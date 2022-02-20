define(["./EventHandler", "./Request", "./Utils"], function(EventHandler, Request, Utils) {
    "use strict";
    
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
        this.roots = [];
        
        this.setSelected = function(ids, mode) {
            if (mode == SELECT_EXCLUSIVE) {
                self.setSelected(self.getSelected(true), DESELECT);
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
            
            this.fire("selection-changed", [self.getSelected(true)])
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

            var build = function(modelId, parentId, d, n, col2) {
                var qid = self.qualifyInstance(modelId, fromXml ? n.guid : n.id);

                var label = document.createElement("div");
                var children = document.createElement("div");
                var children2, eye;

                if (args.withVisibilityToggle) {
                    // children2 = document.createElement("div");
                    eye = document.createElement("i");
                    eye.className = 'bimsurfer-tree-eye material-icons';
                    // col2.appendChild(eye);
                    // col2.appendChild(children2);
                    label.appendChild(eye)
                }

                if (!parentId) {
                    self.roots.push(qid);
                } else {
                    (self.parentToChildMapping[parentId] = (self.parentToChildMapping[parentId] || [])).push(qid);
                }
                
                label.className = "bimsurfer-tree-label";
                let label_collapse = document.createElement("i");
                label_collapse.className = "collapse material-icons";
                label.appendChild(label_collapse);
                if ((n.children || []).filter(x => !x["xlink:href"]).length) {
                    label_collapse.onclick = function(evt) {
                        evt.stopPropagation();
                        evt.preventDefault();
                        d.classList.toggle('bimsurfer-tree-node-collapsed');
                    };
                } else {
                    label_collapse.style.visibility = 'hidden';
                }

                let label_icon = document.createElement("i");
                label_icon.className = "icon material-icons";
                label_icon.innerHTML = self.icons[n.type];
                label.appendChild(label_icon);


                label.appendChild(document.createTextNode(n.label || n.name || n.guid));
                                
                d.appendChild(label);
                children.className = "bimsurfer-tree-children-with-indent";
                d.appendChild(children);

                domNodes[qid] = {label: label, eye: eye};


                if (eye) {
                    eye.onclick = function(evt) {
                        evt.stopPropagation();
                        evt.preventDefault();

                        var visible = !eye.classList.toggle('bimsurfer-tree-eye-off');
                        var descendants = [];
                        var collect = function(id) {
                            descendants.push(id);
                            (self.parentToChildMapping[id] || []).forEach(collect);
                        }
                        collect(qid);
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
                    self.setSelected([qid], clear ? SELECT_EXCLUSIVE : TOGGLE);
                    self.fire("click", [qid, self.getSelected(true)]);

                    return false;
                };
                
                for (var i = 0; i < (n.children || []).length; ++i) {
                    var child = n.children[i];
                    if (fromXml) {
                        if (child["xlink:href"]) continue;
                        // if (child.type === "IfcOpeningElement") continue;
                    }
                    
                    var d2 = document.createElement("div");
                    d2.className = "item";
                    children.appendChild(d2);

                    if (false && eye) {
                        var d3 = document.createElement("div");
                        d3.className = "item";
                        children2.appendChild(d3);
                    }

                    build(modelId, qid, d2, child, d3);
                }
            }

            fetch("https://aecgeeks.github.io/ifc-icons/ifc-full-icons.json").then(r=>r.json()).then(icons => {

            self.icons = icons;

            models.forEach(function(m) {
                var column1 = document.createElement("div");
                var column2;
                var row1cell = document.createElement("div");

                column1.className = 'bimsurfer-tree-column';
                row1cell.className = "item";
                column1.appendChild(row1cell);

                if (false && args.withVisibilityToggle) {
                    column2 = document.createElement("div");
                    var row2cell = document.createElement("div");

                    column2.className = 'bimsurfer-tree-column';
                    row2cell.className = "item";
                    column2.appendChild(row2cell);

                    column1.style.width = (domNode.offsetWidth - 40) + 'px'
                    column2.style.width = '20px';
                } else {
                    column1.style.width = '100%';
                }

                if (m.tree) {
                    build(m.id, null, row1cell, m.tree, column2);
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
                        build(m.id, null, row1cell, project, column2);
                    }
                    
                    var fn = m.src ? loadModelFromSource : loadModelFromJson;
                    fn(m.src ? m.src : m.json);
                }

                domNode.appendChild(column1);
                if (column2) {
                    domNode.appendChild(column2);
                }
            });

            });
        }
        
    };
    
    StaticTreeRenderer.prototype = Object.create(EventHandler.prototype);

    return StaticTreeRenderer;
    
});