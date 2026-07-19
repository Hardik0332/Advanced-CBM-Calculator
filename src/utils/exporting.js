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

/** Round only to kill float noise (12 significant-ish decimals), not precision. */
const raw = (v) => {
  const n = Number(v) || 0;
  return Math.round(n * 1e9) / 1e9;
};

const itemTotalPcs = (item) =>
  item.totalPcs || (item.packSize || 1) * (item.quantity || 1);

const exportFileName = (base, poNumber, ext) =>
  `${base}${poNumber ? '_' + poNumber.replace(/\s+/g, '_') : ''}_${new Date()
    .toISOString()
    .slice(0, 10)}.${ext}`;

/** Shared row-builder so Excel and CSV always agree. */
const buildRows = (shipment, totals) => {
  const rows = shipment.map((item, i) => ({
    '#': i + 1,
    'Item Name': item.name,
    Packing: item.packingString || '',
    L: raw(item.length),
    W: raw(item.width),
    H: raw(item.height),
    Unit: item.unit,
    'Pack Size': raw(item.packSize),
    'Qty (Shippers)': raw(item.quantity),
    'Total Pcs': raw(itemTotalPcs(item)),
    'Net Wt/Unit (kg)': raw(item.netWeightPerUnit),
    'Gross Wt/Shipper (kg)': raw(item.grossWeightPerShipper),
    'CBM/Shipper': raw(item.cbmPerShipper),
    'Total CBM': raw(item.cbmPerShipper * item.quantity),
    'Total Net Wt (kg)': raw(item.netWeightPerUnit * itemTotalPcs(item)),
    'Total Gross Wt (kg)': raw(item.grossWeightPerShipper * item.quantity),
  }));

  rows.push({
    '#': '',
    'Item Name': 'TOTALS',
    Packing: '',
    L: '',
    W: '',
    H: '',
    Unit: '',
    'Pack Size': '',
    'Qty (Shippers)': raw(totals.shippers),
    'Total Pcs': raw(totals.totalPcs),
    'Net Wt/Unit (kg)': '',
    'Gross Wt/Shipper (kg)': '',
    'CBM/Shipper': '',
    'Total CBM': raw(totals.cbm),
    'Total Net Wt (kg)': raw(totals.netWeight),
    'Total Gross Wt (kg)': raw(totals.grossWeight),
  });

  return rows;
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

  // Freight/container summary appended below the table
  const mode = FREIGHT_MODES[freightMode];
  const cont = CONTAINERS[containerType];
  const volumetric = totals.cbm * (mode?.volumetricFactor || 0);
  const chargeable = Math.max(totals.grossWeight, volumetric);
  rows.push({});
  rows.push({ '#': '', 'Item Name': `Freight Mode: ${mode?.label || freightMode}` });
  rows.push({ '#': '', 'Item Name': 'Volumetric Wt (kg)', L: raw(volumetric) });
  rows.push({ '#': '', 'Item Name': 'Chargeable Wt (kg)', L: raw(chargeable) });
  if (cont) {
    rows.push({
      '#': '',
      'Item Name': `Container: ${cont.label}`,
      L: `${((totals.cbm / cont.cbm) * 100).toFixed(2)}% volume`,
      W: `${((totals.grossWeight / cont.maxPayloadKg) * 100).toFixed(2)}% payload`,
    });
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 4 }, { wch: 28 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 8 },
    { wch: 6 }, { wch: 9 }, { wch: 13 }, { wch: 10 }, { wch: 15 }, { wch: 19 },
    { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 18 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Shipment');
  XLSX.writeFile(wb, exportFileName('shipment', poNumber, 'xlsx'));
};

/**
 * Export shipment data to a CSV file (same columns as the Excel export).
 */
export const exportCSV = (shipment, totals, poNumber) => {
  const csv = Papa.unparse(buildRows(shipment, totals));
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
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
  const tableData = shipment.map((item, i) => [
    i + 1,
    item.name + (item.packingString ? `\n(${item.packingString})` : ''),
    item.length || item.width || item.height
      ? `${item.length}×${item.width}×${item.height} ${item.unit}`
      : 'pre-calc',
    item.packSize,
    item.quantity,
    itemTotalPcs(item),
    item.netWeightPerUnit.toFixed(3),
    item.grossWeightPerShipper.toFixed(2),
    fmtCBM(item.cbmPerShipper),
    fmtCBM(item.cbmPerShipper * item.quantity),
    (item.grossWeightPerShipper * item.quantity).toFixed(2),
  ]);

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

  const volumetric = totals.cbm * (mode?.volumetricFactor || 0);
  const chargeable = Math.max(totals.grossWeight, volumetric);
  doc.text(
    `Total CBM: ${fmtCBM(totals.cbm)} m³  |  Net Wt: ${totals.netWeight.toFixed(2)} kg  |  Gross Wt: ${totals.grossWeight.toFixed(2)} kg  |  Shippers: ${totals.shippers}  |  Total Pcs: ${totals.totalPcs.toLocaleString()}`,
    14,
    finalY
  );
  finalY += 6;
  doc.text(
    `Volumetric Wt: ${volumetric.toFixed(2)} kg  |  Chargeable Wt: ${chargeable.toFixed(2)} kg  (${mode?.label || freightMode})`,
    14,
    finalY
  );

  const cont = CONTAINERS[containerType];
  if (cont) {
    finalY += 6;
    const volPct = (totals.cbm / cont.cbm) * 100;
    const wtPct = (totals.grossWeight / cont.maxPayloadKg) * 100;
    let line = `Container: ${cont.label}  |  Volume: ${volPct.toFixed(2)}%  |  Payload: ${wtPct.toFixed(2)}% of ${(cont.maxPayloadKg / 1000).toFixed(1)} t`;
    const plan = containersNeeded(totals, containerType);
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
