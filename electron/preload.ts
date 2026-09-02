import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Badge count for unread messages
  setBadgeCount: (count: number) => ipcRenderer.send('set-badge-count', count),

  // Native notifications
  showNotification: (title: string, body: string) =>
    ipcRenderer.send('show-notification', { title, body }),

  // System power state (sleep/wake/lock/unlock)
  onPowerStateChange: (callback: (state: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: string) => callback(state);
    ipcRenderer.on('system-power-state', listener);
    return () => ipcRenderer.removeListener('system-power-state', listener);
  },

  // App version (from package.json via app.getVersion())
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),

  // Manual "Check for Updates…" — main shows the result in a native dialog
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke('check-for-updates'),

  // Platform info
  platform: process.platform,
});
