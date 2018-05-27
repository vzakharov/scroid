async function filterDocuments(options) {

    let documents = this.project.documents

    if (options.matches) {
        
    }

}

// Todo: think of something more elegant
async function setDocument(documentNameOrDocument, targetLanguage) {

    let document = this.document = (typeof documentNameOrDocument == 'string') ?
        find(this.project.documents, {name: documentNameOrDocument, targetLanguage}) :
        documentNameOrDocument

    assign(document, decomposeDocumentId(document.id))

    return document

}

module.exports = {filterDocuments, setDocument}