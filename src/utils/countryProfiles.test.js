import { describe, it, expect } from 'vitest';
import {
  COUNTRY_PROFILES,
  COUNTRY_FAMILY_MAP,
  COUNTRY_OPTION_GROUPS,
  UNRESEARCHED_COUNTRIES,
  DEFAULT_COUNTRY,
  DEFAULT_VEHICLE,
  CITATIONS,
  isValidCountry,
  countryLabel,
  resolveCountryProfile,
  roadLegalPayloadKg,
  resolvePayloadCap,
  resolveMeasurementTon,
} from './countryProfiles';
import { resolveContainer, CONTAINERS, containersNeeded } from './calculations';
import { computeFreight } from './freight';

const hc40 = resolveContainer('40hc');
const ft20 = resolveContainer('20ft');

/**
 * The number this whole phase exists for.
 * 80,000 lb GVW = 36,287 kg, less a 7,711 kg tractor, a 3,175 kg chassis and the
 * 3,935 kg tare of a 40' HC → 21,466 kg of cargo, against a 26,500 kg rating.
 */
const US_40HC_ROAD_PAYLOAD = 36287 - 7711 - 3175 - 3935; // 21,466

describe('COUNTRY_PROFILES data integrity', () => {
  it('has a DEFAULT profile that applies no road derating', () => {
    const d = COUNTRY_PROFILES[DEFAULT_COUNTRY];
    expect(d.roadMaxGvwKg).toBeNull();
    expect(d.measurementTonM3).toBeNull();
  });

  it('covers every country the research verified', () => {
    for (const key of ['US', 'EU_44T', 'EU_40T', 'GB', 'SE', 'FI', 'DE', 'DK', 'NL', 'IT']) {
      expect(COUNTRY_PROFILES[key], key).toBeTruthy();
    }
  });

  it('states the US federal limit as 80,000 lb in kilograms', () => {
    // 80,000 lb x 0.45359237 = 36,287.4 kg
    expect(COUNTRY_PROFILES.US.roadMaxGvwKg).toBe(36287);
  });

  it('gives the EU the 44 t intermodal allowance and the 40 t baseline separately', () => {
    expect(COUNTRY_PROFILES.EU_44T.roadMaxGvwKg).toBe(44000);
    expect(COUNTRY_PROFILES.EU_40T.roadMaxGvwKg).toBe(40000);
  });

  it('records the national freight-ton definitions that actually differ', () => {
    expect(COUNTRY_PROFILES.US.measurementTonM3).toBe(1.133); // 40 ft³
    expect(COUNTRY_PROFILES.GB.measurementTonM3).toBe(1.189); // 42 ft³
    // Metric countries use the 1 m³ convention, so they say nothing.
    expect(COUNTRY_PROFILES.EU_44T.measurementTonM3).toBeNull();
  });

  it('cites a source for every profile', () => {
    for (const [key, p] of Object.entries(COUNTRY_PROFILES)) {
      expect(CITATIONS[p.citation], key).toBeTruthy();
    }
  });

  it('maps every family-mapped country onto a profile that exists', () => {
    for (const [code, family] of Object.entries(COUNTRY_FAMILY_MAP)) {
      expect(COUNTRY_PROFILES[family], `${code} -> ${family}`).toBeTruthy();
    }
  });

  it('lists every selectable key in the option groups', () => {
    const listed = new Set(COUNTRY_OPTION_GROUPS.flatMap((g) => g.options));
    for (const key of Object.keys(COUNTRY_PROFILES)) expect(listed.has(key), key).toBe(true);
    for (const key of Object.keys(COUNTRY_FAMILY_MAP)) expect(listed.has(key), key).toBe(true);
    for (const key of Object.keys(UNRESEARCHED_COUNTRIES)) expect(listed.has(key), key).toBe(true);
  });

  it('keeps the four groups distinct, so a guess is never shown as researched', () => {
    const researched = COUNTRY_OPTION_GROUPS.find((g) => g.label === 'Researched').options;
    for (const key of Object.keys(COUNTRY_FAMILY_MAP)) expect(researched).not.toContain(key);
    for (const key of Object.keys(UNRESEARCHED_COUNTRIES)) expect(researched).not.toContain(key);
  });
});

describe('resolveCountryProfile', () => {
  it('resolves a researched country exactly', () => {
    const r = resolveCountryProfile('US');
    expect(r.via).toBe('exact');
    expect(r.profileKey).toBe('US');
    expect(r.mappedFrom).toBeNull();
  });

  it('resolves a mapped country through its family, and says so', () => {
    const r = resolveCountryProfile('PL');
    expect(r.via).toBe('family');
    expect(r.profileKey).toBe('EU_44T');
    expect(r.mappedFrom).toBe('Poland');
    // The label must not imply Poland was researched directly.
    expect(r.countryLabel).toContain('Poland');
    expect(r.countryLabel).toContain('EU');
  });

  /* Two research passes failed to source road limits for these markets — the first
     had no search tool, the second found the accessible references do not publish
     the figures. They stay selectable so the gap is visible instead of a user
     assuming the ISO rating is fine. */
  it('resolves a known-unknown country to no derating, and says the limit is missing', () => {
    const r = resolveCountryProfile('IN');
    expect(r.via).toBe('unresearched');
    expect(r.profile.roadMaxGvwKg).toBeNull();
    expect(r.mappedFrom).toBe('India');
    expect(r.countryLabel).toBe('India (no road limit on file)');
    expect(r.profile.citation).toBe('unresearched');
  });

  it('gives a known-unknown country identical numbers to DEFAULT', () => {
    const totalsHeavy = { cbm: 40, grossWeight: 26000, netWeight: 24000 };
    const india = computeFreight({
      totals: totalsHeavy,
      mode: 'ocean_fcl',
      container: '40hc',
      country: 'IN',
    });
    const dflt = computeFreight({
      totals: totalsHeavy,
      mode: 'ocean_fcl',
      container: '40hc',
    });
    expect(india.containerPlan.count).toBe(dflt.containerPlan.count);
    expect(india.containerPlan.payloadCapKg).toBe(dflt.containerPlan.payloadCapKg);
    // But it must not stay silent about why nothing happened.
    expect(india.notes.some((n) => n.includes('No road-weight limit is on file'))).toBe(true);
    expect(dflt.notes.some((n) => n.includes('No road-weight limit is on file'))).toBe(false);
  });

  it('accepts every known-unknown country as a valid selection', () => {
    for (const code of ['IN', 'CN', 'BR', 'AU', 'CA']) {
      expect(isValidCountry(code), code).toBe(true);
      expect(resolveCountryProfile(code).via, code).toBe('unresearched');
    }
  });

  it('falls back to DEFAULT for an unknown key rather than throwing', () => {
    for (const junk of ['ZZ', '', null, undefined, 42, {}]) {
      const r = resolveCountryProfile(junk);
      expect(r.profileKey).toBe(DEFAULT_COUNTRY);
      expect(r.via).toBe('default');
    }
  });

  it('reports DEFAULT itself as via "default", not "exact"', () => {
    expect(resolveCountryProfile(DEFAULT_COUNTRY).via).toBe('default');
  });
});

describe('isValidCountry / countryLabel', () => {
  it('accepts researched and mapped keys, rejects junk', () => {
    expect(isValidCountry('US')).toBe(true);
    expect(isValidCountry('FR')).toBe(true);
    expect(isValidCountry('ZZ')).toBe(false);
    expect(isValidCountry(undefined)).toBe(false);
  });

  it('labels a mapped country with the family it inherits from', () => {
    expect(countryLabel('FR')).toBe('France (→ EU — ISO container, 44 t combined transport)');
  });
});

describe('roadLegalPayloadKg', () => {
  it('returns null when the lane has no known road limit', () => {
    const r = roadLegalPayloadKg({
      profile: COUNTRY_PROFILES[DEFAULT_COUNTRY],
      container: hc40,
    });
    expect(r.capKg).toBeNull();
    expect(r.expression).toBeNull();
  });

  it('derives the US 40ft HC payload from GVW less tractor, chassis and tare', () => {
    const r = roadLegalPayloadKg({ profile: COUNTRY_PROFILES.US, container: hc40 });
    expect(r.capKg).toBe(US_40HC_ROAD_PAYLOAD);
    expect(r.capKg).toBe(21466);
    expect(r.tareKg).toBe(3935);
  });

  it('shows the arithmetic so the figure can be checked by hand', () => {
    const r = roadLegalPayloadKg({ profile: COUNTRY_PROFILES.US, container: hc40 });
    expect(r.expression).toBe(
      '36287 kg GVW − 7711 kg tractor − 3175 kg chassis − 3935 kg container tare'
    );
  });

  it('leaves the EU at 44 t with more payload than the ISO rating', () => {
    const r = roadLegalPayloadKg({ profile: COUNTRY_PROFILES.EU_44T, container: hc40 });
    expect(r.capKg).toBe(44000 - 7500 - 4000 - 3935); // 28,565
    expect(r.capKg).toBeGreaterThan(hc40.maxPayloadKg);
  });

  it('lets the user override the GVW, the vehicle masses and the tare', () => {
    const r = roadLegalPayloadKg({
      profile: COUNTRY_PROFILES.US,
      container: hc40,
      overrides: { roadMaxGvwKg: 40000, tractorKg: 8000, chassisKg: 3000, tareKg: 4000 },
    });
    expect(r.capKg).toBe(40000 - 8000 - 3000 - 4000);
    expect(r.estimated).toBe(false);
  });

  it('flags the payload as estimated while the vehicle masses are inherited', () => {
    const r = roadLegalPayloadKg({ profile: COUNTRY_PROFILES.US, container: hc40 });
    expect(r.estimated).toBe(true);
  });

  it('treats a blank override as "not overridden", not as zero', () => {
    const blank = roadLegalPayloadKg({
      profile: COUNTRY_PROFILES.US,
      container: hc40,
      overrides: { tractorKg: '', chassisKg: null, tareKg: undefined },
    });
    expect(blank.capKg).toBe(US_40HC_ROAD_PAYLOAD);
  });

  it('honours a typed zero — a rigid truck genuinely has no chassis to subtract', () => {
    const r = roadLegalPayloadKg({
      profile: COUNTRY_PROFILES.US,
      container: hc40,
      overrides: { chassisKg: 0 },
    });
    expect(r.capKg).toBe(US_40HC_ROAD_PAYLOAD + 3175);
  });

  it('never returns a negative payload for a GVW below the empty vehicle', () => {
    const r = roadLegalPayloadKg({
      profile: COUNTRY_PROFILES.US,
      container: hc40,
      overrides: { roadMaxGvwKg: 5000 },
    });
    expect(r.capKg).toBe(0);
  });

  it('falls back to the default vehicle masses for a profile that omits them', () => {
    const r = roadLegalPayloadKg({
      profile: { roadMaxGvwKg: 30000 },
      container: hc40,
    });
    expect(r.tractorKg).toBe(DEFAULT_VEHICLE.tractorKg);
    expect(r.chassisKg).toBe(DEFAULT_VEHICLE.chassisKg);
  });
});

describe('resolvePayloadCap — resolution order', () => {
  it('DEFAULT reproduces the ISO rating exactly, with no derating', () => {
    const r = resolvePayloadCap({ container: hc40, country: DEFAULT_COUNTRY });
    expect(r.capKg).toBe(CONTAINERS['40hc'].maxPayloadKg);
    expect(r.source).toBe('iso');
    expect(r.derateKg).toBe(0);
    expect(r.roadKg).toBeNull();
  });

  it('a US destination caps a 40ft HC below its ISO rating', () => {
    const r = resolvePayloadCap({ container: hc40, country: 'US' });
    expect(r.source).toBe('road');
    expect(r.capKg).toBe(21466);
    expect(r.isoKg).toBe(26500);
    expect(r.derateKg).toBe(26500 - 21466); // 5,034 kg of cargo lost
    expect(r.reason).toContain('United States');
  });

  it('an EU 44 t destination leaves the ISO rating governing', () => {
    const r = resolvePayloadCap({ container: hc40, country: 'EU_44T' });
    expect(r.source).toBe('iso');
    expect(r.capKg).toBe(26500);
    expect(r.derateKg).toBe(0);
    // The road figure is still reported, so the UI can say the check was made.
    expect(r.roadKg).toBe(28565);
    expect(r.reason).toContain('governs');
  });

  it('an explicit override beats both the country and the ISO rating', () => {
    const r = resolvePayloadCap({
      container: hc40,
      country: 'US',
      overrides: { payloadKg: 24000 },
    });
    expect(r.source).toBe('override');
    expect(r.capKg).toBe(24000);
  });

  it('derates a 20ft box less than a 40ft HC, because its tare is lighter', () => {
    const r20 = resolvePayloadCap({ container: ft20, country: 'US' });
    expect(r20.roadKg).toBe(36287 - 7711 - 3175 - 2200); // 23,201
    expect(r20.source).toBe('road');
  });

  it('applies no cap at all when there is no container to rate', () => {
    const r = resolvePayloadCap({ container: null, country: 'US' });
    expect(r.capKg).toBe(0);
    expect(r.source).toBe('none');
  });

  it('resolves a family-mapped country and records how it got there', () => {
    const r = resolvePayloadCap({ container: hc40, country: 'FR' });
    expect(r.resolved.via).toBe('family');
    expect(r.source).toBe('iso'); // 44 t leaves ISO governing
  });
});

describe('resolveMeasurementTon', () => {
  it('defaults to the 1 m³ international convention', () => {
    const r = resolveMeasurementTon(DEFAULT_COUNTRY);
    expect(r.value).toBe(1);
    expect(r.source).toBe('default');
  });

  it('uses the US 40 cubic feet definition', () => {
    expect(resolveMeasurementTon('US').value).toBe(1.133);
    expect(resolveMeasurementTon('US').source).toBe('country');
  });

  it('uses the UK 42 cubic feet definition', () => {
    expect(resolveMeasurementTon('GB').value).toBe(1.189);
  });

  it('falls back to 1 for a metric country that defines nothing', () => {
    expect(resolveMeasurementTon('DE').value).toBe(1);
  });

  it('lets an override win', () => {
    const r = resolveMeasurementTon('US', { measurementTonM3: 1.5 });
    expect(r.value).toBe(1.5);
    expect(r.source).toBe('override');
  });

  it('treats a blank or zero override as not overridden', () => {
    expect(resolveMeasurementTon('US', { measurementTonM3: '' }).value).toBe(1.133);
    expect(resolveMeasurementTon('US', { measurementTonM3: 0 }).value).toBe(1.133);
  });
});

describe('containersNeeded — the road-legal third constraint', () => {
  /* 26,000 kg in a 40' HC: fits on its ISO rating, illegal on a US highway.
     This is the exact scenario from the plan's manual verification steps. */
  const load = { cbm: 40, grossWeight: 26000 };

  it('fits one container with no country selected', () => {
    const plan = containersNeeded(load, '40hc');
    expect(plan.count).toBe(1);
    expect(plan.limitedBy).toBe('volume');
    expect(plan.payloadCapSource).toBe('iso');
  });

  it('needs two once the US road limit applies', () => {
    const plan = containersNeeded(load, '40hc', { roadPayloadCapKg: 21466 });
    expect(plan.count).toBe(2);
    expect(plan.limitedBy).toBe('road');
    expect(plan.byRoad).toBe(2);
    // The ISO rating alone would still have said one container.
    expect(plan.byWeight).toBe(1);
  });

  it('reports the derate so the UI can strike the ISO figure through', () => {
    const plan = containersNeeded(load, '40hc', { roadPayloadCapKg: 21466 });
    expect(plan.isoPayloadKg).toBe(26500);
    expect(plan.payloadCapKg).toBe(21466);
    expect(plan.payloadDerateKg).toBe(5034);
  });

  it('ignores a road cap that is looser than the container rating', () => {
    const plan = containersNeeded(load, '40hc', { roadPayloadCapKg: 28565 });
    expect(plan.payloadCapSource).toBe('iso');
    expect(plan.payloadCapKg).toBe(26500);
    expect(plan.limitedBy).toBe('volume');
    // Still counted, so the UI can say the check was made and did nothing.
    expect(plan.byRoad).toBe(1);
  });

  it('keeps "weight" as the reason when the container rating is what binds', () => {
    const plan = containersNeeded({ cbm: 40, grossWeight: 54000 }, '40hc');
    expect(plan.limitedBy).toBe('weight');
  });

  it('leaves a null road cap identical to omitting it entirely', () => {
    const a = containersNeeded(load, '40hc');
    const b = containersNeeded(load, '40hc', { roadPayloadCapKg: null });
    expect(b).toEqual(a);
  });

  it('measures fill against the road cap, not the unreachable rating', () => {
    const plan = containersNeeded({ cbm: 10, grossWeight: 20000 }, '40hc', {
      roadPayloadCapKg: 21466,
    });
    expect(plan.payloadFillPct).toBeCloseTo((20000 / 21466) * 100, 6);
  });

  it('keeps the no-container shape stable with the new fields', () => {
    const plan = containersNeeded({ cbm: 12, grossWeight: 3000 }, 'none', {
      roadPayloadCapKg: 21466,
    });
    expect(plan.applicable).toBe(false);
    expect(plan.payloadCapSource).toBe('none');
    expect(plan.roadPayloadCapKg).toBeNull();
    expect(plan.byRoad).toBe(0);
  });
});

describe('computeFreight — country integration', () => {
  const totals = { cbm: 40, grossWeight: 26000, netWeight: 24000 };

  it('DEFAULT reproduces the pre-profile numbers exactly', () => {
    const before = computeFreight({ totals, mode: 'ocean_fcl', container: '40hc' });
    const after = computeFreight({
      totals,
      mode: 'ocean_fcl',
      container: '40hc',
      country: DEFAULT_COUNTRY,
    });
    expect(after.containerPlan).toEqual(before.containerPlan);
    expect(after.chargeableBilled).toBe(before.chargeableBilled);
    expect(after.rulesAreDefault).toBe(true);
  });

  it('switching to the US fires the road cap and changes the plan', () => {
    const f = computeFreight({ totals, mode: 'ocean_fcl', container: '40hc', country: 'US' });
    expect(f.containerPlan.limitedBy).toBe('road');
    expect(f.containerPlan.count).toBe(2);
    expect(f.rulesAreDefault).toBe(false);
  });

  it('cites the governing limit in the workings, with the arithmetic', () => {
    const f = computeFreight({ totals, mode: 'ocean_fcl', container: '40hc', country: 'US' });
    const road = f.workings.find((w) => w.label === 'Road-legal payload');
    expect(road).toBeTruthy();
    expect(road.value).toBe(21466);
    expect(road.expression).toContain('36287 kg GVW');
    expect(f.workings.find((w) => w.label === 'Payload lost to road law').value).toBe(5034);
  });

  it('states the cap and the rating it overruled in the notes', () => {
    const f = computeFreight({ totals, mode: 'ocean_fcl', container: '40hc', country: 'US' });
    const note = f.notes.find((n) => n.includes('Payload capped at'));
    expect(note).toContain('21,466 kg');
    expect(note).toContain('26,500 kg ISO rating');
  });

  it('warns that the bridge formula can bind tighter still on a US lane', () => {
    const f = computeFreight({ totals, mode: 'ocean_fcl', container: '40hc', country: 'US' });
    expect(f.notes.some((n) => n.includes('bridge formula'))).toBe(true);
  });

  it('says the ISO rating governs when the EU limit is looser', () => {
    const f = computeFreight({ totals, mode: 'ocean_fcl', container: '40hc', country: 'EU_44T' });
    expect(f.containerPlan.payloadCapSource).toBe('iso');
    expect(f.notes.some((n) => n.includes('would allow'))).toBe(true);
  });

  it('discloses that a family-mapped country was not researched directly', () => {
    // Switzerland maps to the 40 t family, which does derate a 40' HC.
    const f = computeFreight({ totals, mode: 'ocean_fcl', container: '40hc', country: 'CH' });
    expect(f.containerPlan.payloadCapSource).toBe('road');
    expect(f.notes.some((n) => n.includes('not researched directly'))).toBe(true);
  });

  it('applies the national measurement ton to LCL revenue tons', () => {
    // 40 m³ ÷ 1.133 = 35.304 measurement tons, against 26 t of weight.
    const us = computeFreight({ totals, mode: 'ocean_lcl', container: 'none', country: 'US' });
    expect(us.measurementTonM3).toBe(1.133);
    expect(us.revenueTons).toBeCloseTo(40 / 1.133, 6);

    // The international default still bills the full 40 CBM as 40 RT.
    const intl = computeFreight({ totals, mode: 'ocean_lcl', container: 'none' });
    expect(intl.revenueTons).toBe(40);
  });

  it('shows the measurement ton in the workings only when it is not 1 m³', () => {
    const us = computeFreight({ totals, mode: 'ocean_lcl', container: 'none', country: 'US' });
    expect(us.workings.some((w) => w.label === 'Measurement ton')).toBe(true);

    const intl = computeFreight({ totals, mode: 'ocean_lcl', container: 'none' });
    expect(intl.workings.some((w) => w.label === 'Measurement ton')).toBe(false);
  });

  it('lets a payload override beat the country rule, and says it did', () => {
    const f = computeFreight({
      totals,
      mode: 'ocean_fcl',
      container: '40hc',
      country: 'US',
      overrides: { payloadKg: 26000 },
    });
    expect(f.payloadCap.source).toBe('override');
    expect(f.containerPlan.count).toBe(1);
    expect(f.workings.some((w) => w.label === 'Payload cap (manual)')).toBe(true);
  });

  /* Regression: the override used to be resolved but never handed to the container
     planner, so it changed the reported cap while leaving the plan on the ISO
     rating — the two disagreed on the same screen. */
  it('carries the override all the way into the container plan', () => {
    const f = computeFreight({
      totals,
      mode: 'ocean_fcl',
      container: '40hc',
      country: 'US',
      overrides: { payloadKg: 26000 },
    });
    expect(f.containerPlan.payloadCapSource).toBe('override');
    expect(f.containerPlan.payloadCapKg).toBe(26000);
    expect(f.containerPlan.limitedBy).toBe('volume');
  });

  it('an override tighter than the rating still needs the extra container', () => {
    const f = computeFreight({
      totals,
      mode: 'ocean_fcl',
      container: '40hc',
      overrides: { payloadKg: 20000 },
    });
    expect(f.containerPlan.count).toBe(2);
    expect(f.containerPlan.limitedBy).toBe('weight');
    expect(f.containerPlan.payloadDerateKg).toBe(6500);
  });

  it('does not claim the ISO rating governs when an override is in force', () => {
    const f = computeFreight({
      totals,
      mode: 'ocean_fcl',
      container: '40hc',
      country: 'US',
      overrides: { payloadKg: 26000 },
    });
    expect(f.notes.some((n) => n.includes('so the container rating governs'))).toBe(false);
    expect(f.notes.some((n) => n.includes('being ignored'))).toBe(true);
  });

  it('survives an unknown country key without changing any number', () => {
    const good = computeFreight({ totals, mode: 'air', container: '40hc' });
    const junk = computeFreight({ totals, mode: 'air', container: '40hc', country: 'ZZ' });
    expect(junk.chargeableBilled).toBe(good.chargeableBilled);
    expect(junk.containerPlan.count).toBe(good.containerPlan.count);
  });
});

describe('rulesAreDefault means "untouched", not "unchanged"', () => {
  const base = {
    totals: { cbm: 40, grossWeight: 26000, netWeight: 24000 },
    mode: 'ocean_fcl',
    container: '40hc',
  };

  it('is true only when neither selector nor any override was touched', () => {
    expect(computeFreight(base).rulesAreDefault).toBe(true);
    expect(computeFreight({ ...base, country: 'DEFAULT', carrier: 'DEFAULT' }).rulesAreDefault).toBe(
      true
    );
  });

  /* A destination whose road limit happens not to bind is still a decision the
     document must record — otherwise the PDF omits the selection entirely and the
     reader cannot tell whether the check was ever made. */
  it('is false for a chosen country even when the ISO rating still governs', () => {
    const f = computeFreight({ ...base, country: 'EU_44T' });
    expect(f.containerPlan.payloadCapSource).toBe('iso');
    expect(f.rulesAreDefault).toBe(false);
  });

  it('is false for a chosen carrier that does not change the mode default', () => {
    // AIR_IATA restates the 6000 divisor the air mode already uses.
    const f = computeFreight({ ...base, mode: 'air', carrier: 'AIR_IATA' });
    expect(f.volumetricDivisor).toBe(6000);
    expect(f.rulesAreDefault).toBe(false);
  });

  it('is false once any override carries a value', () => {
    expect(computeFreight({ ...base, overrides: { tareKg: 4200 } }).rulesAreDefault).toBe(false);
    expect(computeFreight({ ...base, overrides: { chassisKg: 0 } }).rulesAreDefault).toBe(false);
  });

  it('stays true when the override record holds only blanks', () => {
    const f = computeFreight({
      ...base,
      overrides: { tareKg: '', divisorCm3PerKg: null, payloadKg: undefined },
    });
    expect(f.rulesAreDefault).toBe(true);
  });

  it('is false for an unrated country, so the gap reaches the document', () => {
    expect(computeFreight({ ...base, country: 'IN' }).rulesAreDefault).toBe(false);
  });

  it('is true for a junk key, which is genuinely no selection at all', () => {
    expect(computeFreight({ ...base, country: 'ZZ', carrier: 'NOPE' }).rulesAreDefault).toBe(true);
  });
});
