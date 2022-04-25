function highlight(oid, selected) {
    // Clicking an explorer node fits the view to its object and selects
    if (selected.length) {
        bimSurfer.viewFit({
            ids: selected,
            animate: true
        });
    }
    bimSurfer.setSelection({
        ids:selected,
        clear:true,
        selected:true
    });
}        

require([
    "bimsurfer/src/MultiModal",
    "bimsurfer/lib/domReady!"
],
function (Viewer) {
    var modelName = window.location.hash;
    if (modelName.length < 1) {
        modelName = "Duplex_A_20110907_optimized";
    } else {
        modelName = modelName.substr(1);
    }
    modelName = "models/" + modelName;
    
    var v = window.viewer = new Viewer({
        domNode: 'viewerContainer',
        modelPath: modelName,
        withTreeVisibilityToggle: true,
        withTreeViewIcons: true
    });
    
    if (window.SPINNER_CLASS) {
        v.setSpinner({className: window.SPINNER_CLASS});
    } else if (window.SPINNER_URL) {
        v.setSpinner({url: window.SPINNER_URL});
    }
    v.load3d();
    v.loadMetadata('dataContainer');
    v.loadTreeView('treeContainer');
});