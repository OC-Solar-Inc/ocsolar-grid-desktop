interface ElectronAPI {
  showNotification: (title: string, body: string) => void;
  setBadgeCount: (count: number) => void;
  platform: string;
}

interface Window {
  electronAPI?: ElectronAPI;
}
