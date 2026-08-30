import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../environments/environment';
import { AppMember, InvitationCenter, InviteRequest } from './models';

/**
 * The invitation centre talks only to this app's backend, which proxies to
 * CaaS One with the caller's token. Every mutation answers with the refreshed
 * roster so the page never has to guess what changed.
 */
@Injectable({ providedIn: 'root' })
export class InvitationsService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiBaseUrl}/invitations`;
  private readonly opts = { withCredentials: true as const };

  load(): Observable<InvitationCenter> {
    return this.http.get<InvitationCenter>(this.base, this.opts);
  }

  invite(body: InviteRequest): Observable<AppMember[]> {
    return this.http.post<AppMember[]>(this.base, body, this.opts);
  }

  changeRole(
    userId: string,
    roleId: string,
    assignmentId: string,
  ): Observable<AppMember[]> {
    return this.http.post<AppMember[]>(
      `${this.base}/role`,
      { userId, roleId, assignmentId },
      this.opts,
    );
  }

  resend(userId: string): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(
      `${this.base}/${encodeURIComponent(userId)}/resend`,
      {},
      this.opts,
    );
  }

  inviteLink(userId: string): Observable<{ link: string }> {
    return this.http.post<{ link: string }>(
      `${this.base}/${encodeURIComponent(userId)}/invite-link`,
      {},
      this.opts,
    );
  }

  revoke(assignmentId: string): Observable<AppMember[]> {
    return this.http.delete<AppMember[]>(
      `${this.base}/${encodeURIComponent(assignmentId)}`,
      this.opts,
    );
  }
}
