/**
 * Packing List — the primary trade document.
 *
 * What a real packing list carries, and the original single-table PDF did not:
 * the three parties, the transport block, marks and numbers, HS codes, a running
 * carried-forward subtotal on every page but the last, a grand total that cannot
 * render off the page, and a declaration with somewhere to sign.
 */
import { COLORS, PAGE, TYPE, LEAD, tableTheme } from './theme';
import {
  Cursor,
  letterhead,
  partyBox,
  signatureBlock,
  pageFooters,
  fmtCell,
} from './layout';
import { pruneEmptyColumns, PACKING_LIST_COLUMNS } from '../rows';

/** Party lines from a parties-book entry, in the order a document prints them. */
const partyLines = (party) =>
  party
    ? [party.name, party.address, party.contact, party.taxId && `Tax ID: ${party.taxId}`].filter(
        Boolean
      )
    : [];

/**
 * The transport block: how the goods move.
 * Rendered as a compact grid of filled pairs — empty fields are omitted rather
 * than printed as blank labels.
 */
const transportBlock = (cur, ctx) => {
  const { doc } = cur;
  const pairs = [
    ['Mode', ctx.freight?.modeLabel],
    ['Vessel / Flight', ctx.meta?.vesselFlight],
    ['Port of Loading', ctx.meta?.portOfLoading],
    ['Port of Discharge', ctx.meta?.portOfDischarge],
    ['Incoterm', ctx.meta?.incoterm || ctx.company?.defaultIncoterm],
    ['Container', ctx.freight?.containerPlan?.applicable ? ctx.freight.containerPlan.container.label : 'LCL / loose cargo'],
  ].filter(([, v]) => v);

  if (pairs.length === 0) return;

  const perRow = 3;
  const colWidth = cur.contentWidth / perRow;
  const rows = Math.ceil(pairs.length / perRow);

  cur.space(rows * 8 + 2);
  const top = cur.y;

  pairs.forEach(([label, value], i) => {
    const x = PAGE.marginX + (i % perRow) * colWidth;
    const y = top + Math.floor(i / perRow) * 8;

    doc.setFontSize(TYPE.label);
    doc.setFont(doc.getFont().fontName, 'normal');
    doc.setTextColor(...COLORS.muted);
    doc.text(label.toUpperCase(), x, y);

    doc.setFontSize(TYPE.small);
    doc.setFont(doc.getFont().fontName, 'bold');
    doc.setTextColor(...COLORS.ink);
    const lines = doc.splitTextToSize(String(value), colWidth - 3);
    doc.text(lines.slice(0, 1), x, y + 3.6);
  });

  cur.y = top + rows * 8;
};

/**
 * Render the packing list into an existing jsPDF document.
 *
 * @param {object} doc - A jsPDF instance, already sized and font-prepared.
 * @param {object} ctx - A `buildExportContext` result.
 * @param {object} deps
 * @param {Function} deps.autoTable - The `jspdf-autotable` function. Injected
 *   rather than imported so the whole PDF layer stays out of the main bundle and
 *   is loadable in one dynamic import by `pdf/index.js`.
 * @returns {object} `{ pages }`
 */
export const renderPackingList = (doc, ctx, { autoTable }) => {
  const columns = pruneEmptyColumns(PACKING_LIST_COLUMNS, ctx.rows);
  const meta = ctx.meta || {};

  const refs = [
    ['PO / Ref', meta.poNumber],
    ['Invoice No', meta.invoiceNo],
    ['Date', meta.invoiceDate || new Date().toLocaleDateString()],
  ];

  const drawHead = (cur) =>
    letterhead(cur, {
      title: 'Packing List',
      company: ctx.company,
      logoDataUrl: ctx.company?.logo || null,
      refs,
    });

  const cur = new Cursor(doc, { onNewPage: drawHead });
  drawHead(cur);

  /* ── Parties ── */
  const parties = [
    ['Shipper / Exporter', ctx.shipper || ctx.company],
    ['Consignee', ctx.consignee],
    ['Notify Party', ctx.notify],
  ].filter(([, p]) => p);

  if (parties.length) {
    const gutter = 4;
    const boxW = (cur.contentWidth - gutter * (parties.length - 1)) / parties.length;
    const boxH = 26;
    cur.space(boxH + 3);
    parties.forEach(([label, party], i) => {
      partyBox(doc, {
        x: PAGE.marginX + i * (boxW + gutter),
        y: cur.y,
        width: boxW,
        height: boxH,
        label,
        lines: partyLines(party),
      });
    });
    cur.y += boxH + 3;
  }

  /* ── Transport ── */
  cur.section('Transport');
  transportBlock(cur, ctx);

  if (meta.marksNumbers) {
    cur.gap(2);
    cur.text('Marks & Numbers', {
      size: TYPE.label,
      color: COLORS.muted,
      lead: LEAD.tiny + 0.6,
    });
    cur.text(meta.marksNumbers, { size: TYPE.small, color: COLORS.ink });
  }

  /* ── Item table ──
     Body is the item records only; the grand total goes in `foot` so autoTable
     styles it and keeps it with the table instead of it being loose text that can
     land off the page — the original exporter's bug. */
  cur.section('Packing Details');

  const body = ctx.records.map((r) => columns.map((c) => fmtCell(r[c.key], c)));
  const foot = [columns.map((c) => fmtCell(ctx.totalsRecord[c.key], c))];
  // The label lands in whichever column carries the description.
  const nameIdx = columns.findIndex((c) => c.key === 'name');
  if (nameIdx >= 0) foot[0][nameIdx] = 'TOTALS';

  const columnStyles = {};
  columns.forEach((c, i) => {
    columnStyles[i] = { cellWidth: 'auto', halign: c.align || 'left' };
  });

  /* Carried-forward running subtotal.
     Accumulated as cells are drawn, then stamped at the foot of every page except
     the last — the convention on a multi-page packing list, and the only way a
     reader can check a page in isolation. */
  const running = { cbm: 0, gross: 0, net: 0, pcs: 0, rows: 0 };
  const totalRows = ctx.records.length;

  autoTable(doc, {
    ...tableTheme(),
    startY: cur.y,
    head: [columns.map((c) => c.label)],
    body,
    foot,
    showFoot: 'lastPage',
    footStyles: {
      fillColor: COLORS.accentLight,
      textColor: COLORS.accentDark,
      fontStyle: 'bold',
      fontSize: TYPE.tableHead,
      lineColor: COLORS.rule,
    },
    columnStyles,
    // Leave room for the footer strip and the carried-forward line.
    margin: { left: PAGE.marginX, right: PAGE.marginX, bottom: PAGE.marginBottom + PAGE.footerHeight + 6 },

    didDrawCell: (data) => {
      if (data.section !== 'body' || data.column.index !== 0) return;
      const rec = ctx.records[data.row.index];
      if (!rec) return;
      running.cbm += Number(rec.cbmTotal) || 0;
      running.gross += Number(rec.grossTotal) || 0;
      running.net += Number(rec.netTotal) || 0;
      running.pcs += Number(rec.totalPcs) || 0;
      running.rows += 1;
    },

    didDrawPage: (data) => {
      // Nothing to carry on a page with no rows, or once every row is accounted for.
      if (running.rows === 0 || running.rows >= totalRows) return;
      const y = data.cursor?.y ?? cur.bottom;
      doc.setFontSize(TYPE.tiny);
      doc.setFont(doc.getFont().fontName, 'bold');
      doc.setTextColor(...COLORS.muted);
      doc.text(
        `Carried forward — ${running.rows} of ${totalRows} lines · ` +
          `CBM ${running.cbm.toFixed(4)} · Net ${running.net.toFixed(2)} kg · ` +
          `Gross ${running.gross.toFixed(2)} kg · ${running.pcs.toLocaleString('en-US')} pcs`,
        PAGE.marginX,
        Math.min(y + 4, doc.internal.pageSize.getHeight() - PAGE.marginBottom - PAGE.footerHeight + 2)
      );
    },
  });

  cur.y = (doc.lastAutoTable?.finalY ?? cur.y) + 4;

  /* ── Chargeable weight ── */
  const billed = ctx.billed;
  cur.section('Chargeable Weight');
  cur.text(
    `${ctx.freight?.modeLabel ?? ''} · volumetric ${fmtCell(ctx.freight?.volumetricKg ?? 0, { z: '#,##0.00' })} kg · ` +
      `chargeable ${fmtCell(ctx.freight?.chargeableKg ?? 0, { z: '#,##0.00' })} kg · ` +
      `billed ${billed?.display ?? ''}`,
    { size: TYPE.small, style: 'bold', color: COLORS.ink }
  );

  /* The governing-limit statement, on the document rather than only on screen.
     Whoever loads the container is not the person who chose the destination. */
  const plan = ctx.freight?.containerPlan;
  if (plan?.payloadCapSource === 'road') {
    cur.gap(1);
    cur.text(
      `GOVERNING LIMIT — road law: payload capped at ` +
        `${fmtCell(plan.payloadCapKg, { z: '#,##0' })} kg by ${ctx.freight.countryLabel}, ` +
        `not the ${fmtCell(plan.isoPayloadKg, { z: '#,##0' })} kg ISO rating ` +
        `(${fmtCell(plan.payloadDerateKg, { z: '#,##0' })} kg less cargo per container).`,
      { size: TYPE.small, style: 'bold', color: COLORS.warn }
    );
  }

  /* ── Declaration ── */
  cur.section('Declaration');
  cur.text(
    ctx.meta?.notes ||
      'We hereby certify that the particulars given above are true and correct, and that ' +
        'the contents of this consignment are as described.',
    { size: TYPE.small, color: COLORS.body }
  );

  signatureBlock(cur, [
    { label: 'For ' + (ctx.company?.name || 'the Shipper'), caption: 'Authorised signatory & stamp' },
    { label: 'Date', caption: '' },
  ]);

  return {
    pages: pageFooters(doc, {
      left: `Packing List${meta.poNumber ? ` · ${meta.poNumber}` : ''} · generated ${new Date().toLocaleString()}`,
    }),
  };
};

/** Column count, so the caller can pick an orientation before creating the doc. */
export const packingListColumnCount = (ctx) =>
  pruneEmptyColumns(PACKING_LIST_COLUMNS, ctx.rows).length;
