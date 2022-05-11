import * as Utils from './utils.js';

export default class AnnotationRenderer {
  constructor(args) {
    const v = args.viewer;
    const m = args.model;
    const a = args.assets;

    let aabb; let modelExtent; let use_xeogl;

    if (use_xeogl = !!v.scene.worldBoundary) {
      aabb = v.scene.worldBoundary.aabb;
      const max = aabb.subarray(3);
      const min = aabb.subarray(0, 3);
      const diag = xeogl.math.subVec3(max, min, xeogl.math.vec3());
      modelExtent = xeogl.math.lenVec3(diag);
    } else {
      aabb = new THREE.Box3();
      aabb.setFromObject(v.scene);
      modelExtent = aabb.getSize(new THREE.Vector3()).length();
    }

    var visit = function(n, fn) {
      fn(n);
      (n.children || []).forEach(function(c) {
        visit(c, fn);
      });
    };

    const traverse = function(types, p, n) {
      const li = [];
      var _ = function(p, n) {
        let t = n['xlink:href'];
        if (t) t = types[t.substr(1)];
        if (t) li.push([p, t]);
        (n.children || []).forEach(function(c) {
          _(n, c);
        });
      };
      _(p, n);
      return li;
    };

    const makeMatrix = use_xeogl ?
            function(s, lengthUnit) {
              if (arguments.length == 0) {
                return xeogl.math.mat4();
              }

              const m = xeogl.math.mat4(s.split(' '));
              m[12] *= lengthUnit;
              m[13] *= lengthUnit;
              m[14] *= lengthUnit;
              return m;
            } :
            function(s, lengthUnit) {
              const m = new THREE.Matrix4;
              if (arguments.length == 0) return m;

              const f = new Float32Array(s.split(' '));
              f[12] *= lengthUnit;
              f[13] *= lengthUnit;
              f[14] *= lengthUnit;
              m.set(...f);
              m.transpose();
              return m;
            };

    const invert = use_xeogl ? xeogl.math.inverseMat4 : function(m, n) {
      return m.getInverse(n);
    };

    const scaleMatrix = use_xeogl ? xeogl.math.scalingMat4s : function(v) {
      return makeMatrix().scale(new THREE.Vector3(v, v, v));
    };

    const makeVec4 = use_xeogl ? function() {
      return xeogl.math.vec4(arguments);
    } : function(x, y, z, w) {
      return new THREE.Vector4(x, y, z, w);
    };

    const m4v4 = use_xeogl ? xeogl.math.mulMat4v4 : function(m, v) {
      return v.clone().applyMatrix4(m);
    };

    const m4m4_inplace = use_xeogl ? function(m, n) {
      xeogl.math.mulMat4(m, n, m);
    } : function(m, n) {
      m.multiply(n);
    }; ;

    const logMatrix = function(n, m) {
      if (m.elements) {
        m = m.elements; ;
      }
      console.log(n, ...m);
    };

    this.render = function() {
      const typelist = Utils.FindNodeOfType(m, 'types')[0].children;
      const decomposition = Utils.FindNodeOfType(m, 'decomposition')[0];
      const units = Utils.FindNodeOfType(m, 'units')[0].children;

      const types = {};
      typelist.forEach(function(t) {
        types[t.guid] = t;
      });

      let lengthUnit = 1.;
      units.forEach(function(u) {
        if (u.UnitType === 'LENGTHUNIT') {
          lengthUnit = parseFloat(u.SI_equivalent);
        }
      });

      const elementsWithType = traverse(types, null, decomposition);

      elementsWithType.forEach(function(l) {
        const elem = l[0];
        const type = l[1];

        const m1 = makeMatrix(elem.ObjectPlacement, lengthUnit);
        const m1i = makeMatrix();
        invert(m1, m1i);

        v.createModel('Annotations');

        const s = scaleMatrix(Math.sqrt(modelExtent) / 100.);
        const z0 = makeVec4(0, 0, 0, 1);
        const z1 = makeVec4(0, 0, 1, 1);

        visit(type, function(c) {
          if (!c.ObjectPlacement) {
            return;
          }

          const m2 = makeMatrix(c.ObjectPlacement, lengthUnit);
          m4m4_inplace(m2, s);
          m4m4_inplace(m2, m1);

          let symbol = null;

          if (c.type === 'IfcDistributionPort') {
            if (c.FlowDirection == 'SINK') {
              symbol = a.ArrowOut();
            } else if (c.FlowDirection == 'SOURCE') {
              symbol = a.ArrowIn();
            } else if (c.FlowDirection == 'SOURCEANDSINK') {
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
    };
  }
}
