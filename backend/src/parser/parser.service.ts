import { BadRequestException, Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import {
  BudgetModel,
  CategoryNode,
  CodeProfile,
  ColumnMap,
  Finding,
  InspectResult,
  LineItem,
  MoneyValues,
  SheetRows,
  WorkbookSource,
} from './parser.types';

const HDR_HINTS = [
  'funds center',
  'fundscenter',
  'commitment item',
  'cmmtitem',
  'consumable',
  'consumed',
  'available',
  'current budget',
  'commitment',
  'actual',
  'title',
];

const CAT_DIGITS = 3;
const SUB_DIGITS = 9;
const LEAD_CODE = /^\s*(\d+)(?!\d)/;

/** Used only when a sheet has no leading codes at all. */
const DEFAULT_PROFILE: CodeProfile = {
  lineLen: SUB_DIGITS,
  categoryLens: [CAT_DIGITS],
  counts: {},
  derived: false,
};

@Injectable()
export class ParserService {
  parseNumber(v: unknown): number | null {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v !== 'string') return null;
    let s = v.trim();
    if (!s || s === '-' || s === '--') return null;
    // A label such as "669-Repairs & Maint" must never read as the number 669;
    // treating it as numeric skews column detection and can misclassify rows.
    if (/[A-Za-z]/.test(s)) return null;
    let neg = false;
    if (/^\(.*\)$/.test(s)) {
      neg = true;
      s = s.slice(1, -1);
    }
    if (/-$/.test(s)) {
      neg = true;
      s = s.slice(0, -1);
    }
    if (/^-/.test(s)) {
      neg = true;
      s = s.slice(1);
    }
    s = s.replace(/[^0-9.]/g, '');
    if (s === '' || s === '.') return null;
    const n = parseFloat(s);
    if (!Number.isFinite(n)) return null;
    return neg ? -Math.abs(n) : n;
  }

  private cellText(row: SheetRows[number], c: number | null | undefined) {
    if (c == null || c < 0) return '';
    const v = row[c];
    return v == null ? '' : String(v).trim();
  }

  /**
   * The label for a row. SAP exports sometimes shift the description into a
   * neighbouring column (indented hierarchy levels, merged cells), so fall
   * back to the first text-bearing cell rather than discarding the row.
   */
  resolveLabel(row: SheetRows[number], labelCol: number): string {
    const direct = this.cellText(row, labelCol);
    if (direct) return direct;
    for (let c = 0; c < row.length; c++) {
      if (c === labelCol) continue;
      const s = this.cellText(row, c);
      // Require letters so a measure cell is never mistaken for a label.
      if (s && /[A-Za-z]/.test(s)) return s;
    }
    return '';
  }

  private leadingCode(name: string): { code: string | null; len: number } {
    const m = name.trim().match(LEAD_CODE);
    if (!m) return { code: null, len: 0 };
    return { code: m[1], len: m[1].length };
  }

  /**
   * Infers which code widths are groups and which are commitment items.
   * The widest frequently-used width is the line-item level; anything shorter
   * is a group. This keeps 3-digit/9-digit SAP files working while stopping
   * a 4-digit group code from being discarded as unclassifiable.
   */
  buildCodeProfile(body: SheetRows, labelCol: number): CodeProfile {
    const counts = new Map<number, number>();
    for (const row of body) {
      const name = this.resolveLabel(row, labelCol);
      if (!name) continue;
      const { len } = this.leadingCode(name);
      if (!len) continue;
      counts.set(len, (counts.get(len) ?? 0) + 1);
    }

    const lens = [...counts.keys()].sort((a, b) => a - b);
    const asRecord: Record<string, number> = {};
    for (const l of lens) asRecord[String(l)] = counts.get(l) as number;

    if (!lens.length) return { ...DEFAULT_PROFILE, counts: asRecord };

    if (lens.length === 1) {
      // One width throughout: a group-level export with no commitment items
      // beneath it. Every coded row is a category.
      return {
        lineLen: -1,
        categoryLens: lens,
        counts: asRecord,
        derived: true,
      };
    }

    let lineLen = lens[0];
    let best = -1;
    for (const l of lens) {
      const n = counts.get(l) as number;
      if (n >= best) {
        best = n;
        lineLen = l;
      }
    }
    // If the narrowest width is also the most common one, it is the group
    // level, so the line-item level must be the widest width present.
    if (lineLen === lens[0]) lineLen = lens[lens.length - 1];

    return {
      lineLen,
      categoryLens: lens.filter((l) => l < lineLen),
      counts: asRecord,
      derived: true,
    };
  }

  classifyByProfile(
    name: string,
    seenCategory: boolean,
    profile: CodeProfile,
  ): { tag: string; why: string } {
    const c = this.leadingCode(name);
    if (!c.len) {
      return seenCategory
        ? { tag: 'Unknown', why: 'no leading code' }
        : { tag: 'Heading', why: 'no leading code, above the first category' };
    }
    if (profile.lineLen < 0) {
      return {
        tag: 'Category',
        why: `${c.code} — ${c.len}-digit group code (single-level export)`,
      };
    }
    if (c.len < profile.lineLen) {
      return { tag: 'Category', why: `${c.code} — ${c.len}-digit group code` };
    }
    return seenCategory
      ? {
          tag: 'Sub-Category',
          why: `${c.code} — ${c.len}-digit commitment item code`,
        }
      : {
          tag: 'Heading',
          why: `${c.code} — funds centre code above the first category`,
        };
  }

  private numOrZero(v: unknown): number {
    const n = this.parseNumber(v);
    return n == null ? 0 : n;
  }

  sniffDelim(text: string): string {
    const head = text.slice(0, 8000).split(/\r?\n/).slice(0, 12);
    const cand = ['\t', ',', ';', '|'];
    let best = '\t';
    let bestScore = -1;
    for (const d of cand) {
      const counts = head
        .map((l) => l.split(d).length - 1)
        .filter((c) => c > 0);
      if (counts.length < 2) continue;
      const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
      const varc =
        counts.reduce((a, b) => a + Math.pow(b - avg, 2), 0) / counts.length;
      const score = avg - varc;
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    return best;
  }

  /**
   * One pass over the text. Reports whether it ended mid-quote so the caller
   * can retry; `quoting` off treats `"` as ordinary data.
   *
   * A quote opens a quoted field only as the field's first character, per
   * RFC 4180. SAP truncates long labels mid-string and leaves the opening
   * quote dangling — `900110006  "Rent, Rates & Taxes HQ Services - Rent,` —
   * and honouring that mid-field quote swallowed every row up to the next one.
   */
  private scanDelimited(
    text: string,
    d: string,
    quoting: boolean,
  ): { rows: string[][]; unterminated: boolean } {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i++;
          } else {
            q = false;
          }
        } else {
          cell += c;
        }
      } else if (quoting && c === '"' && cell === '') {
        q = true;
      } else if (c === d) {
        row.push(cell);
        cell = '';
      } else if (c === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else if (c === '\r') {
        /* skip */
      } else {
        cell += c;
      }
    }
    if (cell !== '' || row.length) {
      row.push(cell);
      rows.push(row);
    }
    return { rows, unterminated: q };
  }

  parseDelimited(text: string, d: string): string[][] {
    text = text.replace(/^\uFEFF/, '');
    let { rows, unterminated } = this.scanDelimited(text, d, true);
    // An unclosed quote means the rest of the file was absorbed into one cell.
    // Literal quotes are likelier than a genuinely truncated export, so redo
    // the pass without quoting rather than hand back a collapsed sheet.
    if (unterminated) rows = this.scanDelimited(text, d, false).rows;
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }

  readWorkbook(buffer: Buffer, fileName: string): WorkbookSource {
    try {
      const buf = new Uint8Array(buffer);
      const sig4 = Array.from(buf.slice(0, 4))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      const isOle = sig4 === 'd0cf11e0';
      const isZip = sig4.slice(0, 4) === '504b';

      if (isOle || isZip) {
        const wb = XLSX.read(buf, {
          type: 'array',
          cellDates: false,
          raw: true,
        });
        const sheets = wb.SheetNames.map((nm) => ({
          name: nm,
          rows: XLSX.utils.sheet_to_json<SheetRows[number]>(wb.Sheets[nm], {
            header: 1,
            raw: true,
            defval: '',
            blankrows: false,
          }),
        })).filter((s) => s.rows.length);
        if (!sheets.length) {
          throw new BadRequestException(
            'The workbook contains no readable sheets.',
          );
        }
        return {
          fileName,
          kind: isZip ? 'xlsx' : 'xls',
          sheets,
        };
      }

      let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      if (/\uFFFD/.test(text.slice(0, 2000))) {
        text = new TextDecoder('windows-1252').decode(buf);
      }
      const d = this.sniffDelim(text);
      const rows = this.parseDelimited(text, d);
      if (!rows.length) {
        throw new BadRequestException('The file appears to be empty.');
      }
      return {
        fileName,
        kind: 'text',
        delim: d,
        sheets: [{ name: 'Sheet 1', rows }],
      };
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw new BadRequestException(`Parse failed: ${msg}`);
    }
  }

  findHeaderRow(rows: SheetRows): number {
    const lim = Math.min(rows.length, 25);
    for (let i = 0; i < lim; i++) {
      const cells = rows[i].map((c) => String(c).toLowerCase().trim());
      const hits = cells.filter(
        (c) => c && HDR_HINTS.some((h) => c.indexOf(h) >= 0),
      ).length;
      if (hits >= 2) return i;
    }
    return 0;
  }

  autoMap(headers: string[], body: SheetRows): ColumnMap {
    const H = headers.map((h) =>
      String(h).toLowerCase().replace(/\s+/g, ' ').trim(),
    );
    // Data rows can be wider than the header row; ignoring the overflow hides
    // measure columns from detection entirely.
    let nCols = headers.length;
    for (const r of body) if (r.length > nCols) nCols = r.length;

    const findBy = (...tests: ((h: string) => boolean)[]): number => {
      for (const t of tests) {
        const i = H.findIndex((h) => h && t(h));
        if (i >= 0) return i;
      }
      return -1;
    };

    const dens: number[] = [];
    const filled: number[] = [];
    for (let c = 0; c < nCols; c++) {
      let n = 0;
      let t = 0;
      for (let r = 0; r < body.length; r++) {
        const v = body[r][c];
        if (v === '' || v == null) continue;
        t++;
        if (this.parseNumber(v) != null) n++;
      }
      filled[c] = t;
      dens[c] = t ? n / t : 0;
    }

    let label = findBy(
      (h) => h.indexOf('funds center') >= 0 || h.indexOf('fundscenter') >= 0,
      (h) => h.indexOf('commitment item') >= 0 || h.indexOf('cmmtitem') >= 0,
      (h) => h.indexOf('description') >= 0 || h.indexOf('item') >= 0,
    );
    // An empty column scores 0 density, so it must be excluded or it wins the
    // label slot and every row ends up with a blank name.
    if (label < 0) {
      label = dens.findIndex((d, c) => filled[c] > 0 && d < 0.3);
    }
    if (label < 0) label = 0;

    const numCols: number[] = [];
    for (let c = 0; c < nCols; c++) {
      if (c !== label && filled[c] > 0 && dens[c] >= 0.6) numCols.push(c);
    }

    let consumable = findBy((h) => h.indexOf('consumable') >= 0);
    let consumed = findBy((h) => h.indexOf('consumed') >= 0);
    let available = findBy((h) => h.indexOf('available') >= 0);
    if (consumable < 0) consumable = numCols[0] != null ? numCols[0] : -1;
    if (consumed < 0) consumed = numCols[1] != null ? numCols[1] : -1;
    if (available < 0) available = numCols[2] != null ? numCols[2] : -1;

    return { label, consumable, consumed, available };
  }

  codeOf(name: unknown): {
    kind: 'none' | 'short' | 'long' | 'odd';
    code: string | null;
    len: number;
  } {
    const raw = typeof name === 'string' ? name : '';
    const m = raw.trim().match(LEAD_CODE);
    if (!m) return { kind: 'none', code: null, len: 0 };
    const len = m[1].length;
    return {
      kind: len === CAT_DIGITS ? 'short' : len === SUB_DIGITS ? 'long' : 'odd',
      code: m[1],
      len,
    };
  }

  classifyByCode(
    name: string,
    seenCategory: boolean,
  ): { tag: string; why: string } {
    const c = this.codeOf(name);
    if (c.kind === 'short') {
      return {
        tag: 'Category',
        why: `${c.code} — ${CAT_DIGITS}-digit group code`,
      };
    }
    if (c.kind === 'long') {
      return seenCategory
        ? {
            tag: 'Sub-Category',
            why: `${c.code} — ${SUB_DIGITS}-digit commitment item code`,
          }
        : {
            tag: 'Heading',
            why: `${c.code} — funds centre code above the first category`,
          };
    }
    if (c.kind === 'odd') {
      return seenCategory
        ? {
            tag: 'Unknown',
            why: `${c.code} — ${c.len}-digit code, neither ${CAT_DIGITS} nor ${SUB_DIGITS}`,
          }
        : {
            tag: 'Heading',
            why: `${c.code} — ${c.len}-digit code above the first category`,
          };
    }
    return seenCategory
      ? { tag: 'Unknown', why: 'no leading code' }
      : {
          tag: 'Heading',
          why: 'no leading code, above the first category',
        };
  }

  buildModel(
    src: WorkbookSource,
    sheetIdx: number,
    map: ColumnMap,
  ): BudgetModel {
    const sheet = src.sheets[sheetIdx];
    if (!sheet) {
      throw new BadRequestException(`Sheet index ${sheetIdx} is out of range.`);
    }

    const hIdx = this.findHeaderRow(sheet.rows);
    const headers = sheet.rows[hIdx].map((h) => String(h).trim());
    const body = sheet.rows.slice(hIdx + 1);

    const G = (r: SheetRows[number], c: number | null | undefined) =>
      c == null || c < 0 ? '' : r[c] == null ? '' : r[c];
    const vals = (r: SheetRows[number]): MoneyValues => ({
      consumable: this.numOrZero(G(r, map.consumable)),
      consumed: this.numOrZero(G(r, map.consumed)),
      available: this.numOrZero(G(r, map.available)),
    });

    const unknown: LineItem[] = [];
    const skipped: LineItem[] = [];
    const cats: CategoryNode[] = [];
    const headings: LineItem[] = [];
    let cur: CategoryNode | null = null;

    const codeProfile = this.buildCodeProfile(body, map.label);

    body.forEach((r, i) => {
      const rowNo = hIdx + 2 + i;
      const name = this.resolveLabel(r, map.label);
      const values = vals(r);

      if (!name) {
        // Report rows that carry money but no readable label instead of
        // dropping them, otherwise budget silently disappears from the totals.
        if (values.consumable || values.consumed || values.available) {
          skipped.push({
            name: '(unlabelled row)',
            values,
            row: rowNo,
            why: 'row carries values but no label text in any column',
          });
        }
        return;
      }

      const rec: LineItem = { name, values, row: rowNo };

      const v = this.classifyByProfile(name, cats.length > 0, codeProfile);
      rec.why = v.why;
      if (v.tag === 'Heading') {
        headings.push(rec);
        return;
      }
      if (v.tag === 'Category') {
        cur = { ...rec, subs: [] };
        cats.push(cur);
        return;
      }
      if (v.tag === 'Sub-Category') {
        if (cur) cur.subs.push(rec);
        else unknown.push(rec);
        return;
      }
      unknown.push(rec);
    });

    let departmentRow: LineItem | null = null;
    let grandRow: LineItem | null = null;
    for (const h of headings) {
      const { len } = this.leadingCode(h.name);
      if (len && len >= codeProfile.lineLen) departmentRow = h;
      else if (!grandRow) grandRow = h;
    }

    const sum = (list: LineItem[]): MoneyValues =>
      list.reduce(
        (a, n) => ({
          consumable: a.consumable + n.values.consumable,
          consumed: a.consumed + n.values.consumed,
          available: a.available + n.values.available,
        }),
        { consumable: 0, consumed: 0, available: 0 },
      );

    const rolled = sum(cats);
    const declaredRow = grandRow ?? departmentRow;
    const declared = declaredRow ? declaredRow.values : null;

    const findings = this.buildFindings(
      cats,
      unknown,
      departmentRow,
      grandRow,
      rolled,
      declared,
      codeProfile,
      skipped,
    );

    const allLines: LineItem[] = [];
    cats.forEach((c) => c.subs.forEach((s) => allLines.push(s)));

    return {
      fileName: src.fileName,
      kind: src.kind,
      delim: src.delim,
      sheetName: sheet.name,
      sheetIdx,
      headers,
      hIdx,
      map,
      rowCount: body.length,
      cats,
      headings,
      department: departmentRow,
      grandRow,
      deptName: departmentRow ? departmentRow.name : null,
      total: rolled,
      unknown,
      findings,
      lineCount: allLines.length,
      codeProfile,
      skipped,
    };
  }

  private fmtFull(n: number | null | undefined): string {
    if (n == null || !Number.isFinite(n)) return '—';
    const d = Math.abs(n % 1) > 1e-9 ? 2 : 0;
    return n.toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: 2,
    });
  }

  private near(a: number, b: number): boolean {
    return Math.abs(a - b) <= Math.max(0.5, Math.abs(b) * 1e-9);
  }

  private buildFindings(
    cats: CategoryNode[],
    unknown: LineItem[],
    department: LineItem | null,
    grandRow: LineItem | null,
    rolled: MoneyValues,
    declared: MoneyValues | null,
    profile: CodeProfile = DEFAULT_PROFILE,
    skipped: LineItem[] = [],
  ): Finding[] {
    const findings: Finding[] = [];
    const lineCount = cats.reduce((a, c) => a + c.subs.length, 0);

    const catWidths = profile.categoryLens.length
      ? profile.categoryLens.map((l) => `${l}-digit`).join(' / ')
      : `${CAT_DIGITS}-digit`;

    findings.push({
      level: 'ok',
      title: 'Hierarchy read from the leading code',
      detail:
        profile.lineLen < 0
          ? `No tag column used. Every code is ${catWidths}, so all ${cats.length} rows were read as categories with no commitment items beneath them${
              department
                ? `; department heading ${department.name.slice(0, 46)}`
                : ''
            }.`
          : `No tag column used. ${catWidths} codes opened ${cats.length} categories; ${profile.lineLen}-digit codes bound ${lineCount} line items to the category above them${
              department
                ? `; department heading ${department.name.slice(0, 46)}`
                : ''
            }.`,
    });

    if (skipped.length) {
      const skippedTotal = skipped.reduce((a, s) => a + s.values.consumable, 0);
      findings.push({
        level: 'crit',
        title: `${skipped.length} row${skipped.length > 1 ? 's carry' : ' carries'} values but no label`,
        detail: `Rows ${skipped
          .slice(0, 6)
          .map((s) => s.row)
          .join(', ')}${
          skipped.length > 6 ? ` …and ${skipped.length - 6} more` : ''
        } have amounts totalling ${this.fmtFull(skippedTotal)} consumable but no readable description in any column. Check the label column mapping.`,
      });
    }

    if (unknown.length) {
      const unkTotal = unknown.reduce((a, u) => a + u.values.consumable, 0);
      const samples = unknown
        .slice(0, 4)
        .map((u) => `row ${u.row} · ${u.name.slice(0, 40)} (${u.why})`)
        .join('; ');
      findings.push({
        level: 'crit',
        title: `${unknown.length} row${unknown.length > 1 ? 's could' : ' could'} not be placed in the hierarchy`,
        detail: `${samples}${
          unknown.length > 4 ? ` …and ${unknown.length - 4} more` : ''
        }. These are excluded from every total rather than guessed into a category — their values are ${this.fmtFull(unkTotal)} consumable.`,
      });
    }

    const sum = (list: LineItem[]): MoneyValues =>
      list.reduce(
        (a, n) => ({
          consumable: a.consumable + n.values.consumable,
          consumed: a.consumed + n.values.consumed,
          available: a.available + n.values.available,
        }),
        { consumable: 0, consumed: 0, available: 0 },
      );

    const mism = cats
      .map((c) => {
        const s = sum(c.subs);
        return {
          c,
          s,
          bad:
            c.subs.length > 0 &&
            !(
              this.near(s.consumable, c.values.consumable) &&
              this.near(s.consumed, c.values.consumed) &&
              this.near(s.available, c.values.available)
            ),
        };
      })
      .filter((x) => x.bad);

    if (mism.length) {
      findings.push({
        level: 'crit',
        title: `${mism.length} category subtotal${mism.length > 1 ? 's do' : ' does'} not match its lines`,
        detail: mism
          .map(
            (m) =>
              `${m.c.name.slice(0, 40)} header ${this.fmtFull(m.c.values.consumable)} vs lines ${this.fmtFull(m.s.consumable)}`,
          )
          .join('; '),
      });
    } else {
      findings.push({
        level: 'ok',
        title: 'Category subtotals reconcile',
        detail: `All ${cats.length} categories equal the sum of their sub-category lines across the three measures.`,
      });
    }

    if (declared) {
      const d = declared.consumable - rolled.consumable;
      if (this.near(rolled.consumable, declared.consumable)) {
        findings.push({
          level: 'ok',
          title: 'Grand total reconciles',
          detail: `Reported total ${this.fmtFull(declared.consumable)} equals the sum of all categories.`,
        });
      } else {
        findings.push({
          level: 'crit',
          title: `Grand total is out by ${this.fmtFull(Math.abs(d))}`,
          detail: `Report header states ${this.fmtFull(declared.consumable)}; categories sum to ${this.fmtFull(rolled.consumable)}.${
            Math.abs(d) > 0 ? ` Unattributed budget of ${this.fmtFull(d)}.` : ''
          }`,
        });
      }
    }

    const allLines: LineItem[] = [];
    cats.forEach((c) => c.subs.forEach((s) => allLines.push(s)));

    const over = allLines.filter((s) => s.values.available < 0);
    if (over.length) {
      findings.push({
        level: 'warn',
        title: `${over.length} line item${over.length > 1 ? 's are' : ' is'} overspent`,
        detail: `Available amount is negative on ${over.length} commitment item${over.length > 1 ? 's' : ''}, totalling ${this.fmtFull(over.reduce((a, s) => a + s.values.available, 0))}.`,
      });
    }

    const credits = [...cats, ...allLines].filter((n) => n.values.consumed < 0);
    if (credits.length) {
      const sorted = [...credits].sort(
        (a, b) => a.values.consumed - b.values.consumed,
      );
      findings.push({
        level: 'warn',
        title: `${credits.length} row${credits.length > 1 ? 's carry' : ' carries'} a negative consumed value`,
        detail: `Net-credit postings (reversals) invert utilisation. Largest: ${sorted[0].name.slice(0, 44)} at ${this.fmtFull(sorted[0].values.consumed)}.`,
      });
    }

    const ident = allLines.filter(
      (s) =>
        Math.abs(s.values.consumed + s.values.available - s.values.consumable) >
        0.5,
    );
    if (ident.length) {
      findings.push({
        level: 'warn',
        title: `${ident.length} line${ident.length > 1 ? 's break' : ' breaks'} the Consumed + Available = Consumable identity`,
        detail: 'Check for a filtered or partial export.',
      });
    } else {
      findings.push({
        level: 'ok',
        title: 'Measure identity holds',
        detail: 'Consumed + Available equals Consumable on every line item.',
      });
    }

    // A single-level export has no commitment items by definition, so an
    // "empty category" warning there would fire on every row for no reason.
    const emptyCats =
      profile.lineLen < 0 ? [] : cats.filter((c) => !c.subs.length);
    if (emptyCats.length) {
      findings.push({
        level: 'warn',
        title: `${emptyCats.length} categor${emptyCats.length > 1 ? 'ies have' : 'y has'} no line items`,
        detail: `No ${profile.lineLen}-digit commitment item followed: ${emptyCats
          .slice(0, 3)
          .map((c) => c.name.slice(0, 34))
          .join(', ')}.`,
      });
    }

    return findings;
  }

  inspect(
    buffer: Buffer,
    fileName: string,
    sheetIdx = 0,
    mapOverride?: ColumnMap,
  ): InspectResult {
    const src = this.readWorkbook(buffer, fileName);

    if (sheetIdx < 0 || sheetIdx >= src.sheets.length) {
      throw new BadRequestException(`Sheet index ${sheetIdx} is out of range.`);
    }

    const sheet = src.sheets[sheetIdx];
    const hIdx = this.findHeaderRow(sheet.rows);
    const headers = sheet.rows[hIdx].map((h) => String(h).trim());
    const body = sheet.rows.slice(hIdx + 1);

    const map = mapOverride ?? this.autoMap(headers, body);
    const missing = (
      ['label', 'consumable', 'consumed', 'available'] as const
    ).filter((k) => map[k] < 0);
    if (missing.length) {
      throw new BadRequestException(
        `Could not identify columns: ${missing.join(', ')}`,
      );
    }

    const model = this.buildModel(src, sheetIdx, map);

    return {
      source: {
        fileName: src.fileName,
        kind: src.kind,
        delim: src.delim,
        sheets: src.sheets.map((s) => ({
          name: s.name,
          rowCount: s.rows.length,
        })),
      },
      sheetIdx,
      headers,
      map,
      model,
    };
  }

  importModel(
    buffer: Buffer,
    fileName: string,
    sheetIdx: number,
    map: ColumnMap,
  ): BudgetModel {
    const result = this.inspect(buffer, fileName, sheetIdx, map);
    if (!result.model.cats.length) {
      throw new BadRequestException('No categories found in the budget file.');
    }
    return result.model;
  }
}
