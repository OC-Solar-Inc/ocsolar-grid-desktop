# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
# Angular dev server (browser only, port 4200)
ng serve

# Full Electron dev mode (Angular on 4201 + Electron window)
npm run electron:dev

# Production build (Angular + Electron)
npm run electron:build

# Build platform installers
npm run electron:build:mac    # DMG (arm64 + x64)
npm run electron:build:win    # NSIS exe (x64)

# Lint (ESLint with Angular rules, 0 errors expected, warnings OK)
npm run lint

# Tests
npm run test          # Karma with Chrome (interactive)
npm run test:ci       # Headless, single-run, coverage
# Single test file: ng test --include=src/app/grid/services/grid-mention.service.spec.ts

# CHROME_BIN must be set if Chrome is not at the default path:
CHROME_BIN=$(node -e "console.log(require('puppeteer').executablePath())") npm run test:ci

# Install dependencies (legacy-peer-deps required for Angular Fire peer dep conflicts)
npm ci --legacy-peer-deps
```

## Architecture

**Electron 40 + Angular 16 desktop chat app** ("The Grid") for OC Solar internal messaging. Uses Angular Material for UI, AngularFire (compat) for Firebase, and RxJS BehaviorSubjects for state (no NgRx).

### App Shell vs Grid Library

The app has two layers:

1. **App shell** (`src/app/components/`, `src/app/services/`, `src/app/guards/`) — Login, auth guard, routing, Electron title bar. Minimal code.
2. **Grid library** (`src/app/grid/`) — The entire chat system: channels, messages, threads, mentions, file uploads, presence, themes. This is the bulk of the codebase and is designed to be reusable across apps.

The Grid library is consumed via `GridModule.forRoot()` in `app.module.ts`, which injects configuration and auth/data providers through `InjectionToken`s defined in `grid/tokens/grid-tokens.ts`.

### Adapter Pattern

The Grid library doesn't know about Firebase or the desktop app. It depends on interfaces:
- **`GridAuthProvider`** → `DesktopAuthAdapter` (Firebase Auth → ID token + user doc ID)
- **`GridUserDataProvider`** → `DesktopUserDataAdapter` (Firestore users collection)
- **`GridConfig`** → API URLs, WebSocket URL, GIPHY key

### Real-Time Stack

- **`GridWebsocketService`** — persistent WebSocket for messages, typing indicators, presence, notifications. Broadcasts events via RxJS Subjects (`newMessage$`, `messageEdited$`, etc.)
- **`UserPresenceService`** — Firestore `snapshotChanges()` on `user_presence` collection (mirrors Flutter app)
- **`GridApiService`** — REST API for channel/message CRUD, includes a client-side search index

### Routing

Two routes with hash routing (`useHash: true` for Electron `file://` protocol): `/login` and `/` (grid-shell, protected by auth guard).

### Authentication Flow

Login → Firebase email/password → lookup user doc by `sUID` in Firestore `users` → store doc ID in `localStorage` → `authGuard` checks both Firebase auth state and localStorage doc ID.

### Electron Main Process

`electron/main.ts` — separate TypeScript config (CommonJS, ES2020). Preload script (`electron/preload.ts`) exposes IPC via `contextBridge.exposeInMainWorld('electronAPI', ...)`. Types declared in `src/electron.d.ts`.

### SCE PowerClerk submission helper

The desktop app embeds the SCE submission driver — the OCSolar Portal's SCE panel POSTs payloads to `http://localhost:9999/run` and this app drives PowerClerk on the user's own Chromium via Playwright.  Architecture history lives in the portal's `src/documentation/SCE_APPLICATION_SUBMISSION_SYSTEM.md`; the relevant bits in this repo:

- **`electron/local-driver-server.ts`** — HTTP listener booted from `app.whenReady`. `POST /run` accepts a `PtoSubmissionPayload`, writes it to a temp file, spawns the driver via `process.execPath + ELECTRON_RUN_AS_NODE=1` (so no system Node is required on the user's machine), returns a `jobId`. `GET /events/:jobId` is a Server-Sent Events stream of parsed driver stderr lines. CORS restricted to localhost + `ocsolarprocess.com`. `cwd` for the spawn is `os.tmpdir()` — must be a real fs path; `app.asar` is virtual and the OS can't chdir into it.

- **`electron/sce-driver/`** — the actual Playwright driver: `powerclerk-submit-driver.ts`, `-field-map.ts`, `-apply-field.ts`, `-materialize-files.ts`, `-cec-overrides.ts`, `payload-types.ts`. Canonical source for the driver (the portal repo's copies were deleted on 2026-05-22). Compiled by the Electron tsc step into `dist-electron/sce-driver/*.js`.

- **`electron/sce-driver/credentials.ts`** — gitignored. PowerClerk login. A `credentials.example.ts` template ships in git. CI base64-decodes the `POWERCLERK_CREDENTIALS_TS` repository secret into this path before `electron-builder` runs (see the "Write SCE PowerClerk credentials" step in `.github/workflows/build-release.yml`).

- **Bundled Chromium.** `postinstall` runs `cross-env PLAYWRIGHT_BROWSERS_PATH=0 playwright install chromium` so the browser lives at `node_modules/playwright-core/.local-browsers/chromium-<v>/`. `electron-builder.yml` includes the playwright trees in `files:` and `asarUnpack:` (binaries can't exec from inside `app.asar`). Main passes `PLAYWRIGHT_BROWSERS_PATH=<resourcesPath>/app.asar.unpacked/node_modules/playwright-core/.local-browsers` to the driver subprocess so Playwright finds the bundled browser without a system install.

- **Auth state.** Playwright session cache lives at `<userData>/sce/powerclerk-auth.json` (e.g. `~/Library/Application Support/OC Solar Grid/sce/` on macOS). Main creates the parent dir on launch and forwards the path via `--auth-state` to the driver. Lives outside the .app bundle so it survives auto-updates.

- **Generated PDFs** (wizard-8 Form 14-957) save to `~/Downloads/wizard-8-<ts>-<original>.pdf`.

## Key Conventions

- **`ChangeDetectionStrategy.OnPush`** throughout Grid components — always call `cdr.markForCheck()` after async updates
- **RxJS cleanup**: Components use `destroy$` Subject with `takeUntil()`, completed in `ngOnDestroy`
- **Component selectors**: `app-` for app shell, `lib-` for Grid library components
- **Standalone components**: Grid components are standalone with imports declared in `@Component`; app shell components are module-based
- **Environment files** (`src/environments/`) are gitignored; injected via base64 GitHub Secrets in CI
- **`populateDmUsers()`** hardcodes `is_online: false` — don't rely on it for presence state
- **Code style**: 2-space indent, single quotes, no Prettier (ESLint only). `no-explicit-any: warn`, `no-console: warn` (allow warn/error)

## CI/CD

- **`ci.yml`** — Runs on PRs to main: lint → build → test. Uses puppeteer Chrome. Node 22.
- **`build-release.yml`** — Triggers on `v*` tags: builds Mac DMG + Windows EXE, creates GitHub Release.
- Both workflows inject environment files from `ENVIRONMENT_TS` / `ENVIRONMENT_PROD_TS` secrets (base64 encoded).

## Electron Notes

- Single-instance lock; second launches focus existing window
- macOS: `titleBarStyle: 'hiddenInset'` with custom traffic light position
- macOS fullscreen bug: must exit fullscreen before hiding window (listens for `leave-full-screen`)
- Minimize to tray on close (Windows/Linux), hide to dock (macOS)
- External links open in system browser via `shell.openExternal`

## Related Codebases

- **Browser version**: `ocsolar-portal/.../src/app/components/grid/` (same Grid library, different shell)
- **Mobile**: Flutter app (reference for feature parity, especially presence)
