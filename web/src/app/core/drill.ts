import { percent } from './format';
import { BudgetModel, DrillNode, DrillRow, SortKey } from './models';

/**
 * The level currently in view: the department roll-up at the root, or one
 * category's commitment items after a drill-down.
 */
export function nodeAt(model: BudgetModel | null, path: number[]): DrillNode {
  if (!model) {
    return {
      name: 'No dataset',
      values: { consumable: 0, consumed: 0, available: 0 },
      children: [],
      isRoot: true,
    };
  }
  if (!path.length) {
    return {
      name: model.deptName || 'All funds centres',
      values: model.total,
      children: model.cats.map((c, index) => ({ ...c, index })),
      isRoot: true,
    };
  }
  const cat = model.cats[path[0]];
  if (!cat) return nodeAt(model, []);
  return {
    name: cat.name,
    values: cat.values,
    children: cat.subs.map((s, index) => ({ ...s, index })),
    isRoot: false,
  };
}

export function filterRows(rows: DrillRow[], query: string): DrillRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => r.name.toLowerCase().includes(q));
}

/**
 * The leading numeric code on a row label — the category id at root
 * (`684 - Insurance Premium`), the commitment item id one level down
 * (`900111101  Insurance Exp - Cash Insurance`). Null when a label carries
 * no code, so those rows can be kept together at the end.
 */
export function leadingCode(name: string): number | null {
  const m = /^\s*(\d+)/.exec(name);
  return m ? Number(m[1]) : null;
}

export function sortRows(rows: DrillRow[], key: SortKey, dir: 1 | -1): DrillRow[] {
  const sorted = rows.slice();
  sorted.sort((a, b) => {
    if (key === 'name') return a.name.localeCompare(b.name) * (dir < 0 ? 1 : -1);
    if (key === 'code') {
      const x = leadingCode(a.name);
      const y = leadingCode(b.name);
      // Uncoded rows sit last whichever way the sort runs.
      if (x == null || y == null) {
        if (x == null && y == null) return a.name.localeCompare(b.name);
        return x == null ? 1 : -1;
      }
      return (x - y) * dir;
    }
    let x: number;
    let y: number;
    if (key === 'util') {
      x = percent(a.values.consumed, a.values.consumable) ?? -Infinity;
      y = percent(b.values.consumed, b.values.consumable) ?? -Infinity;
    } else {
      x = a.values[key];
      y = b.values[key];
    }
    return (x - y) * dir;
  });
  return sorted;
}

/**
 * Overspend is counted over the whole subtree at root level: categories can
 * net positive while commitment items underneath them are negative, and a
 * "0 overspent" tile beside an "11 overspent" finding is how a dashboard
 * loses trust.
 */
export function overspentLineCount(model: BudgetModel | null, path: number[]): number {
  if (!model) return 0;
  if (!path.length) {
    return model.cats.reduce(
      (a, c) => a + c.subs.filter((s) => s.values.available < 0).length,
      0,
    );
  }
  const cat = model.cats[path[0]];
  return cat ? cat.subs.filter((s) => s.values.available < 0).length : 0;
}

export function overspentCategoryCount(model: BudgetModel | null): number {
  if (!model) return 0;
  return model.cats.filter((c) => c.values.available < 0).length;
}
