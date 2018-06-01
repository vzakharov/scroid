const {
    filter, find, map
} = require('lodash')

module.exports = async function({project, documents, stage}) {

    let storedEmails = require('../../private/settings/emails.json')
    let emails = []
    let userIds = []

    for (let document of documents) {

        console.log(`Looking up assignees for ${document.name}...`)
        let {assignment} = await this._getAssignment(project, document)

        let stageAssignment = find(
            assignment.workflowStages, {id: stage.toString()}
        )

        let assignees = stageAssignment.documentStages[0].executives

        assignees.push(... 
            filter(stageAssignment.freelancerInvitations, {inAutoAssignment: true})
        )

        console.log(`\tFound: ${map(assignees, 'name').join(', ')}.`)

        for (let assignee of assignees) {

            let {userId} = assignee

            if (userIds.includes(userId)) continue
            userIds.push(userId)

            let {name} = assignee

            console.log(`\tLooking up email for ${name}...`)

            let email = storedEmails[name]

            if (!email) {
                let profile = (
                    await this._smartcat.get(`freelancers/profile/${userId}`)
                ).data
    
                email = profile.myTeamContacts.email || profile.ownContacts.email    
            }

            console.log(`\t\tDone: ${email}.`)

            emails.push(email)

        }


    }

    return emails

}