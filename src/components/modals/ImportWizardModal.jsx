/**
 * ImportWizardModal — Multi-step wizard for importing product catalogs from CSV/Excel.
 *
 * Internally contains: StepIndicator, FileUploadStep, ColumnMappingStep, DataPreviewStep.
 */
import { useState, useMemo, useRef, memo, useTransition, useCallback } from 'react';
import {
  CheckCircleIcon,
  FileDocIcon,
  UploadIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  WarningIcon,
  ExcelIcon,
} from '../icons/Icons';
import Modal from '../ui/Modal';
import {
  parseFile,
  parseDimensionString,
  autoMapHeaders,
  applyMapping,
  detectColumnLocales,
  detectDimDelimiter,
} from '../../utils/fileParser';
import { FIELD_DEFS } from '../../utils/headerMap';
import { inferDimensionUnit } from '../../utils/unitInference';
import { calcCBM, fmtCBM } from '../../utils/calculations';
import { compositeKey } from '../../utils/deduplication';
import { exportRejectedRows } from '../../utils/exporting';

/* ═══════════════════════════════════════════════════════
   STEP INDICATOR
   ═══════════════════════════════════════════════════════ */
const StepIndicator = ({ currentStep }) => {
  const steps = [
    { num: 1, label: 'Upload File' },
    { num: 2, label: 'Map Columns' },
    { num: 3, label: 'Preview & Import' },
  ];
  return (
    <div className="flex items-center justify-center gap-1 mb-6">
      {steps.map((s, idx) => (
        <span key={s.num} className="contents">
          <div className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold no-theme-transition
                ${currentStep > s.num
                  ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 border-2 border-emerald-300 dark:border-emerald-700'
                  : currentStep === s.num
                    ? 'bg-accent-100 dark:bg-accent-900/50 text-accent-600 dark:text-accent-300 border-2 border-accent-400'
                    : 'bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-300 border-2 border-surface-200 dark:border-surface-700'
                }`}
            >
              {currentStep > s.num ? <CheckCircleIcon /> : s.num}
            </div>
            <span
              className={`text-xs font-medium hidden sm:block
                ${currentStep >= s.num
                  ? 'text-surface-700 dark:text-surface-50'
                  : 'text-surface-500 dark:text-surface-400'
                }`}
            >
              {s.label}
            </span>
          </div>
          {idx < steps.length - 1 && (
            <div
              className={`w-8 h-0.5 mx-1 rounded
                ${currentStep > s.num
                  ? 'bg-emerald-300 dark:bg-emerald-700'
                  : 'bg-surface-200 dark:bg-surface-700'
                }`}
            />
          )}
        </span>
      ))}
    </div>
  );
};

/* ═══════════════════════════════════════════════════════
   STEP 1 — FILE UPLOAD
   ═══════════════════════════════════════════════════════ */
const FileUploadStep = ({ onFileParsed }) => {
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [parsedFile, setParsedFile] = useState(null);
  const [selectedSheet, setSelectedSheet] = useState(null);
  const fileInputRef = useRef(null);

  const handleFile = async (file) => {
    setLoading(true);
    setError(null);
    setParsedFile(null);
    try {
      const result = await parseFile(file);
      if (result.sheetNames && result.sheetNames.length > 1) {
        setParsedFile({ ...result, fileName: file.name });
        setSelectedSheet(result.sheetNames[0]);
      } else {
        onFileParsed({ ...result, fileName: file.name });
      }
    } catch (err) {
      setError(err.message || 'Failed to parse file.');
    } finally {
      setLoading(false);
    }
  };

  const handleSheetConfirm = () => {
    if (!parsedFile || !selectedSheet) return;
    const { headers, rows } = parsedFile.parseSheet(selectedSheet);
    onFileParsed({
      headers,
      rows,
      sheetNames: parsedFile.sheetNames,
      fileName: parsedFile.fileName,
    });
  };

  // Pre-compute all sheet headers once when parsedFile changes — avoids re-parsing on every render
  const sheetInfos = useMemo(() => {
    if (!parsedFile?.sheetNames) return [];
    return parsedFile.sheetNames.map((name) => {
      const { headers } = parsedFile.parseSheet(name);
      return { name, headers };
    });
  }, [parsedFile]);

  return (
    <div className="fade-in space-y-4">
      {/* Sheet selector — shown only for multi-sheet workbooks */}
      {parsedFile && parsedFile.sheetNames && parsedFile.sheetNames.length > 1 && (
        <div className="p-4 rounded-2xl bg-accent-50/80 dark:bg-accent-950/30 border border-accent-200 dark:border-accent-800 fade-in">
          <p className="text-xs font-bold text-surface-700 dark:text-surface-300 uppercase tracking-wider mb-3">
            📋 {parsedFile.sheetNames.length} sheets found in{' '}
            <span className="text-accent-600 dark:text-accent-300">
              {parsedFile.fileName}
            </span>{' '}
            — pick one to import
          </p>
          <div className="flex flex-col gap-2 mb-4">
            {sheetInfos.map(({ name, headers }) => (
              <button
                key={name}
                type="button"
                onClick={() => setSelectedSheet(name)}
                className={`w-full text-left px-4 py-3 rounded-xl border text-sm font-semibold flex items-center justify-between gap-2
                  ${selectedSheet === name
                    ? 'bg-accent-50 dark:bg-accent-900/40 border-accent-300 dark:border-accent-700 text-accent-700 dark:text-accent-300'
                    : 'bg-white dark:bg-surface-800 border-surface-200 dark:border-surface-700 text-surface-700 dark:text-surface-50 hover:border-accent-300'
                  }`}
              >
                <span>📄 {name}</span>
                <span className="text-[11px] font-normal text-surface-500 dark:text-surface-300 truncate">
                  {headers.length} columns
                  {headers.length > 0
                    ? `: ${headers.slice(0, 4).join(', ')}${headers.length > 4 ? ` +${headers.length - 4} more` : ''}`
                    : ' (empty)'}
                </span>
              </button>
            ))}
          </div>
          <button
            onClick={handleSheetConfirm}
            disabled={!selectedSheet}
            className="w-full py-2.5 rounded-xl bg-accent-600 hover:bg-accent-700 text-white font-bold text-sm disabled:opacity-50"
          >
            Use &quot;{selectedSheet}&quot; →
          </button>
        </div>
      )}

      <div
        id="file-drop-zone"
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files[0];
          if (f) handleFile(f);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer
          ${dragOver
            ? 'border-accent-400 bg-accent-50 dark:bg-accent-950/50 scale-[1.01] drag-pulse'
            : 'border-surface-300 dark:border-surface-700 bg-surface-50/80 dark:bg-surface-800/50 hover:border-accent-300 hover:bg-accent-50/50 dark:hover:bg-accent-950/30'
          }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={(e) => {
            if (e.target.files[0]) handleFile(e.target.files[0]);
          }}
          className="hidden"
          id="file-upload-input"
        />
        {loading ? (
          <div className="flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-2 border-accent-200 border-t-accent-500 rounded-full spinner" />
            <p className="text-sm text-surface-700 dark:text-surface-300 font-medium">
              Parsing your file…
            </p>
          </div>
        ) : (
          <>
            <div
              className={`flex justify-center mb-4 ${dragOver
                ? 'text-accent-500'
                : 'text-surface-500 dark:text-surface-300'
                }`}
            >
              <UploadIcon />
            </div>
            <p className="text-sm font-semibold text-surface-700 dark:text-surface-50 mb-1">
              {dragOver
                ? 'Drop your file here'
                : 'Drag & drop your product catalog'}
            </p>
            <p className="text-xs text-surface-500 dark:text-surface-300">
              or{' '}
              <span className="text-accent-500 underline underline-offset-2 font-semibold">
                browse files
              </span>
            </p>
            <div className="flex items-center justify-center gap-3 mt-5">
              {[
                ['CSV', 'emerald'],
                ['XLSX', 'blue'],
                ['XLS', 'accent'],
              ].map(([ext, c]) => (
                <span
                  key={ext}
                  className={`px-2.5 py-1 rounded-md bg-${c}-50 dark:bg-${c}-950/50 border border-${c}-200 dark:border-${c}-800 text-[11px] font-bold text-${c}-700 dark:text-${c}-400`}
                >
                  .{ext}
                </span>
              ))}
            </div>
          </>
        )}
      </div>
      {error && (
        <div className="mt-4 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center gap-2 fade-in">
          <span className="text-rose-500 flex-shrink-0">
            <WarningIcon />
          </span>
          <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>
        </div>
      )}
    </div>
  );
};


/* ═══════════════════════════════════════════════════════
   STEP 2 — COLUMN MAPPING
   ═══════════════════════════════════════════════════════ */

/** Fields always shown. */
const CORE_FIELDS = ['packingString', 'packSize', 'netWeight', 'grossWeight'];
/** Trade / logistics fields, hidden until asked for so the grid stays scannable. */
const ADVANCED_FIELDS = [
  'unit', 'quantity', 'sku', 'hsCode', 'unitPrice', 'currency', 'origin', 'marks',
];

const FIELD_ICONS = {
  name: '🏷️', length: '📏', width: '📐', height: '📦', cbm: '🔷',
  packingString: '📝', packSize: '📋', netWeight: '⚖️', grossWeight: '🏋️',
  unit: '📐', quantity: '🔢', sku: '#️⃣', hsCode: '🧾', unitPrice: '💰',
  currency: '💱', origin: '🌍', marks: '✒️',
};

/** Small badge showing how confident the automatic mapping was. */
const ConfidenceBadge = ({ level }) => {
  if (!level) return null;
  const styles = {
    high: 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
    medium: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-400 border-sky-200 dark:border-sky-800',
    confirm: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  };
  const labels = { high: 'auto', medium: 'auto?', confirm: 'check' };
  const titles = {
    high: 'Matched automatically with high confidence',
    medium: 'Matched automatically — worth a glance',
    confirm: 'Loose match — please confirm this is the right column',
  };
  return (
    <span
      title={titles[level]}
      className={`ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide border ${styles[level]}`}
    >
      {labels[level]}
    </span>
  );
};

const ColumnMappingStep = ({ headers, rows, onMappingComplete, onBack }) => {
  const autoMap = useMemo(() => autoMapHeaders(headers), [headers]);

  const [mapping, setMapping] = useState(() => {
    const init = {};
    for (const key of Object.keys(FIELD_DEFS)) {
      if (key === 'dims') continue;
      init[key] = autoMap.mapping[key] || '';
    }
    return init;
  });
  const [combinedDim, setCombinedDim] = useState(!!autoMap.combinedDimColumn);
  const [dimColumn, setDimColumn] = useState(autoMap.combinedDimColumn || '');
  const [manualDelimiter, setManualDelimiter] = useState('');
  const [importUnit, setImportUnit] = useState('cm');
  // Weight basis: are the weight columns per-shipper (carton) or per-unit (piece)?
  const [netWeightBasis, setNetWeightBasis] = useState('shipper');
  const [grossWeightBasis, setGrossWeightBasis] = useState('shipper');
  const [importTarget, setImportTarget] = useState('directory');
  const [showAdvanced, setShowAdvanced] = useState(
    () => ADVANCED_FIELDS.some((f) => autoMap.mapping[f])
  );
  const [unitHintDismissed, setUnitHintDismissed] = useState(false);

  /* Per-column number formats, so an ambiguous "1,234" is read consistently. */
  const locales = useMemo(() => detectColumnLocales(rows, mapping), [rows, mapping]);

  /* Auto-detect the combined-dimension separator instead of always assuming 'x',
     which silently pushed files using '*' or '×' onto the loose fallback path.
     Derived rather than stored in state: an empty `manualDelimiter` means "still
     using detection", so the detected value follows a change of column for free. */
  const detectedDelimiter = useMemo(() => {
    if (!combinedDim || !dimColumn) return 'x';
    return detectDimDelimiter((rows || []).map((r) => r?.[dimColumn]));
  }, [combinedDim, dimColumn, rows]);

  const delimiterTouched = manualDelimiter !== '';
  const delimiter = delimiterTouched ? manualDelimiter : detectedDelimiter;

  const dimPreview = useMemo(() => {
    if (!combinedDim || !dimColumn || !rows[0]) return null;
    const raw = String(rows[0][dimColumn] || '');
    return { raw, parsed: parseDimensionString(raw, delimiter) };
  }, [combinedDim, dimColumn, delimiter, rows]);

  /* Does the file's own data agree with the selected unit? */
  const unitHint = useMemo(() => {
    if (combinedDim) return { suggested: null };
    return inferDimensionUnit(rows, mapping, importUnit, locales);
  }, [rows, mapping, importUnit, locales, combinedDim]);

  const applyUnitSuggestion = useCallback(() => {
    if (unitHint.suggested) setImportUnit(unitHint.suggested);
    setUnitHintDismissed(false);
  }, [unitHint.suggested]);

  const canProceed =
    mapping.name &&
    (combinedDim
      ? !!dimColumn
      : (!!mapping.length && !!mapping.width && !!mapping.height) || !!mapping.cbm);

  const handleNext = () => {
    const dimConfig = {
      combined: combinedDim,
      column: combinedDim ? dimColumn : null,
      delimiter: combinedDim ? delimiter : null,
      unit: importUnit,
      netWeightBasis,
      grossWeightBasis,
      locales,
    };
    const finalMapping = { ...mapping };
    // Drop empty selections so `mapping.x` is falsy for unmapped fields.
    for (const k of Object.keys(finalMapping)) {
      if (!finalMapping[k]) delete finalMapping[k];
    }
    if (combinedDim) {
      delete finalMapping.length;
      delete finalMapping.width;
      delete finalMapping.height;
    }
    onMappingComplete({ mapping: finalMapping, dimConfig, importTarget });
  };

  const selClass = (hasValue) =>
    `w-full max-w-full bg-white/80 dark:bg-surface-800/80 border rounded-xl px-3 py-2.5 text-sm font-medium
     text-surface-800 dark:text-surface-50
     focus:outline-none focus:ring-2 focus:ring-accent-500/40 focus:border-accent-400/70
     ${hasValue
      ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/30 dark:bg-emerald-950/20'
      : 'border-surface-200 dark:border-surface-700'
    }`;

  /* Show the badge only while the auto-guess is still in place — once the user
     picks a column themselves, confidence in our guess is irrelevant. */
  const badgeFor = (field) =>
    mapping[field] && mapping[field] === autoMap.mapping[field]
      ? autoMap.confidence[field]
      : null;

  const dimsMapped = !!mapping.length && !!mapping.width && !!mapping.height;

  const fieldRow = (key, requiredOverride) => {
    const def = FIELD_DEFS[key];
    const required = requiredOverride ?? def?.required ?? false;
    return (
      <div key={key} className="space-y-1.5 min-w-0">
        <label
          htmlFor={`map-${key}`}
          className="flex items-center gap-1.5 text-xs font-semibold text-surface-500 dark:text-surface-300 uppercase tracking-wider"
        >
          <span>{FIELD_ICONS[key] || '•'}</span>
          <span className="truncate">{def?.label || key}</span>
          {required && <span className="text-rose-400 flex-shrink-0">*</span>}
          <ConfidenceBadge level={badgeFor(key)} />
        </label>
        <select
          id={`map-${key}`}
          value={mapping[key] || ''}
          onChange={(e) => setMapping((p) => ({ ...p, [key]: e.target.value }))}
          className={selClass(!!mapping[key])}
        >
          <option value="">— Select —</option>
          {headers.map((h) => (
            <option key={h} value={h}>
              {h}
            </option>
          ))}
        </select>
      </div>
    );
  };

  const visibleCoreFields = [
    'name',
    ...(!combinedDim ? ['length', 'width', 'height', 'cbm'] : []),
    ...CORE_FIELDS,
  ];

  return (
    <div className="fade-in space-y-5">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-surface-500 dark:text-surface-300 font-semibold flex-shrink-0">
          Columns found:
        </span>
        <div className="flex flex-wrap gap-1.5">
          {headers.map((h) => (
            <span
              key={h}
              className="text-[11px] bg-surface-100 dark:bg-surface-700 text-surface-700 dark:text-surface-300 border border-surface-200 dark:border-surface-700 px-2 py-0.5 rounded-full font-medium truncate max-w-[120px]"
            >
              {h}
            </span>
          ))}
        </div>
      </div>

      {/* Import destination */}
      <div className="p-4 rounded-xl bg-surface-50 dark:bg-surface-800/60 border border-surface-200 dark:border-surface-700">
        <p className="text-xs font-bold text-surface-700 dark:text-surface-300 uppercase tracking-wider mb-3">
          📥 Import into
        </p>
        <div className="flex gap-1 p-1 rounded-full bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
          {[
            ['directory', 'Product Directory'],
            ['shipment', 'Active Shipment'],
          ].map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setImportTarget(val)}
              className={`flex-1 py-2 px-3 text-[11px] font-bold uppercase tracking-wide rounded-full focus:outline-none
                ${importTarget === val
                  ? 'bg-accent-600 text-white shadow-panel'
                  : 'text-surface-500 dark:text-surface-300 hover:text-surface-700 dark:hover:text-surface-50'
                }`}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-surface-500 dark:text-surface-300 mt-2">
          {importTarget === 'directory'
            ? 'Products are saved to your catalog for reuse.'
            : 'Rows go straight into the current shipment. Map a Quantity column to set carton counts.'}
        </p>
      </div>

      {/* Combined dimension toggle */}
      <div className="p-4 rounded-xl bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/50">
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <div
            className="flex-shrink-0 mt-0.5"
            onClick={(e) => {
              e.preventDefault();
              setCombinedDim((p) => !p);
            }}
          >
            <div
              className={`w-11 h-6 rounded-full relative ${combinedDim
                ? 'bg-accent-600'
                : 'bg-surface-300 dark:bg-surface-700'
                }`}
            >
              <div
                className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow theme-pill ${combinedDim ? 'left-[22px]' : 'left-0.5'
                  }`}
              />
            </div>
          </div>
          <div className="min-w-0">
            <span className="text-sm font-semibold text-surface-700 dark:text-surface-50">
              Dimensions combined in one column
            </span>
            <p className="text-[11px] text-surface-500 dark:text-surface-300 mt-0.5 break-words">
              Enable if your file uses values like &quot;50x40x30&quot; instead of
              separate L/W/H columns
            </p>
          </div>
        </label>
        {combinedDim && (
          <div className="mt-4 space-y-3 fade-in">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 min-w-0">
                <label
                  htmlFor="dim-column-select"
                  className="block text-xs font-semibold text-surface-500 dark:text-surface-300 uppercase tracking-wider"
                >
                  Dimension Column
                </label>
                <select
                  id="dim-column-select"
                  value={dimColumn}
                  onChange={(e) => {
                    setDimColumn(e.target.value);
                    setManualDelimiter(''); // hand control back to auto-detection
                  }}
                  className={selClass(!!dimColumn)}
                >
                  <option value="">— Select —</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5 min-w-0">
                <label
                  htmlFor="delimiter-input"
                  className="flex items-center gap-1.5 text-xs font-semibold text-surface-500 dark:text-surface-300 uppercase tracking-wider"
                >
                  <span>Delimiter</span>
                  {!delimiterTouched && dimColumn && (
                    <ConfidenceBadge level="high" />
                  )}
                </label>
                <input
                  id="delimiter-input"
                  type="text"
                  value={delimiter}
                  onChange={(e) => setManualDelimiter(e.target.value)}
                  placeholder="x"
                  className="w-full max-w-full bg-white/80 dark:bg-surface-800/80 border border-surface-200 dark:border-surface-700 rounded-xl px-3 py-2.5 text-sm font-medium text-surface-800 dark:text-surface-50 focus:outline-none focus:ring-2 focus:ring-accent-500/40"
                />
              </div>
            </div>
            {dimPreview && (
              <div className="p-3 rounded-lg bg-white/80 dark:bg-surface-800/60 border border-amber-200 dark:border-amber-800/50 fade-in overflow-x-auto">
                <p className="text-[10px] text-surface-500 dark:text-surface-300 uppercase tracking-wider mb-2 font-bold">
                  Parsing Preview (Row 1)
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-surface-700 dark:text-surface-300 bg-surface-100 dark:bg-surface-700 px-2.5 py-1 rounded truncate max-w-[160px]">
                    &quot;{dimPreview.raw}&quot;
                  </span>
                  <span className="text-surface-400 text-base">→</span>
                  {dimPreview.parsed ? (
                    <span className="text-xs font-mono text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded border border-emerald-200 dark:border-emerald-800 font-semibold whitespace-nowrap">
                      L:{dimPreview.parsed.length} × W:{dimPreview.parsed.width}{' '}
                      × H:{dimPreview.parsed.height}
                    </span>
                  ) : (
                    <span className="text-xs text-rose-600 dark:text-rose-400 flex items-center gap-1 font-medium">
                      <WarningIcon /> Cannot parse — try a different delimiter
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dimension unit selector */}
      <div className="p-4 rounded-xl bg-sky-50/80 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-800/50">
        <p className="text-xs font-bold text-surface-700 dark:text-surface-300 uppercase tracking-wider mb-3">
          📐 Dimension Unit in this file
        </p>
        <div className="grid grid-cols-5 gap-2">
          {['mm', 'cm', 'inches', 'feet', 'meters'].map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => {
                setImportUnit(u);
                setUnitHintDismissed(false);
              }}
              className={`py-2 px-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide truncate
                ${importUnit === u
                  ? 'bg-accent-50 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300 border border-accent-300 dark:border-accent-700'
                  : 'bg-white dark:bg-surface-800 text-surface-500 dark:text-surface-300 border border-surface-200 dark:border-surface-700 hover:border-surface-300'
                }`}
            >
              {u}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-surface-500 dark:text-surface-300 mt-2">
          {mapping.unit
            ? `Used only for rows where the "${mapping.unit}" column is blank or unrecognised.`
            : 'Select the unit your L/W/H values are measured in. Default is cm.'}
        </p>

        {/* Unit inference — suggests, never silently rewrites */}
        {unitHint.suggested && !unitHintDismissed && (
          <div className="mt-3 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 fade-in">
            <div className="flex items-start gap-2">
              <span className="text-amber-500 flex-shrink-0 mt-0.5">
                <WarningIcon />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-amber-700 dark:text-amber-400">
                  These dimensions look like <strong>{unitHint.suggested}</strong>, not{' '}
                  <strong>{importUnit}</strong>.
                </p>
                <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 mt-0.5">
                  {unitHint.reason}
                </p>
              </div>
            </div>
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                onClick={applyUnitSuggestion}
                className="flex-1 py-1.5 px-2 rounded-lg text-[10px] font-bold uppercase tracking-wide bg-amber-500 hover:bg-amber-400 text-white shadow-sm active:scale-[0.98]"
              >
                Use {unitHint.suggested}
              </button>
              <button
                type="button"
                onClick={() => setUnitHintDismissed(true)}
                className="flex-1 py-1.5 px-2 rounded-lg text-[10px] font-bold uppercase tracking-wide bg-white dark:bg-surface-800 text-amber-700 dark:text-amber-400 border border-amber-300 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/60 active:scale-[0.98]"
              >
                Keep {importUnit}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Mapping dropdowns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {visibleCoreFields.map((key) => {
          // Length/width/height and CBM are alternatives: either satisfies the step.
          if (key === 'cbm') return fieldRow(key, !dimsMapped);
          if (['length', 'width', 'height'].includes(key)) {
            return fieldRow(key, !mapping.cbm);
          }
          return fieldRow(key);
        })}
      </div>

      {/* Advanced / trade fields */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((p) => !p)}
          className="flex items-center gap-2 text-xs font-bold text-accent-600 dark:text-accent-300 hover:underline"
        >
          <span>{showAdvanced ? '−' : '+'}</span>
          {showAdvanced ? 'Hide' : 'Show'} more fields
          <span className="font-normal text-surface-500 dark:text-surface-400">
            (unit, quantity, HS code, price, origin…)
          </span>
        </button>
        {showAdvanced && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 fade-in">
            {ADVANCED_FIELDS.map((key) => fieldRow(key))}
          </div>
        )}
      </div>

      {/* Weight basis — only shown when a weight column is mapped */}
      {(mapping.netWeight || mapping.grossWeight) && (
        <div className="p-4 rounded-xl bg-accent-50/80 dark:bg-accent-950/20 border border-accent-200 dark:border-accent-800/50 fade-in space-y-3">
          <p className="text-xs font-bold text-surface-700 dark:text-surface-300 uppercase tracking-wider">
            ⚖️ What do your weight columns represent?
          </p>
          {mapping.netWeight && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-xs font-semibold text-surface-700 dark:text-surface-300 truncate">
                Net Weight (&quot;{mapping.netWeight}&quot;)
              </span>
              <div className="flex items-center bg-white dark:bg-surface-800 rounded-lg p-0.5 border border-surface-200 dark:border-surface-700">
                {[
                  ['shipper', 'Per Shipper'],
                  ['unit', 'Per Piece'],
                ].map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setNetWeightBasis(val)}
                    className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase ${netWeightBasis === val
                      ? 'bg-accent-50 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300 shadow-sm'
                      : 'text-surface-500 dark:text-surface-300'
                      }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {mapping.grossWeight && (
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-xs font-semibold text-surface-700 dark:text-surface-300 truncate">
                Gross Weight (&quot;{mapping.grossWeight}&quot;)
              </span>
              <div className="flex items-center bg-white dark:bg-surface-800 rounded-lg p-0.5 border border-surface-200 dark:border-surface-700">
                {[
                  ['shipper', 'Per Shipper'],
                  ['unit', 'Per Piece'],
                ].map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setGrossWeightBasis(val)}
                    className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase ${grossWeightBasis === val
                      ? 'bg-accent-50 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300 shadow-sm'
                      : 'text-surface-500 dark:text-surface-300'
                      }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <p className="text-[11px] text-surface-500 dark:text-surface-300">
            &quot;Per Shipper&quot; = the value is for a whole carton/box. &quot;Per
            Piece&quot; = the value is for one unit inside the carton.
          </p>
        </div>
      )}

      {/* Navigation */}
      <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
        <button
          id="mapping-back-btn"
          onClick={onBack}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-surface-700 dark:text-surface-300 bg-surface-100 dark:bg-surface-700 border border-surface-200 dark:border-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600"
        >
          <ArrowLeftIcon /> Back
        </button>
        <button
          id="mapping-next-btn"
          onClick={handleNext}
          disabled={!canProceed}
          className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold
            ${canProceed
              ? 'bg-accent-600 text-white hover:bg-accent-700 active:scale-[0.98]'
              : 'bg-surface-100 dark:bg-surface-700 text-surface-400 cursor-not-allowed border border-surface-200 dark:border-surface-700'
            }`}
        >
          Preview Data <ArrowRightIcon />
        </button>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════
   STEP 3 — PREVIEW & IMPORT
   ═══════════════════════════════════════════════════════ */
const DataPreviewStep = memo(({
  rows,
  mapping,
  dimConfig,
  existingProducts,
  onImport,
  onBack,
  importTarget = 'directory',
  truncated = false,
  totalRows = 0,
}) => {
  const allTagged = useMemo(
    () => applyMapping(rows, mapping, dimConfig),
    [rows, mapping, dimConfig]
  );

  const taggedProducts = useMemo(() => {
    const existingSigs = new Set(existingProducts.map((p) => compositeKey(p)));
    const batchSigs = new Set();
    return allTagged.map((p) => {
      if (p.status === 'skipped') return p;
      const sig = compositeKey(p);
      if (existingSigs.has(sig) || batchSigs.has(sig)) {
        return { ...p, status: 'skipped', skipReason: 'Exact Duplicate' };
      }
      batchSigs.add(sig);
      return p;
    });
  }, [allTagged, existingProducts]);

  /* Warned rows still import — the warning is advisory, not a rejection. */
  const importableProducts = useMemo(
    () =>
      taggedProducts
        .filter((p) => p.status !== 'skipped')
        .map((p) => {
          const clean = { ...p };
          delete clean.status;
          delete clean.skipReason;
          delete clean.warnings;
          delete clean.detail;
          return clean;
        }),
    [taggedProducts]
  );

  const rejectedRows = useMemo(
    () => taggedProducts.filter((p) => p.status === 'skipped'),
    [taggedProducts]
  );

  const counts = useMemo(
    () => ({
      new: taggedProducts.filter((p) => p.status === 'new').length,
      warn: taggedProducts.filter((p) => p.status === 'warn').length,
      skipped: rejectedRows.length,
      total: rows.length,
    }),
    [taggedProducts, rejectedRows.length, rows.length]
  );

  const [activeFilter, setActiveFilter] = useState('all');
  const [importing, setImporting] = useState(false);
  const [, startTransition] = useTransition();

  const setFilter = useCallback((f) => {
    startTransition(() => setActiveFilter(f));
  }, []);

  const handleImport = () => {
    setImporting(true);
    // Forward the in-file skip count so the result toast is accurate.
    setTimeout(
      () => onImport(importableProducts, { skippedInFile: counts.skipped, importTarget }),
      500
    );
  };

  const visibleRows = useMemo(() => {
    if (activeFilter === 'all') return taggedProducts;
    return taggedProducts.filter((p) => p.status === activeFilter);
  }, [taggedProducts, activeFilter]);

  const chipDefs = [
    {
      key: 'new',
      label: `✓ ${counts.new} clean`,
      base: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400',
      active: 'ring-2 ring-emerald-400 dark:ring-emerald-600 scale-[1.04]',
    },
    {
      key: 'warn',
      label: `! ${counts.warn} to review`,
      base: 'bg-sky-50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-400',
      active: 'ring-2 ring-sky-400 dark:ring-sky-600 scale-[1.04]',
      hide: counts.warn === 0,
    },
    {
      key: 'skipped',
      label: `⚠ ${counts.skipped} rejected`,
      base: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400',
      active: 'ring-2 ring-amber-400 dark:ring-amber-600 scale-[1.04]',
      hide: counts.skipped === 0,
    },
    {
      key: 'all',
      label: `${counts.total} total`,
      base: 'bg-surface-50 dark:bg-surface-700/50 border-surface-200 dark:border-surface-700 text-surface-700 dark:text-surface-300',
      active: 'ring-2 ring-surface-300 dark:ring-surface-700 scale-[1.04]',
    },
  ];

  const rowStatusBadge = (p) => {
    if (p.status === 'skipped') {
      return (
        <span className="ml-1.5 inline-flex items-center gap-1 flex-shrink-0">
          <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-700 uppercase tracking-wide">
            skip
          </span>
          {p.skipReason && (
            <span
              className="text-[9px] text-rose-500 dark:text-rose-400 font-medium"
              title={p.detail || p.skipReason}
            >
              {p.skipReason}
            </span>
          )}
        </span>
      );
    }
    if (p.status === 'warn') {
      return (
        <span className="ml-1.5 inline-flex items-center gap-1 flex-shrink-0">
          <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-700 uppercase tracking-wide">
            check
          </span>
          <span
            className="text-[9px] text-sky-600 dark:text-sky-400 font-medium truncate max-w-[140px]"
            title={(p.warnings || []).join(' · ')}
          >
            {(p.warnings || [])[0]}
            {p.warnings?.length > 1 ? ` +${p.warnings.length - 1}` : ''}
          </span>
        </span>
      );
    }
    return (
      <span className="ml-1.5 inline-block px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-700 uppercase tracking-wide flex-shrink-0">
        new
      </span>
    );
  };

  return (
    <div className="fade-in space-y-4">
      {/* Clickable filter chips */}
      <div className="flex flex-wrap gap-2">
        {chipDefs
          .filter((c) => !c.hide)
          .map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() =>
                setFilter(activeFilter === chip.key ? 'all' : chip.key)
              }
              className={`px-3 py-1.5 rounded-lg border text-xs font-bold cursor-pointer
                ${chip.base}
                ${activeFilter === chip.key ? chip.active : 'opacity-80 hover:opacity-100'}`}
            >
              {chip.label}
            </button>
          ))}
      </div>

      {/* Row-cap notice — never let truncation pass silently as "imported everything" */}
      {truncated && (
        <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 flex items-start gap-2">
          <span className="text-amber-500 flex-shrink-0 mt-0.5">
            <WarningIcon />
          </span>
          <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">
            This file has <strong>{totalRows.toLocaleString()}</strong> rows — only the
            first <strong>{rows.length.toLocaleString()}</strong> are being read. Split
            the file to import the rest.
          </p>
        </div>
      )}

      {/* Recover the rejected rows rather than losing them */}
      {counts.skipped > 0 && (
        <div className="p-3 rounded-xl bg-surface-50 dark:bg-surface-800/60 border border-surface-200 dark:border-surface-700 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[11px] text-surface-600 dark:text-surface-300 min-w-0">
            <strong>{counts.skipped}</strong> row{counts.skipped === 1 ? '' : 's'} will not
            be imported. Download them with their original columns and the reason.
          </p>
          <button
            type="button"
            onClick={() => exportRejectedRows(rejectedRows)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/30 flex-shrink-0"
          >
            <ExcelIcon /> Download rejected rows
          </button>
        </div>
      )}

      {/* Full scrollable preview table */}
      <div className="rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
        <div className="bg-surface-50 dark:bg-surface-800 px-4 py-2.5 border-b border-surface-200 dark:border-surface-700 flex items-center justify-between">
          <p className="text-xs font-bold text-surface-700 dark:text-surface-300 uppercase tracking-wider">
            {activeFilter === 'all'
              ? `All ${taggedProducts.length} rows`
              : `Showing ${visibleRows.length} ${activeFilter} rows`}
          </p>
          {activeFilter !== 'all' && (
            <button
              onClick={() => setActiveFilter('all')}
              className="text-[10px] text-accent-500 dark:text-accent-300 font-bold hover:underline"
            >
              Show all
            </button>
          )}
        </div>
        <div className="overflow-x-auto max-h-64 overflow-y-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-surface-50/90 dark:bg-surface-800/90 border-b border-surface-200 dark:border-surface-700 backdrop-blur-sm">
                {['Name', 'L', 'W', 'H', 'Pack', 'Net Wt/Ship', 'Gross Wt/Ship', 'CBM'].map(
                  (h, i) => (
                    <th
                      key={h}
                      className={`${i === 0 ? 'text-left px-4' : 'text-right px-3'} py-2.5 text-[11px] font-bold ${i === 7 ? 'text-accent-600 dark:text-accent-300' : 'text-surface-500 dark:text-surface-300'} uppercase tracking-wider`}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {(() => {
                const previewLimit = 100;
                if (visibleRows.length === 0) {
                  return (
                    <tr>
                      <td colSpan={8} className="px-4 py-10 text-center">
                        <div className="flex flex-col items-center gap-2 text-surface-400">
                          <WarningIcon />
                          <p className="text-sm font-medium">
                            No rows in this category
                          </p>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <>
                    {visibleRows.slice(0, previewLimit).map((p, i) => {
                      const isSkipped = p.status === 'skipped';
                      const isWarn = p.status === 'warn';
                      const cbm = isSkipped
                        ? 'N/A'
                        : p.length > 0 && p.width > 0 && p.height > 0
                          ? fmtCBM(calcCBM(p.length, p.width, p.height, p.unit || 'cm'))
                          : (p.cbmPerShipper || 0) > 0
                            ? fmtCBM(p.cbmPerShipper)
                            : 'N/A';
                      return (
                        <tr
                          key={i}
                          className={`border-t border-surface-100 dark:border-surface-700/60
                            ${isSkipped
                              ? 'bg-amber-50/40 dark:bg-amber-950/10 opacity-70'
                              : isWarn
                                ? 'bg-sky-50/40 dark:bg-sky-950/10'
                                : 'hover:bg-accent-50/30 dark:hover:bg-accent-950/20'
                            }`}
                        >
                          <td className="px-4 py-2.5 font-semibold text-surface-800 dark:text-surface-50 max-w-[180px]">
                            <div className="flex items-center flex-wrap gap-y-0.5">
                              <span className="truncate" title={p.name}>
                                {p.name}
                              </span>
                              {rowStatusBadge(p)}
                            </div>
                          </td>
                          {[
                            p.length || 'N/A',
                            p.width || 'N/A',
                            p.height || 'N/A',
                            p.packingString || p.packSize,
                            // Show per-shipper net weight (= what was in the original CSV column)
                            // netWeightPerUnit was divided by packSize on import; multiply back for display
                            +((p.netWeightPerUnit || 0) * (p.packSize || 1)).toFixed(3),
                            p.grossWeightPerShipper,
                          ].map((v, j) => (
                            <td
                              key={j}
                              className={`px-3 py-2.5 text-right font-mono text-xs ${isSkipped
                                ? 'text-surface-400 dark:text-surface-500'
                                : 'text-surface-700 dark:text-surface-300'
                                }`}
                            >
                              {v}
                            </td>
                          ))}
                          <td
                            className={`px-4 py-2.5 text-right font-mono font-bold text-xs ${isSkipped
                              ? 'text-surface-400 dark:text-surface-500'
                              : 'text-accent-600 dark:text-accent-300'
                              }`}
                          >
                            {cbm}
                          </td>
                        </tr>
                      );
                    })}
                    {visibleRows.length > previewLimit && (
                      <tr className="border-t-2 border-accent-200 dark:border-accent-800">
                        <td
                          colSpan={8}
                          className="px-4 py-3 text-center bg-accent-50/60 dark:bg-accent-950/30"
                        >
                          <span className="text-xs font-bold text-accent-600 dark:text-accent-300">
                            + {visibleRows.length - previewLimit} more rows… (All{' '}
                            {visibleRows.length} will be imported)
                          </span>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })()}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
        <button
          id="preview-back-btn"
          onClick={onBack}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-surface-700 dark:text-surface-300 bg-surface-100 dark:bg-surface-700 border border-surface-200 dark:border-surface-700 hover:bg-surface-200 dark:hover:bg-surface-600"
        >
          <ArrowLeftIcon /> Back
        </button>
        <button
          id="import-catalog-btn"
          onClick={handleImport}
          disabled={importableProducts.length === 0 || importing}
          className={`flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold
            ${importableProducts.length > 0 && !importing
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
              : 'bg-surface-100 dark:bg-surface-700 text-surface-400 cursor-not-allowed border border-surface-200 dark:border-surface-700'
            }`}
        >
          {importing ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full spinner" />{' '}
              Importing…
            </>
          ) : (
            <>
              <CheckCircleIcon /> Import {importableProducts.length}{' '}
              {importTarget === 'shipment' ? 'to Shipment' : 'Products'}
            </>
          )}
        </button>
      </div>
    </div>
  );
});

DataPreviewStep.displayName = 'DataPreviewStep';

/* ═══════════════════════════════════════════════════════
   IMPORT WIZARD MODAL (main export)
   ═══════════════════════════════════════════════════════ */
const ImportWizardModal = memo(({ isOpen, onClose, onImport, existingProducts }) => {
  const [step, setStep] = useState(1);
  const [fileData, setFileData] = useState(null);
  const [mappingConfig, setMappingConfig] = useState(null);
  const [isPending, startTransition] = useTransition();

  const handleClose = useCallback(() => {
    setStep(1);
    setFileData(null);
    setMappingConfig(null);
    onClose();
  }, [onClose]);

  const handleImport = useCallback((products, meta) => {
    onImport(products, meta);
    handleClose();
  }, [onImport, handleClose]);

  const handleFileParsed = useCallback((d) => {
    startTransition(() => {
      setFileData(d);
      setStep(2);
    });
  }, []);

  const handleMappingComplete = useCallback((cfg) => {
    startTransition(() => {
      setMappingConfig(cfg);
      setStep(3);
    });
  }, []);

  const handleBackToStep1 = useCallback(() => {
    setStep(1);
    setFileData(null);
  }, []);

  const handleBackToStep2 = useCallback(() => setStep(2), []);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Import Product Catalog"
      subtitle={
        fileData
          ? `${fileData.fileName} · ${fileData.rows.length} rows · ${fileData.headers.length} cols`
          : undefined
      }
      icon={<FileDocIcon />}
      size="xl"
      maxHeight="max-h-[95vh]"
      sheetOnMobile
      stickyTop={
        <>
          <div className="px-5 sm:px-6 pt-5">
            <StepIndicator currentStep={step} />
          </div>
          {/* Transition pending indicator */}
          {isPending && (
            <div className="px-5 sm:px-6 pb-2">
              <div className="h-0.5 w-full bg-surface-100 dark:bg-surface-800 rounded-full overflow-hidden">
                <div className="h-full bg-accent-500 animate-pulse rounded-full w-3/4" />
              </div>
            </div>
          )}
        </>
      }
    >
      {step === 1 && <FileUploadStep onFileParsed={handleFileParsed} />}
      {step === 2 && fileData && (
        <ColumnMappingStep
          headers={fileData.headers}
          rows={fileData.rows}
          onMappingComplete={handleMappingComplete}
          onBack={handleBackToStep1}
        />
      )}
      {step === 3 && fileData && mappingConfig && (
        <DataPreviewStep
          rows={fileData.rows}
          mapping={mappingConfig.mapping}
          dimConfig={mappingConfig.dimConfig}
          importTarget={mappingConfig.importTarget}
          truncated={fileData.truncated}
          totalRows={fileData.totalRows || fileData.rows.length}
          existingProducts={existingProducts}
          onImport={handleImport}
          onBack={handleBackToStep2}
        />
      )}
    </Modal>
  );
});

ImportWizardModal.displayName = 'ImportWizardModal';

export default ImportWizardModal;
