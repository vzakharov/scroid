module.exports = {

    decomposeDocumentId(compositeId) {
        return compositeId.match(/(\d+)_(\d+)/).slice(1)
    }

}