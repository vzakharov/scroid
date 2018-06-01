const _ = require('lodash')
const {assign} = _

module.exports = async function(api, url, params = {}, options = {totalKey: 'total', itemsKey: 'items'}) {

    let {totalKey, itemsKey} = options
    let start = 0, limit = 500, total, allData = []

    do {

        assign(params, {start, limit})

        let {data} = (
            await api.get(url, {params})
        )

        let items = data[itemsKey]
        if (!total) total = data[totalKey]

        allData.push(... items)

        // Todo: process case where there’s a limit on limit
        start += limit
        limit = total - start

    } while(allData.length < total)

    return allData
}