const _ = require('lodash')
let {assign, groupBy, isArray, map, orderBy, pick, remove} = _

module.exports = function pivotBy(data, dimensions, summarizers, options = {}, points = [], pivots = {}) {

    let {order} = options 

    if (isArray(dimensions)) {
        for (let dimension of dimensions) {
            pivotBy(data, dimension, summarizers, options, points, pivots)
        }
        remove(points, (v, i) => i >= points.length - dimensions.length)
    } else {
        let dimension = dimensions
        points.push(dimension)

        let path = `by_${points.join('_and_')}`

        let groups = groupBy(data.slice(), item => JSON.stringify(pick(item, points)))
        pivots[path] = []

        map(groups, (subArray, groupKey) => {
            let pivot = JSON.parse(groupKey)
            for (let what in summarizers) {
                let predicate = summarizers[what]
                pivot[what] = predicate(subArray, what)
            }
            pivots[path].push(pivot)
        })

        if (order) {
            pivots[path] = orderBy(pivots[path], ... order)
        }

    }

    return pivots

}