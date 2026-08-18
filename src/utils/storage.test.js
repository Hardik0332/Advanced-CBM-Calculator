import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  STORAGE_KEYS,
  isStorageAvailable,
  readJSON,
  writeJSON,
  removeKey,
  estimateUsage,
  buildBackup,
  backupFileName,
  parseBackup,
  applyBackup,
  clearKeys,
  BACKUP_FORMAT,
} from './storage';

/**
 * Minimal in-memory localStorage. Vitest runs in the node environment here, so
 * rather than pulling in jsdom for a key/value map we install our own — which
 * also lets us simulate a quota failure precisely.
 */
class MemoryStorage {
  constructor() { this.map = new Map(); this.failOnSet = false; }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) {
    if (this.failOnSet) {
      const err = new Error('quota exceeded');
      err.name = 'QuotaExceededError';
      throw err;
    }
    this.map.set(k, String(v));
  }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

let store;
beforeEach(() => {
  store = new MemoryStorage();
  vi.stubGlobal('localStorage', store);
});

describe('isStorageAvailable', () => {
  it('is true for a working store', () => {
    expect(isStorageAvailable()).toBe(true);
  });
  it('is false when writes throw (Safari private mode)', () => {
    store.failOnSet = true;
    expect(isStorageAvailable()).toBe(false);
  });
  it('leaves no probe key behind', () => {
    isStorageAvailable();
    expect(store.map.size).toBe(0);
  });
});

describe('readJSON', () => {
  it('round-trips a value', () => {
    writeJSON('k', { a: 1 });
    expect(readJSON('k')).toEqual({ a: 1 });
  });
  it('returns null for a missing key', () => {
    expect(readJSON('nope')).toBeNull();
  });
  it('returns null for invalid JSON instead of throwing', () => {
    store.map.set('bad', '{not json');
    expect(() => readJSON('bad')).not.toThrow();
    expect(readJSON('bad')).toBeNull();
  });
});

describe('writeJSON', () => {
  it('reports success', () => {
    expect(writeJSON('k', [1, 2])).toEqual({ ok: true, quotaExceeded: false });
  });
  it('reports a quota failure without throwing', () => {
    store.failOnSet = true;
    const res = writeJSON('k', { a: 1 });
    expect(res.ok).toBe(false);
    expect(res.quotaExceeded).toBe(true);
  });
});

describe('removeKey', () => {
  it('removes a key', () => {
    writeJSON('k', 1);
    expect(removeKey('k')).toBe(true);
    expect(readJSON('k')).toBeNull();
  });
});

describe('estimateUsage', () => {
  it('is zero for an empty store', () => {
    expect(estimateUsage().totalBytes).toBe(0);
  });
  it('counts app keys only', () => {
    writeJSON(STORAGE_KEYS.products, [{ name: 'Widget' }]);
    store.map.set('unrelated-site-key', 'x'.repeat(1000));
    const { totalBytes, byKey } = estimateUsage();
    expect(totalBytes).toBeGreaterThan(0);
    expect(byKey[STORAGE_KEYS.products]).toBeGreaterThan(0);
    expect(byKey['unrelated-site-key']).toBeUndefined();
  });
});

describe('buildBackup', () => {
  it('captures present app keys', () => {
    writeJSON(STORAGE_KEYS.products, [{ name: 'Widget' }]);
    writeJSON(STORAGE_KEYS.theme, 'dark');
    const backup = buildBackup();
    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.keys[STORAGE_KEYS.products]).toBeTruthy();
    expect(backup.keys[STORAGE_KEYS.theme]).toBeTruthy();
    expect(backup.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
  it('omits absent keys', () => {
    const backup = buildBackup();
    expect(Object.keys(backup.keys)).toHaveLength(0);
  });
  it('stores raw text so values are never re-serialised', () => {
    store.map.set(STORAGE_KEYS.products, '[{"name":"Widget"}]');
    expect(buildBackup().keys[STORAGE_KEYS.products]).toBe('[{"name":"Widget"}]');
  });
});

describe('backupFileName', () => {
  it('is filesystem-safe and dated', () => {
    const name = backupFileName();
    expect(name).toMatch(/^cbm-backup_\d{4}-\d{2}-\d{2}_\d{4}\.json$/);
    expect(name).not.toMatch(/[/\\:*?"<>|]/);
  });
});

describe('parseBackup', () => {
  const validText = () => {
    writeJSON(STORAGE_KEYS.products, [{ name: 'Widget' }]);
    return JSON.stringify(buildBackup());
  };

  it('accepts a valid backup', () => {
    const res = parseBackup(validText());
    expect(res.ok).toBe(true);
    expect(res.keyCount).toBe(1);
  });
  it('rejects non-JSON', () => {
    const res = parseBackup('not json at all');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/JSON/i);
  });
  it('rejects an array or primitive', () => {
    expect(parseBackup('[]').ok).toBe(false);
    expect(parseBackup('42').ok).toBe(false);
    expect(parseBackup('null').ok).toBe(false);
  });
  it('rejects a foreign JSON file', () => {
    const res = parseBackup(JSON.stringify({ some: 'other file' }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not a CBM Calculator backup/i);
  });
  it('rejects a backup with no recognisable keys', () => {
    const res = parseBackup(
      JSON.stringify({ format: BACKUP_FORMAT, keys: { 'evil-key': 'x' } })
    );
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/recognisable/i);
  });
  it('rejects a backup with no keys object', () => {
    expect(parseBackup(JSON.stringify({ format: BACKUP_FORMAT })).ok).toBe(false);
  });
});

describe('applyBackup', () => {
  it('restores recognised keys', () => {
    const backup = {
      format: BACKUP_FORMAT,
      keys: {
        [STORAGE_KEYS.products]: '[{"name":"Restored"}]',
        [STORAGE_KEYS.theme]: '"dark"',
      },
    };
    const res = applyBackup(backup);
    expect(res.restored).toBe(2);
    expect(readJSON(STORAGE_KEYS.products)).toEqual([{ name: 'Restored' }]);
  });

  it('ignores unrecognised keys — a tampered file cannot inject entries', () => {
    const res = applyBackup({
      format: BACKUP_FORMAT,
      keys: { 'attacker-key': '"payload"', [STORAGE_KEYS.theme]: '"light"' },
    });
    expect(res.restored).toBe(1);
    expect(store.getItem('attacker-key')).toBeNull();
  });

  it('skips non-string values', () => {
    const res = applyBackup({
      format: BACKUP_FORMAT,
      keys: { [STORAGE_KEYS.theme]: { nested: true } },
    });
    expect(res.restored).toBe(0);
    expect(res.failed).toBe(1);
  });

  it('handles a missing keys object', () => {
    expect(applyBackup({}).restored).toBe(0);
  });
});

describe('clearKeys', () => {
  it('clears all app keys but leaves unrelated data', () => {
    writeJSON(STORAGE_KEYS.products, [1]);
    writeJSON(STORAGE_KEYS.shipment, [2]);
    store.map.set('unrelated', 'keep me');
    clearKeys();
    expect(readJSON(STORAGE_KEYS.products)).toBeNull();
    expect(readJSON(STORAGE_KEYS.shipment)).toBeNull();
    expect(store.getItem('unrelated')).toBe('keep me');
  });

  it('can clear a subset — the "reset shipment only" recovery path', () => {
    writeJSON(STORAGE_KEYS.products, [1]);
    writeJSON(STORAGE_KEYS.shipment, [2]);
    clearKeys([STORAGE_KEYS.shipment]);
    expect(readJSON(STORAGE_KEYS.products)).toEqual([1]);
    expect(readJSON(STORAGE_KEYS.shipment)).toBeNull();
  });
});

describe('backup round-trip', () => {
  it('survives export → clear → restore', () => {
    writeJSON(STORAGE_KEYS.products, [{ name: 'Widget', length: 50 }]);
    writeJSON(STORAGE_KEYS.meta, { poNumber: 'PO-123' });

    const text = JSON.stringify(buildBackup());
    clearKeys();
    expect(readJSON(STORAGE_KEYS.products)).toBeNull();

    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    applyBackup(parsed.backup);

    expect(readJSON(STORAGE_KEYS.products)).toEqual([{ name: 'Widget', length: 50 }]);
    expect(readJSON(STORAGE_KEYS.meta)).toEqual({ poNumber: 'PO-123' });
  });
});
