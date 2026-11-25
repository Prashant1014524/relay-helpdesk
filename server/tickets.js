import { transaction } from './db.js'
import { publishTicketEvent } from './events.js'
import {
  HttpError, commentSchema, createTicketSchema, editTicketSchema, manageTicketSchema,
  parse, ticketIdSchema, ticketListSchema
} from './validation.js'

const sorts = {
  updated: 't.updated_at DESC, t.id DESC',
  newest: 't.created_at DESC, t.id DESC',
  oldest: 't.created_at ASC, t.id ASC'
}

function visibility(user, alias = 't') {
  const filters = [alias + '.deleted_at IS NULL']
  const params = []
  if (user.role !== 'admin') {
    params.push(user.id)
    filters.push(alias + '.owner_id = $1')
  }
  return { filters, params }
}

async function findTicket(db, user, id, lock = false) {
  const { filters, params } = visibility(user)
  params.push(id)
  filters.push('t.id = $' + params.length)
  const { rows: [ticket] } = await db.query(
    'SELECT t.*, u.name AS owner_name FROM tickets t JOIN users u ON u.id = t.owner_id WHERE ' +
    filters.join(' AND ') + (lock ? ' FOR UPDATE OF t' : ''), params
  )
  if (!ticket) throw new HttpError(404, 'Ticket not found.')
  const { deleted_at, ...visibleTicket } = ticket
  return visibleTicket
}

async function listTickets(db, user, query) {
  const { filters, params } = visibility(user)
  const { status, priority, q, sort, page, limit } = query
  const addFilter = (condition, value) => {
    params.push(value)
    filters.push(condition.replaceAll('?', '$' + params.length))
  }
  if (status) addFilter('t.status = ?', status)
  if (priority) addFilter('t.priority = ?', priority)
  if (q) {
    addFilter(
      "(t.title ILIKE ? ESCAPE '!' OR t.description ILIKE ? ESCAPE '!' OR 'RL-' || t.id::text ILIKE ? ESCAPE '!')",
      '%' + q.replace(/[!%_]/g, '!$&') + '%'
    )
  }

  return transaction(db, async client => {
    const base = ' FROM tickets t WHERE ' + filters.join(' AND ')
    const { rows: [{ count: total }] } = await client.query('SELECT count(*)::int' + base, params)
    const { rows: tickets } = await client.query(
      'SELECT t.id, t.title, t.category, t.priority, t.status, t.created_at, t.updated_at, ' +
      '(SELECT name FROM users WHERE id = t.owner_id) AS owner_name' + base +
      ' ORDER BY ' + sorts[sort] + ' LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2),
      [...params, limit, (page - 1) * limit]
    )
    return { tickets, total, page, limit }
  }, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
}

export function mountTickets(api, db, authenticate) {
  api.use('/tickets', authenticate)
  api.param('id', (req, res, next, value) => {
    req.ticketId = parse(ticketIdSchema, value)
    next()
  })

  api.get('/tickets', async (req, res) => {
    res.json(await listTickets(db, req.user, parse(ticketListSchema, req.query)))
  })

  api.get('/tickets/stats', async (req, res) => {
    const { filters, params } = visibility(req.user)
    const { rows } = await db.query(
      'SELECT status, count(*)::int AS count FROM tickets t WHERE ' + filters.join(' AND ') + ' GROUP BY status',
      params
    )
    const counts = { total: 0, open: 0, in_progress: 0, resolved: 0, closed: 0 }
    for (const { status, count } of rows) {
      counts[status] = count
      counts.total += count
    }
    res.json(counts)
  })

  api.post('/tickets', async (req, res) => {
    if (req.user.role === 'admin') throw new HttpError(403, 'A requester account is required to submit a ticket.')
    const { title, description, category, priority } = parse(createTicketSchema, req.body)
    const ticket = await transaction(db, async client => {
      const { rows: [{ id }] } = await client.query(
        'INSERT INTO tickets (owner_id, title, description, category, priority) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [req.user.id, title, description, category, priority]
      )
      await publishTicketEvent(client, 'ticket_created', { ticketId: id, actorId: req.user.id })
      return findTicket(client, req.user, id)
    })
    res.location('/api/tickets/' + ticket.id).status(201).json({ ticket })
  })

  api.get('/tickets/:id', async (req, res) => {
    const result = await transaction(db, async client => {
      const ticket = await findTicket(client, req.user, req.ticketId)
      const { rows: comments } = await client.query(
        'SELECT c.id, c.body, c.created_at, u.name AS author_name, u.role AS author_role ' +
        'FROM comments c JOIN users u ON u.id = c.author_id WHERE c.ticket_id = $1 ORDER BY c.id',
        [ticket.id]
      )
      const { rows: activity } = await client.query(
        'SELECT a.id, a.type, a.details, a.created_at, u.name AS actor_name ' +
        'FROM activity a JOIN users u ON u.id = a.actor_id WHERE a.ticket_id = $1 ORDER BY a.id DESC',
        [ticket.id]
      )
      return { ticket, comments, activity }
    }, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    res.json(result)
  })

  api.patch('/tickets/:id', async (req, res) => {
    const admin = req.user.role === 'admin'
    const changes = parse(admin ? manageTicketSchema : editTicketSchema, req.body)
    const ticket = await transaction(db, async client => {
      const current = await findTicket(client, req.user, req.ticketId, true)
      if (!admin && current.status !== 'open') throw new HttpError(409, 'Only open tickets can be edited.')
      const entries = Object.entries(changes).filter(([key, value]) => value !== current[key])
      if (!entries.length) return current

      // Every column name comes from the strict role-specific schemas above.
      const setters = entries.map(([key], index) => key + ' = $' + (index + 2))
      await client.query(
        'UPDATE tickets SET ' + setters.join(', ') + ', updated_at = clock_timestamp() WHERE id = $1',
        [current.id, ...entries.map(([, value]) => value)]
      )

      const event = { ticketId: current.id, actorId: req.user.id }
      const fields = entries.map(([key]) => key).filter(key => key !== 'status')
      if (fields.length) await publishTicketEvent(client, 'ticket_updated', { ...event, details: { fields } })
      if (changes.status && changes.status !== current.status) {
        await publishTicketEvent(client, 'status_changed', {
          ...event, details: { from: current.status, to: changes.status }
        })
        if (changes.status === 'resolved') await publishTicketEvent(client, 'ticket_resolved', event)
      }
      return findTicket(client, req.user, current.id)
    })
    res.json({ ticket })
  })

  api.delete('/tickets/:id', async (req, res) => {
    await transaction(db, async client => {
      const ticket = await findTicket(client, req.user, req.ticketId, true)
      if (req.user.role === 'admin') throw new HttpError(403, 'Only the ticket owner can withdraw it.')
      if (ticket.status !== 'open') throw new HttpError(409, 'Only open tickets can be deleted.')
      await client.query('UPDATE tickets SET deleted_at = clock_timestamp(), updated_at = clock_timestamp() WHERE id = $1', [ticket.id])
      await publishTicketEvent(client, 'ticket_deleted', { ticketId: ticket.id, actorId: req.user.id })
    })
    res.sendStatus(204)
  })

  api.post('/tickets/:id/comments', async (req, res) => {
    const { body } = parse(commentSchema, req.body)
    const comment = await transaction(db, async client => {
      const ticket = await findTicket(client, req.user, req.ticketId, true)
      const { rows: [created] } = await client.query(
        'INSERT INTO comments (ticket_id, author_id, body) VALUES ($1, $2, $3) RETURNING id, body, created_at',
        [ticket.id, req.user.id, body]
      )
      await client.query('UPDATE tickets SET updated_at = clock_timestamp() WHERE id = $1', [ticket.id])
      await publishTicketEvent(client, 'comment_added', {
        ticketId: ticket.id, actorId: req.user.id, details: { commentId: created.id }
      })
      return { ...created, author_name: req.user.name, author_role: req.user.role }
    })
    res.status(201).json({ comment })
  })
}
