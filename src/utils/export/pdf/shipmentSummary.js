/**
 * Shipment Summary — the internal planning document.
 *
 * Where the packing list is what you send, this is what you check before you send
 * it: the totals, the derivation behind the billed weight, the container plan with
 * fill bars, and the heaviest lines by volume.
 *
 * The `workings` table is the reason this document exists. The app bills a number
 * the user cannot reproduce in their head — per-piece volume, a carrier divisor, a
 * round-up, and possibly a road-law payload cap — so it owes them the arithmetic in
 * a form they can hand to a customer.
 */
import { COLORS, PAGE, TYPE, LEAD, tableTheme } from './theme';
import { Cursor, letterhead, utilizationBar, pageFooters, fmtCell } from './layout';

/** Big-number cards across the top: the five figures people actually ask for. */
const totalsCards = (cur, ctx) => {
  const { doc } = cur;
  const cards = [
    ['Total CBM', ctx.cbmLabel, 'm³'],
    ['Net Weight', fmtCell(ctx.totals?.netWeight ?? 0, { z: '#,##0.00' }), 'kg'],
    ['Gross Weight', fmtCell(ctx.totals?.grossWeight ?? 0, { z: '#,##0.00' }), 'kg'],
    ['Billed', ctx.billed?.display ?? '—', ''],
    ['Shippers', fmtCell(ctx.totals?.shippers ?? 0, { z: '#,##0' }), ''],
    ['Pieces', fmtCell(ctx.totals?.totalPcs ?? 0, { z: '#,##0' }), ''],
  ];

  const gutter = 3;
  const perRow = 3;
  const cardW = (cur.contentWidth - gutter * (perRow - 1)) / perRow;
  const cardH = 15;
  const rows = Math.ceil(cards.length / perRow);

  cur.space(rows * (cardH + gutter));
  const top = cur.y;

  cards.forEach(([label, value, unit], i) => {
    const x = PAGE.marginX + (i % perRow) * (cardW + gutter);
    const y = top + Math.floor(i / perRow) * (cardH + gutter);

    doc.setFillColor(...COLORS.zebra);
    doc.setDrawColor(...COLORS.rule);
    doc.setLineWidth(0.2);
    doc.rect(x, y, cardW, cardH, 'FD');

    doc.setFontSize(TYPE.label);
    doc.setFont(doc.getFont().fontName, 'normal');
    doc.setTextColor(...COLORS.muted);
    doc.text(label.toUpperCase(), x + 2.4, y + 4.4);

    doc.setFontSize(TYPE.figure);
    doc.setFont(doc.getFont().fontName, 'bold');
    doc.setTextColor(...COLORS.accentDark);
    const text = unit ? `${value} ${unit}` : value;
    doc.text(doc.splitTextToSize(text, cardW - 4.8).slice(0, 1), x + 2.4, y + 11.4);
  });

  cur.y = top + rows * (cardH + gutter);
};

/** The container plan, with utilisation bars drawn as rects. */
const containerPlan = (cur, ctx) => {
  const plan = ctx.freight?.containerPlan;
  cur.section('Container Plan');

  if (!plan?.applicable) {
    cur.text('No container selected — cargo is loose / LCL groupage.', {
      size: TYPE.small,
      color: COLORS.muted,
    });
    return;
  }

  const c = plan.container;
  cur.text(
    `${plan.count} × ${c.label} — limited by ${plan.limitedBy}`,
    { size: TYPE.body, style: 'bold', color: COLORS.ink }
  );
  cur.gap(1.5);

  const bars = [
    [
      `Volume  ${ctx.cbmLabel} / ${fmtCell(plan.capacityCbm, { z: '#,##0.00' })} m³`,
      plan.volumeFillPct,
    ],
    [
      `Payload  ${fmtCell(ctx.totals?.grossWeight ?? 0, { z: '#,##0' })} / ` +
        `${fmtCell(plan.capacityPayloadKg, { z: '#,##0' })} kg` +
        (plan.payloadCapSource === 'road' ? '  (road-legal cap)' : ''),
      plan.payloadFillPct,
    ],
  ];

  for (const [label, pct] of bars) {
    cur.space(9);
    utilizationBar(cur.doc, {
      x: PAGE.marginX,
      y: cur.y + 2.6,
      width: cur.contentWidth - 22,
      pct,
      label,
    });
    cur.doc.setFontSize(TYPE.small);
    cur.doc.setFont(cur.doc.getFont().fontName, 'bold');
    cur.doc.setTextColor(...(pct > 100 ? COLORS.danger : COLORS.body));
    cur.doc.text(
      `${fmtCell(pct, { z: '0.00' })}%`,
      cur.pageWidth - PAGE.marginX,
      cur.y + 5.4,
      { align: 'right' }
    );
    cur.y += 9;
  }

  /* The one sentence that stops a container being loaded to an unreachable plate. */
  if (plan.payloadCapSource === 'road') {
    cur.gap(1);
    cur.text(
      `Payload capped at ${fmtCell(plan.payloadCapKg, { z: '#,##0' })} kg by ` +
        `${ctx.freight.countryLabel} road law, not the ` +
        `${fmtCell(plan.isoPayloadKg, { z: '#,##0' })} kg ISO rating — ` +
        `${fmtCell(plan.payloadDerateKg, { z: '#,##0' })} kg less cargo per container.`,
      { size: TYPE.small, style: 'bold', color: COLORS.warn }
    );
  }

  const margins = [
    plan.remainingCbm > 0 &&
      `${fmtCell(plan.remainingCbm, { z: '#,##0.00' })} m³ volume remaining`,
    plan.remainingPayloadKg > 0 &&
      `${fmtCell(plan.remainingPayloadKg, { z: '#,##0' })} kg payload margin`,
    plan.overCbm > 0 && `OVER VOLUME by ${fmtCell(plan.overCbm, { z: '#,##0.00' })} m³`,
    plan.overPayloadKg > 0 &&
      `OVER PAYLOAD by ${fmtCell(plan.overPayloadKg, { z: '#,##0' })} kg`,
  ].filter(Boolean);

  if (margins.length) {
    cur.gap(1);
    cur.text(margins.join('  ·  '), {
      size: TYPE.small,
      color: plan.overCbm > 0 || plan.overPayloadKg > 0 ? COLORS.danger : COLORS.muted,
    });
  }
};

/**
 * Render the shipment summary.
 *
 * @param {object} doc - A jsPDF instance.
 * @param {object} ctx - A `buildExportContext` result.
 * @param {object} deps
 * @param {Function} deps.autoTable
 * @returns {object} `{ pages }`
 */
export const renderShipmentSummary = (doc, ctx, { autoTable }) => {
  const meta = ctx.meta || {};

  const drawHead = (cur) =>
    letterhead(cur, {
      title: 'Shipment Summary',
      company: ctx.company,
      logoDataUrl: ctx.company?.logo || null,
      refs: [
        ['PO / Ref', meta.poNumber],
        ['Date', meta.invoiceDate || new Date().toLocaleDateString()],
        ['Mode', ctx.freight?.modeLabel],
      ],
    });

  const cur = new Cursor(doc, { onNewPage: drawHead });
  drawHead(cur);

  totalsCards(cur, ctx);

  /* ── Shipment details, when the user has filled any in ── */
  if (ctx.tradePairs.length) {
    cur.section('Shipment Details');
    autoTable(doc, {
      ...tableTheme({ theme: 'plain', styles: { fontSize: TYPE.small, cellPadding: 1.1 } }),
      startY: cur.y,
      body: ctx.tradePairs,
      columnStyles: {
        0: { cellWidth: 46, textColor: COLORS.muted },
        1: { fontStyle: 'bold', textColor: COLORS.ink },
      },
    });
    cur.y = (doc.lastAutoTable?.finalY ?? cur.y) + 2;
  }

  /* ── The derivation. The point of the document. ── */
  cur.section('How the Billed Weight Was Derived');
  autoTable(doc, {
    ...tableTheme(),
    startY: cur.y,
    head: [['Step', 'Derivation', 'Value']],
    body: (ctx.freight?.workings || []).map((w) => [w.label, w.expression, w.display]),
    columnStyles: {
      0: { cellWidth: 42, fontStyle: 'bold', textColor: COLORS.ink },
      2: { cellWidth: 34, halign: 'right', fontStyle: 'bold' },
    },
    margin: {
      left: PAGE.marginX,
      right: PAGE.marginX,
      bottom: PAGE.marginBottom + PAGE.footerHeight,
    },
  });
  cur.y = (doc.lastAutoTable?.finalY ?? cur.y) + 3;

  /* Sourcing caveats printed rather than hidden — some figures are industry
     practice we could not verify from a primary source, and a document that
     implies otherwise is worse than one that says so. */
  const notes = ctx.freight?.notes || [];
  if (notes.length) {
    for (const note of notes) {
      cur.text(`• ${note}`, { size: TYPE.tiny, color: COLORS.muted, lead: LEAD.tiny });
    }
    cur.gap(1);
  }

  containerPlan(cur, ctx);

  /* ── Heaviest lines by volume ── */
  const top10 = [...ctx.records].sort((a, b) => b.cbmTotal - a.cbmTotal).slice(0, 10);
  if (top10.length > 1) {
    cur.section('Largest Lines by Volume');
    const totalCbm = Number(ctx.totalsRecord.cbmTotal) || 0;
    autoTable(doc, {
      ...tableTheme(),
      startY: cur.y,
      head: [['#', 'Item', 'Cartons', 'Total CBM', '% of shipment', 'Gross kg']],
      body: top10.map((r) => [
        r.idx,
        r.name,
        fmtCell(r.quantity, { z: '#,##0' }),
        fmtCell(r.cbmTotal, { z: '0.0000' }),
        totalCbm > 0 ? `${((r.cbmTotal / totalCbm) * 100).toFixed(1)}%` : '—',
        fmtCell(r.grossTotal, { z: '#,##0.00' }),
      ]),
      columnStyles: {
        0: { cellWidth: 9, halign: 'center' },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
      },
      margin: {
        left: PAGE.marginX,
        right: PAGE.marginX,
        bottom: PAGE.marginBottom + PAGE.footerHeight,
      },
    });
    cur.y = (doc.lastAutoTable?.finalY ?? cur.y) + 3;
  }

  if (meta.notes) {
    cur.section('Notes');
    cur.text(meta.notes, { size: TYPE.small, color: COLORS.body });
  }

  return {
    pages: pageFooters(doc, {
      left: `Shipment Summary${meta.poNumber ? ` · ${meta.poNumber}` : ''} · generated ${new Date().toLocaleString()}`,
    }),
  };
};
