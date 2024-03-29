define([
    'module',
    "bimsurfer/src/BimSurfer",
    "bimsurfer/src/StaticTreeRenderer",
    "bimsurfer/src/MetaDataRenderer",
    "bimsurfer/src/Request",
    "bimsurfer/src/Utils",
    "bimsurfer/src/AnnotationRenderer",
    "bimsurfer/src/Assets",
    "bimsurfer/src/EventHandler",
    "bimsurfer/lib/domReady!",
],
function (cfg, BimSurfer, StaticTreeRenderer, MetaDataRenderer, Request, Utils, AnnotationRenderer, Assets, EventHandler) {
    "use strict";    
    
    function MultiModalViewer(args) {
     
        let liveShareEnabled = false;
        let liveShareWithSelection = true;
        
        var n_files = args.n_files || 1;

        EventHandler.call(this);
        
        var origin;
        try {
            origin = (new URL(cfg.uri)).origin;
        } catch (e) {
            origin = window.location.origin;
        }
        
       
        var self = this;
            
        var bimSurfer = self.bimSurfer3D = new BimSurfer({
            domNode: args.domNode,
            engine: 'threejs',
            initiallyInvisible: args.viewerInitiallyInvisible,
            disableSelection: args.viewerInitiallyInvisible
        });
        
        if (args.multiSelect === 'click') {
            this.shouldClearSelection = bimSurfer.shouldClearSelection = function() { return false; };
        } else {
            this.shouldClearSelection = bimSurfer.shouldClearSelection = function(evt) { return !evt.shiftKey; };
        }
        
        var bimSurfer2D;
        var modelPath;
        
        if (args.modelId) {
            modelPath = `${origin}/m/${args.modelId}`;
        } else {
            modelPath = args.modelPath;
        }
       
        function mapFrom(view, objectIds) {
            var mapped;
            if (view.engine === 'svg') {
                mapped = objectIds.map((id) => {
                    return id.replace(/product-/g, '');
                }); 
            } else if (view.engine === 'xeogl') {
                mapped = objectIds.map(function(id) {
                    // So, there are several options here, id can either be a glTF identifier, in which case
                    // the id is a rfc4122 guid, or an annotation in which case it is a compressed IFC guid.
                    if (id.substr(0, 12) === "Annotations:") {
                        return id.substr(12);
                    } else {
                        return id.split("#")[1].replace(/product-/g, '');
                    }
                });
            } else {
                mapped = objectIds;
            }
            return mapped;
        }

        function mapTo(view, objectIds) {
            // we now just always map to base64 guids
            // if (view instanceof StaticTreeRenderer || view instanceof MetaDataRenderer || view.engine === 'xeogl' || view.engine == 'threejs') {
            if (true) {
                const conditionallyCompress = (s) => {
                    if (s.length > 22) {
                        return Utils.CompressGuid(s);
                    } else {
                        return s;
                    }
                }
                return objectIds.map(conditionallyCompress);
            } else {
                return objectIds;
            }
        }

        function processSelectionEvent(source, args0, args1) {
            var objectIds;
            var propagate = true;
            if (source instanceof BimSurfer || source instanceof StaticTreeRenderer) {
                objectIds = mapFrom(source, args0.objects);
                if (source.engine === 'xeogl') {
                    // Only when the user actually clicked the canvas we progate the event.
                    propagate = !!args0.clickPosition || objectIds.length == 0;   
                }
            } else if (source === 'user') {
                objectIds = mapFrom(source, args1);
            }
            
            if (propagate) {
                self.fire('selection-changed', [objectIds]);
            
                [bimSurfer, bimSurfer2D, self.treeView, self.metaDataView].forEach((view) => {
                    if (view && view !== source) {
                        if (view.setSelection) {
                            if (!(view.viewer && view.viewer.error)) {
                                view.setSelection({ids: mapTo(view, objectIds), clear: true, selected: true});
                            }
                        } else {
                            view.setSelected(mapTo(view, objectIds), view.SELECT_EXCLUSIVE);
                        }
                    }
                });
                
                if (self.onSelectionChanged) {
                    self.onSelectionChanged(objectIds);
                }
                
                if (liveShareEnabled && liveShareWithSelection) {
                    this.syncSelection({objects: objectIds});
                }
            }
        }

        function makePartial(fn, arg) {
            // higher order (essentially partial function call)
            return function(arg0, arg1) {
                fn(arg, arg0, arg1);
            }
        }

        this.spinner = null;
        this.requestsInProgress = 0;
        this.incrementRequestsInProgress = function() {
            self.requestsInProgress++;
            if (self.spinner) {
                self.spinner.style.display = self.requestsInProgress ? 'block' : 'none';
            }
        }
        this.decrementRequestsInProgress = function() {
            self.requestsInProgress--;
            if (self.spinner) {
                self.spinner.style.display = self.requestsInProgress ? 'block' : 'none';
            }
            if (!self.requestsInProgress) {
                self.fire('loading-finished', []);
            }
        }

        this.loadXmlPromise = null;
        this.loadXml = function() {
            if (self.loadXmlPromise) {
                return self.loadXmlPromise;
            }
            var promises = [];
            for (var i = 0; i < n_files; i++) {
                self.incrementRequestsInProgress();
                var postfix = args.n_files ? `_${i}` : '';

                promises.push(
                        Request.Make({url: `${modelPath}${postfix}.tree.json`})
                                .catch(
                                        () => { return Request.Make({url: `${modelPath}${postfix}.xml`}).then(function(xml) {
                                            return Utils.XmlToJson(xml, {'Name': 'name', 'id': 'guid'});
                                        }) }
                                )
                                .then(x => {self.decrementRequestsInProgress(); return x; })
                );
            }
            return self.loadXmlPromise = Promise.all(promises);
        }

        this.loadTreeView = function(domNode, part, baseId) {
            var tree = new StaticTreeRenderer({
                domNode: domNode,
                withVisibilityToggle: args.withTreeVisibilityToggle,
                singleLevel: args.withThreeSingleLevel,
                mobileMode: args.withThreeMobileMode,
                expandUntil: args.treeExpandUntil,
                hideLevels: args.treeHideLevels,
                app: this
            });

            let iconPromise;
            if (args.withTreeViewIcons) {
                iconPromise = fetch("https://aecgeeks.github.io/ifc-icons/ifc-full-icons.json").then(r=>r.json());
            } else {
                iconPromise = new Promise((resolve, reject) => {resolve();});
            }
            iconPromise.then((potentaillyIcons) => {
                return self.loadXml().then(function(jsons) {
                    for (var i=0; i < n_files; i++) {
                        tree.addModel({id: i, json: jsons[i]});
                    }
                    tree.icons = potentaillyIcons;
                    tree.build();
                    self.treeView = tree;
                    tree.on('selection-changed', makePartial(processSelectionEvent, tree));
                    tree.on('visibility-changed', bimSurfer.setVisibility);
                    tree.on('selection-context-changed', (args) => {
                        if (args.secondary) {
                            self.bimSurfer3D.setSelection(args);
                        }
                        if (args.parent && self.metaDataView) {
                            self.metaDataView.setSelectedParent(args.ids[0]);
                        }
                    });
                });
            });
        }

        this.setSpinner = function(args) {
            if (args.url) {
                self.spinner = new Image();
                self.spinner.src= url;
                self.spinner.onload = function() {
                    self.spinner.style = 'position: fixed; top: 50%; left: 50%; margin-top: -' + self.spinner.height / 2 + 'px; margin-left: -' + self.spinner.width / 2 + 'px';
                    self.spinner.style.display = self.requestsInProgress ? 'block' : 'none';
                    document.body.appendChild(self.spinner);
                }
            } else if (args.className) {
                self.spinner = document.createElement('div');
                self.spinner.className = args.className;
                document.body.appendChild(self.spinner);
            }
        }

        
        this.loadMetadata = function(domNode, part,baseId) {
            var data = new MetaDataRenderer({
                domNode: domNode
            });

            this.loadXml().then(function(jsons) {
                for (var i = 0; i < n_files; i++) {
                    data.addModel({id: i, json: jsons[i]});
                }
                self.metaDataView = data;
            });
        };
        
        this.load2d = function() {
            // @todo 2d is currently a single image because with
            // IfcConvert --bounds we can no longer overlay them
            // due to the different scaling factors.
            
            bimSurfer2D = self.bimSurfer2D = new BimSurfer({
                domNode: args.svgDomNode,
                engine: 'svg'
            });
            
            if (args.multiSelect === 'click') {
                bimSurfer2D.shouldClearSelection = function() { return false; };
            }
        
            self.incrementRequestsInProgress();
            var P = bimSurfer2D.load({
                src: modelPath
            }).then(function() {
                self.decrementRequestsInProgress();
            });
            
            bimSurfer2D.on("selection-changed", makePartial(processSelectionEvent, bimSurfer2D));

            return P;
        };
        
        this.destroy = function() {
            for (const v of [self.metaDataView, self.treeView, bimSurfer2D, bimSurfer]) {
                if (v) {
                    v.destroy();
                }
            }
            self.metaDataView = self.treeView = bimSurfer2D = bimSurfer = null; 
        };
        
        this.getSelection = function() {
            return bimSurfer.getSelection().map(id => id.replace(/product-/g, '')).map(Utils.CompressGuid);
        }
        
        this.setSelection = function(args) {
            processSelectionEvent('user', 'select', args.ids);
        }
        this.load3d = function(part, baseId) {
        
            for(var i = 0; i < n_files; i++) {

                self.incrementRequestsInProgress();
                var src = modelPath + (part ? `/${part}`: (baseId || ''));
                if (args.n_files) {
                    src += "_" + i;
                }
                var P = bimSurfer.load({src: src}).then(function (model) {
                    
                    if (bimSurfer.engine === 'xeogl' && !part) {
                    // Really make sure everything is loaded.
                    Utils.Delay(100).then(function() {
                    
                        var scene = bimSurfer.viewer.scene;
                        
                        var aabb = scene.worldBoundary.aabb;
                        var max = aabb.subarray(3);
                        var min = aabb.subarray(0, 3);
                        var diag = xeogl.math.subVec3(max, min, xeogl.math.vec3());
                        var modelExtent = xeogl.math.lenVec3(diag);
                    
                        scene.camera.project.near = modelExtent / 1000.;
                        scene.camera.project.far = modelExtent * 100.;
                        
                        bimSurfer.viewFit({centerModel:true});
                        
                        bimSurfer.viewer.scene.canvas.canvas.style.display = 'block';
                    });
                    }
                    self.decrementRequestsInProgress();                    
                });
            }
            
            bimSurfer.on("selection-changed", makePartial(processSelectionEvent, bimSurfer));
            
            return P;
        };
        
        this.setColor = function(args) {
            var viewers = [bimSurfer];
            if (bimSurfer2D) {
                viewers.push(bimSurfer2D);
            }
            viewers.forEach((v) => {
                if (args.ids && args.ids.length) {
                    if (args.highlight) {
                        if (v.viewer && v.viewer.getObjectIds) {
                            v.setColor({ids: v.viewer.getObjectIds(), color: {a: 0.1}});
                        }
                    }
                    v.setColor.apply(v, arguments);
                } else {
                    v.reset({ colors: true });
                }
            });
        }
        
        this.resize = function() {
            bimSurfer.resize();
        };
        
        this.listen = function(path) {
            var evtSource = new EventSource(path);
            evtSource.onmessage = function(e) {
                let msg = JSON.parse(e.data);
                if (msg.type == 'camera') {
                    self.bimSurfer3D.setCamera(msg.data);
                } else if (msg.type == 'selection') {
                    processSelectionEvent('user', null, msg.data);
                }
            }
        };
        
        this.syncSelection = function(args) {
            let objectIds = args ? args.objects : this.getSelection();
            fetch(`/live/${LIVE_SHARE_ID}`, {
                method: 'POST',
                body: JSON.stringify({"type": "selection", "data": objectIds})
            });
        }
        
        this.toggleLiveShare = function(args) {
            let timer;
            let lastUpdate = 0;
            
            liveShareWithSelection = !args.disableSelection;
            liveShareEnabled = !liveShareEnabled;
            
            var make_throttle = (delay, F) => {
                return function(...args) {
                    if (!liveShareEnabled) {
                        // @todo also disable event
                        return;
                    }
                    let now = performance.now();
                    if (now - lastUpdate < delay) {
                        clearTimeout(timer);
                    } else {
                        lastUpdate = now;
                    }
                    timer = setTimeout(() => {
                        F(...args);
                    }, delay);
                }
            }
            
            bimSurfer.on("camera-changed", make_throttle(200, (cam) => {
               fetch(`/live/${LIVE_SHARE_ID}`, {
                   method: 'POST',
                   body: JSON.stringify({"type": "camera", "data": cam})
               });
            }));
            
            return liveShareEnabled;
        };
        
        this.resize = function() {
            [bimSurfer, bimSurfer2D].forEach((surfer) => {
                if (surfer) {
                    surfer.resize();
                }
            });
        }
    }
    
    MultiModalViewer.prototype = Object.create(EventHandler.prototype);
    return MultiModalViewer;
    
});
