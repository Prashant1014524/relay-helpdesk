# Database design

PostgreSQL stores accounts, tickets, comments and ticket activity in separate tables. The schema is defined in [server/schema.sql](../server/schema.sql) and initialized at application startup under a PostgreSQL advisory transaction lock.

| Table | Key | Relationships and important fields |
| --- | --- | --- |
| `users` | UUID | Unique lowercase email, display name, salted password hash, role, creation time |
| `tickets` | Integer identity | Required `owner_id` references `users.id`. Stores title, description, category, priority, status, creation, update and deletion timestamps. |
| `comments` | Integer identity | Required `ticket_id` and `author_id` reference the ticket and posting user. Stores body and creation time. |
| `activity` | Integer identity | Required `ticket_id` and `actor_id` reference the affected ticket and acting user. Stores the event type, JSONB details and creation time. |

A user can own many tickets, write many comments, and generate many events. A ticket can have many comments and activity entries. Foreign keys protect these relationships. Constraints enforce valid roles, categories, statuses and priorities. The application validates request lengths and input formats before writing.

## Reads and transactions

Partial indexes cover active tickets ordered by update time and the status and priority filters. The owner and recency index supports the requester queue. The comment and activity indexes support per-ticket reads ordered by ID. Text search uses a parameterized substring match and escapes wildcard characters. That keeps the small deployment simple. For a larger queue, search can use PostgreSQL full-text or trigram indexes.

A transaction locks the ticket row before updates, withdrawal or comments. A withdrawn ticket keeps `deleted_at` and its relationships for audit. Normal queries exclude withdrawn tickets. Ticket detail and paginated list reads use repeatable-read transactions for a consistent snapshot.

## Events

| Event | When it is recorded |
| --- | --- |
| `ticket_created` | Ticket submission succeeds |
| `ticket_updated` | One or more editable properties other than status change |
| `status_changed` | An administrator changes status. The entry records the previous and new values. |
| `comment_added` | A comment is saved. The entry stores the comment ID. |
| `ticket_resolved` | A ticket transitions to resolved |
| `ticket_deleted` | A requester withdraws an open ticket |

Each event is handled by the activity subscriber during the ticket transaction. If the activity insert fails, the ticket change rolls back. Submitting the current status and priority again creates no event. The history is read through the same ticket visibility check as comments and ticket details.
