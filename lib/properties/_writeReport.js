const {
    assign, isArray, pick, sumBy
} = require('lodash')

const json2csv = require('json2csv')
const trash = require('trash')

const {
    existsSync, mkdirSync, rmdirSync, writeFileSync
} = require('fs')

module.exports = async function(options) {

    let defaultOptions = {
        onProgress: true, onPrice: true,
        outTsv: true,
        outYml: ['onPrice', 'onProgress']
    }

    let {
        excludeCompleted,
        project, projects, projectNames,
        onProgress, onPrice, 
        path,
        outTsv, outYml
    } = assign(defaultOptions, options)

    let scroid = this

    if (project) projects = [project]

    if (projectNames) {
        projects = await scroid.getProjects()
        remove(projects, project => !projectNames.includes(project.name))
    }

    let jobs = await scroid._getJobs({projects})
    let report = {jobs}

    if (onPrice) {

        let targetLanguage_assignee = ['targetLanguage',  'assignee']
        let mainDimensions = [
                'projectName', [
                    ['documentName', ... targetLanguage_assignee],
                    targetLanguage_assignee
                ]
        ]
        let dimensions = [
            ['isPaidByCustomer', [
                ['status', ...mainDimensions],
                mainDimensions,
            ]],
            'stageType', 'assignee'
        ]
    
        let summarizers = {
            effectiveWordsDone: sumBy,
            normalizedWordsDone: sumBy,
            amountUSD: sumBy,
            amountRUB: sumBy
        }
    
        let order = ['amountUSD', 'desc']    

        report.onPrice = this.pivotBy(jobs, dimensions, summarizers, {order})
    }

    if (onProgress) {

        let targetLanguage_assignee = ['targetLanguage',  'assignee']
        let assignee_projectName_documentName = ['assignee', 'projectName', 'documentName']
        let dimensions = [
            ['projectName', 'status', [
                ['documentName', ... targetLanguage_assignee],
                targetLanguage_assignee
            ]],
            ['targetLanguage', [
                ['projectName', 'assignee', 'documentName'],
                assignee_projectName_documentName
            ]],
            assignee_projectName_documentName
        ]
        let summarizers = {
            wordsLeft: sumBy,
            effectiveWordsDone: sumBy
        }
        let order = ['wordsLeft', 'desc']
    
        report.onProgress = this.pivotBy(jobs, dimensions, summarizers, {order})

    }


    if (existsSync(path)) await trash(path)
    mkdirSync(path)

    for (let sectionName in report) {

        let section = report[sectionName]
        let sectionPath = `${path}/${sectionName}`

        mkdirSync(sectionPath)

        if (isArray(section)) {
            section = pick(report, sectionName)
        }

        for (let key in section) {
            if (outTsv === true || outTsv.includes(sectionName)) {
                let tsv = json2csv.parse(section[key], {delimiter: '\t'})
                writeFileSync(`${sectionPath}/${key}.tsv`, tsv)    
            }
        }

    }

}
