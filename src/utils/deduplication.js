/**
 * Smart de-duplication utilities.
 *
 * Composite signature: Name + L + W + H + PackSize + NetWt + GrossWt.
 * Same name / different dims → new variant (appended, not overwritten).
 * Exact full-signature match → skipped.
 */

/**
 * Generate a composite key for a product.
 * Includes the unit so "50×40×30 inches" is never treated as a duplicate
 * of "50×40×30 cm".
 * @param {object} p - The product object.
 * @returns {string} A pipe-delimited composite key.
 */
export const compositeKey = (p) =>
  `${p.name.trim().toLowerCase()}|${p.unit || 'cm'}|${p.length}|${p.width}|${p.height}|${p.packSize}|${p.netWeightPerUnit}|${p.grossWeightPerShipper}|${p.cbmPerShipper || 0}`;

/**
 * Merge incoming products into existing, skipping exact duplicates.
 * Uses a Map for O(n) lookups — scales well with large catalogs.
 * @param {Array} existing - Currently stored products.
 * @param {Array} incoming - New products to merge.
 * @returns {{ nextProducts: Array, added: number, updated: number, skipped: number }}
 */
export const mergeProducts = (existing, incoming) => {
  // Build signature map once — O(n) instead of O(n) per incoming product
  const existingKeys = new Set(existing.map(compositeKey));
  const batchKeys = new Set();
  const additions = [];
  let added = 0, skipped = 0;

  for (const p of incoming) {
    if (p.status === 'skipped') continue; // never persist invalid rows
    const sig = compositeKey(p);
    if (existingKeys.has(sig) || batchKeys.has(sig)) {
      skipped++;
    } else {
      // Avoid spread destructure allocation — just delete the status fields
      const clean = { ...p };
      delete clean.status;
      delete clean.skipReason;
      additions.push(clean);
      existingKeys.add(sig);
      batchKeys.add(sig);
      added++;
    }
  }

  return {
    nextProducts: additions.length > 0 ? [...existing, ...additions] : existing,
    added,
    updated: 0,
    skipped,
  };
};
