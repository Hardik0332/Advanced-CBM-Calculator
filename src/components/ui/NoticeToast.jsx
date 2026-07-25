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
        className={`bg-white dark:bg-surface-800 border rounded-xl px-4 py-3 shadow-pop dark:shadow-pop-dark flex items-center gap-3
          ${isError
            ? 'border-rose-200 dark:border-rose-800'
            : isUndo
              ? 'border-surface-200 dark:border-surface-700'
              : 'border-emerald-200 dark:border-emerald-800'
          }`}
        role="status"
      >
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
            ${isError
              ? 'bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400'
              : isUndo
                ? 'bg-surface-100 dark:bg-surface-700 text-surface-700 dark:text-surface-300'
                : 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400'
            }`}
        >
          {isError ? <WarningIcon /> : <CheckCircleIcon />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold text-surface-800 dark:text-surface-50">
            {notice.message}
          </p>
          {notice.detail && (
            <p className="text-xs text-surface-600 dark:text-surface-400">
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
            className="ml-2 flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold text-accent-600 dark:text-accent-300 bg-accent-50 dark:bg-accent-900/30 border border-accent-200 dark:border-accent-800 hover:bg-accent-100 dark:hover:bg-accent-900/50 active:scale-[0.97]"
          >
            Undo
          </button>
        )}
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="flex-shrink-0 p-1 rounded-lg text-surface-400 hover:text-surface-700 dark:hover:text-surface-200"
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
