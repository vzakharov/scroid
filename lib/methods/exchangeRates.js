const _ = require('lodash')
const {invert, keys, without} = _

const currenciesById = {
    1: 'USD',
    2: 'EUR',
    3: 'RUB',
    4: 'TRY',
    5: 'JPY',
    6: 'SGD',
    7: 'MYR',
    8: 'HKD'
}

const currencyIds = invert(currenciesById)
const supportedCurrencies = keys(currencyIds)
    
async function getExchangeRates(sourceCurrency) {

    let targetCurrencies = without(supportedCurrencies, sourceCurrency)
    let targets = targetCurrencies.join(',')
    let exchangeRates = {}

    let array = (
        await this._marketplace.get(`currencyRate/${sourceCurrency}`, {params: {targets}})
    ).data

    for (let item of array) {
        exchangeRates[`${item.source}${item.target}`] = item.rate
    }

    return exchangeRates

}


module.exports = {
    currenciesById, currencyIds, supportedCurrencies, getExchangeRates
}