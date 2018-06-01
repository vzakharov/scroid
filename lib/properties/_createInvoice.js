const {assign, map} = _ = require('lodash')

module.exports = async function(payables, options) {

    let defaults = {
        currency: 'RUB'
    }

    options = assign(defaults, options)

    let {currency} = options

    let calculationIds = map(payables, 'customerCalculationId')
    // let includedJobIds = map(payables, 'id')

    // let {data} = await this._marketplace.post('billing/invoice/draft', {
    //     datePayUntil: null,
    //     freelancerId: null,
    //     includedJobIds,
    //     projectId: null
    // })

    // let receiverId = data[0].receiver.id

    // Todo: remove receiver hardcoding?
    return await this._marketplace.post('billing/invoice', {
        calculationIds,
        currency,
        receiverId: '567d517cf33021cbe8c4d278',
        status: 'SENT' 
    })

}