import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, of, shareReplay, tap } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { environment } from '../../environments/environment';
import { ANONYMOUS_SESSION, SessionResponse } from './models';
import { BrowserNavigator } from './navigator.service';
import { initialsOf } from './format';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly nav = inject(BrowserNavigator);
  private readonly base = environment.apiBaseUrl;

  private readonly sessionSignal = signal<SessionResponse | null>(null);
  private readonly loadingSignal = signal(false);
  private readonly errorSignal = signal<string | null>(null);
  private inflight: Observable<SessionResponse> | null = null;

  readonly session = this.sessionSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();

  readonly authenticated = computed(() => this.sessionSignal()?.authenticated === true);
  readonly user = computed(() => this.sessionSignal()?.user ?? null);
  readonly roles = computed(() => this.sessionSignal()?.roles ?? []);
  readonly permissions = computed(() => this.sessionSignal()?.permissions ?? []);
  readonly canView = computed(() => this.sessionSignal()?.canView === true);
  readonly canUpload = computed(() => this.sessionSignal()?.canUpload === true);
  readonly canDelete = computed(
    () =>
      this.sessionSignal()?.canDelete === true ||
      this.hasPermission('budget', 'delete'),
  );
  readonly canExport = computed(() => this.sessionSignal()?.canExport === true);
  readonly canManageUsers = computed(() => this.sessionSignal()?.canManageUsers === true);
  readonly displayName = computed(() => this.user()?.displayName ?? this.user()?.email ?? '');
  readonly photoUrl = computed(() => this.user()?.photoUrl ?? '');
  readonly initials = computed(() => initialsOf(this.displayName()));

  /** Fetches the session once; later callers replay the resolved value. */
  loadSession(): Observable<SessionResponse> {
    const cached = this.sessionSignal();
    if (cached) return of(cached);
    if (this.inflight) return this.inflight;

    this.loadingSignal.set(true);
    this.errorSignal.set(null);
    this.inflight = this.http
      .get<SessionResponse>(`${this.base}/auth/session`, { withCredentials: true })
      .pipe(
        map((s) => this.normalise(s)),
        catchError(() => {
          this.errorSignal.set('Could not reach the session endpoint.');
          return of(ANONYMOUS_SESSION);
        }),
        tap((s) => {
          this.sessionSignal.set(s);
          this.loadingSignal.set(false);
          this.inflight = null;
        }),
        shareReplay({ bufferSize: 1, refCount: false }),
      );
    return this.inflight;
  }

  /** Discards the cache so the next `loadSession()` hits the network again. */
  refresh(): Observable<SessionResponse> {
    this.sessionSignal.set(null);
    this.inflight = null;
    return this.loadSession();
  }

  login(returnTo?: string): void {
    const target = returnTo ?? this.nav.currentPath();
    const query = target && target !== '/' ? `?returnTo=${encodeURIComponent(target)}` : '';
    this.nav.redirect(`${this.base}/auth/login${query}`);
  }

  logout(): void {
    this.http
      .post(`${this.base}/auth/logout`, {}, { withCredentials: true })
      .pipe(catchError(() => of(null)))
      .subscribe(() => {
        this.sessionSignal.set(ANONYMOUS_SESSION);
        this.inflight = null;
        this.nav.redirect('/');
      });
  }

  /** A permission check that mirrors the backend feature catalog. */
  hasPermission(featureKey: string, action: string): boolean {
    return this.permissions().some(
      (p) => p.featureKey === featureKey && p.actions.includes(action),
    );
  }

  /** A partial payload from an older backend must not read as "full access". */
  private normalise(s: SessionResponse | null): SessionResponse {
    if (!s || !s.authenticated) return ANONYMOUS_SESSION;
    return {
      ...s,
      authenticated: true,
      canView: s.canView === true,
      canUpload: s.canUpload === true,
      canDelete: s.canDelete === true,
      canExport: s.canExport === true,
      canManageUsers: s.canManageUsers === true,
      roles: s.roles ?? [],
      permissions: s.permissions ?? [],
    };
  }
}
