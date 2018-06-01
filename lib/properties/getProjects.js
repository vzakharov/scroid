function decomposeDocumentId(compositeId) {
    let [documentId, targetLanguageId] = compositeId.match(/(\d+)_(\d+)/).slice(1)
    return {documentId, targetLanguageId}
}


module.exports = async function(params) {

    let projects = (
        await this.smartcat.get('project/list', {params})
    ).data

    for (let project of projects) {
        for (let document of project.documents) {
            Object.assign(document, decomposeDocumentId(document.id))
        }
    }

    return projects

}