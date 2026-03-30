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
Optional translation tuning: set `GEMINI_TRANSLATION_MODEL`, `GEMINI_TRANSLATION_FALLBACK_MODEL`, `TRANSLATION_MODEL_MAX_RETRIES`, and `TRANSLATION_TIMEOUT_MS`.

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
Optional translation tuning: set `GEMINI_TRANSLATION_MODEL`, `GEMINI_TRANSLATION_FALLBACK_MODEL`, `TRANSLATION_MODEL_MAX_RETRIES`, and `TRANSLATION_TIMEOUT_MS`.

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
- If `apps/mobile/node_modules` is root-owned (Linux/macOS): `sudo chown -R $USER:$USER apps/mobile/node_modules`
