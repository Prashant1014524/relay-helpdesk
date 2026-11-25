import { promisify } from 'node:util'
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const deriveKey = promisify(scrypt)
const parameters = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 ** 2 }
export const dummyHash = '00000000000000000000000000000000:' + '0'.repeat(128)

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const key = await deriveKey(password, salt, 64, parameters)
  return salt + ':' + key.toString('hex')
}

export async function verifyPassword(password, hash) {
  const [salt, storedKey] = hash.split(':')
  const key = await deriveKey(password, salt, 64, parameters)
  return timingSafeEqual(Buffer.from(storedKey, 'hex'), key)
}
