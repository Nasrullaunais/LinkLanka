# LinkLanka — Team Setup Guide

This guide walks you through setting up the **LinkLanka** project from scratch on **Windows** or **macOS** using VS Code.

---

## Setup Commands (in order)

Run these commands in the exact sequence below after extracting the project. Detailed explanations for each step are in the sections that follow.

```bash
# 1. Install pnpm (skip if already installed)
npm install -g pnpm@10.28.2

# 2. From the project root — install all dependencies
pnpm install

# 3. From the project root — start the database
docker compose up -d

# 4. Open a new terminal tab, navigate to the API, and start it
cd apps/api
pnpm start:dev

# 5. Open another new terminal tab, navigate to the mobile app, and run it
cd apps/mobile
pnpm android      # Android emulator / device
# pnpm ios        # iOS simulator (macOS only)
# pnpm start      # Metro only (dev build already installed on device)
```

> **Before step 2:** Create your `.env` files as described in [Section 5](#5-set-up-environment-files). The API will not start without them.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [VS Code Extensions](#2-vs-code-extensions)
3. [Extract the Project](#3-extract-the-project)
4. [Install Dependencies](#4-install-dependencies)
5. [Set Up Environment Files](#5-set-up-environment-files)
6. [Start the Database](#6-start-the-database)
7. [Run the API](#7-run-the-api)
8. [Run the Mobile App](#8-run-the-mobile-app)
9. [Running on a Physical Device](#9-running-on-a-physical-device)
10. [Switching Network Environments](#10-switching-network-environments)
11. [Troubleshooting](#11-troubleshooting)

---

## 1. Prerequisites

Install all of the following before opening the project.

### Node.js (LTS)

Download and install the **LTS** version from [https://nodejs.org](https://nodejs.org).

Verify it installed correctly:
```
node --version
```
You should see something like `v22.x.x`.

---

### pnpm

This project uses **pnpm** as its package manager. After installing Node.js, run:

```
npm install -g pnpm@10.28.2
```

Verify:
```
pnpm --version
```
Expected: `10.28.2`

---

### Docker Desktop

The database (PostgreSQL) runs in a Docker container. Download and install **Docker Desktop**:

- **Windows:** [https://docs.docker.com/desktop/install/windows/](https://docs.docker.com/desktop/install/windows/)
- **macOS:** [https://docs.docker.com/desktop/install/mac/](https://docs.docker.com/desktop/install/mac/)

After installing, **launch Docker Desktop** and make sure it is running (look for the whale icon in your system tray / menu bar).

Verify Docker is working:
```
docker --version
```

---

### Android Studio (for Android)

This project uses native modules and requires a **development build** — it does not run in Expo Go.

- **Windows / macOS:** Download Android Studio from [https://developer.android.com/studio](https://developer.android.com/studio).
- During setup, install the **Android SDK**, **Android Emulator**, and **Android Virtual Device (AVD)**.
- Create a virtual device via **Device Manager** in Android Studio (a Pixel device with API 34+ recommended).

> If you only plan to test on a physical Android device, you can skip the emulator setup — just install Android Studio for its SDK and build tools.

---

### Xcode (for iOS — macOS only)

Download **Xcode** from the Mac App Store. After installing, open it once to accept the license and let it install its components.

---

### Git (Windows only)

The project contains shell scripts (`.sh` files). On Windows you need **Git Bash** to run them.

Download Git for Windows: [https://git-scm.com/download/win](https://git-scm.com/download/win)

During installation, choose **"Git Bash Here"** option. Git Bash is bundled with it.

---

## 2. VS Code Extensions

Open VS Code and install these extensions (search by name in the Extensions panel, `Ctrl+Shift+X` / `Cmd+Shift+X`):

| Extension | Publisher |
|---|---|
| **ESLint** | Microsoft |
| **Prettier – Code formatter** | Prettier |
| **TypeScript Next** | Microsoft |
| **NestJS Files** | Mihai Dinculescu |
| **REST Client** | Huachao Mao |
| **Docker** | Microsoft |

> **Tip:** Set Prettier as your default formatter. Open VS Code Settings (`Ctrl+,`) → search "default formatter" → select **Prettier**.

---

## 3. Extract the Project

> **How the ZIP must be created (lead developer note)**
> Always generate the ZIP with `git archive`, never with a file-manager "Compress" option.
> A file-manager zip bundles build artifacts, compiled binaries, and Android CMake cache files
> (some of which contain absolute paths to the developer's own machine) that will break the build
> on any other machine.
>
> From the project root, run:
> ```bash
> git archive HEAD --format=zip -o LinkLankaV2.zip
> ```
> This produces a clean archive containing only files that are tracked by Git.
>
> **Note on `.env` files:** `.env` files are intentionally excluded from the archive — they contain secrets and must never be committed. Teammates create them manually using the values provided in [Section 5](#5-set-up-environment-files). The project will not start without them.

> **Windows users — read this before extracting.**
> The Android project contains deeply nested file paths that exceed Windows' default 260-character path limit. The built-in Windows extractor will fail silently or skip files. Follow the steps below to avoid this.

### Windows

1. Install **7-Zip** (free): [https://7-zip.org](https://7-zip.org)
2. Right-click `LinkLankaV2.zip` → **7-Zip → Extract to "LinkLankaV2\"**
3. Extract to a **short path** such as `C:\Projects\` — the shorter the destination, the better. Avoid deeply nested folders like your Desktop or Downloads.

> **Optional — enable long paths permanently:** Open PowerShell as Administrator and run:
> ```powershell
> New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
> ```
> Restart Windows after running this. You can then use any extractor without path issues.

### macOS

1. Double-click `LinkLankaV2.zip` — the built-in Archive Utility handles it fine.
2. Move the extracted folder to `~/Projects/LinkLankaV2`.

---

### After extracting

1. Open VS Code, then click **File → Open Folder** and select the `LinkLankaV2` folder (the one that contains `compose.yaml` at the root).

2. Open the integrated terminal in VS Code (`` Ctrl+` `` on Windows, `` Cmd+` `` on macOS). All commands below are run from this terminal unless stated otherwise.

---

## 4. Install Dependencies

From the **project root** (`LinkLankaV2/`), run:

```
pnpm install
```

This installs dependencies for **both** `apps/api` and `apps/mobile` in one shot (pnpm workspaces handles this automatically).

---

## 5. Set Up Environment Files

The project requires two `.env` files. **These are not in the zip** because they contain secrets. Follow the steps below to create them.

### 5a. Root `.env` (for the API)

In the project root, create a new file named `.env` and paste the following:

```env
# ── Database ──────────────────────────────────────────────────────────────────
DB_HOST=localhost
DB_PORT=5433
DB_USER=linklanka_admin
DB_PASSWORD=itpse55
DB_NAME=linklanka_db

# ── Auth ──────────────────────────────────────────────────────────────────────
JWT_SECRET=OYoJJErsHNvbxyuIlSda86brge3n7AnTKO+JxDf0pLDUUTLs0QVSi1P48rRkc8zX

# ── External APIs ─────────────────────────────────────────────────────────────
GEMINI_API_KEY=AIzaSyBrVa_1sxPbcAqqnkzQae3gRgM13IpeMk0

# ── API base URL ──────────────────────────────────────────────────────────────
BASE_URL=http://localhost:3000
```

> **Note:** `BASE_URL` is used to build file URL links (media, profile pictures, etc.). If you are testing on a **physical phone** (not an emulator), replace `localhost` with your machine's local IP address — see [Section 9](#9-running-on-a-physical-device) for instructions.

---

### 5b. Mobile `.env` (for the Expo app)

Inside `apps/mobile/`, create a file named `.env` and paste:

```env
EXPO_PUBLIC_API_URL=http://localhost:3000
```

> **Note:** Same as above — if you are testing on a physical phone, you must replace `localhost` with your machine's IP address. See [Section 9](#9-running-on-a-physical-device).

---

### 5c. Firebase config files (`google-services.json`)

These files are excluded from the zip (they contain Firebase project credentials) and must be placed manually. You should have received them from the lead developer alongside the zip.

| File | Destination path | Why it's needed |
|---|---|---|
| `google-services.json` | `apps/mobile/google-services.json` | **Primary** — referenced by `app.json`. Expo reads this during `pnpm android` and copies it into the Android project. |
| `google-services.json` | `apps/mobile/android/app/google-services.json` | Read directly by Gradle at build time. Can be the same file as above — just copy it to both locations. |

Both files have identical content. If you only received one copy, place it in `apps/mobile/google-services.json` **and** copy it to `apps/mobile/android/app/google-services.json`.

The Android build will **fail at the Gradle step** if `apps/mobile/android/app/google-services.json` is missing.

---

## 6. Start the Database

The project ships with a `compose.yaml` file at the root that provisions a **PostgreSQL 16** database automatically.

From the project root, run:

```
docker compose up -d
```

This downloads the PostgreSQL image (first time only) and starts the database container in the background on port **5433**.

Verify it is running:

```
docker compose ps
```

You should see `postgres` listed with a `running` status.

> The database schema is created **automatically** the first time the API starts (TypeORM `synchronize: true` in dev mode). You do not need to run any SQL scripts manually.

To stop the database when you are done:

```
docker compose down
```

---

## 7. Run the API

You need a **dedicated terminal tab** for the API. It must stay open the entire time you are developing — the mobile app cannot work without it.

### Step 1 — Open a new terminal in VS Code

In VS Code, open the terminal panel with `` Ctrl+` `` (Windows) or `` Cmd+` `` (macOS). Click the **`+`** icon to open a fresh tab.

### Step 2 — Navigate to the API folder

```
cd apps/api
```

### Step 3 — Start the development server

```
pnpm start:dev
```

This compiles the TypeScript source and starts NestJS with a **file watcher** — any change you save will automatically restart the server.

### Step 4 — Confirm it started successfully

Wait for the following lines to appear (it takes 5–10 seconds on first run):

```
[Nest] LOG  Starting Nest application...
[Nest] LOG  AppModule dependencies initialized
[Nest] LOG  DatabaseModule dependencies initialized
...
[Nest] LOG  Application is running on: http://[::]:3000
```

The API is now live at **http://localhost:3000** and the database schema has been created automatically.

> **Do not close or stop this terminal.** The mobile app communicates with the API in real time over both HTTP and WebSockets. If the API is stopped, the app will show network errors.

### Available API commands

| Command | Description |
|---|---|
| `pnpm start:dev` | Development mode with auto-restart on save |
| `pnpm start` | Start without the file watcher |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start:prod` | Run the compiled production build |

---

## 8. Run the Mobile App

The mobile app is an **Expo** (React Native) project. You run it in a **second terminal tab** while the API terminal is still running.

### Step 1 — Open a second terminal tab

In the same terminal panel, click **`+`** to open another tab. Do **not** interrupt the API tab.

### Step 2 — Navigate to the mobile folder

```
cd apps/mobile
```

### Step 3 — Build and run the app

This project uses **`expo-dev-client`** and contains native modules (PDF viewer, audio compression, worklets, etc.) that **do not work in Expo Go**. You must build and run a native development build instead.

#### Option A — Android (emulator or physical device)

**Prerequisites:** Android Studio installed with at least one virtual device configured, **or** a physical Android device connected via USB with USB debugging enabled.

```
pnpm android
```

This runs `expo run:android` — it compiles the native Android project (inside the `android/` folder), installs the app on your device or emulator, and starts the Metro bundler all in one step.

> The **first build takes several minutes**. Subsequent builds are much faster as Gradle caches most of the work.

> **Physical Android device:** Go to **Settings → About Phone** and tap **Build Number** 7 times to unlock Developer Options. Then enable **USB Debugging** under Developer Options. Connect your phone via USB and accept the debugging prompt. Run `adb devices` in the terminal to confirm it is detected before running `pnpm android`.

> **Android emulator + API connection:** The emulator cannot reach `localhost` on your machine. Update `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to:
> ```
> EXPO_PUBLIC_API_URL=http://10.0.2.2:3000
> ```
> And update `BASE_URL` in the root `.env` to `http://10.0.2.2:3000`. Restart the API after this change.

---

#### Option B — iOS simulator (macOS only)

**Prerequisites:** Xcode installed from the Mac App Store with at least one simulator device available.

```
pnpm ios
```

This runs `expo run:ios` — compiles the native iOS project, installs the app in the simulator, and starts Metro.

---

#### Option C — Metro only (dev build already installed)

If you have already built and installed the dev build on your device in a previous session, you only need to start the Metro bundler:

```
pnpm start
```

Then open the already-installed **LinkLanka** app on your device — it will connect to Metro automatically.

---

### Metro bundler output

Once running, you will see something like:

```
› Metro waiting on exp://192.168.x.x:8081

› Press r │ reload app
› Press m │ toggle the dev menu
› Press j │ open debugger
› Press ? │ show all commands
```

### Useful Metro keyboard shortcuts

| Key | Action |
|---|---|
| `r` | Reload the app |
| `m` | Toggle the developer menu |
| `j` | Open the JS debugger |
| `Ctrl+C` | Stop the Metro server |

---

## 9. Running on a Physical Device

When running the app on a real phone, `localhost` refers to the **phone itself**, not your laptop. You need to point both the API and the mobile app at your machine's **local network IP address**.

### Find your machine's IP address

**Windows:**
1. Open Command Prompt and run:
   ```
   ipconfig
   ```
2. Look for **IPv4 Address** under your active network adapter (Wi-Fi). It will look like `192.168.x.x`.

**macOS:**
1. Open Terminal and run:
   ```
   ipconfig getifaddr en0
   ```
   (Use `en1` if you are on Ethernet.)

---

### Update your `.env` files

Once you have your IP (e.g., `192.168.1.50`), update both files:

**Root `.env`:**
```env
BASE_URL=http://192.168.1.50:3000
```

**`apps/mobile/.env`:**
```env
EXPO_PUBLIC_API_URL=http://192.168.1.50:3000
```

Then **restart the API** (`Ctrl+C` then `pnpm start:dev`) and **restart Expo** (`Ctrl+C` then `pnpm start`) to apply the changes.

> Make sure your phone and your laptop are connected to the **same Wi-Fi network**.

---

## 10. Switching Network Environments

The project includes two helper scripts to quickly swap between the **home network** and the **university network**. These read your environment files and update your `.env` files.

> **Windows users:** Run these inside **Git Bash**, not PowerShell or Command Prompt.

### Switch to the home network preset

```bash
bash use-home.sh
```

This copies `.env.home` into the root `.env` and writes `apps/mobile/.env` for the home API URL.

### Switch to the university network (auto-detects your IP)

```bash
bash use-uni.sh
```

This auto-detects your current local IP address and writes both `.env` files accordingly. Useful when connected via a mobile hotspot at university.

After running either script, **restart the API and Expo** for the changes to take effect.

---

## 11. Troubleshooting

### `pnpm: command not found`
Install pnpm globally: `npm install -g pnpm@10.28.2`

### `docker: command not found`
Make sure Docker Desktop is **installed and running**. Restart your terminal after installing.

### API fails to connect to the database
- Ensure Docker Desktop is running.
- Run `docker compose ps` and confirm the `postgres` container status is `running`.
- Double-check the credentials in your root `.env` match the values in `compose.yaml`.

### `ECONNREFUSED` error on the mobile app
- Confirm the API is running (`pnpm start:dev` in `apps/api`).
- If on a physical device, ensure `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` is set to your machine's **local IP**, not `localhost`.
- Confirm your phone and laptop are on the same Wi-Fi network.
- Check that your firewall is not blocking port **3000**.

### `Cannot find module` or import errors
Run `pnpm install` again from the project root. If the issue persists, delete `node_modules` folders and reinstall:

```
# Windows (PowerShell)
Remove-Item -Recurse -Force node_modules, apps/api/node_modules, apps/mobile/node_modules
pnpm install
```

```bash
# macOS / Git Bash
rm -rf node_modules apps/api/node_modules apps/mobile/node_modules
pnpm install
```

### Port 5433 already in use
Another process is using port 5433. Either stop that process or change the host port in `compose.yaml` (left side of `"5433:5432"`) and update `DB_PORT` in your root `.env` to match.

### Expo QR code not loading on phone
Try pressing `r` in the Expo terminal to reload, or press `s` to switch between Expo Go and development build modes.

---

## Quick Reference

| Task | Command | Directory |
|---|---|---|
| Install all dependencies | `pnpm install` | Project root |
| Start the database | `docker compose up -d` | Project root |
| Stop the database | `docker compose down` | Project root |
| Run the API (dev) | `pnpm start:dev` | `apps/api` |
| Run the mobile app (Android) | `pnpm android` | `apps/mobile` |
| Run the mobile app (iOS) | `pnpm ios` | `apps/mobile` |
| Start Metro only (app already installed) | `pnpm start` | `apps/mobile` |
| Switch to home network | `bash use-home.sh` | Project root |
| Switch to uni network | `bash use-uni.sh` | Project root |
