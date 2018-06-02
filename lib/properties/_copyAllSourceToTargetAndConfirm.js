const {
    assign
} = require('lodash')

module.exports = async function(document, options = {}) {

    let {stage} = assign({
        stage: 1        
    }, options)

    await this._editor(document).post('SegmentTargets/BatchOperation/CopySourceToTarget', {params: {
        isWorkingInGridView: false
    }})

    await this._confirmNonEmptySegments(document, {stage})

}