/**
 * Freight & container accuracy — the single entry point every display and export
 * reads chargeable weight from.
 *
 * Why this module exists: the app used to derive chargeable weight from the
 * *aggregate* CBM times a rounded kg/m³ shorthand (`cbm × 167`). Carriers do not
 * bill that way. They measure **each piece**, divide by a tariff divisor stated in
 * cm³/kg, and round the consignment total **up** to a mode-specific step. Those
 * three differences compound, and none of them were visible to the user.
 *
 * So `computeFreight` returns not just numbers but `workings[]` — an ordered,
 * human-readable derivation that renders identically in the UI and in the PDF.
 * Every billed figure is traceable to the inputs that produced it.
 *
 * Two rule sets feed in, and keeping them separate matters: a **carrier/service**
 * profile sets the volumetric divisor and rounding (`carrierProfiles.js`), while a
 * **destination-country** profile sets the road-legal payload cap and the
 * measurement-ton definition (`countryProfiles.js`). Conflating them — the obvious
 * design, one "country" dropdown — would apply national law to a carrier tariff and
 * get both wrong. Both default to the behaviour that predates them, so an untouched
 * shipment's numbers are unchanged.
 *
 * Sourcing: divisors and the ISO container figures are cited in
 * docs/COUNTRY_FREIGHT_RULES.md. Two values there are marked `[U]` — unverified
 * from a primary source — and are flagged as such in the output `notes[]` rather
 * than presented as authoritative:
 *   • the IATA 0.5 kg round-up (documented only in the paid TACT Rules)
 *   • the ocean LCL 1 CBM = 1,000 kg equivalence
 */
import {
  toCm,
  FREIGHT_MODES,
  normalizeFreightMode,
  resolveContainer,
  planContainers,
} from './calculations';
import {
  MODE_TARIFF_DEFAULTS,
  DEFAULT_CARRIER,
  resolveVolumetricRule,
  CARRIER_CITATIONS,
} from './carrierProfiles';
import {
  DEFAULT_COUNTRY,
  resolvePayloadCap,
  resolveMeasurementTon,
  CITATIONS,
} from './countryProfiles';
import { safeNonNegative, clampInt, roundUpTo, trimFloat } from './numbers';

/** cm³ in one cubic metre. */
const CM3_PER_M3 = 1_000_000;

/**
 * Per-mode volumetric tariff.
 *
 * The divisor and round-up come from `MODE_TARIFF_DEFAULTS` in `carrierProfiles.js`
 * rather than being written out again here — a carrier profile overrides those same
 * numbers, so keeping one copy is what stops the default path and the overridden
 * path from drifting apart. What stays here is the part carriers do not vary: what
 * the mode is *billed in*, and what the chargeable figure means.
 *
 * divisorCm3PerKg — cm³ of measured volume that bill as 1 kg. This is how every
 *                   carrier tariff is actually written. kg/m³ = 1e6 ÷ divisor,
 *                   so 6000 → 166.667 kg/m³ and 5000 → 200 kg/m³.
 * roundingStepKg  — the step the consignment's chargeable weight rounds UP to.
 *                   0 means no rounding is applied.
 * unit            — what the shipment is billed in: kilograms, or revenue tons.
 */
export const VOLUMETRIC_RULES = {
  ocean_fcl: {
    ...MODE_TARIFF_DEFAULTS.ocean_fcl,
    unit: 'kg',
    basis: 'Gross weight only — FCL has no volumetric basis',
  },
  ocean_lcl: {
    ...MODE_TARIFF_DEFAULTS.ocean_lcl,
    unit: 'RT',
    basis: 'W/M — revenue tons = max(CBM, tonnes)',
  },
  air: {
    ...MODE_TARIFF_DEFAULTS.air,
    unit: 'kg',
    basis: 'max(gross, volumetric)',
  },
  courier: {
    ...MODE_TARIFF_DEFAULTS.courier,
    unit: 'kg',
    basis: 'max(gross, volumetric)',
  },
};

/**
 * Cubic metres per revenue ton when no country profile narrows it. 1.0 is the
 * international convention the `cbm × 1000` rule implies.
 *
 * National freight-ton definitions differ — US 40 ft³ = 1.133 m³, UK 42 ft³ =
 * 1.189 m³ — and `resolveMeasurementTon` in `countryProfiles.js` now selects
 * between them. This constant remains the floor that resolution falls back to.
 */
export const DEFAULT_MEASUREMENT_TON_M3 = 1;

/** Revenue tons are quoted to 2 decimals, so that is the round-up step. */
export const RT_ROUNDING_STEP = 0.01;

/**
 * Group a number with thousands separators at a fixed precision.
 *
 * Hand-rolled rather than `toLocaleString` so `workings[]` expressions read the
 * same in the browser, in the PDF and in a test run — a locale-dependent string
 * inside an audit trail is a bug waiting to happen.
 *
 * @param {number} v
 * @param {number} [dp=2]
 * @returns {string}
 */
export const fmtNum = (v, dp = 2) => {
  const n = trimFloat(v, 6);
  const fixed = Math.abs(n).toFixed(dp);
  const [int, frac] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${n < 0 ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
};

/**
 * Measured volume of one shipper in cm³, the way a carrier measures it.
 *
 * Dimensions are the source of truth whenever present. An item entered as a
 * pre-calculated CBM (no L/W/H) has no measurable faces, so its stored volume is
 * converted instead and tagged `preset` — the caller surfaces that, because a
 * carrier re-measuring on the ramp may well disagree with it.
 *
 * Note: carriers measure to the **longest dimension on each axis**, so anything
 * non-cuboid bills higher than its true volume. Nothing here can correct for that;
 * it is called out in `notes[]`.
 *
 * @param {object} item - A shipment line.
 * @returns {{cm3: number, source: 'dims'|'preset'}}
 */
export const itemVolumeCm3 = (item) => {
  const unit = item?.unit || 'cm';
  const l = toCm(safeNonNegative(item?.length), unit);
  const w = toCm(safeNonNegative(item?.width), unit);
  const h = toCm(safeNonNegative(item?.height), unit);
  const fromDims = l * w * h;
  if (Number.isFinite(fromDims) && fromDims > 0) return { cm3: fromDims, source: 'dims' };
  return { cm3: safeNonNegative(item?.cbmPerShipper) * CM3_PER_M3, source: 'preset' };
};

/**
 * Per-piece volumetric measurement across a shipment.
 *
 * @param {Array<object>} items
 * @returns {{lines: object[], cm3: number, grossKg: number, netKg: number,
 *            dimsCount: number, presetCount: number}}
 */
export const measureShipment = (items) => {
  const lines = [];
  let cm3 = 0;
  let grossKg = 0;
  let netKg = 0;
  let dimsCount = 0;
  let presetCount = 0;

  for (const item of items || []) {
    if (!item || typeof item !== 'object') continue;

    const qty = clampInt(item.quantity, 1);
    const pack = clampInt(item.packSize, 1);
    const pcs = clampInt(item.totalPcs, 0) || pack * qty;
    const { cm3: perShipper, source } = itemVolumeCm3(item);
    const grossPerShipper = safeNonNegative(item.grossWeightPerShipper);
    const netPerUnit = safeNonNegative(item.netWeightPerUnit);

    const cm3Total = perShipper * qty;
    cm3 += cm3Total;
    grossKg += grossPerShipper * qty;
    netKg += netPerUnit * pcs;
    if (source === 'dims') dimsCount++;
    else presetCount++;

    lines.push({
      id: item.id,
      name: String(item.name ?? ''),
      quantity: qty,
      cm3PerShipper: perShipper,
      cm3Total,
      cbmPerShipper: perShipper / CM3_PER_M3,
      cbmTotal: cm3Total / CM3_PER_M3,
      grossKg: grossPerShipper * qty,
      measuredFrom: source,
    });
  }

  return { lines, cm3, grossKg, netKg, dimsCount, presetCount };
};

/** One row of the derivation trail. `value` stays raw; `display` is presentational. */
const working = (label, expression, value, unit, dp = 2) => ({
  label,
  expression,
  value: trimFloat(value, 6),
  unit,
  display: `${fmtNum(value, dp)}${unit ? ` ${unit}` : ''}`,
});

/**
 * Compute every freight figure for a shipment, with the derivation attached.
 *
 * Country and carrier rules enter here and nowhere else. Both default to the
 * behaviour that predates them, so an untouched shipment produces byte-identical
 * numbers — a hard requirement, since users have quotes out based on them.
 *
 * @param {object} args
 * @param {Array<object>} [args.items] - Shipment lines; enables per-piece measurement.
 * @param {{cbm: number, grossWeight: number, netWeight: number}} [args.totals]
 *   Aggregate totals. Used for gross/net and for the volume the container plan
 *   runs against; volumetric weight always prefers the per-piece measurement.
 * @param {string} [args.mode] - Key into FREIGHT_MODES.
 * @param {string} [args.container] - Container selection key, 'custom' or 'none'.
 * @param {object} [args.customContainer] - `{ label, cbm, maxPayloadKg }`.
 * @param {string} [args.country] - Destination-country profile key. Drives the
 *   road-legal payload cap and the measurement-ton definition.
 * @param {string} [args.carrier] - Carrier/service profile key. Drives the
 *   volumetric divisor and rounding step — never the destination.
 * @param {object} [args.overrides] - Explicit user overrides, highest priority:
 *   `{ divisorCm3PerKg, roundingStepKg, payloadKg, roadMaxGvwKg, tractorKg,
 *      chassisKg, tareKg, measurementTonM3 }`. Blank fields fall through.
 * @returns {object} Freight result including `workings[]` and `containerPlan`.
 */
export const computeFreight = ({
  items = null,
  totals = null,
  mode = 'ocean_fcl',
  container = null,
  customContainer = null,
  country = DEFAULT_COUNTRY,
  carrier = DEFAULT_CARRIER,
  overrides = {},
} = {}) => {
  const modeKey = normalizeFreightMode(mode);
  const rule = VOLUMETRIC_RULES[modeKey];
  const modeMeta = FREIGHT_MODES[modeKey];

  /* Resolution order, applied here and reported in `workings[]` rather than taking
     effect silently: explicit override → carrier/service → mode default. */
  const tariff = resolveVolumetricRule({ mode: modeKey, carrier, overrides });
  const divisor = tariff.divisorCm3PerKg;
  const roundingStepKg = tariff.roundingStepKg;

  /* Has the user typed any override at all? Blanks do not count — an empty field
     means "inherit", which is why the override record stores `''` rather than 0. */
  const hasOverrides = Object.values(overrides || {}).some(
    (v) => v !== '' && v !== null && v !== undefined && Number.isFinite(Number(v))
  );

  const measured = measureShipment(items);
  const hasLines = measured.lines.length > 0;
  const notes = [];

  /* Volume. `totals.cbm` drives the container plan so the UI's "Total CBM" card
     and the fill bars can never disagree; the per-piece measurement drives the
     volumetric weight. They should match — both derive from the same dimensions —
     so a divergence means a stale `cbmPerShipper` and is worth saying out loud. */
  const measuredCbm = measured.cm3 / CM3_PER_M3;
  const cbm = totals ? safeNonNegative(totals.cbm) : measuredCbm;
  const volumetricCm3 = hasLines ? measured.cm3 : cbm * CM3_PER_M3;

  if (hasLines && cbm > 0 && Math.abs(measuredCbm - cbm) / cbm > 0.01) {
    notes.push(
      `Stored volume (${fmtNum(cbm, 3)} m³) and re-measured volume ` +
        `(${fmtNum(measuredCbm, 3)} m³) differ by more than 1% — check the item dimensions.`
    );
  }
  if (measured.presetCount > 0) {
    notes.push(
      `${measured.presetCount} item${measured.presetCount === 1 ? '' : 's'} ` +
        'use a pre-calculated CBM rather than measurable dimensions; a carrier ' +
        're-measuring on the ramp may arrive at a different figure.'
    );
  }

  const grossKg = totals ? safeNonNegative(totals.grossWeight) : measured.grossKg;
  const netKg = totals ? safeNonNegative(totals.netWeight) : measured.netKg;

  /* Measurement ton — a genuine national divergence (US 40 ft³, UK 42 ft³) that
     changes an LCL quote. Resolved here so the LCL branch reads one value. */
  const measurementTon = resolveMeasurementTon(country, overrides);

  const volumetricKg = divisor > 0 ? volumetricCm3 / divisor : 0;
  const kgPerM3 = divisor > 0 ? CM3_PER_M3 / divisor : 0;

  const workings = [];
  const volumeSource = hasLines ? 'per-piece' : 'aggregate';

  workings.push(
    working(
      'Total volume',
      hasLines
        ? `${measured.lines.length} line${measured.lines.length === 1 ? '' : 's'} measured per piece: Σ (L×W×H per shipper × qty)`
        : 'Aggregate shipment volume',
      cbm,
      'm³',
      4
    )
  );
  workings.push(working('Total gross weight', 'Σ (gross weight per shipper × qty)', grossKg, 'kg'));

  /* Where the divisor came from, stated before it is used on the next row. Omitted
     when nothing narrowed the mode default, so an untouched shipment's derivation
     is unchanged from before the profiles existed. */
  if (!tariff.isDefault && divisor > 0) {
    workings.push(
      working(
        'Volumetric divisor applied',
        tariff.divisorSource === 'override'
          ? 'Manually overridden — your contract rate, not a published tariff'
          : `${tariff.carrierLabel} tariff (${fmtNum(tariff.in3PerLb, 0)} in³/lb as published)`,
        divisor,
        'cm³/kg',
        0
      )
    );
  }
  if (tariff.divisorSource === 'carrier' || tariff.roundingSource === 'carrier') {
    const cite = CARRIER_CITATIONS[tariff.citation];
    if (cite?.confidence === 'U') notes.push(cite.label + '.');
  }
  /* Choosing a parcel carrier for a container load must not silently apply a parcel
     divisor, so say plainly that the selection did not apply. */
  if (carrier !== DEFAULT_CARRIER && !tariff.applies) {
    notes.push(
      `The ${tariff.carrierLabel} tariff does not cover ${modeMeta?.label ?? modeKey} ` +
        'shipments, so the mode default was used instead.'
    );
  }

  /* ── Chargeable weight, per mode ── */
  let chargeableKg;
  let chargeableBilled;
  let basis;
  let revenueTons = null;
  let revenueTonsBilled = null;

  if (modeKey === 'ocean_fcl') {
    chargeableKg = grossKg;
    chargeableBilled = grossKg;
    basis = 'gross';
    workings.push(
      working(
        'Chargeable weight',
        'FCL is billed per container, so gross weight is the only basis',
        chargeableKg,
        'kg'
      )
    );
  } else if (modeKey === 'ocean_lcl') {
    const tonnes = grossKg / 1000;
    const tonM3 = measurementTon.value;
    const volumeTons = tonM3 > 0 ? cbm / tonM3 : 0;
    revenueTons = Math.max(volumeTons, tonnes);
    revenueTonsBilled = roundUpTo(revenueTons, RT_ROUNDING_STEP);
    basis = volumeTons >= tonnes ? 'volumetric' : 'gross';
    chargeableKg = revenueTons * 1000;
    chargeableBilled = revenueTonsBilled * 1000;

    workings.push(working('Weight in tonnes', `${fmtNum(grossKg)} kg ÷ 1,000`, tonnes, 't', 3));
    /* Only stated when it is not the international 1 m³, so an untouched LCL
       shipment's derivation reads exactly as it did before the country profiles. */
    if (measurementTon.source !== 'default') {
      workings.push(
        working(
          'Measurement ton',
          `${measurementTon.label} — volume tons = ${fmtNum(cbm, 3)} m³ ÷ ${tonM3}`,
          tonM3,
          'm³/ton',
          3
        )
      );
    }
    workings.push(
      working(
        'Revenue tons (W/M)',
        `max(${fmtNum(volumeTons, 3)} measurement tons, ${fmtNum(tonnes, 3)} t) — ${
          basis === 'volumetric' ? 'volume governs' : 'weight governs'
        }`,
        revenueTons,
        'RT',
        3
      ),
      working(
        'Billed revenue tons',
        `round ${fmtNum(revenueTons, 3)} up to the next ${RT_ROUNDING_STEP} RT`,
        revenueTonsBilled,
        'RT'
      )
    );
    notes.push(
      'The 1 CBM = 1,000 kg equivalence is standard practice but is not confirmed ' +
        'by a primary source in this build — verify against the carrier tariff.'
    );
  } else {
    chargeableKg = Math.max(grossKg, volumetricKg);
    chargeableBilled = roundUpTo(chargeableKg, roundingStepKg);
    basis = volumetricKg > grossKg ? 'volumetric' : 'gross';

    workings.push(
      working(
        'Measured volume',
        `${volumeSource === 'per-piece' ? 'Σ per-piece volume' : 'Aggregate volume'} in cm³`,
        volumetricCm3,
        'cm³',
        0
      ),
      working(
        'Volumetric weight',
        `${fmtNum(volumetricCm3, 0)} cm³ ÷ ${fmtNum(divisor, 0)} cm³/kg (= ${fmtNum(kgPerM3, 2)} kg/m³)`,
        volumetricKg,
        'kg'
      ),
      working(
        'Chargeable weight',
        `max(gross ${fmtNum(grossKg)} kg, volumetric ${fmtNum(volumetricKg)} kg) — ${
          basis === 'volumetric' ? 'volume governs' : 'weight governs'
        }`,
        chargeableKg,
        'kg'
      ),
      working(
        'Billed chargeable weight',
        `round ${fmtNum(chargeableKg)} up to the next ${roundingStepKg} kg`,
        chargeableBilled,
        'kg'
      )
    );

    if (modeKey === 'air') {
      notes.push(
        'The 0.5 kg round-up follows IATA/TACT practice, which is published only ' +
          'in the paid TACT Rules — verify against your airline’s tariff.'
      );
    }
    notes.push(
      'Carriers measure to the longest dimension on each axis, so non-cuboid items ' +
        'bill above their true volume.'
    );
  }

  /* ── Container plan ──
     The destination country enters here. An ISO payload rating assumes the loaded
     box can be moved at that weight; national road law often does not allow it. The
     road cap is resolved first, handed to the planner as a third constraint, and
     reported alongside the ISO figure — never quietly substituted for it. */
  const resolved = resolveContainer(container, customContainer);
  const payloadCap = resolvePayloadCap({ container: resolved, country, overrides });
  const containerPlan = planContainers({ cbm, grossWeight: grossKg }, resolved, {
    roadPayloadCapKg: payloadCap.source === 'road' ? payloadCap.capKg : null,
    payloadCapOverrideKg: payloadCap.source === 'override' ? payloadCap.capKg : null,
  });

  if (containerPlan.applicable) {
    const c = containerPlan.container;
    if (c.cbm > 0) {
      workings.push(
        working(
          'Containers by volume',
          `ceil(${fmtNum(cbm, 3)} m³ ÷ ${fmtNum(c.cbm, 2)} m³ usable)`,
          containerPlan.byVolume,
          '',
          0
        )
      );
    }
    if (c.maxPayloadKg > 0) {
      workings.push(
        working(
          'Containers by payload',
          `ceil(${fmtNum(grossKg)} kg ÷ ${fmtNum(c.maxPayloadKg, 0)} kg payload)`,
          containerPlan.byWeight,
          '',
          0
        )
      );
    }

    /* The headline result of the country profiles, printed as arithmetic: exactly
       where the cap comes from and what it costs against the ISO rating. */
    if (containerPlan.payloadCapSource === 'road') {
      workings.push(
        working(
          'Road-legal payload',
          `${payloadCap.resolved.countryLabel}: ${payloadCap.road.expression}`,
          containerPlan.payloadCapKg,
          'kg'
        ),
        working(
          'Payload lost to road law',
          `ISO rating ${fmtNum(containerPlan.isoPayloadKg, 0)} kg − road cap ` +
            `${fmtNum(containerPlan.payloadCapKg, 0)} kg`,
          containerPlan.payloadDerateKg,
          'kg'
        ),
        working(
          'Containers by road limit',
          `ceil(${fmtNum(grossKg)} kg ÷ ${fmtNum(containerPlan.payloadCapKg, 0)} kg road-legal)`,
          containerPlan.byRoad,
          '',
          0
        )
      );
    } else if (payloadCap.source === 'override') {
      workings.push(
        working(
          'Payload cap (manual)',
          'Overridden by you — the container rating and any road limit are ignored',
          payloadCap.capKg,
          'kg'
        )
      );
    }

    workings.push(
      working(
        'Containers required',
        `${c.label} — limited by ${containerPlan.limitedBy}`,
        containerPlan.count,
        '',
        0
      )
    );

    if (c.isCustom) {
      notes.push('Container capacity is a user-entered custom figure, not an ISO rating.');
    } else if (containerPlan.payloadCapSource === 'override') {
      notes.push(
        `Payload is capped at your manual figure of ${fmtNum(containerPlan.payloadCapKg, 0)} kg. ` +
          `The ${fmtNum(containerPlan.isoPayloadKg, 0)} kg ISO rating` +
          (payloadCap.roadKg !== null
            ? ` and the ${fmtNum(payloadCap.roadKg, 0)} kg ${payloadCap.resolved.countryLabel} road limit are`
            : ' is') +
          ' being ignored.'
      );
    } else if (containerPlan.payloadCapSource === 'road') {
      /* Stated as a governing-limit sentence because this is the one number a user
         is most likely to have planned around and got wrong. */
      notes.push(
        `Payload capped at ${fmtNum(containerPlan.payloadCapKg, 0)} kg by ` +
          `${payloadCap.resolved.countryLabel} road law, not the ` +
          `${fmtNum(containerPlan.isoPayloadKg, 0)} kg ISO rating for a ${c.label} — ` +
          `${fmtNum(containerPlan.payloadDerateKg, 0)} kg less cargo per container.`
      );
      if (payloadCap.road.estimated) notes.push(CITATIONS.tractor_estimate.label + '.');
      if (payloadCap.resolved.via === 'family') {
        notes.push(
          `${payloadCap.resolved.mappedFrom} was not researched directly — it is mapped ` +
            `to the ${payloadCap.resolved.profile.label} rule family. Check it against ` +
            'local law and override the GVW if it differs.'
        );
      }
      if (payloadCap.resolved.profile.bridgeFormula) {
        notes.push(
          'A bridge formula also applies on this lane: a short-wheelbase combination ' +
            'can be capped below the gross limit by axle spacing.'
        );
      }
    } else {
      notes.push(
        `${c.label} payload is the ISO rating (tare ${fmtNum(c.tareKg ?? 0, 0)} kg, ` +
          `max gross ${fmtNum(c.maxGrossKg ?? 0, 0)} kg). Road-legal limits in the ` +
          'destination country may cap it lower.'
      );
      /* Saying "the ISO rating binds here" is as useful as the derating warning —
         it tells the user their country selection was applied and did nothing. */
      if (containerPlan.roadPayloadCapKg === null && payloadCap.roadKg !== null) {
        notes.push(
          `${payloadCap.resolved.countryLabel} road law would allow ` +
            `${fmtNum(payloadCap.roadKg, 0)} kg, so the container rating governs.`
        );
      }
      /* A country we know we cannot rate. Distinguished from "no country selected"
         so the silence is visible as a gap rather than read as a clean bill. */
      if (payloadCap.resolved.via === 'unresearched') {
        notes.push(
          `No road-weight limit is on file for ${payloadCap.resolved.mappedFrom}, so no ` +
            'derating was applied and the ISO rating is being reported as achievable. ' +
            'Enter the local GVW as an override to check it properly.'
        );
      }
    }
  }

  return {
    mode: modeKey,
    modeLabel: modeMeta?.label ?? modeKey,
    modeDesc: modeMeta?.desc ?? '',

    cbm,
    measuredCbm,
    volumetricCm3,
    volumeSource,
    netKg,
    grossKg,

    volumetricKg,
    volumetricDivisor: divisor,
    volumetricKgPerM3: kgPerM3,

    chargeableKg,
    chargeableBilled,
    roundingStepKg,
    basis,
    basisLabel: rule.basis,
    billingUnit: rule.unit,

    revenueTons,
    revenueTonsBilled,
    measurementTonM3: measurementTon.value,
    measurementTon,

    /* Rule resolution, exposed so `ShipmentRulesPanel` can show which rule fired
       and the exports can cite it. Deliberately the whole resolution object rather
       than a flattened summary — "why" is the feature. */
    tariff,
    payloadCap,
    countryKey: payloadCap.resolved.key,
    countryLabel: payloadCap.resolved.countryLabel,
    countryProfile: payloadCap.resolved.profile,
    carrierKey: tariff.carrierKey,
    carrierLabel: tariff.carrierLabel,
    /* True only when the user has touched neither selector nor any override.
       Deliberately NOT "the numbers came out the same": selecting a destination
       whose road limit happens not to bind is still a decision the document should
       record, and a note is emitted saying the check was made. */
    rulesAreDefault:
      payloadCap.resolved.key === DEFAULT_COUNTRY &&
      tariff.carrierKey === DEFAULT_CARRIER &&
      !hasOverrides,

    container: resolved,
    containerPlan,
    lines: measured.lines,
    workings,
    notes,
  };
};

/**
 * The single number to print on a document, in the mode's billing unit.
 * LCL quotes revenue tons; everything else quotes kilograms.
 *
 * @param {object} freight - Result of `computeFreight`.
 * @returns {{value: number, unit: string, display: string}}
 */
export const billedFigure = (freight) => {
  if (!freight) return { value: 0, unit: 'kg', display: '0.00 kg' };
  if (freight.billingUnit === 'RT') {
    const v = safeNonNegative(freight.revenueTonsBilled);
    return { value: v, unit: 'RT', display: `${fmtNum(v, 2)} RT` };
  }
  const v = safeNonNegative(freight.chargeableBilled);
  return { value: v, unit: 'kg', display: `${fmtNum(v, 2)} kg` };
};
