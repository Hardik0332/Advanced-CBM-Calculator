/**
 * ShipmentDetailsPanel — the trade metadata the export documents need.
 *
 * Collapsed by default and deliberately out of the main flow. These fifteen fields
 * matter enormously on a commercial invoice and not at all when someone is checking
 * whether a load fits a 40′ HC, which is what most sessions are. Putting them
 * inline would push the totals below the fold for every user to serve the subset
 * who export documents.
 *
 * Parties come from the company profile's book, with "Type one in" for the one-off
 * buyer — requiring every consignee to be saved first would make the book useless
 * within a month.
 */
import { useState, memo } from 'react';
import { ChevronIcon } from '../icons/Icons';
import { INCOTERMS } from '../../hooks/useCompanyProfile';
import { CURRENCY_OPTIONS } from '../../utils/numberToWords';

const fieldClass = `w-full bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700
  rounded-lg px-2 py-1.5 text-[11px] font-medium text-surface-800 dark:text-surface-100
  focus:outline-none focus:ring-1 focus:ring-accent-500/40`;

const labelClass =
  'block text-[9px] uppercase tracking-wider font-bold text-surface-500 dark:text-surface-300 mb-1';

const Field = ({ id, label, value, onChange, placeholder, type = 'text' }) => (
  <div>
    <label htmlFor={id} className={labelClass}>
      {label}
    </label>
    <input
      id={id}
      type={type}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={fieldClass}
    />
  </div>
);

const Picker = ({ id, label, value, onChange, options }) => (
  <div>
    <label htmlFor={id} className={labelClass}>
      {label}
    </label>
    <select
      id={id}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className={fieldClass}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </div>
);

/** Section heading inside the panel. */
const Group = ({ title, children }) => (
  <div className="space-y-2">
    <p className="text-[9px] font-bold uppercase tracking-widest text-accent-700 dark:text-accent-300">
      {title}
    </p>
    {children}
  </div>
);

const ShipmentDetailsPanel = memo(
  ({ trade, updateTradeMeta, company, onOpenProfile, defaultOpen = false }) => {
    const [open, setOpen] = useState(defaultOpen);

    const partyOptions = [
      { value: '', label: '— none —' },
      ...(company?.parties || []).map((p) => ({
        value: p.id,
        label: p.label || p.name || 'Untitled party',
      })),
    ];

    /* How many fields carry something. Shown on the collapsed header so a user can
       see at a glance whether this shipment has document data without opening it. */
    const filled = Object.values(trade || {}).filter(
      (v) => v !== '' && v !== null && v !== undefined
    ).length;

    return (
      <div className="border-t border-surface-200 dark:border-surface-700 pt-2 mt-2">
        <button
          type="button"
          id="shipment-details-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="shipment-details-body"
          className="w-full flex items-center justify-between gap-2 text-[10px] font-bold uppercase
                     tracking-widest text-surface-500 dark:text-surface-300
                     hover:text-accent-600 dark:hover:text-accent-300 rounded
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40"
        >
          <span>
            Shipment &amp; document details
            {filled > 0 && (
              <span className="ml-1.5 font-mono normal-case tracking-normal opacity-70">
                {filled} set
              </span>
            )}
          </span>
          <span
            className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
            aria-hidden="true"
          >
            <ChevronIcon />
          </span>
        </button>

        {open && (
          <div id="shipment-details-body" className="mt-3 space-y-4">
            <p className="text-[10px] text-surface-500 dark:text-surface-400 leading-relaxed">
              Printed on the packing list, shipment summary and commercial invoice. Every field
              is optional — blank ones are left off the document rather than printed empty.
            </p>

            <Group title="Invoice">
              <div className="grid grid-cols-2 gap-2">
                <Field
                  id="trade-invoice-no"
                  label="Invoice no."
                  value={trade.invoiceNo}
                  onChange={(v) => updateTradeMeta('invoiceNo', v)}
                  placeholder="INV-2026-014"
                />
                <Field
                  id="trade-invoice-date"
                  label="Invoice date"
                  type="date"
                  value={trade.invoiceDate}
                  onChange={(v) => updateTradeMeta('invoiceDate', v)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Picker
                  id="trade-incoterm"
                  label="Incoterm"
                  value={trade.incoterm}
                  onChange={(v) => updateTradeMeta('incoterm', v)}
                  options={[
                    {
                      value: '',
                      label: company?.defaultIncoterm
                        ? `Default (${company.defaultIncoterm})`
                        : '— none —',
                    },
                    ...INCOTERMS.map((i) => ({ value: i, label: i })),
                  ]}
                />
                <Picker
                  id="trade-currency"
                  label="Currency"
                  value={trade.currency}
                  onChange={(v) => updateTradeMeta('currency', v)}
                  options={[
                    {
                      value: '',
                      label: `Default (${company?.defaultCurrency || 'USD'})`,
                    },
                    ...CURRENCY_OPTIONS.map((c) => ({ value: c, label: c })),
                  ]}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field
                  id="trade-freight-charge"
                  label="Freight charge"
                  type="number"
                  value={trade.freightCharge}
                  onChange={(v) => updateTradeMeta('freightCharge', v)}
                  placeholder="Leave blank to omit"
                />
                <Field
                  id="trade-insurance-charge"
                  label="Insurance charge"
                  type="number"
                  value={trade.insuranceCharge}
                  onChange={(v) => updateTradeMeta('insuranceCharge', v)}
                  placeholder="Leave blank to omit"
                />
              </div>
              <Field
                id="trade-payment-terms"
                label="Payment terms"
                value={trade.paymentTerms}
                onChange={(v) => updateTradeMeta('paymentTerms', v)}
                placeholder="30 days from B/L date"
              />
            </Group>

            <Group title="Parties">
              {(company?.parties || []).length === 0 ? (
                <p className="text-[10px] text-surface-500 dark:text-surface-400 leading-relaxed">
                  No saved parties yet.{' '}
                  <button
                    type="button"
                    onClick={onOpenProfile}
                    className="font-bold text-accent-600 dark:text-accent-300 underline hover:no-underline"
                  >
                    Add them in the company profile
                  </button>{' '}
                  to select a consignee here.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-2">
                  <Picker
                    id="trade-shipper"
                    label="Shipper / exporter"
                    value={trade.shipperId}
                    onChange={(v) => updateTradeMeta('shipperId', v)}
                    options={[
                      { value: '', label: 'Your company profile' },
                      ...partyOptions.slice(1),
                    ]}
                  />
                  <Picker
                    id="trade-consignee"
                    label="Consignee"
                    value={trade.consigneeId}
                    onChange={(v) => updateTradeMeta('consigneeId', v)}
                    options={partyOptions}
                  />
                  <Picker
                    id="trade-notify"
                    label="Notify party"
                    value={trade.notifyId}
                    onChange={(v) => updateTradeMeta('notifyId', v)}
                    options={partyOptions}
                  />
                </div>
              )}
            </Group>

            <Group title="Transport">
              <div className="grid grid-cols-2 gap-2">
                <Field
                  id="trade-pol"
                  label="Port of loading"
                  value={trade.portOfLoading}
                  onChange={(v) => updateTradeMeta('portOfLoading', v)}
                  placeholder="Nhava Sheva"
                />
                <Field
                  id="trade-pod"
                  label="Port of discharge"
                  value={trade.portOfDischarge}
                  onChange={(v) => updateTradeMeta('portOfDischarge', v)}
                  placeholder="Hamburg"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field
                  id="trade-vessel"
                  label="Vessel / flight"
                  value={trade.vesselFlight}
                  onChange={(v) => updateTradeMeta('vesselFlight', v)}
                  placeholder="MSC Aurora V.214W"
                />
                <Field
                  id="trade-origin-country"
                  label="Country of origin"
                  value={trade.countryOfOrigin}
                  onChange={(v) => updateTradeMeta('countryOfOrigin', v)}
                  placeholder="India"
                />
              </div>
              <div>
                <label htmlFor="trade-marks" className={labelClass}>
                  Marks &amp; numbers
                </label>
                <textarea
                  id="trade-marks"
                  rows={2}
                  value={trade.marksNumbers ?? ''}
                  onChange={(e) => updateTradeMeta('marksNumbers', e.target.value)}
                  placeholder="ACME / HAM / 1-240"
                  className={`${fieldClass} resize-y`}
                />
              </div>
            </Group>

            <Group title="Notes">
              <div>
                <label htmlFor="trade-notes" className={labelClass}>
                  Declaration / notes
                </label>
                <textarea
                  id="trade-notes"
                  rows={2}
                  value={trade.notes ?? ''}
                  onChange={(e) => updateTradeMeta('notes', e.target.value)}
                  placeholder="Replaces the default packing-list declaration"
                  className={`${fieldClass} resize-y`}
                />
              </div>
            </Group>

            <button
              type="button"
              onClick={onOpenProfile}
              className="w-full py-1.5 rounded-lg text-[10px] font-bold text-surface-600 dark:text-surface-300 bg-surface-100 dark:bg-surface-700/50 border border-surface-200 dark:border-surface-700 hover:bg-surface-200 dark:hover:bg-surface-700"
            >
              Edit company profile &amp; parties
            </button>
          </div>
        )}
      </div>
    );
  }
);

ShipmentDetailsPanel.displayName = 'ShipmentDetailsPanel';

export default ShipmentDetailsPanel;
