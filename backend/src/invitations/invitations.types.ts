import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import type { SessionUser } from '../auth/session.types';

/**
 * User types CaaS One accepts on `POST /users/invite` and `POST /roles/assign`.
 * A branch admin can read the user list but cannot invite, so it is absent.
 */
const MANAGER_TYPES = new Set(['platform_admin', 'company_admin', 'tenant_admin']);

export function canManageUsers(user: Pick<SessionUser, 'userType'>): boolean {
  return MANAGER_TYPES.has(user.userType);
}

export class InviteDto {
  @IsEmail() email: string;
  @IsString() @MinLength(1) firstName: string;
  @IsString() @MinLength(1) lastName: string;
  @IsString() @MinLength(1) roleId: string;
  @IsOptional() @IsString() userType?: string;
  @IsOptional() @IsString() company?: string;
  @IsOptional() @IsString() tenant?: string;
  @IsOptional() @IsString() branch?: string;
}

export class AssignRoleDto {
  @IsString() @MinLength(1) userId: string;
  @IsString() @MinLength(1) roleId: string;
  @IsOptional() @IsString() assignmentId?: string;
}

export interface AppRole {
  id: string;
  name: string;
}

/** One row in the invitation centre — a person's access to *this* app. */
export interface AppMember {
  assignmentId: string;
  userId: string;
  name: string;
  email: string;
  photoUrl: string;
  /** active | pending | suspended | locked — from the CaaS One account. */
  status: string;
  roleId: string;
  roleName: string;
  createdAt?: string;
}

export interface InvitationCentre {
  members: AppMember[];
  roles: AppRole[];
  /** True when `roles` was recovered from assignments, not listed by CaaS One. */
  rolesDerived: boolean;
}
