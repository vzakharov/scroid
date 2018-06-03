const _ = require('lodash')

const {
    assign, filter, find, flatten, groupBy, 
    map, orderBy, reject, remove, sumBy, minBy
} = _

const json2csv = require('json2csv')
const fs = require('fs')

async function main() {

    const Scroid = require('./scroid')

    let scroid = new Scroid(require('./private/settings/credentials.json'))

    try {


        /* Confirm all non-empty segments, OR copy all sources to target & confirm */
        let project = await scroid.getProject('Launcher_desktop')
        // let documents = project.documents
        let documents = filter(project.documents,  document =>
            //document => document.name.includes('06-01') &&
            minBy(document.workflowStages, 'progress').progress < 100
        )

        // for (let document of documents) {
        //     // await scroid._copyAllSourceToTargetAndConfirm(document)
        //     await scroid._confirmNonEmptySegments(document)
        // }
        
        for (let document of documents) {
            await scroid._confirmNonEmptySegments(document, {stage: 1})
        }

        /* Fix all purely punctuation changes and confirm */

        for (let document of documents) {
            await scroid._fixAndConfirmPunctuationChanges(document)
        }


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

        // /* Assign and email myteam members */

        // let projectName = 'Strings to 20 langs 1806'
        // let documentName = '180602'
        // let project = await scroid.getProject(projectName)
        // // let documents = project.documents
        // let documents = filter(project.documents, {name: documentName})
        // //     document => document.name.includes('180602')
        // // )

        // // let team = await scroid.getTeam({
        // //     template: 'default',
        // //     includeEmails: false
        // // })

        // // // documents = documents.slice(2)

        // // let assignees = []

        // // for (let document of documents) {
        // //     let {targetLanguage} = document
        // //     let assignee = find(team, {targetLanguage})
        // //     let stage = 1
        // //     // await scroid._assignUnconfirmed({document, stage, assignee})
        // //     await scroid._assignDocument({
        // //         project, document, stage, 
        // //         assignees: [assignee], assignmentMode: 'rocket'
        // //     })
        // //     assignees.push(assignee)
        // // }

        // // /* Email assignees */

        // let clientName = 'Xsolla'
        // let emails = await scroid._getEmails({project, documents, stage: 1}, {returnHash: false})
        // let sequenceName = `${projectName} — ${documentName}`
        // let wordCount = documents[0].wordsCount.toString()
        // let deadlineString = 'today (Sunday), noon'
        // let variables = {
        //     projectName, projectId: project.id, clientName, wordCount, deadlineString, documentName
        // }

        // await scroid.addRecipientsToSequence({sequenceName, emails, variables})


        // /* Send quick-translation emails to team members */

        // let team = await scroid.getTeam({includeEmails: true})

        // let sequence = await scroid.getSequence('Quick translation')

        // return

        // /* Create detailed project status report */
        // let projects = await scroid.getProjects()
        // let projectNames = [
        //     'Login Widget',
        //     'publisher-client'
        // ]
        // projects = filter(projects, project => 
        //     project.name.includes('1806') ||
        //     projectNames.includes(project.name)
        // )
        // await scroid._writeReport({
        //     projects,
        //     path: 'C:/Users/asus/Documents/GitHub/translationProjects/Xsolla/Report 1806', 
        //     excludeCompleted: true
        // })
    
    } catch(error) {
        throw(error)
    }

    return

}

main()