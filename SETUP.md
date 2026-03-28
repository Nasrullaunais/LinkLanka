# LinkLanka Setup

Follow these simple steps to get LinkLanka running locally without any hassle. The backend runs entirely in Docker, which means all development environment variables are pre-configured for you out of the box.

---

## 1. Prerequisites

Make sure you have installed:
- [Node.js 22 LTS](https://nodejs.org/) & **pnpm** (`npm install -g pnpm@10.28.2`)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Must be running before starting)
- Android Studio / Xcode (If running the native mobile build)

---

## 2. Start the Backend

Open a terminal at the root of the project and run:

```bash
docker compose up --build -d
```

This will automatically start PostgreSQL and the NestJS API. 
> 📍 The API is now live at **http://localhost:3000**.
> ♻️ **Hot Reload:** If you edit any code in `apps/api`, the container will automatically reload. You do not need to run `pnpm start:dev` locally!

---

## 3. Install & Configure the Mobile App

Install the app dependencies from the root directory:

```bash
pnpm install
```

### Configure Environment

Create an `.env` file inside `apps/mobile/` and paste the following:
```env
# If using an Android Emulator: use http://10.0.2.2:3000
# If using a physical phone: use your machine's local IP (e.g. http://192.168.1.50:3000)
# If using iOS simulator: use http://localhost:3000
EXPO_PUBLIC_API_URL=http://localhost:3000
```

### Firebase Credentials

Ask the lead developer for the `google-services.json` file. You must copy it to both of these locations before building:
1. `apps/mobile/google-services.json`
2. `apps/mobile/android/app/google-services.json`

---

## 4. Run the Mobile App

Navigate into the mobile folder and launch the app:

```bash
cd apps/mobile
pnpm android   # For Android
# pnpm ios     # For iOS Simulator
```

*The first build will take a few minutes as it compiles native Android/iOS code.*
