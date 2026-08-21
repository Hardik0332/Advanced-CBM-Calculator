/**
 * Excel export — a multi-sheet workbook.
 *
 * Replaces the single sheet that appended its summary as extra table rows, which
 * put "Volumetric Wt" under the Length column: a number in a dimension column, on
 * a document someone loads a container from.
 *
 * Sheets (the last two optional):
 *   Summary          — company block, trade metadata, totals, chargeable-weight
 *                      workings, container plan headline
 *   Packing List     — the classic document table, frozen header + autofilter
 *   Item Breakdown   — every derived figure, for checking the arithmetic
 *   Container Plan   — per-container fill and the constraint that bound
 *   Directory        — the product catalog
 *   Raw Import Data  — the user's original columns, straight from IndexedDB
 *
 * SheetJS features are applied **defensively**. `!freeze`, `!autofilter`, `!merges`
 * and per-cell `z` formats are all build-dependent, and the app pins SheetJS from
 * a tarball URL rather than a semver range. Every one is wrapped so an unsupported
 * property degrades to a plain-but-correct sheet instead of throwing mid-export and
 * losing the user their document.
 */
import { projectRows, pruneEmptyColumns, PACKING_LIST_COLUMNS, ITEM_BREAKDOWN_COLUMNS } from './rows';
import { exportFileName } from './files';
import { defaultSheetSelection } from './catalog';

/**
 * Attempt a workbook enhancement, ignoring failure.
 *
 * Deliberately swallows: every caller is cosmetic, and a thrown error here would
 * abort an otherwise complete export.
 */
const tryFeature = (fn) => {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
};

/** Column widths from a column set, in SheetJS `!cols` shape. */
const colWidths = (columns) => columns.map((c) => ({ wch: c.width ?? 12 }));

/**
 * Apply per-column number formats to a sheet's data cells.
 *
 * Without this, raw numerics render as Excel's General format: 0.0612 shows as
 * 0.0612 but 1234.5 shows as 1234.5 and a CBM of 0.000061 collapses to 6.1E-05,
 * which is unreadable on a packing list.
 *
 * @param {object} XLSX
 * @param {object} ws
 * @param {Array<object>} columns
 * @param {number} rowCount - Data rows, excluding the header.
 * @param {number} [startRow=1] - 0-based row index of the first data row.
 */
const applyNumberFormats = (XLSX, ws, columns, rowCount, startRow = 1) => {
  tryFeature(() => {
    columns.forEach((c, colIdx) => {
      if (!c.z) return;
      for (let r = 0; r < rowCount; r++) {
        const addr = XLSX.utils.encode_cell({ c: colIdx, r: startRow + r });
        const cell = ws[addr];
        // Only format actual numbers — a '' placeholder in a totals row must stay text.
        if (cell && cell.t === 'n') cell.z = c.z;
      }
    });
  });
};

/** Freeze the header row, so scrolling a 500-line packing list stays legible. */
const freezeHeader = (ws) => {
  tryFeature(() => {
    ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' };
    // Older SheetJS builds read this instead.
    ws['!panes'] = [{ pane: 'bottomLeft', ySplit: 1 }];
  });
};

/** Autofilter across the used range, so a user can sort by CBM without formulas. */
const addAutofilter = (XLSX, ws, columns, rowCount) => {
  tryFeature(() => {
    if (rowCount <= 0) return;
    ws['!autofilter'] = {
      ref: `${XLSX.utils.encode_cell({ c: 0, r: 0 })}:${XLSX.utils.encode_cell({
        c: columns.length - 1,
        r: rowCount,
      })}`,
    };
  });
};

/**
 * Bold the TOTALS row.
 *
 * Cell styling is a SheetJS Pro feature in most builds, so this is best-effort by
 * design: the row is already labelled "TOTALS" and sits last, which carries the
 * meaning even when the bold does not survive.
 */
const boldRow = (XLSX, ws, columns, rowIdx) => {
  tryFeature(() => {
    for (let c = 0; c < columns.length; c++) {
      const cell = ws[XLSX.utils.encode_cell({ c, r: rowIdx })];
      if (cell) cell.s = { ...(cell.s || {}), font: { bold: true } };
    }
  });
};

/**
 * Build one table sheet from records and a column set.
 *
 * @returns {object} A SheetJS worksheet.
 */
const tableSheet = (XLSX, records, columns, { autofilter = true, freeze = true } = {}) => {
  const cols = pruneEmptyColumns(columns, records);
  const rows = projectRows(records, cols);
  const ws = XLSX.utils.json_to_sheet(rows, { header: cols.map((c) => c.label) });

  ws['!cols'] = colWidths(cols);
  applyNumberFormats(XLSX, ws, cols, rows.length);
  if (freeze) freezeHeader(ws);
  if (autofilter) addAutofilter(XLSX, ws, cols, rows.length);
  return ws;
};

/** Label-value pairs as a two-column block, with a heading above. */
const pairsBlock = (heading, pairs) => [[heading], ...pairs.map(([k, v]) => [k, v])];

/**
 * The Summary sheet: layout-heavy, so built with `aoa_to_sheet` rather than
 * `json_to_sheet`. This is the sheet a manager opens first.
 */
const summarySheet = (XLSX, ctx) => {
  const aoa = [];

  const company = ctx.company;
  if (company?.name) {
    aoa.push([company.name]);
    for (const line of [company.address, company.phone, company.email, company.website]) {
      if (line) aoa.push([String(line)]);
    }
    const ids = [
      company.gst && `GST: ${company.gst}`,
      company.iec && `IEC: ${company.iec}`,
      company.cin && `CIN: ${company.cin}`,
    ].filter(Boolean);
    if (ids.length) aoa.push([ids.join('  |  ')]);
    aoa.push([]);
  }

  aoa.push(['SHIPMENT SUMMARY'], []);

  if (ctx.tradePairs.length) aoa.push(...pairsBlock('Shipment Details', ctx.tradePairs), []);
  aoa.push(...pairsBlock('Totals', ctx.totalsPairs), []);
  aoa.push(...pairsBlock('Freight & Container', ctx.freightPairs), []);
  aoa.push(['CHARGEABLE WEIGHT WORKINGS'], ...ctx.workingsAoa);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Wide label column, wide value column: `workings` expressions are sentences.
  ws['!cols'] = [{ wch: 34 }, { wch: 62 }, { wch: 14 }, { wch: 10 }];

  // Merge the company name and section headings across the two columns.
  tryFeature(() => {
    const merges = [];
    aoa.forEach((row, r) => {
      if (row.length === 1 && typeof row[0] === 'string') {
        merges.push({ s: { r, c: 0 }, e: { r, c: 1 } });
      }
    });
    if (merges.length) ws['!merges'] = merges;
  });

  return ws;
};

/** The Container Plan sheet. */
const containerPlanSheet = (XLSX, ctx) => {
  const ws = XLSX.utils.aoa_to_sheet([['CONTAINER PLAN'], [], ...ctx.containerPlanAoa]);
  ws['!cols'] = [{ wch: 34 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 }];
  return ws;
};

/** The product-directory sheet. */
const directorySheet = (XLSX, products) => {
  const rows = (products || [])
    .filter((p) => p && typeof p === 'object')
    .map((p, i) => ({
      '#': i + 1,
      Name: String(p.name ?? ''),
      SKU: p.sku ?? '',
      'HS Code': p.hsCode ?? '',
      Unit: p.unit ?? '',
      L: p.length ?? '',
      W: p.width ?? '',
      H: p.height ?? '',
      'Pack Size': p.packSize ?? '',
      Packing: p.packingString ?? '',
      'Net Wt/Unit (kg)': p.netWeightPerUnit ?? '',
      'Gross Wt/Shipper (kg)': p.grossWeightPerShipper ?? '',
      'CBM/Shipper': p.cbmPerShipper ?? '',
    }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 4 }, { wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 8 }, { wch: 9 },
    { wch: 9 }, { wch: 9 }, { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 20 }, { wch: 13 },
  ];
  freezeHeader(ws);
  return ws;
};

/**
 * The Raw Import Data sheet — the user's own columns, verbatim.
 *
 * The union of every record's keys is used as the header, because imported files
 * are ragged: a row missing a column is normal, and dropping columns that only
 * some rows have would silently lose data the user can see in their own file.
 */
const rawDataSheet = (XLSX, products) => {
  const withRaw = (products || []).filter((p) => p?.rawData && typeof p.rawData === 'object');
  if (withRaw.length === 0) return null;

  const headers = [];
  const seen = new Set();
  for (const p of withRaw) {
    for (const key of Object.keys(p.rawData)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }

  const rows = withRaw.map((p) => {
    const out = { 'Mapped Name': String(p.name ?? '') };
    for (const key of headers) out[key] = p.rawData[key] ?? '';
    return out;
  });

  const ws = XLSX.utils.json_to_sheet(rows, { header: ['Mapped Name', ...headers] });
  ws['!cols'] = [{ wch: 28 }, ...headers.map(() => ({ wch: 16 }))];
  freezeHeader(ws);
  return ws;
};

/**
 * Write the workbook.
 *
 * `xlsx` is imported dynamically: it is ~430 kB of the main bundle and is needed
 * only when a user actually exports.
 *
 * @param {object} ctx - A `buildExportContext` result.
 * @param {object} [opts]
 * @param {object} [opts.sheets] - `{ key: boolean }`; defaults to `EXCEL_SHEETS`.
 * @param {string} [opts.filename]
 * @returns {Promise<{filename: string, sheets: string[]}>}
 */
export const exportExcel = async (ctx, opts = {}) => {
  const XLSX = await import('xlsx');
  const sheets = { ...defaultSheetSelection(), ...(opts.sheets || {}) };
  const wb = XLSX.utils.book_new();
  const written = [];

  const append = (name, ws) => {
    if (!ws) return;
    // Excel caps sheet names at 31 chars and forbids : \ / ? * [ ]
    const safe = name.replace(/[:\\/?*[\]]/g, '-').slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, safe);
    written.push(safe);
  };

  if (sheets.summary) append('Summary', summarySheet(XLSX, ctx));

  if (sheets.packingList) {
    const ws = tableSheet(XLSX, ctx.rows, PACKING_LIST_COLUMNS);
    boldRow(XLSX, ws, PACKING_LIST_COLUMNS, ctx.rows.length); // header + records
    append('Packing List', ws);
  }

  if (sheets.itemBreakdown) {
    append('Item Breakdown', tableSheet(XLSX, ctx.records, ITEM_BREAKDOWN_COLUMNS));
  }

  if (sheets.containerPlan) append('Container Plan', containerPlanSheet(XLSX, ctx));

  if (sheets.directory && ctx.products.length) {
    append('Directory', directorySheet(XLSX, ctx.products));
  }

  if (sheets.rawData) append('Raw Import Data', rawDataSheet(XLSX, ctx.products));

  // A workbook with no sheets is invalid and SheetJS throws on write.
  if (written.length === 0) append('Summary', summarySheet(XLSX, ctx));

  const filename = opts.filename || exportFileName('shipment', ctx.meta?.poNumber, 'xlsx');
  XLSX.writeFile(wb, filename);
  return { filename, sheets: written };
};
