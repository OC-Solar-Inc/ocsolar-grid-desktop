import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AngularFireAuth } from '@angular/fire/compat/auth';
import { from, of } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';
import { DesktopIdentityService } from '../services/desktop-identity.service';

export const authGuard: CanActivateFn = () => {
  const afAuth = inject(AngularFireAuth);
  const router = inject(Router);
  const identity = inject(DesktopIdentityService);

  return afAuth.authState.pipe(
    take(1),
    switchMap(user => {
      if (!user) return of(null);
      // Re-resolve the users doc ID from the Firebase uid on every entry so a
      // stale localStorage value cannot send the Grid API the wrong identity.
      return from(identity.syncStoredDocId(user.uid));
    }),
    map(docId => {
      if (docId) return true;
      router.navigate(['/login']);
      return false;
    })
  );
};
