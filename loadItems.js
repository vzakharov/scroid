S = scroid = {}

// action = 'confirm'
// loadMatches = false
// emptyOnly = false
// nonemptyOnly = true
// segmentFilter = [
//   {name: "last-revision-is-not-confirmed"}
// ]

action = 'pretranslate'
matchPercentage = 99
discardIfNoMatches = true
loadMatches = true
emptyOnly = true
nonemptyOnly = false
segmentFilter = [
  {
    "name": "confirmation",
    "isConfirmed": false,
    "workflowStageNumber": 1
  }
]


cookie = 'session-us=id=b4943cecd3a143e637fa3f06&key=tLJ0BRvctr4fdNLD'
proxy = ''
serverUrl = 'us.smartcat.com'
settings = {instantAction: true, confirm: false, retryIfError: true, doSegmentsByOne: false}
unconfirmedOnly = true
level = 'segment'
path = [
  "project",
  "document",
  "target",
  "segment"
]
docFilter = {
  "documentTargetStatuses": [],
  "stageNumbersWithNoAssignments": [],
  "stageNumbersWithIncompleteState": [
    1
  ]
}
projectStatuses = [
  0,
  1,
  2
]
filters = [
  {
    "type": "target",
    "id": "1034",
    "inclusive": true
  },
  {
    "type": "target",
    "id": "3084",
    "inclusive": true
  },
  {
    "type": "target",
    "id": "1036",
    "inclusive": true
  },
    {
    "type": "target",
    "id": "21514",
    "inclusive": true
  }
]

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
        if ( typeN >= uidSequence.length ) 
            return true
        let type = uidSequence[typeN]
        let subItem = item[type]
        if ( !subItem )
            return addUid(typeN + 1, parentUid)
        if ( subItem.uid )
            return addUid(typeN + 1, subItem.uid)
        item.uid = subItem.uid = 
            ( parentUid ? parentUid + '_' : '' )
            + subItem.id.toString().replace(/\W/g, '')
        return addUid(typeN + 1, subItem.uid)
    }
    addUid(0,'')
    if ( settings.instantAction ) {
      // debugger
      scroid.goForItem(item)
    }
}

const uid = item => ({
    uid: uidSequence
        .filter(type => item[type])
        .map(type => item[type].uid)
        .join('_')
    })

totalRequests = 0

// getTotalRequests = () => totalRequests

requestLimit = 100

_fetch = async function(url, {method, params, body}) {
  if (!method) method = 'POST'
  let headers = proxy ? { TheCookie } : { cookie }
  let fetchArgs = { method, headers }
  if (body) {
    fetchArgs.body = JSON.stringify(body)
    headers['Content-Type'] = 'application/json'
  }
  if (params) {
   let char = '?'
   if (url.includes(char)) char = '&'
   url += char + new URLSearchParams(params).toString()
  }
  while ( totalRequests > requestLimit )
    await sleep(1000)
  totalRequests++
  let result = await fetch(url, fetchArgs)
  totalRequests--
  return result
}


call = async function(path, args, retry) {
  let { item } = args
  if (item) serverUrl = item.serverUrl
  let url = 'https://' + proxy + serverUrl + '/' + path
  response = await _fetch(url, args)
  if (!response.ok || args.final) {
    if ( item ) {
        item.processed = true
        item.pending = false
        item.succeeded = !!response.ok
        item.failed = !response.ok
        if ( settings.retryIfError && !retry ) {
          await sleep(1000)
          return await call(path, args, true)
        }
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

sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

prepare = async function() {}

filterSetIds = {}
filterSetPromises = {}
segmentsByDocument = {}
segmentPromises = {}

documentListIds = {}
documentListPromises = {}

assignmentsByDocument = {}
assignmentPromises = {}

log = (what, message) => {
    if (message)
        console.log(message)
    console.log(what)
    return what
}

getPromise = (type, id, functionIfNone, out = {}) =>
    ( ( promises[type] || (promises[type] = {}) )[id] )
        || ( out.new = true, promises[type][id] = functionIfNone() )

// clearPromise = (type, id) => delete promises[type][id]

lock = async (type, id, callback) => {
  let path = `['${type}']['${id}']`
  let lock
  while ( lock = _.get(locks, path)) {
    await lock
  }

  let callbackPromise = callback()
  _.set(locks, path,
    callbackPromise
    .then(() => 
      delete locks[type][id]
    )
  )

  return await callbackPromise
}

loadItems = async () => {

    items = []
    promises = {}
    locks = {}

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

    let { hasMoreProjects, projects } = await get('ssr-projects/page?tab=0')

    if ( hasMoreProjects ) {
      let {
        id: lastProjectId,
        modificationDate: lastProjectModificationDate
      } = _.last(projects)

      let { projects: moreProjects } = await get('ssr-projects/page?tab=0', {
        lastProjectId, lastProjectModificationDate
      })
      projects = [...projects, ...moreProjects]
    }

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

                            let documentListId = loadDocumentLists && await getPromise('documentList', documentId, 
                                () => log(
                                    post('api/WorkflowAssignments/CreateDocumentListId', [documentId]), 
                                    `Fetching document list for document ${document.id}`
                                )
                            )

                            if ( path.includes('assignee') ) {

                                _.find(
                                        (await getPromise('assignments', documentId,
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

                            let filterSetId = (await getPromise(
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
                            

                            let start = 0, limit = 1000, segments = []
                            
                            while (true) {
                              let segmentInfo = await getPromise(
                                'segments',
                                `${documentId}_${languageId}_${start}`,
                                () => get(
                                    `api/Segments?start=${start}&limit=${limit}&mode=manager`,
                                    {
                                        documentId,
                                        filterSetId,
                                        languageId
                                    }
                                )
                              )
                              
                              console.log(segmentInfo.items.length, segmentInfo.total)

                              segments.push(...segmentInfo.items)

                              if ( segments.length >= segmentInfo.total ) break

                              start += limit
                            }
                            
                            for (let segment of segments) {
                                ;(async (item) => {
                                    let { number, id, commentState, topicId, wordsCount, source } = segment
                                    if (!source) debugger
                                    let { tags, text } = source

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
                                            }, { item }
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

    // console.log(userId, message)
    post(`api/chat/conversations/${(
        await getPromise(
            'conversations', 
            userId, 
            () => get(`api/chat/contacts/${userId}/conversation`, {accountId})
        )
    ).id}/messages`, message)

}

scroid.confirm = ( item, text = item.segment.translation ) =>
  put(`api/Segments/${
      item.segment.id
    }/SegmentTargets/${
      item.target.language.id
    }/Confirm?documentId=${
      item.document.id
    }&mode=manager&ignoreWarnings=true`,
    { 
      text, tags:[]
    }, { item }
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
    }, { item }
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

    confirm: scroid.confirm,

    nudge: async item => {

        let { assignee } = item
        let { id } = assignee

        if (id == 'fa428cfb-50a9-4205-b2bb-f79620f8e78d')
          return

        let firstMessage = `Hello, fya, jobs that are either overdue or due in less than ${settings.hoursBeforeDeadlineLessThan} hours:`
        // let message = getPromise( 'message', id, () => (
        //   {body: firstMessage}) 
        // )

        await getPromise('firstMessage', id, async () => scroid.sendMessage(id, firstMessage) )

        // if (!nudged) {}
        
        let { calculatedDeadline } = item.stage

        let overdue = calculatedDeadline < new Date()
        
        // message.body += 
        //   '\n' 
        //   + 
        let message = 
          `${
            overdue ? 'OVERDUE! ' : ''
          }${
            item.stage.wordsLeft
          } words until ${
            calculatedDeadline.toUTCString().slice(0,19)+':00 UTC'
          } 👉 ${
            item.target.url
          }`
        
        
        scroid.sendMessage(id, message)

        // item.nudged = true

        // let remain = _.reject(
        //   _.filter( 
        //     items, {
        //       assignee: {id}
        //     }
        //   ), {
        //     nudged:true
        //   }).length

        // debugger

        // if ( !remain ) {
        //   if (shouldIGo)
            // scroid.sendMessage(id, message.body)
        // }

    },

    pretranslate: async item => {

      let { segment, target, document} = item
      let { text } = segment.matches[0]

      await scroid.editSegment(item, text, { confirm: settings.confirm })

    },

    copySourceToTarget: async item => {
      await scroid.batchOperation(item, 'copySourceToTarget')
      await sleep(1000)
      return scroid.batchOperation(item, 'confirm')
    }


}

scroid.batchOperation = ( item, operation ) =>
  post(`api/SegmentTargets/BatchOperation/${operation}`, {
    documentId: item.document.id,
    languageId: parseInt(item.target.language.id),
    mode: 'manager'
  })

scroid.go = async () => {

    for (let uid of uids) {
        let item = items.find(item=>item.uid==uid)
        scroid.goForItem(item)
    }

}

scroid.goForItem = async item => {
  item.pending = true

  try {
    if (scroid.doAction[action])
      await scroid.doAction[action](item)
    else {
      await prepare(item)
      let path = eval('`/' + pathPattern.replace(/{(.+?)}/g, "${item.$1}") + '`')
      let body = bodyPattern ? eval(`(${bodyPattern})`) : null
      await call(path, { method, item, body, final: true })
    }
    item.succeeded = true
  } catch (error) {
    item.succeeded = false
    item.failed = true
  } finally {
    item.processed = true
    item.pending = false
  }
}

// generic

require = async url => {
  eval(
    await (
      await fetch(url)
    ).text()
  )
}