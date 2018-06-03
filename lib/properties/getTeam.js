const {
    assign, clone, find, map, merge
} = require('lodash')

const readYaml = require('read-yaml')

module.exports = async function(options) {

    let {template, includeEmails} = assign({
        template: 'default',
        includeEmails: false
    }, options)

    let teams = readYaml.sync(`${process.cwd()}/private/settings/teams.yml`)
    let templateTeam = teams[template]
    let team = []
    let smartcatTeam = await this.downloadMyTeam()

    for (let languageKey in templateTeam) {
        let name = templateTeam[languageKey]
        let member = find(smartcatTeam, member => `${member.firstName} ${member.lastName}` == name)
        assign(member, {name})
        if (member.id) this.renameKeys(member, {id: 'userId'})

        let languages = languageKey.split(',')

        for (let targetLanguage of languages) {
            if (languages.length > 0) {
                member = clone(member)
            }
            assign(member, {targetLanguage})
            team.push(member)
        }

    }

    if (includeEmails) {
        await this._getEmails({assignees: team})
    }

    return team

}