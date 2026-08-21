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
/** Absurd invoice values are data errors; unbounded ones produce Infinity totals. */
const MAX_MONEY = 1e12;

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

/**
 * An HS / HTS tariff code.
 *
 * Kept as a string, never a number, and deliberately not run through
 * `parseFlexibleNumber`. Two reasons, both of which produce a wrong customs
 * declaration if ignored:
 *
 *  • Leading zeros are significant. HS 0901.21 is roasted coffee; parse it as a
 *    number and it becomes 901.21, which is not a code at all.
 *  • The dots are separators, not decimal points. `8471.30.01` has two, so any
 *    numeric parse either fails or silently keeps the first segment.
 *
 * Spreadsheets routinely hand these over as numbers already stripped of their
 * leading zero. Nothing here can recover a digit the file never contained — the
 * import warn tier is where a suspiciously short code gets flagged — but this at
 * least stops the app doing the stripping itself.
 *
 * @param {*} v
 * @returns {string}
 */
const hsCode = (v) => {
  if (v == null) return '';
  // A number that arrived here has already lost any leading zero upstream; keep
  // its digits verbatim rather than reformatting them.
  const s = typeof v === 'number' ? String(v) : str(v);
  // Codes are digits, dots, spaces and hyphens. Anything else is not a code.
  return s.replace(/[^\d.\-\s]/g, '').trim().slice(0, 24);
};

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

    /* Trade fields. Importable since Phase 1 and printed by the Phase 3 documents,
       so they are coerced here rather than trusted: an HS code that arrives as a
       number from a spreadsheet must not lose a leading zero, and a unit price of
       `"12,50 €"` must not reach the invoice as a string that sums to NaN. */
    sku: str(raw.sku),
    hsCode: hsCode(raw.hsCode),
    marks: str(raw.marks),
    origin: str(raw.origin),
    currency: str(raw.currency),
    unitPrice: money(raw.unitPrice),
    notes: str(raw.notes),
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
 * Shipment trade metadata — the fields the documents need that are not part of the
 * cargo itself. All optional strings: a shipment with none of them still exports,
 * it just produces a leaner document.
 */
const TRADE_STRING_FIELDS = [
  'invoiceNo',
  'invoiceDate',
  'incoterm',
  'portOfLoading',
  'portOfDischarge',
  'vesselFlight',
  'marksNumbers',
  'currency',
  'paymentTerms',
  'countryOfOrigin',
  'invoiceDeclaration',
  'notes',
  'shipperId',
  'consigneeId',
  'notifyId',
];

/**
 * Normalise shipment metadata (PO number, container, freight mode, custom
 * container capacity, destination/carrier rule selections and their overrides,
 * and the trade fields the export documents read).
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

  const trade = {};
  for (const field of TRADE_STRING_FIELDS) trade[field] = str(raw[field]);

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

    ...trade,
    /* Invoice charges. Blank stays blank rather than becoming 0, so an invoice
       does not print a "Freight: 0.00" line the user never asked for. */
    freightCharge: money(raw.freightCharge),
    insuranceCharge: money(raw.insuranceCharge),
  };
};

/**
 * A monetary amount that may legitimately be absent.
 *
 * Distinct from `weight`: a blank charge must stay blank so the invoice omits the
 * line, whereas a blank weight is genuinely 0 kg.
 *
 * @param {*} v
 * @returns {number|''}
 */
function money(v) {
  if (v === '' || v === null || v === undefined) return '';
  const n = safeNum(v, NaN);
  if (!Number.isFinite(n)) return '';
  return Math.min(Math.abs(n), MAX_MONEY);
}

/** Paper sizes the PDF layer understands. */
export const VALID_PAPER_SIZES = ['a4', 'letter'];

/**
 * Normalise one parties-book entry. Returns null for junk so a corrupt array
 * degrades entry-by-entry rather than losing the whole book.
 *
 * @param {*} raw
 * @param {number} index
 * @returns {object|null}
 */
export const normalizeParty = (raw, index = 0) => {
  if (!isPlainObject(raw)) return null;
  const name = str(raw.name);
  const address = str(raw.address);
  // An entry with neither a name nor an address cannot appear on a document.
  if (!name && !address) return null;

  return {
    ...raw,
    id: str(raw.id) || genId('party'),
    label: str(raw.label) || name || `Party ${index + 1}`,
    name,
    address,
    contact: str(raw.contact),
    taxId: str(raw.taxId),
    country: str(raw.country),
  };
};

/**
 * Normalise the company profile.
 *
 * The logo gets particular care: it is a data URL that has been through
 * localStorage, a JSON backup, and possibly a hand edit. A non-data-URL string
 * there would reach `doc.addImage` and throw mid-export, so anything that is not
 * recognisably an image data URL is dropped rather than passed on.
 *
 * @param {*} raw
 * @returns {object}
 */
export const normalizeCompany = (raw) => {
  const src = isPlainObject(raw) ? raw : {};
  const logo = str(src.logo);

  return {
    ...src,
    name: str(src.name),
    address: str(src.address),
    phone: str(src.phone),
    email: str(src.email),
    website: str(src.website),
    gst: str(src.gst),
    iec: str(src.iec),
    cin: str(src.cin),
    logo: /^data:image\/[a-z+]+;base64,/i.test(logo) ? logo : '',
    defaultIncoterm: str(src.defaultIncoterm),
    defaultCurrency: str(src.defaultCurrency) || 'USD',
    paperSize: VALID_PAPER_SIZES.includes(src.paperSize) ? src.paperSize : 'a4',
    parties: Array.isArray(src.parties)
      ? src.parties.map(normalizeParty).filter(Boolean)
      : [],
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
