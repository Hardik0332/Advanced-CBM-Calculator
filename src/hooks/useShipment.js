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
  EMPTY_CUSTOM_CONTAINER,
  isValidContainerType,
  normalizeFreightMode,
} from '../utils/calculations';
import { computeFreight } from '../utils/freight';
import { DEFAULT_COUNTRY, isValidCountry } from '../utils/countryProfiles';
import { DEFAULT_CARRIER, isValidCarrier } from '../utils/carrierProfiles';
import { mergeProducts } from '../utils/deduplication';
import { IMPORT_COLORS, IMPORT_ICONS } from '../utils/fileParser';
import { clampInt, safeNonNegative } from '../utils/numbers';
import {
  migrateProducts,
  migrateShipment,
  normalizeMeta,
  wrap,
} from '../utils/schema';
import {
  STORAGE_KEYS,
  readJSON,
  writeJSON,
  putRawData,
  pruneRawData,
} from '../utils/storage';

/** Shipment quantities above this are always a typo, and unbounded values
    produce Infinity totals that poison every downstream calculation. */
const MAX_QTY = 1_000_000;

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

/**
 * Load + normalise the persisted product directory.
 * Everything goes through the schema layer, so a corrupt or legacy payload
 * degrades to an empty list instead of crashing the first render.
 */
const loadProducts = () => migrateProducts(readJSON(STORAGE_KEYS.products)).items;

/** Load + migrate persisted shipment items (older versions lack totalPcs). */
const loadShipment = () => migrateShipment(readJSON(STORAGE_KEYS.shipment)).items;

/** Load persisted shipment metadata (PO number, container, freight mode, rules). */
const loadMeta = () => {
  const m = normalizeMeta(readJSON(STORAGE_KEYS.meta));
  const custom = m.customContainer;
  return {
    poNumber: m.poNumber || '',
    // 'none' (LCL / loose cargo) and 'custom' are valid selections now, so this
    // guard checks the whole option set rather than only the ISO container table.
    containerType: isValidContainerType(m.containerType) ? m.containerType : '40hc',
    freightMode: normalizeFreightMode(m.freightMode),
    customContainer: {
      label: typeof custom?.label === 'string' ? custom.label : '',
      cbm: safeNonNegative(custom?.cbm),
      maxPayloadKg: safeNonNegative(custom?.maxPayloadKg),
    },
    /* Rule selections default to the profiles that reproduce pre-Phase-2b
       behaviour, so an existing shipment reloads with identical numbers. */
    destinationCountry: isValidCountry(m.destinationCountry)
      ? m.destinationCountry
      : DEFAULT_COUNTRY,
    carrierProfile: isValidCarrier(m.carrierProfile) ? m.carrierProfile : DEFAULT_CARRIER,
    ruleOverrides: m.ruleOverrides || {},
  };
};

export function useShipment() {
  /* ── Product directory — persisted in localStorage ── */
  const [products, setProducts] = useState(loadProducts);

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
      /* rawData holds every original CSV/Excel column and can run to hundreds of
         KB, which exhausts the ~5 MB localStorage quota. It is stripped here and
         written to IndexedDB instead — so unlike before, it now survives a page
         refresh and the Product Summary modal keeps working. */
      const lean = products.map((p) => {
        const copy = { ...p };
        delete copy.rawData;
        return copy;
      });
      const res = writeJSON(STORAGE_KEYS.products, wrap(lean));
      if (!res.ok) reportStorageError();

      const withRaw = products.filter((p) => p.rawData);
      if (withRaw.length > 0) putRawData(withRaw);
      pruneRawData(products.map((p) => p.id));
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
      if (!writeJSON(STORAGE_KEYS.shipment, wrap(shipment)).ok) reportStorageError();
    }, 500);
    return () => clearTimeout(shipmentTimerRef.current);
  }, [shipment, reportStorageError]);

  /* ── Shipment metadata — persisted in localStorage ── */
  const [
    {
      poNumber,
      containerType,
      freightMode,
      customContainer,
      destinationCountry,
      carrierProfile,
      ruleOverrides,
    },
    setMeta,
  ] = useState(loadMeta);
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
  /** Patch one field of the user-defined container without losing the others. */
  const updateCustomContainer = useCallback(
    (field, value) =>
      setMeta((m) => ({
        ...m,
        customContainer: {
          ...(m.customContainer || EMPTY_CUSTOM_CONTAINER),
          [field]: value,
        },
      })),
    []
  );

  /* Destination and carrier are independent selectors on purpose — see the
     note in freight.js. Neither derives from the other. */
  const setDestinationCountry = useCallback(
    (v) => setMeta((m) => ({ ...m, destinationCountry: v })),
    []
  );
  const setCarrierProfile = useCallback(
    (v) => setMeta((m) => ({ ...m, carrierProfile: v })),
    []
  );
  /**
   * Patch one rule override. Blanking a field **deletes** it rather than storing
   * `''`: an override's whole meaning is "this value instead of the profile's", so
   * an empty one must disappear and let resolution fall through again.
   */
  const updateRuleOverride = useCallback((field, value) => {
    setMeta((m) => {
      const next = { ...(m.ruleOverrides || {}) };
      if (value === '' || value === null || value === undefined) delete next[field];
      else next[field] = value;
      return { ...m, ruleOverrides: next };
    });
  }, []);

  /** Drop every override at once — the "reset to researched defaults" affordance. */
  const resetRuleOverrides = useCallback(
    () => setMeta((m) => ({ ...m, ruleOverrides: {} })),
    []
  );

  const metaTimerRef = useRef(null);
  useEffect(() => {
    clearTimeout(metaTimerRef.current);
    metaTimerRef.current = setTimeout(() => {
      const ok = writeJSON(STORAGE_KEYS.meta, {
        poNumber,
        containerType,
        freightMode,
        customContainer,
        destinationCountry,
        carrierProfile,
        ruleOverrides,
      }).ok;
      if (!ok) reportStorageError();
    }, 500);
    return () => clearTimeout(metaTimerRef.current);
  }, [
    poNumber,
    containerType,
    freightMode,
    customContainer,
    destinationCountry,
    carrierProfile,
    ruleOverrides,
    reportStorageError,
  ]);

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
      const list = incoming || [];

      /* Import straight into the shipment. Honours a mapped Quantity column, so a
         file that already carries carton counts becomes a costed shipment in one
         step instead of a catalog the user then has to re-enter by hand. */
      if (meta.importTarget === 'shipment') {
        const items = list
          .map((p) => {
            const hasDims = p.length > 0 && p.width > 0 && p.height > 0;
            // Dimensions are the source of truth whenever they exist.
            const cbmPerShipper = hasDims
              ? calcCBM(p.length, p.width, p.height, p.unit || 'cm')
              : safeNonNegative(p.cbmPerShipper);
            if (cbmPerShipper <= 0) return null;
            const packSize = clampInt(p.packSize, 1);
            const quantity = clampInt(p.quantity, 1, MAX_QTY);
            return {
              ...p,
              id: genItemId(),
              cbmPerShipper,
              packSize,
              quantity,
              totalPcs: packSize * quantity,
            };
          })
          .filter(Boolean);

        setShipment((prev) => [...prev, ...items]);
        const dropped = list.length - items.length;
        showNotice({
          type: 'success',
          message: items.length > 0 ? 'Added to shipment' : 'Nothing to add',
          detail:
            `${items.length} item${items.length === 1 ? '' : 's'} added` +
            (dropped > 0 ? ` · ${dropped} had no usable volume` : '') +
            (meta.skippedInFile > 0 ? ` · ${meta.skippedInFile} rejected` : ''),
        });
        setImportOpen(false);
        return;
      }

      setProducts((prev) => {
        const { nextProducts, added, skipped } = mergeProducts(prev, list);
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
          /* clampInt, not Math.max(1, qty): `Math.max(1, NaN)` is NaN, which then
             propagated into totalPcs and every downstream total, rendering as
             "NaN" across the UI and exports. It also caps absurd pasted values. */
          const newQty = clampInt(qty, 1, MAX_QTY);
          const pack = clampInt(i.packSize, 1);
          const currentQty = clampInt(i.quantity, 1);
          const currentPcs = clampInt(i.totalPcs, 0) || currentQty * pack;
          // Pieces in the current last box (partial boxes stay partial)
          const lastBox = currentPcs - (currentQty - 1) * pack;
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
          /* Coerce per item rather than trusting the record. Schema normalisation
             covers persisted data, but items also arrive from drag-drop and the
             form — and a single NaN here silently turns every total into NaN. */
          const qty = clampInt(item?.quantity, 1);
          const pack = clampInt(item?.packSize, 1);
          const pcs = clampInt(item?.totalPcs, 0) || pack * qty;
          const cbmPerShipper = safeNonNegative(item?.cbmPerShipper);
          const netPerUnit = safeNonNegative(item?.netWeightPerUnit);
          const grossPerShipper = safeNonNegative(item?.grossWeightPerShipper);
          return {
            cbm: acc.cbm + cbmPerShipper * qty,
            grossWeight: acc.grossWeight + grossPerShipper * qty,
            // Net weight follows the REAL piece count so a partial last box
            // isn't billed as full (matches the form preview maths).
            netWeight: acc.netWeight + netPerUnit * pcs,
            shippers: acc.shippers + qty,
            totalPcs: acc.totalPcs + pcs,
          };
        },
        { cbm: 0, grossWeight: 0, netWeight: 0, shippers: 0, totalPcs: 0 }
      ),
    [shipment]
  );

  /* Every freight and container figure comes from one auditable computation, so
     the UI and the exports can never disagree. `computeFreight` measures volume
     per piece and applies the carrier's own divisor and round-up rather than the
     aggregate `cbm × factor` shorthand this used to use, and derates the container
     payload to the destination's road limit when one is known. */
  const freight = useMemo(
    () =>
      computeFreight({
        items: shipment,
        totals,
        mode: freightMode,
        container: containerType,
        customContainer,
        country: destinationCountry,
        carrier: carrierProfile,
        overrides: ruleOverrides,
      }),
    [
      shipment,
      totals,
      freightMode,
      containerType,
      customContainer,
      destinationCountry,
      carrierProfile,
      ruleOverrides,
    ]
  );

  /* The resolved container, or null for LCL / loose cargo and for a custom entry
     with nothing in it yet. Consumers must handle null. */
  const container = freight.container;

  /* Declared before the utilization memos below, which read the governing payload
     cap off it. */
  const containerPlan = freight.containerPlan;

  /* Kept as named values because they are what the UI labels; both now derive
     from `freight` instead of being computed a second, divergent way. */
  const volumetricWeight = freight.volumetricKg;
  const chargeableWeight = freight.chargeableKg;

  /* Container utilization — deliberately NOT capped at 100 so an overfilled
     container is impossible to miss. */
  const containerPct = useMemo(() => {
    const cap = container?.cbm;
    if (!cap) return 0;
    return (totals.cbm / cap) * 100;
  }, [totals.cbm, container]);

  /* Payload utilization — dense cargo hits the weight limit long before the
     container is volumetrically full.

     Measured against the *governing* cap, not the ISO rating: on a US road lane a
     40' HC is capped ~5 t below its plate, and a bar that fills to 80% against an
     unreachable number is worse than no bar at all. `payloadCapKg` is the ISO
     figure whenever no road limit binds, so this is unchanged by default. */
  const payloadPct = useMemo(() => {
    const max = containerPlan?.payloadCapKg || container?.maxPayloadKg;
    if (!max) return 0;
    return (totals.grossWeight / max) * 100;
  }, [totals.grossWeight, container, containerPlan]);

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
    customContainer,
    updateCustomContainer,
    freightMode,
    setFreightMode,

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
    handleEditItem,
    handleDuplicateItem,
    clearShipment,
    clearDirectory,
  };
}
