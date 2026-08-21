/**
 * ExportModal — one place to choose what leaves the app.
 *
 * Replaces three loose toolbar buttons that each did one fixed thing. With a
 * multi-sheet workbook, six CSV tables and three PDF documents there are now far
 * more than three outputs, and a toolbar cannot express "packing list and invoice,
 * as one PDF".
 *
 * Every export is async — the libraries load on demand — so this owns the busy
 * state and reports what was written, including warnings the exporters raise
 * (a font that cannot render a script, an invoice with no prices).
 */
import { useState, useMemo } from 'react';
import Modal from '../ui/Modal';
import { ExcelIcon, PdfIcon, FileDocIcon, WarningIcon, CheckCircleIcon } from '../icons/Icons';
import {
  exportExcel,
  exportCSV,
  exportPDF,
  EXCEL_SHEETS,
  defaultSheetSelection,
  CSV_TABLES,
  DEFAULT_CSV_TABLE,
  PDF_DOCUMENTS,
  defaultDocumentSelection,
} from '../../utils/exporting';

const FORMATS = [
  {
    key: 'pdf',
    label: 'PDF',
    hint: 'Trade documents — packing list, summary, invoice',
    icon: <PdfIcon />,
    accent: 'rose',
  },
  {
    key: 'excel',
    label: 'Excel',
    hint: 'Multi-sheet workbook with every figure',
    icon: <ExcelIcon />,
    accent: 'emerald',
  },
  {
    key: 'csv',
    label: 'CSV',
    hint: 'One table, for another system to read',
    icon: <FileDocIcon />,
    accent: 'teal',
  },
];

const ACCENTS = {
  rose: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800',
  emerald:
    'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800',
  teal: 'text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/40 border-teal-200 dark:border-teal-800',
};

/** An accessible checkbox row. */
const Check = ({ id, checked, onChange, label, hint, disabled, disabledNote }) => (
  <label
    htmlFor={id}
    className={`flex items-start gap-2.5 p-2 rounded-lg border transition-colors ${
      disabled
        ? 'opacity-50 cursor-not-allowed border-surface-200 dark:border-surface-700'
        : checked
          ? 'cursor-pointer bg-accent-50 dark:bg-accent-900/25 border-accent-200 dark:border-accent-700'
          : 'cursor-pointer border-surface-200 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-700/40'
    }`}
  >
    <input
      id={id}
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-0.5 w-3.5 h-3.5 accent-accent-600 flex-shrink-0"
    />
    <span className="min-w-0">
      <span className="block text-[11px] font-bold text-surface-800 dark:text-surface-100">
        {label}
      </span>
      {(disabled && disabledNote ? disabledNote : hint) && (
        <span className="block text-[9px] text-surface-500 dark:text-surface-400 leading-snug mt-0.5">
          {disabled && disabledNote ? disabledNote : hint}
        </span>
      )}
    </span>
  </label>
);

const ExportModal = ({ isOpen, onClose, exportArgs, hasPrices, hasProducts, hasRawData }) => {
  const [format, setFormat] = useState('pdf');
  const [documents, setDocuments] = useState(defaultDocumentSelection);
  const [combined, setCombined] = useState(true);
  const [sheets, setSheets] = useState(defaultSheetSelection);
  const [csvTable, setCsvTable] = useState(DEFAULT_CSV_TABLE);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  /* Why a choice is unavailable, keyed by the `needs` flag the catalogue declares.
     Disabling with a reason beats letting someone export an empty invoice and
     wonder what went wrong. */
  const reasons = useMemo(
    () => ({
      prices: hasPrices ? null : 'No unit prices on the shipment items',
      products: hasProducts ? null : 'The product directory is empty',
      rawData: hasRawData ? null : 'No imported raw data stored',
    }),
    [hasPrices, hasProducts, hasRawData]
  );

  /** The blocking reason for a catalogue entry, or null when it is available. */
  const blockedBy = (entry) => (entry.needs ? reasons[entry.needs] : null);

  const selectedDocCount = PDF_DOCUMENTS.filter(
    (d) => documents[d.key] && !blockedBy(d)
  ).length;

  const run = async () => {
    setBusy(true);
    setError('');
    setResult(null);
    try {
      if (format === 'excel') {
        const out = await exportExcel(exportArgs, { sheets });
        setResult({
          files: [out.filename],
          detail: `${out.sheets.length} sheet${out.sheets.length === 1 ? '' : 's'}: ${out.sheets.join(', ')}`,
          warnings: [],
        });
      } else if (format === 'csv') {
        const out = await exportCSV(exportArgs, { table: csvTable });
        setResult({
          files: [out.filename],
          detail: `${out.rows} row${out.rows === 1 ? '' : 's'}`,
          warnings: [],
        });
      } else {
        const out = await exportPDF(exportArgs, { documents, combined });
        setResult({
          files: out.files,
          detail: `${out.pages} page${out.pages === 1 ? '' : 's'}`,
          warnings: out.warnings,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The export failed.');
    } finally {
      setBusy(false);
    }
  };

  const disabled =
    busy ||
    (format === 'pdf' && selectedDocCount === 0) ||
    (format === 'excel' && !Object.values(sheets).some(Boolean));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Export"
      subtitle="Choose a format and what to include"
      icon={<FileDocIcon />}
      size="xl"
      sheetOnMobile
    >
      <div className="pt-4 space-y-4">
        {/* ── Format ── */}
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Export format">
          {FORMATS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="radio"
              aria-checked={format === f.key}
              onClick={() => {
                setFormat(f.key);
                setResult(null);
                setError('');
              }}
              className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border-2 transition-all ${
                format === f.key
                  ? `${ACCENTS[f.accent]} border-current shadow-panel`
                  : 'border-surface-200 dark:border-surface-700 text-surface-500 dark:text-surface-400 hover:bg-surface-50 dark:hover:bg-surface-700/40'
              }`}
            >
              {f.icon}
              <span className="text-xs font-bold">{f.label}</span>
              <span className="text-[9px] leading-snug text-center opacity-80">{f.hint}</span>
            </button>
          ))}
        </div>

        {/* ── PDF options ── */}
        {format === 'pdf' && (
          <div className="space-y-2">
            <p className="text-[9px] uppercase tracking-wider font-bold text-surface-500 dark:text-surface-300">
              Documents
            </p>
            {PDF_DOCUMENTS.map((d) => (
              <Check
                key={d.key}
                id={`pdf-doc-${d.key}`}
                checked={Boolean(documents[d.key]) && !blockedBy(d)}
                disabled={Boolean(blockedBy(d))}
                disabledNote={blockedBy(d)}
                onChange={(v) => setDocuments((s) => ({ ...s, [d.key]: v }))}
                label={d.label}
                hint={d.hint}
              />
            ))}

            {selectedDocCount > 1 && (
              <div className="flex gap-2 pt-1" role="radiogroup" aria-label="File layout">
                {[
                  [true, 'One PDF', 'All documents in a single file'],
                  [false, 'Separate files', 'One PDF per document'],
                ].map(([value, label, hint]) => (
                  <button
                    key={String(value)}
                    type="button"
                    role="radio"
                    aria-checked={combined === value}
                    onClick={() => setCombined(value)}
                    className={`flex-1 p-2 rounded-lg border text-left transition-colors ${
                      combined === value
                        ? 'bg-accent-50 dark:bg-accent-900/25 border-accent-200 dark:border-accent-700'
                        : 'border-surface-200 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-700/40'
                    }`}
                  >
                    <span className="block text-[11px] font-bold text-surface-800 dark:text-surface-100">
                      {label}
                    </span>
                    <span className="block text-[9px] text-surface-500 dark:text-surface-400">
                      {hint}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Excel options ── */}
        {format === 'excel' && (
          <div className="space-y-2">
            <p className="text-[9px] uppercase tracking-wider font-bold text-surface-500 dark:text-surface-300">
              Sheets
            </p>
            {EXCEL_SHEETS.map((s) => (
              <Check
                key={s.key}
                id={`xls-sheet-${s.key}`}
                checked={Boolean(sheets[s.key]) && !blockedBy(s)}
                disabled={Boolean(blockedBy(s))}
                disabledNote={blockedBy(s)}
                onChange={(v) => setSheets((prev) => ({ ...prev, [s.key]: v }))}
                label={s.label}
              />
            ))}
          </div>
        )}

        {/* ── CSV options ── */}
        {format === 'csv' && (
          <div className="space-y-2">
            <p className="text-[9px] uppercase tracking-wider font-bold text-surface-500 dark:text-surface-300">
              Table
            </p>
            <p className="text-[10px] text-surface-500 dark:text-surface-400 leading-relaxed">
              CSV holds one table. Pick which — or take the multi-block file if you want
              everything in one place to archive.
            </p>
            {CSV_TABLES.map((t) => {
              const note = blockedBy(t);
              return (
                <label
                  key={t.key}
                  htmlFor={`csv-table-${t.key}`}
                  className={`flex items-start gap-2.5 p-2 rounded-lg border transition-colors ${
                    note
                      ? 'opacity-50 cursor-not-allowed border-surface-200 dark:border-surface-700'
                      : csvTable === t.key
                        ? 'cursor-pointer bg-accent-50 dark:bg-accent-900/25 border-accent-200 dark:border-accent-700'
                        : 'cursor-pointer border-surface-200 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-700/40'
                  }`}
                >
                  <input
                    id={`csv-table-${t.key}`}
                    type="radio"
                    name="csv-table"
                    checked={csvTable === t.key}
                    disabled={Boolean(note)}
                    onChange={() => setCsvTable(t.key)}
                    className="mt-0.5 w-3.5 h-3.5 accent-accent-600 flex-shrink-0"
                  />
                  <span className="min-w-0">
                    <span className="block text-[11px] font-bold text-surface-800 dark:text-surface-100">
                      {t.label}
                    </span>
                    <span className="block text-[9px] text-surface-500 dark:text-surface-400 leading-snug mt-0.5">
                      {note || t.hint}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {/* ── Result / errors ── */}
        {error && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800">
            <span className="text-rose-600 dark:text-rose-400 flex-shrink-0 mt-0.5">
              <WarningIcon />
            </span>
            <p className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">{error}</p>
          </div>
        )}

        {result && (
          <div className="space-y-2">
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
              <span className="text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5">
                <CheckCircleIcon />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-emerald-800 dark:text-emerald-300">
                  Downloaded {result.files.length} file{result.files.length === 1 ? '' : 's'}
                  {result.detail ? ` · ${result.detail}` : ''}
                </p>
                {result.files.map((f) => (
                  <p
                    key={f}
                    className="text-[9px] font-mono text-emerald-700/80 dark:text-emerald-400/80 truncate"
                  >
                    {f}
                  </p>
                ))}
              </div>
            </div>

            {/* Warnings the exporter raised — a script the PDF font cannot render,
                an invoice with nothing priced. Shown after the fact because the
                document is still usable; hiding them would not be. */}
            {result.warnings?.map((w, i) => (
              <div
                key={i}
                className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800"
              >
                <span className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5">
                  <WarningIcon />
                </span>
                <p className="text-[10px] leading-snug text-amber-800 dark:text-amber-300">{w}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── Action ── */}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-bold text-surface-600 dark:text-surface-300 bg-surface-100 dark:bg-surface-700/60 border border-surface-200 dark:border-surface-700 hover:bg-surface-200 dark:hover:bg-surface-700"
          >
            {result ? 'Done' : 'Cancel'}
          </button>
          <button
            type="button"
            onClick={run}
            disabled={disabled}
            className="flex-1 px-4 py-2 rounded-lg text-xs font-bold text-white bg-accent-600 hover:bg-accent-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-panel"
          >
            {busy
              ? 'Generating…'
              : format === 'pdf'
                ? `Export ${selectedDocCount || ''} document${selectedDocCount === 1 ? '' : 's'}`.replace(
                    '  ',
                    ' '
                  )
                : `Export ${format === 'excel' ? 'workbook' : 'CSV'}`}
          </button>
        </div>

        <p className="text-[9px] text-surface-400 dark:text-surface-500 leading-snug">
          Export libraries load on first use, so the first export of a session takes a moment
          longer.
        </p>
      </div>
    </Modal>
  );
};

export default ExportModal;
