const _ = require('lodash')
const {
    assign, capitalize, clone, filter, find, first, flatten, groupBy, keyBy, last, 
    min, maxBy, minBy, map, mapKeys, pick, pull, pullAt, orderBy, 
    reject, remove, reverse, round, sumBy, uniqBy, values
} = _

const Diff = require('diff')
const vz = require('vz-utils')
const {
    deepFor, iterate, loadYamls, loadYamlsAsArray, getDiff, setDeep, renameRecursively
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
            settings: 'C:/Users/asus/Documents/GitHub/scroid/private/settings/',
            tmp: 'C:/Users/asus/Documents/GitHub/scroid/private/tmp/'
        }

        let scroid = new Scroid(username)

        let smartcatAccountName = 'Xsolla'

        scroid.setAccount(smartcatAccountName)

        let projectNames = 
            // [
            //     'trumpet-gdprcontactsmodal', 
            //     'trumpet-prom1557networkerror', 
            //     'trumpet-springboardpopupdash'
            // ]
            scroid.load('projectNames')
        let filters = {
            projectFilter: 
                {name: 'Developer Docs Manual'}
            // project =>
                //     projectNames.includes(project.name),
                    // project.creationDate.match(/2018-06/),
            // , documentFilter: 
            //     document => 
            //         document.name.match(/_en/)
                    // document.targetLanguage.match(/ru/)
            //         last(document.workflowStages).progress < 100
            // document => !document.targetLanguage.match(/ru|en-US/) && document.name.match(/1076/),
            //  {
            //     let stage = last(document.workflowStages)
                // return stage.progress < 100
            // },
            , stageNumber: 1
            // multilingual: true
        }

        // let documents = await scroid.select.targets(filters)

        // return items

        // let project = await go().createProject()
        await go().pretranslateWithAnObject()
        // await scroid.assignFreelancers(filters, {mode: 'pinned', teamName: 'default'})
        // await go().assignUnique(filters, 'proofreaders')
        // await go().editProjects(filters, {
        //     // deadline: '2018-07-19T14:00:00.000Z',
        //     // tmName: 'General',
        //     // glossaryName: 'General',
        //     // mtEngineSettings: [],
        //     markupPlaceholders: true
        // })
        // let pendingJobs = await go().getPendingJobs()
        // scroid.save({pendingJobs})

        // await go().assignIdenticalSegments()

        // await go().joinByContext()

        // await go().completeFinishedDocuments()

        // await go().getComments()

        // await go().writeSegmentTranslations()

        // await go().addPayables()

        function go() { return {


            async addPayables() {

                let payables = await csv2json().fromFile(folder.downloads + 'hourlies - pending.csv')
                remove(payables, {added: 'TRUE'})

                for (let payable of payables) {

                    let {
                        calcDate, currency, freelancerCatUserId, jobDescription, pricePerUnit, unitsAmount
                    } = payable

                    calcDate = new Date(Date.parse(calcDate)).toISOString()

                    let response = await scroid._marketplace.post('import/job', {
                        calcDate, currency, freelancerCatUserId, jobDescription, pricePerUnit, unitsAmount,
                        addToMyTeam: true, isForceImport: false, jobExternalId: '', serviceType: 'Misc',
                        unitsType: 'hour', viaFreelancersLink: false
                    })

                    console.log(response)
                }

                return payables

            },

            async createProject() {

                let project = await scroid.createProject(folder.downloads + 'recipe_social_friends.yml', {
                    sourceLanguage: 'en',
                    targetLanguages: 'de zh-Hans ko ja ru'.split(' '),
                    workflowStages: ['translation'],
                    translationMemoryName: 'Guides from EN',
                    deadline: '2018-07-13T17:00:00.000Z',
                    includeDate: true
                    // name: 'PA 180626'
                })
    
                return project

            },

            async assignDocuments({stage}) {
                let teamTemplate = scroid.load('teamTemplates').default
                let assigneesByLanguage = await scroid.getTeam(teamTemplate, {includeEmails: true})

                scroid.iterateDocuments(filters, async ({project, document}) => {
                    let {targetLanguage} = document
                    let assignees = assigneesByLanguage[targetLanguage]
                    // await scroid._assignUnconfirmed({document, stage, assignee})
                    await scroid.assignDocument({
                        project, document, stage, 
                        assignees, assignmentMode: 'rocket'
                    })
                })
                
            },

            async assignUnique(filters, team) {

                let {stageNumber} = filters
                let teamTemplate = scroid.load('teams')[team]
                assigneesByLanguage = await scroid.getTeam(teamTemplate)
    
                await scroid.iterateDocuments(filters, async ({document}) => {

                    let segments = await scroid.getSegments(document, {confirmed: false, stageNumber})

                    segments = uniqBy(segments, 'source.text')

                    let ranges = scroid.getRanges(segments)

                    let {documentId} = document

                    await scroid.assignRanges(
                        document, 
                        filters.stageNumber, 
                        ranges, 
                        assigneesByLanguage[document.targetLanguage][0]
                    )

                    return ranges
                })
            },

            async editProjects(filters, settings) {
                let {tmName, glossaryName, mtEngineSettings, markupPlaceholders} = settings

                await scroid.iterateProjects(filters, async ({project}) => {
                    let nativeKeys = "name, description, deadline, clientId, domainId, vendorAccountId, externalTag".split(', ')
                    let nativeSettings = assign(
                        pick(project, nativeKeys), 
                        pick(settings, nativeKeys)
                    )
                    let projectApi = scroid.smartcat.project(project.id)
                    await projectApi.put(nativeSettings)

                    let resources = scroid.load('resources')
                    if (tmName) {
                        let {translationMemories} = resources
                        let id = translationMemories[tmName]
                        await projectApi.translationMemories.post([{
                            id,
                            matchThreshold: 75,
                            isWritable: true
                        }])
                    }

                    if (glossaryName) {
                        let {glossaries} = resources
                        let id = glossaries[glossaryName]
                        await projectApi.glossaries.put([id])
                    }

                    if (mtEngineSettings) {
                        await scroid._smartcat.projectResources(project.id).mt.put(mtEngineSettings)
                    }

                    if (markupPlaceholders) {
                        await scroid._smartcat.documents().markupPlaceholders(project.id)
                    }
                })
            },


            async emailAssignees() {

                let clientName = capitalize(smartcatAccountName)
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

                assign(filters, {
                    documentFilter: document => first(document.workflowStages).progress == 100 && document.status != 'completed'
                })

                await scroid.iterateDocuments(filters, async ({document}) => {

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

                assign(filters, {
                    multilingual: true,
                    segmentFilter: {hasComments: true}
                })

                let allComments = []

                await scroid.iterateSegments(filters, async ({project, document, segment}) => {

                    let {topicId} = segment
                    let {documentId} = document

                    let {items} = await scroid._smartcat.topics(topicId).comments({
                        documentId,
                        topicType: 'SEGMENT',
                        start: 0, limit: 100
                    })

                    let segmentComments = map(
                        filter(items, comment => comment.userId), 
                        comment => `${comment.userName}: ${comment.removeType == null ? comment.text : "[comment deleted]"}`
                    ).join('\n\n')
                    console.log(segmentComments)

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
                
                scroid.save({allComments})

            },

            async getUnassignedJobs() {

                let unassignedJobs = []

                let stageFilter = stage => stage.status == 'notAssigned'

                await scroid.iterateDocuments(filters, async ({project, document}) => {

                    let {assignment} = await scroid.getAssignmentData(project, document)
                    for (let stage of filter(assignment.workflowStages, stageFilter)) {
                        return
                    }
                })

            },

            async getPendingJobs() {

                let pendingJobs = []

                let stageFilter = stage => stage.progress != 100

                await scroid.iterateDocuments(filters, async ({project, document}) => {

                    let unassignedFilter = {status: 'notAssigned'}

                    let assignees = []

                    if (find(document.workflowStages, unassignedFilter)) {

                        let {assignment} = await scroid.getAssignmentData(project, document)
                        for (let stage of assignment.workflowStages) {

                            // Todo: account for non-rocket assignments
                            for (let invitation of filter(stage.freelancerInvitations, {
                                isAccepted: false,
                                isDeclined: false
                            })) {
                                let {userId} = invitation
                                let {stageNumber} = stage
                                assignees.push({
                                    userId,
                                    progress: 0,
                                    assignedWordsCount: document.wordsCount,
                                    stageNumber,
                                    status: 'notAssigned'
                                })
                            }
                        }    

                    }

                    for (let stage of filter(document.workflowStages, stageFilter)) {
                        for (let assignee of stage.executives) {
                            let {stageNumber, status} = stage
                            assignees.push(assign(assignee, {stageNumber, status}))
                        }
                    }
                    
                    for (let assignee of assignees) {
                        let {targetLanguage, targetLanguageId} = document
                        let {userId, progress, assignedWordsCount, stageNumber, status} = assignee
                        let contact = await scroid.getContact({userId})
    
                        let {email, firstName} = contact
    
                        if (!firstName) firstName = 'there'
    
                        pendingJobs.push({
                            email, 'First name': firstName,
                            targetLanguage,
                            client: scroid.accountName,
                            project: project.name,
                            document: document.name,
                            projectUrl: scroid.link({project}).url,
                            deadline: project.deadline,
                            documentUrl: scroid.link({document, targetLanguageId}).url,
                            stageNumber,
                            status,
                            wordsTotal: assignedWordsCount,
                            wordsLeft: round((100 - progress) * assignedWordsCount / 100),
                            progress: progress
                        })
                    }

                })



                return pendingJobs

            },

            async assignIdenticalSegments() {

                await scroid.iterateDocuments(filters, async ({document}) => {

                    let segmentHash = {}

                    let segments = await scroid.getSegments(document)

                    for (let segment of segments) {
                        let {source} = segment
                        for (let target of segment.targets) {
                            if (!target.text)
                                continue
                            let key = stringify([source.text, target.language, target.text])
                            if (!segmentHash[key]) segmentHash[key] = []
                            segmentHash[key].push(segment)
                        }
                    }

                    let identicalSegments = flatten(filter(values(segmentHash), pack => pack.length > 1))

                    let ranges = scroid.getRanges(identicalSegments)
                    await scroid.assignRanges(document, 1, ranges, {userId: '6852f318-0a52-4120-a368-71b7a7aba9ce'})

                })

            },

            async joinByContext() {
                await scroid.joinByContext(filters, {onlyJoinIfNotAllConfirmed: true})
            },

            async pretranslateWithAnObject() {
                /* Load translations into one object and pretranslate a document with it*/

                let path = folder.xsolla + '/1808/docs'
                let data = createTableFromHashFiles(path, {
                    includeFilenamesAsKeys: true,
                    pathKeyMask: /(\w+)[^/]+$/,
                    // keysToRemoveIfAtLeastOneEmpty: 'en',
                    format: 'yaml'
                })
                let object = mapKeys(data, 'key')

                await scroid.iterateDocuments(assign(filters, {multilingual: true}), async ({document}) => {
                    await scroid.pretranslateWith_(document, object, {
                        contextFormat: 'yaml',
                        parseFilenames: false,
                        convertNewLinesToTags: true,
                        // convertNewLinesToInline: true,
                        confirm: false
                        // editIfNonEmpty: true,
                        // editIfConfirmed: true,
                        // takeIdFromComments: true
                    })
                })
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

            async renameYamls() {
                renameRecursively()
            },

            async writeSegmentTranslations() {

                let segmentTranslations = await scroid.getSegmentTranslations(filters)

                scroid.save({segmentTranslations})
            },

            async writeReport() {
                /* Create detailed project status report */
                let projects = await scroid.getProjects()

                projects = filter(projects, project => 
                    project.creationDate.match(/2018-06/) ||
                    projectNames.includes(project.name)
                )
                await scroid._writeReport({
                    projects,
                    path: 'C:/Users/asus/Documents/GitHub/Xsolla/Report 1806', 
                    // excludeCompleted: true
                })

            },

            async writeTsv(data, path = folder.tmp) {

                for (let key in data) {
                    let filename = `${path}${key}.tsv`
                    let tsv = json2csv.parse(data[key], {delimiter})
                    fs.writeFileSync(filename, tsv)
                }

            }

        }}


            


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

        return

       
    } catch(error) {
        throw(error)
    }


}