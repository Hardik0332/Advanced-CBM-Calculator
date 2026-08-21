/**
 * ProductSummaryModal — shows the original imported columns for one product or
 * the whole catalog.
 *
 * Raw import data is too bulky for localStorage, so it lives in IndexedDB
 * (see utils/storage). Products loaded from a previous session therefore arrive
 * without `rawData` attached; this modal hydrates what's missing on open, which
 * is why the table no longer goes blank after a refresh.
 */
import { useState, useEffect, useMemo } from 'react';
import { FileDocIcon, ExcelIcon } from '../icons/Icons';
import Modal from '../ui/Modal';
import { exportRawDataExcel } from '../../utils/exporting';
import { getRawData } from '../../utils/storage';

/** Fall back to the normalised fields when a product was never imported. */
const derivedRawData = (product) => ({
  'Product Name': product.name || null,
  Length: product.length || null,
  Width: product.width || null,
  Height: product.height || null,
  Unit: product.unit || null,
  'Pack Size': product.packSize || null,
  'Net Wt': product.netWeightPerUnit || null,
  'Gross Wt': product.grossWeightPerShipper || null,
  CBM: product.cbmPerShipper || null,
});

const formatValue = (v) => {
  if (v === null || v === undefined || v === '') return v;
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  if (typeof v === 'string' && !isNaN(v) && v.trim() !== '') {
    const num = Number(v);
    if (!Number.isInteger(num)) {
      return num.toFixed(2);
    }
  }
  return String(v);
};

const ProductSummaryModal = ({ isOpen, onClose, data }) => {
  /* id -> rawData recovered from IndexedDB for products that lost it on reload. */
  const [hydrated, setHydrated] = useState({});
  /* The Excel export is async now — `xlsx` loads on demand — so the button owns a
     busy state and surfaces a failure rather than appearing to do nothing. */
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState('');

  const items = useMemo(() => {
    if (!data) return [];
    return Array.isArray(data) ? data.filter(Boolean) : [data];
  }, [data]);

  useEffect(() => {
    if (!isOpen) return;
    const missing = items.filter((p) => p?.id && !p.rawData).map((p) => p.id);
    if (missing.length === 0) return;

    let cancelled = false;
    getRawData(missing).then((map) => {
      if (!cancelled && map && Object.keys(map).length > 0) setHydrated(map);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, items]);

  /* No reset on close is needed: `hydrated` is keyed by product id, so an entry
     cached for one product can only ever be read back for that same product. */
  const displayRawData = (product) =>
    product.rawData || hydrated[product.id] || derivedRawData(product);

  if (!isOpen || !data) return null;

  const isCatalogMode = Array.isArray(data);

  /** Union of every column present across the displayed products. */
  const allHeaders = () => {
    const keys = new Set();
    items.forEach((p) => Object.keys(displayRawData(p)).forEach((k) => keys.add(k)));
    return Array.from(keys);
  };

  const renderSingleMode = () => {
    const rawData = displayRawData(data);
    const entries = Object.entries(rawData).filter(
      ([, value]) => value !== null && value !== undefined && value !== ''
    );

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {entries.map(([k, v]) => (
          <div
            key={k}
            className="bg-white/50 dark:bg-surface-800/50 p-3 rounded-xl border border-surface-200 dark:border-surface-700"
          >
            <div className="text-xs text-surface-500 dark:text-surface-300 mb-0.5 font-semibold">
              {k}
            </div>
            <div className="text-sm text-surface-800 dark:text-surface-50 break-words font-medium">
              {formatValue(v)}
            </div>
          </div>
        ))}
        {entries.length === 0 && (
          <div className="col-span-1 sm:col-span-2 text-center text-sm text-surface-500 py-8">
            No additional raw data found.
          </div>
        )}
      </div>
    );
  };

  const renderCatalogMode = () => {
    if (items.length === 0) {
      return (
        <div className="text-center text-sm text-surface-500 py-8">
          No products available.
        </div>
      );
    }

    const headers = allHeaders();

    return (
      <div className="overflow-auto max-h-[50vh] sm:max-h-[60vh] rounded-xl border border-surface-200 dark:border-surface-700 shadow-sm relative custom-scrollbar">
        <table className="w-full text-left border-collapse min-w-max whitespace-nowrap">
          <thead>
            <tr className="bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 sticky top-0 z-30">
              {/* Sticky on both axes, solid background, constrained width. */}
              <th className="p-3 text-xs font-bold text-surface-700 dark:text-surface-300 sticky left-0 top-0 z-40 bg-surface-100 dark:bg-surface-800 border-r border-surface-200 dark:border-surface-700 w-48 sm:w-64 max-w-[12rem] sm:max-w-[16rem] truncate">
                Product Name
              </th>
              {headers.map((h) => (
                <th
                  key={h}
                  className="p-3 text-xs font-bold text-surface-700 dark:text-surface-300 max-w-[200px] truncate sticky top-0 z-30 bg-surface-100 dark:bg-surface-800"
                  title={h}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-200 dark:divide-surface-700 bg-white/40 dark:bg-surface-900/40">
            {items.map((product, idx) => {
              const rawData = displayRawData(product);
              const isImported = !!(product.rawData || hydrated[product.id]);
              return (
                <tr
                  key={product.id || idx}
                  className="hover:bg-white/60 dark:hover:bg-surface-800/60 transition-colors group"
                >
                  <td
                    className="p-3 text-sm text-surface-800 dark:text-surface-50 font-bold sticky left-0 z-10 bg-white dark:bg-surface-900 group-hover:bg-surface-50 dark:group-hover:bg-surface-800/80 border-r border-surface-200 dark:border-surface-700 max-w-[12rem] sm:max-w-[16rem] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]"
                    title={product.name}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate">{product.name}</span>
                      {!isImported && (
                        <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-surface-100 dark:bg-surface-700 text-surface-500 dark:text-surface-300 border border-surface-200 dark:border-surface-700 uppercase tracking-wide">
                          manual
                        </span>
                      )}
                    </div>
                  </td>
                  {headers.map((h) => (
                    <td
                      key={h}
                      className="p-3 text-sm text-surface-700 dark:text-surface-300 max-w-[200px] truncate"
                      title={String(rawData[h] ?? '')}
                    >
                      {rawData[h] !== null &&
                        rawData[h] !== undefined &&
                        rawData[h] !== ''
                        ? formatValue(rawData[h])
                        : '-'}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  /* Hand the exporter the hydrated view so a downloaded summary matches the
     table on screen rather than silently omitting recovered columns. */
  const exportPayload = isCatalogMode
    ? items.map((p) => (p.rawData ? p : { ...p, rawData: hydrated[p.id] }))
    : data.rawData
      ? data
      : { ...data, rawData: hydrated[data.id] };

  const handleExport = async () => {
    setExportBusy(true);
    setExportError('');
    try {
      const written = await exportRawDataExcel(exportPayload);
      if (!written) setExportError('There is no raw import data to export.');
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'The export failed.');
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCatalogMode ? 'Catalog Summary' : `${data.name || 'Product'} Summary`}
      subtitle={
        isCatalogMode
          ? 'Viewing raw data for all imported products'
          : 'Viewing imported raw data'
      }
      icon={<FileDocIcon />}
      size={isCatalogMode ? '4xl' : 'xl'}
      maxHeight={isCatalogMode ? 'max-h-[85vh]' : 'max-h-[80vh]'}
      bodyClassName="p-5"
      headerActions={
        <button
          onClick={handleExport}
          disabled={exportBusy}
          className="px-3 py-1.5 rounded-lg text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/40 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 border border-emerald-200 dark:border-emerald-800/80 transition-colors flex items-center gap-1.5 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Download Excel"
        >
          <ExcelIcon />
          <span className="hidden sm:inline">
            {exportBusy ? 'Exporting…' : 'Export Excel'}
          </span>
        </button>
      }
    >
      {exportError && (
        <p
          role="alert"
          className="mb-3 px-3 py-2 rounded-lg text-[11px] font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800"
        >
          {exportError}
        </p>
      )}
      {isCatalogMode ? renderCatalogMode() : renderSingleMode()}
    </Modal>
  );
};

export default ProductSummaryModal;
