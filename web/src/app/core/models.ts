/**
 * Wire contracts shared with the NestJS backend
 * (`backend/src/parser/parser.types.ts`, `backend/src/auth/session.types.ts`).
 */

export interface MoneyValues {
  consumable: number;
  consumed: number;
  available: number;
}

export interface LineItem {
  name: string;
  values: MoneyValues;
  row: number;
  why?: string;
}

export interface CategoryNode extends LineItem {
  subs: LineItem[];
}

export type FindingLevel = 'ok' | 'info' | 'warn' | 'crit';

export interface Finding {
  level: FindingLevel;
  title: string;
  detail: string;
}

export interface ColumnMap {
  label: number;
  consumable: number;
  consumed: number;
  available: number;
}

export type ColumnMapKey = keyof ColumnMap;

export const COLUMN_MAP_KEYS: ColumnMapKey[] = ['label', 'consumable', 'consumed', 'available'];

export interface BudgetModel {
  fileName: string;
  kind: string;
  delim?: string;
  sheetName: string;
  sheetIdx: number;
  headers: string[];
  hIdx: number;
  map: ColumnMap;
  rowCount: number;
  cats: CategoryNode[];
  headings: LineItem[];
  department: LineItem | null;
  grandRow: LineItem | null;
  deptName: string | null;
  total: MoneyValues;
  unknown: LineItem[];
  findings: Finding[];
  lineCount: number;
  /** Code widths the parser inferred for this sheet. */
  codeProfile?: CodeProfile;
  /** Rows that carried amounts but had no readable label. */
  skipped?: LineItem[];
}

export interface CodeProfile {
  lineLen: number;
  categoryLens: number[];
  counts: Record<string, number>;
  derived: boolean;
}

export interface SourceSheet {
  name: string;
  rowCount: number;
}

export interface InspectResult {
  source: {
    fileName: string;
    kind: string;
    delim?: string;
    sheets: SourceSheet[];
  };
  sheetIdx: number;
  headers: string[];
  map: ColumnMap;
  model: BudgetModel;
}

export interface DatasetSummary {
  id: string;
  fileName: string;
  kind: string;
  sheetName: string;
  deptName: string | null;
  rowCount: number;
  lineCount: number;
  categoryCount: number;
  total: MoneyValues;
  uploadedByName: string | null;
  uploadedByEmail: string | null;
  createdAt?: string;
}

export interface DatasetDetail extends DatasetSummary {
  model: BudgetModel;
}

/* ------------------------------------------------------------------ auth */

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

export interface SessionRole {
  key: string;
  name: string;
}

export interface SessionResponse {
  authenticated: boolean;
  user?: SessionUser;
  roles?: SessionRole[];
  permissions?: SessionPermission[];
  canView: boolean;
  canUpload: boolean;
  canDelete?: boolean;
  canExport: boolean;
  /** May open Settings and the user invitation centre. */
  canManageUsers?: boolean;
}

export const ANONYMOUS_SESSION: SessionResponse = {
  authenticated: false,
  canView: false,
  canUpload: false,
  canDelete: false,
  canExport: false,
  canManageUsers: false,
};

/* --------------------------------------------------- invitation centre */

/** A person's access to *this* application, not their whole CaaS account. */
export interface AppMember {
  assignmentId: string;
  userId: string;
  name: string;
  email: string;
  photoUrl: string;
  status: string;
  roleId: string;
  roleName: string;
  createdAt?: string;
}

export interface AppRole {
  id: string;
  name: string;
}

export interface InvitationCenter {
  members: AppMember[];
  roles: AppRole[];
  /** True when roles were recovered from assignments, not listed by CaaS One. */
  rolesDerived?: boolean;
}

export interface InviteRequest {
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
}

/* --------------------------------------------------------- view models */

export type DashboardView = 'chart' | 'table';
export type DashboardScale = 'absolute' | 'utilization';
export type Units = 'compact' | 'full';
export type SortKey = 'code' | 'name' | 'consumable' | 'consumed' | 'available' | 'util';

/** A row at the level currently being shown — a category at root, a line item below it. */
export interface DrillRow extends LineItem {
  subs?: LineItem[];
  index: number;
}

export interface DrillNode {
  name: string;
  values: MoneyValues;
  children: DrillRow[];
  isRoot: boolean;
}

/** State of a dataset's public, view-only link. */
export interface ShareState {
  shared: boolean;
  token: string | null;
  sharedAt: string | null;
}
