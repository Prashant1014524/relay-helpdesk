import { z } from 'zod'
import { categories, priorities, statuses } from '../shared/options.js'

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

export function parse(schema, input) {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const field = issue.path.join('.')
  throw new HttpError(400, field ? field + ': ' + issue.message : issue.message)
}

const text = (min, max) => z.string().trim().min(min).max(max)
  .refine(value => !value.includes('\0'), 'Remove null characters')

export const emailSchema = z.string().trim().toLowerCase().max(254).email()
export const passwordSchema = z.string().min(10).max(128)
export const loginSchema = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(128)
})
export const registerSchema = loginSchema.extend({
  name: text(2, 80),
  password: passwordSchema
})

const priority = z.enum(Object.keys(priorities))
const status = z.enum(Object.keys(statuses))
const ticketFields = {
  title: text(4, 120),
  description: text(10, 5000),
  category: z.enum(Object.keys(categories)),
  priority
}
export const createTicketSchema = z.strictObject(ticketFields)
const atLeastOne = data => Object.keys(data).length > 0
export const editTicketSchema = z.strictObject(ticketFields).partial().refine(atLeastOne, 'Supply at least one field')
export const manageTicketSchema = z.strictObject({ status, priority }).partial().refine(atLeastOne, 'Supply at least one field')
export const commentSchema = z.strictObject({ body: text(1, 2000) })

function queryInt(max) {
  return z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().min(1).max(max))
}

export const ticketIdSchema = queryInt(2147483647)
export const ticketListSchema = z.strictObject({
  status: status.optional(),
  priority: priority.optional(),
  q: text(0, 120).optional(),
  sort: z.enum(['updated', 'newest', 'oldest']).default('updated'),
  page: queryInt(1000000).optional().transform(value => value ?? 1),
  limit: queryInt(50).optional().transform(value => value ?? 10)
})
