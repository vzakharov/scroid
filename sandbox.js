const _ = require('lodash')

const {assign, filter, flatten, groupBy, map, orderBy, reject, remove, sumBy} = _

const json2csv = require('json2csv')
const readYaml = require('read-yaml')
const fs = require('fs')

async function main() {

    const Scroid = require('./scroid')

    let scroid = new Scroid(require('./private/settings/credentials.json'))

    try {


        // /* Confirm all non-empty segments in documents */
        // let project = await scroid.getProject('Login Widget')
        // let documents = filter(project.documents, document => document.name.includes('2018-06-01'))

        // for (let document of documents) {
        //     await scroid._confirmNonEmptySegments(document, {stage: 1})
        // }

        // /* Fix all purely punctuation changes and confirm */

        // for (let document of documents) {
        //     await scroid._fixAndConfirmPunctuationChanges(document)
        // }


        // /* Join document segments with the same localization context */

        // let project = await scroid.getProject('Publisher emails 1805')
        // await scroid._joinByContext(project.documents)


        /* Load payables, filter them, and create an invoice */
        // let payables = await scroid._getPayables()        
        // await scroid._createInvoice(payables)

        // // /* Complete all completable documents in a project */

        // let project = await scroid.getProject('onboarding-frontend')
        // await scroid._completeDocuments(project.documents)

        // await scroid.setProject('Merchant Backend 1805')
        // await scroid.setDocument('en', 'de')

        // /* Roll back all segments on the Editing stage */
        // scroid.filters = [{
        //     name: 'confirmation', isConfirmed: true, workflowStageNumber: 2
        // }]
        // await scroid._unconfirm()

        // console.log (await scroid._heatmap())

        // /* Assign myteam members to unconfirmed segments in a project, with certain document filters */
        // let project = await scroid.getProject('Launcher_desktop')
        // let documents = project.documents
        // // let documents = filter(project.documents, 
        // //     document => document.name.includes('translation-update-2018-06-01')
        // // )
        // let teams = readYaml.sync('./private/settings/teams.yml')
        // let names = teams.default
        // let wholeTeam = await scroid.getTeam()

        // let team = _.mapValues(names, name => {
        //     let member = _.find(wholeTeam, member => {
        //         let {firstName, lastName} = member
        //         let matches = (
        //             `${firstName} ${lastName}` == name ||
        //             `${lastName} ${firstName}` == name
        //         )
        //         return matches
        //     })
        //     assign(member, {name})
        //     return member
        // })

        // // documents = documents.slice(2)

        // for (let document of documents) {
        //     let {targetLanguage} = document
        //     let assignee = team[targetLanguage]
        //     let stage = 1
        //     // await scroid._assignUnconfirmed({document, stage, assignee})
        //     await scroid._assignDocument({
        //         project, document, stage, 
        //         assignees: [assignee], assignmentMode: 'rocket'
        //     })
        // }

        // /* Email assignees */
        // Todo: move all to a function
        let clientName = 'Xsolla'
        let projectName = 'Launcher_desktop'
        // Todo: calculate wordcount
        let wordCount = '40'
        let deadlineString = 'next Monday, 10 am'
        let project = await scroid.getProject(projectName)
        let documents = project.documents
        // let documents = filter(project.documents, document => document.name.includes('2018-06-01'))

        let emails = await scroid._getEmails({project, documents, stage: 1})

        // Todo: auto-define sequenceName
        let sequenceName = '180601 Launcher_desktop'
        let variables = {
            projectName, projectId: project.id, clientName, wordCount, deadlineString
        }

        await scroid.addRecipientsToSequence({sequenceName, emails, variables})

        /* Create detailed project status report */
        let projects = await scroid.getProjects()
        let projectNames = [
            'Login Widget',
            'publisher-client'
        ]
        projects = filter(projects, project => 
            project.name.includes('1806') ||
            projectNames.includes(project.name)
        )
        await scroid._writeReport({
            projects,
            path: 'C:/Users/asus/Documents/GitHub/translationProjects/Xsolla/Report 1806', 
            excludeCompleted: true
        })
    
    } catch(error) {
        throw(error)
    }

    return

}

main()