import { describe, it, expect } from 'vitest';
import {
  computeFreight,
  measureShipment,
  itemVolumeCm3,
  billedFigure,
  VOLUMETRIC_RULES,
  fmtNum,
} from './freight';
import { FREIGHT_MODES } from './calculations';

/** 51×40×30 cm = 61,200 cm³ per shipper. ×3 shippers = 183,600 cm³ = 0.1836 m³. */
const carton = {
  id: 'i1',
  name: 'Carton',
  unit: 'cm',
  length: 51,
  width: 40,
  height: 30,
  packSize: 10,
  quantity: 3,
  totalPcs: 30,
  netWeightPerUnit: 0.5,
  grossWeightPerShipper: 6,
  cbmPerShipper: 0.0612,
};

/** Same box declared in mm — must measure identically. */
const cartonMm = { ...carton, unit: 'mm', length: 510, width: 400, height: 300 };

/** No dimensions: only a pre-calculated CBM to work from. */
const presetItem = {
  id: 'i2',
  name: 'Preset',
  unit: 'cm',
  quantity: 2,
  packSize: 1,
  grossWeightPerShipper: 10,
  cbmPerShipper: 0.5,
};

describe('itemVolumeCm3', () => {
  it('measures from dimensions in cm', () => {
    expect(itemVolumeCm3(carton)).toEqual({ cm3: 61200, source: 'dims' });
  });

  it('converts non-cm units before measuring', () => {
    expect(itemVolumeCm3(cartonMm).cm3).toBeCloseTo(61200, 6);
  });

  it('falls back to the stored CBM when there are no dimensions', () => {
    expect(itemVolumeCm3(presetItem)).toEqual({ cm3: 500000, source: 'preset' });
  });

  it('prefers dimensions over a stale stored CBM', () => {
    // cbmPerShipper says 1 m³, the dimensions say 0.0612 m³ — dimensions win.
    const stale = { ...carton, cbmPerShipper: 1 };
    expect(itemVolumeCm3(stale).cm3).toBe(61200);
  });

  it('does not throw on junk', () => {
    expect(itemVolumeCm3(null).cm3).toBe(0);
    expect(itemVolumeCm3({ length: 'abc', width: null, height: undefined }).cm3).toBe(0);
  });
});

describe('measureShipment — per-piece measurement', () => {
  it('sums volume per piece across quantities', () => {
    const m = measureShipment([carton]);
    expect(m.cm3).toBe(183600);
    expect(m.lines).toHaveLength(1);
    expect(m.lines[0].cbmTotal).toBeCloseTo(0.1836, 9);
  });

  it('accumulates gross by shipper and net by real piece count', () => {
    const m = measureShipment([carton]);
    expect(m.grossKg).toBeCloseTo(18);
    expect(m.netKg).toBeCloseTo(15); // 0.5 kg × 30 pcs
  });

  it('tracks how each line was measured', () => {
    const m = measureShipment([carton, presetItem]);
    expect(m.dimsCount).toBe(1);
    expect(m.presetCount).toBe(1);
  });

  it('skips null and non-object entries', () => {
    expect(measureShipment([null, 'junk', 42, carton]).lines).toHaveLength(1);
  });

  it('handles an empty or missing list', () => {
    expect(measureShipment([]).cm3).toBe(0);
    expect(measureShipment(null).cm3).toBe(0);
  });
});

describe('computeFreight — air (IATA)', () => {
  const f = computeFreight({ items: [carton], mode: 'air' });

  it('divides per-piece volume by 6000 cm³/kg', () => {
    // 183,600 ÷ 6,000 = 30.6 kg
    expect(f.volumetricDivisor).toBe(6000);
    expect(f.volumetricKg).toBeCloseTo(30.6, 9);
    expect(f.volumetricKgPerM3).toBeCloseTo(166.6667, 4);
  });

  it('rounds the chargeable weight up to the next 0.5 kg', () => {
    expect(f.chargeableKg).toBeCloseTo(30.6, 9);
    expect(f.chargeableBilled).toBe(31);
    expect(f.roundingStepKg).toBe(0.5);
  });

  it('reports volume as the governing basis', () => {
    expect(f.basis).toBe('volumetric');
    expect(f.grossKg).toBeCloseTo(18);
  });

  it('does not push a weight already sitting on a 0.5 kg step to the next one', () => {
    // 100×100×90 cm = 900,000 cm³ ÷ 6,000 = 150.0 kg exactly.
    const exact = computeFreight({
      items: [{ ...carton, length: 100, width: 100, height: 90, quantity: 1 }],
      mode: 'air',
    });
    expect(exact.volumetricKg).toBeCloseTo(150, 9);
    expect(exact.chargeableBilled).toBe(150);
  });

  it('bills gross weight when the cargo is dense', () => {
    const dense = computeFreight({
      items: [{ ...carton, grossWeightPerShipper: 400 }],
      mode: 'air',
    });
    expect(dense.basis).toBe('gross');
    expect(dense.chargeableKg).toBeCloseTo(1200);
    expect(dense.chargeableBilled).toBe(1200);
  });

  it('is measurably different from the old aggregate cbm × 167 shorthand', () => {
    const legacy = 0.1836 * FREIGHT_MODES.air.volumetricFactor; // 30.6612 kg
    expect(legacy).toBeGreaterThan(f.volumetricKg);
    expect(legacy - f.volumetricKg).toBeCloseTo(0.0612, 4);
  });
});

describe('computeFreight — courier', () => {
  const f = computeFreight({ items: [carton], mode: 'courier' });

  it('divides per-piece volume by 5000 cm³/kg', () => {
    // 183,600 ÷ 5,000 = 36.72 kg
    expect(f.volumetricKg).toBeCloseTo(36.72, 9);
    expect(f.volumetricKgPerM3).toBe(200);
  });

  it('rounds the chargeable weight up to the next whole kilogram', () => {
    expect(f.roundingStepKg).toBe(1);
    expect(f.chargeableBilled).toBe(37);
  });
});

describe('computeFreight — ocean FCL', () => {
  const f = computeFreight({ items: [carton], mode: 'ocean_fcl', container: '40hc' });

  it('has no volumetric basis at all', () => {
    expect(f.volumetricDivisor).toBe(0);
    expect(f.volumetricKg).toBe(0);
  });

  it('charges gross weight, unrounded', () => {
    expect(f.chargeableKg).toBeCloseTo(18);
    expect(f.chargeableBilled).toBeCloseTo(18);
    expect(f.basis).toBe('gross');
  });
});

describe('computeFreight — ocean LCL revenue tons', () => {
  it('takes the greater of CBM and tonnes, then rounds up to 0.01 RT', () => {
    const f = computeFreight({
      totals: { cbm: 12.3456, grossWeight: 8500, netWeight: 8000 },
      mode: 'ocean_lcl',
    });
    expect(f.revenueTons).toBeCloseTo(12.3456, 6);
    expect(f.revenueTonsBilled).toBe(12.35);
    expect(f.basis).toBe('volumetric');
    expect(f.billingUnit).toBe('RT');
  });

  it('is weight-governed for dense cargo', () => {
    const f = computeFreight({
      totals: { cbm: 2, grossWeight: 5000, netWeight: 4800 },
      mode: 'ocean_lcl',
    });
    expect(f.revenueTons).toBeCloseTo(5);
    expect(f.revenueTonsBilled).toBe(5);
    expect(f.basis).toBe('gross');
  });

  it('keeps the legacy kg-equivalent chargeable weight max(gross, cbm × 1000)', () => {
    const f = computeFreight({
      totals: { cbm: 12.3456, grossWeight: 8500, netWeight: 0 },
      mode: 'ocean_lcl',
    });
    expect(f.chargeableKg).toBeCloseTo(12345.6, 6);
    expect(f.chargeableBilled).toBeCloseTo(12350);
  });
});

describe('computeFreight — volume source', () => {
  it('measures per piece when items are supplied', () => {
    expect(computeFreight({ items: [carton], mode: 'air' }).volumeSource).toBe('per-piece');
  });

  it('falls back to the aggregate CBM when only totals are supplied', () => {
    const f = computeFreight({
      totals: { cbm: 0.1836, grossWeight: 18, netWeight: 15 },
      mode: 'air',
    });
    expect(f.volumeSource).toBe('aggregate');
    // Same answer here, because the aggregate CBM came from the same dimensions.
    expect(f.volumetricKg).toBeCloseTo(30.6, 6);
  });

  it('uses the aggregate total for volume but per-piece measurement for weight', () => {
    const f = computeFreight({
      items: [carton],
      totals: { cbm: 0.1836, grossWeight: 18, netWeight: 15 },
      mode: 'air',
    });
    expect(f.cbm).toBeCloseTo(0.1836, 9);
    expect(f.measuredCbm).toBeCloseTo(0.1836, 9);
    expect(f.notes.join(' ')).not.toContain('differ by more than 1%');
  });

  it('flags a stored CBM that disagrees with the re-measured dimensions', () => {
    const f = computeFreight({
      items: [carton],
      totals: { cbm: 5, grossWeight: 18, netWeight: 15 },
      mode: 'air',
    });
    expect(f.notes.join(' ')).toContain('differ by more than 1%');
  });

  it('warns when a line has no measurable dimensions', () => {
    const f = computeFreight({ items: [presetItem], mode: 'air' });
    expect(f.notes.join(' ')).toContain('pre-calculated CBM');
  });
});

describe('computeFreight — container plan', () => {
  it('plans against a resolved ISO container', () => {
    const f = computeFreight({
      totals: { cbm: 70, grossWeight: 5000, netWeight: 0 },
      mode: 'ocean_fcl',
      container: '40hc',
    });
    expect(f.containerPlan.applicable).toBe(true);
    expect(f.containerPlan.count).toBe(2);
    expect(f.containerPlan.limitedBy).toBe('volume');
    expect(f.containerPlan.remainingCbm).toBeCloseTo(66); // 2 × 68 − 70
  });

  it('supports the new 45 ft high cube', () => {
    const f = computeFreight({
      totals: { cbm: 76, grossWeight: 1000, netWeight: 0 },
      mode: 'ocean_fcl',
      container: '45hc',
    });
    expect(f.container.cbm).toBe(76);
    expect(f.container.maxPayloadKg).toBe(28500);
    expect(f.containerPlan.count).toBe(1);
  });

  it('plans nothing for loose LCL cargo', () => {
    const f = computeFreight({
      totals: { cbm: 12, grossWeight: 3000, netWeight: 0 },
      mode: 'ocean_lcl',
      container: 'none',
    });
    expect(f.container).toBeNull();
    expect(f.containerPlan.applicable).toBe(false);
    expect(f.containerPlan.count).toBe(0);
  });

  it('uses a user-entered custom capacity', () => {
    const f = computeFreight({
      totals: { cbm: 45, grossWeight: 12000, netWeight: 0 },
      mode: 'ocean_fcl',
      container: 'custom',
      customContainer: { label: 'Rail wagon', cbm: 20, maxPayloadKg: 30000 },
    });
    expect(f.container.label).toBe('Rail wagon');
    expect(f.containerPlan.count).toBe(3); // ceil(45 / 20)
    expect(f.notes.join(' ')).toContain('user-entered custom figure');
  });

  it('treats an empty custom container as no container', () => {
    const f = computeFreight({
      totals: { cbm: 45, grossWeight: 12000, netWeight: 0 },
      mode: 'ocean_fcl',
      container: 'custom',
      customContainer: { label: '', cbm: 0, maxPayloadKg: 0 },
    });
    expect(f.container).toBeNull();
    expect(f.containerPlan.applicable).toBe(false);
  });

  it('ignores a capacity axis the user left blank instead of dividing by zero', () => {
    const f = computeFreight({
      totals: { cbm: 45, grossWeight: 12000, netWeight: 0 },
      mode: 'ocean_fcl',
      container: 'custom',
      customContainer: { cbm: 20, maxPayloadKg: 0 },
    });
    expect(f.containerPlan.byWeight).toBe(0);
    expect(Number.isFinite(f.containerPlan.count)).toBe(true);
    expect(f.containerPlan.count).toBe(3);
  });
});

describe('computeFreight — audit trail', () => {
  const f = computeFreight({ items: [carton], mode: 'air', container: '40hc' });

  it('returns an ordered derivation with a display string per step', () => {
    expect(f.workings.length).toBeGreaterThan(4);
    for (const w of f.workings) {
      expect(typeof w.label).toBe('string');
      expect(typeof w.expression).toBe('string');
      expect(Number.isFinite(w.value)).toBe(true);
      expect(typeof w.display).toBe('string');
    }
  });

  it('shows the divisor arithmetic verbatim', () => {
    const step = f.workings.find((w) => w.label === 'Volumetric weight');
    expect(step.expression).toContain('÷ 6,000 cm³/kg');
    expect(step.expression).toContain('166.67 kg/m³');
  });

  it('states which figure governed the charge', () => {
    const step = f.workings.find((w) => w.label === 'Chargeable weight');
    expect(step.expression).toContain('volume governs');
  });

  it('shows the round-up as its own step, so the billed figure is traceable', () => {
    const step = f.workings.find((w) => w.label === 'Billed chargeable weight');
    expect(step.expression).toContain('next 0.5 kg');
    expect(step.value).toBe(31);
  });

  it('discloses the unverified IATA rounding source rather than implying authority', () => {
    expect(f.notes.join(' ')).toContain('TACT');
  });

  it('discloses the unverified LCL 1 CBM = 1,000 kg equivalence', () => {
    const lcl = computeFreight({ totals: { cbm: 5, grossWeight: 1000 }, mode: 'ocean_lcl' });
    expect(lcl.notes.join(' ')).toContain('1 CBM = 1,000 kg');
  });

  it('says the ISO payload may be unreachable on the road', () => {
    expect(f.notes.join(' ')).toContain('Road-legal');
  });
});

describe('computeFreight — degenerate input', () => {
  it('survives no arguments at all', () => {
    const f = computeFreight();
    expect(f.mode).toBe('ocean_fcl');
    expect(f.chargeableBilled).toBe(0);
    expect(f.workings.length).toBeGreaterThan(0);
  });

  it('falls back to ocean FCL for an unknown mode', () => {
    expect(computeFreight({ mode: 'rocket' }).mode).toBe('ocean_fcl');
  });

  it('maps the legacy "ocean" mode', () => {
    expect(computeFreight({ mode: 'ocean' }).mode).toBe('ocean_fcl');
  });

  it('neutralises NaN and Infinity in totals', () => {
    const f = computeFreight({
      totals: { cbm: NaN, grossWeight: Infinity, netWeight: -5 },
      mode: 'air',
    });
    expect(Number.isFinite(f.chargeableBilled)).toBe(true);
    expect(f.grossKg).toBe(0);
    expect(f.netKg).toBe(5);
  });

  it('never returns a negative billed weight', () => {
    const f = computeFreight({
      items: [{ ...carton, length: -51, grossWeightPerShipper: -6 }],
      mode: 'air',
    });
    expect(f.chargeableBilled).toBeGreaterThanOrEqual(0);
  });
});

describe('billedFigure', () => {
  it('quotes kilograms for air', () => {
    const f = computeFreight({ items: [carton], mode: 'air' });
    expect(billedFigure(f)).toEqual({ value: 31, unit: 'kg', display: '31.00 kg' });
  });

  it('quotes revenue tons for LCL', () => {
    const f = computeFreight({ totals: { cbm: 12.3456, grossWeight: 8500 }, mode: 'ocean_lcl' });
    expect(billedFigure(f)).toEqual({ value: 12.35, unit: 'RT', display: '12.35 RT' });
  });

  it('does not throw on a missing result', () => {
    expect(billedFigure(null).display).toBe('0.00 kg');
  });
});

describe('VOLUMETRIC_RULES', () => {
  it('covers every freight mode', () => {
    for (const key of Object.keys(FREIGHT_MODES)) {
      expect(VOLUMETRIC_RULES[key]).toBeTruthy();
    }
  });

  it('states divisors in cm³/kg, matching published carrier tariffs', () => {
    expect(VOLUMETRIC_RULES.air.divisorCm3PerKg).toBe(6000);
    expect(VOLUMETRIC_RULES.courier.divisorCm3PerKg).toBe(5000);
    expect(VOLUMETRIC_RULES.ocean_lcl.divisorCm3PerKg).toBe(1000);
    expect(VOLUMETRIC_RULES.ocean_fcl.divisorCm3PerKg).toBe(0);
  });
});

describe('fmtNum', () => {
  it('groups thousands deterministically, regardless of host locale', () => {
    expect(fmtNum(1234567.891, 2)).toBe('1,234,567.89');
    expect(fmtNum(999, 0)).toBe('999');
    expect(fmtNum(0.5, 3)).toBe('0.500');
  });

  it('keeps the sign outside the grouping', () => {
    expect(fmtNum(-1234.5, 1)).toBe('-1,234.5');
  });

  it('does not emit "-0"', () => {
    expect(fmtNum(-0, 2)).toBe('0.00');
  });
});
