import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { CaasService, caasDisplayName } from '../caas/caas.service';
import type { CaasAssignment, CaasUserRecord } from '../caas/caas.service';
import type {
  AppMember,
  AppRole,
  AssignRoleDto,
  InvitationCentre,
  InviteDto,
} from './invitations.types';

/** `user`/`role` come back either populated or as a bare id. */
function refId(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  const o = v as { _id?: unknown };
  return o._id ? String(o._id) : '';
}
function refField(v: unknown, key: string): string {
  if (!v || typeof v === 'string') return '';
  const o = v as Record<string, unknown>;
  return o[key] == null ? '' : String(o[key]);
}

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(private readonly caas: CaasService) {}

  /**
   * Everyone holding a role on this app, joined against the CaaS One account
   * for status and avatar. Users with no assignment here are not listed —
   * this centre is scoped to this application, not to the whole directory.
   */
  async listMembers(token: string): Promise<AppMember[]> {
    let directoryLoaded = true;
    const [assignments, users] = await Promise.all([
      this.caas.listAppAssignments(token),
      this.caas.listUsers(token).catch((e: unknown) => {
        // Status and avatars are a nicety; the roster still renders without them.
        this.logger.warn(
          `Could not load user records: ${e instanceof Error ? e.message : String(e)}`,
        );
        directoryLoaded = false;
        return [] as CaasUserRecord[];
      }),
    ]);

    const byId = new Map(users.map((u) => [String(u._id), u]));
    const live = assignments.filter((a) => a.isActive !== false);

    // Deleting a user in CaaS One leaves their assignment behind. Those rows
    // describe nobody, so they are not people and are not listed. Only trusted
    // when the directory actually loaded — a failed lookup must not empty the
    // roster.
    const known = directoryLoaded
      ? live.filter((a) => byId.has(refId(a.user)))
      : live;
    const orphans = live.length - known.length;
    if (orphans) {
      this.logger.warn(
        `${orphans} assignment(s) on this app reference a user that no longer ` +
          `exists in CaaS One; hidden from the roster`,
      );
    }

    return known
      .map((a) => this.toMember(a, byId))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private toMember(
    a: CaasAssignment,
    byId: Map<string, CaasUserRecord>,
  ): AppMember {
    const userId = refId(a.user);
    const account = byId.get(userId);
    const email = account?.email || refField(a.user, 'email');
    const name = account
      ? caasDisplayName(account)
      : [refField(a.user, 'firstName'), refField(a.user, 'lastName')]
          .filter(Boolean)
          .join(' ')
          .trim() || email;
    return {
      assignmentId: String(a._id),
      userId,
      name,
      email,
      photoUrl: account?.photoUrl || '',
      status: account?.status || 'active',
      roleId: refId(a.role),
      roleName: refField(a.role, 'name') || refField(a.role, 'key'),
      createdAt: a.createdAt,
    };
  }

  /**
   * Roster plus the roles that can be granted on this app.
   *
   * `GET /roles?app=` can come back empty even while assignments exist — an app
   * whose roles were never registered under it still has assignments naming the
   * role they grant. Falling back to those keeps the centre usable instead of
   * leaving every control inert.
   */
  async centre(token: string): Promise<InvitationCentre> {
    const [members, declared] = await Promise.all([
      this.listMembers(token),
      this.listRoles(token).catch((e: unknown) => {
        this.logger.warn(
          `Could not list roles: ${e instanceof Error ? e.message : String(e)}`,
        );
        return [] as AppRole[];
      }),
    ]);
    if (declared.length) return { members, roles: declared, rolesDerived: false };

    const seen = new Map<string, string>();
    for (const m of members) {
      if (m.roleId && !seen.has(m.roleId)) {
        seen.set(m.roleId, m.roleName || 'Assigned role');
      }
    }
    const roles = [...seen].map(([id, name]) => ({ id, name }));
    return { members, roles, rolesDerived: roles.length > 0 };
  }

  async listRoles(token: string): Promise<AppRole[]> {
    const roles = await this.caas.listAppRoles(token);
    return roles.map((r) => ({
      id: String(r._id),
      name: r.name || r.key || 'Unnamed role',
    }));
  }

  async invite(token: string, dto: InviteDto): Promise<AppMember[]> {
    const { roleId, ...user } = dto;
    await this.caas.invite(token, user, roleId);
    return this.listMembers(token);
  }

  resendInvite(token: string, userId: string) {
    return this.caas.resendInvite(token, userId);
  }

  async inviteLink(token: string, userId: string): Promise<{ link: string }> {
    const res = await this.caas.inviteLink(token, userId);
    return { link: res?.link || res?.url || '' };
  }

  async assignRole(token: string, dto: AssignRoleDto): Promise<AppMember[]> {
    await this.caas.assignRole(token, dto.userId, dto.roleId, dto.assignmentId);
    return this.listMembers(token);
  }

  /**
   * Revoking is by assignment id, so the id is confirmed to belong to this
   * app before the call — otherwise a guessed id could strip a user's access
   * to an unrelated CaaS app through this endpoint.
   */
  async revoke(token: string, assignmentId: string): Promise<AppMember[]> {
    const mine = await this.caas.listAppAssignments(token);
    if (!mine.some((a) => String(a._id) === assignmentId)) {
      throw new ForbiddenException(
        'That assignment does not belong to this application.',
      );
    }
    await this.caas.revokeAssignment(token, assignmentId);
    return this.listMembers(token);
  }
}
