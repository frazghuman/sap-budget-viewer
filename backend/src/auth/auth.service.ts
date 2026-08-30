import { Injectable, Logger } from '@nestjs/common';
import { CaasService } from '../caas/caas.service';
import { FEATURES } from '../features';
import { toSessionUser } from './session-auth.guard';
import { canManageUsers } from '../invitations/invitations.types';
import type {
  SessionPermission,
  SessionResponse,
  SessionUser,
} from './session.types';

export const BUDGET_FEATURE_KEY = 'budget';
export const PLATFORM_ADMIN = 'platform_admin';

/** Every budget action, granted wholesale to platform admins. */
export const ALL_BUDGET_PERMISSIONS: SessionPermission[] = FEATURES.map(
  (f) => ({
    featureKey: f.key,
    actions: [...f.actions],
  }),
);

export function isPlatformAdmin(user: Pick<SessionUser, 'userType'>): boolean {
  return user.userType === PLATFORM_ADMIN;
}

function hasAction(
  permissions: SessionPermission[],
  featureKey: string,
  action: string,
): boolean {
  return permissions.some(
    (p) => p.featureKey === featureKey && p.actions.includes(action),
  );
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly caas: CaasService) {}

  /** Merges the permission lists of every active app role into one list. */
  private mergePermissions(
    lists: { featureKey: string; actions: string[] }[][],
  ): SessionPermission[] {
    const byFeature = new Map<string, Set<string>>();
    for (const list of lists) {
      for (const perm of list || []) {
        if (!perm?.featureKey) continue;
        const set = byFeature.get(perm.featureKey) ?? new Set<string>();
        (perm.actions || []).forEach((a) => set.add(a));
        byFeature.set(perm.featureKey, set);
      }
    }
    return [...byFeature.entries()].map(([featureKey, actions]) => ({
      featureKey,
      actions: [...actions],
    }));
  }

  anonymousSession(): SessionResponse {
    return {
      authenticated: false,
      canView: false,
      canUpload: false,
      canDelete: false,
      canExport: false,
      canManageUsers: false,
    };
  }

  async buildSession(token: string): Promise<SessionResponse> {
    const me = await this.caas.getMe(token);
    const user = toSessionUser(me);

    let assignments: Awaited<ReturnType<CaasService['getMyAppRoles']>> = [];
    try {
      assignments = await this.caas.getMyAppRoles(token);
    } catch (e: unknown) {
      this.logger.warn(
        `Could not load app roles: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    const roles = assignments
      .map((a) => ({
        key: a.role?.key || '',
        name: a.role?.name || '',
      }))
      .filter((r) => r.key || r.name);

    const permissions = isPlatformAdmin(user)
      ? ALL_BUDGET_PERMISSIONS
      : this.mergePermissions(
          assignments.map((a) => a.role?.permissions || []),
        );

    return {
      authenticated: true,
      user,
      roles,
      permissions,
      canView: hasAction(permissions, BUDGET_FEATURE_KEY, 'view'),
      canUpload: hasAction(permissions, BUDGET_FEATURE_KEY, 'create'),
      canDelete: hasAction(permissions, BUDGET_FEATURE_KEY, 'delete'),
      canExport: hasAction(permissions, BUDGET_FEATURE_KEY, 'export'),
      canManageUsers: canManageUsers(user),
    };
  }
}
