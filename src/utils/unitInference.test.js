import { describe, it, expect } from 'vitest';
import { inferDimensionUnit, CANDIDATE_UNITS } from './unitInference';

const mapping = { name: 'Name', length: 'L', width: 'W', height: 'H' };
const mappingWithCBM = { ...mapping, cbm: 'CBM' };

/** Rows whose dimensions are genuinely in mm, with a correct CBM column. */
const mmRows = [
  { Name: 'A', L: 600, W: 400, H: 300, CBM: 0.072 },
  { Name: 'B', L: 500, W: 400, H: 400, CBM: 0.08 },
  { Name: 'C', L: 300, W: 200, H: 150, CBM: 0.009 },
  { Name: 'D', L: 450, W: 350, H: 250, CBM: 0.0394 },
];

/** Rows genuinely in cm, with a correct CBM column. */
const cmRows = [
  { Name: 'A', L: 60, W: 40, H: 30, CBM: 0.072 },
  { Name: 'B', L: 50, W: 40, H: 40, CBM: 0.08 },
  { Name: 'C', L: 30, W: 20, H: 15, CBM: 0.009 },
  { Name: 'D', L: 45, W: 35, H: 25, CBM: 0.0394 },
];

/** Rows genuinely in inches, with a correct CBM column. */
const inchRows = [
  { Name: 'A', L: 24, W: 16, H: 12, CBM: 0.0755 },
  { Name: 'B', L: 20, W: 16, H: 16, CBM: 0.0839 },
  { Name: 'C', L: 12, W: 8, H: 6, CBM: 0.00944 },
  { Name: 'D', L: 18, W: 14, H: 10, CBM: 0.0413 },
];

describe('inferDimensionUnit — CBM cross-check (the strong signal)', () => {
  it('detects mm when the user said cm', () => {
    const r = inferDimensionUnit(mmRows, mappingWithCBM, 'cm');
    expect(r.suggested).toBe('mm');
    expect(r.confidence).toBe('high');
    expect(r.evidence.method).toBe('cbm-cross-check');
  });

  it('detects inches when the user said cm', () => {
    const r = inferDimensionUnit(inchRows, mappingWithCBM, 'cm');
    expect(r.suggested).toBe('inches');
    expect(r.confidence).toBe('high');
  });

  it('detects cm when the user said mm', () => {
    const r = inferDimensionUnit(cmRows, mappingWithCBM, 'mm');
    expect(r.suggested).toBe('cm');
    expect(r.confidence).toBe('high');
  });

  it('stays silent when the stated unit already reproduces the CBM column', () => {
    const r = inferDimensionUnit(cmRows, mappingWithCBM, 'cm');
    expect(r.suggested).toBeNull();
    expect(r.reason).toMatch(/match/i);
  });

  it('explains its reasoning with row counts', () => {
    const r = inferDimensionUnit(mmRows, mappingWithCBM, 'cm');
    expect(r.reason).toMatch(/\d+ of \d+ rows/);
    expect(r.reason).toContain('mm');
  });

  it('does not fire when the CBM column is inconsistent garbage', () => {
    const noisy = mmRows.map((r, i) => ({ ...r, CBM: [0.5, 12, 0.001, 99][i] }));
    const r = inferDimensionUnit(noisy, mappingWithCBM, 'cm');
    expect(r.confidence).not.toBe('high');
  });

  it('hard CBM evidence overrides the magnitude heuristic', () => {
    /* Sides of 600 look like mm by magnitude, but the CBM column proves they are
       cm here. The weaker signal must not override the stronger one. */
    const bigButCm = [
      { L: 600, W: 400, H: 300, CBM: 72 },
      { L: 500, W: 400, H: 400, CBM: 80 },
      { L: 300, W: 200, H: 150, CBM: 9 },
      { L: 450, W: 350, H: 250, CBM: 39.375 },
    ];
    const r = inferDimensionUnit(bigButCm, mappingWithCBM, 'cm');
    expect(r.suggested).toBeNull();
  });
});

describe('inferDimensionUnit — magnitude heuristic (no CBM column)', () => {
  it('suggests mm for sides that are implausible as cm', () => {
    // 6000 cm would be a 60 m carton.
    const rows = [
      { L: 6000, W: 4000, H: 3000 },
      { L: 5000, W: 4000, H: 4000 },
      { L: 3000, W: 2000, H: 1500 },
    ];
    const r = inferDimensionUnit(rows, mapping, 'cm');
    expect(r.suggested).toBe('mm');
    expect(r.confidence).toBe('medium');
  });

  it('accepts plausible cm dimensions without complaint', () => {
    const r = inferDimensionUnit(cmRows, mapping, 'cm');
    expect(r.suggested).toBeNull();
    expect(r.reason).toMatch(/plausible/i);
  });

  it('accepts plausible mm dimensions stated as mm', () => {
    const r = inferDimensionUnit(mmRows, mapping, 'mm');
    expect(r.suggested).toBeNull();
  });

  it('suggests a larger unit for absurdly small numbers', () => {
    // 0.6 cm sides are a 6 mm box — more likely metres.
    const rows = [
      { L: 0.6, W: 0.4, H: 0.3 },
      { L: 0.5, W: 0.4, H: 0.4 },
      { L: 0.3, W: 0.2, H: 0.15 },
    ];
    const r = inferDimensionUnit(rows, mapping, 'cm');
    expect(r.suggested).toBe('meters');
  });

  it('explains the magnitude reasoning in centimetres', () => {
    const rows = [
      { L: 6000, W: 4000, H: 3000 },
      { L: 5000, W: 4000, H: 4000 },
      { L: 3000, W: 2000, H: 1500 },
    ];
    const r = inferDimensionUnit(rows, mapping, 'cm');
    expect(r.reason).toMatch(/implausible/i);
    expect(r.reason).toContain('mm');
  });
});

describe('inferDimensionUnit — insufficient or unusable data', () => {
  it('declines with too few rows', () => {
    const r = inferDimensionUnit([{ L: 60, W: 40, H: 30 }], mappingWithCBM, 'cm');
    expect(r.suggested).toBeNull();
    expect(r.reason).toMatch(/not enough/i);
  });

  it('declines when dimension columns are unmapped', () => {
    const r = inferDimensionUnit(cmRows, { name: 'Name' }, 'cm');
    expect(r.suggested).toBeNull();
    expect(r.reason).toMatch(/not enough/i);
  });

  it('ignores rows with zero or missing dimensions', () => {
    const rows = [
      ...cmRows,
      { Name: 'X', L: 0, W: 0, H: 0, CBM: 0 },
      { Name: 'Y', L: '', W: '', H: '' },
    ];
    const r = inferDimensionUnit(rows, mappingWithCBM, 'cm');
    expect(r.suggested).toBeNull(); // still recognises the cm rows as correct
  });

  it('handles null and empty input', () => {
    expect(() => inferDimensionUnit(null, mapping, 'cm')).not.toThrow();
    expect(inferDimensionUnit([], mapping, 'cm').suggested).toBeNull();
    expect(() => inferDimensionUnit(cmRows, null, 'cm')).not.toThrow();
  });

  it('handles locale-formatted dimension strings', () => {
    const rows = [
      { L: '600', W: '400', H: '300', CBM: '0,072' },
      { L: '500', W: '400', H: '400', CBM: '0,08' },
      { L: '300', W: '200', H: '150', CBM: '0,009' },
    ];
    const locales = { CBM: 'comma-decimal' };
    const r = inferDimensionUnit(rows, mappingWithCBM, 'cm', locales);
    expect(r.suggested).toBe('mm');
  });
});

describe('inferDimensionUnit — never mutates, only suggests', () => {
  it('returns a suggestion rather than changing anything', () => {
    const rows = JSON.parse(JSON.stringify(mmRows));
    const before = JSON.stringify(rows);
    inferDimensionUnit(rows, mappingWithCBM, 'cm');
    expect(JSON.stringify(rows)).toBe(before);
  });

  it('only ever suggests a unit the app supports', () => {
    const r = inferDimensionUnit(mmRows, mappingWithCBM, 'cm');
    expect(CANDIDATE_UNITS).toContain(r.suggested);
  });
});
