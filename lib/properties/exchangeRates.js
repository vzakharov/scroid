const _ = require('lodash')
const {assign, invert, keys, without} = _

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
    
async function getExchangeRates(sourceCurrency, exchangeRates = {}) {

    let targetCurrencies = without(supportedCurrencies, sourceCurrency)
    let targets = targetCurrencies.join(',')

    let {data} = await this._marketplace.get(`currencyRate/${sourceCurrency}`, {params: {targets}})

    let exchangeRatesTo = exchangeRates[sourceCurrency] = {}

    for (let item of data) {
        exchangeRatesTo[item.target] = item.rate
    }

    exchangeRatesTo[sourceCurrency] = 1

    return exchangeRates

}

// function convertMoney(amount, sourceCurrency, targetCurrency, {exchangeRates}) {

//     if (!exchangeRates) exchangeRates = this.getExchangeRates(sourceCurrency)

//     return amount * exchangeRates[sourceCurrency, targetCurrency]

// }

module.exports = {
    currenciesById, currencyIds, supportedCurrencies, getExchangeRates
}