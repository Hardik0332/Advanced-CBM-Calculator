/**
 * Export row building — the single source of truth for every exported number.
 *
 * Why this module exists: Excel and CSV used to build their own rows, and the CSV
 * quietly omitted the freight block entirely despite a comment claiming parity.
 * The PDF built a third variant. Three renderings of the same shipment could and
 * did disagree.
 *
 * The fix is structural rather than disciplinary. There is exactly one canonical
 * record per shipment line (`buildItemRecords`), and every document is a
 * **projection** of those records through a column set (`projectRows`). A number
 * cannot differ between the packing list and the invoice because neither computes
 * it — both read the same field off the same record.
 *
 * Precision policy, unchanged from the original exporter: spreadsheets carry RAW
 * numerics so the user can re-total them, and rounding stays a display concern
 * owned by the PDF layer. `null` is used for "no value" rather than 0 or '', so a
 * blank HS Code does not become a zero in a numeric column.
 */
import { toCm, fmtCBM } from '../calculations';
import { billedFigure } from '../freight';
import { safeNum, safeNonNegative, clampInt, trimFloat } from '../numbers';

/** Round only to kill float noise, never to lose precision. */
const raw = (v) => trimFloat(v, 9);

/** cm³ in one cubic metre. */
const CM3_PER_M3 = 1_000_000;

/** A trimmed string, or null when there is nothing to show. */
const str = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
};

/** A non-negative number, or null when the field was never filled in. */
const num = (v) => {
  const n = safeNum(v, NaN);
  return Number.isFinite(n) ? raw(Math.abs(n)) : null;
};

const itemTotalPcs = (item) =>
  clampInt(item?.totalPcs, 0) || clampInt(item?.packSize, 1) * clampInt(item?.quantity, 1);

/* ══════════════════════════════════════════════════════════
   Canonical records
   ══════════════════════════════════════════════════════════ */

/**
 * Build one canonical record per shipment line.
 *
 * Every derived quantity is computed here, once. Documents select and format; they
 * never recompute — that is the whole point.
 *
 * @param {Array<object>} shipment
 * @param {object} [freight] - A `computeFreight` result. Supplies per-line
 *   volumetric weight; omit it and those fields are null rather than wrong.
 * @returns {Array<object>}
 */
export const buildItemRecords = (shipment, freight = null) => {
  // Per-line measurement, keyed by id so a reordered shipment still joins.
  const lines = new Map();
  for (const line of freight?.lines || []) {
    if (line?.id != null) lines.set(line.id, line);
  }
  const divisor = safeNonNegative(freight?.volumetricDivisor);

  return (shipment || [])
    .filter((item) => item && typeof item === 'object')
    .map((item, i) => {
      const unit = str(item.unit) || 'cm';
      const quantity = clampInt(item.quantity, 1);
      const packSize = clampInt(item.packSize, 1);
      const totalPcs = itemTotalPcs(item);

      const length = safeNonNegative(item.length);
      const width = safeNonNegative(item.width);
      const height = safeNonNegative(item.height);

      const netPerUnit = safeNonNegative(item.netWeightPerUnit);
      const grossPerShipper = safeNonNegative(item.grossWeightPerShipper);
      const cbmPerShipper = safeNonNegative(item.cbmPerShipper);

      const line = lines.get(item.id);
      const cm3PerShipper = line ? line.cm3PerShipper : length && width && height
        ? toCm(length, unit) * toCm(width, unit) * toCm(height, unit)
        : cbmPerShipper * CM3_PER_M3;

      const unitPrice = num(item.unitPrice);

      return {
        idx: i + 1,
        id: item.id ?? null,

        /* Identity & trade fields. All optional — a shipment built by hand has
           none of them, and a document must not print "null" or "0" for a
           missing HS Code. */
        name: String(item.name ?? ''),
        description: str(item.description),
        sku: str(item.sku),
        marks: str(item.marks),
        hsCode: str(item.hsCode),
        origin: str(item.origin),
        notes: str(item.notes),

        /* Dimensions in the unit the user entered, and in cm. Both are carried
           because a packing list quotes the original while a customs or carrier
           document wants a single consistent unit. */
        unit,
        length: raw(length),
        width: raw(width),
        height: raw(height),
        lengthCm: raw(toCm(length, unit)),
        widthCm: raw(toCm(width, unit)),
        heightCm: raw(toCm(height, unit)),
        dimsLabel: length && width && height ? `${length}×${width}×${height} ${unit}` : null,

        packSize,
        packingString: str(item.packingString),
        quantity,
        totalPcs,
        /* A last carton that is not full. Worth flagging: it is the usual reason a
           piece count does not reconcile with cartons × pack size, and a customs
           officer will ask. */
        partialBox: totalPcs !== packSize * quantity,
        derivedPcs: packSize * quantity,

        netPerUnit: raw(netPerUnit),
        grossPerShipper: raw(grossPerShipper),
        netPerShipper: raw(netPerUnit * packSize),
        netTotal: raw(netPerUnit * totalPcs),
        grossTotal: raw(grossPerShipper * quantity),
        /* Tare implied by the difference. Negative means gross < net, which is
           impossible and is surfaced by the import warn tier. */
        tarePerShipper: raw(Math.max(0, grossPerShipper - netPerUnit * packSize)),

        cbmPerShipper: raw(cbmPerShipper),
        cbmTotal: raw(cbmPerShipper * quantity),
        cm3PerShipper: raw(cm3PerShipper),
        volumetricKg: divisor > 0 ? raw((cm3PerShipper * quantity) / divisor) : null,
        measuredFrom: line?.measuredFrom ?? null,

        unitPrice,
        currency: str(item.currency),
        amount: unitPrice === null ? null : raw(unitPrice * totalPcs),
      };
    });
};

/**
 * The TOTALS record. Same shape as an item record so a totals row can be appended
 * to any projection without the column set knowing about it.
 *
 * Fields that make no sense to sum (a dimension, a pack size, an HS code) are
 * null, not 0 — an averaged dimension in a totals row is meaningless and a zero
 * there reads as real data.
 *
 * @param {Array<object>} records - Output of `buildItemRecords`.
 * @param {object} [totals] - The app's totals object; used when supplied so the
 *   exported total matches the on-screen card exactly.
 * @returns {object}
 */
export const buildTotalsRecord = (records, totals = null) => {
  const sum = (key) => (records || []).reduce((a, r) => a + safeNum(r[key], 0), 0);
  const anyPriced = (records || []).some((r) => r.unitPrice !== null);

  return {
    idx: null,
    id: null,
    isTotals: true,
    name: 'TOTALS',
    description: null,
    sku: null,
    marks: null,
    hsCode: null,
    origin: null,
    notes: null,
    unit: null,
    length: null,
    width: null,
    height: null,
    lengthCm: null,
    widthCm: null,
    heightCm: null,
    dimsLabel: null,
    packSize: null,
    packingString: null,
    quantity: totals ? clampInt(totals.shippers, 0) : sum('quantity'),
    totalPcs: totals ? clampInt(totals.totalPcs, 0) : sum('totalPcs'),
    partialBox: false,
    derivedPcs: null,
    netPerUnit: null,
    grossPerShipper: null,
    netPerShipper: null,
    netTotal: totals ? raw(safeNonNegative(totals.netWeight)) : raw(sum('netTotal')),
    grossTotal: totals ? raw(safeNonNegative(totals.grossWeight)) : raw(sum('grossTotal')),
    tarePerShipper: null,
    cbmPerShipper: null,
    cbmTotal: totals ? raw(safeNonNegative(totals.cbm)) : raw(sum('cbmTotal')),
    cm3PerShipper: null,
    volumetricKg: raw(sum('volumetricKg')) || null,
    measuredFrom: null,
    unitPrice: null,
    currency: null,
    amount: anyPriced ? raw(sum('amount')) : null,
  };
};

/* ══════════════════════════════════════════════════════════
   Column sets
   ══════════════════════════════════════════════════════════ */

/**
 * A column: `key` into the record, `label` as the header, plus presentation hints
 * every exporter can use or ignore.
 *
 * width  — approximate characters, for Excel `!cols` and PDF column sizing.
 * z      — Excel number format. Absent for text columns.
 * align  — PDF cell alignment.
 * trade  — true when the column only carries a trade field, so it can be dropped
 *          from a shipment that has none rather than printing a column of blanks.
 */
const col = (key, label, opts = {}) => ({ key, label, width: 12, ...opts });

/** Packing-list columns — the classic document layout. */
export const PACKING_LIST_COLUMNS = [
  col('idx', '#', { width: 4, z: '0', align: 'center' }),
  col('marks', 'Marks & Nos', { width: 14, trade: true }),
  col('name', 'Description', { width: 30 }),
  col('hsCode', 'HS Code', { width: 12, trade: true }),
  col('packingString', 'Packing', { width: 14 }),
  col('packSize', 'Pack', { width: 7, z: '#,##0', align: 'right' }),
  col('quantity', 'Cartons', { width: 9, z: '#,##0', align: 'right' }),
  col('totalPcs', 'Total Pcs', { width: 10, z: '#,##0', align: 'right' }),
  col('dimsLabel', 'Dimensions', { width: 20 }),
  col('cbmPerShipper', 'CBM/Ctn', { width: 10, z: '0.0000', align: 'right' }),
  col('cbmTotal', 'Total CBM', { width: 11, z: '0.0000', align: 'right' }),
  col('netTotal', 'Net kg', { width: 11, z: '#,##0.00', align: 'right' }),
  col('grossTotal', 'Gross kg', { width: 11, z: '#,##0.00', align: 'right' }),
];

/** Item-breakdown columns — every derived figure, for checking the arithmetic. */
export const ITEM_BREAKDOWN_COLUMNS = [
  col('idx', '#', { width: 4, z: '0' }),
  col('name', 'Item Name', { width: 30 }),
  col('sku', 'SKU', { width: 14, trade: true }),
  col('unit', 'Entered Unit', { width: 11 }),
  col('length', 'L', { width: 9, z: '0.####' }),
  col('width', 'W', { width: 9, z: '0.####' }),
  col('height', 'H', { width: 9, z: '0.####' }),
  col('lengthCm', 'L (cm)', { width: 9, z: '0.####' }),
  col('widthCm', 'W (cm)', { width: 9, z: '0.####' }),
  col('heightCm', 'H (cm)', { width: 9, z: '0.####' }),
  col('packSize', 'Pack Size', { width: 10, z: '#,##0' }),
  col('quantity', 'Qty (Shippers)', { width: 13, z: '#,##0' }),
  col('totalPcs', 'Total Pcs', { width: 10, z: '#,##0' }),
  col('derivedPcs', 'Pack × Qty', { width: 11, z: '#,##0' }),
  col('partialBox', 'Partial Box?', { width: 11 }),
  col('cbmPerShipper', 'CBM/Shipper', { width: 12, z: '0.000000' }),
  col('cbmTotal', 'Total CBM', { width: 11, z: '0.000000' }),
  col('cm3PerShipper', 'cm³/Shipper', { width: 13, z: '#,##0' }),
  col('volumetricKg', 'Volumetric kg', { width: 13, z: '#,##0.00' }),
  col('netPerUnit', 'Net kg/pc', { width: 11, z: '#,##0.000' }),
  col('netPerShipper', 'Net kg/shipper', { width: 14, z: '#,##0.000' }),
  col('grossPerShipper', 'Gross kg/shipper', { width: 15, z: '#,##0.000' }),
  col('tarePerShipper', 'Tare kg/shipper', { width: 14, z: '#,##0.000' }),
  col('netTotal', 'Total Net kg', { width: 12, z: '#,##0.00' }),
  col('grossTotal', 'Total Gross kg', { width: 13, z: '#,##0.00' }),
  col('measuredFrom', 'Measured From', { width: 13 }),
];

/** Commercial-invoice columns. */
export const INVOICE_COLUMNS = [
  col('idx', '#', { width: 4, z: '0', align: 'center' }),
  col('name', 'Description of Goods', { width: 34 }),
  col('hsCode', 'HS Code', { width: 12, trade: true }),
  col('origin', 'Origin', { width: 12, trade: true }),
  col('totalPcs', 'Quantity', { width: 10, z: '#,##0', align: 'right' }),
  col('unitPrice', 'Unit Price', { width: 12, z: '#,##0.00', align: 'right' }),
  col('amount', 'Amount', { width: 14, z: '#,##0.00', align: 'right' }),
];

/**
 * Drop `trade: true` columns that no record fills in.
 *
 * A packing list for a hand-entered shipment should not carry four empty columns
 * for Marks, HS Code, SKU and Origin — it makes the document look unfinished and
 * wastes the width that Description needs.
 *
 * @param {Array<object>} columns
 * @param {Array<object>} records
 * @returns {Array<object>}
 */
export const pruneEmptyColumns = (columns, records) =>
  columns.filter((c) => {
    if (!c.trade) return true;
    return (records || []).some((r) => r[c.key] !== null && r[c.key] !== undefined && r[c.key] !== '');
  });

/**
 * Project records through a column set into `{ header: value }` objects, ready for
 * `XLSX.utils.json_to_sheet` or Papa.unparse.
 *
 * Booleans become Yes/blank and nulls become '' here, at the boundary — the
 * records themselves stay typed.
 *
 * @param {Array<object>} records
 * @param {Array<object>} columns
 * @returns {Array<object>}
 */
export const projectRows = (records, columns) =>
  (records || []).map((r) => {
    const out = {};
    for (const c of columns) {
      const v = r[c.key];
      if (typeof v === 'boolean') out[c.label] = v ? 'Yes' : '';
      else out[c.label] = v ?? '';
    }
    return out;
  });

/** Project into arrays-of-arrays (header row first) — what CSV and PDF want. */
export const projectAoa = (records, columns) => [
  columns.map((c) => c.label),
  ...(records || []).map((r) =>
    columns.map((c) => {
      const v = r[c.key];
      if (typeof v === 'boolean') return v ? 'Yes' : '';
      return v ?? '';
    })
  ),
];

/* ══════════════════════════════════════════════════════════
   Summary blocks
   ══════════════════════════════════════════════════════════ */

/**
 * Freight / container summary as label-value pairs.
 *
 * Reads a `computeFreight` result rather than recomputing, so an exported
 * chargeable weight can never drift from the one on screen.
 *
 * @param {object} freight - A `computeFreight` result.
 * @returns {Array<[string, string|number]>}
 */
export const buildFreightPairs = (freight) => {
  if (!freight) return [];
  const billed = billedFigure(freight);

  const pairs = [
    ['Freight Mode', freight.modeLabel],
    ['Chargeable Basis', freight.basis === 'volumetric' ? 'Volumetric / volume' : 'Gross weight'],
    ['Volumetric Divisor (cm³/kg)', freight.volumetricDivisor],
    ['Volumetric Wt (kg)', raw(freight.volumetricKg)],
    ['Chargeable Wt (kg)', raw(freight.chargeableKg)],
    ['Billed Chargeable Wt (kg)', raw(freight.chargeableBilled)],
    ['Rounding Step (kg)', freight.roundingStepKg],
    ['Billed Figure', billed.display],
  ];

  /* Rule provenance travels with the numbers: a document quoting a 4,000 divisor
     without saying it came from a DHL-UAE tariff is not auditable. */
  pairs.push(
    ['Destination Rules', freight.countryLabel],
    ['Carrier Rules', freight.carrierLabel],
    ['Divisor Source', freight.tariff?.divisorSource ?? 'mode']
  );

  if (freight.revenueTons !== null && freight.revenueTons !== undefined) {
    pairs.push(
      ['Measurement Ton (m³/RT)', raw(freight.measurementTonM3)],
      ['Revenue Tons (RT)', raw(freight.revenueTons)],
      ['Billed Revenue Tons (RT)', raw(freight.revenueTonsBilled)]
    );
  }

  const plan = freight.containerPlan;
  if (plan?.applicable) {
    pairs.push(
      ['Container', plan.container.label],
      ['Volume Utilisation (%)', raw(plan.volumeFillPct)],
      ['Payload Utilisation (%)', raw(plan.payloadFillPct)],
      ['Containers Required', plan.count],
      ['Limited By', plan.limitedBy],
      ['Remaining Volume (m³)', raw(plan.remainingCbm)],
      ['Remaining Payload (kg)', raw(plan.remainingPayloadKg)],
      ['Payload Cap (kg)', raw(plan.payloadCapKg)],
      ['Payload Cap Source', plan.payloadCapSource]
    );
    /* Both figures, never just the smaller one — the reader needs to see that the
       ISO rating was considered and overruled, and by how much. */
    if (plan.payloadCapSource === 'road') {
      pairs.push(
        ['ISO Payload Rating (kg)', raw(plan.isoPayloadKg)],
        ['Payload Lost to Road Law (kg)', raw(plan.payloadDerateKg)]
      );
    }
  } else {
    pairs.push(['Container', 'None (LCL / loose cargo)']);
  }

  return pairs;
};

/**
 * Shipment totals as label-value pairs.
 *
 * @param {object} totals
 * @returns {Array<[string, string|number]>}
 */
export const buildTotalsPairs = (totals) => [
  ['Total CBM', raw(safeNonNegative(totals?.cbm))],
  ['Net Weight (kg)', raw(safeNonNegative(totals?.netWeight))],
  ['Gross Weight (kg)', raw(safeNonNegative(totals?.grossWeight))],
  ['Shippers / Cartons', clampInt(totals?.shippers, 0)],
  ['Total Pieces', clampInt(totals?.totalPcs, 0)],
];

/**
 * The trade metadata block — parties, ports, terms.
 *
 * Only pairs the user actually filled in are returned. A packing list with eight
 * empty "Port of Discharge:" labels looks broken; one with three filled rows looks
 * deliberate.
 *
 * @param {object} meta - Shipment trade metadata.
 * @param {object} [company] - Company profile, for defaults.
 * @returns {Array<[string, string]>}
 */
export const buildTradePairs = (meta, company = null) => {
  const rows = [
    ['PO / Reference', str(meta?.poNumber)],
    ['Invoice No.', str(meta?.invoiceNo)],
    ['Invoice Date', str(meta?.invoiceDate)],
    ['Incoterm', str(meta?.incoterm) || str(company?.defaultIncoterm)],
    ['Port of Loading', str(meta?.portOfLoading)],
    ['Port of Discharge', str(meta?.portOfDischarge)],
    ['Vessel / Flight', str(meta?.vesselFlight)],
    ['Marks & Numbers', str(meta?.marksNumbers)],
    ['Currency', str(meta?.currency) || str(company?.defaultCurrency)],
  ];
  return rows.filter(([, v]) => v !== null);
};

/**
 * The `workings[]` derivation as rows.
 *
 * Every billed number accompanied by the expression that produced it, so a
 * customer or auditor can re-derive it without access to the app.
 *
 * @param {object} freight
 * @returns {Array<Array<string|number>>} Header row followed by one row per step.
 */
export const buildWorkingsAoa = (freight) => {
  const rows = [['Step', 'How it is derived', 'Value', 'Unit']];
  for (const w of freight?.workings || []) {
    rows.push([w.label, w.expression, raw(w.value), w.unit]);
  }
  for (const note of freight?.notes || []) {
    rows.push(['Note', note, '', '']);
  }
  return rows;
};

/**
 * The container plan as rows: one line per container in the plan, plus the
 * constraint arithmetic that produced the count.
 *
 * @param {object} freight
 * @returns {Array<Array<string|number>>}
 */
export const buildContainerPlanAoa = (freight) => {
  const plan = freight?.containerPlan;
  if (!plan?.applicable) {
    return [
      ['Container Plan'],
      ['No container selected — cargo is loose / LCL groupage.'],
    ];
  }

  const c = plan.container;
  const rows = [
    ['Container', c.label],
    ['Usable Volume per Container (m³)', raw(c.cbm)],
    ['Payload Cap per Container (kg)', raw(plan.payloadCapKg)],
    ['Payload Cap Source', plan.payloadCapSource],
  ];
  if (plan.payloadCapSource === 'road') {
    rows.push(
      ['ISO Payload Rating (kg)', raw(plan.isoPayloadKg)],
      ['Payload Lost to Road Law (kg)', raw(plan.payloadDerateKg)]
    );
  }
  rows.push(
    ['Containers by Volume', plan.byVolume],
    ['Containers by Payload Rating', plan.byWeight],
    ['Containers by Road Limit', plan.byRoad],
    ['Containers Required', plan.count],
    ['Limited By', plan.limitedBy],
    [],
    ['#', 'Volume (m³)', 'Gross (kg)', 'Volume Fill (%)', 'Payload Fill (%)']
  );

  /* An even split across the plan. Real stowage is never exactly even, but it is
     the only defensible per-container figure without a packing algorithm, and it
     is what the utilisation bars already show. */
  for (let i = 0; i < plan.count; i++) {
    rows.push([
      i + 1,
      raw(plan.perContainerCbm),
      raw(plan.perContainerKg),
      raw(c.cbm > 0 ? (plan.perContainerCbm / c.cbm) * 100 : 0),
      raw(plan.payloadCapKg > 0 ? (plan.perContainerKg / plan.payloadCapKg) * 100 : 0),
    ]);
  }

  rows.push(
    [],
    ['Remaining Volume across plan (m³)', raw(plan.remainingCbm)],
    ['Remaining Payload across plan (kg)', raw(plan.remainingPayloadKg)]
  );
  if (plan.overCbm > 0) rows.push(['OVER VOLUME by (m³)', raw(plan.overCbm)]);
  if (plan.overPayloadKg > 0) rows.push(['OVER PAYLOAD by (kg)', raw(plan.overPayloadKg)]);

  return rows;
};

/**
 * Invoice money lines: subtotal, freight, insurance, total.
 *
 * @param {Array<object>} records
 * @param {object} [meta] - Supplies `freightCharge` / `insuranceCharge`.
 * @returns {{lines: Array<[string, number|null]>, subtotal: number, total: number,
 *            hasPrices: boolean, currency: string}}
 */
export const buildInvoiceTotals = (records, meta = null) => {
  const priced = (records || []).filter((r) => r.amount !== null);
  const subtotal = priced.reduce((a, r) => a + safeNum(r.amount, 0), 0);
  const freightCharge = num(meta?.freightCharge);
  const insuranceCharge = num(meta?.insuranceCharge);
  const total = subtotal + safeNum(freightCharge, 0) + safeNum(insuranceCharge, 0);

  const lines = [['Subtotal', raw(subtotal)]];
  if (freightCharge !== null) lines.push(['Freight', freightCharge]);
  if (insuranceCharge !== null) lines.push(['Insurance', insuranceCharge]);
  lines.push(['Total', raw(total)]);

  return {
    lines,
    subtotal: raw(subtotal),
    total: raw(total),
    hasPrices: priced.length > 0,
    currency: str(meta?.currency) || 'USD',
  };
};

/**
 * Resolve a party reference against the company profile's parties book.
 *
 * Accepts an id, a full party object, or nothing. The object form matters: a
 * shipment can carry a one-off consignee that was never saved to the book, and
 * requiring a saved party would force users to pollute their address book with
 * every one-time buyer.
 *
 * @param {string|object|null} ref
 * @param {object} [company]
 * @returns {object|null}
 */
export const resolveParty = (ref, company = null) => {
  if (!ref) return null;
  if (typeof ref === 'object') {
    // A one-off party typed straight onto the shipment.
    return ref.name || ref.address ? ref : null;
  }
  const found = (company?.parties || []).find((p) => p?.id === ref);
  return found || null;
};

/**
 * Everything a document needs, assembled once.
 *
 * Each exporter calls this and then formats — no exporter assembles its own view
 * of the shipment, which is what keeps the three in agreement.
 *
 * @param {object} args
 * @param {Array<object>} args.shipment
 * @param {object} args.totals
 * @param {object} args.freight - A `computeFreight` result.
 * @param {object} [args.meta] - Shipment trade metadata.
 * @param {object} [args.company] - Company profile.
 * @param {Array<object>} [args.products] - Directory, for the optional sheet.
 * @returns {object}
 */
export const buildExportContext = ({
  shipment = [],
  totals = null,
  freight = null,
  meta = null,
  company = null,
  products = null,
} = {}) => {
  const records = buildItemRecords(shipment, freight);
  const totalsRecord = buildTotalsRecord(records, totals);
  const m = meta || {};

  return {
    records,
    totalsRecord,
    rows: [...records, totalsRecord],
    totals,
    freight,
    meta: m,
    company: company || null,
    products: products || [],

    /* Parties, resolved once. The shipper falls back to the company profile,
       because on almost every shipment the two are the same and making the user
       enter their own details twice is a needless step. */
    shipper: resolveParty(m.shipperId ?? m.shipper, company) || company || null,
    consignee: resolveParty(m.consigneeId ?? m.consignee, company),
    notify: resolveParty(m.notifyId ?? m.notify, company),

    billed: billedFigure(freight),
    freightPairs: buildFreightPairs(freight),
    totalsPairs: buildTotalsPairs(totals),
    tradePairs: buildTradePairs(m, company),
    workingsAoa: buildWorkingsAoa(freight),
    containerPlanAoa: buildContainerPlanAoa(freight),
    invoiceTotals: buildInvoiceTotals(records, m),
    /* Convenience flags so a document can decide what to render without poking
       at every record itself. */
    hasPrices: records.some((r) => r.amount !== null),
    hasTradeFields: records.some((r) => r.hsCode || r.marks || r.origin || r.sku),
    cbmLabel: fmtCBM(safeNonNegative(totals?.cbm)),
  };
};
