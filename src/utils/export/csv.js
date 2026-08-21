/**
 * CSV export.
 *
 * The original CSV was a lossy subset: the same item table as Excel, minus the
 * freight and container block, despite a comment claiming parity. Rather than
 * cramming every block into one file — which produces a CSV with three different
 * column counts, unreadable by any tool that expects a rectangle — the user now
 * picks **which table** to emit.
 *
 * "Complete shipment" remains available for people who want one file to archive,
 * and is explicit about being multi-block rather than pretending to be tabular.
 *
 * Excel-safety, both previously missing: a UTF-8 BOM so non-ASCII product names
 * are not mojibaked, and CRLF line endings.
 */
import {
  projectAoa,
  pruneEmptyColumns,
  PACKING_LIST_COLUMNS,
  ITEM_BREAKDOWN_COLUMNS,
  INVOICE_COLUMNS,
} from './rows';
import { exportFileName, downloadText, UTF8_BOM } from './files';
import { CSV_TABLES, DEFAULT_CSV_TABLE, findByKey } from './catalog';

/**
 * How each catalogued table is built.
 *
 * Keyed off `catalog.js` rather than redeclaring the list: the labels a user picks
 * from must be importable without dragging Papa Parse and this module into the
 * entry chunk, so the description and the implementation live apart and join here.
 *
 * A null return means "nothing to write", which the caller reports rather than
 * downloading an empty file.
 */
const BUILDERS = {
  packingList: (ctx) => projectAoa(ctx.rows, pruneEmptyColumns(PACKING_LIST_COLUMNS, ctx.rows)),
  itemBreakdown: (ctx) =>
    projectAoa(ctx.records, pruneEmptyColumns(ITEM_BREAKDOWN_COLUMNS, ctx.records)),
  containerPlan: (ctx) => ctx.containerPlanAoa,
  workings: (ctx) => ctx.workingsAoa,
  invoice: (ctx) =>
    ctx.hasPrices
      ? projectAoa(ctx.records, pruneEmptyColumns(INVOICE_COLUMNS, ctx.records))
      : null,
  directory: (ctx) =>
    ctx.products.length
      ? [
          ['#', 'Name', 'SKU', 'HS Code', 'Unit', 'L', 'W', 'H', 'Pack Size', 'Packing',
            'Net Wt/Unit (kg)', 'Gross Wt/Shipper (kg)', 'CBM/Shipper'],
          ...ctx.products.map((p, i) => [
            i + 1,
            String(p?.name ?? ''),
            p?.sku ?? '',
            p?.hsCode ?? '',
            p?.unit ?? '',
            p?.length ?? '',
            p?.width ?? '',
            p?.height ?? '',
            p?.packSize ?? '',
            p?.packingString ?? '',
            p?.netWeightPerUnit ?? '',
            p?.grossWeightPerShipper ?? '',
            p?.cbmPerShipper ?? '',
          ]),
        ]
      : null,
  // `complete` is handled specially below: blocks are joined, not concatenated.
  complete: () => null,
};

/**
 * Blocks for the multi-block file, each with its own heading.
 *
 * Kept separate from `CSV_TABLES` so a heading row is never mistaken for a data
 * row by a parser reading a single-table export.
 */
const completeBlocks = (ctx) => {
  const blocks = [
    ['PACKING LIST', projectAoa(ctx.rows, pruneEmptyColumns(PACKING_LIST_COLUMNS, ctx.rows))],
    ['SHIPMENT DETAILS', ctx.tradePairs.length ? ctx.tradePairs : null],
    ['TOTALS', ctx.totalsPairs],
    ['FREIGHT & CONTAINER', ctx.freightPairs],
    ['CHARGEABLE WEIGHT WORKINGS', ctx.workingsAoa],
    ['CONTAINER PLAN', ctx.containerPlanAoa],
    [
      'ITEM BREAKDOWN',
      projectAoa(ctx.records, pruneEmptyColumns(ITEM_BREAKDOWN_COLUMNS, ctx.records)),
    ],
  ];
  if (ctx.hasPrices) {
    blocks.push([
      'INVOICE LINES',
      projectAoa(ctx.records, pruneEmptyColumns(INVOICE_COLUMNS, ctx.records)),
    ]);
  }
  return blocks.filter(([, rows]) => rows && rows.length);
};

/**
 * Serialise one table to CSV text.
 *
 * `Papa` is imported dynamically — it is only needed at export time.
 *
 * @param {Array<Array<*>>} aoa
 * @returns {Promise<string>}
 */
const unparse = async (aoa) => {
  const Papa = (await import('papaparse')).default;
  return Papa.unparse(aoa, { newline: '\r\n' });
};

/**
 * Export a CSV.
 *
 * @param {object} ctx - A `buildExportContext` result.
 * @param {object} [opts]
 * @param {string} [opts.table='packingList'] - A `CSV_TABLES` key.
 * @param {string} [opts.filename]
 * @returns {Promise<{filename: string, table: string, rows: number}>}
 * @throws {Error} When the chosen table has nothing to write — the caller turns
 *   that into a notice, because a silently-downloaded empty file is worse.
 */
export const exportCSV = async (ctx, opts = {}) => {
  const key = opts.table || DEFAULT_CSV_TABLE;
  const spec = findByKey(CSV_TABLES, key) || CSV_TABLES[0];

  let text;
  let rowCount;

  if (spec.multiBlock) {
    const blocks = completeBlocks(ctx);
    const parts = [];
    rowCount = 0;
    for (const [heading, rows] of blocks) {
      parts.push(await unparse([[heading], ...rows]));
      rowCount += rows.length;
    }
    text = parts.join('\r\n\r\n');
  } else {
    const aoa = BUILDERS[spec.key]?.(ctx);
    if (!aoa || aoa.length <= 1) {
      throw new Error(
        key === 'invoice'
          ? 'No priced lines to export — add unit prices to the shipment items first.'
          : `Nothing to export for "${spec.label}".`
      );
    }
    text = await unparse(aoa);
    rowCount = aoa.length - 1;
  }

  const filename = opts.filename || exportFileName(spec.base, ctx.meta?.poNumber, 'csv');
  downloadText(`${UTF8_BOM}${text}`, filename);
  return { filename, table: spec.key, rows: rowCount };
};
