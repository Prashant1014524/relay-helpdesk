import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import supertest from 'supertest'
import { createApp } from '../server/app.js'
import { ensureAdmin } from '../server/admin.js'

const password = 'example-password-90210'
const adminEmail = 'support@example.test'
const db = new PGlite()
const pool = {
  query: (...args) => db.query(...args),
  connect: async () => ({ query: (...args) => db.query(...args), release() {} })
}
let app

before(async () => {
  const schema = await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8')
  await db.exec(schema)
  await ensureAdmin(pool, adminEmail, password)
  app = createApp(pool, { jwtSecret: 'test-only-'.repeat(8), secureCookies: false, authLimit: 100 })
})
after(() => db.close())

const draft = {
  title: 'Invoice shows an incorrect total',
  description: 'The total differs from the amount displayed in my account.',
  category: 'billing',
  priority: 'medium'
}

function register(agent, name, email) {
  return agent.post('/api/auth/register').send({ name, email, password })
}

test('authentication issues a protected JWT cookie and refuses role escalation', async () => {
  const client = supertest.agent(app)
  await client.get('/api/auth/me').expect(401)
  await client.get('/api/health').expect(200, { status: 'ok' })
  await client.post('/api/auth/register').send({
    name: 'Escalation', email: 'escalation@example.test', password, role: 'admin'
  }).expect(400)
  const result = await register(client, 'First Requester', 'First@example.test').expect(201)
  assert.match(result.headers['set-cookie'][0], /relay_session=.*HttpOnly; SameSite=Strict/)
  assert.equal(result.body.user.email, 'first@example.test')
  assert.equal(result.body.user.role, 'user')
  assert.equal(result.body.user.password_hash, undefined)
  await register(client, 'Duplicate', 'FIRST@example.test').expect(409)
  await client.get('/api/auth/me').expect(200)
  await client.post('/api/auth/logout').set('Sec-Fetch-Site', 'same-site').expect(403)
  await client.post('/api/auth/logout').expect(204)
  await client.get('/api/auth/me').expect(401)
  await client.post('/api/auth/login').send({ email: 'first@example.test', password: 'wrong' }).expect(401)
  await client.post('/api/auth/login').send({ email: 'first@example.test', password }).expect(200)
  await supertest(app).get('/api/auth/me').set('Cookie', 'relay_session=invalid').expect(401)
})

test('requester and admin complete the ticket lifecycle with an ordered activity history', async () => {
  const owner = supertest.agent(app)
  const other = supertest.agent(app)
  const admin = supertest.agent(app)
  await register(owner, 'Ticket Owner', 'owner@example.test').expect(201)
  await register(other, 'Other User', 'other@example.test').expect(201)
  const login = await admin.post('/api/auth/login').send({ email: adminEmail, password }).expect(200)
  assert.equal(login.body.user.role, 'admin')

  await owner.post('/api/tickets').send({ ...draft, status: 'resolved' }).expect(400)
  const created = await owner.post('/api/tickets').send(draft).expect(201)
  const url = created.headers.location
  const { id } = created.body.ticket
  assert.equal(url, '/api/tickets/' + id)
  assert.equal(created.body.ticket.status, 'open')
  await other.get(url).expect(404)
  await other.patch(url).send({ title: 'Different title' }).expect(404)
  await other.delete(url).expect(404)
  await other.post(url + '/comments').send({ body: 'No access' }).expect(404)
  const hidden = await other.get('/api/tickets').expect(200)
  assert.equal(hidden.body.total, 0)
  await owner.patch(url).send({ status: 'resolved' }).expect(400)
  await owner.patch(url).send({ title: 'Incorrect total on final invoice' }).expect(200)
  await owner.post(url + '/comments').send({ body: 'I can provide a receipt.' }).expect(201)
  await admin.post(url + '/comments').send({ body: 'We have corrected the invoice.' }).expect(201)
  await admin.patch(url).send({ priority: 'high', status: 'in_progress' }).expect(200)
  await owner.patch(url).send({ title: 'Cannot edit while in progress' }).expect(409)
  await owner.delete(url).expect(409)
  await admin.patch(url).send({ status: 'resolved' }).expect(200)
  await admin.patch(url).send({ status: 'resolved' }).expect(200)

  const result = await owner.get(url).expect(200)
  assert.deepEqual(result.body.comments.map(comment => comment.author_role), ['user', 'admin'])
  assert.deepEqual(result.body.activity.map(event => event.type), [
    'ticket_resolved', 'status_changed', 'status_changed', 'ticket_updated',
    'comment_added', 'comment_added', 'ticket_updated', 'ticket_created'
  ])
  const matches = await admin.get('/api/tickets').query({ status: 'resolved', priority: 'high', q: 'RL-' + id, limit: '1' }).expect(200)
  assert.equal(matches.body.total, 1)
  assert.equal(matches.body.tickets[0].owner_name, 'Ticket Owner')
  const noWildcard = await admin.get('/api/tickets').query({ q: '%' }).expect(200)
  assert.equal(noWildcard.body.total, 0)
  const stats = await owner.get('/api/tickets/stats').expect(200)
  assert.equal(stats.body.resolved, 1)

  const second = await owner.post('/api/tickets').send(draft).expect(201)
  await admin.delete(second.headers.location).expect(403)
  await owner.delete(second.headers.location).expect(204)
  await owner.get(second.headers.location).expect(404)
  await admin.get(second.headers.location).expect(404)
  const { rows: [removed] } = await db.query('SELECT type FROM activity WHERE ticket_id = $1 ORDER BY id DESC LIMIT 1', [second.body.ticket.id])
  assert.equal(removed.type, 'ticket_deleted')
})

test('ticket writes roll back when activity persistence fails', async () => {
  const owner = supertest.agent(app)
  await register(owner, 'Another Requester', 'rollback@example.test').expect(201)
  await db.exec("ALTER TABLE activity ADD CONSTRAINT test_block_creation CHECK (type <> 'ticket_created') NOT VALID")
  try {
    await owner.post('/api/tickets').send(draft).expect(500, { error: 'Something went wrong. Try again later.' })
  } finally {
    await db.exec('ALTER TABLE activity DROP CONSTRAINT test_block_creation')
  }
  const result = await owner.get('/api/tickets').expect(200)
  assert.equal(result.body.total, 0)
})
