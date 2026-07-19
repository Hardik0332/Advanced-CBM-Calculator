import { describe, it, expect } from 'vitest';
import {
  toCm,
  fromCm,
  convertDim,
  calcCBM,
  fmtCBM,
  CONTAINERS,
  FREIGHT_MODES,
  normalizeFreightMode,
  containersNeeded,
} from './calculations';

describe('toCm', () => {
  it('passes cm through unchanged', () => {
    expect(toCm(100, 'cm')).toBe(100);
  });
  it('converts mm', () => {
    expect(toCm(100, 'mm')).toBe(10);
  });
  it('converts inches', () => {
    expect(toCm(10, 'inches')).toBeCloseTo(25.4);
  });
  it('converts feet', () => {
    expect(toCm(1, 'feet')).toBeCloseTo(30.48);
  });
  it('converts meters', () => {
    expect(toCm(1.5, 'meters')).toBe(150);
  });
  it('returns value unchanged for unknown unit', () => {
    expect(toCm(42, 'furlongs')).toBe(42);
  });
});

describe('fromCm / convertDim round-trip', () => {
  it.each(['cm', 'mm', 'inches', 'feet', 'meters'])(
    'round-trips %s',
    (u) => {
      expect(fromCm(toCm(37.5, u), u)).toBeCloseTo(37.5, 6);
    }
  );
  it('converts 100 cm to inches', () => {
    expect(convertDim(100, 'cm', 'inches')).toBeCloseTo(39.3701, 3);
  });
  it('same-unit conversion is identity', () => {
    expect(convertDim(55.5, 'cm', 'cm')).toBe(55.5);
  });
  it('handles empty values', () => {
    expect(convertDim('', 'cm', 'inches')).toBe(0);
  });
});

describe('calcCBM', () => {
  it('computes a 1 m³ box from cm', () => {
    expect(calcCBM(100, 100, 100, 'cm')).toBe(1);
  });
  it('computes standard carton 60×40×40 cm', () => {
    expect(calcCBM(60, 40, 40, 'cm')).toBeCloseTo(0.096);
  });
  it('computes from inches', () => {
    // 39.3701 in ≈ 100 cm each side → ~1 m³
    expect(calcCBM(39.3701, 39.3701, 39.3701, 'inches')).toBeCloseTo(1, 4);
  });
  it('computes from mm', () => {
    expect(calcCBM(1000, 1000, 1000, 'mm')).toBe(1);
  });
  it('computes from meters', () => {
    expect(calcCBM(1, 1, 1, 'meters')).toBe(1);
  });
});

describe('fmtCBM', () => {
  it('formats zero', () => {
    expect(fmtCBM(0)).toBe('0.0000');
  });
  it('uses 2dp for normal values', () => {
    expect(fmtCBM(1.23456)).toBe('1.23');
  });
  it('uses 4dp for small values', () => {
    expect(fmtCBM(0.0058)).toBe('0.0058');
  });
  it('uses 6dp for very small values', () => {
    expect(fmtCBM(0.00005)).toBe('0.000050');
  });
});

describe('CONTAINERS', () => {
  it('all containers define usable cbm and max payload', () => {
    for (const c of Object.values(CONTAINERS)) {
      expect(c.cbm).toBeGreaterThan(0);
      expect(c.maxPayloadKg).toBeGreaterThan(20000);
      expect(c.label).toBeTruthy();
    }
  });
});

describe('FREIGHT_MODES', () => {
  it('air uses IATA 167 kg/m³', () => {
    expect(FREIGHT_MODES.air.volumetricFactor).toBe(167);
  });
  it('courier uses 200 kg/m³ (÷5000)', () => {
    expect(FREIGHT_MODES.courier.volumetricFactor).toBe(200);
  });
  it('ocean LCL uses W/M 1000 kg/m³', () => {
    expect(FREIGHT_MODES.ocean_lcl.volumetricFactor).toBe(1000);
  });
  it('ocean FCL has no volumetric weight', () => {
    expect(FREIGHT_MODES.ocean_fcl.volumetricFactor).toBe(0);
  });
});

describe('normalizeFreightMode', () => {
  it('maps legacy "ocean" to ocean_fcl', () => {
    expect(normalizeFreightMode('ocean')).toBe('ocean_fcl');
  });
  it('passes valid modes through', () => {
    expect(normalizeFreightMode('air')).toBe('air');
    expect(normalizeFreightMode('courier')).toBe('courier');
  });
  it('falls back to ocean_fcl for junk', () => {
    expect(normalizeFreightMode('rocket')).toBe('ocean_fcl');
    expect(normalizeFreightMode(undefined)).toBe('ocean_fcl');
  });
});

describe('containersNeeded', () => {
  it('fits a small load in one container', () => {
    const plan = containersNeeded({ cbm: 30, grossWeight: 5000 }, '40hc');
    expect(plan.count).toBe(1);
  });
  it('needs two containers when volume overflows', () => {
    const plan = containersNeeded({ cbm: 70, grossWeight: 5000 }, '40hc');
    expect(plan.count).toBe(2);
    expect(plan.limitedBy).toBe('volume');
  });
  it('is weight-limited for dense cargo (tiles) long before volume', () => {
    // 40 m³ of tiles at 54 t: volume fits in one 40HC, weight needs 3
    const plan = containersNeeded({ cbm: 40, grossWeight: 54000 }, '40hc');
    expect(plan.byVolume).toBe(1);
    expect(plan.byWeight).toBe(3);
    expect(plan.count).toBe(3);
    expect(plan.limitedBy).toBe('weight');
  });
  it('handles empty shipment', () => {
    const plan = containersNeeded({ cbm: 0, grossWeight: 0 }, '20ft');
    expect(plan.count).toBe(1);
  });
});
