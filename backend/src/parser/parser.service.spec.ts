import { ParserService } from './parser.service';
import { ColumnMap, SheetRows, WorkbookSource } from './parser.types';

describe('ParserService', () => {
  let service: ParserService;

  beforeEach(() => {
    service = new ParserService();
  });

  describe('parseNumber', () => {
    it('parses plain numbers', () => {
      expect(service.parseNumber('1234.56')).toBe(1234.56);
      expect(service.parseNumber(500)).toBe(500);
      expect(service.parseNumber('1,234,567.89')).toBe(1234567.89);
    });

    it('parses parentheses as negative (SAP)', () => {
      expect(service.parseNumber('(1,234.50)')).toBe(-1234.5);
      expect(service.parseNumber('(500)')).toBe(-500);
    });

    it('parses trailing minus as negative (SAP)', () => {
      expect(service.parseNumber('1234.50-')).toBe(-1234.5);
      expect(service.parseNumber('500-')).toBe(-500);
    });

    it('returns null for empty or invalid values', () => {
      expect(service.parseNumber('')).toBeNull();
      expect(service.parseNumber('-')).toBeNull();
      expect(service.parseNumber(null)).toBeNull();
    });
  });

  describe('codeOf', () => {
    it('recognises 3-digit category codes', () => {
      const r = service.codeOf('684 - Insurance Premium');
      expect(r.kind).toBe('short');
      expect(r.code).toBe('684');
      expect(r.len).toBe(3);
    });

    it('recognises 9-digit commitment item codes', () => {
      const r = service.codeOf('900111101  Insurance Exp - Cash Insurance');
      expect(r.kind).toBe('long');
      expect(r.code).toBe('900111101');
      expect(r.len).toBe(9);
    });

    it('returns none when no leading code', () => {
      const r = service.codeOf('Budget Report Title');
      expect(r.kind).toBe('none');
      expect(r.code).toBeNull();
    });
  });

  describe('sniffDelim', () => {
    it('prefers tab when tab-delimited lines are consistent', () => {
      const text = [
        'Funds Center\tConsumable\tConsumed\tAvailable',
        '151100101 Dept\t1000\t200\t800',
        '684 Category\t500\t100\t400',
        '900111101 Line\t250\t50\t200',
      ].join('\n');
      expect(service.sniffDelim(text)).toBe('\t');
    });

    it('prefers comma when comma-delimited lines are consistent', () => {
      const text = [
        'Funds Center,Consumable,Consumed,Available',
        '151100101 Dept,1000,200,800',
        '684 Category,500,100,400',
        '900111101 Line,250,50,200',
      ].join('\n');
      expect(service.sniffDelim(text)).toBe(',');
    });
  });

  describe('parseDelimited', () => {
    it('keeps a dangling mid-field quote as data', () => {
      // SAP truncates long labels and leaves the opening quote unclosed, so
      // every row up to the next quote used to collapse into one cell.
      const text = [
        'Funds Center\tConsumable\tConsumed\tAvailable',
        '900110006  "Rent, Rates & Taxes HQ Services - Rent,\t21375\t0\t21375',
        '680 - Corporate Services\t191120\t0\t191120',
        '647 - Material and Equipment\t32579157.37\t16235584.13\t16343573.24',
        '900102073  "Mat & Spare - Chem, Indus Gases"\t14104150\t900111.9\t13204038.1',
      ].join('\r\n');
      const rows = service.parseDelimited(text, '\t');
      expect(rows).toHaveLength(5);
      expect(rows[1][0]).toBe('900110006  "Rent, Rates & Taxes HQ Services - Rent,');
      expect(rows[2][0]).toBe('680 - Corporate Services');
      expect(rows[4][0]).toBe('900102073  "Mat & Spare - Chem, Indus Gases"');
    });

    it('still unwraps a properly quoted field', () => {
      const text = ['Name,Consumable', '"Smith, John",1000', 'Plain,2000'].join('\n');
      const rows = service.parseDelimited(text, ',');
      expect(rows).toHaveLength(3);
      expect(rows[1][0]).toBe('Smith, John');
      expect(rows[1][1]).toBe('1000');
    });

    it('honours escaped quotes inside a quoted field', () => {
      const rows = service.parseDelimited('"say ""hi""",5\nnext,6', ',');
      expect(rows[0][0]).toBe('say "hi"');
      expect(rows[1][0]).toBe('next');
    });

    it('recovers every row when a quoted field is never closed', () => {
      const text = ['a,1', '"runaway,2', 'b,3', 'c,4'].join('\n');
      const rows = service.parseDelimited(text, ',');
      expect(rows).toHaveLength(4);
      expect(rows[2][0]).toBe('b');
    });
  });

  describe('buildModel', () => {
    const map: ColumnMap = {
      label: 0,
      consumable: 1,
      consumed: 2,
      available: 3,
    };

    const rows: SheetRows = [
      ['Funds Center', 'Consumable', 'Consumed', 'Available'],
      ['151100101  Sui (Prod) - Production', '10000', '2000', '8000'],
      ['684 - Repairs & Maintenance', '5000', '1000', '4000'],
      ['900111101  Line Item Alpha', '3000', '600', '2400'],
      ['900111102  Line Item Beta', '2000', '400', '1600'],
    ];

    const src: WorkbookSource = {
      fileName: 'test.tsv',
      kind: 'text',
      delim: '\t',
      sheets: [{ name: 'Sheet 1', rows }],
    };

    it('builds hierarchy from synthetic sheet', () => {
      const model = service.buildModel(src, 0, map);

      expect(model.cats).toHaveLength(1);
      expect(model.cats[0].name).toContain('684');
      expect(model.cats[0].subs).toHaveLength(2);
      expect(model.cats[0].subs[0].name).toContain('900111101');
      expect(model.cats[0].subs[1].name).toContain('900111102');

      expect(model.department).not.toBeNull();
      expect(model.department!.name).toContain('151100101');

      expect(model.deptName).toContain('151100101');
      expect(model.lineCount).toBe(2);
      expect(model.rowCount).toBe(4);

      expect(model.cats[0].values.consumable).toBe(5000);
      expect(model.cats[0].subs[0].values.consumable).toBe(3000);
      expect(model.cats[0].subs[1].values.consumable).toBe(2000);

      expect(model.findings.length).toBeGreaterThan(0);
      expect(model.findings[0].level).toBe('ok');
      expect(model.findings[0].title).toContain('Hierarchy');
    });
  });

  describe('category retention', () => {
    const map: ColumnMap = {
      label: 0,
      consumable: 1,
      consumed: 2,
      available: 3,
    };

    const wrap = (rows: SheetRows): WorkbookSource => ({
      fileName: 'budget.tsv',
      kind: 'text',
      delim: '\t',
      sheets: [{ name: 'Sheet 1', rows }],
    });

    it('keeps every category in a group-only export', () => {
      const model = service.buildModel(
        wrap([
          ['Funds Center', 'Consumable', 'Consumed', 'Available'],
          ['684 - Insurance Premium', '264670783', '20629363', '244041420'],
          ['682 - HQ / Office Services', '101375', '58708.18', '42666.82'],
          ['680 - Corporate Services', '191120', '0', '191120'],
          [
            '669-Repairs & Maint of Tanks',
            '6797500',
            '2127028.25',
            '4670471.75',
          ],
          ['660-Repairs & Maint of Office', '301875', '0', '301875'],
          [
            '647 - Material and Equipment',
            '32579157.37',
            '16235584.13',
            '16343573.24',
          ],
        ]),
        0,
        map,
      );

      expect(model.cats).toHaveLength(6);
      expect(model.cats.map((c) => c.name.slice(0, 3))).toEqual([
        '684',
        '682',
        '680',
        '669',
        '660',
        '647',
      ]);
      expect(model.unknown).toHaveLength(0);
      expect(model.total.consumable).toBeCloseTo(304641810.37, 2);
    });

    it('treats non-standard group widths as categories, not unknown rows', () => {
      const model = service.buildModel(
        wrap([
          ['Funds Center', 'Consumable', 'Consumed', 'Available'],
          ['151100101 Sui (Prod)', '9000', '1800', '7200'],
          ['6470 - Material and Equipment', '4000', '800', '3200'],
          ['900111101 Line Alpha', '4000', '800', '3200'],
          ['684 - Insurance Premium', '5000', '1000', '4000'],
          ['900111102 Line Beta', '5000', '1000', '4000'],
        ]),
        0,
        map,
      );

      expect(model.cats.map((c) => c.name.slice(0, 4))).toEqual([
        '6470',
        '684 ',
      ]);
      expect(model.unknown).toHaveLength(0);
      expect(model.total.consumable).toBe(9000);
    });

    it('recovers labels that sit in a shifted column', () => {
      const model = service.buildModel(
        wrap([
          [
            'Funds Center',
            'Description',
            'Consumable',
            'Consumed',
            'Available',
          ],
          ['684 - Insurance Premium', '', '5000', '1000', '4000'],
          ['', '660-Repairs & Maint', '3000', '600', '2400'],
        ]),
        0,
        { label: 0, consumable: 2, consumed: 3, available: 4 },
      );

      expect(model.cats).toHaveLength(2);
      expect(model.cats[1].name).toContain('660');
      expect(model.skipped).toHaveLength(0);
    });

    it('reports rows that carry values but no label', () => {
      const model = service.buildModel(
        wrap([
          ['Funds Center', 'Consumable', 'Consumed', 'Available'],
          ['684 - Insurance Premium', '5000', '1000', '4000'],
          ['', '7777', '1000', '6777'],
        ]),
        0,
        map,
      );

      expect(model.cats).toHaveLength(1);
      expect(model.skipped).toHaveLength(1);
      expect(model.skipped![0].values.consumable).toBe(7777);
      expect(
        model.findings.some(
          (f) => f.level === 'crit' && f.title.includes('no label'),
        ),
      ).toBe(true);
    });
  });

  describe('parseNumber does not read labels as numbers', () => {
    it('rejects codes embedded in descriptions', () => {
      expect(service.parseNumber('669-Repairs & Maint of Tanks')).toBeNull();
      expect(service.parseNumber('684 - Insurance Premium')).toBeNull();
    });

    it('still parses signed and formatted amounts', () => {
      expect(service.parseNumber('-27,396,833.31')).toBeCloseTo(
        -27396833.31,
        2,
      );
      expect(service.parseNumber('32579157.37')).toBeCloseTo(32579157.37, 2);
    });
  });
});
