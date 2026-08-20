/**
 * FreightWorkings — the derivation behind the billed weight, on screen.
 *
 * Collapsed by default so the three-panel layout stays lean, but one click away:
 * the app now bills a number the user cannot reproduce in their head (per-piece
 * volume, a carrier divisor, a round-up), so it owes them the arithmetic.
 *
 * Reads `workings[]` / `notes[]` straight from `computeFreight`, which is the same
 * data the PDF and spreadsheet exports print — one source, three renderings.
 */
import { useState, memo } from 'react';
import { ChevronIcon } from '../icons/Icons';

const FreightWorkings = memo(({ workings = [], notes = [] }) => {
  const [open, setOpen] = useState(false);

  if (workings.length === 0) return null;

  return (
    <div className="mt-2 border-t border-surface-200 dark:border-surface-700 pt-2">
      <button
        type="button"
        id="freight-workings-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="freight-workings-body"
        className="w-full flex items-center justify-between gap-2 text-[10px] font-bold uppercase
                   tracking-widest text-surface-500 dark:text-surface-300
                   hover:text-accent-600 dark:hover:text-accent-300 rounded
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40"
      >
        <span>How this is calculated</span>
        <span
          className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        >
          <ChevronIcon />
        </span>
      </button>

      {open && (
        <div id="freight-workings-body" className="mt-2 space-y-1.5">
          {workings.map((w, i) => (
            <div
              key={`${w.label}-${i}`}
              className="flex items-baseline justify-between gap-3 text-[10px] leading-snug"
            >
              <div className="min-w-0">
                <p className="font-bold text-surface-700 dark:text-surface-200">{w.label}</p>
                <p className="text-surface-500 dark:text-surface-400 break-words">
                  {w.expression}
                </p>
              </div>
              <p className="font-mono font-bold text-accent-700 dark:text-accent-300 whitespace-nowrap tabular-nums">
                {w.display}
              </p>
            </div>
          ))}

          {notes.length > 0 && (
            <ul className="mt-2 pt-2 border-t border-surface-200/70 dark:border-surface-700/70 space-y-1">
              {notes.map((note, i) => (
                <li
                  key={i}
                  className="text-[9px] leading-snug text-surface-500 dark:text-surface-400"
                >
                  <span aria-hidden="true">⚠ </span>
                  {note}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
});

FreightWorkings.displayName = 'FreightWorkings';

export default FreightWorkings;
