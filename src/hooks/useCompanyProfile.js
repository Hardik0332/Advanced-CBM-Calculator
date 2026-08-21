/**
 * useCompanyProfile — the reusable letterhead and address book.
 *
 * Trade documents need the same twenty fields on every export: who you are, your
 * tax registrations, your default Incoterm and currency, your paper size, and the
 * parties you ship to. Asking for those per-export would mean nobody ever produces
 * a complete document; asking once and storing them is the whole feature.
 *
 * Stored under `cbm-company`, separate from shipment state, because a profile
 * outlives any individual shipment and must survive "clear shipment".
 */
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { STORAGE_KEYS, readJSON, writeJSON } from '../utils/storage';
import { normalizeCompany, wrap, unwrap } from '../utils/schema';

/** A blank party, so the UI always has a shape to spread. */
export const EMPTY_PARTY = {
  id: '',
  label: '',
  name: '',
  address: '',
  contact: '',
  taxId: '',
  country: '',
};

/** A blank profile. Also what a first-run user edits. */
export const EMPTY_COMPANY = {
  name: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  gst: '',
  iec: '',
  cin: '',
  logo: '',
  defaultIncoterm: '',
  defaultCurrency: 'USD',
  paperSize: 'a4',
  parties: [],
};

/**
 * Incoterms 2020. Offered as a list because a free-text Incoterm on a customs
 * document is a source of disputes, and these eleven are the complete set.
 */
export const INCOTERMS = [
  'EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP',
];

/** Load + normalise the persisted profile. */
const loadCompany = () => {
  const { data } = unwrap(readJSON(STORAGE_KEYS.company));
  return normalizeCompany(data);
};

const genPartyId = () =>
  `party-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

/**
 * Downscale an image on a canvas before it is stored.
 *
 * A logo dropped straight from a design tool is routinely 2–4 MB, which alone
 * exhausts the ~5 MB localStorage budget and takes the whole profile down with it.
 * Resizing client-side keeps the profile small and the PDF fast, and needs no
 * upload path.
 *
 * @param {File} file
 * @param {object} [opts]
 * @param {number} [opts.maxPx=600] - Longest edge.
 * @param {number} [opts.maxBytes=300000] - Target for the encoded data URL.
 * @returns {Promise<string>} A data URL.
 */
export const resizeImageFile = (file, opts = {}) => {
  const { maxPx = 600, maxBytes = 300_000 } = opts;

  return new Promise((resolve, reject) => {
    if (!file || !/^image\//.test(file.type)) {
      return reject(new Error('That file is not an image.'));
    }
    // Guard before decoding: a 100 MB "image" should be refused, not decoded.
    if (file.size > 20 * 1024 * 1024) {
      return reject(new Error('That image is too large — use one under 20 MB.'));
    }

    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Could not process that image.'));
        ctx.drawImage(img, 0, 0, w, h);

        /* PNG first, to keep a transparent background — most logos have one. If
           that is too big, fall back to progressively harder JPEG, which flattens
           transparency but is far smaller for photographic marks. */
        let out = canvas.toDataURL('image/png');
        for (const q of [0.9, 0.75, 0.6, 0.45]) {
          if (out.length <= maxBytes) break;
          out = canvas.toDataURL('image/jpeg', q);
        }
        if (out.length > maxBytes) {
          return reject(
            new Error('That image is too detailed to store — try a simpler or smaller logo.')
          );
        }
        resolve(out);
      } catch {
        reject(new Error('Could not process that image.'));
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That image could not be read.'));
    };

    img.src = url;
  });
};

/**
 * @param {() => void} [onStorageError] - Called once if a write fails, so the app
 *   can surface it through the existing notice system rather than losing data
 *   silently.
 */
export function useCompanyProfile(onStorageError = null) {
  const [company, setCompany] = useState(loadCompany);

  /* Debounced persist, matching the pattern `useShipment` already uses — a profile
     is edited by typing, and writing on every keystroke is wasteful. */
  const timerRef = useRef(null);
  const errorRef = useRef(false);
  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      const res = writeJSON(STORAGE_KEYS.company, wrap(company));
      if (!res.ok && !errorRef.current) {
        errorRef.current = true;
        onStorageError?.();
      }
    }, 500);
    return () => clearTimeout(timerRef.current);
  }, [company, onStorageError]);

  /** Patch one top-level field. */
  const updateCompany = useCallback((field, value) => {
    setCompany((c) => ({ ...c, [field]: value }));
  }, []);

  /** Replace the whole profile — used by the modal's Save and by restore. */
  const replaceCompany = useCallback((next) => {
    setCompany(normalizeCompany(next));
  }, []);

  /** Add a party to the book and return its id, so the caller can select it. */
  const addParty = useCallback((party = {}) => {
    const id = party.id || genPartyId();
    setCompany((c) => ({
      ...c,
      parties: [...(c.parties || []), { ...EMPTY_PARTY, ...party, id }],
    }));
    return id;
  }, []);

  /** Patch one field of one party. */
  const updateParty = useCallback((id, field, value) => {
    setCompany((c) => ({
      ...c,
      parties: (c.parties || []).map((p) => (p.id === id ? { ...p, [field]: value } : p)),
    }));
  }, []);

  const removeParty = useCallback((id) => {
    setCompany((c) => ({ ...c, parties: (c.parties || []).filter((p) => p.id !== id) }));
  }, []);

  /**
   * Set the logo from a File, resizing first.
   * Resolves to null on success or a message on failure, so the caller can show it.
   */
  const setLogoFromFile = useCallback(async (file) => {
    try {
      const dataUrl = await resizeImageFile(file);
      setCompany((c) => ({ ...c, logo: dataUrl }));
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Could not process that image.';
    }
  }, []);

  const clearLogo = useCallback(() => setCompany((c) => ({ ...c, logo: '' })), []);

  /* Is there enough here to put on a document? A profile with no name produces a
     letterhead-less PDF, which is legal but looks unfinished — the UI nudges. */
  const isConfigured = useMemo(() => Boolean(company.name?.trim()), [company.name]);

  return {
    company,
    isConfigured,
    updateCompany,
    replaceCompany,
    addParty,
    updateParty,
    removeParty,
    setLogoFromFile,
    clearLogo,
  };
}
