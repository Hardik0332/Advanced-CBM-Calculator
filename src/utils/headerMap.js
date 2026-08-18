/**
 * Scored header → field mapping.
 *
 * Replaces the original first-substring-wins loop, whose result depended on
 * *column order*: because `description` is an alias for `name`, a file
 * containing both "Description" and "Product Name" mapped `name` to whichever
 * appeared first. Nothing about the data changed — only the column order — and
 * the import silently used the wrong column.
 *
 * The fix is a two-stage algorithm:
 *
 *   1. Score every (field, header) pair independently. Match quality is graded
 *      (exact > prefix > token > substring > fuzzy) and more specific aliases
 *      outrank vaguer ones, so "Product Name" always beats "Description" for
 *      `name` regardless of position.
 *   2. Assign greedily from the highest score down, consuming BOTH the field and
 *      the header. One column can never satisfy two fields, and a field can
 *      never steal a column that a better-scoring field wanted.
 *
 * Every mapping also carries a confidence level, so the wizard can show which
 * guesses are safe and which need a human to confirm.
 */

/* ══════════════════════════════════════════════════════════
   Field definitions — aliases ordered MOST SPECIFIC FIRST.
   Alias order matters: earlier entries earn a specificity bonus.
   ══════════════════════════════════════════════════════════ */

export const FIELD_DEFS = {
  name: {
    label: 'Product Name',
    required: true,
    aliases: [
      'product name', 'item name', 'material name', 'material description',
      'item description', 'product description', 'product', 'item', 'material',
      'article', 'name', 'description', 'particulars',
    ],
  },
  sku: {
    label: 'SKU / Code',
    aliases: [
      'sku', 'item code', 'product code', 'material code', 'part number',
      'part no', 'article no', 'item no', 'code',
    ],
  },
  length: {
    label: 'Length',
    aliases: ['length', 'len', 'lng', 'l'],
    // "Wavelength" contains "length" but is not a dimension.
    negative: ['wave'],
  },
  width: {
    label: 'Width',
    aliases: ['width', 'breadth', 'wid', 'brd', 'w', 'b'],
  },
  height: {
    label: 'Height',
    aliases: ['height', 'depth', 'thickness', 'ht', 'hgt', 'h', 'd'],
  },
  dims: {
    label: 'Combined Dimensions',
    aliases: [
      'dimensions', 'dimension', 'l x w x h', 'lxwxh', 'lwh', 'size (lxwxh)',
      'measurements', 'dim',
    ],
  },
  unit: {
    label: 'Unit of Measure',
    aliases: [
      'dimension unit', 'unit of measure', 'measurement unit', 'uom', 'units',
      'unit',
    ],
    // "Unit Weight" and "Unit Price" are values, not a unit-of-measure column.
    negative: ['weight', 'wt', 'price', 'cost', 'rate', 'per'],
  },
  cbm: {
    label: 'CBM (pre-calculated)',
    aliases: [
      'sum of totalcbm', 'total cbm', 'totalcbm', 'cbm per shipper',
      'cbm/shipper', 'cbm/ctn', 'volume (m3)', 'volume (cbm)', 'cubic meter',
      'cubic metre', 'cbm', 'volume',
    ],
  },
  packSize: {
    label: 'Pack Size',
    aliases: [
      'pcs per carton', 'pcs per shipper', 'pieces per pack', 'units per pack',
      'qty per pack', 'no. of pack', 'no of pack', 'number of packs',
      '1 pack qnt', 'pcs/ctn', 'pcs/shipper', 'pack size', 'pack qty',
      'packing qty', 'units/carton',
    ],
  },
  quantity: {
    label: 'Quantity (Cartons)',
    aliases: [
      'no. of cartons', 'no of cartons', 'number of cartons', 'total cartons',
      'carton qty', 'cartons', 'ctns', 'shippers', 'boxes', 'cases',
      'quantity', 'qty',
    ],
    // Guard against "Qty per Pack" being read as a carton count.
    negative: ['per pack', 'per carton', 'per ctn', 'per shipper', 'pcs per'],
  },
  packingString: {
    label: 'Packing Description',
    aliases: [
      'packing description', 'pack description', 'packing name', 'packing desc',
      'pack desc', 'variant name', 'packing string', 'pack code', 'packing',
      'variant', 'size',
    ],
  },
  netWeight: {
    label: 'Net Weight',
    aliases: [
      'net weight', 'net wt.', 'net wt', 'nt.wt', 'nt wt', 'unit weight', 'net',
    ],
    negative: ['gross'],
  },
  grossWeight: {
    label: 'Gross Weight',
    aliases: [
      'gross weight', 'gross wt.', 'gross wt', 'gr.wt.', 'gr wt',
      'shipper weight', 'carton weight', 'gross',
    ],
    negative: ['net'],
  },
  hsCode: {
    label: 'HS Code',
    aliases: ['hs code', 'hsn code', 'hs tariff', 'hscode', 'hsn', 'tariff code', 'hs'],
  },
  unitPrice: {
    label: 'Unit Price',
    aliases: [
      'unit price', 'price per unit', 'unit rate', 'rate per unit', 'unit cost',
      'price', 'rate', 'value',
    ],
  },
  currency: {
    label: 'Currency',
    aliases: ['currency', 'curr', 'ccy'],
  },
  origin: {
    label: 'Country of Origin',
    aliases: ['country of origin', 'origin country', 'coo', 'origin', 'made in'],
  },
  marks: {
    label: 'Marks & Numbers',
    aliases: ['marks and numbers', 'marks & numbers', 'shipping marks', 'marks'],
  },
};

/** Minimum score to accept an automatic mapping at all. */
export const SCORE_THRESHOLD = 30;

/** Score bands → confidence shown in the wizard. */
export const CONFIDENCE = { HIGH: 'high', MEDIUM: 'medium', CONFIRM: 'confirm' };

const confidenceFor = (score) => {
  if (score >= 90) return CONFIDENCE.HIGH;
  if (score >= 55) return CONFIDENCE.MEDIUM;
  return CONFIDENCE.CONFIRM;
};

/* ══════════════════════════════════════════════════════════
   Normalisation helpers
   ══════════════════════════════════════════════════════════ */

const normalize = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Drop a trailing unit qualifier: "Length (cm)" -> "length". */
const stripParens = (s) => normalize(s).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();

const tokenize = (s) => normalize(s).split(/[^a-z0-9]+/).filter(Boolean);

/** Does `hay` contain `needle` as a whole-token sequence rather than mid-word? */
const containsTokens = (hayTokens, needleTokens) => {
  if (needleTokens.length === 0) return false;
  for (let i = 0; i <= hayTokens.length - needleTokens.length; i++) {
    let ok = true;
    for (let j = 0; j < needleTokens.length; j++) {
      if (hayTokens[i + j] !== needleTokens[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
};

/** Levenshtein distance with a cheap two-row buffer. */
const levenshtein = (a, b) => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
};

const similarity = (a, b) => {
  const max = Math.max(a.length, b.length);
  return max === 0 ? 0 : 1 - levenshtein(a, b) / max;
};

/* ══════════════════════════════════════════════════════════
   Scoring
   ══════════════════════════════════════════════════════════ */

/**
 * Score one header against one alias. Higher is a better match.
 * Graded so that match *quality* dominates and alias length only breaks ties
 * among matches of the same kind.
 */
const scoreAlias = (header, alias) => {
  const h = normalize(header);
  const hStripped = stripParens(header);
  const a = normalize(alias);
  if (!h || !a) return 0;

  if (h === a) return 100;
  if (hStripped === a) return 95;

  const hTokens = tokenize(header);
  const aTokens = tokenize(alias);

  // Single-letter aliases (L/W/H) must match exactly — never as a substring,
  // or "Length" would match the alias "h" via "lengt(h)".
  if (a.length === 1) {
    return hTokens.length === 1 && hTokens[0] === a ? 92 : 0;
  }

  if (h.startsWith(`${a} `) || hStripped.startsWith(`${a} `)) return 78;
  if (h.endsWith(` ${a}`)) return 72;
  if (containsTokens(hTokens, aTokens)) return 55 + Math.min(a.length, 12);
  if (h.includes(a)) return 35 + Math.min(a.length, 10);

  // Fuzzy only for aliases long enough that near-misses are meaningful.
  if (a.length >= 4) {
    const sim = Math.max(similarity(h, a), similarity(hStripped, a));
    if (sim >= 0.85) return 20 + Math.round(sim * 15);
  }

  return 0;
};

/**
 * Best score for a header against a whole field definition.
 * Earlier aliases carry a small specificity bonus, which is what makes
 * "Product Name" outrank "Description" for `name` no matter the column order.
 */
export const scoreField = (header, def) => {
  const h = normalize(header);
  if (!h) return 0;

  // A disqualifying keyword removes the field from contention entirely, so
  // "Net Weight" can never be claimed by `grossWeight` and "Unit Price" can
  // never be claimed by `unit`.
  if (def.negative?.some((n) => h.includes(normalize(n)))) return 0;

  let best = 0;
  const total = def.aliases.length;
  def.aliases.forEach((alias, i) => {
    const base = scoreAlias(header, alias);
    if (base <= 0) return;
    const specificity = ((total - i) / total) * 4; // 0–4 points
    const score = base + specificity;
    if (score > best) best = score;
  });
  return best;
};

/**
 * Map file headers onto known fields.
 *
 * @param {string[]} headers - Column headers from the file.
 * @param {{ fields?: string[] }} [opts] - Restrict to a subset of fields.
 * @returns {{
 *   mapping: Record<string, string>,
 *   confidence: Record<string, 'high'|'medium'|'confirm'>,
 *   scores: Record<string, number>,
 *   unmappedHeaders: string[],
 *   candidates: Record<string, Array<{ header: string, score: number }>>
 * }}
 */
export const mapHeaders = (headers, opts = {}) => {
  const list = (headers || []).filter((h) => normalize(h) !== '');
  const fieldKeys = opts.fields || Object.keys(FIELD_DEFS);

  /* Stage 1 — score every (field, header) pair. */
  const pairs = [];
  const candidates = {};
  for (const field of fieldKeys) {
    const def = FIELD_DEFS[field];
    if (!def) continue;
    candidates[field] = [];
    for (const header of list) {
      const score = scoreField(header, def);
      if (score >= SCORE_THRESHOLD) {
        pairs.push({ field, header, score });
        candidates[field].push({ header, score });
      }
    }
    candidates[field].sort((a, b) => b.score - a.score);
  }

  /* Stage 2 — greedy assignment, consuming both sides of each match. */
  pairs.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Deterministic tie-break: declaration order, then column order.
    const fi = fieldKeys.indexOf(a.field) - fieldKeys.indexOf(b.field);
    if (fi !== 0) return fi;
    return list.indexOf(a.header) - list.indexOf(b.header);
  });

  const mapping = {};
  const confidence = {};
  const scores = {};
  const usedHeaders = new Set();

  for (const { field, header, score } of pairs) {
    if (mapping[field] || usedHeaders.has(header)) continue;
    mapping[field] = header;
    confidence[field] = confidenceFor(score);
    scores[field] = Math.round(score * 10) / 10;
    usedHeaders.add(header);
  }

  return {
    mapping,
    confidence,
    scores,
    unmappedHeaders: list.filter((h) => !usedHeaders.has(h)),
    candidates,
  };
};
