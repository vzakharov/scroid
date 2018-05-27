const _ = require('lodash')
const languagesById = require('../languagesById')

const statuses = {
    1: 'inProgress',
    2: 'invited',
    4: 'completed',
    9: 'declined'
}

module.exports = async function(project) {

    let jobsByLanguages = {}
    
    let {executivesByJobStatus} = (
        await this._smartcat.get(`Projects/${project.id}/Team`)
    ).data

    for (let collection of executivesByJobStatus) {

        let status = statuses[collection.jobStatus]

        for (let member of collection.executives) {

            let name = member.userName

            if (!member.rateValue) continue
            
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