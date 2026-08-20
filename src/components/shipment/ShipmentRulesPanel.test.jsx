/**
 * Render smoke tests for the rules panel.
 *
 * Deliberately server-rendered rather than mounted in a DOM: `react-dom/server`
 * ships with the app already, so this catches the failure mode that matters here —
 * a crash while rendering — without pulling in jsdom and @testing-library, which
 * the plan schedules for a later phase.
 *
 * What it cannot check is interaction (the disclosure toggles, the override
 * inputs). Those are exercised manually. What it does check is that every branch
 * of the panel survives the shapes `computeFreight` actually produces, including
 * the degenerate ones — no container, no country, junk selections — which is where
 * a new component reading six levels of nested result is most likely to throw.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ShipmentRulesPanel from './ShipmentRulesPanel';
import { computeFreight } from '../../utils/freight';

const totals = { cbm: 40, grossWeight: 26000, netWeight: 24000 };

const render = (args = {}, props = {}) =>
  renderToStaticMarkup(
    <ShipmentRulesPanel
      freight={computeFreight({ totals, mode: 'ocean_fcl', container: '40hc', ...args })}
      destinationCountry={args.country ?? 'DEFAULT'}
      carrierProfile={args.carrier ?? 'DEFAULT'}
      ruleOverrides={args.overrides ?? {}}
      setDestinationCountry={() => {}}
      setCarrierProfile={() => {}}
      updateRuleOverride={() => {}}
      resetRuleOverrides={() => {}}
      {...props}
    />
  );

describe('ShipmentRulesPanel renders', () => {
  it('with no rules selected, and says so', () => {
    const html = render();
    expect(html).toContain('Shipment Rules');
    expect(html).toContain('defaults');
  });

  it('offers both selectors, labelled for what each controls', () => {
    const html = render();
    expect(html).toContain('Destination');
    expect(html).toContain('Carrier');
    expect(html).toContain('Road payload limit');
    expect(html).toContain('Volumetric divisor');
  });

  /* The governing-limit banner is the reason the panel exists. */
  it('strikes the ISO rating through when US road law binds', () => {
    const html = render({ country: 'US' });
    expect(html).toContain('</s>'); // the struck-through ISO figure
    expect(html).toContain('26,500 kg ISO');
    expect(html).toContain('21,466 kg');
    expect(html).toContain('road law');
    // The arithmetic is printed, not just the conclusion.
    expect(html).toContain('36287 kg GVW');
  });

  it('confirms the check was made when the ISO rating still governs', () => {
    const html = render({ country: 'EU_44T' });
    expect(html).toContain('would allow');
    expect(html).toContain('container rating governs');
    expect(html).not.toContain('</s>'); // nothing struck through
  });

  it('shows the carrier divisor with its metric and imperial figures', () => {
    const html = render({ mode: 'courier', carrier: 'DHL_EXPRESS_AE' });
    expect(html).toContain('4,000 cm³/kg');
    expect(html).toContain('111 in³/lb');
    expect(html).toContain('carrier tariff');
  });

  it('warns when the chosen carrier does not cover the mode', () => {
    const html = render({ mode: 'ocean_lcl', carrier: 'USPS_DOMESTIC', container: 'none' });
    expect(html).toContain('does not publish a tariff');
  });

  it('reports a manual payload override instead of a profile figure', () => {
    const html = render({ country: 'US', overrides: { payloadKg: 24000 } });
    expect(html).toContain('manually set to');
    expect(html).toContain('24,000 kg');
  });

  it('counts the overrides in force', () => {
    const html = render({ overrides: { tractorKg: 8000, chassisKg: 3000 } });
    expect(html).toContain('2 overridden');
  });

  /* A country listed but not researched must read as a gap to close, not as a
     clean bill of health — that distinction is the honest part of the feature. */
  it('says the limit is missing for a country with no data on file', () => {
    const html = render({ country: 'IN' });
    expect(html).toContain('No road-weight limit on file for India');
    expect(html).toContain('enter the local GVW');
    expect(html).not.toContain('</s>');
  });

  it('offers the unresearched countries in their own group', () => {
    const html = render();
    expect(html).toContain('No limit on file');
    expect(html).toContain('India (no road limit on file)');
  });
});

describe('ShipmentRulesPanel survives degenerate input', () => {
  it('loose LCL cargo — no container to rate', () => {
    const html = render({ container: 'none', country: 'US' });
    // Must not claim a 0 kg container rating governs.
    expect(html).not.toContain('container rating governs');
    expect(html).toContain('Shipment Rules');
  });

  it('a custom container with nothing typed into it yet', () => {
    expect(() => render({ container: 'custom', country: 'US' })).not.toThrow();
  });

  it('an unknown country and carrier key', () => {
    expect(() => render({ country: 'ZZ', carrier: 'NOPE' })).not.toThrow();
  });

  it('an empty shipment', () => {
    expect(() =>
      renderToStaticMarkup(
        <ShipmentRulesPanel
          freight={computeFreight({})}
          setDestinationCountry={() => {}}
          setCarrierProfile={() => {}}
          updateRuleOverride={() => {}}
          resetRuleOverrides={() => {}}
        />
      )
    ).not.toThrow();
  });

  /* The component must not assume the parent passed anything at all — a prop
     rename upstream should degrade, not white-screen the app. */
  it('no freight result at all', () => {
    expect(() => renderToStaticMarkup(<ShipmentRulesPanel />)).not.toThrow();
  });
});
