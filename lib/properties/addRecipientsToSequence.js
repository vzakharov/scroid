const toCsv = require('json2csv')

const {
    assign, map
} = require('lodash')

module.exports = async function({sequence, sequenceName, emails, recipients, variables}) {
    if (!recipients) {
        recipients = map(emails, email => ({
            email, variables: assign(variables, {email})
        }))
    }

    if (!sequence) sequence = await this.getSequence(sequenceName)

    let {data} = await this.mixmax.post(`sequences/${sequence._id}/recipients`, {
        recipients,
        enrich: false, allowMissingVariables: false, scheduledAt: false
    })

    console.log(toCsv.parse(data.recipients, {delimiter: '\t', quote: ''}))

    return data

}