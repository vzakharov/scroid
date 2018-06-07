const Axios = require('axios')
const Smartcat = require('smartcat')
const _Smartcat = require('smartcat-ud')
const fs = require('fs')
const readYaml = require('read-yaml')

const _ = require('lodash')

const {
    assign, capitalize, clone, filter, find, includes, 
    isArray, isEqual, keyBy, keys, map, pick, remove
} = _

class Scroid {

    constructor(credentials) {

        assign (this, {credentials})

        // this.smartcat = Axios.create({
        //     baseURL: 'https://smartcat.ai/api/integration/v1/',
        //     auth: credentials.smartcat
        // })

        this.smartcat = new Smartcat(credentials.smartcat).methods

        /* All functions with _ refer to the undocumented API */
        let _defaults = {
            baseURL: "https://smartcat.ai/api/",
            headers: {
                Cookie: credentials._smartcat
            }
        }
        this.__smartcat = Axios.create(_defaults)
        this._smartcat = new _Smartcat(credentials._smartcat).methods

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
            baseURL: "https://marketplace.smartcat.ai/api/v1",
            headers: {
                Authorization: `Bearer ${credentials._marketplace}`
            }
        })

        this.mixmax = Axios.create({
            baseURL: 'https://api.mixmax.com/v1/',
            params: {'apiToken': credentials.mixmax}
        })

    }


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

    createFilter({confirmed, stage, changed}) {
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
        
        return filters
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

    async editSegment_(document, segment, {confirm} = {confirm: true}) {

        let editor = this._editor(document, {exclude: ['languageIds']})
        //assign(editor.defaults.params, {languageId})
    
        console.log(`Handling segment ${segment.number} (${segment.localizationContext[0]}) in ${document.name}: \n\t${segment.source.text}...`)
        for (let target of segment.targets) {

            let {text, tags, languageId, language} = target

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

        // let projects = (
        //     await this.smartcat.get('project/list', {params})
        // ).data
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

    async getTeam(options) {

        let {template, includeEmails} = assign({
            template: 'default',
            includeEmails: false
        }, options)
    
        let teams = readYaml.sync(`${process.cwd()}/private/settings/teams.yml`)
        let templateTeam = teams[template]
        let team = []
        let smartcatTeam = await this.downloadMyTeam()
    
        for (let languageKey in templateTeam) {
            let name = templateTeam[languageKey]
            let member = find(smartcatTeam, member => `${member.firstName} ${member.lastName}` == name)
            assign(member, {name})
            if (member.id) this.renameKeys(member, {id: 'userId'})
    
            let languages = languageKey.split(',')
    
            for (let targetLanguage of languages) {
                if (languages.length > 0) {
                    member = clone(member)
                }
                assign(member, {targetLanguage})
                team.push(member)
            }
    
        }
    
        if (includeEmails) {
            await this._getEmails({assignees: team})
        }
    
        return team
    
    }

    async joinByContext_(documents, {onlyJoinIfAllConfirmed, onlyJoinIfNotAllConfirmed} = {}) {
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

    async pretranslateWith_(document, object, {
        contextFormat, parseFilenames, withLanguagePrefix, convertNewLinesToTags, 
        confirm, documentNames, editIfNonEmpty
    } = {documentNames: []}) {

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
                    text = object[id]
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

            await scroid.editSegment_(document, segment, {confirm})

        }
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

    /* Operations with files */

    handleFilesRecursively(path, handler, {mask} = {}) {
        for (let filename of fs.readdirSync(path)) {
            let fullPath = `${path}/${filename}`
            let stats = fs.statSync(fullPath)

            if (stats.isDirectory(fullPath)) {
                console.log(`Directory: ${fullPath}`)
                this.handleFilesRecursively(fullPath, handler, {mask})
            } else {
                let match = fullPath.match(/([^/\\]+)\.([^.]*)$/)
                if (!match) {
                    continue
                }
                let [, filename, extension] = match
                if (mask) {
                    if (!fullPath.match(mask)) {                        
                        console.log(`Skipping ${fullPath} (mask not matched).`)
                        continue
                    }
                }
                console.log(`Handling ${fullPath}...`)
                handler(fullPath, {filename, extension})
            }
        }
    }

    createJsonsFromYmls(path) {
        let mask = /\.ya?ml$/
        this.handleFilesRecursively(path, (path) => {
            let js = this.readYaml(path)
            let jsonFilename = path.replace(mask, '.json')
            fs.writeFileSync(jsonFilename, JSON.stringify(js, null, 4))
        }, {mask})

        return
    }

    loadYmls(path) {
        let out = {}
        this.handleFilesRecursively(path, (path, {filename}) => {
            out[filename] = {}
            assign(out[filename], this.readYaml(path))
        }, {mask: /\.ya?ml$/})
        return out
    }

    readYaml(path) {
        console.log(`Reading ${path}...`)
        try {
            return readYaml.sync(path)
        } catch (error) {
            console.log(`Caught an error while loading:`)
            console.log(error)
            console.log(`Trying with less trict options...`)
            return readYaml.sync(path, {json: true})
        } finally {
            console.log('... Done.')
        }
    }

    renameRecursively(path, mask, renameTo) {
        this.handleFilesRecursively(path, (path) => {
            if (path.match(mask)) {
                let newPath = path.replace(mask, renameTo)
                fs.renameSync(path, newPath)
                console.log(`Renamed ${path} to ${newPath}`)
            }
        }, {mask})
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