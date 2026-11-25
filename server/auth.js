import jwt from 'jsonwebtoken'
import { rateLimit } from 'express-rate-limit'
import { dummyHash, hashPassword, verifyPassword } from './passwords.js'
import { HttpError, loginSchema, parse, registerSchema } from './validation.js'

const publicFields = 'id, name, email, role'
const tokenScope = { issuer: 'relay-helpdesk', audience: 'relay-api' }
const cookieName = 'relay_session'
const maxAge = 60 * 60 * 1000

export function mountAuth(api, db, { jwtSecret, secureCookies, authLimit = 15 }) {
  const cookie = { httpOnly: true, secure: secureCookies, sameSite: 'strict', path: '/' }
  const limited = rateLimit({
    limit: authLimit,
    windowMs: 15 * 60 * 1000,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many sign-in or registration attempts. Try again later.' }
  })

  const signIn = (res, user, status = 200) => {
    const token = jwt.sign({}, jwtSecret, { ...tokenScope, subject: user.id, expiresIn: '1h', algorithm: 'HS256' })
    res.cookie(cookieName, token, { ...cookie, maxAge }).status(status).json({ user })
  }

  async function authenticate(req, res, next) {
    let subject
    try {
      subject = jwt.verify(req.cookies[cookieName], jwtSecret, { ...tokenScope, algorithms: ['HS256'] }).sub
    } catch {
      throw new HttpError(401, 'Sign in to continue.')
    }
    const { rows: [user] } = await db.query('SELECT ' + publicFields + ' FROM users WHERE id = $1', [subject])
    if (!user) throw new HttpError(401, 'Sign in to continue.')
    req.user = user
    next()
  }

  api.post('/auth/register', limited, async (req, res) => {
    const { name, email, password } = parse(registerSchema, req.body)
    const hash = await hashPassword(password)
    const { rows: [user] } = await db.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING RETURNING ' + publicFields,
      [name, email, hash]
    )
    if (!user) throw new HttpError(409, 'An account already uses that email.')
    signIn(res, user, 201)
  })

  api.post('/auth/login', limited, async (req, res) => {
    const { email, password } = parse(loginSchema, req.body)
    const { rows: [account] } = await db.query(
      'SELECT ' + publicFields + ', password_hash FROM users WHERE email = $1', [email]
    )
    const valid = await verifyPassword(password, account?.password_hash ?? dummyHash)
    if (!valid || !account) throw new HttpError(401, 'Email or password is incorrect.')
    const { password_hash, ...user } = account
    signIn(res, user)
  })

  api.post('/auth/logout', (req, res) => res.clearCookie(cookieName, cookie).sendStatus(204))
  api.get('/auth/me', authenticate, (req, res) => res.json({ user: req.user }))
  return authenticate
}
