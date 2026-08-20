/**
 * ShipmentRulesPanel — destination and carrier rule selection, and the governing
 * limit that results.
 *
 * The panel exists because of one concrete failure mode: the app used to report ISO
 * container payload ratings as universally achievable. On a US road lane a 40′ HC
 * is capped roughly 5 tonnes below its plate by the federal 80,000 lb gross limit,
 * so a user planning to the ISO figure builds a load that cannot legally move. Two
 * dropdowns and a banner fix that.
 *
 * Three rules govern the design, all from docs/COUNTRY_FREIGHT_RULES.md §8:
 *
 *  1. **Two selectors, not one.** Destination country drives road payload and the
 *     measurement ton; carrier drives the volumetric divisor. Merging them into a
 *     single "country" control would apply national law to a carrier tariff.
 *  2. **Never silently change a number the user already saw.** When a road limit
 *     binds, the ISO rating is struck through beside the new cap with the reason —
 *     not replaced.
 *  3. **Every field is editable.** Divisors are renegotiated per contract and
 *     vehicle masses are estimates, so a profile the user cannot correct is worse
 *     than no profile: it looks authoritative while being wrong for their account.
 */
import { useState, memo } from 'react';
import { ChevronIcon } from '../icons/Icons';
import {
  COUNTRY_OPTION_GROUPS,
  CITATIONS,
  countryLabel,
  DEFAULT_COUNTRY,
} from '../../utils/countryProfiles';
import {
  CARRIER_OPTION_GROUPS,
  CARRIER_CITATIONS,
  CARRIER_PROFILES,
  DEFAULT_CARRIER,
} from '../../utils/carrierProfiles';
import { fmtNum } from '../../utils/freight';

const selectClass =
  'w-full bg-white dark:bg-surface-700 border border-surface-200 dark:border-surface-700 ' +
  'rounded-lg px-2 py-1.5 text-[11px] font-bold text-surface-700 dark:text-surface-200 ' +
  'focus:outline-none focus:ring-1 focus:ring-accent-500/40';

const labelClass =
  'block text-[9px] uppercase tracking-wider font-bold text-surface-500 ' +
  'dark:text-surface-300 mb-1';

const numInputClass =
  'w-full bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700 ' +
  'rounded-lg px-2 py-1 text-[11px] font-mono font-bold text-surface-800 dark:text-surface-100 ' +
  'focus:outline-none focus:ring-1 focus:ring-accent-500/40';

/** One editable override. Placeholder shows the value it would inherit. */
const OverrideField = ({ id, label, placeholder, value, onChange, hint }) => (
  <div>
    <label htmlFor={id} className={labelClass}>
      {label}
    </label>
    <input
      id={id}
      type="number"
      min="0"
      step="any"
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={numInputClass}
    />
    {hint && (
      <p className="text-[8px] text-surface-400 dark:text-surface-500 mt-0.5 leading-tight">
        {hint}
      </p>
    )}
  </div>
);

const ShipmentRulesPanel = memo(({
  freight,
  destinationCountry = DEFAULT_COUNTRY,
  setDestinationCountry,
  carrierProfile = DEFAULT_CARRIER,
  setCarrierProfile,
  ruleOverrides = {},
  updateRuleOverride,
  resetRuleOverrides,
}) => {
  const [editing, setEditing] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);

  const plan = freight?.containerPlan;
  const cap = freight?.payloadCap;
  const tariff = freight?.tariff;

  const roadBinds = plan?.applicable && plan.payloadCapSource === 'road';
  const overridden = cap?.source === 'override';
  const hasOverrides = Object.keys(ruleOverrides || {}).length > 0;

  /* Citations for whichever rules actually fired — a `[why?]` that opens sources
     the user's own selection did not use would be noise. */
  const citations = [
    cap?.resolved?.profile?.citation ? CITATIONS[cap.resolved.profile.citation] : null,
    tariff?.citation ? CARRIER_CITATIONS[tariff.citation] : null,
  ].filter(Boolean);

  return (
    <div className="p-3 rounded-xl bg-surface-50 dark:bg-surface-800/60 border border-surface-200 dark:border-surface-700 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase tracking-widest font-bold text-surface-500 dark:text-surface-300">
          Shipment Rules
        </span>
        {freight?.rulesAreDefault && (
          <span className="text-[9px] font-bold text-surface-400 dark:text-surface-500">
            defaults
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label htmlFor="destination-country-select" className={labelClass}>
            Destination
          </label>
          <select
            id="destination-country-select"
            value={destinationCountry}
            onChange={(e) => setDestinationCountry(e.target.value)}
            className={selectClass}
          >
            {COUNTRY_OPTION_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((key) => (
                  <option key={key} value={key}>
                    {countryLabel(key)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <p className="text-[8px] text-surface-400 dark:text-surface-500 mt-0.5 leading-tight">
            Road payload limit &amp; measurement ton
          </p>
        </div>

        <div>
          <label htmlFor="carrier-profile-select" className={labelClass}>
            Carrier &amp; service
          </label>
          <select
            id="carrier-profile-select"
            value={carrierProfile}
            onChange={(e) => setCarrierProfile(e.target.value)}
            className={selectClass}
          >
            {CARRIER_OPTION_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((key) => (
                  <option key={key} value={key}>
                    {CARRIER_PROFILES[key].label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <p className="text-[8px] text-surface-400 dark:text-surface-500 mt-0.5 leading-tight">
            Volumetric divisor &amp; rounding
          </p>
        </div>
      </div>

      {/* Governing-limit banner. The ISO figure stays visible, struck through, so
          the number the user planned around is never silently swapped out. */}
      {roadBinds && (
        <div className="text-[10px] leading-snug rounded-lg border border-amber-300/70 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/10 p-2 space-y-1">
          <p className="font-bold text-amber-800 dark:text-amber-300">
            <span aria-hidden="true">⚠ </span>
            {cap.resolved.countryLabel} road law caps this {plan.container.label}
          </p>
          <p className="font-mono text-amber-900 dark:text-amber-200">
            <s className="opacity-60">{fmtNum(plan.isoPayloadKg, 0)} kg ISO</s>{' '}
            <span className="font-bold">→ {fmtNum(plan.payloadCapKg, 0)} kg</span>{' '}
            <span className="opacity-80">
              ({fmtNum(plan.payloadDerateKg, 0)} kg less per container)
            </span>
          </p>
          <p className="text-amber-800/90 dark:text-amber-300/90 font-mono text-[9px]">
            {cap.road.expression}
          </p>
          <p className="text-amber-800 dark:text-amber-300">
            Governing limit: <span className="font-bold">road law</span>
          </p>
        </div>
      )}

      {/* A country we know we cannot rate. Shown as a prompt to act, not as a
          warning to dismiss — the override field is the fix. */}
      {cap?.resolved?.via === 'unresearched' && (
        <p className="text-[10px] leading-snug rounded-lg border border-surface-300/70 dark:border-surface-600/50 bg-white/60 dark:bg-surface-800/40 p-2 text-surface-600 dark:text-surface-300">
          <span aria-hidden="true">ℹ </span>
          No road-weight limit on file for {cap.resolved.mappedFrom}. The ISO rating is being
          reported as achievable — enter the local GVW below to check it.
        </p>
      )}

      {/* The ISO rating binding is worth saying too — it confirms the selection was
          applied and deliberately changed nothing. Gated on `applicable`: loose LCL
          cargo has no container to rate, so there is no limit to compare against. */}
      {plan?.applicable && !roadBinds && !overridden && cap?.roadKg !== null && (
        <p className="text-[10px] leading-snug text-surface-500 dark:text-surface-400">
          {cap.resolved.countryLabel} would allow {fmtNum(cap.roadKg, 0)} kg on the road, so
          the {fmtNum(cap.isoKg, 0)} kg container rating governs.
        </p>
      )}

      {overridden && plan?.applicable && (
        <p className="text-[10px] leading-snug font-semibold text-accent-700 dark:text-accent-300">
          Payload manually set to {fmtNum(cap.capKg, 0)} kg — the container rating and any
          road limit are ignored.
        </p>
      )}

      {/* Divisor summary — the other half of the resolution, always visible because
          it is what sets the price on an air or courier shipment. */}
      {tariff?.divisorCm3PerKg > 0 && (
        <p className="text-[10px] leading-snug text-surface-600 dark:text-surface-300 font-mono">
          Divisor {fmtNum(tariff.divisorCm3PerKg, 0)} cm³/kg
          <span className="opacity-70"> ({fmtNum(tariff.in3PerLb, 0)} in³/lb)</span>
          {tariff.roundingStepKg > 0 && ` · round up to ${tariff.roundingStepKg} kg`}
          <span className="opacity-70">
            {' · '}
            {tariff.divisorSource === 'override'
              ? 'your override'
              : tariff.divisorSource === 'carrier'
                ? 'carrier tariff'
                : 'mode default'}
          </span>
        </p>
      )}

      {carrierProfile !== DEFAULT_CARRIER && tariff && !tariff.applies && (
        <p className="text-[10px] leading-snug text-rose-600 dark:text-rose-400">
          {tariff.carrierLabel} does not publish a tariff for {freight.modeLabel} — the mode
          default is being used instead.
        </p>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          aria-expanded={editing}
          aria-controls="rule-overrides-body"
          className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest
                     text-surface-500 dark:text-surface-300 hover:text-accent-600
                     dark:hover:text-accent-300 rounded focus:outline-none
                     focus-visible:ring-2 focus-visible:ring-accent-500/40"
        >
          <span
            className={`transition-transform duration-200 ${editing ? 'rotate-90' : ''}`}
            aria-hidden="true"
          >
            <ChevronIcon />
          </span>
          Edit rule values
          {hasOverrides && (
            <span className="ml-1 px-1 rounded bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300 normal-case tracking-normal">
              {Object.keys(ruleOverrides).length} overridden
            </span>
          )}
        </button>

        {citations.length > 0 && (
          <button
            type="button"
            onClick={() => setWhyOpen((v) => !v)}
            aria-expanded={whyOpen}
            aria-controls="rule-citations-body"
            className="text-[10px] font-bold text-accent-600 dark:text-accent-300 underline
                       rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40"
          >
            why?
          </button>
        )}
      </div>

      {whyOpen && citations.length > 0 && (
        <ul id="rule-citations-body" className="space-y-1">
          {citations.map((c, i) => (
            <li
              key={i}
              className="text-[9px] leading-snug text-surface-500 dark:text-surface-400"
            >
              <span
                className={`font-bold ${c.confidence === 'V'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-amber-600 dark:text-amber-400'
                  }`}
              >
                [{c.confidence}]
              </span>{' '}
              {c.url ? (
                <a
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline hover:text-accent-600 dark:hover:text-accent-300"
                >
                  {c.label}
                </a>
              ) : (
                c.label
              )}
            </li>
          ))}
          <li className="text-[9px] leading-snug text-surface-400 dark:text-surface-500">
            [V] verified against a cited source · [U] industry practice, not confirmed from a
            primary source — check it before quoting.
          </li>
        </ul>
      )}

      {editing && (
        <div id="rule-overrides-body" className="space-y-2 pt-1 border-t border-surface-200 dark:border-surface-700">
          <p className="text-[9px] leading-snug text-surface-500 dark:text-surface-400">
            Blank means &ldquo;use the profile value&rdquo;. Placeholders show what you would
            inherit. Contract divisors and real vehicle masses belong here.
          </p>

          <div className="grid grid-cols-2 gap-2">
            <OverrideField
              id="override-divisor"
              label="Divisor cm³/kg"
              placeholder={String(tariff?.divisorCm3PerKg ?? '')}
              value={ruleOverrides.divisorCm3PerKg}
              onChange={(v) => updateRuleOverride('divisorCm3PerKg', v)}
              hint="From your contract"
            />
            <OverrideField
              id="override-rounding"
              label="Round up to kg"
              placeholder={String(tariff?.roundingStepKg ?? '')}
              value={ruleOverrides.roundingStepKg}
              onChange={(v) => updateRuleOverride('roundingStepKg', v)}
            />
            <OverrideField
              id="override-gvw"
              label="Road GVW kg"
              placeholder={String(cap?.road?.gvwKg ?? 'none')}
              value={ruleOverrides.roadMaxGvwKg}
              onChange={(v) => updateRuleOverride('roadMaxGvwKg', v)}
              hint="National gross limit"
            />
            <OverrideField
              id="override-payload"
              label="Payload cap kg"
              placeholder={String(Math.round(cap?.capKg ?? 0))}
              value={ruleOverrides.payloadKg}
              onChange={(v) => updateRuleOverride('payloadKg', v)}
              hint="Overrides everything"
            />
            <OverrideField
              id="override-tractor"
              label="Tractor kg"
              placeholder={String(cap?.road?.tractorKg ?? '')}
              value={ruleOverrides.tractorKg}
              onChange={(v) => updateRuleOverride('tractorKg', v)}
              hint="Estimate — check the plate"
            />
            <OverrideField
              id="override-chassis"
              label="Chassis kg"
              placeholder={String(cap?.road?.chassisKg ?? '')}
              value={ruleOverrides.chassisKg}
              onChange={(v) => updateRuleOverride('chassisKg', v)}
              hint="Estimate — check the plate"
            />
            <OverrideField
              id="override-tare"
              label="Container tare kg"
              placeholder={String(cap?.road?.tareKg ?? 0)}
              value={ruleOverrides.tareKg}
              onChange={(v) => updateRuleOverride('tareKg', v)}
              hint="ISO does not fix tare"
            />
            <OverrideField
              id="override-measurement-ton"
              label="m³ per freight ton"
              placeholder={String(freight?.measurementTonM3 ?? 1)}
              value={ruleOverrides.measurementTonM3}
              onChange={(v) => updateRuleOverride('measurementTonM3', v)}
              hint="LCL revenue tons"
            />
          </div>

          <button
            type="button"
            onClick={resetRuleOverrides}
            disabled={!hasOverrides}
            className="w-full py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider
                       border border-surface-200 dark:border-surface-700
                       text-surface-600 dark:text-surface-300
                       hover:bg-surface-100 dark:hover:bg-surface-700/60
                       disabled:opacity-40 disabled:cursor-not-allowed
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40"
          >
            Reset to researched defaults
          </button>
        </div>
      )}
    </div>
  );
});

ShipmentRulesPanel.displayName = 'ShipmentRulesPanel';

export default ShipmentRulesPanel;
