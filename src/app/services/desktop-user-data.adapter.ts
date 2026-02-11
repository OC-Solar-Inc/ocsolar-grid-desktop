import { Injectable } from '@angular/core';
import { AngularFirestore } from '@angular/fire/compat/firestore';
import { GridUserDataProvider } from '../grid/tokens/grid-tokens';
import { User } from '../grid/interfaces/user';
import { map, catchError } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class DesktopUserDataAdapter implements GridUserDataProvider {
  private cachedUsers: User[] | null = null;

  constructor(private afs: AngularFirestore) {}

  getUsers(): Promise<User[]> {
    if (this.cachedUsers) return Promise.resolve(this.cachedUsers);

    return this.afs
      .collection('users')
      .get()
      .pipe(
        map(snapshot =>
          snapshot.docs.map(doc => {
            const id = doc.id;
            const data = doc.data() as Record<string, any>;
            return { id, ...data } as User;
          })
        ),
        catchError(error => {
          console.error('Error fetching users:', error);
          throw error;
        })
      )
      .toPromise()
      .then(users => {
        this.cachedUsers = users || [];
        return this.cachedUsers;
      });
  }
}
