import MultiModal from '../bimsurfer/src/MultiModal.js';

let processed = false;

document.addEventListener('DOMContentLoaded', () => {
  if (processed) {
    // For some reason the event fires twice with es-module-shims on chrome
    return;
  }
  processed = true;

  var modelName = window.location.hash;
  if (modelName.length < 1) {
    modelName = 'Duplex_A_20110907_optimized';
  } else {
    modelName = modelName.substr(1);
  }
  modelName = 'models/' + modelName;

  var v = window.viewer = new MultiModal({
    domNode: 'viewerContainer',
    modelPath: modelName,
    withTreeVisibilityToggle: true,
    withTreeViewIcons: true,
  });

  v.load3d();
  v.loadMetadata('dataContainer');
  v.loadTreeView('treeContainer');
});

window.onkeypress = (evt) => {
  if (evt.key === 'h') {
    viewer.setVisibility({ids: viewer.getSelection(), visible: false});
  } else if (evt.key === 'H') {
    viewer.setVisibility({reset: true});
  } else if (evt.key === 'x') {
    const ids = viewer.getSelection();
    viewer.reset({selection: true});
    viewer.setColor({ids: ids, color: {r: 0., g: 1., b: 1.}, highlight: true});
  } else if (evt.key === 'X') {
    viewer.reset({colors: true});
  }
};

window.onresize = (evt) => {
  viewer.resize();
};
