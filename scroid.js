const Axios = require('axios')
const fs = require('fs')
let {decomposeDocumentId} = require('./lib/helpers')

const _ = require('lodash')
let {assign, find, keyBy} = _

class Scroid {

    constructor(credentials) {

        this.smartcat = Axios.create({
            baseURL: 'https://smartcat.ai/api/integration/v1/',
            auth: credentials.smartcat
        })
        
        let _defaults = {
            baseURL: "https://smartcat.ai/api/",
            headers: {
                Cookie: credentials._smartcat
            }
        }

        // All functions with _ refer to the undocumented API
        this._smartcat = Axios.create(_defaults)

        this._editor = Axios.create(assign(_defaults, {
            params: {mode: 'manager', _page: 'Editor'}
        }))

    }





}

for (let fileName of fs.readdirSync('./lib/methods')) {

    let methodName = fileName.match('^(.*).js$')[1]
    let imported = require(`./lib/methods/${methodName}`)
    let scroid = Scroid.prototype

    if (typeof imported == 'function') {
        scroid[methodName] = imported
    } else {
        assign(scroid, imported)
    }

}

module.exports = Scroid