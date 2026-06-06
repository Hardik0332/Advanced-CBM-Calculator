/**
 * useShipment — Manages all shipment-related state and business logic.
 *
 * This hook encapsulates: product directory, shipment items, the CBM form,
 * totals computation, freight/container calculations, and all CRUD operations.
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import { calcCBM, CONTAINERS } from '../utils/calculations';
import { mergeProducts } from '../utils/deduplication';

const EMPTY_FORM = {
  unit: 'cm',
  length: '',
  width: '',
  height: '',
  packSize: 1,
  netWeight: '',
  grossWeight: '',
  name: '',
  totalPcs: '',
  presetCBM: '',  // for products with pre-calculated CBM (no L/W/H dims)
};

export function useShipment() {
  /* ── Product directory — persisted in localStorage ── */
  const [products, setProducts] = useState(() => {
    try {
      const s = localStorage.getItem('cbm-products');
      return s ? JSON.parse(s) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('cbm-products', JSON.stringify(products));
    } catch {
      /* storage full */
    }
  }, [products]);

  /* ── Modal state ── */
  const [importOpen, setImportOpen] = useState(false);
  const [manualAddOpen, setManualAddOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [importResult, setImportResult] = useState(null);

  /* ── Product directory search ── */
  const [productSearch, setProductSearch] = useState('');
  const filteredProducts = useMemo(() => {
    if (!productSearch.trim()) return products;
    const q = productSearch.trim().toLowerCase();
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, productSearch]);

  /* ── CBM form ── */
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [activeProductId, setActiveProductId] = useState(null);
  const [flashId, setFlashId] = useState(null);
  const [unitSwitchWarning, setUnitSwitchWarning] = useState(false);

  /* ── Shipment items — persisted in localStorage ── */
  const [shipment, setShipment] = useState(() => {
    try {
      const s = localStorage.getItem('cbm-shipment');
      return s ? JSON.parse(s) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('cbm-shipment', JSON.stringify(shipment));
    } catch {
      /* storage full */
    }
  }, [shipment]);

  /* ── Shipment metadata ── */
  const [poNumber, setPoNumber] = useState('');
  const [containerType, setContainerType] = useState('40hc');
  const [freightMode, setFreightMode] = useState('ocean'); // 'ocean' | 'air'

  /* ── Form updater ── */
  const updateForm = useCallback((field, value) => {
    if (field === 'unit') {
      setForm((p) => {
        const hasDims = p.length > 0 || p.width > 0 || p.height > 0;
        if (hasDims && value !== p.unit) setUnitSwitchWarning(true);
        else setUnitSwitchWarning(false);
        return { ...p, [field]: value };
      });
    } else {
      setForm((p) => ({ ...p, [field]: value }));
    }
  }, []);

  /* ── Smart de-duplicating import handler ── */
  const handleImportComplete = useCallback((incoming) => {
    setProducts((prev) => {
      const { nextProducts, added, updated } = mergeProducts(prev, incoming);
      setImportResult({ added, updated });
      setTimeout(() => setImportResult(null), 4000);
      return nextProducts;
    });
    setImportOpen(false);
  }, []);

  /* ── Save/Edit/Delete product handlers ── */
  const handleSaveProduct = useCallback((savedProduct) => {
    if (editingProduct) {
      setProducts((prev) =>
        prev.map((p) => (p.id === editingProduct.id ? savedProduct : p))
      );
      if (activeProductId === editingProduct.id) {
        setForm({
          unit: savedProduct.unit,
          length: savedProduct.length,
          width: savedProduct.width,
          height: savedProduct.height,
          packSize: savedProduct.packSize,
          netWeight: (savedProduct.netWeightPerUnit || 0) * (savedProduct.packSize || 1),
          grossWeight: savedProduct.grossWeightPerShipper,
          name: savedProduct.name,
          totalPcs: 0,
          presetCBM:
            !savedProduct.length && !savedProduct.width && !savedProduct.height
              ? savedProduct.cbmPerShipper || 0
              : 0,
        });
      }
      setEditingProduct(null);
    } else {
      setProducts((prev) => {
        const { nextProducts } = mergeProducts(prev, [savedProduct]);
        return nextProducts;
      });
    }
  }, [editingProduct, activeProductId]);

  const handleEditProduct = useCallback((product) => {
    setEditingProduct(product);
    setManualAddOpen(true);
  }, []);

  const handleDeleteProduct = useCallback((id) => {
    if (window.confirm('Delete this product from directory?')) {
      setProducts((prev) => prev.filter((p) => p.id !== id));
      if (activeProductId === id) {
        setActiveProductId(null);
        setForm({ ...EMPTY_FORM });
      }
    }
  }, [activeProductId]);

  /* ── Product click → populate form ── */
  const handleProductClick = useCallback((product) => {
    if (activeProductId === product.id) {
      setActiveProductId(null);
      setForm({ ...EMPTY_FORM });
    } else {
      setActiveProductId(product.id);
      setForm({
        unit: product.unit,
        length: product.length,
        width: product.width,
        height: product.height,
        packSize: product.packSize,
        netWeight: (product.netWeightPerUnit || 0) * (product.packSize || 1),
        grossWeight: product.grossWeightPerShipper,
        name: product.name,
        totalPcs: 0,
        presetCBM:
          !product.length && !product.width && !product.height
            ? product.cbmPerShipper || 0
            : 0,
      });
    }
  }, [activeProductId]);

  /* ── Add item to shipment ── */
  const handleAddToShipment = useCallback(() => {
    const hasDims = form.length > 0 && form.width > 0 && form.height > 0;
    if (!hasDims && !form.presetCBM) return;
    const cbmPerShipper = hasDims
      ? calcCBM(form.length, form.width, form.height, form.unit)
      : form.presetCBM;
    const derivedShippers =
      form.totalPcs > 0 && form.packSize > 0
        ? Math.ceil(form.totalPcs / form.packSize)
        : 1;
    const newItem = {
      id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      name: form.name || 'Custom Item',
      unit: form.unit,
      length: Number(form.length) || 0,
      width: Number(form.width) || 0,
      height: Number(form.height) || 0,
      packSize: Number(form.packSize) || 1,
      netWeightPerUnit: (Number(form.netWeight) || 0) / (Number(form.packSize) || 1),
      grossWeightPerShipper: Number(form.grossWeight) || 0,
      cbmPerShipper,
      quantity: derivedShippers,
    };
    setShipment((p) => [...p, newItem]);
    setFlashId(newItem.id);
    setTimeout(() => setFlashId(null), 800);
    setForm({ ...EMPTY_FORM });
    setActiveProductId(null);
    setUnitSwitchWarning(false);
  }, [form]);

  /* ── Remove item ── */
  const handleRemove = useCallback(
    (id) => setShipment((p) => p.filter((i) => i.id !== id)),
    []
  );

  /* ── Change quantity ── */
  const handleQuantityChange = useCallback(
    (id, qty) =>
      setShipment((p) =>
        p.map((i) =>
          i.id === id ? { ...i, quantity: Math.max(1, qty) } : i
        )
      ),
    []
  );

  /* ── Edit item — populate form and remove from shipment ── */
  const handleEditItem = useCallback((item) => {
    setForm({
      unit: item.unit,
      length: item.length,
      width: item.width,
      height: item.height,
      packSize: item.packSize,
      netWeight: (item.netWeightPerUnit || 0) * (item.packSize || 1),
      grossWeight: item.grossWeightPerShipper,
      name: item.name,
      totalPcs: 0,
      presetCBM:
        !item.length && !item.width && !item.height
          ? item.cbmPerShipper || 0
          : 0,
    });
    setShipment((p) => p.filter((i) => i.id !== item.id));
    setActiveProductId(null);
  }, []);

  /* ── Duplicate item ── */
  const handleDuplicateItem = useCallback((item) => {
    const dup = {
      ...item,
      id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    };
    setShipment((p) => [...p, dup]);
    setFlashId(dup.id);
    setTimeout(() => setFlashId(null), 800);
  }, []);

  /* ── Clear shipment ── */
  const clearShipment = useCallback(() => {
    if (window.confirm('Clear all shipment items?')) setShipment([]);
  }, []);

  /* ══════════════ Computed values ══════════════ */

  const totals = useMemo(
    () =>
      shipment.reduce(
        (acc, item) => ({
          cbm: acc.cbm + item.cbmPerShipper * item.quantity,
          grossWeight:
            acc.grossWeight + item.grossWeightPerShipper * item.quantity,
          netWeight:
            acc.netWeight +
            item.netWeightPerUnit * item.packSize * item.quantity,
          shippers: acc.shippers + item.quantity,
          totalPcs: acc.totalPcs + item.packSize * item.quantity,
        }),
        { cbm: 0, grossWeight: 0, netWeight: 0, shippers: 0, totalPcs: 0 }
      ),
    [shipment]
  );

  const volumetricWeight = useMemo(() => {
    if (freightMode === 'air') return totals.cbm * 167;
    return totals.cbm * 1000; // ocean: 1 CBM = 1000 kg
  }, [totals.cbm, freightMode]);

  const chargeableWeight = useMemo(
    () => Math.max(totals.grossWeight, volumetricWeight),
    [totals.grossWeight, volumetricWeight]
  );

  const containerPct = useMemo(() => {
    const cap = CONTAINERS[containerType]?.cbm || 76;
    return Math.min(100, (totals.cbm / cap) * 100);
  }, [totals.cbm, containerType]);

  const previewCBM = useMemo(() => {
    if (form.length > 0 && form.width > 0 && form.height > 0)
      return calcCBM(form.length, form.width, form.height, form.unit);
    if (form.presetCBM > 0) return form.presetCBM;
    return 0;
  }, [form.length, form.width, form.height, form.unit, form.presetCBM]);

  const canAdd =
    (form.length > 0 && form.width > 0 && form.height > 0) ||
    form.presetCBM > 0;

  return {
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
    handleImportComplete,
    handleSaveProduct,
    handleEditProduct,
    handleDeleteProduct,
    handleProductClick,
    handleAddToShipment,
    handleRemove,
    handleQuantityChange,
    handleEditItem,
    handleDuplicateItem,
    clearShipment,
  };
}
