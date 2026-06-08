/**
 * Smart de-duplication utilities.
 *
 * Composite signature: Name + L + W + H + PackSize + NetWt + GrossWt.
 * Same name / different dims → new variant (appended, not overwritten).
 * Exact full-signature match → skipped.
 */

/**
 * Generate a composite key for a product.
 * @param {object} p - The product object.
 * @returns {string} A pipe-delimited composite key.
 */
export const compositeKey = (p) =>
  `${p.name.trim().toLowerCase()}|${p.length}|${p.width}|${p.height}|${p.packSize}|${p.netWeightPerUnit}|${p.grossWeightPerShipper}|${p.cbmPerShipper || 0}`;

/**
 * Merge incoming products into existing, skipping exact duplicates.
 * @param {Array} existing - Currently stored products.
 * @param {Array} incoming - New products to merge.
 * @returns {{ nextProducts: Array, added: number, updated: number, skipped: number }}
 */
export const mergeProducts = (existing, incoming) => {
  // Build a set of composite signatures from what already exists
  const existingKeys = new Set(existing.map((p) => compositeKey(p)));
  const next = [...existing];
  let added = 0,
    skipped = 0;

  // Also track composite keys we've already added in THIS batch
  const batchKeys = new Set();

  incoming.forEach((p) => {
    if (p.status === 'skipped') return; // never persist invalid rows
    const sig = compositeKey(p);
    if (existingKeys.has(sig) || batchKeys.has(sig)) {
      skipped++; // exact duplicate — do nothing
    } else {
      const { status, skipReason, ...clean } = p;
      next.push(clean);
      existingKeys.add(sig);
      batchKeys.add(sig);
      added++;
    }
  });

  return { nextProducts: next, added, updated: 0, skipped };
};
