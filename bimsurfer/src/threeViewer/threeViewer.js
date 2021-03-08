define(["../EventHandler", "../Utils"], function(EventHandler, Utils) {
    "use strict";

    function ThreeViewer(cfg) {

        let self = this;
        EventHandler.call(this);

        self.allIds = [];
        self.selected = new Set();
        self.previousMaterials = new Map();
        self.originalMaterials = new Map();
        self.nameToId = new Map();
        self.three = null;

        var raycaster = new THREE.Raycaster();

        var mouse = new THREE.Vector2();
        var renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
	    preserveDrawingBuffer: true
        });
        var viewerContainer = document.getElementById(cfg.domNode);

        var viewAngle = 45;
        var nearClipping = 0.1;
        var farClipping = 9999;
        
        var createdModels = [];
        
        function containedInModel(obj) {
             for (let m of createdModels) {
                 if (obj.name.startsWith(m + ":")) {
                     return true;
                 }
             }
             return false;
        }
        
        var camera = window.cam = new THREE.PerspectiveCamera(viewAngle, 1, nearClipping, farClipping);
        
        self.resize = () => {
            var width = viewerContainer.offsetWidth;
            var height = viewerContainer.offsetHeight;
            if (!height) {
                height = 600;
            }
            cam.aspect = width / height;
            renderer.setSize(width, height);
            camera.updateProjectionMatrix();
        };
        
        self.resize();

        var scene = self.scene = new THREE.Scene();

        var lineMaterial = new THREE.LineBasicMaterial({
            color: 0x000000,
            transparent: true,
            opacity: 0.3
        });
        var lineSelectionMaterial = new THREE.LineBasicMaterial({
            color: 0xff0000,
            transparent: false
        });
        lineSelectionMaterial.depthTest = false;

        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.gammaFactor = 2.2;
        // @tfk sortObjects still needs to be enabled for correctly rendering the transparency overlay
        // renderer.sortObjects = false;

        var rerender = () => renderer.render(scene, camera);

        document.getElementById(cfg.domNode).appendChild(renderer.domElement);
        renderer.setClearColor(0x000000, 0);

        var light = new THREE.DirectionalLight(0xFFFFFF);
        light.position.set(20, 10, 30);
        scene.add(light);
        var light = new THREE.DirectionalLight(0xFFFFFF, 0.8);
        light.position.set(-10, 1, -30);
        scene.add(light);
        scene.add(new THREE.AmbientLight(0x404050));

        var controls = new THREE.OrbitControls(camera, viewerContainer);
        controls.addEventListener('change', rerender);

        var first = true;

        function createSelectionMaterial(originalMaterial) {
            var m = new THREE.MeshLambertMaterial({
                color: originalMaterial.color.clone().lerp(new THREE.Color(0xff0000), 0.5)
            });
            m.side = THREE.DoubleSide;
            // this does not work well.
            // m.depthTest = false;
            return m;
        }

        self.reset = function(params) {
            if (params.colors) {
                for (let [id, mat] of self.originalMaterials) {
                    var obj = scene.getObjectById(id);
                    obj.material = mat;
                }
                rerender();
            }
        };

        self.loadglTF = function(src) {

            var loader = new THREE.GLTFLoader();
            
            var isIE11 = !!window.MSInputMethodContext && !!document.documentMode;
            
            if (!isIE11) {
            var draco = new THREE.DRACOLoader;
            var threePath = Array.from(document.head.querySelectorAll("script")).map(
                s => s.src
            ).filter(
                s => s.split("/").reverse()[0].startsWith("three")
            )[0];
            draco.setDecoderPath(threePath.substr(0, threePath.lastIndexOf("/") + 1));
            loader.setDRACOLoader(draco);
            }            
            
            loader.load(src + (isIE11 ? ".unoptimized" : "") + ".glb", function(gltf) {
                    scene.add(gltf.scene);

                    var createdLines = {};
                    var geometryCount = {};

                    gltf.scene.traverse((obj) => {
                        if (obj.isMesh && obj.geometry) {
                            geometryCount[obj.geometry.id] = 1;
                        }
                    });

                    // @todo we'll make this more adaptive and pregenerate the lines in gltf.
                    var createLines = Object.keys(geometryCount).length <= 500;
                    if (!createLines) {
                        console.log("not creating line geometries due to model size");
                    }

                    gltf.scene.traverse((obj) => {
                        if (obj.isMesh && obj.geometry) {
                            self.originalMaterials.set(obj.id, obj.material);
                            obj.material.side = THREE.DoubleSide;
                            obj.material.depthWrite = !obj.material.transparent;

                            if (createLines) {
                                var edges;
                                if (obj.geometry.id in createdLines) {
                                    edges = createdLines[obj.geometry.id];
                                } else {
                                    edges = createdLines[obj.geometry.id] = new THREE.EdgesGeometry(obj.geometry);
                                }
                                var line = new THREE.LineSegments(edges, lineMaterial);
                                obj.add(line);
                            }                            
                        }

                        if (obj.name.startsWith("product-")) {
                            const id2 = obj.name.substr(8, 36);
                            const g = Utils.CompressGuid(id2);
                            self.allIds.push(g);
                            self.nameToId.set(g, obj.id);
                            self.nameToId.set(obj.name, obj.id);
                        }
                    });

                    if (first) {

                        var boundingBox = new THREE.Box3();
                        boundingBox.setFromObject(scene);
                        var center = new THREE.Vector3();
                        boundingBox.getCenter(center);
                        controls.target = center;
                        
                        // An initial for viewer distance based on the diagonal so that
                        // we have a camera matrix for a more detailed calculation.
                        var viewDistance = boundingBox.getSize(new THREE.Vector3()).length();
                        camera.position.copy(center.clone().add(
                            new THREE.Vector3(0.5, 0.25, 1).normalize().multiplyScalar(viewDistance)
                        ));
                        
                        // Make sure all matrices get calculated.
                        camera.near = viewDistance / 100;
                        camera.far = viewDistance * 100;
                        controls.update();
                        camera.updateProjectionMatrix();
                        camera.updateMatrixWorld();
                        
                        var fovFactor = Math.tan(camera.fov / 2 / 180 * 3.141592653);
                        var outside = 0.;
                        
                        // Calculate distance between projected bounding box coordinates and view frustrum boundaries
                        var largestAngle = 0.;
                        for (var i = 0; i < 8; i++) {
                            const v = new THREE.Vector3(
                                i & 1 ? boundingBox.min.x : boundingBox.max.x,
                                i & 2 ? boundingBox.min.y : boundingBox.max.y,
                                i & 4 ? boundingBox.min.z : boundingBox.max.z
                            );
                            v.applyMatrix4(camera.matrixWorldInverse);
                            // largestAngle = Math.max(largestAngle, Math.atan2(v.x / camera.aspect, -v.z), Math.atan2(v.y, -v.z));
                            outside = Math.max(outside, Math.abs(v.x / camera.aspect) - fovFactor * -v.z, Math.abs(v.y) - fovFactor * -v.z);
                            console.log(v.x / camera.aspect, fovFactor * -v.z);
                        }
                        
                        viewDistance += outside * 2;
                        
                        camera.position.copy(center.clone().add(
                            new THREE.Vector3(0.5, 0.25, 1).normalize().multiplyScalar(viewDistance)
                        ));

                        controls.update();
                        
                        first = false;
                    }
                    
                    self.fire("loaded");
                },

                // called while loading is progressing
                function(xhr) {
                    console.log((xhr.loaded / xhr.total * 100) + '% loaded');
                },

                // called when loading has errors
                function(error) {
                    console.log('An error happened', error);
                }
            );

        };

        self._updateState = function() {
            var id;
            self.previousMaterials.forEach((val, id, _) => {
                if (!self.selected.has(id)) {
                    // restore
                    var obj = scene.getObjectById(id);
                    obj.material = self.previousMaterials.get(id);
                    self.previousMaterials.delete(id);
                    if (obj.children.length) {
                        obj.children[0].material = lineMaterial;
                    }
                }
            });
            for (let id of self.selected) {
                if (!self.previousMaterials.has(id)) {
                    var obj = scene.getObjectById(id);
                    self.previousMaterials.set(id, obj.material);
                    obj.material = createSelectionMaterial(obj.material);
                    if (obj.children.length) {
                        obj.children[0].material = lineSelectionMaterial;
                    }
                }
            }
            rerender();
        };

        // We don't want drag events to be registered as clicks
        var mouseHasMoved = false;
        viewerContainer.addEventListener('mousedown', () => {
            mouseHasMoved = false
        }, false);
        viewerContainer.addEventListener('mousemove', () => {
            mouseHasMoved = true
        }, false);
        viewerContainer.addEventListener('mouseup', () => {
            setTimeout(() => {
                mouseHasMoved = false
            }, 20)
        }, false);

        viewerContainer.addEventListener('click', mouseClick, false);

        function mouseClick(evt) {
            
            if (mouseHasMoved) {
                return false;
            }

            var rect = renderer.domElement.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            evt.preventDefault();

            raycaster.setFromCamera(mouse, camera);
            var intersects = raycaster.intersectObjects(scene.children, true);

            var ids = [];
            
            var clearSelection = cfg.app.shouldClearSelection(evt);

            if (clearSelection) {
                self.selected.clear();
            }
            
            var selected = true;
            
            const processSelection = (name, geomIds) => {
                ids.push(name);
                selected = !(self.selected.has(geomIds[0]) && !clearSelection);
                const fn = selected
                    ? self.selected.add.bind(self.selected)
                    : self.selected.delete.bind(self.selected);
                geomIds.forEach(fn);
            };

            if (intersects.length) {
                var objId;

                for (var x of intersects) {
                    if (x.object.geometry.type == "BufferGeometry") {
                        if (x.object.name.startsWith("product-")) {
                            processSelection(
                                x.object.name.substr(8, 36), 
                                [x.object.id]);
                        } else if (containedInModel(x.object)) {
                            processSelection(
                                x.object.name, 
                                [x.object.id]);
                        } else {
                            processSelection(
                                x.object.parent.name.substr(8, 36), 
                                x.object.parent.children.map(c => c.id));
                        }
                        break;
                    }
                }
            }

            self._updateState();

            self.fire("selection-changed", [{
                objects: ids,
                clear: clearSelection,
                selected: selected
            }]);
        };

        self.setColor = function(params) {
            params.ids.forEach((id) => {
                const obj = scene.getObjectById(id) || scene.getObjectById(self.nameToId.get(id));

                if (!obj) return;

                const objects = obj.type === 'Group' ?
                    obj.children :
                    [obj];

                objects.forEach((object) => {

                    const color = params.color;
                    var material = object.material = object.material.clone();
                    if (Array.isArray(color) || color instanceof Float32Array) {
                        material.color = new THREE.Color(color[0], color[1], color[2]);
                    } else {
                        "rgb".split().forEach((c) => {
                            if (c in color) {
                                material.color[c] = color[c];
                            }
                        });
                    }

                    var opacity;
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
            rerender();
        };

        self.setVisibility = function(params) {
            params.ids.forEach((id) => {
                const obj = scene.getObjectById(id) || scene.getObjectById(self.nameToId.get(id));

                if (!obj) return;

                const objects = obj.type === 'Group' ?
                    obj.children :
                    [obj];

                objects.forEach((object) => {
                    object.visible = params.visible;
                });
            });
            rerender();
        };

        self.getObjectIds = function() {
            return self.allIds;
        };

        self.setSelection = function(params) {
            if (params.clear) {
                self.selected.clear();
            }
            params.ids.forEach((id) => {
                var id2 = self.nameToId.get(id);
                var node = scene.getObjectById(id2);
                if (node) {
                    if (node.type === 'Group') {
                        // Handle objects with multiple materials which become groups
                        for (var c of scene.getObjectById(id2).children) {
                            self.selected.add(c.id);
                        }
                    } else {
                        self.selected.add(id2);
                    }
                }
            });
            self._updateState();
        };
        
        self.getSelection = function() {
            let elements = new Set();
            self.selected.forEach((id) => {
                let obj = self.scene.getObjectById(id);
                if (obj.name.startsWith("product-")) {
                    elements.add(obj.name.substr(8, 36));
                } else {
                    elements.add(obj.parent.name.substr(8, 36));
                }
            });
            return Array.from(elements)
        }
        
        self.createModel = function(name) {
            createdModels.push(name);
        };
        
        var createdGeometries = {};
        var createdGeometryColors = {};
        
        self.createGeometry = function(id, ps, ns, clrs, idxs) {
            createdGeometryColors[id] = new THREE.Color(clrs[0], clrs[1], clrs[2]);
            var geometry = createdGeometries[id] = new THREE.BufferGeometry();
            geometry.addAttribute('position', new THREE.BufferAttribute(new Float32Array(ps), 3));
            geometry.addAttribute('normal', new THREE.BufferAttribute(new Float32Array(ns), 3));
            geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(idxs), 1));
        };
        
        self.createObject = function(modelId, roid, oid, objectId, geometryIds, type, matrix) {
            var material = new THREE.MeshLambertMaterial({
                color: createdGeometryColors[geometryIds[0]],  vertexColors: THREE.VertexColors
            });
            
            var mesh = new THREE.Mesh(createdGeometries[geometryIds[0]], material);
            
            var m = matrix.elements;
            var y_up_matrix = new THREE.Matrix4;
            y_up_matrix.set(
                m[0], m[ 2], -m[ 1], m[3],
                m[4], m[ 6], -m[ 5], m[7],
                m[8], m[ 10], -m[ 9], m[11],
                m[12], m[14], -m[13], m[15]
            );
            y_up_matrix.transpose();
            
            mesh.matrixAutoUpdate = false;
            mesh.matrix = y_up_matrix;
            mesh.name = modelId + ":" + objectId;
            
            var edges = new THREE.EdgesGeometry(mesh.geometry);
            var line = new THREE.LineSegments(edges, lineMaterial);
            mesh.add(line);
            
            scene.add(mesh);

            rerender();
        };
        
        self.destroy = function() {
            scene.traverse(object => {
        	if (!object.isMesh) return
        	    object.geometry.dispose();
            });
        };
    }

    ThreeViewer.prototype = Object.create(EventHandler.prototype);
    return ThreeViewer;


});
