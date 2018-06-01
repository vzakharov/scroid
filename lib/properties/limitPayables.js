module.exports = 'tbd'

// let limit = 4120
        // let costs = map(
        //     groupBy(
        //         map(includedPayables, 'customerCalculation.cost'), 
        //         'currency'
        //     ), 
        //     (group, currency) => ({
        //         currency, amount: sumBy(group, 'amount')
        //     })
        // )
        // let exchangeRates = await scroid.getExchangeRates('USD')
        // let totalInUSD = sumBy(costs, cost => cost.amount / exchangeRates['USD'][cost.currency])

        // let orderedPayables = orderBy(
        //     filter(payables, payable => 
        //         !includedPayables.includes(payable) && 
        //         payable.customerCalculation.cost.currency == 'USD'
        //     ), 
        //     'customerCalculation.cost.amount'
        // )

        // while(1) {
        //     let payable = orderedPayables.shift()
        //     let {amount} = payable.customerCalculation.cost
        //     let sum = amount + totalInUSD
        //     if (sum > limit) break
        //     totalInUSD += amount
        //     includedPayables.push(payable)
        // }

        // console.log(totalInUSD)

        // if (totalInUSD > limit) {
        //     throw(`The sum of ${totalInUSD} USD exceeds the set maximum of $4000.`)
        // }