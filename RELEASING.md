# Releasing OC Solar Grid Desktop

## How to release a new version

### 1. Make your changes and commit them

```bash
git add -A
git commit -m "Description of changes"
git push
```

### 2. Bump the version in package.json

Update the `version` field in `package.json` (e.g., `"1.0.0"` → `"1.0.1"`).

```bash
git add package.json
git commit -m "Bump version to 1.0.1"
git push
```

### 3. Create and push a tag

```bash
git tag v1.0.1
git push origin v1.0.1
```

This triggers the GitHub Actions workflow which:
- Builds the Mac `.dmg` (both Apple Silicon and Intel)
- Builds the Windows `.exe` installer
- Creates a GitHub Release with all installers attached

### 4. Done

The release will appear at:
https://github.com/OC-Solar-Inc/ocsolar-grid-desktop/releases

Download links will be:
- **Mac (Apple Silicon)**: `OC Solar Grid-{version}-arm64.dmg`
- **Mac (Intel)**: `OC Solar Grid-{version}.dmg`
- **Windows**: `OC Solar Grid Setup {version}.exe`

---

## Making changes to the Grid itself

If you need to change Grid functionality (not just the desktop shell):

### 1. Edit the shared library

```bash
cd /path/to/ocsolar-grid-lib
# Make changes in projects/grid/src/
```

### 2. Build the library

```bash
ng build grid
```

### 3. Commit and push (including dist/)

```bash
git add -A
git commit -m "Description of grid changes"
git push
```

### 4. Update the desktop app to pick up changes

```bash
cd /path/to/ocsolar-grid-desktop
npm update @ocsolar/grid
git add package.json package-lock.json
git commit -m "Update @ocsolar/grid"
git push
```

### 5. Release (follow steps above)

---

## Local development

### Run the desktop app locally

```bash
npm run electron:dev
```

This starts Angular on port 4201 and opens Electron pointing to it.

### Build locally without releasing

```bash
npm run electron:build:mac    # Mac .dmg
npm run electron:build:win    # Windows .exe (must be on Windows)
```

Output goes to `release/` folder.

---

## Architecture

```
@ocsolar/grid (shared library - ocsolar-grid-lib repo)
  └── All Grid components, services, interfaces

ocsolar-grid-desktop (this repo)
  ├── src/           Angular app (login + grid shell)
  ├── electron/      Electron main process (window, tray)
  └── build/         App icons, entitlements

ocsolar-portal (portal repo)
  └── Also imports @ocsolar/grid
```

Changes to Grid components/services go in `ocsolar-grid-lib`.
Changes to the desktop shell/login go in this repo.
Both apps share the same Grid library.

---

## Notarization (TODO)

Mac notarization is currently disabled. To enable:

1. Fix Apple credentials (401 issue with notarytool)
2. In `electron-builder.yml`, uncomment `notarize: true`
3. In `.github/workflows/build-release.yml`, uncomment the Apple env vars
4. Add these secrets to the GitHub repo settings:
   - `APPLE_ID` — Apple Developer account email
   - `APPLE_APP_SPECIFIC_PASSWORD` — from appleid.apple.com
   - `APPLE_TEAM_ID` — `U74676J6B6`

Without notarization, users right-click > Open the first time to bypass Gatekeeper.
