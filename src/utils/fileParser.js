/**
 * File-parsing utilities for CSV and Excel imports.
 *
 * Design stance: the app cannot control what spreadsheet a logistics user has,
 * so parsing is permissive but never silent. Values that cannot be understood
 * produce a diagnosis on the row rather than a zero, and every rejected row is
 * recoverable via the rejected-rows export in the wizard.
 */
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { parseFlexibleNumber, detectColumnLocale, clampInt } from './numbers';
import { mapHeaders, FIELD_DEFS } from './headerMap';
import { calcCBM } from './calculations';

/* Stable monotonic counter — avoids duplicate IDs when Date.now() is the same ms */
let _importIdCounter = 0;
const genId = () => `import-${Date.now()}-${++_importIdCounter}`;

/* ══════════════════════════════════════════════════════════
   Scale limits
   ══════════════════════════════════════════════════════════ */

/** Above this the browser tab is likely to run out of memory before it finishes. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
/** Rows beyond this are dropped, and the wizard says so rather than pretending. */
export const MAX_ROWS = 50_000;
/** Rows sampled when inferring a column's number format or unit. */
const SAMPLE_SIZE = 200;

const formatBytes = (b) =>
  b >= 1024 * 1024 ? `${(b / (1024 * 1024)).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;

/* ══════════════════════════════════════════════════════════
   Units
   ══════════════════════════════════════════════════════════ */

const UNIT_LOOKUP = {
  mm: 'mm', millimeter: 'mm', millimetre: 'mm', millimeters: 'mm', millimetres: 'mm',
  cm: 'cm', centimeter: 'cm', centimetre: 'cm', centimeters: 'cm', centimetres: 'cm',
  m: 'meters', meter: 'meters', metre: 'meters', meters: 'meters', metres: 'meters',
  mtr: 'meters', mtrs: 'meters',
  in: 'inches', inch: 'inches', inches: 'inches', '"': 'inches', ins: 'inches',
  ft: 'feet', foot: 'feet', feet: 'feet', "'": 'feet',
};

/**
 * Normalise a free-text unit label to one the app understands.
 * @param {*} v - e.g. "CM", "Millimetres", 'in'
 * @returns {string|null} A valid unit key, or null when unrecognised.
 */
export const normalizeUnitLabel = (v) => {
  if (v == null) return null;
  const s = String(v).toLowerCase().trim().replace(/\.$/, '');
  if (!s) return null;
  return UNIT_LOOKUP[s] || null;
};

/* ══════════════════════════════════════════════════════════
   Combined dimension strings
   ══════════════════════════════════════════════════════════ */

/** Delimiters seen in real files, in preference order. */
export const DIM_DELIMITERS = ['x', '*', '×', 'X', 'by', '/', '-'];

/**
 * Guess which delimiter a set of combined-dimension values uses.
 * Previously the wizard always defaulted to 'x', so a file using '*' or '×'
 * silently fell back to the loose "first three numbers" path.
 *
 * @param {Array<*>} samples
 * @returns {string} The best delimiter, defaulting to 'x'.
 */
export const detectDimDelimiter = (samples) => {
  const values = (samples || [])
    .map((v) => String(v ?? '').trim())
    .filter((s) => s.length > 0)
    .slice(0, SAMPLE_SIZE);
  if (values.length === 0) return 'x';

  let best = 'x';
  let bestScore = 0;
  for (const d of DIM_DELIMITERS) {
    let score = 0;
    for (const v of values) {
      // Two separators means three components — the shape we actually want.
      const parts = v.split(d);
      if (parts.length === 3) score += 2;
      else if (parts.length > 3) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return bestScore > 0 ? best : 'x';
};

/**
 * Extract L×W×H from a combined dimension string.
 * @param {string} str - e.g. "50x40x30" or "50 cm x 40 cm x 30 cm"
 * @param {string} delimiter - Separator, or 'auto' to detect from this value.
 * @returns {{ length: number, width: number, height: number } | null}
 */
export const parseDimensionString = (str, delimiter = 'x') => {
  if (!str || typeof str !== 'string') return null;
  const delim = !delimiter || delimiter === 'auto' ? detectDimDelimiter([str]) : delimiter;
  const esc = delim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pat = new RegExp(
    '([\\d]+\\.?[\\d]*)\\s*[a-zA-Z]*\\s*' +
    esc +
    '\\s*([\\d]+\\.?[\\d]*)\\s*[a-zA-Z]*\\s*' +
    esc +
    '\\s*([\\d]+\\.?[\\d]*)',
    'i'
  );
  const m = str.match(pat);
  if (m) return { length: +m[1], width: +m[2], height: +m[3] };
  // Loose fallback: any three numbers, which also covers unicode separators.
  const nums = str.match(/(\d+\.?\d*)/g);
  if (nums && nums.length >= 3)
    return { length: +nums[0], width: +nums[1], height: +nums[2] };
  return null;
};

/* ══════════════════════════════════════════════════════════
   Cell coercion
   ══════════════════════════════════════════════════════════ */

/**
 * Coerce any cell value to a valid number, defaulting to 0.
 *
 * Thin wrapper over `parseFlexibleNumber` so existing call sites keep their
 * forgiving behaviour. Prefer `parseCell` where an unparseable value needs to
 * stay visible — that distinction is what stops junk silently becoming 0.
 *
 * @param {*} val
 * @param {{ locale?: string|null }} [opts]
 * @returns {number}
 */
export const sanitizeNumeric = (val, opts) => parseFlexibleNumber(val, opts) ?? 0;

/**
 * Parse a cell, distinguishing "blank" from "present but unintelligible".
 * @returns {{ value: number, blank: boolean, failed: boolean }}
 */
export const parseCell = (val, opts) => {
  const blank = val == null || String(val).trim() === '';
  if (blank) return { value: 0, blank: true, failed: false };
  const n = parseFlexibleNumber(val, opts);
  return n === null
    ? { value: 0, blank: false, failed: true }
    : { value: n, blank: false, failed: false };
};

/* ══════════════════════════════════════════════════════════
   File parsing
   ══════════════════════════════════════════════════════════ */

/**
 * Parse a CSV or Excel file.
 *
 * @param {File} file
 * @returns {Promise<{ headers: string[], rows: object[], sheetNames?: string[],
 *   parseSheet?: Function, truncated?: boolean, totalRows?: number }>}
 */
export const parseFile = (file) =>
  new Promise((resolve, reject) => {
    if (!file) return reject(new Error('No file provided.'));

    if (file.size > MAX_FILE_BYTES) {
      return reject(
        new Error(
          `File is ${formatBytes(file.size)} — the limit is ${formatBytes(MAX_FILE_BYTES)}. ` +
          `Split it into smaller files, or remove unused columns and sheets.`
        )
      );
    }

    /** Enforce the row cap once, in one place, and report what was dropped. */
    const capRows = (rows) => {
      const totalRows = rows.length;
      if (totalRows <= MAX_ROWS) return { rows, truncated: false, totalRows };
      return { rows: rows.slice(0, MAX_ROWS), truncated: true, totalRows };
    };

    const name = file.name.toLowerCase();

    if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv')) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: 'greedy', // also drops rows of only commas
        worker: true,             // PapaParse built-in worker mode
        complete: (r) => {
          const { rows, truncated, totalRows } = capRows(r.data || []);
          resolve({ headers: r.meta.fields || [], rows, truncated, totalRows });
        },
        error: (err) => reject(err),
      });
      return;
    }

    if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.xlsm')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        // Defer heavy XLSX parsing so the browser can repaint the loading spinner first
        setTimeout(() => {
          try {
            const wb = XLSX.read(e.target.result, {
              type: 'array',
              cellDates: false, // Faster: don't parse dates
              sheetStubs: false, // Faster: skip empty cells
              dense: true,      // Use dense array format for better memory
            });
            const sheetNames = wb.SheetNames;

            const parseSheet = (sheetName) => {
              const ws = wb.Sheets[sheetName];
              if (!ws) return { headers: [], rows: [] };
              const allRows = XLSX.utils.sheet_to_json(ws, {
                header: 1,
                defval: '',
                raw: true, // Faster: don't format cells
              });
              if (!allRows.length) return { headers: [], rows: [] };
              const scanLimit = Math.min(20, allRows.length);
              let headerRowIdx = -1, bestCount = 0;
              for (let ri = 0; ri < scanLimit; ri++) {
                const count = allRows[ri].filter(
                  (cell) => cell !== null && cell !== undefined && String(cell).trim() !== ''
                ).length;
                if (count > bestCount) { bestCount = count; headerRowIdx = ri; }
              }
              if (headerRowIdx === -1) return { headers: [], rows: [] };
              const headerRow = allRows[headerRowIdx].map((h) => String(h ?? '').trim());
              const validHeaders = headerRow.filter((h) => h !== '');
              // Build rows using index lookup (faster than filter+map chain)
              const dataRows = [];
              for (let ri = headerRowIdx + 1; ri < allRows.length; ri++) {
                const r = allRows[ri];
                let hasData = false;
                for (let ci = 0; ci < r.length; ci++) {
                  const c = r[ci];
                  if (c !== null && c !== undefined && String(c).trim() !== '') {
                    hasData = true;
                    break;
                  }
                }
                if (!hasData) continue;
                const obj = {};
                for (let ci = 0; ci < headerRow.length; ci++) {
                  const h = headerRow[ci];
                  if (h !== '') obj[h] = r[ci] ?? '';
                }
                dataRows.push(obj);
              }
              const capped = capRows(dataRows);
              return {
                headers: validHeaders,
                rows: capped.rows,
                truncated: capped.truncated,
                totalRows: capped.totalRows,
              };
            };

            const first = parseSheet(sheetNames[0]);
            resolve({ ...first, sheetNames, parseSheet });
          } catch (err) {
            reject(
              new Error(
                `Could not read this workbook: ${err?.message || 'unknown error'}. ` +
                `Try re-saving it as .xlsx or .csv.`
              )
            );
          }
        }, 0); // defer to next event loop tick — allows UI to repaint
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
      return;
    }

    reject(
      new Error('Unsupported file type. Please upload a .csv, .xlsx or .xls file.')
    );
  });

/* ══════════════════════════════════════════════════════════
   Header mapping — back-compatible facade over headerMap.js
   ══════════════════════════════════════════════════════════ */

/**
 * Auto-map file headers to known field names.
 *
 * Delegates to the scored matcher in headerMap.js. The old implementation was
 * first-substring-wins, so column *order* decided which column won a field.
 *
 * @param {string[]} headers - Column headers from the file.
 * @returns {{ mapping: object, combinedDimColumn: string|null,
 *   confidence: object, scores: object, unmappedHeaders: string[], candidates: object }}
 */
export const autoMapHeaders = (headers) => {
  const result = mapHeaders(headers);
  const mapping = { ...result.mapping };
  // `dims` is surfaced separately — the wizard toggles combined-dimension mode
  // rather than treating it as an ordinary mapped field.
  const combinedDimColumn = mapping.dims || null;
  delete mapping.dims;

  return {
    mapping,
    combinedDimColumn,
    confidence: result.confidence,
    scores: result.scores,
    unmappedHeaders: result.unmappedHeaders,
    candidates: result.candidates,
  };
};

/** Field keys whose columns hold numbers, for per-column format detection. */
const NUMERIC_FIELDS = [
  'length', 'width', 'height', 'cbm', 'packSize', 'quantity',
  'netWeight', 'grossWeight', 'unitPrice',
];

/**
 * Detect the decimal convention of each mapped numeric column.
 *
 * Done per column rather than per cell so the genuinely ambiguous `1,234` is
 * resolved once, consistently, using evidence from the whole column.
 *
 * @param {object[]} rows
 * @param {object} mapping
 * @returns {Record<string, 'dot-decimal'|'comma-decimal'|null>} Keyed by column header.
 */
export const detectColumnLocales = (rows, mapping) => {
  const locales = {};
  const sample = (rows || []).slice(0, SAMPLE_SIZE);
  for (const field of NUMERIC_FIELDS) {
    const col = mapping?.[field];
    if (!col || locales[col] !== undefined) continue;
    locales[col] = detectColumnLocale(sample.map((r) => r?.[col]));
  }
  return locales;
};

/* ── Icon/colour pools for imported products ── */

export const IMPORT_ICONS = [
  '📦', '⚙️', '🏗️', '🧵', '📱', '🔧', '💊', '🎁',
  '🧴', '🪣', '🖥️', '🔩', '🗄️', '🛢️', '🔋',
];

/*
 * Product card tints. The redesign uses a single flat accent surface for the
 * active card (applied directly in ProductDirectory), so these no longer carry
 * per-slot rainbow gradients — kept as a stable, neutral fallback shape.
 */
export const IMPORT_COLORS = [
  { color: 'from-accent-50 to-accent-50', border: 'border-accent-200' },
];

/* ══════════════════════════════════════════════════════════
   Row → product
   ══════════════════════════════════════════════════════════ */

/**
 * Build a normalised product object from one raw row + mapping config.
 *
 * @param {object} row - Raw data row.
 * @param {object} mapping - Field → column header mapping.
 * @param {object} dimConfig - Dimension configuration.
 *   dimConfig.combined / column / delimiter — combined-dimension parsing.
 *   dimConfig.unit — fallback unit when the file has no per-row unit column.
 *   dimConfig.netWeightBasis / grossWeightBasis — 'shipper' (default) or 'unit'.
 *   dimConfig.locales — column header → decimal convention (see detectColumnLocales).
 * @param {number} slotIndex - Index for icon/color cycling.
 * @param {object} [diag] - Optional sink for parse diagnostics.
 * @returns {object} A normalised product object.
 */
export const buildProductFromRow = (row, mapping, dimConfig, slotIndex, diag) => {
  const locales = dimConfig.locales || {};
  const opts = (field) => {
    const col = mapping?.[field];
    return col && locales[col] ? { locale: locales[col] } : undefined;
  };

  /** Read a mapped numeric column, recording blank/failed state for triage. */
  const num = (field) => {
    const col = mapping?.[field];
    if (!col) return { value: 0, blank: true, failed: false, mapped: false };
    const res = parseCell(row?.[col], opts(field));
    if (res.failed && diag) {
      diag.failedFields = diag.failedFields || [];
      diag.failedFields.push(FIELD_DEFS[field]?.label || field);
    }
    return { ...res, mapped: true };
  };

  /* ── Dimensions ── */
  let length = 0, width = 0, height = 0;
  let dimsMapped; // assigned by both branches below
  if (dimConfig.combined && dimConfig.column) {
    dimsMapped = true;
    const parsed = parseDimensionString(
      String(row?.[dimConfig.column] ?? ''),
      dimConfig.delimiter || 'x'
    );
    if (parsed) {
      length = Math.abs(parsed.length) || 0;
      width = Math.abs(parsed.width) || 0;
      height = Math.abs(parsed.height) || 0;
    } else if (diag && String(row?.[dimConfig.column] ?? '').trim() !== '') {
      diag.failedFields = diag.failedFields || [];
      diag.failedFields.push('Dimensions');
    }
  } else {
    const l = num('length'), w = num('width'), h = num('height');
    dimsMapped = l.mapped || w.mapped || h.mapped;
    length = Math.abs(l.value);
    width = Math.abs(w.value);
    height = Math.abs(h.value);
    if (diag) diag.dimBlanks = [l, w, h].filter((d) => d.mapped && d.blank).length;
  }

  /* ── Unit: per-row column wins over the file-wide default ── */
  let unit = dimConfig.unit || 'cm';
  if (mapping?.unit) {
    const rowUnit = normalizeUnitLabel(row?.[mapping.unit]);
    if (rowUnit) unit = rowUnit;
    else if (diag && String(row?.[mapping.unit] ?? '').trim() !== '') {
      diag.unknownUnit = String(row[mapping.unit]).trim();
    }
  }

  /* ── Pack size, quantity, weights ── */
  const packRaw = num('packSize');
  const packSize = clampInt(packRaw.value, 1) || 1;
  const qtyRaw = num('quantity');
  const quantity = qtyRaw.mapped && qtyRaw.value > 0 ? clampInt(qtyRaw.value, 1) : 1;

  const rawNet = Math.abs(num('netWeight').value);
  const rawGross = Math.abs(num('grossWeight').value);
  // Weight-basis: columns may hold per-shipper (default) or per-unit values.
  const netWeightPerUnit =
    dimConfig.netWeightBasis === 'unit' ? rawNet : rawNet / packSize;
  const grossWeightPerShipper =
    dimConfig.grossWeightBasis === 'unit' ? rawGross * packSize : rawGross;

  const cbmCell = num('cbm');
  const fileCBM = Math.abs(cbmCell.value);
  /* Pre-calc CBM is only valid when the user intentionally mapped NO dim columns.
     If dim columns were mapped but came back empty, that is bad data and must
     surface as a rejected row — falling back to a CBM column would mask it. */
  const preCalcCBM = !dimsMapped && cbmCell.mapped ? fileCBM : 0;

  const nameCell = row?.[mapping?.name];
  const nameBlank = mapping?.name ? String(nameCell ?? '').trim() === '' : true;
  if (diag) {
    diag.nameBlank = nameBlank;
    diag.nameMapped = !!mapping?.name;
    diag.dimsMapped = dimsMapped;
    diag.fileCBM = cbmCell.mapped ? fileCBM : null;
    // Only meaningful to warn about absent weights if the user mapped a weight
    // column at all — otherwise every dimension-only catalog would warn.
    diag.weightsMapped = !!(mapping?.netWeight || mapping?.grossWeight);
  }

  const style = IMPORT_COLORS[slotIndex % IMPORT_COLORS.length];

  return {
    id: genId(), // stable counter-based ID
    name: String(nameCell ?? '').trim() || `Product ${slotIndex + 1}`,
    description: 'Imported product',
    icon: IMPORT_ICONS[slotIndex % IMPORT_ICONS.length],
    color: style.color,
    border: style.border,
    unit,
    length,
    width,
    height,
    /* Only ever the real packing description. It used to fall back to the pack-size
       column, so `packingString` came out as the bare number "10" — which forced
       ActiveShipment to strip-and-compare it against packSize just to avoid
       rendering "10 pcs/shipper (10)". Empty is the honest value when the file
       has no packing description. */
    packingString: String(row?.[mapping?.packingString] ?? '').trim(),
    packSize,
    quantity,
    netWeightPerUnit,
    grossWeightPerShipper,
    ...(preCalcCBM > 0 && { cbmPerShipper: preCalcCBM }),
    ...(mapping?.sku && { sku: String(row?.[mapping.sku] ?? '').trim() }),
    ...(mapping?.hsCode && { hsCode: String(row?.[mapping.hsCode] ?? '').trim() }),
    ...(mapping?.origin && { origin: String(row?.[mapping.origin] ?? '').trim() }),
    ...(mapping?.marks && { marks: String(row?.[mapping.marks] ?? '').trim() }),
    ...(mapping?.currency && { currency: String(row?.[mapping.currency] ?? '').trim() }),
    ...(mapping?.unitPrice && { unitPrice: Math.abs(num('unitPrice').value) }),
    rawData: row,
  };
};

/* ══════════════════════════════════════════════════════════
   Row triage
   ══════════════════════════════════════════════════════════ */

/** Skip reasons — a row carrying one of these is never imported. */
export const SKIP_REASONS = {
  MISSING_DIMS: 'Missing Dimensions',
  ZERO_DIM: 'Zero/Negative Dimension',
  UNPARSEABLE: 'Unparseable Numbers',
  BLANK_NAME: 'Blank Name',
  DUPLICATE: 'Exact Duplicate',
};

/** Warning reasons — the row imports, but something looks off. */
export const WARN_REASONS = {
  GROSS_LT_NET: 'Gross weight below net weight',
  NO_WEIGHTS: 'No weights provided',
  HUGE_CBM: 'Implausibly large CBM',
  EXTREME_RATIO: 'Extreme dimension ratio',
  HUGE_DIM: 'Implausibly large dimension',
  CBM_MISMATCH: 'File CBM disagrees with dimensions',
  UNKNOWN_UNIT: 'Unrecognised unit',
};

/** A single shipper above this volume is almost certainly a data error. */
const MAX_PLAUSIBLE_CBM = 100;
/** 20 m in cm — longer than any container. */
const MAX_PLAUSIBLE_DIM_CM = 2000;
/** Beyond this length:width ratio the row is probably misaligned columns. */
const MAX_ASPECT_RATIO = 100;

/**
 * Classify one built product as importable, questionable, or rejected.
 *
 * @param {object} p - Product from buildProductFromRow.
 * @param {object} diag - Diagnostics collected while building it.
 * @returns {{ status: 'new'|'warn'|'skipped', skipReason?: string, warnings?: string[] }}
 */
export const validateRow = (p, diag = {}) => {
  const hasDims = p.length > 0 && p.width > 0 && p.height > 0;
  const hasCBM = (p.cbmPerShipper || 0) > 0;

  /* ── Rejections, most specific first ── */

  // A mapped-but-empty name usually means a footer or subtotal row.
  if (diag.nameMapped && diag.nameBlank) {
    return { status: 'skipped', skipReason: SKIP_REASONS.BLANK_NAME };
  }

  if (diag.failedFields?.length) {
    return {
      status: 'skipped',
      skipReason: SKIP_REASONS.UNPARSEABLE,
      detail: diag.failedFields.join(', '),
    };
  }

  if (!hasDims && !hasCBM) {
    /* Distinguish "no dimension data at all" from "some dimensions present but
       one is zero" — the old code reported both as Missing Dimensions, sending
       users hunting for an absent column when really one cell was empty. */
    const someDims = p.length > 0 || p.width > 0 || p.height > 0;
    return {
      status: 'skipped',
      skipReason: someDims ? SKIP_REASONS.ZERO_DIM : SKIP_REASONS.MISSING_DIMS,
    };
  }

  /* ── Warnings — the row still imports ── */
  const warnings = [];

  if (diag.unknownUnit) warnings.push(WARN_REASONS.UNKNOWN_UNIT);

  const cbm = hasDims ? calcCBM(p.length, p.width, p.height, p.unit) : p.cbmPerShipper || 0;
  if (cbm > MAX_PLAUSIBLE_CBM) warnings.push(WARN_REASONS.HUGE_CBM);

  if (hasDims) {
    const dims = [p.length, p.width, p.height].map((d) => {
      const mult = { mm: 0.1, cm: 1, meters: 100, inches: 2.54, feet: 30.48 }[p.unit] ?? 1;
      return d * mult;
    });
    if (dims.some((d) => d > MAX_PLAUSIBLE_DIM_CM)) warnings.push(WARN_REASONS.HUGE_DIM);
    const min = Math.min(...dims);
    const max = Math.max(...dims);
    if (min > 0 && max / min > MAX_ASPECT_RATIO) warnings.push(WARN_REASONS.EXTREME_RATIO);
  }

  const net = p.netWeightPerUnit * p.packSize;
  if (diag.weightsMapped) {
    // Only judge weights the user actually mapped — a dimension-only catalog
    // should import clean, not warn on every single row.
    if (net === 0 && p.grossWeightPerShipper === 0) warnings.push(WARN_REASONS.NO_WEIGHTS);
    else if (p.grossWeightPerShipper > 0 && net > p.grossWeightPerShipper) {
      warnings.push(WARN_REASONS.GROSS_LT_NET);
    }
  }

  /* Cross-check a file-supplied CBM against the dimensions. Disagreement usually
     means the dimensions are in a different unit than assumed — which is exactly
     the signal unit inference uses. */
  if (hasDims && diag.fileCBM > 0) {
    const ratio = cbm / diag.fileCBM;
    if (ratio < 0.95 || ratio > 1.05) warnings.push(WARN_REASONS.CBM_MISMATCH);
  }

  return warnings.length > 0 ? { status: 'warn', warnings } : { status: 'new' };
};

/**
 * Transform all rows → tagged product objects.
 *
 * @param {object[]} rows
 * @param {object} mapping
 * @param {object} dimConfig - See buildProductFromRow. `locales` is filled in
 *   automatically when absent.
 * @returns {object[]} Products tagged with status / skipReason / warnings.
 */
export const applyMapping = (rows, mapping, dimConfig = {}) => {
  const cfg = dimConfig.locales
    ? dimConfig
    : { ...dimConfig, locales: detectColumnLocales(rows, mapping) };

  return (rows || []).map((r, i) => {
    const diag = {};
    const p = buildProductFromRow(r, mapping, cfg, i, diag);
    const verdict = validateRow(p, diag);
    return { ...p, ...verdict };
  });
};
