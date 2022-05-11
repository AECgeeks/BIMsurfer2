define(['../../../lib/xeogl'], function() {
  'use strict';

  /**

     Controls camera with mouse and keyboard, handles selection of entities and rotation point.

     */
  xeogl.BIMCameraControl = xeogl.Component.extend({

    type: 'xeogl.BIMCameraControl',

    _init: function(cfg) {
      const self = this;

      const math = xeogl.math;

      // Configs

      const sensitivityKeyboardRotate = cfg.sensitivityKeyboardRotate || 0.5;

      const orthoScaleRate = 0.02; // Rate at which orthographic scale changes with zoom

      const canvasPickTolerance = 4;
      const worldPickTolerance = 3;

      const pitchMat = math.mat4();

      const camera = cfg.camera;
      const view = camera.view;
      const project = camera.project;
      const scene = this.scene;
      const input = scene.input;

      // Camera position on last mouse click
      let rotateStartEye;
      let rotateStartLook;
      const rotateStartUp = math.vec3();

      const orbitPitchAxis = math.vec3([1, 0, 0]); // The current axis for vertical orbit

      let pickHit; // Hit record from the most recent pick
      let pickClicks = 0; // Number of times we've clicked on same spot on entity

      const mouseClickPos = math.vec2(); // Canvas position of last mouseDown
      let firstPickCanvasPos = math.vec2(); // Canvas position of first pick
      let firstPickWorldPos = math.vec2(); // World position of first pick
      let firstPickTime; // Time of first pick

      const rotatePos = this._rotatePos = math.vec3([0, 0, 0]); // World-space pivot point we're currently rotating about

      const lastCanvasPos = math.vec2(); // Mouse's position in previous tick
      const rotationDeltas = math.vec2(); // Accumulated angle deltas while rotating with keyboard or mouse

      let shiftDown = false; // True while shift key down
      let mouseDown = false; // true while mouse down

      let flying = false;

      let lastHoverDistance = null;

      this._defaultDragAction = 'orbit';

      // Returns the inverse of the camera's current view transform matrix
      const getInverseViewMat = (function() {
        let viewMatDirty = true;
        camera.on('viewMatrix', function() {
          viewMatDirty = true;
        });
        const inverseViewMat = math.mat4();
        return function() {
          if (viewMatDirty) {
            math.inverseMat4(view.matrix, inverseViewMat);
          }
          return inverseViewMat;
        };
      })();

      // Returns the inverse of the camera's current projection transform matrix
      const getInverseProjectMat = (function() {
        let projMatDirty = true;
        camera.on('projectMatrix', function() {
          projMatDirty = true;
        });
        const inverseProjectMat = math.mat4();
        return function() {
          if (projMatDirty) {
            math.inverseMat4(project.matrix, inverseProjectMat);
          }
          return inverseProjectMat;
        };
      })();

      // Returns the transposed copy the camera's current projection transform matrix
      const getTransposedProjectMat = (function() {
        let projMatDirty = true;
        camera.on('projectMatrix', function() {
          projMatDirty = true;
        });
        const transposedProjectMat = math.mat4();
        return function() {
          if (projMatDirty) {
            math.transposeMat4(project.matrix, transposedProjectMat);
          }
          return transposedProjectMat;
        };
      })();

      // Get the current diagonal size of the scene
      const getSceneDiagSize = (function() {
        let sceneSizeDirty = true;
        let diag = 1; // Just in case
        scene.worldBoundary.on('updated', function() {
          sceneSizeDirty = true;
        });
        return function() {
          if (sceneSizeDirty) {
            diag = math.getAABB3Diag(scene.worldBoundary.aabb);
          }
          return diag;
        };
      })();

      const rotate = (function() {
        const tempVec3a = math.vec3();
        const tempVec3b = math.vec3();
        const tempVec3c = math.vec3();
        return function(p) {
          const p1 = math.subVec3(p, rotatePos, tempVec3a);
          const p2 = math.transformVec3(pitchMat, p1, tempVec3b);
          const p3 = math.addVec3(p2, rotatePos, tempVec3c);
          return math.rotateVec3Z(p3, rotatePos, -rotationDeltas[0] * math.DEGTORAD, math.vec3());
        };
      })();

      // Rotation point indicator

      const pickHelper = this.create({
        type: 'xeogl.Entity',
        geometry: this.create({
          type: 'xeogl.SphereGeometry',
          radius: 1.0,
        }),
        material: this.create({
          type: 'xeogl.PhongMaterial',
          diffuse: [0, 0, 0],
          ambient: [0, 0, 0],
          specular: [0, 0, 0],
          emissive: [1.0, 1.0, 0.6], // Glowing
          lineWidth: 4,
        }),
        transform: this.create({
          type: 'xeogl.Translate',
          xyz: [0, 0, 0],
        }),
        visibility: this.create({
          type: 'xeogl.Visibility',
          visible: false, // Initially invisible
        }),
        modes: this.create({
          type: 'xeogl.Modes',
          collidable: false, // This helper has no collision boundary of its own
        }),
      });

      // Shows the rotation point indicator
      // at the given position for one second

      const showRotationPoint = (function() {
        let pickHelperHide = null;

        return function(pos) {
          pickHelper.transform.xyz = pos;
          pickHelper.visibility.visible = true;

          if (pickHelperHide) {
            clearTimeout(pickHelperHide);
            pickHelperHide = null;
          }

          pickHelperHide = setTimeout(function() {
            pickHelper.visibility.visible = false;
            pickHelperHide = null;
          },
          1000);
        };
      })();


      let pickTimer;

      // Fires a "pick" after a timeout period unless clearPickTimer is called before then.
      function startPickTimer() {
        if (pickTimer) {
          clearPickTimer();
        }

        pickTimer = setTimeout(function() {
          pickClicks = 0;
          self.fire('pick', pickHit);
          pickTimer = null;
        }, 250);
      }

      // Stops a previous call to startPickTimer from firing a "pick"
      function clearPickTimer() {
        clearTimeout(pickTimer);
        pickTimer = null;
      }


      function resetRotate() {
        pickClicks = 0;

        rotationDeltas[0] = 0;
        rotationDeltas[1] = 0;

        rotateStartEye = view.eye.slice();
        rotateStartLook = view.look.slice();
        math.addVec3(rotateStartEye, view.up, rotateStartUp);

        setOrbitPitchAxis();
      }

      function setOrbitPitchAxis() {
        math.cross3Vec3(math.normalizeVec3(math.subVec3(view.eye, view.look, math.vec3())), view.up, orbitPitchAxis);
      }

      const setCursor = (function() {
        let t;

        return function(cursor, persist) {
          clearTimeout(t);

          self.scene.canvas.overlay.style['cursor'] = cursor;

          if (!persist) {
            t = setTimeout(function() {
              self.scene.canvas.overlay.style['cursor'] = 'auto';
            }, 100);
          }
        };
      })();

      input.on('mousedown',
          function(canvasPos) {
            canvasPos = canvasPos.slice();

            if (!input.mouseover) {
              return;
            }

            if (!input.mouseDownLeft) {
              return;
            }

            if (flying) {
              return;
            }

            clearPickTimer();

            setOrbitPitchAxis();

            rotateStartEye = view.eye.slice();
            rotateStartLook = view.look.slice();
            math.addVec3(rotateStartEye, view.up, rotateStartUp);

            pickHit = scene.pick({
              canvasPos: canvasPos,
              pickSurface: true,
            });

            if (pickHit && pickHit.worldPos) {
              const pickWorldPos = pickHit.worldPos.slice();
              const pickCanvasPos = canvasPos;

              const pickTime = Date.now();

              if (pickClicks === 1) {
                if ((pickTime - firstPickTime < 250) &&
                                closeEnoughCanvas(canvasPos, firstPickCanvasPos) &&
                                closeEnoughWorld(pickWorldPos, firstPickWorldPos)) {
                  // Double-clicked

                  rotatePos.set(pickWorldPos);

                  showRotationPoint(pickWorldPos);
                }

                pickClicks = 0;
              } else {
                pickClicks = 1;

                firstPickWorldPos = pickWorldPos;
                firstPickCanvasPos = pickCanvasPos;
                firstPickTime = pickTime;
              }
            } else {
              pickClicks = 0;
            }

            mouseClickPos[0] = canvasPos[0];
            mouseClickPos[1] = canvasPos[1];

            rotationDeltas[0] = 0;
            rotationDeltas[1] = 0;

            mouseDown = true;
          });

      // Returns true if the two Canvas-space points are
      // close enough to be considered the same point

      function closeEnoughCanvas(p, q) {
        return p[0] >= (q[0] - canvasPickTolerance) &&
                    p[0] <= (q[0] + canvasPickTolerance) &&
                    p[1] >= (q[1] - canvasPickTolerance) &&
                    p[1] <= (q[1] + canvasPickTolerance);
      }

      // Returns true if the two World-space points are
      // close enough to be considered the same point

      function closeEnoughWorld(p, q) {
        return p[0] >= (q[0] - worldPickTolerance) &&
                    p[0] <= (q[0] + worldPickTolerance) &&
                    p[1] >= (q[1] - worldPickTolerance) &&
                    p[1] >= (q[1] - worldPickTolerance) &&
                    p[2] <= (q[2] + worldPickTolerance) &&
                    p[2] <= (q[2] + worldPickTolerance);
      }

      const tempVecHover = math.vec3();

      const updateHoverDistanceAndCursor = function(canvasPos) {
        const hit = scene.pick({
          canvasPos: canvasPos || lastCanvasPos,
          pickSurface: true,
        });

        if (hit) {
          setCursor('pointer', true);
          if (hit.worldPos) {
            // TODO: This should be somehow hit.viewPos.z, but doesn't seem to be
            lastHoverDistance = math.lenVec3(math.subVec3(hit.worldPos, view.eye, tempVecHover));
          }
        } else {
          setCursor('auto', true);
        }
      };

      input.on('mousemove',
          function(canvasPos) {
            if (!input.mouseover) {
              return;
            }

            if (flying) {
              return;
            }

            if (!mouseDown) {
              updateHoverDistanceAndCursor(canvasPos);

              lastCanvasPos[0] = canvasPos[0];
              lastCanvasPos[1] = canvasPos[1];

              return;
            }

            const sceneSize = getSceneDiagSize();

            // Use normalized device coords
            const canvas = scene.canvas.canvas;
            const cw2 = canvas.offsetWidth / 2.;
            const ch2 = canvas.offsetHeight / 2.;

            const inverseProjMat = getInverseProjectMat();
            const inverseViewMat = getInverseViewMat();

            // Get last two columns of projection matrix
            const transposedProjectMat = getTransposedProjectMat();
            const Pt3 = transposedProjectMat.subarray(8, 12);
            const Pt4 = transposedProjectMat.subarray(12);

            // TODO: Should be simpler to get the projected Z value
            const D = [0, 0, -(lastHoverDistance || sceneSize), 1];
            const Z = math.dotVec4(D, Pt3) / math.dotVec4(D, Pt4);

            // Returns in camera space and model space as array of two points
            const unproject = function(p) {
              let cp = math.vec4();
              cp[0] = (p[0] - cw2) / cw2;
              cp[1] = (p[1] - ch2) / ch2;
              cp[2] = Z;
              cp[3] = 1.;
              cp = math.vec4(math.mulMat4v4(inverseProjMat, cp));

              // Normalize homogeneous coord
              math.mulVec3Scalar(cp, 1.0 / cp[3]);
              cp[3] = 1.0;

              // TODO: Why is this reversed?
              cp[0] *= -1;

              const cp2 = math.vec4(math.mulMat4v4(inverseViewMat, cp));
              return [cp, cp2];
            };

            const A = unproject(canvasPos);
            const B = unproject(lastCanvasPos);

            let panning = self._defaultDragAction === 'pan';

            if (input.keyDown[input.KEY_SHIFT] || input.mouseDownMiddle || (input.mouseDownLeft && input.mouseDownRight)) {
              panning = !panning;
            }

            if (panning) {
              // TODO: view.pan is in view space? We have a world coord vector.

              // Subtract model space unproject points
              math.subVec3(A[1], B[1], tempVecHover);
              view.eye = math.addVec3(view.eye, tempVecHover);
              view.look = math.addVec3(view.look, tempVecHover);
            } else {
              // If not panning, we are orbiting

              // Subtract camera space unproject points
              math.subVec3(A[0], B[0], tempVecHover);

              //           v because reversed above
              const xDelta = - tempVecHover[0] * Math.PI;
              const yDelta = tempVecHover[1] * Math.PI;

              rotationDeltas[0] += xDelta;
              rotationDeltas[1] += yDelta;

              math.rotationMat4v(rotationDeltas[1] * math.DEGTORAD, orbitPitchAxis, pitchMat);

              view.eye = rotate(rotateStartEye);
              view.look = rotate(rotateStartLook);
              view.up = math.subVec3(rotate(rotateStartUp), view.eye, math.vec3());
            }

            lastCanvasPos[0] = canvasPos[0];
            lastCanvasPos[1] = canvasPos[1];
          });

      input.on('keydown',
          function(keyCode) {
            if (keyCode === input.KEY_SHIFT) {
              shiftDown = true;
            }
          });

      input.on('keyup',
          function(keyCode) {
            if (keyCode === input.KEY_SHIFT) {
              shiftDown = false;
              resetRotate();
            }
          });

      input.on('mouseup',
          function(canvasPos) {
            if (!mouseDown) {
              return;
            }

            if (flying) {
              return;
            }

            mouseDown = false;

            if (input.mouseover) {
              if (firstPickCanvasPos && closeEnoughCanvas(canvasPos, firstPickCanvasPos)) {
                if (pickClicks === 1) {
                  if (shiftDown) {
                    pickClicks = 0;

                    self.fire('pick', pickHit);
                  } else {
                    startPickTimer();
                  }
                } else {
                  //  self.fire("nopick");
                }
              } else if (pickClicks === 0) {
                if (mouseClickPos && closeEnoughCanvas(canvasPos, mouseClickPos)) {
                  self.fire('nopick');
                }
              }
            }
          });

      input.on('dblclick',
          function() {
            if (flying) {
              return;
            }

            mouseDown = false;
          });

      // ---------------------------------------------------------------------------------------------------------
      // Keyboard rotate camera
      // ---------------------------------------------------------------------------------------------------------


      scene.on('tick',
          function(params) {
            if (!input.mouseover) {
              return;
            }

            if (mouseDown) {
              return;
            }

            if (flying) {
              return;
            }

            if (!input.ctrlDown && !input.altDown) {
              const left = input.keyDown[input.KEY_LEFT_ARROW];
              const right = input.keyDown[input.KEY_RIGHT_ARROW];
              const up = input.keyDown[input.KEY_UP_ARROW];
              const down = input.keyDown[input.KEY_DOWN_ARROW];

              if (left || right || up || down) {
                const elapsed = params.deltaTime;
                const yawRate = sensitivityKeyboardRotate * 0.3;
                const pitchRate = sensitivityKeyboardRotate * 0.3;
                let yaw = 0;
                let pitch = 0;

                if (right) {
                  yaw = -elapsed * yawRate;
                } else if (left) {
                  yaw = elapsed * yawRate;
                }

                if (down) {
                  pitch = elapsed * pitchRate;
                } else if (up) {
                  pitch = -elapsed * pitchRate;
                }

                if (Math.abs(yaw) > Math.abs(pitch)) {
                  pitch = 0;
                } else {
                  yaw = 0;
                }

                rotationDeltas[0] -= yaw;
                rotationDeltas[1] += pitch;

                math.rotationMat4v(rotationDeltas[1] * math.DEGTORAD, orbitPitchAxis, pitchMat);

                view.eye = rotate(rotateStartEye);
                view.look = rotate(rotateStartLook);
                view.up = math.subVec3(rotate(rotateStartUp), view.eye, math.vec3());
              }
            }
          });


      // ---------------------------------------------------------------------------------------------------------
      // Keyboard zoom camera
      // ---------------------------------------------------------------------------------------------------------

      (function() {
        const tempVec3a = math.vec3();
        const tempVec3b = math.vec3();
        const tempVec3c = math.vec3();
        const eyePivotVec = math.vec3();

        scene.on('tick',
            function(params) {
              if (!input.mouseover) {
                return;
              }

              if (mouseDown) {
                return;
              }

              if (flying) {
                return;
              }

              const elapsed = params.deltaTime;

              if (!input.ctrlDown && !input.altDown) {
                const wkey = input.keyDown[input.KEY_ADD];
                const skey = input.keyDown[input.KEY_SUBTRACT];

                if (wkey || skey) {
                  const sceneSize = getSceneDiagSize();
                  const rate = sceneSize / 5000.0;

                  let delta = 0;

                  if (skey) {
                    delta = elapsed * rate; // Want sensitivity configs in [0..1] range
                  } else if (wkey) {
                    delta = -elapsed * rate;
                  }

                  const eye = view.eye;
                  const look = view.look;

                  // Get vector from eye to center of rotation
                  math.mulVec3Scalar(math.normalizeVec3(math.subVec3(eye, rotatePos, tempVec3a), tempVec3b), delta, eyePivotVec);

                  // Move eye and look along the vector
                  view.eye = math.addVec3(eye, eyePivotVec, tempVec3c);
                  view.look = math.addVec3(look, eyePivotVec, tempVec3c);

                  if (project.isType('xeogl.Ortho')) {
                    project.scale += delta * orthoScaleRate;
                  }

                  resetRotate();
                }
              }
            });
      })();

      // ---------------------------------------------------------------------------------------------------------
      // Mouse zoom
      // Roll mouse wheel to move eye and look closer or further from center of rotationDeltas
      // ---------------------------------------------------------------------------------------------------------

      (function() {
        let delta = 0;
        let target = 0;
        let newTarget = false;
        let targeting = false;
        let progress = 0;

        const tempVec3a = math.vec3();
        const tempVec3b = math.vec3();
        const newEye = math.vec3();
        const newLook = math.vec3();
        const eyePivotVec = math.vec3();


        input.on('mousewheel',
            function(_delta) {
              if (mouseDown) {
                return;
              }

              if (flying) {
                return;
              }

              delta = -_delta;

              if (delta === 0) {
                targeting = false;
                newTarget = false;
              } else {
                newTarget = true;
              }
            });

        let updateTimeout = null;

        scene.on('tick',
            function(e) {
              if (!targeting && !newTarget) {
                return;
              }

              if (mouseDown) {
                return;
              }

              if (flying) {
                return;
              }

              if (updateTimeout) {
                clearTimeout(updateTimeout);
              }
              updateTimeout = setTimeout(function() {
                updateHoverDistanceAndCursor();
                updateTimeout = null;
              }, 50);

              const zoomTimeInSeconds = 0.2;
              let viewDistance = getSceneDiagSize();
              if (lastHoverDistance) {
                viewDistance = viewDistance * 0.02 + lastHoverDistance;
              }

              const tickDeltaSecs = e.deltaTime / 1000.0;
              const f = viewDistance * ((delta < 0) ? -1 : 1) / zoomTimeInSeconds / 100.;

              if (newTarget) {
                target = zoomTimeInSeconds;

                progress = 0;
                newTarget = false;
                targeting = true;
              }

              if (targeting) {
                progress += tickDeltaSecs;

                if (progress > target) {
                  targeting = false;
                }

                if (targeting) {
                  const eye = view.eye;
                  const look = view.look;

                  math.mulVec3Scalar(xeogl.math.transposeMat4(view.matrix).slice(8), f, eyePivotVec);
                  math.addVec3(eye, eyePivotVec, newEye);
                  math.addVec3(look, eyePivotVec, newLook);

                  const lenEyePivotVec = Math.abs(math.lenVec3(eyePivotVec));
                  const currentEyePivotDist = Math.abs(math.lenVec3(math.subVec3(eye, rotatePos, math.vec3())));

                  // if (lenEyePivotVec < currentEyePivotDist - 10) {

                  // Move eye and look along the vector
                  view.eye = newEye;
                  view.look = newLook;

                  if (project.isType('xeogl.Ortho')) {
                    project.scale += delta * orthoScaleRate;
                  }
                  // }

                  resetRotate();
                }
              }
            });
      })();

      // ---------------------------------------------------------------------------------------------------------
      // Keyboard axis view
      // Press 1,2,3,4,5 or 6 to view center of model from along an axis
      // ---------------------------------------------------------------------------------------------------------

      (function() {
        const flight = self.create({
          type: 'xeogl.CameraFlightAnimation',
          camera: camera,
          duration: 1.0, // One second to fly to each new target
        });

        function fly(eye, look, up) {
          rotatePos.set(look);

          flying = true;

          flight.cancel();

          flight.flyTo({
            look: look,
            eye: eye,
            up: up,
          },
          function() {
            resetRotate();

            flying = false;
          });
        }

        input.on('keydown',
            function(keyCode) {
              if (!input.mouseover) {
                return;
              }

              if (mouseDown) {
                return;
              }

              if (keyCode !== input.KEY_NUM_1 &&
                            keyCode !== input.KEY_NUM_2 &&
                            keyCode !== input.KEY_NUM_3 &&
                            keyCode !== input.KEY_NUM_4 &&
                            keyCode !== input.KEY_NUM_5 &&
                            keyCode !== input.KEY_NUM_6) {
                return;
              }

              const boundary = scene.worldBoundary;
              const aabb = boundary.aabb;
              const center = boundary.center;
              const diag = math.getAABB3Diag(aabb);
              const fitFOV = 55;
              const dist = Math.abs((diag) / Math.tan(fitFOV/2));

              switch (keyCode) {
                case input.KEY_NUM_1: // Right view
                  fly(math.vec3([center[0] - dist, center[1], center[2]]), center, math.vec3([0, 0, 1]));
                  break;

                case input.KEY_NUM_2: // Back view
                  fly(math.vec3([center[0], center[1] + dist, center[2]]), center, math.vec3([0, 0, 1]));
                  break;

                case input.KEY_NUM_3: // Left view
                  fly(math.vec3([center[0] + dist, center[1], center[2]]), center, math.vec3([0, 0, 1]));
                  break;

                case input.KEY_NUM_4: // Front view
                  fly(math.vec3([center[0], center[1] - dist, center[2]]), center, math.vec3([0, 0, 1]));
                  break;

                case input.KEY_NUM_5: // Top view
                  fly(math.vec3([center[0], center[1], center[2] + dist]), center, math.vec3([0, 1, 0]));
                  break;

                case input.KEY_NUM_6: // Bottom view
                  fly(math.vec3([center[0], center[1], center[2] - dist]), center, math.vec3([0, -1, 0]));
                  break;

                default:
                  return;
              }
            });
      })();

      // ---------------------------------------------------------------------------------------------------------
      // Keyboard pan camera
      // Press W,S,A or D to pan the camera
      // ---------------------------------------------------------------------------------------------------------

      scene.on('tick', (function() {
        const tempVec3 = math.vec3();

        return function(params) {
          if (mouseDown) {
            return;
          }

          if (!input.mouseover) {
            return;
          }

          if (flying) {
            return;
          }

          const elapsed = params.deltaTime;

          if (!input.ctrlDown && !input.altDown) {
            const wkey = input.keyDown[input.KEY_W];
            const skey = input.keyDown[input.KEY_S];
            const akey = input.keyDown[input.KEY_A];
            const dkey = input.keyDown[input.KEY_D];
            const zkey = input.keyDown[input.KEY_Z];
            const xkey = input.keyDown[input.KEY_X];

            if (wkey || skey || akey || dkey || xkey || zkey) {
              let x = 0;
              let y = 0;
              let z = 0;

              const sceneSize = getSceneDiagSize();
              const sensitivity = sceneSize / 4000.0;

              if (skey) {
                y = elapsed * sensitivity;
              } else if (wkey) {
                y = -elapsed * sensitivity;
              }

              if (dkey) {
                x = elapsed * sensitivity;
              } else if (akey) {
                x = -elapsed * sensitivity;
              }

              if (xkey) {
                z = elapsed * sensitivity;
              } else if (zkey) {
                z = -elapsed * sensitivity;
              }

              tempVec3[0] = x;
              tempVec3[1] = y;
              tempVec3[2] = z;

              view.pan(tempVec3);

              resetRotate();
            }
          }
        };
      })());
    },

    _props: {

      // The position we're currently orbiting
      rotatePos: {

        set: function(value) {
          if (value) {
            this._rotatePos.set(value);
          }
        },
      },

      defaultDragAction: {
        set: function(value) {
          if (value === 'pan' || value === 'orbit') {
            this._defaultDragAction = value;
          }
        },
      },
    },
  });
});
