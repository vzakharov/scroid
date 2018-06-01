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
        enrich: true, allowMissingVariables: false, scheduledAt: false
    })

    return data

}