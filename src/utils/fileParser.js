/**
 * File-parsing utilities for CSV and Excel imports.
 */
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

/* ── Parse a combined dimension string ── */

/**
 * Extract L×W×H from a combined dimension string.
 * @param {string} str - e.g. "50x40x30" or "50 cm x 40 cm x 30 cm"
 * @param {string} delimiter - The separator character (default 'x')
 * @returns {{ length: number, width: number, height: number } | null}
 */
export const parseDimensionString = (str, delimiter = 'x') => {
  if (!str || typeof str !== 'string') return null;
  const esc = delimiter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  const nums = str.match(/(\d+\.?\d*)/g);
  if (nums && nums.length >= 3)
    return { length: +nums[0], width: +nums[1], height: +nums[2] };
  return null;
};

/* ── Coerce cell values ── */

/**
 * Coerce any cell value to a valid number.
 * @param {*} val - The cell value.
 * @returns {number}
 */
/** Coerce any cell value to a valid number, strictly defaulting to 0. */
export const sanitizeNumeric = (val) => {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (val == null || val === '') return 0;

  // Clean string and parse
  const n = parseFloat(String(val).replace(/,/g, '').replace(/[^\d.\-]/g, '').trim());

  // Strict NaN fallback to prevent validation bypass
  return isNaN(n) ? 0 : n;
};

/* ── Parse a CSV or Excel file ── */

/**
 * Parse a CSV or Excel file → { headers, rows, sheetNames?, parseSheet? }.
 * @param {File} file - The file to parse.
 * @returns {Promise<{ headers: string[], rows: object[], sheetNames?: string[], parseSheet?: Function }>}
 */
export const parseFile = (file) =>
  new Promise((resolve, reject) => {
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv')) {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (r) =>
          resolve({ headers: r.meta.fields || [], rows: r.data }),
        error: (err) => reject(err),
      });
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: 'array' });
          const sheetNames = wb.SheetNames;

          const parseSheet = (sheetName) => {
            const ws = wb.Sheets[sheetName];
            // Read everything as raw arrays to handle blank header rows
            const allRows = XLSX.utils.sheet_to_json(ws, {
              header: 1,
              defval: '',
            });
            // Smart header detection: scan first 20 rows and pick the one
            // with the most non-empty string cells — this skips title/banner rows.
            const scanLimit = Math.min(20, allRows.length);
            let headerRowIdx = -1;
            let bestCount = 0;
            for (let ri = 0; ri < scanLimit; ri++) {
              const count = allRows[ri].filter(
                (cell) =>
                  cell !== null &&
                  cell !== undefined &&
                  String(cell).trim() !== ''
              ).length;
              if (count > bestCount) {
                bestCount = count;
                headerRowIdx = ri;
              }
            }
            if (headerRowIdx === -1) return { headers: [], rows: [] };
            const headerRow = allRows[headerRowIdx].map((h) =>
              String(h ?? '').trim()
            );
            // All rows after the header that have at least one non-empty cell
            const dataRows = allRows
              .slice(headerRowIdx + 1)
              .filter((r) =>
                r.some(
                  (c) =>
                    c !== null &&
                    c !== undefined &&
                    String(c).trim() !== ''
                )
              )
              .map((r) =>
                Object.fromEntries(
                  headerRow.map((h, i) => [h, r[i] ?? ''])
                )
              );
            return {
              headers: headerRow.filter((h) => h !== ''),
              rows: dataRows,
            };
          };

          const { headers, rows } = parseSheet(sheetNames[0]);
          resolve({ headers, rows, sheetNames, parseSheet });
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    } else {
      reject(
        new Error(
          'Unsupported file type. Please upload a .csv or .xlsx file.'
        )
      );
    }
  });

/* ── Auto-map headers to known field aliases ── */

export const FIELD_ALIASES = {
  name: [
    'product name',
    'item name',
    'material name',
    'product',
    'name',
    'item',
    'description',
    'sku',
  ],
  length: ['length (cm)', 'length (mm)', 'length (in)', 'length', 'len'],
  width: ['width (cm)', 'width (mm)', 'width (in)', 'width', 'wid'],
  height: ['height (cm)', 'height (mm)', 'height (in)', 'height', 'depth', 'ht'],
  cbm: [
    'sum of totalcbm',
    'total cbm',
    'totalcbm',
    'cbm/shipper',
    'cbm per shipper',
    'volume (m³)',
    'volume (cbm)',
    'cbm',
  ],
  packSize: [
    'pack size',
    'pack qty',
    '1 pack qnt',
    'no of pack',
    'pack',
    'pcs',
    'units',
  ],
  netWeight: [
    'net wt.',
    'net weight',
    'unit weight',
    'net wt',
    'nt.wt',
    'net',
  ],
  grossWeight: [
    'gross wt.',
    'gross weight',
    'total weight',
    'shipper weight',
    'gross wt',
    'gr.wt.',
    'gross',
  ],
};

// Single-letter exact column names (e.g. L, W, H in shipping templates)
export const SINGLE_LETTER_ALIASES = {
  length: ['l'],
  width: ['w'],
  height: ['h'],
};

export const DIM_ALIASES = [
  'size',
  'dimension',
  'dim',
  'dimensions',
  'l x w x h',
  'lxwxh',
];

/**
 * Auto-map file headers to known field names.
 * @param {string[]} headers - Column headers from the file.
 * @returns {{ mapping: object, combinedDimColumn: string|null }}
 */
export const autoMapHeaders = (headers) => {
  const mapping = {};
  let combinedDimColumn = null;
  const norm = headers.map((h) => h.toLowerCase().trim());

  // Check for combined dimension column (e.g. "dimensions", "L x W x H")
  norm.forEach((nh, i) => {
    if (DIM_ALIASES.some((a) => nh.includes(a)))
      combinedDimColumn = headers[i];
  });

  // Multi-word / phrase aliases — longest first to avoid false substring matches
  Object.entries(FIELD_ALIASES).forEach(([field, aliases]) => {
    norm.forEach((nh, i) => {
      if (!mapping[field] && aliases.some((a) => nh.includes(a.trim())))
        mapping[field] = headers[i];
    });
  });

  // Single-letter exact aliases (L, W, H) — only match if nothing was found yet
  Object.entries(SINGLE_LETTER_ALIASES).forEach(([field, letters]) => {
    if (!mapping[field]) {
      norm.forEach((nh, i) => {
        if (!mapping[field] && letters.some((l) => nh === l))
          mapping[field] = headers[i];
      });
    }
  });

  return { mapping, combinedDimColumn };
};

/* ── Icon/colour pools for imported products ── */

export const IMPORT_ICONS = [
  '📦', '⚙️', '🏗️', '🧵', '📱', '🔧', '💊', '🎁',
  '🧴', '🪣', '🖥️', '🔩', '🗄️', '🛢️', '🔋',
];

export const IMPORT_COLORS = [
  { color: 'from-violet-100 to-indigo-100', border: 'border-violet-200' },
  { color: 'from-sky-100 to-cyan-100', border: 'border-sky-200' },
  { color: 'from-lime-100 to-emerald-100', border: 'border-lime-200' },
  { color: 'from-fuchsia-100 to-pink-100', border: 'border-fuchsia-200' },
  { color: 'from-orange-100 to-amber-100', border: 'border-orange-200' },
  { color: 'from-teal-100 to-cyan-100', border: 'border-teal-200' },
  { color: 'from-rose-100 to-pink-100', border: 'border-rose-200' },
];

/* ── Build a product from a raw row ── */

/**
 * Build a normalised product object from one raw row + mapping config.
 * @param {object} row - Raw data row.
 * @param {object} mapping - Field → column header mapping.
 * @param {object} dimConfig - Dimension configuration (combined/separate).
 * @param {number} slotIndex - Index for icon/color cycling.
 * @returns {object} A normalised product object.
 */
export const buildProductFromRow = (row, mapping, dimConfig, slotIndex) => {
  let length = 0,
    width = 0,
    height = 0;
  if (dimConfig.combined && dimConfig.column) {
    const parsed = parseDimensionString(
      String(row[dimConfig.column] || ''),
      dimConfig.delimiter || 'x'
    );
    if (parsed) {
      length = sanitizeNumeric(parsed.length);
      width = sanitizeNumeric(parsed.width);
      height = sanitizeNumeric(parsed.height);
    }
  } else {
    length = sanitizeNumeric(row[mapping.length]);
    width = sanitizeNumeric(row[mapping.width]);
    height = sanitizeNumeric(row[mapping.height]);
  }
  const style = IMPORT_COLORS[slotIndex % IMPORT_COLORS.length];

  // When file has no L/W/H but has a pre-calculated CBM column, store it directly
  const preCalcCBM =
    !length && !width && !height && mapping.cbm
      ? sanitizeNumeric(row[mapping.cbm])
      : 0;

  return {
    id: `import-${Date.now()}-${slotIndex}-${Math.random().toString(36).substr(2, 5)}`,
    name: String(row[mapping.name] || `Product ${slotIndex + 1}`).trim(),
    description: 'Imported product',
    icon: IMPORT_ICONS[slotIndex % IMPORT_ICONS.length],
    color: style.color,
    border: style.border,
    unit: dimConfig.unit || 'cm',
    length,
    width,
    height,
    packSize: sanitizeNumeric(row[mapping.packSize]) || 1,
    netWeightPerUnit: sanitizeNumeric(row[mapping.netWeight]),
    grossWeightPerShipper: sanitizeNumeric(row[mapping.grossWeight]),
    ...(preCalcCBM > 0 && { cbmPerShipper: preCalcCBM }),
    rawData: row,
  };
};

/**
 * Transform all rows → product objects, tagging invalid ones instead of dropping them.
 * @param {Array} rows - Raw data rows.
 * @param {object} mapping - Field → column header mapping.
 * @param {object} dimConfig - Dimension configuration.
 * @returns {Array} Array of product objects with status tags.
 */
export const applyMapping = (rows, mapping, dimConfig) =>
  rows.map((r, i) => {
    const p = buildProductFromRow(r, mapping, dimConfig, i);

    // Strict truthy check: Dimensions must be strictly greater than 0
    // This cannot be bypassed by NaN, null, or undefined
    const hasValidDims = p.length > 0 && p.width > 0 && p.height > 0;

    if (!hasValidDims) {
      return { ...p, status: 'skipped', skipReason: 'Missing Dimensions' };
    }

    return { ...p, status: 'new' };
  });
