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

