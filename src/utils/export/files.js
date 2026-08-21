/**
 * Filename and download plumbing, shared by every exporter.
 *
 * Small, but worth its own module: the filename rules encode two bugs that were
 * fixed once and must not regress in three places. A PO like `AB/123` produced
 * `shipment_AB/123_….pdf`, which Windows rejects outright, and `toISOString()`
 * stamped a UTC date that is the wrong day for every user west of Greenwich.
 */

/** Characters Windows forbids in filenames. */
const UNSAFE_FILENAME = /[/\\:*?"<>|]/g;

/** Local ISO date (YYYY-MM-DD). `toISOString()` is UTC and gives the wrong day. */
export const localDateStamp = (d = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Local date and time, for filenames that may be generated more than once a day. */
export const localStamp = (d = new Date()) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${localDateStamp(d)}_${pad(d.getHours())}${pad(d.getMinutes())}`;
};

/**
 * Build a download filename that is safe on every OS.
 *
 * @param {string} base - e.g. 'packing-list'.
 * @param {string} poNumber - Reference to embed; sanitised and capped.
 * @param {string} ext - Extension without the dot.
 * @returns {string}
 */
export const exportFileName = (base, poNumber, ext) => {
  const ref = String(poNumber || '')
    .replace(UNSAFE_FILENAME, '-')
    .replace(/\s+/g, '_')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 60);
  return `${base}${ref ? `_${ref}` : ''}_${localDateStamp()}.${ext}`;
};

/**
 * Trigger a browser download for a Blob.
 *
 * The object URL is revoked on the next task rather than synchronously: Safari has
 * historically cancelled the download if the URL is revoked in the same tick as
 * the click.
 *
 * @param {Blob} blob
 * @param {string} filename
 */
export const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

/**
 * Download text with an explicit charset.
 *
 * @param {string} text
 * @param {string} filename
 * @param {string} [mime]
 */
export const downloadText = (text, filename, mime = 'text/csv;charset=utf-8;') =>
  downloadBlob(new Blob([text], { type: mime }), filename);

/**
 * UTF-8 BOM. Without it Excel reads a CSV in the system codepage and mojibakes
 * every non-ASCII product name.
 *
 * Written as an escape sequence, never as a literal — an invisible zero-width
 * character in source survives no encoding change, editor or copy-paste.
 */
export const UTF8_BOM = '\uFEFF';
