/**
 * ActiveShipment — Middle panel with shipment items, totals, container fill, and freight mode.
 */
import {
  TruckIcon,
  BoxIcon,
  ScaleIcon,
  TrashIcon,
  EditIcon,
  CopyIcon,
  ExcelIcon,
  PdfIcon,
} from '../icons/Icons';
import { CONTAINERS } from '../../utils/calculations';
import { exportExcel, exportPDF } from '../../utils/exporting';

const colorStyles = {
  indigo: {
    bg: 'from-indigo-50 to-indigo-100/50 dark:from-indigo-950/40 dark:to-indigo-900/20',
    border: 'border-indigo-200 dark:border-indigo-800/50',
    text: 'text-indigo-600 dark:text-indigo-400',
    icon: 'text-indigo-500 dark:text-indigo-400',
  },
  amber: {
    bg: 'from-amber-50 to-amber-100/50 dark:from-amber-950/40 dark:to-amber-900/20',
    border: 'border-amber-200 dark:border-amber-800/50',
    text: 'text-amber-600 dark:text-amber-400',
    icon: 'text-amber-500 dark:text-amber-400',
  },
  cyan: {
    bg: 'from-cyan-50 to-cyan-100/50 dark:from-cyan-950/40 dark:to-cyan-900/20',
    border: 'border-cyan-200 dark:border-cyan-800/50',
    text: 'text-cyan-600 dark:text-cyan-400',
    icon: 'text-cyan-500 dark:text-cyan-400',
  },
  emerald: {
    bg: 'from-emerald-50 to-emerald-100/50 dark:from-emerald-950/40 dark:to-emerald-900/20',
    border: 'border-emerald-200 dark:border-emerald-800/50',
    text: 'text-emerald-600 dark:text-emerald-400',
    icon: 'text-emerald-500 dark:text-emerald-400',
  },
};

const ActiveShipment = ({
  shipment,
  flashId,
  poNumber,
  setPoNumber,
  containerType,
  setContainerType,
  freightMode,
  setFreightMode,
  totals,
  volumetricWeight,
  chargeableWeight,
  containerPct,
  handleRemove,
  handleQuantityChange,
  handleEditItem,
  handleDuplicateItem,
  clearShipment,
}) => {
  const panelCls = 'glass rounded-2xl shadow-card dark:shadow-card-dark';

  return (
    <section className="lg:col-span-6 fade-in" style={{ animationDelay: '0.12s' }}>
      <div className={`${panelCls} p-4 sm:p-5 flex flex-col`}>
        {/* Header row with PO input + export buttons */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-2 mb-4 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400 flex-shrink-0">
              <TruckIcon />
            </div>
            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 truncate">
              Active Shipment
            </h2>
          </div>
          <div className="flex items-center w-full sm:w-auto justify-start sm:justify-end gap-2 flex-shrink-0 flex-wrap">
            {shipment.length > 0 && (
              <>
                <button
                  id="export-excel-btn"
                  onClick={() => exportExcel(shipment, totals, poNumber)}
                  title="Export Excel"
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/30"
                >
                  <ExcelIcon /> Excel
                </button>
                <button
                  id="export-pdf-btn"
                  onClick={() =>
                    exportPDF(shipment, totals, poNumber, containerType, freightMode)
                  }
                  title="Export PDF"
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-900/30"
                >
                  <PdfIcon /> PDF
                </button>
                <button
                  onClick={clearShipment}
                  title="Clear all"
                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700"
                >
                  <TrashIcon /> Clear
                </button>
              </>
            )}
          </div>
        </div>

        {/* PO / Reference Number */}
        <div className="mb-4">
          <input
            id="po-number"
            type="text"
            value={poNumber}
            onChange={(e) => setPoNumber(e.target.value)}
            placeholder="Shipment Reference / PO Number"
            className="w-full bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-600/70 rounded-xl px-3 py-2 text-sm font-medium text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
          />
        </div>

        {/* Items list */}
        <div className="flex-1 space-y-3 overflow-y-auto max-h-[320px] lg:max-h-[360px] pr-1">
          {shipment.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-12">
              <div className="w-16 h-16 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center mb-4 text-slate-400 dark:text-slate-600">
                <BoxIcon />
              </div>
              <p className="text-slate-500 dark:text-slate-400 text-sm font-semibold">
                No items in shipment
              </p>
              <p className="text-slate-400 dark:text-slate-600 text-xs mt-1">
                Add items from the form or product directory
              </p>
            </div>
          ) : (
            shipment.map((item, idx) => {
              const totalCBM = item.cbmPerShipper * item.quantity;
              const totalWeight = item.grossWeightPerShipper * item.quantity;
              const totalPcs = item.packSize * item.quantity;
              const isFlashing = flashId === item.id;

              return (
                <div
                  key={item.id}
                  className={`group rounded-xl border
                    ${isFlashing
                      ? 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-700 shadow-glow'
                      : 'bg-white/60 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                    }`}
                >
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                          {item.name}
                        </h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                          {item.length || item.width || item.height
                            ? `${item.length}×${item.width}×${item.height} ${item.unit}`
                            : `pre-calc ${item.cbmPerShipper < 0.001
                              ? item.cbmPerShipper.toFixed(5)
                              : item.cbmPerShipper.toFixed(3)} m³`
                          }{' '}· {item.packSize} pcs/shipper
                        </p>
                      </div>
                      {/* Action icons: Edit, Copy, Delete */}
                      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100">
                        <button
                          id={`edit-item-${idx}`}
                          onClick={() => handleEditItem(item)}
                          title="Edit"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/30"
                        >
                          <EditIcon />
                        </button>
                        <button
                          id={`dup-item-${idx}`}
                          onClick={() => handleDuplicateItem(item)}
                          title="Duplicate"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-teal-500 hover:bg-teal-50 dark:hover:bg-teal-950/30"
                        >
                          <CopyIcon />
                        </button>
                        <button
                          id={`remove-item-${idx}`}
                          onClick={() => handleRemove(item.id)}
                          title="Remove"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    </div>

                    {/* Responsive Mobile Layout for Stats & Controls */}
                    <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700/50">
                      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 sm:gap-4">

                        {/* Stats Grid - Locks to 4 columns on mobile so text doesn't squish */}
                        <div className="grid grid-cols-4 gap-4 sm:gap-x-8 sm:gap-y-2 w-full sm:w-auto">
                          <div className="text-center sm:text-left">
                            <p className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-0.5">CBM/ship</p>
                            <p className="text-[11px] sm:text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 truncate">
                              {item.cbmPerShipper < 0.001
                                ? item.cbmPerShipper.toFixed(5)
                                : item.cbmPerShipper.toFixed(3)}
                            </p>
                          </div>
                          <div className="text-center sm:text-left">
                            <p className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-0.5">Total CBM</p>
                            <p className="text-[11px] sm:text-sm font-mono font-bold text-indigo-600 dark:text-indigo-400 truncate">
                              {totalCBM < 0.001
                                ? totalCBM.toFixed(5)
                                : totalCBM.toFixed(3)}
                            </p>
                          </div>
                          <div className="text-center sm:text-left">
                            <p className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-0.5">Wt (kg)</p>
                            <p className="text-[11px] sm:text-sm font-mono font-bold text-amber-600 dark:text-amber-400 truncate">{totalWeight.toFixed(2)}</p>
                          </div>
                          {item.packSize > 1 ? (
                            <div className="text-center sm:text-left">
                              <p className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-0.5">Pcs</p>
                              <p className="text-[11px] sm:text-sm font-mono font-bold text-violet-600 dark:text-violet-400 truncate">{totalPcs.toLocaleString()}</p>
                            </div>
                          ) : <div />}
                        </div>

                        {/* Qty Controls - Drops below stats on mobile, aligns right */}
                        <div className="flex items-center justify-end w-full sm:w-auto mt-1 sm:mt-0">
                          <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-800/50 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                            <button id={`qty-dec-${idx}`} onClick={() => handleQuantityChange(item.id, item.quantity - 1)}
                              className="w-8 h-8 rounded-lg bg-white dark:bg-slate-700 shadow-sm border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600 flex items-center justify-center text-base font-bold">−</button>
                            <input id={`qty-input-${idx}`} type="number" min="1" value={item.quantity}
                              onChange={e => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) handleQuantityChange(item.id, v); }}
                              onBlur={e => { const v = parseInt(e.target.value, 10); if (isNaN(v) || v < 1) handleQuantityChange(item.id, 1); }}
                              className="w-12 h-8 mx-0.5 text-center bg-transparent border-none text-sm font-bold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-0" />
                            <button id={`qty-inc-${idx}`} onClick={() => handleQuantityChange(item.id, item.quantity + 1)}
                              className="w-8 h-8 rounded-lg bg-white dark:bg-slate-700 shadow-sm border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-600 flex items-center justify-center text-base font-bold">+</button>
                          </div>
                        </div>

                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Grand totals + Container + Freight */}
        {shipment.length > 0 && (
          <div className="mt-5 pt-5 border-t border-slate-200 dark:border-slate-700 flex-shrink-0 space-y-4">
            {/* 4 totals row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                { label: 'Total CBM', value: totals.cbm.toFixed(2), color: 'indigo', icon: <BoxIcon /> },
                { label: 'Gross Wt', value: totals.grossWeight.toFixed(2) + ' kg', color: 'amber', icon: <ScaleIcon /> },
                { label: 'Net Wt', value: totals.netWeight.toFixed(2) + ' kg', color: 'cyan', icon: <ScaleIcon /> },
                { label: 'Shippers', value: totals.shippers, color: 'emerald', icon: <TruckIcon /> },
              ].map((t) => (
                <div
                  key={t.label}
                  className={`rounded-xl bg-gradient-to-br ${colorStyles[t.color].bg} border ${colorStyles[t.color].border} p-2.5 text-center pulse-glow`}
                >
                  <div
                    className={`flex items-center justify-center gap-1 mb-1 ${colorStyles[t.color].icon}`}
                  >
                    {t.icon}
                    <p className="text-[8px] uppercase tracking-widest font-bold hidden sm:block">
                      {t.label}
                    </p>
                  </div>
                  <p
                    className={`text-xs sm:text-base font-bold font-mono ${colorStyles[t.color].text} tabular-nums truncate`}
                  >
                    {t.value}
                  </p>
                </div>
              ))}
            </div>

            {/* Container utilization */}
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between mb-2 gap-2">
                <span className="text-[10px] uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400">
                  Container Fill
                </span>
                <select
                  id="container-select"
                  value={containerType}
                  onChange={(e) => setContainerType(e.target.value)}
                  className="bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                >
                  {Object.entries(CONTAINERS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label} ({v.cbm} m³)
                    </option>
                  ))}
                </select>
              </div>
              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-4 overflow-hidden">
                <div
                  className={`bar-fill h-full rounded-full ${containerPct > 95
                    ? 'bg-gradient-to-r from-rose-500 to-red-500'
                    : containerPct > 75
                      ? 'bg-gradient-to-r from-amber-500 to-orange-500'
                      : 'bg-gradient-to-r from-indigo-500 to-violet-500'
                    }`}
                  style={{ width: `${containerPct}%` }}
                />
              </div>
              <div className="flex justify-between mt-1.5">
                <span className="text-[11px] font-mono font-bold text-slate-600 dark:text-slate-400">
                  {totals.cbm.toFixed(2)} / {CONTAINERS[containerType].cbm} m³
                </span>
                <span
                  className={`text-[11px] font-mono font-bold ${containerPct > 95
                    ? 'text-rose-600 dark:text-rose-400'
                    : 'text-indigo-600 dark:text-indigo-400'
                    }`}
                >
                  {containerPct.toFixed(2)}%
                </span>
              </div>
              {containerPct > 0 && containerPct < 50 && (
                <div className="mt-2.5 text-center text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 py-1.5 rounded border border-amber-200/50 dark:border-amber-500/20 shadow-sm">
                  {(CONTAINERS[containerType].cbm - totals.cbm).toFixed(2)} m³ remaining in container
                </div>
              )}
            </div>

            {/* Freight Mode + Chargeable Weight */}
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between mb-2 gap-2">
                <span className="text-[10px] uppercase tracking-widest font-bold text-slate-500 dark:text-slate-400">
                  Freight Mode
                </span>
                <div className="flex items-center bg-slate-200 dark:bg-slate-700 rounded-lg p-0.5">
                  {['ocean', 'air'].map((m) => (
                    <button
                      key={m}
                      onClick={() => setFreightMode(m)}
                      className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase ${freightMode === m
                        ? 'bg-white dark:bg-slate-600 text-indigo-600 dark:text-indigo-300 shadow-sm'
                        : 'text-slate-500 dark:text-slate-400'
                        }`}
                    >
                      {m === 'ocean' ? '🚢 Ocean' : '✈️ Air'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[9px] text-slate-500 dark:text-slate-400 uppercase mb-0.5">
                    Volumetric
                  </p>
                  <p className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
                    {volumetricWeight.toFixed(2)} kg
                  </p>
                </div>
                <div>
                  <p className="text-[9px] text-slate-500 dark:text-slate-400 uppercase mb-0.5">
                    Gross
                  </p>
                  <p className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
                    {totals.grossWeight.toFixed(2)} kg
                  </p>
                </div>
                <div className="bg-indigo-50 dark:bg-indigo-950/40 rounded-lg p-1.5 border border-indigo-200 dark:border-indigo-800">
                  <p className="text-[9px] text-indigo-600 dark:text-indigo-400 uppercase mb-0.5 font-bold">
                    Chargeable
                  </p>
                  <p className="text-sm font-mono font-bold text-indigo-700 dark:text-indigo-300">
                    {chargeableWeight.toFixed(2)} kg
                  </p>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2 text-center">
                {freightMode === 'air'
                  ? 'Air: 1 CBM = 167 kg · Chargeable = max(Gross, Volumetric)'
                  : 'Ocean: Chargeable = Gross Weight only'}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

export default ActiveShipment;