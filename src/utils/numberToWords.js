/**
 * Amount in words, for the commercial invoice.
 *
 * A legal requirement on invoices in many jurisdictions and a fraud control
 * everywhere: figures can be altered after signing, words are far harder to.
 *
 * Two numbering systems, because the app's users need both:
 *
 *   • **international** — thousand / million / billion. `1234567` →
 *     "one million two hundred thirty-four thousand five hundred sixty-seven".
 *   • **indian** — thousand / lakh / crore, grouped 2-2-3. `1234567` →
 *     "twelve lakh thirty-four thousand five hundred sixty-seven". This is not a
 *     cosmetic variant: an Indian invoice reading "1.2 million" instead of
 *     "12 lakh" looks wrong to every party who has to sign it.
 *
 * Deliberately no `Intl.NumberFormat` spell-out: engine support is inconsistent,
 * the Indian system is not covered at all, and an invoice must not read differently
 * depending on the browser that generated it.
 */
import { safeNum } from './numbers';

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];

const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
];

/**
 * Spell a number below 1000.
 * @param {number} n - 0..999
 * @returns {string}
 */
const under1000 = (n) => {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)];
    const o = n % 10;
    return o ? `${t}-${ONES[o]}` : t;
  }
  const h = `${ONES[Math.floor(n / 100)]} hundred`;
  const rest = n % 100;
  return rest ? `${h} ${under1000(rest)}` : h;
};

/** International scale groups, largest first. */
const INTERNATIONAL_SCALES = [
  [1e12, 'trillion'],
  [1e9, 'billion'],
  [1e6, 'million'],
  [1e3, 'thousand'],
];

/**
 * Spell a non-negative integer in the international system.
 * @param {number} n
 * @returns {string}
 */
const internationalWords = (n) => {
  if (n < 1000) return under1000(n);

  const parts = [];
  let rest = n;
  for (const [value, name] of INTERNATIONAL_SCALES) {
    if (rest >= value) {
      const count = Math.floor(rest / value);
      // Recurse: a "thousand" group can itself run to 999.
      parts.push(`${internationalWords(count)} ${name}`);
      rest %= value;
    }
  }
  if (rest > 0) parts.push(under1000(rest));
  return parts.join(' ');
};

/**
 * Spell a non-negative integer in the Indian system.
 *
 * Grouping is 2-2-3 above the hundreds, so the units are crore (1e7), lakh (1e5),
 * thousand (1e3), then the final three digits. Crores above 99 are themselves
 * grouped in the same way — 1e9 reads "one hundred crore".
 *
 * @param {number} n
 * @returns {string}
 */
const indianWords = (n) => {
  if (n < 1000) return under1000(n);

  const parts = [];
  let rest = n;

  const crore = Math.floor(rest / 1e7);
  if (crore > 0) {
    parts.push(`${crore < 1000 ? under1000(crore) : indianWords(crore)} crore`);
    rest %= 1e7;
  }
  const lakh = Math.floor(rest / 1e5);
  if (lakh > 0) {
    parts.push(`${under1000(lakh)} lakh`);
    rest %= 1e5;
  }
  const thousand = Math.floor(rest / 1e3);
  if (thousand > 0) {
    parts.push(`${under1000(thousand)} thousand`);
    rest %= 1e3;
  }
  if (rest > 0) parts.push(under1000(rest));

  return parts.join(' ');
};

/** Capitalise the first letter, leaving the rest alone. */
const sentenceCase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * Currency metadata: the minor unit's name and how many decimals it has.
 *
 * Extend rather than guess — a wrong minor unit ("cents" on a yen invoice) is more
 * embarrassing than a generic one. Unknown codes fall back to a decimal fraction
 * ("and 45/100"), which is standard practice and never wrong.
 */
export const CURRENCY_UNITS = {
  USD: { major: 'US Dollars', minor: 'Cents', decimals: 2 },
  EUR: { major: 'Euros', minor: 'Cents', decimals: 2 },
  GBP: { major: 'Pounds Sterling', minor: 'Pence', decimals: 2 },
  INR: { major: 'Rupees', minor: 'Paise', decimals: 2, system: 'indian' },
  AED: { major: 'UAE Dirhams', minor: 'Fils', decimals: 2 },
  AUD: { major: 'Australian Dollars', minor: 'Cents', decimals: 2 },
  CAD: { major: 'Canadian Dollars', minor: 'Cents', decimals: 2 },
  CNY: { major: 'Chinese Yuan', minor: 'Fen', decimals: 2 },
  JPY: { major: 'Japanese Yen', minor: '', decimals: 0 },
  SGD: { major: 'Singapore Dollars', minor: 'Cents', decimals: 2 },
  CHF: { major: 'Swiss Francs', minor: 'Rappen', decimals: 2 },
  SEK: { major: 'Swedish Kronor', minor: 'Öre', decimals: 2 },
};

/** Currency codes the amount-in-words line understands, for a select. */
export const CURRENCY_OPTIONS = Object.keys(CURRENCY_UNITS);

/**
 * Spell an integer, in either numbering system.
 *
 * @param {number} n
 * @param {'international'|'indian'} [system='international']
 * @returns {string}
 */
export const integerToWords = (n, system = 'international') => {
  const v = Math.floor(Math.abs(safeNum(n, 0)));
  if (!Number.isFinite(v)) return 'zero';
  // Beyond this, float precision makes the digits themselves untrustworthy, and
  // spelling an imprecise number onto an invoice would be worse than declining.
  if (v > Number.MAX_SAFE_INTEGER) return 'amount too large to express in words';
  return system === 'indian' ? indianWords(v) : internationalWords(v);
};

/**
 * The full amount-in-words line for an invoice.
 *
 * @param {number} amount
 * @param {string} [currency='USD'] - ISO 4217 code.
 * @param {object} [opts]
 * @param {'international'|'indian'} [opts.system] - Overrides the currency's default.
 * @param {boolean} [opts.only=true] - Append "only", the conventional terminator
 *   that stops anything being added after the words.
 * @returns {string}
 */
export const amountToWords = (amount, currency = 'USD', opts = {}) => {
  const code = String(currency || 'USD').toUpperCase();
  const meta = CURRENCY_UNITS[code];
  const decimals = meta?.decimals ?? 2;
  const system = opts.system || meta?.system || 'international';
  const only = opts.only !== false;

  const n = safeNum(amount, 0);
  const negative = n < 0;
  const abs = Math.abs(n);

  /* Round to the currency's precision BEFORE splitting, so 0.999 becomes "one
     dollar" rather than "zero dollars and 100 cents". */
  const factor = 10 ** decimals;
  const scaled = Math.round(abs * factor);
  const major = Math.floor(scaled / factor);
  const minor = scaled % factor;

  const majorName = meta?.major ?? code;
  const parts = [`${majorName} ${integerToWords(major, system)}`];

  if (decimals > 0 && minor > 0) {
    if (meta?.minor) {
      parts.push(`and ${integerToWords(minor, system)} ${meta.minor.toLowerCase()}`);
    } else {
      // Unknown minor unit — the fraction form, which is standard and unambiguous.
      parts.push(`and ${minor}/${factor}`);
    }
  }

  const body = parts.join(' ');
  return sentenceCase(`${negative ? 'minus ' : ''}${body}${only ? ' only' : ''}`);
};
