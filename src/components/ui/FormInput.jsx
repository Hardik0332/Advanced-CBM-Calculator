/**
 * FormInput — Reusable labeled input component.
 */
import { memo } from 'react';

const FormInput = memo(({ id, label, value, onChange, type = 'number', step, min, suffix }) => (
  <div className="space-y-1.5 min-w-0">
    <label
      htmlFor={id}
      className="block text-xs font-semibold text-surface-600 dark:text-surface-400 uppercase tracking-wider truncate"
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
        onChange={(e) => onChange(e.target.value)}
        className="w-full max-w-full bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700
                   rounded-lg px-3 py-2.5 text-sm font-medium text-surface-800 dark:text-surface-50
                   focus:outline-none focus:ring-2 focus:ring-accent-500/40 focus:border-accent-400/70
                   placeholder-surface-400 dark:placeholder-surface-500"
        placeholder={`0`}
      />
      {suffix && (
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-surface-500 dark:text-surface-400 font-semibold pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  </div>
));

FormInput.displayName = 'FormInput';

export default FormInput;
