/**
 * importWorker.js — Web Worker for off-thread file parsing and product mapping.
 *
 * Runs XLSX/CSV parsing and applyMapping entirely off the main thread so the
 * UI stays responsive even when processing thousands of rows.
 *
 * Messages received from main thread:
 *   { type: 'PARSE_FILE', payload: { buffer, fileName } }
 *   { type: 'APPLY_MAPPING', payload: { rows, mapping, dimConfig } }
 *
 * Messages sent to main thread:
 *   { type: 'PARSE_RESULT', payload: { headers, rows, sheetNames? } }
 *   { type: 'MAPPING_RESULT', payload: products[] }
 *   { type: 'ERROR', payload: message }
 */

/* ─── Inline copies of utility functions (workers can't import ES modules
       the same way — vite's ?worker syntax handles this via bundling) ─── */

const parseDimensionString = (str, delimiter = 'x') => {
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

const sanitizeNumeric = (val) => {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (val == null || val === '') return 0;
  const n = parseFloat(String(val).replace(/,/g, '').replace(/[^\d.\-]/g, '').trim());
  return isNaN(n) ? 0 : n;
};

const IMPORT_ICONS = [
  '📦', '⚙️', '🏗️', '🧵', '📱', '🔧', '💊', '🎁',
  '🧴', '🪣', '🖥️', '🔩', '🗄️', '🛢️', '🔋',
];

const IMPORT_COLORS = [
  { color: 'from-violet-100 to-indigo-100', border: 'border-violet-200' },
  { color: 'from-sky-100 to-cyan-100', border: 'border-sky-200' },
  { color: 'from-lime-100 to-emerald-100', border: 'border-lime-200' },
  { color: 'from-fuchsia-100 to-pink-100', border: 'border-fuchsia-200' },
  { color: 'from-orange-100 to-amber-100', border: 'border-orange-200' },
  { color: 'from-teal-100 to-cyan-100', border: 'border-teal-200' },
  { color: 'from-rose-100 to-pink-100', border: 'border-rose-200' },
];

/* Use a stable counter instead of Date.now() per row to avoid identical IDs */
let _idCounter = 0;
const genId = (prefix) => `${prefix}-${Date.now()}-${++_idCounter}`;

const buildProductFromRow = (row, mapping, dimConfig, slotIndex) => {
  let length = 0, width = 0, height = 0;
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
  const preCalcCBM =
    !length && !width && !height && mapping.cbm
      ? sanitizeNumeric(row[mapping.cbm])
      : 0;

  return {
    id: genId('import'),
    name: String(row[mapping.name] || `Product ${slotIndex + 1}`).trim(),
    description: 'Imported product',
    icon: IMPORT_ICONS[slotIndex % IMPORT_ICONS.length],
    color: style.color,
    border: style.border,
    unit: dimConfig.unit || 'cm',
    length,
    width,
    height,
    packingString: String(row[mapping.packingString] || row[mapping.packSize] || '').trim(),
    packSize: sanitizeNumeric(row[mapping.packSize]) || 1,
    netWeightPerUnit:
      sanitizeNumeric(row[mapping.netWeight]) /
      (sanitizeNumeric(row[mapping.packSize]) || 1),
    grossWeightPerShipper: sanitizeNumeric(row[mapping.grossWeight]),
    ...(preCalcCBM > 0 && { cbmPerShipper: preCalcCBM }),
    rawData: row,
  };
};

const applyMappingWorker = (rows, mapping, dimConfig) => {
  const hasDimMapping = !!mapping.length || !!mapping.width || !!mapping.height;
  return rows.map((r, i) => {
    const p = buildProductFromRow(r, mapping, dimConfig, i);
    const hasValidDims = p.length > 0 && p.width > 0 && p.height > 0;
    const hasPreCalcCBM = !hasDimMapping && (p.cbmPerShipper || 0) > 0;
    if (!hasValidDims && !hasPreCalcCBM) {
      return { ...p, status: 'skipped', skipReason: 'Missing Dimensions' };
    }
    return { ...p, status: 'new' };
  });
};

/* ─── Sheet parsing helpers (XLSX is imported by Vite when bundling the worker) ─── */
const parseSheetFromWorkbook = (wb, sheetName) => {
  const ws = wb.Sheets[sheetName];
  const allRows = self.XLSX
    ? self.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
    : [];
  if (!allRows.length) return { headers: [], rows: [] };

  const scanLimit = Math.min(20, allRows.length);
  let headerRowIdx = -1, bestCount = 0;
  for (let ri = 0; ri < scanLimit; ri++) {
    const count = allRows[ri].filter(
      (c) => c !== null && c !== undefined && String(c).trim() !== ''
    ).length;
    if (count > bestCount) { bestCount = count; headerRowIdx = ri; }
  }
  if (headerRowIdx === -1) return { headers: [], rows: [] };
  const headerRow = allRows[headerRowIdx].map((h) => String(h ?? '').trim());
  const dataRows = allRows
    .slice(headerRowIdx + 1)
    .filter((r) => r.some((c) => c !== null && c !== undefined && String(c).trim() !== ''))
    .map((r) => Object.fromEntries(headerRow.map((h, i) => [h, r[i] ?? ''])));
  return { headers: headerRow.filter((h) => h !== ''), rows: dataRows };
};

/* ─── Message handler ─── */
self.onmessage = async (e) => {
  const { type, payload } = e.data;

  if (type === 'APPLY_MAPPING') {
    try {
      const { rows, mapping, dimConfig } = payload;
      const products = applyMappingWorker(rows, mapping, dimConfig);
      self.postMessage({ type: 'MAPPING_RESULT', payload: products });
    } catch (err) {
      self.postMessage({ type: 'ERROR', payload: err.message });
    }
  }
};
