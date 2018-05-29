const _ = require('lodash')

const {assign, filter, map, reject, remove} = _

const json2csv = require('json2csv')
const readYaml = require('read-yaml')
const fs = require('fs')

async function main() {

    const Scroid = require('./scroid')

    let scroid = new Scroid(require('./private/settings/credentials.json'))

    try {
        
        // await scroid.setProject('Merchant Backend 1805')
        // await scroid.setDocument('en', 'de')

        // /* Roll back all segments on the Editing stage */
        // scroid.filters = [{
        //     name: 'confirmation', isConfirmed: true, workflowStageNumber: 2
        // }]
        // await scroid._unconfirm()

        // console.log (await scroid._heatmap())

        //// Assign myteam members to unconfirmed segments in a project, with certain document filters
        // let project = await scroid.getProject('onboarding-frontend')
        // let documents = reject(project.documents, document => 
        //     document.name.includes('en-US') ||
        //     document.workflowStages[0].progress == 100
        // )
        // let teams = readYaml.sync('./private/settings/teams.yml')
        // let names = teams.default
        // let wholeTeam = await scroid.getTeam()

        // let team = _.mapValues(names, name => {
        //     let member = _.find(wholeTeam, member => {
        //         let {firstName, lastName} = member
        //         let matches = (
        //             `${firstName} ${lastName}` == name ||
        //             `${lastName} ${firstName}` == name
        //         )
        //         return matches
        //     })
        //     assign(member, {name})
        //     return member
        // })

        // // documents = documents.slice(2)

        // for (let document of documents) {
        //     let {targetLanguage} = document
        //     let assignee = team[targetLanguage]
        //     let stage = 1
        //     await scroid._assignUnconfirmed({document, stage, assignee})
        // }

        // await scroid.setDocument('en', 'de')
        // scroid.stage = 1
        // // Todo: find user by name
        // scroid.user = {id: '4be24505-c078-44c4-b001-5924731ef908'}
        // await scroid._assignUnconfirmed()
    
        let projects = await scroid.getProjects()
        let projectNames = [... map(filter(projects, project => project.name.includes('1805')), 'name'),
            'Login Widget',
            'Login Widget',
            'onboarding-frontend',
            'publisher-client',
            'publisher-client copywriting'
        ]
        
        remove(projects, project => !projectNames.includes(project.name))
      
        let jobs = await scroid._getJobs({projects})

        let path = 'C:/Users/asus/Documents/GitHub/translationProjects/Xsolla/Price 1805'
        let parser = require('json2csv')
        for (let key in jobs) {
            let csv = parser.parse(jobs[key], {delimiter: '\t', quote: ''})
            fs.writeFileSync(`${path}/${key}.csv`, csv)    
        }
    
    } catch(error) {
        throw(error)
    }

    return

}

main()