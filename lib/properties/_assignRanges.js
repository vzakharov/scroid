module.exports = async function() {

    let {assignee, document, stage, ranges} = arguments[0]
    let {_smartcat} = this
    let {documentId, targetLanguageId} = document

    let data = []
    let params = {
        targetLanguageId
    }

    for (let range of ranges) {

        let {startSegmentNumber, endSegmentNumber} = range

        let [startIncludedSegmentOrder, endExcludedSegmentOrder, wordsCount] = 
            [startSegmentNumber, endSegmentNumber + 1, 0]

        data.push({
            startSegmentNumber, endSegmentNumber, 
            startIncludedSegmentOrder, endExcludedSegmentOrder, wordsCount
        })

    }

    await _smartcat.post(`WorkflowAssignments/${documentId}/Split/${stage}/User/${assignee.id}`, data, {params})

    console.log(`${document.name} stage ${stage} ranges ${this.stringifyRanges(ranges)} assigned to ${assignee.name}`)
}