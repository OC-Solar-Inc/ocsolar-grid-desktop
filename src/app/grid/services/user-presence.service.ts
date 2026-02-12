import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { serverTimestamp } from '@angular/fire/firestore';
import { Observable, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';
import { GridWebsocketService } from './grid-websocket.service';
import { IdleConnectionService, IdleState } from './idle-connection.service';

@Injectable()
export class UserPresenceService implements OnDestroy {
  private userDocId: string | null = null;
  private currentStatus: string | null = null;
  private idleSub: Subscription | null = null;
  private wsSub: Subscription | null = null;
  private boundBeforeUnload: () => void;
  private isInitialized = false;

  constructor(
    private afs: AngularFirestore,
    private idleConnection: IdleConnectionService,
    private ngZone: NgZone,
  ) {
    this.boundBeforeUnload = this.onBeforeUnload.bind(this);
  }

  ngOnDestroy(): void { this.destroy(); }

  initialize(userDocId: string, gridWs: GridWebsocketService): void {
    if (this.isInitialized) return;
    this.userDocId = userDocId;
    this.isInitialized = true;
    console.log('UserPresence: Initializing for', userDocId);
    this.setStatus('active');

    this.wsSub = gridWs.connectionState$.subscribe((state) => {
      if (state === 'connected') { this.setStatus('active'); }
    });

    this.idleSub = this.idleConnection.idleState$.subscribe((state: IdleState) => {
      switch (state) {
        case 'active': this.setStatus('active'); break;
        case 'idle':
        case 'hidden': this.setStatus('background'); break;
      }
    });

    this.ngZone.runOutsideAngular(() => {
      window.addEventListener('beforeunload', this.boundBeforeUnload);
    });
  }

  destroy(): void {
    if (!this.isInitialized) return;
    console.log('UserPresence: Destroying, writing offline');
    this.setStatus('offline');
    window.removeEventListener('beforeunload', this.boundBeforeUnload);
    if (this.idleSub) { this.idleSub.unsubscribe(); this.idleSub = null; }
    if (this.wsSub) { this.wsSub.unsubscribe(); this.wsSub = null; }
    this.isInitialized = false;
    this.userDocId = null;
    this.currentStatus = null;
  }

  private setStatus(status: string): void {
    if (!this.userDocId || status === this.currentStatus) return;
    this.currentStatus = status;
    console.log('UserPresence: Writing status =', status, 'for', this.userDocId);
    this.afs.collection('user_presence').doc(this.userDocId)
      .set({ status, lastStatusChange: serverTimestamp() }, { merge: true })
      .then(() => console.log('UserPresence: Write succeeded:', status))
      .catch((err) => console.error('UserPresence: Write FAILED:', err));
  }

  private onBeforeUnload(): void {
    this.currentStatus = null;
    this.setStatus('offline');
  }

  /**
   * Real-time listener on the entire user_presence collection.
   * Emits a Map<userId, isOnline> whenever any user's presence changes.
   * This mirrors the Flutter app's Firestore snapshot approach.
   */
  watchAllPresence$(): Observable<Map<string, boolean>> {
    return this.afs.collection<{ status?: string }>('user_presence')
      .snapshotChanges()
      .pipe(
        map(actions => {
          const presenceMap = new Map<string, boolean>();
          actions.forEach(action => {
            const data = action.payload.doc.data();
            const userId = action.payload.doc.id;
            presenceMap.set(userId, data?.status === 'active' || data?.status === 'background');
          });
          return presenceMap;
        })
      );
  }
}
