function recordActivity(client, { ticketId, actorId, type, details }) {
  return client.query(
    'INSERT INTO activity (ticket_id, actor_id, type, details) VALUES ($1, $2, $3, $4)',
    [ticketId, actorId, type, details]
  )
}

const subscribers = {
  ticket_created: recordActivity,
  ticket_updated: recordActivity,
  status_changed: recordActivity,
  comment_added: recordActivity,
  ticket_resolved: recordActivity,
  ticket_deleted: recordActivity
}

export async function publishTicketEvent(client, type, { ticketId, actorId, details = {} }) {
  await subscribers[type](client, { type, ticketId, actorId, details })
}
