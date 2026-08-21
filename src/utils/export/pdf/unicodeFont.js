/**
 * Unicode support for the PDF documents.
 *
 * jsPDF's built-in Helvetica is a WinAnsi (cp1252) font. Any character outside that
 * range — Devanagari, CJK, Cyrillic, Greek, and even a plain `₹` or `—` — does not
 * render as itself. It renders as a wrong glyph or nothing, silently. For an app
 * whose users import product names in whatever script their supplier uses, that
 * means a packing list that looks fine to the developer and is unreadable to the
 * consignee.
 *
 * The honest options are: embed a Unicode font (adds hundreds of kB), or detect the
 * problem and say so. This module does both, in that order of preference:
 *
 *  1. `analyseText` scans the strings a document will actually print and classifies
 *     what is out of range.
 *  2. If a font pack is available it is `import()`ed **lazily** — nothing is added
 *     to the default bundle, and a Latin-only shipment never downloads it.
 *  3. If no pack covers the script, `notes` explains which characters will not
 *     render and the caller surfaces that through `showNotice` — rather than
 *     emitting a document full of `?` and letting the user discover it.
 *
 * No font binary ships in this change. Registering one is a data drop into
 * `fonts/` plus an entry in `FONT_PACKS`; the detection and the warning path are
 * what make that drop safe to do later, and what stop the current build lying
 * about what it can render.
 */

/**
 * Characters WinAnsi can represent: ASCII, Latin-1 Supplement, and the handful of
 * punctuation and symbols cp1252 maps into 0x80–0x9F.
 */
const WINANSI_EXTRAS = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160,
  0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/**
 * Whitespace that is not a printable glyph but is handled correctly.
 *
 * `splitTextToSize` breaks on these and jsPDF never tries to draw them, so they
 * must not count as unrenderable. Without this a company address entered across
 * three lines — the normal case — produced "2 characters cannot be rendered" on
 * every single export, which trains users to ignore a warning that matters.
 */
const RENDERABLE_CONTROL = new Set([0x09, 0x0a, 0x0d]); // tab, LF, CR

/** Can the default font render this code point? */
const isWinAnsi = (cp) =>
  (cp >= 0x20 && cp <= 0x7e) ||
  (cp >= 0xa0 && cp <= 0xff) ||
  WINANSI_EXTRAS.has(cp) ||
  RENDERABLE_CONTROL.has(cp);

/**
 * Unicode ranges we can name, so a warning can say "Devanagari" rather than
 * "U+0915". Ordered; first match wins.
 */
const SCRIPT_RANGES = [
  [0x0370, 0x03ff, 'Greek'],
  [0x0400, 0x04ff, 'Cyrillic'],
  [0x0590, 0x05ff, 'Hebrew'],
  [0x0600, 0x06ff, 'Arabic'],
  [0x0900, 0x097f, 'Devanagari'],
  [0x0980, 0x09ff, 'Bengali'],
  [0x0a00, 0x0a7f, 'Gurmukhi'],
  [0x0a80, 0x0aff, 'Gujarati'],
  [0x0b80, 0x0bff, 'Tamil'],
  [0x0c00, 0x0c7f, 'Telugu'],
  [0x0c80, 0x0cff, 'Kannada'],
  [0x0d00, 0x0d7f, 'Malayalam'],
  [0x0e00, 0x0e7f, 'Thai'],
  [0x1100, 0x11ff, 'Hangul'],
  [0x3040, 0x30ff, 'Japanese kana'],
  [0x3400, 0x4dbf, 'CJK'],
  [0x4e00, 0x9fff, 'CJK'],
  [0xac00, 0xd7af, 'Hangul'],
  [0x0100, 0x024f, 'Latin Extended'],
  [0x2000, 0x206f, 'punctuation'],
  [0x20a0, 0x20bf, 'currency symbols'],
];

const scriptOf = (cp) => {
  for (const [lo, hi, name] of SCRIPT_RANGES) {
    if (cp >= lo && cp <= hi) return name;
  }
  return 'other';
};

/**
 * Font packs available for lazy loading.
 *
 * Each entry needs a `load()` returning `{ name, style, base64 }` and the set of
 * scripts it covers. Empty by design in this build — see the module note. Adding a
 * pack requires no change to any document.
 *
 * @type {Array<{id: string, label: string, scripts: string[], load: () => Promise<object>}>}
 */
export const FONT_PACKS = [];

/**
 * Scan text for characters the default font cannot render.
 *
 * @param {Array<string>} strings
 * @returns {{ok: boolean, scripts: string[], samples: string[], count: number}}
 */
export const analyseText = (strings) => {
  const scripts = new Set();
  const samples = [];
  let count = 0;

  for (const s of strings || []) {
    if (s == null) continue;
    for (const ch of String(s)) {
      const cp = ch.codePointAt(0);
      if (isWinAnsi(cp)) continue;
      count++;
      scripts.add(scriptOf(cp));
      if (samples.length < 12 && !samples.includes(ch)) samples.push(ch);
    }
  }

  return { ok: count === 0, scripts: [...scripts], samples, count };
};

/**
 * Every string a document will print, gathered from an export context.
 *
 * Numbers are excluded deliberately — they are always ASCII by the time they reach
 * the PDF, and scanning them would waste time on the largest part of the data.
 *
 * @param {object} ctx - A `buildExportContext` result.
 * @returns {Array<string>}
 */
export const collectStrings = (ctx) => {
  const out = [];
  const push = (v) => {
    if (typeof v === 'string' && v) out.push(v);
  };

  for (const r of ctx?.records || []) {
    push(r.name);
    push(r.description);
    push(r.marks);
    push(r.packingString);
    push(r.notes);
    push(r.origin);
    push(r.sku);
  }

  const c = ctx?.company;
  if (c) [c.name, c.address, c.email, c.website].forEach(push);

  const m = ctx?.meta;
  if (m) {
    [
      m.poNumber, m.invoiceNo, m.marksNumbers, m.notes, m.portOfLoading,
      m.portOfDischarge, m.vesselFlight, m.incoterm,
    ].forEach(push);
  }

  for (const party of [ctx?.shipper, ctx?.consignee, ctx?.notify]) {
    if (party) [party.name, party.address, party.contact].forEach(push);
  }

  return out;
};

/**
 * Prepare a document's font, loading a Unicode pack only if the content needs one.
 *
 * Never throws: a failed font load must degrade to "the document renders with a
 * warning", not "the export dies". A user with a Devanagari product name still
 * needs their packing list.
 *
 * @param {object} doc - A jsPDF instance.
 * @param {object} ctx - A `buildExportContext` result.
 * @returns {Promise<{font: string, unicode: boolean, notes: string[]}>}
 */
export const prepareFont = async (doc, ctx) => {
  const analysis = analyseText(collectStrings(ctx));
  if (analysis.ok) return { font: 'helvetica', unicode: false, notes: [] };

  const needed = new Set(analysis.scripts);
  const pack = FONT_PACKS.find((p) => p.scripts.some((s) => needed.has(s)));

  if (pack) {
    try {
      const { name, style, base64 } = await pack.load();
      doc.addFileToVFS(`${name}.ttf`, base64);
      doc.addFont(`${name}.ttf`, name, style || 'normal');
      doc.setFont(name);

      // A pack may cover only some of what the document contains.
      const uncovered = [...needed].filter((s) => !pack.scripts.includes(s));
      return {
        font: name,
        unicode: true,
        notes: uncovered.length
          ? [
              `${pack.label} covers most of this document, but ${uncovered.join(', ')} ` +
                'characters may still not render.',
            ]
          : [],
      };
    } catch {
      /* fall through to the warning path */
    }
  }

  /* No pack, or the load failed. Say exactly what will be wrong and where — a
     vague "some characters may not display" is not actionable. */
  const scriptList = analysis.scripts.filter((s) => s !== 'other');
  return {
    font: 'helvetica',
    unicode: false,
    notes: [
      `${analysis.count} character${analysis.count === 1 ? '' : 's'} in this shipment ` +
        `cannot be rendered by the PDF's built-in font` +
        (scriptList.length ? ` (${scriptList.join(', ')})` : '') +
        `${analysis.samples.length ? `: ${analysis.samples.join(' ')}` : ''}. ` +
        'They will print incorrectly. Use the Excel or CSV export for these names, ' +
        'or transliterate them.',
    ],
  };
};
