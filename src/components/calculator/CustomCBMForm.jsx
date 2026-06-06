/**
 * CustomCBMForm — Left panel for custom CBM entry.
 */
import FormInput from '../ui/FormInput';
import { PlusIcon, WarningIcon } from '../icons/Icons';

const CustomCBMForm = ({
  form,
  updateForm,
  unitSwitchWarning,
  previewCBM,
  canAdd,
  handleAddToShipment,
}) => {
  const panelCls = 'glass rounded-2xl shadow-card dark:shadow-card-dark';

  return (
    <section className="lg:col-span-3 fade-in" style={{ animationDelay: '0.05s' }}>
      <div className={`${panelCls} p-4 sm:p-5`}>
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

        <div className="mb-4">
          <FormInput
            id="item-name"
            label="Item Name"
            type="text"
            value={form.name}
            onChange={(v) => updateForm('name', v)}
          />
        </div>

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

        <div className="mb-4 space-y-2">
          <FormInput
            id="pack-size"
            label="Quantity Per Shipper"
            value={form.packSize}
            onChange={(v) => updateForm('packSize', v)}
            min="1"
            step="1"
            suffix="pcs"
          />
          <FormInput
            id="total-pcs"
            label="Total Pcs"
            value={form.totalPcs || ''}
            onChange={(v) => updateForm('totalPcs', v)}
            min="0"
            step="1"
            suffix="pcs"
          />
          {form.totalPcs > 0 && form.packSize > 0 && (
            <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-700 fade-in">
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
                {form.totalPcs} ÷ {form.packSize}
              </span>
              <span className="text-sm font-bold font-mono text-emerald-600 dark:text-emerald-400">
                = {Math.ceil(form.totalPcs / form.packSize)} shippers
              </span>
            </div>
          )}
        </div>

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

        {(Number(form.netWeight) > 0 || Number(form.grossWeight) > 0) && (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 mb-5 fade-in">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">Total Net Wt</span>
              <span className="text-sm font-bold font-mono text-slate-700 dark:text-slate-300">
                {((Number(form.netWeight) || 0) * (Number(form.totalPcs) > 0 && Number(form.packSize) > 0 ? Math.ceil(Number(form.totalPcs) / Number(form.packSize)) : 1)).toFixed(2)} kg
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">Total Gross Wt</span>
              <span className="text-sm font-bold font-mono text-slate-700 dark:text-slate-300">
                {((Number(form.grossWeight) || 0) * (Number(form.totalPcs) > 0 && Number(form.packSize) > 0 ? Math.ceil(Number(form.totalPcs) / Number(form.packSize)) : 1)).toFixed(2)} kg
              </span>
            </div>
          </div>
        )}

        {previewCBM > 0 && (
          <div className="mb-4 p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-100 dark:border-indigo-800 fade-in">
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
                {previewCBM.toFixed(6)} m³
              </span>
            </div>
          </div>
        )}

        <button
          id="add-to-shipment-btn"
          onClick={handleAddToShipment}
          disabled={!canAdd}
          className={`w-full max-w-full py-3 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2
            ${canAdd
              ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-500 hover:to-violet-500 hover:shadow-glow active:scale-[0.98]'
              : 'bg-slate-100 dark:bg-slate-700/50 text-slate-400 dark:text-slate-500 cursor-not-allowed border border-slate-200 dark:border-slate-600'
            }`}
        >
          <PlusIcon /> Add to Shipment
        </button>
      </div>
    </section>
  );
};

export default CustomCBMForm;
