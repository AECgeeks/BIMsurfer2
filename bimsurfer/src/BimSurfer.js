import EventHandler from './EventHandler.js';
import SvgViewer from './SvgViewer.js';
import ThreeViewer from './ThreeViewer.js';

// Helper function to traverse over the mappings for individually loaded models
function _traverseMappings(mappings) {
  return function(k) {
    for (let i = 0; i < mappings.length; ++i) {
      const v = mappings[i][k];
      if (v) return v;
    }
    return null;
  };
}

export default class BimSurfer extends EventHandler {
  constructor(cfg) {
    super(cfg);

    this.cfg = cfg || {};

    this.engine = (this.cfg.engine || 'threejs').toLowerCase();
    const engine = {
      svg: SvgViewer,
      xeogl: window.XeoViewer,
      threejs: ThreeViewer,
    }[this.engine];

    this.viewer = new engine(Object.assign(this.cfg, {app: this}));

    /**
         * Fired whenever this BIMSurfer's camera changes.
         * @event camera-changed
         */
    this.viewer.on('camera-changed', (...args) => {
      this.fire('camera-changed', args);
    });

    /**
         * Fired whenever this BIMSurfer's selection changes.
         * @event selection-changed
         */
    this.viewer.on('selection-changed', (...args) => {
      this.fire('selection-changed', args);
    });

    // This are arrays as multiple models might be loaded or unloaded.
    this._idMapping = {
      'toGuid': [],
      'toId': [],
    };
  }

  /**
     * Loads a model into this BIMSurfer.
     * @param params
     */
  load(params) {
    if (params.test) {
      this.viewer.loadRandom(params);
      return null;
    } else if (params.bimserver) {
      return this._loadFromServer(params);
    } else if (params.api) {
      return this._loadFromAPI(params);
    } else if (params.src && ((window.XeoViewer && this.viewer instanceof XeoViewer) || this.viewer instanceof ThreeViewer)) {
      return this._loadFrom_glTF(params);
    } else if (params.src && this.viewer instanceof SvgViewer) {
      return this._loadFrom_SVG(params);
    }
  }

  _loadFromServer(params) {
    const notifier = new Notifier();
    const bimServerApi = new BimServerApi(params.bimserver, notifier);

    params.api = bimServerApi; // TODO: Make copy of params

    return this._initApi(params)
        .then(this._loginToServer)
        .then(this._getRevisionFromServer)
        .then(this._loadFromAPI);
  }

  _initApi(params) {
    return new Promise(function(resolve, reject) {
      params.api.init(function() {
        resolve(params);
      });
    });
  }

  _loginToServer(params) {
    return new Promise(function(resolve, reject) {
      if (params.token) {
        params.api.setToken(params.token, function() {
          resolve(params);
        }, reject);
      } else {
        params.api.login(params.username, params.password, function() {
          resolve(params);
        }, reject);
      }
    });
  }

  shouldClearSelection(evt) {
    return !evt.shiftKey;
  }

  _getRevisionFromServer(params) {
    return new Promise((resolve, reject) => {
      if (params.roid) {
        resolve(params);
      } else {
        params.api.call('ServiceInterface', 'getAllRelatedProjects', {poid: params.poid}, (data) => {
          let resolved = false;

          data.forEach((projectData) => {
            if (projectData.oid == params.poid) {
              params.roid = projectData.lastRevisionId;
              params.schema = projectData.schema;
              if (!this.models) {
                this.models = [];
              }
              this.models.push(projectData);
              resolved = true;
              resolve(params);
            }
          });

          if (!resolved) {
            reject(new Error(''));
          }
        }, reject);
      }
    });
  }

  _loadFrom_SVG(params) {
    if (params.src) {
      return this.viewer.load(params.src + '.svg');
    }
  }

  _loadFrom_glTF(params) {
    if (params.src) {
      let maxActiveProcessesEncountered = 0;
      let oldProgress = 0;
      return new Promise((resolve, reject) => {
        const m = this.viewer.loadglTF(params.src);

        if (window.XeoViewer && this.viewer instanceof XeoViewer) {
          m.on('loaded', () => {
            this.viewer.scene.canvas.spinner.on('processes', (n) => {
              if (n === 0) {
                this.viewer.viewFit({});
                resolve(m);
              }
              if (n > maxActiveProcessesEncountered) {
                maxActiveProcessesEncountered = n;
              }
              const progress = parseInt((maxActiveProcessesEncountered - n) * 100 / maxActiveProcessesEncountered);
              if (oldProgress != progress) {
                this.fire('progress', [progress]);
              }
              oldProgress = progress;
            });
          });
        } else {
          this.viewer.on('loaded', () => {
            resolve(this.viewer);

            if (this.cfg.initiallyInvisible) {
              this.viewer.setVisibility({ids: this.viewer.getObjectIds(), visible: false});
            }
          });
        }
      });
    }
  }

  _loadFromAPI(params) {
    return new Promise((resolve, reject) => {
      params.api.getModel(params.poid, params.roid, params.schema, false,
          (model) => {
            // TODO: Preload not necessary combined with the bruteforce tree
            let fired = false;

            model.query(PreloadQuery, () => {
              if (!fired) {
                fired = true;
                const vmodel = new Model(params.api, model);

                this._loadModel(vmodel);

                resolve(vmodel);
              }
            });
          });
    });
  }

  _loadModel(model) {
    model.getTree().then((tree) => {
      const oids = [];
      const oidToGuid = {};
      const guidToOid = {};

      var visit = function(n) {
        if (BIMSERVER_VERSION == '1.4') {
          oids.push(n.id);
        } else {
          oids[n.gid] = n.id;
        }
        oidToGuid[n.id] = n.guid;
        guidToOid[n.guid] = n.id;

        for (let i = 0; i < (n.children || []).length; ++i) {
          visit(n.children[i]);
        }
      };

      visit(tree);

      this._idMapping.toGuid.push(oidToGuid);
      this._idMapping.toId.push(guidToOid);

      const models = {};

      // TODO: Ugh. Undecorate some of the newly created classes
      models[model.model.roid] = model.model;

      // Notify this.viewer that things are loading, so this.viewer can
      // reduce rendering speed and show a spinner.
      this.viewer.taskStarted();

      this.viewer.createModel(model.model.roid);

      const loader = new GeometryLoader(model.api, models, this.viewer);

      loader.addProgressListener((progress, nrObjectsRead, totalNrObjects) => {
        if (progress == 'start') {
          console.log('Started loading geometries');
          this.fire('loading-started');
        } else if (progress == 'done') {
          console.log('Finished loading geometries (' + totalNrObjects + ' objects received)');
          this.fire('loading-finished');
          this.viewer.taskFinished();
        }
      });

      loader.setLoadOids([model.model.roid], oids);

      // this.viewer.clear(); // For now, until we support multiple models through the API

      this.viewer.on('tick', function() { // TODO: Fire "tick" event from XeoViewer
        loader.process();
      });

      loader.start();
    });
  }

  /**
     * Returns a list of object ids (oid) for the list of guids (GlobalId)
     *
     * @param guids List of globally unique identifiers from the IFC model
     */
  toId(guids) {
    return guids.map(_traverseMappings(this._idMapping.toId));
  }

  /**
     * Returns a list of guids (GlobalId) for the list of object ids (oid)
     *
     * @param ids List of internal object ids from the BIMserver / glTF file
     */
  toGuid(ids) {
    return ids.map(_traverseMappings(this._idMapping.toGuid));
  }

  /**
     * Shows/hides objects specified by id or entity type, e.g IfcWall.
     *
     * When recursive is set to true, hides children (aggregates, spatial structures etc) or
     * subtypes (IfcWallStandardCase ⊆ IfcWall).
     *
     * @param params
     */
  setVisibility(params) {
    this.viewer.setVisibility(params);
  }

  /**
     * Selects/deselects objects specified by id.
     **
     * @param params
     */
  setSelection(params) {
    if (this.cfg.initiallyInvisible) {
      return this.viewer.setVisibility(Object.assign({}, params, {visible: params.selected}));
    } else {
      return this.viewer.setSelection(params);
    }
  }

  /**
     * Gets a list of selected elements.
     */
  getSelection() {
    return this.viewer.getSelection();
  }

  /**
     * Sets color of objects specified by ids or entity type, e.g IfcWall.
     **
     * @param params
     */
  setColor(params) {
    this.viewer.setColor(params);
  }

  /**
     * Sets opacity of objects specified by ids or entity type, e.g IfcWall.
     **
     * @param params
     */
  setOpacity(params) {
    this.viewer.setOpacity(params);
  }

  /**
     * Fits the elements into view.
     *
     * Fits the entire model into view if ids is an empty array, null or undefined.
     * Animate allows to specify a transition period in milliseconds in which the view is altered.
     *
     * @param params
     */
  viewFit(params) {
    this.viewer.viewFit(params);
  }

  /**
     *
     */
  getCamera() {
    return this.viewer.getCamera();
  }

  /**
     *
     * @param params
     */
  setCamera(params) {
    this.viewer.setCamera(params);
  }

  /**
     * Redefines light sources.
     *
     * @param params Array of lights {type: "ambient"|"dir"|"point", params: {[...]}}
     * See http://xeoengine.org/docs/classes/Lights.html for possible params for each light type
     */
  setLights(params) {
    this.viewer.setLights(params);
  }


  /**
     * Returns light sources.
     *
     * @return Array of lights {type: "ambient"|"dir"|"point", params: {[...]}}
     */
  getLights() {
    return this.viewer.getLights;
  }

  /**
     *
     * @param params
     */
  reset(params) {
    this.viewer.reset(params);
  }

  /**
      * Returns a list of loaded IFC entity types in the model.
      *
      * @method getTypes
      * @return {Array} List of loaded IFC entity types, with visibility flag
      */
  getTypes() {
    return this.viewer.getTypes();
  }

  /**
     * Sets the default behaviour of mouse and touch drag input
     *
     * @method setDefaultDragAction
     * @param {String} action ("pan" | "orbit")
     */
  setDefaultDragAction(action) {
    this.viewer.setDefaultDragAction(action);
  }

  /**
     * Returns the world boundary of an object
     *
     * @method getWorldBoundary
     * @param {String} objectId id of object
     * @param {Object} result Existing boundary object
     * @return {Object} World boundary of object, containing {obb, aabb, center, sphere} properties. See xeogl.Boundary3D
     */
  getWorldBoundary(objectId, result) {
    return this.viewer.getWorldBoundary(objectId, result);
  }

  /**
     * Destroys the BIMSurfer
     */
  destroy() {
    this.viewer.destroy();
  }

  resize() {
    this.viewer.resize();
  }
}
