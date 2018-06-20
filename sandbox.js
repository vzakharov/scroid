const _ = require('lodash')
const {
    assign, filter, find, flatten, groupBy, keyBy, last, min, maxBy, minBy, map, mapKeys,
    pick, pull, pullAt, orderBy, reject, remove, reverse, round,
    sumBy, uniqBy
} = _

const Diff = require('diff')
const vz = require('vz-utils')
const {
    deepFor, iterate, loadYamls, loadYamlsAsArray, getDiff, setDeep
} = vz

const json2csv = require('json2csv')
const csv2json = require('csvtojson')
const fs = require('fs')
const readYaml = require('read-yaml')
const writeYaml = require('write-yaml')

const l10n = require('l10n-vz')
const {
    createTableFromHashFiles
} = l10n

const {stringify} = JSON

const delimiter = '\t'

main()

async function main() {

    const Scroid = require('./scroid')


    try {

        let username = 'vzakharov@gmail.com'

        let folder = {
            downloads: 'C:/users/asus/downloads/',
            xsolla: 'C:/Users/asus/Documents/GitHub/Xsolla/',
            weebly: 'C:/Users/asus/Documents/GitHub/weebly/',
            settings: './private/settings/',
            tmp: './private/tmp/'
        }

        let scroid = new Scroid(username)

        let smartcatAccountName = 'weebly'

        scroid.setSmartcatAccount(smartcatAccountName)

        let projectNames = scroid.load('projects')[smartcatAccountName]
        let options = {
            projectFilter: project => projectNames.includes(project.name)
            // projectFilter: {name: 'weebly-customer-accounts-integration'}
        }

        // await go().createProject()
        // await go().assignProject({stage: 1})
        let uncompletedJobs = await go().getUncompletedJobs()
        go().writeTsv({uncompletedJobs})

        return

        function go() { return {


            async createProject() {

                let project = await scroid.createProject(folder.downloads + 'PA_strings_translations.json', {
                    sourceLanguage: 'en',
                    targetLanguages: 'de zh-Hans ko ja ru'.split(' '),
                    workflowStages: ['translation'],
                    translationMemoryName: 'PA 1806',
                    deadline: '2018-06-20T12:00:00.000Z',
                    //name: 'PA 1806',
                    includeDate: true
                })
    
            },

            async assignProject({stage}) {
                let teamTemplate = scroid.load('teamTemplates').default
                let assigneesByLanguage = await scroid.getTeam(teamTemplate, {includeEmails: true})
                scroid.iterateDocuments(options, async ({project, document}) => {
                    let {targetLanguage} = document
                    let assignees = assigneesByLanguage[targetLanguage]
                    // await scroid._assignUnconfirmed({document, stage, assignee})
                    await scroid.assignDocument_({
                        project, document, stage, 
                        assignees, assignmentMode: 'rocket'
                    })
                })
            },
            
            async emailAssignees() {

                let clientName = 'Xsolla'
                let emails = await scroid._getEmails({project, documents, stage: 1}, {returnHash: false})
                let documentNameForMixmax = 'login-319'
                let sequenceName = `Introducing Chau`
                let wordCount = documents[0].wordsCount.toString()
                let deadlineString = 'tomorrow (Friday), noon'
                let variables = {
                    projectName, projectId: project.id, clientName, wordCount, deadlineString, documentNameForMixmax
                }
        
                await scroid.addRecipientsToSequence({sequenceName, emails, variables})
                        
            },

            async completeFinishedDocuments() {

                assign(options, {
                    documentFilter: document => document.workflowStages[0].progress == 100 && document.status != 'completed'
                })

                scroid.iterateDocuments(options, async ({document}) => {

                    await scroid._smartcat.documents(document.documentId).targets(document.targetLanguageId).complete()

                })

            },

            async convertCsvsToJsons() {
                let path = 'C:/Users/asus/Documents/GitHub/translationProjects/Xsolla/Names correction 1806/'
                await l10n.csvToJsons(path, ['ko', 'zh-Hans'])
                return
            },

            async convertJsonOrYamlToTsv() {
                let path = 'C:/Users/asus/Documents/GitHub/translationProjects/Xsolla/Names correction 1806/'
                let outFilename = path + 'table.tsv'
    
                let data = createTableFromHashFiles(path + 'in', {
                    keysToRemoveIfAtLeastOneEmpty: 'en',
                    format: 'json'
                })
                let tsv = json2csv.parse(data, {delimiter: '\t'})
                fs.writeFileSync(outFilename, tsv)    
            },

            async getComments() {

                assign(options, {
                    multilingual: true,
                    segmentFilter: {hasComments: true}
                })

                let allComments = []

                await scroid.iterateSegments(options, async ({project, document, segment}) => {

                    let {topicId} = segment

                    let {items} = await scroid._smartcat.topics(topicId).comments({
                        documentId: document.id,
                        topicType: 'SEGMENT',
                        start: 0, limit: 100
                    })

                    let segmentComments = map(
                        filter(items, comment => comment.userId), 
                        comment => `${comment.userName}: ${comment.removeType == null ? comment.text : "[comment deleted]"}`
                    ).join('\n\n')

                    let hyperlink = (text, link) => `=HYPERLINK("${link}", "${text}")`
                    allComments.push({
                        project: scroid.googleSheetLink({project}),
                        document: scroid.googleSheetLink({document}),
                        segmentNumber: segment.number,
                        key: segment.localizationContext.join('\n'),
                        sourceText: segment.source.text,
                        comments: segmentComments
                    })

                })
                
                let tsv = json2csv.parse(allComments, {delimiter})
                fs.writeFileSync(folder.weebly + 'comments.tsv', tsv)

            },

            async getUncompletedJobs() {

                let uncompletedJobs = []

                assign(options, {
                    stageFilter: stage => stage.progress < 100
                })

                await scroid.iterateAssignees(options, async ({assignee, project, document}) => {
                    let {targetLanguage, targetLanguageId} = document

                    uncompletedJobs.push({
                        email: await scroid.getEmail({userId: assignee.id}),
                        targetLanguage,
                        project: project.name,
                        document: document.name,
                        documentUrl: scroid.link({document, targetLanguageId}).url,
                        assignedWords: assignee.assignedWordsCount,
                        pendingWords: round((100 - assignee.progress) * assignee.assignedWordsCount / 100),
                        progress: assignee.progress
                    })

                    let job = last(uncompletedJobs)
                    job.infoLine = `${job.document} (${job.documentUrl}): ${job.pendingWords} words`
                })

                return uncompletedJobs

            },

            async propagateCsvChangesToYaml() {
                let encoding = 'utf8'
                let before = keyBy(await csv2json().fromFile(path + 'before.csv'), 'key')
                let after = keyBy(await csv2json().fromFile(path + 'after.csv'), 'key')
    
                let changes = {}
    
    
                for (let key in before) {
                    for (let language in before[key]) {
                        if (before[key][language] == after[key][language]) continue
                        if (!changes[language]) changes[language] = {}
    
                        let change = changes[language][key] = {
                            before: before[key][language],
                            after: after[key][language]
                        }
    
                        let linesBefore = change.before.split(/\r?\n/)
                        let linesAfter = change.after.split(/\r?\n/)
                        change.diffs = []
                        for (let i = 0; i < min([linesBefore.length, linesAfter.length]); i++) {
                            change.diffs[i] = getDiff(linesBefore[i], linesAfter[i])
                        }
                    }
                }
    
                let object = loadYamls(path + 'translations')
    
                for (let filename in object) {
                    let language = filename.match(/(?<=^).*?(?=\.)/)[0]
                    let filePath = [path, 'translations', language, filename + '.yaml'].join('/')
    
                    deepFor(object[filename], (value, nestedKeys, keyPath) => {
                        let languageChanges = changes[language]
                        let change = languageChanges[keyPath]
                        if (change) {
                            let lines = fs
                                .readFileSync(
                                    filePath, 
                                    {encoding: 'utf-8'}
                                )
                                .split(/\r?\n/)
                            let keyDepth, matchFound
    
                            let resetCounters = () => {
                                matchFound = false
                                keyDepth = 0
                            }
    
                            resetCounters()
    
                            lineLoop:
                            for (let i = 0; i < lines.length; i++) {
    
                                // A match was found but didn’t work
                                if (matchFound) {
                                    resetCounters()
                                }
    
                                let line = lines[i]
    
                                let setLine = (k) => {
                                    i = k
                                    line = lines[k]
                                }
    
                                let key = nestedKeys[keyDepth]
    
                                if (!matchFound) {
                                    let match = line.match(new RegExp(`^ *${key}: *`))
                                    if (match) {
                                        keyDepth++
                                        if (keyDepth != nestedKeys.length) continue
                                        matchFound = true
                                    } else {
                                        continue lineLoop
                                    }
                                }
    
                                if (matchFound) {
    
                                    let edited, missed
                                    let {diffs} = change
    
                                    diffLoop:
                                    for (let j = 0; j < diffs.length; j++) {
                                        let diff = diffs[j]
    
                                        let {array} = diff
                                        if (array.length == 1) {
                                            continue
                                        }
    
                                        let match
    
                                        do {
                                            match = line.match(/(^ *(?:([^ ]+): *)?).*?([>|]-)?$/)
    
                                            if (match[2] && match[2] != key) {
                                                continue lineLoop
                                            }
            
                                            if (match[3]) {
                                                setLine(i + 1)
                                            }
    
                                        } while(match[3])
    
                                        let replaceWhat = match[1]
    
                                        pieceLoop:
                                        for (let piece of array) {
                                            if (!piece.changed) {
                                                replaceWhat += piece.value
                                            } else {
                                                let newLine
                                                if (piece.added) {
                                                    newLine = line.replace(replaceWhat, replaceWhat + piece.value)
                                                    replaceWhat += piece.value
                                                } else if (piece.removed) {
                                                    newLine = line.replace(replaceWhat + piece.value, replaceWhat)
                                                }
    
                                                if (newLine == line) {
                                                    j--
                                                    setLine(i + 1)
                                                    continue diffLoop
                                                } else {
                                                    line = newLine
                                                    edited = true
                                                }
                                            }
                                        }
                                        
                                        if (edited) {
                                            lines[i] = line
                                            delete languageChanges[keyPath]
                                            fs.writeFileSync(filePath, lines.join('\n'))
                                            if (j < diffs.length - 1) {
                                                setLine(i + 1)
                                            }
                                        }
            
                                    }
    
                                    return
                                }
                            }
                        }
                    })
                }
    
    
                let check = beforeOrAfter => {
                    let out = {}
                    for (let language in changes) {
                        out[language] = {}
                        for (let key in changes[language]) {
                            out[language][key] = changes[language][key][beforeOrAfter]
                        }
                    }
                    return out
                }
    
                writeYaml.sync(path + 'remaining.yaml', check('before'))
                writeYaml.sync(path + 'remaining.yaml', check('after'))
    
                // for (let lang in changes) {
                //     let langChanges = changes[lang]
    
                //     for (let key in langChanges) {
                //         let stops = key.split('/')
    
                //         let filename = find()
                //     }
    
                // }
    
                return changes
            },

            async writeTsv(data, path = folder.tmp) {

                for (let key in data) {
                    let filename = `${path}${key}.tsv`
                    let tsv = json2csv.parse(data[key], {delimiter})
                    fs.writeFileSync(filename, tsv)
                }

            }

        }}


            // /* Load translations into one object and pretranslate a document with it*/

            // let path = folders.xsolla + 'PA 1806/translations/'
            // let data = createTableFromHashFiles(path, {
            //     keysToRemoveIfAtLeastOneEmpty: 'en',
            //     format: 'json'
            // })
            // let object = mapKeys(data, 'key')

            // await scroid.iterateDocuments({projectFilter: {name: 'PA 1806'}, multilingual: true}, async ({document}) => {
            //     await scroid.pretranslateWith_(document, object, {
            //         contextFormat: 'json',
            //         parseFilenames: false,
            //         convertNewLinesToTags: true,
            //         confirm: false,
            //         editIfNonEmpty: false
            //     })
            // })

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