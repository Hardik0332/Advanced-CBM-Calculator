import { describe, it, expect } from 'vitest';
import {
  parseDimensionString,
  sanitizeNumeric,
  autoMapHeaders,
  buildProductFromRow,
  applyMapping,
} from './fileParser';

describe('parseDimensionString', () => {
  it('parses plain 50x40x30', () => {
    expect(parseDimensionString('50x40x30')).toEqual({ length: 50, width: 40, height: 30 });
  });
  it('parses decimals and spaces', () => {
    expect(parseDimensionString('50.5 x 40.25 x 30')).toEqual({ length: 50.5, width: 40.25, height: 30 });
  });
  it('parses with unit labels', () => {
    expect(parseDimensionString('50 cm x 40 cm x 30 cm')).toEqual({ length: 50, width: 40, height: 30 });
  });
  it('supports a custom delimiter', () => {
    expect(parseDimensionString('50*40*30', '*')).toEqual({ length: 50, width: 40, height: 30 });
  });
  it('falls back to first three numbers', () => {
    expect(parseDimensionString('L50 W40 H30')).toEqual({ length: 50, width: 40, height: 30 });
  });
  it('returns null for garbage', () => {
    expect(parseDimensionString('no numbers here')).toBeNull();
    expect(parseDimensionString(null)).toBeNull();
    expect(parseDimensionString(undefined)).toBeNull();
  });
});

describe('sanitizeNumeric', () => {
  it('passes numbers through', () => {
    expect(sanitizeNumeric(42.5)).toBe(42.5);
  });
  it('parses comma thousands separators', () => {
    expect(sanitizeNumeric('1,234.56')).toBe(1234.56);
  });
  it('strips unit suffixes', () => {
    expect(sanitizeNumeric('12.5 kg')).toBe(12.5);
  });
  it('defaults null/empty/NaN to 0', () => {
    expect(sanitizeNumeric(null)).toBe(0);
    expect(sanitizeNumeric('')).toBe(0);
    expect(sanitizeNumeric('abc')).toBe(0);
    expect(sanitizeNumeric(NaN)).toBe(0);
  });
});

describe('autoMapHeaders', () => {
  it('maps common column names', () => {
    const { mapping } = autoMapHeaders(['Product Name', 'Length', 'Width', 'Height', 'Pack Size', 'Gross Weight']);
    expect(mapping.name).toBe('Product Name');
    expect(mapping.length).toBe('Length');
    expect(mapping.width).toBe('Width');
    expect(mapping.height).toBe('Height');
    expect(mapping.packSize).toBe('Pack Size');
    expect(mapping.grossWeight).toBe('Gross Weight');
  });
  it('maps single-letter L/W/H columns', () => {
    const { mapping } = autoMapHeaders(['Item', 'L', 'W', 'H']);
    expect(mapping.length).toBe('L');
    expect(mapping.width).toBe('W');
    expect(mapping.height).toBe('H');
  });
  it('detects combined dimension columns', () => {
    const { combinedDimColumn } = autoMapHeaders(['Name', 'Dimensions (LxWxH)']);
    expect(combinedDimColumn).toBe('Dimensions (LxWxH)');
  });
});

describe('buildProductFromRow — weight basis', () => {
  const row = { Name: 'Syrup', L: 50, W: 40, H: 30, Pack: 10, Net: 5, Gross: 6 };
  const mapping = { name: 'Name', length: 'L', width: 'W', height: 'H', packSize: 'Pack', netWeight: 'Net', grossWeight: 'Gross' };

  it('default: net column is per-shipper → divided by pack size', () => {
    const p = buildProductFromRow(row, mapping, { unit: 'cm' }, 0);
    expect(p.netWeightPerUnit).toBeCloseTo(0.5);
    expect(p.grossWeightPerShipper).toBe(6);
  });

  it('net per-unit basis: value stored directly', () => {
    const p = buildProductFromRow(row, mapping, { unit: 'cm', netWeightBasis: 'unit' }, 0);
    expect(p.netWeightPerUnit).toBe(5);
  });

  it('gross per-unit basis: multiplied up to per-shipper', () => {
    const p = buildProductFromRow(row, mapping, { unit: 'cm', grossWeightBasis: 'unit' }, 0);
    expect(p.grossWeightPerShipper).toBe(60);
  });

  it('keeps import unit', () => {
    const p = buildProductFromRow(row, mapping, { unit: 'inches' }, 0);
    expect(p.unit).toBe('inches');
  });
});

describe('applyMapping', () => {
  const mapping = { name: 'Name', length: 'L', width: 'W', height: 'H' };

  it('tags valid rows as new', () => {
    const out = applyMapping([{ Name: 'A', L: 10, W: 10, H: 10 }], mapping, { unit: 'cm' });
    expect(out[0].status).toBe('new');
  });

  it('skips rows where a mapped dimension is zero', () => {
    const out = applyMapping([{ Name: 'B', L: 0, W: 10, H: 10 }], mapping, { unit: 'cm' });
    expect(out[0].status).toBe('skipped');
    /* Reported as Zero/Negative rather than the old blanket "Missing Dimensions":
       two of three dimensions are present, so the user needs to look at a cell,
       not hunt for an absent column. */
    expect(out[0].skipReason).toBe('Zero/Negative Dimension');
  });

  it('reports Missing Dimensions when no dimension data exists at all', () => {
    const out = applyMapping([{ Name: 'B', L: '', W: '', H: '' }], mapping, { unit: 'cm' });
    expect(out[0].status).toBe('skipped');
    expect(out[0].skipReason).toBe('Missing Dimensions');
  });

  it('accepts CBM-only rows when no dim columns are mapped', () => {
    const out = applyMapping(
      [{ Name: 'C', Vol: 0.5 }],
      { name: 'Name', cbm: 'Vol' },
      { unit: 'cm' }
    );
    expect(out[0].status).toBe('new');
    expect(out[0].cbmPerShipper).toBe(0.5);
  });

  it('ignores pre-calc CBM when dim columns ARE mapped but empty', () => {
    const out = applyMapping(
      [{ Name: 'D', L: '', W: '', H: '', Vol: 0.5 }],
      { ...mapping, cbm: 'Vol' },
      { unit: 'cm' }
    );
    expect(out[0].status).toBe('skipped');
  });
});
