/**
 * PDF theme — colours, geometry and type scale in one place.
 *
 * The three documents must look like one family, which they cannot if each picks
 * its own margins and greys. Colours derive from the app's Tailwind accent
 * (`#0d7d6e`) so a printed document matches the screen it came from.
 *
 * All geometry is millimetres, matching the `unit: 'mm'` jsPDF is created with.
 * Mixing mm and pt inside one document was the source of the original exporter's
 * off-page text.
 */

/** RGB triples, in the shape jsPDF's setTextColor/setFillColor wants. */
export const COLORS = {
  accent: [13, 125, 110],       // #0d7d6e — Tailwind accent-600
  accentDark: [9, 88, 78],
  accentLight: [224, 242, 239],
  ink: [23, 23, 23],
  body: [64, 64, 64],
  muted: [115, 115, 115],
  faint: [163, 163, 163],
  rule: [214, 211, 209],
  zebra: [249, 250, 251],
  white: [255, 255, 255],
  danger: [190, 24, 60],
  warn: [180, 83, 9],
  warnBg: [254, 243, 199],
  ok: [4, 120, 87],
};

/** Page geometry, in mm. */
export const PAGE = {
  marginX: 14,
  marginTop: 14,
  marginBottom: 16,
  /** Reserved strip at the foot for the page number and generated-on line. */
  footerHeight: 10,
};

/** Type scale, in pt (jsPDF font sizes are always pt regardless of unit). */
export const TYPE = {
  docTitle: 17,
  sectionTitle: 10.5,
  label: 7,
  body: 8.5,
  small: 7.5,
  tiny: 6.5,
  tableHead: 7.5,
  tableBody: 7.5,
  figure: 12,
};

/** Line heights, in mm, matched to the sizes above. */
export const LEAD = {
  body: 4.2,
  small: 3.6,
  tiny: 3.1,
  section: 6,
};

/** Paper sizes the company profile can select. */
export const PAPER_SIZES = { a4: 'a4', letter: 'letter' };

/**
 * Table styling shared by every autoTable call, so the three documents cannot
 * drift apart visually.
 *
 * @param {object} [overrides]
 * @returns {object}
 */
export const tableTheme = (overrides = {}) => ({
  theme: 'grid',
  styles: {
    fontSize: TYPE.tableBody,
    cellPadding: 1.6,
    lineColor: COLORS.rule,
    lineWidth: 0.1,
    textColor: COLORS.body,
    overflow: 'linebreak',
  },
  headStyles: {
    fillColor: COLORS.accent,
    textColor: COLORS.white,
    fontStyle: 'bold',
    fontSize: TYPE.tableHead,
    lineColor: COLORS.accent,
  },
  alternateRowStyles: { fillColor: COLORS.zebra },
  margin: { left: PAGE.marginX, right: PAGE.marginX },
  ...overrides,
});
