-- ── Personal Dictionary language-bucket migration ───────────────────────────
-- Goal:
-- 1) Normalize dialect_type to one of: singlish | english | tanglish
-- 2) Enforce non-null dialect_type with default english
-- 3) Replace old uniqueness (user_id, slang_word) with
--    language-scoped uniqueness (user_id, slang_word, dialect_type)
--
-- Run this in production BEFORE deploying the API version that requires
-- language-specific limits.

BEGIN;

-- Normalize existing values first.
UPDATE personal_context
SET dialect_type = lower(dialect_type)
WHERE dialect_type IS NOT NULL;

UPDATE personal_context
SET dialect_type = 'english'
WHERE dialect_type IS NULL
   OR dialect_type NOT IN ('singlish', 'english', 'tanglish');

-- Enforce strict column constraints.
ALTER TABLE personal_context
  ALTER COLUMN dialect_type TYPE varchar(20),
  ALTER COLUMN dialect_type SET DEFAULT 'english',
  ALTER COLUMN dialect_type SET NOT NULL;

-- Drop prior unique constraint on (user_id, slang_word) if present.
DO $$
DECLARE
  old_constraint_name text;
BEGIN
  SELECT con.conname
  INTO old_constraint_name
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE con.contype = 'u'
    AND rel.relname = 'personal_context'
    AND nsp.nspname = current_schema()
    AND con.conname <> 'UQ_personal_context_user_word_dialect'
    AND pg_get_constraintdef(con.oid) ILIKE '%(user_id, slang_word)%'
  LIMIT 1;

  IF old_constraint_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE personal_context DROP CONSTRAINT %I',
      old_constraint_name
    );
  END IF;
END $$;

-- Add language-scoped uniqueness.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'UQ_personal_context_user_word_dialect'
  ) THEN
    ALTER TABLE personal_context
      ADD CONSTRAINT "UQ_personal_context_user_word_dialect"
      UNIQUE (user_id, slang_word, dialect_type);
  END IF;
END $$;

COMMIT;
