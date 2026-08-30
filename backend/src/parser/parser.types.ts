export type SheetRows = (string | number | null | undefined)[][];

export interface WorkbookSheet {
  name: string;
  rows: SheetRows;
}

export interface WorkbookSource {
  fileName: string;
  kind: 'xlsx' | 'xls' | 'text';
  delim?: string;
  sheets: WorkbookSheet[];
}

export interface ColumnMap {
  label: number;
  consumable: number;
  consumed: number;
  available: number;
}

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

export interface Finding {
  level: 'ok' | 'warn' | 'crit';
  title: string;
  detail: string;
}

/**
 * Code widths observed in the sheet. Hierarchy depth is inferred from the
 * data instead of assuming SAP's usual 3-digit groups / 9-digit commitment
 * items, so an export that numbers its groups differently still parses.
 */
export interface CodeProfile {
  /** Width that marks a commitment item. `-1` when every code shares one width. */
  lineLen: number;
  /** Widths treated as category/group levels. */
  categoryLens: number[];
  /** Occurrences per code width, for diagnostics. */
  counts: Record<string, number>;
  /** False when no leading codes were found and defaults were used. */
  derived: boolean;
}

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
  /** Code widths used to build the hierarchy. */
  codeProfile?: CodeProfile;
  /** Rows carrying values that had no label text in any column. */
  skipped?: LineItem[];
}

export interface InspectResult {
  source: {
    fileName: string;
    kind: string;
    delim?: string;
    sheets: { name: string; rowCount: number }[];
  };
  sheetIdx: number;
  headers: string[];
  map: ColumnMap;
  model: BudgetModel;
}
