/**
 * useShipment — Manages all shipment-related state and business logic.
 *
 * This hook encapsulates: product directory, shipment items, the CBM form,
 * totals computation, freight/container calculations, and all CRUD operations.
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  calcCBM,
  convertDim,
  CONTAINERS,
  FREIGHT_MODES,
  normalizeFreightMode,
  containersNeeded,
} from '../utils/calculations';
import { mergeProducts } from '../utils/deduplication';
import { IMPORT_COLORS, IMPORT_ICONS } from '../utils/fileParser';

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
  packingString: '',
};

const genItemId = () =>
  `item-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

/** Load + migrate persisted shipment items (older versions lack totalPcs). */
const loadShipment = () => {
  try {
    const s = localStorage.getItem('cbm-shipment');
    const arr = s ? JSON.parse(s) : [];
    return arr.map((i) => ({
      ...i,
      totalPcs: i.totalPcs ?? (i.packSize || 1) * (i.quantity || 1),
    }));
  } catch {
    return [];
  }
};

/** Load persisted shipment metadata (PO number, container, freight mode). */
const loadMeta = () => {
  try {
    const s = localStorage.getItem('cbm-shipment-meta');
    const m = s ? JSON.parse(s) : {};
    return {
      poNumber: typeof m.poNumber === 'string' ? m.poNumber : '',
      containerType: CONTAINERS[m.containerType] ? m.containerType : '40hc',
      freightMode: normalizeFreightMode(m.freightMode),
    };
  } catch {
    return { poNumber: '', containerType: '40hc', freightMode: 'ocean_fcl' };
  }
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

  /* ── Notice / toast system (import results, undo, storage errors) ── */
  const [notice, setNotice] = useState(null);
  const noticeTimerRef = useRef(null);
  const storageWarnedRef = useRef(false);

  const dismissNotice = useCallback(() => {
    clearTimeout(noticeTimerRef.current);
    setNotice(null);
  }, []);

  const showNotice = useCallback((n, duration = 4000) => {
    clearTimeout(noticeTimerRef.current);
    setNotice({ id: Date.now(), ...n });
    noticeTimerRef.current = setTimeout(() => setNotice(null), duration);
  }, []);

  useEffect(() => () => clearTimeout(noticeTimerRef.current), []);

  /** Surface localStorage failures once instead of silently losing data. */
  const reportStorageError = useCallback(() => {
    if (storageWarnedRef.current) return;
    storageWarnedRef.current = true;
    showNotice(
      {
        type: 'error',
        message: 'Browser storage is full',
        detail: 'Changes may not persist — export your catalog to keep a backup.',
      },
      8000
    );
  }, [showNotice]);

  const productsTimerRef = useRef(null);
  useEffect(() => {
    // Debounce: avoid writing on every keystroke — wait 500 ms of no changes
    clearTimeout(productsTimerRef.current);
    productsTimerRef.current = setTimeout(() => {
      try {
        // Strip rawData before persisting — it holds all original CSV/Excel columns and
        // can be hundreds of KB for large catalogs, exhausting the 5 MB localStorage quota.
        // rawData remains in memory for the current session (ProductSummaryModal uses it).
        const lean = products.map((p) => {
          const copy = { ...p };
          delete copy.rawData;
          return copy;
        });
        localStorage.setItem('cbm-products', JSON.stringify(lean));
      } catch {
        reportStorageError();
      }
    }, 500);
    return () => clearTimeout(productsTimerRef.current);
  }, [products, reportStorageError]);

  /* ── Modal state ── */
  const [importOpen, setImportOpen] = useState(false);
  const [manualAddOpen, setManualAddOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);

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
  // { from, to } while dimensions entered in one unit are re-labelled as another
  const [unitSwitch, setUnitSwitch] = useState(null);

  /* ── Shipment items — persisted in localStorage ── */
  const [shipment, setShipment] = useState(loadShipment);

  const shipmentTimerRef = useRef(null);
  useEffect(() => {
    clearTimeout(shipmentTimerRef.current);
    shipmentTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem('cbm-shipment', JSON.stringify(shipment));
      } catch {
        reportStorageError();
      }
    }, 500);
    return () => clearTimeout(shipmentTimerRef.current);
  }, [shipment, reportStorageError]);

  /* ── Shipment metadata — persisted in localStorage ── */
  const [{ poNumber, containerType, freightMode }, setMeta] = useState(loadMeta);
  const setPoNumber = useCallback(
    (v) => setMeta((m) => ({ ...m, poNumber: v })),
    []
  );
  const setContainerType = useCallback(
    (v) => setMeta((m) => ({ ...m, containerType: v })),
    []
  );
  const setFreightMode = useCallback(
    (v) => setMeta((m) => ({ ...m, freightMode: v })),
    []
  );

  const metaTimerRef = useRef(null);
  useEffect(() => {
    clearTimeout(metaTimerRef.current);
    metaTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(
          'cbm-shipment-meta',
          JSON.stringify({ poNumber, containerType, freightMode })
        );
      } catch {
        reportStorageError();
      }
    }, 500);
    return () => clearTimeout(metaTimerRef.current);
  }, [poNumber, containerType, freightMode, reportStorageError]);

  /* ── Form updater ── */
  const updateForm = useCallback((field, value) => {
    if (field === 'unit') {
      setForm((p) => {
        const hasDims = p.length > 0 || p.width > 0 || p.height > 0;
        if (hasDims && value !== p.unit)
          setUnitSwitch((u) => ({ from: u?.from ?? p.unit, to: value }));
        else setUnitSwitch(null);
        return { ...p, [field]: value };
      });
    } else {
      setForm((p) => ({ ...p, [field]: value }));
    }
  }, []);

  /** One-click conversion of the entered L/W/H from the previous unit. */
  const convertFormUnits = useCallback(() => {
    setUnitSwitch((u) => {
      if (u) {
        setForm((p) => ({
          ...p,
          length: p.length ? convertDim(p.length, u.from, u.to) : p.length,
          width: p.width ? convertDim(p.width, u.from, u.to) : p.width,
          height: p.height ? convertDim(p.height, u.from, u.to) : p.height,
        }));
      }
      return null;
    });
  }, []);

  const dismissUnitSwitch = useCallback(() => setUnitSwitch(null), []);

  /* ── Smart de-duplicating import handler ── */
  const handleImportComplete = useCallback(
    (incoming, meta = {}) => {
      setProducts((prev) => {
        const { nextProducts, added, skipped } = mergeProducts(prev, incoming);
        const totalSkipped = skipped + (meta.skippedInFile || 0);
        showNotice({
          type: 'success',
          message: added > 0 ? 'Import complete!' : 'Nothing new to import',
          detail:
            `${added} added` +
            (totalSkipped > 0 ? ` · ${totalSkipped} skipped (duplicates/invalid)` : ''),
        });
        return nextProducts;
      });
      setImportOpen(false);
    },
    [showNotice]
  );

  /* ── Save/Edit/Delete product handlers ── */
  const handleSaveProduct = useCallback((savedProduct) => {
    if (editingProduct) {
      setProducts((prev) =>
        prev.map((p) => (p.id === editingProduct.id ? savedProduct : p))
      );
      if (activeProductId === editingProduct.id) {
        setForm((prev) => ({
          unit: savedProduct.unit,
          length: savedProduct.length,
          width: savedProduct.width,
          height: savedProduct.height,
          packSize: savedProduct.packSize,
          netWeight: (savedProduct.netWeightPerUnit || 0) * (savedProduct.packSize || 1),
          grossWeight: savedProduct.grossWeightPerShipper,
          name: savedProduct.name,
          totalPcs: prev.totalPcs,
          presetCBM:
            !savedProduct.length && !savedProduct.width && !savedProduct.height
              ? savedProduct.cbmPerShipper || 0
              : 0,
          packingString: savedProduct.packingString || '',
        }));
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

  /* Closes the manual-add/edit modal AND always clears the editing target.
     Without this, dismissing via backdrop leaves editingProduct set, so
     the next "Add" click would re-open with the previous product pre-filled. */
  const handleCloseManualModal = useCallback(() => {
    setManualAddOpen(false);
    setEditingProduct(null);
  }, []);

  const handleDeleteProduct = useCallback(
    (id) => {
      setProducts((prev) => {
        const idx = prev.findIndex((p) => p.id === id);
        if (idx === -1) return prev;
        const removed = prev[idx];
        showNotice(
          {
            type: 'undo',
            message: `Deleted "${removed.name}"`,
            onUndo: () =>
              setProducts((cur) => {
                const next = [...cur];
                next.splice(Math.min(idx, next.length), 0, removed);
                return next;
              }),
          },
          6000
        );
        return prev.filter((p) => p.id !== id);
      });
      if (activeProductId === id) {
        setActiveProductId(null);
        setForm({ ...EMPTY_FORM });
      }
    },
    [activeProductId, showNotice]
  );

  /* ── Product click → populate form ── */
  const handleProductClick = useCallback((product) => {
    if (activeProductId === product.id) {
      setActiveProductId(null);
      setForm({ ...EMPTY_FORM });
    } else {
      setActiveProductId(product.id);
      setForm((prev) => ({
        unit: product.unit,
        length: product.length,
        width: product.width,
        height: product.height,
        packSize: product.packSize,
        netWeight: (product.netWeightPerUnit || 0) * (product.packSize || 1),
        grossWeight: product.grossWeightPerShipper,
        name: product.name,
        totalPcs: prev.totalPcs,
        presetCBM:
          !product.length && !product.width && !product.height
            ? product.cbmPerShipper || 0
            : 0,
        packingString: product.packingString || '',
      }));
    }
    setUnitSwitch(null);
  }, [activeProductId]);

  /* ── Add item to shipment ── */
  const handleAddToShipment = useCallback((overrides = {}) => {
    const finalForm = { ...form, ...overrides };
    const hasDims =
      Number(finalForm.length) > 0 &&
      Number(finalForm.width) > 0 &&
      Number(finalForm.height) > 0;
    const hasPreset = Number(finalForm.presetCBM) > 0;
    if (!hasDims && !hasPreset) return;
    const cbmPerShipper = hasDims
      ? calcCBM(finalForm.length, finalForm.width, finalForm.height, finalForm.unit)
      : Number(finalForm.presetCBM) || 0;
    const packSize = Number(finalForm.packSize) || 1;
    const enteredPcs = Number(finalForm.totalPcs) || 0;
    const derivedShippers =
      enteredPcs > 0 && packSize > 0 ? Math.ceil(enteredPcs / packSize) : 1;
    const newItem = {
      id: genItemId(),
      name: finalForm.name || 'Custom Item',
      unit: finalForm.unit,
      length: Number(finalForm.length) || 0,
      width: Number(finalForm.width) || 0,
      height: Number(finalForm.height) || 0,
      packSize,
      netWeightPerUnit: (Number(finalForm.netWeight) || 0) / packSize,
      grossWeightPerShipper: Number(finalForm.grossWeight) || 0,
      cbmPerShipper,
      quantity: derivedShippers,
      // Keep the REAL piece count (e.g. 250), not shippers × packSize (300)
      totalPcs: enteredPcs > 0 ? enteredPcs : derivedShippers * packSize,
      packingString: finalForm.packingString || '',
    };
    setShipment((p) => [...p, newItem]);
    setFlashId(newItem.id);
    setTimeout(() => setFlashId(null), 800);
    setForm({ ...EMPTY_FORM });
    setActiveProductId(null);
    setUnitSwitch(null);
  }, [form]);

  /* ── Drag & Drop directly to shipment ── */
  const handleAddProductToShipment = useCallback((product) => {
    const hasDims =
      Number(product.length) > 0 &&
      Number(product.width) > 0 &&
      Number(product.height) > 0;
    // Dimensions are the source of truth: recalculate whenever they exist so a
    // stale pre-calculated cbmPerShipper (e.g. left over from an import before
    // dims were edited in) can never override the real volume.
    const cbmPerShipper = hasDims
      ? calcCBM(product.length, product.width, product.height, product.unit || 'cm')
      : Number(product.cbmPerShipper) || 0;
    if (cbmPerShipper <= 0) return;

    const packSize = Number(product.packSize) || 1;
    const newItem = {
      id: genItemId(),
      name: product.name || 'Imported Item',
      unit: product.unit || 'cm',
      length: Number(product.length) || 0,
      width: Number(product.width) || 0,
      height: Number(product.height) || 0,
      packSize,
      netWeightPerUnit: Number(product.netWeightPerUnit) || 0,
      grossWeightPerShipper: Number(product.grossWeightPerShipper) || 0,
      cbmPerShipper,
      quantity: 1, // Default to 1 shipper when dragging/dropping directly
      totalPcs: packSize,
      packingString: product.packingString || '',
    };

    setShipment((p) => [...p, newItem]);
    setFlashId(newItem.id);
    setTimeout(() => setFlashId(null), 800);
  }, []);

  /* ── Add item to product directory ── */
  const handleAddToDirectory = useCallback((overrides = {}) => {
    const finalForm = { ...form, ...overrides };
    const hasDims =
      Number(finalForm.length) > 0 &&
      Number(finalForm.width) > 0 &&
      Number(finalForm.height) > 0;
    const hasPreset = Number(finalForm.presetCBM) > 0;
    if (!hasDims && !hasPreset) return;
    const cbmPerShipper = hasDims
      ? calcCBM(finalForm.length, finalForm.width, finalForm.height, finalForm.unit)
      : Number(finalForm.presetCBM) || 0;

    const style = IMPORT_COLORS[Math.floor(Math.random() * IMPORT_COLORS.length)];
    const icon = IMPORT_ICONS[Math.floor(Math.random() * IMPORT_ICONS.length)];

    const newProduct = {
      id: `manual-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      name: finalForm.name || 'Custom Item',
      description: 'Manually added',
      icon,
      color: style.color,
      border: style.border,
      unit: finalForm.unit,
      length: Number(finalForm.length) || 0,
      width: Number(finalForm.width) || 0,
      height: Number(finalForm.height) || 0,
      packSize: Number(finalForm.packSize) || 1,
      netWeightPerUnit: (Number(finalForm.netWeight) || 0) / (Number(finalForm.packSize) || 1),
      grossWeightPerShipper: Number(finalForm.grossWeight) || 0,
      cbmPerShipper,
      packingString: finalForm.packingString || '',
    };

    setProducts((prev) => {
      const { nextProducts } = mergeProducts(prev, [newProduct]);
      return nextProducts;
    });

    setForm({ ...EMPTY_FORM });
    setActiveProductId(null);
    setUnitSwitch(null);
  }, [form]);

  /* ── Remove item (instant, with undo) ── */
  const handleRemove = useCallback(
    (id) => {
      setShipment((prev) => {
        const idx = prev.findIndex((i) => i.id === id);
        if (idx === -1) return prev;
        const removed = prev[idx];
        showNotice(
          {
            type: 'undo',
            message: `Removed "${removed.name}"`,
            onUndo: () =>
              setShipment((cur) => {
                const next = [...cur];
                next.splice(Math.min(idx, next.length), 0, removed);
                return next;
              }),
          },
          6000
        );
        return prev.filter((i) => i.id !== id);
      });
    },
    [showNotice]
  );

  /* ── Change quantity — preserves a partial last box ── */
  const handleQuantityChange = useCallback(
    (id, qty) =>
      setShipment((p) =>
        p.map((i) => {
          if (i.id !== id) return i;
          const newQty = Math.max(1, qty);
          const pack = i.packSize || 1;
          // Pieces in the current last box (partial boxes stay partial)
          const lastBox = (i.totalPcs || i.quantity * pack) - (i.quantity - 1) * pack;
          const safeLast = lastBox > 0 && lastBox <= pack ? lastBox : pack;
          return {
            ...i,
            quantity: newQty,
            totalPcs: (newQty - 1) * pack + safeLast,
          };
        })
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
      totalPcs: item.totalPcs || item.packSize * item.quantity,
      presetCBM:
        !item.length && !item.width && !item.height
          ? item.cbmPerShipper || 0
          : 0,
      packingString: item.packingString || '',
    });
    setShipment((p) => p.filter((i) => i.id !== item.id));
    setActiveProductId(null);
    setUnitSwitch(null);
  }, []);

  /* ── Duplicate item ── */
  const handleDuplicateItem = useCallback((item) => {
    const dup = { ...item, id: genItemId() };
    setShipment((p) => [...p, dup]);
    setFlashId(dup.id);
    setTimeout(() => setFlashId(null), 800);
  }, []);

  /* ── Clear shipment (instant, with undo) ── */
  const clearShipment = useCallback(() => {
    setShipment((prev) => {
      if (prev.length === 0) return prev;
      const snapshot = prev;
      showNotice(
        {
          type: 'undo',
          message: `Cleared ${snapshot.length} shipment item${snapshot.length !== 1 ? 's' : ''}`,
          onUndo: () => setShipment(snapshot),
        },
        6000
      );
      return [];
    });
  }, [showNotice]);

  /* ── Clear product directory (instant, with undo) ── */
  const clearDirectory = useCallback(() => {
    setProducts((prev) => {
      if (prev.length === 0) return prev;
      const snapshot = prev;
      showNotice(
        {
          type: 'undo',
          message: `Cleared ${snapshot.length} product${snapshot.length !== 1 ? 's' : ''} from directory`,
          onUndo: () => setProducts(snapshot),
        },
        6000
      );
      return [];
    });
    setActiveProductId(null);
    setForm({ ...EMPTY_FORM });
  }, [showNotice]);


  /* ══════════════ Computed values ══════════════ */

  const totals = useMemo(
    () =>
      shipment.reduce(
        (acc, item) => {
          const pcs = item.totalPcs || item.packSize * item.quantity;
          return {
            cbm: acc.cbm + item.cbmPerShipper * item.quantity,
            grossWeight:
              acc.grossWeight + item.grossWeightPerShipper * item.quantity,
            // Net weight follows the REAL piece count so a partial last box
            // isn't billed as full (matches the form preview maths).
            netWeight: acc.netWeight + item.netWeightPerUnit * pcs,
            shippers: acc.shippers + item.quantity,
            totalPcs: acc.totalPcs + pcs,
          };
        },
        { cbm: 0, grossWeight: 0, netWeight: 0, shippers: 0, totalPcs: 0 }
      ),
    [shipment]
  );

  const volumetricWeight = useMemo(() => {
    const factor = FREIGHT_MODES[freightMode]?.volumetricFactor || 0;
    return totals.cbm * factor;
  }, [totals.cbm, freightMode]);

  const chargeableWeight = useMemo(
    () => Math.max(totals.grossWeight, volumetricWeight),
    [totals.grossWeight, volumetricWeight]
  );

  /* Container utilization — deliberately NOT capped at 100 so an overfilled
     container is impossible to miss. */
  const containerPct = useMemo(() => {
    const cap = CONTAINERS[containerType]?.cbm;
    if (!cap) return 0;
    return (totals.cbm / cap) * 100;
  }, [totals.cbm, containerType]);

  /* Payload utilization — dense cargo hits the weight limit long before the
     container is volumetrically full. */
  const payloadPct = useMemo(() => {
    const max = CONTAINERS[containerType]?.maxPayloadKg;
    if (!max) return 0;
    return (totals.grossWeight / max) * 100;
  }, [totals.grossWeight, containerType]);

  const containerPlan = useMemo(
    () => containersNeeded(totals, containerType),
    [totals, containerType]
  );

  const previewCBM = useMemo(() => {
    const hasDims =
      Number(form.length) > 0 &&
      Number(form.width) > 0 &&
      Number(form.height) > 0;
    if (hasDims)
      return calcCBM(form.length, form.width, form.height, form.unit);
    if (Number(form.presetCBM) > 0) return Number(form.presetCBM);
    return 0;
  }, [form.length, form.width, form.height, form.unit, form.presetCBM]);

  const canAdd =
    (Number(form.length) > 0 &&
      Number(form.width) > 0 &&
      Number(form.height) > 0) ||
    Number(form.presetCBM) > 0;

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
    freightMode,
    setFreightMode,

    // Computed
    totals,
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
    handleEditItem,
    handleDuplicateItem,
    clearShipment,
    clearDirectory,
  };
}
