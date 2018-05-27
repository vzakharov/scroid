const {find} = require('lodash')

module.exports = async function() {

    let {document} = this
    let segments = await this._getSegments()
    // let sourceTexts = []

    for (let segment of segments) {
        let {documentId, targetLanguageId} = document
        let target = segment.targets[0]
        let {stageNumber} = target

        let {text} = target
        // let sourceText = segment.source.text
        
        // if (sourceTexts.includes(sourceText)) {
        //     continue
        // }

        // sourceTexts.push(sourceText)

        let data = {languageId: targetLanguageId, tags: [], text}
        let params = {documentId}

        let url = `Segments/${segment.id}/SegmentTargets/${targetLanguageId}`
        await this._editor.put(`${url}/WorkflowRollback`, data, {params})
        await this._editor.put(`${url}/Confirm`, data, {params})
    }

}