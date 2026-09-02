interface ElectronAPI {
  showNotification: (title: string, body: string) => void;
  setBadgeCount: (count: number) => void;
  onPowerStateChange: (callback: (state: string) => void) => () => void;
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<void>;
  platform: string;
}

interface Window {
  electronAPI?: ElectronAPI;
}
