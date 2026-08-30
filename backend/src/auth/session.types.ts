export interface SessionUser {
  sub: string;
  email: string;
  userType: string;
  firstName?: string;
  lastName?: string;
  displayName: string;
  photoUrl?: string;
}

export interface SessionPermission {
  featureKey: string;
  actions: string[];
}

export interface SessionResponse {
  authenticated: boolean;
  user?: SessionUser;
  roles?: { key: string; name: string }[];
  permissions?: SessionPermission[];
  canView: boolean;
  canUpload: boolean;
  canDelete: boolean;
  canExport: boolean;
  /** May open the user invitation centre. */
  canManageUsers: boolean;
}
