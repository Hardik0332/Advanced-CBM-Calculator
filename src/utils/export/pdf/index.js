/**
 * PDF suite entry point.
 *
 * One dynamic `import()` pulls jsPDF, autoTable and all three document renderers.
 * That is the whole reason this file exists: `jspdf` plus `jspdf-autotable` is the
 * single largest contributor to the main bundle, and neither is needed until a user
 * clicks Export.
 *
 * Documents can be combined into one file or emitted separately, because both are
 * genuinely wanted: one PDF to email, separate files to attach to different
 * systems.
 */
import { renderPackingList, packingListColumnCount } from './packingList';
import { renderShipmentSummary } from './shipmentSummary';
import { renderCommercialInvoice } from './commercialInvoice';
import { orientationFor } from './layout';
import { prepareFont } from './unicodeFont';
import { exportFileName } from '../files';
import { PDF_DOCUMENTS, defaultDocumentSelection } from '../catalog';

/**
 * How each catalogued document is rendered, and how it picks its orientation.
 *
 * Keyed off `catalog.js` for the same reason `csv.js` is: `ExportModal` needs the
 * labels at first paint, and importing a label must not import jsPDF. `orientation`
 * lives here rather than in the catalogue because the packing list decides from its
 * own column count, which needs the column logic.
 */
const RENDERERS = {
  packingList: {
    render: renderPackingList,
    orientation: (ctx) => orientationFor(packingListColumnCount(ctx)),
  },
  shipmentSummary: {
    render: renderShipmentSummary,
    orientation: () => 'portrait',
  },
  commercialInvoice: {
    render: renderCommercialInvoice,
    orientation: () => 'portrait',
  },
};

/** A catalogue entry joined to its renderer. */
const specFor = (doc) => ({ ...doc, ...RENDERERS[doc.key] });

/** Paper size from the company profile, defaulting to A4. */
const paperFormat = (company) => (company?.paperSize === 'letter' ? 'letter' : 'a4');

/**
 * Create a document, prepare its font, and render one spec into it.
 *
 * @returns {Promise<{doc: object, result: object, fontNotes: string[]}>}
 */
const renderOne = async ({ jsPDF, autoTable, spec, ctx }) => {
  const doc = new jsPDF({
    orientation: spec.orientation(ctx),
    unit: 'mm',
    format: paperFormat(ctx.company),
  });

  const font = await prepareFont(doc, ctx);
  const result = spec.render(doc, ctx, { autoTable }) || {};
  return { doc, result, fontNotes: font.notes };
};

/**
 * Export the selected PDF documents.
 *
 * @param {object} ctx - A `buildExportContext` result.
 * @param {object} [opts]
 * @param {object} [opts.documents] - `{ key: boolean }`; defaults to `PDF_DOCUMENTS`.
 * @param {boolean} [opts.combined=true] - One file containing every selected
 *   document, versus one file each.
 * @returns {Promise<{files: string[], warnings: string[], pages: number}>}
 */
export const exportPDF = async (ctx, opts = {}) => {
  /* One import for the whole PDF layer. Vite splits this into its own chunk, so
     the app's first paint never pays for it. */
  const [{ jsPDF }, autoTableModule] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);
  const autoTable = autoTableModule.default || autoTableModule;

  const selection = { ...defaultDocumentSelection(), ...(opts.documents || {}) };
  const specs = PDF_DOCUMENTS.filter((d) => selection[d.key] && RENDERERS[d.key]).map(specFor);
  if (specs.length === 0) throw new Error('Select at least one document to export.');

  const warnings = [];
  const files = [];
  let pages = 0;

  const combined = opts.combined !== false;

  if (!combined || specs.length === 1) {
    /* Separate files. Also the path a single selected document takes, so its
       orientation and paper size are its own rather than the first document's. */
    for (const spec of specs) {
      const { doc, result, fontNotes } = await renderOne({ jsPDF, autoTable, spec, ctx });
      warnings.push(...fontNotes, ...(result.warnings || []));
      pages += result.pages || 0;
      const filename = exportFileName(spec.base, ctx.meta?.poNumber, 'pdf');
      doc.save(filename);
      files.push(filename);
    }
    // Dedupe: the font warning is identical for every document in one export.
    return { files, warnings: [...new Set(warnings)], pages };
  }

  /* Combined. jsPDF fixes orientation and format at construction, and mixing
     orientations inside one file needs per-page format arguments that autoTable's
     page-break handling does not follow reliably. So a combined file uses the first
     document's orientation, and landscape wins when any document wants it —
     clipping a table is worse than a portrait page in a landscape file. */
  const wantsLandscape = specs.some((s) => s.orientation(ctx) === 'landscape');
  const doc = new jsPDF({
    orientation: wantsLandscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: paperFormat(ctx.company),
  });

  const font = await prepareFont(doc, ctx);
  warnings.push(...font.notes);

  specs.forEach((spec, i) => {
    if (i > 0) doc.addPage();
    const result = spec.render(doc, ctx, { autoTable }) || {};
    warnings.push(...(result.warnings || []));
  });

  /* `pageFooters` runs inside each renderer and numbers every page that exists at
     that moment, so in a combined file the last renderer's pass is the one that
     stands — and it covers the whole document. Reported from the doc itself rather
     than summed, which would double-count. */
  pages = doc.internal.getNumberOfPages();

  const filename = exportFileName('shipment-documents', ctx.meta?.poNumber, 'pdf');
  doc.save(filename);
  files.push(filename);

  return { files, warnings: [...new Set(warnings)], pages };
};
