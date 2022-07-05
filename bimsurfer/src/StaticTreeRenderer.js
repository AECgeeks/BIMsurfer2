define(["./EventHandler", "./Request", "./Utils"], function(EventHandler, Request, Utils) {
    "use strict";
    
    const SPATIAL_STRUCTURE_ELEMENTS = ["IfcProject", "IfcSite", "IfcBuilding", "IfcBuildingStorey", "IfcSpace"];
    
    function StaticTreeRenderer(args) {
        
        var self = this;        
        EventHandler.call(this);
        
        var TOGGLE = self.TOGGLE = 0;
        var SELECT = self.SELECT = 1;
        var SELECT_EXCLUSIVE = self.SELECT_EXCLUSIVE = 2;
        var DESELECT = self.DESELECT = 3;
        
        var fromXml = false;
        
        var domNodes = {};
        var selectionState = {};
        
        this.getOffset = function(elem) {
            var reference = document.getElementById(args['domNode']);
            var y = 0;
            while (true) {
                if (elem === null) {
                    break;
                }
                y += elem.offsetTop;
                if (elem == reference) {
                    break;
                }
                elem = elem.offsetParent;
            }
            return y;
        };

        this.parentToChildMapping = {};
        this.childParentMapping = {};
        this.objectTypeMapping = {};
        this.roots = [];
        this.currentFocusNode = null;

        function collect(...qids) {
            var descendants = [];
            var inner = function(id) {
                descendants.push(id);
                (self.parentToChildMapping[id] || []).forEach(inner);
            }
            qids.forEach(inner);
            return descendants
        }
        
        this.setSelected = function(ids, mode, fire) {
            if (mode == SELECT_EXCLUSIVE) {
                self.setSelected(self.getSelected(true), DESELECT, false);
            }

            let decomposingParent = null;
            let parentIds = new Set(ids.map(i => self.childParentMapping[i]));
            if (parentIds.size === 1) {
                [decomposingParent] = parentIds;
                if (SPATIAL_STRUCTURE_ELEMENTS.indexOf(self.objectTypeMapping[decomposingParent]) !== -1) {
                    decomposingParent = null;
                }
            }

            if (fire) {
            if (decomposingParent) {
                this.fire("selection-context-changed", [{
                    secondary: true,
                    selected: true,
                    ids: self.parentToChildMapping[decomposingParent].filter(v => ids.indexOf(v) === -1)
                }]);
                this.fire("selection-context-changed", [{
                    parent: true,
                    selected: true,
                    ids: [decomposingParent]
                }]);
            } else {
                this.fire("selection-context-changed", [{
                    secondary: true,
                    selected: true,
                    clear: true,
                    ids: []
                }]);
                this.fire("selection-context-changed", [{
                    parent: true,
                    selected: true,
                    clear: true,
                    ids: []
                }]);
            }
            }
            
            ids.forEach(function(id) {        
                var s = null;
                if (mode == TOGGLE) {
                    s = selectionState[id] = !selectionState[id];
                } else if (mode == SELECT || mode == SELECT_EXCLUSIVE) {
                    s = selectionState[id] = true;
                } else if (mode == DESELECT) {
                    s = selectionState[id] = false;
                }
                
                if (s) {
                    domNodes[id].label.classList.add("selected");
                } else {
                    domNodes[id].label.classList.remove("selected");
                }
            });
            
            var desiredViewRange = self.getSelected().map(function(id) {
                return self.getOffset(domNodes[id].label);
            });
            
            if (desiredViewRange.length) {
                desiredViewRange.sort()
                desiredViewRange = [desiredViewRange[0], desiredViewRange[desiredViewRange.length-1]];
            
                var domNode = document.getElementById(args['domNode']);
                var currentViewRange = [domNode.scrollTop, domNode.scrollTop + domNode.offsetHeight];
                
                if (!(desiredViewRange[0] >= currentViewRange[0] && desiredViewRange[1] <= currentViewRange[1])) {
                    if ( (desiredViewRange[1] - desiredViewRange[0]) > (currentViewRange[1] - currentViewRange[0]) ) {
                        domNode.scrollTop = desiredViewRange[0];
                    } else {
                        var l = parseInt((desiredViewRange[1] + desiredViewRange[0]) / 2. - (currentViewRange[1] - currentViewRange[0]) / 2., 10);
                        l = Math.max(l, 0);
                        l = Math.min(l, domNode.scrollHeight - domNode.offsetHeight);
                        domNode.scrollTop = l;
                    }
                }
            }
            
            if (fire) {
            this.fire("selection-changed", [{
                objects: self.getSelected(true),
                clear: true,
                selected: true
            }]);
            }
        };
        
        this.getSelected = function(b) {
            b = typeof(b) === 'undefined' ? true: !!b;
            var l = [];
            Object.keys(selectionState).forEach(function (k) {
                if (!!selectionState[k] === b) {
                    l.push(k);
                }
            });
            return l;
        };
        
        var models = [];
        
        this.addModel = function(args) {
            models.push(args);
            if (args.src || args.json) {
                fromXml = true;
            }
        };
        
        this.qualifyInstance = function(modelId, id) {
            if (fromXml) {
                return id;
            } else {
                return modelId + ":" + id;
            }
        };
        
        this.destroy = function() {
            var node = document.getElementById(args['domNode']);
            while (node.lastChild) {
                node.removeChild(node.lastChild);
            }
        };
        
        this.build = function() {
            var domNode = document.getElementById(args['domNode']);

            let styleSheet = null;
            let styleSheet2 = null;
            let level = args.hideLevels || 0;
            let minLevel = level;
            let maxLevel = 0;
            let mergeMode = false;
            let itemsByLevelByName = {};
            let firstOrrenceOfDuplicateName = {};
            let duplicateNameIdsById = {};


            if (args.singleLevel || args.mobileMode) {
                let setHiddenByDefault = () => {
                    if (!styleSheet) {
                        styleSheet = document.createElement('style');
                        document.head.appendChild(styleSheet);
                    }
                    styleSheet.textContent = `
                    .item { display: none; }
                    `;
                }

                let toggleSheet = () => {
                    if (!styleSheet) {
                        styleSheet = document.createElement('style');
                        document.head.appendChild(styleSheet);
                    }
                    styleSheet.textContent = `
                    .item { display: none; }
                    .level-${level} { display: block; }
                    `;
                }

                let toggleMergeMode = () => {
                    if (!styleSheet2) {
                        styleSheet2 = document.createElement('style');
                        document.head.appendChild(styleSheet2);
                    }
                    mergeMode = !mergeMode;
                    styleSheet2.textContent = `
                    .duplicate-name { display: ${mergeMode ? 'none' : 'block'}; }
                    .number-occurrences { display: ${mergeMode ? 'inline-block' : 'none'}; }
                    `;
                    if (merged) {
                        merged.classList.toggle("checked");
                    }
                }

                if (args.singleLevel) {
                    toggleSheet();
                    mergeMode = true;
                    toggleMergeMode();
                } else if (args.mobileMode) {
                    setHiddenByDefault();
                }

                var controls = document.createElement("div");
                controls.className = "controls";
                domNode.appendChild(controls);
                
                var levelup = document.createElement("div");
                controls.appendChild(levelup);
                
                let levelupsymbol = document.createElement("i");
                levelupsymbol.className = 'material-icons';
                levelupsymbol.innerHTML = "arrow_back_ios_new";
                levelup.appendChild(levelupsymbol);

                let switchLevel = (advance) => {
                    return () => {
                        level += advance;
                        if (level < minLevel) {
                            level = minLevel;
                        }
                        if (level > maxLevel) {
                            level = maxLevel;
                        }
                        toggleSheet(level);
                    }
                }

                if (args.singleLevel) {
                    var leveldown = document.createElement("div");
                    controls.appendChild(leveldown);
                    var merged = document.createElement("div");
                    controls.appendChild(merged);

                    let leveldownsymbol = document.createElement("i");
                    leveldownsymbol.className = 'material-icons';
                    leveldownsymbol.innerHTML = "arrow_forward_ios";

                    let mergesymbol = document.createElement("i");
                    mergesymbol.className = 'material-icons';
                    mergesymbol.innerHTML = "merge_type";
                    
                    leveldown.appendChild(leveldownsymbol);
                    merged.appendChild(mergesymbol);

                    levelup.onclick = switchLevel(-1);
                    leveldown.onclick = switchLevel(+1);
                    merged.onclick = toggleMergeMode;
                } else {
                    levelup.onclick = () => {
                        this.parentToChildMapping[this.childParentMapping[this.currentFocusNode]].map(id => domNodes[id].label.parentNode).forEach(e => {e.style = 'display: block';});
                        this.parentToChildMapping[this.currentFocusNode].map(id => domNodes[id].label.parentNode).forEach(e => {e.style = 'display: none';});
                        this.currentFocusNode = this.childParentMapping[this.currentFocusNode];
                        if (!domNodes[this.currentFocusNode]) {
                            levelup.classList.add('disabled');
                        }
                    }
                    levelup.classList.add('disabled');
                }
            }            

            let build = (modelId, parentId, parent_d, d, n, level) => {
                if (level > maxLevel) {
                    maxLevel = level;
                }

                var qid = self.qualifyInstance(modelId, fromXml ? n.guid : n.id);

                let duplicateNameWrapper;
                if (args.singleLevel) {
                    duplicateNameWrapper = document.createElement("div");
                    d.appendChild(duplicateNameWrapper);
                    d = duplicateNameWrapper;
                }

                // The following structure is built:
                //
                // <div>          <-- d
                //   <div>        <-- label
                //     <i>        <-- label_icon
                //     ""         <-- nm
                //   <div>        <-- children
                //     <div>      <-- d2 (next recursion d)
                //     ...

                const levelHidden = !args.singleLevel && args.hideLevels && level < args.hideLevels;
                if (!levelHidden) {

                    var label = document.createElement("div");
                    var children = document.createElement("div");
                    var eye;

                    if (args.withVisibilityToggle) {
                        eye = document.createElement("i");
                        eye.className = 'bimsurfer-tree-eye material-icons';
                        label.appendChild(eye)
                    }

                    if (!parentId) {
                        self.roots.push(qid);
                    } else {
                        (self.parentToChildMapping[parentId] = (self.parentToChildMapping[parentId] || [])).push(qid);
                        self.childParentMapping[qid] = parentId;
                    }
                    
                    let nm = n.label || n.name || n.guid;
                    
                    if (args.singleLevel) {
                        let k = `l${level}-${nm}`;
                        let li = itemsByLevelByName[k] = itemsByLevelByName[k] || [];
                        if (li.length) {
                            duplicateNameWrapper.classList.add("duplicate-name");
                        } else {
                            firstOrrenceOfDuplicateName[k] = qid;
                        }
                        li.push(d);
                        
                        let qid0 = firstOrrenceOfDuplicateName[k];
                        li = duplicateNameIdsById[qid0] = duplicateNameIdsById[qid0] || [];
                        li.push(qid);
                    } else if (args.mobileMode) {
                        label.className = "bimsurfer-tree-label";
                        let label_collapse = document.createElement("i");
                        label_collapse.className = "material-icons";
                        label_collapse.innerHTML = "arrow_forward_ios";
                        label_collapse.style='padding: 0 0.3em; margin: 0 0.6em';
                        label.appendChild(label_collapse);
                        if ((n.children || []).filter(x => !x["xlink:href"]).length) {
                            label_collapse.onclick = (evt) => {
                                evt.stopPropagation();
                                evt.preventDefault();
                                
                                Array.from(label.parentNode.parentNode.children).forEach(e => {e.style = 'display: none'});
                                this.parentToChildMapping[qid].map(id => domNodes[id].label.parentNode).forEach(e => {e.style = 'display: block';});
                                this.currentFocusNode = qid;
                                levelup.classList.remove('disabled');
                            };
                        } else {
                            label_collapse.style.visibility = 'hidden';
                        }
                    } else {
                        label.className = "bimsurfer-tree-label";
                        let label_collapse = document.createElement("i");
                        label_collapse.className = "collapse material-icons";
                        label.appendChild(label_collapse);
                        if ((n.children || []).filter(x => !x["xlink:href"]).length) {
                            if ((args.expandUntil || []).indexOf(n.type) !== -1) {
                                d.classList.toggle('bimsurfer-tree-node-collapsed');
                            }

                            label_collapse.onclick = (evt) => {
                                evt.stopPropagation();
                                evt.preventDefault();
                                d.classList.toggle('bimsurfer-tree-node-collapsed');
                            };
                        } else {
                            label_collapse.style.visibility = 'hidden';
                        }
                    }

                    let label_icon = document.createElement("i");
                    label_icon.className = "icon material-icons";
                    label_icon.innerHTML = self.icons[n.type];
                    label.appendChild(label_icon);

                    label.appendChild(document.createTextNode(nm));

                    self.objectTypeMapping[qid] = n.type;
                    
                    d.appendChild(label);
                    if (!args.singleLevel && !args.mobileMode) {
                        children.className = "bimsurfer-tree-children-with-indent";
                        d.appendChild(children);
                    }

                    domNodes[qid] = {label: label, eye: eye};

                    if (eye) {
                        eye.onclick = function(evt) {
                            evt.stopPropagation();
                            evt.preventDefault();

                            var visible = !eye.classList.toggle('bimsurfer-tree-eye-off');
                            var descendants = collect(qid);
                            var fn = visible ? DOMTokenList.prototype.remove : DOMTokenList.prototype.add;
                            descendants.forEach(s => {
                                fn.call(domNodes[s].eye.classList, 'bimsurfer-tree-eye-off');
                            });

                            self.fire("visibility-changed", [{visible: visible, ids: descendants}]);

                            return false;
                        }
                    }
                    
                    label.onclick = function(evt) {                    
                        evt.stopPropagation();
                        evt.preventDefault();

                        var clear = args.app ? args.app.shouldClearSelection(evt) : !evt.shiftKey;

                        let ids = mergeMode ? collect(...duplicateNameIdsById[qid]) : collect(qid);
                        self.setSelected(ids, clear ? SELECT_EXCLUSIVE : TOGGLE, true);
                        self.fire("click", [qid, self.getSelected(true)]);

                        return false;
                    };

                }
                
                for (var i = 0; i < (n.children || []).length; ++i) {
                    var child = n.children[i];
                    if (fromXml) {
                        // This is a link to a resource such as a propertyset, do not display
                        // in the tree view.
                        if (child["xlink:href"]) continue;

                        // Opening Elements are shown because the fill elements are positioned
                        // underneath in the IfcConvert output.
                        // @todo option to hide, similar to the d -> d2 propagation for hideLevels?
                        if (false && child.type === "IfcOpeningElement") continue;
                    }
                    
                    let d2;
                    if (levelHidden) {
                        d2 = d;
                    } else {
                        d2 = document.createElement("div");
                        d2.className = "item";
                        d2.classList.add(`level-${level+1}`);
                        ((args.singleLevel || args.mobileMode) ? parent_d : children).appendChild(d2);
                    }

                    build(modelId, qid, parent_d, d2, child, level+1);
                }
            }

            fetch("https://aecgeeks.github.io/ifc-icons/ifc-full-icons.json").then(r=>r.json()).then(icons => {

            self.icons = icons;

            models.forEach(function(m) {
                var column1 = document.createElement("div");
                var row1cell = document.createElement("div");

                column1.className = 'bimsurfer-tree-column';
                row1cell.className = "item";
                row1cell.classList.add(`level-0`);
                row1cell.style = 'display: block';
                column1.appendChild(row1cell);
                column1.style.width = '100%';

                if (m.tree) {
                    build(m.id, null, column1, row1cell, m.tree, 0);
                } else if (m.src || m.json) {
                    const loadModelFromSource = (src) => {
                        Request.Make({url: src}).then(function(xml) {
                            var json = Utils.XmlToJson(xml, {'Name': 'name', 'id': 'guid'});
                            loadModelFromJson(json);
                        });                    
                    }
                    
                    const loadModelFromJson = (json) => {
                        var project = Utils.FindNodeOfType(json, "decomposition")[0].children[0];
                        // build(m.id || i, null, row1cell, project, column2);
                        build(m.id, null, column1, row1cell, project, 0);
                    }
                    
                    var fn = m.src ? loadModelFromSource : loadModelFromJson;
                    fn(m.src ? m.src : m.json);
                }

                domNode.appendChild(column1);
            });

            for (let items of Object.values(itemsByLevelByName)) {
                if (items.length > 1) {
                    let span = document.createElement("span");
                    span.innerHTML = items.length;
                    span.className = "number-occurrences"
                    items[0].children[0].appendChild(span);
                }
            }

            });
        }
        
    };
    
    StaticTreeRenderer.prototype = Object.create(EventHandler.prototype);

    return StaticTreeRenderer;
    
});