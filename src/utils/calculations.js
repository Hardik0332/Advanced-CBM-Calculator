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
 * Standard shipping container definitions (usable capacities).
 */
export const CONTAINERS = {
  '20ft': { label: "20' Standard (Usable)", cbm: 28 },
  '40ft': { label: "40' Standard (Usable)", cbm: 58 },
  '40hc': { label: "40' High Cube (Usable)", cbm: 68 },
};
