const _ = require('lodash')

const saveTypes = {
    0: "Manual input",
    1: "TM insertion",
    6: "Repetition insertion"
}

module.exports = async function () {

    let contributors = []
    
    // Todo: think of a more elegant solution
    let charcode = 65

    await this._getJobsByLanguages()
    await this._segments()

    let {jobsByLanguages, segments, document} = this
    let segmentAssignees = {}

    let jobsByMembers = jobsByLanguages[document.targetLanguage]

    for (let userName in jobsByMembers) {

        let jobsByStatuses = jobsByMembers[userName]

        for (let statusName in jobsByStatuses) {
            
            if (statusName == 'declined') continue

            for (let job of jobsByStatuses[statusName]) {
                let {status} = job
                for (let range of job.segmentRanges) {
                    for (let i = range.startSegmentNumber; i <= range.endSegmentNumber; i++) {
                        if (!segmentAssignees[i] || segmentAssignees[i].status > status) {
                            segmentAssignees[i] = {userName, status, statusName}
                        }
                    }
                }
            }

        }

    }

    let heatmap = segments.map(segment => {
        let target = segment.targets[0]
        let data
        let {isConfirmed} = target 

        if (!isConfirmed) {
            data = segmentAssignees[segment.number]
            if (!data) return '.'
        } else {
            let lastRevision = target.revisions[0]

            if (!lastRevision || !lastRevision.userName || lastRevision.saveType != 0) return '>'

            data = lastRevision
        }

        let {userName} = data

        if (!contributors[userName]) {
            contributors[userName] = String.fromCharCode(charcode++)
        }

        let result = contributors[userName]

        if (!isConfirmed) {
            result = result.toLowerCase()
        }
        
        return result

    }).join('')

    contributors = _.invert(contributors)

    heatmap = heatmap.match(/.{1,100}/g).join("\n")

    console.log(heatmap + '\n')
    console.log(JSON.stringify(contributors, null, 1))

    return {heatmap, contributors}

}