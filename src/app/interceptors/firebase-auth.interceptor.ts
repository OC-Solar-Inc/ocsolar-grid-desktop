import { Injectable } from '@angular/core';
import { HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Observable, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { environment } from '../../environments/environment';
import { DesktopAuthAdapter } from '../services/desktop-auth.adapter';

/**
 * Attaches the signed-in user's Firebase ID token as a Bearer token on every
 * request to the site_frame backend.
 *
 * Mirrors the portal's FirebaseAuthInterceptor. site_frame's Grid chat REST
 * endpoints used to trust the bare `user_id` query param; since the
 * "require verified Firebase tokens on Grid chat REST + WS" change they reject
 * anything without a valid token ("Valid Firebase authentication required."),
 * which is what left the desktop app with empty channel, DM and group lists.
 */
@Injectable()
export class FirebaseAuthInterceptor implements HttpInterceptor {
  constructor(private auth: DesktopAuthAdapter) {}

  intercept(req: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    const needsToken =
      req.url.startsWith(environment.siteFrameApiUrl) &&
      !req.headers.has('Authorization');

    if (!needsToken) {
      return next.handle(req);
    }

    return from(this.auth.getIdToken()).pipe(
      switchMap(token =>
        next.handle(token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req)
      )
    );
  }
}
