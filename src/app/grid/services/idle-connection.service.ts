import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subject, Subscription } from 'rxjs';
import { GridWebsocketService } from './grid-websocket.service';

export type IdleState = 'active' | 'idle' | 'hidden';

/**
 * Tracks user activity and window visibility to drive presence status
 * (active / idle / hidden). The WebSocket is NEVER disconnected on idle —
 * desktop notifications depend on it staying alive while the app is
 * backgrounded or minimized, like Slack/Discord. This service instead acts
 * as a reconnect safety net: whenever the user returns (activity or the
 * window becoming visible) and the socket is down, it reconnects.
 */
@Injectable()
export class IdleConnectionService implements OnDestroy {
  private readonly IDLE_TIMEOUT = 5 * 60 * 1000;
  private readonly THROTTLE_DELAY = 100;
  private readonly ACTIVITY_EVENTS = ['mousemove', 'keydown', 'scroll', 'touchstart', 'click'] as const;

  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastActivityTime = Date.now();
  private isUserActive = true;
  private isTabVisible = true;
  private isInitialized = false;
  private throttleTimeout: ReturnType<typeof setTimeout> | null = null;

  private gridWs: GridWebsocketService | null = null;
  private activitySubscription: Subscription | null = null;

  private idleStateSubject = new BehaviorSubject<IdleState>('active');
  public idleState$ = this.idleStateSubject.asObservable();

  private destroyed$ = new Subject<void>();

  private boundActivityHandler: () => void;
  private boundVisibilityHandler: () => void;

  constructor(private ngZone: NgZone) {
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
  }

  getIdleState(): IdleState { return this.idleStateSubject.value; }

  private onActivity(): void {
    if (this.throttleTimeout) return;
    this.throttleTimeout = setTimeout(() => { this.throttleTimeout = null; }, this.THROTTLE_DELAY);
    this.handleActivityDetected();
  }

  private handleActivityDetected(): void {
    this.lastActivityTime = Date.now();
    this.isUserActive = true;
    if (this.isTabVisible) { this.updateIdleState('active'); }
    this.resetIdleTimer();
    this.reconnectIfDown();
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
    // Presence only — the WebSocket stays connected so notifications keep working
    console.log('IdleConnectionService: User idle for 5 minutes, marking presence idle (connection stays alive)');
    this.isUserActive = false;
    this.updateIdleState('idle');
  }

  private handleVisibilityChange(): void {
    const wasVisible = this.isTabVisible;
    this.isTabVisible = !document.hidden;

    console.log('IdleConnectionService: Visibility changed, visible:', this.isTabVisible);

    if (document.hidden) {
      this.clearIdleTimer();
      this.updateIdleState('hidden');
      // Keep WebSocket alive when hidden so DM/channel/mention notifications
      // can still be received and pushed as desktop notifications
    } else if (!wasVisible) {
      this.updateIdleState(this.isUserActive ? 'active' : 'idle');
      this.resetIdleTimer();
      // Safety net: if the socket died while we were hidden (network blip,
      // sleep, server restart), reconnect immediately instead of waiting out
      // the current backoff delay
      this.reconnectIfDown(true);
    }
  }

  /**
   * Reconnect the WebSocket if it's down. With `immediate`, an in-progress
   * backoff wait is cut short via forceReconnect; otherwise only a fully
   * disconnected socket is revived (so we don't stomp an in-flight attempt
   * on every mouse move).
   */
  private reconnectIfDown(immediate = false): void {
    if (!this.gridWs) return;
    const state = this.gridWs.getConnectionState();
    if (state === 'connected' || state === 'connecting') return;

    if (state === 'disconnected' || (immediate && state === 'reconnecting')) {
      console.log('IdleConnectionService: Socket down on user return, reconnecting...');
      this.ngZone.run(() => { this.gridWs!.forceReconnect(); });
    }
  }

  private updateIdleState(state: IdleState): void {
    if (this.idleStateSubject.value !== state) {
      this.ngZone.run(() => { this.idleStateSubject.next(state); });
    }
  }
}
