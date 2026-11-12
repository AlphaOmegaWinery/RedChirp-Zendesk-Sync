-- Sync state only. Message text is never kept here after an event is processed.

CREATE TABLE IF NOT EXISTS user_map (
  id SERIAL PRIMARY KEY,
  redchirp_user_id TEXT UNIQUE NOT NULL,
  zendesk_user_id BIGINT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS conversation_map (
  id SERIAL PRIMARY KEY,
  redchirp_conversation_id TEXT UNIQUE NOT NULL,
  phone TEXT NOT NULL,
  sunshine_user_external_id TEXT NOT NULL,
  sunshine_conversation_id TEXT UNIQUE,
  active_ticket_id BIGINT,
  last_synced_assignee_zendesk_id BIGINT,
  last_synced_status TEXT,
  last_message_direction TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_map (
  id SERIAL PRIMARY KEY,
  redchirp_message_id TEXT UNIQUE,
  sunshine_message_id TEXT UNIQUE,
  redchirp_conversation_id TEXT NOT NULL,
  direction TEXT NOT NULL,          -- inbound (guest) or outbound (staff)
  origin TEXT NOT NULL,             -- redchirp or zendesk
  ticket_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_cursor (
  source TEXT PRIMARY KEY,
  cursor_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Work queue and audit log. payload is cleared once an event is finished.
CREATE TABLE IF NOT EXISTS event_log (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,             -- redchirp | sunshine | zendesk
  event_type TEXT NOT NULL,
  dedupe_key TEXT UNIQUE NOT NULL,
  conversation_key TEXT,
  payload JSONB,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | done | skipped | failed
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS event_log_pending ON event_log (status, next_attempt_at, id);
