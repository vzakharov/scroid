const {
    isArray, isEqual, remove, includes
} = require('lodash')

module.exports = async function(documents) {
    if (!isArray(documents)) documents = [documents]

    let documentNames = []

    for (let document of documents) {

        let {name} = document
        if (includes(documentNames, name)) {
            continue
        }
        documentNames.push(name)

        let segments = await this._getSegments(document)

        let oldContext
        let segmentsToJoin = []

        for (let i = 0; i < segments.length; i++) {
            let segment = segments[i]
            let {localizationContext} = segment
            if (isEqual(oldContext, localizationContext)) {
                segmentsToJoin.push(segment)
            } else {
                if (segmentsToJoin.length > 1) {
                    await this._editor.put('Segments/Join', segmentsToJoin, {params: {
                        documentId: document.documentId,
                        languageIds: document.targetLanguageId
                    }})
                    
                    // Update segments after joining and remove those already checked
                    segments = await this._getSegments(document)
                    i -= segmentsToJoin.length - 1
                }
                oldContext = localizationContext
                segmentsToJoin = [segments[i]]
            }
        }
    }
}