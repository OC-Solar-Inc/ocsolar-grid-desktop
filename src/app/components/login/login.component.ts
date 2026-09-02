import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { DesktopIdentityService } from '../../services/desktop-identity.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent implements OnInit {
  email = '';
  password = '';
  errorMessage = '';
  isLoading = false;
  appVersion = '';

  constructor(
    private afAuth: AngularFireAuth,
    private identity: DesktopIdentityService,
    private router: Router
  ) {
    // If already logged in, redirect to grid
    this.afAuth.authState.subscribe(user => {
      if (user && this.identity.getStoredDocId()) {
        this.router.navigate(['/']);
      }
    });
  }

  ngOnInit(): void {
    window.electronAPI?.getAppVersion?.().then(version => {
      this.appVersion = version;
    }).catch(() => { /* not running under Electron */ });
  }

  async login(): Promise<void> {
    if (!this.email || !this.password) {
      this.errorMessage = 'Please enter email and password.';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    try {
      const credential = await this.afAuth.signInWithEmailAndPassword(
        this.email,
        this.password
      );

      if (!credential.user) {
        this.errorMessage = 'Login failed. Please try again.';
        this.isLoading = false;
        return;
      }

      // Find user doc where sUID matches Firebase UID
      let userDoc;
      try {
        userDoc = await this.identity.lookupUserDoc(credential.user.uid);
      } catch (lookupError) {
        console.error('Login: users lookup failed:', lookupError);
        this.errorMessage = 'Could not reach the user directory. Check your connection and try again.';
        await this.afAuth.signOut();
        this.isLoading = false;
        return;
      }

      if (!userDoc?.id) {
        this.errorMessage = 'User account not found.';
        await this.afAuth.signOut();
        this.isLoading = false;
        return;
      }

      await this.identity.syncStoredDocId(credential.user.uid);

      this.router.navigate(['/']);
    } catch (error: any) {
      console.error('Login error:', error);
      if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password') {
        this.errorMessage = 'Invalid email or password.';
      } else if (error.code === 'auth/invalid-email') {
        this.errorMessage = 'Invalid email format.';
      } else if (error.code === 'auth/too-many-requests') {
        this.errorMessage = 'Too many login attempts. Please try again later.';
      } else {
        this.errorMessage = 'Login failed. Please try again.';
      }
      this.isLoading = false;
    }
  }
}
