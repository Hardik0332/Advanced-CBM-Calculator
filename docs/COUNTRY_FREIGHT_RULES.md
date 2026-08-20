# Country & Carrier Freight Rules — Research Report

> Compiled 2026-08-18 for the CBM Calculator country-profile feature.
> Every figure is marked **[V]** verified against a cited source in this research pass, or
> **[U]** unverified — widely used in industry but not confirmed from a primary source here.
> Do not ship a **[U]** figure as an authoritative default without checking it first.

---

## 1. The core finding: CBM does not vary by country

Cubic metres are geometry: `L × W × H ÷ 1,000,000`. A 60×40×40 cm carton is 0.096 m³ everywhere on
earth. There is no national variation, and the app's [`calcCBM`](../src/utils/calculations.js#L56)
needs no country awareness.

What people mean when they say "CBM rules change by country" is one of four genuinely variable
things:

| # | Variable | Actually determined by | Magnitude of effect |
|---|---|---|---|
| 1 | Volumetric / dimensional **divisor** | **Carrier + service + origin country** | ±40% on chargeable weight |
| 2 | Chargeable-weight **rounding** | Carrier / mode | <1% |
| 3 | **Road-legal payload** of a loaded container | **Destination (and origin) country law** | up to −25% vs ISO rating |
| 4 | **Units** and measurement-ton definition | Country convention | display only |

### Design consequence

A dropdown labelled *"destination country"* correctly drives **#3 and #4**, which is worth having.
But **#1 — the divisor, the thing that changes the billed number most — is a carrier/service
property, not a destination property.** DHL applies 5000 cm³/kg whether the box goes to Kenya or
Korea; what changes it is shipping *from* the UAE (4000) or using a US retail rate (6000).

So the feature needs **two** selectors, not one:

```
Destination country  ▸ [ Default / United States / Germany / … ]   → road payload, units, ton def.
Carrier & service    ▸ [ Default / DHL Express / FedEx Intl / … ] → divisor, rounding
```
Both default to today's behaviour when untouched.

---

## 2. Dimensional-weight divisors — courier & express **[V]**

Source: [Wikipedia — Dimensional weight](https://en.wikipedia.org/wiki/Dimensional_weight),
citing carrier tariffs.

| Carrier | Scope | Divisor (in³/lb) | Divisor (cm³/kg) | Implied kg/m³ |
|---|---|---|---|---|
| DHL Express | Global | 139 | **5,000** | 200 |
| DHL Express | **United Arab Emirates** | 111 | **4,000** | 250 |
| FedEx | International | 139 | 5,000 | 200 |
| FedEx | US & Puerto Rico | 139 | 5,000 | 200 |
| UPS | International | 139 | 5,000 | 200 |
| UPS | US domestic — daily rates, >1 ft³ | 139 | 5,000 | 200 |
| UPS | US domestic — retail rates (all sizes); daily ≤1 ft³ | 166 | 6,000 | 166.7 |
| UPS | Canada domestic (except Standard) | 139 | 5,000 | 200 |
| UPS | UPS Standard within Canada | 166 | 6,000 | 166.7 |
| USPS | International (Global Express Guaranteed) | 166 | 6,000 | 166.7 |
| USPS | Domestic Priority, Zones 5–9, >1 ft³ | 194 | 7,000 | 142.9 |
| Canada Post | Expedited / Regular | 166 | 6,000 | 166.7 |
| Canada Post | Priority, Xpresspost, US, International | 139 | 5,000 | 200 |

**Notes**
- The UAE row is the clearest genuinely *country*-scoped divisor in the whole dataset — and it is
  scoped to **origin**, not destination.
- The source renders 5,000 cm³/kg as both 138 and 139 in³/lb. The exact value is 138.4; carriers
  publish 139. Store the metric figure as canonical and derive the imperial one.
- Since 2015, UPS and FedEx apply greater-of-actual-or-dimensional to **every** air and ground
  shipment; before that it applied only within a size band.
- Divisors are frequently overridden by **negotiated contract**, so every profile value must be
  user-editable. This is the single most important UX requirement in this document.

### Air freight (IATA) **[V for the factor, U for rounding]**

- **[V]** 166 in³/lb ≈ **6,000 cm³/kg** = 166.67 kg/m³ is described as "common for IATA shipments."
- **[V]** 194 in³/lb ≈ 7,000 cm³/kg = 142.86 kg/m³ is "common for domestic shipments."
- **[U]** Chargeable weight rounded **up to the next 0.5 kg** (IATA/TACT practice). IATA does not
  publish this openly — it sits in the paid TACT Rules. **Verify before shipping.** The app's
  current aggregate `cbm × 167` is close enough for estimation but is not the per-piece method
  carriers actually use.
- **[V]** Volume is measured to the **longest dimension on each axis**, so anything non-cuboid is
  overstated. Worth a UI note: irregular items bill higher than their true volume.
- **[V]** Worked example confirming round-up: 18×18×18 in at 10 lb international →
  5,832 ÷ 166 = 35.1 lb → **billed 36 lb**.

---

## 3. Road-legal payload by country — the big one **[V]**

This is where destination country genuinely and substantially changes the answer, and where the app
is currently misleading: it reports ISO container ratings as if they were achievable everywhere.

### ISO container specifications **[V]**

Source: [Wikipedia — Intermodal container](https://en.wikipedia.org/wiki/Intermodal_container),
citing ISO 668 and ISO 1496-1.

| | 20′ std | 40′ std | 40′ HC | 45′ HC |
|---|---|---|---|---|
| Internal volume (geometric) | 33.1 m³ | 67.5 m³ | 75.3 m³ | 86.1 m³ |
| Tare (approx.) | 2,200 kg | 3,800 kg | 3,935 kg | 4,500 kg |
| Common max gross | 30,480 kg | 30,480 kg | 30,480 kg | 33,000 kg |
| **ISO net payload** | 28,280 kg | 26,680 kg | 26,545 kg | 28,500 kg |

The app's current [`CONTAINERS`](../src/utils/calculations.js#L79) values (28 / 58 / 68 m³ usable,
28,200 / 26,700 / 26,500 kg) are sound: the volumes apply a ~85–90% practical stowage factor to the
geometric figures, and the payloads match ISO net load closely. **Keep them**; add 45′ HC as
86.1 m³ geometric → ~76 m³ usable, 28,500 kg.

Two caveats worth surfacing in the UI:
- **[V]** ISO 668:2013 Amendment 1 (2016) raised the ceiling to 36,000 kg for all sizes except 10′,
  but "the majority of the global container fleet have not caught up" — so 30,480 kg remains the
  safe planning assumption.
- **[V]** Tare "is not determined by the standards, but by the container's construction." Payload
  must be derived from the *actual* box's plate, so tare has to be user-overridable.

### Maximum gross vehicle weight, by country **[V]**

| Country / bloc | Max GVW (articulated) | Source detail |
|---|---|---|
| **United States** | **80,000 lb = 36,287 kg** | FHWA/FMCSA §658.17, Interstate system. Single axle 20,000 lb; tandem 34,000 lb; also subject to the Federal Bridge Gross Weight Formula `W = 500(LN/(N−1) + 12N + 36)` |
| US — **rail** intermodal | 20′ ≈ 24,000 kg gross · 40′ ≈ 30,500 kg gross | Tighter than road for 20′ boxes |
| **EU** baseline | **40 t** | Directive 96/53/EC framework |
| **EU carrying an ISO container** | **44 t** | Intermodal/combined-transport allowance |
| EU cross-border ceiling | 44 t, max 18.75 m | Applies to internal border crossings |
| **United Kingdom** | **44,000 kg** | Requires 3+ axles on both tractor and semi-trailer |
| **Italy** | **44 t** | Five axles or more |
| **Sweden** | **60 t** (25.25 m) | 1996 EEA exemption; permits to 76 t (Boliden ore) and 90 t (Northland) |
| **Finland** | **76 t** since Jan 2013 (was 60 t) | Height also raised 4.2 → 4.4 m |
| **Denmark** | 60 t on approved routes | 25.25 m combinations |
| **Germany** | 60 t on restricted routes | Since 2006, 25.25 m combinations |
| **Netherlands** | 60 t (trial) | 25.25 m combinations |
| France · Spain · Belgium | EU baseline assumed (40 t / 44 t container) | **[U]** — not individually sourced |
| India · China · Brazil · Australia · Canada | **[U] not researched** | See §6 |

### Derived: what you can *actually* load — the payoff table

Payload = `GVW − tractor − chassis − container tare`. Tractor and chassis masses below are
**[U] typical estimates**, not law, and must be user-editable.

| Lane | Governing limit | 40′ HC practical payload | vs ISO 26,545 kg |
|---|---|---|---|
| **US road** | 80,000 lb GVW | 80,000 − 17,000 (tractor) − 7,000 (chassis) − 8,675 (tare) ≈ **47,325 lb ≈ 21,466 kg** | **−19%. Road law binds; the ISO rating is unreachable.** |
| **EU road, container @ 44 t** | ISO container rating | 44,000 − 7,500 − 4,000 − 3,935 ≈ 28,565 kg available | ISO 26,545 kg binds first ✅ |
| **UK @ 44 t** | ISO container rating | ≈ same as EU | ISO binds ✅ |
| **Sweden / Finland @ 60–76 t** | ISO container rating | far above ISO | ISO binds ✅ |

**This is the headline result.** A user planning a US-bound 40′ HC to the app's current
26,500 kg payload figure will build a load that **cannot legally move on a US highway** — roughly
5 tonnes overweight. In the EU the ISO rating is the correct cap. One dropdown fixes a real,
expensive error.

---

## 4. Measurement / freight ton **[V]**

Source: [Wikipedia — Shipping ton](https://en.wikipedia.org/wiki/Freight_ton).

| Country | Freight / measurement ton |
|---|---|
| **USA** | 40 ft³ = 1.133 m³ |
| **UK** | 42 ft³ = 1.189 m³ |

A real national divergence, and it matters for anyone quoting in freight tons rather than CBM.
Do not confuse with the **register ton** (100 ft³), which measures ship capacity.

---

## 5. Ocean LCL — W/M **[U]**

The app implements `chargeable = max(gross, CBM × 1000)`, i.e. 1 CBM ⇄ 1,000 kg, and bills revenue
tons. This is standard industry practice and almost certainly right, but **no source in this pass
confirmed it** — Wikipedia's freight-rate and shipping-ton articles cover neither W/M, revenue tons,
nor any kg-per-CBM factor. Treat 1,000 kg/m³ as a well-founded default; verify against a carrier
tariff or FIATA reference before presenting it as authoritative. Some trades reportedly use a long
ton (1,016 kg) basis — also unverified.

---

## 6. Gaps to close before implementing

| Gap | Why it matters | Where to look |
|---|---|---|
| IATA 0.5 kg round-up | Affects every air quote | IATA TACT Rules (paid) |
| Ocean LCL 1 CBM = 1,000 kg | Core to LCL mode | Carrier tariff, FIATA |
| EU road groupage factor (reportedly 1 m³ = 333 kg) and **loading metre** (LDM) kg allowance | Needed for any EU road mode | Forwarder tariffs; the Wikipedia "Loading metre" page 404s |
| Road limits for India, China, Brazil, Australia, Canada | Large markets, no data | MoRTH (IN), MOT (CN), NHVR (AU), CCMTA (CA) |
| Per-country oversize / surcharge thresholds | Length & girth limits vary | Carrier service guides |
| Air domestic divisors outside the US | 7,000 cm³/kg is US-centric | National carrier tariffs |

**Honest scope note:** an exhaustive all-195-country table is not achievable or verifiable, and most
of what would fill it is carrier-determined rather than national. The workable model is **rule
families**: ~15 explicitly researched countries, plus documented regional defaults (EU-44t,
EU-60t Nordic, ISO-unrestricted) that every other country maps onto — with the mapping visible and
editable rather than hidden.

### Second verification pass — 2026-08-20

Re-attempted during Phase 2b implementation, with a search tool available this time. **The gaps did
not close, for a different reason: the accessible references do not publish the figures.**

| Gap | Attempted | Result |
|---|---|---|
| Road limits for IN · CN · BR · CA | Wikipedia *Semi-trailer truck*, *Axle load* | **Not found.** Neither page mentions any of the four. |
| Road limit for AU | Wikipedia *Semi-trailer truck* | Found, but not usable as a container-haulage cap: road trains to 164 t, B-doubles to 62.5 t — both far above ISO, so the container rating binds anyway, exactly as in the Nordics. |
| IATA 0.5 kg round-up | Wikipedia *Chargeable weight* (404) | **Not found.** Still paid-TACT-only. |
| Ocean LCL 1 CBM = 1,000 kg | Wikipedia *Freight rate* | **Not found.** The page covers rate determinants but defines neither W/M, revenue tons, nor any kg-per-CBM factor. |

`WebSearch` is unsupported on the current model, so only direct page fetches were possible.

**How the implementation handles this.** The `[U]` figures ship as defaults but are never presented
as authoritative: each appears in `computeFreight`'s `notes[]` as a sourcing caveat, and the
`[why?]` disclosure in `ShipmentRulesPanel` badges every citation `[V]` or `[U]`. The four
unrateable countries are **selectable but explicitly unrated** — `UNRESEARCHED_COUNTRIES` in
`countryProfiles.js` resolves them to no derating plus a note saying the limit is missing and
pointing at the GVW override. Listing them beats omitting them: a user shipping to India who finds
no entry assumes the ISO rating is achievable, which is the exact error this phase exists to
prevent.

---

## 7. Proposed data model

```js
// src/utils/countryProfiles.js
export const COUNTRY_PROFILES = {
  DEFAULT: {                      // exactly today's behaviour — nothing changes unless chosen
    label: 'Default (ISO / international)',
    roadMaxGvwKg: null,           // null ⇒ container ISO rating governs
    measurementTonM3: null,
    preferredUnits: 'metric',
    notes: 'ISO container ratings, no road-law derating.',
  },
  US: {
    label: 'United States',
    roadMaxGvwKg: 36287,          // [V] 80,000 lb
    axleLimits: { single: 9072, tandem: 15422 },   // [V] 20,000 / 34,000 lb
    railMaxGrossKg: { '20ft': 24000, '40ft': 30500 },  // [V]
    typicalTractorKg: 7711,       // [U] editable
    typicalChassisKg: 3175,       // [U] editable
    measurementTonM3: 1.133,      // [V] 40 ft³
    preferredUnits: 'imperial',
    bridgeFormula: true,          // [V]
  },
  EU_44T: { label: 'EU (ISO container, 44 t)', roadMaxGvwKg: 44000, … },   // [V]
  EU_40T: { label: 'EU (general freight, 40 t)', roadMaxGvwKg: 40000, … }, // [V]
  GB:     { label: 'United Kingdom', roadMaxGvwKg: 44000, measurementTonM3: 1.189, … }, // [V]
  SE:     { label: 'Sweden', roadMaxGvwKg: 60000, … },   // [V]
  FI:     { label: 'Finland', roadMaxGvwKg: 76000, … },  // [V]
  // … DE / DK / NL 60 t restricted-route; IT 44 t; regional fallbacks
};

// src/utils/carrierProfiles.js — drives the divisor, independent of destination
export const CARRIER_PROFILES = {
  DEFAULT:        { label: 'Default (IATA 6000 / LCL 1000)', air: 6000, courier: 5000 },
  DHL_EXPRESS:    { label: 'DHL Express', courier: 5000 },              // [V]
  DHL_EXPRESS_AE: { label: 'DHL Express (from UAE)', courier: 4000 },   // [V]
  FEDEX_INTL:     { label: 'FedEx International', courier: 5000 },      // [V]
  UPS_US_RETAIL:  { label: 'UPS US retail', courier: 6000 },            // [V]
  USPS_DOMESTIC:  { label: 'USPS Domestic Priority', courier: 7000 },   // [V]
  CUSTOM:         { label: 'Custom / negotiated', editable: true },
};
```

**Resolution order** — first match wins, and the UI must show which rule fired and why:

```
explicit user override  →  carrier/service profile  →  destination country profile  →  DEFAULT
```

Every resolved value feeds `workings[]` in `utils/freight.js` (Phase 2 of the main plan), so the PDF
and the UI can both state *"Payload capped at 21,466 kg by US federal 80,000 lb GVW, not the ISO
26,545 kg rating"* rather than silently changing a number.

---

## 8. UI sketch

```
┌─ Shipment Rules ──────────────────────────────────────────┐
│ Destination  ▸ United States            [i]               │
│ Carrier      ▸ FedEx International      [i]               │
│                                                            │
│ ⚠ US federal road limit (80,000 lb GVW) caps this 40′ HC  │
│   at ≈21,466 kg — 5,079 kg BELOW its ISO 26,545 kg rating.│
│   Governing limit: road law ▸ [why?]                      │
│                                                            │
│ Divisor 5,000 cm³/kg · round up to 1.0 kg · [edit]        │
└────────────────────────────────────────────────────────────┘
```

Rules: never silently change a number the user already saw — show the old value struck through with
the reason. Every profile field editable, with a "reset to researched default" affordance. A
`[why?]` link on every derived cap opens the citation from this report.

---

## Sources

| Source | Used for | Confidence |
|---|---|---|
| [Wikipedia — Dimensional weight](https://en.wikipedia.org/wiki/Dimensional_weight) | §2 full divisor table, rounding example, longest-axis rule | High — cites carrier tariffs |
| [Wikipedia — Intermodal container](https://en.wikipedia.org/wiki/Intermodal_container) | §3 ISO specs, tare, ISO 668 Amd 1, rail limits | High — cites ISO 668 / 1496-1 |
| [Wikipedia — Federal Bridge Gross Weight Formula](https://en.wikipedia.org/wiki/Federal_Bridge_Gross_Weight_Formula) | §3 US limits, axle limits, bridge formula | High — cites §658.17 |
| [Wikipedia — Semi-trailer truck](https://en.wikipedia.org/wiki/Semi-trailer_truck) | §3 EU 40/44 t, UK, Italy, Nordic limits | Medium — encyclopedic |
| [Wikipedia — Shipping ton](https://en.wikipedia.org/wiki/Freight_ton) | §4 US 40 ft³ vs UK 42 ft³ | Medium — short stub, last edited 2020 |
| [Wikipedia — Large goods vehicle](https://en.wikipedia.org/wiki/Large_goods_vehicle) | §3 EU cross-border 44 t / 18.75 m | Medium |

**Blocked / unavailable this pass:** `WebSearch` is unsupported on this model; fedex.com returned a
permission error, dhl.com timed out, iata.org publishes rating rules only in paid TACT, and
searates.com / Wikipedia "Loading metre" 404'd. The **[U]** items above are the direct consequence —
they are gaps in sourcing, not invented figures.
