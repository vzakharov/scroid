const Axios = require('axios')
const fs = require('fs')

const _ = require('lodash')
let {assign, find, keyBy} = _

class Scroid {

    constructor(credentials) {

        this.smartcat = Axios.create({
            baseURL: 'https://smartcat.ai/api/integration/v1/',
            auth: credentials.smartcat
        })
        
        // All functions with _ refer to the undocumented API
        this._smartcat = Axios.create({
            baseURL: "https://smartcat.ai/api/",
            headers: {
                Cookie: credentials._smartcat
            }
        })

    }

    async setDocument(documentName, targetLanguage) {
        return (
            this.document = find(this.project.documents, {name: documentName, targetLanguage})
        )
    }

    async setProject(projectName) {

        await this.getProjects({projectName})
        return (
            this.project = this.projects[0]
        )

    }

    async getProjects(params) {

        this.projects = (
            await this.smartcat.get('project/list', {params})
        ).data

        let {projects} = this

        assign(this, {
            projectsByName: keyBy(projects, 'name'),
            projectsById: keyBy(projects, 'id')
        })

        return projects
    }

}

for (let method of fs.readdirSync('./lib/methods')) {

    assign(Scroid.prototype, require(`./lib/methods/${method}`))

}

module.exports = Scroid