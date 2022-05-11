define(['../../../lib/xeogl'], function() {
  'use strict';

  xeogl.HighlightEffect = xeogl.Component.extend({

    type: 'xeogl.HighlightEffect',

    _init: function(cfg) {
      this._modes = this.create({
        type: 'xeogl.Modes',
        transparent: true,
        collidable: false, // Has no collision boundary of its own
      });

      this._stage = this.create({
        type: 'xeogl.Stage',
        priority: 2,
      });

      this._depthBuf = this.create({
        type: 'xeogl.DepthBuf',
        active: false,
      });

      this._emissiveColor = (cfg.color || [0.2, 0.9, 0.2]).slice(0, 3);
      this._opacity = cfg.color && cfg.color.length > 3 ? cfg.color[3] : 0.25;

      this._helpers = {};
      this._freeHelpers = [];
    },

    add: function(bimObject) {
      const entities = bimObject.entities;
      if (entities) {
        let entity;
        for (let i = 0, len = entities.length; i < len; i++) {
          entity = entities[i];
          this._createHelper(entity);
        }
      } else {
        this._createHelper(bimObject);
      }
    },

    _createHelper: function(entity) {
      let helper = this._freeHelpers.pop();
      if (!helper) {
        helper = this.create({
          type: 'xeogl.Entity',
          geometry: entity.geometry,
          transform: entity.transform,
          material: this.create({
            type: 'xeogl.PhongMaterial',
            emissive: this._emissiveColor,
            specular: [0, 0, 0],
            diffuse: [0, 0, 0],
            ambient: [0, 0, 0],
            opacity: this._opacity,
          }),
          modes: this._modes,
          stage: this._stage,
          depthBuf: this._depthBuf,
          visibility: this.create({
            type: 'xeogl.Visibility',
            visible: true,
          }),
          meta: {
            entityId: entity.id,
          },
        });
      } else {
        helper.geometry = entity.geometry;
        helper.material.diffuse = entity.material.diffuse;
        helper.material.ambient = entity.material.ambient;
        helper.transform = entity.transform;
        helper.visibility.visible = true;
        helper.meta.entityId = entity.id;
      }
      this._helpers[entity.id] = helper;
    },

    clear: function() {
      let helper;
      for (const id in this._helpers) {
        if (this._helpers.hasOwnProperty(id)) {
          helper = this._helpers[id];
          this._destroyHelper(helper);
        }
      }
    },

    remove: function(bimObject) {
      const entities = bimObject.entities;
      let entity;
      for (let i = 0, len = entities.length; i < len; i++) {
        entity = entities[i];
        const helper = this._helpers[entity.id];
        if (helper) {
          this._destroyHelper(helper);
        }
      }
    },

    _destroyHelper: function(helper) {
      helper.visibility.visible = false;
      this._freeHelpers.push(helper);
      delete this._helpers[helper.meta.entityId];
    },

  });
});
