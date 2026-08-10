import { Injectable } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { firstValueFrom } from 'rxjs';
import { GridAuthProvider } from '../grid/tokens/grid-tokens';

@Injectable({ providedIn: 'root' })
export class DesktopAuthAdapter implements GridAuthProvider {
  constructor(private afAuth: AngularFireAuth) {}

  async getIdToken(): Promise<string | null> {
    try {
      let user = await this.afAuth.currentUser;
      if (!user) {
        // On a cold start Firebase is still restoring the session from disk,
        // so currentUser is briefly null. authState's first emission fires
        // once restoration completes (restored user, or null if truly signed
        // out) — without this wait, the first API calls go out with no
        // Authorization header and the WebSocket connects with token=null.
        user = await firstValueFrom(this.afAuth.authState);
      }
      if (!user) return null;
      return await user.getIdToken();
    } catch (error) {
      console.error('Error getting ID token:', error);
      return null;
    }
  }

  getCurrentUserDocId(): string | null {
    return localStorage.getItem('userDocId');
  }
}
