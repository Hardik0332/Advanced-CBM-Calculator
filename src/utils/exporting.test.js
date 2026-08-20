import { describe, it, expect } from 'vitest';
import {
  exportFileName,
  buildRows,
  buildSummaryPairs,
  buildWorkingsRows,
} from './exporting';

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
    /* Air is now billed the way an airline bills it: volume ÷ 6,000 cm³/kg
       (= 166.667 kg/m³), not the rounded 167 kg/m³ trade shorthand. 0.18 m³ →
       180,000 cm³ ÷ 6,000 = 30.00 kg, so this is deliberately 0.06 kg below the
       old figure. */
    expect(map['Volumetric Wt (kg)']).toBeCloseTo(30);
    expect(map['Chargeable Wt (kg)']).toBeCloseTo(30);
    expect(map['Volumetric Divisor (cm³/kg)']).toBe(6000);
  });

  it('reports the billed weight after the carrier round-up, not just the raw figure', () => {
    // 0.1836 m³ → 183,600 cm³ ÷ 6,000 = 30.6 kg → billed 31.0 kg (next 0.5 kg).
    const map = Object.fromEntries(
      buildSummaryPairs({ ...totals, cbm: 0.1836 }, '40hc', 'air')
    );
    expect(map['Chargeable Wt (kg)']).toBeCloseTo(30.6);
    expect(map['Billed Chargeable Wt (kg)']).toBe(31);
    expect(map['Rounding Step (kg)']).toBe(0.5);
  });

  it('measures per piece when the items are supplied', () => {
    const item = {
      ...goodItem,
      length: 51,
      width: 40,
      height: 30,
      quantity: 3,
      cbmPerShipper: 0.0612,
    };
    const map = Object.fromEntries(
      buildSummaryPairs({ ...totals, cbm: 0.1836 }, '40hc', 'courier', { items: [item] })
    );
    // 183,600 cm³ ÷ 5,000 = 36.72 kg → billed 37 kg (next 1.0 kg).
    expect(map['Volumetric Wt (kg)']).toBeCloseTo(36.72);
    expect(map['Billed Chargeable Wt (kg)']).toBe(37);
  });

  it('quotes revenue tons for ocean LCL', () => {
    const map = Object.fromEntries(
      buildSummaryPairs({ cbm: 12.3456, grossWeight: 8500 }, 'none', 'ocean_lcl')
    );
    expect(map['Revenue Tons (RT)']).toBeCloseTo(12.3456);
    expect(map['Billed Revenue Tons (RT)']).toBe(12.35);
  });

  it('uses gross weight when it exceeds volumetric', () => {
    const map = Object.fromEntries(
      buildSummaryPairs({ ...totals, grossWeight: 500 }, '40hc', 'air')
    );
    expect(map['Chargeable Wt (kg)']).toBeCloseTo(500);
    expect(map['Chargeable Basis']).toBe('Gross weight');
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
    expect(typeof map['Remaining Volume (m³)']).toBe('number');
  });

  it('flags a weight-limited load', () => {
    const map = Object.fromEntries(
      buildSummaryPairs({ cbm: 40, grossWeight: 54000 }, '40hc', 'ocean_fcl')
    );
    expect(map['Containers Required']).toBe(3);
    expect(map['Limited By']).toBe('weight');
  });

  it('says "no container" rather than silently omitting the row', () => {
    // An unknown key and an explicit LCL selection both mean "nothing to plan
    // against". Leaving the row out entirely made the export look truncated.
    for (const key of ['nope', 'none']) {
      const map = Object.fromEntries(buildSummaryPairs(totals, key, 'air'));
      expect(map.Container).toBe('None (LCL / loose cargo)');
      expect(map['Containers Required']).toBeUndefined();
      expect(map['Freight Mode']).toBe('Air');
    }
  });

  it('honours a user-entered custom container', () => {
    const map = Object.fromEntries(
      buildSummaryPairs({ cbm: 45, grossWeight: 1000 }, 'custom', 'ocean_fcl', {
        customContainer: { label: 'Rail wagon', cbm: 20, maxPayloadKg: 30000 },
      })
    );
    expect(map.Container).toBe('Rail wagon');
    expect(map['Containers Required']).toBe(3);
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

describe('buildWorkingsRows — the derivation travels with the numbers', () => {
  it('emits a header row and one row per derivation step', () => {
    const rows = buildWorkingsRows({ ...totals, cbm: 0.1836 }, '40hc', 'air');
    expect(rows[0]).toEqual(['Step', 'How it is derived', 'Value', 'Unit']);
    expect(rows.length).toBeGreaterThan(5);
  });

  it('carries the billed weight and the round-up that produced it', () => {
    const rows = buildWorkingsRows({ ...totals, cbm: 0.1836 }, '40hc', 'air');
    const billed = rows.find((r) => r[0] === 'Billed chargeable weight');
    expect(billed[1]).toContain('next 0.5 kg');
    expect(billed[2]).toBe(31);
    expect(billed[3]).toBe('kg');
  });

  it('writes raw numbers, not formatted strings — the spreadsheet must stay numeric', () => {
    const rows = buildWorkingsRows({ ...totals, cbm: 0.1836 }, '40hc', 'air');
    for (const row of rows.slice(1)) {
      if (row[0] === 'Note') continue;
      expect(typeof row[2]).toBe('number');
    }
  });

  it('appends the sourcing caveats as notes', () => {
    const rows = buildWorkingsRows(totals, '40hc', 'air');
    expect(rows.some((r) => r[0] === 'Note')).toBe(true);
  });

  it('survives null totals', () => {
    expect(() => buildWorkingsRows(null, 'none', 'ocean_fcl')).not.toThrow();
  });
});

describe('exports carry the resolved country & carrier rules', () => {
  /** 26 t in a 40' HC: legal on the ISO rating, overweight on a US highway. */
  const heavy = { cbm: 40, grossWeight: 26000, netWeight: 24000, shippers: 100, totalPcs: 1000 };
  const pairMap = (pairs) => Object.fromEntries(pairs);

  it('names the rule profiles that were applied', () => {
    const map = pairMap(
      buildSummaryPairs(heavy, '40hc', 'courier', {
        country: 'US',
        carrier: 'DHL_EXPRESS_AE',
      })
    );
    expect(map['Destination Rules']).toBe('United States');
    expect(map['Carrier Rules']).toBe('DHL Express — shipping from the UAE');
    expect(map['Divisor Source']).toBe('carrier');
    expect(map['Volumetric Divisor (cm³/kg)']).toBe(4000);
  });

  it('reports the road cap AND the ISO rating it overruled, never just one', () => {
    const map = pairMap(buildSummaryPairs(heavy, '40hc', 'ocean_fcl', { country: 'US' }));
    expect(map['Payload Cap (kg)']).toBe(21466);
    expect(map['Payload Cap Source']).toBe('road');
    expect(map['ISO Payload Rating (kg)']).toBe(26500);
    expect(map['Payload Lost to Road Law (kg)']).toBe(5034);
    expect(map['Limited By']).toBe('road');
    expect(map['Containers Required']).toBe(2);
  });

  it('omits the derate rows when the ISO rating governs', () => {
    const map = pairMap(buildSummaryPairs(heavy, '40hc', 'ocean_fcl', { country: 'EU_44T' }));
    expect(map['Payload Cap Source']).toBe('iso');
    expect(map['ISO Payload Rating (kg)']).toBeUndefined();
    expect(map['Limited By']).toBe('volume');
  });

  it('quotes the measurement ton on an LCL shipment', () => {
    const map = pairMap(buildSummaryPairs(heavy, 'none', 'ocean_lcl', { country: 'US' }));
    expect(map['Measurement Ton (m³/RT)']).toBe(1.133);
  });

  it('keeps every rule figure numeric so the spreadsheet stays a spreadsheet', () => {
    const map = pairMap(buildSummaryPairs(heavy, '40hc', 'ocean_fcl', { country: 'US' }));
    for (const key of [
      'Payload Cap (kg)',
      'ISO Payload Rating (kg)',
      'Payload Lost to Road Law (kg)',
    ]) {
      expect(typeof map[key], key).toBe('number');
    }
  });

  it('prints the governing-limit derivation in the workings block', () => {
    const rows = buildWorkingsRows(heavy, '40hc', 'ocean_fcl', { country: 'US' });
    const road = rows.find((r) => r[0] === 'Road-legal payload');
    expect(road[1]).toContain('36287 kg GVW');
    expect(road[2]).toBe(21466);
    expect(rows.find((r) => r[0] === 'Payload lost to road law')[2]).toBe(5034);
    expect(rows.some((r) => r[0] === 'Note' && r[1].includes('Payload capped at'))).toBe(true);
  });

  it('honours an explicit override over both profiles', () => {
    const map = pairMap(
      buildSummaryPairs(heavy, '40hc', 'courier', {
        country: 'US',
        carrier: 'DHL_EXPRESS_AE',
        overrides: { payloadKg: 26000, divisorCm3PerKg: 5500 },
      })
    );
    expect(map['Payload Cap Source']).toBe('override');
    expect(map['Volumetric Divisor (cm³/kg)']).toBe(5500);
    expect(map['Divisor Source']).toBe('override');
    expect(map['Containers Required']).toBe(1);
  });

  it('reproduces the pre-Phase-2b output when no rules are passed', () => {
    const withDefaults = buildSummaryPairs(heavy, '40hc', 'ocean_fcl', {
      country: 'DEFAULT',
      carrier: 'DEFAULT',
      overrides: {},
    });
    const without = buildSummaryPairs(heavy, '40hc', 'ocean_fcl');
    expect(withDefaults).toEqual(without);

    const map = pairMap(without);
    expect(map['Payload Cap (kg)']).toBe(26500);
    expect(map['Limited By']).toBe('volume');
  });
});
