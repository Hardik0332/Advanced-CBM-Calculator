/**
 * Commercial Invoice.
 *
 * The document customs assesses duty from, so its requirements are legal rather
 * than aesthetic: identified seller and buyer, a description and HS code per line,
 * country of origin, unit price and amount, the currency named explicitly, the
 * charges that make up the total, **the amount in words**, and a signed declaration
 * of truth and origin.
 *
 * The amount in words is not decoration. Figures can be altered after signing;
 * words are far harder to, which is why the line is mandatory on invoices in many
 * jurisdictions.
 */
import { COLORS, PAGE, TYPE, LEAD, tableTheme } from './theme';
import { Cursor, letterhead, partyBox, signatureBlock, pageFooters, fmtCell } from './layout';
import { pruneEmptyColumns, INVOICE_COLUMNS } from '../rows';
import { amountToWords } from '../../numberToWords';

const partyLines = (party) =>
  party
    ? [party.name, party.address, party.contact, party.taxId && `Tax ID: ${party.taxId}`].filter(
        Boolean
      )
    : [];

/**
 * Render the commercial invoice.
 *
 * @param {object} doc - A jsPDF instance.
 * @param {object} ctx - A `buildExportContext` result.
 * @param {object} deps
 * @param {Function} deps.autoTable
 * @returns {object} `{ pages, warnings }`
 */
export const renderCommercialInvoice = (doc, ctx, { autoTable }) => {
  const meta = ctx.meta || {};
  const money = ctx.invoiceTotals;
  const currency = money.currency;
  const warnings = [];

  /* An invoice with no prices is not an invoice. It still renders — a user may want
     the layout to fill in by hand — but the caller is told so it can say why the
     document looks empty rather than leaving them to guess. */
  if (!money.hasPrices) {
    warnings.push(
      'No unit prices are set on the shipment items, so the invoice has no amounts. ' +
        'Add unit prices to the items, or import a Unit Price column.'
    );
  }

  const columns = pruneEmptyColumns(INVOICE_COLUMNS, ctx.records);

  const drawHead = (cur) =>
    letterhead(cur, {
      title: 'Commercial Invoice',
      company: ctx.company,
      logoDataUrl: ctx.company?.logo || null,
      refs: [
        ['Invoice No', meta.invoiceNo || '—'],
        ['Invoice Date', meta.invoiceDate || new Date().toLocaleDateString()],
        ['PO / Ref', meta.poNumber],
        ['Currency', currency],
      ],
    });

  const cur = new Cursor(doc, { onNewPage: drawHead });
  drawHead(cur);

  /* ── Seller / Buyer ── */
  const parties = [
    ['Seller / Exporter', ctx.shipper || ctx.company],
    ['Buyer / Importer', ctx.consignee],
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

  /* ── Terms ── */
  const terms = [
    ['Incoterm', meta.incoterm || ctx.company?.defaultIncoterm],
    ['Payment Terms', meta.paymentTerms],
    ['Port of Loading', meta.portOfLoading],
    ['Port of Discharge', meta.portOfDischarge],
    ['Vessel / Flight', meta.vesselFlight],
    ['Country of Origin', meta.countryOfOrigin],
  ].filter(([, v]) => v);

  if (terms.length) {
    cur.section('Terms');
    autoTable(doc, {
      ...tableTheme({ theme: 'plain', styles: { fontSize: TYPE.small, cellPadding: 1.1 } }),
      startY: cur.y,
      body: terms,
      columnStyles: {
        0: { cellWidth: 44, textColor: COLORS.muted },
        1: { fontStyle: 'bold', textColor: COLORS.ink },
      },
    });
    cur.y = (doc.lastAutoTable?.finalY ?? cur.y) + 2;
  }

  /* ── Line items ── */
  cur.section('Goods');
  const columnStyles = {};
  columns.forEach((c, i) => {
    columnStyles[i] = { halign: c.align || 'left' };
  });

  autoTable(doc, {
    ...tableTheme(),
    startY: cur.y,
    head: [columns.map((c) => (c.key === 'amount' ? `Amount (${currency})` : c.label))],
    body: ctx.records.map((r) => columns.map((c) => fmtCell(r[c.key], c))),
    columnStyles,
    margin: {
      left: PAGE.marginX,
      right: PAGE.marginX,
      bottom: PAGE.marginBottom + PAGE.footerHeight,
    },
  });
  cur.y = (doc.lastAutoTable?.finalY ?? cur.y) + 3;

  /* ── Money block, right-aligned as on every invoice ── */
  const boxW = 76;
  const boxX = cur.pageWidth - PAGE.marginX - boxW;
  cur.space(money.lines.length * 5 + 6);

  money.lines.forEach(([label, value], i) => {
    const isTotal = i === money.lines.length - 1;
    const y = cur.y + i * 5;

    if (isTotal) {
      doc.setFillColor(...COLORS.accentLight);
      doc.rect(boxX, y - 3.4, boxW, 6.4, 'F');
    }
    doc.setFontSize(isTotal ? TYPE.body : TYPE.small);
    doc.setFont(doc.getFont().fontName, isTotal ? 'bold' : 'normal');
    doc.setTextColor(...(isTotal ? COLORS.accentDark : COLORS.body));
    doc.text(label, boxX + 2, y + 1);
    doc.text(
      `${currency} ${fmtCell(value, { z: '#,##0.00' })}`,
      boxX + boxW - 2,
      y + 1,
      { align: 'right' }
    );
  });
  cur.y += money.lines.length * 5 + 3;

  /* ── Amount in words ── */
  cur.space(12);
  doc.setDrawColor(...COLORS.rule);
  doc.setLineWidth(0.2);
  const wordsTop = cur.y;
  cur.text('AMOUNT IN WORDS', {
    size: TYPE.label,
    color: COLORS.muted,
    lead: LEAD.tiny + 0.8,
  });
  cur.text(amountToWords(money.total, currency), {
    size: TYPE.small,
    style: 'bold',
    color: COLORS.ink,
  });
  doc.rect(PAGE.marginX - 1.4, wordsTop - 2.4, cur.contentWidth + 2.8, cur.y - wordsTop + 2, 'S');
  cur.gap(3);

  /* ── Declaration ── */
  cur.section('Declaration');
  cur.text(
    meta.invoiceDeclaration ||
      'We declare that this invoice shows the actual price of the goods described, that ' +
        'all particulars are true and correct, and that the goods are of the origin stated.',
    { size: TYPE.small, color: COLORS.body }
  );

  if (ctx.freight) {
    cur.gap(1);
    cur.text(
      `Shipment: ${ctx.cbmLabel} m³ · gross ${fmtCell(ctx.totals?.grossWeight ?? 0, { z: '#,##0.00' })} kg · ` +
        `billed ${ctx.billed?.display ?? ''} (${ctx.freight.modeLabel})`,
      { size: TYPE.tiny, color: COLORS.muted }
    );
  }

  signatureBlock(cur, [
    {
      label: 'For ' + (ctx.company?.name || 'the Seller'),
      caption: 'Authorised signatory & stamp',
    },
    { label: 'Date', caption: '' },
  ]);

  return {
    pages: pageFooters(doc, {
      left:
        `Commercial Invoice${meta.invoiceNo ? ` ${meta.invoiceNo}` : ''}` +
        ` · generated ${new Date().toLocaleString()}`,
    }),
    warnings,
  };
};
