import { describe, it, expect } from 'vitest';
import {
  parseFlexibleNumber,
  detectColumnLocale,
  safeNum,
  safeNonNegative,
  clampInt,
  roundUpTo,
  trimFloat,
} from './numbers';

describe('parseFlexibleNumber — pass-through types', () => {
  it('returns finite numbers unchanged', () => {
    expect(parseFlexibleNumber(42.5)).toBe(42.5);
    expect(parseFlexibleNumber(0)).toBe(0);
    expect(parseFlexibleNumber(-7)).toBe(-7);
  });
  it('rejects non-finite numbers', () => {
    expect(parseFlexibleNumber(NaN)).toBeNull();
    expect(parseFlexibleNumber(Infinity)).toBeNull();
    expect(parseFlexibleNumber(-Infinity)).toBeNull();
  });
  it('rejects null, undefined and empty strings', () => {
    expect(parseFlexibleNumber(null)).toBeNull();
    expect(parseFlexibleNumber(undefined)).toBeNull();
    expect(parseFlexibleNumber('')).toBeNull();
    expect(parseFlexibleNumber('   ')).toBeNull();
  });
  it('rejects booleans — never a meaningful dimension', () => {
    expect(parseFlexibleNumber(true)).toBeNull();
    expect(parseFlexibleNumber(false)).toBeNull();
  });
  it('rejects Dates', () => {
    expect(parseFlexibleNumber(new Date(2026, 0, 1))).toBeNull();
  });
  it('returns null — not 0 — for unparseable text', () => {
    expect(parseFlexibleNumber('abc')).toBeNull();
    expect(parseFlexibleNumber('N/A')).toBeNull();
    expect(parseFlexibleNumber('-')).toBeNull();
    expect(parseFlexibleNumber('kg')).toBeNull();
  });
});

describe('parseFlexibleNumber — plain strings', () => {
  it('parses integers and decimals', () => {
    expect(parseFlexibleNumber('42')).toBe(42);
    expect(parseFlexibleNumber('42.5')).toBe(42.5);
    expect(parseFlexibleNumber('.5')).toBe(0.5);
  });
  it('parses signs', () => {
    expect(parseFlexibleNumber('-5')).toBe(-5);
    expect(parseFlexibleNumber('+5')).toBe(5);
  });
  it('strips unit suffixes and currency symbols', () => {
    expect(parseFlexibleNumber('12.5 kg')).toBe(12.5);
    expect(parseFlexibleNumber('50 cm')).toBe(50);
    expect(parseFlexibleNumber('$1234.56')).toBeCloseTo(1234.56);
    expect(parseFlexibleNumber('1234.56 USD')).toBeCloseTo(1234.56);
  });
  it('handles a trailing percent', () => {
    expect(parseFlexibleNumber('50%')).toBe(50);
  });
});

describe('parseFlexibleNumber — decimal separator disambiguation', () => {
  it('reads the last separator as decimal when both appear', () => {
    expect(parseFlexibleNumber('1,234.56')).toBeCloseTo(1234.56);   // English
    expect(parseFlexibleNumber('1.234,56')).toBeCloseTo(1234.56);   // European
    expect(parseFlexibleNumber('1.234.567,89')).toBeCloseTo(1234567.89);
    expect(parseFlexibleNumber('1,234,567.89')).toBeCloseTo(1234567.89);
  });
  it('treats a lone comma before exactly 3 digits as grouping', () => {
    expect(parseFlexibleNumber('1,234')).toBe(1234);
  });
  it('treats a lone comma before 1, 2 or 4+ digits as decimal', () => {
    expect(parseFlexibleNumber('1,5')).toBe(1.5);
    expect(parseFlexibleNumber('1,25')).toBe(1.25);
    expect(parseFlexibleNumber('1,2345')).toBe(1.2345);
  });
  it('treats a lone dot as decimal, matching JS and metric dimension data', () => {
    expect(parseFlexibleNumber('1.5')).toBe(1.5);
    expect(parseFlexibleNumber('1.234')).toBe(1.234);
  });
  it('treats repeated dots as grouping', () => {
    expect(parseFlexibleNumber('1.234.567')).toBe(1234567);
  });
  it('treats repeated commas as grouping', () => {
    expect(parseFlexibleNumber('1,234,567')).toBe(1234567);
  });
  it('honours an explicit comma-decimal locale hint', () => {
    expect(parseFlexibleNumber('1,234', { locale: 'comma-decimal' })).toBeCloseTo(1.234);
    expect(parseFlexibleNumber('1.234', { locale: 'comma-decimal' })).toBe(1234);
  });
  it('honours an explicit dot-decimal locale hint', () => {
    expect(parseFlexibleNumber('1,234', { locale: 'dot-decimal' })).toBe(1234);
    expect(parseFlexibleNumber('1.234', { locale: 'dot-decimal' })).toBe(1.234);
  });
});

describe('parseFlexibleNumber — grouping characters', () => {
  it('collapses space grouping', () => {
    expect(parseFlexibleNumber('1 234')).toBe(1234);
    expect(parseFlexibleNumber('1 234 567')).toBe(1234567);
  });
  it('collapses NBSP and thin-space grouping', () => {
    expect(parseFlexibleNumber('1 234')).toBe(1234);
    expect(parseFlexibleNumber('1 234')).toBe(1234);
    expect(parseFlexibleNumber('1 234,56')).toBeCloseTo(1234.56);
  });
  it('does NOT fuse two separate numbers sharing a cell', () => {
    // `50 40` is not thousands grouping — 40 is only two digits.
    expect(parseFlexibleNumber('50 40')).toBe(50);
  });
  it('collapses apostrophe grouping (Swiss)', () => {
    expect(parseFlexibleNumber("1'234'567.89")).toBeCloseTo(1234567.89);
  });
  it('folds full-width digits via NFKC', () => {
    expect(parseFlexibleNumber('１２３')).toBe(123);
    expect(parseFlexibleNumber('４２．５')).toBe(42.5);
  });
});

describe('parseFlexibleNumber — signs, negatives, fractions, exponents', () => {
  it('reads accounting parentheses as negative', () => {
    expect(parseFlexibleNumber('(5)')).toBe(-5);
    expect(parseFlexibleNumber('(1,234.56)')).toBeCloseTo(-1234.56);
  });
  it('reads the unicode minus sign', () => {
    expect(parseFlexibleNumber('−5')).toBe(-5);
    expect(parseFlexibleNumber('–5.5')).toBe(-5.5);
  });
  it('parses simple fractions', () => {
    expect(parseFlexibleNumber('1/2')).toBe(0.5);
    expect(parseFlexibleNumber('3/4')).toBe(0.75);
  });
  it('parses mixed fractions', () => {
    expect(parseFlexibleNumber('1 1/2')).toBe(1.5);
    expect(parseFlexibleNumber('2 3/4')).toBe(2.75);
  });
  it('rejects division by zero', () => {
    expect(parseFlexibleNumber('1/0')).toBeNull();
    expect(parseFlexibleNumber('1 1/0')).toBeNull();
  });
  it('parses scientific notation', () => {
    expect(parseFlexibleNumber('1e3')).toBe(1000);
    expect(parseFlexibleNumber('1.2e3')).toBe(1200);
    expect(parseFlexibleNumber('1.2E-2')).toBeCloseTo(0.012);
  });
  it('takes the first value from a range', () => {
    expect(parseFlexibleNumber('5-10')).toBe(5);
    expect(parseFlexibleNumber('5 - 10')).toBe(5);
  });
});

describe('detectColumnLocale', () => {
  it('detects dot-decimal from mixed separators', () => {
    expect(detectColumnLocale(['1,234.56', '2,000.00'])).toBe('dot-decimal');
  });
  it('detects comma-decimal from mixed separators', () => {
    expect(detectColumnLocale(['1.234,56', '2.000,00'])).toBe('comma-decimal');
  });
  it('detects comma-decimal from a short fractional comma', () => {
    expect(detectColumnLocale(['1,5', '2,75', '10,25'])).toBe('comma-decimal');
  });
  it('detects dot-decimal from a short fractional dot', () => {
    expect(detectColumnLocale(['1.5', '2.75'])).toBe('dot-decimal');
  });
  it('detects comma-decimal from dot grouping', () => {
    expect(detectColumnLocale(['1.234.567', '2.000.000'])).toBe('comma-decimal');
  });
  it('returns null without evidence', () => {
    expect(detectColumnLocale(['100', '200', '300'])).toBeNull();
    expect(detectColumnLocale([])).toBeNull();
    expect(detectColumnLocale(null)).toBeNull();
  });
  it('ignores numbers and blanks', () => {
    expect(detectColumnLocale([42, null, '', '1,5'])).toBe('comma-decimal');
  });
  it('resolves the ambiguous 1,234 case when the column proves comma-decimal', () => {
    const locale = detectColumnLocale(['1,5', '2,25', '1,234']);
    expect(locale).toBe('comma-decimal');
    expect(parseFlexibleNumber('1,234', { locale })).toBeCloseTo(1.234);
  });
});

describe('safeNum / safeNonNegative', () => {
  it('falls back deliberately', () => {
    expect(safeNum('abc')).toBe(0);
    expect(safeNum('abc', 1)).toBe(1);
    expect(safeNum(null, 5)).toBe(5);
  });
  it('passes valid values through', () => {
    expect(safeNum('12.5 kg')).toBe(12.5);
  });
  it('makes negatives positive for dimensions and weights', () => {
    expect(safeNonNegative('-5')).toBe(5);
    expect(safeNonNegative('(5)')).toBe(5);
    expect(safeNonNegative('abc', 2)).toBe(2);
  });
});

describe('clampInt', () => {
  it('rounds to an integer', () => {
    expect(clampInt('5.6')).toBe(6);
    expect(clampInt('5.4')).toBe(5);
  });
  it('clamps to the range', () => {
    expect(clampInt('0', 1)).toBe(1);
    expect(clampInt('999', 1, 100)).toBe(100);
    expect(clampInt('-5', 1)).toBe(1);
  });
  it('yields min for unparseable input — this is what stops NaN totals', () => {
    expect(clampInt('abc', 1)).toBe(1);
    expect(clampInt(NaN, 1)).toBe(1);
    expect(clampInt(undefined, 1)).toBe(1);
  });
});

describe('roundUpTo', () => {
  it('rounds up to the next 0.5 kg (IATA air)', () => {
    expect(roundUpTo(35.1, 0.5)).toBe(35.5);
    expect(roundUpTo(35.6, 0.5)).toBe(36);
    expect(roundUpTo(0.1, 0.5)).toBe(0.5);
  });
  it('rounds up to the next 1 kg (courier)', () => {
    expect(roundUpTo(35.1, 1)).toBe(36);
    expect(roundUpTo(35.0, 1)).toBe(35);
  });
  it('leaves a value already exactly on a step alone', () => {
    expect(roundUpTo(35.5, 0.5)).toBe(35.5);
    expect(roundUpTo(36, 0.5)).toBe(36);
    // 0.1+0.2 float noise must not push this to the next step
    expect(roundUpTo(0.30000000000000004, 0.1)).toBeCloseTo(0.3, 10);
  });
  it('handles zero and invalid input', () => {
    expect(roundUpTo(0, 0.5)).toBe(0);
    expect(roundUpTo(5, 0)).toBe(5);
    expect(roundUpTo(NaN, 0.5)).toBe(0);
  });
});

describe('trimFloat', () => {
  it('kills float noise', () => {
    expect(trimFloat(0.1 + 0.2)).toBe(0.3);
  });
  it('preserves meaningful precision', () => {
    expect(trimFloat(0.000048)).toBe(0.000048);
  });
  it('handles invalid input', () => {
    expect(trimFloat(NaN)).toBe(0);
    expect(trimFloat(Infinity)).toBe(0);
  });
});
