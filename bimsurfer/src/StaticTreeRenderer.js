import * as Request from './Request.js';
import EventHandler from './EventHandler.js';
import * as Utils from './Utils.js';

const SPATIAL_STRUCTURE_ELEMENTS = ['IfcProject', 'IfcSite', 'IfcBuilding', 'IfcBuildingStorey', 'IfcSpace'];

export const TOGGLE = 0;
export const SELECT = 1;
export const SELECT_EXCLUSIVE = 2;
export const DESELECT = 3;

export class StaticTreeRenderer extends EventHandler {
  constructor(args) {
    super(args);
    this.args = args;

    this.fromXml = false;
    this.domNodes = {};
    this.eyeNodes = {};
    this.selectionState = {};
    this.models = [];

    this.parentToChildMapping = {};
    this.childParentMapping = {};
    this.objectTypeMapping = {};
    this.roots = [];
  }

  getOffset(elem) {
    const reference = document.getElementById(this.args['domNode']);
    let y = 0;
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
  }

  collect(...qids) {
    const descendants = [];
    var inner = (id) => {
      descendants.push(id);
      (this.parentToChildMapping[id] || []).forEach(inner);
    };
    qids.forEach(inner);
    return descendants;
  }

  setSelected(ids, mode, fire) {
    if (mode == SELECT_EXCLUSIVE) {
      this.setSelected(this.getSelected(true), DESELECT, false);
    }

    let decomposingParent = null;
    const parentIds = new Set(ids.map((i) => this.childParentMapping[i]));
    if (parentIds.size === 1) {
      [decomposingParent] = parentIds;
      if (SPATIAL_STRUCTURE_ELEMENTS.indexOf(this.objectTypeMapping[decomposingParent]) !== -1) {
        decomposingParent = null;
      }
    }

    if (fire !== false) {
      if (decomposingParent) {
        this.fire('selection-context-changed', [{
          secondary: true,
          selected: true,
          ids: this.parentToChildMapping[decomposingParent].filter((v) => ids.indexOf(v) === -1),
        }]);
        this.fire('selection-context-changed', [{
          parent: true,
          selected: true,
          ids: [decomposingParent],
        }]);
      } else {
        this.fire('selection-context-changed', [{
          secondary: true,
          selected: true,
          clear: true,
          ids: [],
        }]);
        this.fire('selection-context-changed', [{
          parent: true,
          selected: true,
          clear: true,
          ids: [],
        }]);
      }
    }

    ids.forEach((id) => {
      let s = null;
      if (mode == TOGGLE) {
        s = this.selectionState[id] = !this.selectionState[id];
      } else if (mode == SELECT || mode == SELECT_EXCLUSIVE) {
        s = this.selectionState[id] = true;
      } else if (mode == DESELECT) {
        s = this.selectionState[id] = false;
      }

      if (s) {
        this.domNodes[id].label.classList.add('selected');
      } else {
        this.domNodes[id].label.classList.remove('selected');
      }
    });

    let desiredViewRange = this.getSelected().map((id) => {
      return this.getOffset(this.domNodes[id].label);
    });

    if (desiredViewRange.length) {
      desiredViewRange.sort();
      desiredViewRange = [desiredViewRange[0], desiredViewRange[desiredViewRange.length-1]];

      const domNode = document.getElementById(this.args['domNode']);
      const currentViewRange = [domNode.scrollTop, domNode.scrollTop + domNode.offsetHeight];

      if (!(desiredViewRange[0] >= currentViewRange[0] && desiredViewRange[1] <= currentViewRange[1])) {
        if ( (desiredViewRange[1] - desiredViewRange[0]) > (currentViewRange[1] - currentViewRange[0]) ) {
          domNode.scrollTop = desiredViewRange[0];
        } else {
          let l = parseInt((desiredViewRange[1] + desiredViewRange[0]) / 2. - (currentViewRange[1] - currentViewRange[0]) / 2., 10);
          l = Math.max(l, 0);
          l = Math.min(l, domNode.scrollHeight - domNode.offsetHeight);
          domNode.scrollTop = l;
        }
      }
    }

    if (fire) {
      this.fire('selection-changed', [{
        objects: this.getSelected(true),
        clear: true,
        selected: true,
      }]);
    }
  }

  reset(args) {
    if (args.visibility) {
      Object.values(this.eyeNodes).forEach((eye) => {
        eye.classList.remove('bimsurfer-tree-eye-off');
      });
    }
  }

  getSelected(b) {
    b = typeof(b) === 'undefined' ? true: !!b;
    const l = [];
    Object.keys(this.selectionState).forEach((k) => {
      if (!!this.selectionState[k] === b) {
        l.push(k);
      }
    });
    return l;
  }

  addModel(modelArgs) {
    this.models.push(modelArgs);
    if (modelArgs.src || modelArgs.json) {
      this.fromXml = true;
    }
  }

  qualifyInstance(modelId, id) {
    if (this.fromXml) {
      return id;
    } else {
      return modelId + ':' + id;
    }
  }

  destroy() {
    const node = document.getElementById(this.args.domNode);
    while (node.lastChild) {
      node.removeChild(node.lastChild);
    }
  }

  build() {
    const domNode = document.getElementById(this.args.domNode);

    let styleSheet = null;
    let styleSheet2 = null;
    let level = 0;
    let maxLevel = 0;
    let mergeMode = false;
    const itemsByLevelByName = {};
    const firstOrrenceOfDuplicateName = {};
    const duplicateNameIdsById = {};


    if (this.args.singleLevel) {
      const toggleSheet = () => {
        if (!styleSheet) {
          styleSheet = document.createElement('style');
          document.head.appendChild(styleSheet);
        }
        styleSheet.textContent = `
                .item { display: none; }
                .level-${level} { display: block; }
                `;
      };

      const toggleMergeMode = () => {
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
          merged.classList.toggle('checked');
        }
      };

      toggleSheet();
      mergeMode = true;
      toggleMergeMode();

      const controls = document.createElement('div');
      controls.className = 'controls';
      const levelup = document.createElement('div');
      const leveldown = document.createElement('div');
      var merged = document.createElement('div');
      domNode.appendChild(controls);
      controls.appendChild(levelup);
      controls.appendChild(leveldown);
      controls.appendChild(merged);

      const levelupsymbol = document.createElement('i');
      levelupsymbol.className = 'material-icons';
      levelupsymbol.innerHTML = 'arrow_back_ios_new';

      const leveldownsymbol = document.createElement('i');
      leveldownsymbol.className = 'material-icons';
      leveldownsymbol.innerHTML = 'arrow_forward_ios';

      const mergesymbol = document.createElement('i');
      mergesymbol.className = 'material-icons';
      mergesymbol.innerHTML = 'merge_type';

      levelup.appendChild(levelupsymbol);
      leveldown.appendChild(leveldownsymbol);
      merged.appendChild(mergesymbol);

      const switchLevel = (advance) => {
        return () => {
          level += advance;
          if (level < 0) {
            level = 0;
          }
          if (level > maxLevel) {
            level = maxLevel;
          }
          toggleSheet(level);
        };
      };

      levelup.onclick = switchLevel(-1);
      leveldown.onclick = switchLevel(+1);
      merged.onclick = toggleMergeMode;
    }

    var buildNode = (modelId, parentId, parent_d, d, n, level) => {
      if (level > maxLevel) {
        maxLevel = level;
      }

      const qid = this.qualifyInstance(modelId, this.fromXml ? n.guid : n.id);

      let duplicateNameWrapper;
      if (this.args.singleLevel) {
        duplicateNameWrapper = document.createElement('div');
        d.appendChild(duplicateNameWrapper);
        d = duplicateNameWrapper;
      }

      const label = document.createElement('div');
      const children = document.createElement('div');
      let eye;

      if (this.args.withVisibilityToggle) {
        eye = this.eyeNodes[qid] = document.createElement('i');
        eye.className = 'bimsurfer-tree-eye material-icons';
        label.appendChild(eye);
      }

      if (!parentId) {
        this.roots.push(qid);
      } else {
        (this.parentToChildMapping[parentId] = (this.parentToChildMapping[parentId] || [])).push(qid);
        this.childParentMapping[qid] = parentId;
      }

      const nm = n.label || n.name || n.guid;

      if (this.args.singleLevel) {
        const k = `l${level}-${nm}`;
        let li = itemsByLevelByName[k] = itemsByLevelByName[k] || [];
        if (li.length) {
          duplicateNameWrapper.classList.add('duplicate-name');
        } else {
          firstOrrenceOfDuplicateName[k] = qid;
        }
        li.push(d);

        const qid0 = firstOrrenceOfDuplicateName[k];
        li = duplicateNameIdsById[qid0] = duplicateNameIdsById[qid0] || [];
        li.push(qid);
      } else {
        label.className = 'bimsurfer-tree-label';
        const label_collapse = document.createElement('i');
        label_collapse.className = 'collapse material-icons';
        label.appendChild(label_collapse);
        if ((n.children || []).filter((x) => !x['xlink:href']).length) {
          if ((this.args.expandUntil || []).indexOf(n.type) !== -1) {
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

      const label_icon = document.createElement('i');
      label_icon.className = 'icon material-icons';
      label_icon.innerHTML = this.icons[n.type];
      label.appendChild(label_icon);

      label.appendChild(document.createTextNode(nm));

      this.objectTypeMapping[qid] = n.type;

      d.appendChild(label);
      if (!this.args.singleLevel) {
        children.className = 'bimsurfer-tree-children-with-indent';
        d.appendChild(children);
      }

      this.domNodes[qid] = {label: label, eye: eye};

      if (eye) {
        eye.onclick = (evt) => {
          evt.stopPropagation();
          evt.preventDefault();

          const visible = !eye.classList.toggle('bimsurfer-tree-eye-off');
          const descendants = this.collect(qid);
          const fn = visible ? DOMTokenList.prototype.remove : DOMTokenList.prototype.add;
          descendants.forEach((s) => {
            fn.call(this.domNodes[s].eye.classList, 'bimsurfer-tree-eye-off');
          });

          this.fire('visibility-changed', [{visible: visible, ids: descendants}]);

          return false;
        };
      }

      label.onclick = (evt) => {
        evt.stopPropagation();
        evt.preventDefault();

        const clear = this.args.app ? this.args.app.shouldClearSelection(evt) : !evt.shiftKey;

        const ids = mergeMode ? this.collect(...duplicateNameIdsById[qid]) : this.collect(qid);
        this.setSelected(ids, clear ? SELECT_EXCLUSIVE : TOGGLE, true);
        this.fire('click', [qid, this.getSelected(true)]);

        return false;
      };

      for (let i = 0; i < (n.children || []).length; ++i) {
        const child = n.children[i];
        if (this.fromXml) {
          if (child['xlink:href']) continue;
          // if (child.type === "IfcOpeningElement") continue;
        }

        const d2 = document.createElement('div');
        d2.className = 'item';
        d2.classList.add(`level-${level+1}`);
        (this.args.singleLevel ? parent_d : children).appendChild(d2);

        buildNode(modelId, qid, parent_d, d2, child, level+1);
      }
    };

    fetch('https://aecgeeks.github.io/ifc-icons/ifc-full-icons.json').then((r)=>r.json()).then((icons) => {
      this.icons = icons;

      this.models.forEach((m) => {
        const column1 = document.createElement('div');
        const row1cell = document.createElement('div');

        column1.className = 'bimsurfer-tree-column';
        row1cell.className = 'item';
        row1cell.classList.add(`level-0`);
        column1.appendChild(row1cell);
        column1.style.width = '100%';

        if (m.tree) {
          buildNode(m.id, null, column1, row1cell, m.tree, 0);
        } else if (m.src || m.json) {
          const loadModelFromSource = (src) => {
            Request.Make({url: src}).then((xml) => {
              const json = Utils.XmlToJson(xml, {'Name': 'name', 'id': 'guid'});
              loadModelFromJson(json);
            });
          };

          const loadModelFromJson = (json) => {
            const project = Utils.FindNodeOfType(json, 'decomposition')[0].children[0];
            buildNode(m.id, null, column1, row1cell, project, 0);
          };

          const fn = m.src ? loadModelFromSource : loadModelFromJson;
          fn(m.src ? m.src : m.json);
        }

        domNode.appendChild(column1);
      });

      for (const items of Object.values(itemsByLevelByName)) {
        if (items.length > 1) {
          const span = document.createElement('span');
          span.innerHTML = items.length;
          span.className = 'number-occurrences';
          items[0].children[0].appendChild(span);
        }
      }
    });
  }

  setVisibility(vizArgs) {
    (vizArgs.ids || []).forEach((id) => {
      let eye;
      if (eye = this.eyeNodes[id]) {
        if (vizArgs.visible) {
          eye.classList.remove('bimsurfer-tree-eye-off');
        } else {
          eye.classList.add('bimsurfer-tree-eye-off');
        }
      }
    });
  }
}
