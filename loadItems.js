scroid = {}

const uidSequence = [
    'project',
        'document',
            'target',
                'stage',
                'segment'
]

const addItem = item => {
    item = {... item}
    items.push(item)
    let addUid = (typeN, parentUid) => {
        if ( log(typeN, "typeN") >= uidSequence.length ) 
            return true
        let type = uidSequence[typeN]
        let subItem = log(item[type], 'subItem')
        if ( !subItem )
            return addUid(typeN + 1, parentUid)
        if ( subItem.uid )
            return addUid(typeN + 1, subItem.uid)
        item.uid = subItem.uid = 
            log(( parentUid ? parentUid + '_' : '' )
            + subItem.id.toString().replace(/\W/g, ''), "uid")
        return addUid(typeN + 1, subItem.uid)
    }
    addUid(0,'')
}

const uid = item => ({
    uid: uidSequence
        .filter(type => item[type])
        .map(type => item[type].uid)
        .join('_')
    })

_fetch = function(url, {method, params, body}) {
  if (!method) method = 'POST'
  let headers = { TheCookie }
  fetchArgs = { method, headers }
  if (body) {
    fetchArgs.body = JSON.stringify(body)
    headers['Content-Type'] = 'application/json'
  }
  if (params) {
   let char = '?'
   if (url.includes(char)) char = '&'
   url += char + new URLSearchParams(params).toString()
  }
  return fetch(url, fetchArgs)
}


call = async function(path, args) {
  let { item } = args
  if (item) serverUrl = item.serverUrl
  let url = 'https://' + proxy + serverUrl + '/' + path
  response = await _fetch(url, args)
  if (!response.ok || args.final) {
    if ( item ) {
        item.processed = true
        item.pending = false
        item.succeeded = response.ok    
    }
    return response.ok
  } else {
    try {
        return await response.json()
    } catch(e) {
        return true
    }
  }
}

post = (path, body, args) => call(path, {method:'POST', body, ...args})
get = (path, params, args) => call(path, {method:'GET', params, ...args})
put = (path, body, args) => call(path, {method:'PUT', body, ...args})

prepare = async function() {}

filterSetIds = {}
filterSetPromises = {}
segmentsByDocument = {}
segmentPromises = {}

documentListIds = {}
documentListPromises = {}

assignmentsByDocument = {}
assignmentPromises = {}

promises = {}

log = (what, message) => {
    if (message)
        console.log(message)
    console.log(what)
    return what
}

getThing = (type, id, functionIfNone) =>
    log(( promises[type] || log( promises[type] = {}, `Creating promises for ${type}` ))[id],  `${type} promise for id=${id}`)
        || log ( promises[type][id] = functionIfNone(), `Creating ${type} promise for id=${id}` )

loadItems = async () => {

    items = []

    languagesById = {}

    languages = (await get('api/languages')).map(language => ({
        id: language.id.toString(),
        code: language.cultureName,
        name: language.englishName
    }))

    for (let language of languages) {
        languagesById[parseInt(language.id)] = language
    }

    isInclusive = type => _.find(filters, {type}) && _.find(filters, {type}).inclusive
    filteredIds = type => _.map(_.filter(filters, {type}), 'id')

    let globalTargetLanguageIds = (
        isInclusive('target') ? filteredIds('target') :
            _.map(languages.filter(language => !filteredIds('target').includes(language.id)), 'id')
    ).map(s => parseInt(s))
    
    await post('api/projects/filter', {
        searchName:"", deadlineFrom: null, deadlineTo:null, createdByIds: [], 
        clientIds: [], clientAccountIds: [], withoutClients:false, domainIds:[], 
        withoutManagers: false, managerUserIds: [], sourceLanguageIds: [],
        targetLanguageIds: globalTargetLanguageIds, statuses: projectStatuses, "creationDateFrom":null,"creationDateTo":null
    })

    let { projects } = await get('ssr-projects/page?tab=0')

    let item = {
        serverUrl
    }

    for (let project of projects) {

        let {id, name, requiresAssigment, clientId} = project

        item.project = {
            url: `https://${serverUrl}/projects/${project.id}`,
            creationDate: new Date(project.creationDate),
            deadline: new Date(project.deadline),
            sourceLanguage: languagesById[project.sourceLanguage.id],
            targetLanguages: project.targetLanguages.map(targetLanguage => languagesById[targetLanguage.id]),
            id, name, requiresAssigment, clientId
        }

        let filter = {
            "searchName":"","creationDateFrom":null,"creationDateTo":null, createdByAccountUserIds:[], 
            targetLanguageIds: _.intersection(
                globalTargetLanguageIds,
                _.map(item.project.targetLanguages, 'id')
            ),
            ...docFilter
        }

        ;(async item => {

            let documentIds = (await post(
                `api/Projects/${project.id}/LoadDocumentsPageBoundaries?orderBy=0&desc=false`,
                filter
            )).map(a => a.documentIds).flat()

            let { documents } = await post(
                `api/Projects/${project.id}/LoadDocumentsPage?orderBy=0&desc=false&limit=100`,
                {documentIds, filter}
            )

            for (let document of documents) {

                let {id, name} = document
                let documentId = id
                item.document = {
                    id, name,
                    creationDate: new Date(document.creationDate),
                }

                for (let target of document.targets) {

                    let { languageId } = target

                    if ( !globalTargetLanguageIds.includes(languageId) ) continue
                    let language = languagesById[languageId]
                    item.target = {
                        id: languageId,
                        language,
                        url: `https://${serverUrl}/editor?documentId=${document.id}&languageId=${languageId}`,
                    }

                    if (path.includes('stage'))
                        for (let stage of target.workflowStages) {

                            let wordsLeft = stage.sourceDocumentWordsCount - stage.wordsTranslated

                            if (showCompletedOnly && wordsLeft > 0) continue;

                            let {number, name, requiresAssigment} = stage
                            item.stage = {
                                number, name, requiresAssigment, wordsLeft,
                                id: number,
                                type: stage.type.toString(),
                                deadline: new Date(stage.deadline),
                                calculatedDeadline: new Date(stage.deadline || project.deadline),
                            }

                            let documentListId = loadDocumentLists && await getThing('documentList', documentId, 
                                () => log(
                                    post('api/WorkflowAssignments/CreateDocumentListId', [documentId]), 
                                    `Fetching document list for document ${document.id}`
                                )
                            )

                            if ( path.includes('assignee') ) {

                                _.find(
                                        (await getThing('assignments', documentId,
                                            async () => log(get(`api/WorkflowAssignments/${project.id}/GetWorkflowStages`, {
                                                documentListId
                                            }), `Fetching assignments for document ${document.id}`)
                                        )), {
                                            id: stage.number,
                                            targetLanguageId: languageId
                                        }
                                    ).executives.forEach(assignee => {
                                        item.assignee = _.pick(assignee, [
                                            'id', 'name', 'hasAcceptedInvitation'
                                        ])

                                        addItem(item)
                                    })
                            } else
                                addItem(item)

                        }
                    else if (level == 'segment') {
                        
                        ;(async (item) => {

                            let filterSetId = (await getThing(
                                'filterSets',
                                documentId,
                                () => post(
                                    `api/Documents/${document.id}/SegmentsFilter?mode=manager`,
                                    [
                                        ... segmentFilter, 
                                        {name:"language", targetLanguageIds: _.map(document.targets, 'languageId')}
                                    ]
                                )
                            )).id

                            let segments = (await getThing(
                                'segments',
                                documentId,
                                () => get(
                                    `api/Segments?start=0&limit=1000&mode=manager`,
                                    {
                                        documentId,
                                        filterSetId
                                    }
                                )
                            )).items
                            
                            for (let segment of segments) {
                                ;(async (item) => {
                                    let { number, id, commentState, topicId, wordsCount } = segment
                                    let { tags, text } = segment.source

                                    let segmentTarget = segment.targets.find(target => target.languageId == languageId)
                                    let { isConfirmed } = segmentTarget

                                    if ( unconfirmedOnly && isConfirmed) return
                                    if ( nonemptyOnly && !segmentTarget.text ) return
                                    if ( emptyOnly && segmentTarget.text ) return

                                    item.segment = {
                                        number, id, commentState, topicId, wordsCount, isConfirmed,
                                        tags, text,
                                        stringId: segment.localizationContext && segment.localizationContext[0],
                                        translation: segmentTarget.text
                                    }

                                    if (loadMatches) {
                                        let matches = await get (
                                            `api/SegmentTargets/TMTranslations?mode=manager`,
                                            {
                                                documentId,
                                                segmentId: segment.id,
                                                languageId: language.id
                                            }
                                        )
                                        
                                        if ( matches )
                                            item.segment.matches = matches
                                                .filter(match => match.matchPercentage >= matchPercentage)
                                                .map(match => ({
                                                    tmName: match.resourceName,
                                                    author: match.authorName,
                                                    percentage: match.matchPercentage,
                                                    text: match.targetText,
                                                    sourceText: match.sourceText
                                                }))
                                        
                                        if ( discardIfNoMatches )
                                            if ( !matches || !item.segment.matches.length)
                                                return
                                    }

                                    addItem(item)
                                })({... item})
                            }
                        })({... item})
                    }
                }
            }

        })({... item})

    }

}

scroid.sendMessage = async (userId, message) => {

    post(`api/chat/conversations/${(
        await getThing(
            'conversations', 
            userId, 
            () => get(`api/chat/contacts/${userId}/conversation`, {accountId})
        )
    ).id}/messages`, message)

}

scroid.confirm = ( item, text = item.segment.translation ) =>
  put(`
    api/Segments/${
      item.segment.id
    }/SegmentTargets/${
      item.target.language.id
    }/Confirm?documentId=${
      item.document.id
    }&mode=manager&ignoreWarnings=true`,
    { 
      text, tags:[]
    }
  )

scroid.editSegment = async ( item, text, { confirm } ) => {
  let { segment, target, document } = item
  let editResult = await put(
    `api/Segments/${
      segment.id
    }/SegmentTargets/${
      target.language.id
    }?documentId=${
      document.id
    }&saveType=0&mode=manager&stageNumber=0`,
    {
      text, tags:[]
    }
  )
  if ( confirm )
    return {
      editResult,
      confirmResult: await scroid.confirm(item, text)
    }
  else
    return { editResult }
}

scroid.doAction = {

    nudge: async item => {

        let { assignee } = item
        let { id } = assignee

        // scroid.nudged = scroid.nudged || []
        item.nudged = false

        let message = getThing( 'message', id, () => (
          {body: 'Hello, for your convenience, here are the jobs that are either overdue or coming due within the next 24 hours:'}) 
        )

        // if ( !message.body )

        // if ( !assignee.nudged ) {

        //     _.filter(items, {assignee: {id}}).forEach( item => item.assignee.nudged = true )

        //     await scroid.sendMessage(id, settings.nudgeMessage || "Hello, for your convenience, here are the jobs that are either overdue or coming due within the next 24 hours:")

        // }
        
        let { calculatedDeadline } = item.stage

        let overdue = calculatedDeadline < new Date()
        
        message.body += 
          '\n' 
          + `${
            overdue ? 'OVERDUE! ' : ''
          }${
            item.stage.wordsLeft
          } words until ${
            calculatedDeadline.toUTCString().slice(0,19)+':00 UTC'
          } 👉 ${
            item.target.url
          }`
        
        item.nudged = true

        if ( !_.filter( items, {assignee: {id}, nudged: false} ).length )
          // console.log(id, message.body)
          scroid.sendMessage(id, message.body)
        
        // setTimeout(() => 
        //   scroid.sendMessage(id, `${overdue ? 'OVERDUE! ' : ''}${item.stage.wordsLeft} words until ${calculatedDeadline.toDateString()} 👉 ${item.target.url}`),
        //   200
        // )

    },

    pretranslate: async item => {

      let { segment, target, document} = item
      let { text } = segment.matches[0]

      await scroid.editSegment(item, text, { confirm: true })

    }


}

scroid.go = async () => {

    for (let uid of uids) {
        let item = items.find(item=>item.uid==uid)
        item.pending = true

        new Promise(async function() {
            
            try {
                if ( scroid.doAction[action] )
                    await scroid.doAction[action](item)
                else {
                    await prepare(item)
                    let path = eval('`/'+pathPattern.replace(/{(.+?)}/g, "${item.$1}")+'`')
                    let body = bodyPattern ? eval(`(${bodyPattern})`) : null
                    await call(path, {method, item, body, final: true})    
                }
                item.succeeded = true
            } catch(error) {
                item.succeeded = false
            } finally {
                item.processed = true
                item.pending = false
            }
        })
    }

}