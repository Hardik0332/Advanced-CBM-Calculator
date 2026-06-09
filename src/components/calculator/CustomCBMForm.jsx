/**
 * CustomCBMForm — Left panel for custom CBM entry.
 *
 * Supports two pack modes:
 *   'single'   — a direct "Units per Shipper" input (original behaviour)
 *   'multiple' — two-tier entry: Units per Inner Carton × Inner Cartons per Master
 *                The effective packSize (innerPackQty × masterPackQty) is written
 *                to the shared form state via flushSync before the hook's
 *                handleAddToShipment runs, so the hook needs zero changes.
 */
import { useState } from 'react';
import { flushSync } from 'react-dom';
import FormInput from '../ui/FormInput';
import { PlusIcon, WarningIcon } from '../icons/Icons';

// Adaptive CBM formatter — prevents 0.00 for small pharmaceutical/medical items.
// Uses more decimal places only when the value is too small for 2dp to be meaningful.
const fmtCBM = (v) => {
  if (!v || v === 0) return '0.0000';
  if (v < 0.0001) return v.toFixed(6);
  if (v < 0.01)   return v.toFixed(4);
  return v.toFixed(2);
};

/* ─── small helpers ────────────────────────────────────────────────────────── */

const PACK_MODES = [
  { id: 'single',   label: 'Single Tier' },
  { id: 'multiple', label: 'Multi-Tier'  },
];

/* Pill-toggle shared style tokens */
const pillBase =
  'flex-1 py-2 px-3 text-[11px] font-bold uppercase tracking-wide rounded-full transition-all duration-200 focus:outline-none';
const pillActive =
  'bg-indigo-600 dark:bg-indigo-500 text-white shadow-md';
const pillInactive =
  'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200';

/* ─── component ─────────────────────────────────────────────────────────────── */

const CustomCBMForm = ({
  form,
  updateForm,
  unitSwitchWarning,
  previewCBM,
  canAdd,
  handleAddToShipment,
  handleAddToDirectory,
  products = [],
  handleProductClick,
  activeProductId,
}) => {
  /* ── Local pack-mode state ── */
  const [packMode, setPackMode]       = useState('single');  // 'single' | 'multiple'
  const [innerPackQty, setInnerPackQty] = useState('');
  const [masterPackQty, setMasterPackQty] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const panelCls = 'glass rounded-2xl shadow-card dark:shadow-card-dark';

  /* ── Derived: effective total for multi-tier helper text ── */
  const innerNum  = Number(innerPackQty)  || 0;
  const masterNum = Number(masterPackQty) || 0;
  const multiTotal = innerNum * masterNum;

  /* ── Reset multi fields when switching back to single ── */
  const handlePackModeChange = (mode) => {
    setPackMode(mode);
    if (mode === 'single') {
      setInnerPackQty('');
      setMasterPackQty('');
    }
  };

  /**
   * Local add wrapper.
   * For 'multiple' mode we must patch `form.packSize` (and optionally
   * `form.packDetails`) in the hook's state *before* the hook's
   * handleAddToShipment closure reads it.
   * flushSync forces the React state flush synchronously so the next
   * read (inside handleAddToShipment) sees the updated value.
   */
  const handleAdd = () => {
    if (packMode === 'multiple' && multiTotal > 0) {
      handleAddToShipment({
        packSize: multiTotal,
      });
    } else {
      handleAddToShipment();
    }

    /* Reset multi-tier fields after successful add */
    if (packMode === 'multiple') {
      setInnerPackQty('');
      setMasterPackQty('');
    }
  };

  /**
   * Local wrapper for adding to the product directory.
   */
  const handleAddToDir = () => {
    if (packMode === 'multiple' && multiTotal > 0) {
      handleAddToDirectory({
        packSize: multiTotal,
      });
    } else {
      handleAddToDirectory();
    }

    /* Reset multi-tier fields after successful add */
    if (packMode === 'multiple') {
      setInnerPackQty('');
      setMasterPackQty('');
    }
  };

  /* ── Filter products for Item Name search dropdown ── */
  const query = (form.name || '').trim().toLowerCase();
  
  // Group products by case-insensitive name
  const groupedProducts = query ? products.reduce((acc, p) => {
    const key = p.name.toLowerCase();
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {}) : {};

  const matchingGroups = query
    ? Object.values(groupedProducts)
        .filter((group) => group[0].name.toLowerCase().includes(query))
        .sort((groupA, groupB) => {
          const aName = groupA[0].name.toLowerCase();
          const bName = groupB[0].name.toLowerCase();

          const aStarts = aName.startsWith(query);
          const bStarts = bName.startsWith(query);
          if (aStarts && !bStarts) return -1;
          if (!aStarts && bStarts) return 1;

          const aWord = aName.includes(` ${query}`);
          const bWord = bName.includes(` ${query}`);
          if (aWord && !bWord) return -1;
          if (!aWord && bWord) return 1;

          return groupA[0].name.localeCompare(groupB[0].name);
        })
        .slice(0, 5)
    : [];

  const exactName = (form.name || '').trim().toLowerCase();
  const availableVariants = exactName ? products.filter((p) => p.name.toLowerCase() === exactName) : [];

  return (
    <section className="lg:col-span-3 fade-in" style={{ animationDelay: '0.05s' }}>
      <div className={`${panelCls} p-4 sm:p-5`}>

        {/* ── Section header ── */}
        <div className="flex items-center gap-2 mb-5">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-900/60 flex items-center justify-center flex-shrink-0">
            <svg
              className="w-4 h-4 text-indigo-600 dark:text-indigo-400 no-theme-transition"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </div>
          <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 truncate">
            Custom CBM Entry
          </h2>
        </div>

        {/* ── Item Name ── */}
        <div className="mb-4 relative">
          <div className="space-y-1.5 min-w-0">
            <label
              htmlFor="item-name"
              className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate"
            >
              Item Name
            </label>
            <div className="relative">
              <input
                id="item-name"
                type="text"
                value={form.name}
                onChange={(e) => {
                  updateForm('name', e.target.value);
                  setIsDropdownOpen(true);
                }}
                onFocus={() => setIsDropdownOpen(true)}
                onBlur={() => {
                  // delay to allow click on dropdown items
                  setTimeout(() => setIsDropdownOpen(false), 200);
                }}
                autoComplete="off"
                className="w-full max-w-full bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-600/70
                           rounded-xl px-3 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-100
                           focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-400/70
                           placeholder-slate-300 dark:placeholder-slate-600"
                placeholder="Type item name..."
              />
            </div>
          </div>

          {/* ── Dropdown Overlay ── */}
          {isDropdownOpen && matchingGroups.length > 0 && (
            <div className="absolute left-0 right-0 z-30 mt-1 max-h-56 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg divide-y divide-slate-100 dark:divide-slate-700/50">
              {matchingGroups.map((group) => {
                const product = group[0];
                return (
                  <button
                    key={product.id}
                    type="button"
                    onMouseDown={(e) => {
                      // Prevent input blur before onClick fires
                      e.preventDefault();
                    }}
                    onClick={() => {
                      if (group.length === 1) {
                        handleProductClick(product);
                      } else {
                        updateForm('name', product.name);
                      }
                      setIsDropdownOpen(false);
                    }}
                    className="w-full text-left px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-700/50 flex items-center justify-between gap-2 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-base flex-shrink-0">{product.icon}</span>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">
                          {product.name}
                        </p>
                        {group.length > 1 ? (
                          <p className="text-[10px] text-indigo-500 dark:text-indigo-400 font-semibold truncate">
                            {group.length} variants available
                          </p>
                        ) : (
                          <p className="text-[10px] text-slate-400 dark:text-slate-500 truncate">
                            {Number(product.length).toFixed(2)}×{Number(product.width).toFixed(2)}×{Number(product.height).toFixed(2)} {product.unit} · {product.packSize} pcs
                          </p>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] font-bold text-indigo-500 dark:text-indigo-400 shrink-0">
                      Select
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Variant Dropdown ── */}
        {availableVariants.length > 0 && (
          <div className="mb-4 space-y-1.5 min-w-0 fade-in">
            <label
              htmlFor="variant-select"
              className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate"
            >
              Pack Size / Variant
            </label>
            <div className="relative">
              <select
                id="variant-select"
                onChange={(e) => {
                  const variant = availableVariants.find((v) => v.id === e.target.value);
                  if (variant) {
                    handleProductClick(variant);
                  }
                }}
                value={activeProductId || ""} // Bind to active variant
                className="w-full max-w-full appearance-none bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200 dark:border-indigo-800/70
                           rounded-xl px-3 py-2.5 pr-10 text-sm font-semibold text-indigo-700 dark:text-indigo-300
                           focus:outline-none focus:ring-2 focus:ring-indigo-500/50
                           hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors"
              >
                <option value="" disabled className="bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                  — Select a variant —
                </option>
                {availableVariants.map((v) => {
                  // Show the raw packing description from the CSV (e.g. "10X100GM")
                  // when available; fall back to numeric packSize + dimensions
                  const hasDims = v.length > 0 && v.width > 0 && v.height > 0;
                  const dimsStr = hasDims ? `${v.length}×${v.width}×${v.height} ${v.unit}` : '';
                  const label = v.packingString
                    ? `${v.packingString}${dimsStr ? ` · ${dimsStr}` : ''}`
                    : `${v.packSize} pcs${dimsStr ? ` · ${dimsStr}` : ''}`;
                  return (
                    <option key={v.id} value={v.id} className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                      {label}
                    </option>
                  );
                })}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-indigo-500 dark:text-indigo-400">
                <svg className="h-4 w-4 fill-current" viewBox="0 0 20 20">
                  <path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" fillRule="evenodd"></path>
                </svg>
              </div>
            </div>
          </div>
        )}

        {/* ── Unit selector ── */}
        <div className="mb-4 space-y-1.5">
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Unit
          </label>
          <div className="grid grid-cols-5 gap-1.5">
            {['mm', 'cm', 'inches', 'feet', 'meters'].map((u) => (
              <button
                key={u}
                id={`unit-${u}`}
                onClick={() => updateForm('unit', u)}
                className={`py-2 px-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide max-w-full truncate
                  ${form.unit === u
                    ? 'bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-600 shadow-glow'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600 hover:border-slate-300 dark:hover:border-slate-500'
                  }`}
              >
                {u}
              </button>
            ))}
          </div>
        </div>

        {/* ── Unit switch warning ── */}
        {unitSwitchWarning && (
          <div className="mb-3 p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 flex items-start gap-2 fade-in">
            <span className="text-amber-500 flex-shrink-0 mt-0.5">
              <WarningIcon />
            </span>
            <p className="text-[11px] text-amber-700 dark:text-amber-400 font-medium">
              Values not converted — existing dimensions are now treated as{' '}
              <strong>{form.unit}</strong>.
            </p>
          </div>
        )}

        {/* ── Dimensions ── */}
        <div className="grid grid-cols-1 min-[400px]:grid-cols-3 gap-2 mb-4">
          <FormInput
            id="dim-length"
            label="L"
            value={form.length}
            onChange={(v) => updateForm('length', v)}
            suffix={form.unit.slice(0, 2)}
          />
          <FormInput
            id="dim-width"
            label="W"
            value={form.width}
            onChange={(v) => updateForm('width', v)}
            suffix={form.unit.slice(0, 2)}
          />
          <FormInput
            id="dim-height"
            label="H"
            value={form.height}
            onChange={(v) => updateForm('height', v)}
            suffix={form.unit.slice(0, 2)}
          />
        </div>

        {/* ══════════════ PACK SIZE SECTION ══════════════ */}
        <div className="mb-4 space-y-2">

          {/* ── Pack mode pill-toggle ── */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Pack Configuration
            </label>
            <div className="flex gap-1 p-1 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              {PACK_MODES.map(({ id, label }) => (
                <button
                  key={id}
                  id={`pack-mode-${id}`}
                  onClick={() => handlePackModeChange(id)}
                  className={`${pillBase} ${packMode === id ? pillActive : pillInactive}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* ── Single-tier: standard Units per Shipper ── */}
          {packMode === 'single' && (
            <div className="fade-in">
              <FormInput
                id="pack-size"
                label="Quantity Per Shipper"
                value={form.packSize}
                onChange={(v) => updateForm('packSize', v)}
                min="1"
                step="1"
                suffix="pcs"
              />
            </div>
          )}

          {/* ── Multi-tier: inner × master grid ── */}
          {packMode === 'multiple' && (
            <div className="fade-in space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <FormInput
                  id="inner-pack-qty"
                  label="Units / Inner Carton"
                  value={innerPackQty}
                  onChange={(v) => setInnerPackQty(v)}
                  min="1"
                  step="1"
                  suffix="pcs"
                />
                <FormInput
                  id="master-pack-qty"
                  label="Inners / Master Carton"
                  value={masterPackQty}
                  onChange={(v) => setMasterPackQty(v)}
                  min="1"
                  step="1"
                  suffix="ctn"
                />
              </div>

              {/* Dynamic helper text */}
              <div
                className={`flex items-center justify-between px-3 py-2 rounded-lg border transition-colors duration-200
                  ${multiTotal > 0
                    ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-700'
                    : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700'
                  }`}
              >
                <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {innerNum > 0 && masterNum > 0
                    ? `${innerNum} × ${masterNum}`
                    : 'Total'}
                </span>
                <span
                  className={`text-sm font-bold font-mono tabular-nums
                    ${multiTotal > 0
                      ? 'text-indigo-600 dark:text-indigo-400'
                      : 'text-slate-400 dark:text-slate-600'
                    }`}
                >
                  {multiTotal > 0
                    ? `= ${multiTotal.toLocaleString()} units / master`
                    : '—'}
                </span>
              </div>
            </div>
          )}

          {/* ── Total Pcs (always visible) ── */}
          <FormInput
            id="total-pcs"
            label="Total Pcs"
            value={form.totalPcs || ''}
            onChange={(v) => updateForm('totalPcs', v)}
            min="0"
            step="1"
            suffix="pcs"
          />

          {/* Shipper count derivation row */}
          {(() => {
            const effectivePack =
              packMode === 'multiple' ? multiTotal : Number(form.packSize);
            return form.totalPcs > 0 && effectivePack > 0 ? (
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-700 fade-in">
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
                  {form.totalPcs} ÷ {effectivePack}
                </span>
                <span className="text-sm font-bold font-mono text-emerald-600 dark:text-emerald-400">
                  = {Math.ceil(form.totalPcs / effectivePack)} shippers
                </span>
              </div>
            ) : null;
          })()}
        </div>

        {/* ── Weights ── */}
        <div className="grid grid-cols-2 gap-2 mb-2">
          <FormInput
            id="net-weight"
            label="Net Wt/Shipper"
            value={form.netWeight}
            onChange={(v) => updateForm('netWeight', v)}
            suffix="kg"
          />
          <FormInput
            id="gross-weight"
            label="Gross Wt/Shipper"
            value={form.grossWeight}
            onChange={(v) => updateForm('grossWeight', v)}
            suffix="kg"
          />
        </div>

        {/* Weight totals summary */}
        {(Number(form.netWeight) > 0 || Number(form.grossWeight) > 0) && (
          <>
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 mb-2 fade-in">
              {(() => {
                const effectivePack =
                  packMode === 'multiple' ? multiTotal : Number(form.packSize);
                const shippers =
                  form.totalPcs > 0 && effectivePack > 0
                    ? Math.ceil(Number(form.totalPcs) / effectivePack)
                    : 1;
                const packSizeForWeight = effectivePack > 0 ? effectivePack : 1;
                const netWeightPerUnit = (Number(form.netWeight) || 0) / packSizeForWeight;
                const totalPcs =
                  form.totalPcs !== ''
                    ? Number(form.totalPcs) || 0
                    : packSizeForWeight;
                const totalNetWt = (netWeightPerUnit * totalPcs).toFixed(2);
                const totalGrossWt = ((Number(form.grossWeight) || 0) * shippers).toFixed(2);
                return (
                  <>
                    <div className="flex flex-col">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">
                        Total Net Wt
                      </span>
                      <span className="text-sm font-bold font-mono text-slate-700 dark:text-slate-300">
                        {totalNetWt} kg
                      </span>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">
                        Total Gross Wt
                      </span>
                      <span className="text-sm font-bold font-mono text-slate-700 dark:text-slate-300">
                        {totalGrossWt} kg
                      </span>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Per-pcs weight breakdown */}
            {(() => {
              const effectivePack =
                packMode === 'multiple' ? multiTotal : Number(form.packSize);
              const perPcsNet   = effectivePack > 0 ? (Number(form.netWeight)   || 0) / effectivePack : 0;
              const perPcsGross = effectivePack > 0 ? (Number(form.grossWeight) || 0) / effectivePack : 0;
              const hasData = effectivePack > 0 && (perPcsNet > 0 || perPcsGross > 0);
              return hasData ? (
                <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 mb-5 fade-in">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold uppercase tracking-wider">
                      Net Wt / Pcs
                    </span>
                    <span className="text-sm font-bold font-mono text-amber-700 dark:text-amber-300">
                      {perPcsNet.toFixed(2)} kg
                    </span>
                  </div>
                  <div className="w-px h-8 bg-amber-200 dark:bg-amber-700/50" />
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold uppercase tracking-wider">
                      Gross Wt / Pcs
                    </span>
                    <span className="text-sm font-bold font-mono text-amber-700 dark:text-amber-300">
                      {perPcsGross.toFixed(2)} kg
                    </span>
                  </div>
                </div>
              ) : <div className="mb-5" />;
            })()}
          </>
        )}

        {/* ── Volume preview ── */}
        {previewCBM > 0 && (
          <div className="mb-2 p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-800 fade-in">
            <div className="flex justify-between items-center gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                Volume Preview
                {form.presetCBM > 0 && !form.length && !form.width && !form.height && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-violet-100 dark:bg-violet-900/50 text-violet-600 dark:text-violet-400 border border-violet-200 dark:border-violet-700 uppercase tracking-wide">
                    pre-calc
                  </span>
                )}
              </span>
              <span className="text-base font-bold font-mono text-indigo-600 dark:text-indigo-400 tabular-nums">
                {fmtCBM(previewCBM)} m³
              </span>
            </div>
          </div>
        )}

        {/* ── CBM breakdown ── */}
        {previewCBM > 0 && (
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-800 mb-4 fade-in">
            {(() => {
              const effectivePack =
                packMode === 'multiple' ? multiTotal : Number(form.packSize);
              const shippers =
                form.totalPcs > 0 && effectivePack > 0
                  ? Math.ceil(Number(form.totalPcs) / effectivePack)
                  : 1;
              const totalCBM = previewCBM * shippers;
              return (
                <>
                  <div className="flex flex-col">
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">
                      CBM / Shipper
                    </span>
                    <span className="text-sm font-bold font-mono text-slate-700 dark:text-slate-300">
                      {fmtCBM(previewCBM)} m³
                    </span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">
                      Total CBM
                    </span>
                    <span className="text-sm font-bold font-mono text-indigo-600 dark:text-indigo-400">
                      {fmtCBM(totalCBM)} m³
                    </span>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* ── Add buttons ── */}
        <div className="flex flex-col gap-2">
          <button
            id="add-to-shipment-btn"
            onClick={handleAdd}
            disabled={!canAdd}
            className={`w-full max-w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2
              ${canAdd
                ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-500 hover:to-violet-500 hover:shadow-glow active:scale-[0.98]'
                : 'bg-slate-100 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-200 dark:border-slate-600'
              }`}
          >
            <PlusIcon /> Add to Shipment
          </button>

          <button
            id="add-to-directory-btn"
            onClick={handleAddToDir}
            disabled={!canAdd}
            className={`w-full max-w-full py-2.5 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2
              ${canAdd
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 active:scale-[0.98] transition-colors'
                : 'bg-transparent text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-200 dark:border-slate-600'
              }`}
          >
            <PlusIcon /> Add to Product Directory
          </button>
        </div>
      </div>
    </section>
  );
};

export default CustomCBMForm;
