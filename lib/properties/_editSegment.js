const {
    assign
} = require('lodash')

module.exports = async function(document, segment, text, tags = [], options) {

    options = assign({
        confirm: true
    }, options)

    let languageId = document.targetLanguageId
    let editor = this._editor(document, {exclude: ['languageIds']})
    assign(editor.defaults.params, {languageId})

    await editor.put(`Segments/${segment.id}/SegmentTargets/${languageId}`, {
        languageId,
        tags,
        text
    }, {params: {
        saveType: 0
    }})

    if (options.confirm) {
        await editor.put(`Segments/${segment.id}/SegmentTargets/${languageId}/Confirm`, {
            languageId,
            tags,
            text
        })    
    }

    console.log(`Segment ${segment.number}: ${segment.source.text} → ${text}`)

}