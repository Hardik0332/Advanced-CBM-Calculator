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
    if (data.length === 0) {
      return (
        <div className="text-center text-sm text-surface-500 py-8">
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
      <div className="overflow-auto max-h-[50vh] sm:max-h-[60vh] rounded-xl border border-surface-200 dark:border-surface-700 shadow-sm relative custom-scrollbar">
        <table className="w-full text-left border-collapse min-w-max whitespace-nowrap">
          <thead>
            <tr className="bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700 sticky top-0 z-30">
              {/* FIXED: Made the header sticky top and left, gave it a solid background, and constrained its width */}
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
            {data.map((product, idx) => {
              const rawData = getDisplayRawData(product);
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
                      {!product.rawData && (
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
        className="absolute inset-0 bg-surface-900/40 dark:bg-surface-900/70 backdrop-blur-sm wizard-backdrop"
        onClick={onClose}
      />
      <div
        className={`relative flex flex-col w-full ${isCatalogMode ? 'max-w-6xl max-h-[85vh]' : 'max-w-2xl max-h-[80vh]'
          } bg-white dark:bg-surface-800 rounded-2xl shadow-pop dark:shadow-pop-dark border border-surface-200 dark:border-surface-700 wizard-panel overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >

        {/* MODAL HEADER - Fixed Overlap Bug */}
        <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 flex-shrink-0">
          <div className="flex items-center gap-3 sm:gap-4 min-w-0 pr-4">
            {/* Replaced emoji with SVG and locked dimensions */}
            <div className="w-10 h-10 rounded-xl bg-accent-100 dark:bg-accent-900/50 flex items-center justify-center text-accent-600 dark:text-accent-300 flex-shrink-0">
              <FileDocIcon />
            </div>

            {/* Added min-w-0 and truncate to force text boundaries */}
            <div className="flex flex-col min-w-0">
              <h2 className="text-base font-bold text-surface-800 dark:text-surface-50 truncate">
                {isCatalogMode
                  ? 'Catalog Summary'
                  : `${data.name || 'Product'} Summary`}
              </h2>
              <p className="text-xs text-surface-500 dark:text-surface-300 truncate">
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
              className="p-2 rounded-lg text-surface-400 hover:text-surface-700 dark:hover:text-surface-50 hover:bg-surface-100 dark:hover:bg-surface-700 flex-shrink-0 transition-colors"
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