/**
 * ManualAddModal — Modal overlay for manually adding a product to the directory.
 *
 * Supports two entry modes:
 *  - Dimensions (L/W/H) — CBM is derived on save.
 *  - Pre-calculated CBM — for products without dims (e.g. imported CBM-only rows).
 * On save cbmPerShipper is ALWAYS recomputed from the current inputs, so a
 * stale imported value can never survive an edit.
 */
import { useState, useEffect, memo, useCallback } from 'react';
import FormInput from '../ui/FormInput';
import Modal from '../ui/Modal';
import { CheckCircleIcon, FileDocIcon } from '../icons/Icons';
import { IMPORT_COLORS, IMPORT_ICONS } from '../../utils/fileParser';
import { calcCBM } from '../../utils/calculations';

const EMPTY_FORM = {
  name: '', length: '', width: '', height: '',
  unit: 'cm', packSize: 1, netWeight: '', grossWeight: '',
  presetCBM: '',
};

const ManualAddModal = memo(({ isOpen, onClose, onSave, editingProduct }) => {
  const [f, setF] = useState(EMPTY_FORM);
  // 'dims' | 'cbm' — which entry mode is active
  const [entryMode, setEntryMode] = useState('dims');

  useEffect(() => {
    if (editingProduct) {
      const isPreCalc =
        !editingProduct.length && !editingProduct.width && !editingProduct.height;
      setEntryMode(isPreCalc ? 'cbm' : 'dims');
      setF({
        name: editingProduct.name || '',
        length: editingProduct.length || '',
        width: editingProduct.width || '',
        height: editingProduct.height || '',
        unit: editingProduct.unit || 'cm',
        packSize: editingProduct.packSize || 1,
        netWeight: editingProduct.netWeightPerUnit
          ? Number(editingProduct.netWeightPerUnit * (editingProduct.packSize || 1)).toFixed(2)
          : '',
        grossWeight: editingProduct.grossWeightPerShipper || '',
        presetCBM: isPreCalc ? editingProduct.cbmPerShipper || '' : '',
      });
    } else {
      setEntryMode('dims');
      setF(EMPTY_FORM);
    }
  }, [editingProduct, isOpen]);

  const up = useCallback((k, v) => setF((p) => ({ ...p, [k]: v })), []);

  const hasDims = f.length > 0 && f.width > 0 && f.height > 0;
  const hasPresetCBM = Number(f.presetCBM) > 0;
  const canSave =
    f.name.trim() && (entryMode === 'dims' ? hasDims : hasPresetCBM);

  const handleSave = () => {
    const pSize = Number(f.packSize) || 1;
    const usingDims = entryMode === 'dims' && hasDims;
    // Recompute — never carry a stale cbmPerShipper through an edit.
    const cbmPerShipper = usingDims
      ? calcCBM(Number(f.length), Number(f.width), Number(f.height), f.unit)
      : Number(f.presetCBM) || 0;

    const core = {
      name: f.name.trim(),
      unit: f.unit,
      length: usingDims ? Number(f.length) || 0 : 0,
      width: usingDims ? Number(f.width) || 0 : 0,
      height: usingDims ? Number(f.height) || 0 : 0,
      packSize: pSize,
      netWeightPerUnit: (Number(f.netWeight) || 0) / pSize,
      grossWeightPerShipper: Number(f.grossWeight) || 0,
      cbmPerShipper,
    };

    if (editingProduct) {
      onSave({ ...editingProduct, ...core });
    } else {
      const style =
        IMPORT_COLORS[Math.floor(Math.random() * IMPORT_COLORS.length)];
      const icon =
        IMPORT_ICONS[Math.floor(Math.random() * IMPORT_ICONS.length)];
      onSave({
        id: `manual-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        description: 'Manually added',
        icon,
        color: style.color,
        border: style.border,
        ...core,
      });
    }
    setF(EMPTY_FORM);
    setEntryMode('dims');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingProduct ? 'Edit Product' : 'Add Product Manually'}
      icon={<FileDocIcon />}
      size="sm"
      bodyClassName="p-5 space-y-3"
    >
      <FormInput
        id="manual-name"
        label="Product Name"
        type="text"
        value={f.name}
        onChange={(v) => up('name', v)}
      />

      {/* Entry mode toggle */}
      <div className="flex gap-1 p-1 rounded-full bg-surface-100 dark:bg-surface-800 border border-surface-200 dark:border-surface-700">
        {[
          ['dims', 'Dimensions (L×W×H)'],
          ['cbm', 'Pre-calculated CBM'],
        ].map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            onClick={() => setEntryMode(mode)}
            className={`flex-1 py-1.5 px-2 text-[10px] font-bold uppercase tracking-wide rounded-full
              ${entryMode === mode
                ? 'bg-accent-600 text-white shadow-md'
                : 'text-surface-500 dark:text-surface-300 hover:text-surface-700 dark:hover:text-surface-50'
              }`}
          >
            {label}
          </button>
        ))}
      </div>

      {entryMode === 'dims' ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <FormInput
              id="manual-l"
              label="Length"
              value={f.length}
              onChange={(v) => up('length', v)}
              suffix={f.unit.slice(0, 2)}
            />
            <FormInput
              id="manual-w"
              label="Width"
              value={f.width}
              onChange={(v) => up('width', v)}
              suffix={f.unit.slice(0, 2)}
            />
            <FormInput
              id="manual-h"
              label="Height"
              value={f.height}
              onChange={(v) => up('height', v)}
              suffix={f.unit.slice(0, 2)}
            />
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {['mm', 'cm', 'inches', 'feet', 'meters'].map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => up('unit', u)}
                className={`py-1.5 rounded-lg text-[10px] font-bold uppercase ${
                  f.unit === u
                    ? 'bg-accent-50 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300 border border-accent-300 dark:border-accent-700'
                    : 'bg-surface-50 dark:bg-surface-800 text-surface-400 border border-surface-200 dark:border-surface-700'
                }`}
              >
                {u}
              </button>
            ))}
          </div>
        </>
      ) : (
        <FormInput
          id="manual-cbm"
          label="CBM per Shipper"
          value={f.presetCBM}
          onChange={(v) => up('presetCBM', v)}
          step="any"
          suffix="m³"
        />
      )}

      <div className="grid grid-cols-3 gap-2">
        <FormInput
          id="manual-pack"
          label="Pack Size"
          value={f.packSize}
          onChange={(v) => up('packSize', v)}
          suffix="pcs"
        />
        <FormInput
          id="manual-nw"
          label="Net Wt/Shipper"
          value={f.netWeight}
          onChange={(v) => up('netWeight', v)}
          suffix="kg"
        />
        <FormInput
          id="manual-gw"
          label="Gross Wt/Shipper"
          value={f.grossWeight}
          onChange={(v) => up('grossWeight', v)}
          suffix="kg"
        />
      </div>
      <button
        onClick={handleSave}
        disabled={!canSave}
        className={`w-full py-2.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 mt-2
          ${
            canSave
              ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
              : 'bg-surface-100 dark:bg-surface-700 text-surface-400 cursor-not-allowed border border-surface-200 dark:border-surface-700'
          }`}
      >
        <CheckCircleIcon /> {editingProduct ? 'Save Changes' : 'Save to Directory'}
      </button>
    </Modal>
  );
});

ManualAddModal.displayName = 'ManualAddModal';

export default ManualAddModal;
