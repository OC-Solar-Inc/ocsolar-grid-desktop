import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { User } from '../grid/interfaces/user';

const USER_DOC_ID_KEY = 'userDocId';

/**
 * Resolves the signed-in Firebase user to their `users` document.
 *
 * The Grid API identifies people purely by the Firestore `users` document ID
 * (sent as `user_id` on every request), so a stale or wrong value in
 * localStorage makes the app behave like a brand-new account: no DMs, no
 * groups, no history. The portal re-resolves this ID from the Firebase uid on
 * every dashboard load; the desktop used to trust whatever was stored at
 * login forever. This service mirrors the portal: resolve on every launch,
 * overwrite the stored ID if it drifted, and keep the doc around so the shell
 * can show who is signed in.
 */
@Injectable({ providedIn: 'root' })
export class DesktopIdentityService {
  private readonly currentUserSubject = new BehaviorSubject<User | null>(null);
  readonly currentUser$ = this.currentUserSubject.asObservable();

  constructor(private afs: AngularFirestore) {}

  get currentUser(): User | null {
    return this.currentUserSubject.value;
  }

  getStoredDocId(): string | null {
    return localStorage.getItem(USER_DOC_ID_KEY);
  }

  clearStoredDocId(): void {
    localStorage.removeItem(USER_DOC_ID_KEY);
    this.currentUserSubject.next(null);
  }

  /**
   * Look up the `users` document whose sUID matches the Firebase uid.
   * Reads from the server so an unreachable Firestore surfaces as an error
   * instead of an empty from-cache snapshot that looks like "no such user".
   */
  async lookupUserDoc(firebaseUid: string): Promise<User | null> {
    const snapshot = await firstValueFrom(
      this.afs
        .collection<User>('users', ref => ref.where('sUID', '==', firebaseUid))
        .get({ source: 'server' })
    );
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { id: doc.id, ...(doc.data() as User) };
  }

  /**
   * Resolve the stored doc ID against Firestore. Returns the doc ID the app
   * should use, or null when the user has no `users` document at all.
   *
   * Lookup failures (offline, Firestore unreachable) fall back to the stored
   * value so a flaky network does not log people out.
   */
  async syncStoredDocId(firebaseUid: string): Promise<string | null> {
    const stored = this.getStoredDocId();
    try {
      const userDoc = await this.lookupUserDoc(firebaseUid);
      if (!userDoc?.id) {
        console.warn('Identity: no users document for uid', firebaseUid, '- keeping stored id', stored);
        return stored;
      }
      if (stored !== userDoc.id) {
        console.warn('Identity: stored userDocId', stored, 'differs from resolved', userDoc.id, '- updating');
        localStorage.setItem(USER_DOC_ID_KEY, userDoc.id);
      }
      this.currentUserSubject.next(userDoc);
      return userDoc.id;
    } catch (error) {
      console.error('Identity: failed to resolve users document, keeping stored id', stored, error);
      return stored;
    }
  }
}
