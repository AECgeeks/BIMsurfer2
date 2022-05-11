import * as Request from './Request.js';
import EventHandler from './EventHandler.js';
import * as Utils from './Utils.js';

function identity(x) {
  return x;
}

class Row {
  constructor(args) {
    this.args = args;
    this.num_names = 0;
    this.num_values = 0;
  }

  setName(name) {
    if (this.num_names++ > 0) {
      this.args.name.appendChild(document.createTextNode(' '));
    }
    this.args.name.appendChild(document.createTextNode(name));
  }

  setValue(value) {
    if (this.num_values++ > 0) {
      this.args.value.appendChild(document.createTextNode(', '));
    }
    this.args.value.appendChild(document.createTextNode(value));
  }
}

class Section {
  constructor(args) {
    const div = self.div = document.createElement('div');
    this.nameh = document.createElement('h3');
    this.table = document.createElement('table');

    const tr = document.createElement('tr');
    this.table.appendChild(tr);
    const nameth = document.createElement('th');
    const valueth = document.createElement('th');
    nameth.appendChild(document.createTextNode('Name'));
    valueth.appendChild(document.createTextNode('Value'));
    tr.appendChild(nameth);
    tr.appendChild(valueth);

    div.appendChild(this.nameh);
    div.appendChild(this.table);

    args.domNode.appendChild(div);
  }

  setName(name) {
    this.nameh.appendChild(document.createTextNode(name));
  }

  addRow() {
    const tr = document.createElement('tr');
    this.table.appendChild(tr);
    const nametd = document.createElement('td');
    const valuetd = document.createElement('td');
    tr.appendChild(nametd);
    tr.appendChild(valuetd);
    return new Row({name: nametd, value: valuetd});
  }
};

function loadModelFromSource(src) {
  return Request.Make({url: src}).then(function(xml) {
    const json = Utils.XmlToJson(xml, {'Name': 'name', 'id': 'guid'});
    return loadModelFromJson(json);
  });
}

function loadModelFromJson(json) {
  return new Promise(function(resolve, reject) {
    const psets = Utils.FindNodeOfType(json, 'properties')[0];
    const project = Utils.FindNodeOfType(json, 'decomposition')[0].children[0];
    const types = Utils.FindNodeOfType(json, 'types')[0];

    const objects = {};
    const typeObjects = {};
    const properties = {};
    (psets.children || []).forEach(function(pset) {
      properties[pset.guid] = pset;
    });

    var visitObject = function(parent, node) {
      const props = [];
      const o = (parent && parent.ObjectPlacement) ? objects : typeObjects;

      if (node['xlink:href']) {
        if (!o[parent.guid]) {
          var p = Utils.Clone(parent);
          p.GlobalId = p.guid;
          o[p.guid] = p;
          o[p.guid].properties = [];
        }
        const g = node['xlink:href'].substr(1);
        var p = properties[g];
        if (p) {
          o[parent.guid].properties.push(p);
        } else if (typeObjects[g]) {
          // If not a pset, it is a type, so concatenate type props
          o[parent.guid].properties = o[parent.guid].properties.concat(typeObjects[g].properties);
        }
      }
      (node.children || []).forEach(function(n) {
        visitObject(node, n);
      });
    };

    visitObject(null, types);
    const numTypes = Object.keys(objects).length;
    visitObject(null, project);
    const numTotal = Object.keys(objects).length;
    const productCount = numTotal - numTypes;

    resolve({model: {objects: objects, productCount: productCount, source: 'XML'}});
  });
}

export default class MetaDataRenderer extends EventHandler {
  constructor(args) {
    super(args);

    this.models = {};
    this.domNode = document.getElementById(args['domNode']);

    this.selectedParent = null;
    this.selectedElement = null;
    this.selectedElements = [];
  }

  addModel(args) {
    return new Promise((resolve, reject) => {
      if (args.model) {
        this.models[args.id] = args.model;
        resolve(args.model);
      } else {
        const fn = args.src ? loadModelFromSource : loadModelFromJson;
        fn(args.src ? args.src : args.json).then((m) => {
          this.models[args.id] = m;
          resolve(m);
        });
      }
    });
  }

  renderAttributes(elem) {
    const s = new Section({domNode: this.domNode});
    s.setName(elem.type || elem.getType());
    ['GlobalId', 'Name', 'OverallWidth', 'OverallHeight', 'Tag', 'PredefinedType', 'FlowDirection'].forEach(function(k) {
      let v = elem[k];
      if (typeof(v) === 'undefined') {
        const fn = elem['get'+k];
        if (fn) {
          v = fn.apply(elem);
        }
      }
      if (typeof(v) !== 'undefined') {
        const r = s.addRow();
        r.setName(k);
        r.setValue(v);
      }
    });
    return s;
  }

  renderPSet(pset) {
    const s = new Section({domNode: this.domNode});
    if (pset.name && pset.children) {
      s.setName(pset.name);
      pset.children.forEach(function(v) {
        const r = s.addRow();
        r.setName(v.name);
        r.setValue(v.NominalValue);
      });
    } else {
      pset.getName(function(name) {
        s.setName(name);
      });
      pset.getHasProperties(function(prop) {
        const r = s.addRow();
        prop.getName(function(name) {
          r.setName(name);
        });
        prop.getNominalValue(function(value) {
          r.setValue(value._v);
        });
      });
    }
    return s;
  }

  queryPSet(resolve, pset, psetName, propName) {
    if (pset.name && pset.children) {
      // based on XML
      if (pset.name !== psetName) {
        return false;
      }
      return pset.children.map(function(v) {
        if (v.name !== propName) {
          return false;
        }
        resolve(v.NominalValue);
        return true;
      }).some(identity);
    } else {
      // based on BIMserver
      pset.getName(function(name) {
        if (name !== psetName) {
          return;
        }
        pset.getHasProperties(function(prop) {
          prop.getName(function(name) {
            if (name !== propName) {
              return;
            }
            prop.getNominalValue(function(value) {
              resolve(value._v);
            });
          });
        });
      });
    }
    return s;
  }

  query(oid, psetName, propName) {
    return new Promise((resolve, reject) => {
      oid = oid.split(':');
      if (oid.length == 1) {
        oid = [Object.keys(this.models)[0], oid];
      }
      const model = this.models[oid[0]].model || this.models[oid[0]].apiModel;
      const ob = model.objects[oid[1]];

      if (model.source === 'XML') {
        const containedInPset = ob.properties.map(function(pset) {
          return queryPSet(resolve, pset, psetName, propName);
        });
        console.log(containedInPset);
        if (!containedInPset.some(identity)) {
          reject();
        }
      } else {
        ob.getIsDefinedBy(function(isDefinedBy) {
          if (isDefinedBy.getType() == 'IfcRelDefinesByProperties') {
            isDefinedBy.getRelatingPropertyDefinition(function(pset) {
              if (pset.getType() == 'IfcPropertySet') {
                queryPSet(resolve, pset, propsetName, propName);
              }
            });
          }
        });
      }
    });
  }

  setSelectedParent(oid) {
    this.selectedParent = oid;
    this.processSelection();
  }

  setSelected(oid) {
    // @todo this should take into account the clear flag, to detect
    // multiple selection events from the 3d viewer, but it's not
    // available in this handler.

    if (oid.length === 1) {
      this.selectedElement = oid[0];
    } else {
      this.selectedElement = null;
    }
    this.processSelection();
  }

  processSelection() {
    this.selectedElements = [this.selectedParent, this.selectedElement].filter((x) => x);

    if (self.highlightMode) {
      (self.selectedSections || []).forEach(function(s) {
        s.div.className = '';
      });

      if (this.selectedElement) {
        self.sections[this.selectedElement].forEach(function(s) {
          s.div.className = 'selected';
        });

        self.selectedSections = self.sections[this.selectedElement];
      } else {
        self.selectedSections = [];
      }
    } else {
      this.domNode.innerHTML = '';

      this.selectedElements.forEach((oid) => {
        oid = oid.split(':');
        if (oid.length == 1) {
          oid = [Object.keys(this.models)[0], oid];
        }

        let idModel;

        for (let i =0; i<Object.keys(this.models).length; i++) {
          if ((this.models[i].model.objects[oid[1][0]] !== undefined == true)) {
            idModel = i;
            break;
          }
        }

        const model = this.models[idModel].model || this.models[idModel].apiModel;

        const ob = model.objects[oid[1]];

        this.renderAttributes(ob);

        if (model.source === 'XML') {
          ob.properties.forEach((pset) => {
            this.renderPSet(pset);
          });
        } else {
          ob.getIsDefinedBy((isDefinedBy) => {
            if (isDefinedBy.getType() == 'IfcRelDefinesByProperties') {
              isDefinedBy.getRelatingPropertyDefinition((pset) => {
                if (pset.getType() == 'IfcPropertySet') {
                  this.renderPSet(pset);
                }
              });
            }
          });
        }
      });
    }
  }

  renderAll() {
    self.highlightMode = true;
    self.sections = {};
    Object.keys(this.models).forEach((m) => {
      const model = this.models[m].model;
      if (model.source === 'XML') {
        Object.keys(model.objects).forEach((o) => {
          const ob = model.objects[o];
          console.log(ob);
          const li = self.sections[ob.guid] = [];
          if (ob.type !== 'IfcBuildingElementProxy') {
            li.push(this.renderAttributes(ob));
          }
          ob.properties.forEach((pset) => {
            li.push(this.renderPSet(pset));
          });
        });
      }
    });
  }

  destroy() {
    while (this.domNode.lastChild) {
      this.domNode.removeChild(this.domNode.lastChild);
    }
  }
}

