import { Injectable } from '@angular/core';
import {
  HttpEvent,
  HttpHandler,
  HttpInterceptor,
  HttpRequest,
} from '@angular/common/http';
import { Observable, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { environment } from 'src/environments/environment';
import { DesktopAuthAdapter } from '../services/desktop-auth.adapter';

/**
 * Attaches the current user's Firebase ID token as a Bearer token on requests
 * to the site_frame backend (The Grid chat API).
 *
 * site_frame's chat endpoints used to be unauthenticated (AllowAny + a
 * trusted user_id param); they now verify this header, bind the claimed
 * user_id to the token's Firebase UID, and reject offboarded users.
 */
@Injectable()
export class FirebaseAuthInterceptor implements HttpInterceptor {
  constructor(private authAdapter: DesktopAuthAdapter) {}

  intercept(req: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    const needsToken =
      req.url.startsWith(environment.siteFrameApiUrl) &&
      !req.headers.has('Authorization');

    if (!needsToken) {
      return next.handle(req);
    }

    return from(this.authAdapter.getIdToken()).pipe(
      switchMap((token) =>
        next.handle(
          token
            ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
            : req
        )
      )
    );
  }
}
