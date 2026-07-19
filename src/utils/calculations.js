/**
 * Unit conversion & CBM calculation helpers.
 */

/**
 * Convert a dimension value to centimeters.
 * @param {number} v - The value to convert.
 * @param {string} u - The unit ('cm', 'mm', 'inches', 'feet', 'meters').
 * @returns {number} The value in centimeters.
 */
export const toCm = (v, u) => {
  if (u === 'cm') return v;
  if (u === 'mm') return v / 10;
  if (u === 'inches') return v * 2.54;
  if (u === 'feet') return v * 30.48;
  if (u === 'meters') return v * 100;
  return v;
};

/**
 * Convert a value in centimeters back to the given unit.
 * @param {number} v - The value in centimeters.
 * @param {string} u - The target unit.
 * @returns {number} The value in the target unit.
 */
export const fromCm = (v, u) => {
  if (u === 'cm') return v;
  if (u === 'mm') return v * 10;
  if (u === 'inches') return v / 2.54;
  if (u === 'feet') return v / 30.48;
  if (u === 'meters') return v / 100;
  return v;
};

/**
 * Convert a dimension value from one unit to another, rounded to 4 decimals.
 * @param {number} v - The value to convert.
 * @param {string} from - Source unit.
 * @param {string} to - Target unit.
 * @returns {number}
 */
export const convertDim = (v, from, to) => {
  const n = Number(v);
  if (!n || from === to) return n || 0;
  return Math.round(fromCm(toCm(n, from), to) * 10000) / 10000;
};

/**
 * Calculate CBM (Cubic Meters) from dimensions.
 * @param {number} l - Length.
 * @param {number} w - Width.
 * @param {number} h - Height.
 * @param {string} u - The unit of the dimensions.
 * @returns {number} Volume in cubic meters.
 */
export const calcCBM = (l, w, h, u) => {
  return (toCm(l, u) * toCm(w, u) * toCm(h, u)) / 1_000_000;
};

/**
 * Adaptive CBM formatter — prevents 0.00 for small pharmaceutical/medical items.
 * Uses more decimal places only when the value is too small for 2dp to be meaningful.
 * @param {number} v - CBM value.
 * @returns {string}
 */
export const fmtCBM = (v) => {
  if (!v || v === 0) return '0.0000';
  if (v < 0.0001) return v.toFixed(6);
  if (v < 0.01) return v.toFixed(4);
  return v.toFixed(2);
};

/**
 * Standard shipping container definitions.
 * cbm          — usable (practical) loading volume, not the theoretical geometric volume.
 * maxPayloadKg — ISO maximum cargo payload; loads above this are overweight even
 *                when the container is volumetrically far from full.
 */
export const CONTAINERS = {
  '20ft': { label: "20' Standard (Usable)", cbm: 28, maxPayloadKg: 28200 },
  '40ft': { label: "40' Standard (Usable)", cbm: 58, maxPayloadKg: 26700 },
  '40hc': { label: "40' High Cube (Usable)", cbm: 68, maxPayloadKg: 26500 },
};

/**
 * Freight mode definitions.
 * volumetricFactor — kg per CBM used to compute volumetric (dimensional) weight.
 *   Ocean FCL: no volumetric concept, chargeable = gross weight.
 *   Ocean LCL: W/M rule — 1 CBM = 1000 kg (revenue ton).
 *   Air (IATA): 1 CBM = 167 kg (divisor 6000 cm³/kg).
 *   Courier (DHL/FedEx/UPS): 1 CBM = 200 kg (divisor 5000 cm³/kg).
 */
export const FREIGHT_MODES = {
  ocean_fcl: {
    label: 'Ocean FCL',
    short: '🚢 FCL',
    volumetricFactor: 0,
    desc: 'Ocean FCL: Chargeable = Gross Weight only',
  },
  ocean_lcl: {
    label: 'Ocean LCL',
    short: '🚢 LCL',
    volumetricFactor: 1000,
    desc: 'Ocean LCL (W/M): 1 CBM = 1000 kg · Chargeable = max(Gross, CBM × 1000)',
  },
  air: {
    label: 'Air',
    short: '✈️ Air',
    volumetricFactor: 167,
    desc: 'Air: 1 CBM = 167 kg (÷6000) · Chargeable = max(Gross, Volumetric)',
  },
  courier: {
    label: 'Courier',
    short: '📦 Courier',
    volumetricFactor: 200,
    desc: 'Courier: 1 CBM = 200 kg (÷5000) · Chargeable = max(Gross, Volumetric)',
  },
};

/** Map legacy persisted freight mode values to current keys. */
export const normalizeFreightMode = (m) => {
  if (m === 'ocean') return 'ocean_fcl';
  return FREIGHT_MODES[m] ? m : 'ocean_fcl';
};

/**
 * How many containers of the given type the load needs, considering BOTH
 * volume and payload limits.
 * @param {{cbm: number, grossWeight: number}} totals
 * @param {string} containerType - Key into CONTAINERS.
 * @returns {{ count: number, byVolume: number, byWeight: number, limitedBy: 'volume'|'weight' }}
 */
export const containersNeeded = (totals, containerType) => {
  const cont = CONTAINERS[containerType];
  if (!cont) return { count: 1, byVolume: 1, byWeight: 1, limitedBy: 'volume' };
  const byVolume = Math.max(1, Math.ceil(totals.cbm / cont.cbm));
  const byWeight = Math.max(1, Math.ceil(totals.grossWeight / cont.maxPayloadKg));
  return {
    count: Math.max(byVolume, byWeight),
    byVolume,
    byWeight,
    limitedBy: byWeight > byVolume ? 'weight' : 'volume',
  };
};
