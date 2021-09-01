function addWorkingHours(date, hours) {
    var count = 0;
    while (count < hours) {
        date.setHours(date.getHours() + 1);
        if (date.getDay() != 0 && date.getDay() != 6) // Skip weekends
            count++;
    }
    return date;
}

documentListIds = {}
let documentListPromises = {}

prepare = async function(item) {

  let documentId = item.document.id
  item.documentListId = documentListIds[documentId]

  if (!item.documentListId) {
    if (!documentListPromises[item.document.id]) {
      documentListPromises[item.document.id] = new Promise(async function(resolve, reject) {
        resolve(await call('/api/WorkflowAssignments/CreateDocumentListId', {item, body: [documentId]}))
      })
      console.log(`${item.document.name} — promise created`)
    }
    console.log(`${item.document.name} — awaiting promise`)
    item.documentListId = await documentListPromises[item.document.id]
    console.log(`${item.document.name} — promise resolved, list id #${item.documentListId}`)
  }
 
  item.assigneeIds = _.map(_.filter(assignees, {stageType: item.stage.type, languageCode: item.target.language.code}), 'id')
  item.newDeadline = deadlineBaseIsNow ? new Date() : new Date(item.document.creationDate)
  let { excludeWeekends } = settings
  if ( excludeWeekends )
    addWorkingHours(item.newDeadline, deadlineOffset)
  else
    item.newDeadline.setHours(item.newDeadline.getHours() + deadlineOffset)

item.newDeadline = item.newDeadline.toISOString()

}