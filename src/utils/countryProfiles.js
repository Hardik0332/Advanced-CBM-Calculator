/**
 * Destination-country rule profiles.
 *
 * The research behind every figure here is in docs/COUNTRY_FREIGHT_RULES.md, and
 * its headline finding shapes this whole module: **CBM does not vary by country.**
 * `L × W × H ÷ 1e6` is geometry, so `calcCBM` stays country-agnostic. What a
 * destination genuinely changes is narrower and more consequential:
 *
 *   1. the **road-legal payload** of a loaded container — up to −25% vs the ISO
 *      rating, and the app previously reported ISO ratings as if they were
 *      achievable everywhere;
 *   2. the **measurement-ton** definition used to quote ocean LCL (US 40 ft³,
 *      UK 42 ft³, international 1 m³);
 *   3. the **preferred units** for display.
 *
 * It does **not** change the volumetric divisor. That is a carrier/service
 * property — see `carrierProfiles.js`. The one genuinely country-scoped divisor in
 * the whole dataset (DHL from the UAE, 4000) is scoped to *origin*, and is
 * modelled there as a service variant rather than here.
 *
 * Why this matters concretely: a 40′ HC bound for the US road network can legally
 * carry ≈21,466 kg, not its 26,545 kg ISO rating. A user planning to the ISO
 * figure builds a load ~5 t over the federal limit. One dropdown prevents that.
 *
 * Confidence is tracked per figure, not per module: `V` means verified against a
 * cited source during the research pass, `U` means widely used but not confirmed
 * from a primary source. `U` figures are surfaced as such in the UI rather than
 * presented as law.
 */
import { safeNonNegative } from './numbers';

/** Selection meaning "no country rules — ISO ratings govern", i.e. today's behaviour. */
export const DEFAULT_COUNTRY = 'DEFAULT';

/**
 * Citations, keyed so a profile can point at one and the UI's `[why?]` link can
 * render the source without duplicating the URL at every field.
 */
export const CITATIONS = {
  us_fhwa: {
    label: 'FHWA / FMCSA 23 CFR §658.17 — Interstate 80,000 lb GVW',
    url: 'https://en.wikipedia.org/wiki/Federal_Bridge_Gross_Weight_Formula',
    confidence: 'V',
  },
  eu_directive: {
    label: 'Directive 96/53/EC — 40 t general, 44 t for combined transport of an ISO container',
    url: 'https://en.wikipedia.org/wiki/Semi-trailer_truck',
    confidence: 'V',
  },
  semitrailer: {
    label: 'Wikipedia — Semi-trailer truck (national GVW limits)',
    url: 'https://en.wikipedia.org/wiki/Semi-trailer_truck',
    confidence: 'V',
  },
  freight_ton: {
    label: 'Wikipedia — Freight ton (US 40 ft³ = 1.133 m³, UK 42 ft³ = 1.189 m³)',
    url: 'https://en.wikipedia.org/wiki/Freight_ton',
    confidence: 'V',
  },
  iso_container: {
    label: 'Wikipedia — Intermodal container, citing ISO 668 / ISO 1496-1',
    url: 'https://en.wikipedia.org/wiki/Intermodal_container',
    confidence: 'V',
  },
  tractor_estimate: {
    label:
      'Tractor and chassis masses are typical estimates, not law — read the real ' +
      'figures off the vehicle plate and override them here',
    url: null,
    confidence: 'U',
  },
  unresearched: {
    label:
      'No road-weight limit on file for this country. The sources available to this ' +
      'build do not publish one, and a guessed figure on a shipping document is worse ' +
      'than an absent one — enter the GVW yourself to apply a cap',
    url: null,
    confidence: 'U',
  },
};

/**
 * Vehicle masses assumed when deriving a road-legal payload.
 *
 * These are the weakest link in the chain and are deliberately editable: a day-cab
 * tractor and a sleeper differ by well over a tonne, and that tonne comes straight
 * off the cargo. Both figures are marked `U` in the research.
 */
export const DEFAULT_VEHICLE = {
  /** ≈17,000 lb — US 6×4 sleeper tractor. */
  tractorKg: 7711,
  /** ≈7,000 lb — US tandem-axle container chassis. */
  chassisKg: 3175,
};

/**
 * Destination-country profiles.
 *
 * roadMaxGvwKg    — maximum gross vehicle weight for an articulated combination.
 *                   `null` means "no road derating known" → the ISO container
 *                   rating governs, which is exactly today's behaviour.
 * axleLimits      — informational; per-axle law can bind before GVW on a badly
 *                   distributed load, which this module does not attempt to model.
 * railMaxGrossKg  — intermodal rail ceilings, tighter than road for 20′ boxes.
 * typicalTractorKg / typicalChassisKg — estimates subtracted from GVW.
 * measurementTonM3 — m³ per freight ton for LCL quoting. `null` ⇒ 1 m³.
 * preferredUnits  — display convention. Informational in this phase.
 * bridgeFormula   — whether an axle-spacing bridge formula also applies.
 */
export const COUNTRY_PROFILES = {
  [DEFAULT_COUNTRY]: {
    label: 'Default (ISO / international)',
    roadMaxGvwKg: null,
    axleLimits: null,
    railMaxGrossKg: null,
    typicalTractorKg: DEFAULT_VEHICLE.tractorKg,
    typicalChassisKg: DEFAULT_VEHICLE.chassisKg,
    measurementTonM3: null,
    preferredUnits: 'metric',
    bridgeFormula: false,
    citation: 'iso_container',
    notes: 'ISO container ratings, no road-law derating. Nothing changes unless you choose a country.',
  },

  US: {
    label: 'United States',
    roadMaxGvwKg: 36287, // 80,000 lb
    axleLimits: { singleKg: 9072, tandemKg: 15422 }, // 20,000 / 34,000 lb
    railMaxGrossKg: { '20ft': 24000, '40ft': 30500, '40hc': 30500, '45hc': 30500 },
    typicalTractorKg: 7711,
    typicalChassisKg: 3175,
    measurementTonM3: 1.133, // 40 ft³
    preferredUnits: 'imperial',
    bridgeFormula: true,
    citation: 'us_fhwa',
    notes:
      'Federal Interstate limit is 80,000 lb gross. The Federal Bridge Gross Weight ' +
      'Formula can cap a short-wheelbase combination below that; state permits can raise it.',
  },

  EU_44T: {
    label: 'EU — ISO container, 44 t combined transport',
    roadMaxGvwKg: 44000,
    axleLimits: null,
    railMaxGrossKg: null,
    typicalTractorKg: 7500,
    typicalChassisKg: 4000,
    measurementTonM3: null,
    preferredUnits: 'metric',
    bridgeFormula: false,
    citation: 'eu_directive',
    notes:
      'The 44 t intermodal allowance applies to road legs of a combined transport ' +
      'movement carrying an ISO container. General freight is capped at 40 t.',
  },

  EU_40T: {
    label: 'EU — general freight, 40 t',
    roadMaxGvwKg: 40000,
    axleLimits: null,
    railMaxGrossKg: null,
    typicalTractorKg: 7500,
    typicalChassisKg: 4000,
    measurementTonM3: null,
    preferredUnits: 'metric',
    bridgeFormula: false,
    citation: 'eu_directive',
    notes: 'Directive 96/53/EC baseline for a five-axle articulated combination.',
  },

  GB: {
    label: 'United Kingdom',
    roadMaxGvwKg: 44000,
    axleLimits: null,
    railMaxGrossKg: null,
    typicalTractorKg: 7500,
    typicalChassisKg: 4000,
    measurementTonM3: 1.189, // 42 ft³
    preferredUnits: 'metric',
    bridgeFormula: false,
    citation: 'semitrailer',
    notes: '44,000 kg requires three or more axles on both the tractor and the semi-trailer.',
  },

  IT: {
    label: 'Italy',
    roadMaxGvwKg: 44000,
    axleLimits: null,
    railMaxGrossKg: null,
    typicalTractorKg: 7500,
    typicalChassisKg: 4000,
    measurementTonM3: null,
    preferredUnits: 'metric',
    bridgeFormula: false,
    citation: 'semitrailer',
    notes: '44 t permitted for combinations of five axles or more.',
  },

  SE: {
    label: 'Sweden',
    roadMaxGvwKg: 60000,
    axleLimits: null,
    railMaxGrossKg: null,
    typicalTractorKg: 7500,
    typicalChassisKg: 4000,
    measurementTonM3: null,
    preferredUnits: 'metric',
    bridgeFormula: false,
    citation: 'semitrailer',
    notes:
      '60 t at up to 25.25 m under the 1996 EEA exemption. Route-specific permits ' +
      'reach 76 t and 90 t for bulk ore.',
  },

  FI: {
    label: 'Finland',
    roadMaxGvwKg: 76000,
    axleLimits: null,
    railMaxGrossKg: null,
    typicalTractorKg: 7500,
    typicalChassisKg: 4000,
    measurementTonM3: null,
    preferredUnits: 'metric',
    bridgeFormula: false,
    citation: 'semitrailer',
    notes: '76 t since January 2013, with the height limit raised from 4.2 m to 4.4 m.',
  },

  DE: {
    label: 'Germany',
    roadMaxGvwKg: 60000,
    axleLimits: null,
    railMaxGrossKg: null,
    typicalTractorKg: 7500,
    typicalChassisKg: 4000,
    measurementTonM3: null,
    preferredUnits: 'metric',
    bridgeFormula: false,
    citation: 'semitrailer',
    notes:
      '60 t applies only to approved routes for 25.25 m combinations. Off-network ' +
      'movements fall back to the 40 t / 44 t EU limits — pick EU_44T if unsure.',
  },

  DK: {
    label: 'Denmark',
    roadMaxGvwKg: 60000,
    axleLimits: null,
    railMaxGrossKg: null,
    typicalTractorKg: 7500,
    typicalChassisKg: 4000,
    measurementTonM3: null,
    preferredUnits: 'metric',
    bridgeFormula: false,
    citation: 'semitrailer',
    notes: '60 t on approved routes for 25.25 m combinations.',
  },

  NL: {
    label: 'Netherlands',
    roadMaxGvwKg: 60000,
    axleLimits: null,
    railMaxGrossKg: null,
    typicalTractorKg: 7500,
    typicalChassisKg: 4000,
    measurementTonM3: null,
    preferredUnits: 'metric',
    bridgeFormula: false,
    citation: 'semitrailer',
    notes: '60 t for 25.25 m combinations, introduced as a trial and now routine.',
  },
};

/**
 * Countries that were **not** individually researched, mapped to the regional
 * family that best describes them.
 *
 * This mapping is deliberately explicit and visible rather than hidden behind a
 * fallback: an exhaustive 195-country table is neither achievable nor verifiable
 * from the sources available, and pretending otherwise would put unsourced numbers
 * on a shipping document. Every entry here is an **assumption the user can see and
 * change**, which is the honest version of the same feature.
 *
 * Marked `U` throughout — these are reasoned regional defaults, not researched law.
 */
export const COUNTRY_FAMILY_MAP = {
  FR: 'EU_44T',
  ES: 'EU_44T',
  BE: 'EU_44T',
  PT: 'EU_44T',
  AT: 'EU_44T',
  IE: 'EU_44T',
  PL: 'EU_44T',
  CZ: 'EU_44T',
  SK: 'EU_44T',
  HU: 'EU_44T',
  RO: 'EU_44T',
  BG: 'EU_44T',
  GR: 'EU_44T',
  HR: 'EU_44T',
  SI: 'EU_44T',
  LT: 'EU_44T',
  LV: 'EU_44T',
  EE: 'EU_44T',
  LU: 'EU_44T',
  NO: 'SE',
  CH: 'EU_40T',
};

/** Human labels for the mapped countries, so the dropdown reads like a country list. */
export const MAPPED_COUNTRY_LABELS = {
  FR: 'France',
  ES: 'Spain',
  BE: 'Belgium',
  PT: 'Portugal',
  AT: 'Austria',
  IE: 'Ireland',
  PL: 'Poland',
  CZ: 'Czechia',
  SK: 'Slovakia',
  HU: 'Hungary',
  RO: 'Romania',
  BG: 'Bulgaria',
  GR: 'Greece',
  HR: 'Croatia',
  SI: 'Slovenia',
  LT: 'Lithuania',
  LV: 'Latvia',
  EE: 'Estonia',
  LU: 'Luxembourg',
  NO: 'Norway',
  CH: 'Switzerland',
};

/**
 * Countries the research could not cover.
 *
 * Listed as selectable rather than omitted, and that is a deliberate choice. Two
 * attempts were made to source road-weight limits for these markets — the original
 * research pass had no search tool, and a later pass with one found the accessible
 * references simply do not publish the figures. Leaving them off the list would
 * mean a user shipping to India picks nothing, sees the ISO rating, and assumes it
 * is achievable. Listing them with the gap stated makes the unknown visible and
 * points at the override that fixes it.
 *
 * Each resolves to no road derating — identical to DEFAULT — plus a note saying why.
 */
export const UNRESEARCHED_COUNTRIES = {
  IN: 'India',
  CN: 'China',
  BR: 'Brazil',
  AU: 'Australia',
  CA: 'Canada',
};

/** Every selectable value, grouped for an `<optgroup>` select. */
export const COUNTRY_OPTION_GROUPS = [
  {
    label: 'No country rules',
    options: [DEFAULT_COUNTRY],
  },
  {
    label: 'Researched',
    options: Object.keys(COUNTRY_PROFILES).filter((k) => k !== DEFAULT_COUNTRY),
  },
  {
    label: 'Mapped to a regional family',
    options: Object.keys(COUNTRY_FAMILY_MAP),
  },
  {
    label: 'No limit on file — set the GVW yourself',
    options: Object.keys(UNRESEARCHED_COUNTRIES),
  },
];

/** Is this a country selection the app understands? */
export const isValidCountry = (key) =>
  Boolean(COUNTRY_PROFILES[key]) ||
  Boolean(COUNTRY_FAMILY_MAP[key]) ||
  Boolean(UNRESEARCHED_COUNTRIES[key]);

/**
 * Display label for any selectable country key, mapped or researched.
 *
 * @param {string} key
 * @returns {string}
 */
export const countryLabel = (key) => {
  if (COUNTRY_PROFILES[key]) return COUNTRY_PROFILES[key].label;
  const family = COUNTRY_FAMILY_MAP[key];
  if (family) {
    const name = MAPPED_COUNTRY_LABELS[key] || key;
    return `${name} (→ ${COUNTRY_PROFILES[family]?.label ?? family})`;
  }
  if (UNRESEARCHED_COUNTRIES[key]) {
    return `${UNRESEARCHED_COUNTRIES[key]} (no road limit on file)`;
  }
  return key ? String(key) : COUNTRY_PROFILES[DEFAULT_COUNTRY].label;
};

/**
 * Resolve a country selection to a concrete profile, reporting **how** it
 * resolved so the UI can say "Poland, using the EU 44 t family" rather than
 * implying Poland was researched directly.
 *
 * @param {string} key - A profile key, a mapped ISO-2 code, or anything else.
 * @returns {{key: string, profileKey: string, profile: object,
 *            via: 'exact'|'family'|'unresearched'|'default', mappedFrom: string|null,
 *            countryLabel: string}}
 */
export const resolveCountryProfile = (key) => {
  if (COUNTRY_PROFILES[key]) {
    return {
      key,
      profileKey: key,
      profile: COUNTRY_PROFILES[key],
      via: key === DEFAULT_COUNTRY ? 'default' : 'exact',
      mappedFrom: null,
      countryLabel: COUNTRY_PROFILES[key].label,
    };
  }

  const family = COUNTRY_FAMILY_MAP[key];
  if (family && COUNTRY_PROFILES[family]) {
    return {
      key,
      profileKey: family,
      profile: COUNTRY_PROFILES[family],
      via: 'family',
      mappedFrom: MAPPED_COUNTRY_LABELS[key] || key,
      countryLabel: countryLabel(key),
    };
  }

  /* A country we know we do not know. Behaves exactly like DEFAULT — no derating —
     but carries its own label and citation so the UI can say the limit is missing
     rather than implying none exists. */
  if (UNRESEARCHED_COUNTRIES[key]) {
    return {
      key,
      profileKey: DEFAULT_COUNTRY,
      profile: {
        ...COUNTRY_PROFILES[DEFAULT_COUNTRY],
        label: countryLabel(key),
        citation: 'unresearched',
        notes: CITATIONS.unresearched.label + '.',
      },
      via: 'unresearched',
      mappedFrom: UNRESEARCHED_COUNTRIES[key],
      countryLabel: countryLabel(key),
    };
  }

  return {
    key: DEFAULT_COUNTRY,
    profileKey: DEFAULT_COUNTRY,
    profile: COUNTRY_PROFILES[DEFAULT_COUNTRY],
    via: 'default',
    mappedFrom: null,
    countryLabel: COUNTRY_PROFILES[DEFAULT_COUNTRY].label,
  };
};

/**
 * Read an override that may legitimately be blank.
 *
 * The rules panel writes raw input strings, so `''`, `null` and `undefined` all
 * mean "not overridden" and must fall through to the profile — whereas a typed `0`
 * is a real instruction (e.g. "no chassis, this is a rigid truck") and must win.
 *
 * @param {*} v
 * @returns {number|null}
 */
const override = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n);
};

/**
 * Derive the road-legal cargo payload for one container on one lane.
 *
 * `payload = GVW − tractor − chassis − container tare`. Every term is overridable,
 * because only the GVW is law: the vehicle masses are estimates and the tare is a
 * property of the individual box, stamped on its plate and not fixed by ISO.
 *
 * Returns `null` for `capKg` when the lane has no known road limit — the honest
 * answer, and the one that leaves the ISO rating governing.
 *
 * @param {object} args
 * @param {object} args.profile - A country profile.
 * @param {{tareKg?: number}|null} [args.container] - Resolved container.
 * @param {object} [args.overrides] - `{ roadMaxGvwKg, tractorKg, chassisKg, tareKg }`.
 * @returns {{capKg: number|null, gvwKg: number|null, tractorKg: number,
 *            chassisKg: number, tareKg: number, expression: string|null,
 *            estimated: boolean}}
 */
export const roadLegalPayloadKg = ({ profile, container = null, overrides = {} } = {}) => {
  const gvwKg = override(overrides?.roadMaxGvwKg) ?? profile?.roadMaxGvwKg ?? null;

  const tractorKg =
    override(overrides?.tractorKg) ??
    safeNonNegative(profile?.typicalTractorKg ?? DEFAULT_VEHICLE.tractorKg);
  const chassisKg =
    override(overrides?.chassisKg) ??
    safeNonNegative(profile?.typicalChassisKg ?? DEFAULT_VEHICLE.chassisKg);
  const tareKg = override(overrides?.tareKg) ?? safeNonNegative(container?.tareKg);

  if (gvwKg === null || gvwKg <= 0) {
    return {
      capKg: null,
      gvwKg: null,
      tractorKg,
      chassisKg,
      tareKg,
      expression: null,
      // Whether the *inputs* were estimates. Irrelevant when there is no cap, but
      // kept shape-stable so callers never branch on presence.
      estimated: false,
    };
  }

  // Clamped at 0: a GVW lower than the empty vehicle means the combination cannot
  // legally move at all, not that it carries a negative load.
  const capKg = Math.max(0, gvwKg - tractorKg - chassisKg - tareKg);

  return {
    capKg,
    gvwKg,
    tractorKg,
    chassisKg,
    tareKg,
    expression:
      `${gvwKg} kg GVW − ${tractorKg} kg tractor − ${chassisKg} kg chassis − ` +
      `${tareKg} kg container tare`,
    estimated:
      override(overrides?.tractorKg) === null || override(overrides?.chassisKg) === null,
  };
};

/**
 * Decide the payload cap that actually governs a container on a lane, and say why.
 *
 * Resolution order, per the plan: explicit user override → destination country →
 * DEFAULT (the ISO rating). The carrier plays no part in payload — it sets the
 * volumetric divisor, nothing more.
 *
 * The `road` result is the point of this whole phase. It is returned alongside the
 * ISO figure rather than replacing it, so the UI can strike the ISO number through
 * and give the reason instead of silently substituting a smaller one.
 *
 * @param {object} args
 * @param {{maxPayloadKg?: number, label?: string, tareKg?: number}|null} [args.container]
 * @param {string} [args.country] - Country selection key.
 * @param {object} [args.overrides] - `{ payloadKg, roadMaxGvwKg, tractorKg, chassisKg, tareKg }`.
 * @returns {object} `{ capKg, source, isoKg, roadKg, derateKg, road, resolved, reason }`
 */
export const resolvePayloadCap = ({ container = null, country = DEFAULT_COUNTRY, overrides = {} } = {}) => {
  const resolved = resolveCountryProfile(country);
  const isoKg = safeNonNegative(container?.maxPayloadKg);
  const road = roadLegalPayloadKg({ profile: resolved.profile, container, overrides });

  const explicit = override(overrides?.payloadKg);
  if (explicit !== null && explicit > 0) {
    return {
      capKg: explicit,
      source: 'override',
      isoKg,
      roadKg: road.capKg,
      derateKg: isoKg > 0 ? Math.max(0, isoKg - explicit) : 0,
      road,
      resolved,
      reason: `Payload manually overridden to ${explicit} kg.`,
    };
  }

  // A road cap only governs when it is genuinely tighter than the container's own
  // rating. In the EU at 44 t it is not, and saying so is as useful as the US case.
  if (road.capKg !== null && isoKg > 0 && road.capKg < isoKg) {
    return {
      capKg: road.capKg,
      source: 'road',
      isoKg,
      roadKg: road.capKg,
      derateKg: isoKg - road.capKg,
      road,
      resolved,
      reason:
        `${resolved.countryLabel} road law caps this at ${Math.round(road.capKg)} kg ` +
        `(${road.expression}), below the ${Math.round(isoKg)} kg container rating.`,
    };
  }

  if (road.capKg !== null && isoKg > 0) {
    return {
      capKg: isoKg,
      source: 'iso',
      isoKg,
      roadKg: road.capKg,
      derateKg: 0,
      road,
      resolved,
      reason:
        `The ${Math.round(isoKg)} kg container rating governs — ` +
        `${resolved.countryLabel} road law would allow ${Math.round(road.capKg)} kg.`,
    };
  }

  // No road limit known, or no container to rate: today's behaviour, unchanged.
  return {
    capKg: isoKg,
    source: isoKg > 0 ? 'iso' : 'none',
    isoKg,
    roadKg: road.capKg,
    derateKg: 0,
    road,
    resolved,
    reason:
      isoKg > 0
        ? `The ${Math.round(isoKg)} kg container rating governs; no road derating applied.`
        : 'No payload limit to apply.',
  };
};

/**
 * Cubic metres per freight ton for a lane. Drives ocean LCL revenue tons.
 * Falls back to 1 m³ — the international convention and today's behaviour.
 *
 * @param {string} [country]
 * @param {object} [overrides] - `{ measurementTonM3 }`
 * @returns {{value: number, source: 'override'|'country'|'default', label: string}}
 */
export const resolveMeasurementTon = (country = DEFAULT_COUNTRY, overrides = {}) => {
  const explicit = override(overrides?.measurementTonM3);
  if (explicit !== null && explicit > 0) {
    return { value: explicit, source: 'override', label: `${explicit} m³ per ton (manual)` };
  }

  const { profile, countryLabel: label } = resolveCountryProfile(country);
  const fromCountry = profile?.measurementTonM3;
  if (typeof fromCountry === 'number' && fromCountry > 0) {
    return { value: fromCountry, source: 'country', label: `${fromCountry} m³ per ton (${label})` };
  }

  return { value: 1, source: 'default', label: '1 m³ per ton (international)' };
};
