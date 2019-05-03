const bcrypt = require('bcrypt')
const Hapi = require('@hapi/hapi')
const Scroid = require('./scroid')

let scroids = {}

const validate = async (request, username, password) => {

    let scroid = scroids[username]
    let credentials = {username}
    if (!scroid)
        scroid = new Scroid(username)
    if (!scroid.settings.password || !(await bcrypt.compare(password, scroid.settings.password))) {
        try {
            await scroid.login(username, password)
        } catch(err) {
            let {error} = err
            switch(error) {
                case 'invalid-password': return {isValid: false, credentials}
                case 'invalid-email-credentials': return {isValid: false, credentials: null}
                default: throw(err)
            }
        }
        scroid.settings.password = await bcrypt.hash(password, 10)
        scroid.save({settings})
        scroids[username] = scroid
    }
    return {isValid: true, credentials}
}

const init = async () => {

    const server = Hapi.server({
        port: 3000,
        host: 'localhost'
    })

    await server.register(require('@hapi/basic'))

    server.auth.strategy('simple', 'basic', {validate})

    server.route({
        method: 'POST',
        path:'/{action}/{args*}',
        options: {auth: 'simple'},
        handler: (request, h) => {

            let {action, args} = request.params
            let {payload, query} = request
            args = args.split('/')
            return {action, args, query, payload}
            
        }
    })

    await server.start()
    console.log('Server running on %s', server.info.uri)
}

process.on('unhandledRejection', (err) => {

    console.log(err)
    process.exit(1)
})

init()