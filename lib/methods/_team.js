const _ = require('lodash')
const languagesById = require('../languagesById')

const statuses = {
    1: 'inProgress',
    2: 'invited',
    4: 'completed',
    9: 'declined'
}

module.exports = {

    _getJobsByLanguages: async function() {

        this.jobsByLanguages = {}
        let {jobsByLanguages} = this
        
        let {executivesByJobStatus} = (
            await this._smartcat.get(`Projects/${this.project.id}/Team`)
        ).data

        for (let collection of executivesByJobStatus) {

            let status = statuses[collection.jobStatus]

            for (let member of collection.executives) {

                let name = member.userName
                
                // LangAUge is not a typo ( not on my part)
                let language = languagesById[member.targetLangaugeId]

                jobsByLanguages[language] = jobsByLanguages[language] || {}
                let jobsByNames = jobsByLanguages[language]

                jobsByNames[name] = jobsByNames[name] || {}

                jobsByNames[name][status] = member.jobs

            }
        }

        return jobsByLanguages
    }
    
}