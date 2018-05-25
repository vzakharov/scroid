const {assign, pick, round, values} = require('lodash')


async function _getAllJobs(options) {

    let report = {}

    await this.getProjects()

    let {projectNames} = options
    let {projects, projectsByName} = this

    if (projectNames) {
        projects = values(pick(projectsByName, projectNames))
    }

    for (let project of projects) {

        assign(this, {project})
        
        await this._getJobsByLanguages()

        let {jobsByLanguages} = this

        for (let language in jobsByLanguages) {

            let jobsByMembers = jobsByLanguages[language]

            for (let member in jobsByMembers) {

                let jobsByStatuses = jobsByMembers[member]

                let {inProgress} = jobsByStatuses

                if (!inProgress) continue

                for (let job of inProgress) {

                    let {assignedWords, progress} = job
                    let wordsDone = round(progress * assignedWords)
                    let wordsLeft = assignedWords - wordsDone

                    progress = round(progress * 100)

                    jobs.push({
                        language, project: project.name, member,
                        assignedWords, wordsDone, wordsLeft, progress
                    })

                }
                

            }
        }

    }

    return jobs

}

module.exports = {_getAllJobs}