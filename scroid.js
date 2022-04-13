// Module to perform various Smartcat tasks via calls to its undocumented API

let cdns = {
  axios: 'https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js',
  _: 'https://cdnjs.cloudflare.com/ajax/libs/axios/0.25.0/axios.min.js',
  Papa: 'https://unpkg.com/papaparse@latest/papaparse.min.js',
  axiosRateLimit: 'https://cdn.jsdelivr.net/npm/axios-rate-limit@1.3.0/src/index.min.js',
}

// If it's not browser environment, we're in node.js
if ( !window ) {

  // Require every module using keys of cdns
  for ( let key in cdns ) {
    require(cdns[key])
  }

} else {

  module = {}

  let codeToEval = ''
  
  for ( let key in cdns ) {
    let url = cdns[key]
    codeToEval += `\n\nconsole.log('Evaluating ${url}');`
    codeToEval += '\n\n' + await ( await fetch(cdns[key]) ).text()
    codeToEval += '\n\nconsole.log("Done");'
  }

  eval(codeToEval)
  
}

// Create an axios instance
axios = axios.create({
  baseURL: 'https://us.smartcat.com/'
})

// Add rate limit (max 3 requests per second)
axios = axiosRateLimit(axios, { maxRPS: 3 })

let { filter, find, flatten, forEach, identity, map, mapValues, range, uniq, without } = _
let { assign } = Object

multiCallback = ( callback = identity ) =>
  async listPromise =>
    Promise.all(
      ( await listPromise ).map(item => callback(item))
    )

addWorkingHours = ( date, hours ) => {
  date = new Date(date)
  let count = 0
  while (count < hours) {
      date.setHours(date.getHours() + 1)
      if (date.getDay() != 0 && date.getDay() != 6) // Skip weekends
          count++
  }
  return date
}

data = promise => promise.then(response => response.data)

log = what => ( console.log(what), what )

promises = []

getPromise = (type, id, callback ) =>
    ( ( promises[type] || (promises[type] = {}) )[id] )
        || ( promises[type][id] = callback() )

sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

maxRequests = 50
numRequests = 0
totalRequests = 0
requestsUnblocked = Promise.resolve()
maxRetries = 5

retry = async ( callback, retries = maxRetries, ms = 3000 ) => {
  let unblockRequests = () => {}
  let mustBlock = () => numRequests >= maxRequests

  let releaseRequest = () => {
    numRequests--
    if ( !mustBlock() )
      unblockRequests()
  }

  try {
    while ( mustBlock() )
      await requestsUnblocked

    numRequests++
    totalRequests++

    if ( mustBlock() )
      requestsUnblocked = new Promise(resolve => unblockRequests = resolve)
    
    console.log({ numRequests, totalRequests, callback, retries })

    let result = await callback()
    releaseRequest()
    return result

  } catch(error) {

    let { status, data: { error: scError } = {} } = error.response || {}

    console.log({ callback, error, scError })
    if ( retries && scError != 'QACriticalError' ) {
      releaseRequest()
      await sleep(ms)
      return retry( callback, retries - 1, ms)
    }

  }
}

//

getUserContext = () => getPromise('userContext', 0, () =>
  data(axios.get('api/userContext'))
)

getExchangeRates = () => data(axios.get('api/freelancers/exchange-rates'))

days = without(range(1,32), 4, 5, 11, 12, 18, 19, 25, 26)
dates = map(days, day => new Date(2021, 11, day, 23, 59, 59).toISOString())

addHourlies = () => forEach(dates, addHourly)

addJob = ({
  executiveUserId,
  unitType,
  unitCount,
  pricePerUnit,
  currency,
  jobDescription,
  dateStarted,
  dateCompleted,
  serviceType
}) => fetch("https://us.smartcat.com/api/jobs/external-v2?executiveSource=1&random_9kx8270a=", {
  "body": JSON.stringify({
    executor: { executiveUserId, type: 0 },
    unitType,
    unitCount,
    pricePerUnit,
    currency,
    jobDescription,
    dateStarted: new Date(dateStarted),
    dateCompleted: new Date(dateCompleted),
    externalNumber: null,
    projectId: null,
    serviceType,
    sourceLanguageId: null,
    targetLanguageId: null
  }),
  "method": "POST",
  headers: {'content-type': 'application/json'}
})

addMinutely = function({
  executiveUserId,
  date,
  jobDescription,
  minutes,
  pricePerUnit,
  currency,
}) { 
  return addJob({
    unitType: 4,
    unitCount: minutes,
    jobDescription,
    dateStarted: date,
    dateCompleted: date,
    serviceType: 13,
    ...arguments[0]
  })
}


// addHourly = ( date ) => addJob({
//   executiveUserId: '97d58fd3-2065-4000-81c9-bbad9717f991',
//   unitType: 4,
//   unitCount: 20,
//   pricePerUnit: 260,
//   currency: 3,
//   jobDescription: 'Hourly',
//   dateStarted: date,
//   dateCompleted: date,
//   serviceType: 13
// })

timeStringToSeconds = time =>
  _.sum(time.split(':').map(s=>parseInt(s)).map((v,i) => v*([3600,60,1])[i]))

addHoursFromTogglCSV = ( csv, executiveUserId, pricePerUnit, currency, jobDescription = 'Hourly' ) =>
  Promise.all(
    _(
      Papa.parse(csv, { header: true }).data
    )
      .groupBy('Start date')
      .mapValues(entries => 
        _.sumBy(entries, e => 
          Math.ceil(timeStringToSeconds(e.Duration)/60/5)*5)
      ).mapValues(
        ( minutes, date ) => 
          addMinutely({
            executiveUserId,
            date,
            minutes,
            pricePerUnit,
            currency,
            jobDescription
          })
      )  
  )

// await addHoursFromTogglCSV(csv, '97d58fd3-2065-4000-81c9-bbad9717f991', 260, 3, 'Loc engineering')
// 979adbb9-8d04-4ab8-bd6a-4228ae69fee5

addProRata = ({ wordsTranslated: unitCount, date }, id) =>
  addJob({
    executiveUserId: '979adbb9-8d04-4ab8-bd6a-4228ae69fee5',
    unitType: 1,
    unitCount,
    pricePerUnit: 3.7,
    currency: 3,
    jobDescription: 'https://us.smartcat.com/projects/'+id,
    dateStarted: date,
    dateCompleted: date,
    serviceType: 13
  })


allJobs = async ({ paymentStateFilter = 0, skip = 0, limit = 500, doNotContinue, numJobs } = {}) => {
  numJobs ||= (
    await data(
      axios.post('api/invoices/invoice-cost', null, { 
        params: {
          paymentStateFilter
        }
        , headers: {
          'Content-Type': 'application/json'
        }
      })
    )
  ).jobIds.length

  // change limit if it would overrun the number of jobs
  limit + skip > numJobs && (
    limit = numJobs - skip,
    doNotContinue = true
  )

  return data(axios.get('api/jobs/for-customer', { params: {
    skip, limit, paymentStateFilter
  }})).then(async jobs => (
    jobs = await Promise.all(jobs.map(async job => ({
      ...job,
      costUSD: job.cost / (
        await getPromise('exchangeRates', 0, getExchangeRates)
      )[job.executiveCurrency]
    }))),
    jobs.length < limit || doNotContinue
      ? jobs
      : [ ...jobs, 
        ...await allJobs({ paymentStateFilter, skip: skip + limit, limit, numJobs })
      ]
  ))
}

deleteJob = ({ id }) => fetch(`https://us.smartcat.com/api/jobs/${id}/canceled`, {
  "method": "PUT",
})

groupJobsByProject = async ( jobs, wordsPerMinute = 70, fixedMinutes = 360, minuteStep = 5 ) => {
  let totalWords, groupedJobs = (
    !jobs && ( jobs = await allJobs() ),
    totalWords = _.sumBy(jobs, 'wordsTranslated'),
    _(jobs)
      .groupBy('projectName')
      .mapValues(( jobs, projectName ) => {
        let wordsTranslated = Math.round(_.sumBy(jobs, 'wordsTranslated'))
        return { 
          projectName,
          wordsTranslated,
          minutes: Math.round(wordsTranslated * ( 1 / wordsPerMinute + 1 / totalWords * fixedMinutes)/minuteStep) * minuteStep,
          date: _.minBy(jobs, 'dateVerified').dateVerified
        }
      }).values().value()
  )

  return groupedJobs
}

addAllProRata = jobs => forEach(groupJobs(jobs), addProRata)

addProRataAsMinutes = async ( groupedJobs, executiveUserId, pricePerUnit, currency ) => (
  groupedJobs ||= await groupJobsByProject(),
  Promise.all( 
    groupedJobs.map( ({ date, minutes, projectName }) =>
      minutes && addMinutely({
        executiveUserId,
        date, minutes, pricePerUnit, currency,
        jobDescription: projectName
      })
    )
  )
)

// await addProRataAsMinutes(await groupJobsByProject(), '97d58fd3-2065-4000-81c9-bbad9717f991', 420, 3)
// await addProRataAsMinutes(groupedJobs, '97d58fd3-2065-4000-81c9-bbad9717f991', 420, 3)
// Rub account: 979adbb9-8d04-4ab8-bd6a-4228ae69fee5
// await addProRataAsMinutes(await groupJobsByProject(), '979adbb9-8d04-4ab8-bd6a-4228ae69fee5', 290, 3)

ids = ['97d58fd3-2065-4000-81c9-bbad9717f991', '624ef942-f51d-43fe-982d-3dd1c36f231a', '492d3b0d-ea65-40c6-9c39-ab49f21155f6', '0049c5af-628b-4244-8a23-725be860f0cb', 'cfa6c3cb-d672-4ab2-8cda-7f0b27de8a37', 'c0d8e9fa-84d4-4759-8bb1-735faf0f2a89', '528f58d7-64a6-4e46-9b73-9d1ab16615d5', '38721b9b-2319-4394-b7e1-1742e82a764b', 'fe7be237-ac21-4d8d-8b1a-9276885587a9', '30cc4d4e-25fe-424f-9dd1-75a856950019', 'c5071b14-8845-44c3-b81d-76c35cb96cd6', 'daebb7c8-c179-4c3d-b9e5-b72a74bdeff6', 'ded33a3a-e521-474d-b1bf-78d31a2fc2bb', 'e3c0dc19-5621-4f10-8464-4a615978e410', '4be24505-c078-44c4-b001-5924731ef908', 'd54c6931-1cde-40e8-ba31-f1fbe91c66df', 'cd87fac0-7758-45ae-8ed2-c9af71b35cf1', '16050fab-1224-46f7-9a9a-d503fea21ee8']

addFixed = month => forEach(ids, ( id, n ) => addJob({
  executiveUserId: id,
  unitType: 4,
  unitCount: 20,
  pricePerUnit: n ? 0.75 : 260,
  currency: n ? 1 : 3,
  jobDescription: 'Fixed',
  dateStarted: month + '-01T00:00:00Z',
  dateCompleted: month + '-28T00:00:00Z',
  serviceType: 13
}))

createInvoice = jobs => 
  Promise.all([
    data(axios.post('api/invoices', {
      jobIds: map(jobs.slice(0, 500), 'id'),
      preliminaryCosts: [],
      targetCurrency: 1
    })),
    jobs.length > 500 && createInvoice(jobs.slice(500))  
  ])

createInvoices = async jobs => (
  jobs ||= await allJobs(),
  // sort jobs by date and create an invoice for each batch of 500
  _(jobs)
    .sortBy('dateVerified')
    .chunk(500)
    .value()
    .map(createInvoice)
)

deleteInvoice = ({ id }) => axios.delete('api/invoices/' + id)

unpaidInvoices = async () => 
  (
    await data(axios.get('api/invoices?skip=0&limit=50'))
  ).filter(invoice => !invoice.status)

setProjectFilter = ({
  clientAccountIds = [],
  clientIds = [],
  createdByIds = [],
  creationDateFrom = null,
  creationDateTo = null,
  deadlineFrom = null,
  deadlineTo = null,
  domainIds = [],
  managerUserIds = [],
  searchName = null,
  sourceLanguageIds = [],
  statuses = [],
  targetLanguageIds = [],
  withoutClients = false,
  withoutManagers = false
} = {}) => axios.post('api/Projects/Filter', {
  clientAccountIds,
  clientIds,
  createdByIds,
  creationDateFrom,
  creationDateTo,
  deadlineFrom,
  deadlineTo,
  domainIds,
  managerUserIds,
  searchName,
  sourceLanguageIds,
  statuses,
  targetLanguageIds,
  withoutClients,
  withoutManagers
})

batchConfirm = ({ documentId, languageId }) => axios.post('api/SegmentTargets/BatchOperation/Confirm', {
  mode: 'manager',
  documentId,
  filterSetId: null,
  languageId,
  stageNumber: null
})


allProjects = async () => {
  delete promises.filterSets
  let allProjects = []
  let lastProjectId, lastProjectModificationDate
  while ( true ) {
    let { data: { projects, hasMoreProjects }} = 
      await axios.get('ssr-projects/page?tab=0', { 
        params: { lastProjectId, lastProjectModificationDate }
      })
    allProjects.push(...projects)
    if ( !hasMoreProjects )
      break
    ;(
      { id: lastProjectId, modificationDate: lastProjectModificationDate } = _.last(projects)
    )
  }
  return allProjects
}

completeProject = ({ id }) => axios.post(`api/Projects/${id}/ChangeStatus/3`)

expandProjects = async projects => 
  await Promise.all(projects.map(project => 
    axios.get(`api/Projects/${project.id}/Full`).then(
      ({ data }) => ({
        ...project, ...data
      })
    )
  ))

projectDocuments = ({ id }) => data(axios.get(`api/Projects/${id}/AllDocuments`))

allDocuments = async ( callback = identity ) => 
  Promise.all(
    ( await Promise.all(
      (
        await allProjects()
      ).map(projectDocuments)
    ) )
    .flat()
    .map(callback)  
  )

allTargets = async ( callback = identity ) => 
  Promise.all(
    map( 
      await allDocuments(), ({ targets, projectId }) =>
        map(targets, target => ({
          ...target, projectId
        }))
    )
    .flat()
    .map(callback)
  )

batchCopySourceToTarget = ({ documentId, languageId }) =>
      axios.post(`https://us.smartcat.com/api/SegmentTargets/BatchOperation/CopySourceToTarget`, {
        documentId, languageId, filterSetId: null, stageNumber: null, mode: 'manager'
      })

allIncompleteTargets = async () => ( await allTargets ).filter(t=>t.workflowStages[0].progress < 100)

getDocumentListId = async document => {
  let { id } = document
  let documentListId = await getPromise('documentListId', id, () => data(
    axios.post('api/WorkflowAssignments/CreateDocumentListId', [ id ])
  ))
  assign(document, { documentListId })
  return documentListId
}

getDocumentAssignments = async document => {

  try {
    return (
      await data(
        retry(
          async () => axios.get(`api/WorkflowAssignments/${document.projectId}/GetWorkflowStages?documentListId=${
            await getDocumentListId(document)
          }`)
        )
      )
    ).map( assignment => {
      let { name, targetLanguageId: languageId } = assignment
      let { targets, wordsCount } = document
      let workflowStage = find(
        find(
          targets, { languageId }
        ).workflowStages, { name }
      )
      return {
        ...assignment, document,
        workflowStage,
        wordsLeft: wordsCount - workflowStage.wordsTranslated
      }
    })
  } catch ( e ) {
    console.log(e)
    return []
  }

}

allAssignments = async ( predicate = identity, callback = identity ) => {
  let assignments = await allDocuments(getDocumentAssignments)
  assignments = assignments.flat()
  assignments = assignments.filter(predicate)
  
  return Promise.all(
    assignments.map(assignment => callback(assignment))
  )
}

let assignmentComplete = ({ name, targetLanguageId, document: { targets }}) =>
  !find(targets, ({ languageId, workflowStages }) =>
    languageId == targetLanguageId
    && find(workflowStages, { name })?.progress < 100
  )

getUnassigned = ( callback, predicate = identity ) =>
  allAssignments(assignment => {
    if ( !assignment.freelancerInvitations.length && !assignmentComplete(assignment) ) {
      let matchesOwnFilter = predicate(assignment)
      return matchesOwnFilter  
    } else
      return false
  }, callback)

getUnconfirmedAssignments = callback =>
  allAssignments(
    ({ freelancerInvitations, executives }) => freelancerInvitations.length && !executives.length,
    callback
  )

getIncompleteAssignments = async () =>
  filter(
    await allAssignments(),
    assignment => assignment.freelancerInvitations.length && !assignmentComplete(assignment)
  )

assignmentsDueIn = async ( hours = 0, callback = identity ) =>
  Promise.all( map(
    filter(
      await getIncompleteAssignments(), 
      ({ documents: [{ deadline }]}) => 
        deadline && ( new Date(deadline) - new Date() < hours*3600*1000 )
    )
  , assignment => callback( assignment, hours )) )

logOverdueAssignment = ({ 
  wordsLeft, targetLanguageId, freelancerInvitations: [{ name: supplierName }], document: { id: documentId, name: documentName }, documents: [{ deadline }]
}) =>
  console.log(supplierName, deadline, wordsLeft, documentName, `https://us.smartcat.com/editor?documentId=${documentId}&languageId=${targetLanguageId}`)

logUnassignedAssignment = ({
  // log document name and link to document
  document: { id: documentId, name: documentName }, targetLanguageId
}) =>
  console.log(documentName, `https://us.smartcat.com/editor?documentId=${documentId}&languageId=${targetLanguageId}`)

sendMessage = async (userId, message) => {
  axios.post(`api/chat/conversations/${(
    ( await getPromise(
      'conversation', 
      userId, 
      async () => data(axios.get(`api/chat/contacts/${userId}/conversation`, {params: { 
        accountId: ( await getUserContext() ).accountContext.accountId
      }}))
    ) ).id
  )}/messages`, message, {
    headers: {
      'Content-Type': 'application/json'
    }
  })
}

jobLink = ({ documents: [{ id }], targetLanguageId }) => 
  `https://us.smartcat.com/editor?documentId=${id}&languageId=${targetLanguageId}`

nudge = job => {
  let { documents: [{ deadline }], wordsLeft, freelancerInvitations: [{ id }]} = job
  deadline = new Date(deadline)
  let hours = Math.ceil( ( deadline - new Date() ) / 3600/1000 )
  return sendMessage(id, 
    `${
      hours > 0
        ? `${wordsLeft} words due in < ${hours} hours`
        : `${wordsLeft} WORDS OVERDUE BY > ${
          hours > -48
            ? `${-hours} HOURS`
            : `${Math.ceil(-hours/24)} DAYS`
        }`
    }: ${ jobLink(job) }`
  )
}

getUnassignedForTemplate = async ( callback = identity, templateName ) => {
  let templateLanguages = await getTemplateLanguages(templateName)
  return getUnassigned(callback, ({ targetLanguageId }) => templateLanguages.includes(targetLanguageId))
}

getTemplateLanguages = async templateName =>
  uniq(map(
    (await getAssignmentTemplate(templateName)).targetingRules[0].suppliers,
    'targetLanguageId'
  ))


assignSupplier = ({ targetLanguageId, document: { creationDate, documentListId, projectId } }, supplierId, { hours = 72, countFromNow }) =>
  retry(
    () => axios.post(`api/WorkflowAssignments/${projectId}/SaveAssignments?documentListId=${documentListId}&stageSelector=1`, {
      targetLanguageId,
      addedAssignedUserIds: [
        supplierId
      ],
      removedAssignedUserIds: [],
      removedInvitedUserIds: [],
      saveDeadline: true,
      deadline: addWorkingHours(countFromNow ? new Date() : creationDate, hours).toISOString()
    }
  ), 3
)

allAssignmentTemplates = () => getPromise('assignmentTemplates', 0, () => data(
  axios.get('api/assignment-templates/templates?targetCurrency=1'))
)

getAssignmentTemplate = async ( name = 'default' ) => {
  let id = find( await allAssignmentTemplates(), { name } ).id 
  return getPromise('assignmentTemplate', id, 
    () => data(axios.get(`api/assignment-templates/templates/${id}?targetCurrency=1`))
  )
}
  

assignFromTemplate = async ( assignment, templateName = 'default', { hours = 72, countFromNow } = {} ) => {
  let { targetLanguageId, name: stageName } = assignment
  let { targetingRules } = await getAssignmentTemplate(templateName)
  let targetingRule = find(targetingRules, { stageName })
  if ( targetingRule ) {
    let { suppliers } = targetingRule
    let supplier = find(suppliers, { targetLanguageId })
    if ( supplier ) {
      return assignSupplier(assignment, supplier.id, { hours, countFromNow })
    }
  }
}

// Team mgmt


// Editing

segmentFilters = {

  unconfirmed: {
    name: 'confirmation',
    isConfirmed: false,
    workflowStageNumber: 1
  }

}

postFilters = {

  empty: { target: { text: '' }},
  unconfirmed: { target: { isConfirmed: false } }

}

getFilterSetId = ( { id, targets }, segmentFilter ) =>
  axios.post(
    `api/Documents/${id}/SegmentsFilter?mode=manager`,
    [
      ...segmentFilter,
      { name: 'language', targetLanguageIds: map(targets, 'languageId') }
    ]
  ).then( r => r.data.id)

documentSegments = async ( { id: documentId, projectId, targets }, { filterKeys, keepPromises } = {} ) =>
  {
    !keepPromises && ( promises.filterSets = {} )

    if ( filterKeys.includes('unconfirmed') )
      targets = filter(targets, t => t.workflowStages[0]?.progress < 100)

    return ( await Promise.all(targets.map(async ({ languageId }) =>
      ( await axios.get('api/Segments', { params: {
        languageId,
        documentId,
        start: 0,
        limit: 1000,
        mode: 'manager',
        filterSetId: filterKeys && await getPromise('filterSets', documentId,
          () => getFilterSetId( { id: documentId, targets }, filterKeys.map(key => segmentFilters[key]).filter(identity) )
        )
      }}) ).data.items.map( item => ({ ...item, documentId, projectId, target: item.targets[0] }) )
    )) ).flat()
  }

allSegments = async ( filterKeys = [], callback = identity ) => {
  let documents = await allDocuments()

  let segments = ( await Promise.all(
    documents.map(async document => {
      try {
        let segments = await documentSegments(document, { filterKeys, keepPromises: true })

        for ( let key of filterKeys ) {
          let postFilter = postFilters[key]
          if ( postFilter )
            segments = filter(segments, log(postFilter))
        }
      
        segments = await Promise.all(
          segments.map(callback)
        )

        return segments
      
      } catch(error) {
        return []
      }
    })
  ) ).flat()

  return segments
}

allSegmentsWithMatches = async ( filterKeys = ['unconfirmed', 'empty'], callback = identity ) => {

  
  let segments = await allSegments(filterKeys, async segment => {
    try {
      let { id: segmentId, targets: [{ documentId, languageId }] } = segment
      segment.matches = ( await retry( () => 
        axios.get('api/SegmentTargets/TMTranslations', { params: {
          languageId, segmentId, documentId, mode: 'manager'
        }})
      ) ).data
    } catch(error) {
      log({error})
      segment.matches = null
    }
    return await callback(segment)
  })
  segments = segments.filter(s=>s.matches?.[0]?.matchPercentage>=100)
  return segments

}

putSegment = ( { id, targets: [{ languageId, documentId }] }, text, action = '' ) =>
  text &&
  retry(() =>
    axios.put(`api/Segments/${id}/SegmentTargets/${languageId}/${action}?documentId=${documentId}&mode=manager&ignoreWarnings=true`,
    { 
      text, tags: []
    }
  )
)

confirmSegment = segment =>
  putSegment(segment, segment.targets[0].text, 'Confirm')

editSegment = async ( segment, text ) => {
  await putSegment( segment, text )
  Object.assign(segment.targets[0], { text })
}

copySourceToTarget = segment => 
  segment.targets[0].text != segment.source.text &&
  editSegment(segment, segment.source.text)

pretranslateSegment = async segment => {
  let match = segment.matches?.find(m=>m.matchPercentage>=100)
  if ( match ) {
    await editSegment(segment, match.targetText)
    await confirmSegment(segment)
  }
}

completeTarget = ({ documentId, languageId }) => 
  axios.post(`api/Documents/${documentId}/Targets/${languageId}/Complete`)

completeFinishedTargets = async () =>
  ( await allTargets() )
  .filter(t => t.workflowStages[0].progress == 100 && t.status != 3)
  .forEach(target => retry(() => completeTarget(target)))

projectsByCompletedWordCount = projects => 
  _(projects)
  .map(({ id, name, totalSourceWordsCount, workflowStages: [{ progress }]}) => ({
    name,
    url: `https://us.smartcat.com/projects/${id}`, 
    wordCount: totalSourceWordsCount*progress/100
  }))
  .orderBy('wordCount', 'desc').value()

// Function to do all the stuff you usually have to do
async function doAll({ dont = [] } = {}) {

  let actions = {
    completeProjects: () => allProjects().then( projects => 
      projects.forEach(completeProject)
    ),
    assign: () => getUnassignedForTemplate(assignFromTemplate),
    nudge: () => assignmentsDueIn(0, nudge),
    pretranslate: () => allSegmentsWithMatches(['unconfirmed'], pretranslateSegment),
    completeTargets: () => completeFinishedTargets()
  }

  for(key in actions) {

    try {
      if ( !dont.includes(key) ) {
        console.log('Current action: ', key)
        await actions[key]()
        console.log('Action completed: ', key)
      }
    } catch(error) {
      log({error})
    }

  }
  
}


module.exports = {
  allSegmentsWithMatches
}