/**
 * ImportWizardModal — Multi-step wizard for importing product catalogs from CSV/Excel.
 *
 * Internally contains: StepIndicator, FileUploadStep, ColumnMappingStep, DataPreviewStep.
 */
import { useState, useMemo, useRef } from 'react';
import {
  CheckCircleIcon,
  CloseIcon,
  FileDocIcon,
  UploadIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  WarningIcon,
} from '../icons/Icons';
import { parseFile, parseDimensionString, autoMapHeaders, applyMapping } from '../../utils/fileParser';
import { calcCBM } from '../../utils/calculations';
import { compositeKey } from '../../utils/deduplication';

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
                ${
                  currentStep > s.num
                    ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 border-2 border-emerald-300 dark:border-emerald-700'
                    : currentStep === s.num
                      ? 'bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 border-2 border-indigo-400 shadow-glow'
                      : 'bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500 border-2 border-slate-200 dark:border-slate-600'
                }`}
            >
              {currentStep > s.num ? <CheckCircleIcon /> : s.num}
            </div>
            <span
              className={`text-xs font-medium hidden sm:block
                ${
                  currentStep >= s.num
                    ? 'text-slate-700 dark:text-slate-200'
                    : 'text-slate-400 dark:text-slate-600'
                }`}
            >
              {s.label}
            </span>
          </div>
          {idx < steps.length - 1 && (
            <div
              className={`w-8 h-0.5 mx-1 rounded
                ${
                  currentStep > s.num
                    ? 'bg-emerald-300 dark:bg-emerald-700'
                    : 'bg-slate-200 dark:bg-slate-700'
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

  return (
    <div className="fade-in space-y-4">
      {/* Sheet selector — shown only for multi-sheet workbooks */}
      {parsedFile && parsedFile.sheetNames && parsedFile.sheetNames.length > 1 && (
        <div className="p-4 rounded-2xl bg-indigo-50/80 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 fade-in">
          <p className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-3">
            📋 {parsedFile.sheetNames.length} sheets found in{' '}
            <span className="text-indigo-600 dark:text-indigo-400">
              {parsedFile.fileName}
            </span>{' '}
            — pick one to import
          </p>
          <div className="flex flex-col gap-2 mb-4">
            {parsedFile.sheetNames.map((name) => {
              const { headers } = parsedFile.parseSheet(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => setSelectedSheet(name)}
                  className={`w-full text-left px-4 py-3 rounded-xl border text-sm font-semibold flex items-center justify-between gap-2
                    ${
                      selectedSheet === name
                        ? 'bg-indigo-100 dark:bg-indigo-900/60 border-indigo-400 dark:border-indigo-600 text-indigo-700 dark:text-indigo-300'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:border-indigo-300'
                    }`}
                >
                  <span>📄 {name}</span>
                  <span className="text-[11px] font-normal text-slate-400 dark:text-slate-500 truncate">
                    {headers.length} columns
                    {headers.length > 0
                      ? `: ${headers.slice(0, 4).join(', ')}${headers.length > 4 ? ` +${headers.length - 4} more` : ''}`
                      : ' (empty)'}
                  </span>
                </button>
              );
            })}
          </div>
          <button
            onClick={handleSheetConfirm}
            disabled={!selectedSheet}
            className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-sm disabled:opacity-50"
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
          ${
            dragOver
              ? 'border-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 scale-[1.01] drag-pulse'
              : 'border-slate-300 dark:border-slate-600 bg-slate-50/80 dark:bg-slate-800/50 hover:border-indigo-300 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/30'
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
            <div className="w-10 h-10 border-2 border-indigo-200 border-t-indigo-500 rounded-full spinner" />
            <p className="text-sm text-slate-600 dark:text-slate-300 font-medium">
              Parsing your file…
            </p>
          </div>
        ) : (
          <>
            <div
              className={`flex justify-center mb-4 ${
                dragOver
                  ? 'text-indigo-500'
                  : 'text-slate-400 dark:text-slate-500'
              }`}
            >
              <UploadIcon />
            </div>
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-1">
              {dragOver
                ? 'Drop your file here'
                : 'Drag & drop your product catalog'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              or{' '}
              <span className="text-indigo-500 underline underline-offset-2 font-semibold">
                browse files
              </span>
            </p>
            <div className="flex items-center justify-center gap-3 mt-5">
              {[
                ['CSV', 'emerald'],
                ['XLSX', 'blue'],
                ['XLS', 'purple'],
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
const ColumnMappingStep = ({ headers, rows, onMappingComplete, onBack }) => {
  const autoMap = useMemo(() => autoMapHeaders(headers), [headers]);
  const [mapping, setMapping] = useState(() => ({
    name: autoMap.mapping.name || '',
    length: autoMap.mapping.length || '',
    width: autoMap.mapping.width || '',
    height: autoMap.mapping.height || '',
    packSize: autoMap.mapping.packSize || '',
    netWeight: autoMap.mapping.netWeight || '',
    grossWeight: autoMap.mapping.grossWeight || '',
  }));
  const [combinedDim, setCombinedDim] = useState(!!autoMap.combinedDimColumn);
  const [dimColumn, setDimColumn] = useState(autoMap.combinedDimColumn || '');
  const [delimiter, setDelimiter] = useState('x');
  const [importUnit, setImportUnit] = useState('cm');

  const dimPreview = useMemo(() => {
    if (!combinedDim || !dimColumn || !rows[0]) return null;
    const raw = String(rows[0][dimColumn] || '');
    return { raw, parsed: parseDimensionString(raw, delimiter) };
  }, [combinedDim, dimColumn, delimiter, rows]);

  const canProceed =
    mapping.name &&
    (combinedDim
      ? dimColumn
      : mapping.length && mapping.width && mapping.height);

  const handleNext = () => {
    const dimConfig = {
      combined: combinedDim,
      column: combinedDim ? dimColumn : null,
      delimiter: combinedDim ? delimiter : null,
      unit: importUnit,
    };
    const finalMapping = { ...mapping };
    if (combinedDim) {
      delete finalMapping.length;
      delete finalMapping.width;
      delete finalMapping.height;
    }
    onMappingComplete({ mapping: finalMapping, dimConfig });
  };

  const selClass = (hasValue) =>
    `w-full max-w-full bg-white/80 dark:bg-slate-800/80 border rounded-xl px-3 py-2.5 text-sm font-medium
     text-slate-800 dark:text-slate-100
     focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-400/70
     ${
       hasValue
         ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/30 dark:bg-emerald-950/20'
         : 'border-slate-200 dark:border-slate-600/70'
     }`;

  const fields = [
    { key: 'name', label: 'Product Name', required: true, icon: '🏷️' },
    ...(!combinedDim
      ? [
          { key: 'length', label: 'Length', required: true, icon: '📏' },
          { key: 'width', label: 'Width', required: true, icon: '📐' },
          { key: 'height', label: 'Height', required: true, icon: '📦' },
        ]
      : []),
    { key: 'packSize', label: 'Pack Size', required: false, icon: '📋' },
    { key: 'netWeight', label: 'Net Weight', required: false, icon: '⚖️' },
    { key: 'grossWeight', label: 'Gross Weight', required: false, icon: '🏋️' },
  ];

  return (
    <div className="fade-in space-y-5">
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold flex-shrink-0">
          Columns found:
        </span>
        <div className="flex flex-wrap gap-1.5">
          {headers.map((h) => (
            <span
              key={h}
              className="text-[11px] bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-600 px-2 py-0.5 rounded-full font-medium truncate max-w-[120px]"
            >
              {h}
            </span>
          ))}
        </div>
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
              className={`w-11 h-6 rounded-full relative ${
                combinedDim
                  ? 'bg-indigo-500'
                  : 'bg-slate-300 dark:bg-slate-600'
              }`}
            >
              <div
                className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow theme-pill ${
                  combinedDim ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </div>
          </div>
          <div className="min-w-0">
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
              Dimensions combined in one column
            </span>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 break-words">
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
                  className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider"
                >
                  Dimension Column
                </label>
                <select
                  id="dim-column-select"
                  value={dimColumn}
                  onChange={(e) => setDimColumn(e.target.value)}
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
                  className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider"
                >
                  Delimiter
                </label>
                <input
                  id="delimiter-input"
                  type="text"
                  value={delimiter}
                  onChange={(e) => setDelimiter(e.target.value)}
                  placeholder="x"
                  className="w-full max-w-full bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-600/70 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                />
              </div>
            </div>
            {dimPreview && (
              <div className="p-3 rounded-lg bg-white/80 dark:bg-slate-800/60 border border-amber-200 dark:border-amber-800/50 fade-in overflow-x-auto">
                <p className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 font-bold">
                  Parsing Preview (Row 1)
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 px-2.5 py-1 rounded truncate max-w-[160px]">
                    &quot;{dimPreview.raw}&quot;
                  </span>
                  <span className="text-slate-400 text-base">→</span>
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
        <p className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider mb-3">
          📐 Dimension Unit in this file
        </p>
        <div className="grid grid-cols-5 gap-2">
          {['cm', 'mm', 'inches', 'feet', 'meters'].map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setImportUnit(u)}
              className={`py-2 px-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide truncate
                ${
                  importUnit === u
                    ? 'bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-600'
                    : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600 hover:border-slate-300'
                }`}
            >
              {u}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
          Select the unit your L/W/H values are measured in. Default is cm.
        </p>
      </div>

      {/* Mapping dropdowns */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map((field) => (
          <div key={field.key} className="space-y-1.5 min-w-0">
            <label
              htmlFor={`map-${field.key}`}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider"
            >
              <span>{field.icon}</span>
              <span className="truncate">{field.label}</span>
              {field.required && (
                <span className="text-rose-400 flex-shrink-0">*</span>
              )}
            </label>
            <select
              id={`map-${field.key}`}
              value={mapping[field.key]}
              onChange={(e) =>
                setMapping((p) => ({ ...p, [field.key]: e.target.value }))
              }
              className={selClass(!!mapping[field.key])}
            >
              <option value="">— Select —</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {/* Navigation */}
      <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
        <button
          id="mapping-back-btn"
          onClick={onBack}
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-600"
        >
          <ArrowLeftIcon /> Back
        </button>
        <button
          id="mapping-next-btn"
          onClick={handleNext}
          disabled={!canProceed}
          className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold
            ${
              canProceed
                ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-500 hover:to-violet-500 hover:shadow-glow'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-400 cursor-not-allowed border border-slate-200 dark:border-slate-600'
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
const DataPreviewStep = ({
  rows,
  mapping,
  dimConfig,
  existingProducts,
  onImport,
  onBack,
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

  const importableProducts = useMemo(
    () =>
      taggedProducts
        .filter((p) => p.status !== 'skipped')
        .map(({ status, skipReason, ...p }) => p),
    [taggedProducts]
  );

  const counts = useMemo(
    () => ({
      new: taggedProducts.filter((p) => p.status === 'new').length,
      skipped: taggedProducts.filter((p) => p.status === 'skipped').length,
      total: rows.length,
    }),
    [taggedProducts, rows.length]
  );

  const [activeFilter, setActiveFilter] = useState('all');
  const [importing, setImporting] = useState(false);

  const handleImport = () => {
    setImporting(true);
    setTimeout(() => onImport(importableProducts), 500);
  };

  const visibleRows = useMemo(() => {
    if (activeFilter === 'new')
      return taggedProducts.filter((p) => p.status === 'new');
    if (activeFilter === 'skipped')
      return taggedProducts.filter((p) => p.status === 'skipped');
    return taggedProducts;
  }, [taggedProducts, activeFilter]);

  const chipDefs = [
    {
      key: 'new',
      label: `✓ ${counts.new} new`,
      base: 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400',
      active: 'ring-2 ring-emerald-400 dark:ring-emerald-600 scale-[1.04]',
    },
    {
      key: 'skipped',
      label: `⚠ ${counts.skipped} skipped`,
      base: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400',
      active: 'ring-2 ring-amber-400 dark:ring-amber-600 scale-[1.04]',
      hide: counts.skipped === 0,
    },
    {
      key: 'all',
      label: `${counts.total} total`,
      base: 'bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400',
      active: 'ring-2 ring-slate-400 dark:ring-slate-500 scale-[1.04]',
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
            <span className="text-[9px] text-rose-500 dark:text-rose-400 font-medium">
              {p.skipReason}
            </span>
          )}
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
                setActiveFilter(activeFilter === chip.key ? 'all' : chip.key)
              }
              className={`px-3 py-1.5 rounded-lg border text-xs font-bold transition-all duration-150 cursor-pointer
                ${chip.base}
                ${activeFilter === chip.key ? chip.active : 'opacity-80 hover:opacity-100'}`}
            >
              {chip.label}
            </button>
          ))}
      </div>

      {/* Full scrollable preview table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="bg-gradient-to-r from-slate-50 to-indigo-50/30 dark:from-slate-800 dark:to-indigo-950/20 px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <p className="text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
            {activeFilter === 'all'
              ? `All ${taggedProducts.length} rows`
              : `Showing ${visibleRows.length} ${activeFilter} rows`}
          </p>
          {activeFilter !== 'all' && (
            <button
              onClick={() => setActiveFilter('all')}
              className="text-[10px] text-indigo-500 dark:text-indigo-400 font-bold hover:underline"
            >
              Show all
            </button>
          )}
        </div>
        <div className="overflow-x-auto max-h-64 overflow-y-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-50/90 dark:bg-slate-800/90 border-b border-slate-200 dark:border-slate-700 backdrop-blur-sm">
                {['Name', 'L', 'W', 'H', 'Pack', 'Net Wt', 'Gross Wt', 'CBM'].map(
                  (h, i) => (
                    <th
                      key={h}
                      className={`${i === 0 ? 'text-left px-4' : 'text-right px-3'} py-2.5 text-[11px] font-bold ${i === 7 ? 'text-indigo-500 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400'} uppercase tracking-wider`}
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
                        <div className="flex flex-col items-center gap-2 text-slate-400">
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
                      const cbm =
                        !isSkipped &&
                        p.length > 0 &&
                        p.width > 0 &&
                        p.height > 0
                          ? calcCBM(
                              p.length,
                              p.width,
                              p.height,
                              p.unit || 'cm'
                            ).toFixed(4)
                          : 'N/A';
                      return (
                        <tr
                          key={i}
                          className={`border-t border-slate-100 dark:border-slate-700/60
                            ${
                              isSkipped
                                ? 'bg-amber-50/40 dark:bg-amber-950/10 opacity-70'
                                : 'hover:bg-indigo-50/30 dark:hover:bg-indigo-950/20'
                            }`}
                        >
                          <td className="px-4 py-2.5 font-semibold text-slate-800 dark:text-slate-200 max-w-[180px]">
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
                            p.packSize,
                            p.netWeightPerUnit,
                            p.grossWeightPerShipper,
                          ].map((v, j) => (
                            <td
                              key={j}
                              className={`px-3 py-2.5 text-right font-mono text-xs ${
                                isSkipped
                                  ? 'text-slate-400 dark:text-slate-600'
                                  : 'text-slate-600 dark:text-slate-400'
                              }`}
                            >
                              {v}
                            </td>
                          ))}
                          <td
                            className={`px-4 py-2.5 text-right font-mono font-bold text-xs ${
                              isSkipped
                                ? 'text-slate-400 dark:text-slate-600'
                                : 'text-indigo-600 dark:text-indigo-400'
                            }`}
                          >
                            {cbm}
                          </td>
                        </tr>
                      );
                    })}
                    {visibleRows.length > previewLimit && (
                      <tr className="border-t-2 border-indigo-200 dark:border-indigo-800">
                        <td
                          colSpan={8}
                          className="px-4 py-3 text-center bg-indigo-50/60 dark:bg-indigo-950/30"
                        >
                          <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
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
          className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-600"
        >
          <ArrowLeftIcon /> Back
        </button>
        <button
          id="import-catalog-btn"
          onClick={handleImport}
          disabled={importableProducts.length === 0 || importing}
          className={`flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold
            ${
              importableProducts.length > 0 && !importing
                ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-500 hover:to-teal-500 hover:shadow-glow'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-400 cursor-not-allowed border border-slate-200 dark:border-slate-600'
            }`}
        >
          {importing ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full spinner" />{' '}
              Importing…
            </>
          ) : (
            <>
              <CheckCircleIcon /> Import {importableProducts.length} Products
            </>
          )}
        </button>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════
   IMPORT WIZARD MODAL (main export)
   ═══════════════════════════════════════════════════════ */
const ImportWizardModal = ({ isOpen, onClose, onImport, existingProducts }) => {
  const [step, setStep] = useState(1);
  const [fileData, setFileData] = useState(null);
  const [mappingConfig, setMappingConfig] = useState(null);

  const handleClose = () => {
    setStep(1);
    setFileData(null);
    setMappingConfig(null);
    onClose();
  };

  const handleImport = (products) => {
    onImport(products);
    handleClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div
        className="absolute inset-0 bg-slate-900/50 dark:bg-slate-950/70 backdrop-blur-sm wizard-backdrop"
        onClick={handleClose}
      />
      <div
        className="relative w-full sm:max-w-2xl bg-white/90 dark:bg-slate-900/95 rounded-t-2xl sm:rounded-2xl shadow-2xl border border-slate-200/80 dark:border-slate-700/80 overflow-hidden wizard-panel max-h-[95vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-slate-50 to-indigo-50/40 dark:from-slate-800/80 dark:to-indigo-950/30 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/50 border border-indigo-200 dark:border-indigo-700 flex items-center justify-center text-indigo-600 dark:text-indigo-400 flex-shrink-0">
              <FileDocIcon />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-800 dark:text-slate-100">
                Import Product Catalog
              </h2>
              {fileData && (
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                  📄 {fileData.fileName} · {fileData.rows.length} rows ·{' '}
                  {fileData.headers.length} cols
                </p>
              )}
            </div>
          </div>
          <button
            id="wizard-close-btn"
            onClick={handleClose}
            title="Close"
            className="flex-shrink-0 p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="px-5 sm:px-6 pt-5 flex-shrink-0">
          <StepIndicator currentStep={step} />
        </div>
        <div className="px-5 sm:px-6 pb-6 overflow-y-auto flex-1">
          {step === 1 && (
            <FileUploadStep
              onFileParsed={(d) => {
                setFileData(d);
                setStep(2);
              }}
            />
          )}
          {step === 2 && fileData && (
            <ColumnMappingStep
              headers={fileData.headers}
              rows={fileData.rows}
              onMappingComplete={(cfg) => {
                setMappingConfig(cfg);
                setStep(3);
              }}
              onBack={() => {
                setStep(1);
                setFileData(null);
              }}
            />
          )}
          {step === 3 && fileData && mappingConfig && (
            <DataPreviewStep
              rows={fileData.rows}
              mapping={mappingConfig.mapping}
              dimConfig={mappingConfig.dimConfig}
              existingProducts={existingProducts}
              onImport={handleImport}
              onBack={() => setStep(2)}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default ImportWizardModal;
