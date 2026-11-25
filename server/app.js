import express from 'express'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { mountAuth } from './auth.js'
import { mountTickets } from './tickets.js'
import { HttpError } from './validation.js'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))

export function createApp(db, options) {
  if (Buffer.byteLength(options.jwtSecret ?? '') < 32) throw new Error('Set JWT_SECRET to at least 32 bytes.')
  const app = express()
  app.disable('x-powered-by')
  if (options.trustProxy) app.set('trust proxy', options.trustProxy)
  app.use(helmet({
    strictTransportSecurity: options.secureCookies,
    contentSecurityPolicy: {
      directives: { upgradeInsecureRequests: options.secureCookies ? [] : null }
    }
  }))
  const api = express.Router()
  api.use((req, res, next) => {
    res.set('Cache-Control', 'no-store')
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method)
    const site = req.get('Sec-Fetch-Site')
    if (unsafe && site && !['same-origin', 'none'].includes(site)) {
      throw new HttpError(403, 'Cross-origin writes are forbidden.')
    }
    next()
  })
  api.use(express.json({ limit: '32kb' }), cookieParser())
  api.get('/health', async (req, res) => {
    try {
      await db.query('SELECT 1')
      res.json({ status: 'ok' })
    } catch {
      res.status(503).json({ status: 'unavailable' })
    }
  })
  const authenticate = mountAuth(api, db, options)
  mountTickets(api, db, authenticate)
  api.use((req, res) => res.status(404).json({ error: 'API route not found.' }))
  app.use('/api', api)

  if (existsSync(dist + 'index.html')) {
    app.use('/assets', express.static(dist + 'assets', { immutable: true, maxAge: '1y' }))
    app.get('/', (req, res) => res.sendFile(dist + 'index.html', { maxAge: 0 }))
  }

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error)
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message })
    if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON.' })
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' })
    console.error('Request failed:', error.code ?? error.name)
    res.status(500).json({ error: 'Something went wrong. Try again later.' })
  })
  return app
}
