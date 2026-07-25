/**
 * ProductDirectory — Right panel with product list, search, and import/add buttons.
 */
import { useMemo, memo } from 'react';
import { SearchIcon, ChevronIcon, ImportIcon, TrashIcon } from '../icons/Icons';
import { calcCBM, fmtCBM } from '../../utils/calculations';

/** CBM for a product card — dims win; otherwise fall back to pre-calc value. */
const productCBM = (p) => {
  if (p.length > 0 && p.width > 0 && p.height > 0)
    return calcCBM(p.length, p.width, p.height, p.unit);
  return Number(p.cbmPerShipper) || 0;
};

const ProductDirectory = memo(({
  products,
  filteredProducts,
  productSearch,
  setProductSearch,
  activeProductId,
  handleProductClick,
  setManualAddOpen,
  setImportOpen,
  handleEditProduct,
  handleDeleteProduct,
  setSummaryData,
  clearDirectory,
}) => {
  const panelCls = 'panel rounded-2xl shadow-panel';

  const sortedProducts = useMemo(() => {
    if (!filteredProducts) return [];
    const q = productSearch.trim().toLowerCase();
    return [...filteredProducts].sort((a, b) => {
      if (!q) return a.name.localeCompare(b.name);
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      const aStarts = aName.startsWith(q);
      const bStarts = bName.startsWith(q);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      const aWord = aName.includes(` ${q}`);
      const bWord = bName.includes(` ${q}`);
      if (aWord && !bWord) return -1;
      if (!aWord && bWord) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [filteredProducts, productSearch]);

  return (
    <section className="lg:col-span-3 fade-in" style={{ animationDelay: '0.22s' }}>
      <div className={`${panelCls} p-4 sm:p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2 max-w-full">
            <div className="w-8 h-8 rounded-lg bg-accent-50 dark:bg-accent-900/40 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-4 h-4 text-accent-600 dark:text-accent-300 no-theme-transition"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                />
              </svg>
            </div>
            <h2 className="text-base font-bold text-surface-800 dark:text-surface-50 truncate">
              Product Directory
            </h2>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setSummaryData(products)}
              title="Catalog Summary"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-accent-700 dark:text-accent-300 bg-accent-50 dark:bg-accent-900/40 border border-accent-200 dark:border-accent-800 hover:bg-accent-100 dark:hover:bg-accent-900/30"
            >
              📋 Summary
            </button>
            {products.length > 0 && (
              <button
                onClick={clearDirectory}
                title="Clear Directory"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 hover:bg-rose-100 dark:hover:bg-rose-900/30 active:scale-[0.96]"
              >
                <TrashIcon /> Clear
              </button>
            )}
            <button
              id="manual-add-btn"
              onClick={() => setManualAddOpen(true)}
              title="Add product manually"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 active:scale-[0.96]"
            >
              ➕ Add
            </button>
            <button
              id="import-data-btn"
              onClick={() => setImportOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-accent-600 text-white hover:bg-accent-700 active:scale-[0.96]"
            >
              <ImportIcon /> Import
            </button>
          </div>
        </div>

        {/* Search/Filter */}
        {products.length > 0 && (
          <div className="relative mb-3 sticky top-0 z-10">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-500 dark:text-surface-300">
              <SearchIcon />
            </span>
            <input
              id="product-search"
              type="text"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Search products…"
              className="w-full pl-9 pr-3 py-2 bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 rounded-xl text-sm font-medium text-surface-800 dark:text-surface-50 placeholder-surface-400 dark:placeholder-surface-400 focus:outline-none focus:ring-2 focus:ring-accent-500/40"
            />
          </div>
        )}

        {products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-14 h-14 rounded-2xl bg-surface-50 dark:bg-surface-800 border border-dashed border-surface-300 dark:border-surface-700 flex items-center justify-center mb-4 text-surface-400 dark:text-surface-500">
              <svg
                className="w-7 h-7 no-theme-transition"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4.5v15m7.5-7.5h-15"
                />
              </svg>
            </div>
            <p className="text-sm font-semibold text-surface-600 dark:text-surface-200">
              No products yet
            </p>
            <p className="text-xs text-surface-600 dark:text-surface-400 mt-1 max-w-[160px] break-words">
              Click <strong>Import</strong> to build your
              catalog
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs text-surface-600 dark:text-surface-300 mb-2">
              Click any product to auto-fill the calculator.
            </p>
            <div className="space-y-2 max-h-[450px] overflow-y-auto pr-1">
              {filteredProducts.length === 0 ? (
                <p className="text-xs text-surface-500 dark:text-surface-300 text-center py-6">
                  No products matching &quot;{productSearch}&quot;
                </p>
              ) : (
                sortedProducts
                  .map((product) => {
                    const isActive = activeProductId === product.id;
                    return (
                      <div
                        key={product.id}
                        id={`product-${product.id}`}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('application/json', JSON.stringify(product));
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => handleProductClick(product)}
                        className={`w-full max-w-full text-left rounded-xl p-3.5 group/card cursor-grab active:cursor-grabbing select-none
                          ${
                            isActive
                              ? 'bg-accent-50 dark:bg-accent-900/25 border border-accent-300 dark:border-accent-700'
                              : 'bg-white/60 dark:bg-surface-800/60 border border-surface-200 dark:border-surface-700 hover:border-surface-300 dark:hover:border-surface-700 hover:bg-white/80 dark:hover:bg-surface-800/80'
                          }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="text-xl flex-shrink-0">
                              {product.icon}
                            </span>
                            <div className="min-w-0">
                              <h3 className="text-sm font-bold text-surface-800 dark:text-surface-50 truncate">
                                {product.name}
                              </h3>
                              <p className="text-[11px] text-surface-500 dark:text-surface-300 mt-0.5 truncate">
                                {product.length > 0 || product.width > 0 || product.height > 0
                                  ? `${Number(product.length).toFixed(2)}×${Number(product.width).toFixed(2)}×${Number(product.height).toFixed(2)} ${product.unit}`
                                  : `pre-calc · ${fmtCBM(productCBM(product))} m³`}
                              </p>
                            </div>
                          </div>
                          <div className="text-surface-500 dark:text-surface-300 flex-shrink-0 flex items-center gap-1">
                            <ChevronIcon />
                          </div>
                        </div>
                        {isActive && (
                          <div className="mt-3 pt-3 border-t border-surface-200 dark:border-surface-700">
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                              {[
                                ['Pack', `${product.packSize} pcs`],
                                ['Net Wt', `${Number(product.netWeightPerUnit).toFixed(2)} kg`],
                                ['Gross', `${Number(product.grossWeightPerShipper).toFixed(2)} kg`],
                                ['Unit', product.unit.toUpperCase()],
                              ].map(([k, v]) => (
                                <div key={k} className="flex justify-between gap-1">
                                  <span className="text-surface-500 dark:text-surface-300 flex-shrink-0">
                                    {k}
                                  </span>
                                  <span className="text-surface-700 dark:text-surface-300 font-mono truncate">
                                    {v}
                                  </span>
                                </div>
                              ))}
                              <div className="flex justify-between col-span-2 gap-1">
                                <span className="text-surface-500 dark:text-surface-300 flex-shrink-0">
                                  CBM
                                </span>
                                <span className="text-accent-600 dark:text-accent-300 font-mono font-bold truncate">
                                  {fmtCBM(productCBM(product))} m³
                                </span>
                              </div>
                            </div>
                            <div className="flex justify-end gap-2 mt-3 pt-2.5 border-t border-surface-200/60 dark:border-surface-700/60">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSummaryData(product);
                                }}
                                className="px-2.5 py-1 rounded bg-accent-50 dark:bg-accent-900/40 hover:bg-accent-100 dark:hover:bg-accent-900/30 text-[10px] font-bold text-accent-700 dark:text-accent-300 border border-accent-200/80 dark:border-accent-800/80 active:scale-[0.97]"
                              >
                                ℹ️ Summary
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditProduct(product);
                                }}
                                className="px-2.5 py-1 rounded bg-white dark:bg-surface-700 hover:bg-surface-50 dark:hover:bg-surface-700 text-[10px] font-bold text-surface-700 dark:text-surface-50 border border-surface-200 dark:border-surface-700 active:scale-[0.97]"
                              >
                                ✏️ Edit
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteProduct(product.id);
                                }}
                                className="px-2.5 py-1 rounded bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/30 text-[10px] font-bold text-rose-600 dark:text-rose-400 border border-rose-200/80 dark:border-rose-800/80 active:scale-[0.97]"
                              >
                                🗑️ Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
              )}
            </div>
          </>
        )}

        <div className="mt-4 pt-3 border-t border-surface-200 dark:border-surface-700">
          <p className="text-[11px] text-surface-500 dark:text-surface-400 text-center">
            {products.length} product{products.length !== 1 ? 's' : ''} in
            directory
          </p>
        </div>
      </div>
    </section>
  );
});

ProductDirectory.displayName = 'ProductDirectory';

export default ProductDirectory;
