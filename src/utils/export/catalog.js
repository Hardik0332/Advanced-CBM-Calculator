/**
 * Export option catalogues — pure metadata, no heavy dependencies.
 *
 * This module exists to make the dynamic imports actually work. `ExportModal` needs
 * the list of formats, sheets, tables and documents to render its checkboxes, and
 * it needs that list at first paint. But the lists used to live *inside*
 * `excel.js`, `csv.js` and `pdf/index.js` alongside the renderers, so importing a
 * label statically imported the whole PDF layer — and Rollup rightly warned that
 * the matching `import()` could no longer move anything into its own chunk:
 *
 *     [INEFFECTIVE_DYNAMIC_IMPORT] src/utils/export/pdf/index.js is dynamically
 *     imported ... but also statically imported, dynamic import will not move
 *     module into another chunk
 *
 * So the *description* of each output lives here and the *implementation* stays in
 * the heavy modules, which attach themselves by key. The modal imports this; only a
 * click imports a renderer.
 */

/* ══════════════════════════════════════════════════════════
   Excel sheets
   ══════════════════════════════════════════════════════════ */

/**
 * Which sheets the workbook can carry.
 *
 * `needs` names an export-context flag the sheet requires; `ExportModal` disables
 * the row and says why rather than letting someone export an empty sheet.
 */
export const EXCEL_SHEETS = [
  { key: 'summary', label: 'Summary', default: true, always: true },
  { key: 'packingList', label: 'Packing List', default: true },
  { key: 'itemBreakdown', label: 'Item Breakdown', default: true },
  { key: 'containerPlan', label: 'Container Plan', default: true },
  { key: 'directory', label: 'Product Directory', default: false, needs: 'products' },
  { key: 'rawData', label: 'Raw Import Data', default: false, needs: 'rawData' },
];

/** The default sheet selection, as a `{ key: boolean }` record. */
export const defaultSheetSelection = () =>
  Object.fromEntries(EXCEL_SHEETS.map((s) => [s.key, s.default]));

/* ══════════════════════════════════════════════════════════
   CSV tables
   ══════════════════════════════════════════════════════════ */

/**
 * The tables a user can emit as CSV.
 *
 * CSV holds one rectangle, so cramming every block into one file produces something
 * no tool can parse. `complete` is offered for people who want one file to archive
 * and is explicit about being multi-block rather than pretending to be tabular.
 */
export const CSV_TABLES = [
  {
    key: 'packingList',
    label: 'Packing list',
    hint: 'The document table — one row per line, with totals',
    base: 'packing-list',
  },
  {
    key: 'itemBreakdown',
    label: 'Item breakdown',
    hint: 'Every derived figure — dims in both units, volumetric, per-piece weights',
    base: 'item-breakdown',
  },
  {
    key: 'containerPlan',
    label: 'Container plan',
    hint: 'Containers by volume vs payload, per-container fill, remaining margin',
    base: 'container-plan',
  },
  {
    key: 'workings',
    label: 'Chargeable weight workings',
    hint: 'The derivation behind the billed figure, step by step',
    base: 'chargeable-weight',
  },
  {
    key: 'invoice',
    label: 'Invoice lines',
    hint: 'Priced lines with amounts',
    base: 'invoice-lines',
    needs: 'prices',
  },
  {
    key: 'directory',
    label: 'Product directory',
    hint: 'The saved catalog, not this shipment',
    base: 'directory',
    needs: 'products',
  },
  {
    key: 'complete',
    label: 'Complete shipment (multi-block)',
    hint: 'Every block in one file — archival, not tabular',
    base: 'shipment',
    multiBlock: true,
  },
];

/** The default table, and what a bare "Export CSV" emits. */
export const DEFAULT_CSV_TABLE = 'packingList';

/* ══════════════════════════════════════════════════════════
   PDF documents
   ══════════════════════════════════════════════════════════ */

/**
 * The documents on offer.
 *
 * `orientation` lives with the renderer rather than here, because the packing list
 * decides from its own column count and that needs the column logic.
 */
export const PDF_DOCUMENTS = [
  {
    key: 'packingList',
    label: 'Packing List',
    hint: 'Parties, transport, item table, declaration — the document you send',
    base: 'packing-list',
    default: true,
  },
  {
    key: 'shipmentSummary',
    label: 'Shipment Summary',
    hint: 'Totals, the billed-weight derivation, container plan and fill bars',
    base: 'shipment-summary',
    default: true,
  },
  {
    key: 'commercialInvoice',
    label: 'Commercial Invoice',
    hint: 'Priced lines, charges, amount in words',
    base: 'commercial-invoice',
    default: false,
    needs: 'prices',
  },
];

/** The default document selection, as a `{ key: boolean }` record. */
export const defaultDocumentSelection = () =>
  Object.fromEntries(PDF_DOCUMENTS.map((d) => [d.key, d.default]));

/** Look a catalogue entry up by key. */
export const findByKey = (list, key) => list.find((x) => x.key === key) || null;
