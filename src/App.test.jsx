import { describe, it, expect, beforeAll } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import App from './App';

/**
 * App render smoke tests.
 *
 * The export overhaul added four components and rewired ActiveShipment, and none of
 * that is reachable from the util tests. Server rendering catches the class of
 * failure that actually happens when wiring components together: an undefined prop
 * destructured, a missing import, a `.map` over something that is not an array — the
 * three breaks that got through to `npm run build` during this change.
 *
 * `react-dom/server` rather than jsdom + @testing-library on purpose. It is already
 * a dependency, it needs no new devDeps, and it answers "does this render at all",
 * which is the question here. Interaction testing needs jsdom, which the plan
 * schedules alongside `Modal.test.jsx`.
 */
beforeAll(() => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  const mm = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  });
  globalThis.matchMedia = mm;
  globalThis.window = globalThis;
  globalThis.window.matchMedia = mm;
  if (!globalThis.document) {
    globalThis.document = {
      documentElement: { classList: { toggle() {}, add() {}, remove() {} } },
      body: { classList: { toggle() {} } },
    };
  }
});

describe('App renders', () => {
  it('renders the dashboard without throwing', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('CBM Calculator');
    expect(html).toContain('Active Shipment');
  });

  it('renders the company-profile entry point in the header', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('company-profile-btn');
  });

  it('renders with a corrupt localStorage payload', () => {
    localStorage.setItem('cbm-shipment', '{"not":"an array"}');
    localStorage.setItem('cbm-products', 'not json at all');
    localStorage.setItem('cbm-company', '{"parties":"nope"}');
    localStorage.setItem('cbm-shipment-meta', '{"customContainer":{"cbm":"lots"}}');
    expect(() => renderToStaticMarkup(<App />)).not.toThrow();
  });

  it('renders a shipment with items, showing the export button and rules panel', () => {
    localStorage.setItem(
      'cbm-shipment',
      JSON.stringify({
        v: 1,
        data: [
          {
            id: 'i1',
            name: 'Steel Bracket',
            unit: 'cm',
            length: 50,
            width: 40,
            height: 30,
            packSize: 10,
            quantity: 12,
            totalPcs: 118,
            netWeightPerUnit: 0.5,
            grossWeightPerShipper: 6,
            cbmPerShipper: 0.06,
            hsCode: '7326.90',
          },
        ],
      })
    );
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('Steel Bracket');
    expect(html).toContain('export-btn');
    // The freight workings toggle and the trade-details panel both mount.
    expect(html).toContain('freight-workings-toggle');
    expect(html).toContain('shipment-details-toggle');
    // And the per-item trade-field toggle, with its "has data" dot.
    expect(html).toContain('trade-item-0');
  });
});
