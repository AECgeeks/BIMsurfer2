import EventHandler from './EventHandler.js';
import * as Utils from './Utils.js';

// Convert XML hex guid with potential storey prefix to an IFC base64 guid
const convertId = (id) => {
    let parts = id.split('-');
    parts = parts.slice(parts.lastIndexOf('product'));
    
    const id2 = parts.filter(s => s !== 'product' && s !== 'body' && s !== 'storey').join('-');
    return Utils.CompressGuid(id2);
}

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

export default class SvgViewer extends EventHandler {
    
    constructor(args) {
        super(args);
        
        this.selected = new Set();
        this.lineMapping = new Map();
        
        this.svg = null;
                
        this.elem = document.getElementById(cfg.domNode);
    }
        
    load(src) {
    
        this.select = createElem("select");
        /*this.obj = createElem("object", {
            type : "image/svg+xml",
            data : src
        });*/
        this.obj = createElem("div");
        this.elem.appendChild(this.obj);
        var d = createElem("div", {
            class: "selectcontainer"
        });
        
        this.elem.appendChild(d);
        d.appendChild(this.select);
        
        this.obj.style.width = this.elem.offsetWidth + 'px';
        this.obj.style.height = (this.elem.offsetHeight - d.offsetHeight) + 'px';
        
        return fetch(src)
            .then(response => {
                if (!response.ok) {
                    throw new Error("HTTP status " + response.status);
                } else {
                    return response.text();
                }
            }).then(text => { 
                this.obj.innerHTML = text; 
                var svg = this.obj.getElementsByTagName('svg')[0];
                svg.style.width = svg.style.height = '100%';
            }).catch(exc => {
                this.error = true;
            }).then(() => {
                this._onload();
            });
    }
    
    resize() {}
    
    _updateState(n, parentState) {
        if (parentState || this.selected.has(n)) {
            if (!this.lineMapping.has(n)) {
                for (let c of children(n)) {
                    this._updateState(c, true);
                }
                if (n.tagName == 'path') {
                    const line = n.cloneNode(false);
                    line.style.cssText = "fill: none; stroke: lime; stroke-width: 3px";
                    this.lineMapping.set(n, line);
                    // children[0] is the pan-zoom viewport
                    this.rootGroup.appendChild(line);
                }
            }
        } else {
            if (this.lineMapping.has(n)) {
                // the groups do not get a line
                this.rootGroup.removeChild(this.lineMapping.get(n));
                this.lineMapping.delete(n);
            }
            for (let c of children(n)) {
                this._updateState(c, false);
            }
        }
    }
    
    setSelection(params) {
        const updateState = (n) => {this._updateState(n)};
        if (params.clear) {
            const previous = Array.from(this.selected);
            this.selected.clear();
            previous.forEach(updateState);
        }
        const fn = params.selected ? this.selected.add : this.selected.delete;

        const convertGuidOrIdentity = (s) => (this.guidToIdMap.get(s) || [s]);
        
        var nodes = null;
        if (params.nodes) {
            nodes = params.nodes;
        } else if (params.ids) {
            nodes = params.ids.flatMap(convertGuidOrIdentity).map(this.svg.getElementById.bind(this.svg)).filter((s) => (s !== null));
        }
        
        nodes.forEach(fn.bind(this.selected));                    
        nodes.forEach(updateState);
        
        const getStoreyIdx = (n) => {
            while (n) {
                let idx = this.storeys.indexOf(n);
                if (idx !== -1) {
                    return idx;
                }
                n = n.parentElement;
            }
        }

        const sids = new Set(nodes.map(getStoreyIdx));
        if (params.clear && sids.size && !sids.has(this.select.selectedIndex)) {
            this.select.selectedIndex = Array.from(sids).sort()[0];
            this.toggleStorey(this.select.selectedIndex, false);
        }

        if (params.nodes) {
            const ids = params.nodes.map((n) => (n.getAttribute("id"))).map(convertId);
            this.fire("selection-changed", [{objects: ids}]);
        }
    }
    
    toggleStorey(i, clearSelection) {
        if (clearSelection !== false) {
            this.setSelection({clear: true, nodes:[], selected: true});
        }
        this.storeys.forEach((s, j)=>{
            s.style.visibility = (i == j) ? 'visible' : 'hidden';
        });
        this.updateTextVisibility();
    }
    
    reset(args) {
        if (args.colors) {
            for (let p of Array.from(this.svg.getElementsByTagName("path"))) {
                /*
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
                */
            }        
        }
    }
    
    setColor(args) {
        const convertGuidOrIdentity = (s) => (this.guidToIdMap.get(s) || s);
        var nodes = args.ids.map(convertGuidOrIdentity).map((s)=>`product-product-${s}-body`).map(this.svg.getElementById.bind(this.svg)).filter((s) => (s !== null));
        var color = "#" + args.color.map((f) => (("0" + parseInt(f * 255.).toString(16)).substr(-2))).join("");
        
        nodes.forEach((n) => {
            n.style.fill = n.style.stroke = color;
            Array.from(n.getElementsByTagName("path")).forEach((n) => {
                n.style.fill = n.style.stroke = color;
            });
        });
    }
    
    destroy() {
        this.spz.destroy();
        while(this.elem.lastChild) {
            this.elem.removeChild(this.elem.lastChild);
        }
    }
    
    updateTextVisibility() {
        if (!this.textNodes) return;
        this.textNodes.forEach(t => {
            let n = t;
            var storeyVisible;
            while (n) {
                if (this.storeys.indexOf(n) !== -1) {
                    storeyVisible = n.style.visibility !== 'hidden';
                    break;
                }
                n = n.parentElement;
            }
            // Dimensions and storey elevations  are always visible
            let cls = t.parentElement.className.baseVal
            var visible = storeyVisible && (cls.includes("Dimension") || cls.includes("IfcBuildingStorey") || !Array.from(t.parentElement.querySelectorAll('path')).some((path) => {
                return testOverlap(t, path)
            }));
            t.style.visibility = visible ? 'visible' : 'hidden';
        });
    }
    
    _onload() {
        if (this.error) {
            return;
        }
        
        var svgDoc = this.obj.contentDocument || this.obj.getElementsByTagName('svg')[0];
        this.svg = this.obj.contentDocument ? children(svgDoc)[0] : svgDoc;
        this.reset({colors:true});
        this.storeys = children(this.svg).filter(n => n.tagName == 'g');
        
        if (this.storeys.length === 0) {
            return;
        }
        
        this.guidToIdMap = new Map();
        const traverse = (e) => {
            const id = e.getAttribute('id');
            if (id !== null) {
                const guid = convertId(id);
                if (!this.guidToIdMap.has(guid)) {
                    this.guidToIdMap.set(guid, []);
                }
                this.guidToIdMap.get(guid).push(id);
            }
            for (const c of children(e)) {
                traverse(c);
            }
        };
        traverse(this.svg);
        this.toggleStorey(0);
        this.select.onchange = function(evt) {
            this.toggleStorey(evt.target.selectedIndex);
        }
        this.storeys.forEach((s, i) => {
            const opt = document.createElement('option');
            
            var N;
            if (s.hasAttribute('data-name')) {
                N = s.getAttribute('data-name')
            } else if (s.hasAttribute("ifc:name")) {
                N = s.getAttribute("ifc:name")
            } else {
                N = `storey ${i}`;
            }
            opt.setAttribute("value", N);
            opt.appendChild(document.createTextNode(N));
            this.select.appendChild(opt);
        });
        this.textNodes = Array.from(this.svg.querySelectorAll('text'));        
        const updateZoom = (scale) => { 
            this.svg.style.fontSize = 10 / this.rootGroup.transform.baseVal.getItem(0).matrix.a + "pt";
            this.updateTextVisibility();
        };
        this.spz = svgPanZoom(this.obj.contentDocument ? this.obj : this.obj.getElementsByTagName('svg')[0], {
          zoomEnabled: true,
          preventMouseEventsDefault: true,
          controlIconsEnabled: false,
          onZoom: updateZoom
        });
        this.rootGroup = children(this.svg).filter(n => n.tagName == 'g')[0];
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
            this.setSelection({
                selected: true,
                clear: cfg.app.shouldClearSelection(evt),
                nodes: nodes
            });
        }
    }
}