const _ = require('lodash')
const {
    remove
} = _

module.exports = async function() {

    let completedCount = 0
    
    let documents = arguments[0].slice()
    remove(documents, {status: 'completed'})

    documentLoop:
    for (let document of documents) {
        let {documentId, targetLanguageId} = document
        for (let stage of document.workflowStages) {
            if (stage.progress < 100) {
                continue documentLoop
            }
        }
        await this._smartcat.post(`Documents/${documentId}/Targets/${targetLanguageId}/Complete`)
        completedCount++
        console.log(`${document.name}_${document.targetLanguage} (${completedCount}/${documents.length})`)
    }
}