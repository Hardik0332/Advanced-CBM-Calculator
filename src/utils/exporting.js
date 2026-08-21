/**
 * Export public API.
 *
 * A thin facade. Everything substantial lives in `utils/export/`:
 *
 *   export/rows.js          one canonical record per line — the single source of
 *                           truth every document projects from
 *   export/excel.js         multi-sheet workbook
 *   export/csv.js           per-table CSV
 *   export/pdf/            the three-document suite
 *   export/files.js         filename and download plumbing
 *
 * **Every entry point is async.** That is a deliberate API change, not an
 * accident of implementation: `xlsx`, `papaparse`, `jspdf` and `jspdf-autotable`
 * were all statically imported, which put roughly 900 kB of libraries into the
 * first paint of an app that most sessions never export from. They are now behind
 * `import()` inside the functions that need them, so callers must `await`.
 *
 * Precision policy, unchanged: spreadsheets carry raw numerics so a user can
 * re-total them; formatting is the PDF layer's business alone.
 */
import { computeFreight } from './freight';
import { buildExportContext } from './export/rows';
import { exportFileName, downloadText, localDateStamp, UTF8_BOM } from './export/files';

/* ── Re-exports: the row builders and column sets, for callers and tests ── */
export {
  buildItemRecords,
  buildTotalsRecord,
  buildExportContext,
  buildFreightPairs,
  buildTotalsPairs,
  buildTradePairs,
  buildWorkingsAoa,
  buildContainerPlanAoa,
  buildInvoiceTotals,
  resolveParty,
  projectRows,
  projectAoa,
  pruneEmptyColumns,
  PACKING_LIST_COLUMNS,
  ITEM_BREAKDOWN_COLUMNS,
  INVOICE_COLUMNS,
} from './export/rows';

export { exportFileName, localDateStamp, downloadText, downloadBlob, UTF8_BOM } from './export/files';

/* The option catalogues come from `export/catalog.js`, which is deliberately free
   of any heavy dependency. Re-exporting them from `excel.js` / `csv.js` / `pdf/`
   instead would statically pull those modules — and jsPDF and SheetJS with them —
   into the entry chunk, defeating the `import()` calls below. Rollup says so out
   loud: INEFFECTIVE_DYNAMIC_IMPORT. */
export {
  EXCEL_SHEETS,
  defaultSheetSelection,
  CSV_TABLES,
  DEFAULT_CSV_TABLE,
  PDF_DOCUMENTS,
  defaultDocumentSelection,
} from './export/catalog';

/**
 * Assemble the export context from the app's raw state.
 *
 * Every export entry point funnels through here, which is what guarantees the
 * Excel, CSV and PDF outputs describe the same shipment. `computeFreight` is called
 * once per export rather than once per document.
 *
 * @param {object} args
 * @param {Array<object>} args.shipment
 * @param {object} args.totals
 * @param {object} [args.meta] - Shipment metadata: poNumber, containerType,
 *   freightMode, customContainer, the rule selections, and the trade fields.
 * @param {object} [args.company] - Company profile.
 * @param {Array<object>} [args.products] - Product directory.
 * @param {object} [args.freight] - A precomputed `computeFreight` result; supply the
 *   one the UI is already rendering so the document cannot differ from the screen.
 * @returns {object} A `buildExportContext` result.
 */
export const prepareExport = ({
  shipment = [],
  totals = null,
  meta = null,
  company = null,
  products = null,
  freight = null,
} = {}) => {
  const m = meta || {};
  const resolved =
    freight ||
    computeFreight({
      items: shipment,
      totals,
      mode: m.freightMode,
      container: m.containerType,
      customContainer: m.customContainer,
      country: m.destinationCountry,
      carrier: m.carrierProfile,
      overrides: m.ruleOverrides,
    });

  return buildExportContext({ shipment, totals, freight: resolved, meta: m, company, products });
};

/**
 * Export an Excel workbook.
 *
 * @param {object} args - See `prepareExport`.
 * @param {object} [opts] - `{ sheets, filename }`.
 * @returns {Promise<{filename: string, sheets: string[]}>}
 */
export const exportExcel = async (args, opts = {}) => {
  const { exportExcel: run } = await import('./export/excel');
  return run(prepareExport(args), opts);
};

/**
 * Export a CSV of one table.
 *
 * @param {object} args - See `prepareExport`.
 * @param {object} [opts] - `{ table, filename }`.
 * @returns {Promise<{filename: string, table: string, rows: number}>}
 */
export const exportCSV = async (args, opts = {}) => {
  const { exportCSV: run } = await import('./export/csv');
  return run(prepareExport(args), opts);
};

/**
 * Export the PDF document suite.
 *
 * @param {object} args - See `prepareExport`.
 * @param {object} [opts] - `{ documents, combined }`.
 * @returns {Promise<{files: string[], warnings: string[], pages: number}>}
 */
export const exportPDF = async (args, opts = {}) => {
  const { exportPDF: run } = await import('./export/pdf');
  return run(prepareExport(args), opts);
};

/**
 * Export the rows an import rejected, as CSV, with the reason attached.
 *
 * Silent truncation is the failure mode this guards against: telling a user
 * "412 of 500 rows imported" is useless unless they can see exactly which 88
 * were dropped and why, in their own original columns.
 *
 * @param {Array} rejected - Tagged products with status 'skipped'.
 * @returns {Promise<number>} How many rows were written.
 */
export const exportRejectedRows = async (rejected) => {
  const list = (rejected || []).filter(Boolean);
  if (list.length === 0) return 0;

  const Papa = (await import('papaparse')).default;

  /* Union of every original column, so the output mirrors the user's own file
     rather than our normalised field names. */
  const columns = [];
  const seen = new Set();
  for (const p of list) {
    for (const key of Object.keys(p.rawData || {})) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }

  const rows = list.map((p) => {
    const row = {
      'Rejection Reason': p.skipReason || 'Unknown',
      'Reason Detail': p.detail || '',
      'Parsed Name': p.name || '',
    };
    for (const col of columns) {
      row[col] = p.rawData?.[col] ?? '';
    }
    return row;
  });

  const csv = Papa.unparse(rows, { newline: '\r\n' });
  downloadText(`${UTF8_BOM}${csv}`, `rejected_rows_${localDateStamp()}.csv`);
  return rows.length;
};

/**
 * The columns the Product Summary modal shows for a product.
 *
 * A product imported from a file has `rawData` — its original columns, which is
 * what the user recognises. One added by hand has none, so its normalised fields
 * are presented under readable headings instead.
 */
const getDisplayRawData = (product) => {
  if (product?.rawData) return product.rawData;
  return {
    'Product Name': product?.name || null,
    Length: product?.length || null,
    Width: product?.width || null,
    Height: product?.height || null,
    Unit: product?.unit || null,
    'Pack Size': product?.packSize || null,
    'Net Wt': product?.netWeightPerUnit || null,
    'Gross Wt': product?.grossWeightPerShipper || null,
    CBM: product?.cbmPerShipper || null,
  };
};

/**
 * Export the raw imported columns for one product or the whole catalog.
 *
 * Separate from the shipment exports on purpose: this is the directory's own view
 * of what a file contained, not a trade document, and it deliberately does not go
 * through `buildExportContext`.
 *
 * Now async — `xlsx` loads on demand like every other exporter.
 *
 * @param {object|Array<object>} data - One product, or an array for catalog mode.
 * @returns {Promise<{filename: string, rows: number}|null>} Null when there is
 *   nothing to write.
 */
export const exportRawDataExcel = async (data) => {
  const isCatalogMode = Array.isArray(data);
  let rows;

  if (isCatalogMode) {
    if (data.length === 0) return null;

    /* Union of every product's keys, because imported files are ragged: dropping
       columns that only some rows have would lose data the user can see in their
       own file. */
    const allKeys = new Set();
    for (const product of data) {
      for (const key of Object.keys(getDisplayRawData(product))) allKeys.add(key);
    }
    const headers = [...allKeys];

    rows = data.map((product) => {
      const row = { 'Product Name': product?.name ?? '' };
      const rawData = getDisplayRawData(product);
      for (const h of headers) row[h] = rawData[h] ?? '';
      return row;
    });
  } else {
    const rawData = getDisplayRawData(data);
    if (Object.keys(rawData).length === 0) return null;
    const row = { 'Product Name': data?.name ?? '' };
    for (const [k, v] of Object.entries(rawData)) row[k] = v ?? '';
    rows = [row];
  }

  const XLSX = await import('xlsx');
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Raw Data Summary');

  /* Through `exportFileName` so this shares the Windows-safe sanitising and the
     LOCAL date the rest of the layer uses — it previously hand-rolled both, and
     `toISOString()` stamped the wrong day for anyone west of Greenwich. */
  const filename = isCatalogMode
    ? exportFileName('catalog_summary', '', 'xlsx')
    : exportFileName('product_summary', data?.name || 'product', 'xlsx');

  XLSX.writeFile(wb, filename);
  return { filename, rows: rows.length };
};
