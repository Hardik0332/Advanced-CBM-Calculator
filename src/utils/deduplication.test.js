import { describe, it, expect } from 'vitest';
import { compositeKey, mergeProducts } from './deduplication';

const base = {
  name: 'Widget',
  unit: 'cm',
  length: 50,
  width: 40,
  height: 30,
  packSize: 10,
  netWeightPerUnit: 0.5,
  grossWeightPerShipper: 6,
};

describe('compositeKey', () => {
  it('is case/whitespace-insensitive on name', () => {
    expect(compositeKey({ ...base, name: '  WIDGET ' })).toBe(compositeKey(base));
  });
  it('differs when the unit differs (inches ≠ cm)', () => {
    expect(compositeKey({ ...base, unit: 'inches' })).not.toBe(compositeKey(base));
  });
  it('differs when a dimension differs', () => {
    expect(compositeKey({ ...base, length: 51 })).not.toBe(compositeKey(base));
  });
  it('differs when pack size differs (variant)', () => {
    expect(compositeKey({ ...base, packSize: 20 })).not.toBe(compositeKey(base));
  });
  it('defaults missing unit to cm for legacy products', () => {
    const legacy = { ...base };
    delete legacy.unit;
    expect(compositeKey(legacy)).toBe(compositeKey({ ...base, unit: 'cm' }));
  });
});

describe('mergeProducts', () => {
  it('adds new products', () => {
    const { nextProducts, added, skipped } = mergeProducts([], [{ ...base }]);
    expect(nextProducts).toHaveLength(1);
    expect(added).toBe(1);
    expect(skipped).toBe(0);
  });

  it('skips exact duplicates against existing', () => {
    const { nextProducts, added, skipped } = mergeProducts(
      [{ ...base }],
      [{ ...base, id: 'other' }]
    );
    expect(nextProducts).toHaveLength(1);
    expect(added).toBe(0);
    expect(skipped).toBe(1);
  });

  it('skips duplicates within the same batch', () => {
    const { nextProducts, added, skipped } = mergeProducts(
      [],
      [{ ...base }, { ...base, id: 'dup' }]
    );
    expect(nextProducts).toHaveLength(1);
    expect(added).toBe(1);
    expect(skipped).toBe(1);
  });

  it('keeps same name / different dims as a new variant', () => {
    const { nextProducts, added } = mergeProducts(
      [{ ...base }],
      [{ ...base, id: 'v2', length: 60 }]
    );
    expect(nextProducts).toHaveLength(2);
    expect(added).toBe(1);
  });

  it('keeps same dims / different unit as a new product', () => {
    const { nextProducts, added } = mergeProducts(
      [{ ...base }],
      [{ ...base, id: 'in', unit: 'inches' }]
    );
    expect(nextProducts).toHaveLength(2);
    expect(added).toBe(1);
  });

  it('never persists rows tagged skipped', () => {
    const { nextProducts } = mergeProducts(
      [],
      [{ ...base, status: 'skipped', skipReason: 'Missing Dimensions' }]
    );
    expect(nextProducts).toHaveLength(0);
  });

  it('strips status fields from persisted products', () => {
    const { nextProducts } = mergeProducts([], [{ ...base, status: 'new' }]);
    expect(nextProducts[0]).not.toHaveProperty('status');
    expect(nextProducts[0]).not.toHaveProperty('skipReason');
  });

  it('returns the same array reference when nothing was added', () => {
    const existing = [{ ...base }];
    const { nextProducts } = mergeProducts(existing, [{ ...base }]);
    expect(nextProducts).toBe(existing);
  });
});
