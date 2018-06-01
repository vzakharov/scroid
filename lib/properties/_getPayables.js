
module.exports = async function() {

    let q = JSON.stringify({
        status: ['VERIFIED'], 
        hasCustomerCalculationId: true, 
        datePaidByCustomer: {isSet: false}, 
        sortBy: ['-dateCreated', '_id'], 
        hasRate: true 
    })

    let payables = await this.getAll(this._marketplace, 'job', {q})

    return payables
}