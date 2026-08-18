/**
 * Flexible numeric parsing for arbitrary user/spreadsheet data.
 *
 * The guiding rule: `parseFlexibleNumber` returns **null** when a value cannot be
 * understood — never 0. Silently coercing junk to 0 is how bad data reaches a
 * shipping document unnoticed. Callers that genuinely want a default use
 * `safeNum(v, fallback)` and do so deliberately.
 *
 * Handles, in one pass: full-width digits, unicode minus/dashes, NBSP & thin-space
 * grouping, apostrophe grouping (Swiss `1'234.56`), currency symbols and unit
 * suffixes (`12.5 kg`), accounting negatives (`(5)`), fractions (`1/2`, `1 1/2`),
 * scientific notation (`1.2e3`), percentages, ranges (`5-10` -> 5), and — the
 * genuinely hard part — deciding whether `,` or `.` is the decimal separator.
 *
 * Exotic characters are written as escape sequences, never as literals, so this
 * file survives any editor or encoding.
 */

/**
 * Digit-grouping spaces. Deliberately narrow: only a space run followed by
 * exactly three digits counts as grouping, so `1 234` collapses to 1234 while
 * `50 40` (two numbers sharing one cell) is left alone rather than fused to 5040.
 * `\s` already covers NBSP, thin space and narrow NBSP per the spec.
 */
const GROUP_SPACE_RUN = /(\d)\s+(\d{3})(?!\d)/g;

/** Unicode minus (U+2212), figure/en/em dashes and horizontal bar -> ASCII hyphen. */
const DASHES = /[−‒–—―]/g;

/** Apostrophe grouping: Swiss/Liechtenstein `1'234'567.89`. */
const APOSTROPHES = /['’ʼ]/g;

/**
 * A numeric run: optional sign, digits with optional `,`/`.` separators, optional
 * exponent. Deliberately does NOT match spaces — grouping spaces are collapsed
 * before extraction, so `50 x 40` can never fuse into a single number.
 */
const NUMERIC_RUN = /[+-]?(?:\d+(?:[.,]\d+)*|[.,]\d+)(?:[eE][+-]?\d+)?/;

const MIXED_FRACTION = /^([+-]?\d+)\s+(\d+)\s*\/\s*(\d+)$/;
const SIMPLE_FRACTION = /^([+-]?\d+)\s*\/\s*(\d+)$/;

/** Collapse grouping spaces, repeating so `1 234 567` fully reduces. */
const stripGroupSpaces = (s) => {
  let out = s;
  let prev;
  do {
    prev = out;
    out = out.replace(GROUP_SPACE_RUN, '$1$2');
  } while (out !== prev);
  return out;
};

/**
 * Decide which of `,` / `.` is the decimal separator in a numeric token and
 * return a JS-parseable string.
 *
 * @param {string} token - e.g. "1.234,56", "1,234", "1,5"
 * @param {'dot-decimal'|'comma-decimal'|null} hint - column-level locale, when known.
 * @returns {string}
 */
const resolveSeparators = (token, hint = null) => {
  // Keep the exponent out of separator analysis — `1,5e3` must not confuse it.
  const expMatch = token.match(/[eE][+-]?\d+$/);
  const exponent = expMatch ? expMatch[0] : '';
  let body = exponent ? token.slice(0, -exponent.length) : token;

  const commas = (body.match(/,/g) || []).length;
  const dots = (body.match(/\./g) || []).length;

  const asDecimal = (sep) => {
    const other = sep === ',' ? '.' : ',';
    return body.split(other).join('').replace(sep, '.');
  };
  const asGrouping = (sep) => body.split(sep).join('');

  if (commas > 0 && dots > 0) {
    // Both present: whichever appears last is the decimal separator.
    body = body.lastIndexOf(',') > body.lastIndexOf('.') ? asDecimal(',') : asDecimal('.');
  } else if (commas > 0) {
    if (hint === 'comma-decimal') body = asDecimal(',');
    else if (hint === 'dot-decimal') body = asGrouping(',');
    else if (commas > 1) body = asGrouping(',');
    else {
      const after = body.length - body.indexOf(',') - 1;
      // `1,234` is ambiguous — English grouping is the more common convention in
      // trade data, so default to grouping. `1,5` / `1,2345` must be decimal.
      body = after === 3 ? asGrouping(',') : asDecimal(',');
    }
  } else if (dots > 0) {
    // A lone dot stays decimal: that matches both JS-native parsing and metric
    // dimension data. Only an explicit comma-decimal column or repeated dots
    // (`1.234.567`) make it grouping.
    if (hint === 'comma-decimal') body = asGrouping('.');
    else if (dots > 1) body = asGrouping('.');
    else body = asDecimal('.');
  }

  return body + exponent;
};

/**
 * Parse any cell value into a number, or null when it cannot be understood.
 *
 * @param {*} v - The raw cell value.
 * @param {{ locale?: 'dot-decimal'|'comma-decimal'|null }} [opts]
 * @returns {number|null}
 */
export const parseFlexibleNumber = (v, opts = {}) => {
  const { locale = null } = opts;

  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  // Booleans and Dates are never meaningful dimensions or weights.
  if (typeof v === 'boolean') return null;
  if (v instanceof Date) return null;
  if (v == null) return null;

  let s = String(v);
  // NFKC folds full-width digits and other compatibility forms to ASCII.
  try {
    s = s.normalize('NFKC');
  } catch {
    /* normalize unavailable in very old engines — continue with the raw string */
  }
  s = s.trim();
  if (!s) return null;

  s = s.replace(DASHES, '-').replace(APOSTROPHES, '');

  // Accounting negative: (1,234.56)
  let negative = false;
  if (s.length > 2 && s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }

  s = stripGroupSpaces(s);

  // Fractions, checked before token extraction so "1 1/2" isn't read as 1.
  const mixed = s.match(MIXED_FRACTION);
  if (mixed) {
    const whole = Number(mixed[1]);
    const den = Number(mixed[3]);
    if (den === 0) return null;
    const frac = Number(mixed[2]) / den;
    const n = whole < 0 ? whole - frac : whole + frac;
    return negative ? -n : n;
  }
  const simple = s.match(SIMPLE_FRACTION);
  if (simple) {
    const den = Number(simple[2]);
    if (den === 0) return null;
    const n = Number(simple[1]) / den;
    return negative ? -n : n;
  }

  const match = s.match(NUMERIC_RUN);
  if (!match) return null;

  const n = Number(resolveSeparators(match[0], locale));
  if (!Number.isFinite(n)) return null;

  return negative ? -n : n;
};

/**
 * Infer a column's decimal convention from sample values, so the genuinely
 * ambiguous `1,234` case is decided once per column rather than per cell.
 *
 * @param {Array<*>} samples - Raw cell values from one column.
 * @returns {'dot-decimal'|'comma-decimal'|null} null when there is no evidence.
 */
export const detectColumnLocale = (samples) => {
  let dotVotes = 0;
  let commaVotes = 0;

  for (const raw of samples || []) {
    if (typeof raw === 'number' || raw == null) continue;
    let s = String(raw).trim();
    if (!s) continue;
    s = stripGroupSpaces(s.replace(APOSTROPHES, ''));

    const commas = (s.match(/,/g) || []).length;
    const dots = (s.match(/\./g) || []).length;
    if (!commas && !dots) continue;

    if (commas > 0 && dots > 0) {
      // The separator appearing last is the decimal one — strong evidence.
      if (s.lastIndexOf('.') > s.lastIndexOf(',')) dotVotes += 2;
      else commaVotes += 2;
      continue;
    }
    if (commas > 1) { dotVotes += 1; continue; }   // commas used for grouping
    if (dots > 1) { commaVotes += 1; continue; }   // dots used for grouping
    if (commas === 1) {
      const after = s.length - s.indexOf(',') - 1;
      if (after !== 3) commaVotes += 2;            // `1,5` — comma must be decimal
      continue;
    }
    if (dots === 1) {
      const after = s.length - s.indexOf('.') - 1;
      if (after !== 3) dotVotes += 2;              // `1.5` — dot must be decimal
    }
  }

  if (dotVotes === commaVotes) return null;
  return dotVotes > commaVotes ? 'dot-decimal' : 'comma-decimal';
};

/**
 * Parse with a deliberate fallback. Use this where a number must be produced;
 * use `parseFlexibleNumber` where "unparseable" needs to stay visible.
 *
 * @param {*} v
 * @param {number} [fallback=0]
 * @returns {number}
 */
export const safeNum = (v, fallback = 0) => {
  const n = parseFlexibleNumber(v);
  return n === null ? fallback : n;
};

/** Non-negative variant — dimensions and weights are never negative. */
export const safeNonNegative = (v, fallback = 0) => {
  const n = safeNum(v, fallback);
  return n < 0 ? Math.abs(n) : n;
};

/**
 * Coerce to an integer inside [min, max]. NaN-safe: unparseable input yields
 * `min`, which is what stops a bad quantity poisoning every downstream total.
 */
export const clampInt = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = parseFlexibleNumber(v);
  if (n === null) return min;
  const i = Math.round(n);
  if (i < min) return min;
  if (i > max) return max;
  return i;
};

/**
 * Round up to the next multiple of `step` — carrier chargeable-weight rounding
 * (IATA 0.5 kg, courier 1.0 kg). Guards against float error so a value already
 * sitting exactly on a step is not pushed to the next one.
 */
export const roundUpTo = (v, step) => {
  const n = Number(v);
  if (!Number.isFinite(n) || !step || step <= 0) return Number.isFinite(n) ? n : 0;
  const r = Math.ceil(n / step - 1e-9) * step;
  // `|| 0` normalises the -0 that Math.ceil produces for input 0, which would
  // otherwise render as "-0.00" in an export.
  return Math.round(r * 1e9) / 1e9 || 0;
};

/** Kill float noise without losing meaningful precision. */
export const trimFloat = (v, decimals = 9) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** decimals;
  return Math.round(n * f) / f || 0;
};
