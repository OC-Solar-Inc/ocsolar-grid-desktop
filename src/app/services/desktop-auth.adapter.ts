import { Injectable } from '@angular/core';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { GridAuthProvider } from '@ocsolar/grid';

@Injectable({ providedIn: 'root' })
export class DesktopAuthAdapter implements GridAuthProvider {
  constructor(private afAuth: AngularFireAuth) {}

  async getIdToken(): Promise<string | null> {
    const user = await this.afAuth.currentUser;
    if (!user) return null;
    return user.getIdToken();
  }

  getCurrentUserDocId(): string | null {
    return localStorage.getItem('userDocId');
  }
}
