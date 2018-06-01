module.exports = function({confirmed, stage, changed}) {
    let filters = []
    
    if (confirmed != undefined) {
        filters.push({name: 'confirmation', isConfirmed: confirmed, workflowStageNumber: stage})
    }

    if (changed) {
        filters.push({
            name: 'revisions', 
            includeAutoRevisions: false, 
            revisionAccountUserId: [],
            revisionStageNumber: null
        })
    }
    
    return filters
}