/**
 * End-to-end import pipeline checks.
 *
 * These exercise autoMapHeaders -> detectColumnLocales -> inferDimensionUnit ->
 * applyMapping together on files shaped like the ones that actually break
 * imports, rather than testing each helper in isolation.
 */
import { describe, it, expect } from 'vitest';
import {
  autoMapHeaders,
  applyMapping,
  detectColumnLocales,
  detectDimDelimiter,
  normalizeUnitLabel,
  SKIP_REASONS,
  WARN_REASONS,
} from './fileParser';
import { inferDimensionUnit } from './unitInference';

describe('pipeline — a clean English catalog', () => {
  const headers = ['Product Name', 'Length', 'Width', 'Height', 'Pack Size', 'Gross Weight'];
  const rows = [
    { 'Product Name': 'Widget A', Length: 60, Width: 40, Height: 30, 'Pack Size': 10, 'Gross Weight': 6 },
    { 'Product Name': 'Widget B', Length: 50, Width: 40, Height: 40, 'Pack Size': 20, 'Gross Weight': 9 },
  ];

  it('maps, imports cleanly and computes volume', () => {
    const { mapping } = autoMapHeaders(headers);
    const out = applyMapping(rows, mapping, { unit: 'cm' });
    expect(out).toHaveLength(2);
    expect(out.every((p) => p.status === 'new')).toBe(true);
    expect(out[0].name).toBe('Widget A');
    expect(out[0].packSize).toBe(10);
    expect(out[0].grossWeightPerShipper).toBe(6);
  });
});

describe('pipeline — European number formats', () => {
  const rows = [
    { Produkt: 'Kiste A', 'Länge': '60,5', Breite: '40,25', 'Höhe': '30', Bruttogewicht: '1.234,56' },
    { Produkt: 'Kiste B', 'Länge': '50,0', Breite: '40,0', 'Höhe': '40', Bruttogewicht: '2.000,00' },
  ];

  it('detects comma-decimal columns and parses them correctly', () => {
    const mapping = { name: 'Produkt', length: 'Länge', width: 'Breite', height: 'Höhe', grossWeight: 'Bruttogewicht' };
    const locales = detectColumnLocales(rows, mapping);
    expect(locales['Länge']).toBe('comma-decimal');
    expect(locales['Bruttogewicht']).toBe('comma-decimal');

    const out = applyMapping(rows, mapping, { unit: 'cm', locales });
    expect(out[0].length).toBeCloseTo(60.5);
    expect(out[0].width).toBeCloseTo(40.25);
    // 1.234,56 must be 1234.56, not 1.23456
    expect(out[0].grossWeightPerShipper).toBeCloseTo(1234.56);
  });
});

describe('pipeline — dimensions mislabelled as cm when they are mm', () => {
  const headers = ['Item', 'L', 'W', 'H', 'CBM'];
  const rows = [
    { Item: 'A', L: 600, W: 400, H: 300, CBM: 0.072 },
    { Item: 'B', L: 500, W: 400, H: 400, CBM: 0.08 },
    { Item: 'C', L: 300, W: 200, H: 150, CBM: 0.009 },
  ];

  it('flags the mismatch on every row and suggests the right unit', () => {
    const { mapping } = autoMapHeaders(headers);
    const out = applyMapping(rows, mapping, { unit: 'cm' });
    // Reading mm as cm makes each CBM 1000x too large, so the file's own CBM
    // column disagrees — surfaced as a warning, not a silent bad import.
    expect(out.every((p) => p.warnings?.includes(WARN_REASONS.CBM_MISMATCH))).toBe(true);

    const hint = inferDimensionUnit(rows, mapping, 'cm');
    expect(hint.suggested).toBe('mm');
  });

  it('imports clean once the suggested unit is applied', () => {
    const { mapping } = autoMapHeaders(headers);
    const out = applyMapping(rows, mapping, { unit: 'mm' });
    expect(out.every((p) => p.status === 'new')).toBe(true);
  });
});

describe('pipeline — junk rows in a real sheet', () => {
  const headers = ['Product Name', 'L', 'W', 'H', 'Qty'];
  const rows = [
    { 'Product Name': 'Real Item', L: 60, W: 40, H: 30, Qty: 5 },
    // A totals/footer row: numbers but no name.
    { 'Product Name': '', L: '', W: '', H: '', Qty: 5 },
    // One dimension left blank.
    { 'Product Name': 'Partial', L: 60, W: '', H: 30, Qty: 1 },
    // Text where a number belongs.
    { 'Product Name': 'Garbled', L: 'see note', W: 40, H: 30, Qty: 1 },
    // No dimension data at all.
    { 'Product Name': 'Empty', L: '', W: '', H: '', Qty: 2 },
  ];

  it('rejects each junk row with a specific, actionable reason', () => {
    const { mapping } = autoMapHeaders(headers);
    const out = applyMapping(rows, mapping, { unit: 'cm' });

    expect(out[0].status).toBe('new');
    expect(out[1].skipReason).toBe(SKIP_REASONS.BLANK_NAME);
    expect(out[2].skipReason).toBe(SKIP_REASONS.ZERO_DIM);
    expect(out[3].skipReason).toBe(SKIP_REASONS.UNPARSEABLE);
    expect(out[3].detail).toMatch(/length/i);
    expect(out[4].skipReason).toBe(SKIP_REASONS.MISSING_DIMS);
  });

  it('keeps every rejected row available with its original data', () => {
    const { mapping } = autoMapHeaders(headers);
    const out = applyMapping(rows, mapping, { unit: 'cm' });
    const rejected = out.filter((p) => p.status === 'skipped');
    expect(rejected).toHaveLength(4);
    // rawData is what the rejected-rows CSV exports.
    expect(rejected.every((p) => p.rawData)).toBe(true);
    expect(rejected[0].rawData.Qty).toBe(5);
  });
});

describe('pipeline — per-row unit column', () => {
  const headers = ['Item', 'L', 'W', 'H', 'UOM'];
  const rows = [
    { Item: 'Metric', L: 600, W: 400, H: 300, UOM: 'mm' },
    { Item: 'Imperial', L: 24, W: 16, H: 12, UOM: 'inches' },
    { Item: 'Shouty', L: 60, W: 40, H: 30, UOM: 'CM' },
    { Item: 'Unknown', L: 60, W: 40, H: 30, UOM: 'cubits' },
  ];

  it('applies each row its own unit', () => {
    const { mapping } = autoMapHeaders(headers);
    expect(mapping.unit).toBe('UOM');
    const out = applyMapping(rows, mapping, { unit: 'cm' });
    expect(out[0].unit).toBe('mm');
    expect(out[1].unit).toBe('inches');
    expect(out[2].unit).toBe('cm');
  });

  it('falls back to the file default and warns on an unrecognised unit', () => {
    const { mapping } = autoMapHeaders(headers);
    const out = applyMapping(rows, mapping, { unit: 'cm' });
    expect(out[3].unit).toBe('cm');
    expect(out[3].warnings).toContain(WARN_REASONS.UNKNOWN_UNIT);
  });
});

describe('pipeline — combined dimension column', () => {
  it('auto-detects an asterisk delimiter', () => {
    const values = ['50*40*30', '60*40*40', '30*20*15'];
    expect(detectDimDelimiter(values)).toBe('*');
  });

  it('auto-detects the unicode multiplication sign', () => {
    expect(detectDimDelimiter(['50×40×30', '60×40×40'])).toBe('×');
  });

  it('defaults to x when there is no evidence', () => {
    expect(detectDimDelimiter([])).toBe('x');
    expect(detectDimDelimiter(['nonsense'])).toBe('x');
  });

  it('parses a combined column end to end', () => {
    const rows = [
      { Name: 'A', Size: '60*40*30' },
      { Name: 'B', Size: '50*40*40' },
    ];
    const out = applyMapping(rows, { name: 'Name' }, {
      combined: true,
      column: 'Size',
      delimiter: '*',
      unit: 'cm',
    });
    expect(out[0].length).toBe(60);
    expect(out[0].height).toBe(30);
    expect(out.every((p) => p.status === 'new')).toBe(true);
  });
});

describe('pipeline — quantity column enables a shipment import', () => {
  it('reads carton counts from the file', () => {
    const headers = ['Item', 'L', 'W', 'H', 'No. of Cartons'];
    const rows = [
      { Item: 'A', L: 60, W: 40, H: 30, 'No. of Cartons': 12 },
      { Item: 'B', L: 50, W: 40, H: 40, 'No. of Cartons': 3 },
    ];
    const { mapping } = autoMapHeaders(headers);
    expect(mapping.quantity).toBe('No. of Cartons');
    const out = applyMapping(rows, mapping, { unit: 'cm' });
    expect(out[0].quantity).toBe(12);
    expect(out[1].quantity).toBe(3);
  });

  it('defaults quantity to 1 when no column is mapped', () => {
    const out = applyMapping(
      [{ Item: 'A', L: 60, W: 40, H: 30 }],
      { name: 'Item', length: 'L', width: 'W', height: 'H' },
      { unit: 'cm' }
    );
    expect(out[0].quantity).toBe(1);
  });
});

describe('pipeline — implausible data warnings', () => {
  const mapping = { name: 'Name', length: 'L', width: 'W', height: 'H', netWeight: 'Net', grossWeight: 'Gross' };

  it('warns when gross weight is below net', () => {
    const out = applyMapping(
      [{ Name: 'A', L: 60, W: 40, H: 30, Net: 10, Gross: 5 }],
      mapping,
      { unit: 'cm', netWeightBasis: 'shipper' }
    );
    expect(out[0].status).toBe('warn');
    expect(out[0].warnings).toContain(WARN_REASONS.GROSS_LT_NET);
  });

  it('warns when mapped weight columns are empty', () => {
    const out = applyMapping(
      [{ Name: 'A', L: 60, W: 40, H: 30, Net: '', Gross: '' }],
      mapping,
      { unit: 'cm' }
    );
    expect(out[0].warnings).toContain(WARN_REASONS.NO_WEIGHTS);
  });

  it('does NOT warn about weights that were never mapped', () => {
    const out = applyMapping(
      [{ Name: 'A', L: 60, W: 40, H: 30 }],
      { name: 'Name', length: 'L', width: 'W', height: 'H' },
      { unit: 'cm' }
    );
    expect(out[0].status).toBe('new');
  });

  it('warns on an implausibly large dimension', () => {
    const out = applyMapping(
      [{ Name: 'A', L: 5000, W: 40, H: 30 }],
      { name: 'Name', length: 'L', width: 'W', height: 'H' },
      { unit: 'cm' }
    );
    expect(out[0].warnings).toContain(WARN_REASONS.HUGE_DIM);
  });

  it('warns on an extreme aspect ratio', () => {
    const out = applyMapping(
      [{ Name: 'A', L: 1500, W: 1, H: 1 }],
      { name: 'Name', length: 'L', width: 'W', height: 'H' },
      { unit: 'cm' }
    );
    expect(out[0].warnings).toContain(WARN_REASONS.EXTREME_RATIO);
  });

  it('still imports warned rows — warnings are advisory', () => {
    const out = applyMapping(
      [{ Name: 'A', L: 60, W: 40, H: 30, Net: 10, Gross: 5 }],
      mapping,
      { unit: 'cm' }
    );
    expect(out[0].status).toBe('warn');
    expect(out[0].status).not.toBe('skipped');
  });
});

describe('normalizeUnitLabel', () => {
  it('accepts common spellings and casings', () => {
    expect(normalizeUnitLabel('CM')).toBe('cm');
    expect(normalizeUnitLabel('centimetres')).toBe('cm');
    expect(normalizeUnitLabel('MM.')).toBe('mm');
    expect(normalizeUnitLabel('Inch')).toBe('inches');
    expect(normalizeUnitLabel('ft')).toBe('feet');
    expect(normalizeUnitLabel('m')).toBe('meters');
    expect(normalizeUnitLabel('Metre')).toBe('meters');
  });
  it('returns null for anything unrecognised', () => {
    expect(normalizeUnitLabel('cubits')).toBeNull();
    expect(normalizeUnitLabel('')).toBeNull();
    expect(normalizeUnitLabel(null)).toBeNull();
  });
});
