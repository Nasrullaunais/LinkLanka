-- ── General Chat cleanup ─────────────────────────────────────────────────────
-- Run this once against your database AFTER deploying the new API build.
-- The TypeORM `synchronize: true` flag will automatically drop the obsolete
-- `type` and `slug` columns from `chat_groups` on the first startup.
--
-- This script only removes the General Chat row and all its associated data.
-- Everything else is left intact.

BEGIN;

-- 1. Remove ALL orphaned messages (group_id references a non-existent group).
--    This is what causes the TypeORM FK sync error on startup.
DELETE FROM messages
WHERE group_id NOT IN (SELECT id FROM chat_groups);

-- 2. Remove ALL orphaned group_members rows for the same reason.
DELETE FROM group_members
WHERE group_id NOT IN (SELECT id FROM chat_groups);

-- 3. Also remove the General Chat group specifically (if it still exists),
--    along with any remaining messages / memberships tied to it.
DELETE FROM messages
WHERE group_id IN (
  SELECT id FROM chat_groups WHERE slug = 'general-chat'
);

DELETE FROM group_members
WHERE group_id IN (
  SELECT id FROM chat_groups WHERE slug = 'general-chat'
);

DELETE FROM chat_groups
WHERE slug = 'general-chat';

COMMIT;

-- Verify: should return 0 rows.
SELECT id, name FROM chat_groups WHERE slug = 'general-chat';
