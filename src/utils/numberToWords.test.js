import { describe, it, expect } from 'vitest';
import {
  amountToWords,
  integerToWords,
  CURRENCY_UNITS,
  CURRENCY_OPTIONS,
} from './numberToWords';

describe('integerToWords — international', () => {
  const cases = [
    [0, 'zero'],
    [1, 'one'],
    [13, 'thirteen'],
    [20, 'twenty'],
    [21, 'twenty-one'],
    [99, 'ninety-nine'],
    [100, 'one hundred'],
    [101, 'one hundred one'],
    [999, 'nine hundred ninety-nine'],
    [1000, 'one thousand'],
    [1001, 'one thousand one'],
    [10_000, 'ten thousand'],
    [100_000, 'one hundred thousand'],
    [1_000_000, 'one million'],
    [1_000_000_000, 'one billion'],
  ];

  for (const [n, expected] of cases) {
    it(`spells ${n}`, () => {
      expect(integerToWords(n)).toBe(expected);
    });
  }

  it('spells a full mixed number', () => {
    expect(integerToWords(1_234_567)).toBe(
      'one million two hundred thirty-four thousand five hundred sixty-seven'
    );
  });

  it('recurses into scale groups larger than 999', () => {
    // 12 million, not "twelve thousand thousand".
    expect(integerToWords(12_000_000)).toBe('twelve million');
  });
});

describe('integerToWords — Indian', () => {
  /* Not a cosmetic variant: an Indian invoice reading "1.2 million" instead of
     "12 lakh" looks wrong to every party who has to sign it. */
  const cases = [
    [1000, 'one thousand'],
    [100_000, 'one lakh'],
    [150_000, 'one lakh fifty thousand'],
    [1_234_567, 'twelve lakh thirty-four thousand five hundred sixty-seven'],
    [10_000_000, 'one crore'],
    [12_345_678, 'one crore twenty-three lakh forty-five thousand six hundred seventy-eight'],
  ];

  for (const [n, expected] of cases) {
    it(`spells ${n}`, () => {
      expect(integerToWords(n, 'indian')).toBe(expected);
    });
  }

  it('groups crores above 99 in the same 2-2-3 pattern', () => {
    expect(integerToWords(1_000_000_000, 'indian')).toBe('one hundred crore');
  });

  it('differs from the international system for the same number', () => {
    const n = 1_234_567;
    expect(integerToWords(n, 'indian')).not.toBe(integerToWords(n, 'international'));
  });
});

describe('integerToWords — degenerate input', () => {
  it('treats junk as zero rather than throwing', () => {
    for (const v of [null, undefined, '', NaN, 'abc', {}, []]) {
      expect(() => integerToWords(v)).not.toThrow();
    }
    expect(integerToWords(null)).toBe('zero');
    expect(integerToWords('abc')).toBe('zero');
  });

  it('takes the magnitude of a negative', () => {
    expect(integerToWords(-42)).toBe('forty-two');
  });

  it('truncates a fraction rather than rounding it', () => {
    expect(integerToWords(5.9)).toBe('five');
  });

  it('declines rather than spelling a number past float precision', () => {
    // Beyond MAX_SAFE_INTEGER the digits themselves are untrustworthy, and an
    // imprecise number spelled onto an invoice is worse than an honest refusal.
    expect(integerToWords(1e300)).toBe('amount too large to express in words');
  });
});

describe('amountToWords', () => {
  it('names the currency and appends the conventional terminator', () => {
    expect(amountToWords(100, 'USD')).toBe('US Dollars one hundred only');
  });

  it('spells the minor unit when the currency has a named one', () => {
    expect(amountToWords(100.45, 'USD')).toBe('US Dollars one hundred and forty-five cents only');
    expect(amountToWords(5.5, 'GBP')).toBe('Pounds Sterling five and fifty pence only');
  });

  it('uses the Indian system for INR without being told', () => {
    // The currency carries its own numbering system, so callers cannot forget.
    expect(amountToWords(1_234_567, 'INR')).toBe(
      'Rupees twelve lakh thirty-four thousand five hundred sixty-seven only'
    );
  });

  it('honours an explicit system override', () => {
    expect(amountToWords(100_000, 'USD', { system: 'indian' })).toBe(
      'US Dollars one lakh only'
    );
  });

  it('omits the minor unit for a zero-decimal currency', () => {
    expect(amountToWords(1000.7, 'JPY')).toBe('Japanese Yen one thousand one only');
  });

  it('falls back to a fraction for an unknown minor unit', () => {
    // Standard practice, and never wrong — unlike guessing "cents" on a currency
    // that has no cents.
    expect(amountToWords(10.25, 'XYZ')).toBe('XYZ ten and 25/100 only');
  });

  it('rounds to the currency precision BEFORE splitting major and minor', () => {
    // 0.999 must become "one dollar", not "zero dollars and 100 cents".
    expect(amountToWords(0.999, 'USD')).toBe('US Dollars one only');
    expect(amountToWords(1.006, 'USD')).toBe('US Dollars one and one cents only');
  });

  it('rounds a half-cent the way binary floats actually do', () => {
    /* 1.005 × 100 is 100.49999999999999 in IEEE 754, so it rounds DOWN. Asserted
       rather than papered over: any "fix" here would be a different rounding rule
       applied inconsistently with the `toFixed` the rest of the export layer uses,
       and an invoice whose words and figures disagree by a cent is worse than one
       that rounds a half-cent down. */
    expect(amountToWords(1.005, 'USD')).toBe('US Dollars one only');
  });

  it('omits the minor unit when it rounds to zero', () => {
    expect(amountToWords(42.001, 'USD')).toBe('US Dollars forty-two only');
  });

  it('marks a negative amount rather than hiding the sign', () => {
    expect(amountToWords(-50, 'USD')).toBe('Minus US Dollars fifty only');
  });

  it('can drop the terminator when asked', () => {
    expect(amountToWords(5, 'USD', { only: false })).toBe('US Dollars five');
  });

  it('handles zero and junk without throwing', () => {
    expect(amountToWords(0, 'USD')).toBe('US Dollars zero only');
    for (const v of [null, undefined, NaN, 'abc']) {
      expect(() => amountToWords(v, 'USD')).not.toThrow();
    }
  });

  it('defaults to USD for a missing currency', () => {
    expect(amountToWords(1)).toContain('US Dollars');
  });

  it('is case-insensitive about the currency code', () => {
    expect(amountToWords(1, 'inr')).toContain('Rupees');
  });
});

describe('CURRENCY_UNITS', () => {
  it('offers every configured currency as an option', () => {
    expect(CURRENCY_OPTIONS).toEqual(Object.keys(CURRENCY_UNITS));
    expect(CURRENCY_OPTIONS).toContain('USD');
    expect(CURRENCY_OPTIONS).toContain('INR');
  });

  it('gives every entry a major name and a decimal count', () => {
    for (const [code, meta] of Object.entries(CURRENCY_UNITS)) {
      expect(meta.major, code).toBeTruthy();
      expect(typeof meta.decimals, code).toBe('number');
    }
  });

  it('scopes the Indian numbering system to INR alone', () => {
    const indian = Object.entries(CURRENCY_UNITS).filter(([, m]) => m.system === 'indian');
    expect(indian.map(([c]) => c)).toEqual(['INR']);
  });
});
