const Axios = require('axios')
const Smartcat = require('smartcat-api')
const _Smartcat = require('smartcat-ud')
const fs = require('fs')
const readYaml = require('read-yaml')
const writeYaml = require('write-yaml')
const json2csv = require('json2csv')
const csv2json = require('csvtojson')
const readline = require('readline').createInterface({input: process.stdin, output: process.stdout})
const { GoogleSpreadsheet } = require('google-spreadsheet')

const {promisify} = require('util')
// const setImmediatePromise = promisify(setImmediate)

const l10n = require('l10n-vz')
const {
    createTableFromHashFiles
} = l10n

const _ = require('lodash')

const {
    assign, capitalize, clone, compact, concat, cloneDeep, difference, filter, find, findKey, first, flattenDeep, forEach, 
    get, groupBy, includes, indexOf, isArray, isFunction, isEqual, isString, isUndefined, keyBy, keys, last, 
    map, mapKeys, mapValues, merge, noop, omit, pick, remove, reverse, round, sample, sortBy, sumBy, 
    toNumber, uniqBy, values
} = _

const {
    AsyncIterable, sleep, getDeep, setGetters,
    iterate, setDeep, Select, matchesFilter, renameKeys, lastDefined,
    QuotaWatcher
} = require('vz-utils')

const pluralize = require('pluralize')

const subdomainByRegion = {
    eu: '',
    us: 'us.',
    ea: 'ea.'
}

const sessionSuffixByRegion = {
    eu: 'ru', us: 'us', ea: 'ea'
}

const {stringify} = JSON

const sheetReader = new QuotaWatcher({ rateLimit: 10, watchPeriod: 100, maxCallsPerPeriod: 100 })
const sheetWriter = new QuotaWatcher({ rateLimit: 10, watchPeriod: 100, maxCallsPerPeriod: 100 })


const schema = scroid => ({
    spreadsheets: {
        _nativeFilterKeys: ['id'],
        sheets: {}
    },
    convos: {
        _nativeFilterKeys: ['unseen']
    },
    exchangeRates: {},
    languages: {
        _descriptor: 'name'
    },
    nativeServices: {
        _descriptor: 'name',
    },
    freelancers: {
        // _: {
        //     inheritance: [
        //         'nativeService', { sourceLanguage: 'language'}, { targetLanguage: 'language' }
        //     ]
        // },
        _nativeFilterKeys: [
            'searchString', 'namePrefix', 
            'withPortfolio', 'daytime', 
            'serviceType', 'specializations', 'minRate', 'maxRate', 
            'specializationKnowledgeLevels', 'rateRangeCurrency', 
            'sourceLanguageId', 'targetLanguageId', 
            'onlyNativeSpeakers', 'accountId', 'searchMode'
        ]
    },
    installations: {
        _: {
            descriptor: 'region',
            freeze: true
        },
        accounts: {
            _: {
                id: 'id',
                descriptor: 'name',
                freeze: true
            },
            invoices: {
                _descriptor: 'number',
                invoiceJobs: {}
            },
            jobs: {
                _id: 'id',
                _descriptor: 'id',
                _nativeFilterKeys: [
                    'paymentStateFilter', 'userId', 'projectNamePrefix', 'invoiceId', 'payUntil'
                ]
            },        
            teams: { },
            members: {
                _nativeFilterKeys: [
                    'serviceType', 'sourceLanguage', 'targetLanguage', 'onlyNativeSpeakers',
                    'allDialects', 'minRate', 'maxRate', 'rateRangeCurrency', 'specializations',
                    'specializationKnowledgeLevel', 'searchString', 'daytime'
                ],
                memberProfile: { }
            },
            projects: {
                _defaultFields: ['name', 'url', 'status'],
                _descriptor: 'name',
                _nativeFilterKeys: [
                    'clientAccountIds', 'clientIds', 'createdByIds', 'creationDateFrom', 'creationDateTo',
                    'deadlineFrom', 'deadlineTo', 'domainIds', 'managerUserIds', 'searchName', 'sourceLanguageIds',
                    'statuses', 'targetLanguageIds', 'withoutClients', 'withoutManagers'
                ],
                assignments: {
                    assignedDocuments: {}
                },
                multidocs: {
                    _descriptor: 'name',
                    commentThreads: {
                        commentThreadText: {},
                        comments: {}
                    },
                    multidocStages: {},
                    sourceSegments: {},
                    documentList: {},
                    documents: {
                        _descriptor: 'name',
                        segments: {
                            _fetch: ({document, search}) => scroid.getSegments(document, {segmentFilter: search.segments}),
                            _nativeFilterKeys: ['not-confirmed', 'confirmed', 'stageNumber', 'changed', 'hasComments'], 
                            targets: {}
                        },
                        workflowStages: {
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
                },
                fullDetails: {

                },
                translationMemories: {}
            }
        }
    }
})

let decomposeDocumentId = compositeId => {
    let [documentId, targetLanguageId] = compositeId.match(/(^.+)_(\d+)/).slice(1)
    targetLanguageId = toNumber(targetLanguageId)
    return {documentId, targetLanguageId}
}

let languagesById = {}

class Scroid extends AsyncIterable {

// Fetches

    async fetch_spreadsheets({ nativeFilters }) {
        let { ids } = nativeFilters
        if (!isArray(ids)) ids = [ids]
        let spreadsheets = []
        for ( let id in ids ) {
            let doc = new GoogleSpreadsheet(id)
            await sheetReader.run(() => doc.useServiceAccountAuth(this.credentials.google))
            await sheetReader.run(() => doc.loadInfo())
            doc.sheets = doc.sheetsByIndex
            spreadsheets.push(doc)
        }
        return spreadsheets
    }


    async fetch_convos({ nativeFilters }) {
        let { unseen } = nativeFilters
        if (unseen) {
            return this._smartcat.chat.messages.unseen()
        }
    }

    fetch_exchangeRates() { return this._smartcat.freelancers.exchangeRates() }

    async fetch_languages () { 
        return this._smartcat.languages()
    }

    async fetch_nativeServices () { 
        return map({
            1: 'Translation',
            2: 'Editing',
            3: 'Proofreading',
            4: 'Postediting'
        }, (name, id) => ({ id, name }))
    }

    async fetch_languagePairs () {

        // Todo: introduce two-level iterators
        let { languagePairs } = this
        if ( languagePairs ) return languagePairs

        languagePairs = []
        let languages = await this.fetch('languages')
        for (let sourceLanguage of languages) {
            for (let targetLanguage of languages) {
                if ( sourceLanguage != targetLanguage ) {
                    languagePairs.push({
                        name: map([sourceLanguage, targetLanguage], 'cultureName').join(' to '),
                        sourceLanguage,
                        targetLanguage
                    })
                }
            }
        }

        assign(this, { languagePairs })
        return languagePairs
    }


    async fetch_freelancers({ 
        // languagePair, nativeService, 
        nativeFilters 
    }) {
        // let { sourceLanguage, targetLanguage } = languagePair
        return this._smartcat.freelancers.search({
            // targetLanguageId: targetLanguage.id,
            // sourceLanguageId: sourceLanguage.id,
            // serviceType: nativeService.id,
            ... nativeFilters
        })
    }

    async fetch_invoices() { return this._smartcat.invoices.get() }

    async fetch_jobs({ nativeFilters }) { return this._smartcat.jobs.get(nativeFilters) }

    async normalize_job(job) {
        let { executiveCurrency, cost } = job
        if ( executiveCurrency != 1 ) {
            let exchangeRates = await this.fetch('exchangeRates')
            let exchangeRate = exchangeRates[executiveCurrency]
            job.costUSD = cost * 1.0 / exchangeRate    
        } else {
            job.costUSD = cost
        }
    }

    async fetch_installations() { return this._smartcat.installations() }

    async fetch_accounts({ installation }) {
        let { _smartcat } = this
        let { region } = installation
        let accounts = 
            region == this.region
            ?
            await _smartcat.auth.getAccountsForUser()
            : await _smartcat.accounts(region)
        remove(accounts, {isPersonal: true})

        let savedAccounts = filter(this.load('accounts'),  { region })
        for ( let savedAccount of savedAccounts) {
            let { name } = savedAccount
            let matchingAccount = find(accounts, { name })
            assign(matchingAccount, savedAccount )
        }

        return accounts
    }

    async normalize_account( account ) {
        assign(account, {
            alias: account.alias || account.name,
            subdomain: subdomainByRegion[account.installation.region]
        })
    }

    async set_account(account) {
        let { _smartcat, region } = this
        let { id, installation, name, auth } = account
        if ( installation.region == region ) {
            this.smartcat = new Smartcat(auth, subdomainByRegion[region])
            return _smartcat.auth.loginToAccount(id)
        }
        else {
            let { region } = installation
            await _smartcat.loginToRemoteAccount(installation.region, account.id)
            _smartcat = this.setRegion(region)

            let getContext = async () => {
                let { username, password } = this.credentials.smartcat.login

                let {userContext, accountContext} = await _smartcat.userContext()
                let {isAuthenticated, inAccount} = userContext
                if (!inAccount) {
                    if (isAuthenticated)
                        await _smartcat.auth.logout()
                    let {redirectUrl} = await this.loginToServer(username, password, region)
                    if (redirectUrl.match(/CrossAuth/)) {
                        await _smartcat.auth.loginToAccount(auth.accountId)
                    }
                    return await getContext()
                } else {
                    return {userContext, accountContext}
                }    
    
            }
            
            let {accountContext} = await getContext()
    
            let {accountName, availableAccounts} = accountContext
    
            if (accountName != name) {
                let availableAccount = find(availableAccounts, { name })
                await _smartcat.account.change(availableAccount.id)
            }

            let { auth } = account
            let subdomain = subdomainByRegion[region]    
            this.smartcat = new Smartcat(auth, subdomain)
    
    
        }
    }

    // async fetch_freelancers({ account, nativeFilters }) {
    //     return this._smartcat.freelancers.search({
    //         accountId: account.id,
    //         ... nativeFilters
    //     })
    // }

    async fetch_teams() {
        return this.load('teams')
    }

    async fetch_members({ nativeFilters, account }) {
        let members = await this.smartcat.account.searchMyTeam(nativeFilters)

        // Todo: Somehow move 👇 to normalize (introduce post_fetch or normalize_ for plural?)
        for (let member of members) {
            let { firstName, lastName } = member
            let name = [firstName, lastName].join(' ')
            // assign(member, {
            //     name, teams: []
            // })
            renameKeys(member, {id: 'userId'})
        }

        // let teams = await this.fetch('teams', { account })
        // for ( let team in teams ) {
        //     let teamByTargetLanguage = teams[team]
        //     for ( let targetLanguage in teamByTargetLanguage) {
        //         let teamMembers = teamByTargetLanguage[targetLanguage]
        //         if ( !isArray(teamMembers) ) teamMembers = [ teamMembers ]
        //         for (let name of teamMembers ) {
        //             let matchingMember = find(members, { name })
        //             if ( !matchingMember )
        //                 continue
        //             // Todo: turn 👇 into an array
        //             matchingMember.teams.push({team, targetLanguage})
        //         }
        //     }
        // }

        return members
    }

    async fetch_memberProfile({ member }) {
        let profile = await this._smartcat.freelancers.profile(member.userId)
        return profile
    }

    async normalize_memberProfile( profile ) {
        profile.clientNames = map(profile.myTeamClientIds, id => find(profile.accountClients, {id}).name)
        if ( profile.nativeLanguageId ) {
            profile.nativeLanguage = await this.getLanguageById(profile.nativeLanguageId)
            return 
        }
    }

    async fetch_invoiceJobs({ invoice }) {
        let jobs = await this._smartcat.jobs.invoice(invoice.id)
        for (let job of jobs) {
            job.isPaid = !!job.datePaidByCustomer
        }
        return jobs
    }

    async fetch_projects({ nativeFilters }) {
        await this._smartcat.projects().filter(nativeFilters)
        return this._smartcat.ssrProjects().page()
    }

    normalize_project( project ) {
        // Todo: Use some one-off function to find out all culture names at startup
        for (let targetLanguage of project.targetLanguages) {
            let { id } = targetLanguage
            if (!languagesById[id])
                languagesById[id] = targetLanguage.cultureName
        }
        if (!project.translationMemories)
            delete project.translationMemories
        project.url = `https://${project.account.subdomain}smartcat.ai/project/${project.id}`
    }

    async fetch_multidocs({ project }) {
        return this._smartcat.projects(project.id).allDocuments()
    }

    normalize_multidoc(multidoc) {
        renameKeys(multidoc, {targets: 'documents', id: 'documentId' })
    }

    normalize_document(document, { multidoc }) {
        let { wordsCount } = multidoc
        renameKeys(document, {languageId: 'targetLanguageId'})
        document.id = [document.documentId, document.targetLanguageId].join('_')
        document.targetLanguage = languagesById[document.targetLanguageId]
        document.name = [multidoc.name, document.targetLanguage].join('_')
        // document.url = this.link({document}).url
        document.url = `https://${document.account.subdomain}smartcat.ai/editor?documentId=${document.documentId}&languageId=${document.targetLanguageId}`
        assign(document, { wordsCount })
    }

    async fetch_documentList({ multidoc, project }) {
        return {
            id: await this._smartcat
                .workflowAssignments(project.id, [ multidoc.documentId ])
                .createDocumentListId()
        }
    }

    async fetch_multidocStages(parents) {
        let { multidoc, project } = parents
        let assignment = this._smartcat.workflowAssignments(
            project.id
        )

        // Todo: What if we need to update the document list?
        // if ( !this.documentLists ) this.documentLists = {}
        let documentList = await this.fetch('documentList', parents)
        // let documentListId = await this.getDocumentListId(multidoc)
        let multidocStages = await assignment.getWorkflowStages({ documentListId: documentList.id })
        return multidocStages
    }

    async normalize_multidocStage(stage) {
        stage.targetLanguage = languagesById[stage.targetLanguageId]
        stage.stageNumber = parseInt(stage.id)
        delete stage.id
        stage.deadline = stage.documents[0].deadline
        delete stage.documents
    }

    async fetch_workflowStages(parents) {
        let { document } = parents
        let { targetLanguageId } = document

        let multidocStages = await this.fetch('multidocStages', parents)
        let workflowStages = filter(multidocStages, { targetLanguageId })
        merge(document.workflowStages, workflowStages)
        return document.workflowStages
    }

    normalize_workflowStage(stage, { project, document }) {
        let { documentId, targetLanguageId } = document
        stage.wordsLeft = document.wordsCount - stage.wordsTranslated
        for (let assignee of stage.executives || []) {
            renameKeys(assignee, {id: 'userId'})        
        }
        stage.assignment = this._smartcat.workflowAssignments(project.id, [documentId], targetLanguageId)
        renameKeys(stage, {
            number: 'stageNumber'
        })
    }

    async fetch_segments({ document, nativeFilters }) {

        let { documentId, targetLanguageId } = document
    
        let releaseDocument = () => {}
        let filterSetId
        if (nativeFilters) {
            while ( this.freeze_documents[documentId] )
                await this.freeze_documents[documentId]
            this.freeze_documents[documentId] = new Promise(resolve => releaseDocument = () => {
                resolve()
                delete this.freeze_documents[documentId]
                console.log(this.freeze_documents)
            })
            filterSetId = await this.getFilterSetId(document, nativeFilters)
        }

        let segments = await this._smartcat.segments().get(documentId, targetLanguageId, filterSetId)
        releaseDocument()

        return segments
        
    }

    nativeFilters_segments(filters) {
        let { 
            confirmed, stageNumber, changed, hasComments 
        } = filters
        let nativeFilters = []
        
        if (!isUndefined(confirmed)) {
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

    normalize_target (target) {
        target.language = languagesById[target.languageId]
    }

    async fetch_sourceSegments({ multidoc, nativeFilters }) {
        // let documents = await this.fetch('documents', { project, multidoc })
        let document = multidoc.documents[0]
        let sourceSegments = await this.fetch_segments({ document , nativeFilters })
        return sourceSegments
    }

    async fetch_commentThreads(parents) {
        // Todo: user sourceSegments below
        let documents = await this.fetch('documents', parents)
        let document = documents[0]
        let segments = await this.fetch('segments', { ... parents, document }, { filters: { segments: { hasComments: true }}})
        let commentThreads = map(segments, segment => ({
            id: segment.topicId,
            read: segment.commentState == 1,
            sourceText: segment.source.text,
            segmentNumber: segment.number
        }))
        return commentThreads
    }

    async fetch_commentThreadText(parents) {
        let comments = await this.fetch('comments', parents)
        let commentThreadText = map(comments, comment => {
            let { created, userName, isRemoved, text } = comment
            return `${created.slice(0, 16)} ${userName}: ${ isRemoved ? '[Removed]' : text }`
        }).join('\n\n')
        return commentThreadText
    }

    async fetch_comments({ commentThread, multidoc }) {
        let comments = await this._smartcat.topics(commentThread.id).comments(multidoc.id, 'SEGMENT')
        return comments
    }

    normalize_comment(comment) {
        comment.uid = [comment.commentThread.id, comment.id].join('_')
    }

    async fetch_fullDetails({ project }) {
        return this._smartcat.projects(project.id).full()
    }

    async fetch_translationMemories({ project }) {
        let fullDetails = await this.fetch('fullDetails', { project })
        return fullDetails.translationMemories.wholeProjectTranslationMemories.translationMemories
    }

    setRegion(region) {
        let session = this.credentials.smartcat.sessionsByServer[region]
        let cookie = `session-${sessionSuffixByRegion[region]}=${session}`
        let subdomain = subdomainByRegion[region]
        assign(this, { region })
        return this._smartcat = new _Smartcat({cookie, subdomain})
    }

    async getLanguageById(id) {
        let languages = await this.fetch('languages')
        return find(languages, { id }).cultureName
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


    link({project, document, segment}) {
        let domain = `https://${this.subdomain}smartcat.ai`
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
            let { account } = this
            if (account) {
                let { name, alias } = account
                name = alias || name
                if ( value[name] ) {
                    value = value[name]
                }    
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
        let wugs = await this.select(what, options)

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

        this.setRegion('us')
        let { _smartcat } = this

        this.freeze_documents = {}
        this.freeze = {}
        this.unfreeze = {}
        this.unfrozen = {}

        _smartcat._onError = async ({execute, executeArgs = {}, stem, error}) => {
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
                            let { credentials } = this
                            console.log('Trying to re-login...')
                            stem._state.relogin = 'inProgress'
                            let {username, password} = credentials.smartcat.login
                            cookie = (await _smartcat.auth.signInUser(username, password)).cookie
                            let region = findKey(sessionSuffixByRegion, r => r == cookie.match(/(?<=session-)\w+/)[0])
                            credentials.smartcat.sessionsByServer[region] = cookie.match(/id=.*/)[0]
                            this.dump({credentials})
                            assign(stem._axios.defaults.headers, {cookie})
                            // await _smartcat.account.change(auth.accountId)
                            stem._state.relogin = 'completed'
                        }
                    }
                    return await execute({ignore403: true})
                } else
                    throw(error)
            } else {
                if (code == 'ETIMEDOUT' || code == 'ECONNRESET' || code == 'ENOTFOUND') {
                    console.log(`${code}. Trying again...`)
                    return await execute()
                } else {
                    throw(error)
                }
            }
        }    


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

        let {folder, filename, uniqueOnly} = options
        let path = folder + filename

        let payables = await csv2json().fromFile(path)
        remove(payables, {added: 'TRUE'})
            
        await this.iterate('accounts', options, async ({ account }) => {
    
            let existingJobs = uniqueOnly &&
                await this.select('jobs', {
                    filters: {
                        accounts: {
                            name: account.name
                        }
                    }
                })

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
        })

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
        let { assigneeFilter, assignWithoutInviting, inviteWithAutoAssignment, deadline, overwriteDeadline } =
            options.set

        // Todo: insert the below into iteration, and get team from yaml
        // let teamTemplate = this.load('teams')[team]
        // let assigneesByLanguage = await this.getTeam(teamTemplate)

        let assigneesByLanguageByAccount = {}

        // options.wait = true

        await this.iterate('workflowStages', options, async workflowStage => {
            // let { account } = workflowStage
            // let assigneesByLanguage = assigneesByLanguageByAccount[account.id]
            // if (!assigneesByLanguage) {
            //     let teamTemplate = this.load('teams')[team]
            //     assigneesByLanguage = await this.getTeam(teamTemplate)
            //     assigneesByLanguageByAccount[account.id] = assigneesByLanguage
            // }

            let { account, assignment, document, project, stageNumber: stageNumber, multidoc } = workflowStage
            let targetLanguages = map(multidoc.documents, 'targetLanguage')
            let sourceLanguage = project.sourceLanguage.cultureName
            let { targetLanguage, targetLanguageId } = document
            // Todo: add workflowstage check besides source & target language
            let members = await this.select('members', {
                reload: 'members',
                filters: {
                    ... options.filters,
                    members: {
                        sourceLanguage,
                        services: {
                            contain: {
                                targetLanguage: targetLanguages
                            }
                        },
                        ... assigneeFilter
                    }
                }
            })
            let freelancers = filter(members, member =>
                !!find(member.services, {
                    sourceLanguage, targetLanguage
                })
            )
            let freelancerIds = map(
                freelancers, 
                'userId'
            )

            let documentListId = (
                await this.fetch('documentList', { project, multidoc })
            ).id

            let saveDeadline = !!deadline
            if (!overwriteDeadline) {
                //Todo: combine into one function
                if (isUndefined(workflowStage.deadline)) {
                    await this.fetch('deadline', {project, document, workflowStage}) 
                }
                saveDeadline = !workflowStage.deadline
            }
            if ( assignWithoutInviting ) {
                await assignment.saveAssignments({
                    addedAssignedUserIds: freelancerIds, deadline, saveDeadline, stageNumber, documentListId
                })
            } else {
                await assignment.inviteFreelancersByDocumentListId({
                    freelancerIds, deadline, saveDeadline, stage: stageNumber, documentListId, inviteWithAutoAssignment, targetLanguageId
                })
            }
            noop()    
        })
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
                return this.iterate('documents', options, async (document) => {
                    try {
                        await this._smartcat.documents(document.documentId).targets(document.targetLanguageId).complete()
                    } catch (error) {
                        console.warning(`Can’t complete document ${document.url}`)
                        return
                    }
                })
            case 'projects':
                return this.iterate('projects', options, async (project) => {
                    let projectApi = this._smartcat.projects(project.id)
                    if (options.fixUncompletable) {
                        await projectApi.changeStatus(8)                        
                        await projectApi.restoreProjectStatus()
                    } else {
                        await projectApi.changeStatus(3)
                    }
                })
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

    createInvoice(options) {
        let { jobIds } = options
        if ( !jobIds ) {
            let { jobs } = this
            jobIds = map(jobs, 'id')
        }
        if ( !jobIds ) throw new Error("No jobs selected.")
        return this._smartcat.invoices.post({ jobIds, ... options})
    }

    async processFile(options) {
        let { path, replace } = options

        let content = fs.readFileSync(path).toString()

        if (replace) {
            for ( let replacement of replace ) {
                let { from, to, flags } = replacement
                let rx = new RegExp(from, flags || 'g')
                content = content.replace(rx, to)
            }
        }

        fs.writeFileSync(path, content)
    }

    async getSourceFromSheet(sheetId) {
        let doc = new GoogleSpreadsheet(sheetId)
        await doc.useServiceAccountAuth(this.credentials.google)
        await doc.loadInfo()

        const nonLanguageHeadings = ['id', 'comments', 'maxLen']

        for ( let sheet in doc.sheetsByIndex ) {

            await sheet.loadHeaderRow()
            let languageHeadings = difference(sheet.headerValues, nonLanguageHeadings)
            let sourceLanguage = languageHeadings[0]
            let targetLanguages = languageHeadings.slice(1)
            let rows = await sheet.getRows()
            let content = JSON.stringify(map(rows, row =>
                row.id ?
                    {[row.id]: row[sourceLanguage]} :
                    row[sourceLanguage]
            ))
            let name = sheet.title + '.json'
            return { name, content, sourceLanguage, targetLanguages }
    
        }
    }

    async createProject(options) {
        this.iterate('accounts', options, async () => {
            let { path, sheet } = options
            let apiOptions = pick(options, [
                'sourceLanguage', 'targetLanguages', 'workflowStages', 'translationMemoryId', 'deadline', 'name'
            ])

            let file = {}
            if (path) {
                file = {
                    content: fs.readFileSync(path),
                    name: path.match(/[^/\\]+$/)[0]
                }    
            } else if (sheet) {
                let {name, content, sourceLanguage, targetLanguages} = await this.getSourceFromSheet(sheet.id)
                assign(file, {name, content})
                assign(apiOptions, {sourceLanguage, targetLanguages})
            }
    
            if (options.clientName) {
                apiOptions.clientId = await this.getClientId(options.clientName)
            }
    
            if (!options.name) {
                apiOptions.name = file.name
            }
    
            if (options.excludeExtension) {
                apiOptions.name = apiOptions.name.replace(/\.[^.]*$/, '')
            }
    
            if (options.includeDate) {
                apiOptions.name += ' ' + (new Date().toISOString()).replace(/^\d\d(\d+)-(\d+)-(\d+).*/, '$1$2$3')
            }
    
            await this.smartcat.project().create(file, apiOptions)
        })
    }


    async deleteJobs(options) {
        await this.iterate('jobs', options, async job => {
            await this._smartcat.jobs.cancel(job.id)
        })
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

            await this.iterate('projects', options, async project => {
                {
                    // Todo: move resources to schema/model
                    let resources = this.load('resources')
                    let {translationMemories} = resources
                    let pretranslateRules = options.set.pretranslate
                    if (pretranslateRules) {
                        for (let rule of pretranslateRules) {
                            if ( rule.translationMemoryId )
                                continue
                            rule.translationMemoryId = translationMemories[rule.tmName]
                            delete rule.tmName
                        }
                    }

                    // await this.iterateProjects({filters}, async ({project}) => {
                        let nativeKeys = "name, description, deadline, clientId, domainId, vendorAccountIds".split(', ')
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
                            projectApi.translationMemories.post([{
                                id, matchThreshold: 75, isWritable: true
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
            })
        }
    }

    async editConvos(options) {
        await this.iterate('convos', options, async convo => {
            if (options.read) {
                await this._smartcat.chat.conversations(convo.conversationId).read()
            }
        })
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
            if (!languagesById[id])
                languagesById[id] = cultureName
        }
        if (!project.documents) {
            project.documents = []
            let multidocs = await this._smartcat.projects(project.id).allDocuments()
            for (let multidoc of multidocs) {
                let { wordsCount } = multidoc
                for (let document of multidoc.targets) {
                    renameKeys(document, {languageId: 'targetLanguageId'})
                    document.id = [document.documentId, document.targetLanguageId].join('_')
                    document.targetLanguage = languagesById[document.targetLanguageId]
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
            while ( this.freeze_documents[documentId] )
                await this.freeze_documents[documentId]
            this.freeze_documents[documentId] = new Promise(resolve => releaseDocument = () => {
                resolve()
                delete this.freeze_documents[documentId]
                console.log(this.freeze_documents)
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
                target.language = languagesById[target.languageId]
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

        let account = find(accounts, {name})

        assign(this, {account})

        let {auth, region, fullName} = account

        if (fullName)
            name = fullName

        this.subdomain = subdomainByRegion[region]
        let {subdomain} = this

        this.smartcat = new Smartcat(auth, subdomain)

        let {credentials} = this        

        let {username, password} = credentials.smartcat.login

        let session = this.credentials.smartcat.sessionsByServer[region]
        let cookie = `session-${sessionSuffixByRegion[region]}=${session}`    

        let _defaults = {
            baseURL: `https://${subdomain}smartcat.ai/api/`,
            headers: {cookie}
        }

        this.__smartcat = Axios.create(_defaults)

        this._smartcat = new _Smartcat({cookie, subdomain})


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

    async remember(key, options) {
        let wugs = await this.select(key, options)
        this[key] = wugs
    }

    async store(key, options) {
        let wugs = await this.select(key, options)
        this[key] = wugs
        let paths = options.include
        if (paths) {
            wugs = this.mapWugsByPaths(wugs, paths)
        }
        let saveAs = options.as
        if (!saveAs)
            saveAs = key
        this.dump({wugs}, saveAs)
    }

    mapWugsByPaths(wugs, paths) {
        return map(wugs, wug => {
            // Todo: do via fetch 👇
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

    async writeToGoogleSheet(key, options) {

        let doc = new GoogleSpreadsheet(options.sheet.id)
        await sheetReader.run(() => doc.useServiceAccountAuth(this.credentials.google))
        await sheetReader.run(() => doc.loadInfo())

        let sheet = doc.sheetsByIndex[0]
        await sheetWriter.run(() => sheet.clear())

        let { columns } = options

        await sheetWriter.run(() => sheet.setHeaderRow(columns))

        let rows = []
        let promises = []
        let lastWrite = new Date()
        await this.iterate(key, options, async wug => {
            let row = {}
            for (let column of columns) {
                row[column] = get(wug, column)
            }
            rows.push(row)
            let now = new Date()
            if ( now - lastWrite > 1000 ) {
                promises.push(sheetWriter.run(() => sheet.addRows(rows)))
                rows = []
                lastWrite = now
            }
        })
        await Promise.all(promises)
        await sheetWriter.run(() => sheet.addRows(rows))

    }

    async buildStats(options) {
        await this.iterate('projects', options, async project  => {
            let { netRateId } = options
            if ( netRateId ) {
                await this._smartcat.projects(project.id).netRate(netRateId)
            }
            let translationMemories = await this.fetch('translationMemories', { project })
            let multidocs = await this.fetch('multidocs', { project })
            let translationMemoryIds = map(translationMemories, 'id')
            let documentIds = map(multidocs, 'documentId')
            await this._smartcat.projects(project.id).statistics.build(documentIds, translationMemoryIds)
        })
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
        await this.iterate(what, options, async project =>
            this._smartcat[what](project.id)[action](args)
        )
    }

    async waitForInput({query}) {
        await new Promise(resolve => readline.question(query, ans => {
            readline.close();
            resolve(ans);
        }))
    }
    

    calc_daysFromNow(nDays) {
        return (
            new Date(Date.now() + 1000*3600*24*nDays)
        ).toISOString()
    }
}



module.exports = Scroid