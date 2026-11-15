// Helpers shared by the two fetchers (same download/unzip code as scripts/fetch-sf3-2000-places.mjs).
import { writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

// The 50 states and DC: FIPS, postal code, state name.
export const STATES = [
  ['01', 'al', 'Alabama'], ['02', 'ak', 'Alaska'], ['04', 'az', 'Arizona'], ['05', 'ar', 'Arkansas'],
  ['06', 'ca', 'California'], ['08', 'co', 'Colorado'], ['09', 'ct', 'Connecticut'], ['10', 'de', 'Delaware'],
  ['11', 'dc', 'District of Columbia'], ['12', 'fl', 'Florida'], ['13', 'ga', 'Georgia'], ['15', 'hi', 'Hawaii'],
  ['16', 'id', 'Idaho'], ['17', 'il', 'Illinois'], ['18', 'in', 'Indiana'], ['19', 'ia', 'Iowa'],
  ['20', 'ks', 'Kansas'], ['21', 'ky', 'Kentucky'], ['22', 'la', 'Louisiana'], ['23', 'me', 'Maine'],
  ['24', 'md', 'Maryland'], ['25', 'ma', 'Massachusetts'], ['26', 'mi', 'Michigan'], ['27', 'mn', 'Minnesota'],
  ['28', 'ms', 'Mississippi'], ['29', 'mo', 'Missouri'], ['30', 'mt', 'Montana'], ['31', 'ne', 'Nebraska'],
  ['32', 'nv', 'Nevada'], ['33', 'nh', 'New Hampshire'], ['34', 'nj', 'New Jersey'], ['35', 'nm', 'New Mexico'],
  ['36', 'ny', 'New York'], ['37', 'nc', 'North Carolina'], ['38', 'nd', 'North Dakota'], ['39', 'oh', 'Ohio'],
  ['40', 'ok', 'Oklahoma'], ['41', 'or', 'Oregon'], ['42', 'pa', 'Pennsylvania'], ['44', 'ri', 'Rhode Island'],
  ['45', 'sc', 'South Carolina'], ['46', 'sd', 'South Dakota'], ['47', 'tn', 'Tennessee'], ['48', 'tx', 'Texas'],
  ['49', 'ut', 'Utah'], ['50', 'vt', 'Vermont'], ['51', 'va', 'Virginia'], ['53', 'wa', 'Washington'],
  ['54', 'wv', 'West Virginia'], ['55', 'wi', 'Wisconsin'], ['56', 'wy', 'Wyoming'],
];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function download(url, file, attempts = 6) {
  for (let i = 1; ; i++) {
    try {
      await sleep(300);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (/\.zip$/i.test(url) && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new Error('not a ZIP');
      writeFileSync(file, bytes);
      return bytes;
    } catch (error) {
      if (i >= attempts) throw new Error(`${url}: ${error.message}`);
      await sleep(Math.min(60000, 3000 * 2 ** (i - 1)));
    }
  }
}

/** The files of a ZIP archive (stored or deflated), by lower-case name. */
export function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('not a ZIP archive');
  const files = new Map();
  let at = view.getUint32(end + 16, true);
  for (let n = view.getUint16(end + 10, true); n > 0; n--) {
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + size);
    files.set(name.toLowerCase(), method === 0 ? data : inflateRawSync(data));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

export const text = (bytes) => new TextDecoder('latin1').decode(bytes);
export const share = (part, whole) => (whole > 0 && part >= 0 ? Number(((part / whole) * 100).toFixed(2)) : null);
export const positive = (n) => (Number.isFinite(n) && n > 0 ? n : null);
