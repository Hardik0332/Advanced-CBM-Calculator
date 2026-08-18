/**
 * ErrorBoundary — last line of defence against a white screen.
 *
 * Any render crash below this boundary previously took the whole app down with
 * no way back short of clearing browser data. The recovery screen deliberately
 * depends on nothing but `utils/storage` (which is synchronous and non-throwing),
 * so it still works when app state is the thing that's broken.
 *
 * Escalating recovery, least destructive first:
 *   1. Download backup — always offered, so nothing is lost by trying the rest.
 *   2. Reset shipment  — clears the active shipment, keeps the product catalog.
 *   3. Reset everything — clears all app keys plus the IndexedDB raw-data store.
 */
import { Component } from 'react';
import {
  STORAGE_KEYS,
  buildBackup,
  backupFileName,
  clearKeys,
  clearRawData,
  estimateUsage,
} from '../../utils/storage';
import { WarningIcon } from '../icons/Icons';

const btnBase =
  'w-full py-2.5 px-4 rounded-xl font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98]';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null, backupDone: false, actionDone: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.setState({ info });
    // Keep the real stack in the console for anyone debugging from a report.
    console.error('CBM Calculator crashed:', error, info?.componentStack);
  }

  handleDownloadBackup = () => {
    try {
      const blob = new Blob([JSON.stringify(buildBackup(), null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = backupFileName();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.setState({ backupDone: true });
    } catch {
      this.setState({ actionDone: 'Backup failed — try "Reset shipment" instead.' });
    }
  };

  handleResetShipment = () => {
    clearKeys([STORAGE_KEYS.shipment, STORAGE_KEYS.meta]);
    window.location.reload();
  };

  handleResetEverything = () => {
    clearKeys();
    // Fire-and-forget: never block the reload on IndexedDB, which may be
    // unavailable in exactly the situations that got us here.
    Promise.resolve(clearRawData()).finally(() => window.location.reload());
  };

  render() {
    if (!this.state.error) return this.props.children;

    const { error, info, backupDone, actionDone } = this.state;
    const usage = (() => {
      try {
        return Math.round(estimateUsage().totalBytes / 1024);
      } catch {
        return null;
      }
    })();

    return (
      <div className="min-h-screen bg-surface-50 dark:bg-surface-900 flex items-center justify-center p-4">
        <div className="panel rounded-2xl shadow-panel w-full max-w-lg p-6 sm:p-8">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400 flex items-center justify-center flex-shrink-0">
              <WarningIcon />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-surface-800 dark:text-surface-50">
                Something went wrong
              </h1>
              <p className="text-xs text-surface-600 dark:text-surface-400 mt-0.5">
                Your saved data is still on this device.
              </p>
            </div>
          </div>

          <p className="text-sm text-surface-600 dark:text-surface-300 mb-5">
            This is usually caused by saved data the app can no longer read.
            Download a backup first — then try the smallest reset that fixes it.
          </p>

          <div className="space-y-2.5">
            <button
              type="button"
              onClick={this.handleDownloadBackup}
              className={`${btnBase} bg-accent-600 text-white hover:bg-accent-700`}
            >
              {backupDone ? 'Backup downloaded ✓' : 'Download backup'}
            </button>

            <button
              type="button"
              onClick={() => window.location.reload()}
              className={`${btnBase} bg-white dark:bg-surface-800 text-surface-700 dark:text-surface-200 border border-surface-200 dark:border-surface-700 hover:bg-surface-50 dark:hover:bg-surface-700`}
            >
              Reload the page
            </button>

            <button
              type="button"
              onClick={this.handleResetShipment}
              className={`${btnBase} bg-white dark:bg-surface-800 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-amber-950/40`}
            >
              Reset shipment only (keeps your products)
            </button>

            <button
              type="button"
              onClick={this.handleResetEverything}
              className={`${btnBase} bg-white dark:bg-surface-800 text-rose-600 dark:text-rose-400 border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/40`}
            >
              Reset everything
            </button>
          </div>

          {actionDone && (
            <p className="mt-4 text-xs font-semibold text-rose-600 dark:text-rose-400">
              {actionDone}
            </p>
          )}

          <details className="mt-6 group">
            <summary className="text-xs font-semibold text-surface-500 dark:text-surface-400 cursor-pointer hover:text-surface-700 dark:hover:text-surface-200 select-none">
              Technical details
            </summary>
            <div className="mt-2 p-3 rounded-lg bg-surface-50 dark:bg-surface-800 border border-surface-200 dark:border-surface-700 overflow-auto max-h-48">
              <p className="text-[11px] font-mono text-rose-600 dark:text-rose-400 break-words">
                {error?.name}: {error?.message}
              </p>
              {usage != null && (
                <p className="text-[11px] font-mono text-surface-500 dark:text-surface-400 mt-2">
                  Stored data: {usage} KB
                </p>
              )}
              {info?.componentStack && (
                <pre className="text-[10px] font-mono text-surface-500 dark:text-surface-400 mt-2 whitespace-pre-wrap">
                  {info.componentStack.trim().split('\n').slice(0, 8).join('\n')}
                </pre>
              )}
            </div>
          </details>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
