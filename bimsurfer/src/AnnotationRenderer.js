define(["./Utils"], function (Utils) {
    "use strict";
    
    var AnnotationRenderer = function(args) {
    
        var v = args.viewer;
        var m = args.model;
        var a = args.assets;
        
        var aabb, modelExtent, use_xeogl;
        
        if (use_xeogl = !!v.scene.worldBoundary) {        
            aabb = v.scene.worldBoundary.aabb;
            var max = aabb.subarray(3);
            var min = aabb.subarray(0, 3);
            var diag = xeogl.math.subVec3(max, min, xeogl.math.vec3());
            modelExtent = xeogl.math.lenVec3(diag);   
        } else {
            aabb = new THREE.Box3();
            aabb.setFromObject(v.scene);
            modelExtent = aabb.getSize(new THREE.Vector3()).length();
        }
    
        var visit = function(n, fn) {
            fn(n);
            (n.children || []).forEach(function(c) {visit(c, fn);});
        };
        
        var traverse = function(types, p, n) {
            var li = [];
            var _ = function(p, n) {
                var t = n["xlink:href"];
                if (t) t = types[t.substr(1)];
                if (t) li.push([p, t]);
                (n.children || []).forEach(function(c) {_(n, c);});
            }
            _(p, n);
            return li;
        };
        
        var makeMatrix = use_xeogl
            ? function(s, lengthUnit) {
                if (arguments.length == 0) {
                    return xeogl.math.mat4();
                }
                
                var m = xeogl.math.mat4(s.split(" "));
                m[12] *= lengthUnit;
                m[13] *= lengthUnit;
                m[14] *= lengthUnit;
                return m;
            }
            : function(s, lengthUnit) {
                var m = new THREE.Matrix4;
                if (arguments.length == 0) return m;
                
                var f = new Float32Array(s.split(" "));
                f[12] *= lengthUnit;
                f[13] *= lengthUnit;
                f[14] *= lengthUnit;
                m.set.apply(m, f);
                m.transpose();
                return m;
            };
            
        var invert = use_xeogl ? xeogl.math.inverseMat4 : function(m, n) { return m.getInverse(n); }
        
        var scaleMatrix = use_xeogl ? xeogl.math.scalingMat4s : function(v) {
            return makeMatrix().scale(new THREE.Vector3(v,v,v));
        };
        
        var makeVec4 = use_xeogl ? function() { return xeogl.math.vec4(arguments); } : function(x,y,z,w) { return new THREE.Vector4(x,y,z,w); };
        
        var m4v4 = use_xeogl ? xeogl.math.mulMat4v4 : function(m, v) { return v.clone().applyMatrix4(m); };
        
        var m4m4_inplace = use_xeogl ? function(m, n) { xeogl.math.mulMat4(m, n, m); } : function(m, n) { m.multiply(n); };;
        
        var logMatrix = function(n, m) {
            if (m.elements) {
                m = m.elements;;
            }
            console.log(n, ...m);
        };
            
        this.render = function() {            
            var typelist = Utils.FindNodeOfType(m, "types")[0].children;
            var decomposition = Utils.FindNodeOfType(m, "decomposition")[0];
            var units = Utils.FindNodeOfType(m, "units")[0].children;
            
            var types = {};
            typelist.forEach(function(t) {
                types[t.guid] = t;
            });
            
            var lengthUnit = 1.;
            units.forEach(function(u) {
                if (u.UnitType === "LENGTHUNIT") {
                    lengthUnit = parseFloat(u.SI_equivalent);
                }
            });
            
            var elementsWithType = traverse(types, null, decomposition);

            elementsWithType.forEach(function(l) {
                var elem = l[0];
                var type = l[1];
                
                var m1 = makeMatrix(elem.ObjectPlacement, lengthUnit);
                var m1i = makeMatrix();
                invert(m1, m1i);
                
                v.createModel("Annotations");
                
                var s = scaleMatrix(Math.sqrt(modelExtent) / 100.);
                var z0 = makeVec4(0,0,0,1);
                var z1 = makeVec4(0,0,1,1);
                    
                visit(type, function(c) {
                    if (!c.ObjectPlacement) {
                        return;
                    }
                    
                    var m2 = makeMatrix(c.ObjectPlacement, lengthUnit);
                    m4m4_inplace(m2, s);
                    m4m4_inplace(m2, m1);
                                        
                    var symbol = null;
                    
                    if (c.type === "IfcDistributionPort") {
                        if (c.FlowDirection == "SINK") {
                            symbol = a.ArrowOut();
                        } else if (c.FlowDirection == "SOURCE") {
                            symbol = a.ArrowIn();
                        } else if (c.FlowDirection == "SOURCEANDSINK") {
                            symbol = a.ArrowInOut();
                        }
                    }
                    
                    if (symbol === null) {
                        symbol = a.Sphere();
                    }
                    
                    symbol.register(v);
                    symbol.render(v, c.guid, c.type, m2);
                });
            });
        }               
   
    };
    
    return AnnotationRenderer;
    
});