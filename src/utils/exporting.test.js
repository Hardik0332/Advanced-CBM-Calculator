import { describe, it, expect } from 'vitest';
import { exportFileName, buildRows, buildSummaryPairs } from './exporting';

/* A record from an older build: no weights, no CBM, no totalPcs. Passing one of
   these through the exporters used to throw "toFixed is not a function". */
const legacyItem = { id: 'i1', name: 'Legacy Widget', unit: 'cm' };

const goodItem = {
  id: 'i2',
  name: 'Widget',
  unit: 'cm',
  length: 50,
  width: 40,
  height: 30,
  packSize: 10,
  quantity: 3,
  totalPcs: 25,
  netWeightPerUnit: 0.5,
  grossWeightPerShipper: 6,
  cbmPerShipper: 0.06,
  packingString: '10X100GM',
};

const totals = {
  cbm: 0.18,
  grossWeight: 18,
  netWeight: 12.5,
  shippers: 3,
  totalPcs: 25,
};

describe('exportFileName', () => {
  it('includes the base, reference and a local date', () => {
    const name = exportFileName('shipment', 'PO-123', 'pdf');
    expect(name).toMatch(/^shipment_PO-123_\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('omits the reference when there is no PO', () => {
    expect(exportFileName('shipment', '', 'csv')).toMatch(
      /^shipment_\d{4}-\d{2}-\d{2}\.csv$/
    );
    expect(exportFileName('shipment', null, 'csv')).toMatch(
      /^shipment_\d{4}-\d{2}-\d{2}\.csv$/
    );
  });

  it('strips characters Windows forbids in filenames', () => {
    // "AB/123" previously produced "shipment_AB/123_….pdf" — an invalid path.
    const name = exportFileName('shipment', 'AB/123', 'pdf');
    expect(name).not.toMatch(/[/\\:*?"<>|]/);
    expect(name).toContain('AB-123');
  });

  it('strips every forbidden character, not just the slash', () => {
    const name = exportFileName('shipment', 'A:B*C?D"E<F>G|H\\I', 'pdf');
    // Only the extension dot and the date hyphens should remain as punctuation.
    expect(name).not.toMatch(/[/\\:*?"<>|]/);
  });

  it('collapses whitespace to underscores', () => {
    expect(exportFileName('shipment', 'PO 123  456', 'csv')).toContain('PO_123_456');
  });

  it('caps a very long reference', () => {
    const name = exportFileName('shipment', 'X'.repeat(200), 'csv');
    expect(name.length).toBeLessThan(100);
  });

  it('uses the LOCAL date, not the UTC date', () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    expect(exportFileName('shipment', '', 'csv')).toContain(local);
  });

  it('does not leave a stray separator for a reference of only bad characters', () => {
    const name = exportFileName('shipment', '///', 'csv');
    expect(name).not.toContain('__');
  });
});

describe('buildRows — crash safety', () => {
  it('does not throw on a legacy record missing every numeric field', () => {
    expect(() => buildRows([legacyItem], totals)).not.toThrow();
  });

  it('renders missing numerics as 0 rather than undefined', () => {
    const [row] = buildRows([legacyItem], totals);
    expect(row['Net Wt/Unit (kg)']).toBe(0);
    expect(row['Gross Wt/Shipper (kg)']).toBe(0);
    expect(row['CBM/Shipper']).toBe(0);
    expect(row['Total CBM']).toBe(0);
  });

  it('defaults a missing quantity and pack size to 1', () => {
    const [row] = buildRows([legacyItem], totals);
    expect(row['Qty (Shippers)']).toBe(1);
    expect(row['Pack Size']).toBe(1);
  });

  it('survives null and non-object entries', () => {
    expect(() => buildRows([null, undefined, 'junk', 42], totals)).not.toThrow();
  });

  it('survives a null shipment and null totals', () => {
    expect(() => buildRows(null, null)).not.toThrow();
    expect(buildRows(null, null)).toHaveLength(1); // just the TOTALS row
  });

  it('computes a good row correctly', () => {
    const [row] = buildRows([goodItem], totals);
    expect(row['Item Name']).toBe('Widget');
    expect(row.Packing).toBe('10X100GM');
    expect(row['Total Pcs']).toBe(25);
    expect(row['Total CBM']).toBeCloseTo(0.18);
    expect(row['Total Gross Wt (kg)']).toBeCloseTo(18);
    // Net weight follows the real piece count, so a partial last box isn't over-billed.
    expect(row['Total Net Wt (kg)']).toBeCloseTo(12.5);
  });

  it('appends a TOTALS row last', () => {
    const rows = buildRows([goodItem], totals);
    expect(rows[rows.length - 1]['Item Name']).toBe('TOTALS');
    expect(rows[rows.length - 1]['Total CBM']).toBeCloseTo(0.18);
  });

  it('coerces negative dimensions to positive', () => {
    const [row] = buildRows([{ ...goodItem, cbmPerShipper: -0.06 }], totals);
    expect(row['CBM/Shipper']).toBeGreaterThanOrEqual(0);
  });

  it('neutralises NaN and Infinity', () => {
    const [row] = buildRows(
      [{ ...goodItem, cbmPerShipper: NaN, grossWeightPerShipper: Infinity }],
      totals
    );
    expect(Number.isFinite(row['Total CBM'])).toBe(true);
    expect(Number.isFinite(row['Total Gross Wt (kg)'])).toBe(true);
  });
});

describe('buildSummaryPairs — Excel/CSV parity', () => {
  it('reports the freight mode, volumetric and chargeable weight', () => {
    const pairs = buildSummaryPairs(totals, '40hc', 'air');
    const map = Object.fromEntries(pairs);
    expect(map['Freight Mode']).toBe('Air');
    // Air: 0.18 m³ × 167 kg/m³ = 30.06 kg volumetric, above the 18 kg gross.
    expect(map['Volumetric Wt (kg)']).toBeCloseTo(30.06);
    expect(map['Chargeable Wt (kg)']).toBeCloseTo(30.06);
  });

  it('uses gross weight when it exceeds volumetric', () => {
    const map = Object.fromEntries(
      buildSummaryPairs({ ...totals, grossWeight: 500 }, '40hc', 'air')
    );
    expect(map['Chargeable Wt (kg)']).toBeCloseTo(500);
  });

  it('has no volumetric weight for Ocean FCL', () => {
    const map = Object.fromEntries(buildSummaryPairs(totals, '40hc', 'ocean_fcl'));
    expect(map['Volumetric Wt (kg)']).toBe(0);
    expect(map['Chargeable Wt (kg)']).toBeCloseTo(18);
  });

  it('includes the container plan', () => {
    const map = Object.fromEntries(buildSummaryPairs(totals, '40hc', 'ocean_fcl'));
    expect(map.Container).toContain('High Cube');
    expect(map['Containers Required']).toBe(1);
    expect(map['Limited By']).toBe('volume');
  });

  it('flags a weight-limited load', () => {
    const map = Object.fromEntries(
      buildSummaryPairs({ cbm: 40, grossWeight: 54000 }, '40hc', 'ocean_fcl')
    );
    expect(map['Containers Required']).toBe(3);
    expect(map['Limited By']).toBe('weight');
  });

  it('omits container rows for an unknown container', () => {
    const map = Object.fromEntries(buildSummaryPairs(totals, 'nope', 'air'));
    expect(map.Container).toBeUndefined();
    expect(map['Freight Mode']).toBe('Air');
  });

  it('survives null totals', () => {
    expect(() => buildSummaryPairs(null, '40hc', 'air')).not.toThrow();
  });

  it('keeps utilisation percentages as numbers, not formatted strings', () => {
    // These used to be written as "12.34% volume" into the Length column.
    const map = Object.fromEntries(buildSummaryPairs(totals, '40hc', 'air'));
    expect(typeof map['Volume Utilisation (%)']).toBe('number');
    expect(typeof map['Payload Utilisation (%)']).toBe('number');
  });
});
