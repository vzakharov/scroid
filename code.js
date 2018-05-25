const Scroid = require('./scroid')

main()

async function main() {


    let projectsByName = await Scroid.getProjectsByName()

    return

    
    const Axios = require('axios')
    const convert = require('xml-js')
    //const unzip = require('unzip')
    const fs = require('fs')
    const Path = require('path')
    // const xml2js = require('xml2js')

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
            let langTeam = team[lang]
            if (typeof langTeam == 'string') {
                langTeam = [langTeam]
            }

            for (let fullName of langTeam) {
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

        return response.data.jobsImported[0]
    }

    async function _getEmail(id) {
        response = await _smartcat.get(`/freelancers/profile/${id}`)
        let profile = response.data

        let email = profile.ownContacts.email
        let name = profile.transliteratedFullName

        emails[name] = _.assign(emails[name], {email, name})

        let result = email

        console.log(email + "\n" + id + "\n\n")

        return result
    } 

    async function nudge(names, templateID, commonVariables) {
        let defaultVariables = {
            "Project name": project.name,
            "Project ID": project.id
        }

        commonVariables = _.assign(defaultVariables, commonVariables)

        for (let name of names) {

            let contact = emails[name]

            let firstName = contact.firstName
            if (!firstName) {
                firstName = getFirstName(name)
            }

            let variables = _.assign(commonVariables, {
                "First name": firstName,
            })

            let {email} = contact
            let data = {
                to: [{email, name}],
                from: "vova@gyglio.com",
                variables
            }
            //Todo: find template by name
            response = await mixmax.post(`/snippets/${templateID}/send`, data)

            console.log(response)
        }
        return  
    }

    async function nudgeNonresponders() {

        let invitations = require('./private/settings/invitations.json')
    
        let names = []

        for (let stage of invitations.workflowStages) {
            for (let invitation of stage.freelancerInvitations) {

                if (invitation.isAccepted || invitation.isDeclined) continue

                let name = invitation.name
                
                let email = await _getEmail(invitation.userId)

                console.log(email)

                names.push(name)
            }
        }

        // Todo: change template id to name
        return await nudge(names, '5b03d4a8f5c8b71534540716')
    
    }

    async function _nudgeNonstarters(documentNames) {

        let names = []

        for (let document of project.documents) {

            if (!_.includes(documentNames, document.name)) continue

            for (let stage of document.workflowStages) {
                for (let user of stage.executives) {
                    if (user.progress < 100) {
                        let email = await _getEmail(user.id)

                        console.log(email)

                        names.push(user.name)
                    }
                }
            }
        }

        // Todo: remove hardocded template id
        await nudge(names, '5b0412572bf2e7153a5b40b1')

    }

    async function assignTranslators(project, options) {   

        let team = teams[project.team]

        if (!team) {
            team = teams.default
        }
            
        for (let document of project.documents) {
            if (!_.includes(options.documentNames, document.name)) {
                continue
            }
            // Todo: multiple translators per language
            let executives = team[document.targetLanguage]
            
            if (typeof executives == 'string') {
                executives = [executives]
            }

            executives = executives.map(name => {
                return {
                    id: translatorsByName[name].id,
                    wordsCount: 0
                }
            })

            try {
                response = await smartcat.post(`/document/assign?documentId=${document.id}&stageNumber=1`, {
                    executives,
                    minWordsCountForExecutive: 0,
                    assignmentMode: "distributeAmongAll"
                })
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

    async function completeAll(project) {
        let responses = []

        for (let document of project.documents) {
            // Todo: turn the below into a function
            let [, documentId, targetLanguageId] = document.id.match(/(\d+)_(\d+)/)
            let url = `/Documents/${documentId}/Targets/${targetLanguageId}/Complete`

            try {
                response = await _smartcat.post(url)    
            } catch(error) {
                response = error
            }

            responses.push(response)

            console.log(response)
        }        

        return responses
    }

    async function _findTranslators(parameters) {
        let users = []
        let isNewSearchByUser = true
        let inAssignmentMode = false
        let limit = 50
        let skip = 0

        while(1) {

            response = await _smartcat.post('/freelancers', 
                _.assign(parameters, {
                    limit, skip
                }), {
                params: {
                    isNewSearchByUser, inAssignmentMode
                }
            })
    
            let {data} = response
            let {results} = data

            users.push(... results)

            if (data.noMoreResults) break

            isNewSearchByUser = false
            skip += limit
        }

        for (let user of users) {
            user.email = await _getEmail(user.userId)
            let name = user.transliteratedFullName
            user['First name'] = getFirstName(name)
            _.assign(user, {name})
        }

        return users
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
            if (options.excludeApproved) {
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
            excludeApproved: false,
            join: false,
            languages: null,
            clear: false
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
        
        if (options.excludeApproved) {
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

                if (options.excludeApproved) {
                    // Todo: correctly process text with inline tags (placeholders)
                    js = convert.xml2js(data, {compact: true})
                    // xml2js.parseString(data, {
                    //     explicitArray:false
                    // }, (err, result) => {js = result})

                    units = js.xliff.file.body['trans-unit']

                    if (!Array.isArray(units)) {
                        units = [units]
                    }
                    _.remove(units, unit => unit._attributes.approved == "yes")
    
                    if (units.length == 0) {
                        continue
                    }

                    if (options.clear) {
                        for (let unit of units) {
                            unit.target._text = ""
                        }
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

    function _assignmentProgresses() {
        let projectInfo = require('./private/settings/projectInfo.json')
        
        let out = {}

        for (let document of projectInfo.documents) {
            
            out[document.name] = {}
            let _document = out[document.name]

            for (let target of document.targets) {

                _document[target.languageId] = {}
                let _target = _document[target.languageId]
                
                for (let stage of target.workflowStages) {

                    _target[stage.number] = stage.progress

                }
            }
        }

        return out
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

    let project = projects[settings.project]
    project.name = settings.project
    
    let response = await smartcat.get(`/project/${project.id}`)
    Object.assign(project, response.data)

    let status
    
    try {

        // status = await addJob("Vladimir Zakharov", "PM", "General April", "1.25", "hours", "60", "USD")

        //status = await completeAll(project)

        // status = await exportDocs(project, 'xliff', null, {
        //     excludeApproved: true,
        //     clear: true
        // })

        // status = await assignTranslators(project, {
        //     documentNames: ["Strings to 20 langs 180522"]
        // })

        //status = await unassignAll(project)

        // let progressesByStatus = await check(project)
        // let names = _.keys(progressesByStatus.assigned)
        // status = await nudge(names, '5ae6a466a7b4b70fd5a477e4')

        // status = await nudge([
        //     "Julia Tarach",
        //     "Robert Patzold",
        //     "Charis Argyropoulos",
        //     "Miho Miyazaki",
        //     "Frank Richter"
        // ], '5b03c55be28bb20fef7e9e8e', {
        //     "Client name": "Xsolla"
        // })

        //status = await nudgeNonresponders()

        //status = await _nudgeNonstarters('Strings to 20 langs 180522')

        //status = _assignmentProgresses()

        // Todo: move to a separate function
        // Todo: do via MixMax sequence API
        let parser = require('json2csv')
        status = await _findTranslators(require('./private/settings/search.json'))
        let csv = parser.parse(status)
        fs.writeFileSync('./private/tmp/searchResults.csv', csv)


    } catch (error) {
        throw(error)
    }

    console.log(status)

    return status

}
