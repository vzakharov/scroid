const _ = require('lodash')
let {assign, groupBy, isArray, map, orderBy, pick, remove, round} = _

module.exports = function pivotBy(data, dimensions, summarizers, options = {}, points = [], pivots = {}) {

    let {order} = options 

    if (isArray(dimensions)) {
        for (let dimension of dimensions) {
            pivotBy(data, dimension, summarizers, options, points, pivots)
        }
        for (let i = 0; i < dimensions.length; i++) {
            points.pop()
        }
    } else {
        let dimension = dimensions
        points.push(dimension)

        let path = `by_${points.join('_')}`

        let groups = groupBy(data.slice(), item => JSON.stringify(pick(item, points)))
        pivots[path] = []

        map(groups, (subArray, groupKey) => {
            let pivot = JSON.parse(groupKey)
            for (let what in summarizers) {
                let predicate = summarizers[what]

                // Todo: remove rounding hardcoding!
                pivot[what] = round(predicate(subArray, what), 2)
            }
            pivots[path].push(pivot)
        })

        if (order) {
            pivots[path] = orderBy(pivots[path], ... order)
        }

    }

    return pivots

}