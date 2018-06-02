module.exports = function (object, change) {
    for (let before in change) {
        let after = change[before]
        object[after] = object[before]
        delete object[before]
    }
}