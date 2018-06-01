let {
    escapeRegExp, map, minBy, times, uniq
} = require('lodash')

module.exports = function getDiffs(... strings) {

    let minLength = minBy(strings, 'length') 

    for (let i = 0; i < minLength; i++) {
        for (let j = minLength - 1; j >= i; j--) {

            let substrings = map(strings, string => string.slice(i, j))
            let substring = uniq(substrings)

            if (!substring) continue

            let matches = map(substrings, s =>
                s.match(`^(.*?)(${escapeRegExp(substring)})(.*?)$`)
            )

            // Todo: generalize for more than two strings
            let match = matches[0]

            match[2] = {same: substring}

            for (let k = 1; k <= 3; k += 2) {
                match[k] = getDiffs(
                    map(matches, m => m[k])
                )
            }

            return match
        }
    }

    // Todo: generalize for more than two strings
    return strings[0]
}