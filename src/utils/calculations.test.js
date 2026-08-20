import { describe, it, expect } from 'vitest';
import {
  toCm,
  fromCm,
  convertDim,
  calcCBM,
  fmtCBM,
  CONTAINERS,
  CONTAINER_OPTIONS,
  NO_CONTAINER,
  CUSTOM_CONTAINER,
  isValidContainerType,
  resolveContainer,
  planContainers,
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

  it('includes the 45 ft high cube', () => {
    expect(CONTAINERS['45hc'].cbm).toBe(76);
    expect(CONTAINERS['45hc'].maxPayloadKg).toBe(28500);
  });

  it('usable volume stays below the geometric volume — stowage is never 100%', () => {
    for (const c of Object.values(CONTAINERS)) {
      expect(c.cbm).toBeLessThan(c.geometricCbm);
      expect(c.cbm / c.geometricCbm).toBeGreaterThan(0.8);
    }
  });

  it('payload plus tare stays within the max gross rating, to within the tare estimate', () => {
    // ISO does not fix tare — it varies with the individual box's construction —
    // and the payloads here are the app's rounded planning figures (40' std is
    // 26,700 against an exact ISO net load of 26,680). So this is a sanity check
    // on the order of magnitude, not an exact identity.
    for (const c of Object.values(CONTAINERS)) {
      expect(c.maxPayloadKg + c.tareKg).toBeLessThanOrEqual(c.maxGrossKg * 1.005);
      expect(c.maxPayloadKg + c.tareKg).toBeGreaterThan(c.maxGrossKg * 0.95);
    }
  });

  it('carries internal, door and TEU metadata for shipping documents', () => {
    for (const c of Object.values(CONTAINERS)) {
      expect(c.internalCm.l).toBeGreaterThan(0);
      expect(c.doorCm.w).toBeGreaterThan(0);
      expect(c.teu).toBeGreaterThan(0);
    }
  });
});

describe('container selection', () => {
  it('offers every ISO container plus custom and none', () => {
    expect(CONTAINER_OPTIONS).toContain('20ft');
    expect(CONTAINER_OPTIONS).toContain('45hc');
    expect(CONTAINER_OPTIONS).toContain(CUSTOM_CONTAINER);
    expect(CONTAINER_OPTIONS).toContain(NO_CONTAINER);
  });

  it('validates selections', () => {
    expect(isValidContainerType('40hc')).toBe(true);
    expect(isValidContainerType(NO_CONTAINER)).toBe(true);
    expect(isValidContainerType(CUSTOM_CONTAINER)).toBe(true);
    expect(isValidContainerType('rocket')).toBe(false);
    expect(isValidContainerType(undefined)).toBe(false);
  });
});

describe('resolveContainer', () => {
  it('resolves an ISO key to its capacity', () => {
    const c = resolveContainer('40hc');
    expect(c.key).toBe('40hc');
    expect(c.cbm).toBe(68);
  });

  it('returns null for "no container" — LCL has nothing to plan against', () => {
    expect(resolveContainer(NO_CONTAINER)).toBeNull();
  });

  it('returns null for an unknown key', () => {
    expect(resolveContainer('rocket')).toBeNull();
    expect(resolveContainer(undefined)).toBeNull();
  });

  it('builds a custom container from user input', () => {
    const c = resolveContainer(CUSTOM_CONTAINER, { label: ' Reefer ', cbm: '25.5', maxPayloadKg: '21,000' });
    expect(c.label).toBe('Reefer');
    expect(c.cbm).toBeCloseTo(25.5);
    expect(c.maxPayloadKg).toBe(21000);
    expect(c.isCustom).toBe(true);
  });

  it('names an unlabelled custom container', () => {
    expect(resolveContainer(CUSTOM_CONTAINER, { cbm: 10 }).label).toBe('Custom container');
  });

  it('treats a blank custom container as no container', () => {
    expect(resolveContainer(CUSTOM_CONTAINER, { cbm: 0, maxPayloadKg: 0 })).toBeNull();
    expect(resolveContainer(CUSTOM_CONTAINER, null)).toBeNull();
  });
});

describe('planContainers', () => {
  it('reports "not applicable" for loose cargo instead of inventing one container', () => {
    const plan = planContainers({ cbm: 12, grossWeight: 3000 }, null);
    expect(plan.applicable).toBe(false);
    expect(plan.count).toBe(0);
    expect(plan.limitedBy).toBeNull();
  });

  it('computes fill and margins across the whole plan', () => {
    const plan = planContainers({ cbm: 70, grossWeight: 5000 }, resolveContainer('40hc'));
    expect(plan.count).toBe(2);
    expect(plan.capacityCbm).toBe(136);
    expect(plan.volumeFillPct).toBeCloseTo((70 / 136) * 100);
    expect(plan.remainingCbm).toBeCloseTo(66);
    expect(plan.perContainerCbm).toBeCloseTo(35);
    expect(plan.overCbm).toBe(0);
  });

  it('reports the overflow against a single container', () => {
    const plan = planContainers({ cbm: 70, grossWeight: 5000 }, { cbm: 68, maxPayloadKg: 0 });
    expect(plan.byWeight).toBe(0);
    expect(plan.count).toBe(2);
  });

  it('ignores a capacity axis of zero rather than dividing by it', () => {
    const plan = planContainers({ cbm: 12, grossWeight: 3000 }, { cbm: 0, maxPayloadKg: 25000 });
    expect(plan.byVolume).toBe(0);
    expect(plan.count).toBe(1);
    expect(Number.isFinite(plan.volumeFillPct)).toBe(true);
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

  it('accepts "none" as a first-class selection', () => {
    const plan = containersNeeded({ cbm: 12, grossWeight: 3000 }, 'none');
    expect(plan.applicable).toBe(false);
    expect(plan.count).toBe(0);
  });

  it('accepts a custom container passed through options', () => {
    const plan = containersNeeded({ cbm: 45, grossWeight: 1000 }, 'custom', {
      customContainer: { cbm: 20, maxPayloadKg: 30000 },
    });
    expect(plan.count).toBe(3);
  });
});
