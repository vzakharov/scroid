const Axios = require('axios')
const Smartcat = require('smartcat-api')
const _Smartcat = require('smartcat-ud')
const fs = require('fs')
const readYaml = require('read-yaml')
const writeYaml = require('write-yaml')
const json2csv = require('json2csv')
const csv2json = require('csvtojson')
const readline = require('readline').createInterface({input: process.stdin, output: process.stdout})

const {promisify} = require('util')
// const setImmediatePromise = promisify(setImmediate)

const l10n = require('l10n-vz')
const {
    createTableFromHashFiles
} = l10n

const _ = require('lodash')

const {
    assign, capitalize, clone, compact, concat, cloneDeep, filter, find, first, flattenDeep, forEach, 
    get, groupBy, includes, isArray, isFunction, isEqual, isString, isUndefined, keyBy, keys, last, 
    map, mapKeys, mapValues, merge, noop, omit, pick, remove, reverse, round, sample, sortBy, sumBy, 
    toNumber, uniqBy, values
} = _

const {
    AsyncIterable, sleep, getDeep, iterate, setDeep, Select, matchesFilter, renameKeys, lastDefined
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

const schema = scroid => ({
    freelancers: {
        _fetch: ({search}) => scroid._smartcat.freelancers.search(search.freelancers),
        _nativeFilterKeys: function ({
            searchString, namePrefix, 
            withPortfolio, daytime, 
            serviceType, specializations, minRate, maxRate, 
            specializationKnowledgeLevels, rateRangeCurrency, 
            sourceLanguageId, targetLanguageId, 
            onlyNativeSpeakers
        }) { return arguments[0] }
    },
    invoices: {
        _descriptor: 'number',
        _fetch: () => 
            scroid._smartcat.invoices(),
        jobs: {
            _fetch: async ({invoice}) => {
                let jobs = await scroid._smartcat.jobs.invoice(invoice.id)
                for (let job of jobs) {
                    job.isPaid = !!job.datePaidByCustomer
                }
                return jobs
            }
        }
    },
    projects: {
        _defaultFields: ['name', 'url', 'status'],
        _descriptor: 'name',
        _fetch: ({options}) => scroid.getProjects(options),
        _nativeFilterKeys: ['statuses'],
        documents: {
            _fetch: ({project}) => scroid.getDocuments(project),
            _descriptor: 'name',
            segments: {
                _fetch: ({document, search}) => scroid.getSegments(document, {segmentFilter: search.segments}),
                _preNativeFilters: ['confirmed', 'stageNumber', 'changed', 'hasComments'],
                _getNativeFilters: (filters) => {
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
                }, 
                targets: {}
            },
            multidocs: {
                
            },
            workflowStages: {
                _fetch: async( { document, project } ) => {
                    let { documentId, targetLanguageId } = document
                    let assignment = scroid._smartcat.workflowAssignments(
                        project.id, [documentId], targetLanguageId
                    )
                    // Todo: What if we need to update the document list?
                    if ( !scroid.documentLists ) scroid.documentLists = {}
                    let documentListId = await scroid.getDocumentListId(document, assignment)
                    let documents = await assignment.documentsByDocumentListId(documentListId)
                    let multidoc = find(
                        documents, {id: documentId}
                    )
                    let {workflowStages} = find(
                        multidoc.targetDocuments, {targetLanguageId}
                    )
                    merge(document.workflowStages, workflowStages)
                },
                _fetchChildren: async ({ workflowStage, project, document }) => {
                    // Todo: turn 👇 into something prettier
                    await scroid.subSchema['workflowStages']._fetch({ project, document })
                    return workflowStage
                },
                deadline: { _fetch: 'parent' },
                executives: { _fetch: 'parent' },
                freelancerInvitations: { _fetch: 'parent' },
                documentStages: {
                    _fetch: 'parent',
                    documentStageExecutives: {
                        segmentRanges: {}
                    }
                }
            }
        }
    }
})

let decomposeDocumentId = compositeId => {
    let [documentId, targetLanguageId] = compositeId.match(/(^.+)_(\d+)/).slice(1)
    targetLanguageId = toNumber(targetLanguageId)
    return {documentId, targetLanguageId}
}

let targetLanguagesById = {}

class Scroid extends AsyncIterable {

// Fetches

    async fetch_freelancers({ nativeFilters }) {
        return this._smartcat.freelancers.search(nativeFilters)
    }

    async fetch_projects({ nativeFilters }) {
        await this._smartcat.projects().filter(nativeFilters)
        return this._smartcat.ssrProjects().page()
    }

    async getProjects(options = {}) {

        // if (this.projects && !options.source == 'api')
        //     return this.projects

        // projects = await this.smartcat.project().list(options)

        // Todo: make prettier 👇
        let statuses = (options.search && options.search.projects) ?
            options.search.projects.statuses :
            []
        await this._smartcat.projects().filter({statuses})
        let projects = await this._smartcat.ssrProjects().page()
        
        for (let project of projects) {
            project.url = this.link({project}).url
            // project.targetLanguagesById = {}
            if (project.documents) {
                await this.getDocuments(project)
            }

        }
    
        assign(this, {projects})
        this.saveProjects()

        return projects
    
    }

    async do(action, args, options) {
        return this[action](... args, options)
    }

    async getDocumentListId(document, assignment) {
        let { documentId } = document
        if (!this.documentLists) this.documentLists = {}
        let { documentLists } = this
        if (this.hold_documentList)
            await this.hold_documentList
        let documentListId = documentLists[documentId]
        if (!documentListId) {
            this.hold_documentList = (async () => {
                documentLists[documentId] = documentListId = await assignment.createDocumentListId()
            })();
            await this.hold_documentList
            delete this.hold_documentList
        }
        return documentListId
    }

    async fetch(what, args) {
        let {
            project, document, options
        } = args

        try {
            switch(what) {
                case 'freelancers': return this._smartcat.freelancers.search(options.search)
                case 'projects': return this.getProjects(options)
                
                case 'documents': return this.getDocuments(project)
        
                case 'segments': return this.getSegments(document, {segmentFilter: options.search.segments})
        
                // Todo: merge with document.workflowStages
                case 'freelancerInvitations': // fallthrough
                // case 'documentStages':
                case 'executives':
                case 'deadline':
                case 'requiresAssignment':
                // case 'assignmentStages':
                    let { workflowStage } = args
                    // Todo: Fix the thing with deadline
                    if (!workflowStage)
                        return
                    let { documentId, targetLanguageId } = document
                    let assignment = this._smartcat.workflowAssignments(
                        project.id, [documentId], targetLanguageId
                    )
                    if (!this.documentLists) this.documentLists = {}
                    let documentListId = await this.getDocumentListId(document, assignment)
                    let documents = await assignment.documentsByDocumentListId(documentListId)
                    let multidoc = find(
                        documents, {id: documentId}
                    )
                    let {workflowStages} = find(
                        multidoc.targetDocuments, {targetLanguageId}
                    )
                    merge(document.workflowStages, workflowStages)
                    return workflowStage[what]
            }
        } catch(e) {
            console.error(e)
        }

    }

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

    async login(username, password) {
        
        try {
            await this._smartcat.auth.signInUser(username, password)
        } catch(error) {
            throw(lastDefined(error, error.response, error.response.data))
        }

        assign(this, {
            username,
            storageFolder: `${process.env.scroidDir}/private/userStorage/${username}`
        })

        this.load('settings')
        this.load('credentials')

        this._smartcat = new _Smartcat(username)
    }

    async loginToServer(username, password, server) {
        let {_smartcat} = this
        let {credentials} = this
        let response = await _smartcat.auth.signInUser(username, password)
        let {cookie} = response
        credentials.smartcat.sessionsByServer[server] = cookie.match(/id=.*/)[0]
        this.dump({credentials})
        assign(_smartcat._axios.defaults.headers, {cookie})
        return response
    }

    googleSheetLink(args) {
        let link = this.link(args)
        return `=HYPERLINK("${link.url}", "${link.text}")`
    }

    // Todo: Load from tsv/csv
    load(what, asWhat) {
        let value
        try {
            value = readYaml.sync(`${this.storageFolder}/${what}.yaml`)
            let {account} = this
            if (account && value[account.name]) {
                value = value[account.name]
            }
        } catch(error) {
            value = {}
        }
        if (!asWhat) {
            asWhat = what
        }
        this[asWhat] = value
        return value 
    }

    dump(object, alias) {
        if (isString(object)) {
            let key = object
            object = {}
            object[key] = this[key]
        }
        if (isString(alias)) {
            let newObject = {}
            // Todo: multiple aliases for multiple objects
            newObject[alias] = values(object)[0]
            object = newObject
        }
        for (let key in object) {
            let wug = object[key]
            let path = [this.storageFolder, key].join('/')
            writeYaml.sync(path + '.yaml', wug)
            if (isArray(wug)) {
                if (wug.length == 0)
                    continue
                let tsv = json2csv.parse(wug, {flatten: true, delimiter: '\t'})
                fs.writeFileSync(path + '.tsv', tsv)
            }
        }
    }

    async list(what, options) {
        let wugs = await this.all(what, options)

        let {fields} = options
        if (!fields) {
            fields = this.subSchema[what]._defaultFields
        }

        wugs = wugs.map(wug => pick(wug, fields))

        if (options.format != 'yaml') 
            wugs = json2csv.parse(wugs, {flatten: true, delimiter: '\t'})

        let out = {}
        out[what] = wugs
        return out
    }

    
    constructor(username) {

        super(schema)

        if (username) {
            assign(this, {
                username,
                storageFolder: `./private/userStorage/${username}`
            })
    
            this.load('settings')
            this.load('credentials')    
        }

        // let {apiToken} = this.credentials.mixmax
        // this.mixmax = Axios.create({
        //     baseURL: 'https://api.mixmax.com/v1/',
        //     params: {apiToken}
        // })

        this._smartcat = new _Smartcat()


        // this.log = {
        //     project: 'name',
        //     document: document => `${document.name} (${document.targetLanguage})`,
        //     segment: segment => `#${segment.number} → ${segment.localizationContext[0]} → ${segment.source.text}`,
        //     target: target => `${target.language} → ${target.text}`
        // }

        this.hold_documents = {}

    }

    /* Iterators */

    prepareFilters(filters) {
        for (let key in filters) {
            let value = filters[key]
            if (value && value._import) {
                let {_import} = value
                let array = this.load(_import.from)
                let {what} = _import
                if (!what)
                    what = key
                let items = uniqBy(map(array, what), 'id')
                value = items
            } else if (value && !isFunction(value) && !isArray(value) && !isString(value)) {
                this.prepareFilters(value)
            }
        }
    }

    async addPayables(options) {

        let {folder, filename} = options
        let path = folder + filename

        let payables = await csv2json().fromFile(path)
        remove(payables, {added: 'TRUE'})

        let promises = []

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


            promises.push(this._smartcat.jobs.external({
                dateCompleted, currency, executiveUserId, jobDescription, pricePerUnit, unitCount, unitType,
                serviceType: 'Misc'
            }))

            // console.log(response)
        }

        await Promise.all(promises)

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


    async editAssignments(options) {
        let {deadline, team, overwriteDeadline} = {
            team: 'default',
            ... options.set
        }

        let teamTemplate = this.load('teams')[team]
        // Todo: insert the below into iteration, and get team from yaml
        let assigneesByLanguage = await this.getTeam(teamTemplate)

        await this.iterate('workflowStages', async workflowStage => {
            let {assignment, document, project, stageNumber} = workflowStage

            let documentListId = await this.getDocumentListId(document, assignment)

            let saveDeadline = !!deadline
            let addedAssignedUserIds = map(assigneesByLanguage[document.targetLanguage], 'userId')
            if (!overwriteDeadline) {
                //Todo: combine into one function
                if (isUndefined(workflowStage.deadline)) {
                    await this.fetch('deadline', {project, document, workflowStage}) 
                }
                saveDeadline = !workflowStage.deadline
            }
            await assignment.saveAssignments({
                addedAssignedUserIds, deadline, saveDeadline, stageNumber, documentListId
            })
            noop()
        }, options)
        noop()
    }

    async assignFreelancers(options) {

        let {deadline, mode, teamName, stageNumber} = assign({
            mode: 'rocket', teamName: 'default', stageNumber: 1
        }, options)

        let assigneesByLanguage

        if (mode == 'rocket') {
            let teamTemplate = this.load('teams')[teamName]
            assigneesByLanguage = await this.getTeam(teamTemplate)
        }

        let apiCalls = []

        for (let project of this.projects) {
            let documentsByTargetLanguageId = groupBy(project.documents, 'targetLanguageId')
            for (let targetLanguageId in documentsByTargetLanguageId) {
                let documents = documentsByTargetLanguageId[targetLanguageId]
                let {targetLanguage} = documents[0]
                let documentIds = map(documents, 'documentId')
                let freelancerIds = map(assigneesByLanguage[targetLanguage], 'userId')
                let inviteWithAutoAssignment = mode == 'rocket'
                targetLanguageId = toNumber(targetLanguageId)
                
                let assignment = this._smartcat.workflowAssignments(project.id, documentIds, targetLanguageId)
                apiCalls.push((async () => {
                    if (deadline)
                        await assignment.saveAssignments({
                            deadline, saveDeadline: true, stageSelector: stageNumber
                        })
                    try {
                        await assignment.inviteFreelancers({
                            freelancerIds, stage: stageNumber, inviteWithAutoAssignment
                        })
                        noop()
                    } catch(error) {
                        let {status} = error.response
                        console.warn({project, targetLanguage, documentIds})
                        if (status == 400 || status == 500) { 
                            // Could be that some freelancers are already invited, then confirm the assignment
                            console.warn(error)
                            let toSave = {
                                addedAssignedUserIds: [freelancerIds[0]], stageNumber // Todo: choose at random
                            }
                            let {name} = assigneesByLanguage[targetLanguage][0]
                            try {
                                console.warn(`Re-assigning ${name}...`)
                                await assignment.saveAssignments(toSave)
                                console.warn(`${name} re-assigned.`)
                            } catch (error) {
                                // Different assignments for different documents? Let’s try one by one
                                console.warn(`Failed for ${name}. Re-assigning by every document...`)
                                for (let documentId of documentIds) {
                                    try {
                                        console.warn(`Trying ${name} → ${documentId}...`)
                                        await this._smartcat
                                            .workflowAssignments(project.id, [documentId], targetLanguageId)
                                            .saveAssignments(toSave)
                                        console.warn(`Successful for ${name} → ${documentId}`)
                                    } catch(error) {
                                        console.error(`Failed for ${name} → ${documentId}`)
                                    }
                                }
                            }
                            
                        }
                    }
                })())
            }
        }

        await Promise.all(apiCalls)

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
                    this.load('replacements'), 
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

    async complete(what, options) {
        switch (what) {
            case 'documents':
                return this.iterate('documents', async (document) => {
                    try {
                        await this._smartcat.documents(document.documentId).targets(document.targetLanguageId).complete()
                    } catch (error) {
                        console.warning(`Can’t complete document ${document.url}`)
                        return
                    }
                }, options)
            case 'projects':
                return this.iterate('projects', async (project) => {
                    if (options.fixUncompletable) {
                        let projectApi = this._smartcat.projects(project.id)
                        await projectApi.changeStatus(8)                        
                        await projectApi.restoreProjectStatus()
                    }    
                }, options)
        }
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
        // let {folder, filename} = options
        // let path = this.config.folders[folder] + filename
        let {path} = options
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

    async edit(what, options) {
        if (what == 'projects') {
            let {tmName, glossaryName, mtEngineSettings, markupPlaceholders} = options.set
            let resources = this.load('resources')
            let {translationMemories} = resources
            let pretranslateRules = options.set.pretranslate
            if (pretranslateRules) {
                for (let rule of pretranslateRules) {
                    rule.translationMemoryId = translationMemories[rule.tmName]
                    delete rule.tmName
                }
            }

            await this.iterate('projects', async project => {
                {
                    // await this.iterateProjects({filters}, async ({project}) => {
                        let nativeKeys = "name, description, deadline, clientId, domainId, vendorAccountId, externalTag".split(', ')
                        let nativeSettings = assign(
                            pick(project, nativeKeys), 
                            pick(options.set, nativeKeys)
                        )
                        let projectApi = this.smartcat.project(project.id)
                        try {
                            await projectApi.put(nativeSettings)
                        } catch (error) {
                            throw(error)
                        }
            
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
                    }
            }, options)
        }
    }

    async editProject(options) { //, filters) {
        let {tmName, glossaryName, mtEngineSettings, markupPlaceholders} = options
        let resources = this.load('resources')
        let {translationMemories} = resources
        let pretranslateRules = options.pretranslate
        if (pretranslateRules) {
            for (let rule of pretranslateRules) {
                rule.translationMemoryId = translationMemories[rule.tmName]
                delete rule.tmName
            }
        }

        for (let project of this.projects) {
        // await this.iterateProjects({filters}, async ({project}) => {
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
        }
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


    async filterDocuments(filter) {
        for (let project of this.projects) {
            remove(project.documents, document => !matchesFilter(document, filter))
        }
        this.saveProjects()
    }

    async filterProjects(filter) {
        remove(this.projects, project => !matchesFilter(project, filter))
        this.saveProjects()
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

        this.dump({termsMatchingRegexp})
    }

    async getDocumentsWithoutInvitations(options, filters) {
        let documentsWithoutInvitations = []
        let apiCalls = []

        await this.iterateProjects({filters}, async ({project}) => {
            let documents = filter(project.documents, filters.documentFilter)
            apiCalls.push(
                this._smartcat.projects(project.id).team().then(team => {
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
                        if (options.valuesToSave)
                            document = pick(document, options.valuesToSave)
                        documentsWithoutInvitations.push(document)
                    }
                    this.dump({documentsWithoutInvitations})    
                })
            )
        })

        await Promise.all(apiCalls)
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
        
        this.dump({allComments})

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
            

            this.dump({contacts})
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

    async getAssignments() {
        let promises = []

        for (let project of this.projects) {
            for (let document of project.documents) {
                promises.push((async () => {
                    let {documentId, targetLanguageId} = document
                    document.assignment = await this._smartcat.workflowAssignments(project.id, [documentId], targetLanguageId).info()
                })())
            }
        }

        await Promise.all(promises)
        this.saveProjects()
    }

    async getJobs() {
        let apiCalls = []

        for (let project of this.projects) {
            apiCalls.push(
                this._smartcat.projects(project.id).team().then(team => {
                    project.jobs = team.executivesByJobStatus
                })
            )
        }

        await Promise.all(apiCalls)
        this.saveProjects()
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
            this.dump({documentWordcounts})
        })

        return documentWordcounts
    }

    async getProject(projectName) {

        let projects = (
            await this.getProjects({projectName})
        )
    
        return projects.find(project => project.name == projectName)
    
    }


    async getDocuments(project) {
        for (let targetLanguage of project.targetLanguages) {
            let { id, cultureName } = targetLanguage
            if (!targetLanguagesById[id])
                targetLanguagesById[id] = cultureName
        }
        if (!project.documents) {
            project.documents = []
            let multidocs = await this._smartcat.projects(project.id).allDocuments()
            for (let multidoc of multidocs) {
                let { wordsCount } = multidoc
                for (let document of multidoc.targets) {
                    renameKeys(document, {languageId: 'targetLanguageId'})
                    document.id = [document.documentId, document.targetLanguageId].join('_')
                    document.targetLanguage = targetLanguagesById[document.targetLanguageId]
                    document.name = [multidoc.name, document.targetLanguage].join('_')
                    assign(document, { wordsCount, multidoc})                    
                    project.documents.push(document)
                }
            }
        }

        for (let document of project.documents) {
            let {documentId, targetLanguageId} = decomposeDocumentId(document.id)
            assign(document, {documentId, targetLanguageId})
            document.url = this.link({document}).url
            // if (!project.targetLanguagesById[targetLanguageId]) {
            //     project.targetLanguagesById[targetLanguageId] = document.targetLanguage
            // }
            
            let i = 1
            for (let stage of document.workflowStages) {
                stage.stageNumber = i++
                stage.wordsLeft = document.wordsCount - stage.wordsTranslated
                for (let assignee of stage.executives || []) {
                    renameKeys(assignee, {id: 'userId'})        
                }
                stage.assignment = this._smartcat.workflowAssignments(project.id, [documentId], targetLanguageId)
            }
    
            Object.defineProperty(document, 'project', {get: () => project})
        }

        return project.documents
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

    async getSegments(document, {segmentFilter, multilingual}) {

        let segments = []
        let {documentId, targetLanguageId} = document
    
        let start = 0, limit = 5000

        let params = {
            mode: 'manager'
        }

        let releaseDocument = () => {}
        if (segmentFilter) {
            segmentFilter = clone(segmentFilter)
            let nativeFilters = this.getNativeFilters(segmentFilter)
            while ( this.hold_documents[documentId] )
                await this.hold_documents[documentId]
            this.hold_documents[documentId] = new Promise(resolve => releaseDocument = () => {
                resolve()
                delete this.hold_documents[documentId]
                console.log(this.hold_documents)
            })
            let filterSetId = await this.getFilterSetId(document, nativeFilters)
            assign(params, {filterSetId})
        }

        while(1) {
        
            assign(params, {start, limit})

            if (!multilingual) {
                assign(params, {languageIds: targetLanguageId})
                //params._page = 'editor'
            }
        
            let {total, items} = await this._smartcat.segments(documentId, params)
            releaseDocument()
            
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
                target.language = targetLanguagesById[target.languageId]
            }
        }
    
        return segments
        
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

    async getDocumentsByLanguageAndProjectId(filters) {

        let documentsByLanguageAndProjectId = {}

        await this.iterateDocuments(filters, ({document, project}) => {
            let documents = getDeep(documentsByLanguageAndProjectId, [document.targetLanguage, project.id], [])
            documents.push(document)
        })

        return documentsByLanguageAndProjectId
    }

    async getTeam(teamTemplate, {includeEmails} = {}) {

        let assigneesByLanguage = {}
        let assignees = []
        let smartcatTeam = await this.downloadMyTeam()
        this.dump({smartcatTeam})
    
        for (let languageKey in teamTemplate) {
            let languages = languageKey.split(',')

            let names = teamTemplate[languageKey]
            if (!isArray(names)) names = [names]
            for (let name of names) {
                // console.log({name})
                let assignee = find(smartcatTeam, assignee => compact([assignee.firstName, assignee.lastName]).join(' ') == name)
                
                if (!assignees.includes(assignee)) {
                    assignees.push(assignee)
                    assign(assignee, {name})
                    if (assignee.id) renameKeys(assignee, {id: 'userId'})
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

    removeDocumentsWithInvitations() {
        for (let project of this.projects) {
            let {documents} = project
            for (let executivesByThisJobStatus of project.jobs) {
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
        }
        
        this.saveProjects()
    }

    saveDocuments(args) {
        let documents = []
        for (let project of this.projects) {
            for (let document of project.documents) {
                if (args.valuesToSave)
                    document = pick(document, args.valuesToSave)
                documents.push(document)
            }
        }
        assign(this, {documents})

        let {saveAs} = args
        if (!saveAs) saveAs = 'documents'
        let toSave = {}
        toSave[saveAs] = documents
        this.dump(toSave)
    }

    saveProjects() {
        let {projects} = this
        this.dump({projects})
    }

    async setAccount(name) {
        let accounts = this.load('accounts')

        // if (!name) name = this.settings.defaultAccount
        // if (!name) name = accounts[0].name

        let account = find(accounts, {name})

        assign(this, {account})

        let {auth, server, fullName} = account

        if (fullName)
            name = fullName

        this.subDomain = domainByServer[server]
        let {subDomain} = this

        this.smartcat = new Smartcat({auth, subDomain})

        let {credentials} = this        

        let {username, password} = credentials.smartcat.login

        let session = this.credentials.smartcat.sessionsByServer[server]
        let cookie = `session-${serverSessionSuffix[server]}=${session}`    

        let _defaults = {
            baseURL: `https://${subDomain}smartcat.ai/api/`,
            headers: {cookie}
        }

        this.__smartcat = Axios.create(_defaults)

        this._smartcat = new _Smartcat({cookie, subDomain})

        let {_smartcat} = this

        let getContext = async () => {
            let {userContext, accountContext} = await _smartcat.userContext()
            let {isAuthenticated, inAccount} = userContext
            if (!inAccount) {
                if (isAuthenticated)
                    await _smartcat.auth.logout()
                let {redirectUrl} = await this.loginToServer(username, password, server)
                if (redirectUrl.match(/CrossAuth/)) {
                    let {accountId} = auth
                    await _smartcat.auth.loginToAccount({accountId})
                }
                return await getContext()
            } else {
                return {userContext, accountContext}
            }    

         }
        
        let {accountContext} = await getContext()

        let {accountName, availableAccounts} = accountContext

        if (accountName != name) {
            let availableAccount = find(availableAccounts, {name})
            await _smartcat.account.change(availableAccount.id)
        }


        // _smartcat._beforeExecute = async () => {
        //     let {headers} = this._axios
        //     if (!headers.cookie) {
        //         headers.cookie = await this.auth.signInUser(username, password)
        //     }
        // }
    
        _smartcat._onError = async ({tryExecute, executeArgs = {}, stem, error}) => {
            let {response, code} = error
            if (response) {
                let {status} = response
                if (status == 403 && !executeArgs.ignore403) {
                    while (stem._state.relogin == 'inProgress') {
                        await sleep(stem._options._rateLimit)
                    }
                    let {relogin} = stem._state
                    this.load('credentials')
                    let {cookie} = error.request._headers
                    let newCookie = stem._axios.defaults.headers.cookie
                    if (cookie != newCookie) {
                        console.log('Cookie has changed; trying with the new one...')
                        cookie = newCookie
                    } else {
                        if (relogin == 'completed') {
                            throw(error)
                        } else {
                            console.log('Trying to re-login...')
                            stem._state.relogin = 'inProgress'
                            cookie = (await _smartcat.auth.signInUser(username, password)).cookie
                            credentials.smartcat.sessionsByServer[server] = cookie.match(/id=.*/)[0]
                            this.dump({credentials})
                            assign(stem._axios.defaults.headers, {cookie})
                            await _smartcat.account.change(auth.accountId)
                            stem._state.relogin = 'completed'
                        }
                    }
                    return await tryExecute({ignore403: true})
                } else
                    throw(error)
            } else {
                if (code == 'ETIMEDOUT' || code == 'ECONNRESET') {
                    console.log(`${code}. Trying again...`)
                    return tryExecute
                } else {
                    throw(error)
                }
            }
        }    

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

    async store(key, options) {
        let wugs = await this.all(key, options)
        this[key] = wugs
        let paths = options.include
        if (paths) {
            wugs = map(wugs, wug => {
                let newWug = {}
                for (let path of paths) {
                    let key = path
                    if (!isString(path)) {
                        key = keys(path)[0]
                        path = path[key]
                    }
                    newWug[key] = get(wug, path)
                }
                return newWug
            })
        }
        let saveAs = options.as
        if (!saveAs)
            saveAs = key
        this.dump({wugs}, saveAs)
    }

    async call(path, data) {
        if (!isArray(data)) {
            data = [data]
        }
        let paths = path.split('/')
        let result = this
        let i = data.length - paths.length
        for (let subPath of paths) {
            let func = get(result, subPath)
            result = await func(data[i])
            i++
        }
        assign(this, {result})    
    }

    async with(what, options) {
        let { action, args } = options
        await this.iterate(what, async project =>
            this._smartcat[what](project.id)[action](args),
            options
        )
    }

    async waitForInput({query}) {
        await new Promise(resolve => readline.question(query, ans => {
            readline.close();
            resolve(ans);
        }))
    }

}



module.exports = Scroid