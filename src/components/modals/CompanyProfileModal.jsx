/**
 * CompanyProfileModal — edit the letterhead and the parties book.
 *
 * Two tabs rather than one long form: the company block is set once and rarely
 * touched, while parties are added over time. Mixing them made the one-time setup
 * look like an endless form.
 */
import { useState, useRef } from 'react';
import Modal from '../ui/Modal';
import { TrashIcon, PlusIcon, FileDocIcon } from '../icons/Icons';
import { INCOTERMS, EMPTY_PARTY } from '../../hooks/useCompanyProfile';
import { CURRENCY_OPTIONS } from '../../utils/numberToWords';

const TABS = [
  { key: 'company', label: 'Company' },
  { key: 'parties', label: 'Parties' },
  { key: 'defaults', label: 'Document defaults' },
];

const fieldClass = `w-full bg-white dark:bg-surface-800 border border-surface-200 dark:border-surface-700
  rounded-lg px-2.5 py-1.5 text-xs font-medium text-surface-800 dark:text-surface-100
  focus:outline-none focus:ring-1 focus:ring-accent-500/40`;

const labelClass =
  'block text-[9px] uppercase tracking-wider font-bold text-surface-500 dark:text-surface-300 mb-1';

/** A labelled textarea — addresses are multi-line and a single input mangles them. */
const TextArea = ({ id, label, value, onChange, rows = 3, placeholder, hint }) => (
  <div>
    <label htmlFor={id} className={labelClass}>
      {label}
    </label>
    <textarea
      id={id}
      rows={rows}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`${fieldClass} resize-y custom-scrollbar`}
    />
    {hint && (
      <p className="text-[9px] text-surface-400 dark:text-surface-500 mt-0.5 leading-snug">{hint}</p>
    )}
  </div>
);

const Text = ({ id, label, value, onChange, placeholder, hint, type = 'text' }) => (
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
    {hint && (
      <p className="text-[9px] text-surface-400 dark:text-surface-500 mt-0.5 leading-snug">{hint}</p>
    )}
  </div>
);

const Select = ({ id, label, value, onChange, options, hint }) => (
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
    {hint && (
      <p className="text-[9px] text-surface-400 dark:text-surface-500 mt-0.5 leading-snug">{hint}</p>
    )}
  </div>
);

const CompanyProfileModal = ({
  isOpen,
  onClose,
  company,
  updateCompany,
  addParty,
  updateParty,
  removeParty,
  setLogoFromFile,
  clearLogo,
}) => {
  const [tab, setTab] = useState('company');
  const [logoError, setLogoError] = useState('');
  const [expandedParty, setExpandedParty] = useState(null);
  const fileRef = useRef(null);

  const handleLogo = async (e) => {
    const file = e.target.files?.[0];
    // Reset the input so re-picking the same file fires a change event again.
    e.target.value = '';
    if (!file) return;
    setLogoError('');
    const err = await setLogoFromFile(file);
    if (err) setLogoError(err);
  };

  const handleAddParty = () => {
    const id = addParty({ ...EMPTY_PARTY, label: '' });
    setExpandedParty(id);
    setTab('parties');
  };

  const parties = company.parties || [];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Company Profile"
      subtitle="Used as the letterhead and party details on every exported document"
      icon={<FileDocIcon />}
      size="2xl"
      stickyTop={
        <div
          className="flex gap-1 px-5 sm:px-6 pb-3 border-b border-surface-200 dark:border-surface-700"
          role="tablist"
          aria-label="Profile sections"
        >
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                tab === t.key
                  ? 'bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300 border border-accent-200 dark:border-accent-700'
                  : 'text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 border border-transparent'
              }`}
            >
              {t.label}
              {t.key === 'parties' && parties.length > 0 && (
                <span className="ml-1.5 font-mono opacity-70">{parties.length}</span>
              )}
            </button>
          ))}
        </div>
      }
    >
      <div className="pt-4 space-y-4">
        {/* ── Company ── */}
        {tab === 'company' && (
          <>
            <Text
              id="company-name"
              label="Company name"
              value={company.name}
              onChange={(v) => updateCompany('name', v)}
              placeholder="Acme Exports Pvt Ltd"
              hint="Without this, documents export with no letterhead."
            />
            <TextArea
              id="company-address"
              label="Address"
              value={company.address}
              onChange={(v) => updateCompany('address', v)}
              placeholder={'12 Industrial Estate\nMumbai 400001\nIndia'}
              hint="Printed as entered — keep it to four or five short lines so it fits the letterhead."
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Text
                id="company-phone"
                label="Phone"
                value={company.phone}
                onChange={(v) => updateCompany('phone', v)}
              />
              <Text
                id="company-email"
                label="Email"
                type="email"
                value={company.email}
                onChange={(v) => updateCompany('email', v)}
              />
              <Text
                id="company-website"
                label="Website"
                value={company.website}
                onChange={(v) => updateCompany('website', v)}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Text
                id="company-gst"
                label="GST / VAT"
                value={company.gst}
                onChange={(v) => updateCompany('gst', v)}
              />
              <Text
                id="company-iec"
                label="IEC"
                value={company.iec}
                onChange={(v) => updateCompany('iec', v)}
              />
              <Text
                id="company-cin"
                label="CIN"
                value={company.cin}
                onChange={(v) => updateCompany('cin', v)}
              />
            </div>

            {/* ── Logo ── */}
            <div className="pt-2 border-t border-surface-200 dark:border-surface-700">
              <p className={labelClass}>Logo</p>
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {company.logo ? (
                    <img
                      src={company.logo}
                      alt="Company logo preview"
                      className="max-w-full max-h-full object-contain"
                    />
                  ) : (
                    <span className="text-[9px] text-surface-400 text-center px-1">No logo</span>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    onChange={handleLogo}
                    className="hidden"
                    id="company-logo-input"
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-accent-700 dark:text-accent-300 bg-accent-50 dark:bg-accent-900/30 border border-accent-200 dark:border-accent-700 hover:bg-accent-100 dark:hover:bg-accent-900/50"
                  >
                    {company.logo ? 'Replace logo' : 'Upload logo'}
                  </button>
                  {company.logo && (
                    <button
                      type="button"
                      onClick={clearLogo}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-surface-500 dark:text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700 border border-surface-200 dark:border-surface-700"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
              <p className="text-[9px] text-surface-400 dark:text-surface-500 mt-1.5 leading-snug">
                Resized to 600 px and kept under 300 KB so it fits the browser&apos;s storage
                budget alongside your shipment.
              </p>
              {logoError && (
                <p className="text-[10px] font-semibold text-rose-600 dark:text-rose-400 mt-1">
                  {logoError}
                </p>
              )}
            </div>
          </>
        )}

        {/* ── Parties ── */}
        {tab === 'parties' && (
          <>
            <p className="text-[11px] text-surface-500 dark:text-surface-300 leading-relaxed">
              Saved shipper, consignee and notify parties. Select them per shipment in the
              Shipment Details panel — a one-off buyer can be typed there instead of saved here.
            </p>

            {parties.length === 0 && (
              <p className="text-[11px] text-center text-surface-400 dark:text-surface-500 py-6 border border-dashed border-surface-200 dark:border-surface-700 rounded-lg">
                No parties saved yet.
              </p>
            )}

            <div className="space-y-2">
              {parties.map((party) => {
                const open = expandedParty === party.id;
                return (
                  <div
                    key={party.id}
                    className="border border-surface-200 dark:border-surface-700 rounded-lg overflow-hidden"
                  >
                    <div className="flex items-center gap-2 px-3 py-2 bg-surface-50 dark:bg-surface-800">
                      <button
                        type="button"
                        onClick={() => setExpandedParty(open ? null : party.id)}
                        aria-expanded={open}
                        className="flex-1 text-left min-w-0"
                      >
                        <p className="text-xs font-bold text-surface-800 dark:text-surface-100 truncate">
                          {party.label || party.name || 'Untitled party'}
                        </p>
                        {party.address && (
                          <p className="text-[10px] text-surface-500 dark:text-surface-400 truncate">
                            {party.address.split('\n')[0]}
                          </p>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeParty(party.id)}
                        title="Remove party"
                        aria-label={`Remove ${party.label || party.name || 'party'}`}
                        className="p-1.5 rounded-lg text-surface-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20"
                      >
                        <TrashIcon />
                      </button>
                    </div>

                    {open && (
                      <div className="p-3 space-y-3 bg-white dark:bg-surface-900/40">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <Text
                            id={`party-label-${party.id}`}
                            label="Label (for the dropdown)"
                            value={party.label}
                            onChange={(v) => updateParty(party.id, 'label', v)}
                            placeholder="Acme GmbH — Hamburg"
                          />
                          <Text
                            id={`party-name-${party.id}`}
                            label="Legal name"
                            value={party.name}
                            onChange={(v) => updateParty(party.id, 'name', v)}
                          />
                        </div>
                        <TextArea
                          id={`party-address-${party.id}`}
                          label="Address"
                          rows={3}
                          value={party.address}
                          onChange={(v) => updateParty(party.id, 'address', v)}
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                          <Text
                            id={`party-contact-${party.id}`}
                            label="Contact"
                            value={party.contact}
                            onChange={(v) => updateParty(party.id, 'contact', v)}
                            placeholder="Tel / email"
                          />
                          <Text
                            id={`party-tax-${party.id}`}
                            label="Tax ID"
                            value={party.taxId}
                            onChange={(v) => updateParty(party.id, 'taxId', v)}
                          />
                          <Text
                            id={`party-country-${party.id}`}
                            label="Country"
                            value={party.country}
                            onChange={(v) => updateParty(party.id, 'country', v)}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleAddParty}
              className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-bold text-accent-700 dark:text-accent-300 bg-accent-50 dark:bg-accent-900/30 border border-accent-200 dark:border-accent-700 hover:bg-accent-100 dark:hover:bg-accent-900/50"
            >
              <PlusIcon /> Add party
            </button>
          </>
        )}

        {/* ── Document defaults ── */}
        {tab === 'defaults' && (
          <>
            <p className="text-[11px] text-surface-500 dark:text-surface-300 leading-relaxed">
              Pre-filled on every new shipment. A shipment can always override them.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Select
                id="company-incoterm"
                label="Default Incoterm"
                value={company.defaultIncoterm}
                onChange={(v) => updateCompany('defaultIncoterm', v)}
                options={[
                  { value: '', label: 'None' },
                  ...INCOTERMS.map((i) => ({ value: i, label: i })),
                ]}
                hint="Incoterms 2020"
              />
              <Select
                id="company-currency"
                label="Default currency"
                value={company.defaultCurrency}
                onChange={(v) => updateCompany('defaultCurrency', v)}
                options={CURRENCY_OPTIONS.map((c) => ({ value: c, label: c }))}
                hint="Drives the invoice amount in words"
              />
              <Select
                id="company-paper"
                label="Paper size"
                value={company.paperSize}
                onChange={(v) => updateCompany('paperSize', v)}
                options={[
                  { value: 'a4', label: 'A4' },
                  { value: 'letter', label: 'US Letter' },
                ]}
              />
            </div>
          </>
        )}

        <p className="text-[10px] text-surface-400 dark:text-surface-500 pt-2 border-t border-surface-200 dark:border-surface-700">
          Saved automatically to this browser. Include it in a backup from the recovery screen
          to move it to another machine.
        </p>
      </div>
    </Modal>
  );
};

export default CompanyProfileModal;
