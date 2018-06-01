const diff = require('diff') 

const {
    assign, escapeRegExp
} = require('lodash')

module.exports = async function(document) {

    let {targetLanguageId} = document

    let filters = this.createFilter({confirmed: false, changed: true, stage: 1})

    let segments = await this._getSegments(document, {filters})
    let editor = this._editor(document, {exclude: ['languageIds']})
    assign(editor.defaults.params, {languageId: targetLanguageId})

    for (let segment of segments) {

        let {data} = await editor.get('SegmentTargets/TMTranslations', {params: {
            segmentId: segment.id
        }})

        if (data.length > 0) {
            let changes = diff.diffChars(data[0].sourceText, segment.source.text)
            
            if (changes.length > 2 || changes[0].added || changes[0].removed) continue

            // Todo: generalize for removed punctuation
            if (changes[1].removed || !changes[1].added) continue

            let {value} = changes[1]
            let {text} = segment.targets[0]

            // Todo: de-hardcode Asian languages
            if (document.targetLanguage.match(/ja|zh-Hans.*/)) {
                if (value != '.') {
                    continue
                }
                value = '。'
            }

            if (text.match(`${escapeRegExp(value)}$`)) continue

            text += value

            await editor.put(`Segments/${segment.id}/SegmentTargets/${targetLanguageId}`, {
                languageId: targetLanguageId,
                tags: [],
                text
            }, {params: {
                saveType: 0
            }})

            await editor.put(`Segments/${segment.id}/SegmentTargets/${targetLanguageId}/Confirm`, {
                languageId: targetLanguageId,
                tags: [],
                text
            })

        }

    }

}