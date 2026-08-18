import { describe, it, expect } from 'vitest';
import { mapHeaders, scoreField, FIELD_DEFS, CONFIDENCE } from './headerMap';

describe('mapHeaders — the order-dependence bug', () => {
  /* The original implementation used first-substring-wins. Because
     `description` is an alias for `name`, the result depended on column order —
     the same data imported differently depending on how the columns were laid
     out. Both orders must now pick "Product Name". */
  it('picks Product Name over Description when Description comes first', () => {
    const { mapping } = mapHeaders(['Description', 'Product Name', 'Length']);
    expect(mapping.name).toBe('Product Name');
  });

  it('picks Product Name over Description when Product Name comes first', () => {
    const { mapping } = mapHeaders(['Product Name', 'Description', 'Length']);
    expect(mapping.name).toBe('Product Name');
  });

  it('still falls back to Description when it is the only name-ish column', () => {
    const { mapping } = mapHeaders(['Description', 'Length', 'Width']);
    expect(mapping.name).toBe('Description');
  });

  it('prefers Height over Depth regardless of order', () => {
    expect(mapHeaders(['Depth', 'Height']).mapping.height).toBe('Height');
    expect(mapHeaders(['Height', 'Depth']).mapping.height).toBe('Height');
  });

  it('prefers Total CBM over a bare CBM column', () => {
    const { mapping } = mapHeaders(['Item', 'CBM', 'Total CBM']);
    expect(mapping.cbm).toBe('Total CBM');
  });
});

describe('mapHeaders — one header cannot serve two fields', () => {
  it('assigns each header at most once', () => {
    const { mapping } = mapHeaders([
      'Product Name', 'Length', 'Width', 'Height', 'Pack Size', 'Net Weight',
      'Gross Weight',
    ]);
    const used = Object.values(mapping);
    expect(new Set(used).size).toBe(used.length);
  });

  it('gives Description to nothing else once Name is taken', () => {
    const { mapping, unmappedHeaders } = mapHeaders(['Product Name', 'Description']);
    expect(mapping.name).toBe('Product Name');
    expect(unmappedHeaders).toContain('Description');
  });
});

describe('mapHeaders — common real-world header sets', () => {
  it('maps a plain English catalog', () => {
    const { mapping } = mapHeaders([
      'Product Name', 'Length', 'Width', 'Height', 'Pack Size', 'Gross Weight',
    ]);
    expect(mapping).toMatchObject({
      name: 'Product Name',
      length: 'Length',
      width: 'Width',
      height: 'Height',
      packSize: 'Pack Size',
      grossWeight: 'Gross Weight',
    });
  });

  it('maps single-letter L/W/H columns', () => {
    const { mapping } = mapHeaders(['Item', 'L', 'W', 'H']);
    expect(mapping.name).toBe('Item');
    expect(mapping.length).toBe('L');
    expect(mapping.width).toBe('W');
    expect(mapping.height).toBe('H');
  });

  it('maps headers carrying unit qualifiers', () => {
    const { mapping } = mapHeaders([
      'Item Name', 'Length (cm)', 'Width (cm)', 'Height (cm)', 'Net Wt (kg)',
    ]);
    expect(mapping.length).toBe('Length (cm)');
    expect(mapping.width).toBe('Width (cm)');
    expect(mapping.height).toBe('Height (cm)');
    expect(mapping.netWeight).toBe('Net Wt (kg)');
  });

  it('maps an Indian pharma-style sheet', () => {
    const { mapping } = mapHeaders([
      'Material Name', 'Packing Name', '1 Pack Qnt', 'Net Wt.', 'Gross Wt.',
      'Sum of TotalCBM',
    ]);
    expect(mapping.name).toBe('Material Name');
    expect(mapping.packingString).toBe('Packing Name');
    expect(mapping.packSize).toBe('1 Pack Qnt');
    expect(mapping.netWeight).toBe('Net Wt.');
    expect(mapping.grossWeight).toBe('Gross Wt.');
    expect(mapping.cbm).toBe('Sum of TotalCBM');
  });

  it('maps a combined dimension column', () => {
    const { mapping } = mapHeaders(['Name', 'Dimensions (LxWxH)']);
    expect(mapping.name).toBe('Name');
    expect(mapping.dims).toBe('Dimensions (LxWxH)');
  });

  it('maps the new trade fields', () => {
    const { mapping } = mapHeaders([
      'Item', 'HS Code', 'Unit Price', 'Currency', 'Country of Origin',
      'Shipping Marks', 'No. of Cartons',
    ]);
    expect(mapping.hsCode).toBe('HS Code');
    expect(mapping.unitPrice).toBe('Unit Price');
    expect(mapping.currency).toBe('Currency');
    expect(mapping.origin).toBe('Country of Origin');
    expect(mapping.marks).toBe('Shipping Marks');
    expect(mapping.quantity).toBe('No. of Cartons');
  });

  it('maps a per-row unit column', () => {
    const { mapping } = mapHeaders(['Item', 'L', 'W', 'H', 'UOM']);
    expect(mapping.unit).toBe('UOM');
  });
});

describe('mapHeaders — negative keywords prevent cross-claims', () => {
  it('never lets Net Weight satisfy grossWeight', () => {
    const { mapping } = mapHeaders(['Item', 'Net Weight']);
    expect(mapping.netWeight).toBe('Net Weight');
    expect(mapping.grossWeight).toBeUndefined();
  });

  it('never lets Gross Weight satisfy netWeight', () => {
    const { mapping } = mapHeaders(['Item', 'Gross Weight']);
    expect(mapping.grossWeight).toBe('Gross Weight');
    expect(mapping.netWeight).toBeUndefined();
  });

  it('keeps both apart when both are present', () => {
    const { mapping } = mapHeaders(['Item', 'Net Wt', 'Gross Wt']);
    expect(mapping.netWeight).toBe('Net Wt');
    expect(mapping.grossWeight).toBe('Gross Wt');
  });

  it('does not read Unit Price or Unit Weight as a unit-of-measure column', () => {
    expect(mapHeaders(['Item', 'Unit Price']).mapping.unit).toBeUndefined();
    expect(mapHeaders(['Item', 'Unit Weight']).mapping.unit).toBeUndefined();
  });

  it('does not read "Qty per Pack" as a carton count', () => {
    const { mapping } = mapHeaders(['Item', 'Qty per Pack']);
    expect(mapping.quantity).toBeUndefined();
  });

  it('does not read Wavelength as a Length column', () => {
    const { mapping } = mapHeaders(['Item', 'Wavelength']);
    expect(mapping.length).toBeUndefined();
  });
});

describe('mapHeaders — single-letter aliases are exact-only', () => {
  it('does not let "Length" match the alias "h" via its last letter', () => {
    const { mapping } = mapHeaders(['Length']);
    expect(mapping.length).toBe('Length');
    expect(mapping.height).toBeUndefined();
  });

  it('does not let "Width" match the alias "d"', () => {
    const { mapping } = mapHeaders(['Width']);
    expect(mapping.width).toBe('Width');
    expect(mapping.height).toBeUndefined();
  });

  it('prefers a spelled-out column over a single letter', () => {
    const { mapping } = mapHeaders(['Length', 'L']);
    expect(mapping.length).toBe('Length');
  });
});

describe('mapHeaders — confidence', () => {
  it('reports high confidence for an exact match', () => {
    const { confidence } = mapHeaders(['Product Name', 'Length']);
    expect(confidence.name).toBe(CONFIDENCE.HIGH);
    expect(confidence.length).toBe(CONFIDENCE.HIGH);
  });

  it('reports lower confidence for a loose match', () => {
    const { confidence, mapping } = mapHeaders(['Consignment Particulars']);
    expect(mapping.name).toBe('Consignment Particulars');
    expect([CONFIDENCE.MEDIUM, CONFIDENCE.CONFIRM]).toContain(confidence.name);
  });

  it('exposes numeric scores for debugging', () => {
    const { scores } = mapHeaders(['Product Name']);
    expect(scores.name).toBeGreaterThan(90);
  });
});

describe('mapHeaders — junk and edge cases', () => {
  it('handles an empty header list', () => {
    const { mapping, unmappedHeaders } = mapHeaders([]);
    expect(mapping).toEqual({});
    expect(unmappedHeaders).toEqual([]);
  });

  it('handles null/undefined input', () => {
    expect(() => mapHeaders(null)).not.toThrow();
    expect(mapHeaders(undefined).mapping).toEqual({});
  });

  it('ignores blank headers', () => {
    const { mapping } = mapHeaders(['', '   ', 'Product Name']);
    expect(mapping.name).toBe('Product Name');
    expect(Object.values(mapping)).not.toContain('');
  });

  it('maps nothing when no header resembles a known field', () => {
    const { mapping } = mapHeaders(['zzz', 'qqq', '12345']);
    expect(Object.keys(mapping)).toHaveLength(0);
  });

  it('reports every unmapped header', () => {
    const { unmappedHeaders } = mapHeaders(['Product Name', 'Notes', 'Internal Ref']);
    expect(unmappedHeaders).toContain('Notes');
  });

  it('can be restricted to a subset of fields', () => {
    const { mapping } = mapHeaders(['Product Name', 'Length', 'HS Code'], {
      fields: ['name', 'length'],
    });
    expect(mapping.name).toBe('Product Name');
    expect(mapping.length).toBe('Length');
    expect(mapping.hsCode).toBeUndefined();
  });

  it('is deterministic across repeated calls', () => {
    const headers = ['Description', 'Product Name', 'L', 'W', 'H', 'Qty'];
    const a = mapHeaders(headers).mapping;
    const b = mapHeaders(headers).mapping;
    expect(a).toEqual(b);
  });

  it('offers ranked candidates for manual override', () => {
    const { candidates } = mapHeaders(['Product Name', 'Description']);
    expect(candidates.name.length).toBeGreaterThanOrEqual(2);
    expect(candidates.name[0].header).toBe('Product Name');
    expect(candidates.name[0].score).toBeGreaterThan(candidates.name[1].score);
  });
});

describe('scoreField', () => {
  it('scores an exact match highest', () => {
    const exact = scoreField('Length', FIELD_DEFS.length);
    const loose = scoreField('Overall Length Value', FIELD_DEFS.length);
    expect(exact).toBeGreaterThan(loose);
  });

  it('scores a parenthetical-qualified header nearly as high as exact', () => {
    expect(scoreField('Length (cm)', FIELD_DEFS.length)).toBeGreaterThan(90);
  });

  it('returns 0 for a disqualified header', () => {
    expect(scoreField('Gross Weight', FIELD_DEFS.netWeight)).toBe(0);
  });

  it('returns 0 for an unrelated header', () => {
    expect(scoreField('Invoice Date', FIELD_DEFS.length)).toBe(0);
  });

  it('tolerates a typo via fuzzy matching', () => {
    expect(scoreField('Lenght', FIELD_DEFS.length)).toBeGreaterThan(0);
  });
});
