import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subject, Subscription } from 'rxjs';
import { GridWebsocketService } from './grid-websocket.service';
import { GridNotificationService } from './grid-notification.service';

export type IdleState = 'active' | 'idle' | 'hidden';

@Injectable()
export class IdleConnectionService implements OnDestroy {
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000;
  private readonly THROTTLE_DELAY = 100;
  private readonly ACTIVITY_EVENTS = ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'] as const;

  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastActivityTime = Date.now();
  private isUserActive = true;
  private isTabVisible = true;
  private wasDisconnectedDueToIdle = false;
  private isInitialized = false;
  private throttleTimeout: ReturnType<typeof setTimeout> | null = null;

  private gridWs: GridWebsocketService | null = null;
  private activitySubscription: Subscription | null = null;

  private idleStateSubject = new BehaviorSubject<IdleState>('active');
  public idleState$ = this.idleStateSubject.asObservable();

  private destroyed$ = new Subject<void>();

  private boundActivityHandler: () => void;
  private boundVisibilityHandler: () => void;

  constructor(private ngZone: NgZone, private gridNotification: GridNotificationService) {
    this.boundActivityHandler = this.onActivity.bind(this);
    this.boundVisibilityHandler = this.handleVisibilityChange.bind(this);
  }

  ngOnDestroy(): void { this.destroy(); }

  initialize(gridWs: GridWebsocketService): void {
    if (this.isInitialized) { console.log('IdleConnectionService: Already initialized'); return; }

    this.gridWs = gridWs;
    this.isInitialized = true;
    this.isTabVisible = !document.hidden;
    this.isUserActive = true;
    this.wasDisconnectedDueToIdle = false;

    console.log('IdleConnectionService: Initializing, tab visible:', this.isTabVisible);

    this.activitySubscription = this.gridWs.activity$.subscribe(() => { this.resetIdleTimerFromMessage(); });

    this.ngZone.runOutsideAngular(() => {
      this.ACTIVITY_EVENTS.forEach((event) => {
        document.addEventListener(event, this.boundActivityHandler, { passive: true });
      });
      document.addEventListener('visibilitychange', this.boundVisibilityHandler);
    });

    this.resetIdleTimer();
    if (document.hidden) { this.handleVisibilityChange(); }
  }

  destroy(): void {
    if (!this.isInitialized) return;
    console.log('IdleConnectionService: Destroying');
    this.clearIdleTimer();
    if (this.throttleTimeout) { clearTimeout(this.throttleTimeout); this.throttleTimeout = null; }
    this.ACTIVITY_EVENTS.forEach((event) => { document.removeEventListener(event, this.boundActivityHandler); });
    document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
    if (this.activitySubscription) { this.activitySubscription.unsubscribe(); this.activitySubscription = null; }
    this.destroyed$.next();
    this.destroyed$.complete();
    this.gridWs = null;
    this.isInitialized = false;
    this.wasDisconnectedDueToIdle = false;
  }

  getIdleState(): IdleState { return this.idleStateSubject.value; }
  isDisconnectedDueToIdle(): boolean { return this.wasDisconnectedDueToIdle; }

  private onActivity(): void {
    if (this.throttleTimeout) return;
    this.throttleTimeout = setTimeout(() => { this.throttleTimeout = null; }, this.THROTTLE_DELAY);
    this.handleActivityDetected();
  }

  private handleActivityDetected(): void {
    this.lastActivityTime = Date.now();
    this.isUserActive = true;
    this.resetIdleTimer();
    if (this.wasDisconnectedDueToIdle && this.isTabVisible) {
      console.log('IdleConnectionService: User activity detected, reconnecting...');
      this.reconnect();
    }
  }

  private resetIdleTimerFromMessage(): void {
    if (this.isTabVisible) { this.lastActivityTime = Date.now(); this.resetIdleTimer(); }
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    if (!this.isTabVisible) return;
    this.idleTimer = setTimeout(() => { this.handleIdleTimeout(); }, this.IDLE_TIMEOUT);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
  }

  private handleIdleTimeout(): void {
    if (!this.gridWs) return;
    console.log('IdleConnectionService: User idle for 5 minutes, disconnecting...');
    this.isUserActive = false;
    this.updateIdleState('idle');
    this.disconnectForIdle('User idle timeout');
  }

  private handleVisibilityChange(): void {
    const wasVisible = this.isTabVisible;
    this.isTabVisible = !document.hidden;

    console.log('IdleConnectionService: Visibility changed, visible:', this.isTabVisible);

    if (document.hidden) {
      this.clearIdleTimer();
      this.updateIdleState('hidden');
      if (!this.gridNotification.isEnabled()) {
        this.disconnectForIdle('Tab hidden');
      } else {
        console.log('IdleConnectionService: Tab hidden but notifications enabled, keeping connection alive');
      }
    } else if (!wasVisible) {
      this.updateIdleState(this.isUserActive ? 'active' : 'idle');
      if (this.wasDisconnectedDueToIdle) {
        console.log('IdleConnectionService: Tab visible again, reconnecting...');
        this.reconnect();
      }
      this.resetIdleTimer();
    }
  }

  private disconnectForIdle(reason: string): void {
    if (!this.gridWs) return;
    if (!this.gridWs.isConnected()) { this.wasDisconnectedDueToIdle = true; return; }
    console.log('IdleConnectionService: Disconnecting for idle:', reason);
    this.wasDisconnectedDueToIdle = true;
    this.gridWs.disconnectForIdle(reason);
  }

  private reconnect(): void {
    if (!this.gridWs) return;
    if (!this.isTabVisible) { console.log('IdleConnectionService: Tab hidden, skipping reconnect'); return; }
    if (this.gridWs.isConnected()) { this.wasDisconnectedDueToIdle = false; this.updateIdleState('active'); return; }
    console.log('IdleConnectionService: Reconnecting...');
    this.wasDisconnectedDueToIdle = false;
    this.updateIdleState('active');
    this.ngZone.run(() => { this.gridWs!.connect(); });
  }

  private updateIdleState(state: IdleState): void {
    if (this.idleStateSubject.value !== state) {
      this.ngZone.run(() => { this.idleStateSubject.next(state); });
    }
  }
}
