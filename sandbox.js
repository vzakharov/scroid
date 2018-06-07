const _ = require('lodash')

const {
    assign, filter, find, flatten, groupBy, keyBy,
    map, pick, orderBy, reject, remove, sumBy, minBy,
    uniqBy
} = _

const json2csv = require('json2csv')
const fs = require('fs')

main()

async function main() {

    const Scroid = require('./scroid')

    let scroid = new Scroid(require('./private/settings/credentials.json'))

    try {

        let projectName = 'User Account autoloc'
        let project = await scroid.getProject(projectName)
        // let documents = project.documents
        let documents = filter(project.documents, document => document.name.includes('319'))

        // // /* Replace newlines with tags */

        // // for (let document of project.documents) {
        // //     await scroid.convertDocumentNewlinesToTags(document)
        // // }

        // /* Load all yamls into one object and pretranslate a document with it*/
        // let path = 'C:/Users/asus/Documents/GitHub/translationProjects/Xsolla/Docs 1806/translations/'
        // let object = scroid.loadYmls(path)


        // let documentNames = []
        // for (let document of documents) {
        //     await scroid.pretranslateWith_(document, object, {
        //         contextFormat: 'yaml',
        //         parseFilenames: true,
        //         withLanguagePrefix: true,
        //         convertNewLinesToTags: true,
        //         confirm: true,
        //         editIfNonEmpty: true,
        //         documentNames
        //     })
        // }

        // /* Create jsons out of ymls */
        // scroid.createJsonsFromYmls('C:/Users/asus/Documents/GitHub/translationProjects/Xsolla/Docs 1806/en')

        // /* Rename yaml to yml */
        // scroid.renameYamlsToYmls('C:/Users/asus/Documents/GitHub/translationProjects/Xsolla/Docs 1806')

        // // /* Pretranslate with a js object */
        // let projectName = 'publisher-client alignment'
        // let documentName = 'en'
        // let project = await scroid.getProject(projectName)
        // let path = `./private/tmp/${projectName}/${documentName}`

        // for (let filename of fs.readdirSync(path)) {
        //     let json = require(`${path}/${filename}`)

        //     let targetLanguage = filename.match(/(.*)\.\w+$/)[1]
        //     let document = find(project.documents, {name: documentName, targetLanguage})

        //     scroid.pretranslateWith_(document, json, {contextFormat: 'json'})

        // }

        // /* Confirm all non-empty segments, OR copy all sources to target & confirm */

        // for (let document of documents) {
        //     // await scroid._copyAllSourceToTargetAndConfirm(document)
        //     await scroid.confirmNonEmptySegments_(document)
        // }
        
        // /* Fix all purely punctuation changes and confirm */

        // for (let document of documents) {
        //     await scroid._fixAndConfirmPunctuationChanges(document)
        // }


        // /* Join document segments with the same localization context */

        // let project = await scroid.getProject('Docs 1806')
        // await scroid.joinByContext_(project.documents, {onlyJoinIfNotAllConfirmed: true})


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

        // /* Export multilingual doc as a TSV file */
        // let filename = `${process.cwd()}/private/tmp/translation.tsv`
        // let projectName = 'Life is Feudal 1806'
        // let documentName = 'LiF 180605'
        // let project = await scroid.getProject(projectName)
        // // let documents = project.documents
        // let documents = filter(project.documents, 
        //     document => document.name.includes(documentName)
        // )
        // let document = documents[0]

        // let languageNames = {}
        // for (let document of documents) {
        //     languageNames[document.targetLanguageId] = document.targetLanguage
        // }

        // let segments = await scroid.getSegments_(document, {multilingual: true})

        // let data = []

        // for (let segment of segments) {
        //     let item = {}
        //     item[document.sourceLanguage] = segment.source.text

        //     for (let target of segment.targets) {
        //         let languageName = languageNames[target.languageId]
        //         item[languageName] = target.text
        //     }
        //     data.push(item)
        // }

        // let tsv = json2csv.parse(data, {delimiter: '\t'})

        // fs.writeFileSync(filename, tsv)


        // /* Assign myteam members */

        // let team = await scroid.getTeam({
        //     template: 'default',
        //     includeEmails: false
        // })

        // // documents = documents.slice(2)

        // let assignees = []

        // for (let document of documents) {
        //     let {targetLanguage} = document
        //     let assignee = find(team, {targetLanguage})
        //     let stage = 1
        //     // await scroid._assignUnconfirmed({document, stage, assignee})
        //     await scroid.assignDocument_({
        //         project, document, stage, 
        //         assignees: [assignee], assignmentMode: 'rocket'
        //     })
        //     assignees.push(assignee)
        // }

        // /* Email assignees */

        // let clientName = 'Xsolla'
        // let emails = await scroid._getEmails({project, documents, stage: 1}, {returnHash: false})
        // let documentNameForMixmax = 'login-319'
        // let sequenceName = `${projectName} — ${documentNameForMixmax}`
        // let wordCount = documents[0].wordsCount.toString()
        // let deadlineString = 'tomorrow (Friday), noon'
        // let variables = {
        //     projectName, projectId: project.id, clientName, wordCount, deadlineString, documentNameForMixmax
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