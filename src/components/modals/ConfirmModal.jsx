/**
 * ConfirmModal — Custom styled overlay for confirming destructive or critical actions (e.g. clearing shipment, deleting product).
 */
import { WarningIcon } from '../icons/Icons';

const ConfirmModal = ({ isOpen, message, onConfirm, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 fade-in">
      <div
        className="absolute inset-0 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-[2px] wizard-backdrop"
        onClick={onClose}
      />
      <div
        className="relative max-w-sm w-full bg-white/95 dark:bg-slate-900/95 rounded-2xl shadow-2xl border border-slate-200/80 dark:border-slate-700/80 p-5 text-center wizard-panel scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400 flex items-center justify-center mx-auto mb-4 border border-amber-200 dark:border-amber-800">
          <WarningIcon />
        </div>
        <h3 className="text-base font-bold text-slate-800 dark:text-slate-100 mb-1">
          Are you sure?
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">
          {message}
        </p>
        <div className="flex justify-center gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 px-4 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-750 transition-colors"
          >
            Cancel
          </button>
          <button
            id="confirm-modal-ok-btn"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="flex-1 py-2 px-4 rounded-xl text-xs font-bold text-white bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 hover:shadow-glow active:scale-[0.98] transition-all"
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
