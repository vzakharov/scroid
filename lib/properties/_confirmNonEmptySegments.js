const {
    find
} = require('lodash')

module.exports = async function(document, {stage}) {

    let filters = this.createFilter({confirmed: false, changed: true, stage})

    let segments = await this._getSegments(document, {filters})
    let editor = this._editor(document, {exclude: ['languageIds']})

    for (let segment of segments) {

        let languageId = document.targetLanguageId

        // Todo: works with other stages?
        let target = find(segment.targets, {stageNumber: stage})
        if (target.isConfirmed) continue // because they could have got confirmed by this method

        let {text} = target
        let data = {
            languageId, tags: [], text
        }
        await editor.put(`Segments/${segment.id}/SegmentTargets/${languageId}/Confirm`, data)
    }
}