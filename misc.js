scroid = {}

scroid.prepare = {

    nudge: item => {
        item.assignee.conversationId = (
            await get(`api/chat/contacts/${item.assignee.id}/conversation?accountId=${accountId}`)
        ).id
    }

}


scroid.action = {

    nudge: item => {

        if ( !scroid.nudged ) scroid.nudged = []

        if ( !scroid.nudged[item.assignee.id] ) {

        }

    }

}