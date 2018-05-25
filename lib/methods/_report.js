const {assign, pick, round, values} = require('lodash')

function addTotals(addendum, basis, path) {

    let totals = basis

    do {

        let key = path.shift()
        
        if (!totals[key]) {
            totals[key] = {}
        }

        totals = totals[key]

        for (let property in addendum) {
            let total = totals[property] || 0
            
            total += addendum[property]

            totals[property] = total
        }

        // Todo: generalize for other uses
        totals.progress = round(totals.wordsDone / totals.assignedWords * 100)
    
    } while (path.length > 0)

}

async function _getReport(options) {

    let report = {}

    await this.getProjects()

    let {projectNames} = options
    let {projects, projectsByName} = this

    if (projectNames) {
        projects = values(pick(projectsByName, projectNames))
    }

    let projectsReport = (report.projects = {})

    let languagesReport = (report.languages = {})

    for (let project of projects) {

        assign(this, {project})

        let projectReport = (projectsReport[project.name] = {})
        
        let teamReport = (projectReport.team = {})
        
        await this._getJobsByLanguages()

        let {jobsByLanguages} = this

        for (let language in jobsByLanguages) {

            let languageReport = (teamReport[language] = {})

            let jobsByMembers = jobsByLanguages[language]

            for (let member in jobsByMembers) {

                let jobsByStatuses = jobsByMembers[member]
                let memberReport = (languageReport[member] = {})

                let {inProgress} = jobsByStatuses

                if (!inProgress) continue

                for (let job of inProgress) {

                    let {assignedWords, progress} = job
                    let wordsDone = round(progress * assignedWords)
                    let wordsLeft = assignedWords - wordsDone

                    progress = round(progress * 100)

                    assign(memberReport, {
                        assignedWords, progress, wordsDone, wordsLeft
                    })

                    // Todo: combine into one function
                    addTotals(memberReport, report, ['languages', language, member])
                    addTotals(languagesReport, language, memberReport)
                    addTotals(projectReport, language, memberReport)
                    addTotals(projectsReport, project.name, memberReport)
                    
                }
                

            }
        }

    }

    return report

}

module.exports = {_getReport}