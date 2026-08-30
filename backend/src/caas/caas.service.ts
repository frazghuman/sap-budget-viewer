import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface CaasMe {
  _id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  userType: string;
  photoUrl?: string;
  company?: string | null;
  tenant?: string | null;
  branches?: string[];
}

/** A CaaS One app record, trimmed to what this app needs. */
export interface CaasApp {
  _id: string;
  key: string;
  name?: string;
}

export interface CaasRole {
  _id: string;
  key?: string;
  name?: string;
}

/** One user-app-role row from `GET /roles/assignments`. */
export interface CaasAssignment {
  _id: string;
  user?: { _id?: string; firstName?: string; lastName?: string; email?: string } | string;
  app?: { _id?: string; key?: string; name?: string } | string;
  role?: { _id?: string; key?: string; name?: string } | string;
  isActive?: boolean;
  createdAt?: string;
}

export interface CaasUserRecord {
  _id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  status?: string;
  userType?: string;
  photoUrl?: string;
}

export interface CaasInviteInput {
  email: string;
  firstName: string;
  lastName: string;
  userType?: string;
  company?: string;
  tenant?: string;
  branch?: string;
}

export interface CaasRoleAssignment {
  app?: { key?: string; name?: string };
  role?: {
    name?: string;
    key?: string;
    permissions?: { featureKey: string; actions: string[] }[];
  };
  isActive?: boolean;
}

export function caasDisplayName(
  me: Pick<CaasMe, 'firstName' | 'lastName' | 'email'>,
): string {
  const full = [me.firstName, me.lastName].filter(Boolean).join(' ').trim();
  return full || me.email;
}

interface CacheEntry<T> {
  value: T;
  expires: number;
}

/** Drops keys that are absent or blank so they cannot overwrite a default. */
function definedOnly<T extends object>(o: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out as Partial<T>;
}

@Injectable()
export class CaasService {
  private readonly logger = new Logger(CaasService.name);
  private readonly apiUrl: string;
  private readonly appKey: string;
  private readonly timeoutMs: number;
  private readonly ttlMs = 5_000;
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private appIdCache: CacheEntry<string> | null = null;

  constructor(config: ConfigService) {
    this.apiUrl = (
      config.get<string>('CAAS_API_URL') || 'http://localhost:3501/api'
    ).replace(/\/$/, '');
    this.appKey = config.get<string>('CAAS_APP_KEY') || 'sui-budget-control';
    const t = Number(config.get<string>('CAAS_REQUEST_TIMEOUT_MS'));
    this.timeoutMs = t > 0 ? t : 15_000;
    this.logger.log(`CaaS URL: ${this.apiUrl} | appKey: ${this.appKey}`);
  }

  get applicationKey() {
    return this.appKey;
  }

  private async cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key) as CacheEntry<T> | undefined;
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = await fn();
    this.cache.set(key, { value, expires: Date.now() + this.ttlMs });
    return value;
  }

  private async fetchJson<T>(
    path: string,
    token: string,
    init: RequestInit = {},
  ): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.apiUrl}${path}`, {
        ...init,
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.headers || {}),
        },
      });
      if (!res.ok) {
        // CaaS One explains itself in the body ("A company, tenant, and branch
        // are required..."); a bare status code sends the caller hunting.
        const detail = await res
          .text()
          .then((t) => {
            try {
              const b = JSON.parse(t) as { message?: unknown };
              return Array.isArray(b?.message)
                ? b.message.join('; ')
                : typeof b?.message === 'string'
                  ? b.message
                  : '';
            } catch {
              return t.slice(0, 200);
            }
          })
          .catch(() => '');
        const err = new Error(
          detail || `CaaS ${path} -> ${res.status}`,
        ) as Error & { status: number };
        err.status = res.status;
        throw err;
      }
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  getMe(token: string): Promise<CaasMe> {
    return this.cached(`me:${token}`, () =>
      this.fetchJson<CaasMe>('/users/me', token),
    );
  }

  async getMyAppRoles(token: string): Promise<CaasRoleAssignment[]> {
    const all = await this.cached(`roles:${token}`, () =>
      this.fetchJson<CaasRoleAssignment[]>('/roles/my', token).catch(
        () => [] as CaasRoleAssignment[],
      ),
    );
    return (all || []).filter(
      (a) => a?.app?.key === this.appKey && a.isActive !== false,
    );
  }

  /**
   * This app's CaaS One id. `GET /apps` has no by-key route, so the entitled
   * list is matched on `key`. Cached for longer than the 5s default — an app
   * id does not change, and every admin call needs it.
   */
  async getAppId(token: string): Promise<string> {
    const hit = this.appIdCache;
    if (hit && hit.expires > Date.now()) return hit.value;
    const apps = await this.fetchJson<CaasApp[]>('/apps', token);
    const match = (apps || []).find((a) => a?.key === this.appKey);
    if (!match) {
      throw new Error(`App '${this.appKey}' is not registered in CaaS One`);
    }
    const id = String(match._id);
    this.appIdCache = { value: id, expires: Date.now() + 300_000 };
    return id;
  }

  /** Role assignments on this app only — never any other CaaS app. */
  async listAppAssignments(token: string): Promise<CaasAssignment[]> {
    const appId = await this.getAppId(token);
    const rows = await this.fetchJson<CaasAssignment[]>(
      `/roles/assignments?app=${encodeURIComponent(appId)}`,
      token,
    );
    return rows || [];
  }

  /**
   * Roles defined for this app, for the invite and change-role pickers.
   *
   * `GET /roles?app=` filters server-side against the caller's manageable-app
   * set and has been observed returning nothing while roles plainly exist. So
   * an unfiltered list is tried next and matched here on the app the role
   * belongs to — populated as `{ name, key }`, or left as a bare id.
   */
  async listAppRoles(token: string): Promise<CaasRole[]> {
    const appId = await this.getAppId(token);

    const scoped = await this.fetchJson<CaasRole[]>(
      `/roles?app=${encodeURIComponent(appId)}`,
      token,
    ).catch(() => [] as CaasRole[]);
    if (scoped?.length) {
      this.logger.log(`roles: ${scoped.length} from /roles?app=`);
      return scoped;
    }

    const all = await this.fetchJson<CaasRole[]>('/roles', token).catch(
      () => [] as CaasRole[],
    );

    if (!all?.length) {
      // CaaS One scopes /roles to the caller's manageable apps and returns an
      // empty array (not an error) when that set is empty. Record what the
      // caller actually looks like so the cause is visible rather than guessed.
      const me = await this.getMe(token).catch(() => null);
      const mine = await this.fetchJson<CaasRoleAssignment[]>(
        '/roles/my',
        token,
      ).catch(() => [] as CaasRoleAssignment[]);
      const apps = await this.fetchJson<CaasApp[]>('/apps', token).catch(
        () => [] as CaasApp[],
      );
      this.logger.warn(
        `roles diagnostic — userType=${me?.userType ?? '?'} ` +
          `company=${me?.company ?? 'none'} tenant=${me?.tenant ?? 'none'} | ` +
          `/roles/my=${mine.length} [${mine
            .map((a) => `${a.app?.key ?? '?'}:${a.role?.key ?? '?'}`)
            .join(', ')}] | ` +
          `/apps=${apps.length} [${apps.map((a) => a.key).join(', ')}] | ` +
          `appId=${appId}`,
      );
    }
    const mine = (all || []).filter((r) => this.roleBelongsHere(r, appId));
    this.logger.log(
      `roles: /roles?app= returned 0; unfiltered /roles returned ${all?.length ?? 0}, ` +
        `${mine.length} belong to ${this.appKey}`,
    );
    return mine;
  }

  private roleBelongsHere(role: CaasRole, appId: string): boolean {
    const app = (role as { app?: unknown }).app;
    if (!app) return false;
    if (typeof app === 'string') return app === appId;
    const o = app as { _id?: unknown; key?: unknown };
    if (o.key) return o.key === this.appKey;
    return o._id != null && String(o._id) === appId;
  }

  /**
   * Users the caller may administer. Assignments carry only name and email,
   * so this supplies status (pending / active) and avatars.
   */
  async listUsers(token: string): Promise<CaasUserRecord[]> {
    const rows = await this.fetchJson<CaasUserRecord[]>('/users', token);
    return rows || [];
  }

  /**
   * Invites a user and grants them a role on this app in one call.
   *
   * CaaS One defaults an invite with no `userType` to `branch_member`, which it
   * then rejects unless company + tenant + branch are all supplied. Neither is
   * something this app asks for, so the invitee inherits the inviter's own
   * scope and the deepest member type that scope actually supports.
   */
  async invite(
    token: string,
    input: CaasInviteInput,
    roleId: string,
  ): Promise<CaasUserRecord> {
    const [appId, me] = await Promise.all([
      this.getAppId(token),
      this.getMe(token),
    ]);
    const scope = this.inviteeScope(me);
    return this.fetchJson<CaasUserRecord>('/users/invite', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // A plain spread would let `input`'s absent optional fields (present as
      // `undefined` on the validated DTO) blank out the inherited scope, and
      // JSON.stringify then drops them entirely.
      body: JSON.stringify({
        ...scope,
        ...definedOnly(input),
        appAccess: [{ appId, roleId }],
      }),
    });
  }

  /** The invitee sits where the inviter sits, one rung below in user type. */
  private inviteeScope(me: CaasMe): {
    userType: string;
    company?: string;
    tenant?: string;
    branch?: string;
  } {
    const company = me.company ? String(me.company) : undefined;
    const tenant = me.tenant ? String(me.tenant) : undefined;
    const branch = me.branches?.length ? String(me.branches[0]) : undefined;
    if (company && tenant && branch) {
      return { userType: 'branch_member', company, tenant, branch };
    }
    if (company && tenant) return { userType: 'tenant_member', company, tenant };
    if (company) return { userType: 'company_member', company };
    // A platform admin has no org of their own — let CaaS One decide.
    return { userType: 'company_member' };
  }

  resendInvite(token: string, userId: string): Promise<unknown> {
    return this.fetchJson(
      `/users/${encodeURIComponent(userId)}/resend-invite`,
      token,
      { method: 'POST' },
    );
  }

  inviteLink(token: string, userId: string): Promise<{ link?: string; url?: string }> {
    return this.fetchJson(
      `/users/${encodeURIComponent(userId)}/invite-link`,
      token,
      { method: 'POST' },
    );
  }

  /** Re-points an existing assignment at a different role on this app. */
  async assignRole(
    token: string,
    userId: string,
    roleId: string,
    assignmentId?: string,
  ): Promise<unknown> {
    const appId = await this.getAppId(token);
    return this.fetchJson('/roles/assign', token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(assignmentId ? { assignmentId } : {}),
        userId,
        appId,
        roleId,
      }),
    });
  }

  /**
   * Drops one assignment. Scoped by id, and the caller checks the id belongs
   * to this app first, so a stray id cannot revoke access to another app.
   */
  revokeAssignment(token: string, assignmentId: string): Promise<unknown> {
    return this.fetchJson(
      `/roles/assignments/${encodeURIComponent(assignmentId)}`,
      token,
      { method: 'DELETE' },
    );
  }

  async checkAccess(
    token: string,
    featureKey: string,
    action: string,
  ): Promise<boolean> {
    try {
      const body = await this.fetchJson<{ allowed?: boolean }>(
        '/roles/check-access',
        token,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appKey: this.appKey,
            featureKey,
            action,
          }),
        },
      );
      return !!body.allowed;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`check-access ${featureKey}/${action}: ${msg}`);
      return false;
    }
  }
}
