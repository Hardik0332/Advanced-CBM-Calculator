/**
 * Persisted-state schema, validation and migration.
 *
 * Everything read back from localStorage passes through here before it reaches
 * React state. Previously a hand-edited or legacy record with a missing numeric
 * field would reach `.toFixed()` in the PDF exporter and the shipment row and
 * crash the whole app to a white screen; normalising on load makes that
 * impossible by construction.
 *
 * Unknown keys are preserved, so fields added by later phases (hsCode,
 * unitPrice, notes) survive a round-trip through an older build.
 */
import { safeNum, safeNonNegative, clampInt } from './numbers';

/** Bump when a change requires transforming existing persisted data. */
export const SCHEMA_VERSION = 1;

/** Units the app understands; anything else falls back to cm. */
export const VALID_UNITS = ['mm', 'cm', 'inches', 'feet', 'meters'];

/* Defensive caps — absurd values are almost always bad data, and unbounded ones
   produce Infinity totals that poison every downstream calculation. */
const MAX_DIMENSION = 1e7;      // cm; 100 km — far beyond any real cargo
const MAX_WEIGHT = 1e9;         // kg
const MAX_PACK_SIZE = 1e7;
const MAX_QUANTITY = 1e7;

const isPlainObject = (v) =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);

/** Coerce to a clean, printable string without throwing on non-strings. */
const str = (v, fallback = '') => {
  if (v == null) return fallback;
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
};

const dim = (v) => Math.min(safeNonNegative(v, 0), MAX_DIMENSION);
const weight = (v) => Math.min(safeNonNegative(v, 0), MAX_WEIGHT);

const unit = (v) => (VALID_UNITS.includes(v) ? v : 'cm');

/**
 * Every field a user may override on the country/carrier rule profiles, with the
 * cap that keeps an absurd entry from poisoning the freight calculation.
 */
const RULE_OVERRIDE_CAPS = {
  divisorCm3PerKg: 1e7,
  roundingStepKg: 1e4,
  payloadKg: MAX_WEIGHT,
  roadMaxGvwKg: MAX_WEIGHT,
  tractorKg: MAX_WEIGHT,
  chassisKg: MAX_WEIGHT,
  tareKg: MAX_WEIGHT,
  measurementTonM3: 1e4,
};

/**
 * Normalise the rule-override record.
 *
 * The distinction that matters here: **blank is not zero.** An empty field means
 * "fall through to the profile", while a typed 0 is a real instruction — "no
 * chassis", or "no volumetric basis at all". Coercing blanks to 0 the way the
 * numeric helpers above do would turn every untouched field into an override and
 * silently cap payloads at nothing. So blanks are preserved as `''` and only
 * genuinely numeric entries are coerced.
 *
 * @param {object} raw
 * @returns {object}
 */
export const normalizeRuleOverrides = (raw) => {
  const out = {};
  if (!isPlainObject(raw)) return out;

  for (const [field, cap] of Object.entries(RULE_OVERRIDE_CAPS)) {
    const v = raw[field];
    if (v === '' || v === null || v === undefined) continue;
    const n = safeNonNegative(v, NaN);
    if (!Number.isFinite(n)) continue;
    out[field] = Math.min(n, cap);
  }
  return out;
};

let _idCounter = 0;
const genId = (prefix) =>
  `${prefix}-${Date.now()}-${++_idCounter}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * Normalise one product record. Returns null for anything that isn't an object,
 * so junk entries are dropped rather than crashing a `.map`.
 *
 * @param {*} raw
 * @param {number} index - Used for the fallback name.
 * @returns {object|null}
 */
export const normalizeProduct = (raw, index = 0) => {
  if (!isPlainObject(raw)) return null;

  const packSize = clampInt(raw.packSize ?? 1, 1, MAX_PACK_SIZE);

  return {
    // Spread first so unknown/future fields survive, then override the known ones.
    ...raw,
    id: str(raw.id) || genId('product'),
    // A product with no usable name still renders and exports — it does not throw.
    name: str(raw.name) || `Product ${index + 1}`,
    description: str(raw.description, 'Imported product'),
    icon: str(raw.icon, '\u{1F4E6}'),
    color: str(raw.color),
    border: str(raw.border),
    unit: unit(raw.unit),
    length: dim(raw.length),
    width: dim(raw.width),
    height: dim(raw.height),
    packSize,
    packingString: str(raw.packingString),
    netWeightPerUnit: weight(raw.netWeightPerUnit),
    grossWeightPerShipper: weight(raw.grossWeightPerShipper),
    cbmPerShipper: Math.min(safeNonNegative(raw.cbmPerShipper, 0), MAX_DIMENSION),
  };
};

/**
 * Normalise one shipment line. Guarantees `quantity >= 1` and a coherent
 * `totalPcs`, so a NaN quantity can never poison the totals reducer.
 *
 * @param {*} raw
 * @param {number} index
 * @returns {object|null}
 */
export const normalizeShipmentItem = (raw, index = 0) => {
  const base = normalizeProduct(raw, index);
  if (!base) return null;

  const quantity = clampInt(raw.quantity ?? 1, 1, MAX_QUANTITY);
  const packSize = base.packSize;

  // Preserve a genuine partial last box; fall back to the full derived count.
  const rawPcs = clampInt(raw.totalPcs ?? 0, 0, MAX_QUANTITY * MAX_PACK_SIZE);
  const derived = quantity * packSize;
  const totalPcs = rawPcs > 0 ? rawPcs : derived;

  return {
    ...base,
    id: str(raw.id) || genId('item'),
    name: str(raw.name) || 'Custom Item',
    description: str(raw.description),
    quantity,
    totalPcs,
  };
};

/**
 * Normalise shipment metadata (PO number, container, freight mode, custom
 * container capacity, destination/carrier rule selections and their overrides).
 *
 * `normalizeFreightMode` and the container-selection check stay in
 * calculations.js — this only guarantees types, and callers apply their own
 * domain validation.
 *
 * @param {*} raw
 * @returns {object}
 */
export const normalizeMeta = (raw) => {
  if (!isPlainObject(raw)) return {};
  return {
    ...raw,
    poNumber: str(raw.poNumber),
    containerType: str(raw.containerType),
    freightMode: str(raw.freightMode),
    /* A user-entered container capacity. Coerced here rather than at the point of
       use so a hand-edited `{"cbm": "lots"}` cannot reach the container planner
       and produce NaN containers. */
    customContainer: isPlainObject(raw.customContainer)
      ? {
          label: str(raw.customContainer.label),
          cbm: Math.min(safeNonNegative(raw.customContainer.cbm), MAX_DIMENSION),
          maxPayloadKg: weight(raw.customContainer.maxPayloadKg),
        }
      : null,
    /* Rule-profile selections. Kept as plain strings; `countryProfiles.js` and
       `carrierProfiles.js` own the "is this a key I know?" question and fall back
       to their DEFAULT profiles, which reproduce pre-Phase-2b behaviour. */
    destinationCountry: str(raw.destinationCountry),
    carrierProfile: str(raw.carrierProfile),
    /* Explicit rule overrides — the highest-priority input to every resolution.
       `''` is preserved as "not overridden", so this must NOT coerce blanks to 0:
       a 0 GVW would silently mean "this load cannot legally move". */
    ruleOverrides: isPlainObject(raw.ruleOverrides)
      ? normalizeRuleOverrides(raw.ruleOverrides)
      : null,
  };
};

/**
 * Unwrap a persisted payload, accepting both the versioned envelope written by
 * this build and the bare values written by every previous one.
 *
 * @param {*} payload - Result of JSON.parse.
 * @returns {{ version: number, data: * }}
 */
export const unwrap = (payload) => {
  if (isPlainObject(payload) && 'v' in payload && 'data' in payload) {
    return { version: safeNum(payload.v, 0), data: payload.data };
  }
  // v0 — the pre-versioning format: a bare array or object.
  return { version: 0, data: payload };
};

/** Wrap a value for persistence with the current schema version. */
export const wrap = (data) => ({ v: SCHEMA_VERSION, data });

/**
 * Migrate + normalise a persisted array.
 *
 * Tolerates every corruption mode seen in practice: a non-array payload (the old
 * code would throw on `.map`/`.filter`), null entries, primitives mixed into the
 * array, and records missing required numeric fields.
 *
 * @param {*} payload - Result of JSON.parse.
 * @param {(raw: *, i: number) => object|null} normalizer
 * @returns {{ items: object[], dropped: number, version: number }}
 */
export const migrateList = (payload, normalizer) => {
  const { version, data } = unwrap(payload);

  if (!Array.isArray(data)) {
    // A non-array here means the key was corrupted or hand-edited. Losing it is
    // preferable to crashing, and the caller surfaces the drop count.
    return { items: [], dropped: data == null ? 0 : 1, version };
  }

  const items = [];
  let dropped = 0;
  data.forEach((raw, i) => {
    const norm = normalizer(raw, i);
    if (norm) items.push(norm);
    else dropped++;
  });

  return { items, dropped, version };
};

/** Convenience wrappers used by the persistence hooks. */
export const migrateProducts = (payload) => migrateList(payload, normalizeProduct);
export const migrateShipment = (payload) => migrateList(payload, normalizeShipmentItem);
