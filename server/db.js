import { readFile } from 'node:fs/promises'
import pg from 'pg'

export function createPool() {
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before starting.')
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, max: 10 })
  pool.on('error', error => console.error('Idle PostgreSQL connection failed:', error.code ?? error.name))
  return pool
}

export async function transaction(pool, operation, isolation = 'BEGIN') {
  const client = await pool.connect()
  let discard = false
  try {
    await client.query(isolation)
    const result = await operation(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      discard = true
    }
    throw error
  } finally {
    client.release(discard)
  }
}

export async function migrate(pool) {
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
  await transaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(421572)')
    await client.query(schema)
  })
}
