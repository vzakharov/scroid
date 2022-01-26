const require = async url => {
  eval(
    await (
      await fetch(url)
    ).text()
  )
}

await require('https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js')
await require('https://cdnjs.cloudflare.com/ajax/libs/axios/0.25.0/axios.min.js')


;({ forEach, map, range, without } = _)

days = without(range(1,32), 4, 5, 11, 12, 18, 19, 25, 26)
dates = map(days, day => new Date(2021, 11, day, 23, 59, 59).toISOString())

addHourlies = () => forEach(dates, addHourly)

addHourly = date => addJob({
  executiveUserId: '97d58fd3-2065-4000-81c9-bbad9717f991',
  unitType: 4,
  unitCount: 20,
  pricePerUnit: 260,
  currency: 3,
  jobDescription: 'Hourly',
  dateStarted: date,
  dateCompleted: date,
  serviceType: 13
})

addProRata = ({ wordsTranslated: unitCount, date }, id) =>
  addJob({
    executiveUserId: '97d58fd3-2065-4000-81c9-bbad9717f991',
    unitType: 1,
    unitCount,
    pricePerUnit: 3.55,
    currency: 3,
    jobDescription: 'https://us.smartcat.com/projects/'+id,
    dateStarted: date,
    dateCompleted: date,
    serviceType: 13
  })

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
    dateStarted,
    dateCompleted,
    externalNumber: null,
    projectId: null,
    serviceType,
    sourceLanguageId: null,
    targetLanguageId: null
  }),
  "method": "POST",
  headers: {'content-type': 'application/json'}
})

batchConfirm = ( documentId, languageId ) => axios.post('api/SegmentTargets/BatchOperation/Confirm', {
  mode: 'manager',
  documentId,
  filterSetId: null,
  languageId,
  stageNumber: null
})


deleteJob = ({ id }) => fetch(`https://us.smartcat.com/api/jobs/${id}/canceled`, {
  "method": "PUT",
})

groupJobs = jobs => _(jobs).groupBy('projectId').mapValues(jobs => ({ wordsTranslated: _.sumBy(jobs, 'wordsTranslated'), date: _.minBy(jobs, 'dateVerified').dateVerified})).value()

addAllProRata = jobs => forEach(groupJobs(jobs), addProRata)

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

createInvoice = jobs => fetch("https://us.smartcat.com/api/invoices", {
  "body": JSON.stringify({
    jobIds: map(jobs, 'id'),
    preliminaryCosts: [],
    targetCurrency: 1
  }),
  "method": "POST",
  headers: {'content-type': 'application/json'}
})

allProjects = async () => {
  let allProjects = []
  let lastProjectId, lastProjectModificationDate
  while ( true ) {
    let { data: { projects, hasMoreProjects }} = 
      await axios.get('ssr-projects/page?tab=0', { params: { lastProjectId, lastProjectModificationDate }})
    allProjects.push(...projects)
    if ( !hasMoreProjects )
      break
    ;(
      { id: lastProjectId, modificationDate: lastProjectModificationDate } = _.last(projects)
    )
  }
  return allProjects
}

expandProjects = async projects => 
  await Promise.all(projects.map(project => 
    axios.get(`api/Projects/${project.id}/Full`).then(
      ({ data }) => ({
        ...project, ...data
      })
    )
  ))

projectDocuments = async ({ id }) => (await axios.get(`api/Projects/${id}/AllDocuments`)).data

allDocuments = async () => ( await Promise.all((await allProjects()).map(projectDocuments)) ).flat()

projectsByCompletedWordCount = projects => 
  _(projects)
  .map(({ id, name, totalSourceWordsCount, workflowStages: [{ progress }]}) => ({
    name,
    url: `https://us.smartcat.com/projects/${id}`, 
    wordCount: totalSourceWordsCount*progress/100
  }))
  .orderBy('wordCount', 'desc').value()