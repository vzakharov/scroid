module.exports = async function({name, userId}) {

    let storedEmails = require(`${process.cwd()}/private/settings/emails.json`)

    let email = storedEmails[name]

    if (!email) {
        let profile = (
            await this.__smartcat.get(`freelancers/profile/${userId}`)
        ).data

        email = profile.myTeamContacts.email || profile.ownContacts.email    
    }

    return email

}