/**
 * Unit conversion & CBM calculation helpers.
 */
import { safeNum, safeNonNegative } from './numbers';

/**
 * Convert a dimension value to centimeters.
 *
 * Input is coerced through `safeNum`, so a spreadsheet string like "1.234,56"
 * or " 50 cm " converts correctly instead of poisoning the result with NaN.
 *
 * @param {number|string} v - The value to convert.
 * @param {string} u - The unit ('cm', 'mm', 'inches', 'feet', 'meters').
 * @returns {number} The value in centimeters.
 */
export const toCm = (v, u) => {
  const n = safeNum(v, 0);
  if (u === 'mm') return n / 10;
  if (u === 'inches') return n * 2.54;
  if (u === 'feet') return n * 30.48;
  if (u === 'meters') return n * 100;
  // 'cm' and any unrecognised unit pass through unchanged.
  return n;
};

/**
 * Convert a value in centimeters back to the given unit.
 * @param {number} v - The value in centimeters.
 * @param {string} u - The target unit.
 * @returns {number} The value in the target unit.
 */
export const fromCm = (v, u) => {
  const n = safeNum(v, 0);
  if (u === 'mm') return n * 10;
  if (u === 'inches') return n / 2.54;
  if (u === 'feet') return n / 30.48;
  if (u === 'meters') return n / 100;
  return n;
};

/**
 * Convert a dimension value from one unit to another, rounded to 4 decimals.
 * @param {number} v - The value to convert.
 * @param {string} from - Source unit.
 * @param {string} to - Target unit.
 * @returns {number}
 */
export const convertDim = (v, from, to) => {
  const n = Number(v);
  if (!n || from === to) return n || 0;
  return Math.round(fromCm(toCm(n, from), to) * 10000) / 10000;
};

/**
 * Calculate CBM (Cubic Meters) from dimensions.
 *
 * Dimensions are forced non-negative: a negative volume is never a real answer,
 * and letting one through produced negative CBM totals and negative container
 * fill percentages.
 *
 * @param {number|string} l - Length.
 * @param {number|string} w - Width.
 * @param {number|string} h - Height.
 * @param {string} u - The unit of the dimensions.
 * @returns {number} Volume in cubic meters.
 */
export const calcCBM = (l, w, h, u) => {
  const cm =
    toCm(safeNonNegative(l), u) * toCm(safeNonNegative(w), u) * toCm(safeNonNegative(h), u);
  return Number.isFinite(cm) ? cm / 1_000_000 : 0;
};

/**
 * Adaptive CBM formatter — prevents 0.00 for small pharmaceutical/medical items.
 * Uses more decimal places only when the value is too small for 2dp to be meaningful.
 *
 * Hardened against non-finite and negative input: NaN/Infinity and negative
 * volumes are meaningless here and previously rendered as "Infinity" or
 * "-1.000000" in exports.
 *
 * @param {number} v - CBM value.
 * @returns {string}
 */
export const fmtCBM = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '0.0000';
  if (n < 0.0001) return n.toFixed(6);
  if (n < 0.01) return n.toFixed(4);
  return n.toFixed(2);
};

/**
 * Higher-precision CBM formatter for per-item detail rows, where 2dp would hide
 * meaningful differences between small items. Same non-finite guards as `fmtCBM`.
 *
 * @param {number} v - CBM value.
 * @returns {string}
 */
export const fmtCBMPrecise = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '0.000';
  return n < 0.001 ? n.toFixed(5) : n.toFixed(3);
};

/**
 * Standard shipping container definitions.
 *
 * cbm          — usable (practical) loading volume: the geometric volume with a
 *                ~85–90% stowage factor applied. This is what a load planner can
 *                actually fill, and it is deliberately NOT `geometricCbm`.
 * maxPayloadKg — ISO maximum cargo payload; loads above this are overweight even
 *                when the container is volumetrically far from full.
 * geometricCbm — internal volume per ISO 668 / 1496-1, for reference.
 * tareKg       — approximate empty mass. ISO does **not** fix tare: it varies with
 *                the individual box's construction, so treat this as an estimate
 *                and read the real figure off the container's plate.
 * maxGrossKg   — common maximum gross mass. ISO 668:2013 Amd 1 raised the ceiling
 *                to 36,000 kg, but most of the global fleet has not caught up, so
 *                30,480 kg stays the safe planning default.
 * internalCm / doorCm — nominal internal and door-opening dimensions. Published
 *                figures vary by builder; used for fit checks and documents only.
 *
 * Sources for geometric volume, tare and payload: docs/COUNTRY_FREIGHT_RULES.md §3.
 */
export const CONTAINERS = {
  '20ft': {
    label: "20' Standard (Usable)",
    short: "20'",
    cbm: 28,
    maxPayloadKg: 28200,
    geometricCbm: 33.1,
    tareKg: 2200,
    maxGrossKg: 30480,
    teu: 1,
    internalCm: { l: 589.8, w: 235.2, h: 239.3 },
    doorCm: { w: 234.3, h: 228.0 },
  },
  '40ft': {
    label: "40' Standard (Usable)",
    short: "40'",
    cbm: 58,
    maxPayloadKg: 26700,
    geometricCbm: 67.5,
    tareKg: 3800,
    maxGrossKg: 30480,
    teu: 2,
    internalCm: { l: 1203.2, w: 235.2, h: 239.3 },
    doorCm: { w: 234.3, h: 228.0 },
  },
  '40hc': {
    label: "40' High Cube (Usable)",
    short: "40'HC",
    cbm: 68,
    maxPayloadKg: 26500,
    geometricCbm: 75.3,
    tareKg: 3935,
    maxGrossKg: 30480,
    teu: 2,
    internalCm: { l: 1203.2, w: 235.2, h: 269.8 },
    doorCm: { w: 234.3, h: 258.5 },
  },
  '45hc': {
    label: "45' High Cube (Usable)",
    short: "45'HC",
    cbm: 76,
    maxPayloadKg: 28500,
    geometricCbm: 86.1,
    tareKg: 4500,
    maxGrossKg: 33000,
    teu: 2.25,
    internalCm: { l: 1355.6, w: 235.2, h: 269.8 },
    doorCm: { w: 234.3, h: 258.5 },
  },
};

/** Container selection meaning "loose cargo / LCL" — no container to plan against. */
export const NO_CONTAINER = 'none';

/** Container selection meaning "the user typed their own capacity". */
export const CUSTOM_CONTAINER = 'custom';

/** Empty custom-container record, so the UI always has a shape to spread. */
export const EMPTY_CUSTOM_CONTAINER = { label: '', cbm: 0, maxPayloadKg: 0 };

/** Every value the container selector may hold, in display order. */
export const CONTAINER_OPTIONS = [
  ...Object.keys(CONTAINERS),
  CUSTOM_CONTAINER,
  NO_CONTAINER,
];

/** Is this a container selection the app understands? */
export const isValidContainerType = (t) =>
  Boolean(CONTAINERS[t]) || t === NO_CONTAINER || t === CUSTOM_CONTAINER;

/**
 * Resolve a container selection to a concrete capacity, or `null` when there is
 * nothing to plan against (LCL / loose cargo, or a custom entry with no numbers
 * in it yet). Callers must handle `null` — it is a normal state now, not an error.
 *
 * @param {string} containerType - A key of CONTAINERS, 'custom', or 'none'.
 * @param {{label?: string, cbm?: number|string, maxPayloadKg?: number|string}} [custom]
 * @returns {{key: string, label: string, cbm: number, maxPayloadKg: number}|null}
 */
export const resolveContainer = (containerType, custom = null) => {
  if (containerType === NO_CONTAINER) return null;

  if (containerType === CUSTOM_CONTAINER) {
    const cbm = safeNonNegative(custom?.cbm);
    const maxPayloadKg = safeNonNegative(custom?.maxPayloadKg);
    // Neither capacity entered yet — behave exactly like "no container" rather
    // than reporting a 0 m³ container that is infinitely overfull.
    if (cbm <= 0 && maxPayloadKg <= 0) return null;
    const label = typeof custom?.label === 'string' ? custom.label.trim() : '';
    return {
      key: CUSTOM_CONTAINER,
      label: label || 'Custom container',
      short: label || 'Custom',
      cbm,
      maxPayloadKg,
      isCustom: true,
    };
  }

  const cont = CONTAINERS[containerType];
  return cont ? { key: containerType, ...cont } : null;
};

/**
 * Freight mode definitions.
 *
 * `volumetricFactor` (kg per CBM) is kept for persisted-meta and test
 * back-compatibility, but it is **no longer the calculation path**. Real carrier
 * tariffs are stated as a volumetric *divisor* in cm³/kg and applied per piece,
 * with a mode-specific round-up — see `VOLUMETRIC_RULES` and `computeFreight` in
 * `freight.js`, which every display and export now routes through.
 *
 * The two disagree slightly on purpose: 167 kg/m³ is the rounded trade shorthand,
 * ÷6000 cm³/kg (= 166.667 kg/m³) is what an airline actually bills.
 */
export const FREIGHT_MODES = {
  ocean_fcl: {
    label: 'Ocean FCL',
    short: '🚢 FCL',
    volumetricFactor: 0,
    desc: 'Ocean FCL: Chargeable = Gross Weight only',
  },
  ocean_lcl: {
    label: 'Ocean LCL',
    short: '🚢 LCL',
    volumetricFactor: 1000,
    desc: 'Ocean LCL (W/M): revenue tons = max(CBM, tonnes), rounded up',
  },
  air: {
    label: 'Air',
    short: '✈️ Air',
    volumetricFactor: 167,
    desc: 'Air (IATA): per-piece cm³ ÷ 6000 · chargeable rounded up to next 0.5 kg',
  },
  courier: {
    label: 'Courier',
    short: '📦 Courier',
    volumetricFactor: 200,
    desc: 'Courier: per-piece cm³ ÷ 5000 · chargeable rounded up to next 1.0 kg',
  },
};

/** Map legacy persisted freight mode values to current keys. */
export const normalizeFreightMode = (m) => {
  if (m === 'ocean') return 'ocean_fcl';
  return FREIGHT_MODES[m] ? m : 'ocean_fcl';
};

/**
 * Plan how many containers a load needs against an already-resolved container,
 * considering volume, the container's own payload rating, and — when the lane has
 * one — the **road-legal** payload.
 *
 * The third constraint is the point of the country profiles: an ISO rating assumes
 * the loaded box can actually be moved, and on a US highway a 40′ HC at its
 * 26,500 kg rating is roughly 5 t over the federal 80,000 lb gross limit. Planning
 * to the ISO figure there produces a load that cannot legally leave the port.
 *
 * Pass the cap as a number rather than a country profile: this module stays pure
 * geometry and arithmetic, and `freight.js` owns the resolution.
 *
 * A `null` container (LCL / loose cargo) yields `applicable: false` and a count of
 * 0 — there is genuinely nothing to plan, and reporting "1 container" for a
 * groupage shipment was misleading.
 *
 * A capacity of 0 on either axis means "that constraint does not apply", which is
 * what a custom container with only a volume or only a payload entered means. It
 * must not divide by zero into Infinity containers.
 *
 * @param {{cbm: number, grossWeight: number}} totals
 * @param {{cbm: number, maxPayloadKg: number, label?: string}|null} container
 * @param {{roadPayloadCapKg?: number|null, payloadCapOverrideKg?: number|null}} [opts]
 *   `roadPayloadCapKg` — road-legal cargo payload per container for this lane;
 *   `null`/omitted ⇒ no road derating, i.e. the behaviour before the country
 *   profiles existed. `payloadCapOverrideKg` — a capacity the user typed in, which
 *   outranks both the ISO rating and the road limit.
 * @returns {object} Plan with counts, the binding constraint, fill and margins.
 */
export const planContainers = (totals, container, opts = {}) => {
  const cbm = safeNonNegative(totals?.cbm);
  const grossWeight = safeNonNegative(totals?.grossWeight);

  if (!container) {
    return {
      applicable: false,
      container: null,
      count: 0,
      byVolume: 0,
      byWeight: 0,
      byRoad: 0,
      limitedBy: null,
      capacityCbm: 0,
      capacityPayloadKg: 0,
      isoPayloadKg: 0,
      roadPayloadCapKg: null,
      payloadCapKg: 0,
      payloadCapSource: 'none',
      payloadDerateKg: 0,
      volumeFillPct: 0,
      payloadFillPct: 0,
      perContainerCbm: 0,
      perContainerKg: 0,
      remainingCbm: 0,
      remainingPayloadKg: 0,
      overCbm: 0,
      overPayloadKg: 0,
    };
  }

  const capCbm = safeNonNegative(container.cbm);
  const isoPayloadKg = safeNonNegative(container.maxPayloadKg);

  const optional = (v) => (v === null || v === undefined ? null : safeNonNegative(v));
  const roadPayloadCapKg = optional(opts?.roadPayloadCapKg);
  const overrideCapKg = optional(opts?.payloadCapOverrideKg);

  /* The cargo cap that actually governs one container, in priority order:
     what the user typed → the road limit when it is tighter than the rating → the
     rating itself. Reported separately from the ISO figure so callers can strike
     the ISO number through and give the reason rather than quietly substituting a
     smaller one. */
  let payloadCapKg = isoPayloadKg;
  let payloadCapSource = isoPayloadKg > 0 ? 'iso' : 'none';
  if (overrideCapKg !== null && overrideCapKg > 0) {
    payloadCapKg = overrideCapKg;
    payloadCapSource = 'override';
  } else if (
    roadPayloadCapKg !== null &&
    roadPayloadCapKg > 0 &&
    (isoPayloadKg <= 0 || roadPayloadCapKg < isoPayloadKg)
  ) {
    payloadCapKg = roadPayloadCapKg;
    payloadCapSource = 'road';
  }

  // safeNonNegative above guards against a NaN total reaching Math.ceil, which
  // would otherwise yield NaN and render as "NaN containers".
  const byVolume = capCbm > 0 ? Math.max(1, Math.ceil(cbm / capCbm)) : 0;
  const byWeight = isoPayloadKg > 0 ? Math.max(1, Math.ceil(grossWeight / isoPayloadKg)) : 0;
  const byRoad =
    roadPayloadCapKg !== null && roadPayloadCapKg > 0
      ? Math.max(1, Math.ceil(grossWeight / roadPayloadCapKg))
      : 0;
  // One payload axis drives the count, using whichever cap governs.
  const byPayload = payloadCapKg > 0 ? Math.max(1, Math.ceil(grossWeight / payloadCapKg)) : 0;
  const count = Math.max(1, byVolume, byPayload);

  const capacityCbm = capCbm * count;
  const capacityPayloadKg = payloadCapKg * count;

  return {
    applicable: true,
    container,
    count,
    byVolume,
    byWeight,
    byRoad,
    /* 'road' only when a road limit both applies and binds — so with no country
       selected this reads exactly as it did before, 'volume' or 'weight'. */
    limitedBy: byPayload > byVolume ? (payloadCapSource === 'road' ? 'road' : 'weight') : 'volume',
    capacityCbm,
    capacityPayloadKg,
    isoPayloadKg,
    roadPayloadCapKg,
    payloadCapKg,
    payloadCapSource,
    // How much cargo the governing cap costs against the container's own rating.
    payloadDerateKg:
      isoPayloadKg > 0 && payloadCapKg < isoPayloadKg ? isoPayloadKg - payloadCapKg : 0,
    // Fill of the whole plan, not of a single box — deliberately uncapped so an
    // overfilled load is impossible to miss.
    volumeFillPct: capacityCbm > 0 ? (cbm / capacityCbm) * 100 : 0,
    payloadFillPct: capacityPayloadKg > 0 ? (grossWeight / capacityPayloadKg) * 100 : 0,
    // Even split across the plan: what each container carries if loaded equally.
    perContainerCbm: cbm / count,
    perContainerKg: grossWeight / count,
    remainingCbm: Math.max(0, capacityCbm - cbm),
    remainingPayloadKg: Math.max(0, capacityPayloadKg - grossWeight),
    overCbm: Math.max(0, cbm - capacityCbm),
    overPayloadKg: Math.max(0, grossWeight - capacityPayloadKg),
  };
};

/**
 * How many containers of the given type the load needs.
 * Thin wrapper over `planContainers` that resolves the selection first.
 *
 * @param {{cbm: number, grossWeight: number}} totals
 * @param {string} containerType - Key into CONTAINERS, 'custom', or 'none'.
 * @param {{customContainer?: object, roadPayloadCapKg?: number|null,
 *          payloadCapOverrideKg?: number|null}} [opts]
 * @returns {object} See `planContainers`.
 */
export const containersNeeded = (totals, containerType, opts = {}) =>
  planContainers(totals, resolveContainer(containerType, opts?.customContainer), {
    roadPayloadCapKg: opts?.roadPayloadCapKg ?? null,
    payloadCapOverrideKg: opts?.payloadCapOverrideKg ?? null,
  });
