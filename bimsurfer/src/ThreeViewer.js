import EventHandler from './EventHandler.js';
import * as Utils from './Utils.js';
import * as THREE from 'three';
import {DRACOLoader} from '../lib/three/r140/DRACOLoader.js';
import {GLTFLoader} from '../lib/three/r140/GLTFLoader.js';
import {OrbitControls} from '../lib/three/r140/OrbitControls.js';
import {SSAOPass} from '../lib/three/r140/postprocessing/SSAOPass.js';
import {EffectComposer} from '../lib/three/r140/postprocessing/EffectComposer.js';

const lineMaterial = new THREE.LineBasicMaterial({
  color: 0x000000,
  transparent: true,
  opacity: 0.3,
});
const lineSelectionMaterial = new THREE.LineBasicMaterial({
  color: 0xff0000,
  transparent: false,
});
const lineSecondarySelectionMaterial = new THREE.LineBasicMaterial({
  color: 0xdd7011,
  transparent: false,
});
lineSelectionMaterial.depthTest = false;
lineSecondarySelectionMaterial.depthTest = false;

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
      const width = this.viewerContainer.offsetWidth;
      let height = this.viewerContainer.offsetHeight;
      if (!height) {
        height = 600;
      }
      this.camera.aspect = width / height;
      this.renderer.setSize(width, height);
      this.camera.updateProjectionMatrix();
      this.rerender();
    };

    this.resize();

    this.scene = new THREE.Scene();

    this.renderer.setPixelRatio(window.devicePixelRatio);

    /*
    const composer = new EffectComposer(this.renderer);
    const ssaoPass = new SSAOPass(this.scene, this.camera, this.viewerContainer.offsetWidth, this.viewerContainer.offsetHeight);
    ssaoPass.kernelRadius = 16;
    composer.addPass(ssaoPass);
    */

    // @tfk sortObjects still needs to be enabled for correctly rendering the transparency overlay
    // this.renderer.sortObjects = false;

    this.rerender = () => this.renderer.render(this.scene, this.camera);

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

    /*
        this.renderer.domElement.removeAttribute('width')
        this.renderer.domElement.removeAttribute('height')
        this.renderer.domElement.style = '';
        */
    document.getElementById(cfg.domNode).appendChild(this.renderer.domElement);

    this.renderer.setClearColor(0x000000, 0);

    var light = new THREE.DirectionalLight(0xFFFFFF);
    light.position.set(20, 10, 30);
    this.scene.add(light);
    var light = new THREE.DirectionalLight(0xFFFFFF, 0.8);
    light.position.set(-10, 1, -30);
    this.scene.add(light);
    this.scene.add(new THREE.AmbientLight(0x404050));

    this.controls = new OrbitControls(this.camera, this.viewerContainer);
    this.controls.addEventListener('change', () => {
      this.fire('this.camera-changed', [this.getCamera()]);
      this.rerender();
    });

    this.firstLoad = true;

    this.createdGeometries = {};
    this.createdGeometryColors = {};
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
        const obj = this.scene.getObjectById(id);
        obj.material = mat;
      }
      this.rerender();
    }
  }

  loadglTF(src) {
    const loader = new GLTFLoader();

    const isIE11 = !!window.MSInputMethodContext && !!document.documentMode;

    if (!isIE11) {
      const draco = new DRACOLoader;
      let origin;
      try {
        origin = new URL(import.meta.url).origin.toString();
      } catch (e) {
        origin = new URL(window.location.origin).toString();
      }
      draco.setDecoderPath(`${origin}/bimsurfer/lib/three/r140`);
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
          obj.material.side = THREE.DoubleSide;
          obj.material.depthWrite = !obj.material.transparent;

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
    params.ids.forEach((id) => {
      const obj = this.scene.getObjectById(id) || this.scene.getObjectById(this.nameToId.get(id));

      if (!obj) return;

      const objects = obj.type === 'Group' ?
                obj.children :
                [obj];

      objects.forEach((object) => {
        const color = params.color;
        const material = object.material = object.material.clone();
        if (Array.isArray(color) || color instanceof Float32Array) {
          material.color = new THREE.Color(color[0], color[1], color[2]);
        } else {
          'rgb'.split().forEach((c) => {
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
    });
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
