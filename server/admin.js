import { pathToFileURL } from 'node:url'
import { createPool, migrate } from './db.js'
import { hashPassword } from './passwords.js'
import { emailSchema, parse, passwordSchema } from './validation.js'

export async function ensureAdmin(db, rawEmail, rawPassword) {
  if (!rawEmail && !rawPassword) return
  const email = parse(emailSchema, rawEmail)
  const password = parse(passwordSchema, rawPassword)
  const existing = await db.query('SELECT role FROM users WHERE email = $1', [email])
  if (existing.rows[0]?.role === 'admin') return

  const passwordHash = await hashPassword(password)
  const { rows } = await db.query(
    "INSERT INTO users (name, email, password_hash, role) VALUES ('Support Admin', $1, $2, 'admin') " +
    'ON CONFLICT (email) DO NOTHING RETURNING role',
    [email, passwordHash]
  )
  if (!rows.length) {
    const { rows: [account] } = await db.query('SELECT role FROM users WHERE email = $1', [email])
    if (account?.role !== 'admin') throw new Error('ADMIN_EMAIL already belongs to a regular user. Choose a new address.')
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const db = createPool()
  try {
    if (!process.env.ADMIN_EMAIL || !process.env.ADMIN_PASSWORD) throw new Error('Set ADMIN_EMAIL and ADMIN_PASSWORD.')
    await migrate(db)
    await ensureAdmin(db, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD)
    console.log('Administrator account is ready.')
  } catch (error) {
    console.error(error.code ?? error.message)
    process.exitCode = 1
  } finally {
    await db.end()
  }
}
