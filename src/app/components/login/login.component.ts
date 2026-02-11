import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { firstValueFrom } from 'rxjs';
import { map } from 'rxjs/operators';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent {
  email = '';
  password = '';
  errorMessage = '';
  isLoading = false;

  constructor(
    private afAuth: AngularFireAuth,
    private afs: AngularFirestore,
    private router: Router
  ) {
    // If already logged in, redirect to grid
    this.afAuth.authState.subscribe(user => {
      if (user && localStorage.getItem('userDocId')) {
        this.router.navigate(['/']);
      }
    });
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
      const firebaseUid = credential.user.uid;
      const users = await firstValueFrom(
        this.afs
          .collection('users', ref => ref.where('sUID', '==', firebaseUid))
          .snapshotChanges()
          .pipe(
            map(actions =>
              actions.map(a => ({
                id: a.payload.doc.id,
                ...(a.payload.doc.data() as Record<string, any>),
              }))
            )
          )
      );

      if (users.length === 0) {
        this.errorMessage = 'User account not found.';
        await this.afAuth.signOut();
        this.isLoading = false;
        return;
      }

      const userDoc = users[0];
      localStorage.setItem('userDocId', userDoc.id);

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
