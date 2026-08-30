import {
  filterRows,
  leadingCode,
  nodeAt,
  overspentCategoryCount,
  overspentLineCount,
  sortRows,
} from './drill';
import { BudgetModel, CategoryNode, DrillRow, LineItem } from './models';

function line(name: string, consumable: number, consumed: number, row = 1): LineItem {
  return {
    name,
    row,
    values: { consumable, consumed, available: consumable - consumed },
  };
}

function cat(name: string, subs: LineItem[], row = 1): CategoryNode {
  const total = subs.reduce(
    (a, s) => ({
      consumable: a.consumable + s.values.consumable,
      consumed: a.consumed + s.values.consumed,
      available: a.available + s.values.available,
    }),
    { consumable: 0, consumed: 0, available: 0 },
  );
  return { name, row, values: total, subs };
}

const cats: CategoryNode[] = [
  cat('660 - Repairs', [line('900111101 Pipe repair', 100, 120), line('900111102 Valves', 400, 100)]),
  cat('684 - Insurance', [line('900222201 Fire cover', 1000, 250)]),
];

const model: BudgetModel = {
  fileName: 'export.xlsx',
  kind: 'xlsx',
  sheetName: 'Sheet1',
  sheetIdx: 0,
  headers: [],
  hIdx: 0,
  map: { label: 0, consumable: 1, consumed: 2, available: 3 },
  rowCount: 5,
  cats,
  headings: [],
  department: null,
  grandRow: null,
  deptName: '151100101 Sui (Prod)',
  total: { consumable: 1500, consumed: 470, available: 1030 },
  unknown: [],
  findings: [],
  lineCount: 3,
};

describe('drill-down', () => {
  it('shows the department roll-up at the root', () => {
    const node = nodeAt(model, []);
    expect(node.isRoot).toBeTrue();
    expect(node.name).toBe('151100101 Sui (Prod)');
    expect(node.children.length).toBe(2);
    expect(node.values.consumable).toBe(1500);
  });

  it('shows one category’s commitment items after a drill', () => {
    const node = nodeAt(model, [0]);
    expect(node.isRoot).toBeFalse();
    expect(node.name).toBe('660 - Repairs');
    expect(node.children.map((c) => c.name)).toEqual([
      '900111101 Pipe repair',
      '900111102 Valves',
    ]);
  });

  it('falls back to the root when the path points nowhere', () => {
    expect(nodeAt(model, [99]).isRoot).toBeTrue();
    expect(nodeAt(null, []).children).toEqual([]);
  });

  it('counts overspent line items across the whole tree at root', () => {
    // The 660 category nets positive, but one of its lines is overspent.
    expect(model.cats[0].values.available).toBeGreaterThan(0);
    expect(overspentLineCount(model, [])).toBe(1);
    expect(overspentLineCount(model, [1])).toBe(0);
    expect(overspentCategoryCount(model)).toBe(0);
  });
});

describe('row filtering and sorting', () => {
  const rows = nodeAt(model, []).children;

  it('filters case-insensitively on the name', () => {
    expect(filterRows(rows, 'insurance').map((r) => r.name)).toEqual(['684 - Insurance']);
    expect(filterRows(rows, '   ').length).toBe(2);
  });

  it('sorts descending on a measure', () => {
    const sorted = sortRows(rows, 'consumable', -1);
    expect(sorted[0].name).toBe('684 - Insurance');
  });

  it('sorts by utilisation, parking unmeasurable rows last', () => {
    const withZero: DrillRow[] = [...rows, { ...line('Empty', 0, 0), index: 2 }];
    const sorted = sortRows(withZero, 'util', -1);
    expect(sorted[sorted.length - 1].name).toBe('Empty');
  });

  it('sorts by the leading id in either direction', () => {
    expect(sortRows(rows, 'code', 1).map((r) => r.name)).toEqual([
      '660 - Repairs',
      '684 - Insurance',
    ]);
    expect(sortRows(rows, 'code', -1)[0].name).toBe('684 - Insurance');
  });

  it('orders ids numerically, not as text', () => {
    // Commitment item ids share a width, but a plain string sort would still
    // put '900102052' before '900111101' only by luck of equal length.
    const subs: DrillRow[] = [
      { ...line('900111101  Cash Insurance', 10, 1), index: 0 },
      { ...line('90099  Short code', 10, 1), index: 1 },
      { ...line('900102052  Mat & Spare', 10, 1), index: 2 },
    ];
    expect(sortRows(subs, 'code', 1).map((r) => leadingCode(r.name))).toEqual([
      90099, 900102052, 900111101,
    ]);
  });

  it('parks uncoded rows last in either direction', () => {
    const mixed: DrillRow[] = [...rows, { ...line('Unallocated', 5, 1), index: 2 }];
    expect(sortRows(mixed, 'code', 1)[2].name).toBe('Unallocated');
    expect(sortRows(mixed, 'code', -1)[2].name).toBe('Unallocated');
  });

  it('sorts by name ascending when direction is 1', () => {
    expect(sortRows(rows, 'name', 1)[0].name).toBe('684 - Insurance');
    expect(sortRows(rows, 'name', -1)[0].name).toBe('660 - Repairs');
  });

  it('does not mutate the source array', () => {
    const before = rows.map((r) => r.name);
    sortRows(rows, 'consumed', 1);
    expect(rows.map((r) => r.name)).toEqual(before);
  });
});
