import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  CanActivateFn,
  Router,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { Observable, isObservable, of } from 'rxjs';

import { authGuard, uploadGuard, viewGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { SessionResponse } from './models';
import { BrowserNavigator } from './navigator.service';
import { environment } from '../../environments/environment';

class NavigatorStub {
  readonly visited: string[] = [];
  redirect(url: string): void {
    this.visited.push(url);
  }
  currentPath(): string {
    return '/';
  }
}

const route = {} as ActivatedRouteSnapshot;
const state = { url: '/upload' } as RouterStateSnapshot;

interface GuardResultBox {
  value?: boolean | UrlTree;
}

/**
 * The guard's observable is cold, so it has to be subscribed before the
 * session request exists to flush.
 */
function run(guard: CanActivateFn): GuardResultBox {
  const box: GuardResultBox = {};
  const result = TestBed.runInInjectionContext(() => guard(route, state));
  const obs = isObservable(result)
    ? (result as Observable<boolean | UrlTree>)
    : of(result as boolean | UrlTree);
  obs.subscribe((v) => (box.value = v));
  return box;
}

describe('route guards', () => {
  let http: HttpTestingController;
  let nav: NavigatorStub;

  beforeEach(() => {
    nav = new NavigatorStub();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: BrowserNavigator, useValue: nav },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthService);
  });

  afterEach(() => http.verify());

  function flush(session: Partial<SessionResponse>): void {
    http.expectOne(`${environment.apiBaseUrl}/auth/session`).flush({
      canView: false,
      canUpload: false,
      canExport: false,
      ...session,
    } as SessionResponse);
  }

  function urlOf(value: boolean | UrlTree | undefined): string {
    expect(value instanceof UrlTree).toBeTrue();
    return TestBed.inject(Router).serializeUrl(value as UrlTree);
  }

  it('redirects an anonymous visitor into the login flow', () => {
    const result = run(authGuard);
    flush({ authenticated: false });

    expect(result.value).toBeFalse();
    expect(nav.visited[0]).toBe(`${environment.apiBaseUrl}/auth/login?returnTo=%2Fupload`);
  });

  it('lets an authenticated viewer through the view guard', () => {
    const result = run(viewGuard);
    flush({ authenticated: true, canView: true });

    expect(result.value).toBeTrue();
  });

  it('sends a signed-in user without budget:view to the no-access page', () => {
    const result = run(viewGuard);
    flush({ authenticated: true, canView: false });

    expect(urlOf(result.value)).toBe('/no-access');
  });

  it('bounces a viewer away from the upload route', () => {
    const result = run(uploadGuard);
    flush({ authenticated: true, canView: true, canUpload: false });

    expect(urlOf(result.value)).toBe('/');
  });

  it('admits an administrator to the upload route', () => {
    const result = run(uploadGuard);
    flush({ authenticated: true, canView: true, canUpload: true });

    expect(result.value).toBeTrue();
  });

  it('starts the login flow when an unauthenticated user hits a permissioned route', () => {
    const result = run(uploadGuard);
    flush({ authenticated: false });

    expect(result.value).toBeFalse();
    expect(nav.visited[0]).toContain(`${environment.apiBaseUrl}/auth/login`);
  });
});
