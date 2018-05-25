async function main() {

    const Scroid = require('./scroid')

    let scroid = new Scroid(require('./private/settings/credentials.json'))

    await scroid._getReport({
        projectNames: [
            'Merchant Backend 1805',
            'Direct Accounts 1805'
        ]
    })


    return

}

main()