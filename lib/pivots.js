const _ = require('lodash')
let {groupBy, isArray, map} = _

module.exports = function pivots(data, dimensions, totalBy, sortBy, currentPath = [], allPivots = [{}]) {

    if (isArray(dimensions)) {
        for (let dimension of dimensions) {
            pivots(data, dimension, totalBy, sortBy, currentPath, allPivots)
        }
    } else {
        let dimension = dimensions
        currentPath.push(dimension)

        let pathString = currentPath.join('.')

        let groups = groupBy(data.slice(), dimension)

        map(groups, (subArray, groupKey) => {
            parentPivot[dimension] = groupKey
            for (let what in totalBy) {
                let predicate = totalBy[what]
                parentPivot[what] = predicate(subArray, what)
            }
        })

    }

}