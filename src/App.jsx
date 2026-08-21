/**
 * App.jsx — Root component.
 *
 * Wires custom hooks (useTheme, useShipment) to UI components.
 * This file is intentionally lean — all logic lives in hooks, all UI in components.
 */
import { useState, useCallback } from 'react';
import { useTheme } from './hooks/useTheme';
import { useShipment } from './hooks/useShipment';
import { useCompanyProfile } from './hooks/useCompanyProfile';
import Header from './components/layout/Header';
import CustomCBMForm from './components/calculator/CustomCBMForm';
import ActiveShipment from './components/shipment/ActiveShipment';
import ProductDirectory from './components/directory/ProductDirectory';
import ManualAddModal from './components/modals/ManualAddModal';
import ImportWizardModal from './components/modals/ImportWizardModal';
import ProductSummaryModal from './components/modals/ProductSummaryModal';
import CompanyProfileModal from './components/modals/CompanyProfileModal';
import NoticeToast from './components/ui/NoticeToast';

function App() {
  const [summaryData, setSummaryData] = useState(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const { mode, setTheme } = useTheme();
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

    // Notices / undo
    notice,
    dismissNotice,

    // Form
    form,
    updateForm,
    unitSwitch,
    convertFormUnits,
    dismissUnitSwitch,
    previewCBM,
    canAdd,

    // Shipment
    shipment,
    flashId,
    poNumber,
    setPoNumber,
    containerType,
    setContainerType,
    customContainer,
    updateCustomContainer,
    freightMode,
    setFreightMode,

    // Trade metadata for the export documents
    trade,
    updateTradeMeta,
    exportMeta,

    // Country & carrier rule profiles
    destinationCountry,
    setDestinationCountry,
    carrierProfile,
    setCarrierProfile,
    ruleOverrides,
    updateRuleOverride,
    resetRuleOverrides,

    // Computed
    totals,
    freight,
    container,
    volumetricWeight,
    chargeableWeight,
    containerPct,
    payloadPct,
    containerPlan,

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
    updateItemTradeField,
    handleEditItem,
    handleDuplicateItem,
    clearShipment,
    clearDirectory,
    reportStorageError,
  } = useShipment();

  /* The company profile lives in its own hook and its own storage key: it outlives
     any single shipment and must survive "clear shipment". */
  const {
    company,
    updateCompany,
    addParty,
    updateParty,
    removeParty,
    setLogoFromFile,
    clearLogo,
  } = useCompanyProfile(reportStorageError);

  // Stable callbacks to prevent re-renders of memoized modal children
  const handleCloseImport   = useCallback(() => setImportOpen(false), [setImportOpen]);
  const handleCloseSummary  = useCallback(() => setSummaryData(null), []);
  const handleOpenProfile   = useCallback(() => setProfileOpen(true), []);
  const handleCloseProfile  = useCallback(() => setProfileOpen(false), []);

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-900">
      {/* ── Notice / undo toast ── */}
      <NoticeToast notice={notice} onDismiss={dismissNotice} />

      <div className="relative z-10 max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* ── HEADER ── */}
        <Header mode={mode} setTheme={setTheme} onOpenProfile={handleOpenProfile} />

        {/* ── MAIN GRID ── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-6">
          {/* Left: Custom CBM Form */}
          <CustomCBMForm
            form={form}
            updateForm={updateForm}
            unitSwitch={unitSwitch}
            convertFormUnits={convertFormUnits}
            dismissUnitSwitch={dismissUnitSwitch}
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
            customContainer={customContainer}
            updateCustomContainer={updateCustomContainer}
            freightMode={freightMode}
            setFreightMode={setFreightMode}
            destinationCountry={destinationCountry}
            setDestinationCountry={setDestinationCountry}
            carrierProfile={carrierProfile}
            setCarrierProfile={setCarrierProfile}
            ruleOverrides={ruleOverrides}
            updateRuleOverride={updateRuleOverride}
            resetRuleOverrides={resetRuleOverrides}
            trade={trade}
            updateTradeMeta={updateTradeMeta}
            exportMeta={exportMeta}
            company={company}
            onOpenProfile={handleOpenProfile}
            products={products}
            totals={totals}
            freight={freight}
            container={container}
            volumetricWeight={volumetricWeight}
            chargeableWeight={chargeableWeight}
            containerPct={containerPct}
            payloadPct={payloadPct}
            containerPlan={containerPlan}
            handleRemove={handleRemove}
            handleQuantityChange={handleQuantityChange}
            updateItemTradeField={updateItemTradeField}
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
            clearDirectory={clearDirectory}
          />
        </div>

        <footer className="mt-8 text-center text-xs text-surface-600 dark:text-surface-400 pb-6">
          CBM Calculator Dashboard &nbsp;·&nbsp; Volume in m³ &nbsp;·&nbsp;
          Weight in kg
        </footer>
      </div>

      {/* ── Modals ── */}
      <ImportWizardModal
        isOpen={importOpen}
        onClose={handleCloseImport}
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
        onClose={handleCloseSummary}
        data={summaryData}
      />
      <CompanyProfileModal
        isOpen={profileOpen}
        onClose={handleCloseProfile}
        company={company}
        updateCompany={updateCompany}
        addParty={addParty}
        updateParty={updateParty}
        removeParty={removeParty}
        setLogoFromFile={setLogoFromFile}
        clearLogo={clearLogo}
      />
    </div>
  );
}

export default App;
