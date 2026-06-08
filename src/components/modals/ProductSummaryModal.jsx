import { CloseIcon, FileDocIcon, ExcelIcon } from '../icons/Icons';
import { exportRawDataExcel } from '../../utils/exporting';

const getDisplayRawData = (product) => {
  if (product.rawData) return product.rawData;
  return {
    'Product Name': product.name || null,
    'Length': product.length || null,
    'Width': product.width || null,
    'Height': product.height || null,
    'Unit': product.unit || null,
    'Pack Size': product.packSize || null,
    'Net Wt': product.netWeightPerUnit || null,
    'Gross Wt': product.grossWeightPerShipper || null,
    'CBM': product.cbmPerShipper || null,
  };
};

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
  if (!isOpen || !data) return null;

  const isCatalogMode = Array.isArray(data);

  const renderSingleMode = () => {
    const rawData = getDisplayRawData(data);
    const entries = Object.entries(rawData).filter(
      ([key, value]) => value !== null && value !== undefined && value !== ''
    );

    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {entries.map(([k, v]) => (
          <div
            key={k}
            className="bg-white/50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-200/60 dark:border-slate-700/60"
          >
            <div className="text-xs text-slate-500 dark:text-slate-400 mb-0.5 font-semibold">
              {k}
            </div>
            <div className="text-sm text-slate-800 dark:text-slate-200 break-words font-medium">
              {formatValue(v)}
            </div>
          </div>
        ))}
        {entries.length === 0 && (
          <div className="col-span-1 sm:col-span-2 text-center text-sm text-slate-500 py-8">
            No additional raw data found.
          </div>
        )}
      </div>
    );
  };

  const renderCatalogMode = () => {
    if (data.length === 0) {
      return (
        <div className="text-center text-sm text-slate-500 py-8">
          No products available.
        </div>
      );
    }

    // Extract all unique keys across all rawData objects
    const allKeys = new Set();
    data.forEach((product) => {
      const rawData = getDisplayRawData(product);
      Object.keys(rawData).forEach((key) => allKeys.add(key));
    });

    const headers = Array.from(allKeys);

    return (
      <div className="overflow-auto max-h-[50vh] sm:max-h-[60vh] rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm relative custom-scrollbar">
        <table className="w-full text-left border-collapse min-w-max whitespace-nowrap">
          <thead>
            <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-30">
              {/* FIXED: Made the header sticky top and left, gave it a solid background, and constrained its width */}
              <th className="p-3 text-xs font-bold text-slate-700 dark:text-slate-300 sticky left-0 top-0 z-40 bg-slate-100 dark:bg-slate-800 border-r border-slate-200 dark:border-slate-700 w-48 sm:w-64 max-w-[12rem] sm:max-w-[16rem] truncate">
                Product Name
              </th>
              {headers.map((h) => (
                <th
                  key={h}
                  className="p-3 text-xs font-bold text-slate-700 dark:text-slate-300 max-w-[200px] truncate sticky top-0 z-30 bg-slate-100 dark:bg-slate-800"
                  title={h}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700 bg-white/40 dark:bg-slate-900/40">
            {data.map((product, idx) => {
              const rawData = getDisplayRawData(product);
              return (
                <tr
                  key={product.id || idx}
                  className="hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors group"
                >
                  <td
                    className="p-3 text-sm text-slate-800 dark:text-slate-200 font-bold sticky left-0 z-10 bg-white dark:bg-slate-900 group-hover:bg-slate-50 dark:group-hover:bg-slate-800/80 border-r border-slate-200/50 dark:border-slate-700/50 max-w-[12rem] sm:max-w-[16rem] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]"
                    title={product.name}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate">{product.name}</span>
                      {!product.rawData && (
                        <span className="flex-shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-600 uppercase tracking-wide">
                          manual
                        </span>
                      )}
                    </div>
                  </td>
                  {headers.map((h) => (
                    <td
                      key={h}
                      className="p-3 text-sm text-slate-600 dark:text-slate-400 max-w-[200px] truncate"
                      title={String(rawData[h] || '')}
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-slate-900/50 dark:bg-slate-950/70 backdrop-blur-sm wizard-backdrop"
        onClick={onClose}
      />
      <div
        className={`relative flex flex-col w-full ${isCatalogMode ? 'max-w-6xl max-h-[85vh]' : 'max-w-2xl max-h-[80vh]'
          } bg-white/95 dark:bg-slate-900/95 rounded-2xl shadow-2xl border border-slate-200/80 dark:border-slate-700/80 wizard-panel overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >

        {/* MODAL HEADER - Fixed Overlap Bug */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-slate-200 dark:border-slate-700 bg-white/50 dark:bg-slate-800/50 flex-shrink-0">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0 pr-4">
            {/* Replaced emoji with SVG and locked dimensions */}
            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 flex-shrink-0">
              <FileDocIcon />
            </div>

            {/* Added min-w-0 and truncate to force text boundaries */}
            <div className="flex flex-col min-w-0">
              <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 truncate">
                {isCatalogMode
                  ? 'Catalog Summary'
                  : `${data.name || 'Product'} Summary`}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {isCatalogMode
                  ? 'Viewing raw data for all imported products'
                  : 'Viewing imported raw data'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => exportRawDataExcel(data)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-100 dark:bg-emerald-900/40 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 border border-emerald-200 dark:border-emerald-800/80 transition-colors flex items-center gap-1.5 flex-shrink-0"
              title="Download Excel"
            >
              <ExcelIcon />
              <span className="hidden sm:inline">Export Excel</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex-shrink-0 transition-colors"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto custom-scrollbar">
          {isCatalogMode ? renderCatalogMode() : renderSingleMode()}
        </div>
      </div>
    </div>
  );
};

export default ProductSummaryModal;