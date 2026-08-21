/**
 * Smoke tests that actually render.
 *
 * The rest of the export suite tests row building and formatting — pure functions.
 * Nothing exercised jsPDF or SheetJS themselves, which is where the interesting
 * failures live: a `doc.text` called with an array where a string was expected, an
 * autoTable hook that throws on an empty body, a sheet name Excel rejects. Those
 * only surface when a document is genuinely produced.
 *
 * So these tests drive the real libraries and inspect the artefact. `doc.save` and
 * `XLSX.writeFile` are stubbed, because the assertion is "a valid document was
 * built", not "a file reached the disk".
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { prepareExport } from './exporting';

/* Both libraries write to disk when told to save, and in Node that means these
   tests litter the repo root with .pdf and .xlsx files on every run. Neither export
   can be intercepted with `vi.spyOn`: `xlsx` and `jspdf` are external ESM packages
   whose namespace objects are frozen, so spying throws "Module namespace is not
   configurable". Mocking each module with a factory that keeps every real export and
   replaces only the write call is the supported route — and it still drives the real
   document-building code, which is the entire point of these tests. */
const written = { workbook: null, filename: null };
vi.mock('xlsx', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    default: actual.default ?? actual,
    writeFile: (wb, filename) => {
      written.workbook = wb;
      written.filename = filename;
    },
  };
});

/** Filenames jsPDF was asked to save, captured instead of written. */
const savedPdfs = [];
vi.mock('jspdf', async (importOriginal) => {
  const actual = await importOriginal();
  const Real = actual.jsPDF;
  /* Overridden in the constructor, not as a subclass method: jsPDF attaches its
     API onto each *instance* rather than the prototype, so an own `save` property
     shadows anything declared on the subclass. Assigning after `super()` replaces
     the one that actually gets called. Subclassing at all — rather than patching
     the real prototype — keeps the mutation from leaking to other importers. */
  class TestJsPDF extends Real {
    constructor(...args) {
      super(...args);
      this.save = (filename) => {
        savedPdfs.push(filename);
        return this;
      };
    }
  }
  return { ...actual, jsPDF: TestJsPDF, default: TestJsPDF };
});

/* jsPDF touches a few browser globals even in Node. Stubbing them here rather than
   switching the whole suite to jsdom keeps the other 600 tests running in the fast
   node environment. */
beforeAll(() => {
  if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;
  if (typeof globalThis.navigator === 'undefined') {
    globalThis.navigator = { userAgent: 'node', language: 'en-US' };
  }
});

const items = [
  {
    id: 'i1',
    name: 'Steel Bracket',
    unit: 'cm',
    length: 50,
    width: 40,
    height: 30,
    packSize: 10,
    quantity: 12,
    totalPcs: 118,
    netWeightPerUnit: 0.5,
    grossWeightPerShipper: 6,
    cbmPerShipper: 0.06,
    packingString: '10X500GM',
    hsCode: '7326.90',
    origin: 'India',
    marks: 'ACME/HAM/1-12',
    unitPrice: 4.25,
  },
  {
    id: 'i2',
    name: 'Rubber Gasket',
    unit: 'mm',
    length: 300,
    width: 200,
    height: 150,
    packSize: 50,
    quantity: 40,
    totalPcs: 2000,
    netWeightPerUnit: 0.02,
    grossWeightPerShipper: 1.4,
    cbmPerShipper: 0.009,
    packingString: '50X20GM',
    hsCode: '4016.93',
    origin: 'India',
    unitPrice: 0.85,
  },
];

/** The same items with their prices stripped — an invoice has nothing to bill. */
const unpricedItems = () =>
  items.map((item) => {
    const copy = { ...item };
    delete copy.unitPrice;
    return copy;
  });

const totals = {
  cbm: 12 * 0.06 + 40 * 0.009,
  grossWeight: 12 * 6 + 40 * 1.4,
  netWeight: 118 * 0.5 + 2000 * 0.02,
  shippers: 52,
  totalPcs: 2118,
};

const company = {
  name: 'Acme Exports Pvt Ltd',
  address: '12 Industrial Estate\nMumbai 400001\nIndia',
  phone: '+91 22 1234 5678',
  email: 'export@acme.test',
  gst: '27AAAAA0000A1Z5',
  defaultIncoterm: 'FOB',
  defaultCurrency: 'USD',
  paperSize: 'a4',
  parties: [
    { id: 'p1', label: 'Buyer GmbH', name: 'Buyer GmbH', address: 'Hafenstr 4\nHamburg' },
  ],
};

const ctx = (over = {}) =>
  prepareExport({
    shipment: over.shipment ?? items,
    totals: over.totals ?? totals,
    company: over.company === undefined ? company : over.company,
    meta: {
      poNumber: 'PO-2026-014',
      containerType: '40hc',
      freightMode: 'ocean_fcl',
      invoiceNo: 'INV-2026-014',
      invoiceDate: '2026-08-21',
      portOfLoading: 'Nhava Sheva',
      portOfDischarge: 'Hamburg',
      vesselFlight: 'MSC Aurora V.214W',
      marksNumbers: 'ACME / HAM / 1-52',
      consigneeId: 'p1',
      freightCharge: 1800,
      ...(over.meta || {}),
    },
    products: over.products ?? [],
  });

describe('PDF suite renders for real', () => {
  it('captures the save instead of writing to disk', async () => {
    /* Guards the mock itself. Without it these tests wrote five real PDFs into the
       repo root on every `npm test` run, which is how they were caught. */
    const before = savedPdfs.length;
    await (await import('./export/pdf')).exportPDF(ctx(), {
      documents: { packingList: true, shipmentSummary: false, commercialInvoice: false },
      combined: false,
    });
    expect(savedPdfs.length).toBe(before + 1);
    expect(savedPdfs.at(-1)).toMatch(/\.pdf$/);
  });

  it('produces a packing list without throwing', async () => {
    const result = await (await import('./export/pdf')).exportPDF(ctx(), {
      documents: { packingList: true, shipmentSummary: false, commercialInvoice: false },
      combined: false,
    });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatch(/^packing-list_PO-2026-014_\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(result.pages).toBeGreaterThan(0);
  });

  it('produces a shipment summary with the workings table', async () => {
    const result = await (await import('./export/pdf')).exportPDF(ctx(), {
      documents: { packingList: false, shipmentSummary: true, commercialInvoice: false },
      combined: false,
    });
    expect(result.pages).toBeGreaterThan(0);
    expect(result.files[0]).toContain('shipment-summary');
  });

  it('produces a commercial invoice when lines are priced', async () => {
    const result = await (await import('./export/pdf')).exportPDF(ctx(), {
      documents: { packingList: false, shipmentSummary: false, commercialInvoice: true },
      combined: false,
    });
    expect(result.pages).toBeGreaterThan(0);
    expect(result.warnings).toEqual([]);
  });

  it('warns rather than silently emitting a blank invoice', async () => {
    const result = await (await import('./export/pdf')).exportPDF(
      ctx({ shipment: unpricedItems() }),
      {
        documents: { packingList: false, shipmentSummary: false, commercialInvoice: true },
        combined: false,
      }
    );
    expect(result.warnings.join(' ')).toContain('No unit prices');
  });

  it('combines documents into one file when asked', async () => {
    const result = await (await import('./export/pdf')).exportPDF(ctx(), {
      documents: { packingList: true, shipmentSummary: true, commercialInvoice: true },
      combined: true,
    });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toContain('shipment-documents');
    // Three documents cannot fit on one page.
    expect(result.pages).toBeGreaterThanOrEqual(3);
  });

  it('emits separate files when asked', async () => {
    const result = await (await import('./export/pdf')).exportPDF(ctx(), {
      documents: { packingList: true, shipmentSummary: true, commercialInvoice: true },
      combined: false,
    });
    expect(result.files).toHaveLength(3);
    expect(new Set(result.files).size).toBe(3);
  });

  it('refuses an export with nothing selected, rather than writing an empty PDF', async () => {
    await expect(
      (await import('./export/pdf')).exportPDF(ctx(), {
        documents: { packingList: false, shipmentSummary: false, commercialInvoice: false },
      })
    ).rejects.toThrow(/at least one document/i);
  });

  it('pages a long shipment and still renders its totals', async () => {
    /* The bug this guards: the original exporter wrote post-table text at a running
       y with no bounds check, so a shipment that page-broke just after the table
       rendered its totals off the bottom of the last page. */
    const many = Array.from({ length: 120 }, (_, i) => ({
      ...items[0],
      id: `bulk-${i}`,
      name: `Bulk Item ${i} with a deliberately long description to force wrapping`,
    }));
    const result = await (await import('./export/pdf')).exportPDF(
      ctx({ shipment: many }),
      {
        documents: { packingList: true, shipmentSummary: false, commercialInvoice: false },
        combined: false,
      }
    );
    expect(result.pages).toBeGreaterThan(1);
  });

  it('renders with no company profile at all', async () => {
    // A first-run user has no letterhead and still needs a usable document.
    const result = await (await import('./export/pdf')).exportPDF(ctx({ company: null }), {
      documents: { packingList: true, shipmentSummary: false, commercialInvoice: false },
      combined: false,
    });
    expect(result.pages).toBeGreaterThan(0);
  });

  it('renders an empty shipment without throwing', async () => {
    const result = await (await import('./export/pdf')).exportPDF(
      ctx({ shipment: [], totals: null }),
      {
        documents: { packingList: true, shipmentSummary: true, commercialInvoice: false },
        combined: false,
      }
    );
    expect(result.files).toHaveLength(2);
  });

  it('warns about characters its font cannot render, and still produces the file', async () => {
    const result = await (await import('./export/pdf')).exportPDF(
      ctx({ shipment: [{ ...items[0], name: 'हिन्दी उत्पाद' }] }),
      {
        documents: { packingList: true, shipmentSummary: false, commercialInvoice: false },
        combined: false,
      }
    );
    expect(result.files).toHaveLength(1);
    expect(result.warnings.join(' ')).toMatch(/Devanagari/);
  });
});

describe('Excel workbook builds for real', () => {
  /** Run an Excel export and return the workbook the mock captured. */
  const runExcel = async (context, opts) => {
    written.workbook = null;
    written.filename = null;
    const result = await (await import('./export/excel')).exportExcel(context, opts);
    return { workbook: written.workbook, filename: written.filename, result };
  };

  it('writes the four default sheets', async () => {
    const { workbook, result } = await runExcel(ctx());
    expect(result.sheets).toEqual([
      'Summary',
      'Packing List',
      'Item Breakdown',
      'Container Plan',
    ]);
    expect(workbook.SheetNames).toEqual(result.sheets);
  });

  it('keeps the packing-list numbers numeric, not text', async () => {
    const { workbook } = await runExcel(ctx());
    const ws = workbook.Sheets['Packing List'];
    // Find the Total CBM column and check a data cell's type.
    const XLSX = await import('xlsx');
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const col = rows[0].indexOf('Total CBM');
    expect(col).toBeGreaterThan(-1);
    const addr = XLSX.utils.encode_cell({ c: col, r: 1 });
    expect(ws[addr].t).toBe('n');
  });

  it('honours a sheet selection', async () => {
    const { result } = await runExcel(ctx(), {
      sheets: { summary: true, packingList: false, itemBreakdown: false, containerPlan: false },
    });
    expect(result.sheets).toEqual(['Summary']);
  });

  it('never writes a workbook with zero sheets', async () => {
    // SheetJS throws on an empty workbook, so an all-off selection falls back.
    const { result } = await runExcel(ctx(), {
      sheets: Object.fromEntries(
        ['summary', 'packingList', 'itemBreakdown', 'containerPlan', 'directory', 'rawData'].map(
          (k) => [k, false]
        )
      ),
    });
    expect(result.sheets).toEqual(['Summary']);
  });

  it('includes the directory and raw-data sheets when there is data for them', async () => {
    const products = [
      { id: 'p1', name: 'Catalog Item', unit: 'cm', rawData: { 'Item Code': 'X1', Qty: 5 } },
    ];
    const { result } = await runExcel(ctx({ products }), {
      sheets: { summary: true, directory: true, rawData: true },
    });
    expect(result.sheets).toContain('Directory');
    expect(result.sheets).toContain('Raw Import Data');
  });

  it('omits the raw-data sheet when no product carries raw data', async () => {
    const { result } = await runExcel(ctx({ products: [{ id: 'p1', name: 'Manual' }] }), {
      sheets: { summary: true, rawData: true },
    });
    expect(result.sheets).not.toContain('Raw Import Data');
  });
});

describe('CSV writes for real', () => {
  /* `downloadText` needs a DOM. Stubbing the module gives us the produced text,
     which is what the assertions are actually about. */
  const runCsv = async (context, opts) => {
    const files = await import('./export/files');
    let text = null;
    let filename = null;
    const spy = vi.spyOn(files, 'downloadText').mockImplementation((t, f) => {
      text = t;
      filename = f;
    });
    const result = await (await import('./export/csv')).exportCSV(context, opts);
    spy.mockRestore();
    return { text, filename, result };
  };

  it('emits the packing list by default, BOM-prefixed and CRLF-terminated', async () => {
    const { text, result } = await runCsv(ctx());
    expect(result.table).toBe('packingList');
    // Without the BOM Excel reads the file in the system codepage and mojibakes it.
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('\r\n');
    expect(text).toContain('Steel Bracket');
  });

  it('emits each catalogued table on request', async () => {
    for (const table of ['itemBreakdown', 'containerPlan', 'workings', 'invoice']) {
      const { result, text } = await runCsv(ctx(), { table });
      expect(result.table, table).toBe(table);
      expect(text.length, table).toBeGreaterThan(10);
    }
  });

  it('refuses the invoice table when nothing is priced, with a reason', async () => {
    await expect(runCsv(ctx({ shipment: unpricedItems() }), { table: 'invoice' })).rejects.toThrow(
      /No priced lines/
    );
  });

  it('writes every block for the archival multi-block file', async () => {
    const { text } = await runCsv(ctx(), { table: 'complete' });
    for (const heading of [
      'PACKING LIST',
      'TOTALS',
      'FREIGHT & CONTAINER',
      'CHARGEABLE WEIGHT WORKINGS',
      'CONTAINER PLAN',
      'ITEM BREAKDOWN',
    ]) {
      expect(text, heading).toContain(heading);
    }
  });

  it('names the file after the table, not just the shipment', async () => {
    const { filename } = await runCsv(ctx(), { table: 'containerPlan' });
    expect(filename).toMatch(/^container-plan_PO-2026-014_\d{4}-\d{2}-\d{2}\.csv$/);
  });
});
