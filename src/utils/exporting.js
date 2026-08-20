/**
 * Export utilities for Excel, CSV and PDF generation.
 *
 * Precision policy: spreadsheet exports (Excel/CSV) always carry the RAW
 * numeric values — rounding is a display concern, never baked into the data.
 * Only the PDF (a purely visual document) uses formatted strings.
 */
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fmtCBM } from './calculations';
import { computeFreight, billedFigure } from './freight';
import { safeNum, safeNonNegative, clampInt, trimFloat } from './numbers';

/** Round only to kill float noise (12 significant-ish decimals), not precision. */
const raw = (v) => trimFloat(v, 9);

/**
 * Fixed-decimal formatter that cannot throw.
 *
 * Every `item.someWeight.toFixed(n)` in this file was a latent crash: a legacy
 * or hand-edited record with a missing numeric field took the whole app down
 * with "toFixed is not a function". Schema normalisation now prevents that on
 * load, but exports also run on data handed straight in, so they defend too.
 */
const fx = (v, decimals = 2) => safeNum(v, 0).toFixed(decimals);

const itemTotalPcs = (item) =>
  clampInt(item?.totalPcs, 0) ||
  clampInt(item?.packSize, 1) * clampInt(item?.quantity, 1);

/** Characters Windows forbids in filenames. */
const UNSAFE_FILENAME = /[/\\:*?"<>|]/g;

/** Local ISO date (YYYY-MM-DD). `toISOString()` is UTC and gives the wrong day. */
const localDateStamp = (d = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Build a download filename that is safe on every OS.
 * A PO like "AB/123" previously produced "shipment_AB/123_….pdf", which browsers
 * mangle or reject on Windows.
 *
 * Exported for tests — the filename and date rules are easy to regress silently.
 */
export const exportFileName = (base, poNumber, ext) => {
  const ref = String(poNumber || '')
    .replace(UNSAFE_FILENAME, '-')
    .replace(/\s+/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 60);
  return `${base}${ref ? `_${ref}` : ''}_${localDateStamp()}.${ext}`;
};

/** Shared row-builder so Excel and CSV always agree. */
export const buildRows = (shipment, totals) => {
  const rows = (shipment || []).map((item, i) => {
    const pcs = itemTotalPcs(item);
    const qty = clampInt(item?.quantity, 1);
    const cbmPerShipper = safeNonNegative(item?.cbmPerShipper);
    const netPerUnit = safeNonNegative(item?.netWeightPerUnit);
    const grossPerShipper = safeNonNegative(item?.grossWeightPerShipper);
    return {
      '#': i + 1,
      'Item Name': String(item?.name ?? ''),
      Packing: String(item?.packingString ?? ''),
      L: raw(item?.length),
      W: raw(item?.width),
      H: raw(item?.height),
      Unit: String(item?.unit ?? ''),
      'Pack Size': clampInt(item?.packSize, 1),
      'Qty (Shippers)': qty,
      'Total Pcs': pcs,
      'Net Wt/Unit (kg)': raw(netPerUnit),
      'Gross Wt/Shipper (kg)': raw(grossPerShipper),
      'CBM/Shipper': raw(cbmPerShipper),
      'Total CBM': raw(cbmPerShipper * qty),
      'Total Net Wt (kg)': raw(netPerUnit * pcs),
      'Total Gross Wt (kg)': raw(grossPerShipper * qty),
    };
  });

  rows.push({
    '#': '',
    'Item Name': 'TOTALS',
    Packing: '',
    L: '',
    W: '',
    H: '',
    Unit: '',
    'Pack Size': '',
    'Qty (Shippers)': raw(totals?.shippers),
    'Total Pcs': raw(totals?.totalPcs),
    'Net Wt/Unit (kg)': '',
    'Gross Wt/Shipper (kg)': '',
    'CBM/Shipper': '',
    'Total CBM': raw(totals?.cbm),
    'Total Net Wt (kg)': raw(totals?.netWeight),
    'Total Gross Wt (kg)': raw(totals?.grossWeight),
  });

  return rows;
};

/**
 * One `computeFreight` call shape, shared by every exporter.
 *
 * Centralised deliberately: the Excel summary, the CSV summary, the workings block
 * and the PDF each need the same freight result, and three of them silently
 * omitting the country/carrier rules would put a different chargeable weight on
 * each document. Adding an argument here reaches all of them at once.
 *
 * @param {object} totals
 * @param {string} containerType
 * @param {string} freightMode
 * @param {{items?: Array, customContainer?: object, country?: string,
 *          carrier?: string, overrides?: object}} [opts]
 * @returns {object} See `computeFreight`.
 */
const freightFor = (totals, containerType, freightMode, opts = {}) =>
  computeFreight({
    items: opts?.items ?? null,
    totals,
    mode: freightMode,
    container: containerType,
    customContainer: opts?.customContainer ?? null,
    country: opts?.country,
    carrier: opts?.carrier,
    overrides: opts?.overrides ?? {},
  });

/**
 * Freight / container summary as label-value pairs.
 *
 * Shared by Excel and CSV so the two exports finally agree — `exportCSV` used to
 * omit this block entirely despite the comment claiming column parity.
 *
 * Every figure comes from `computeFreight`, the same call the UI renders, so an
 * exported chargeable weight can never drift from the one on screen. Pass the
 * shipment items in `opts` to get per-piece volumetric measurement; without them
 * the aggregate CBM is used instead, which is a slightly coarser answer.
 *
 * @param {object} totals
 * @param {string} containerType
 * @param {string} freightMode
 * @param {{items?: Array, customContainer?: object, country?: string,
 *          carrier?: string, overrides?: object}} [opts]
 * @returns {Array<[string, string|number]>}
 */
export const buildSummaryPairs = (totals, containerType, freightMode, opts = {}) => {
  const f = freightFor(totals, containerType, freightMode, opts);

  const pairs = [
    ['Freight Mode', f.modeLabel],
    ['Chargeable Basis', f.basis === 'volumetric' ? 'Volumetric / volume' : 'Gross weight'],
    ['Volumetric Divisor (cm³/kg)', f.volumetricDivisor],
    ['Volumetric Wt (kg)', raw(f.volumetricKg)],
    ['Chargeable Wt (kg)', raw(f.chargeableKg)],
    ['Billed Chargeable Wt (kg)', raw(f.chargeableBilled)],
    ['Rounding Step (kg)', f.roundingStepKg],
  ];

  /* Rule provenance travels with the numbers: a document quoting a 4,000 divisor
     without saying it came from a DHL-UAE tariff is not auditable. */
  pairs.push(
    ['Destination Rules', f.countryLabel],
    ['Carrier Rules', f.carrierLabel],
    ['Divisor Source', f.tariff.divisorSource]
  );

  if (f.revenueTons !== null) {
    pairs.push(
      ['Measurement Ton (m³/RT)', raw(f.measurementTonM3)],
      ['Revenue Tons (RT)', raw(f.revenueTons)],
      ['Billed Revenue Tons (RT)', raw(f.revenueTonsBilled)]
    );
  }

  const plan = f.containerPlan;
  if (plan.applicable) {
    pairs.push(
      ['Container', plan.container.label],
      ['Volume Utilisation (%)', raw(plan.volumeFillPct)],
      ['Payload Utilisation (%)', raw(plan.payloadFillPct)],
      ['Containers Required', plan.count],
      ['Limited By', plan.limitedBy],
      ['Remaining Volume (m³)', raw(plan.remainingCbm)],
      ['Remaining Payload (kg)', raw(plan.remainingPayloadKg)],
      ['Payload Cap (kg)', raw(plan.payloadCapKg)],
      ['Payload Cap Source', plan.payloadCapSource]
    );
    /* Both figures, never just the smaller one — the reader needs to see that the
       ISO rating was considered and overruled, and by how much. */
    if (plan.payloadCapSource === 'road') {
      pairs.push(
        ['ISO Payload Rating (kg)', raw(plan.isoPayloadKg)],
        ['Payload Lost to Road Law (kg)', raw(plan.payloadDerateKg)]
      );
    }
  } else {
    pairs.push(['Container', 'None (LCL / loose cargo)']);
  }

  return pairs;
};

/**
 * The `workings[]` derivation as spreadsheet rows.
 *
 * This is the Phase 2 payoff in export form: every billed number is accompanied
 * by the expression that produced it, so a customer or auditor can re-derive it
 * without access to the app.
 *
 * @param {object} totals
 * @param {string} containerType
 * @param {string} freightMode
 * @param {{items?: Array, customContainer?: object, country?: string,
 *          carrier?: string, overrides?: object}} [opts]
 * @returns {Array<Array<string|number>>} Header row followed by one row per step.
 */
export const buildWorkingsRows = (totals, containerType, freightMode, opts = {}) => {
  const f = freightFor(totals, containerType, freightMode, opts);

  const rows = [['Step', 'How it is derived', 'Value', 'Unit']];
  for (const w of f.workings) {
    rows.push([w.label, w.expression, raw(w.value), w.unit]);
  }
  for (const note of f.notes) {
    rows.push(['Note', note, '', '']);
  }
  return rows;
};

/**
 * Export shipment data to an Excel file.
 * @param {Array} shipment - Array of shipment items.
 * @param {object} totals - Computed totals object.
 * @param {string} poNumber - PO / reference number.
 * @param {string} containerType - Container selection key ('40hc', 'custom', 'none').
 * @param {string} freightMode - Key into FREIGHT_MODES.
 * @param {{customContainer?: object, country?: string, carrier?: string,
 *          overrides?: object}} [opts] - User-entered container capacity plus the
 *   destination/carrier rule selections, so the document quotes the same
 *   chargeable weight and payload cap the user saw on screen.
 */
export const exportExcel = (
  shipment,
  totals,
  poNumber,
  containerType,
  freightMode,
  opts = {}
) => {
  const rows = buildRows(shipment, totals);
  const ws = XLSX.utils.json_to_sheet(rows);

  ws['!cols'] = [
    { wch: 4 }, { wch: 28 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
    { wch: 6 }, { wch: 9 }, { wch: 13 }, { wch: 10 }, { wch: 15 }, { wch: 19 },
    { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 18 },
  ];

  /* Summary block appended below the table.
     Previously these rows were pushed through `json_to_sheet` with the value in
     the `L` key, so "Volumetric Wt" landed under the Length column — a number in
     a dimension column, which is actively misleading. Writing the pairs directly
     into column A/B after the table puts each label beside its own value. */
  const freightOpts = {
    items: shipment,
    customContainer: opts?.customContainer,
    country: opts?.country,
    carrier: opts?.carrier,
    overrides: opts?.overrides,
  };
  const pairs = buildSummaryPairs(totals, containerType, freightMode, freightOpts);
  const startRow = rows.length + 2; // one blank row after the table
  XLSX.utils.sheet_add_aoa(ws, [['SHIPMENT SUMMARY']], { origin: `A${startRow}` });
  XLSX.utils.sheet_add_aoa(ws, pairs, { origin: `A${startRow + 1}` });

  /* The derivation trail, so the chargeable weight above can be re-checked by
     hand from this same file rather than taken on trust. */
  const workings = buildWorkingsRows(totals, containerType, freightMode, freightOpts);
  const workingsRow = startRow + pairs.length + 2;
  XLSX.utils.sheet_add_aoa(ws, [['CHARGEABLE WEIGHT WORKINGS']], {
    origin: `A${workingsRow}`,
  });
  XLSX.utils.sheet_add_aoa(ws, workings, { origin: `A${workingsRow + 1}` });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Shipment');
  XLSX.writeFile(wb, exportFileName('shipment', poNumber, 'xlsx'));
};

/**
 * Export shipment data to a CSV file (same columns as the Excel export).
 *
 * Now genuinely at parity: the freight/container summary and the chargeable-weight
 * workings are appended as further blocks, and the file is prefixed with a UTF-8
 * BOM so Excel renders non-ASCII product names correctly instead of as mojibake.
 * CRLF line endings match what Excel expects.
 */
export const exportCSV = (
  shipment,
  totals,
  poNumber,
  containerType,
  freightMode,
  opts = {}
) => {
  const freightOpts = {
    items: shipment,
    customContainer: opts?.customContainer,
    country: opts?.country,
    carrier: opts?.carrier,
    overrides: opts?.overrides,
  };
  const table = Papa.unparse(buildRows(shipment, totals), { newline: '\r\n' });
  const summary = Papa.unparse(
    [
      ['SHIPMENT SUMMARY'],
      ...buildSummaryPairs(totals, containerType, freightMode, freightOpts),
    ],
    { newline: '\r\n' }
  );
  const workings = Papa.unparse(
    [
      ['CHARGEABLE WEIGHT WORKINGS'],
      ...buildWorkingsRows(totals, containerType, freightMode, freightOpts),
    ],
    { newline: '\r\n' }
  );
  const csv = `${table}\r\n\r\n${summary}\r\n\r\n${workings}`;

  // \uFEFF is the UTF-8 BOM; without it Excel assumes the system codepage
  // and renders non-ASCII product names as mojibake.
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFileName('shipment', poNumber, 'csv');
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/** Trigger a browser download for a text blob. */
const downloadText = (text, filename, mime = 'text/csv;charset=utf-8;') => {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

/**
 * Export the rows an import rejected, as CSV, with the reason attached.
 *
 * Silent truncation is the failure mode this guards against: telling a user
 * "412 of 500 rows imported" is useless unless they can see exactly which 88
 * were dropped and why, in their own original columns.
 *
 * @param {Array} rejected - Tagged products with status 'skipped'.
 * @returns {number} How many rows were written.
 */
export const exportRejectedRows = (rejected) => {
  const list = (rejected || []).filter(Boolean);
  if (list.length === 0) return 0;

  /* Union of every original column, so the output mirrors the user's own file
     rather than our normalised field names. */
  const columns = [];
  const seen = new Set();
  for (const p of list) {
    for (const key of Object.keys(p.rawData || {})) {
      if (!seen.has(key)) { seen.add(key); columns.push(key); }
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
  downloadText(`\uFEFF${csv}`, `rejected_rows_${localDateStamp()}.csv`);
  return rows.length;
};

/**
 * Export shipment data to a PDF packing list.
 * @param {Array} shipment - Array of shipment items.
 * @param {object} totals - Computed totals object.
 * @param {string} poNumber - PO / reference number.
 * @param {string} containerType - Container selection key ('40hc', 'custom', 'none').
 * @param {string} freightMode - Key into FREIGHT_MODES.
 * @param {{customContainer?: object, country?: string, carrier?: string,
 *          overrides?: object}} [opts] - User-entered container capacity plus the
 *   destination/carrier rule selections, so the document quotes the same
 *   chargeable weight and payload cap the user saw on screen.
 */
export const exportPDF = (
  shipment,
  totals,
  poNumber,
  containerType,
  freightMode,
  opts = {}
) => {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  /* One computation for the whole document — the same one the UI renders — so the
     PDF can quote both the billed figure and the derivation behind it. */
  const freight = freightFor(totals, containerType, freightMode, {
    items: shipment,
    customContainer: opts?.customContainer,
    country: opts?.country,
    carrier: opts?.carrier,
    overrides: opts?.overrides,
  });

  // Header
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('Packing List / Shipment Summary', 14, 18);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  let headerY = 26;
  if (poNumber) {
    doc.text(`PO / Reference: ${poNumber}`, 14, headerY);
    headerY += 6;
  }
  doc.text(`Date: ${new Date().toLocaleDateString()}`, 14, headerY);
  headerY += 6;
  doc.text(`Freight Mode: ${freight.modeLabel}`, 14, headerY);
  headerY += 5;
  /* Only printed when a rule profile actually applied — an untouched shipment's
     letterhead stays exactly as it was. */
  if (!freight.rulesAreDefault) {
    doc.text(
      `Rules: ${freight.countryLabel}  |  ${freight.carrierLabel}`,
      14,
      headerY
    );
    headerY += 5;
  }

  // Table
  const tableData = (shipment || []).map((item, i) => {
    const qty = clampInt(item?.quantity, 1);
    const cbmPerShipper = safeNonNegative(item?.cbmPerShipper);
    const grossPerShipper = safeNonNegative(item?.grossWeightPerShipper);
    const hasDims =
      safeNonNegative(item?.length) ||
      safeNonNegative(item?.width) ||
      safeNonNegative(item?.height);
    return [
      i + 1,
      String(item?.name ?? '') + (item?.packingString ? `\n(${item.packingString})` : ''),
      hasDims
        ? `${raw(item?.length)}×${raw(item?.width)}×${raw(item?.height)} ${item?.unit ?? ''}`
        : 'pre-calc',
      clampInt(item?.packSize, 1),
      qty,
      itemTotalPcs(item),
      // fx() instead of .toFixed() — a record missing these fields used to throw.
      fx(item?.netWeightPerUnit, 3),
      fx(grossPerShipper, 2),
      fmtCBM(cbmPerShipper),
      fmtCBM(cbmPerShipper * qty),
      fx(grossPerShipper * qty, 2),
    ];
  });

  // jspdf-autotable v5: functional API — doc.autoTable() no longer exists.
  autoTable(doc, {
    startY: headerY,
    head: [
      [
        '#',
        'Item',
        'Dims',
        'Pack',
        'Qty',
        'Total Pcs',
        'Net Wt/Unit',
        'Gross Wt/Ship',
        'CBM/Ship',
        'Total CBM',
        'Total Wt (kg)',
      ],
    ],
    body: tableData,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: {
      fillColor: [99, 102, 241],
      textColor: 255,
      fontStyle: 'bold',
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    theme: 'grid',
  });

  // Summary footer
  let finalY = (doc.lastAutoTable?.finalY || headerY) + 8;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0);

  const pageHeight = doc.internal.pageSize.getHeight();
  const marginBottom = 14;
  /* When the table ends near the bottom of a page these lines previously rendered
     off the paper entirely. Start a new page instead of drawing into the void. */
  const ensureSpace = (needed) => {
    if (finalY + needed > pageHeight - marginBottom) {
      doc.addPage();
      finalY = 20;
    }
  };

  const cbm = freight.cbm;
  const grossWeight = freight.grossKg;
  const billed = billedFigure(freight);

  ensureSpace(8);
  doc.text(
    `Total CBM: ${fmtCBM(cbm)} m³  |  Net Wt: ${fx(totals?.netWeight)} kg  |  Gross Wt: ${fx(grossWeight)} kg  |  Shippers: ${clampInt(totals?.shippers, 0)}  |  Total Pcs: ${clampInt(totals?.totalPcs, 0).toLocaleString()}`,
    14,
    finalY
  );
  finalY += 6;
  ensureSpace(8);
  doc.text(
    `Volumetric Wt: ${fx(freight.volumetricKg)} kg  |  Chargeable Wt: ${fx(freight.chargeableKg)} kg  |  BILLED: ${billed.display}  (${freight.modeLabel})`,
    14,
    finalY
  );

  const plan = freight.containerPlan;
  if (plan.applicable) {
    finalY += 6;
    ensureSpace(8);
    const cont = plan.container;
    let line = `Container: ${cont.label}  |  Volume: ${fx(plan.volumeFillPct)}%  |  Payload: ${fx(plan.payloadFillPct)}% of ${fx(plan.payloadCapKg / 1000, 1)} t`;
    if (plan.count > 1) {
      line += `  |  REQUIRES ${plan.count} CONTAINERS (limited by ${plan.limitedBy})`;
      doc.setTextColor(220, 38, 38);
    } else if (plan.volumeFillPct > 100 || plan.payloadFillPct > 100) {
      doc.setTextColor(220, 38, 38);
    }
    doc.text(line, 14, finalY);
    doc.setTextColor(0);

    /* The governing-limit statement, printed on the document rather than only shown
       on screen. Whoever loads the container is not the person who selected the
       destination, and this is the line that stops them loading to the plate. */
    if (plan.payloadCapSource === 'road') {
      finalY += 5;
      ensureSpace(8);
      doc.setTextColor(180, 83, 9);
      doc.setFontSize(8.5);
      const capLines = doc.splitTextToSize(
        `GOVERNING LIMIT — road law: payload capped at ${fx(plan.payloadCapKg, 0)} kg by ` +
          `${freight.countryLabel}, not the ${fx(plan.isoPayloadKg, 0)} kg ISO rating ` +
          `(${fx(plan.payloadDerateKg, 0)} kg less cargo per container).`,
        doc.internal.pageSize.getWidth() - 28
      );
      doc.text(capLines, 14, finalY);
      finalY += (capLines.length - 1) * 4;
      doc.setFontSize(9);
      doc.setTextColor(0);
    }
  }

  /* Chargeable-weight workings.
     The whole point of Phase 2: whoever receives this document can re-derive the
     billed figure from the printed arithmetic instead of taking it on trust. */
  if (freight.workings.length > 0) {
    finalY += 10;
    ensureSpace(14);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('How the chargeable weight was derived', 14, finalY);
    finalY += 2;

    autoTable(doc, {
      startY: finalY,
      head: [['Step', 'Derivation', 'Value']],
      body: freight.workings.map((w) => [w.label, w.expression, w.display]),
      styles: { fontSize: 7.5, cellPadding: 1.5 },
      headStyles: { fillColor: [13, 125, 110], textColor: 255, fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 52, fontStyle: 'bold' },
        2: { cellWidth: 38, halign: 'right' },
      },
      theme: 'grid',
      margin: { left: 14, right: 14 },
    });
    finalY = (doc.lastAutoTable?.finalY || finalY) + 6;

    /* Sourcing caveats printed rather than hidden — two of the figures above are
       industry practice we could not verify from a primary source, and a document
       that implies otherwise is worse than one that says so. */
    if (freight.notes.length > 0) {
      doc.setFontSize(7);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(110);
      const pageWidth = doc.internal.pageSize.getWidth();
      for (const note of freight.notes) {
        const lines = doc.splitTextToSize(`• ${note}`, pageWidth - 28);
        ensureSpace(lines.length * 3.2 + 2);
        doc.text(lines, 14, finalY);
        finalY += lines.length * 3.2 + 1;
      }
      doc.setTextColor(0);
    }
  }

  doc.save(exportFileName('shipment', poNumber, 'pdf'));
};

const getDisplayRawData = (product) => {
  if (product.rawData) return product.rawData;
  return {
    'Product Name': product.name || null,
    'Length': product.length || null,
    'Width': product.width || null,
    'Height': product.height || null,
    'Unit': product.unit || null,
    'Pack Size': product.packSize || null,
    'Net Wt': product.netWeightPerUnit || null,
    'Gross Wt': product.grossWeightPerShipper || null,
    'CBM': product.cbmPerShipper || null,
  };
};

/**
 * Export raw product data to an Excel file.
 * Values are written as-is (raw) — no display rounding.
 * @param {Array|object} data - Either an array of products (catalog mode) or a single product (single mode).
 */
export const exportRawDataExcel = (data) => {
  const isCatalogMode = Array.isArray(data);
  let rows;

  if (isCatalogMode) {
    if (data.length === 0) return;

    // Extract all unique keys across all rawData objects
    const allKeys = new Set();
    data.forEach((product) => {
      const rawData = getDisplayRawData(product);
      Object.keys(rawData).forEach((key) => allKeys.add(key));
    });

    const headers = Array.from(allKeys);

    rows = data.map((product) => {
      const row = { 'Product Name': product.name };
      const rawData = getDisplayRawData(product);
      headers.forEach((h) => {
        row[h] = rawData[h] !== null && rawData[h] !== undefined ? rawData[h] : '';
      });
      return row;
    });
  } else {
    // Single mode
    const rawData = getDisplayRawData(data);
    if (Object.keys(rawData).length === 0) return;
    const row = { 'Product Name': data.name };
    Object.entries(rawData).forEach(([k, v]) => {
      row[k] = v !== null && v !== undefined ? v : '';
    });
    rows = [row];
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Raw Data Summary');

  const fileName = isCatalogMode
    ? `catalog_summary_${new Date().toISOString().slice(0, 10)}.xlsx`
    : `product_summary_${(data.name || 'product').replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().slice(0, 10)}.xlsx`;

  XLSX.writeFile(wb, fileName);
};
