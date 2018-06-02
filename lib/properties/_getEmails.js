const {
    assign, filter, find, isArray, map, uniqBy, values
} = require('lodash')

module.exports = async function({project, documents, stage, assignees}, {options}) {

    let {returnHash} = assign({
        returnHash: false
    }, options)

    let emails = returnHash ? {} : []
    let userIds = []

    if (!assignees) {

        assignees = []

        for (let document of documents) {

            console.log(`Looking up assignees for ${document.name}...`)
            let {assignment} = await this._getAssignment(project, document)
    
            let stageAssignment = find(
                assignment.workflowStages, {id: stage.toString()}
            )
    
            assignees.push(
                ... stageAssignment.documentStages[0].executives,
                ... filter(stageAssignment.freelancerInvitations, {inAutoAssignment: true})
            )
    
            console.log(`\tFound: ${map(assignees, 'name').join(', ')}.`)
    
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

        let email = this.getEmail({name, userId})

        console.log(`\tDone: ${email}.`)

        if (returnHash) {
            emails[name] = email
        } else {
            emails.push(email)
        }

    }

    return emails

}