import { app, BrowserWindow, Tray, Menu, nativeImage, shell, ipcMain, Notification, dialog, powerMonitor } from 'electron';
import { autoUpdater } from 'electron-updater';
import * as path from 'path';
import { startLocalDriverServer } from './local-driver-server';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const isDev = !app.isPackaged;

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

function setupAutoUpdater(): void {
  if (isDev) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-downloaded', (info) => {
    dialog.showMessageBox(mainWindow!, {
      type: 'info',
      title: 'Update Ready',
      message: `Version ${info.version} has been downloaded.`,
      detail: 'The update will be installed when you restart the app.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
    }).then((result) => {
      if (result.response === 0) {
        isQuitting = true;
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.checkForUpdatesAndNotify();
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
    startLocalDriverServer({
      appVersion: app.getVersion(),
      playwrightBrowsersPath,
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
