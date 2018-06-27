const Axios = require('axios')
const Smartcat = require('smartcat-api')
const _Smartcat = require('smartcat-ud')
const fs = require('fs')
const readYaml = require('read-yaml')
const writeYaml = require('write-yaml')

const _ = require('lodash')

const {
    assign, capitalize, clone, filter, find, includes, 
    isArray, isEqual, keyBy, keys, last, map, omit, pick, remove,
    sample, uniqBy
} = _

const {
    sleep, getDeep, iterate, setDeep
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

    link({project, document, targetLanguageId}) {
        let domain = `https://${this.subDomain}smartcat.ai`
        let url, text
        if (project) {
            url = `${domain}/project/${project.id}`
            text = project.name
        } else if (document) {
            if (targetLanguageId) {
                url = `${domain}/editor?documentId=${document.documentId}&languageId=${targetLanguageId}`
                text = `${document.name} (${document.targetLanguage})`
            } else {
                url = `${domain}/grid-editor?documentId=${document.documentId}`
                text = document.name
            }
        }

        return {url, text}

    }

    googleSheetLink(args) {
        let link = this.link(args)
        return `=HYPERLINK("${link.url}", "${link.text}")`
    }



    load(what) { 
        let value = readYaml.sync(`${this.storageFolder}/${what}.yaml`)
        this[what] = value
        return value 
    }

    save(hash) {
        for (let key in hash) {
            writeYaml.sync(`${this.storageFolder}/${key}.yaml`, hash[key])
        }
    }
    
    constructor(username) {

        assign(this, {
            username,
            storageFolder: `./private/userStorage/${username}`
        })

        this.load('credentials')

        let {apiToken} = this.credentials.mixmax
        this.mixmax = Axios.create({
            baseURL: 'https://api.mixmax.com/v1/',
            params: {apiToken}
        })

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
    async iterateProjects({projectFilter, multilingual}, asyncCallback) {
        let getAll = isEqual(keys(projectFilter), ['name']) ?
            async () => [await this.getProject(projectFilter.name)] :
            async () => await this.getProjects()
        await this.iterateSome({
            kind: 'project',
            filter: projectFilter,
            options: {multilingual},
            asyncCallback,
            getAll
        })
    }

    /** callback: async ({document, project}) => ... */
    async iterateDocuments({projectFilter, documentFilter, multilingual}, asyncCallback) {

        await this.iterateProjects({projectFilter, multilingual}, async ({project}) => {

            await this.iterateSome({
                kind: 'document',
                filter: documentFilter,
                options: {multilingual, project},
                asyncCallback,
                getAll: () => {
                    let {documents} = project
                    
                    if (multilingual) {

                        documents = uniqBy(documents, 'documentId')
                        for (let document of documents) {
                            for (let property of [
                                'targetLanguage', 'targetLanguageId', 'status', 'id', 'workflowStages', 'statusModificationDate'
                            ]) {
                                delete document[property]
                            }
                        }
                        

                    }

                    return documents
                }
            })

        })

    }

    async iterateAssignees(options, callback) {
        let {assigneeFilter} = options

        await this.iterateStages(options, 
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

                let filters = segmentFilter && this.createFilter(segmentFilter)

                let segments = await this.getSegments_(document, {filters, multilingual})

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
            async ({iteratees}) => {

                let {segment} = iteratees
                let {targets} = segment

                for (let target of targets) {
                    await callback(assign(iteratees, {target, targets}))
                }

            }
        )

    }

    /* */


    async assignDocument_(options) {

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
    
            let {assignment, assignmentId} = await this._getAssignment(project, document)
    
            let stageAssignment = find(
                assignment.workflowStages, {id: stage.toString()}
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

    async assignPinnedFreelancers(options) {

        let {stageNumber} = assign({
            stageNumber: 1
        }, options)

        let documentsByLanguageAndProjectName = await this.getDocumentsByLanguageAndProjectName(options)

        await iterate(documentsByLanguageAndProjectName, 2, async (documents) => {
            let documentIds = map(documents, 'id')
            try {
                await this.smartcat.document.assignFromMyTeam(documentIds, stageNumber)
            } catch (error) {
                let {project, targetLanguageId} = documents[0]
                let projectId = project.id
                documentIds = map(documents, 'documentId')
                let {response} = error
                if (response && response.status == 500) {
                    let assignmentId = await this._smartcat.workflowAssignments.start({documentIds, projectId, targetLanguageId})
                    let assignment = await this._smartcat.workflowAssignments.get(assignmentId)

                    let stage = find(assignment.workflowStages, {id: stageNumber.toString()})

                    let {freelancerInvitations} = stage
                    let invitation = find(freelancerInvitations, {isAccepted: true})
                    
                    console.log(`Assigning ${invitation.name}...`)

                    let assignmentOptions = {
                        addedAssignedUserIds: [invitation.userId],
                        deadline: null,
                        removedAssignedUserIds: [],
                        removedInvitedUserIds: [],
                        saveDeadline: true,
                        stageSelector: stageNumber
                    }

                    await this._smartcat.workflowAssignments.save(assignmentId, assignmentOptions)
                    
                    // post(`WorkflowAssignments/${assignmentId}/SaveAssignments`, 
                    // data, {params: {
                    //     stageSelector: stageNumber
                    // }})
                }
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
    
        let filters = this.createFilter({confirmed: false, changed: true, stage})
    
        let filterSetId = await this.getFilterSetId(document, {filters})

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

    createFilter({confirmed, stage, changed, hasComments} = {}) {
        let filters = []
        
        if (confirmed != undefined) {
            filters.push({name: 'confirmation', isConfirmed: confirmed, workflowStageNumber: stage})
        }
    
        if (changed) {
            filters.push({
                name: 'revisions', 
                includeAutoRevisions: false, 
                revisionAccountUserId: [],
                revisionStageNumber: null
            })
        }

        if (hasComments) {
            filters.push({
                name: 'comments',
                hasComments: true
            })
        }
        
        return filters
    }

    async createProject(path, settings) {
        let file = {
            content: fs.readFileSync(path),
            name: path.match(/[^/\\]+$/)[0]
        }

        if (settings.clientName) {
            settings.clientId = await this.getClientId(settings.clientName)
        }

        if (!settings.name) {
            settings.name = file.name
        }

        if (settings.excludeExtension) {
            settings.name = settings.name.replace(/\.[^.]*$/, '')
        }

        if (settings.includeDate) {
            settings.name += ' ' + (new Date().toISOString()).replace(/^\d\d(\d+)-(\d+)-(\d+).*/, '$1$2$3')
        }

        return await this.smartcat.project.create(file, settings)
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
                if (!error.response) throw(error)
                console.log(`\t${verb} failed for ${languageText} (error ${error.response.status})`)
                continue
            }

            console.log(`\t${languageText}`)
        }    
    }

    async getClientId(name) {
        return find(
            await this._smartcat.clients(),
            {name}
        ).id
    }

    /** identifier: {name, userId} */
    async getContact(filter, force) {

        this.load('contacts')
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
            contact = assign({
                name: transliteratedFullName, userId: id, firstName
            }, profile.myTeamContacts, profile.ownContacts)
            if (!contact.externalId) delete contact.externalId
            for (let key in contact) {
                if (!key) delete contact[key]
            }
            this.save({contacts})
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

    async getFilterSetId(document, {filters, multilingual} = {}) {

        let {targetLanguageId, documentId} = document

        let targetLanguageIds = multilingual ? 
            map(keys(document.project.targetLanguagesById), Number) :
            [targetLanguageId]

        let languageFilter = {
            name: 'language',
            targetLanguageIds
        }

        let filterSetId = (
            await this.__smartcat.post(`Documents/${documentId}/SegmentsFilter`, 
                [... filters, languageFilter], {params:
                    {mode: 'manager', documentId}
                })
        ).data.id

        return filterSetId
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

    async getProductivityData(options) {

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
    }

    async getProject(projectName) {

        let projects = (
            await this.getProjects({projectName})
        )
    
        return projects.find(project => project.name == projectName)
    
    }

    async getProjects(params) {

        let decomposeDocumentId = compositeId => {
            let [documentId, targetLanguageId] = compositeId.match(/(\d+)_(\d+)/).slice(1)
            return {documentId, targetLanguageId}
        }

        let projects = await this.smartcat.project.list(params)
        
        for (let project of projects) {
            project.targetLanguagesById = {}
            for (let document of project.documents) {
                let {documentId, targetLanguageId} = decomposeDocumentId(document.id)
                assign(document, {documentId, targetLanguageId})
                if (!project.targetLanguagesById[targetLanguageId]) {
                    project.targetLanguagesById[targetLanguageId] = document.targetLanguage
                }
                Object.defineProperty(document, 'project', {get: () => project})
            }
        }
    
        return projects
    
    }

    async getSegments_(document, {filters, multilingual} = {}) {

        let segments = []
    
        let start = 0, limit = 500
    
        while(1) {
    
            let {documentId, targetLanguageId, project} = document
            let {targetLanguagesById} = project
    
            let params = {
                //documentId,
                start, limit, mode: 'manager'
            }

            if (!multilingual) {
                assign(params, {languageIds: targetLanguageId})
                //params._page = 'editor'
            }
    
            if (filters) {
                let filterSetId = await this.getFilterSetId(document, {filters, multilingual})
                assign(params, {filterSetId})
            }
    
            let {total, items} = await this._smartcat.segments(documentId, params)
            
            // (
            //     await this._smartcat.get('Segments', {params})
            // ).data
    
            segments.push(... items)
    
            if (segments.length >= total) {
                for (let segment of segments) {
                    for (let target of segment.targets) {
                        target.language = targetLanguagesById[target.languageId]
                    }
                }
                return segments
            } 
    
            start += limit
            limit = total - start
    
        }
        
    }

    async getSegmentsByContext(document, regexp) {
        let segments = await this.getSegments_(document, {multilingual: true}) 
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

        let segments = await this.getSegments_(document, {multilingual: true}) 
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

    async getDocumentsByLanguageAndProjectName(options) {

        let documentsByLanguageAndProject = {}

        await this.iterateDocuments(options, ({document, project}) => {
            let documents = getDeep(documentsByLanguageAndProject, [document.targetLanguage, project.name], [])
            documents.push(document)
        })

        return documentsByLanguageAndProject
    }

    async getTeam(teamTemplate, {includeEmails} = {}) {

        let assigneesByLanguage = {}
        let assignees = []
        let smartcatTeam = await this.downloadMyTeam()
    
        for (let languageKey in teamTemplate) {
            let languages = languageKey.split(',')

            let names = teamTemplate[languageKey]
            if (!isArray(names)) names = [names]
            for (let name of names) {
                let assignee = find(smartcatTeam, assignee => `${assignee.firstName} ${assignee.lastName}` == name)
                
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

    async joinByContext_(filters, {onlyJoinIfAllConfirmed, onlyJoinIfNotAllConfirmed} = {}) {

        if (!isArray(documents)) documents = [documents]
    
        let documentNames = []
    
        for (let document of documents) {
    
            let {name} = document
            if (includes(documentNames, name)) {
                continue
            }
            documentNames.push(name)
    
            let segments = await this.getSegments_(document, {multilingual: true})
    
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
        }
    }

    /** Options: {
            contextFormat, parseFilenames, convertNewLinesToTags, 
            confirm, documentNames, editIfNonEmpty
        } */
    async pretranslateWith_(document, object, options) {

        let {
            contextFormat, parseFilenames, convertNewLinesToTags, 
            confirm, documentNames, editIfNonEmpty
        } = assign({documentNames: []}, options)

        if (documentNames.includes(document.name)) return
        documentNames.push(document.name)

        console.log(`Pretranslating ${document.name}...`)

        let documentNameWithoutLanguage = parseFilenames && document.name.match(/\w+\.(.+)$/)[1]

        let scroid = this
        let filters = scroid.createFilter({confirmed: false, stage: 1})
        let segments = await scroid.getSegments_(document, {filters, multilingual: true})

        let languageFilesMissing = []

        for (let segment of segments) {
            let {targets} = segment
            remove(targets, target => languageFilesMissing.includes(target.language))

            targetLoop:
            for (let target of targets) {
                
                target.changed = false
                let {language, isConfirmed} = target

                if (!editIfNonEmpty) {
                    if (target.text) continue
                }

                if (target.isConfirmed) {
                    continue
                }

                let string = segment.localizationContext[0]
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
                    text = object[id][language]
                }
                
                if (contextFormat == 'yaml') {
                    let path = id.split('/').slice(1)
                    for (let stop of path) {
                        text = text[stop]
                        if (!text) {
                            console.log(`No key named ${id} for ${language}`)
                            continue targetLoop
                        }
                    }
                }
    
                if (!text) continue

                assign(target, {text})

                if (convertNewLinesToTags) {
                    this.convertToTagsInTarget(target)    
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

            let tryEdit = async () => {
                try {
                    await scroid.editSegment_(document, segment, {confirm})
                } catch(error) {
                    console.log(error)
                    await sleep(2000)
                    process.nextTick(tryEdit)
                }
            }

            await tryEdit()

        }
    }

    setSmartcatAccount(accountName) {
        let smartcatCredentials = this.credentials.smartcat

        if (!accountName) accountName = smartcatCredentials.defaultAccount

        let {auth, server} = smartcatCredentials.accounts[accountName]
        this.subDomain = domainByServer[server]
        let {subDomain} = this

        this.smartcat = new Smartcat({auth, subDomain}).methods
        
        let session = smartcatCredentials.sessionsByServer[server]
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
                authorization: `Bearer ${smartcatCredentials.marketplaceTokensByServer[server]}`
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
        let scroid = this
        let filters = scroid.createFilter({confirmed: false, changed: true, stage: 1})
        let segments = await scroid.getSegments_(document, {filters})


        for (let segment of segments) {
            for (let target of segment.targets) {
                this.convertToTagsInTarget(target)                
            }

            await scroid.editSegment_(document, segment, {confirm: false})
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