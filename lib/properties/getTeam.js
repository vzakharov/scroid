const {
    assign, find, mapValues, merge
} = require('lodash')

const readYaml = require('read-yaml')

module.exports = async function(options) {

    let {id, includeEmails} = assign({
        id: 'default',
        includeEmails: false
    }, options)

    let teams = readYaml.sync(`${process.cwd()}/private/settings/teams.yml`)
    let assignees = teams[id]
    let wholeTeam = await this.downloadMyTeam()

    for (let language in assignees) {
        let name = assignees[language]
        let member = find(wholeTeam, member => `${member.firstName} ${member.lastName}` == name)
        assign(member, {name})
        this.renameKeys(member, {id: 'userId'})
        let {userId} = member
        assignees[language] = member
    }

    if (includeEmails) {
        let emails = await this._getEmails({assignees}, {returnHash: true})
        assignees = merge(assignees, emails)
    }

    return assignees

}