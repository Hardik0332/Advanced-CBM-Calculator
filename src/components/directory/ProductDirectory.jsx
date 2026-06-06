/**
 * ProductDirectory — Right panel with product list, search, and import/add buttons.
 */
import { SearchIcon, ChevronIcon, ImportIcon } from '../icons/Icons';
import { calcCBM } from '../../utils/calculations';

const ProductDirectory = ({
  products,
  filteredProducts,
  productSearch,
  setProductSearch,
  activeProductId,
  handleProductClick,
  setManualAddOpen,
  setImportOpen,
}) => {
  const panelCls = 'glass rounded-2xl shadow-card dark:shadow-card-dark';

  return (
    <section className="lg:col-span-3 fade-in" style={{ animationDelay: '0.22s' }}>
      <div className={`${panelCls} p-5`}>
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center flex-shrink-0">
              <svg
                className="w-4 h-4 text-violet-600 dark:text-violet-400 no-theme-transition"
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
            <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 truncate">
              Product Directory
            </h2>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              id="manual-add-btn"
              onClick={() => setManualAddOpen(true)}
              title="Add manually"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/30"
            >
              ➕ Add
            </button>
            <button
              id="import-data-btn"
              onClick={() => setImportOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-gradient-to-r from-indigo-600 to-violet-600 text-white hover:from-indigo-500 hover:to-violet-500 hover:shadow-glow active:scale-[0.96]"
            >
              <ImportIcon /> Import
            </button>
          </div>
        </div>

        {/* Search/Filter */}
        {products.length > 0 && (
          <div className="relative mb-3 sticky top-0 z-10">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500">
              <SearchIcon />
            </span>
            <input
              id="product-search"
              type="text"
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              placeholder="Search products…"
              className="w-full pl-9 pr-3 py-2 bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-600/70 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
            />
          </div>
        )}

        {products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-14 h-14 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-dashed border-slate-300 dark:border-slate-600 flex items-center justify-center mb-4 text-slate-300 dark:text-slate-600">
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
            <p className="text-sm font-semibold text-slate-500 dark:text-slate-400">
              No products yet
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-600 mt-1 max-w-[160px] break-words">
              Click <strong>Import</strong> or <strong>Add</strong> to build your
              catalog
            </p>
          </div>
        ) : (
          <>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
              Click any product to auto-fill the calculator.
            </p>
            <div className="space-y-2 max-h-[450px] overflow-y-auto pr-1">
              {filteredProducts.length === 0 ? (
                <p className="text-xs text-slate-400 dark:text-slate-500 text-center py-6">
                  No products matching &quot;{productSearch}&quot;
                </p>
              ) : (
                [...filteredProducts]
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((product) => {
                    const isActive = activeProductId === product.id;
                    return (
                      <button
                        key={product.id}
                        id={`product-${product.id}`}
                        onClick={() => handleProductClick(product)}
                        className={`w-full max-w-full text-left rounded-xl p-3.5 group/card
                          ${
                            isActive
                              ? `bg-gradient-to-r ${product.color} dark:from-indigo-950/60 dark:to-violet-950/40 border ${product.border} dark:border-indigo-700/60 shadow-glow`
                              : 'bg-white/60 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 hover:bg-white/80 dark:hover:bg-slate-800/80'
                          }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <span className="text-xl flex-shrink-0">
                              {product.icon}
                            </span>
                            <div className="min-w-0">
                              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate">
                                {product.name}
                              </h3>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                                {product.length}×{product.width}×{product.height}{' '}
                                {product.unit}
                              </p>
                            </div>
                          </div>
                          <span className="text-slate-400 dark:text-slate-500 flex-shrink-0">
                            <ChevronIcon />
                          </span>
                        </div>
                        {isActive && (
                          <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                              {[
                                ['Pack', `${product.packSize} pcs`],
                                ['Net Wt', `${product.netWeightPerUnit} kg`],
                                ['Gross', `${product.grossWeightPerShipper} kg`],
                                ['Unit', product.unit.toUpperCase()],
                              ].map(([k, v]) => (
                                <div key={k} className="flex justify-between gap-1">
                                  <span className="text-slate-500 dark:text-slate-400 flex-shrink-0">
                                    {k}
                                  </span>
                                  <span className="text-slate-700 dark:text-slate-300 font-mono truncate">
                                    {v}
                                  </span>
                                </div>
                              ))}
                              <div className="flex justify-between col-span-2 gap-1">
                                <span className="text-slate-500 dark:text-slate-400 flex-shrink-0">
                                  CBM
                                </span>
                                <span className="text-indigo-600 dark:text-indigo-400 font-mono font-bold truncate">
                                  {calcCBM(
                                    product.length,
                                    product.width,
                                    product.height,
                                    product.unit
                                  ).toFixed(6)}{' '}
                                  m³
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                      </button>
                    );
                  })
              )}
            </div>
          </>
        )}

        <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
          <p className="text-[11px] text-slate-400 dark:text-slate-600 text-center">
            {products.length} product{products.length !== 1 ? 's' : ''} in
            directory
          </p>
        </div>
      </div>
    </section>
  );
};

export default ProductDirectory;
