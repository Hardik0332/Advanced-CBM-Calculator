/**
 * Persistence layer: a non-throwing localStorage wrapper, an IndexedDB store for
 * bulky imported raw data, and whole-app backup/restore.
 *
 * Two problems this solves:
 *
 * 1. **Quota.** Imported `rawData` (every original CSV/Excel column) can run to
 *    hundreds of KB and exhaust the ~5 MB localStorage budget, so `useShipment`
 *    strips it before persisting — which means the Product Summary modal goes
 *    blank after a refresh. IndexedDB has no such limit, so raw data now
 *    survives the session.
 * 2. **Recovery.** When state does get corrupted, the user needs a way out that
 *    isn't "clear your browser data". `exportBackup` runs even from the
 *    ErrorBoundary, before any of the app has rendered.
 *
 * Every function here is non-throwing. Callers get `null`/`false`/`[]` and decide
 * what to surface.
 */

export const STORAGE_KEYS = {
  theme: 'cbm-theme',
  products: 'cbm-products',
  shipment: 'cbm-shipment',
  meta: 'cbm-shipment-meta',
  company: 'cbm-company',
  shipments: 'cbm-shipments',
  activeShipment: 'cbm-active-shipment',
  rules: 'cbm-rules',
};

const ALL_KEYS = Object.values(STORAGE_KEYS);

/** Is localStorage actually usable? Safari private mode throws on write. */
export const isStorageAvailable = () => {
  try {
    const probe = '__cbm_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
};

/**
 * Read and JSON-parse a key. Returns null for a missing key, invalid JSON, or an
 * unavailable store — never throws.
 *
 * @param {string} key
 * @returns {*|null}
 */
export const readJSON = (key) => {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/**
 * JSON-stringify and write a key.
 *
 * @param {string} key
 * @param {*} value
 * @returns {{ ok: boolean, quotaExceeded: boolean }}
 */
export const writeJSON = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return { ok: true, quotaExceeded: false };
  } catch (err) {
    // QuotaExceededError names differ across engines (Firefox uses NS_ERROR_DOM_QUOTA_REACHED).
    const quotaExceeded =
      err instanceof Error &&
      /quota|NS_ERROR_DOM_QUOTA/i.test(`${err.name} ${err.message}`);
    return { ok: false, quotaExceeded };
  }
};

/** Remove a key, ignoring failures. */
export const removeKey = (key) => {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
};

/**
 * Approximate bytes used by this app's keys. UTF-16 storage means 2 bytes per
 * code unit, which is what browsers actually count against the quota.
 *
 * @returns {{ totalBytes: number, byKey: Record<string, number> }}
 */
export const estimateUsage = () => {
  const byKey = {};
  let totalBytes = 0;
  for (const key of ALL_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      const bytes = raw ? (raw.length + key.length) * 2 : 0;
      byKey[key] = bytes;
      totalBytes += bytes;
    } catch {
      byKey[key] = 0;
    }
  }
  return { totalBytes, byKey };
};

/* ══════════════════════════════════════════════════════════
   Backup / restore
   ══════════════════════════════════════════════════════════ */

export const BACKUP_FORMAT = 'cbm-calculator-backup';
export const BACKUP_VERSION = 1;

/**
 * Snapshot every app key into one portable object. Deliberately dependency-free
 * and synchronous so the ErrorBoundary can call it after a render crash.
 *
 * @returns {object}
 */
export const buildBackup = () => {
  const keys = {};
  for (const key of ALL_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (raw != null) keys[key] = raw; // keep as raw text — never re-serialise
    } catch {
      /* skip unreadable keys */
    }
  }
  return {
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
    keys,
  };
};

/** A filesystem-safe, locally-dated backup filename. */
export const backupFileName = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  // Local date, not toISOString — UTC would give the wrong day for many users.
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `cbm-backup_${stamp}_${time}.json`;
};

/**
 * Validate a backup file's contents before anything is written.
 *
 * @param {string} text - Raw file contents.
 * @returns {{ ok: true, backup: object, keyCount: number } | { ok: false, error: string }}
 */
export const parseBackup = (text) => {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Not a valid JSON file.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Not a valid backup file.' };
  }
  if (parsed.format !== BACKUP_FORMAT) {
    return { ok: false, error: 'This file is not a CBM Calculator backup.' };
  }
  if (!parsed.keys || typeof parsed.keys !== 'object') {
    return { ok: false, error: 'Backup file contains no data.' };
  }
  const recognised = Object.keys(parsed.keys).filter((k) => ALL_KEYS.includes(k));
  if (recognised.length === 0) {
    return { ok: false, error: 'Backup file contains no recognisable data.' };
  }
  return { ok: true, backup: parsed, keyCount: recognised.length };
};

/**
 * Write a validated backup over the current state. Only recognised keys are
 * restored, so a tampered file cannot inject arbitrary localStorage entries.
 *
 * @param {object} backup - A backup validated by `parseBackup`.
 * @returns {{ restored: number, failed: number }}
 */
export const applyBackup = (backup) => {
  let restored = 0;
  let failed = 0;
  for (const [key, raw] of Object.entries(backup.keys || {})) {
    if (!ALL_KEYS.includes(key)) continue;
    if (typeof raw !== 'string') { failed++; continue; }
    try {
      localStorage.setItem(key, raw);
      restored++;
    } catch {
      failed++;
    }
  }
  return { restored, failed };
};

/**
 * Clear app state. Scoped to this app's keys so unrelated site data survives.
 *
 * @param {string[]} [keys] - Defaults to every app key.
 */
export const clearKeys = (keys = ALL_KEYS) => {
  let cleared = 0;
  for (const key of keys) {
    if (removeKey(key)) cleared++;
  }
  return cleared;
};

/* ══════════════════════════════════════════════════════════
   IndexedDB — raw imported row data
   ══════════════════════════════════════════════════════════ */

const DB_NAME = 'cbm-calculator';
const DB_VERSION = 1;
const RAW_STORE = 'rawData';

let _dbPromise = null;

/**
 * Open (and upgrade) the database. Resolves to null rather than rejecting when
 * IndexedDB is unavailable — private browsing, disabled storage, or a blocked
 * upgrade — so every caller can treat raw data as best-effort.
 *
 * @returns {Promise<IDBDatabase|null>}
 */
const openDB = () => {
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);

    let req;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(RAW_STORE)) {
        db.createObjectStore(RAW_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    // A concurrent tab holding an older version would otherwise hang forever.
    req.onblocked = () => resolve(null);
  });

  return _dbPromise;
};

/**
 * Run a transaction against the raw-data store, resolving to `fallback` on any
 * failure. `fn` receives the store plus a mutable `box` to write its result
 * into; the promise settles on `tx.oncomplete`, by which point every queued
 * request has finished.
 */
const withStore = (mode, fn, fallback) =>
  openDB().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) return resolve(fallback);
        let tx;
        try {
          tx = db.transaction(RAW_STORE, mode);
        } catch {
          return resolve(fallback);
        }
        const store = tx.objectStore(RAW_STORE);
        const box = { value: fallback };
        try {
          fn(store, box);
        } catch {
          return resolve(fallback);
        }
        tx.oncomplete = () => resolve(box.value);
        tx.onerror = () => resolve(fallback);
        tx.onabort = () => resolve(fallback);
      })
  );

/**
 * Persist the original imported columns for a batch of products.
 *
 * @param {Array<{ id: string, rawData: object }>} records
 * @returns {Promise<number>} How many were written.
 */
export const putRawData = (records) => {
  const valid = (records || []).filter((r) => r && r.id && r.rawData);
  if (valid.length === 0) return Promise.resolve(0);
  return withStore(
    'readwrite',
    (store, box) => {
      for (const { id, rawData } of valid) store.put({ id, rawData });
      box.value = valid.length;
    },
    0
  );
};

/**
 * Load raw data for the given product ids.
 *
 * @param {string[]} ids
 * @returns {Promise<Record<string, object>>} id -> rawData (missing ids omitted).
 */
export const getRawData = (ids) => {
  const wanted = (ids || []).filter(Boolean);
  if (wanted.length === 0) return Promise.resolve({});
  return withStore(
    'readonly',
    (store, box) => {
      const out = {};
      box.value = out;
      for (const id of wanted) {
        const req = store.get(id);
        req.onsuccess = () => {
          if (req.result?.rawData) out[id] = req.result.rawData;
        };
      }
    },
    {}
  );
};

/**
 * Drop raw data for products that no longer exist, so the store cannot grow
 * without bound as catalogs are cleared and re-imported.
 *
 * @param {string[]} keepIds
 * @returns {Promise<number>} How many were deleted.
 */
export const pruneRawData = (keepIds) => {
  const keep = new Set(keepIds || []);
  return withStore(
    'readwrite',
    (store, box) => {
      box.value = 0;
      const req = store.getAllKeys();
      req.onsuccess = () => {
        for (const key of req.result || []) {
          if (!keep.has(key)) {
            store.delete(key);
            box.value++;
          }
        }
      };
    },
    0
  );
};

/** Wipe the raw-data store (used by the full reset path). */
export const clearRawData = () =>
  withStore('readwrite', (store, box) => { store.clear(); box.value = true; }, false);

/** Reset the cached connection — test-only seam. */
export const _resetDbCache = () => { _dbPromise = null; };
