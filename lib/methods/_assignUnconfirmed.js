const {assign} = require('lodash')

module.exports = async function() {

    let {document, stage, assignee} = arguments[0]
    let {_smartcat} = this
    let {documentId, targetLanguageId} = document

    let params = {documentId, _page: 'Editor', mode: 'manager'}

    let filters = [
        {name: 'confirmation', isConfirmed: false, workflowStageNumber: stage}
    ]

    let segments = await this._getSegments({document, filters})

    let ranges = this.ranges = []

    let endSegmentNumber, range

    for (let i = 0; i < segments.length; i++) {

        let segment = segments[i]

        endSegmentNumber = segment.number

        if (range && segment.number == segments[i-1].number + 1) {
            assign(range, {endSegmentNumber})
        } else {
            ranges.unshift({
                startSegmentNumber: segment.number,
                endSegmentNumber
            })
            range = ranges[0]
        }

    }

    ranges = ranges.reverse()

    await this._assignRanges({document, stage, ranges, assignee})

    return ranges

}