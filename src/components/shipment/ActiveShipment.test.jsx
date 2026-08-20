/**
 * Integration smoke tests for the shipment panel.
 *
 * These exist because Phase 2b threaded a new payload cap through the fill bars,
 * the overweight warnings and the export handlers — edits to code that already
 * worked. The unit tests prove `computeFreight` returns the right numbers; this
 * proves the component reads them without throwing and puts the governing figure
 * on screen rather than the ISO one.
 *
 * Server-rendered for the same reason as the rules-panel tests: no jsdom in the
 * tree yet, and a render crash is the failure this most needs to catch. Props are
 * built from a real `computeFreight` result and the same derivations `useShipment`
 * performs, so a shape mismatch between hook and component shows up here.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ActiveShipment from './ActiveShipment';
import { computeFreight } from '../../utils/freight';

/** 26 t of dense cargo in a 40' HC: legal on the plate, illegal on a US highway. */
const item = {
  id: 'i1',
  name: 'Tile pallet',
  unit: 'cm',
  length: 120,
  width: 100,
  height: 110,
  packSize: 1,
  quantity: 20,
  totalPcs: 20,
  netWeightPerUnit: 1200,
  grossWeightPerShipper: 1300,
  cbmPerShipper: 1.32,
  packingString: '1X1PC',
};

const totals = {
  cbm: 26.4,
  grossWeight: 26000,
  netWeight: 24000,
  shippers: 20,
  totalPcs: 20,
};

const noop = () => {};

/** Mirrors the derivations `useShipment` exposes, so the shapes stay in step. */
const render = (freightArgs = {}) => {
  const freight = computeFreight({
    items: [item],
    totals,
    mode: 'ocean_fcl',
    container: '40hc',
    ...freightArgs,
  });
  const container = freight.container;
  const plan = freight.containerPlan;

  return renderToStaticMarkup(
    <ActiveShipment
      shipment={[item]}
      flashId={null}
      poNumber="PO-42"
      setPoNumber={noop}
      containerType={freightArgs.container ?? '40hc'}
      setContainerType={noop}
      customContainer={freightArgs.customContainer ?? { label: '', cbm: 0, maxPayloadKg: 0 }}
      updateCustomContainer={noop}
      freightMode={freightArgs.mode ?? 'ocean_fcl'}
      setFreightMode={noop}
      destinationCountry={freightArgs.country ?? 'DEFAULT'}
      setDestinationCountry={noop}
      carrierProfile={freightArgs.carrier ?? 'DEFAULT'}
      setCarrierProfile={noop}
      ruleOverrides={freightArgs.overrides ?? {}}
      updateRuleOverride={noop}
      resetRuleOverrides={noop}
      totals={totals}
      freight={freight}
      container={container}
      volumetricWeight={freight.volumetricKg}
      chargeableWeight={freight.chargeableKg}
      containerPct={container?.cbm ? (totals.cbm / container.cbm) * 100 : 0}
      payloadPct={
        plan.payloadCapKg || container?.maxPayloadKg
          ? (totals.grossWeight / (plan.payloadCapKg || container.maxPayloadKg)) * 100
          : 0
      }
      containerPlan={plan}
      handleRemove={noop}
      handleQuantityChange={noop}
      handleEditItem={noop}
      handleDuplicateItem={noop}
      clearShipment={noop}
      handleAddProductToShipment={noop}
    />
  );
};

describe('ActiveShipment renders the shipment panel', () => {
  it('with default rules, showing the ISO payload', () => {
    const html = render();
    expect(html).toContain('Container Fill');
    expect(html).toContain('Shipment Rules');
    expect(html).toContain('26,500 kg');
  });

  it('offers the custom and no-container selections', () => {
    const html = render();
    expect(html).toContain('Custom container');
    expect(html).toContain('LCL / no container');
    // React escapes the apostrophe in the container labels.
    expect(html).toContain('45&#x27; High Cube');
  });

  /* The point of the phase, at the level the user actually sees it. */
  it('measures the payload bar against the road cap on a US lane', () => {
    const html = render({ country: 'US' });
    expect(html).toContain('21,466 kg');
    // The bar is tagged so the number is not mistaken for the ISO rating.
    expect(html).toContain('>road<');
  });

  it('warns that the load exceeds the road-legal payload, not "max payload"', () => {
    const html = render({ country: 'US' });
    expect(html).toContain('Exceeds the road-legal payload');
    expect(html).toContain('limited by road');
  });

  it('keeps the ISO wording when no country derates the load', () => {
    const html = render();
    expect(html).not.toContain('Exceeds the road-legal payload');
    expect(html).not.toContain('>road<');
  });

  it('shows the billed figure and the derivation toggle', () => {
    const html = render({ mode: 'air' });
    expect(html).toContain('Billed');
    expect(html).toContain('How this is calculated');
  });
});

describe('ActiveShipment survives degenerate shipment states', () => {
  it('loose LCL cargo with no container', () => {
    const html = render({ container: 'none', mode: 'ocean_lcl' });
    expect(html).toContain('loose cargo');
  });

  it('a custom container with no capacity typed in', () => {
    const html = render({ container: 'custom' });
    expect(html).toContain('Enter a usable volume');
  });

  it('a custom container with only a payload entered', () => {
    expect(() =>
      render({ container: 'custom', customContainer: { label: 'Wagon', cbm: 0, maxPayloadKg: 22000 } })
    ).not.toThrow();
  });

  it('an empty shipment', () => {
    expect(() =>
      renderToStaticMarkup(
        <ActiveShipment
          shipment={[]}
          totals={{ cbm: 0, grossWeight: 0, netWeight: 0, shippers: 0, totalPcs: 0 }}
          freight={computeFreight({})}
          container={null}
          containerPlan={computeFreight({}).containerPlan}
          volumetricWeight={0}
          chargeableWeight={0}
          containerPct={0}
          payloadPct={0}
          containerType="none"
          freightMode="ocean_fcl"
          customContainer={{ label: '', cbm: 0, maxPayloadKg: 0 }}
          ruleOverrides={{}}
          poNumber=""
          setPoNumber={noop}
          setContainerType={noop}
          updateCustomContainer={noop}
          setFreightMode={noop}
          setDestinationCountry={noop}
          setCarrierProfile={noop}
          updateRuleOverride={noop}
          resetRuleOverrides={noop}
          handleRemove={noop}
          handleQuantityChange={noop}
          handleEditItem={noop}
          handleDuplicateItem={noop}
          clearShipment={noop}
          handleAddProductToShipment={noop}
        />
      )
    ).not.toThrow();
  });

  /* A record from an older build with no weights at all — the crash class the
     schema layer was added to prevent. */
  it('a legacy item missing every numeric field', () => {
    const legacy = { id: 'old', name: 'Legacy', unit: 'cm' };
    const freight = computeFreight({ items: [legacy], totals, container: '40hc' });
    expect(() =>
      renderToStaticMarkup(
        <ActiveShipment
          shipment={[legacy]}
          totals={totals}
          freight={freight}
          container={freight.container}
          containerPlan={freight.containerPlan}
          volumetricWeight={freight.volumetricKg}
          chargeableWeight={freight.chargeableKg}
          containerPct={0}
          payloadPct={0}
          containerType="40hc"
          freightMode="ocean_fcl"
          customContainer={{ label: '', cbm: 0, maxPayloadKg: 0 }}
          ruleOverrides={{}}
          poNumber=""
          setPoNumber={noop}
          setContainerType={noop}
          updateCustomContainer={noop}
          setFreightMode={noop}
          setDestinationCountry={noop}
          setCarrierProfile={noop}
          updateRuleOverride={noop}
          resetRuleOverrides={noop}
          handleRemove={noop}
          handleQuantityChange={noop}
          handleEditItem={noop}
          handleDuplicateItem={noop}
          clearShipment={noop}
          handleAddProductToShipment={noop}
        />
      )
    ).not.toThrow();
  });
});
