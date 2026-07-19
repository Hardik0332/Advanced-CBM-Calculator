/**
 * NoticeToast — Unified toast for success messages, storage errors, and
 * undoable destructive actions (clear shipment/directory, delete, remove).
 */
import { memo } from 'react';
import { CheckCircleIcon, WarningIcon } from '../icons/Icons';

const NoticeToast = memo(({ notice, onDismiss }) => {
  if (!notice) return null;

  const isError = notice.type === 'error';
  const isUndo = notice.type === 'undo';

  return (
    <div className="fixed top-4 right-4 z-[60] fade-in max-w-sm">
      <div
        className={`bg-white dark:bg-slate-800 border rounded-xl px-4 py-3 shadow-lg flex items-center gap-3
          ${isError
            ? 'border-rose-200 dark:border-rose-700'
            : isUndo
              ? 'border-slate-200 dark:border-slate-600'
              : 'border-emerald-200 dark:border-emerald-700'
          }`}
        role="status"
      >
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
            ${isError
              ? 'bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400'
              : isUndo
                ? 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'
                : 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400'
            }`}
        >
          {isError ? <WarningIcon /> : <CheckCircleIcon />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
            {notice.message}
          </p>
          {notice.detail && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {notice.detail}
            </p>
          )}
        </div>
        {isUndo && notice.onUndo && (
          <button
            type="button"
            onClick={() => {
              notice.onUndo();
              onDismiss();
            }}
            className="ml-2 flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 active:scale-[0.97]"
          >
            Undo
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="flex-shrink-0 p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
});

NoticeToast.displayName = 'NoticeToast';

export default NoticeToast;
