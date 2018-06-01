const {
    find, map
} = require('lodash')

module.exports = async function(options) {

    let {document, project, stage, assignees, assignmentMode} = options
    let joinNames = (assignees) => map(assignees, 'name').join(', ')
    let executives = map(assignees, assignee => ({id: assignee.id, wordsCount: 0}))

    try {
        await this.smartcat.post('document/assign', {
            minWordsCountForExecutive: 0,
            assignmentMode,
            executives
        }, {params: {
            documentId: document.id,
            stageNumber: stage
        }})

        console.log(`Assignee(s) ${joinNames(assignees)} assigned to ${document.name} in ${assignmentMode} mode.`)
    } catch(error) {
        if (error.response.status != 500) throw(error)

        let {assignment, assignmentId} = this._getAssignment(project, document)

        let stageAssignment = find(
            assignment.workflowStages, {id: stage.toString()}
        )
        
        if (stageAssignment.documentStages[0].allSegmentsAssigned) {
            let assigneeNames = joinNames(stageAssignment.freelancerInvitations)
            console.log(`${assigneeNames} already assigned to ${document.name}, skipping.`)
            return
        }

        let data = {
            addedAssignedUserIds: map(assignees, 'id'),
            deadline: null,
            removedAssignedUserIds: [],
            removedInvitedUserIds: [],
            saveDeadline: true
        }

        await this._smartcat.post(`WorkflowAssignments/${assignmentId}/SaveAssignments`, 
            data, {params: {
                stageSelector: stage
            }})

        console.log(`${joinNames(assignees)} already invited to ${document.name}, now moved to assignees.`)
    }

}