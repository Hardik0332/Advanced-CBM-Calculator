import { describe, it, expect } from 'vitest';
import {
  CARRIER_PROFILES,
  CARRIER_OPTION_GROUPS,
  CARRIER_CITATIONS,
  MODE_TARIFF_DEFAULTS,
  DEFAULT_CARRIER,
  isValidCarrier,
  carrierLabel,
  resolveCarrierProfile,
  resolveVolumetricRule,
  toIn3PerLb,
} from './carrierProfiles';
import { computeFreight, VOLUMETRIC_RULES } from './freight';
import { FREIGHT_MODES } from './calculations';

/** 100×50×40 cm = 200,000 cm³ per shipper, 1 shipper, 5 kg gross. Volume-heavy. */
const lightBox = {
  id: 'i1',
  name: 'Light box',
  unit: 'cm',
  length: 100,
  width: 50,
  height: 40,
  packSize: 1,
  quantity: 1,
  totalPcs: 1,
  netWeightPerUnit: 4,
  grossWeightPerShipper: 5,
  cbmPerShipper: 0.2,
};

describe('MODE_TARIFF_DEFAULTS is the single source of the divisors', () => {
  it('covers every freight mode', () => {
    expect(Object.keys(MODE_TARIFF_DEFAULTS).sort()).toEqual(Object.keys(FREIGHT_MODES).sort());
  });

  it('feeds freight.js VOLUMETRIC_RULES rather than being duplicated there', () => {
    for (const [mode, base] of Object.entries(MODE_TARIFF_DEFAULTS)) {
      expect(VOLUMETRIC_RULES[mode].divisorCm3PerKg, mode).toBe(base.divisorCm3PerKg);
      expect(VOLUMETRIC_RULES[mode].roundingStepKg, mode).toBe(base.roundingStepKg);
    }
  });

  it('states the published divisors: IATA 6000, courier 5000, LCL 1000, FCL none', () => {
    expect(MODE_TARIFF_DEFAULTS.air.divisorCm3PerKg).toBe(6000);
    expect(MODE_TARIFF_DEFAULTS.courier.divisorCm3PerKg).toBe(5000);
    expect(MODE_TARIFF_DEFAULTS.ocean_lcl.divisorCm3PerKg).toBe(1000);
    expect(MODE_TARIFF_DEFAULTS.ocean_fcl.divisorCm3PerKg).toBe(0);
  });

  it('states the round-up steps: air 0.5 kg, courier 1.0 kg', () => {
    expect(MODE_TARIFF_DEFAULTS.air.roundingStepKg).toBe(0.5);
    expect(MODE_TARIFF_DEFAULTS.courier.roundingStepKg).toBe(1);
  });
});

describe('CARRIER_PROFILES data integrity', () => {
  it('declares which modes each profile actually speaks to', () => {
    for (const [key, p] of Object.entries(CARRIER_PROFILES)) {
      expect(Array.isArray(p.modes), key).toBe(true);
      expect(p.modes.length, key).toBeGreaterThan(0);
      for (const mode of p.modes) expect(MODE_TARIFF_DEFAULTS[mode], `${key}/${mode}`).toBeTruthy();
    }
  });

  it('cites a source for every profile', () => {
    for (const [key, p] of Object.entries(CARRIER_PROFILES)) {
      expect(CARRIER_CITATIONS[p.citation], key).toBeTruthy();
    }
  });

  it('reproduces the researched divisor table', () => {
    expect(CARRIER_PROFILES.DHL_EXPRESS.divisors.courier).toBe(5000);
    expect(CARRIER_PROFILES.DHL_EXPRESS_AE.divisors.courier).toBe(4000);
    expect(CARRIER_PROFILES.FEDEX_INTL.divisors.courier).toBe(5000);
    expect(CARRIER_PROFILES.UPS_US_RETAIL.divisors.courier).toBe(6000);
    expect(CARRIER_PROFILES.UPS_US_DAILY.divisors.courier).toBe(5000);
    expect(CARRIER_PROFILES.USPS_DOMESTIC.divisors.courier).toBe(7000);
    expect(CARRIER_PROFILES.CANADA_POST_EXPEDITED.divisors.courier).toBe(6000);
    expect(CARRIER_PROFILES.CANADA_POST_PRIORITY.divisors.courier).toBe(5000);
    expect(CARRIER_PROFILES.AIR_DOMESTIC.divisors.air).toBe(7000);
  });

  it('leaves the DEFAULT profile overriding nothing', () => {
    expect(CARRIER_PROFILES[DEFAULT_CARRIER].divisors).toEqual({});
    expect(CARRIER_PROFILES[DEFAULT_CARRIER].rounding).toEqual({});
  });

  it('lists every profile in the option groups', () => {
    const listed = new Set(CARRIER_OPTION_GROUPS.flatMap((g) => g.options));
    for (const key of Object.keys(CARRIER_PROFILES)) expect(listed.has(key), key).toBe(true);
  });
});

describe('resolveCarrierProfile', () => {
  it('resolves a known carrier', () => {
    expect(resolveCarrierProfile('DHL_EXPRESS').key).toBe('DHL_EXPRESS');
  });

  it('falls back to DEFAULT for junk rather than throwing', () => {
    for (const junk of ['NOPE', '', null, undefined, 7]) {
      const r = resolveCarrierProfile(junk);
      expect(r.key).toBe(DEFAULT_CARRIER);
      expect(r.isDefault).toBe(true);
    }
  });

  it('accepts and labels every key', () => {
    expect(isValidCarrier('UPS_US_RETAIL')).toBe(true);
    expect(isValidCarrier('UPS_MARS')).toBe(false);
    expect(carrierLabel('DHL_EXPRESS_AE')).toBe('DHL Express — shipping from the UAE');
    expect(carrierLabel('UPS_MARS')).toBe(CARRIER_PROFILES[DEFAULT_CARRIER].label);
  });
});

describe('toIn3PerLb', () => {
  it('derives the figures carriers publish from the metric ones', () => {
    expect(toIn3PerLb(5000)).toBe(138); // published as 139; exact value 138.4
    expect(toIn3PerLb(6000)).toBe(166);
    expect(toIn3PerLb(7000)).toBe(194);
    expect(toIn3PerLb(4000)).toBe(111);
  });

  it('returns 0 when there is no divisor at all', () => {
    expect(toIn3PerLb(0)).toBe(0);
    expect(toIn3PerLb(null)).toBe(0);
    expect(toIn3PerLb(NaN)).toBe(0);
  });
});

describe('resolveVolumetricRule — resolution order', () => {
  it('mode default when no carrier is chosen', () => {
    const r = resolveVolumetricRule({ mode: 'courier' });
    expect(r.divisorCm3PerKg).toBe(5000);
    expect(r.divisorSource).toBe('mode');
    expect(r.isDefault).toBe(true);
  });

  it('carrier profile beats the mode default', () => {
    const r = resolveVolumetricRule({ mode: 'courier', carrier: 'USPS_DOMESTIC' });
    expect(r.divisorCm3PerKg).toBe(7000);
    expect(r.divisorSource).toBe('carrier');
    expect(r.isDefault).toBe(false);
  });

  it('an explicit override beats the carrier profile', () => {
    const r = resolveVolumetricRule({
      mode: 'courier',
      carrier: 'USPS_DOMESTIC',
      overrides: { divisorCm3PerKg: 4500 },
    });
    expect(r.divisorCm3PerKg).toBe(4500);
    expect(r.divisorSource).toBe('override');
  });

  it('resolves the divisor and the rounding step independently', () => {
    const r = resolveVolumetricRule({
      mode: 'courier',
      carrier: 'USPS_DOMESTIC',
      overrides: { roundingStepKg: 0.5 },
    });
    expect(r.divisorSource).toBe('carrier');
    expect(r.roundingSource).toBe('override');
    expect(r.roundingStepKg).toBe(0.5);
  });

  it('treats a blank override as not overridden', () => {
    const r = resolveVolumetricRule({
      mode: 'courier',
      overrides: { divisorCm3PerKg: '', roundingStepKg: null },
    });
    expect(r.divisorCm3PerKg).toBe(5000);
    expect(r.divisorSource).toBe('mode');
  });

  it('honours a typed zero — "no volumetric basis" is a real instruction', () => {
    const r = resolveVolumetricRule({ mode: 'courier', overrides: { divisorCm3PerKg: 0 } });
    expect(r.divisorCm3PerKg).toBe(0);
    expect(r.divisorSource).toBe('override');
  });

  it('does NOT apply a parcel tariff to an ocean container load', () => {
    const r = resolveVolumetricRule({ mode: 'ocean_lcl', carrier: 'USPS_DOMESTIC' });
    expect(r.applies).toBe(false);
    // The LCL default, not the 7,000 parcel divisor.
    expect(r.divisorCm3PerKg).toBe(1000);
    expect(r.divisorSource).toBe('mode');
  });

  it('does not apply a courier tariff to an air waybill either', () => {
    const r = resolveVolumetricRule({ mode: 'air', carrier: 'DHL_EXPRESS' });
    expect(r.applies).toBe(false);
    expect(r.divisorCm3PerKg).toBe(6000);
  });

  it('reports kg/m³ alongside the divisor, because that is what users recognise', () => {
    expect(resolveVolumetricRule({ mode: 'courier' }).kgPerM3).toBe(200);
    expect(resolveVolumetricRule({ mode: 'air' }).kgPerM3).toBeCloseTo(166.667, 3);
    expect(resolveVolumetricRule({ mode: 'ocean_fcl' }).kgPerM3).toBe(0);
  });

  it('falls back to FCL for an unknown mode instead of throwing', () => {
    const r = resolveVolumetricRule({ mode: 'teleportation' });
    expect(r.divisorCm3PerKg).toBe(0);
  });
});

describe('computeFreight — carrier integration', () => {
  const items = [lightBox];
  const totals = { cbm: 0.2, grossWeight: 5, netWeight: 4 };

  it('DEFAULT reproduces the pre-profile numbers exactly', () => {
    const before = computeFreight({ items, totals, mode: 'courier', container: 'none' });
    const after = computeFreight({
      items,
      totals,
      mode: 'courier',
      container: 'none',
      carrier: DEFAULT_CARRIER,
    });
    expect(after.volumetricKg).toBe(before.volumetricKg);
    expect(after.chargeableBilled).toBe(before.chargeableBilled);
    expect(after.rulesAreDefault).toBe(true);
  });

  it('DHL from the UAE bills 25% more than the global 5000 divisor', () => {
    const global = computeFreight({
      items,
      totals,
      mode: 'courier',
      container: 'none',
      carrier: 'DHL_EXPRESS',
    });
    const uae = computeFreight({
      items,
      totals,
      mode: 'courier',
      container: 'none',
      carrier: 'DHL_EXPRESS_AE',
    });
    expect(global.volumetricKg).toBe(200000 / 5000); // 40 kg
    expect(uae.volumetricKg).toBe(200000 / 4000); // 50 kg
    expect(uae.chargeableBilled).toBe(50);
    expect(global.chargeableBilled).toBe(40);
  });

  it('a USPS Domestic tariff bills less than the express default', () => {
    const usps = computeFreight({
      items,
      totals,
      mode: 'courier',
      container: 'none',
      carrier: 'USPS_DOMESTIC',
    });
    expect(usps.volumetricKg).toBeCloseTo(200000 / 7000, 6);
    expect(usps.chargeableBilled).toBe(29); // round up to the next whole kg
  });

  it('names the tariff in the workings so the divisor is traceable', () => {
    const f = computeFreight({
      items,
      totals,
      mode: 'courier',
      container: 'none',
      carrier: 'DHL_EXPRESS_AE',
    });
    const step = f.workings.find((w) => w.label === 'Volumetric divisor applied');
    expect(step).toBeTruthy();
    expect(step.value).toBe(4000);
    expect(step.expression).toContain('DHL Express');
    expect(step.expression).toContain('111 in³/lb');
  });

  it('omits the provenance row entirely when nothing narrowed the default', () => {
    const f = computeFreight({ items, totals, mode: 'courier', container: 'none' });
    expect(f.workings.some((w) => w.label === 'Volumetric divisor applied')).toBe(false);
  });

  it('says plainly when the selected carrier does not cover the mode', () => {
    const f = computeFreight({
      items,
      totals,
      mode: 'ocean_lcl',
      container: 'none',
      carrier: 'USPS_DOMESTIC',
    });
    expect(f.tariff.applies).toBe(false);
    expect(f.notes.some((n) => n.includes('does not cover'))).toBe(true);
  });

  it('describes an override as a contract rate, not as a published tariff', () => {
    const f = computeFreight({
      items,
      totals,
      mode: 'courier',
      container: 'none',
      carrier: 'CUSTOM',
      overrides: { divisorCm3PerKg: 4500, roundingStepKg: 0.5 },
    });
    expect(f.volumetricDivisor).toBe(4500);
    expect(f.roundingStepKg).toBe(0.5);
    const step = f.workings.find((w) => w.label === 'Volumetric divisor applied');
    expect(step.expression).toContain('Manually overridden');
  });

  it('applies the overridden rounding step to the billed figure', () => {
    // 200,000 ÷ 4500 = 44.44 kg → 44.5 at a 0.5 kg step, 45 at 1 kg.
    const half = computeFreight({
      items,
      totals,
      mode: 'courier',
      container: 'none',
      overrides: { divisorCm3PerKg: 4500, roundingStepKg: 0.5 },
    });
    expect(half.chargeableBilled).toBe(44.5);

    const whole = computeFreight({
      items,
      totals,
      mode: 'courier',
      container: 'none',
      overrides: { divisorCm3PerKg: 4500 },
    });
    expect(whole.chargeableBilled).toBe(45);
  });

  it('surfaces the unverified IATA rounding caveat when an air tariff is chosen', () => {
    const f = computeFreight({
      items,
      totals,
      mode: 'air',
      container: 'none',
      carrier: 'AIR_DOMESTIC',
    });
    expect(f.volumetricDivisor).toBe(7000);
    expect(f.carrierLabel).toBe('Air — domestic (7000)');
  });

  it('leaves FCL untouched by any carrier selection — there is no volumetric basis', () => {
    const f = computeFreight({
      items,
      totals,
      mode: 'ocean_fcl',
      container: '40hc',
      carrier: 'DHL_EXPRESS_AE',
    });
    expect(f.volumetricKg).toBe(0);
    expect(f.chargeableKg).toBe(5);
  });

  it('resolves country and carrier independently, not as one selector', () => {
    const f = computeFreight({
      items,
      totals: { cbm: 40, grossWeight: 26000, netWeight: 24000 },
      mode: 'courier',
      container: '40hc',
      country: 'US',
      carrier: 'DHL_EXPRESS_AE',
    });
    // Carrier set the divisor; country set the payload cap. Neither leaked.
    expect(f.volumetricDivisor).toBe(4000);
    expect(f.containerPlan.payloadCapSource).toBe('road');
    expect(f.countryKey).toBe('US');
    expect(f.carrierKey).toBe('DHL_EXPRESS_AE');
  });
});
