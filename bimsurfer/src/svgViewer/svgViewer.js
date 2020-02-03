define(["../EventHandler", "../Utils"], function(EventHandler, Utils) {
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
            fetch(src).then(response => response.text())
                .then(text => { 
                    self.obj.innerHTML = text; 
                    var svg = self.obj.getElementsByTagName('svg')[0];
                    svg.style.width = svg.style.height = '100%';
                    self._onload();
                });
            elem.appendChild(d);
            d.appendChild(self.select);
            
            self.obj.style.width = elem.offsetWidth + 'px';
            self.obj.style.height = (elem.offsetHeight - d.offsetHeight) + 'px';
            
            // self.obj.onload = self._onload;
        }
        
        self._updateState = function(n, parentState) {
            if (parentState || self.selected.has(n)) {
                if (!self.lineMapping.has(n)) {
                    for (let c of n.children) {
                        self._updateState(c, true);
                    }
                    if (n.tagName == 'path') {
                        const line = n.cloneNode(false);
                        line.style.cssText = "fill: none; stroke: lime; stroke-width: 3px";
                        self.lineMapping.set(n, line);
                        // children[0] is the pan-zoom viewport
                        self.svg.children[0].appendChild(line);
                    }
                }
            } else {
                if (self.lineMapping.has(n)) {
                    // the groups do not get a line
                    self.svg.children[0].removeChild(self.lineMapping.get(n));
                    self.lineMapping.delete(n);
                }
                for (let c of n.children) {
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
            
            var nodes = null;
            if (params.nodes) {
                nodes = params.nodes;
            } else if (params.ids) {
                nodes = params.ids.map(convertGuidOrIdentity).map((s)=>`product-product-${s}-body`).map(self.svg.getElementById.bind(self.svg)).filter((s) => (s !== null));
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
        };
        
        self.reset = function(args) {
            if (args.colors) {
                for (let p of Array.from(self.svg.getElementsByTagName("path"))) {
                    p.style.fill = '#444';
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
        
        self._onload = function() {
            var svgDoc = self.obj.contentDocument || self.obj.getElementsByTagName('svg')[0];
            self.svg = self.obj.contentDocument ? svgDoc.children[0] : svgDoc;
            self.reset({colors:true});
            self.storeys = Array.from(self.svg.children);
            self.guidToIdMap = new Map();
            const traverse = (e) => {
                const id = e.getAttribute('id');
                if (id !== null) {
                    const id2 = id.substr(16, 36);
                    const g = Utils.CompressGuid(id2);
                    self.guidToIdMap.set(g, id2);
                }
                for (const c of Array.from(e.children)) {
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
                const N = `storey ${i}`;
                opt.setAttribute("value", N);
                opt.appendChild(document.createTextNode(N));
                self.select.appendChild(opt);
            });
            svgPanZoom(self.obj.contentDocument ? self.obj : self.obj.getElementsByTagName('svg')[0], {
              zoomEnabled: true,
              preventMouseEventsDefault: true,
              controlIconsEnabled: false
            });
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
                    clear: !evt.shiftKey,
                    nodes: nodes
                });
            }
        };
    }
    
    SvgViewer.prototype = Object.create(EventHandler.prototype);
    
    return SvgViewer;
});
