/**
 * Export utilities for Excel and PDF generation.
 */
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { CONTAINERS } from './calculations';

// Adaptive CBM formatter — prevents 0.00 for small pharmaceutical/medical items.
// Uses more decimal places only when the value is too small for 2dp to be meaningful.
const fmtCBM = (v) => {
  if (!v || v === 0) return '0.0000';
  if (v < 0.0001) return v.toFixed(6);
  if (v < 0.01)   return v.toFixed(4);
  return v.toFixed(2);
};

/**
 * Export shipment data to an Excel file.
 * @param {Array} shipment - Array of shipment items.
 * @param {object} totals - Computed totals object.
 * @param {string} poNumber - PO / reference number.
 */
export const exportExcel = (shipment, totals, poNumber) => {
  const rows = shipment.map((item, i) => ({
    '#': i + 1,
    'Item Name': item.name,
    L: +item.length.toFixed(2),
    W: +item.width.toFixed(2),
    H: +item.height.toFixed(2),
    Unit: item.unit,
    'Pack Size': item.packSize,
    'Qty (Shippers)': item.quantity,
    'Net Wt/Unit (kg)': +item.netWeightPerUnit.toFixed(2),
    'Gross Wt/Shipper (kg)': +item.grossWeightPerShipper.toFixed(2),
    'CBM/Shipper': +fmtCBM(item.cbmPerShipper),
    'Total CBM': +fmtCBM(item.cbmPerShipper * item.quantity),
    'Total Gross Wt (kg)': +(
      item.grossWeightPerShipper * item.quantity
    ).toFixed(2),
  }));

  // Totals row
  rows.push({
    '#': '',
    'Item Name': 'TOTALS',
    L: '',
    W: '',
    H: '',
    Unit: '',
    'Pack Size': '',
    'Qty (Shippers)': totals.shippers,
    'Net Wt/Unit (kg)': '',
    'Gross Wt/Shipper (kg)': '',
    'CBM/Shipper': '',
    'Total CBM': +fmtCBM(totals.cbm),
    'Total Gross Wt (kg)': +totals.grossWeight.toFixed(2),
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Shipment');
  XLSX.writeFile(
    wb,
    `shipment${poNumber ? '_' + poNumber.replace(/\s+/g, '_') : ''}_${new Date().toISOString().slice(0, 10)}.xlsx`
  );
};

/**
 * Export shipment data to a PDF file.
 * @param {Array} shipment - Array of shipment items.
 * @param {object} totals - Computed totals object.
 * @param {string} poNumber - PO / reference number.
 * @param {string} containerType - Container type key (e.g. '40hc').
 * @param {string} freightMode - 'ocean' or 'air'.
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
  if (poNumber) doc.text(`PO / Reference: ${poNumber}`, 14, 26);
  doc.text(
    `Date: ${new Date().toLocaleDateString()}`,
    14,
    poNumber ? 32 : 26
  );
  doc.text(
    `Freight Mode: ${freightMode === 'air' ? 'Air' : 'Ocean'}`,
    14,
    poNumber ? 38 : 32
  );

  // Table
  const tableData = shipment.map((item, i) => [
    i + 1,
    item.name,
    item.length || item.width || item.height
      ? `${item.length}×${item.width}×${item.height}`
      : 'pre-calc',
    item.unit,
    item.packSize,
    item.quantity,
    item.netWeightPerUnit.toFixed(2),
    item.grossWeightPerShipper.toFixed(2),
    fmtCBM(item.cbmPerShipper),
    fmtCBM(item.cbmPerShipper * item.quantity),
    (item.grossWeightPerShipper * item.quantity).toFixed(2),
  ]);

  doc.autoTable({
    startY: poNumber ? 43 : 37,
    head: [
      [
        '#',
        'Item',
        'Dims',
        'Unit',
        'Pack',
        'Qty',
        'Net Wt/Unit',
        'Gross Wt/Ship',
        'CBM/Ship',
        'Total CBM',
        'Total Wt',
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
  const finalY = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(0);
  const cont = CONTAINERS[containerType];
  const pct = cont
    ? Math.min(100, (totals.cbm / cont.cbm) * 100).toFixed(2)
    : '—';
  doc.text(
    `Total CBM: ${fmtCBM(totals.cbm)} m³  |  Gross Weight: ${totals.grossWeight.toFixed(2)} kg  |  Shippers: ${totals.shippers}  |  Container: ${cont ? cont.label : '—'} (${pct}%)`,
    14,
    finalY
  );

  doc.save(
    `shipment${poNumber ? '_' + poNumber.replace(/\s+/g, '_') : ''}_${new Date().toISOString().slice(0, 10)}.pdf`
  );
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

const formatValue = (v) => {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  if (typeof v === 'string' && !isNaN(v) && v.trim() !== '') {
    const num = Number(v);
    if (!Number.isInteger(num)) {
      return num.toFixed(2);
    }
  }
  return String(v);
};

/**
 * Export raw product data to an Excel file.
 * @param {Array|object} data - Either an array of products (catalog mode) or a single product (single mode).
 */
export const exportRawDataExcel = (data) => {
  const isCatalogMode = Array.isArray(data);
  let rows = [];

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
      headers.forEach(h => {
        row[h] = rawData[h] !== null && rawData[h] !== undefined ? formatValue(rawData[h]) : '';
      });
      return row;
    });

  } else {
    // Single mode
    const rawData = getDisplayRawData(data);
    if (Object.keys(rawData).length === 0) return;
    const row = { 'Product Name': data.name };
    Object.entries(rawData).forEach(([k, v]) => {
      row[k] = v !== null && v !== undefined ? formatValue(v) : '';
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
