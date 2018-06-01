module.exports = {

    decomposeDocumentId: function(compositeId) {
        let [documentId, targetLanguageId] = compositeId.match(/(\d+)_(\d+)/).slice(1)
        return {documentId, targetLanguageId}
    },

    

    stringifyRanges: function(ranges) {
        if (ranges.length > 0) {
            return ranges.map(range => {
                let {startSegmentNumber, endSegmentNumber} = range
                if (startSegmentNumber == endSegmentNumber) {
                    return startSegmentNumber
                } else {
                    return `${range.startSegmentNumber}-${range.endSegmentNumber}`
                }
            }).join(',')    
        } else {
            return ''
        }
    }

}