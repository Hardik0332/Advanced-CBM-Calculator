/**
 * Export utilities for Excel and PDF generation.
 */
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { CONTAINERS } from './calculations';

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
    L: item.length,
    W: item.width,
    H: item.height,
    Unit: item.unit,
    'Pack Size': item.packSize,
    'Qty (Shippers)': item.quantity,
    'Net Wt/Unit (kg)': item.netWeightPerUnit,
    'Gross Wt/Shipper (kg)': item.grossWeightPerShipper,
    'CBM/Shipper': +item.cbmPerShipper.toFixed(6),
    'Total CBM': +(item.cbmPerShipper * item.quantity).toFixed(6),
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
    'Total CBM': +totals.cbm.toFixed(6),
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
    `${item.length}×${item.width}×${item.height}`,
    item.unit,
    item.packSize,
    item.quantity,
    item.netWeightPerUnit.toFixed(2),
    item.grossWeightPerShipper.toFixed(2),
    item.cbmPerShipper.toFixed(4),
    (item.cbmPerShipper * item.quantity).toFixed(4),
    (item.grossWeightPerShipper * item.quantity).toFixed(1),
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
        'Net Wt',
        'Gross Wt',
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
    ? Math.min(100, (totals.cbm / cont.cbm) * 100).toFixed(1)
    : '—';
  doc.text(
    `Total CBM: ${totals.cbm.toFixed(4)} m³  |  Gross Weight: ${totals.grossWeight.toFixed(1)} kg  |  Shippers: ${totals.shippers}  |  Container: ${cont ? cont.label : '—'} (${pct}%)`,
    14,
    finalY
  );

  doc.save(
    `shipment${poNumber ? '_' + poNumber.replace(/\s+/g, '_') : ''}_${new Date().toISOString().slice(0, 10)}.pdf`
  );
};
