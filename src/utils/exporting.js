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
import {
  CONTAINERS,
  FREIGHT_MODES,
  fmtCBM,
  containersNeeded,
} from './calculations';
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
 * Freight / container summary as label-value pairs.
 *
 * Shared by Excel and CSV so the two exports finally agree — `exportCSV` used to
 * omit this block entirely despite the comment claiming column parity.
 */
export const buildSummaryPairs = (totals, containerType, freightMode) => {
  const mode = FREIGHT_MODES[freightMode];
  const cont = CONTAINERS[containerType];
  const cbm = safeNonNegative(totals?.cbm);
  const grossWeight = safeNonNegative(totals?.grossWeight);
  const volumetric = cbm * (mode?.volumetricFactor || 0);
  const chargeable = Math.max(grossWeight, volumetric);

  const pairs = [
    ['Freight Mode', mode?.label || String(freightMode ?? '')],
    ['Volumetric Wt (kg)', raw(volumetric)],
    ['Chargeable Wt (kg)', raw(chargeable)],
  ];

  if (cont) {
    const plan = containersNeeded({ cbm, grossWeight }, containerType);
    pairs.push(
      ['Container', cont.label],
      ['Volume Utilisation (%)', raw((cbm / cont.cbm) * 100)],
      ['Payload Utilisation (%)', raw((grossWeight / cont.maxPayloadKg) * 100)],
      ['Containers Required', plan.count],
      ['Limited By', plan.limitedBy]
    );
  }

  return pairs;
};

/**
 * Export shipment data to an Excel file.
 * @param {Array} shipment - Array of shipment items.
 * @param {object} totals - Computed totals object.
 * @param {string} poNumber - PO / reference number.
 * @param {string} containerType - Container type key (e.g. '40hc').
 * @param {string} freightMode - Key into FREIGHT_MODES.
 */
export const exportExcel = (shipment, totals, poNumber, containerType, freightMode) => {
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
  const pairs = buildSummaryPairs(totals, containerType, freightMode);
  const startRow = rows.length + 2; // one blank row after the table
  XLSX.utils.sheet_add_aoa(ws, [['SHIPMENT SUMMARY']], { origin: `A${startRow}` });
  XLSX.utils.sheet_add_aoa(ws, pairs, { origin: `A${startRow + 1}` });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Shipment');
  XLSX.writeFile(wb, exportFileName('shipment', poNumber, 'xlsx'));
};

/**
 * Export shipment data to a CSV file (same columns as the Excel export).
 *
 * Now genuinely at parity: the freight/container summary is appended as a second
 * block, and the file is prefixed with a UTF-8 BOM so Excel renders non-ASCII
 * product names correctly instead of as mojibake. CRLF line endings match what
 * Excel expects.
 */
export const exportCSV = (shipment, totals, poNumber, containerType, freightMode) => {
  const table = Papa.unparse(buildRows(shipment, totals), { newline: '\r\n' });
  const summary = Papa.unparse(
    [['SHIPMENT SUMMARY'], ...buildSummaryPairs(totals, containerType, freightMode)],
    { newline: '\r\n' }
  );
  const csv = `${table}\r\n\r\n${summary}`;

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

/**
 * Export shipment data to a PDF packing list.
 * @param {Array} shipment - Array of shipment items.
 * @param {object} totals - Computed totals object.
 * @param {string} poNumber - PO / reference number.
 * @param {string} containerType - Container type key (e.g. '40hc').
 * @param {string} freightMode - Key into FREIGHT_MODES.
 */
export const exportPDF = (
  shipment,
  totals,
  poNumber,
  containerType,
  freightMode
) => {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  // Header
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('Packing List / Shipment Summary', 14, 18);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100);
  const mode = FREIGHT_MODES[freightMode];
  let headerY = 26;
  if (poNumber) {
    doc.text(`PO / Reference: ${poNumber}`, 14, headerY);
    headerY += 6;
  }
  doc.text(`Date: ${new Date().toLocaleDateString()}`, 14, headerY);
  headerY += 6;
  doc.text(`Freight Mode: ${mode?.label || freightMode}`, 14, headerY);
  headerY += 5;

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

  const cbm = safeNonNegative(totals?.cbm);
  const grossWeight = safeNonNegative(totals?.grossWeight);
  const volumetric = cbm * (mode?.volumetricFactor || 0);
  const chargeable = Math.max(grossWeight, volumetric);

  ensureSpace(8);
  doc.text(
    `Total CBM: ${fmtCBM(cbm)} m³  |  Net Wt: ${fx(totals?.netWeight)} kg  |  Gross Wt: ${fx(grossWeight)} kg  |  Shippers: ${clampInt(totals?.shippers, 0)}  |  Total Pcs: ${clampInt(totals?.totalPcs, 0).toLocaleString()}`,
    14,
    finalY
  );
  finalY += 6;
  ensureSpace(8);
  doc.text(
    `Volumetric Wt: ${fx(volumetric)} kg  |  Chargeable Wt: ${fx(chargeable)} kg  (${mode?.label || freightMode})`,
    14,
    finalY
  );

  const cont = CONTAINERS[containerType];
  if (cont) {
    finalY += 6;
    ensureSpace(8);
    const volPct = (cbm / cont.cbm) * 100;
    const wtPct = (grossWeight / cont.maxPayloadKg) * 100;
    let line = `Container: ${cont.label}  |  Volume: ${fx(volPct)}%  |  Payload: ${fx(wtPct)}% of ${fx(cont.maxPayloadKg / 1000, 1)} t`;
    const plan = containersNeeded({ cbm, grossWeight }, containerType);
    if (plan.count > 1) {
      line += `  |  REQUIRES ${plan.count} CONTAINERS (limited by ${plan.limitedBy})`;
      doc.setTextColor(220, 38, 38);
    } else if (volPct > 100 || wtPct > 100) {
      doc.setTextColor(220, 38, 38);
    }
    doc.text(line, 14, finalY);
    doc.setTextColor(0);
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
