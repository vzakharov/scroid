module.exports = async function() {
    let myTeam = []
    let limit = 500
    let skip = 0

    while(1) {
        let {data} = await this.smartcat.post('account/searchMyTeam', {skip, limit})
        // let data = await this.smartcat.account.searchMyTeam({skip, limit})
        myTeam.push(... data)
        if (data.length < limit) break
        skip += limit
    }

    return myTeam
}