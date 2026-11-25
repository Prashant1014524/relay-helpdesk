# Relay Helpdesk

Relay is a mini support desk built with Node.js, Express, PostgreSQL and React. Requesters submit and track their own tickets. Administrators work from a shared queue and reply in the same conversation.

[Open the live helpdesk](https://relay-helpdesk-9noe.onrender.com/)

## Run locally

Prerequisites are Node.js 22.12 or later, npm, and PostgreSQL 17. Docker Compose can start PostgreSQL for you.

```bash
docker compose up -d --wait db
npm ci
```

Copy `.env.example` to `.env`. The example database URL matches the Compose service. If you already have PostgreSQL, create an empty database and use its connection URL. Generate a JWT secret and paste the result into `JWT_SECRET`.

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
npm run dev
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Express starts on port 3000 and applies the SQL schema at startup. Vite proxies `/api` to Express. If you change the API port, update the proxy target in `vite.config.js`.

For an administrator account, add `ADMIN_EMAIL` and `ADMIN_PASSWORD` to `.env` using a new email and a unique password of at least 10 characters. Run `npm run admin:set`. Once the account exists, remove both bootstrap values from `.env`. Sign in with those credentials while using a separate requester account to submit tickets.

```bash
npm test
npm run build
npm start
```

After building, Express serves the frontend and API at [http://localhost:3000](http://localhost:3000). For local HTTP, leave `NODE_ENV` unset so the browser can accept the development session cookie.

## Ticket rules

| Action | Requester | Administrator |
| --- | --- | --- |
| Submit a ticket | Yes | Use a requester account |
| View, filter or comment | Own tickets | All visible tickets |
| Edit the title, description or category | Own open tickets | — |
| Change priority | Own open tickets | Any visible ticket |
| Change status | — | Any visible ticket |
| Withdraw a ticket | Own open tickets | — |

Tickets start open. Administrators can change status to open, in progress, resolved, or closed, including reopening a ticket. Commenting remains available at every status. Withdrawal hides the ticket from the application and preserves its history in PostgreSQL.

## Implementation

- Express routes validate input with Zod, then apply the role and ownership rules before running parameterized queries through `pg`.
- Public registration creates requester accounts. Server-side bootstrap provisions administrators. Passwords use salted scrypt hashes and authentication routes have an IP-based rate limit.
- The API issues one-hour HS256 JWTs in HttpOnly, SameSite=Strict cookies. Production cookies also use Secure. Each protected request reads the current account and role from PostgreSQL. Signing out clears the browser cookie. A previously copied token remains valid until expiry.
- Ticket mutations publish typed events to a synchronous activity subscriber. The mutation and activity insert commit together. A row lock serializes competing writes to the same ticket.
- React uses the same REST API as external clients. Search supports title, description and ticket reference. Lists expose status and priority filters, three sort orders and pagination. Statistics are scoped to the signed-in role.

See [the API reference](docs/API.md) and [the database design](docs/DATABASE.md).

## Deploy to Render

1. Push the repository to GitHub. In Render, create a Blueprint using that repository. Authorize Render to access the repository if prompted.
2. Deploy the Blueprint. The included `render.yaml` provisions a Node web service and a PostgreSQL 17 database. Render generates the JWT secret and the initial password for `admin@relay.example`. The workspace owner can retrieve `ADMIN_PASSWORD` from the web service's Environment page after deployment.
3. After the first successful deploy, open the web service's URL and check `/api/health`. Register a requester, submit a ticket, and use a separate admin session to reply and resolve it.
4. Share the live URL with the evaluator and share any evaluator credentials through a private channel. Grant the evaluator access if the GitHub repository is private. Keep the generated password available for evaluator access. Changing the bootstrap variable after account creation does not change the account password.

The Blueprint uses Render's free plans. Account for free database expiration if the evaluator will review the project later. [Render Blueprint reference](https://render.com/docs/blueprint-spec) · [Free plan limits](https://render.com/docs/free)

## Interview walkthrough

Register two requesters so you can demonstrate that each sees only their own tickets. Submit a ticket, add a requester comment, then sign in as the administrator in a separate browser session. Filter the queue, reply, and resolve the ticket. Return to the requester account to show the status, both comments, and the activity history.

The main design tradeoffs are transactional activity logging for consistency, short-lived cookies without a server-side session table, and offset pagination for a small queue. The automated tests cover login, role restrictions, ownership, filtering, the ticket lifecycle, and rollback when activity persistence fails. They run against an in-memory PostgreSQL engine using PGlite. The deployed API uses PostgreSQL through `pg`.
