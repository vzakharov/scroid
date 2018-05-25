const {decomposeDocumentId} = require('../helpers')

module.exports = {

    _segments: async function() {

        this.segments = []
        let {segments, document} = this

        let [start, limit] = [0, 50]

        while(1) {

            let [documentId, languageIds] = decomposeDocumentId(document.id)

            let params = {
                start, limit, documentId, languageIds, 
                mode: 'manager', _page: 'Editor'
            }

            let {data} = await this._smartcat.get('Segments', {params})

            let {total, items} = data
            segments.push(... items)

            if (segments.length >= total) {
                return segments
            } 

            start += 50
            limit = total - start
    
        }
        
     }

}