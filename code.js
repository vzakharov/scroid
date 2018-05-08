main()

async function main() {

    const Axios = require('axios')
    const convert = require('xml-js')
    //const unzip = require('unzip')
    const fs = require('fs')
    const Path = require('path')

    const _ = require('lodash')
    const {find} = _
    
    var settings = require('./private/settings/settings.json')
    var credentials = require('./private/settings/credentials.json')
    var translators = require('./private/settings/translators.json')
    var teams = require('./private/settings/teams.json')
    var projects = require('./private/settings/projects.json')
    var emails = require('./private/settings/emails.json')
    
    var translatorsByName = {}
    var translatorsById = {}
    
    for (let name in teams) {
        let team = teams[name]
        for (let lang in team) {
            // Todo: multiple translators per language
            let fullName = team[lang]
    
            let translator = find(translators, candidate => {
                let {firstName, lastName} = candidate
                return [firstName, lastName].join(' ') == fullName ||
                    [lastName, firstName].join(' ') == fullName
            })
    
            if (translator) {
                translator.fullName = fullName
                translatorsByName[fullName] = translator
                translatorsById[translator.id] = translator
            }
        }
    }
    
    var smartcat = Axios.create({
        baseURL: 'https://smartcat.ai/api/integration/v1/',
        auth: credentials.smartcat
    })

    var _smartcat = Axios.create({
        baseURL: "https://smartcat.ai/api/",
        headers: {
            Cookie: credentials._smartcat
        }
    })

    var marketplace = Axios.create({
        baseURL: "https://marketplace.smartcat.ai/api/v1",
        headers: {
            Authorization: `Bearer ${credentials.marketplace}`
        }
    })

    var mixmax = Axios.create({
        baseURL: 'https://api.mixmax.com/v1/',
        params: {'apiToken': credentials.mixmax}
    })
    
    
    let project = projects[settings.project]
    project.name = settings.project
    
    let response = await smartcat.get(`/project/${project.id}`)
    Object.assign(project, response.data)

    let status

    async function addJob(name, serviceType, jobDescription, unitsAmount, unitsType, pricePerUnit, currency) {
        let freelancerCatUserId = translatorsByName[name].id
        let costAmount = pricePerUnit * unitsAmount

        response = await marketplace.post('/import/job', {
            freelancerCatUserId, serviceType, jobDescription, unitsAmount, unitsType, pricePerUnit, currency, costAmount,
            addToMyTeam: true,
            calcDate: null,
            isForceImport: false,
            jobExternalId: '',
            viaFreelancersLink: false
        })

        return response
    }

    async function nudge(names, templateID) {
        for (let name of names) {
            let email = emails[name]
            let data = {
                to: [{email, name}],
                from: "vova@gyglio.com",
                variables: {
                    "First name": getFirstName(name),
                    "Project name": project.name,
                    "Project ID": project.id,
                }
            }
            //Todo: find template by name
            response = await mixmax.post(`/snippets/${templateID}/send`, data)

            console.log(response)
        }
        return  
    }

    async function assign(project) {   

        let team = teams[project.team]

        if (!team) {
            team = teams.default
        }
            
        for (let document of project.documents) {
            // Todo: multiple translators per language
            let translator = translatorsByName[team[document.targetLanguage]]

            try {
                response = await smartcat.post(`/document/assignFreelancers?documentId=${document.id}&stageNumber=1`, [translator.id])
            } catch (error) {
                response = error.response           
            }

            console.log(response)
        }
    }

    async function check(project) {
        let progressesByStatus = {}

        for (let document of project.documents) {
            for (let stage of document.workflowStages) {
                for (let translator of stage.executives) {
                    let {fullName} = translatorsById[translator.id]
                    if (!progressesByStatus[stage.status]) progressesByStatus[stage.status] = {}
                    progressesByStatus[stage.status][fullName] = translator.progress
                }
            }
        }

        return progressesByStatus
    }

    async function getComments(documentId, options = {}) {
        let defaultParams = {
            documentId,
            mode: 'manager',
            _page: 'Editor',
            start: 0,
            limit: 25
        }

        console.log(`Fetching comments for document #${documentId}...\n`)
        
        let params = defaultParams

        response = await _smartcat.post(`/Documents/${documentId}/SegmentsFilter`, [{
            name: 'comments',
            hasComments: true
        }], {params})
        
        let filterSetId = response.data.id

        params = _.assign(defaultParams, {filterSetId})

        response = await _smartcat.get('/Segments', {params})

        let segments = response.data.items

        for (let segment of segments) {
            // commentState = 2 for segments with new comments
            if (options.newOnly) {
                if (segment.commentState == 1) {
                    continue
                }
            }

            let {topicId} = segment

            console.log(`\n===Comments to segment #${segment.number} (text: “${segment.source.text}”)===`)

            params = _.assign(defaultParams, {topicType: 'SEGMENT'})
            response = await _smartcat.get(`/Topics/${topicId}/Comments`, {params})
            
            let comments = response.data.items

            for (let comment of comments) {
                if (!comment.userId) continue

                console.log(`${comment.userName}:\n${comment.text}\n`)
            }
        }

        return response
    }

    async function exportDocs(project, type, stageNumber, options) {
        let defaultOptions = {
            timeout: 100,
            reportEvery: 1000,
            newOnly: false,
            join: false,
            languages: null
        }

        options = _.assign(defaultOptions, options)

        console.log(`Exporting ${type} docs for project “${project.name}”...`)

        let joined
        let date = (new Date()).toISOString().replace(/[:-]|\..*/g, '').replace('T', '-')

        let dirPath = `./private/exports/${project.name}.${type}/${date}`

        function ensureDirectoryExistence(_dirPath) {            
            if (fs.existsSync(_dirPath)) {
              return true;
            }
            ensureDirectoryExistence(Path.dirname(_dirPath));
            fs.mkdirSync(_dirPath);
        }

        ensureDirectoryExistence(dirPath)

        let documents = project.documents.slice()

        _.remove(documents, document => document.documentDisassemblingStatus != 'success')
        
        if (options.newOnly) {
            _.remove(documents, document => document.workflowStages[0].progress == 100)
        }

        if (options.languages) {
            _.remove(documents, document => !(_.includes(options.languages, document.targetLanguage)))
        }

        // Todo: Batch download (as a zip)
        for (let document of documents) {

            console.log(`Exporting ${document.name}.${type} (${document.targetLanguage})...`)
            let documentIds = document.id

            response = await smartcat.post('/document/export', {}, {params: {
                documentIds, type, stageNumber
            }})

            let taskId = response.data.id
            //console.log(`Export task ID: ${taskId}`)

            let ready
            let timer = 0
            let {timeout} = options

            async function getExport () {
                setTimeout(async () => {
                    timer += timeout
                    response = await smartcat.get(`/document/export/${taskId}`)

                    if (response.status == 200) {
                        if (ready) {
                            ready()
                        }
                        return
                    }

                    if (timer > options.reportEvery) {
                        console.log("Still waiting...")
                        timer = 0
                    }

                    await getExport()
                }, timeout)
            }

            await getExport()

            await new Promise((resolve, reject) => {
                ready = resolve
            })

            let {data} = response
            let path = `${dirPath}/${document.name}.${type}`

            if (type == 'xliff') {
                let js, units

                if (options.newOnly) {
                    js = convert.xml2js(data, {compact: true})

                    units = js.xliff.file.body['trans-unit']

                    if (!Array.isArray(units)) {
                        units = [units]
                    }
                    _.remove(units, unit => unit.target._attributes.state != "needs-translation")
    
                    if (units.length == 0) {
                        continue
                    }

                }

                if (options.join) {
                    path = `${dirPath}/all.${type}`
                    if (!joined) {
                        joined = js
                    } else {
                        let joinedUnits = joined.xliff.file.body['trans-unit']
                        joinedUnits.push(... units)
                        joined.xliff.file.body['trans-unit'] = _.uniqBy(joinedUnits, unit => unit.source._text)
                        js = joined
                    }
                }

                data = convert.js2xml(js, {compact: true})
            }

            fs.writeFileSync(path, data)

        }

        return response
    }

    async function unassignAll(project) {

        let {documents} = project
        _.remove(documents, document => {
            for (let stage of document.workflowStages) {
                if (stage.executives.length > 0)
                {
                    return false
                }
            }
            return true
        })

        for (let document of documents) {
            let [, documentId, targetLanguageId] = document.id.match(/(\d+)_(\d+)/)
            
            response = await _smartcat.post('/WorkflowAssignments/Start', {
                documentIds: [documentId],
                projectId: project.id,
                targetLanguageId
            })

            let assignmentId = response.data

            // Todo: go through all stages
            let params = {stage: 1}

            response = await _smartcat.get(`/WorkflowAssignments/${assignmentId}`, {}, {params})

            let assignments = response.data

            let users = assignments.assignedExecutives

            if (users) {
                response = await _smartcat.post(`/WorkflowAssignments/${assignmentId}/CancelAllInvitations/1`)
                continue
            }

            response = await _smartcat.post(`/WorkflowAssignments/${documentId}/${targetLanguageId}/ChangeSimpleToSplitAssignment/1`)            

            for (let stage of assignments.workflowStages) {
                for (let invitation of stage.freelancerInvitations) {
                    let {userId} = invitation

                    response = await _smartcat.post(`/WorkflowAssignments/${assignmentId}/Unassign`, userId, {params})

                    console.log(`${invitation.name} unassigned from stage ${stage.id} of “${document.name}”.`)
                }
            }

        }

        return response
    }

    function getFirstName(fullName) {
        return fullName.match(/^[^ ]+/)[0]
    }

    try {
        // status = await exportDocs(project, 'xliff', null, {
        //     newOnly: true,
        //     join: true,
        //     languages: ['ru']            
        // })

        status = await assign(project)

        //status = await unassignAll(project)

        // let progressesByStatus = await check(project)
        // let names = _.keys(progressesByStatus.assigned)
        // status = await nudge(names, '5ae6a466a7b4b70fd5a477e4')

        // status = await nudge(['Sam Huang'], '5ae6a466a7b4b70fd5a477e4')

    } catch (error) {
        status = error
    }

    console.log(JSON.stringify(status))

}
