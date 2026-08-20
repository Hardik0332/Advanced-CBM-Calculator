import { describe, it, expect } from 'vitest';
import {
  SCHEMA_VERSION,
  normalizeProduct,
  normalizeShipmentItem,
  normalizeMeta,
  normalizeRuleOverrides,
  unwrap,
  wrap,
  migrateProducts,
  migrateShipment,
} from './schema';

const validProduct = {
  id: 'p1',
  name: 'Widget',
  unit: 'cm',
  length: 50,
  width: 40,
  height: 30,
  packSize: 10,
  netWeightPerUnit: 0.5,
  grossWeightPerShipper: 6,
};

describe('normalizeProduct — rejects junk', () => {
  it('returns null for non-objects', () => {
    expect(normalizeProduct(null)).toBeNull();
    expect(normalizeProduct(undefined)).toBeNull();
    expect(normalizeProduct('a string')).toBeNull();
    expect(normalizeProduct(42)).toBeNull();
    expect(normalizeProduct([])).toBeNull();
    expect(normalizeProduct(new Date())).toBeNull();
  });
});

describe('normalizeProduct — guarantees every field the UI touches', () => {
  it('passes a valid product through intact', () => {
    const p = normalizeProduct(validProduct);
    expect(p.name).toBe('Widget');
    expect(p.length).toBe(50);
    expect(p.packSize).toBe(10);
    expect(p.netWeightPerUnit).toBe(0.5);
  });

  it('supplies a name when missing — the old code threw on name.trim()', () => {
    expect(normalizeProduct({}, 0).name).toBe('Product 1');
    expect(normalizeProduct({ name: '   ' }, 4).name).toBe('Product 5');
    expect(normalizeProduct({ name: null }, 0).name).toBe('Product 1');
  });

  it('coerces a numeric name to a string', () => {
    expect(normalizeProduct({ name: 12345 }).name).toBe('12345');
  });

  it('defaults every missing numeric to 0, never undefined', () => {
    const p = normalizeProduct({ name: 'X' });
    // This is the exact crash the PDF exporter hit: undefined.toFixed(3)
    expect(p.netWeightPerUnit).toBe(0);
    expect(p.grossWeightPerShipper).toBe(0);
    expect(p.cbmPerShipper).toBe(0);
    expect(p.length).toBe(0);
    expect(() => p.netWeightPerUnit.toFixed(3)).not.toThrow();
    expect(() => p.cbmPerShipper.toFixed(5)).not.toThrow();
  });

  it('parses messy numeric strings via parseFlexibleNumber', () => {
    const p = normalizeProduct({ name: 'X', length: '1.234,56', grossWeightPerShipper: '12.5 kg' });
    expect(p.length).toBeCloseTo(1234.56);
    expect(p.grossWeightPerShipper).toBe(12.5);
  });

  it('clamps negatives — dimensions and weights are never negative', () => {
    const p = normalizeProduct({ name: 'X', length: -50, grossWeightPerShipper: -6 });
    expect(p.length).toBe(50);
    expect(p.grossWeightPerShipper).toBe(6);
  });

  it('neutralises NaN and Infinity', () => {
    const p = normalizeProduct({ name: 'X', length: NaN, width: Infinity, packSize: NaN });
    expect(p.length).toBe(0);
    expect(Number.isFinite(p.width)).toBe(true);
    expect(p.packSize).toBe(1);
  });

  it('forces packSize to at least 1 — prevents divide-by-zero downstream', () => {
    expect(normalizeProduct({ name: 'X', packSize: 0 }).packSize).toBe(1);
    expect(normalizeProduct({ name: 'X', packSize: -5 }).packSize).toBe(1);
    expect(normalizeProduct({ name: 'X', packSize: 'abc' }).packSize).toBe(1);
  });

  it('falls back to cm for an unknown unit', () => {
    expect(normalizeProduct({ name: 'X', unit: 'furlongs' }).unit).toBe('cm');
    expect(normalizeProduct({ name: 'X' }).unit).toBe('cm');
    expect(normalizeProduct({ name: 'X', unit: 'inches' }).unit).toBe('inches');
  });

  it('generates an id when missing', () => {
    expect(normalizeProduct({ name: 'X' }).id).toMatch(/^product-/);
  });

  it('preserves unknown/future fields', () => {
    const p = normalizeProduct({ ...validProduct, hsCode: '3004.90', unitPrice: 12.5 });
    expect(p.hsCode).toBe('3004.90');
    expect(p.unitPrice).toBe(12.5);
  });
});

describe('normalizeShipmentItem', () => {
  it('forces quantity to at least 1', () => {
    expect(normalizeShipmentItem({ name: 'X', quantity: 0 }).quantity).toBe(1);
    expect(normalizeShipmentItem({ name: 'X', quantity: -3 }).quantity).toBe(1);
    expect(normalizeShipmentItem({ name: 'X', quantity: NaN }).quantity).toBe(1);
    expect(normalizeShipmentItem({ name: 'X' }).quantity).toBe(1);
  });

  it('derives totalPcs when absent (legacy records lacked it)', () => {
    const i = normalizeShipmentItem({ name: 'X', packSize: 10, quantity: 3 });
    expect(i.totalPcs).toBe(30);
  });

  it('preserves a genuine partial last box', () => {
    const i = normalizeShipmentItem({ name: 'X', packSize: 10, quantity: 3, totalPcs: 25 });
    expect(i.totalPcs).toBe(25);
  });

  it('names an unnamed line Custom Item', () => {
    expect(normalizeShipmentItem({}).name).toBe('Custom Item');
  });
});

describe('normalizeMeta', () => {
  it('guarantees string types', () => {
    const m = normalizeMeta({ poNumber: 12345, containerType: '40hc', freightMode: 'air' });
    expect(m.poNumber).toBe('12345');
    expect(m.containerType).toBe('40hc');
  });
  it('returns an empty object for junk', () => {
    expect(normalizeMeta(null)).toEqual({});
    expect(normalizeMeta('nope')).toEqual({});
    expect(normalizeMeta([])).toEqual({});
  });
  it('drops a non-string poNumber safely', () => {
    expect(normalizeMeta({ poNumber: { nested: true } }).poNumber).toBe('');
  });
  it('coerces a hand-edited custom container instead of letting NaN through', () => {
    const m = normalizeMeta({
      containerType: 'custom',
      customContainer: { label: 42, cbm: 'lots', maxPayloadKg: '21,000' },
    });
    expect(m.customContainer.label).toBe('42');
    expect(m.customContainer.cbm).toBe(0);
    expect(m.customContainer.maxPayloadKg).toBe(21000);
  });
  it('reports no custom container when the key is absent or junk', () => {
    expect(normalizeMeta({ poNumber: 'x' }).customContainer).toBeNull();
    expect(normalizeMeta({ customContainer: 'nope' }).customContainer).toBeNull();
  });
  it('keeps the rule-profile selections as plain strings', () => {
    const m = normalizeMeta({ destinationCountry: 'US', carrierProfile: 'DHL_EXPRESS' });
    expect(m.destinationCountry).toBe('US');
    expect(m.carrierProfile).toBe('DHL_EXPRESS');
  });
  it('reports no rule overrides when the key is absent or junk', () => {
    expect(normalizeMeta({ poNumber: 'x' }).ruleOverrides).toBeNull();
    expect(normalizeMeta({ ruleOverrides: 'nope' }).ruleOverrides).toBeNull();
  });
});

describe('normalizeRuleOverrides', () => {
  it('keeps a numeric override', () => {
    expect(normalizeRuleOverrides({ divisorCm3PerKg: 4500 })).toEqual({
      divisorCm3PerKg: 4500,
    });
  });

  it('parses a spreadsheet-style string', () => {
    expect(normalizeRuleOverrides({ roadMaxGvwKg: '36,287' })).toEqual({
      roadMaxGvwKg: 36287,
    });
  });

  /* The distinction the whole record depends on: an empty field must fall through
     to the profile, while a typed 0 is a real instruction. Coercing blanks to 0
     would turn every untouched field into an override capping payload at nothing. */
  it('drops blank fields instead of coercing them to zero', () => {
    const out = normalizeRuleOverrides({
      divisorCm3PerKg: '',
      roundingStepKg: null,
      tractorKg: undefined,
    });
    expect(out).toEqual({});
  });

  it('keeps a deliberate zero', () => {
    expect(normalizeRuleOverrides({ chassisKg: 0 })).toEqual({ chassisKg: 0 });
  });

  it('drops an unparseable value rather than storing NaN', () => {
    expect(normalizeRuleOverrides({ payloadKg: 'heavy' })).toEqual({});
    expect(normalizeRuleOverrides({ tareKg: {} })).toEqual({});
  });

  it('ignores fields that are not rule overrides', () => {
    expect(normalizeRuleOverrides({ nonsense: 5, tareKg: 4000 })).toEqual({ tareKg: 4000 });
  });

  it('clamps an absurd entry instead of letting it poison the freight maths', () => {
    const out = normalizeRuleOverrides({ roadMaxGvwKg: 1e30, measurementTonM3: 1e30 });
    expect(out.roadMaxGvwKg).toBe(1e9);
    expect(out.measurementTonM3).toBe(1e4);
  });

  it('forces a negative entry positive — no weight or divisor is negative', () => {
    expect(normalizeRuleOverrides({ tractorKg: -7711 })).toEqual({ tractorKg: 7711 });
  });

  it('returns an empty object for junk input', () => {
    expect(normalizeRuleOverrides(null)).toEqual({});
    expect(normalizeRuleOverrides('nope')).toEqual({});
    expect(normalizeRuleOverrides([])).toEqual({});
  });
});

describe('unwrap / wrap', () => {
  it('round-trips the versioned envelope', () => {
    const { version, data } = unwrap(wrap([1, 2, 3]));
    expect(version).toBe(SCHEMA_VERSION);
    expect(data).toEqual([1, 2, 3]);
  });
  it('treats a bare array as v0 — every previous build wrote this', () => {
    const { version, data } = unwrap([validProduct]);
    expect(version).toBe(0);
    expect(data).toEqual([validProduct]);
  });
  it('treats a bare object as v0', () => {
    expect(unwrap({ poNumber: 'X' }).version).toBe(0);
  });
});

describe('migrateProducts — corruption tolerance', () => {
  it('migrates a v0 bare array', () => {
    const { items, dropped, version } = migrateProducts([validProduct]);
    expect(items).toHaveLength(1);
    expect(dropped).toBe(0);
    expect(version).toBe(0);
  });

  it('migrates a v1 envelope', () => {
    const { items, version } = migrateProducts(wrap([validProduct]));
    expect(items).toHaveLength(1);
    expect(version).toBe(1);
  });

  it('survives a non-array payload instead of throwing', () => {
    // The old code called .filter/.map on this and crashed the app.
    const { items, dropped } = migrateProducts({ x: 1 });
    expect(items).toEqual([]);
    expect(dropped).toBe(1);
  });

  it('survives null and primitives', () => {
    expect(migrateProducts(null).items).toEqual([]);
    expect(migrateProducts('garbage').items).toEqual([]);
    expect(migrateProducts(42).items).toEqual([]);
  });

  it('drops junk entries but keeps the good ones', () => {
    const { items, dropped } = migrateProducts([
      validProduct,
      null,
      'not a product',
      42,
      { ...validProduct, id: 'p2', name: 'Other' },
    ]);
    expect(items).toHaveLength(2);
    expect(dropped).toBe(3);
    expect(items.map((p) => p.name)).toEqual(['Widget', 'Other']);
  });

  it('makes every migrated record export-safe', () => {
    const { items } = migrateProducts([{ name: 'Legacy, no weights' }]);
    const p = items[0];
    expect(() => {
      p.netWeightPerUnit.toFixed(3);
      p.grossWeightPerShipper.toFixed(2);
      p.cbmPerShipper.toFixed(5);
    }).not.toThrow();
  });
});

describe('migrateShipment', () => {
  it('migrates legacy items missing totalPcs', () => {
    const { items } = migrateShipment([
      { name: 'A', packSize: 12, quantity: 2 },
      { name: 'B', packSize: 6, quantity: 1, totalPcs: 4 },
    ]);
    expect(items[0].totalPcs).toBe(24);
    expect(items[1].totalPcs).toBe(4);
  });

  it('never yields a NaN that could poison the totals reducer', () => {
    const { items } = migrateShipment([
      { name: 'A', quantity: NaN, packSize: NaN, totalPcs: NaN, cbmPerShipper: NaN },
    ]);
    const i = items[0];
    const total = i.cbmPerShipper * i.quantity;
    expect(Number.isNaN(total)).toBe(false);
    expect(i.quantity).toBe(1);
    expect(i.packSize).toBe(1);
  });
});
