# LinkLanka Setup

## Linux/macOS

1. Install Bun, then verify tools.

```bash
curl -fsSL https://bun.sh/install | bash
bun --version
docker --version
```

If `bun` is not found, open a new terminal and run `bun --version` again.

1. From repo root, create env files.

```bash
cp .env.example .env
cp apps/mobile/.env.example apps/mobile/.env
```

1. Open backend env file.

```bash
nano .env
```

Set `DB_PASSWORD`, `JWT_SECRET`, and `GEMINI_API_KEY`.
Set S3 values for uploads: `AWS_S3_BUCKET`, `AWS_S3_REGION`, `AWS_S3_PREFIX`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`.
Optional translation tuning: set `GEMINI_TRANSLATION_MODEL`, `GEMINI_TRANSLATION_FALLBACK_MODEL`, `TRANSLATION_MODEL_MAX_RETRIES`, `TRANSLATION_TIMEOUT_MS_TEXT`, `TRANSLATION_TIMEOUT_MS_MEDIA`, `TTS_MANDATORY_ENGLISH_RETRIES`, and `DOMINANT_LANGUAGE_LOW_CONFIDENCE_THRESHOLD`.

1. Copy Firebase credentials (ask lead dev for the file).

```bash
cp /path/to/google-services.json apps/mobile/google-services.json
cp /path/to/google-services.json apps/mobile/android/app/google-services.json
```

1. Start backend (API + Postgres).

```bash
docker compose up --build -d
```

1. Install dependencies (separate installs).

```bash
cd apps/api && bun install
cd ../mobile && bun install
```

1. Run mobile.

```bash
cd apps/mobile
bun run android
# bun run ios
```

## Windows (PowerShell)

1. Install Bun, then verify tools.
Make sure you run these commands in windows POWERSHELL.

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
bun --version
docker --version
```

If `bun` is not found, open a new PowerShell window and run `bun --version` again.

1. From repo root, create env files.

```powershell
Copy-Item .env.example .env
Copy-Item apps/mobile/.env.example apps/mobile/.env
```

1. Open backend env file.

```powershell
notepad .env
```

Set `DB_PASSWORD`, `JWT_SECRET`, and `GEMINI_API_KEY`.
Set S3 values for uploads: `AWS_S3_BUCKET`, `AWS_S3_REGION`, `AWS_S3_PREFIX`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY`.
Optional translation tuning: set `GEMINI_TRANSLATION_MODEL`, `GEMINI_TRANSLATION_FALLBACK_MODEL`, `TRANSLATION_MODEL_MAX_RETRIES`, `TRANSLATION_TIMEOUT_MS_TEXT`, `TRANSLATION_TIMEOUT_MS_MEDIA`, `TTS_MANDATORY_ENGLISH_RETRIES`, and `DOMINANT_LANGUAGE_LOW_CONFIDENCE_THRESHOLD`.

1. Copy Firebase credentials (ask lead dev for the file).

```powershell
Copy-Item "C:\path\to\google-services.json" "apps/mobile/google-services.json"
Copy-Item "C:\path\to\google-services.json" "apps/mobile/android/app/google-services.json"
```

1. Start backend (API + Postgres).

```powershell
docker compose up --build -d
```

1. Install dependencies (separate installs).

```powershell
Set-Location apps/api
bun install
Set-Location ../mobile
bun install
```

1. Run mobile.

```powershell
Set-Location apps/mobile
bun run android
# bun run ios
```

## Tiny Troubleshooting

- Check running containers: `docker compose ps`
- Android emulator API URL should be `http://10.0.2.2:3000` in `apps/mobile/.env`
- Keep `AWS_S3_PREFIX=linklanka/` so uploads stay inside the expected bucket folder.
- If `apps/mobile/node_modules` is root-owned (Linux/macOS): `sudo chown -R $USER:$USER apps/mobile/node_modules`

## Personal Dictionary Language Buckets Rollout (Production)

When deploying the 50-per-language personal dictionary update (Singlish/English/Tanglish), run the database migration script first in production environments where `DB_SYNCHRONIZE=false`.

```bash
psql "$DATABASE_URL" -f apps/api/scripts/migrate-personal-context-language-buckets.sql
```

What this script does:
- Normalizes invalid or null `dialect_type` values to `english`
- Enforces `dialect_type` as non-null with default `english`
- Replaces global uniqueness `(user_id, slang_word)` with language-scoped uniqueness `(user_id, slang_word, dialect_type)`
