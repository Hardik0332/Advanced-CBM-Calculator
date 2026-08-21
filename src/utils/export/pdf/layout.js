/**
 * PDF layout primitives.
 *
 * The original exporter wrote text at a running `finalY` with no bounds check, so a
 * shipment that page-broke just after the table rendered its totals **off the
 * bottom of the last page** — silently, on a document someone signs. Every helper
 * here goes through `Cursor`, which knows where the page ends.
 *
 * The other recurring bug was raw `doc.text()` with a long string: jsPDF does not
 * wrap, it runs off the right edge. `Cursor.text()` always goes through
 * `splitTextToSize`.
 */
import { COLORS, PAGE, TYPE, LEAD } from './theme';

/**
 * A page-aware write head.
 *
 * Owns the y position and the page count so callers never touch either. `space(n)`
 * is the contract: ask for room before drawing, and get a new page if there isn't
 * any.
 */
export class Cursor {
  /**
   * @param {object} doc - A jsPDF instance.
   * @param {object} [opts]
   * @param {(cursor: Cursor) => void} [opts.onNewPage] - Draws repeating chrome.
   */
  constructor(doc, opts = {}) {
    this.doc = doc;
    this.onNewPage = opts.onNewPage || null;
    this.pageWidth = doc.internal.pageSize.getWidth();
    this.pageHeight = doc.internal.pageSize.getHeight();
    this.contentWidth = this.pageWidth - PAGE.marginX * 2;
    this.y = PAGE.marginTop;
    // Where content must stop to leave the footer alone.
    this.bottom = this.pageHeight - PAGE.marginBottom - PAGE.footerHeight;
  }

  /** Reset to the top of a fresh page and let the caller redraw its chrome. */
  newPage() {
    this.doc.addPage();
    this.y = PAGE.marginTop;
    if (this.onNewPage) this.onNewPage(this);
    return this;
  }

  /**
   * Ensure `height` mm of room, adding a page if not.
   * @param {number} height
   * @returns {boolean} True when a page break happened.
   */
  space(height) {
    if (this.y + height <= this.bottom) return false;
    this.newPage();
    return true;
  }

  /** Move down without drawing. */
  gap(mm) {
    this.y += mm;
    return this;
  }

  /**
   * Write wrapped text, breaking pages as needed.
   *
   * @param {string} text
   * @param {object} [opts]
   * @param {number} [opts.size=TYPE.body]
   * @param {'normal'|'bold'|'italic'} [opts.style='normal']
   * @param {number[]} [opts.color=COLORS.body]
   * @param {number} [opts.x] - Defaults to the left margin.
   * @param {number} [opts.width] - Defaults to the content width.
   * @param {number} [opts.lead] - Line height in mm.
   * @param {'left'|'center'|'right'} [opts.align='left']
   * @returns {Cursor}
   */
  text(text, opts = {}) {
    const {
      size = TYPE.body,
      style = 'normal',
      color = COLORS.body,
      x = PAGE.marginX,
      width = this.contentWidth,
      lead = size >= TYPE.body ? LEAD.body : LEAD.small,
      align = 'left',
    } = opts;

    const str = text == null ? '' : String(text);
    if (!str) return this;

    this.doc.setFontSize(size);
    this.doc.setFont(this.doc.getFont().fontName, style);
    this.doc.setTextColor(...color);

    const lines = this.doc.splitTextToSize(str, width);
    for (const line of lines) {
      this.space(lead);
      const drawX =
        align === 'center' ? x + width / 2 : align === 'right' ? x + width : x;
      this.doc.text(line, drawX, this.y, align === 'left' ? undefined : { align });
      this.y += lead;
    }
    return this;
  }

  /** A horizontal rule across the content width. */
  rule(opts = {}) {
    const { color = COLORS.rule, width = 0.2, gapBefore = 1.5, gapAfter = 2.5 } = opts;
    this.space(gapBefore + gapAfter + width);
    this.y += gapBefore;
    this.doc.setDrawColor(...color);
    this.doc.setLineWidth(width);
    this.doc.line(PAGE.marginX, this.y, this.pageWidth - PAGE.marginX, this.y);
    this.y += gapAfter;
    return this;
  }

  /** A section heading: small caps-ish label with a rule under it. */
  section(title) {
    this.space(LEAD.section + 4);
    this.gap(2);
    this.text(String(title).toUpperCase(), {
      size: TYPE.sectionTitle,
      style: 'bold',
      color: COLORS.accentDark,
      lead: LEAD.section,
    });
    this.doc.setDrawColor(...COLORS.accent);
    this.doc.setLineWidth(0.4);
    this.doc.line(PAGE.marginX, this.y - 3.2, this.pageWidth - PAGE.marginX, this.y - 3.2);
    this.gap(1);
    return this;
  }
}

/**
 * The letterhead: company identity, document title, and the reference block.
 *
 * Falls back gracefully to just the document title when no company profile exists,
 * because a user who has not filled one in still needs a usable document.
 *
 * @param {Cursor} cur
 * @param {object} args
 * @param {string} args.title - e.g. 'PACKING LIST'.
 * @param {object} [args.company]
 * @param {Array<[string, string]>} [args.refs] - Right-aligned reference pairs.
 * @param {string} [args.logoDataUrl]
 */
export const letterhead = (cur, { title, company = null, refs = [], logoDataUrl = null }) => {
  const { doc } = cur;
  const top = cur.y;
  const rightColWidth = 62;
  const leftWidth = cur.contentWidth - rightColWidth - 4;

  let logoBottom = top;
  let textX = PAGE.marginX;

  /* Logo, if the profile carries one. Wrapped: a corrupt data URL from a hand-
     edited backup must not take the whole export down. */
  if (logoDataUrl) {
    try {
      const size = 16;
      doc.addImage(logoDataUrl, PAGE.marginX, top, size, size, undefined, 'FAST');
      textX = PAGE.marginX + size + 4;
      logoBottom = top + size;
    } catch {
      /* unreadable logo — fall through to text-only */
    }
  }

  /* Left column: company identity. */
  let leftY = top;
  if (company?.name) {
    doc.setFontSize(TYPE.sectionTitle + 1);
    doc.setFont(doc.getFont().fontName, 'bold');
    doc.setTextColor(...COLORS.ink);
    const nameLines = doc.splitTextToSize(String(company.name), leftWidth - (textX - PAGE.marginX));
    doc.text(nameLines, textX, leftY + 3.4);
    leftY += 3.4 + (nameLines.length - 1) * 4.4;

    doc.setFontSize(TYPE.small);
    doc.setFont(doc.getFont().fontName, 'normal');
    doc.setTextColor(...COLORS.muted);

    const detail = [
      company.address,
      [company.phone, company.email].filter(Boolean).join('  ·  '),
      company.website,
      [
        company.gst && `GST ${company.gst}`,
        company.iec && `IEC ${company.iec}`,
        company.cin && `CIN ${company.cin}`,
      ]
        .filter(Boolean)
        .join('  ·  '),
    ].filter(Boolean);

    for (const line of detail) {
      const wrapped = doc.splitTextToSize(String(line), leftWidth - (textX - PAGE.marginX));
      leftY += LEAD.small;
      doc.text(wrapped, textX, leftY);
      leftY += (wrapped.length - 1) * LEAD.small;
    }
  }

  /* Right column: document title and references. */
  const rightX = cur.pageWidth - PAGE.marginX;
  doc.setFontSize(TYPE.docTitle);
  doc.setFont(doc.getFont().fontName, 'bold');
  doc.setTextColor(...COLORS.accent);
  doc.text(String(title).toUpperCase(), rightX, top + 4.6, { align: 'right' });

  let rightY = top + 4.6;
  doc.setFontSize(TYPE.small);
  doc.setFont(doc.getFont().fontName, 'normal');
  doc.setTextColor(...COLORS.body);
  for (const [label, value] of refs) {
    if (value === null || value === undefined || value === '') continue;
    rightY += LEAD.small + 0.4;
    doc.text(`${label}: ${value}`, rightX, rightY, { align: 'right' });
  }

  cur.y = Math.max(leftY, rightY, logoBottom) + 3;
  cur.rule({ color: COLORS.accent, width: 0.5, gapBefore: 0, gapAfter: 4 });
};

/**
 * A bordered party box (Shipper / Consignee / Notify).
 *
 * Fixed height by design: three boxes of different heights side by side read as a
 * layout bug rather than as data. Content that overflows is clipped by
 * `splitTextToSize` at the line count the box can hold, and the profile editor is
 * where a too-long address gets shortened.
 *
 * @param {object} doc
 * @param {object} args
 * @returns {number} The box's bottom edge, in mm.
 */
export const partyBox = (doc, { x, y, width, height, label, lines = [] }) => {
  doc.setDrawColor(...COLORS.rule);
  doc.setLineWidth(0.2);
  doc.setFillColor(...COLORS.white);
  doc.rect(x, y, width, height, 'S');

  // Label strip.
  doc.setFillColor(...COLORS.accentLight);
  doc.rect(x, y, width, 4.6, 'F');
  doc.setFontSize(TYPE.label);
  doc.setFont(doc.getFont().fontName, 'bold');
  doc.setTextColor(...COLORS.accentDark);
  doc.text(String(label).toUpperCase(), x + 1.6, y + 3.2);

  doc.setFontSize(TYPE.small);
  doc.setFont(doc.getFont().fontName, 'normal');
  doc.setTextColor(...COLORS.body);

  const usable = height - 6.4;
  const maxLines = Math.max(1, Math.floor(usable / LEAD.small));
  const text = lines.filter(Boolean).join('\n');
  const wrapped = doc.splitTextToSize(text || '—', width - 3.2).slice(0, maxLines);
  doc.text(wrapped, x + 1.6, y + 7.6);

  return y + height;
};

/**
 * A horizontal utilisation bar, drawn with rects.
 *
 * Deliberately allows over-100% to render as a full bar in the danger colour: an
 * overloaded container must be impossible to miss, and clamping the value would
 * hide exactly the case that matters.
 *
 * @param {object} doc
 * @param {object} args
 */
export const utilizationBar = (doc, { x, y, width, height = 3.2, pct, label = '' }) => {
  const value = Number.isFinite(pct) ? Math.max(0, pct) : 0;
  const filled = Math.min(1, value / 100) * width;
  const over = value > 100;

  doc.setFillColor(...COLORS.rule);
  doc.rect(x, y, width, height, 'F');
  doc.setFillColor(...(over ? COLORS.danger : value > 95 ? COLORS.warn : COLORS.accent));
  if (filled > 0) doc.rect(x, y, filled, height, 'F');

  if (label) {
    doc.setFontSize(TYPE.tiny);
    doc.setFont(doc.getFont().fontName, 'normal');
    doc.setTextColor(...COLORS.muted);
    doc.text(label, x, y - 1);
  }
  return y + height;
};

/**
 * A signature block: a rule to sign above, with a caption.
 *
 * @param {Cursor} cur
 * @param {Array<{label: string, caption?: string}>} slots
 */
export const signatureBlock = (cur, slots) => {
  const { doc } = cur;
  cur.space(20);
  cur.gap(8);

  const gutter = 8;
  const width = (cur.contentWidth - gutter * (slots.length - 1)) / slots.length;

  slots.forEach((slot, i) => {
    const x = PAGE.marginX + i * (width + gutter);
    doc.setDrawColor(...COLORS.faint);
    doc.setLineWidth(0.2);
    doc.line(x, cur.y, x + width, cur.y);

    doc.setFontSize(TYPE.small);
    doc.setFont(doc.getFont().fontName, 'bold');
    doc.setTextColor(...COLORS.body);
    doc.text(slot.label, x, cur.y + 4);

    if (slot.caption) {
      doc.setFontSize(TYPE.tiny);
      doc.setFont(doc.getFont().fontName, 'normal');
      doc.setTextColor(...COLORS.muted);
      doc.text(slot.caption, x, cur.y + 7.4);
    }
  });

  cur.y += 10;
  return cur;
};

/**
 * Stamp `Page X of Y` and a generated-on line onto every page.
 *
 * Must run **after** all content: the total page count is not known until then,
 * which is why the original exporter could not print a real total. jsPDF lets us
 * revisit pages, so this is a second pass rather than a guess.
 *
 * @param {object} doc
 * @param {object} [opts]
 * @param {string} [opts.left] - Left-hand footer text.
 */
export const pageFooters = (doc, opts = {}) => {
  const total = doc.internal.getNumberOfPages();
  const width = doc.internal.pageSize.getWidth();
  const height = doc.internal.pageSize.getHeight();
  const y = height - PAGE.marginBottom + 4;

  for (let page = 1; page <= total; page++) {
    doc.setPage(page);
    doc.setFontSize(TYPE.tiny);
    doc.setFont(doc.getFont().fontName, 'normal');
    doc.setTextColor(...COLORS.faint);

    doc.setDrawColor(...COLORS.rule);
    doc.setLineWidth(0.2);
    doc.line(PAGE.marginX, y - 3, width - PAGE.marginX, y - 3);

    if (opts.left) doc.text(String(opts.left), PAGE.marginX, y);
    doc.text(`Page ${page} of ${total}`, width - PAGE.marginX, y, { align: 'right' });
  }
  return total;
};

/**
 * Choose page orientation from the column count.
 *
 * A packing list with marks, HS codes and prices needs landscape; a lean one reads
 * better in portrait, and portrait is what people expect to file.
 *
 * @param {number} columnCount
 * @param {number} [threshold=9]
 * @returns {'portrait'|'landscape'}
 */
export const orientationFor = (columnCount, threshold = 9) =>
  columnCount > threshold ? 'landscape' : 'portrait';

/**
 * Format a record value for print.
 *
 * This is the *only* place the PDF turns a number into a string, which is what
 * keeps the precision policy honest: spreadsheets carry raw numerics, and rounding
 * lives here. Decimal places are read off the column's Excel format so the two
 * documents round identically rather than by coincidence.
 *
 * @param {*} value
 * @param {object} column - A column from a `rows.js` column set.
 * @returns {string}
 */
export const fmtCell = (value, column) => {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'boolean') return value ? 'Yes' : '';
  if (typeof value !== 'number') return String(value);
  if (!Number.isFinite(value)) return '';

  // Decimal count from the Excel format string, e.g. '#,##0.00' -> 2.
  const z = column?.z || '';
  const dot = z.indexOf('.');
  const decimals = dot === -1 ? 0 : (z.slice(dot + 1).match(/0/g) || []).length;
  const grouped = z.includes(',');

  const fixed = value.toFixed(decimals);
  if (!grouped) return fixed;

  const [int, frac] = fixed.split('.');
  // Hand-rolled grouping: `toLocaleString` would make a printed document depend on
  // the machine's locale, which is not acceptable on a shipping document.
  const withSeps = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac ? `${withSeps}.${frac}` : withSeps;
};
