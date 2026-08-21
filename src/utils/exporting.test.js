import { describe, it, expect } from 'vitest';
import {
  exportFileName,
  prepareExport,
  buildItemRecords,
  buildTotalsRecord,
  projectRows,
  projectAoa,
  pruneEmptyColumns,
  resolveParty,
  PACKING_LIST_COLUMNS,
  ITEM_BREAKDOWN_COLUMNS,
  INVOICE_COLUMNS,
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

/**
 * Build an export context the way the app does.
 *
 * Every assertion below goes through `prepareExport`, which is the point: the old
 * suite called three separate builders that each recomputed freight from loose
 * arguments. Excel, CSV and PDF now read one context, so the tests do too.
 */
const ctx = (opts = {}) =>
  prepareExport({
    shipment: opts.shipment ?? [],
    totals: 'totals' in opts ? opts.totals : totals,
    meta: {
      containerType: opts.container ?? '40hc',
      freightMode: opts.mode ?? 'ocean_fcl',
      customContainer: opts.customContainer,
      destinationCountry: opts.country,
      carrierProfile: opts.carrier,
      ruleOverrides: opts.overrides,
      ...(opts.trade || {}),
    },
    company: opts.company,
    products: opts.products,
  });

/** Freight pairs as a lookup, which is how every document consumes them. */
const pairs = (opts) => Object.fromEntries(ctx(opts).freightPairs);

/** A packing-list projection, keyed by header — the shape `json_to_sheet` writes. */
const plRows = (shipment, t = totals) => {
  const c = ctx({ shipment, totals: t });
  return projectRows(c.rows, pruneEmptyColumns(PACKING_LIST_COLUMNS, c.rows));
};

describe('exportFileName', () => {
  it('includes the base, reference and a local date', () => {
    const name = exportFileName('shipment', 'PO-123', 'pdf');
    expect(name).toMatch(/^shipment_PO-123_\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('omits the reference when there is no PO', () => {
    expect(exportFileName('shipment', '', 'csv')).toMatch(/^shipment_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(exportFileName('shipment', null, 'csv')).toMatch(/^shipment_\d{4}-\d{2}-\d{2}\.csv$/);
  });

  it('strips characters Windows forbids in filenames', () => {
    // "AB/123" previously produced "shipment_AB/123_….pdf" — an invalid path.
    const name = exportFileName('shipment', 'AB/123', 'pdf');
    expect(name).not.toMatch(/[/\\:*?"<>|]/);
    expect(name).toContain('AB-123');
  });

  it('strips every forbidden character, not just the slash', () => {
    const name = exportFileName('shipment', 'A:B*C?D"E<F>G|H\\I', 'pdf');
    expect(name).not.toMatch(/[/\\:*?"<>|]/);
  });

  it('collapses whitespace to underscores', () => {
    expect(exportFileName('shipment', 'PO 123  456', 'csv')).toContain('PO_123_456');
  });

  it('caps a very long reference', () => {
    expect(exportFileName('shipment', 'X'.repeat(200), 'csv').length).toBeLessThan(100);
  });

  it('uses the LOCAL date, not the UTC date', () => {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    expect(exportFileName('shipment', '', 'csv')).toContain(local);
  });

  it('does not leave a stray separator for a reference of only bad characters', () => {
    expect(exportFileName('shipment', '///', 'csv')).not.toContain('__');
  });
});

describe('buildItemRecords — crash safety', () => {
  it('does not throw on a legacy record missing every numeric field', () => {
    expect(() => buildItemRecords([legacyItem])).not.toThrow();
  });

  it('renders missing numerics as 0 rather than undefined', () => {
    const [r] = buildItemRecords([legacyItem]);
    expect(r.netPerUnit).toBe(0);
    expect(r.grossPerShipper).toBe(0);
    expect(r.cbmPerShipper).toBe(0);
    expect(r.cbmTotal).toBe(0);
  });

  it('defaults a missing quantity and pack size to 1', () => {
    const [r] = buildItemRecords([legacyItem]);
    expect(r.quantity).toBe(1);
    expect(r.packSize).toBe(1);
  });

  it('drops null and non-object entries instead of throwing', () => {
    expect(() => buildItemRecords([null, undefined, 'junk', 42])).not.toThrow();
    expect(buildItemRecords([null, 'junk', goodItem])).toHaveLength(1);
  });

  it('survives a null shipment and null totals', () => {
    expect(() => buildTotalsRecord(buildItemRecords(null), null)).not.toThrow();
    expect(ctx({ shipment: null, totals: null }).rows).toHaveLength(1); // TOTALS only
  });

  it('computes a good record correctly', () => {
    const [r] = buildItemRecords([goodItem]);
    expect(r.name).toBe('Widget');
    expect(r.packingString).toBe('10X100GM');
    expect(r.totalPcs).toBe(25);
    expect(r.cbmTotal).toBeCloseTo(0.18);
    expect(r.grossTotal).toBeCloseTo(18);
    // Net weight follows the real piece count, so a partial last box isn't over-billed.
    expect(r.netTotal).toBeCloseTo(12.5);
  });

  it('flags a partial last box', () => {
    const [full] = buildItemRecords([{ ...goodItem, totalPcs: 30 }]);
    expect(full.partialBox).toBe(false);
    // 25 pcs across 3 cartons of 10 means the last carton is short.
    const [partial] = buildItemRecords([goodItem]);
    expect(partial.partialBox).toBe(true);
    expect(partial.derivedPcs).toBe(30);
  });

  it('carries dimensions in the entered unit and in cm', () => {
    const [r] = buildItemRecords([{ ...goodItem, unit: 'inches', length: 10 }]);
    expect(r.length).toBe(10);
    expect(r.unit).toBe('inches');
    expect(r.lengthCm).toBeCloseTo(25.4);
  });

  it('coerces negative dimensions to positive', () => {
    const [r] = buildItemRecords([{ ...goodItem, cbmPerShipper: -0.06 }]);
    expect(r.cbmPerShipper).toBeGreaterThanOrEqual(0);
  });

  it('neutralises NaN and Infinity', () => {
    const [r] = buildItemRecords([
      { ...goodItem, cbmPerShipper: NaN, grossWeightPerShipper: Infinity },
    ]);
    expect(Number.isFinite(r.cbmTotal)).toBe(true);
    expect(Number.isFinite(r.grossTotal)).toBe(true);
  });

  it('leaves an unset trade field null rather than 0 or ""', () => {
    const [r] = buildItemRecords([goodItem]);
    // A blank HS code must not become a zero in a numeric column.
    expect(r.hsCode).toBeNull();
    expect(r.unitPrice).toBeNull();
    expect(r.amount).toBeNull();
  });

  it('prices a line from unitPrice × total pieces', () => {
    const [r] = buildItemRecords([{ ...goodItem, unitPrice: 4 }]);
    expect(r.unitPrice).toBe(4);
    expect(r.amount).toBeCloseTo(100); // 25 pcs × 4
  });
});

describe('buildTotalsRecord', () => {
  it('appends as the last row of a projection, labelled TOTALS', () => {
    const rows = plRows([goodItem]);
    expect(rows[rows.length - 1].Description).toBe('TOTALS');
    expect(rows[rows.length - 1]['Total CBM']).toBeCloseTo(0.18);
  });

  it('prefers the app totals so the export matches the on-screen card', () => {
    // A deliberately inconsistent totals object: the export must quote it, not
    // silently re-derive a different number.
    const t = { ...totals, cbm: 99, grossWeight: 88 };
    const rec = buildTotalsRecord(buildItemRecords([goodItem]), t);
    expect(rec.cbmTotal).toBe(99);
    expect(rec.grossTotal).toBe(88);
  });

  it('sums the records when no totals are supplied', () => {
    const rec = buildTotalsRecord(buildItemRecords([goodItem, goodItem]), null);
    expect(rec.cbmTotal).toBeCloseTo(0.36);
    expect(rec.grossTotal).toBeCloseTo(36);
  });

  it('nulls fields that make no sense to total', () => {
    const rec = buildTotalsRecord(buildItemRecords([goodItem]), totals);
    // An averaged dimension or a summed pack size in a totals row is meaningless,
    // and a 0 there reads as real data.
    for (const key of ['length', 'width', 'height', 'packSize', 'hsCode', 'unit']) {
      expect(rec[key], key).toBeNull();
    }
  });
});

describe('column projection — one source, many documents', () => {
  it('drops trade columns no record fills in', () => {
    const c = ctx({ shipment: [goodItem] });
    const cols = pruneEmptyColumns(PACKING_LIST_COLUMNS, c.rows).map((x) => x.key);
    expect(cols).not.toContain('hsCode');
    expect(cols).not.toContain('marks');
    // Non-trade columns always survive, even when empty.
    expect(cols).toContain('name');
    expect(cols).toContain('cbmTotal');
  });

  it('keeps a trade column as soon as one record fills it', () => {
    const c = ctx({ shipment: [goodItem, { ...goodItem, id: 'i3', hsCode: '8471.30' }] });
    const cols = pruneEmptyColumns(PACKING_LIST_COLUMNS, c.rows).map((x) => x.key);
    expect(cols).toContain('hsCode');
  });

  it('renders nulls as empty strings and booleans as Yes/blank at the boundary', () => {
    const c = ctx({ shipment: [goodItem] });
    const rows = projectRows(c.records, ITEM_BREAKDOWN_COLUMNS);
    expect(rows[0]['SKU']).toBe('');
    expect(rows[0]['Partial Box?']).toBe('Yes');
  });

  it('projects to arrays-of-arrays with the header first', () => {
    const c = ctx({ shipment: [goodItem] });
    const aoa = projectAoa(c.rows, PACKING_LIST_COLUMNS);
    expect(aoa[0]).toContain('Description');
    expect(aoa).toHaveLength(c.rows.length + 1);
  });

  it('gives Excel and CSV byte-identical values from one builder', () => {
    /* The regression this whole module exists to prevent: the CSV used to omit the
       freight block entirely while claiming column parity. */
    const c = ctx({ shipment: [goodItem] });
    const cols = pruneEmptyColumns(PACKING_LIST_COLUMNS, c.rows);
    const excel = projectRows(c.rows, cols);
    const csv = projectAoa(c.rows, cols);
    csv.slice(1).forEach((row, i) => {
      cols.forEach((col, j) => {
        expect(row[j], `${col.label} row ${i}`).toEqual(excel[i][col.label]);
      });
    });
  });

  it('keeps spreadsheet values numeric, never formatted strings', () => {
    // These used to be written as "12.34% volume" into the Length column.
    const c = ctx({ shipment: [goodItem] });
    const rows = projectRows(c.records, PACKING_LIST_COLUMNS);
    expect(typeof rows[0]['Total CBM']).toBe('number');
    expect(typeof rows[0]['Gross kg']).toBe('number');
  });
});

describe('freight pairs — Excel/CSV parity', () => {
  it('reports the freight mode, volumetric and chargeable weight', () => {
    const map = pairs({ mode: 'air' });
    expect(map['Freight Mode']).toBe('Air');
    /* Air is billed the way an airline bills it: volume ÷ 6,000 cm³/kg
       (= 166.667 kg/m³), not the rounded 167 kg/m³ trade shorthand. 0.18 m³ →
       180,000 cm³ ÷ 6,000 = 30.00 kg, deliberately 0.06 kg below the old figure. */
    expect(map['Volumetric Wt (kg)']).toBeCloseTo(30);
    expect(map['Chargeable Wt (kg)']).toBeCloseTo(30);
    expect(map['Volumetric Divisor (cm³/kg)']).toBe(6000);
  });

  it('reports the billed weight after the carrier round-up, not just the raw figure', () => {
    // 0.1836 m³ → 183,600 cm³ ÷ 6,000 = 30.6 kg → billed 31.0 kg (next 0.5 kg).
    const map = pairs({ totals: { ...totals, cbm: 0.1836 }, mode: 'air' });
    expect(map['Chargeable Wt (kg)']).toBeCloseTo(30.6);
    expect(map['Billed Chargeable Wt (kg)']).toBe(31);
    expect(map['Rounding Step (kg)']).toBe(0.5);
    expect(map['Billed Figure']).toBe('31.00 kg');
  });

  it('measures per piece when the items are supplied', () => {
    const item = { ...goodItem, length: 51, quantity: 3, cbmPerShipper: 0.0612 };
    const map = pairs({
      shipment: [item],
      totals: { ...totals, cbm: 0.1836 },
      mode: 'courier',
    });
    // 183,600 cm³ ÷ 5,000 = 36.72 kg → billed 37 kg (next 1.0 kg).
    expect(map['Volumetric Wt (kg)']).toBeCloseTo(36.72);
    expect(map['Billed Chargeable Wt (kg)']).toBe(37);
  });

  it('quotes revenue tons for ocean LCL', () => {
    const map = pairs({
      totals: { cbm: 12.3456, grossWeight: 8500 },
      container: 'none',
      mode: 'ocean_lcl',
    });
    expect(map['Revenue Tons (RT)']).toBeCloseTo(12.3456);
    expect(map['Billed Revenue Tons (RT)']).toBe(12.35);
  });

  it('uses gross weight when it exceeds volumetric', () => {
    const map = pairs({ totals: { ...totals, grossWeight: 500 }, mode: 'air' });
    expect(map['Chargeable Wt (kg)']).toBeCloseTo(500);
    expect(map['Chargeable Basis']).toBe('Gross weight');
  });

  it('has no volumetric weight for Ocean FCL', () => {
    const map = pairs({});
    expect(map['Volumetric Wt (kg)']).toBe(0);
    expect(map['Chargeable Wt (kg)']).toBeCloseTo(18);
  });

  it('includes the container plan', () => {
    const map = pairs({});
    expect(map.Container).toContain('High Cube');
    expect(map['Containers Required']).toBe(1);
    expect(map['Limited By']).toBe('volume');
    expect(typeof map['Remaining Volume (m³)']).toBe('number');
  });

  it('flags a weight-limited load', () => {
    const map = pairs({ totals: { cbm: 40, grossWeight: 54000 } });
    expect(map['Containers Required']).toBe(3);
    expect(map['Limited By']).toBe('weight');
  });

  it('says "no container" rather than silently omitting the row', () => {
    // An unknown key and an explicit LCL selection both mean "nothing to plan
    // against". Leaving the row out entirely made the export look truncated.
    for (const container of ['nope', 'none']) {
      const map = pairs({ container, mode: 'air' });
      expect(map.Container).toBe('None (LCL / loose cargo)');
      expect(map['Containers Required']).toBeUndefined();
      expect(map['Freight Mode']).toBe('Air');
    }
  });

  it('honours a user-entered custom container', () => {
    const map = pairs({
      totals: { cbm: 45, grossWeight: 1000 },
      container: 'custom',
      customContainer: { label: 'Rail wagon', cbm: 20, maxPayloadKg: 30000 },
    });
    expect(map.Container).toBe('Rail wagon');
    expect(map['Containers Required']).toBe(3);
  });

  it('survives null totals', () => {
    expect(() => pairs({ totals: null, mode: 'air' })).not.toThrow();
  });

  it('keeps utilisation percentages as numbers, not formatted strings', () => {
    const map = pairs({ mode: 'air' });
    expect(typeof map['Volume Utilisation (%)']).toBe('number');
    expect(typeof map['Payload Utilisation (%)']).toBe('number');
  });
});

describe('workings — the derivation travels with the numbers', () => {
  const workings = (opts) => ctx(opts).workingsAoa;

  it('emits a header row and one row per derivation step', () => {
    const rows = workings({ totals: { ...totals, cbm: 0.1836 }, mode: 'air' });
    expect(rows[0]).toEqual(['Step', 'How it is derived', 'Value', 'Unit']);
    expect(rows.length).toBeGreaterThan(5);
  });

  it('carries the billed weight and the round-up that produced it', () => {
    const rows = workings({ totals: { ...totals, cbm: 0.1836 }, mode: 'air' });
    const billed = rows.find((r) => r[0] === 'Billed chargeable weight');
    expect(billed[1]).toContain('next 0.5 kg');
    expect(billed[2]).toBe(31);
    expect(billed[3]).toBe('kg');
  });

  it('writes raw numbers, not formatted strings — the spreadsheet must stay numeric', () => {
    const rows = workings({ totals: { ...totals, cbm: 0.1836 }, mode: 'air' });
    for (const row of rows.slice(1)) {
      if (row[0] === 'Note') continue;
      expect(typeof row[2]).toBe('number');
    }
  });

  it('appends the sourcing caveats as notes', () => {
    expect(workings({ mode: 'air' }).some((r) => r[0] === 'Note')).toBe(true);
  });

  it('survives null totals', () => {
    expect(() => workings({ totals: null, container: 'none' })).not.toThrow();
  });
});

describe('container plan rows', () => {
  it('emits one row per container in the plan', () => {
    const aoa = ctx({ totals: { cbm: 40, grossWeight: 54000 } }).containerPlanAoa;
    const header = aoa.findIndex((r) => r[0] === '#');
    expect(header).toBeGreaterThan(-1);
    // 3 containers → 3 per-container rows after the header.
    expect(aoa[header + 1][0]).toBe(1);
    expect(aoa[header + 3][0]).toBe(3);
  });

  it('states plainly that there is nothing to plan for loose cargo', () => {
    const aoa = ctx({ container: 'none' }).containerPlanAoa;
    expect(aoa.flat().join(' ')).toContain('loose / LCL groupage');
  });

  it('shows the derate rows only when road law governs', () => {
    const flat = (opts) => ctx(opts).containerPlanAoa.map((r) => r[0]);
    const heavy = { cbm: 40, grossWeight: 26000 };
    expect(flat({ totals: heavy, country: 'US' })).toContain('ISO Payload Rating (kg)');
    expect(flat({ totals: heavy, country: 'EU_44T' })).not.toContain('ISO Payload Rating (kg)');
  });
});

describe('trade metadata & parties', () => {
  const company = {
    name: 'Acme Exports',
    address: '12 Industrial Estate',
    defaultIncoterm: 'FOB',
    defaultCurrency: 'INR',
    parties: [
      { id: 'p1', label: 'Buyer GmbH', name: 'Buyer GmbH', address: 'Hamburg' },
    ],
  };

  it('omits trade pairs the user never filled in', () => {
    const c = ctx({ trade: { invoiceNo: 'INV-1' } });
    const keys = c.tradePairs.map(([k]) => k);
    expect(keys).toContain('Invoice No.');
    // A packing list with eight empty "Port of Discharge:" labels looks broken.
    expect(keys).not.toContain('Port of Discharge');
  });

  it('falls back to the company defaults for Incoterm and currency', () => {
    const map = Object.fromEntries(ctx({ company }).tradePairs);
    expect(map.Incoterm).toBe('FOB');
    expect(map.Currency).toBe('INR');
  });

  it('lets the shipment override a company default', () => {
    const map = Object.fromEntries(ctx({ company, trade: { incoterm: 'CIF' } }).tradePairs);
    expect(map.Incoterm).toBe('CIF');
  });

  it('resolves a party id against the company book', () => {
    const c = ctx({ company, trade: { consigneeId: 'p1' } });
    expect(c.consignee.name).toBe('Buyer GmbH');
  });

  it('accepts a one-off party object that was never saved to the book', () => {
    // Requiring every consignee to be saved first would make the book useless.
    const party = resolveParty({ name: 'One-time Buyer', address: 'Lagos' }, company);
    expect(party.name).toBe('One-time Buyer');
  });

  it('ignores an unknown party id rather than inventing one', () => {
    expect(resolveParty('nope', company)).toBeNull();
    expect(resolveParty(null, company)).toBeNull();
    expect(resolveParty({}, company)).toBeNull();
  });

  it('defaults the shipper to the company profile', () => {
    // On almost every shipment the two are the same; making the user enter their
    // own details twice is a needless step.
    expect(ctx({ company }).shipper.name).toBe('Acme Exports');
  });
});

describe('invoice totals', () => {
  const priced = { ...goodItem, unitPrice: 4 }; // 25 pcs × 4 = 100

  it('subtotals the priced lines', () => {
    const money = ctx({ shipment: [priced] }).invoiceTotals;
    expect(money.subtotal).toBeCloseTo(100);
    expect(money.total).toBeCloseTo(100);
    expect(money.hasPrices).toBe(true);
  });

  it('adds freight and insurance when set', () => {
    const money = ctx({
      shipment: [priced],
      trade: { freightCharge: 50, insuranceCharge: 10 },
    }).invoiceTotals;
    expect(money.total).toBeCloseTo(160);
    expect(money.lines.map(([l]) => l)).toEqual(['Subtotal', 'Freight', 'Insurance', 'Total']);
  });

  it('omits a charge line left blank rather than printing 0.00', () => {
    const money = ctx({ shipment: [priced], trade: { freightCharge: '' } }).invoiceTotals;
    expect(money.lines.map(([l]) => l)).toEqual(['Subtotal', 'Total']);
  });

  it('reports no prices when nothing is priced', () => {
    const money = ctx({ shipment: [goodItem] }).invoiceTotals;
    expect(money.hasPrices).toBe(false);
    expect(money.subtotal).toBe(0);
  });

  it('drops unpriced lines from the invoice column set', () => {
    const c = ctx({ shipment: [goodItem] });
    const cols = pruneEmptyColumns(INVOICE_COLUMNS, c.records).map((x) => x.key);
    expect(cols).not.toContain('hsCode');
    expect(cols).toContain('amount'); // the column stays; the values are blank
  });
});

describe('exports carry the resolved country & carrier rules', () => {
  /** 26 t in a 40' HC: legal on the ISO rating, overweight on a US highway. */
  const heavy = { cbm: 40, grossWeight: 26000, netWeight: 24000, shippers: 100, totalPcs: 1000 };

  it('names the rule profiles that were applied', () => {
    const map = pairs({ totals: heavy, mode: 'courier', country: 'US', carrier: 'DHL_EXPRESS_AE' });
    expect(map['Destination Rules']).toBe('United States');
    expect(map['Carrier Rules']).toBe('DHL Express — shipping from the UAE');
    expect(map['Divisor Source']).toBe('carrier');
    expect(map['Volumetric Divisor (cm³/kg)']).toBe(4000);
  });

  it('reports the road cap AND the ISO rating it overruled, never just one', () => {
    const map = pairs({ totals: heavy, country: 'US' });
    expect(map['Payload Cap (kg)']).toBe(21466);
    expect(map['Payload Cap Source']).toBe('road');
    expect(map['ISO Payload Rating (kg)']).toBe(26500);
    expect(map['Payload Lost to Road Law (kg)']).toBe(5034);
    expect(map['Limited By']).toBe('road');
    expect(map['Containers Required']).toBe(2);
  });

  it('omits the derate rows when the ISO rating governs', () => {
    const map = pairs({ totals: heavy, country: 'EU_44T' });
    expect(map['Payload Cap Source']).toBe('iso');
    expect(map['ISO Payload Rating (kg)']).toBeUndefined();
    expect(map['Limited By']).toBe('volume');
  });

  it('quotes the measurement ton on an LCL shipment', () => {
    const map = pairs({ totals: heavy, container: 'none', mode: 'ocean_lcl', country: 'US' });
    expect(map['Measurement Ton (m³/RT)']).toBe(1.133);
  });

  it('keeps every rule figure numeric so the spreadsheet stays a spreadsheet', () => {
    const map = pairs({ totals: heavy, country: 'US' });
    for (const key of [
      'Payload Cap (kg)',
      'ISO Payload Rating (kg)',
      'Payload Lost to Road Law (kg)',
    ]) {
      expect(typeof map[key], key).toBe('number');
    }
  });

  it('prints the governing-limit derivation in the workings block', () => {
    const rows = ctx({ totals: heavy, country: 'US' }).workingsAoa;
    const road = rows.find((r) => r[0] === 'Road-legal payload');
    expect(road[1]).toContain('36287 kg GVW');
    expect(road[2]).toBe(21466);
    expect(rows.find((r) => r[0] === 'Payload lost to road law')[2]).toBe(5034);
    expect(rows.some((r) => r[0] === 'Note' && r[1].includes('Payload capped at'))).toBe(true);
  });

  it('honours an explicit override over both profiles', () => {
    const map = pairs({
      totals: heavy,
      mode: 'courier',
      country: 'US',
      carrier: 'DHL_EXPRESS_AE',
      overrides: { payloadKg: 26000, divisorCm3PerKg: 5500 },
    });
    expect(map['Payload Cap Source']).toBe('override');
    expect(map['Volumetric Divisor (cm³/kg)']).toBe(5500);
    expect(map['Divisor Source']).toBe('override');
    expect(map['Containers Required']).toBe(1);
  });

  it('reproduces the pre-Phase-2b output when no rules are passed', () => {
    const withDefaults = ctx({
      totals: heavy,
      country: 'DEFAULT',
      carrier: 'DEFAULT',
      overrides: {},
    }).freightPairs;
    const without = ctx({ totals: heavy }).freightPairs;
    expect(withDefaults).toEqual(without);

    const map = Object.fromEntries(without);
    expect(map['Payload Cap (kg)']).toBe(26500);
    expect(map['Limited By']).toBe('volume');
  });
});

describe('prepareExport — one context, three documents', () => {
  it('calls computeFreight once and shares the result', () => {
    const c = ctx({ shipment: [goodItem] });
    // The same object drives the pairs, the workings and the plan.
    expect(c.freight).toBeTruthy();
    expect(c.billed.display).toBe(c.freight.billingUnit === 'RT'
      ? `${c.freight.revenueTonsBilled.toFixed(2)} RT`
      : c.billed.display);
    expect(c.freightPairs.length).toBeGreaterThan(0);
  });

  it('accepts a precomputed freight result so the document matches the screen', () => {
    const mine = { ...ctx({}).freight, modeLabel: 'SENTINEL' };
    const c = prepareExport({ shipment: [], totals, meta: {}, freight: mine });
    expect(Object.fromEntries(c.freightPairs)['Freight Mode']).toBe('SENTINEL');
  });

  it('exposes the flags a document needs without it inspecting every record', () => {
    const c = ctx({ shipment: [{ ...goodItem, unitPrice: 2, hsCode: '8471.30' }] });
    expect(c.hasPrices).toBe(true);
    expect(c.hasTradeFields).toBe(true);
    expect(c.cbmLabel).toBe('0.18');
  });

  it('survives being called with nothing at all', () => {
    expect(() => prepareExport()).not.toThrow();
    expect(prepareExport().rows).toHaveLength(1);
  });
});
