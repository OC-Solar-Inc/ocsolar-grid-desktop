import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { firstValueFrom } from 'rxjs';
import { GridUserDataProvider } from '../grid/tokens/grid-tokens';
import { User } from '../grid/interfaces/user';

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

@Injectable({ providedIn: 'root' })
export class DesktopUserDataAdapter implements GridUserDataProvider {
  private cachedUsers: User[] | null = null;

  constructor(private afs: AngularFirestore) {}

  /**
   * Load the employee directory from Firestore.
   *
   * Reads with `source: 'server'`: the default source silently resolves with an
   * empty from-cache snapshot when the SDK decides it is offline, which the
   * Grid then renders as "Unknown User" everywhere and "No employees found" in
   * the DM picker with nothing in the console. Forcing the server makes that
   * case throw, so it is retried and, if it keeps failing, logged loudly.
   * An empty result is never cached — a later retry (next launch) gets a
   * fresh chance.
   */
  async getUsers(): Promise<User[]> {
    if (this.cachedUsers && this.cachedUsers.length > 0) return this.cachedUsers;

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const snapshot = await firstValueFrom(
          this.afs.collection<User>('users').get({ source: 'server' })
        );
        const users = snapshot.docs.map(doc => ({ id: doc.id, ...(doc.data() as User) }));
        if (users.length === 0) {
          console.warn(`Users: server returned an empty users collection (attempt ${attempt}/${MAX_ATTEMPTS})`);
        } else {
          this.cachedUsers = users;
          return users;
        }
      } catch (error) {
        lastError = error;
        console.warn(`Users: fetch attempt ${attempt}/${MAX_ATTEMPTS} failed:`, error);
      }
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
      }
    }

    console.error('Users: could not load the employee directory from Firestore', lastError);
    if (lastError) throw lastError;
    return [];
  }
}
