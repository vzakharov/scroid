const Axios = require('axios')
const Smartcat = require('smartcat-api')
const _Smartcat = require('smartcat-ud')
const fs = require('fs')
const readYaml = require('read-yaml')
const writeYaml = require('write-yaml')
const json2csv = require('json2csv')
const csv2json = require('csvtojson')

const l10n = require('l10n-vz')
const {
    createTableFromHashFiles
} = l10n

const _ = require('lodash')

const {
    assign, capitalize, clone, compact, concat, cloneDeep, filter, find, first, forEach, 
    groupBy, includes, isArray, isEqual, keyBy, keys, last, map, mapKeys, mapValues, omit, pick, remove,
    reverse, round, sample, sortBy, uniqBy
} = _

const {
    sleep, getDeep, iterate, setDeep, Select, matchesFilter,
} = require('vz-utils')

const pluralize = require('pluralize')

const domainByServer = {
    eu: '',
    us: 'us.',
    ea: 'ea.'
}

const serverSessionSuffix = {
    eu: 'ru', us: 'us', ea: 'ea'
}

const {stringify} = JSON

class Scroid {

    link({project, document, segment}) {
        let domain = `https://${this.subDomain}smartcat.ai`
        let url, text
        if (project) {
            url = `${domain}/project/${project.id}`
            text = project.name
        } else if (document) {
            let {targetLanguageId} = document
            text = document.name
            if (targetLanguageId) {
                text += ` (${document.targetLanguage})`
            } else {
                targetLanguageId = document.targetLanguageIds[0]
            }
            url = `${domain}/editor?documentId=${document.documentId}&languageId=${targetLanguageId}`
            if (segment) {
                url += `&segmentIndex=${segment.number - 1}`
            }
        }

        return {url, text}

    }

    googleSheetLink(args) {
        let link = this.link(args)
        return `=HYPERLINK("${link.url}", "${link.text}")`
    }

    // Todo: Load from tsv/csv
    import(what, asWhat) { 
        let value = readYaml.sync(`${this.storageFolder}/${what}.yaml`)
        let {account} = this
        if (account && value[account.name]) {
            value = value[account.name]
        }
        if (!asWhat) {
            asWhat = what
        }
        this[asWhat] = value
        return value 
    }

    export(what) {
        for (let key in what) {
            let object = what[key]
            let path = [this.storageFolder, key].join('/')
            writeYaml.sync(path + '.yaml', object)
            if (isArray(object)) {
                if (object.length == 0)
                    continue
                let tsv = json2csv.parse(object, {flatten: true, delimiter: '\t'})
                fs.writeFileSync(path + '.tsv', tsv)
        }
    }
    }
    
    constructor(username) {

        assign(this, {
            username,
            storageFolder: `./private/userStorage/${username}`
        })

        this.import('settings')
        this.import('credentials')

        let {apiToken} = this.credentials.mixmax
        this.mixmax = Axios.create({
            baseURL: 'https://api.mixmax.com/v1/',
            params: {apiToken}
        })

        this.schema = {
            project: {
                document: {
                    segment: {
                        target: true
                    }
                }
            }
        }

        this.fetch = {

            projects: async ({projectFilter}) => 
                isEqual(keys(projectFilter), ['name']) ?
                    [await this.getProject(projectFilter.name)] :
                    await this.getProjects(),
        
            documents: async ({project, multilingual}) => {
                let {documents} = project
                
                if (multilingual) {
        
                    documents = uniqBy(documents, 'documentId')

                    for (let document of documents) {
                        let {documentId} = document
                        for (let key of [
                            'targetLanguage', 'targetLanguageId', 'status', 'id', 'workflowStages', 'statusModificationDate'
                        ]) {
                            delete document[key]
                            document[pluralize(key)] = map(
                                filter(project.documents, {documentId}),
                                key
                            )
                        }
                    }
                    
        
                }
        
                return documents
            },
        
            segments: async ({document, segmentFilter, multilingual}) => 
                await this.getSegments(document, {filters: segmentFilter, multilingual})
        }

        this.log = {
            project: 'name',
            document: document => `${document.name} (${document.targetLanguage})`,
            segment: segment => `#${segment.number} → ${segment.localizationContext[0]} → ${segment.source.text}`,
            target: target => `${target.language} → ${target.text}`
        }

        Select.process(this)

        // this.select = new Select({
        //     schema: {
        //         project: {
        //             document: {
        //                 segment: {
        //                     target: true
        //                 }
        //             }
        //         }
        //     },
        //     get: {
        //         projects: async ({projectFilter}) => 
        //             isEqual(keys(projectFilter), ['name']) ?
        //                 [await this.getProject(projectFilter.name)] :
        //                 await this.getProjects(),
        //         documents: async ({project, multilingual}) => {
        //             let {documents} = project
                    
        //             if (multilingual) {

        //                 documents = uniqBy(documents, 'documentId')
        //                 for (let document of documents) {
        //                     for (let key of [
        //                         'targetLanguage', 'targetLanguageId', 'status', 'id', 'workflowStages', 'statusModificationDate'
        //                     ]) {
        //                         delete document[key]
        //                     }
        //                 }
                        

        //             }

        //             return documents
        //         },
        //         segments: async ({document, segmentFilter, multilingual}) => 
        //             await this.getSegments(document, {filters: segmentFilter, multilingual})
        //     },
        //     log: {
        //         project: 'name',
        //         document: document => `${document.name} (${document.targetLanguage})`,
        //         segment: segment => `#${segment.number} → ${segment.localizationContext[0]} → ${segment.source.text}`,
        //         target: target => `${target.language} → ${target.text}`
        //     }
        // })


        
    }

    /* Iterators */

    async iterateSome({kind, filter, options, asyncCallback, getAll}) {

        if (!filter) filter = () => true

        let allItems = await getAll();
        let items = _.filter(allItems, filter)
        console.log(`${capitalize(kind)}(s): ${map(items, 'name').join(', ')}`)

        for (let item of items) {
            console.log(`Handling ${kind} ${item.name} (id ${item.id})...`)
            let itemArgs = {}
            itemArgs[kind] = item
            itemArgs[pluralize(kind)] = items
            await asyncCallback(assign(options, itemArgs))
        }
    }

    /** callback: async {project} => ... */
    async iterateProjects({filters, options}, asyncCallback) {
        let {multilingual} = filters
        // let {projectFilter} = filters
        let projectFilter = filters.project
        let getAll = isString(projectFilter.name) ?
            async () => [await this.getProject(projectFilter.name)] :
            async () => await this.getProjects()
        await this.iterateSome({
            kind: 'project',
            filter: project => matchesFilter(project, projectFilter, this),
            options: {multilingual},
            asyncCallback,
            getAll
        })
    }

    /** callback: async ({document, project}) => ... */
    async iterateDocuments({projectFilter, documentFilter, multilingual, noInvitations}, asyncCallback) {

        let {noInvitations, multilingual} = options
        
        if (noInvitations) {
            let oldAsyncCallback = asyncCallback
            asyncCallback = async (options) => {
                let {document, project} = options
                let documentIds = [document.documentId]
                let projectId = project.id
                let {targetLanguageId} = document
                let assignmentId = await this._smartcat.workflowAssignments().start({documentIds, projectId, targetLanguageId})
                let assignment = await this._smartcat.workflowAssignments(assignmentId).get()
                let {workflowStages} = assignment
                let {freelancerInvitations} = workflowStages[0] //Todo: multi-stage
                if (freelancerInvitations.length > 0)
                    return false
                return await oldAsyncCallback(options)
            }
        }

        await this.iterateProjects({projectFilter, multilingual}, async ({project}) => {

            await this.iterateSome({
                kind: 'document',
                filter: documentFilter,
                options: {multilingual, project},
                asyncCallback,
                getAll: () => {
                    let {documents} = project
                    for (let document of documents)
                        document.targetLanguageId = Number(document.targetLanguageId)
                    
                    if (multilingual) {

                        documents = uniqBy(documents, 'documentId')
                        for (let document of documents) {
                            let {documentId} = document
                            for (let key of [
                                'targetLanguage', 'targetLanguageId', 'status', 'id', 'workflowStages', 'statusModificationDate'
                            ]) {
                                let monoDocuments = filter(project.documents, {documentId})
                                if (monoDocuments.length == 1)
                                    continue
                                document.multilingual = true
                                document[pluralize(key)] = map(
                                    monoDocuments,
                                    key
                                )
                                delete document[key]
                            }
                        }
                        

                    }

                    return documents
                }
            })

        })

    }

    async iterateAssignees(filters, callback) {
        let {assigneeFilter} = filters

        await this.iterateStages(filters, 
            async iteratees => {

                let {stage} = iteratees

                let assignees = filter(stage.executives, assigneeFilter)

                for (let assignee of assignees) {
                    await callback(assign(iteratees, {assignee, assignees}))
                }

            }
        )
    }


    async iterateStages(options, callback) {
        let {stageFilter} = options

        await this.iterateDocuments(options, 
            async iteratees => {

                let {document} = iteratees

                let stages = filter(document.workflowStages, stageFilter)

                for (let stage of stages) {
                    await callback(assign(iteratees, {stage, stages}))
                }

            }
        )
    }

    async iterateSegments(options, callback) {

        let {segmentFilter, multilingual} = options

        await this.iterateDocuments(options, 
            async iteratees => {

                let {document} = iteratees

                let segments = await this.getSegments(document, segmentFilter, multilingual)

                for (let segment of segments) {
                    await callback(assign(iteratees, {segment, segments}))
                }

            }
        )

    }

    /** Callback: async ({target, segment, segments, document, documents, project, projects}) => ...
     */
    async iterateSegmentTargets(options, callback) {

        await this.iterateSegments(options, 
            async iteratees => {

                let {segment} = iteratees
                let {targets} = segment

                for (let target of targets) {
                    await callback(assign(iteratees, {target, targets}))
                }

            }
        )

    }

    /* */


    async addPayables(options) {

        let {folder, filename} = options
        let path = this.config.folders[folder] + filename

        let payables = await csv2json().fromFile(path)
        remove(payables, {added: 'TRUE'})

        for (let payable of payables) {

            let {
                dateCompleted, currencyName, executiveUserId, jobDescription, pricePerUnit, unitCount, unitType,
            } = payable

            let currencyByName = {
                'USD': 1,
                'EUR': 2,
                'RUB': 3
            }

            let currency = currencyByName[currencyName]

            if (!currency) throw(new Error('Unknown currency: ' + currencyName))

            dateCompleted = new Date(Date.parse(dateCompleted)).toISOString()

            let response = await this._smartcat.jobs.external({
                dateCompleted, currency, executiveUserId, jobDescription, pricePerUnit, unitCount, unitType,
                serviceType: 'Misc'
            })

            console.log(response)
        }

        return payables

    }

    async assignDocument(options) {

        let {document, project, stage, assignees, assignmentMode} = options
        let joinNames = (assignees) => map(assignees, 'name').join(', ')
        let executives = map(assignees, assignee => ({id: assignee.userId, wordsCount: 0}))
    
        try {
            // await this.smartcat.post('document/assign', {
            //     minWordsCountForExecutive: 0,
            //     assignmentMode,
            //     executives
            // }, {params: {
            //     documentId: document.id,
            //     stageNumber: stage
            // }})
    
            await this.smartcat.document.assign(document.id, stage, executives, {
                minWordsCountForExecutive: 0,
                assignmentMode
            })
    
            console.log(`Assignee(s) ${joinNames(assignees)} assigned to ${document.name} in ${assignmentMode} mode.`)
        } catch(error) {
            if (!error.response || error.response.status != 500) throw(error)
    
            let assignmentData = await this.getAssignmentInfo(project, document)
    
            let stageAssignment = find(
                assignmentData.workflowStages, {id: stage.toString()}
            )
            
            if (stageAssignment.documentStages[0].allSegmentsAssigned) {
                let assigneeNames = joinNames(stageAssignment.freelancerInvitations)
                console.log(`${assigneeNames} already assigned to ${document.name}, skipping.`)
                return
            }
    
            let data = {
                addedAssignedUserIds: map(assignees, 'userId'),
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

    async assignFreelancers(options, filters) {

        let {deadline, mode, teamName} = assign({
            mode: 'rocket', teamName: 'default'
        }, options)

        let {stageNumber} = assign({
            stageNumber: 1
        }, filters)

        let documentsByLanguageAndProjectName = await this.getDocumentsByLanguageAndProjectName(filters)

        let assigneesByLanguage
        if (mode == 'rocket') {
            let teamTemplate = this.import('teams')[teamName]
            assigneesByLanguage = await this.getTeam(teamTemplate)
        }

        await iterate(documentsByLanguageAndProjectName, 2, async (documents) => {
            try {
                let documentIds = map(documents, 'documentId')
                let {targetLanguage, targetLanguageId, project} = documents[0]
                let projectId = project.id

                // Todo: move unassign & cancel invitations to a separate method
                if (mode == 'pinned') {
                    documentIds = map(documents, 'id')

                    await this.smartcat.document.assignFromMyTeam(documentIds, stageNumber)
                } else if (mode == 'cancelAllInvitations') {
                    let assignmentId = await this._smartcat.workflowAssignments().start({documentIds, projectId, targetLanguageId})
                    await this._smartcat.workflowAssignments(assignmentId).cancelAllInvitations(stageNumber)
                } else if (mode == 'unassign') {
                    let assignmentId = await this._smartcat.workflowAssignments().start({documentIds, projectId, targetLanguageId})
                    // Todo: handle if multiple docs per assignment
                    // await this._smartcat.documents(documentIds[0]).changeSimpleToSplitAssignment(targetLanguageId, stageNumber)
                    await this._smartcat.workflowAssignments(assignmentId).unassign(options.freelancerId, stageNumber)
                } else {

                    let freelancerIds = map(assigneesByLanguage[targetLanguage], 'userId')

                    // let assignmentId = await this._smartcat.workflowAssignments().start({documentIds, projectId, targetLanguageId})

                    let inviteWithAutoAssignment = mode == 'rocket'

                    await this._smartcat.workflowAssignments(projectId).inviteFreelancers(
                        {freelancerIds, documentIds, targetLanguageId, stage: stageNumber, inviteWithAutoAssignment}
                    )

                }
            } catch (error) {
                let {response} = error

                console.log(error)

                if (mode == 'unassign') {
                    return
                }

                if (response && (response.status == 500 || response.status == 400)) {

                    let {project, targetLanguageId} = documents[0]
                    let projectId = project.id
                    let documentIds = map(documents, 'documentId')

                    let assignmentId = await this._smartcat.workflowAssignments().start({documentIds, projectId, targetLanguageId})
                    let assignment = await this._smartcat.workflowAssignments(assignmentId).get()

                    let stage = find(assignment.workflowStages, {id: stageNumber.toString()})

                    let {freelancerInvitations} = stage
                    let acceptedInvitations = filter(freelancerInvitations, {isAccepted: true})
                    // let unacceptedInvitations = filter(freelancerInvitations, {isAccepted: false})
                    if (acceptedInvitations.length > 1) {
                        console.log(`Accepted invitations: ${map(acceptedInvitations, 'name').join(', ')}, picking one...`)
                    }
                    let invitation = sample(acceptedInvitations)
                    
                    console.log(`Assigning ${invitation.name}...`)

                    let assignmentOptions = {
                        addedAssignedUserIds: [invitation.userId],
                        deadline: null,
                        removedAssignedUserIds: [], //map(acceptedInvitations, 'userId'),
                        removedInvitedUserIds: [], //map(unacceptedInvitations, 'userId'),
                        saveDeadline: true,
                        stageSelector: stageNumber
                    }

                    try {
                        await this._smartcat.workflowAssignments(assignmentId).saveAssignments(assignmentOptions)
                    } catch (errorAgain) {
                        console.log('\x1b[43m%s\x1b[0m', 'Couldn’t assign, proceeding to further freelancers.')
                    }
                    
                    // post(`WorkflowAssignments/${assignmentId}/SaveAssignments`, 
                    // data, {params: {
                    //     stageSelector: stageNumber
                    // }})
                }
            }
        })


    }

    async assignRanges(document, stage, ranges, assignee) {

        let {documentId, targetLanguageId} = document
    
        let data = []
        let params = {
            targetLanguageId
        }
    
        for (let range of ranges) {
    
            let {startSegmentNumber, endSegmentNumber, wordsCount} = range
    
            let [startIncludedSegmentOrder, endExcludedSegmentOrder] = 
                [startSegmentNumber, endSegmentNumber + 1]
    
            data.push({
                startSegmentNumber, endSegmentNumber, 
                startIncludedSegmentOrder, endExcludedSegmentOrder, wordsCount
            })
    
        }
    
        await this.__smartcat.post(`WorkflowAssignments/${documentId}/Split/${stage}/User/${assignee.userId}`, data, {params})
    
        console.log(`${document.name} stage ${stage} ranges ${this.stringifyRanges(ranges)} assigned to ${assignee.name}`)
    }

    async batchReplace(options, filters) {

        let replacements = reverse(
            sortBy(
                map(
                    this.import('replacements'), 
                    (to, from) => ({from, to})
                ), 
                'from.length'
            )
        )

        let {isCaseSensitive} = options

        let nativeFilters = [{
            isCaseSensitive,
            name: 'target-text'
        }]

        await this.iterateDocuments(filters, async ({document}) => {
            for (let replacement of replacements) {
                let textToReplace = replacement.from
                let {to} = replacement
                console.log(`Replacing '${textToReplace} → ${to}'`)
                nativeFilters[0].text = textToReplace
                let filterSetId = await this.getFilterSetId(document, nativeFilters)
                let {documentId} = document
                while(true) {
                    try {
                        await this._smartcat.segmentTargets.batchOperation.replaceTargetText({
                            documentId, filterSetId, isCaseSensitive, textToReplace,
                            replacement: to
                        })
                        break
                    } catch(error) {
                        if (error.response.data.error == 'BatchEditInProgress') {
                            continue
                        } else {
                            throw error
                        }
                    }    
                }
                // await this._smartcat.segmentTargets.batchOperation.delete({id,
                //     editType: 'FindAndReplace',
                //     isUndoRequested: false,
                //     progress: 1,
                //     result: null,
                //     status: true,
                //     userId: null
                // })
            }
    
        })

        await this.iterateSegmentTargets(filters, async ({target, document, project}) => {
            let {regexp} = options
            let {text} = target
            let match = text.match(regexp)
            let projectName = project.name
            let documentName = document.name
            if (match) {
                let term = match[0]
                termsMatchingRegexp.push({projectName, documentName, term})
            } 
        })

    }

    async completeFinishedDocuments(options, filters) {

        assign(filters, {
            documentFilter: document => first(document.workflowStages).progress == 100 && document.status != 'completed'
        })

        await this.iterateDocuments(filters, async ({document}) => {

            try {
                await this._smartcat.documents(document.documentId).targets(document.targetLanguageId).complete()
            } catch (error) {
                return
            }

        })

    }

    async confirmNonEmptySegments_(document, options = {}) {

        let {documentId} = document

        let documentFullName = [document.name, document.targetLanguage].join('/')
        console.log(`Confirming ${documentFullName}...`)

        let {stage} = assign({
            stage: 1
        }, options)
    
        let filters = this.getNativeFilters({confirmed: false, changed: true, stage})
    
        let filterSetId = await this.getFilterSetId(document, {nativeFilters})

        let languageIds = document.targetLanguageId

        // try {
        await this.__smartcat.post('SegmentTargets/BatchOperation/Confirm', null, {params: {
            filterSetId, languageIds, mode: 'manager', isWorkingInGridView: false, documentId
        }})    
        console.log('Done.')
        // } catch(error) {
        //     if (!error.response || error.response.status != 404) throw(error)
        //     console.log(`No matching segments for ${documentFullName})`)
        // }

        // let segments = await this._getSegments(document, {filters})
        // let editor = this._editor(document, {exclude: ['languageIds']})
    
        // for (let segment of segments) {
    
        //     let languageId = document.targetLanguageId
    
        //     // Todo: works with other stages?
        //     let target = find(segment.targets, {stageNumber: stage})
        //     if (target.isConfirmed) continue // because they could have got confirmed by this method
    
        //     let {text} = target
        //     let data = {
        //         languageId, tags: [], text
        //     }
        //     await editor.put(`Segments/${segment.id}/SegmentTargets/${languageId}/Confirm`, data)
        // }
    }

    getNativeFilters(filters) {
        let {confirmed, stageNumber, changed, hasComments} = filters
        for (let key of ['confirmed', 'stageNumber', 'changed', 'hasComments']) {
            delete filters[key]
        }
        let nativeFilters = []
        
        if (confirmed != undefined) {
            nativeFilters.push({name: 'confirmation', isConfirmed: confirmed, workflowStageNumber: stageNumber})
        }
    
        if (changed) {
            nativeFilters.push({
                name: 'revisions', 
                includeAutoRevisions: false, 
                revisionAccountUserId: [],
                revisionStageNumber: null
            })
        }

        if (hasComments) {
            nativeFilters.push({
                name: 'comments',
                hasComments: true
            })
        }
        
        return nativeFilters
    }

    async createProject(options) {
        let {folder, filename} = options
        let path = this.config.folders[folder] + filename
        let file = {
            content: fs.readFileSync(path),
            name: path.match(/[^/\\]+$/)[0]
        }

        if (options.clientName) {
            options.clientId = await this.getClientId(options.clientName)
        }

        if (!options.name) {
            options.name = file.name
        }

        if (options.excludeExtension) {
            options.name = options.name.replace(/\.[^.]*$/, '')
        }

        if (options.includeDate) {
            options.name += ' ' + (new Date().toISOString()).replace(/^\d\d(\d+)-(\d+)-(\d+).*/, '$1$2$3')
        }

        return await this.smartcat.project().create(file, options)
    }

    async downloadMyTeam() {
        let myTeam = []
        let limit = 500
        let skip = 0
    
        while(1) {
            //let {data} = await this.smartcat.post('account/searchMyTeam', {skip, limit})
            let data = await this.smartcat.account.searchMyTeam({skip, limit})
            myTeam.push(... data)
            if (data.length < limit) break
            skip += limit
        }
    
        return myTeam
    }

    async editProjectForDocuments(options, filters) {
        let projects = []
        let projectFilter = project => includes(projects, project)
        await this.iterateDocuments(filters, async ({document, project}) => {
            projects.push(project)
        })
        await this.editProject(options, {projectFilter})
    }

    async editProject(options, filters) {
        let {tmName, glossaryName, mtEngineSettings, markupPlaceholders} = options
        let resources = this.import('resources')
        let {translationMemories} = resources
        let pretranslateRules = options.pretranslate
        if (pretranslateRules) {
            for (let rule of pretranslateRules) {
                rule.translationMemoryId = translationMemories[rule.tmName]
                delete rule.tmName
            }
        }

        await this.iterateProjects({filters}, async ({project}) => {
            let nativeKeys = "name, description, deadline, clientId, domainId, vendorAccountId, externalTag".split(', ')
            let nativeSettings = assign(
                pick(project, nativeKeys), 
                pick(options, nativeKeys)
            )
            let projectApi = this.smartcat.project(project.id)
            await projectApi.put(nativeSettings)

            if (tmName) {
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
                await this._smartcat.projectResources(project.id).mt.put(mtEngineSettings)
            }

            if (markupPlaceholders) {
                await this._smartcat.documents().markupPlaceholders(project.id)
            }

            if (pretranslateRules) {
                await this._smartcat.projects(project.id).pretranslate(pretranslateRules)
            }
        })
    }

    async editSegment_(document, segment, {confirm, languages} = {confirm: true}) {

        let editor = this._editor(document, {exclude: ['languageIds']})
        //assign(editor.defaults.params, {languageId})
    
        console.log(`Handling segment ${segment.number} (${segment.localizationContext[0]}) in ${document.name}: \n\t${segment.source.text}`)
        for (let target of segment.targets) {

            let {text, tags, languageId, language} = target

            if (languages && !languages.includes(language)) continue

            let languageText = `${language} → ${text}`

            let verb 

            try {
                verb = 'Edit'

                await editor.put(`Segments/${segment.id}/SegmentTargets/${languageId}`, {
                    languageId,
                    tags,
                    text
                }, {params: {
                    saveType: 0
                }})

            
                verb = 'Confirm'

                if (confirm) {
                    verb = 'confirm'
                    await editor.put(`Segments/${segment.id}/SegmentTargets/${languageId}/Confirm`, {
                        languageId,
                        tags,
                        text
                    })    
                }
                
            } catch (error) {
                if (error.response) {
                    console.log(`\t${verb} failed for ${languageText} (error ${error.response.status})`)
                    continue
                }
                if (error.code == 'ETIMEDOUT') {
                    return error.code
                }
                throw(error)
            }

            console.log(`\t${languageText}`)
        }    
    }

    getAccounts({accounts} = {}) {
        let {force} = accounts

        if (!force) {

        }
    }

    async getClientId(name) {
        return find(
            await this._smartcat.clients(),
            {name}
        ).id
    }


    async getTermsMatchingRegexp(options, filters) {
        let termsMatchingRegexp = []

        await this.iterateSegmentTargets(filters, async ({target, document, project}) => {
            let {regexp} = options
            let {text} = target
            let match = text.match(regexp)
            let projectName = project.name
            let documentName = document.name
            if (match) {
                let term = match[0]
                termsMatchingRegexp.push({projectName, documentName, term})
            } 
        })

        this.export({termsMatchingRegexp})
    }

    async getDocumentsWithoutInvitations(options, filters) {
        let documentsWithoutInvitations = []

        await this.iterateProjects({filters}, async ({project}) => {
            let documents = filter(project.documents, filters.documentFilter)
            let team = await this._smartcat.projects(project.id).team()
            let {executivesByJobStatus} = team
            for (let executivesByThisJobStatus of executivesByJobStatus) {
                let {executives} = executivesByThisJobStatus
                for (let executive of executives) {
                    let {jobs} = executive
                    let {targetLanguageId} = executive
                    targetLanguageId = targetLanguageId.toString()
                    for (let job of jobs) {
                        let {documentId} = job
                        remove(documents, {
                            documentId,
                            targetLanguageId
                        })
                    }
                }
            }
            for (let document of documents) {
                // let {valuesToSave} = options
                if (options.valuesToSave)
                    document = pick(document, options.valuesToSave)
                documentsWithoutInvitations.push(document)
            }
            // let documentNames = mapValues(
            //     groupBy(documents, 'name'),
            //     documentsWithThatName => map(documentsWithThatName, 'targetLanguage')
            // )
            // documentsWithoutInvitations[project.name] = documentNames
            this.export({documentsWithoutInvitations})
        })

        return documentsWithoutInvitations
    }

    async getComments(options, filters) {

        assign(filters, {
            multilingual: true,
            segmentFilter: {hasComments: true}
        })

        let allComments = []

        await this.iterateSegments(filters, async ({project, document, segment}) => {

            let {topicId} = segment
            let {documentId} = document

            let {items} = await this._smartcat.topics(topicId).comments({
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
                project: this.googleSheetLink({project}),
                document: this.googleSheetLink({document, segment}),
                segmentNumber: segment.number,
                key: segment.localizationContext.join('\n'),
                sourceText: segment.source.text,
                comments: segmentComments
            })

        })
        
        this.export({allComments})

    }

    /** identifier: {name, userId} */
    async getContact(filter, force) {

        this.import('contacts')
        let {contacts} = this
        let contact = find(contacts, filter)

        if (force) {
            console.log(`Updating contact data for ${stringify(filter)}...`)
        } else {
            console.log(`Looking up contact data for ${stringify(filter)}...`)
        }

        if (!contact || force) {
            console.log('Not found locally, requesting via API...')
    
            let profile = await this._smartcat.freelancers.profile(filter.userId)
    
            let {firstName, transliteratedFullName, id} = profile

            contacts.push(
                assign({
                name: transliteratedFullName, userId: id, firstName
            }, profile.myTeamContacts, profile.ownContacts)
            )
            
            contact = last(contacts)
            
            if (!contact.externalId) delete contact.externalId
            for (let key in contact) {
                if (!key) delete contact[key]
            }
            

            this.export({contacts})
        }
    

        console.log(`\tDone: ${stringify(contact)}.`)

        return contact
    
    }

    async getEmails({project, documents, stage, assignees}, {returnHash, modifyAssignees} = {}) {

        let emails = returnHash ? {} : []
        // let userIds = []
    
        if (!assignees) {
    
            assignees = []
    
            for (let document of documents) {
    
                console.log(`Looking up assignees for ${document.name} (${document.targetLanguage})...`)
                let {assignment} = await this.getAssignmentInfo(project, document)
        
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
    
            let {userId, name} = assignee
        
            let {email} = await this.getContact({name, userId})
    
            if (returnHash) {
                emails[name] = email
            } else {
                emails.push({name, userId, email})
            }
    
            if (modifyAssignees) {
                assign(assignee, {email})
            }
    
        }
    
        return emails
    
    }

    async getFilterSetId(document, nativeFilters) {

        let {targetLanguageId, targetLanguageIds, documentId} = document

        if (!targetLanguageIds)
            targetLanguageIds = [targetLanguageId]

        let languageFilter = {
            name: 'language',
            targetLanguageIds
        }

        let {id} = await this._smartcat.documents(documentId).segmentsFilter([
            ... nativeFilters, languageFilter
        ])
        // (
        //     await this.__smartcat.post(`Documents/${documentId}/SegmentsFilter`, 
        //         [... nativeFilters, languageFilter], {params:
        //             {mode: 'manager', documentId}
        //         })
        // ).data.id

        return id
    }

    async getDocuments(options) {

        let documents = []

        await this.iterateDocuments(options, ({document}) => documents.push(document))

        return documents

    }

    async getAssignees(options) {
        let assignees = []

        await this.iterateDocuments(options, async ({document, project}) => {
            for (let stage of document.workflowStages) {
                for (let executive of stage.executives) {
                    let {userId, progress} = executive
                    assignees.push(assign(executive, options.report({project, document})))
                }
            }
        })

        return assignees

    } 

    async getAssignmentInfo(project, documents) {

        if (!isArray(documents)) documents = [documents]

        let documentIds = map(documents, 'documentId')
        let projectId = project.id
        let {targetLanguageId} = documents[0]

        // Old flow, keeping for now just in case
        // let assignmentId = await this._smartcat.workflowAssignments().start({documentIds, projectId, targetLanguageId})
        // let assignment = await this._smartcat.workflowAssignments(assignmentId).get()
        let assignmentInfo = await this._smartcat.workflowAssignments(projectId).info({documentIds, targetLanguageId})

        for (let stage of assignmentInfo.workflowStages) {
            stage.stageNumber = parseInt(stage.id)
            delete stage.id
        }

        return assignmentInfo
    }

    async getSegmentTranslations(options) {

        let getTmFactor = ({matchPercentage, saveType}) => 
            saveType == 6 ? 0 :
            matchPercentage > 99 ? 0 :
            matchPercentage >= 95 ? 0.1 :
            matchPercentage >= 85 ? 0.4 :
            matchPercentage >= 75 ? 0.7 :
            1
        
        let data = []

        await this.iterateSegmentTargets(options, async ({target, segment, project, document}) => {
            let {matchPercentage, language} = target
            let revision = find(reverse(target.revisions), revision => revision.userName)
            if (!revision) return
            let {userName, saveType} = revision
            let {wordsCount, number} = segment
            let tmFactor = getTmFactor({matchPercentage, saveType})
            let createdAt = revision.creationDate
            let date = createdAt.match(/^\d+-\d+-\d+/)[0]
            let dateAndHour  = createdAt.match(/^\d+-\d+-\d+\w\d+/)[0]
            let hour = createdAt.match(/(?<=T)\d+/)[0]
            let effectiveWordsCount = tmFactor * wordsCount
            data.push({
                project: project.name, document: document.name, language, 
                createdAt, date, hour,
                userName, segmentNumber: segment.number, 
                saveType, wordsCount, matchPercentage, tmFactor, effectiveWordsCount
            })
            console.log(stringify(last(data)))
        })

        return data
    }

    async getDocumentWordcounts(options, filters) {

        let documentWordcounts = []

        await this.iterateDocuments(filters, async ({project, document}) => {
            documentWordcounts.push({
                document: document.name, 
                project: project.name, 
                words: document.wordsCount,
                targetLanguage: document.targetLanguage
            })
            this.export({documentWordcounts})
        })

        return documentWordcounts
    }

    async getPendingJobs(options, filters) {

        let pendingJobs = []

        let stageFilter = stage => stage.progress != 100

        await this.iterateDocuments(filters, async ({project, document}) => {

            let unassignedFilter = {status: 'notAssigned'}

            let assignees = []

            if (find(document.workflowStages, unassignedFilter)) {

                let assignmentInfo = await this.getAssignmentInfo(project, document)
                for (let stage of assignmentInfo.workflowStages) {

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
                let contact = await this.getContact({userId})

                let {email, firstName} = contact

                if (!firstName) firstName = 'there'

                pendingJobs.push({
                    email, 'First name': firstName,
                    targetLanguage,
                    client: this.accountName,
                    project: project.name,
                    document: document.name,
                    projectUrl: this.link({project}).url,
                    deadline: project.deadline,
                    documentUrl: this.link({document, targetLanguageId}).url,
                    stageNumber,
                    status,
                    wordsTotal: assignedWordsCount,
                    wordsLeft: round((100 - progress) * assignedWordsCount / 100),
                    progress: progress
                })
                
                this.export({pendingJobs})
            }

        })

        // this.save({pendingJobs})
        return pendingJobs

    }

    async getProject(projectName) {

        let projects = (
            await this.getProjects({projectName})
        )
    
        return projects.find(project => project.name == projectName)
    
    }

    async _getProjects({account, projects}) {

        let {name} = account
        if (name != this.account.name) {
            this.setAccount(name)
        }

        // Nb: projects is a function/hash (filter)
        let params
        let projectName = typeof projects != 'function' && projects.name
        if (projectName) params = {projectName}

        let decomposeDocumentId = compositeId => {
            let [documentId, targetLanguageId] = compositeId.match(/(\d+)_(\d+)/).slice(1)
            return {documentId, targetLanguageId}
        }

        let projects = map(
            await this.smartcat.project().list(params), 
            project => assign(new class Project{}(), project)
        )

        assign (this, {projects})
    
        return projects
    
    }


    async getProjects(params) {

        let decomposeDocumentId = compositeId => {
            let [documentId, targetLanguageId] = compositeId.match(/(^.+)_(\d+)/).slice(1)
            return {documentId, targetLanguageId}
        }

        let projects = await this.smartcat.project().list(params)
        
        for (let project of projects) {
            project.targetLanguagesById = {}
            for (let document of project.documents) {
                let {documentId, targetLanguageId} = decomposeDocumentId(document.id)
                assign(document, {documentId, targetLanguageId})
                if (!project.targetLanguagesById[targetLanguageId]) {
                    project.targetLanguagesById[targetLanguageId] = document.targetLanguage
                }
                
                let stages = document.workflowStages
                for (let i = 0; i < stages.length; i++) {
                    let stage = stages[i]
                    stage.stageNumber = i + 1 
                    for (let assignee of stage.executives) {
                        this.renameKeys(assignee, {id: 'userId'})        
                    }
                }

                Object.defineProperty(document, 'project', {get: () => project})
            }
        }
    
        return projects
    
    }

    getRanges(segments) {

        let ranges = this.ranges = []
    
        let endSegmentNumber, range, wordsCount

        segments = sortBy(segments, 'number')
        
        for (let i = 0; i < segments.length; i++) {
    
            let segment = segments[i]
    
            endSegmentNumber = segment.number
    
            if (range && segment.number == segments[i-1].number + 1) {
                assign(range, {endSegmentNumber})
                range.wordsCount += segment.wordsCount
            } else {
                wordsCount = segment.wordsCount
                ranges.push({
                    startSegmentNumber: segment.number,
                    endSegmentNumber,
                    wordsCount
                })
                range = last(ranges)
            }
    
        }
    
        return ranges
    
    }

    async getSegments(document, segmentFilter, multilingual) {

        let segments = []
    
        let start = 0, limit = 5000

        let params = {
            mode: 'manager'
        }

        if (segmentFilter) {
            segmentFilter = clone(segmentFilter)
            let nativeFilters = this.getNativeFilters(segmentFilter)
            let filterSetId = await this.getFilterSetId(document, nativeFilters)
            assign(params, {filterSetId})
        }

        while(1) {
    
            let {documentId, targetLanguageId} = document
    
            assign(params, {start, limit})

            if (!multilingual) {
                assign(params, {languageIds: targetLanguageId})
                //params._page = 'editor'
            }
        
            let {total, items} = await this._smartcat.segments(documentId, params)
            
            // (
            //     await this._smartcat.get('Segments', {params})
            // ).data
    
            segments.push(... items)
    
            if (segments.length >= total) break
    
            start += limit
            limit = total - start
    
        }

        for (let segment of segments) {
            for (let target of segment.targets) {
                target.language = document.project.targetLanguagesById[target.languageId]
            }
        }
    
        return filter(segments, segmentFilter)
        
    }

    async getSegmentsByContext(document, regexp) {
        let segments = await this.getSegments(document, {multilingual: true}) 
        let out = []

        for (let segment of segments) {
            let context = segment.localizationContext[0]
            if (context.match(regexp)) {
                out.push(segment)
            }
        }

        return out
    }

    async getSegmentsWithTargetSameAsSource(document) {

        let segments = await this.getSegments(document, {multilingual: true}) 
        let out = []

        for (let segment of segments) {
            for (let target of segment.targets) {
                if (segment.source.text == target.text) {
                    out.push(segment)
                    break
                }
            }
        }

        return out

    }

    async getDocumentsByLanguageAndProjectName(filters) {

        let documentsByLanguageAndProjectName = {}

        await this.iterateDocuments(filters, ({document, project}) => {
            let documents = getDeep(documentsByLanguageAndProjectName, [document.targetLanguage, project.name], [])
            documents.push(document)
        })

        return documentsByLanguageAndProjectName
    }

    async getTeam(teamTemplate, {includeEmails} = {}) {

        let assigneesByLanguage = {}
        let assignees = []
        let smartcatTeam = await this.downloadMyTeam()
        this.export({smartcatTeam})
    
        for (let languageKey in teamTemplate) {
            let languages = languageKey.split(',')

            let names = teamTemplate[languageKey]
            if (!isArray(names)) names = [names]
            for (let name of names) {
                console.log({name})
                let assignee = find(smartcatTeam, assignee => compact([assignee.firstName, assignee.lastName]).join(' ') == name)
                
                if (!assignees.includes(assignee)) {
                    assignees.push(assignee)
                    assign(assignee, {name})
                    if (assignee.id) this.renameKeys(assignee, {id: 'userId'})
                }

                for (let targetLanguage of languages) {
                    getDeep(assigneesByLanguage, [targetLanguage], []).push(assignee)
                }
            }

        }
    
        if (includeEmails) {
            await this.getEmails({assignees}, {modifyAssignees: true})
        }
    
        return assigneesByLanguage
    
    }

    async joinByContext(filters, {onlyJoinIfAllConfirmed, onlyJoinIfNotAllConfirmed} = {}) {
    
        let multilingual = true
    
        assign(filters, {multilingual})
        await this.iterateDocuments(filters, async ({document}) => {
    
            let segments = await this.getSegments(document, {multilingual})
    
            let oldContext
            let segmentsToJoin = []
            let skipContext
    
            for (let i = 0; i < segments.length; i++) {
                let segment = segments[i]
                let localizationContext = segment.localizationContext.join('\n')
                if (localizationContext == skipContext) {
                    continue
                }
                if (isEqual(oldContext, localizationContext)) {
                    segmentsToJoin.push(segment)
                    console.log('Segments with the same context:')
                    console.log({localizationContext})
                    console.log(map(segmentsToJoin, segment => [segment.number, segment.source.text].join('. ')).join('\n'))
                } else {

                    if (segmentsToJoin.length > 1) {

                        let iterateTargets = (predicate) => {
                            for (let segment of segmentsToJoin) {
                                for (let target of segment.targets) {
                                    let {languageId, isConfirmed} = target
                                    let result = predicate(target, languageId, isConfirmed)
                                    if (typeof result !== 'undefined') {
                                        return result
                                    }
                                }
                            }
                        }

                        let shouldJoin = () => {
                            let wasEmptyByLanguageIds = {}
                            iterateTargets((target, languageId, isConfirmed) => {
                                if (!isConfirmed && onlyJoinIfAllConfirmed) {
                                    return false
                                }
                                let wasEmpty = wasEmptyByLanguageIds[languageId]
                                if (wasEmpty == undefined) {
                                    wasEmptyByLanguageIds[languageId] = isConfirmed
                                } else {
                                    if (isConfirmed != wasEmpty) {
                                        skipContext = localizationContext
                                        console.log(`Targets for language ${languageId} are partially empty; skipping.`)
                                        return false
                                    }
                                }
                            })
                            return true
                        }

                        let shouldConfirm = () => {
                            let shouldConfirm = {}
                            iterateTargets((target, languageId, isConfirmed) => {
                                if (shouldConfirm[languageId] !== undefined) return
                                shouldConfirm[languageId] = isConfirmed
                            })
                            return shouldConfirm
                        }

                        if (shouldJoin()) {
                            await this._editor(document).put('Segments/Join', segmentsToJoin, {params: {
                                documentId: document.documentId,
                                languageIds: document.targetLanguageId
                            }})

                            let shouldConfirmByLanguageId = shouldConfirm()

                            let languageIds = map(segmentsToJoin[0].targets, 'languageId')
                            for (let languageId of languageIds) {
                                if (shouldConfirmByLanguageId[languageId]) {
                                    let target = find(segment.targets, {languageId})
                                    await this._editor(document).put(
                                        `Segments/${segment.id}/SegmentTargets/${languageId}/Confirm`,
                                        pick(target, ['languageId', 'tags', 'text'])
                                    )
                                }
                            }
                        }
                        
                        // Update segments after joining and remove those already checked
                        // segments = await this.getSegments_(document, {multilingual: true})
                        // i -= segmentsToJoin.length - 1
                    }

                    oldContext = localizationContext
                    segmentsToJoin = [segments[i]]
                }
            }
        })
    }


    async pretranslateByIds(options, filters) {
        /* Load translations into one object and pretranslate a document with it*/

        let {path, format, folder, subPath} = options

        if (folder && subPath) {
            path = this.config.folders[folder] + subPath
        }

        let data = createTableFromHashFiles(path, {
            includeFilenamesAsKeys: true,
            // pathKeyMask: /([\-\w]+)\/[^/]+$/,
            // keysToRemoveIfAtLeastOneEmpty: 'en',
            format
        })
        let object = mapKeys(data, 'key')

        await this.iterateDocuments(assign(filters, {multilingual: true}), async ({document}) => {
            await this.pretranslateDocumentById(document, object, options)
        })
    }

    /** Options: {
            contextFormat, parseFilenames, convertNewLinesToTags, 
            confirm, documentNames, editIfNonEmpty
        } */
    async pretranslateDocumentById(document, object, options) {

        let {
            addMissingTagsInTheEnd, contextFormat, parseFilenames, convertExtraTagsTo,
            convertNewLinesToInline, convertNewLinesToTags, confirm, documentNames, 
            editIfConfirmed, editIfNonEmpty, editIfExtraTagsOnly, editIfMissingTagsOnly,
            editIfNonMatchingTagsOnly, takeIdFromComments
        } = assign({documentNames: []}, options)

        if (documentNames.includes(document.name)) return
        documentNames.push(document.name)

        console.log(`Pretranslating ${document.name}...`)

        let documentNameWithoutLanguage = parseFilenames && document.name.match(/\w+\.(.+)$/)[1]

        let filters

        if (!editIfConfirmed)
            filters = {confirmed: false, stageNumber: 1}

        let segments = await this.getSegments(document, filters, true)

        let languageFilesMissing = []

        for (let segment of segments) {
            let {targets, source} = segment
            remove(targets, target => languageFilesMissing.includes(target.language))

            targetLoop:
            for (let target of targets) {
                
                target.changed = false
                let {language} = target

                if (!editIfNonEmpty) {
                    if (target.text) continue
                }

                if (!editIfConfirmed && target.isConfirmed) {
                    continue
                }

                let string

                if (!takeIdFromComments) {
                    string = segment.localizationContext[0]
                } else {
                    let {documentId} = document
                    let {items} = await this._smartcat.topics(segment.topicId).comments({
                        documentId,
                        topicType: 'SEGMENT',
                        start: 0, limit: 100
                    })

                    string = find(items, item => item.text.match(/^\/[\w\d._]+$/)).text.slice(1)
                }

                let id = string
                let text = object
    
                if (parseFilenames) {
                    let languageFilenameKey = [language, documentNameWithoutLanguage].join('.')
                    text = object[languageFilenameKey]
                    if (!object[languageFilenameKey]) {
                        console.log(`No file named ${documentNameWithoutLanguage} for ${language}, skipping language.`)
                        languageFilesMissing.push(language)
                        continue
                    }
                }
    
                if (contextFormat == 'json') {
                    let match = string.match(/^\['(.*)'\]$/)
                    id = match ? match[1] : string
                }
                
                if (contextFormat == 'yaml') {
                    id = id.slice(1)
                }

                let translations = object[id]

                if (!translations)
                    continue

                text = translations[language]
    
                if (!text || text == target.text) 
                    continue

                assign(target, {text})

                if (convertNewLinesToTags) {
                    this.convertToTagsInTarget(target)    
                }

                if (
                    (editIfNonMatchingTagsOnly && target.tags.length == source.tags.length)
                    || (editIfExtraTagsOnly && target.tags.length <= source.tags.length)
                    || (editIfMissingTagsOnly && target.tags.length >= source.tags.length)
                ) {
                    continue
                }

                if (addMissingTagsInTheEnd && target.tags.length < source.tags.length) {
                    for (let i = target.tags.length + 1; i <= source.tags.length; i++) {
                        target.tags.push({
                            tagNumber: i, position: target.text.length, 
                            tagType: 3, isSubtitleTag: false, isVirtual: false, 
                            isRequired: true, formatting: null
                        })
                    }
                }

                if (convertExtraTagsTo && target.tags.length > source.tags.length) {
                    let positions = []
                    do {
                        let tag = target.tags.pop()
                        positions.push(tag.position)
                    } while(target.tags.length != source.tags.length)
                    for (let position of positions) {
                        let {text} = target
                        target.text = text.slice(0, position) + convertExtraTagsTo + text.slice(position)
                    }
                }


                if (convertNewLinesToInline && target.text.match('\n')) {
                    target.text = target.text.replace(/\n/g, '\\n')
                }

                target.changed = true
    
            }

            if (languageFilesMissing.length == targets.length) {
                console.log('Language files missing for all languages, skipping document.')
                return
            }

            remove(targets, {changed: false})

            if (targets.length == 0) {
                continue
            }

            await this.editSegment_(document, segment, {confirm})

        }
    }

    setAccount(name) {
        let accounts = this.import('accounts')

        if (!name) name = this.settings.defaultAccount
        if (!name) name = accounts[0].name

        let account = find(accounts, {name})
        assign(this, {account})

        let {auth, server} = account
        this.subDomain = domainByServer[server]
        let {subDomain} = this

        this.smartcat = new Smartcat({auth, subDomain}).methods

        let {credentials} = this        
        let session = credentials.smartcat.sessionsByServer[server]
        let cookie = `session-${serverSessionSuffix[server]}=${session}`

        let _defaults = {
            baseURL: `https://${subDomain}smartcat.ai/api/`,
            headers: {cookie}
        }

        this.__smartcat = Axios.create(_defaults)
        this._smartcat = new _Smartcat({cookie, subDomain}).methods

        this._editor = function (document, options = {}) {
            let {exclude} = options
            let params = {
                mode: 'manager', 
                _page: 'Editor', 
                documentId: document.documentId, 
                languageIds: document.targetLanguageId
            }
            if (exclude) {
                for (let what of exclude) {
                    delete params[what]
                }
            }
            return Axios.create(assign(_defaults, {params}))
        }

        this._marketplace = Axios.create({
            baseURL: `https://${subDomain}marketplace.smartcat.ai/api/v1`,
            headers: {
                authorization: `Bearer ${credentials.smartcat.marketplaceTokensByServer[server]}`
            }
        })
    }

    async unassignSingleFreelancer(options, filters) {
        let {freelancerId, stageNumber} = options
        await this.iterateDocuments(filters, async ({document}) => {
            try {
                let documentIds = [document.documentId]
                let projectId = document.project.id
                let {targetLanguageId} = document
                let assignmentId = await this._smartcat.workflowAssignments().start({documentIds, projectId, targetLanguageId})
                // Todo: handle if multiple docs per assignment
                // await this._smartcat.documents(documentIds[0]).changeSimpleToSplitAssignment(targetLanguageId, stageNumber)
                await this._smartcat.workflowAssignments(assignmentId).unassign(freelancerId, stageNumber)
            } catch(error) {
                console.log
            }

        })
    }

    convertToTagsInTarget(target, regex = /[\n\t]/) {
        let tagNumber = 1

        let tags = []

        let {text} = target
        while(1) {
            let index = text.search(regex)
            if (index < 0) break
            text = text.replace(regex, '')
            tags.push({
                tagNumber, position: index, 
                tagType: 3, isSubtitleTag: false, isVirtual: false, 
                isRequired: true, formatting: null
            })
            tagNumber++
        }

        if (tags.length == 0) return false

        assign(target, {tags, text})
        return true
    }

    async convertDocumentNewlinesToTags(document) {
        let filters = this.getNativeFilters({confirmed: false, changed: true, stage: 1})
        let segments = await this.getSegments(document, {filters})


        for (let segment of segments) {
            for (let target of segment.targets) {
                this.convertToTagsInTarget(target)                
            }

            await this.editSegment_(document, segment, {confirm: false})
        }

    }

}


for (let fileName of fs.readdirSync('./lib/properties')) {

    let propertyName = fileName.match('^(.*).js$')[1]
    let imported = require(`./lib/properties/${propertyName}`)
    let scroid = Scroid.prototype

    if (typeof imported == 'function') {
        scroid[propertyName] = imported
    } else {
        assign(scroid, imported)
    }

}

module.exports = Scroid