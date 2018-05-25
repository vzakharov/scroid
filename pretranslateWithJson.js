const _ = require('lodash')
const fs = require('fs')
const convert = require('xml-js')

function pretranslateWithJson(dirPath, srcLang = "en") {
    let dir = fs.readdirSync(dirPath)
    let files = {}

    let outDirPath = dirPath + "\\pretranslated"
    fs.mkdir(outDirPath)

    for (let path of dir) {
        let match = path.match("(.*)\\.(.*)")

        if (!match) continue

        let [, filename, extension] = match 

        if (extension != 'xliff' && extension != 'json') continue

        if (!files[extension]) {
            files[extension] = {}
        }

        let fullPath = dirPath + '\\' + path

        if (extension == 'xliff') {
            files[extension][filename] = convert.xml2js(fs.readFileSync(fullPath), {compact: true})
        } else {
            files[extension][filename] = require(fullPath)
        }
    }

    let keys = _.keys(files.json[srcLang])

    for (let lang in files.json) {

        if (lang == srcLang) continue

        let xliffName = `${srcLang}(${srcLang}-${lang})`
        let target = files.json[lang]

        let xliffObj = files.xliff[xliffName]
        let units = xliffObj.xliff.file.body['trans-unit']

        for (let i = 0; i < units.length; i++) {
            let key = keys[i]
            let unit = units[i]
            let targetText = target[key]
            if (targetText) {
                unit.target._text = targetText
                unit._attributes.approved = "yes"
                unit.target._attributes.state = "translated"
            }
        }
    
        let xml = convert.js2xml(xliffObj, {compact: true})
    
        fs.writeFileSync(`${outDirPath}\\${xliffName}.xliff`, xml)

    }

    return
}

module.exports = pretranslateWithJson

pretranslateWithJson("C:\\Users\\asus\\Documents\\GitHub\\translationProjects\\Xsolla\\Strings 1805\\direct_accounts")