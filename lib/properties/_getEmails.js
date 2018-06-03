const {
    assign, filter, find, flatten, isArray, map, uniqBy, values
} = require('lodash')

module.exports = async function({project, documents, stage, assignees}, options = {}) {

    let {
        returnHash, modifyAssignees
    } = assign({
        returnHash: true,
        modifyAssignees: true
    }, options)

    let emails = returnHash ? {} : []
    let userIds = []

    if (!assignees) {

        assignees = []

        for (let document of documents) {

            console.log(`Looking up assignees for ${document.name} (${document.targetLanguage})...`)
            let {assignment} = await this._getAssignment(project, document)
    
            let stageAssignment = find(
                assignment.workflowStages, {id: stage.toString()}
            )
    
            let documentAssignees = flatten([
                stageAssignment.documentStages[0].executives,
                filter(stageAssignment.freelancerInvitations, {inAutoAssignment: true})
            ])

            console.log(`\tFound: ${map(documentAssignees, 'name').join(', ')}.`)

            assignees.push(... documentAssignees)
    
    
        }

        assignees = uniqBy(assignees, 'userId')

    }

    if (!isArray(assignees)) {
        assignees = values(assignees)
    }

    for (let assignee of assignees) {

        let {userId} = assignee

        if (userIds.includes(userId)) continue
        userIds.push(userId)

        let {name} = assignee

        console.log(`Looking up email for ${name}...`)

        let email = await this._getEmail({name, userId})

        console.log(`\tDone: ${email}.`)

        if (returnHash) {
            emails[name] = email
        } else {
            emails.push(email)
        }

        if (modifyAssignees) {
            assign(assignee, {email})
        }

    }

    return emails

}