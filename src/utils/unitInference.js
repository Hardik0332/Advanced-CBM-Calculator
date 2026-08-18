/**
 * Dimension-unit inference.
 *
 * The wizard asks the user which unit a file's L/W/H columns are in and defaults
 * to cm. Get that wrong and every volume is out by 10x, 1000x or 2.54x — the
 * single most expensive import mistake available, and completely invisible
 * because the numbers still look plausible.
 *
 * Two signals, in order of strength:
 *
 *   1. **CBM cross-check** — when the file also has a CBM column, compute the
 *      volume under each candidate unit and see which one reproduces it. This is
 *      near-proof: only one unit will agree to within a few percent.
 *   2. **Magnitude heuristic** — a carton whose median side is 600 is not 600 cm
 *      (6 m); it is 600 mm. Weak on its own, so it only ever *suggests*.
 *
 * Nothing here changes a value. It returns a suggestion for the UI to offer,
 * because silently rewriting the user's stated unit would be worse than the bug.
 */
import { calcCBM, toCm } from './calculations';
import { parseFlexibleNumber } from './numbers';

export const CANDIDATE_UNITS = ['mm', 'cm', 'inches', 'feet', 'meters'];

/** Rows sampled — enough to be representative, cheap enough to run on keystroke. */
const SAMPLE_SIZE = 200;
/** A computed CBM within this relative error of the file's counts as agreement. */
const CBM_TOLERANCE = 0.03;
/* Plausible *shipper* side length in cm. The floor is 1 cm, not a few millimetres:
   these are carton dimensions, so a 4 mm side means the unit is wrong, not that
   someone is shipping a 4 mm box. The ceiling is 12 m — longer than a 40' container. */
const MIN_PLAUSIBLE_CM = 1;
const MAX_PLAUSIBLE_CM = 1200;

const median = (arr) => {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * Collect usable dimension triples (and file CBM, when present) from raw rows.
 *
 * @param {object[]} rows
 * @param {object} mapping - Field → column header.
 * @param {object} [locales] - Column → decimal convention.
 * @returns {Array<{ l: number, w: number, h: number, cbm: number|null }>}
 */
const collectSamples = (rows, mapping, locales = {}) => {
  const out = [];
  const opt = (col) => (col && locales[col] ? { locale: locales[col] } : undefined);
  const lCol = mapping?.length, wCol = mapping?.width, hCol = mapping?.height;
  if (!lCol || !wCol || !hCol) return out;

  for (const row of (rows || []).slice(0, SAMPLE_SIZE)) {
    const l = parseFlexibleNumber(row?.[lCol], opt(lCol));
    const w = parseFlexibleNumber(row?.[wCol], opt(wCol));
    const h = parseFlexibleNumber(row?.[hCol], opt(hCol));
    if (!l || !w || !h || l <= 0 || w <= 0 || h <= 0) continue;
    const cbmRaw = mapping?.cbm
      ? parseFlexibleNumber(row?.[mapping.cbm], opt(mapping.cbm))
      : null;
    out.push({ l, w, h, cbm: cbmRaw && cbmRaw > 0 ? cbmRaw : null });
  }
  return out;
};

/**
 * Score each candidate unit against a file's CBM column.
 *
 * @returns {{ unit: string, agreement: number, matched: number, total: number }[]}
 *   Sorted best-first. `agreement` is the fraction of rows that reproduce the
 *   file's CBM under that unit.
 */
const scoreAgainstCBM = (samples) => {
  const withCBM = samples.filter((s) => s.cbm != null);
  if (withCBM.length === 0) return [];

  return CANDIDATE_UNITS.map((unit) => {
    let matched = 0;
    for (const s of withCBM) {
      const computed = calcCBM(s.l, s.w, s.h, unit);
      if (computed <= 0) continue;
      const relErr = Math.abs(computed - s.cbm) / s.cbm;
      if (relErr <= CBM_TOLERANCE) matched++;
    }
    return {
      unit,
      agreement: matched / withCBM.length,
      matched,
      total: withCBM.length,
    };
  }).sort((a, b) => b.agreement - a.agreement);
};

/**
 * Judge whether dimensions expressed in `unit` describe a plausible carton.
 * @returns {{ unit: string, medianCm: number, plausible: boolean }}
 */
const plausibility = (samples, unit) => {
  const sides = samples.flatMap((s) => [
    toCm(s.l, unit),
    toCm(s.w, unit),
    toCm(s.h, unit),
  ]);
  const medianCm = median(sides);
  return {
    unit,
    medianCm,
    plausible: medianCm >= MIN_PLAUSIBLE_CM && medianCm <= MAX_PLAUSIBLE_CM,
  };
};

/**
 * Infer the dimension unit for a mapped file.
 *
 * @param {object[]} rows - Raw data rows.
 * @param {object} mapping - Field → column header mapping.
 * @param {string} statedUnit - What the user currently has selected.
 * @param {object} [locales] - Column → decimal convention.
 * @returns {{
 *   suggested: string|null,   // null when the stated unit looks fine or evidence is weak
 *   confidence: 'high'|'medium'|'low',
 *   reason: string,
 *   evidence: object,
 * }}
 */
export const inferDimensionUnit = (rows, mapping, statedUnit = 'cm', locales = {}) => {
  const none = { suggested: null, confidence: 'low', reason: '', evidence: {} };

  const samples = collectSamples(rows, mapping, locales);
  if (samples.length < 3) {
    return { ...none, reason: 'Not enough dimension data to check.' };
  }

  /* ── Signal 1: cross-check against the file's own CBM column ── */
  const cbmScores = scoreAgainstCBM(samples);
  if (cbmScores.length > 0) {
    const best = cbmScores[0];
    const statedScore = cbmScores.find((s) => s.unit === statedUnit);

    // Require a strong majority to agree, and a clear margin over the stated unit.
    if (best.agreement >= 0.8 && best.unit !== statedUnit) {
      if (best.agreement - (statedScore?.agreement ?? 0) >= 0.3) {
        return {
          suggested: best.unit,
          confidence: 'high',
          reason:
            `${best.matched} of ${best.total} rows reproduce the file's CBM column ` +
            `when dimensions are read as ${best.unit}` +
            (statedScore && statedScore.matched > 0
              ? `, versus ${statedScore.matched} as ${statedUnit}.`
              : `, but none do as ${statedUnit}.`),
          evidence: { method: 'cbm-cross-check', scores: cbmScores },
        };
      }
    }

    // The stated unit already reproduces the CBM column — stop here, and do not
    // let the weaker magnitude heuristic second-guess hard evidence.
    if ((statedScore?.agreement ?? 0) >= 0.8) {
      return {
        ...none,
        reason: `Dimensions match the file's CBM column as ${statedUnit}.`,
        evidence: { method: 'cbm-cross-check', scores: cbmScores },
      };
    }
  }

  /* ── Signal 2: magnitude plausibility ── */
  const stated = plausibility(samples, statedUnit);
  if (stated.plausible) {
    return {
      ...none,
      reason: `Median side is ${stated.medianCm.toFixed(1)} cm as ${statedUnit} — plausible.`,
      evidence: { method: 'magnitude', ...stated },
    };
  }

  // Stated unit is implausible: offer the candidate closest to a ~30 cm carton.
  const TYPICAL_CM = 30;
  const ranked = CANDIDATE_UNITS.map((u) => plausibility(samples, u))
    .filter((p) => p.plausible)
    .sort(
      (a, b) =>
        Math.abs(Math.log(a.medianCm / TYPICAL_CM)) -
        Math.abs(Math.log(b.medianCm / TYPICAL_CM))
    );

  if (ranked.length === 0 || ranked[0].unit === statedUnit) {
    return {
      ...none,
      reason:
        `Dimensions look implausible as ${statedUnit} ` +
        `(median side ${stated.medianCm.toFixed(1)} cm), but no other unit fits better.`,
      evidence: { method: 'magnitude', ...stated },
    };
  }

  return {
    suggested: ranked[0].unit,
    confidence: 'medium',
    reason:
      `As ${statedUnit} the median side is ${stated.medianCm.toFixed(1)} cm, which is ` +
      `implausible for packaging. As ${ranked[0].unit} it is ` +
      `${ranked[0].medianCm.toFixed(1)} cm.`,
    evidence: { method: 'magnitude', stated, ranked },
  };
};
