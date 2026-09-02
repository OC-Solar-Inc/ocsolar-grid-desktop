import { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, Notification, dialog, powerMonitor } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import * as fs from 'fs';
import { startLocalDriverServer } from './local-driver-server';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const isDev = !app.isPackaged;

// Windows requires the AppUserModelID to match the installer shortcut's appId,
// otherwise new Notification().show() silently does nothing in packaged builds.
app.setAppUserModelId('com.ocsolar.grid');

if (isDev) {
  // Keep dev state separate from the installed production app so both can run side-by-side
  app.setPath('userData', path.join(app.getPath('appData'), 'ocsolar-grid-desktop-dev'));
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 12, y: 10 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // Disable CORS for API calls to ocsolarprocess.com
      // Keep timers running at full speed while hidden/minimized so the
      // WebSocket heartbeat and reconnect backoff aren't throttled —
      // notifications depend on the socket staying alive in the background
      backgroundThrottling: false,
    },
    icon: path.join(__dirname, '..', 'src', 'assets', 'icons', 'icon.png'),
    show: false,
  });

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:4201');
    // Open DevTools in dev mode
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'ocsolar-grid-desktop', 'index.html'));
  }

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      if (mainWindow?.isFullScreen()) {
        // Exit fullscreen first — hiding during the fullscreen animation
        // causes a black screen on macOS. Wait for the transition to finish.
        mainWindow.once('leave-full-screen', () => {
          mainWindow?.hide();
        });
        mainWindow.setFullScreen(false);
      } else {
        mainWindow?.hide();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open external links in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function createTray(): void {
  const iconPath = isDev
    ? path.join(__dirname, '..', 'src', 'assets', 'icons', 'tray-icon.png')
    : path.join(__dirname, '..', 'dist', 'ocsolar-grid-desktop', 'assets', 'icons', 'tray-icon.png');

  // Create a small default icon if none exists
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      trayIcon = nativeImage.createEmpty();
    }
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  // Resize for tray (16x16 on macOS)
  if (!trayIcon.isEmpty()) {
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('OC Solar Grid');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Grid',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    }
  });
}

// ---- Auto-update ----
//
// Windows users almost never quit: the close button hides to the tray, so a
// single check at launch (the previous behaviour) could go weeks without
// running again, and a dialog parented to a hidden window is invisible on
// Windows.  We re-check on an interval, keep the dialog visible whether or
// not the window is showing, log every updater event, and expose a manual
// "Check for Updates…" from the renderer.
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 hours
let updateCheckTimer: NodeJS.Timeout | null = null;
let manualCheckInFlight = false;

function dialogParent(): BrowserWindow | undefined {
  return mainWindow && mainWindow.isVisible() ? mainWindow : undefined;
}

function showUpdateDialog(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  const parent = dialogParent();
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}

function setupAutoUpdater(): void {
  if (isDev) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;

  autoUpdater.on('checking-for-update', () => console.log('[updater] checking for update'));
  autoUpdater.on('update-available', (info) => console.log('[updater] update available:', info.version));
  autoUpdater.on('update-not-available', (info) => console.log('[updater] up to date:', info.version));
  autoUpdater.on('error', (err) => console.error('[updater] error:', err?.message || err));

  autoUpdater.on('update-downloaded', (info) => {
    showUpdateDialog({
      type: 'info',
      title: 'Update Ready',
      message: `Version ${info.version} has been downloaded.`,
      detail: `You are on ${app.getVersion()}. The update will be installed when you restart the app.`,
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    }).then((result) => {
      if (result.response === 0) {
        isQuitting = true;
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('[updater] initial check failed:', err?.message || err);
  });

  updateCheckTimer = setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error('[updater] periodic check failed:', err?.message || err);
    });
  }, UPDATE_CHECK_INTERVAL_MS);
}

/**
 * User-initiated check from the account menu. Unlike the background check,
 * this always reports back: up to date, downloading, or the error.
 */
async function checkForUpdatesManually(): Promise<void> {
  const current = app.getVersion();
  if (isDev) {
    await showUpdateDialog({ type: 'info', title: 'Check for Updates', message: `Version ${current} (development build)`, detail: 'Auto-update is disabled in development.' });
    return;
  }
  if (manualCheckInFlight) return;
  manualCheckInFlight = true;
  try {
    const result = await autoUpdater.checkForUpdates();
    const latest = result?.updateInfo?.version;
    if (latest && latest !== current) {
      await showUpdateDialog({
        type: 'info',
        title: 'Update Available',
        message: `Version ${latest} is available.`,
        detail: `You are on ${current}. It is downloading now and you will be prompted to restart when it is ready.`,
      });
    } else {
      await showUpdateDialog({
        type: 'info',
        title: 'Up to Date',
        message: `You are on the latest version (${current}).`,
      });
    }
  } catch (err) {
    console.error('[updater] manual check failed:', (err as Error)?.message || err);
    await showUpdateDialog({
      type: 'error',
      title: 'Update Check Failed',
      message: `Could not check for updates. You are on ${current}.`,
      detail: (err as Error)?.message || String(err),
    });
  } finally {
    manualCheckInFlight = false;
  }
}

// Single instance lock (skipped in dev so a dev build can run alongside the installed production app)
const gotTheLock = isDev ? true : app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    createTray();
    setupAutoUpdater();

    // Boot the SCE submission helper HTTP listener on localhost:9999.
    // The OCSolar Portal's SCE submission panel POSTs payloads here
    // to drive PowerClerk via Playwright in this user's local
    // Chromium.  Bind failure is non-fatal — the rest of the app
    // (chat, notifications) still works; the user just can't submit
    // SCE applications until the next launch frees the port.
    // In a packaged build, Chromium lives at
    //   <app>/Contents/Resources/app.asar.unpacked/node_modules/playwright-core/.local-browsers
    // — the unpacked sibling of app.asar.  Playwright's own resolver
    // does NOT follow the asar fork, so we explicitly point at the
    // unpacked path via PLAYWRIGHT_BROWSERS_PATH inside the driver
    // subprocess.  In dev, the install lives in node_modules under
    // the repo root and the default resolver finds it.
    const playwrightBrowsersPath = app.isPackaged
      ? path.join(
          process.resourcesPath,
          'app.asar.unpacked',
          'node_modules',
          'playwright-core',
          '.local-browsers',
        )
      : undefined;
    // PowerClerk auth cache lives in userData/ so it survives
    // auto-updates and stays writable.  The driver passes
    // `--auth-state <this path>` and Playwright reads/writes
    // session state there.  Falls under <userData>/sce/.
    const authStatePath = path.join(
      app.getPath('userData'),
      'sce',
      'powerclerk-auth.json',
    );
    try {
      fs.mkdirSync(path.dirname(authStatePath), { recursive: true });
    } catch (err) {
      console.warn('[main] failed to create sce userData dir:', (err as Error)?.message);
    }
    startLocalDriverServer({
      appVersion: app.getVersion(),
      playwrightBrowsersPath,
      authStatePath,
    }).catch((err) => {
      console.error('[main] local-driver-server failed to start:', err?.message);
    });

    // Native notification handler
    ipcMain.on('show-notification', (_event, { title, body }: { title: string; body: string }) => {
      const notification = new Notification({ title, body });
      notification.on('click', () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      });
      notification.show();
    });

    // Badge count handler (macOS dock badge)
    ipcMain.on('set-badge-count', (_event, count: number) => {
      app.setBadgeCount(count);
    });

    // App version + manual update check (account menu in the renderer)
    ipcMain.handle('get-app-version', () => app.getVersion());
    ipcMain.handle('check-for-updates', () => checkForUpdatesManually());

    // Power state monitoring — notify renderer on sleep/wake
    powerMonitor.on('suspend', () => {
      console.log('System suspended');
      mainWindow?.webContents.send('system-power-state', 'suspend');
    });

    powerMonitor.on('resume', () => {
      console.log('System resumed');
      mainWindow?.webContents.send('system-power-state', 'resume');
    });

    powerMonitor.on('lock-screen', () => {
      console.log('Screen locked');
      mainWindow?.webContents.send('system-power-state', 'lock');
    });

    powerMonitor.on('unlock-screen', () => {
      console.log('Screen unlocked');
      mainWindow?.webContents.send('system-power-state', 'unlock');
    });
  });
}

app.on('before-quit', () => {
  isQuitting = true;
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  } else {
    createWindow();
  }
});
