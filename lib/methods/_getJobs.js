const _ = require('lodash')
const {assign, find, groupBy, includes, keyBy, omit, pick, reject, remove, round, sumBy, values, filter} = _
const {stringify, parse} = JSON
const pivotBy = require('../pivotBy')
const h = require('../helpers')
const statusesById = {
    1: 'inProgress',
    2: 'invited',
    4: 'completed',
    9: 'declined'
}

function renameKeys(object, change) {
    for (let before in change) {
        let after = change[before]
        object[after] = object[before]
        delete object[before]
    }
}

// Todo: report for all stages
module.exports = async function (options) {

    let {projects, stage, excludeCompleted} = options
    let jobs = []
    let languagesById = {}

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
            let assignees = reject(item.executives, {rateValue: null})
            for (let assignee of assignees) {
                for (let job of assignee.jobs) {

                    assign(job, omit(assignee, 'jobs'))

                    renameKeys(job, {
                        targetLangaugeId: 'targetLanguageId', // Typo in API
                        userName: 'assignee',
                        executiveLastVisitTime: 'lastSeen'
                    })

                    let {
                        assignedWords, documentName, progress,
                        effectiveWordsDone, rateValue, segmentRanges
                    } = job

                    assign(job, {
                        earned: effectiveWordsDone * rateValue,
                        effectiveWordsDone: round(effectiveWordsDone),
                        targetLanguage: languagesById[job.targetLanguageId],
                        projectName: project.name,
                        projectId: project.id,
                        progress: round(progress * 100),
                        split: segmentRanges.length > 0,
                        wordsLeft: round((1 - progress) * assignedWords),
                        status: statusesById[assignee.status]
                    })

                    if (job.split) {
                        job.segmentRangeString = h.stringifyRanges(segmentRanges)
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
        return stringify(pick(job, ['projectName', 'documentName', 'targetLanguage']))
    })

    for (let key in groups) {
        let {projectName, documentName, targetLanguage} = parse(key)
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

        let documentWordsLeft = document.wordsCount - document.workflowStages[stage - 1].wordsTranslated
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

                    let filters = [
                        {name: 'confirmation', isConfirmed: false, workflowStageNumber: stage}
                    ]

                    let segments = await this._getSegments({document, filters})
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

    let dimensions = [
        ['projectName', [
            ['documentName', 'targetLanguage', 'assignee'],
            ['language', 'assignee']
        ]],
        ['targetLanguage', [
            ['projectName', 'assignee', 'documentName'],
            ['assignee', 'projectName', 'documentName']
        ]],
        ['assignee', 'projectName', 'documentName']
    ]
    let summarizers = {
        wordsLeft: sumBy,
        effectiveWordsDone: sumBy
    }

    let pivotedJobs = this.pivotedJobs = pivotBy(jobs, dimensions, summarizers, {order: ['wordsLeft', 'desc']})

    // Todo: why are some languages lost from this.jobsByLanguages??
    return assign({allJobs: jobs}, pivotedJobs)

}