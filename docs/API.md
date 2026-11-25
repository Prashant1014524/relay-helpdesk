# REST API reference

The base URL is `http://localhost:3000/api` for local production builds. On the deployed host, use its HTTPS origin plus `/api`. Send JSON request bodies with `Content-Type: application/json`. Login and registration return a `relay_session` HttpOnly cookie. Send that cookie on subsequent requests. Browsers do this automatically for the same origin. Postman retains it in the cookie jar.

## Authentication and health

| Method | Route | Body | Success |
| --- | --- | --- | --- |
| GET | `/health` | — | `200 { status: "ok" }` when PostgreSQL is reachable, otherwise `503` |
| POST | `/auth/register` | `{ name, email, password }` | `201 { user }` and session cookie |
| POST | `/auth/login` | `{ email, password }` | `200 { user }` and session cookie |
| GET | `/auth/me` | — | `200 { user }` |
| POST | `/auth/logout` | — | `204` and cleared session cookie |

`user` contains `id`, `name`, `email` and `role`. Names are 2–80 characters. Emails are trimmed and normalized to lowercase. New passwords must be 10–128 characters.

## Tickets

These routes require authentication. Requesters see their own tickets. Administrators see the shared queue. Deleted tickets are absent from both views.

| Method | Route | Body or query | Success |
| --- | --- | --- | --- |
| GET | `/tickets` | Optional `status`, `priority`, `q`, `sort`, `page`, `limit` | `200 { tickets, total, page, limit }` |
| GET | `/tickets/stats` | — | `200 { total, open, in_progress, resolved, closed }` |
| POST | `/tickets` | `{ title, description, category, priority }` | `201 { ticket }` and a `Location` header |
| GET | `/tickets/:id` | — | `200 { ticket, comments, activity }` |
| PATCH | `/tickets/:id` | Requester uses any subset of `title`, `description`, `category`, `priority`. Admin uses `status`, `priority` or both. | `200 { ticket }` |
| DELETE | `/tickets/:id` | — | `204` |
| POST | `/tickets/:id/comments` | `{ body }` | `201 { comment }` |

- Statuses are `open`, `in_progress`, `resolved`, and `closed`.
- Priorities are `low`, `medium`, `high`, and `urgent`.
- Categories are `account`, `billing`, `technical`, and `general`.
- Titles are 4–120 characters, descriptions are 10–5,000, and comments are 1–2,000. These values are trimmed.
- `sort` supports `updated` (default), `newest`, and `oldest`. `page` starts at 1. `limit` defaults to 10 and supports 1–50. The case-insensitive `q` filter searches title, description and reference, such as `RL-42`.
- Requesters can edit and withdraw their own open tickets. Administrators can change status or priority on any visible ticket. Both can comment on every ticket they can view.
- List items contain `id`, `title`, `category`, `priority`, `status`, `created_at`, `updated_at`, and `owner_name`. Ticket details also contain `owner_id` and `description`. Comments include the body, author name, author role and timestamp. Activity includes its type, actor name, timestamp and event details.

## Example requester session

Run the commands from a shell with cURL. Use `curl.exe` on Windows PowerShell where `curl` may resolve to a different command. The example credentials are for local testing.

```bash
curl -i -c relay.cookies -H 'Content-Type: application/json' \
  -d '{"name":"Asha Rao","email":"asha@example.test","password":"local-example-9010"}' \
  http://localhost:3000/api/auth/register

curl -i -b relay.cookies -H 'Content-Type: application/json' \
  -d '{"title":"Cannot download an invoice","description":"The download button gives me a blank page.","category":"billing","priority":"medium"}' \
  http://localhost:3000/api/tickets

curl -b relay.cookies 'http://localhost:3000/api/tickets?status=open&limit=10'
```

Delete the local cookie jar after testing. Treat it like a password while the session is active.

## Errors

Errors use `{ "error": "Human-readable message" }`, except health check failures. Unknown fields, invalid IDs or values, and malformed JSON return `400`. Invalid or missing credentials return `401`. Disallowed actions such as an admin attempting deletion return `403`. Missing tickets and another requester's tickets return `404`. Duplicate emails and edits or withdrawals of non-open tickets return `409`. Oversized JSON returns `413`, and auth rate limits return `429`. Unexpected server errors return a generic `500`.
