import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs/operators';

import { AuthService } from './auth.service';

/** Unauthenticated visitors are bounced to the CAAS One login flow. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  return auth.loadSession().pipe(
    map((session) => {
      if (!session.authenticated) {
        auth.login(state.url);
        return false;
      }
      return true;
    }),
  );
};

/** Signed in but without `budget:view` — nothing to show, so say so. */
export const viewGuard: CanActivateFn = (route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.loadSession().pipe(
    map((session) => {
      if (!session.authenticated) {
        auth.login(state.url);
        return false;
      }
      return session.canView ? true : router.createUrlTree(['/no-access']);
    }),
  );
};

/** Viewers never reach the upload stage; they land back on the dashboard. */
export const uploadGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.loadSession().pipe(
    map((session) => {
      if (!session.authenticated) {
        auth.login(state.url);
        return false;
      }
      return session.canUpload ? true : router.createUrlTree(['/']);
    }),
  );
};

/** Settings holds the invitation centre, which only CaaS One admins may use. */
export const settingsGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.loadSession().pipe(
    map((session) => {
      if (!session.authenticated) {
        auth.login(state.url);
        return false;
      }
      return session.canManageUsers ? true : router.createUrlTree(['/']);
    }),
  );
};
