define(["../EventHandler", "../Utils"], function(EventHandler, Utils) {

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
            antialias: true
        });
        var viewerContainer = document.getElementById(cfg.domNode);

        var viewAngle = 45;
        var nearClipping = 0.1;
        var farClipping = 9999;

        var width = viewerContainer.offsetWidth;
        var height = viewerContainer.offsetHeight;;

        var camera = self.camera = new THREE.PerspectiveCamera(viewAngle, width / height, nearClipping, farClipping);
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

        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.gammaFactor = 2.2;

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
        
        controls.addEventListener('change', () => {
            self.fire("camera-changed", [self.camera]);
        });

        var animate = function() {
            requestAnimationFrame(animate);
            renderer.render(scene, camera);
        };

        animate();

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
            }
        };

        self.loadglTF = function(src) {

            var loader = new THREE.GLTFLoader();
            loader.load(src + ".glb", function(gltf) {
                    scene.add(gltf.scene);

                    gltf.scene.traverse((obj) => {
                        if (obj.isMesh && obj.geometry) {
                            self.originalMaterials.set(obj.id, obj.material);

                            edges = new THREE.EdgesGeometry(obj.geometry);
                            var line = new THREE.LineSegments(edges, lineMaterial);
                            obj.add(line);
                            obj.material.side = THREE.DoubleSide;
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
                        var dist = boundingBox.getSize(new THREE.Vector3()).length();
                        camera.position.copy(center.clone().add(
                            new THREE.Vector3(-0.5, 0.25, -1).normalize().multiplyScalar(dist)
                        ));

                        camera.near = dist / 100;
                        camera.far = dist * 100;
                        camera.updateProjectionMatrix();

                        controls.update();

                        first = false;
                    }
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
            for (id of Array.from(self.previousMaterials.keys())) {
                if (!self.selected.has(id)) {
                    // restore
                    var obj = scene.getObjectById(id);
                    obj.material = self.previousMaterials.get(id);
                    self.previousMaterials.delete(id);
                    obj.children[0].material = lineMaterial;
                }
            }
            for (id of self.selected) {
                if (!self.previousMaterials.has(id)) {
                    var obj = scene.getObjectById(id);
                    self.previousMaterials.set(id, obj.material);
                    obj.material = createSelectionMaterial(obj.material);
                    obj.children[0].material = lineSelectionMaterial;
                }
            }
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

            if (!evt.shiftKey) {
                self.selected.clear();
            }

            if (intersects.length) {
                var objId;

                for (var x of intersects) {
                    if (x.object.geometry.type == "BufferGeometry") {
                        if (x.object.name.startsWith("product-")) {
                            ids.push(x.object.name.substr(8, 36));
                            self.selected.add(x.object.id);
                        } else {
                            ids.push(x.object.parent.name.substr(8, 36));
                            for (let c of x.object.parent.children) {
                                self.selected.add(c.id);
                            }
                        }
                        break;
                    }
                }
            }

            self._updateState();

            self.fire("selection-changed", [{
                objects: ids,
                clear: !evt.shiftKey,
                selected: true
            }]);
        };

        self.setColor = function(params) {
            params.ids.forEach((id) => {
                const obj = scene.getObjectById(id) || scene.getObjectById(self.nameToId.get(id));

                const objects = obj.type === 'Group' ?
                    obj.children :
                    [obj];

                objects.forEach((object) => {

                    const color = params.color;
                    var material = object.material = object.material.clone();
                    if (Array.isArray(color) || color instanceof Float32Array) {
                        material.color = new THREE.Color(color[0], color[1], color[2]);
                    } else {
                        "rgb".split('').forEach((c) => {
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
                    if (typeof(opacity) !== 'undefined' && opacity !== material.opacity) {
                        material.opacity = opacity;
                        material.transparent = opacity < 1;
                        material.depthWrite = !material.transparent;
                    }

                });
            });
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
                if (scene.getObjectById(id2).type === 'Group') {
                    // Handle objects with multiple materials which become groups
                    for (var c of scene.getObjectById(id2).children) {
                        self.selected.add(c.id);
                    }
                } else {
                    self.selected.add(id2);
                }
            });
            self._updateState();
        };
        
        self.getSelection = function() {
            var ar = Array.from(self.selected);
            return ar.map(function(id) {
                return self.scene.getObjectById(id).name;
            });
        };
    }

    ThreeViewer.prototype = Object.create(EventHandler.prototype);
    return ThreeViewer;


});
