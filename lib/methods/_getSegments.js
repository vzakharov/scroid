const {assign} = require('lodash')
const {decomposeDocumentId} = require('../helpers')

module.exports =  async function({document, filters}) {

    let segments = this.segments = []

    let  = arguments[0]

    let [start, limit] = [0, 50]

    while(1) {

        let {documentId, targetLanguageId} = document

        let params = {
            start, limit, documentId, languageIds: targetLanguageId, 
            mode: 'manager', _page: 'Editor'
        }

        if (filters) {
            let defaultFilter = {
                name: 'language',
                targetLanguageIds: [targetLanguageId]
            }

            let filterSetId = (
                await this._smartcat.post(`Documents/${documentId}/SegmentsFilter`, 
                    [... filters, defaultFilter],
                    {params})
            ).data.id

            assign(params, {filterSetId})
        }

        let {total, items} = (
            await this._smartcat.get('Segments', {params})
        ).data

        segments.push(... items)

        if (segments.length >= total) {
            return segments
        } 

        start += 50
        limit = total - start

    }
    
}