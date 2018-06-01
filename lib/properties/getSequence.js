const {find} = require('lodash')

module.exports = async function(name) {

    let sequences = (
        await this.mixmax.get('sequences', {params: {name}})
    ).data.results
    
    let sequence = find(sequences, {name})

    return sequence
}