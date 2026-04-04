-- ── Message idempotency migration (client_temp_id) ─────────────────────────
-- Goal:
-- 1) Add nullable client_temp_id to messages
-- 2) Enforce sender+group+client_temp_id uniqueness when client_temp_id is set
--
-- Run this in production BEFORE deploying API builds that rely on idempotent
-- message replay via clientTempId.

BEGIN;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS client_temp_id varchar(64);

-- Normalize empty values to NULL so the partial unique index remains valid.
UPDATE messages
SET client_temp_id = NULL
WHERE client_temp_id IS NOT NULL
  AND btrim(client_temp_id) = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'uq_messages_sender_group_client_temp_id'
  ) THEN
    CREATE UNIQUE INDEX uq_messages_sender_group_client_temp_id
      ON messages (sender_id, group_id, client_temp_id)
      WHERE client_temp_id IS NOT NULL;
  END IF;
END $$;

COMMIT;
