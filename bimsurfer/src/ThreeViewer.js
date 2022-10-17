import EventHandler from './EventHandler.js';
import * as Utils from './Utils.js';
import * as THREE from 'three';
import {DRACOLoader} from '../lib/three/r140/DRACOLoader.js';
import {GLTFLoader} from '../lib/three/r140/GLTFLoader.js';
import {OrbitControls} from '../lib/three/r140/OrbitControls.js';
import {SSAOPass} from '../lib/three/r140/postprocessing/SSAOPass.js';
import {RenderPass} from '../lib/three/r140/postprocessing/RenderPass.js';
import {EffectComposer} from '../lib/three/r140/postprocessing/EffectComposer.js';

const lineMaterial = new THREE.LineBasicMaterial({
  color: 0x000000,
  transparent: true,
  opacity: 0.3,
});
const lineSelectionMaterial = new THREE.LineBasicMaterial({
  color: 0xff0000,
  // transparent = true, needed apparently to get depthTest to properly function?
  transparent: true,
  depthTest: false,
});
const lineSecondarySelectionMaterial = new THREE.LineBasicMaterial({
  color: 0xdd7011,
  transparent: true,
  depthTest: false,
});

export default class ThreeViewer extends EventHandler {
  constructor(cfg) {
    super(cfg);
    this.cfg = cfg;

    this.allIds = [];
    this.selected = new Set();
    this.secondarySelected = new Set();
    this.previousMaterials = new Map();
    this.originalMaterials = new Map();
    this.secondaryOrPrimary = new Map();
    this.nameToId = new Map();
    this.three = null;

    this.renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });

    this.viewerContainer = document.getElementById(cfg.domNode);

    this.createdModels = [];

    const viewAngle = 45;
    const nearClipping = 0.1;
    const farClipping = 9999;
    this.camera = new THREE.PerspectiveCamera(viewAngle, 1, nearClipping, farClipping);

    // To be redefined later
    this.rerender = () => {};

    this.resize = () => {
      try {
        // Temporarily remove canvas node, because content potentially makes parent element grow
        this.viewerContainer.removeChild(this.renderer.domElement);
      } catch {
        // pass
      }
      const width = this.viewerContainer.offsetWidth;
      let height = this.viewerContainer.offsetHeight;
      if (!height) {
        height = 600;
      }
      this.camera.aspect = width / height;
      if (cfg.withSSAO) {
        this.camera.near = 1.;
        this.camera.far = 100.;
      }
      this.renderer.setSize(width, height);
      this.camera.updateProjectionMatrix();
      this.viewerContainer.appendChild(this.renderer.domElement);
      this.rerender();
    };

    this.resize();

    this.scene = new THREE.Scene();

    this.renderer.setPixelRatio(window.devicePixelRatio);
    if (cfg.withShadowMaps) {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // default THREE.PCFShadowMap
    }

    if (cfg.withSSAO) {
      this.renderer.autoClear = false;
      this.composer = new EffectComposer(this.renderer);
      this.composer.setSize(this.viewerContainer.offsetWidth * 2, this.viewerContainer.offsetHeight * 2);
      const ssaoPass = new SSAOPass(this.scene, this.camera, this.viewerContainer.offsetWidth * 2, this.viewerContainer.offsetHeight * 2);
      ssaoPass.kernelRadius = 1;
      ssaoPass.minDistance = 0.01;
      ssaoPass.maxDistance = 1.0;
      const renderScene = new RenderPass(this.scene, this.camera);
      this.composer.addPass(renderScene);
      this.composer.addPass(ssaoPass);
    }

    // @tfk sortObjects still needs to be enabled for correctly rendering the transparency overlay
    // this.renderer.sortObjects = false;

    this.rerender = () => {
      if (cfg.withSSAO) {
        this.renderer.clear();
        this.camera.layers.set(0);
        this.composer.render();
        this.scene.overrideMaterial = new THREE.MeshBasicMaterial();
        this.scene.overrideMaterial.colorWrite = false;
        this.renderer.render(this.scene, this.camera);
        this.scene.overrideMaterial = null;
        this.camera.layers.set(1);
        this.renderer.render(this.scene, this.camera);
      } else {
        this.renderer.render(this.scene, this.camera);
      }
    };

    // We don't want drag events to be registered as clicks
    this.mouseHasMoved = false;
    this.viewerContainer.addEventListener('click', this._mouseClick.bind(this), false);
    this.viewerContainer.addEventListener('mousedown', () => {
      this.mouseHasMoved = false;
    }, false);
    this.viewerContainer.addEventListener('mousemove', () => {
      this.mouseHasMoved = true;
    }, false);
    this.viewerContainer.addEventListener('mouseup', () => {
      setTimeout(() => {
        this.mouseHasMoved = false;
      }, 20);
    }, false);

    this.renderer.setClearColor(0x000000, 0);

    var light;

    if (!cfg.withShadowMaps) {
      light = new THREE.DirectionalLight(0xFFFFFF);
      light.position.set(20, 10, 30);
      light.layers.enableAll();
      this.scene.add(light);
    }

    light = this.light = new THREE.DirectionalLight(0xFFFFDD, cfg.withShadowMaps ? 0.5 : 0.8);
    if (cfg.withShadowMaps) {
      // Do these really need to be different?
      light.position.set(4, 10, 10);
    } else {
      light.position.set(-10, 1, -30);
    }
    light.layers.enableAll();
    light.castShadow = !!cfg.withShadowMaps;
    this.scene.add(light);

    if (cfg.withShadowMaps) {      
      light.shadow.mapSize.width = 1024;
      light.shadow.mapSize.height = 1024;      
      light.shadow.blurSamples = 0;
      light.shadow.radius = 0;
      light.shadow.bias = -1.e-3;      

      // Add a second identical light to lighten shadows
      light = new THREE.DirectionalLight(0xFFFFDD, 0.3);
      light.position.copy(this.light.position);
      light.layers.enableAll();
      this.scene.add(light);
    }

    light = new THREE.AmbientLight(0x404050, 2.0);
    light.layers.enableAll();
    this.scene.add(light);

    this.controls = new OrbitControls(this.camera, this.viewerContainer);
    this.controls.addEventListener('change', () => {
      this.fire('this.camera-changed', [this.getCamera()]);
      this.rerender();
    });

    this.firstLoad = true;

    this.createdGeometries = {};
    this.createdGeometryColors = {};

    this.transparentLayer = new THREE.Layers();
    this.transparentLayer.set(1);
  }

  resizeShadowMap() {
    let tmp = new THREE.Vector3();
    function* get_corners(bbox) {
      let p = [bbox.min, bbox.max];
      for (let i = 0; i < 8; ++i) {
        tmp.set(
            p[(i&1)?1:0].x,
            p[(i&2)?1:0].y,
            p[(i&4)?1:0].z
        );
        yield tmp;
      }
    }

    let bbox = new THREE.Box3().setFromObject(this.scene);

    let minVec = new THREE.Vector3();
    let maxVec = new THREE.Vector3();

    for (let v of get_corners(bbox)) {
      v.applyMatrix4(this.light.shadow.camera.matrixWorldInverse);
      minVec.min(v);
      maxVec.max(v);
    }
    
    const shadow_map_size = 1;

    

    this.light.shadow.camera.left = minVec.x;
    this.light.shadow.camera.bottom = minVec.y;
    this.light.shadow.camera.right = maxVec.x;
    this.light.shadow.camera.top = maxVec.y;
    this.light.shadow.camera.near = -maxVec.z;
    this.light.shadow.camera.far = -minVec.z;

    this.light.shadow.camera.matrixWorldNeedsUpdate = true;

    this.light.shadow.camera.updateProjectionMatrix();   

    // For visually inspecting the shadow map cam frustrum
    // const cameraHelper = new THREE.CameraHelper(this.light.shadow.camera);
    // this.scene.add(cameraHelper);

    this.rerender();
  }

  containedInModel(obj) {
    for (const m of this.createdModels) {
      if (obj.name.startsWith(m + ':')) {
        return true;
      }
    }
    return false;
  }

  createSelectionMaterial(originalMaterial, secondary) {
    const m = new THREE.MeshStandardMaterial({
      color: originalMaterial.color.clone().lerp(new THREE.Color(secondary ? 0xff8000 : 0xff0000), secondary ? 0.3 : 0.7),
      flatShading: true,
      metalness: 0,
      roughness: 1,
    });
    m.side = THREE.DoubleSide;
    // this does not work well.
    // m.depthTest = false;
    return m;
  }

  reset(params) {
    if (params.colors) {
      for (const [id, mat] of this.originalMaterials) {
        if (!this.selected.has(id)) {
          const obj = this.scene.getObjectById(id);
          obj.material = mat;
        }
      }
      this.rerender();
    } else if (params.visibility) {
      this.scene.traverse((object) => {
        object.visible = true;
      });
    } else if (params.selection) {
      this.setSelection({ids: [], clear: true, selected: true});
    }
    this.rerender();
  }

  loadglTF(src) {
    const loader = new GLTFLoader();

    const isIE11 = !!window.MSInputMethodContext && !!document.documentMode;

    if (!isIE11) {
      const draco = new DRACOLoader;
      let origin;
      try {
        if (import.meta.webpack) {
          // Most likely using ifc-pipeline. Inspect scripts in head to
          // find origin.
          const scriptSrc = Array.from(document.head.getElementsByTagName('script'))
              .map((x) => x.src)
              .filter((x) => x.indexOf('static/App.') !== -1);
          if (scriptSrc.length === 1) {
            origin = new URL('./bimsurfer/src/v2/bimsurfer', new URL(scriptSrc[0])).toString();
          } else {
            throw new Error();
          }
        } else {
          origin = import.meta.url.replace('/src/ThreeViewer.js', '');
        }
      } catch (e) {
        origin = new URL('./static/bimsurfer/src/v2/bimsurfer', window.location.origin).toString();
      }
      draco.setDecoderPath(`${origin}/lib/three/r140/`);
      loader.setDRACOLoader(draco);
    }

    loader.load(src + (isIE11 ? '.unoptimized' : '') + '.glb', (gltf) => {
      this.scene.add(gltf.scene);

      const createdLines = {};
      const geometryCount = {};

      gltf.scene.traverse((obj) => {
        if (obj.isMesh && obj.geometry) {
          geometryCount[obj.geometry.id] = 1;
        }
      });

      // @todo we'll make this more adaptive and pregenerate the lines in gltf.
      const createLines = Object.keys(geometryCount).length <= 500;
      if (!createLines) {
        console.log('not creating line geometries due to model size');
      }

      gltf.scene.traverse((obj) => {
        if (obj.isMesh && obj.geometry) {
          this.originalMaterials.set(obj.id, obj.material);
          if (!this.cfg.withShadowMaps) {
            obj.material.side = THREE.DoubleSide;
          }
          obj.material.depthWrite = !obj.material.transparent;
          if (this.cfg.withSSAO && obj.material.transparent) {
            obj.layers = this.transparentLayer;
          } else if (this.cfg.withShadowMaps && !obj.material.transparent) {
            obj.castShadow = true;
            obj.receiveShadow = true;
          }

          if (createLines) {
            let edges;
            if (obj.geometry.id in createdLines) {
              edges = createdLines[obj.geometry.id];
            } else {
              edges = createdLines[obj.geometry.id] = new THREE.EdgesGeometry(obj.geometry);
            }
            const line = new THREE.LineSegments(edges, lineMaterial);
            obj.add(line);
          }
        }

        if (obj.name.startsWith('product-')) {
          const id2 = obj.name.substr(8, 36);
          const g = Utils.CompressGuid(id2);
          this.allIds.push(g);
          this.nameToId.set(g, obj.id);
          this.nameToId.set(obj.name, obj.id);
        }
      });

      if (this.firstLoad) {
        const boundingBox = new THREE.Box3();
        boundingBox.setFromObject(this.scene);
        const center = new THREE.Vector3();
        boundingBox.getCenter(center);
        this.controls.target = center;

        // An initial for viewer distance based on the diagonal so that
        // we have a this.camera matrix for a more detailed calculation.
        let viewDistance = boundingBox.getSize(new THREE.Vector3()).length();
        this.camera.position.copy(center.clone().add(
            new THREE.Vector3(0.5, 0.25, 1).normalize().multiplyScalar(viewDistance),
        ));

        // Make sure all matrices get calculated.
        this.camera.near = viewDistance / 100;
        this.camera.far = viewDistance * 100;
        this.controls.update();
        this.camera.updateProjectionMatrix();
        this.camera.updateMatrixWorld();

        const fovFactor = Math.tan(this.camera.fov / 2 / 180 * 3.141592653);
        let outside = 0.;

        // Calculate distance between projected bounding box coordinates and view frustrum boundaries
        // const largestAngle = 0.;
        for (let i = 0; i < 8; i++) {
          const v = new THREE.Vector3(
                            i & 1 ? boundingBox.min.x : boundingBox.max.x,
                            i & 2 ? boundingBox.min.y : boundingBox.max.y,
                            i & 4 ? boundingBox.min.z : boundingBox.max.z,
          );
          v.applyMatrix4(this.camera.matrixWorldInverse);
          // largestAngle = Math.max(largestAngle, Math.atan2(v.x / this.camera.aspect, -v.z), Math.atan2(v.y, -v.z));
          outside = Math.max(outside, Math.abs(v.x / this.camera.aspect) - fovFactor * -v.z, Math.abs(v.y) - fovFactor * -v.z);
        }

        viewDistance += outside * 2;

        this.camera.position.copy(center.clone().add(
            new THREE.Vector3(0.5, 0.25, 1).normalize().multiplyScalar(viewDistance),
        ));

        this.controls.update();

        this.firstLoad = false;
      }

      if (this.cfg.withShadowMaps) {
        this.resizeShadowMap();
      }

      this.fire('loaded');
    },

    // called while loading is progressing
    function(xhr) {
      console.log((xhr.loaded / xhr.total * 100) + '% loaded');
    },

    // called when loading has errors
    function(error) {
      console.log('An error happened', error);
    },
    );
  }

  _updateState() {
    this.previousMaterials.forEach((val, id, _) => {
      if (!(this.selected.has(id) || this.secondarySelected.has(id))) {
        // restore
        const obj = this.scene.getObjectById(id);
        obj.material = this.previousMaterials.get(id);
        this.previousMaterials.delete(id);
        if (obj.children.length) {
          obj.children[0].material = lineMaterial;
        }
      }
    });
    [this.secondarySelected, this.selected].forEach((collection, is_primary) => {
      for (const id of collection) {
        const is_unselected = !this.previousMaterials.has(id);
        const has_incorrect_state = this.secondaryOrPrimary.has(id) && this.secondaryOrPrimary.get(id) != is_primary;
        if (is_unselected || has_incorrect_state) {
          const obj = this.scene.getObjectById(id);
          if (is_unselected) {
            this.previousMaterials.set(id, obj.material);
          }
          this.secondaryOrPrimary.set(id, is_primary);
          obj.material = this.createSelectionMaterial(obj.material, !is_primary);
          if (obj.children.length) {
            obj.children[0].material = is_primary ?
                            lineSelectionMaterial :
                            lineSecondarySelectionMaterial;
          }
        }
      }
    });
    setTimeout(this.rerender, 0);
  }

  _mouseClick(evt) {
    if (this.mouseHasMoved) {
      return false;
    }

    if (this.cfg.disableSelection) {
      return;
    }

    const mouse = new THREE.Vector2();
    const rect = this.renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    evt.preventDefault();

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);
    const intersects = raycaster.intersectObjects(this.scene.children, true);

    const ids = [];

    const clearSelection = this.cfg.app.shouldClearSelection(evt);

    if (clearSelection) {
      this.selected.clear();
    }

    let selected = true;

    const processSelection = (name, geomIds) => {
      ids.push(name);
      selected = !(this.selected.has(geomIds[0]) && !clearSelection);
      const fn = selected ?
                this.selected.add.bind(this.selected) :
                this.selected.delete.bind(this.selected);
      geomIds.forEach(fn);
    };

    if (intersects.length) {
      for (const x of intersects) {
        if (!x.object.visible) {
          continue;
        }
        if (x.object.geometry.type == 'BufferGeometry') {
          if (x.object.name.startsWith('product-')) {
            processSelection(
                x.object.name.substr(8, 36),
                [x.object.id]);
          } else if (this.containedInModel(x.object)) {
            processSelection(
                x.object.name,
                [x.object.id]);
          } else {
            processSelection(
                x.object.parent.name.substr(8, 36),
                x.object.parent.children.map((c) => c.id));
          }
          break;
        }
      }
    }

    this._updateState();

    this.fire('selection-changed', [{
      objects: ids,
      clear: clearSelection,
      selected: selected,
    }]);
  }

  setColor(params) {
    const processObject = (obj) => {
      const objects = obj.type === 'Group' ?
                obj.children :
                [obj];

      objects.forEach((object) => {
        const color = params.color;
        const material = object.material = object.material.clone();
        if (Array.isArray(color) || color instanceof Float32Array) {
          material.color = new THREE.Color(color[0], color[1], color[2]);
        } else {
          'rgb'.split('').forEach((c) => {
            if (c in color) {
              material.color[c] = color[c];
            }
          });
        }

        let opacity;
        if (Array.isArray(color) || color instanceof Float32Array) {
          opacity = (color.length > 3) ? color[3] : 1;
        } else if ('a' in color || 'A' in color) {
          opacity = 'a' in color ? color.a : color.A;
        }
        if (opacity !== material.opacity) {
          material.opacity = opacity;
          material.transparent = opacity < 1;
          material.depthWrite = !material.transparent;
        }
      });
    };

    if (params.ids.length < 10) {
      params.ids.map((id) => {
        return this.scene.getObjectById(id) || this.scene.getObjectById(this.nameToId.get(id));
      }).filter((obj) => obj).forEach(processObject);
    } else {
      const idsTransformed = new Set(params.ids.concat(params.ids.map((id) => this.nameToId.get(id))));

      this.scene.traverse((obj) => {
        if (idsTransformed.has(obj.id)) {
          processObject(obj);
        }
      });
    }

    this.rerender();
  };

  setVisibility(params) {
    const ids = params.clear ? this.allIds : params.ids;
    let visibility;
    if (params.clear) {
      const s = new Set(params.ids);
      visibility = (id) => {
        return s.has(id);
      };
    } else {
      visibility = (id) => {
        return params.visible;
      };
    }

    ids.forEach((id) => {
      const obj = this.scene.getObjectById(id) || this.scene.getObjectById(this.nameToId.get(id));

      if (!obj) return;

      const objects = obj.type === 'Group' ?
                obj.children :
                [obj];

      objects.forEach((object) => {
        object.visible = visibility(id);
      });
    });
    this.rerender();
  };

  getObjectIds() {
    return this.allIds;
  }

  setSelection(params) {
    const collection = params.secondary ? this.secondarySelected : this.selected;
    this.secondarySelected.clear();
    if (params.clear) {
      collection.clear();
    }
    params.ids.forEach((id) => {
      const id2 = this.nameToId.get(id);
      const node = this.scene.getObjectById(id2);
      if (node) {
        if (node.type === 'Group') {
          // Handle objects with multiple materials which become groups
          for (const c of this.scene.getObjectById(id2).children) {
            collection.add(c.id);
          }
        } else {
          collection.add(id2);
        }
      }
    });
    if (!params.selected) {
      params.ids.forEach((id) => {
        const id2 = this.nameToId.get(id);
        collection.delete(id2);
      });
    }
    this._updateState();
  }

  getSelection = function() {
    const elements = new Set();
    this.selected.forEach((id) => {
      const obj = this.scene.getObjectById(id);
      if (obj.name.startsWith('product-')) {
        elements.add(obj.name.substr(8, 36));
      } else {
        elements.add(obj.parent.name.substr(8, 36));
      }
    });
    return Array.from(elements);
  };

  createModel(name) {
    this.createdModels.push(name);
  }

  createGeometry(id, ps, ns, clrs, idxs) {
    this.createdGeometryColors[id] = new THREE.Color(clrs[0], clrs[1], clrs[2]);
    const geometry = this.createdGeometries[id] = new THREE.BufferGeometry();
    geometry.addAttribute('position', new THREE.BufferAttribute(new Float32Array(ps), 3));
    geometry.addAttribute('normal', new THREE.BufferAttribute(new Float32Array(ns), 3));
    geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(idxs), 1));
  }

  createObject(modelId, roid, oid, objectId, geometryIds, type, matrix) {
    const material = new THREE.MeshLambertMaterial({
      color: this.createdGeometryColors[geometryIds[0]], vertexColors: THREE.VertexColors,
    });

    const mesh = new THREE.Mesh(this.createdGeometries[geometryIds[0]], material);

    const m = matrix.elements;
    const y_up_matrix = new THREE.Matrix4;
    y_up_matrix.set(
        m[0], m[2], -m[1], m[3],
        m[4], m[6], -m[5], m[7],
        m[8], m[10], -m[9], m[11],
        m[12], m[14], -m[13], m[15],
    );
    y_up_matrix.transpose();

    mesh.matrixAutoUpdate = false;
    mesh.matrix = y_up_matrix;
    mesh.name = modelId + ':' + objectId;

    const edges = new THREE.EdgesGeometry(mesh.geometry);
    const line = new THREE.LineSegments(edges, lineMaterial);
    mesh.add(line);

    this.scene.add(mesh);

    this.rerender();
  }

  destroy() {
    this.scene.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry.dispose();
    });
  }

  getCamera() {
    const vecToArray = (v) => [v.x, v.y, v.z];

    return {
      type: 'PERSPECTIVE',
      eye: vecToArray(this.controls.object.position),
      target: vecToArray(this.controls.target),
    };
  }

  setCamera(obj) {
    ['x', 'y', 'z'].forEach((c, i) => {
      this.controls.target0[c] = obj.target[i];
      this.controls.position0[c] = obj.eye[i];
    });
    this.controls.reset();
  }
}
