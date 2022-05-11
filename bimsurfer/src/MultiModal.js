import BimSurfer from './BimSurfer.js';
import {StaticTreeRenderer, SELECT_EXCLUSIVE} from './StaticTreeRenderer.js';
import MetaDataRenderer from './MetaDataRenderer.js';
import * as Request from './Request.js';
import * as Utils from './Utils.js';
import AnnotationRenderer from './AnnotationRenderer.js';
import * as Assets from './Assets.js';
import EventHandler from './EventHandler.js';

function makePartial(fn, arg) {
  // higher order (essentially partial function call)
  return function(arg0, arg1) {
    fn(arg, arg0, arg1);
  };
}

export default class MultiModalViewer extends EventHandler {
  constructor(args) {
    super(args);

    this.liveShareEnabled = false;

    this.args = args;
    this.n_files = this.args.n_files || 1;

    let origin;
    try {
      origin = new URL(import.meta.url).origin;
    } catch (e) {
      origin = window.location.origin;
    }

    this.bimSurfer3d = new BimSurfer({
      domNode: this.args.domNode,
      engine: 'threejs',
      initiallyInvisible: this.args.viewerInitiallyInvisible,
      disableSelection: this.args.viewerInitiallyInvisible,
    });

    if (this.args.multiSelect === 'click') {
      this.shouldClearSelection = this.bimSurfer3d.shouldClearSelection = function() {
        return false;
      };
    } else {
      this.shouldClearSelection = this.bimSurfer3d.shouldClearSelection = function(evt) {
        return !evt.shiftKey;
      };
    }

    this.bimSurfer2d = null;

    if (this.args.modelId) {
      this.modelPath = `${origin}/m/${this.args.modelId}`;
    } else {
      this.modelPath = this.args.modelPath;
    }

    this.spinner = null;
    this.requestsInProgress = 0;
    this.loadXmlPromise = null;
  }

  mapFrom(view, objectIds) {
    let mapped;
    if (view.engine === 'svg') {
      mapped = objectIds.map((id) => {
        return id.replace(/product-/g, '');
      });
    } else if (view.engine === 'xeogl') {
      mapped = objectIds.map(function(id) {
        // So, there are several options here, id can either be a glTF identifier, in which case
        // the id is a rfc4122 guid, or an annotation in which case it is a compressed IFC guid.
        if (id.substr(0, 12) === 'Annotations:') {
          return id.substr(12);
        } else {
          return id.split('#')[1].replace(/product-/g, '');
        }
      });
    } else {
      mapped = objectIds;
    }
    return mapped;
  }

  mapTo(view, objectIds) {
    // we now just always map to base64 guids
    // if (view instanceof StaticTreeRenderer|| view instanceof MetaDataRenderer || view.engine === 'xeogl' || view.engine == 'threejs') {
    if (true) {
      const conditionallyCompress = (s) => {
        if (s.length > 22) {
          return Utils.CompressGuid(s);
        } else {
          return s;
        }
      };
      return objectIds.map(conditionallyCompress);
    } else {
      return objectIds;
    }
  }

  processSelectionEvent(source, args0, args1) {
    let objectIds;
    let propagate = true;
    if (source instanceof BimSurfer || source instanceof StaticTreeRenderer) {
      objectIds = this.mapFrom(source, args0.objects);
      if (source.engine === 'xeogl') {
        // Only when the user actually clicked the canvas we progate the event.
        propagate = !!args0.clickPosition || objectIds.length == 0;
      }
    } else if (source === 'user') {
      objectIds = this.mapFrom(source, args1);
    }

    if (propagate) {
      this.fire('selection-changed', [objectIds]);

      [this.bimSurfer3d, this.bimSurfer2d, this.treeView, this.metaDataView].forEach((view) => {
        if (view && view !== source) {
          if (view.setSelection) {
            if (!(view.viewer && view.viewer.error)) {
              view.setSelection({ids: this.mapTo(view, objectIds), clear: true, selected: true});
            }
          } else {
            view.setSelected(this.mapTo(view, objectIds), SELECT_EXCLUSIVE);
          }
        }
      });

      if (this.onSelectionChanged) {
        this.onSelectionChanged(objectIds);
      }

      if (this.liveShareEnabled) {
        fetch(`/live/${LIVE_SHARE_ID}`, {
          method: 'POST',
          body: JSON.stringify({'type': 'selection', 'data': objectIds}),
        });
      }
    }
  }

  incrementRequestsInProgress() {
    this.requestsInProgress++;
    if (this.spinner) {
      this.spinner.style.display = this.requestsInProgress ? 'block' : 'none';
    }
  }

  decrementRequestsInProgress() {
    this.requestsInProgress--;
    if (this.spinner) {
      this.spinner.style.display = this.requestsInProgress ? 'block' : 'none';
    }
  }

  loadXml() {
    if (this.loadXmlPromise) {
      return this.loadXmlPromise;
    }
    const promises = [];
    for (let i = 0; i < this.n_files; i++) {
      this.incrementRequestsInProgress();
      var postfix = this.args.n_files ? `_${i}` : '';

      promises.push(
          Request.Make({url: `${this.modelPath}${postfix}.tree.json`})
              .catch(
                  () => {
                    return Request.Make({url: `${this.modelPath}${postfix}.xml`}).then(function(xml) {
                      return Utils.XmlToJson(xml, {'Name': 'name', 'id': 'guid'});
                    });
                  },
              )
              .then((x) => {
                this.decrementRequestsInProgress(); return x;
              }),
      );
    }
    return this.loadXmlPromise = Promise.all(promises);
  }

  loadTreeView(domNode, part, baseId) {
    const tree = this.tree = new StaticTreeRenderer({
      domNode: domNode,
      withVisibilityToggle: this.args.withTreeVisibilityToggle,
      singleLevel: this.args.withThreeSingleLevel,
      expandUntil: this.args.treeExpandUntil,
      app: this,
    });

    let iconPromise;
    if (this.args.withTreeViewIcons) {
      iconPromise = fetch('https://aecgeeks.github.io/ifc-icons/ifc-full-icons.json').then((r)=>r.json());
    } else {
      iconPromise = new Promise((resolve, reject) => {
        resolve();
      });
    }
    iconPromise.then((potentaillyIcons) => {
      return this.loadXml().then((jsons) => {
        for (let i=0; i < this.n_files; i++) {
          tree.addModel({id: i, json: jsons[i]});
        }
        tree.icons = potentaillyIcons;
        tree.build();
        this.treeView = tree;
        tree.on('selection-changed', makePartial(this.processSelectionEvent.bind(this), tree));
        tree.on('visibility-changed', this.bimSurfer3d.setVisibility.bind(this.bimSurfer3d));
        tree.on('selection-context-changed', (args) => {
          if (args.secondary) {
            this.bimSurfer3d.setSelection(args);
          }
          if (args.parent && this.metaDataView) {
            this.metaDataView.setSelectedParent(args.ids[0]);
          }
        });
      });
    });
  }

  setSpinner(spinnerArgs) {
    if (spinnerArgs.url) {
      this.spinner = new Image();
      this.spinner.src= url;
      this.spinner.onload = () => {
        this.spinner.style = 'position: fixed; top: 50%; left: 50%; margin-top: -' + this.spinner.height / 2 + 'px; margin-left: -' + this.spinner.width / 2 + 'px';
        this.spinner.style.display = this.requestsInProgress ? 'block' : 'none';
        document.body.appendChild(this.spinner);
      };
    } else if (spinnerArgs.className) {
      this.spinner = document.createElement('div');
      this.spinner.className = spinnerArgs.className;
      document.body.appendChild(this.spinner);
    }
  }

  loadMetadata(domNode, part, baseId) {
    const data = new MetaDataRenderer({
      domNode: domNode,
    });

    this.loadXml().then((jsons) => {
      for (let i = 0; i < this.n_files; i++) {
        data.addModel({id: i, json: jsons[i]});
      }
      this.metaDataView = data;
    });
  }

  load2d() {
    // @todo 2d is currently a single image because with
    // IfcConvert --bounds we can no longer overlay them
    // due to the different scaling factors.

    bimSurfer2d = this.bimSurfer2d = new BimSurfer({
      domNode: this.args.svgDomNode,
      engine: 'svg',
    });

    if (this.args.multiSelect === 'click') {
      bimSurfer2d.shouldClearSelection = function() {
        return false;
      };
    }

    this.incrementRequestsInProgress();
    const P = bimSurfer2d.load({
      src: this.modelPath,
    }).then(this.decrementRequestsInProgress.bind(this));

    bimSurfer2d.on('selection-changed', makePartial(this.processSelectionEvent.bind(this), this.bimSurfer2d));

    return P;
  }

  destroy() {
    for (const v of [this.metaDataView, this.treeView, bimSurfer2d, this.bimSurfer3d]) {
      if (v) {
        v.destroy();
      }
    }
    this.metaDataView = this.treeView = bimSurfer2d = this.bimSurfer3d = null;
  }

  getSelection() {
    return this.bimSurfer3d.getSelection().map((id) => id.replace(/product-/g, '')).map(Utils.CompressGuid);
  }

  setSelection(selectionArgs) {
    this.processSelectionEvent('user', 'select', selectionArgs.ids);
  }

  load3d(part, baseId) {
    for (let i = 0; i < this.n_files; i++) {
      this.incrementRequestsInProgress();
      let src = this.modelPath + (part ? `/${part}`: (baseId || ''));
      if (this.args.n_files) {
        src += '_' + i;
      }
      var P = this.bimSurfer3d.load({src: src}).then(this.decrementRequestsInProgress.bind(this));
    }

    this.bimSurfer3d.on('selection-changed', makePartial(this.processSelectionEvent.bind(this), this.bimSurfer3d));

    return P;
  }

  performOnViewers(fn, withTree) {
    const viewers = [this.bimSurfer3d];
    if (this.bimSurfer2d) {
      viewers.push(this.bimSurfer2d);
    }
    if (withTree && this.tree) {
      viewers.push(this.tree);
    }
    viewers.forEach(fn);
  }

  setColor(colorArgs) {
    this.performOnViewers((v) => {
      if (colorArgs.ids && colorArgs.ids.length) {
        if (colorArgs.highlight) {
          if (v.viewer && v.viewer.getObjectIds) {
            v.setColor({ids: v.viewer.getObjectIds(), color: {a: 0.1}});
          }
        }
        v.setColor.apply(v, arguments);
      } else {
        v.reset({colors: true});
      }
    });
  }

  setVisibility(vizArgs) {
    this.performOnViewers((v) => {
      if (vizArgs.ids && vizArgs.ids.length) {
        v.setVisibility.apply(v, arguments);
      } else {
        v.reset({colors: true});
      }
    }, true);
  }

  listen = function(path) {
    const evtSource = new EventSource(path);
    evtSource.onmessage = function(e) {
      const msg = JSON.parse(e.data);
      if (msg.type == 'camera') {
        this.bimSurfer3d.setCamera(msg.data);
      } else if (msg.type == 'selection') {
        this.processSelectionEvent('user', null, msg.data);
      }
    };
  };

  toggleLiveShare() {
    let timer;
    let lastUpdate = 0;

    this.liveShareEnabled = !this.liveShareEnabled;

    const make_throttle = (delay, F) => {
      return function(...a) {
        if (!this.liveShareEnabled) {
          // @todo also disable event
          return;
        }
        const now = performance.now();
        if (now - lastUpdate < delay) {
          clearTimeout(timer);
        } else {
          lastUpdate = now;
        }
        timer = setTimeout(() => {
          F(...a);
        }, delay);
      };
    };

    this.bimSurfer3d.on('camera-changed', make_throttle(200, (cam) => {
      fetch(`/live/${LIVE_SHARE_ID}`, {
        method: 'POST',
        body: JSON.stringify({'type': 'camera', 'data': cam}),
      });
    }));

    return this.liveShareEnabled;
  }

  resize() {
    [this.bimSurfer3d, this.bimSurfer2d].forEach((surfer) => {
      if (surfer) {
        surfer.resize();
      }
    });
  }
}
