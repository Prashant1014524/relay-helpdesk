CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(80) NOT NULL,
  email varchar(254) UNIQUE NOT NULL CHECK (email = lower(email)),
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  title varchar(120) NOT NULL,
  description varchar(5000) NOT NULL,
  category text NOT NULL CHECK (category IN ('account', 'billing', 'technical', 'general')),
  priority text NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE IF NOT EXISTS comments (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id integer NOT NULL REFERENCES tickets(id),
  author_id uuid NOT NULL REFERENCES users(id),
  body varchar(2000) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS activity (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ticket_id integer NOT NULL REFERENCES tickets(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  type text NOT NULL CHECK (type IN (
    'ticket_created', 'ticket_updated', 'status_changed',
    'comment_added', 'ticket_resolved', 'ticket_deleted'
  )),
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS tickets_owner_recency ON tickets (owner_id, updated_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tickets_recency ON tickets (updated_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tickets_status ON tickets (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS tickets_priority ON tickets (priority) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS comments_ticket ON comments (ticket_id, id);
CREATE INDEX IF NOT EXISTS activity_ticket ON activity (ticket_id, id);
