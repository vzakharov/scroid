const Axios = require('axios')
const Smartcat = require('smartcat')
const fs = require('fs')

const _ = require('lodash')
let {assign, find, keyBy} = _

class Scroid {

    constructor(credentials) {

        assign (this, {credentials})

        // this.smartcat = Axios.create({
        //     baseURL: 'https://smartcat.ai/api/integration/v1/',
        //     auth: credentials.smartcat
        // })

        this.smartcat = new Smartcat(credentials.smartcat).methods
        
        let _defaults = {
            baseURL: "https://smartcat.ai/api/",
            headers: {
                Cookie: credentials._smartcat
            }
        }

        // All functions with _ refer to the undocumented API
        this._smartcat = Axios.create(_defaults)

        this._editor = function (document, options = {}) {
            let {exclude} = options
            let params = {
                mode: 'manager', 
                _page: 'Editor', 
                documentId: document.documentId, 
                languageIds: document.targetLanguageId
            }
            if (exclude) {
                for (let what of exclude) {
                    delete params[what]
                }
            }
            return Axios.create(assign(_defaults, {params}))
        }

        this._marketplace = Axios.create({
            baseURL: "https://marketplace.smartcat.ai/api/v1",
            headers: {
                Authorization: `Bearer ${credentials._marketplace}`
            }
        })

        this.mixmax = Axios.create({
            baseURL: 'https://api.mixmax.com/v1/',
            params: {'apiToken': credentials.mixmax}
        })

    }


    async getProjects(params) {

        let decomposeDocumentId = compositeId => {
            let [documentId, targetLanguageId] = compositeId.match(/(\d+)_(\d+)/).slice(1)
            return {documentId, targetLanguageId}
        }

        // let projects = (
        //     await this.smartcat.get('project/list', {params})
        // ).data
        let projects = await this.smartcat.project.list()
    
        for (let project of projects) {
            for (let document of project.documents) {
                Object.assign(document, decomposeDocumentId(document.id))
            }
        }
    
        return projects
    
    }


}

for (let fileName of fs.readdirSync('./lib/properties')) {

    let propertyName = fileName.match('^(.*).js$')[1]
    let imported = require(`./lib/properties/${propertyName}`)
    let scroid = Scroid.prototype

    if (typeof imported == 'function') {
        scroid[propertyName] = imported
    } else {
        assign(scroid, imported)
    }

}

module.exports = Scroid