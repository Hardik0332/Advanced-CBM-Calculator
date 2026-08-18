# CBM Calculator — v2 Hardening, Export Overhaul & Email

> Working plan. Phases are independently shippable — add items under any phase before we start coding.

## Context

The app (React 19 + Vite 8, 100% client-side, Firebase Hosting) works well for clean data
entered by hand, but three things limit it in real use:

1. **It assumes well-formed data.** Import silently coerces unparseable cells to `0`
   (`sanitizeNumeric` in [fileParser.js:46](../src/utils/fileParser.js#L46)), auto-maps headers on a
   first-substring-wins basis so column *order* decides the mapping
   ([fileParser.js:240](../src/utils/fileParser.js#L240)), and there is no schema validation on
   `localStorage` load — a legacy or hand-edited record with a missing `netWeightPerUnit` crashes
   the PDF export at [exporting.js:181](../src/utils/exporting.js#L181) and the item row at
   [ActiveShipment.jsx:252](../src/components/shipment/ActiveShipment.jsx#L252). No ErrorBoundary
   exists, so any such crash is a white screen with no recovery path.
2. **Exports are thin and inconsistent.** CSV ignores container/freight entirely despite the
   comment claiming parity with Excel ([exporting.js:119](../src/utils/exporting.js#L119)); Excel
   appends summary rows whose values land in the `L` column
   ([exporting.js:94](../src/utils/exporting.js#L94)); the PDF is a single table with no letterhead,
   no page numbers, no overflow guard, and no Unicode font. None of them carry the trade data a
   real packing list needs.
3. **There is no way to send a document to anyone.**

Additionally the README advertises "offline-capable" but there is no service worker, `firebase.json`
sends `no-store` on every route, and the fonts load from the Google CDN — so it is not. The main
bundle is **1.22 MB un-gzipped** because `xlsx`, `jspdf` and `papaparse` are all eagerly imported.

**Outcome:** an app that ingests whatever spreadsheet a logistics user has, produces auditable
trade documents (Packing List / Shipment Summary / Commercial Invoice), emails them without a
backend, survives corrupt state, and genuinely works offline.

### Decisions locked in

| Question | Choice |
|---|---|
| Email delivery | **No backend.** Web Share API → `.eml` download → `mailto:` fallback |
| PDF scope | **Full document suite** + reusable Company Profile |
| Data hardening | **Full** — parsing, schema versioning, IndexedDB, ErrorBoundary, backup/restore |
| Extras | PWA/offline, saved shipments, carrier rounding rules, a11y + keyboard |
| Country rules | **Destination-country + carrier profiles** — see [COUNTRY_FREIGHT_RULES.md](COUNTRY_FREIGHT_RULES.md) |

---

## Architecture

Preserve the existing separation — pure logic in `utils/`, state in `hooks/`, UI in `components/`.
New modules follow it:

```
src/utils/
  numbers.js              # parseFlexibleNumber, safeNum, clampInt, roundUpTo, detectColumnLocale
  schema.js               # SCHEMA_VERSION, normalizeProduct/ShipmentItem, migrate, isPlausible
  storage.js              # safe localStorage wrapper, IndexedDB rawData store, backup/restore
  headerMap.js            # scored header→field assignment (replaces autoMapHeaders internals)
  freight.js              # per-piece volumetric, carrier rounding, revenue tons, workings[]
  countryProfiles.js      # destination country → road GVW cap, units, measurement ton
  carrierProfiles.js      # carrier/service → volumetric divisor, rounding step
  numberToWords.js        # invoice amount in words (INR lakh/crore + international)
  share.js                # Web Share / .eml / mailto builders
  export/
    rows.js               # SINGLE source of truth for all export row/summary building
    excel.js  csv.js
    pdf/theme.js  pdf/layout.js  pdf/packingList.js  pdf/shipmentSummary.js
    pdf/commercialInvoice.js  pdf/index.js  pdf/unicodeFont.js
src/hooks/
  useCompanyProfile.js    useShipments.js    useKeyboardShortcuts.js
src/components/
  ui/Modal.jsx            # shared accessible modal shell (focus trap, Esc, scroll lock)
  ui/ErrorBoundary.jsx
  modals/ExportModal.jsx  modals/EmailShareModal.jsx  modals/CompanyProfileModal.jsx
  shipment/ShipmentSwitcher.jsx  shipment/ShipmentDetailsPanel.jsx
  shipment/ShipmentRulesPanel.jsx   # destination + carrier dropdowns, governing-limit banner
```

Reuse without rewriting: `toCm`/`fromCm`/`convertDim`/`calcCBM`/`fmtCBM`/`CONTAINERS`/
`containersNeeded` ([calculations.js](../src/utils/calculations.js)), `compositeKey`/`mergeProducts`
([deduplication.js](../src/utils/deduplication.js)), `showNotice`/undo toast pattern
([useShipment.js:86](../src/hooks/useShipment.js#L86), [NoticeToast.jsx](../src/components/ui/NoticeToast.jsx)),
`FormInput` ([FormInput.jsx](../src/components/ui/FormInput.jsx)), and the debounced-persist +
`reportStorageError` pattern already in `useShipment`.

---

## Phase 0 — Foundation & crash-safety

No user-visible feature change; unblocks every later phase.

**`utils/numbers.js`**
- `parseFlexibleNumber(v)` → `number | null` (**null, not 0**, when unparseable). Handles:
  unicode minus/full-width digits, NBSP & thin-space grouping, currency symbols & unit words,
  `(5)` accounting negatives, `1/2` and `1 1/2` fractions, `1.2e3` scientific, trailing `%`,
  `5-10` ranges (takes first), and — the important one — **decimal-separator disambiguation**:
  when both `,` and `.` appear the *last* one is the decimal; when only one appears, decide from
  digit-group shape.
- `detectColumnLocale(samples)` → resolves the genuinely ambiguous `1,234` case **per column**
  rather than per cell, then the whole column parses under one decision.
- `safeNum(v, fallback = 0)`, `clampInt(v, min, max)`, `roundUpTo(v, step)`.
- Keep `sanitizeNumeric` in `fileParser.js` as a thin `parseFlexibleNumber(v) ?? 0` wrapper so the
  existing assertions in [fileParser.test.js](../src/utils/fileParser.test.js) still hold.

**`utils/schema.js`** — `SCHEMA_VERSION = 1`. `normalizeProduct` / `normalizeShipmentItem` coerce
every numeric field through `safeNum`, guarantee `name` is a non-empty string, default `unit`,
clamp negatives to 0, and drop non-object entries. `migrate(raw)` handles: non-array payloads,
`v0` (current, unversioned) → `v1`, and unknown-future → refuse and preserve. Wire into the three
`useState` initialisers in [useShipment.js:67](../src/hooks/useShipment.js#L67), `loadShipment`, `loadMeta`.

**`utils/storage.js`** — `readJSON/writeJSON` with quota handling (reuse `reportStorageError`),
`estimateUsage()`, `exportBackup()` → single JSON of every key + version, `importBackup(file)` with
a confirm step, and an IndexedDB store (`cbm-raw-data`, keyed by product id) so imported `rawData`
**survives a refresh** — today it is stripped before persisting
([useShipment.js:117](../src/hooks/useShipment.js#L117)), so the Product Summary modal goes blank
after reload.

**`components/ui/ErrorBoundary.jsx`** — wraps `<App/>` in [main.jsx](../src/main.jsx). Recovery screen:
error digest, **Download backup**, **Reset shipment only**, **Reset everything**, Reload.

**`components/ui/Modal.jsx`** — `role="dialog"`, `aria-modal`, `aria-labelledby`, focus-trap,
Escape, focus restore, body scroll lock with scrollbar-width compensation. Retrofit all four
existing modals onto it (they currently have none of this).

**Known bugs fixed in this phase**

| Bug | Location |
|---|---|
| `.toFixed()` on possibly-undefined weights → crash | [exporting.js:181](../src/utils/exporting.js#L181), [ActiveShipment.jsx:252](../src/components/shipment/ActiveShipment.jsx#L252) |
| CSV has no UTF-8 BOM → mojibake in Excel | [exporting.js:121](../src/utils/exporting.js#L121) |
| Excel summary values land in the `L` column | [exporting.js:94](../src/utils/exporting.js#L94) |
| `packingString` falls back to the numeric pack size, forcing a display hack | [fileParser.js:343](../src/utils/fileParser.js#L343) → [ActiveShipment.jsx:256](../src/components/shipment/ActiveShipment.jsx#L256) |
| `Math.max(1, NaN)` → NaN quantity poisons all totals | [useShipment.js:503](../src/hooks/useShipment.js#L503) |
| Filename keeps `/ \ : * ? " < > \|` from the PO → invalid on Windows | [exporting.js:28](../src/utils/exporting.js#L28) |
| `toISOString()` date is UTC → off-by-one for negative offsets | [exporting.js:29](../src/utils/exporting.js#L29) |
| `fmtCBM` emits `-1.000000` / `Infinity` for bad input | [calculations.js:66](../src/utils/calculations.js#L66) |

---

## Phase 1 — Import hardening ("any data the user gives")

**`utils/headerMap.js`** — replaces the substring loop in
[fileParser.js:240](../src/utils/fileParser.js#L240). Build a full `field × header` score matrix
(exact 100 → startsWith 70 → contains 40 + alias length → token overlap 30 → fuzzy 20), then
**greedily assign highest-scoring pairs, consuming both the field and the header**. This kills the
current failure where a file containing both `Product Name` and `Description` maps `name` to
whichever appears first. Scores below threshold stay unmapped. Surface a
`high / medium / confirm` confidence badge per field in the wizard.

New mappable fields: `unit` (**per-row** — today one global unit is forced on the whole file),
`quantity`/`cartons`, `hsCode`, `unitPrice`, `currency`, `origin`, `sku`, `marks`.

**Import target toggle** in `ColumnMappingStep`: *Directory* (today's behaviour) or **Shipment** —
a file with a quantity column becomes a priced, quantified shipment in one step.

**Unit inference**: if the file has a CBM column, compute CBM from the dims under each candidate
unit and pick the one matching within 2% — the strongest possible signal. Otherwise use
median-magnitude heuristics (median dim > 2500 with unit `cm` ⇒ probably mm). Never auto-switch:
show a dismissible one-click banner.

**Row triage** — extend the existing `new`/`skipped` tagging in
[applyMapping](../src/utils/fileParser.js#L355) with a **`warn`** tier: gross < net, CBM > 100 m³ per
shipper, dimension ratio > 100:1, zero weights, or a mapped CBM column disagreeing with computed
CBM by > 5%. Skip reasons expand to *Unparseable Numbers*, *Zero/Negative Dimension*, *Blank Name*.
Add a **"Download rejected rows (CSV)"** button so nothing is ever silently discarded.

**Scale limits** — file-size guard (~25 MB) and row cap (~50 000) with a clear message; move the
synchronous `XLSX.read` at [fileParser.js:82](../src/utils/fileParser.js#L82) into a Web Worker so a
large workbook no longer freezes the tab; chunk the preview.

**Delimiter auto-detect** for combined dimension columns (`x`, `X`, `×`, `*`, `by`, `/`, `-`)
instead of defaulting to `x`.

---

## Phase 2 — Freight & container accuracy

**`utils/freight.js`** — one entry point returning an auditable result:

```js
computeFreight({ items, totals, mode, container }) → {
  grossKg, volumetricKg, chargeableKg, chargeableBilled, revenueTons,
  basis: 'gross' | 'volumetric', workings: [{ label, expression, value }], containerPlan
}
```

| Mode | Rule now | Rule after |
|---|---|---|
| Air | aggregate CBM × 167 | per-piece cm³ ÷ 6000, summed, chargeable **rounded up to next 0.5 kg** (IATA TACT) |
| Courier | aggregate CBM × 200 | per-piece cm³ ÷ 5000, chargeable **rounded up to next 1.0 kg** |
| Ocean LCL | `max(gross, cbm × 1000)` | **revenue tons** = `max(CBM, tonnes)`, rounded up; shown as RT |
| Ocean FCL | gross | unchanged (correct today) |

`workings[]` renders both in the UI and in the PDF, so every billed number is traceable — this is
the "accurate details" payoff. Add `45hc` (≈76 m³ / 25 600 kg), an **LCL / no container** option,
and a **custom container** (user-entered usable CBM + max payload). Extend `CONTAINERS` entries
with internal L/W/H, door dimensions and TEU for the summary document. Keep
`FREIGHT_MODES[].volumetricFactor` for persisted-meta and test back-compat, but route all display
and export through `freight.js`.

---

## Phase 2b — Country & carrier rule profiles

Full research and every cited figure: **[COUNTRY_FREIGHT_RULES.md](COUNTRY_FREIGHT_RULES.md)**.

**Key finding: CBM itself does not vary by country** — `L×W×H÷1e6` is geometry, so
[`calcCBM`](../src/utils/calculations.js#L56) stays country-agnostic. Four *other* things vary, and
they split across two independent selectors:

| Selector | Controls | Why |
|---|---|---|
| **Destination country** | Road-legal payload cap, units, measurement-ton definition | National law |
| **Carrier & service** | Volumetric divisor, rounding step | Carrier tariff — *not* destination |

Both default to today's exact behaviour when untouched, per your requirement.

**The payoff.** The app currently reports ISO container ratings as universally achievable. They are
not. For a 40′ HC:

| Lane | Governing limit | Practical payload | vs ISO 26,545 kg |
|---|---|---|---|
| **US road** | 80,000 lb federal GVW | **≈21,466 kg** | **−19% — ISO rating is unreachable** |
| EU road @ 44 t | ISO container rating | 28,565 kg available | ISO binds ✅ |

A user planning a US-bound 40′ HC to today's 26,500 kg figure builds a load ~5 t over the legal
highway limit. This phase fixes that.

**`utils/countryProfiles.js`** — `roadMaxGvwKg`, `axleLimits`, `railMaxGrossKg`,
`typicalTractorKg`/`typicalChassisKg` (editable estimates), `measurementTonM3`, `preferredUnits`,
`bridgeFormula`. Verified entries: `US`, `EU_44T`, `EU_40T`, `GB`, `SE`, `FI`, `DE`, `DK`, `NL`, `IT`,
plus `DEFAULT` = current behaviour. Every other country maps to a documented regional family with the
mapping **visible and editable**, not hidden — an exhaustive 195-country table is neither achievable
nor verifiable, and most of what would fill it is carrier-determined anyway.

**`utils/carrierProfiles.js`** — divisor + rounding per carrier/service. Verified: DHL Express 5000
(**UAE 4000** — the one genuinely country-scoped divisor, and it is scoped to *origin*), FedEx Intl
5000, UPS US retail 6000, USPS Domestic 7000, Canada Post variants, plus `CUSTOM`. Divisors are
routinely renegotiated per contract, so **every field must be user-editable** — the most important
UX requirement in the research.

**Resolution order**, surfaced in the UI rather than applied silently:
```
explicit user override → carrier/service profile → destination country profile → DEFAULT
```

**Integration** — `computeFreight` (Phase 2) takes `{ countryProfile, carrierProfile }` and pushes
every resolved cap into `workings[]`, so the UI and PDF both state *"Payload capped at 21,466 kg by
US federal 80,000 lb GVW, not the ISO 26,545 kg rating"*. `ShipmentRulesPanel` renders the two
dropdowns plus a governing-limit banner with a `[why?]` link to the citation. Never silently change a
number the user already saw — strike it through and give the reason. Container capacity in
[`containersNeeded`](../src/utils/calculations.js#L133) gains a third constraint alongside volume and
ISO payload: **road-legal payload**, so `limitedBy` becomes `'volume' | 'weight' | 'road'`.

**Also from the research** — add 45′ HC (86.1 m³ geometric → ~76 m³ usable, 28,500 kg); make
container tare editable (ISO does not fix tare — it varies by build); note that ISO 668:2013 Amd 1
raised the ceiling to 36,000 kg but most of the fleet has not caught up, so 30,480 kg stays the
planning default.

**Verify before shipping** (marked `[U]` in the report — sourcing gaps, not invented numbers):
IATA's 0.5 kg round-up, ocean LCL's 1 CBM = 1,000 kg, EU road groupage 333 kg/m³ + loading-metre
allowances, and road limits for India, China, Brazil, Australia, Canada. `WebSearch` was unavailable
this pass and the carrier/IATA sites either block automated access or publish only in paid TACT.

---

## Phase 3 — Export overhaul

### Single source of truth

`utils/export/rows.js` — `buildItemRows`, `buildTotalsRow`, `buildSummaryPairs`,
`buildContainerPlanRows`, `buildInvoiceRows`. All three exporters consume these, which structurally
prevents the current Excel/CSV divergence. Keep the existing precision policy from
[exporting.js:1-23](../src/utils/exporting.js#L1-L23): raw numerics in spreadsheets, formatted strings
only in the PDF.

### Excel — multi-sheet workbook

| Sheet | Contents |
|---|---|
| Summary | Company block, PO/invoice/date, totals, chargeable-weight `workings`, mode, container plan |
| Packing List | Full item table — frozen header, autofilter, per-column number formats, bold TOTALS |
| Item Breakdown | Dims in original unit **and** cm, CBM/shipper & total, volumetric, net/gross per pc & per shipper, partial-box flag |
| Container Plan | Containers by volume vs weight, per-container fill, remaining margin |
| Directory | Product catalog (toggle) |
| Raw Import Data | Original imported columns from IndexedDB (toggle) |

`aoa_to_sheet` for the layout-heavy Summary, `json_to_sheet` for tables; set `!cols` (already
done), `!merges`, `!freeze`, `!autofilter`, and `cell.z` number formats — verify each against the
installed SheetJS build and degrade gracefully if unsupported.

### CSV

BOM + CRLF (Excel-safe), plus a selector for **which** table to emit (Packing list / Item
breakdown / Container plan / Directory) so CSV output is complete rather than a lossy subset.

### PDF document suite

`pdf/theme.js` (palette from the Tailwind accent `#0d7d6e`, mm geometry) and `pdf/layout.js`
(`letterhead`, `partyBox`, `ensureSpace`, `wrapText`, `pageFooter`, `utilizationBar`).

- **Packing List** — Shipper / Consignee / Notify boxes, Marks & Numbers, transport block (mode,
  vessel/flight, POL/POD, Incoterm), item table (#, Marks, Description, HS Code, Pack, Cartons,
  Total Pcs, Dims, CBM/ctn, Total CBM, Net kg, Gross kg), per-page running subtotal via
  `didDrawPage`, grand totals, declaration + signature block.
- **Shipment Summary** — totals cards, the `workings[]` derivation table, container plan,
  utilization bars drawn with `doc.rect`, top-10-by-CBM, notes.
- **Commercial Invoice** — invoice no./date, seller/buyer, payment terms, unit price & amount,
  subtotal + freight + insurance + total, **amount in words** (`numberToWords.js`), declaration.

Cross-cutting fixes: `ensureSpace()` before every post-table block (the current
`doc.text(..., finalY)` at [exporting.js:225](../src/utils/exporting.js#L225) can render off the last
page); `splitTextToSize` everywhere instead of raw `doc.text`; real `Page X of Y` in a second pass;
auto orientation (portrait ≤ 8 columns, else landscape); A4/Letter from the profile.

**Unicode** (`pdf/unicodeFont.js`) — jsPDF's default Helvetica is WinAnsi, so non-Latin product
names currently render as garbage. Detect out-of-range characters and only then dynamically
`import()` a base64 Noto Sans chunk (Latin-Ext + Devanagari) and register it via
`addFileToVFS`/`addFont`. Lazy so the default bundle is unaffected; if a script isn't covered, warn
via `showNotice` rather than emitting silent `?`s.

### Company Profile + shipment trade metadata

`useCompanyProfile.js` (key `cbm-company`): name, address, GST/IEC/CIN, phone, email, website,
logo (client-side canvas-resized to ≤ 600 px / 300 KB), default Incoterm, currency, paper size, and
a saved **parties book** (shipper/consignee/notify). Edited via `CompanyProfileModal` from
[Header.jsx](../src/components/layout/Header.jsx).

Shipment meta gains `invoiceNo`, `invoiceDate`, `shipperId`, `consigneeId`, `notifyId`, `incoterm`,
`portOfLoading`, `portOfDischarge`, `vesselFlight`, `marksNumbers`, `currency`, `freightCharge`,
`insuranceCharge`, `notes` — behind a collapsible `ShipmentDetailsPanel` so the three-panel layout
stays lean. Per-item `hsCode`, `unitPrice`, `notes`, editable inline and importable.

`ExportModal` replaces the three loose buttons at
[ActiveShipment.jsx:158-193](../src/components/shipment/ActiveShipment.jsx#L158-L193): pick format,
pick documents, pick sheets, one PDF or separate files, then Download or **Email**.

### Bundle split (prerequisite, not optional)

`xlsx` + `jspdf` + `papaparse` are eagerly imported today → 1.22 MB main chunk. Convert every
export entry point to `async` with a dynamic `import()` inside, and add
`build.rollupOptions.manualChunks` in [vite.config.js](../vite.config.js). Callers become `await`-ed
— a deliberate API change, needed before adding a font chunk.

---

## Phase 4 — Email / share (no backend)

`utils/share.js`, three tiers, chosen automatically:

1. **`navigator.share({ files })`** when `navigator.canShare({files:[f]})` — mobile & Safari hand
   the PDF straight to Gmail/Mail/WhatsApp. Swallow `AbortError`; fall through on `NotAllowedError`.
2. **`.eml` download** — build an RFC 822 message with the PDF as a base64 MIME part. Opening it
   launches Outlook / Apple Mail / Thunderbird **with the attachment already attached**. This is the
   desktop primary; it needs no service, no key, and works offline.
3. **`mailto:` draft + PDF download** — universal fallback. Body capped ≈1800 chars for client URL
   limits; toast explains the one manual attach step.

`EmailShareModal`: To / Cc with validation, templated subject (`Packing List — {PO} — {date}`),
pre-filled editable body from `buildMailBody(ctx)` (totals, chargeable weight, container plan, first
20 items + "…and N more"), document picker, and **Copy summary to clipboard** — which works
everywhere including Gmail web and Outlook Web.

---

## Phase 5 — Saved shipments

`hooks/useShipments.js` — `{ id, name, createdAt, updatedAt, meta, items }[]` under
`cbm-shipments`, active id under `cbm-active-shipment`. On first load, migrate the existing
`cbm-shipment` + `cbm-shipment-meta` into shipment #1. `ShipmentSwitcher` in the ActiveShipment
header: name + item count + CBM, with New / Duplicate / Rename / Delete (undo via the existing
`showNotice` pattern). Soft cap ~50 with a quota warning. `useShipment` keeps its current public
API so `App.jsx` wiring barely changes.

---

## Phase 6 — PWA, keyboard, docs

- **PWA** — `vite-plugin-pwa`, `registerType: 'prompt'`. Generate `pwa-192`, `pwa-512`,
  `maskable-512` PNGs from [public/favicon.svg](../public/favicon.svg) (add `scripts/generate-icons.mjs`).
  **Self-host Inter + JetBrains Mono** — [index.html](../index.html) currently hard-depends on
  `fonts.googleapis.com`, so the app cannot render offline. **Fix [firebase.json](../firebase.json)**:
  `no-store` on `/**` defeats any service worker — scope it to `index.html` + `sw.js` and serve
  `/assets/**` as `max-age=31536000, immutable`.
- **`useKeyboardShortcuts.js`** — `Ctrl/⌘+E` export, `Ctrl/⌘+I` import, `/` or `Ctrl/⌘+K` search,
  `Ctrl/⌘+Enter` add to shipment, `Esc` close topmost, `?` cheatsheet. Ignore events originating in
  inputs (except `Esc`).
- **README** — correct the "offline-capable" claim (true only after this phase), document exports,
  email, shortcuts, backup/restore, the storage-key table with `SCHEMA_VERSION`, and the updated
  architecture tree.

---

## Verification

**Automated** — `npm test`. Existing 64 assertions across
[calculations.test.js](../src/utils/calculations.test.js),
[deduplication.test.js](../src/utils/deduplication.test.js),
[fileParser.test.js](../src/utils/fileParser.test.js) must stay green (hence the `sanitizeNumeric`
wrapper). New suites:

| Suite | Covers |
|---|---|
| `numbers.test.js` | Format matrix: `1.234,56`, `1,234`, `(5)`, `1e3`, `1 1/2`, `50%`, `−5`, `12.5 kg`, `''`, `null`, booleans |
| `headerMap.test.js` | Real header sets incl. the ambiguous `Description` + `Product Name` case; per-row unit column |
| `freight.test.js` | IATA 0.5 kg and courier 1.0 kg round-up, revenue tons, per-piece vs aggregate volumetric |
| `countryProfiles.test.js` | Resolution order (override → carrier → country → DEFAULT); US 40′ HC derates to ≈21,466 kg; EU @44 t stays ISO-bound; `DEFAULT` reproduces today's numbers **exactly** |
| `rows.test.js` | Excel / CSV / PDF read identical numbers from one builder |
| `schema.test.js` | v0→v1 migration, non-array payload, missing/negative/NaN fields |
| `share.test.js` | `.eml` MIME structure, `mailto:` length cap, `navigator.share` mocked |
| `Modal.test.jsx` | Focus trap, Esc, focus restore (adds `@testing-library/react` + `jsdom` devDeps) |

Fixtures in `src/test/fixtures/`: European decimals, merged/offset header rows, blank & junk rows,
Unicode names, mm dims mislabelled cm, combined dims, CBM-only rows, 50k-row stress file.

**Manual** — `npm run dev`, then:
1. Import each fixture; confirm the confidence badges, the unit-inference banner, the `warn` tier,
   and that "Download rejected rows" accounts for every skipped row.
2. Export Excel → open in Excel: six sheets, frozen headers, autofilter, correct number formats,
   summary values in the right cells.
3. Export CSV → open in Excel: no mojibake on a Unicode product name.
4. Export the PDF suite → check letterhead, `Page X of Y`, no clipped text on a shipment long
   enough to page-break right after the table, a Devanagari product name rendering correctly.
5. Country rules: load a 40′ HC to 26,000 kg with **Default** → fits. Switch destination to
   **United States** → the governing-limit banner fires, `limitedBy` reads `road`, and the PDF
   `workings` cites the 80,000 lb GVW cap. Switch back to Default → the original numbers return
   unchanged.
6. Email: on Android/iOS confirm the native share sheet carries the PDF; on desktop confirm the
   `.eml` opens with the attachment already attached, and that `mailto:` is the fallback.
7. Corrupt `localStorage` (`cbm-products` → `{"x":1}`) and reload → ErrorBoundary recovery screen,
   backup downloads, reset works.
8. `npm run build` → confirm the main chunk drops well below 1.22 MB and that xlsx/jspdf load only
   on first export. `npm run preview`, go offline in DevTools, reload → app still renders.
9. `npm run lint` clean.

---

## Sequencing note

Phases 0 → 1 → 2 → 2b are prerequisites for 3 (exports need trustworthy numbers, and the PDF cites
the governing-limit workings), and 3 precedes 4 (email needs documents). 5 and 6 are independent and
can land in any order. Each phase is independently shippable, so this can stop at any boundary.
