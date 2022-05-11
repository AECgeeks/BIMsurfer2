class MeasurementCanvas {
  constructor(scene, domNode) {
    this.pointToPointLines = [];
    this.aspect = 1.;
    this.is_enabled = false;

    this.use_xeogl = !!scene.worldBoundary;

    this.mathUtils = {
      makeMatrix: this.use_xeogl ?
                function(s, lengthUnit) {
                  if (arguments.length == 0) {
                    return xeogl.math.mat4();
                  }

                  const m = xeogl.math.mat4(s.split(' '));
                  m[12] *= lengthUnit;
                  m[13] *= lengthUnit;
                  m[14] *= lengthUnit;
                  return m;
                } :
                function(s, lengthUnit) {
                  const m = new THREE.Matrix4;
                  if (arguments.length == 0) return m;

                  const f = new Float32Array(s.split(' '));
                  f[12] *= lengthUnit;
                  f[13] *= lengthUnit;
                  f[14] *= lengthUnit;
                  m.set.apply(m, f);
                  m.transpose();
                  return m;
                },

      invert: this.use_xeogl ? xeogl.math.inverseMat4 : function(m, n) {
        return m.getInverse(n);
      },

      scaleMatrix: this.use_xeogl ? xeogl.math.scalingMat4s : function(v) {
        return makeMatrix().scale(new THREE.Vector3(v, v, v));
      },

      makeVec4: this.use_xeogl ? function() {
        return xeogl.math.vec4(arguments[0], arguments[1], arguments[2], len(arguments) > 3 ? arguments[3] : 1.0);
      } : function(x, y, z, w) {
        return new THREE.Vector4(x, y, z, typeof(w) == 'undefined' ? 1.0 : w);
      },

      m4v4: this.use_xeogl ? xeogl.math.mulMat4v4 : function(m, v) {
        return v.clone().applyMatrix4(m);
      },

      m4m4_inplace: this.use_xeogl ? function(m, n) {
        xeogl.math.mulMat4(m, n, m);
      } : function(m, n) {
        m.multiply(n);
      },

      logMatrix: function(n, m) {
        if (m.elements) {
          m = m.elements; ;
        }
        console.log(n, ...m);
      },

      pdiv: this.use_xeogl ? function(v) {
        xeogl.math.mulVec3Scalar(v, 1. / v[3]);
        v[3] = 1.;
      } :
            function(v) {
              v.divideScalar(v.w);
            },

      mulvec3s: this.use_xeogl ? xeogl.math.mulVec3Scalar :
            function(v, s) {
              v.multiplyScalar(s);
            },

      subv3: this.use_xeogl ? xeogl.math.subVec3 :
            function(a, b, dest) {
              return dest.subVectors(a, b);
            },

      addv3: this.use_xeogl ? xeogl.math.addVec3 :
            function(a, b, dest) {
              return dest.addVectors(a, b);
            },

      length: this.use_xeogl ? xeogl.math.lenVec3 :
            function(v) {
              return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
            },
    };

    // Create SVG and marker defs for arrowheads

    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');

    let marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttributeNS(null, 'id', 'm1');
    marker.setAttributeNS(null, 'markerWidth', 13);
    marker.setAttributeNS(null, 'markerHeight', 13);
    marker.setAttributeNS(null, 'refX', 10);
    marker.setAttributeNS(null, 'refY', 6);
    marker.setAttributeNS(null, 'orient', 'auto');

    let path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttributeNS(null, 'd', 'M2,2 L2,11 L10,6 L2,2');
    path.setAttributeNS(null, 'style', 'fill: #000000;');
    marker.appendChild(path);

    path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttributeNS(null, 'd', 'M10,2 L10,11');
    path.setAttributeNS(null, 'style', 'stroke: #000000; stroke-width: 1');
    marker.appendChild(path);

    defs.appendChild(marker);

    marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
    marker.setAttributeNS(null, 'id', 'm2');
    marker.setAttributeNS(null, 'markerWidth', 13);
    marker.setAttributeNS(null, 'markerHeight', 13);
    marker.setAttributeNS(null, 'refX', 2);
    marker.setAttributeNS(null, 'refY', 6);
    marker.setAttributeNS(null, 'orient', 'auto');

    path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttributeNS(null, 'd', 'M10,2 L10,11 L2,6 L10,2');
    path.setAttributeNS(null, 'style', 'fill: #000000;');
    marker.appendChild(path);

    path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttributeNS(null, 'd', 'M2,2 L2,11');
    path.setAttributeNS(null, 'style', 'stroke: #000000; stroke-width: 1');
    marker.appendChild(path);

    defs.appendChild(marker);

    const colors = ['red', 'green', 'blue'];

    [0, 1, 2].forEach(function(idx) {
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.setAttributeNS(null, 'id', 'sub'+idx);
      marker.setAttributeNS(null, 'markerWidth', 9);
      marker.setAttributeNS(null, 'markerHeight', 9);
      marker.setAttributeNS(null, 'refX', 5);
      marker.setAttributeNS(null, 'refY', 5);

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttributeNS(null, 'cx', '5');
      circle.setAttributeNS(null, 'cy', '5');
      circle.setAttributeNS(null, 'r', '3');
      circle.setAttributeNS(null, 'style', 'stroke: '+colors[idx]+'; fill:white; stroke-width: 1');
      marker.appendChild(circle);

      defs.appendChild(marker);
    });

    this.svg.appendChild(defs);

    const style = this.svg.style;
    style.padding = '0';
    style.margin = '0';
    style.position = 'absolute';
    style.zIndex = '10000';
    style.display = 'block';
    style.pointerEvents = 'none';

    document.body.appendChild(this.svg);

    // Keep camera matrices in sync
    if (this.use_xeogl) {
      const matrix = xeogl.math.mat4();
      let projMatrix = scene.camera.project._matrix;
      let viewMatrix = scene.camera.view._matrix;

      var updateMC = function() {
        if (projMatrix && viewMatrix) {
          xeogl.math.mulMat4(projMatrix, viewMatrix, matrix);
          this.update(matrix);
        }
      };

      scene.camera.on('viewMatrix', function() {
        viewMatrix = scene.camera.view._matrix;
        updateMC();
      });

      scene.camera.on('projectMatrix', function() {
        projMatrix = scene.camera.project._matrix;
        updateMC();
      });
    } else {
      // manually call update() by connecting to the OrbitControls.change event
    }

    // Keep canvas dimensions in sync

    let firstTick = true;
    const counters = {
      lastWindowWidth: null,
      lastWindowHeight: null,
      lastCanvasWidth: null,
      lastCanvasHeight: null,
      lastCanvasOffsetLeft: null,
      lastCanvasOffsetTop: null,
    };

    const register = function(a, b) {
      if (a == 'scene.tick') {
        if (this.use_xeogl) {
          scene.on('tick', b);
        } else {
          scene.onBeforeRender = b;
        }
      }
    };

    register('scene.tick', function() {
      // Copied from xeogl
      const canvas = (this.canvas || (this.canvas = scene.canvas ? scene.canvas.canvas : document.getElementById(domNode).children[0]));

      const compare = function(_) {
        const [elem, attr, counter] = _;
        if (elem[attr] != counters[counter]) {
          counters[counter] = elem[attr];
          return true;
        }
        return false;
      };

      const update = [[window, 'innerWidth', 'lastWindowWidth'],
        [window, 'innerHeight', 'lastWindowHeight'],
        [canvas, 'clientWidth', 'lastCanvasWidth'],
        [canvas, 'clientHeight', 'lastCanvasHeight'],
        [canvas, 'offsetLeft', 'lastCanvasOffsetLeft'],
        [canvas, 'offsetTop', 'lastCanvasOffsetTop']].map(compare).reduce(function(a, b) {
        return a || b;
      });

      if (update || firstTick) {
        this.resize(canvas);
      }

      firstTick = false;
    });

    if (this.use_xeogl) {
      updateMC();
    }
  }

  add(a, b, opts) {
    opts = opts || {};

    let m;

    if (opts.components) {
      var from = this.mathUtils.makeVec4(...a); var to = this.mathUtils.makeVec4(...b);
      let matrix; let invmatrix;

      if (opts.normal) {
        matrix = xeogl.math.mat4();
        invmatrix = xeogl.math.mat4();
        matrix.set(opts.normal);
        xeogl.math.normalizeVec3(matrix);
        const up = (Math.abs(matrix[10]) + 1e-2) > 1. ? [1, 0, 0] : [0, 0, 1];
        xeogl.math.cross3Vec3(matrix, up, matrix.subarray(4));
        xeogl.math.cross3Vec3(matrix, matrix.subarray(4), matrix.subarray(8));
        xeogl.math.normalizeVec3(matrix.subarray(4));
        xeogl.math.normalizeVec3(matrix.subarray(8));
        matrix[15] = 1.;
        xeogl.math.inverseMat4(matrix, invmatrix);
      }

      subs = [0, 1, 2].map(function(idx) {
        return {points: [a, b], node: null, label: null, threshold: 0.01, font_size: 8, color: colors[idx], dash: '4', start: 'none', end: 'sub'+idx, type: opts.type, set: function(i, p, no_update) {
          this.points[i] = p;
          if (this.label) {
            this.svg.removeChild(this.label);
            this.label = null;
          }
          if (!no_update) {
            this.update();
          }
        }};
      });

      const temp = xeogl.math.vec4();
      const temp2 = xeogl.math.vec4();
      const temp3 = xeogl.math.vec4();

      subs.forEach(function(sub) {
        this.pointToPointLines.push(sub);
      });

      const updateSubs = function(a, b, align) {
        if (matrix && align) {
          var from = a.slice();
          var to = a.slice();
          subtract(b, a, temp);
          temp.set(mulmat4(invmatrix, temp));
          subs.forEach(function(sub, idx) {
            temp2.fill(0);
            temp2[idx] = temp[idx];
            temp3.set(mulmat4(matrix, temp2));
            add(to, temp3, to);
            sub.set(0, from.slice(), true);
            sub.set(1, to.slice(), true);
            from.set(to);
          });
        } else {
          var from = a.slice(); var to = a.slice();
          subs.forEach(function(sub, idx) {
            to[idx] = b[idx];
            sub.set(0, from.slice(), true);
            sub.set(1, to.slice(), true);
            from.set(to);
          });
        }
      };

      m = {points: [a, b], node: null, label: null, type: opts.type, set: function(i, p, align) {
        this.points[i] = p;
        if (this.label) {
          this.svg.removeChild(this.label);
          this.label = null;
        }
        updateSubs(this.points[0], this.points[1], align);
        this.update();
      }};
    } else {
      var from = this.mathUtils.makeVec4(...a); var to = this.mathUtils.makeVec4(...b);
      m = {points: [from, to], node: null, label: null, type: opts.type, set: function(i, p) {
        this.points[i] = p;
        if (this.label) {
          this.svg.removeChild(this.label);
          this.label = null;
        }
        this.update();
      }};
    }

    this.pointToPointLines.push(m);
    if (opts.update !== false) {
      this.update();
    }

    return m;
  }

  clearBoundaries() {
    this.pointToPointLines = this.pointToPointLines.filter(function(m) {
      const remove = m.type === 'box';
      if (remove) {
        if (m.node) this.svg.removeChild(m.node);
        if (m.label) this.svg.removeChild(m.label);
      }
      return !remove;
    });
  };

  enabled(b) {
    this.is_enabled = b;
    this.update();
  };

  update(matrix) {
    const m = (this.matrix = (matrix || this.matrix));
    const w = this.w;
    const h = this.h;

    const rects = [];

    function intersectRect(r1, r2) {
      return !(r2.left > r1.right ||
                   r2.right < r1.left ||
                   r2.top > r1.bottom ||
                   r2.bottom < r1.top);
    }

    this.pointToPointLines.forEach(function(l) {
      const ab = l.points.map(function(p) {
        // var v = this.mathUtils.makeVec4(p[0], p[1], p[2], 1.);
        // var v = xeogl.math.vec4();
        v = this.mathUtils.m4v4(m, p);
        // v.set(mulmat4(m, p));
        this.mathUtils.pdiv(v);
        // mulvec3s(v, 1. / v[3]);
        // v[3] = 1.;
        return v;
      });

      if (!ab[0].w || !ab[1].w || Math.abs(ab[0].w) < 1e-9 || Math.abs(ab[1].w) < 1e-9) {
        return;
      }

      const color = l.color || 'black';
      if (l.node === null) {
        let start = l.start || 'm2';
        if (start !== 'none') start = 'url(#'+start+')';
        let end = l.end || 'm1';
        if (end !== 'none') end = 'url(#'+end+')';
        l.node = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        l.node.setAttributeNS(null, 'style', 'stroke: '+color+'; stroke-width: 1; marker-start: '+start+'; marker-end: '+end+';');
        if (l.dash) {
          l.node.setAttributeNS(null, 'stroke-dasharray', l.dash);
        }
        this.svg.appendChild(l.node);
      }

      if (l.label === null) {
        const size = l.font_size || 10;
        l.label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        l.label.setAttributeNS(null, 'style', 'text-anchor: middle; font-family:Verdana; font-size:'+size+'; fill: #fff; stroke: '+color+'; stroke-width: 2; paint-order: stroke; alignment-baseline: middle');
        this.svg.appendChild(l.label);
        const d = this.mathUtils.length(this.mathUtils.subv3(l.points[0], l.points[1], this.mathUtils.makeVec4()));
        l.label.appendChild(document.createTextNode(d.toFixed(2)));
      }

      const c = this.mathUtils.addv3(ab[0], ab[1], this.mathUtils.makeVec4());
      this.mathUtils.mulvec3s(c, 0.5);

      let dx; let dy;
      if (this.use_xeogl) {
        dx = ab[0][0] - ab[1][0];
        dy = ab[0][1] - ab[1][1];
      } else {
        dx = ab[0].x - ab[1].x;
        dy = ab[0].y - ab[1].y;
      }
      const sl = Math.sqrt(dx*dx+dy*dy);
      const threshold = l.threshold || 0.05;
      const hide = sl <= threshold || ab[0][2] > 1. || ab[1][2] > 1. || (!this.is_enabled && l.type === 'box');
      let rot = Math.atan2(-dy, dx * this.aspect) * 180. / Math.PI;

      // Keep text up straight
      rot = (rot + 720) % 360;
      if (rot > 85 && rot < 265) rot += 180;

      let x1; let y1; let x2; let y2; let cx; let cy;
      if (this.use_xeogl) {
        x1 = ab[0][0];
        y1 = -ab[0][1];
        x2 = ab[1][0];
        y2 = -ab[1][1];
        cx = c[0];
        cy = c[1];
      } else {
        x1 = ab[0].x;
        y1 = -ab[0].y;
        x2 = ab[1].x;
        y2 = -ab[1].y;
        cx = c.x;
        cy = c.y;
      }

      l.node.setAttributeNS(null, 'x1', x1 * w + w);
      l.node.setAttributeNS(null, 'y1', y1 * h + h);
      l.node.setAttributeNS(null, 'x2', x2 * w + w);
      l.node.setAttributeNS(null, 'y2', y2 * h + h);

      const xy = this.mathUtils.makeVec4(c.x * w + w, -c.y * h + h, 0, 1);
      const initialxy = this.use_xeogl ? xeogl.math.vec3(xy) : xy.clone();
      const delta = this.mathUtils.subv3(ab[1], ab[0], this.mathUtils.makeVec4());
      if (this.use_xeogl) {
        delta[2] = delta[3] = 0.;
      } else {
        delta.z = delta.w = 0.;
      }
      const len = this.mathUtils.length(delta);

      if (len > 1e-5) {
        this.mathUtils.mulvec3s(delta, 0.02 / len, delta);
        if (this.use_xeogl) {
          delta[0] *= w;
          delta[1] *= -h;
        } else {
          delta.x *= w;
          delta.y *= -h;
        }
      }
      let r2;

      const setpos = function() {
        let xyx; let xyy;
        if (this.use_xeogl) {
          xyx = xy[0];
          xyy = xy[1];
        } else {
          xyx = xy.x;
          xyy = xy.y;
        }
        l.label.setAttributeNS(null, 'x', xyx);
        l.label.setAttributeNS(null, 'y', xyy);
        l.label.setAttributeNS(null, 'transform', 'rotate('+rot+' '+xyx+','+xyy+')');
      };

      let success = false;
      for (let attempt = 0; attempt < 2; ++attempt) {
        let i = 10;
        while (i--) {
          setpos();
          r2 = l.label.getBoundingClientRect();

          if (rects.some(function(r1) {
            return intersectRect(r1, r2);
          })) {
            xeogl.math.addVec3(xy, delta, xy);
            continue;
          } else {
            success = true;
            break;
          }
        }
        if (success) {
          break;
        }
        if (this.use_xeogl) {
          xy.set(initialxy);
        } else {
          xy.copy(initialxy);
        }

        // Reverse search direction
        if (this.use_xeogl) {
          xeogl.math.mulVec2Scalar(delta, -1, delta);
        } else {
          delta.x *= -1.;
          delta.y *= -1.;
        }
      }

      if (!success) {
        // Set to initial overlapping center
        setpos();
      }

      rects.push(r2);

      l.node.style.visibility = hide ? 'hidden' : 'visible';
      l.label.style.visibility = hide ? 'hidden' : 'visible';
    });
  }

  drawPointToPoint(a, b) {
    return this.add(a, b, {type: 'p2p'});
  }

  drawBoundary(eye, obb) {
    const P = function(i) {
      return obb.slice(4*i, 4*i+4);
    };

    let closest = -1;
    let closestDistance = Infinity;

    let j;
    for (let i = 0; i < 4; ++i) {
      j = i;
      if (i & 2) {
        j = (i & ~1) + ((i+1)%2);
      }
      const p = P(j);
      const d = xeogl.math.lenVec3(xeogl.math.subVec3(eye, p, xeogl.math.vec3()));
      if (d < closestDistance) {
        closest = i;
        closestDistance = d;
      }
    }

    let b = (closest & ~1) + ((closest+1) % 2);
    let c = (closest & ~3) + ((closest+2) % 4);

    // Correct for order in which points are defined

    // 3---2            2---3
    // |   | instead of |   |
    // 0---1            0---1

    if (closest & 2) {
      closest = (closest & ~1) + ((closest+1)%2);
    }
    if (b & 2) {
      b = (b & ~1) + ((b+1)%2);
    }
    if (c & 2) {
      c = (c & ~1) + ((c+1)%2);
    }

    const A = P(closest);
    const a = closest + 4;

    this.add(A, P(a), {update: false, type: 'box'});
    this.add(A, P(b), {update: false, type: 'box'});
    this.add(A, P(c), {update: false, type: 'box'});

    this.update();
  }

  resize(canvas) {
    // copied from xeogl
    const getElementXY = function(e) {
      let x = 0; let y = 0;
      while (e) {
        x += (e.offsetLeft-e.scrollLeft);
        y += (e.offsetTop-e.scrollTop);
        e = e.offsetParent;
      }

      const bodyRect = document.body.getBoundingClientRect();
      return {
        x: (x - bodyRect.left),
        y: (y - bodyRect.top),
      };
    };

    const svgStyle = this.svg.style;
    const xy = getElementXY(canvas);
    svgStyle.left = xy.x + 'px';
    svgStyle.top = xy.y + 'px';
    svgStyle.width = (this.w = canvas.clientWidth) + 'px';
    svgStyle.height = (this.h = canvas.clientHeight) + 'px';
    this.svg.setAttribute('width', this.w);
    this.svg.setAttribute('height', this.h);
    this.svg.setAttribute('viewBox', '0 0 ' + this.w + ' ' + this.h);
    this.w /= 2.;
    this.h /= 2.;

    this.aspect = this.w / this.h;
  }
}
