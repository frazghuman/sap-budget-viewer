import {
  formatCompact,
  formatFull,
  formatPercent,
  formatValue,
  meterWidth,
  parseNumber,
  percent,
  safeFileName,
  toCsv,
  toNumber,
} from './format';

describe('number parsing', () => {
  it('reads plain and separated figures', () => {
    expect(parseNumber(1234.5)).toBe(1234.5);
    expect(parseNumber('1,234.50')).toBe(1234.5);
    expect(parseNumber('PKR 1,234')).toBe(1234);
  });

  it('reads the SAP trailing-minus and parenthesised negatives', () => {
    expect(parseNumber('1,234.50-')).toBe(-1234.5);
    expect(parseNumber('(1,234.50)')).toBe(-1234.5);
  });

  it('returns null rather than a silent zero for non-figures', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('-')).toBeNull();
    expect(parseNumber('n/a')).toBeNull();
    expect(parseNumber(null)).toBeNull();
    expect(toNumber('n/a')).toBe(0);
  });
});

describe('value formatting', () => {
  it('renders full precision with grouping', () => {
    expect(formatFull(835999744.33)).toBe('835,999,744.33');
    expect(formatFull(1000)).toBe('1,000');
    expect(formatFull(null)).toBe('—');
  });

  it('renders compact magnitudes', () => {
    expect(formatCompact(836000000)).toBe('836M');
    expect(formatCompact(1500)).toBe('1.5K');
    expect(formatCompact(-2500000000)).toBe('-2.5B');
    expect(formatCompact(42)).toBe('42');
  });

  it('switches on the units setting', () => {
    expect(formatValue(836000000, 'compact')).toBe('836M');
    expect(formatValue(836000000, 'full')).toBe('836,000,000');
  });
});

describe('percentages', () => {
  it('guards against a zero budget', () => {
    expect(percent(50, 0)).toBeNull();
    expect(formatPercent(percent(50, 0))).toBe('—');
  });

  it('caps runaway utilisation at a readable label', () => {
    expect(formatPercent(percent(50, 100))).toBe('50.0%');
    expect(formatPercent(percent(50000, 1))).toBe('>999%');
  });

  it('clamps meter widths so an overspend never paints past its track', () => {
    expect(meterWidth(140)).toBe(100);
    expect(meterWidth(-20)).toBe(0);
    expect(meterWidth(null)).toBe(0);
    expect(meterWidth(63.4)).toBe(63.4);
  });
});

describe('export helpers', () => {
  it('quotes CSV fields and keeps numbers bare', () => {
    const csv = toCsv([
      ['Name', 'Amount'],
      ['Repairs & Maint, "660"', 1234.5],
    ]);
    expect(csv.startsWith('\ufeff')).toBeTrue();
    expect(csv).toContain('"Repairs & Maint, ""660""",1234.5');
  });

  it('produces a safe download name', () => {
    expect(safeFileName('684 - Insurance Premium')).toBe('684_Insurance_Premium');
    expect(safeFileName('***')).toBe('budget');
  });
});
