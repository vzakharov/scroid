const _ = require('lodash')
const {
    assign, capitalize, clone, filter, find, first, flatten, groupBy, isString, keyBy, keys, last, 
    min, maxBy, minBy, map, mapKeys, pick, pull, pullAt, orderBy, 
    reject, remove, reverse, round, sumBy, uniqBy, values
} = _

const Diff = require('diff')
const vz = require('vz-utils')
const {
    deepFor, iterate, loadYamls, loadYamlsAsArray, matchesFilter,
    getDiff, setDeep, renameRecursively
} = vz

const json2csv = require('json2csv')
const fs = require('fs')
const readYaml = require('read-yaml')
const writeYaml = require('write-yaml')

const {stringify} = JSON

const delimiter = '\t'

main()

async function main() {

    const Scroid = require('./scroid')

    try {

        let username = 'vzakharov@gmail.com'

        let scroid = new Scroid(username)

        let autorun = scroid.load('autorun')
        let {script} = autorun

        // await scroid.setAccount(accountName)

        let configs = scroid.load(`script.${script}`, 'config')
        if (!Array.isArray(configs)) configs = [configs]

        for (let config of configs) {
    
            let action, options
            if (isString(config)) {
                action = config
                options = {}
            } else {
                action = keys(config)[0]
                options = config[action]
            }

            args = action.split(' ')
            action = args[0]
            args = args.slice(1)
            let toLog = assign(new class Action{}, {action, args, options})
            console.log(toLog)

            for (let setter in options.set || []) {
                let { __calculate__ } = options.set[setter]
                if (__calculate__) {
                    for (let calc in __calculate__) {
                        options.set[setter] = scroid['calc_'+calc](__calculate__[calc])
                    }
                }
            }

            await scroid[action](...args, options)

            console.log(`Completed: ${JSON.stringify(toLog)}`)
        }

    } catch(error) {

        throw(error)
        
    }

    return

}