import { MoneyValues, Units } from './models';

/**
 * SAP exports carry parenthesised and trailing-minus negatives, thousands
 * separators and stray currency marks; anything that is not a real figure
 * becomes `null` rather than a silent zero.
 */
export function parseNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return isFinite(value) ? value : null;
  let s = String(value).trim();
  if (!s || s === '-' || s === '--') return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (/-$/.test(s)) {
    neg = true;
    s = s.slice(0, -1);
  }
  s = s.replace(/[^0-9.\-]/g, '');
  if (s === '' || s === '-' || s === '.') return null;
  const n = parseFloat(s);
  if (!isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
}

export function toNumber(value: unknown): number {
  const n = parseNumber(value);
  return n == null ? 0 : n;
}

export function formatFull(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  const d = Math.abs(n % 1) > 1e-9 ? 2 : 0;
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: 2 });
}

export function formatCompact(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e9) return sign + trimZeros((a / 1e9).toFixed(2)) + 'B';
  if (a >= 1e6) return sign + trimZeros((a / 1e6).toFixed(2)) + 'M';
  if (a >= 1e3) return sign + trimZeros((a / 1e3).toFixed(1)) + 'K';
  return sign + (a % 1 ? a.toFixed(2) : String(a));
}

function trimZeros(s: string): string {
  return s.replace(/\.?0+$/, '');
}

export function formatValue(n: number | null | undefined, units: Units): string {
  return units === 'full' ? formatFull(n) : formatCompact(n);
}

export function percent(part: number, whole: number): number | null {
  if (!whole || !isFinite(whole) || whole === 0) return null;
  return (part / whole) * 100;
}

export function formatPercent(p: number | null): string {
  if (p == null) return '—';
  return (Math.abs(p) >= 1000 ? '>999' : p.toFixed(1)) + '%';
}

/** Meter widths are clamped so an overspend never paints past its track. */
export function meterWidth(p: number | null): number {
  if (p == null || !isFinite(p)) return 0;
  return Math.max(0, Math.min(100, p));
}

export function sumValues(list: { values: MoneyValues }[]): MoneyValues {
  return list.reduce<MoneyValues>(
    (a, n) => ({
      consumable: a.consumable + n.values.consumable,
      consumed: a.consumed + n.values.consumed,
      available: a.available + n.values.available,
    }),
    { consumable: 0, consumed: 0, available: 0 },
  );
}

export function safeFileName(name: string, fallback = 'budget'): string {
  const cleaned = name.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return cleaned || fallback;
}

export function toCsv(rows: (string | number)[][]): string {
  const quote = (v: string | number) =>
    typeof v === 'number' ? String(v) : '"' + String(v).replace(/"/g, '""') + '"';
  return '\ufeff' + rows.map((r) => r.map(quote).join(',')).join('\r\n');
}

/** Up to two initials for an avatar, falling back to the first character. */
export function initialsOf(name: string): string {
  const parts = String(name ?? '')
    .trim()
    .split(/[\s@._-]+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  const letters = parts.slice(0, 2).map((p) => p[0]);
  return letters.join('').toUpperCase();
}
