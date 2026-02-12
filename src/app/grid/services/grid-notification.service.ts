import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

const ENABLED_KEY = 'gridNotificationsEnabled';
const DISMISSED_KEY = 'gridNotificationsDismissed';
const PREFERENCES_KEY = 'gridNotificationPreferences';

export type NotificationType = 'dm' | 'channel' | 'mention';

export interface NotificationPreferences {
  dm: boolean;
  channel: boolean;
  mention: boolean;
}

const DEFAULT_PREFERENCES: NotificationPreferences = {
  dm: true,
  channel: true,
  mention: true,
};

@Injectable()
export class GridNotificationService {
  private enabledSubject = new BehaviorSubject<boolean>(false);
  private bannerVisibleSubject = new BehaviorSubject<boolean>(false);
  private preferencesSubject = new BehaviorSubject<NotificationPreferences>(DEFAULT_PREFERENCES);
  private currentChannelId: string | null = null;
  private isElectron = !!(window as any).electronAPI;

  public enabled$: Observable<boolean> = this.enabledSubject.asObservable();
  public bannerVisible$: Observable<boolean> = this.bannerVisibleSubject.asObservable();
  public preferences$: Observable<NotificationPreferences> = this.preferencesSubject.asObservable();

  constructor() {
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    const enabled = localStorage.getItem(ENABLED_KEY) === 'true';
    const dismissed = localStorage.getItem(DISMISSED_KEY) === 'true';

    this.enabledSubject.next(enabled);

    // Load per-type preferences
    const saved = localStorage.getItem(PREFERENCES_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        this.preferencesSubject.next({ ...DEFAULT_PREFERENCES, ...parsed });
      } catch {
        this.preferencesSubject.next(DEFAULT_PREFERENCES);
      }
    }

    // Show banner if notifications aren't enabled and user hasn't dismissed it
    const notificationsSupported = this.isElectron || ('Notification' in window);
    this.bannerVisibleSubject.next(
      notificationsSupported && !enabled && !dismissed
    );
  }

  /**
   * Request browser notification permission and enable notifications if granted.
   */
  async requestPermission(): Promise<boolean> {
    // In Electron, native notifications are handled by the main process via IPC.
    // OS-level permission is managed by macOS System Settings, so we just enable.
    if (this.isElectron) {
      this.enabledSubject.next(true);
      localStorage.setItem(ENABLED_KEY, 'true');
      this.bannerVisibleSubject.next(false);
      localStorage.setItem(DISMISSED_KEY, 'true');
      return true;
    }

    if (!('Notification' in window)) {
      console.warn('Grid Notifications: Browser does not support notifications');
      return false;
    }

    const permission = await Notification.requestPermission();
    const granted = permission === 'granted';

    this.enabledSubject.next(granted);
    localStorage.setItem(ENABLED_KEY, String(granted));

    // Hide banner regardless of outcome (user interacted)
    this.bannerVisibleSubject.next(false);
    localStorage.setItem(DISMISSED_KEY, 'true');

    return granted;
  }

  /**
   * Check if notifications are currently enabled (synchronous).
   */
  isEnabled(): boolean {
    return this.enabledSubject.value;
  }

  /**
   * Disable desktop notifications.
   */
  disable(): void {
    this.enabledSubject.next(false);
    localStorage.setItem(ENABLED_KEY, 'false');
  }

  /**
   * Dismiss the notification permission banner permanently.
   */
  dismissBanner(): void {
    this.bannerVisibleSubject.next(false);
    localStorage.setItem(DISMISSED_KEY, 'true');
  }

  /**
   * Update a single notification type preference.
   */
  setPreference(type: NotificationType, value: boolean): void {
    const current = this.preferencesSubject.value;
    const updated = { ...current, [type]: value };
    this.preferencesSubject.next(updated);
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(updated));
  }

  /**
   * Track which channel the user is currently viewing so we can suppress
   * notifications for that channel only (instead of blocking all notifications
   * when the app window is visible).
   */
  setCurrentChannel(channelId: string | null): void {
    this.currentChannelId = channelId;
  }

  /**
   * Show a desktop notification if enabled, the type is allowed, and the user
   * is not currently viewing the notification's channel.
   *
   * In Electron, uses native notifications via IPC for reliable macOS integration.
   * Falls back to the browser Notification API otherwise.
   */
  showNotification(title: string, body: string, type: NotificationType, channelId?: string): void {
    const truncatedBody = body.length > 100 ? body.substring(0, 100) + '...' : body;

    console.log('Grid Notifications: showNotification called', {
      title,
      type,
      enabled: this.enabledSubject.value,
      typeAllowed: this.preferencesSubject.value[type],
      currentChannel: this.currentChannelId,
      notificationChannel: channelId,
      documentHidden: document.hidden,
      isElectron: this.isElectron,
    });

    if (!this.enabledSubject.value) { console.log('Grid Notifications: BLOCKED — not enabled'); return; }
    if (!this.preferencesSubject.value[type]) { console.log('Grid Notifications: BLOCKED — type disabled:', type); return; }

    // Only suppress if the user is actively viewing this exact channel AND the window is focused
    if (channelId && channelId === this.currentChannelId && !document.hidden) {
      console.log('Grid Notifications: BLOCKED — user is viewing this channel');
      return;
    }

    // Use native Electron notifications when available
    if (this.isElectron) {
      console.log('Grid Notifications: SENDING via Electron native notification');
      window.electronAPI!.showNotification(title, truncatedBody);
      return;
    }

    // Fallback to browser Notification API (for web builds)
    if (!('Notification' in window)) { console.log('Grid Notifications: BLOCKED — API not supported'); return; }
    if (Notification.permission !== 'granted') { console.log('Grid Notifications: BLOCKED — permission:', Notification.permission); return; }

    console.log('Grid Notifications: SENDING via browser Notification API');
    const notification = new Notification(title, {
      body: truncatedBody,
      icon: 'assets/images/Grid_Black.png',
      tag: channelId || 'grid-notification',
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }
}
