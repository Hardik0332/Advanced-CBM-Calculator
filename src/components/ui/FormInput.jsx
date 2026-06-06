/**
 * FormInput — Reusable labeled input component.
 */

const FormInput = ({ id, label, value, onChange, type = 'number', step, min, suffix }) => (
  <div className="space-y-1.5 min-w-0">
    <label
      htmlFor={id}
      className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate"
    >
      {label}
    </label>
    <div className="relative">
      <input
        id={id}
        type={type}
        step={step || 'any'}
        min={min || '0'}
        value={value}
        onChange={(e) =>
          onChange(
            type === 'number'
              ? parseFloat(e.target.value) || 0
              : e.target.value
          )
        }
        className="w-full max-w-full bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-600/70
                   rounded-xl px-3 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-100
                   focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-400/70
                   placeholder-slate-300 dark:placeholder-slate-600"
        placeholder={`Enter ${label.toLowerCase()}`}
      />
      {suffix && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400 dark:text-slate-500 font-semibold pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  </div>
);

export default FormInput;
