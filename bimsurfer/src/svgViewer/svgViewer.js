define(["../EventHandler", "../Utils"], function(EventHandler, Utils) {
    "use strict";
    
    function createElem(tag, attrs, NS) {
        const ob = NS ? document.createElementNS(NS, tag) : document.createElement(tag);
        for(let [k,v] of Object.entries(attrs || {})) {
            if (NS) {
                ob.setAttribute(k, v);
            } else {
                ob.setAttributeNS(null, k, v);
            }
        }
        return ob;
    }
    
    function children(node) {
        return Array.from(node.childNodes).filter(n => n.nodeType === 1);
    }
    
    function testOverlap(text, path) {
        var Mt = text.getScreenCTM().inverse();
        
        var P1 = text.ownerSVGElement.createSVGPoint();
        var P2 = text.ownerSVGElement.createSVGPoint();
        var bb = text.getBoundingClientRect();
        
        if (typeof(bb) === 'undefined') {
            return false;
        }
        
        P1.x = bb.x;
        P1.y = bb.y;
        P2.x = bb.x + bb.width;
        P2.y = bb.y + bb.height;
        
        P1 = P1.matrixTransform(Mt);
        P2 = P2.matrixTransform(Mt);
        
        var bb_width = P2.x - P1.x;
        var bb_height = P2.y - P1.y;
        
        var len = path.getTotalLength();
        var u = 0.;
        var step = (bb_width < bb_height ? bb_width : bb_height) / 2.;

        while (u < len) {
            // Sample some points over the bath when contained in the AABB rectangle
            // for the text we know text and path intersect and text should be hidden
            var p = path.getPointAtLength(u);
            if (p.x >= P1.x && p.y >= P1.y && p.x <= P2.x && p.y <= P2.y) {
                return true;
            }
            u += step;
        }
        
        return false;
    }
  
    function SvgViewer(cfg) {
        let self = this;
        
        EventHandler.call(this);
        
        self.selected = new Set();
        self.lineMapping = new Map();
        
        self.svg = null;
        
        var xmlns = "http://www.w3.org/2000/svg";
        
        var elem = document.getElementById(cfg.domNode);
        
        self.load = function(src) {
        
            self.select = createElem("select");
            /*self.obj = createElem("object", {
                type : "image/svg+xml",
                data : src
            });*/
            self.obj = createElem("div");
            elem.appendChild(self.obj);
            var d = createElem("div", {
                class: "selectcontainer"
            });
            
            elem.appendChild(d);
            d.appendChild(self.select);
            
            self.obj.style.width = elem.offsetWidth + 'px';
            self.obj.style.height = (elem.offsetHeight - d.offsetHeight) + 'px';
            
            return fetch(src)
                .then(response => {
                    if (!response.ok) {
                        throw new Error("HTTP status " + response.status);
                    } else {
                        return response.text();
                    }
                }).then(text => { 
                    self.obj.innerHTML = text; 
                    var svg = self.obj.getElementsByTagName('svg')[0];
                    svg.style.width = svg.style.height = '100%';
                }).catch(exc => {
                    self.error = true;
                }).then(() => {
                    self._onload();
                });
        }
        
        self._updateState = function(n, parentState) {
            if (parentState || self.selected.has(n)) {
                if (!self.lineMapping.has(n)) {
                    for (let c of children(n)) {
                        self._updateState(c, true);
                    }
                    if (n.tagName == 'path') {
                        const line = n.cloneNode(false);
                        line.style.cssText = "fill: none; stroke: lime; stroke-width: 3px";
                        self.lineMapping.set(n, line);
                        // children[0] is the pan-zoom viewport
                        self.rootGroup.appendChild(line);
                    }
                }
            } else {
                if (self.lineMapping.has(n)) {
                    // the groups do not get a line
                    self.rootGroup.removeChild(self.lineMapping.get(n));
                    self.lineMapping.delete(n);
                }
                for (let c of children(n)) {
                    self._updateState(c, false);
                }
            }
        }
        
        self.setSelection = function(params) {
            const updateState = (n) => {self._updateState(n)};
            if (params.clear) {
                const previous = Array.from(self.selected);
                self.selected.clear();
                previous.forEach(updateState);
            }
            const fn = params.selected ? self.selected.add : self.selected.delete;

            const convertGuidOrIdentity = (s) => (self.guidToIdMap.get(s) || s);
            
            const prefix = self.legacySvgExport ? 'product-product' : 'product';
            
            var nodes = null;
            if (params.nodes) {
                nodes = params.nodes;
            } else if (params.ids) {
                nodes = params.ids.map(convertGuidOrIdentity).map((s)=>`${prefix}-${s}-body`).map(self.svg.getElementById.bind(self.svg)).filter((s) => (s !== null));
            }
            
            nodes.forEach(fn.bind(self.selected));                    
            nodes.forEach(updateState);
            
            if (params.nodes) {
                const ids = params.nodes.map((n) => (n.getAttribute("id")));
                self.fire("selection-changed", [{objects: ids}]);
            }
        }
        
        self.toggleStorey = function(i) {
            self.setSelection({clear: true, nodes:[], selected: true});
            self.storeys.forEach((s, j)=>{
                s.style.visibility = (i == j) ? 'visible' : 'hidden';
            });
            self.updateTextVisibility();
        };
        
        self.reset = function(args) {
            if (args.colors) {
                for (let p of Array.from(self.svg.getElementsByTagName("path"))) {
                    if (p.parentNode.className.baseVal == 'IfcDoor') {
                        // @todo this is mainly for the door arcs, but we need to annotate closed areas and line annotations better in the IfcConvert binary
                        p.style.fill = 'none';
                    } else {
                        p.style.fill = '#444';
                        if (p.parentNode.className.baseVal == 'IfcSpace') {
                            p.style.fillOpacity = '.2';
                        }
                    }
                    p.style.stroke = '#222';
                }        
            }
        }
        
        self.setColor = function(args) {
            const convertGuidOrIdentity = (s) => (self.guidToIdMap.get(s) || s);
            var nodes = args.ids.map(convertGuidOrIdentity).map((s)=>`product-product-${s}-body`).map(self.svg.getElementById.bind(self.svg)).filter((s) => (s !== null));
            var color = "#" + args.color.map((f) => (("0" + parseInt(f * 255.).toString(16)).substr(-2))).join("");
            
            nodes.forEach((n) => {
                n.style.fill = n.style.stroke = color;
                Array.from(n.getElementsByTagName("path")).forEach((n) => {
                    n.style.fill = n.style.stroke = color;
                });
            });
        }
        
        self.destroy = function() {
            self.spz.destroy();
            while(elem.lastChild) {
                elem.removeChild(elem.lastChild);
            }
        }
        
        self.updateTextVisibility = function() {
            if (!self.textNodes) return;
            self.textNodes.forEach(t => {
                let n = t;
                var storeyVisible;
                while (n) {
                    if (self.storeys.indexOf(n) !== -1) {
                        storeyVisible = n.style.visibility !== 'hidden';
                        break;
                    }
                    n = n.parentElement;
                }
                var visible = storeyVisible && (t.parentElement.className.baseVal == 'IfcAnnotation' || !Array.from(t.parentElement.querySelectorAll('path')).some((path) => {
                    return testOverlap(t, path)
                }));
                t.style.visibility = visible ? 'visible' : 'hidden';
            });
        }
        
        self._onload = function() {
            if (self.error) {
                return;
            }
            
            var svgDoc = self.obj.contentDocument || self.obj.getElementsByTagName('svg')[0];
            self.svg = self.obj.contentDocument ? children(svgDoc)[0] : svgDoc;
            self.reset({colors:true});
            self.storeys = children(self.svg).filter(n => n.tagName == 'g');
            
            if (self.storeys.length === 0) {
                return;
            }
            
            self.guidToIdMap = new Map();
            const traverse = (e) => {
                const id = e.getAttribute('id');
                if (id !== null) {
                    const parts = id.split('-');
                    if (parts.filter(s => s === 'product').length == 2) {
                        self.legacySvgExport = true;
                    }
                    const id2 = parts.filter(s => s !== 'product' && s !== 'body' && s !== 'storey').join('-');
                    const g = Utils.CompressGuid(id2);
                    self.guidToIdMap.set(g, id2);
                }
                for (const c of children(e)) {
                    traverse(c);
                }
            };
            traverse(self.svg);
            self.toggleStorey(0);
            self.select.onchange = function(evt) {
                self.toggleStorey(evt.target.selectedIndex);
            }
            self.storeys.forEach((s, i) => {
                const opt = document.createElement('option');
                
                var N;
                if (s.hasAttribute('data-name')) {
                    N = s.getAttribute('data-name')
                } else {
                    N = `storey ${i}`;
                }
                opt.setAttribute("value", N);
                opt.appendChild(document.createTextNode(N));
                self.select.appendChild(opt);
            });
            self.textNodes = Array.from(self.svg.querySelectorAll('text'));        
            const updateZoom = (scale) => { 
                self.svg.style.fontSize = 10 / self.rootGroup.transform.baseVal.getItem(0).matrix.a + "pt";
                self.updateTextVisibility();
            };
            self.spz = svgPanZoom(self.obj.contentDocument ? self.obj : self.obj.getElementsByTagName('svg')[0], {
              zoomEnabled: true,
              preventMouseEventsDefault: true,
              controlIconsEnabled: false,
              onZoom: updateZoom
            });
            self.rootGroup = children(self.svg).filter(n => n.tagName == 'g')[0];
            updateZoom();
            svgDoc.onclick = function(evt) {
                let n = evt.target;
                const nodes = []
                if (n.tagName !== 'svg') {
                    while (n.tagName !== 'g' && n.parentNode) {
                        n = n.parentNode;
                    }
                    nodes.push(n);
                }
                self.setSelection({
                    selected: true,
                    clear: cfg.app.shouldClearSelection(evt),
                    nodes: nodes
                });
            }
        };
    }
    
    SvgViewer.prototype = Object.create(EventHandler.prototype);
    
    return SvgViewer;
});
