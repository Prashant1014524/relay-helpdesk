import { createApp } from './app.js'
import { createPool, migrate } from './db.js'
import { ensureAdmin } from './admin.js'

const db = createPool()
try {
  const app = createApp(db, {
    jwtSecret: process.env.JWT_SECRET,
    secureCookies: process.env.NODE_ENV === 'production',
    trustProxy: Number(process.env.TRUST_PROXY_HOPS ?? 0)
  })
  await migrate(db)
  await ensureAdmin(db, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD)
  const port = Number(process.env.PORT ?? 3000)
  const server = app.listen(port, '0.0.0.0', () => console.log('Relay Helpdesk listening on port ' + port))
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.close(() => void db.end()))
  }
} catch (error) {
  console.error('Startup failed:', error.code ?? error.message)
  await db.end()
  process.exitCode = 1
}
