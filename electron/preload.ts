import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Badge count for unread messages
  setBadgeCount: (count: number) => ipcRenderer.send('set-badge-count', count),

  // Native notifications
  showNotification: (title: string, body: string) =>
    ipcRenderer.send('show-notification', { title, body }),

  // Platform info
  platform: process.platform,
});
