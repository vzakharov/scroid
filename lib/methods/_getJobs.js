const _ = require('lodash')
const {assign, includes, keyBy, pick, reject, remove, round, sumBy, values, filter} = _
const pivotBy = require('../pivotBy')
const h = require('../helpers')

// Todo: report for all stages
module.exports = async function (options) {

    let {projects, stage, excludeCompleted} = options
    let allJobs = []

    for (let project of projects) {

        
        let jobsByLanguages = await this._getJobsByLanguages(project)

        for (let language in jobsByLanguages) {

            let jobsByMembers = jobsByLanguages[language]

            for (let assignee in jobsByMembers) {

                let jobsByStatuses = jobsByMembers[assignee]

                let {inProgress, invited} = jobsByStatuses

                for (let status in jobsByStatuses) {

                    if (!includes(['inProgress', 'invited'], status)) {
                        continue
                    }

                    for (let job of jobsByStatuses[status]) {

                        let {assignedWords, documentName, progress, segmentRanges, effectiveWordsDone} = job

                        effectiveWordsDone = round(effectiveWordsDone)

                        let wordsLeft = round((1 - progress) * assignedWords)
                        
                        let projectName = project.name

                        let split = segmentRanges.length > 0
    
                        allJobs.push({
                            language, projectName, documentName, assignee,
                            wordsLeft, effectiveWordsDone, split, status, segmentRanges
                        })
    
                    }
    
                }

                

            }
        }

        // If at least one job is split, all non-splitted should be deleted
        // Todo: optimize to avoid unneeded iterations
        for (let job of filter(allJobs, {split: true})) {
            let {language, projectName, documentName} = job
            remove(allJobs, {split: false, language, projectName, documentName})
        }

        // Normalize documents that weren’t split by ranges
        for (let project of projects) {
            for (let document of project.documents) {
                let documentJobs = filter(allJobs, {language: document.targetLanguage, documentName: document.name, projectName: project.name})
                if (documentJobs.length == 0) continue

                let documentWordsLeft = document.wordsCount - document.workflowStages[stage - 1].wordsTranslated
                let wordsLeftPerJobs = sumBy(documentJobs, 'wordsLeft')

                if (documentWordsLeft != wordsLeftPerJobs) {

                    if (documentWordsLeft == 0) {
                        for (let job of documentJobs) {
                            job.wordsLeft = round(job.wordsLeft * documentWordsLeft / wordsLeftPerJobs)
                        }    
                    } else if (!documentJobs[0].split) {
                        for (let job of documentJobs) {
                            job.wordsLeft = documentWordsLeft / documentJobs.length
                        }
                    } else {

                        // Todo: remove "document", "project", etc. from instance variables
                        let filters = [
                            {name: 'confirmation', isConfirmed: false, workflowStageNumber: stage}
                        ]

                        let segments = await this._getSegments({document, filters})
                        let segmentsByNumber = keyBy(segments, 'number') 

                        for (let job of reject(documentJobs, {wordsLeft: 0})) {
                            job.wordsLeft = 0
                            for (let range of job.segmentRanges) {
                                for (let i = range.startSegmentNumber; i <= range.endSegmentNumber; i++) {
                                    let segment = segmentsByNumber[i]
                                    if (segment) {
                                        job.wordsLeft += segment.wordsCount
                                    }
                                }                            
                            }
                        }
    
                    } 


                }
    
            }
        }

    }

    if (excludeCompleted) {
        remove(allJobs, {wordsLeft: 0})
    }

    // Make segmentRanges more readable
    for (let job of allJobs) {
        job.segmentRanges = h.stringifyRanges(job.segmentRanges)
    }

    let dimensions = [
        ['projectName', [
            ['documentName', 'language', 'assignee'],
            ['language', 'assignee']
        ]],
        ['language', [
            ['projectName', 'assignee', 'documentName'],
            ['assignee', 'projectName', 'documentName']
        ]],
        ['assignee', 'projectName', 'documentName']
    ]
    let summarizers = {
        wordsLeft: sumBy,
        effectiveWordsDone: sumBy
    }

    let pivotedJobs = this.pivotedJobs = pivotBy(allJobs, dimensions, summarizers, {order: ['wordsLeft', 'desc']})

    // Todo: why are some languages lost from this.jobsByLanguages??
    return assign({allJobs}, pivotedJobs)

}