import { describe, it, expect } from 'vitest';
import { fmtCell, orientationFor } from './export/pdf/layout';
import { analyseText, collectStrings, FONT_PACKS } from './export/pdf/unicodeFont';
import {
  CSV_TABLES,
  DEFAULT_CSV_TABLE,
  EXCEL_SHEETS,
  defaultSheetSelection,
  PDF_DOCUMENTS,
  defaultDocumentSelection,
  findByKey,
} from './export/catalog';

describe('fmtCell — the only place the PDF rounds', () => {
  it('reads the decimal count off the column Excel format', () => {
    // Same format string drives both documents, so they round identically rather
    // than by coincidence.
    expect(fmtCell(1.23456, { z: '0.00' })).toBe('1.23');
    expect(fmtCell(1.23456, { z: '0.0000' })).toBe('1.2346');
    expect(fmtCell(1.6, { z: '0' })).toBe('2');
  });

  it('groups thousands when the format asks for it', () => {
    expect(fmtCell(1234567.891, { z: '#,##0.00' })).toBe('1,234,567.89');
    expect(fmtCell(1234567, { z: '0' })).toBe('1234567');
  });

  it('groups deterministically, not by host locale', () => {
    /* `toLocaleString` would make a printed shipping document depend on the machine
       that generated it. Asserting the separator pins that down. */
    expect(fmtCell(1000, { z: '#,##0' })).toBe('1,000');
  });

  it('renders a blank for nothing rather than "null" or "0"', () => {
    for (const v of [null, undefined, '']) {
      expect(fmtCell(v, { z: '0.00' })).toBe('');
    }
    // A non-finite number is a data error, not a zero.
    expect(fmtCell(NaN, { z: '0.00' })).toBe('');
    expect(fmtCell(Infinity, { z: '0.00' })).toBe('');
  });

  it('renders booleans as Yes / blank', () => {
    expect(fmtCell(true, {})).toBe('Yes');
    expect(fmtCell(false, {})).toBe('');
  });

  it('passes strings through untouched', () => {
    expect(fmtCell('8471.30.01', {})).toBe('8471.30.01');
  });

  it('survives a column with no format at all', () => {
    expect(fmtCell(1.5, {})).toBe('2');
    expect(fmtCell(1.5, undefined)).toBe('2');
  });
});

describe('orientationFor', () => {
  it('keeps a lean table portrait and turns a wide one landscape', () => {
    expect(orientationFor(6)).toBe('portrait');
    expect(orientationFor(9)).toBe('portrait');
    expect(orientationFor(13)).toBe('landscape');
  });

  it('honours a custom threshold', () => {
    expect(orientationFor(7, 6)).toBe('landscape');
  });
});

describe('analyseText — Unicode detection', () => {
  it('passes plain ASCII', () => {
    const a = analyseText(['Widget', 'Carton 10x100GM', 'PO-123']);
    expect(a.ok).toBe(true);
    expect(a.count).toBe(0);
  });

  it('passes Latin-1, which the built-in font can render', () => {
    // é, ñ, ü are all inside WinAnsi — flagging them would produce a false warning
    // on the majority of European shipments.
    const a = analyseText(['Crème brûlée', 'Piñata', 'Müller GmbH']);
    expect(a.ok).toBe(true);
  });

  it('passes the cp1252 punctuation block', () => {
    // The euro sign and an em dash live in 0x80–0x9F and do render.
    expect(analyseText(['€100 — net']).ok).toBe(true);
  });

  it('passes newlines and tabs', () => {
    /* Regression: a company address entered across three lines produced
       "2 characters cannot be rendered" on every export. `splitTextToSize` breaks
       on these and jsPDF never draws them, so they are not unrenderable — and a
       warning that fires on the normal case trains users to ignore it. */
    expect(analyseText(['12 Industrial Estate\nMumbai 400001\nIndia']).ok).toBe(true);
    expect(analyseText(['a\tb\r\nc']).ok).toBe(true);
  });

  it('flags Devanagari and names the script', () => {
    const a = analyseText(['हिन्दी उत्पाद']);
    expect(a.ok).toBe(false);
    expect(a.scripts).toContain('Devanagari');
    expect(a.count).toBeGreaterThan(0);
  });

  it('flags CJK, Cyrillic and Greek by name', () => {
    expect(analyseText(['产品']).scripts).toContain('CJK');
    expect(analyseText(['Товар']).scripts).toContain('Cyrillic');
    expect(analyseText(['Ελλάδα']).scripts).toContain('Greek');
  });

  it('flags the rupee sign, which is outside WinAnsi', () => {
    // ₹ (U+20B9) renders as a wrong glyph in the default font — silently.
    const a = analyseText(['₹1,200']);
    expect(a.ok).toBe(false);
    expect(a.scripts).toContain('currency symbols');
  });

  it('collects a bounded sample of the offending characters', () => {
    const a = analyseText(['अआइईउऊऋएऐओऔकखगघङचछज']);
    expect(a.samples.length).toBeLessThanOrEqual(12);
    expect(a.samples.length).toBeGreaterThan(0);
    // Deduplicated, so a repeated character does not fill the sample.
    expect(new Set(a.samples).size).toBe(a.samples.length);
  });

  it('survives null, undefined and non-strings', () => {
    expect(() => analyseText([null, undefined, 42, {}, ''])).not.toThrow();
    expect(analyseText(null).ok).toBe(true);
  });

  it('handles astral characters without splitting a surrogate pair', () => {
    // Iterating a string by code point rather than by UTF-16 unit; an emoji is one
    // character, not two broken halves.
    const a = analyseText(['\u{1F4E6}']);
    expect(a.count).toBe(1);
  });
});

describe('collectStrings', () => {
  const ctx = {
    records: [
      { name: 'Widget', description: 'desc', marks: 'ACME/1-10', packingString: '10X1KG',
        notes: 'fragile', origin: 'India', sku: 'W-1' },
    ],
    company: { name: 'Acme', address: 'Mumbai', email: 'a@b.c', website: 'acme.test' },
    meta: { poNumber: 'PO-1', invoiceNo: 'INV-1', marksNumbers: 'M/1', notes: 'n' },
    shipper: { name: 'Acme', address: 'Mumbai', contact: '+91' },
    consignee: { name: 'Buyer', address: 'Hamburg', contact: '+49' },
  };

  it('gathers the strings a document actually prints', () => {
    const s = collectStrings(ctx);
    expect(s).toContain('Widget');
    expect(s).toContain('ACME/1-10');
    expect(s).toContain('Acme');
    expect(s).toContain('Hamburg');
    expect(s).toContain('PO-1');
  });

  it('excludes numbers, which are always ASCII by the time they reach the PDF', () => {
    const s = collectStrings({ records: [{ name: 'W', cbmTotal: 1.5, quantity: 3 }] });
    expect(s.every((v) => typeof v === 'string')).toBe(true);
    expect(s).not.toContain(1.5);
  });

  it('survives a context with nothing in it', () => {
    expect(() => collectStrings({})).not.toThrow();
    expect(() => collectStrings(null)).not.toThrow();
    expect(collectStrings(null)).toEqual([]);
  });
});

describe('FONT_PACKS', () => {
  it('ships empty, and the detection path warns instead of embedding a font', () => {
    /* No font binary ships in this change. The detection and warning path is what
       makes dropping one in later safe — and what stops the current build implying
       it can render a script it cannot. */
    expect(FONT_PACKS).toEqual([]);
  });
});

describe('export option catalogues', () => {
  it('gives every CSV table a key, label and filename base', () => {
    for (const t of CSV_TABLES) {
      expect(t.key, t.label).toBeTruthy();
      expect(t.label, t.key).toBeTruthy();
      expect(t.base, t.key).toBeTruthy();
    }
  });

  it('carries no implementation, so importing a label cannot pull in a library', () => {
    /* The regression guard for INEFFECTIVE_DYNAMIC_IMPORT: the catalogue must stay
       pure metadata. A `render` or `build` function here means the entry chunk is
       about to grow by 400 kB again. */
    for (const list of [CSV_TABLES, EXCEL_SHEETS, PDF_DOCUMENTS]) {
      for (const entry of list) {
        for (const [key, value] of Object.entries(entry)) {
          expect(typeof value, `${entry.key}.${key}`).not.toBe('function');
        }
      }
    }
  });

  it('looks entries up by key', () => {
    expect(findByKey(CSV_TABLES, 'workings').label).toBe('Chargeable weight workings');
    expect(findByKey(CSV_TABLES, 'nope')).toBeNull();
  });

  it('marks the entries that need extra data, so the modal can say why', () => {
    expect(findByKey(CSV_TABLES, 'invoice').needs).toBe('prices');
    expect(findByKey(PDF_DOCUMENTS, 'commercialInvoice').needs).toBe('prices');
    expect(findByKey(EXCEL_SHEETS, 'rawData').needs).toBe('rawData');
    // The core outputs need nothing beyond a shipment.
    expect(findByKey(PDF_DOCUMENTS, 'packingList').needs).toBeUndefined();
  });

  it('names a default CSV table that exists', () => {
    expect(CSV_TABLES.some((t) => t.key === DEFAULT_CSV_TABLE)).toBe(true);
  });

  it('has unique keys across every catalogue', () => {
    for (const list of [CSV_TABLES, EXCEL_SHEETS, PDF_DOCUMENTS]) {
      const keys = list.map((x) => x.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it('defaults the Excel selection to the four core sheets', () => {
    const sel = defaultSheetSelection();
    expect(sel.summary).toBe(true);
    expect(sel.packingList).toBe(true);
    expect(sel.itemBreakdown).toBe(true);
    expect(sel.containerPlan).toBe(true);
    // The heavy optional sheets stay off unless asked for.
    expect(sel.directory).toBe(false);
    expect(sel.rawData).toBe(false);
  });

  it('defaults the PDF selection to the two documents that need no extra data', () => {
    const sel = defaultDocumentSelection();
    expect(sel.packingList).toBe(true);
    expect(sel.shipmentSummary).toBe(true);
    // The invoice needs unit prices, so it is opt-in.
    expect(sel.commercialInvoice).toBe(false);
  });

  it('gives every PDF document a filename base', () => {
    for (const d of PDF_DOCUMENTS) {
      expect(d.base, d.key).toBeTruthy();
      expect(d.label, d.key).toBeTruthy();
    }
  });
});
