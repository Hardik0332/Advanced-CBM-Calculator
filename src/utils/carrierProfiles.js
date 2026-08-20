/**
 * Carrier & service rule profiles — the volumetric divisor and the rounding step.
 *
 * These are deliberately **separate from destination country**, because that is how
 * the trade actually works and the distinction was the central finding of
 * docs/COUNTRY_FREIGHT_RULES.md §1: DHL applies 5,000 cm³/kg whether the box goes
 * to Kenya or Korea. What changes the divisor is the *carrier*, the *service level*,
 * and occasionally the *origin* — never the destination.
 *
 * The one apparent exception proves the rule. DHL Express bills 4,000 cm³/kg out of
 * the UAE, which looks country-scoped until you notice it is scoped to origin and
 * is a property of DHL's tariff, not of Emirati law. So it lives here as a service
 * variant rather than in `countryProfiles.js`.
 *
 * **Every value here must be user-editable, and that is the single most important
 * requirement in the research.** Divisors are routinely renegotiated per contract,
 * so a shipper with volume gets a number that appears in no published tariff. A
 * profile the user cannot correct is worse than no profile, because it looks
 * authoritative while being wrong for their account.
 *
 * This module owns `MODE_TARIFF_DEFAULTS`, which `freight.js` reads — so the divisor
 * a carrier profile overrides and the divisor the app falls back to are the same
 * numbers from the same place, and cannot drift apart.
 */
import { safeNonNegative } from './numbers';

/** Selection meaning "no carrier chosen — mode defaults apply", i.e. today's behaviour. */
export const DEFAULT_CARRIER = 'DEFAULT';

/**
 * Per-mode tariff defaults: the divisor and round-up used when no carrier profile
 * narrows them.
 *
 * divisorCm3PerKg — cm³ of measured volume billing as 1 kg, which is how carrier
 *                   tariffs are written. kg/m³ = 1e6 ÷ divisor, so 6000 → 166.667.
 * roundingStepKg  — the step the consignment's chargeable weight rounds UP to.
 *                   0 means no rounding.
 *
 * `freight.js` builds `VOLUMETRIC_RULES` from this, so these four pairs are the
 * only place the numbers exist.
 */
export const MODE_TARIFF_DEFAULTS = {
  // FCL is billed per container; there is no volumetric basis to divide by.
  ocean_fcl: { divisorCm3PerKg: 0, roundingStepKg: 0 },
  // 1 CBM ⇄ 1,000 kg → 1,000 cm³ per kg. Marked [U] in the research.
  ocean_lcl: { divisorCm3PerKg: 1000, roundingStepKg: 0 },
  // IATA / TACT: 6,000 cm³/kg (≈166 in³/lb), rounded up to the next 0.5 kg [U].
  air: { divisorCm3PerKg: 6000, roundingStepKg: 0.5 },
  // DHL / FedEx / UPS international express: 5,000 cm³/kg, next whole kg.
  courier: { divisorCm3PerKg: 5000, roundingStepKg: 1 },
};

/**
 * Citations for the divisor table. All from the same source, which cites the
 * carrier tariffs themselves — high confidence for the metric figures.
 */
export const CARRIER_CITATIONS = {
  dimensional_weight: {
    label: 'Wikipedia — Dimensional weight, citing carrier tariffs',
    url: 'https://en.wikipedia.org/wiki/Dimensional_weight',
    confidence: 'V',
  },
  iata_rounding: {
    label:
      'IATA / TACT chargeable-weight rounding is published only in the paid TACT ' +
      'Rules — the 0.5 kg step is industry practice, unverified here',
    url: null,
    confidence: 'U',
  },
  negotiated: {
    label: 'Contract rates override every published divisor — confirm against your own tariff',
    url: null,
    confidence: 'U',
  },
};

/**
 * Carrier & service profiles.
 *
 * modes    — which freight modes this profile speaks to. A courier tariff says
 *            nothing about an ocean LCL shipment, and pretending otherwise would
 *            silently apply a parcel divisor to a container load.
 * divisors — per-mode override of `divisorCm3PerKg`. A mode absent here falls back
 *            to `MODE_TARIFF_DEFAULTS`.
 * rounding — per-mode override of `roundingStepKg`. Rarely differs from the mode
 *            default; present so a negotiated tariff can say so.
 *
 * The imperial in³/lb figures carriers publish (139, 166, 194) are derived from the
 * metric ones on display rather than stored: the exact value behind "139" is 138.4,
 * and storing both invites them to disagree.
 */
export const CARRIER_PROFILES = {
  [DEFAULT_CARRIER]: {
    label: 'Default (IATA 6000 · courier 5000 · LCL 1000)',
    modes: ['ocean_fcl', 'ocean_lcl', 'air', 'courier'],
    divisors: {},
    rounding: {},
    citation: 'dimensional_weight',
    notes: 'Mode defaults — nothing changes unless you pick a carrier.',
  },

  DHL_EXPRESS: {
    label: 'DHL Express — global',
    modes: ['courier'],
    divisors: { courier: 5000 },
    rounding: {},
    citation: 'dimensional_weight',
    notes: '139 in³/lb as published; 5,000 cm³/kg canonical.',
  },

  DHL_EXPRESS_AE: {
    label: 'DHL Express — shipping from the UAE',
    modes: ['courier'],
    divisors: { courier: 4000 },
    rounding: {},
    citation: 'dimensional_weight',
    notes:
      'The clearest genuinely country-scoped divisor in the dataset — and it is ' +
      'scoped to ORIGIN, not destination. 250 kg/m³ instead of 200.',
  },

  FEDEX_INTL: {
    label: 'FedEx — International',
    modes: ['courier'],
    divisors: { courier: 5000 },
    rounding: {},
    citation: 'dimensional_weight',
    notes: 'Since 2015 FedEx bills greater-of-actual-or-dimensional on every shipment.',
  },

  FEDEX_US: {
    label: 'FedEx — US & Puerto Rico',
    modes: ['courier'],
    divisors: { courier: 5000 },
    rounding: {},
    citation: 'dimensional_weight',
    notes: 'Same 5,000 cm³/kg as the international service.',
  },

  UPS_INTL: {
    label: 'UPS — International',
    modes: ['courier'],
    divisors: { courier: 5000 },
    rounding: {},
    citation: 'dimensional_weight',
    notes: 'Since 2015 UPS bills greater-of-actual-or-dimensional on every shipment.',
  },

  UPS_US_DAILY: {
    label: 'UPS — US domestic, daily rates over 1 ft³',
    modes: ['courier'],
    divisors: { courier: 5000 },
    rounding: {},
    citation: 'dimensional_weight',
    notes: 'Daily-rate accounts use 5,000; packages at or under 1 ft³ use 6,000.',
  },

  UPS_US_RETAIL: {
    label: 'UPS — US domestic, retail rates',
    modes: ['courier'],
    divisors: { courier: 6000 },
    rounding: {},
    citation: 'dimensional_weight',
    notes: 'Retail counter rates use 6,000 cm³/kg at every size.',
  },

  UPS_CA_DOMESTIC: {
    label: 'UPS — Canada domestic (except Standard)',
    modes: ['courier'],
    divisors: { courier: 5000 },
    rounding: {},
    citation: 'dimensional_weight',
    notes: '',
  },

  UPS_CA_STANDARD: {
    label: 'UPS Standard — within Canada',
    modes: ['courier'],
    divisors: { courier: 6000 },
    rounding: {},
    citation: 'dimensional_weight',
    notes: '',
  },

  USPS_INTL_GXG: {
    label: 'USPS — Global Express Guaranteed',
    modes: ['courier'],
    divisors: { courier: 6000 },
    rounding: {},
    citation: 'dimensional_weight',
    notes: '',
  },

  USPS_DOMESTIC: {
    label: 'USPS — Domestic Priority, zones 5–9 over 1 ft³',
    modes: ['courier'],
    divisors: { courier: 7000 },
    rounding: {},
    citation: 'dimensional_weight',
    notes: 'The most generous published divisor at 142.9 kg/m³.',
  },

  CANADA_POST_EXPEDITED: {
    label: 'Canada Post — Expedited / Regular',
    modes: ['courier'],
    divisors: { courier: 6000 },
    rounding: {},
    citation: 'dimensional_weight',
    notes: '',
  },

  CANADA_POST_PRIORITY: {
    label: 'Canada Post — Priority / Xpresspost / US / International',
    modes: ['courier'],
    divisors: { courier: 5000 },
    rounding: {},
    citation: 'dimensional_weight',
    notes: '',
  },

  AIR_IATA: {
    label: 'Air — IATA international (6000)',
    modes: ['air'],
    divisors: { air: 6000 },
    rounding: { air: 0.5 },
    citation: 'iata_rounding',
    notes: '166 in³/lb, described as common for IATA shipments.',
  },

  AIR_DOMESTIC: {
    label: 'Air — domestic (7000)',
    modes: ['air'],
    divisors: { air: 7000 },
    rounding: { air: 0.5 },
    citation: 'dimensional_weight',
    notes:
      '194 in³/lb = 142.86 kg/m³, described as common for domestic shipments. ' +
      'This figure is US-centric; other national tariffs were not researched.',
  },

  CUSTOM: {
    label: 'Custom / negotiated tariff',
    modes: ['ocean_fcl', 'ocean_lcl', 'air', 'courier'],
    divisors: {},
    rounding: {},
    citation: 'negotiated',
    editable: true,
    notes:
      'Enter the divisor and round-up from your own contract. Published divisors are ' +
      'routinely renegotiated, so this is the accurate option for most real accounts.',
  },
};

/** Every selectable carrier value, grouped for an `<optgroup>` select. */
export const CARRIER_OPTION_GROUPS = [
  { label: 'No carrier rules', options: [DEFAULT_CARRIER] },
  {
    label: 'Courier & express',
    options: Object.keys(CARRIER_PROFILES).filter(
      (k) => CARRIER_PROFILES[k].modes.length === 1 && CARRIER_PROFILES[k].modes[0] === 'courier'
    ),
  },
  {
    label: 'Air freight',
    options: Object.keys(CARRIER_PROFILES).filter(
      (k) => CARRIER_PROFILES[k].modes.length === 1 && CARRIER_PROFILES[k].modes[0] === 'air'
    ),
  },
  { label: 'Your own tariff', options: ['CUSTOM'] },
];

/** Is this a carrier selection the app understands? */
export const isValidCarrier = (key) => Boolean(CARRIER_PROFILES[key]);

/** Display label for any carrier key, falling back to the default profile's label. */
export const carrierLabel = (key) =>
  CARRIER_PROFILES[key]?.label ?? CARRIER_PROFILES[DEFAULT_CARRIER].label;

/**
 * Resolve a carrier selection to a profile. Unknown keys fall back to DEFAULT
 * rather than throwing, so a stale persisted value degrades to today's behaviour.
 *
 * @param {string} key
 * @returns {{key: string, profile: object, isDefault: boolean}}
 */
export const resolveCarrierProfile = (key) => {
  const profile = CARRIER_PROFILES[key];
  if (!profile) {
    return {
      key: DEFAULT_CARRIER,
      profile: CARRIER_PROFILES[DEFAULT_CARRIER],
      isDefault: true,
    };
  }
  return { key, profile, isDefault: key === DEFAULT_CARRIER };
};

/**
 * Read an override that may legitimately be blank. `''`/null/undefined mean "not
 * overridden"; a typed 0 is a real instruction (no volumetric basis at all) and wins.
 *
 * @param {*} v
 * @returns {number|null}
 */
const override = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
};

/** cm³ in one cubic metre — for the kg/m³ figure users recognise. */
const CM3_PER_M3 = 1_000_000;

/**
 * Imperial equivalent of a metric divisor, in in³/lb.
 *
 * Derived rather than stored: 5,000 cm³/kg is exactly 138.4 in³/lb, which carriers
 * publish as 139. Rounding here keeps the two representations consistent.
 *
 * @param {number} divisorCm3PerKg
 * @returns {number} 0 when there is no divisor.
 */
export const toIn3PerLb = (divisorCm3PerKg) => {
  const d = safeNonNegative(divisorCm3PerKg);
  if (d <= 0) return 0;
  // 1 in³ = 16.387064 cm³, 1 lb = 0.45359237 kg.
  return Math.round((d / 16.387064) * 0.45359237);
};

/**
 * Resolve the volumetric divisor and rounding step for one mode.
 *
 * Resolution order, per the plan — and each step is reported rather than applied
 * silently, so the UI can state which rule fired:
 *
 *     explicit user override → carrier/service profile → mode default
 *
 * A carrier that does not speak to the requested mode is reported with
 * `applies: false` and contributes nothing. That matters: selecting "USPS Domestic"
 * must not quietly apply a 7,000 parcel divisor to an ocean LCL container load.
 *
 * @param {object} args
 * @param {string} args.mode - Freight mode key.
 * @param {string} [args.carrier] - Carrier selection key.
 * @param {object} [args.overrides] - `{ divisorCm3PerKg, roundingStepKg }`.
 * @returns {object} Resolved tariff plus provenance for every field.
 */
export const resolveVolumetricRule = ({ mode, carrier = DEFAULT_CARRIER, overrides = {} } = {}) => {
  const base = MODE_TARIFF_DEFAULTS[mode] ?? MODE_TARIFF_DEFAULTS.ocean_fcl;
  const { key: carrierKey, profile } = resolveCarrierProfile(carrier);
  const applies = Array.isArray(profile.modes) && profile.modes.includes(mode);

  const fromCarrierDivisor = applies ? override(profile.divisors?.[mode]) : null;
  const fromCarrierRounding = applies ? override(profile.rounding?.[mode]) : null;

  const explicitDivisor = override(overrides?.divisorCm3PerKg);
  const explicitRounding = override(overrides?.roundingStepKg);

  let divisorCm3PerKg = base.divisorCm3PerKg;
  let divisorSource = 'mode';
  if (explicitDivisor !== null) {
    divisorCm3PerKg = explicitDivisor;
    divisorSource = 'override';
  } else if (fromCarrierDivisor !== null) {
    divisorCm3PerKg = fromCarrierDivisor;
    divisorSource = 'carrier';
  }

  let roundingStepKg = base.roundingStepKg;
  let roundingSource = 'mode';
  if (explicitRounding !== null) {
    roundingStepKg = explicitRounding;
    roundingSource = 'override';
  } else if (fromCarrierRounding !== null) {
    roundingStepKg = fromCarrierRounding;
    roundingSource = 'carrier';
  }

  return {
    mode,
    divisorCm3PerKg,
    divisorSource,
    roundingStepKg,
    roundingSource,
    kgPerM3: divisorCm3PerKg > 0 ? CM3_PER_M3 / divisorCm3PerKg : 0,
    in3PerLb: toIn3PerLb(divisorCm3PerKg),
    carrierKey,
    carrierLabel: profile.label,
    /* False when the chosen carrier's tariff has nothing to say about this mode —
       the caller surfaces it instead of implying the profile was applied. */
    applies,
    /* True when nothing narrowed the mode default, i.e. output identical to before
       this phase existed. Tests assert on it; the UI uses it to stay quiet. */
    isDefault: divisorSource === 'mode' && roundingSource === 'mode',
    citation: profile.citation ?? null,
    notes: profile.notes ?? '',
  };
};
