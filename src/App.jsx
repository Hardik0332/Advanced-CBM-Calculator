/**
 * App.jsx — Root component.
 *
 * Wires custom hooks (useTheme, useShipment) to UI components.
 * This file is intentionally lean — all logic lives in hooks, all UI in components.
 */
import { useState } from 'react';
import { useTheme } from './hooks/useTheme';
import { useShipment } from './hooks/useShipment';
import Header from './components/layout/Header';
import CustomCBMForm from './components/calculator/CustomCBMForm';
import ActiveShipment from './components/shipment/ActiveShipment';
import ProductDirectory from './components/directory/ProductDirectory';
import ManualAddModal from './components/modals/ManualAddModal';
import ImportWizardModal from './components/modals/ImportWizardModal';
import ProductSummaryModal from './components/modals/ProductSummaryModal';
import ConfirmModal from './components/modals/ConfirmModal';
import { CheckCircleIcon } from './components/icons/Icons';

function App() {
  const [summaryData, setSummaryData] = useState(null);
  const { mode, isDark, setTheme } = useTheme();
  const {
    // Product directory
    products,
    filteredProducts,
    productSearch,
    setProductSearch,
    activeProductId,

    // Modal state
    importOpen,
    setImportOpen,
    manualAddOpen,
    setManualAddOpen,
    editingProduct,
    importResult,
    confirmConfig,
    setConfirmConfig,

    // Form
    form,
    updateForm,
    unitSwitchWarning,
    previewCBM,
    canAdd,

    // Shipment
    shipment,
    flashId,
    poNumber,
    setPoNumber,
    containerType,
    setContainerType,
    freightMode,
    setFreightMode,

    // Computed
    totals,
    volumetricWeight,
    chargeableWeight,
    containerPct,

    // Handlers
    handleAddProductToShipment,
    handleImportComplete,
    handleSaveProduct,
    handleEditProduct,
    handleCloseManualModal,
    handleDeleteProduct,
    handleProductClick,
    handleAddToShipment,
    handleAddToDirectory,
    handleRemove,
    handleQuantityChange,
    handleEditItem,
    handleDuplicateItem,
    clearShipment,
  } = useShipment();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-white to-indigo-50/60 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950/30">
      {/* ── Ambient orbs ── */}
      <div aria-hidden="true">
        <div className="orb w-96 h-96 -top-40 -left-32 bg-indigo-300/20 dark:bg-indigo-700/10" />
        <div className="orb w-80 h-80 top-1/3 -right-20 bg-purple-300/15 dark:bg-purple-700/10" />
        <div className="orb w-64 h-64 bottom-0 left-1/3 bg-cyan-300/10 dark:bg-cyan-700/8" />
      </div>

      {/* ── Import result toast ── */}
      {importResult && (
        <div className="fixed top-4 right-4 z-[60] fade-in">
          <div className="bg-white dark:bg-slate-800 border border-emerald-200 dark:border-emerald-700 rounded-xl px-4 py-3 shadow-lg flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/50 flex items-center justify-center text-emerald-600 dark:text-emerald-400 flex-shrink-0">
              <CheckCircleIcon />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-100">
                Import complete!
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {importResult.added > 0 && `${importResult.added} added`}
                {importResult.added > 0 && importResult.updated > 0 && ' · '}
                {importResult.updated > 0 && `${importResult.updated} updated`}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="relative z-10 max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* ── HEADER ── */}
        <Header mode={mode} setTheme={setTheme} />

        {/* ── MAIN GRID ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6">
          {/* Left: Custom CBM Form */}
          <CustomCBMForm
            form={form}
            updateForm={updateForm}
            unitSwitchWarning={unitSwitchWarning}
            previewCBM={previewCBM}
            canAdd={canAdd}
            handleAddToShipment={handleAddToShipment}
            handleAddToDirectory={handleAddToDirectory}
            products={products}
            handleProductClick={handleProductClick}
            activeProductId={activeProductId}
          />

          {/* Middle: Active Shipment */}
          <ActiveShipment
            shipment={shipment}
            flashId={flashId}
            poNumber={poNumber}
            setPoNumber={setPoNumber}
            containerType={containerType}
            setContainerType={setContainerType}
            freightMode={freightMode}
            setFreightMode={setFreightMode}
            totals={totals}
            volumetricWeight={volumetricWeight}
            chargeableWeight={chargeableWeight}
            containerPct={containerPct}
            handleRemove={handleRemove}
            handleQuantityChange={handleQuantityChange}
            handleEditItem={handleEditItem}
            handleDuplicateItem={handleDuplicateItem}
            clearShipment={clearShipment}
            handleAddProductToShipment={handleAddProductToShipment}
          />

          {/* Right: Product Directory */}
          <ProductDirectory
            products={products}
            filteredProducts={filteredProducts}
            productSearch={productSearch}
            setProductSearch={setProductSearch}
            activeProductId={activeProductId}
            handleProductClick={handleProductClick}
            setManualAddOpen={setManualAddOpen}
            setImportOpen={setImportOpen}
            handleEditProduct={handleEditProduct}
            handleDeleteProduct={handleDeleteProduct}
            setSummaryData={setSummaryData}
          />
        </div>

        <footer className="mt-8 text-center text-xs text-slate-400 dark:text-slate-600 pb-6">
          CBM Calculator Dashboard &nbsp;·&nbsp; Volume in m³ &nbsp;·&nbsp;
          Weight in kg
        </footer>
      </div>

      {/* ── Modals ── */}
      <ImportWizardModal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={handleImportComplete}
        existingProducts={products}
      />
      <ManualAddModal
        isOpen={manualAddOpen}
        onClose={handleCloseManualModal}
        onSave={handleSaveProduct}
        editingProduct={editingProduct}
      />
      <ProductSummaryModal
        isOpen={!!summaryData}
        onClose={() => setSummaryData(null)}
        data={summaryData}
      />
      <ConfirmModal
        isOpen={!!confirmConfig}
        message={confirmConfig?.message}
        onConfirm={confirmConfig?.onConfirm}
        onClose={() => setConfirmConfig(null)}
      />
    </div>
  );
}

export default App;
