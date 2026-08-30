import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { AuthService } from './auth.service';
import { SessionResponse } from './models';
import { BrowserNavigator } from './navigator.service';

class NavigatorStub {
  readonly visited: string[] = [];
  redirect(url: string): void {
    this.visited.push(url);
  }
  currentPath(): string {
    return '/datasets/abc';
  }
}

const adminSession: SessionResponse = {
  authenticated: true,
  user: {
    sub: 'u1',
    email: 'admin@sui.pk',
    userType: 'staff',
    displayName: 'Budget Admin',
  },
  roles: [{ key: 'budget-admin', name: 'Budget Admin' }],
  permissions: [{ featureKey: 'budget', actions: ['view', 'create', 'export'] }],
  canView: true,
  canUpload: true,
  canExport: true,
};

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;
  let nav: NavigatorStub;

  beforeEach(() => {
    nav = new NavigatorStub();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: BrowserNavigator, useValue: nav },
      ],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('exposes the permission flags from the session payload', () => {
    service.loadSession().subscribe();
    const req = http.expectOne('/api/auth/session');
    expect(req.request.withCredentials).toBeTrue();
    req.flush(adminSession);

    expect(service.authenticated()).toBeTrue();
    expect(service.canView()).toBeTrue();
    expect(service.canUpload()).toBeTrue();
    expect(service.canExport()).toBeTrue();
    expect(service.displayName()).toBe('Budget Admin');
    expect(service.hasPermission('budget', 'create')).toBeTrue();
    expect(service.hasPermission('budget', 'delete')).toBeFalse();
  });

  it('denies upload and export to a view-only session', () => {
    service.loadSession().subscribe();
    http.expectOne('/api/auth/session').flush({
      authenticated: true,
      user: { sub: 'u2', email: 'viewer@sui.pk', userType: 'staff', displayName: 'Viewer' },
      permissions: [{ featureKey: 'budget', actions: ['view'] }],
      canView: true,
      canUpload: false,
      canExport: false,
    } as SessionResponse);

    expect(service.canView()).toBeTrue();
    expect(service.canUpload()).toBeFalse();
    expect(service.canExport()).toBeFalse();
  });

  it('treats a missing flag as denied rather than granted', () => {
    service.loadSession().subscribe();
    http.expectOne('/api/auth/session').flush({ authenticated: true } as SessionResponse);

    expect(service.authenticated()).toBeTrue();
    expect(service.canView()).toBeFalse();
    expect(service.canUpload()).toBeFalse();
    expect(service.canExport()).toBeFalse();
  });

  it('falls back to an anonymous session when the endpoint fails', () => {
    service.loadSession().subscribe();
    http
      .expectOne('/api/auth/session')
      .flush('nope', { status: 500, statusText: 'Server Error' });

    expect(service.authenticated()).toBeFalse();
    expect(service.error()).toBeTruthy();
  });

  it('caches the session so repeat callers do not re-request it', () => {
    service.loadSession().subscribe();
    http.expectOne('/api/auth/session').flush(adminSession);

    let replayed: SessionResponse | null = null;
    service.loadSession().subscribe((s) => (replayed = s));

    expect(http.match('/api/auth/session').length).toBe(0);
    expect(replayed).not.toBeNull();
  });

  it('sends the current path as returnTo when starting login', () => {
    service.login();
    expect(nav.visited[0]).toBe('/api/auth/login?returnTo=%2Fdatasets%2Fabc');
  });

  it('clears the session and returns home on logout', () => {
    service.loadSession().subscribe();
    http.expectOne('/api/auth/session').flush(adminSession);

    service.logout();
    http.expectOne('/api/auth/logout').flush({});

    expect(service.authenticated()).toBeFalse();
    expect(nav.visited).toContain('/');
  });
});
