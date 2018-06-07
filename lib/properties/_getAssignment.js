module.exports = async function(project, document) {
    let assignmentId = (
        await this.__smartcat.post('WorkflowAssignments/Start', {
            documentIds: [document.documentId],
            projectId: project.id,
            targetLanguageId: document.targetLanguageId
        })
    ).data

    let assignment = (
        await this.__smartcat.get(`WorkflowAssignments/${assignmentId}`)
    ).data

    return {assignment, assignmentId}
}