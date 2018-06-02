const _ = require('lodash')
const {assign, find, groupBy, includes, keyBy, omit, pick, reject, remove, round, sumBy, values, filter} = _
const {stringify, parse} = JSON

const statusesById = {
    1: 'inProgress',
    2: 'invited',
    3: 'awaitingAssignment',
    4: 'completed',
    5: 'internal',
    6: 'processingPayment',
    7: 'paidOut',
    9: 'declined'
}

const stageTypesById = {
    1: 'translation',
    2: 'editing',
    3: 'proofreading',
    4: 'postediting'
}

// Todo: think if it needs to be soft-coded
const normalizedWordFactor = {
    'translation': 1,
    'editing': 0.5,
    'proofreading': 0.35,
    'postediting': 0.2
}


module.exports = async function (options) {

    let {projects, excludeCompleted} = options
    let jobs = []
    let languagesById = {}

    let exchangeRates = {}

    let reportCurrencies = ['USD', 'RUB']

    for (let currency of reportCurrencies) {
        assign(exchangeRates, await this.getExchangeRates(currency))
    }

    for (let project of projects) {

        for (let document of project.documents) {
            if (!languagesById[document.targetLanguageId]) {
                languagesById[document.targetLanguageId] = document.targetLanguage
            }
        }

        let {executivesByJobStatus} = (
            await this._smartcat.get(`Projects/${project.id}/Team`)
        ).data
        
        for (let key in executivesByJobStatus) {
            let item = executivesByJobStatus[key]
            let status = statusesById[item.jobStatus]
            if (status == 'internal') {
                continue
            }
            let assignees = reject(item.executives, {rateValue: null})
            for (let assignee of assignees) {
                for (let job of assignee.jobs) {

                    assign(job, omit(assignee, 'jobs'))

                    this.renameKeys(job, {
                        targetLangaugeId: 'targetLanguageId', // Typo in API
                        userName: 'assignee',
                        executiveLastVisitTime: 'lastSeen',
                        rateCurrency: 'currencyId',
                        rateValue: 'rate',
                        stageType: 'stageTypeId'
                    })

                    job.stageType = stageTypesById[job.stageTypeId]

                    job.currency = this.currenciesById[job.currencyId]

                    let {
                        assignedWords, documentName, progress,
                        effectiveWordsDone, segmentRanges
                    } = job

                    // Todo: Remove harcoding!!! via /api/usercontext
                    if (job.myTeamProfileType == 1) {
                        job.rate *= 1.05
                    } else {
                        job.rate *= 1.1
                    }

                    job.normalizedWordsDone = effectiveWordsDone * normalizedWordFactor[job.stageType]

                    job.amount = round(effectiveWordsDone * job.rate, 2)

                    for (let reportCurrency of reportCurrencies) {
                        for (let variableName of ['amount', 'rate']) {
                            let variableNameInReportCurrency = `${variableName}${reportCurrency}`

                            job[variableNameInReportCurrency] = (reportCurrency == job.currency) ?
                                job[variableName] :
                                job[variableName] / exchangeRates[reportCurrency][job.currency]

                            if (variableName == 'amount') {
                                job[variableNameInReportCurrency] = round(job[variableNameInReportCurrency], 2)
                            }
                        }
                    }

                    

                    job.isPaidByCustomer = !!job.datePaidByCustomer
                    job.isPaidToFreelancer = !!job.datePaidToFreelancer

                    assign(job, {
                        effectiveWordsDone: round(effectiveWordsDone),
                        targetLanguage: languagesById[job.targetLanguageId],
                        projectName: project.name,
                        projectId: project.id,
                        progress: round(progress * 100),
                        split: segmentRanges.length > 0,
                        wordsLeft: round((1 - progress) * assignedWords),
                        status: statusesById[assignee.status]
                    })

                    delete job.rateCurrency

                    if (job.split) {
                        job.segmentRangeString = this.stringifyRanges(segmentRanges)
                    } else {
                        delete job.segmentRanges
                    }

                    jobs.push(job)
    
                }
            }
        }

    }

    // // If at least one job is split, all non-splitted should be deleted
    // // Todo: optimize to avoid unneeded iterations
    // for (let job of filter(allJobs, {split: true})) {
    //     let {language, projectName, documentName} = job
    //     remove(allJobs, {split: false, language, projectName, documentName})
    // }

    // Correct incorrect wordsLeft counts
    let groups = groupBy(jobs, job => {
        return stringify(pick(job, ['projectName', 'documentName', 'targetLanguage', 'stageNumber']))
    })

    for (let key in groups) {
        let {projectName, documentName, targetLanguage, stageNumber} = parse(key)
        let documentJobs = groups[key]
        let project = find(projects, {name: projectName})
        let document = find(project.documents, {name: documentName, targetLanguage})

        if (documentJobs.length == 0) continue

        if (!document) {
            for (let job of documentJobs) {
                job.wordsLeft = 0
            }
            continue
        }

        let documentWordsLeft = document.wordsCount - document.workflowStages[stageNumber - 1].wordsTranslated
        let wordsLeftPerJobs = sumBy(documentJobs, 'wordsLeft')

        if (documentWordsLeft != wordsLeftPerJobs) {

            if (documentWordsLeft == 0) {
                for (let job of documentJobs) {
                    job.wordsLeft = 0
                }    
            } else {
                let jobsBySplit = groupBy(documentJobs, 'split')
                let splitJobs = jobsBySplit['true']
                let unsplitJobs = jobsBySplit['false']

                if (splitJobs) {

                    if (unsplitJobs) {
                        for (let unsplitJob of unsplitJobs) {
                            let {wordsLeft} = unsplitJob
                            wordsLeftPerJobs -= wordsLeft
                            unsplitJob.wordsLeft = 0
                        }
                    }

                    if (documentWordsLeft == wordsLeftPerJobs) {
                        continue
                    }

                    let filters = this.createFilter({confirmed: false, stage: stageNumber})

                    let segments = await this._getSegments(document, {filters})
                    let segmentsByNumber = keyBy(segments, 'number') 

                    for (let splitJob of reject(splitJobs, {wordsLeft: 0})) {
                        splitJob.wordsLeft = 0
                        for (let range of splitJob.segmentRanges) {
                            for (let i = range.startSegmentNumber; i <= range.endSegmentNumber; i++) {
                                let segment = segmentsByNumber[i]
                                if (segment) {
                                    splitJob.wordsLeft += segment.wordsCount
                                }
                            }                            
                        }
                    }

                }  else  {
                    let jobsByDeclined = groupBy(documentJobs, job => job.status == 'declined')
                    let declinedJobs = jobsByDeclined[true]
                    let nonDeclinedJobs = jobsByDeclined[false]
                    for (let job of nonDeclinedJobs || []) {
                        job.wordsLeft = documentWordsLeft / nonDeclinedJobs.length
                    }
                    for (let job of declinedJobs || []) {
                        job.wordsLeft = 0
                    }
                } 
            }


        }
    }

    if (excludeCompleted) {
        remove(jobs, {wordsLeft: 0})
    }

    // Todo: why are some languages lost from this.jobsByLanguages??
    return jobs

}