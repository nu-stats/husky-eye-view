/**
 * Husky Eye View's use of the unpacker (./unpack.js, shared with Husky
 * Explorer): open a picked compressed file into the files inside, keeping the
 * archives the app already reads as one dataset whole.
 *
 * - A zip that holds a shapefile (.shp) comes back as itself, named .zip, for
 *   the shapefile readers (src/curated/userData.js), wherever it was found: on
 *   its own, gzipped (tracts.zip.gz) or inside another archive.
 * - Shapefile parts in a tar (tracts.tar.gz) are put in a zip, the same way.
 * - KMZ, Excel and other zip-based documents inside an archive stay whole.
 * - Everything else is opened: a .csv.gz becomes the CSV, a zip of two CSVs
 *   the two CSVs, a .tar.xz its files.
 */
import { crc32, kindOf, unpack } from './unpack.js';
import { isCompressedName } from './names.js';

export { offered } from './unpack.js';

// Names inside an archive that are zip files but one document each.
const WHOLE_DOCUMENT = /\.(kmz|xlsx|xlsm|docx|pptx|ods|odt)$/i;
// The files that make up a shapefile, kept together.
const SHAPEFILE_PART = /\.(shp|shx|dbf|prj|cpg|sbn|sbx|qix|fix|qmd|shp\.xml)$/i;
const IS_SHP = (entry) => /\.shp$/i.test(entry.name);

const baseName = (name) => String(name).split('/').pop();
const asZipName = (name) =>
  /\.zip$/i.test(name) ? name : `${name.replace(/\.(tar|zip)$/i, '')}.zip`;

/**
 * A zip that stores these files as they are (method 0), for the shapefile
 * readers. Sizes stay well under 4 GB here (the boxes' limits are 50–250 MB).
 * @param {Array<{name: string, bytes: Uint8Array}>} files
 * @returns {Uint8Array}
 */
export function storeZip(files) {
  const encoder = new TextEncoder();
  const local = [];
  const central = [];
  let at = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const crc = crc32(file.bytes);
    const head = new Uint8Array(30 + name.length);
    const h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 0x0800, true); // names are UTF-8
    h.setUint32(14, crc, true);
    h.setUint32(18, file.bytes.length, true);
    h.setUint32(22, file.bytes.length, true);
    h.setUint16(26, name.length, true);
    head.set(name, 30);
    const entry = new Uint8Array(46 + name.length);
    const d = new DataView(entry.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(8, 0x0800, true);
    d.setUint32(16, crc, true);
    d.setUint32(20, file.bytes.length, true);
    d.setUint32(24, file.bytes.length, true);
    d.setUint16(28, name.length, true);
    d.setUint32(42, at, true);
    entry.set(name, 46);
    local.push(head, file.bytes);
    central.push(entry);
    at += head.length + file.bytes.length;
  }
  const size = central.reduce((n, part) => n + part.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, central.length, true);
  e.setUint16(10, central.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, at, true);
  const parts = [...local, ...central, end];
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function open(bytes, name, maxBytes, depth) {
  const kind = kindOf(bytes);
  if (kind === 'plain' || depth > 3) return [{ name, bytes }];
  if (kind === 'zip' && WHOLE_DOCUMENT.test(name)) return [{ name, bytes }];
  // One level at a time (depth 3 is the unpacker's last), so a shapefile zip
  // inside another archive is seen before it is taken apart.
  const inner = await unpack(bytes, name, { maxBytes, depth: 3 });
  if (inner.some(IS_SHP)) {
    if (kind === 'zip') return [{ name: asZipName(name), bytes }];
    const parts = inner.filter((entry) => SHAPEFILE_PART.test(entry.name));
    const stem = baseName(inner.find(IS_SHP).name).replace(/\.shp$/i, '');
    const rest = inner.filter((entry) => !SHAPEFILE_PART.test(entry.name));
    const out = [{ name: `${stem}.zip`, bytes: storeZip(parts) }];
    for (const entry of rest)
      out.push(...(await openEntry(entry, maxBytes, depth)));
    return out;
  }
  const out = [];
  for (const entry of inner)
    out.push(...(await openEntry(entry, maxBytes, depth)));
  return out;
}

// An entry is opened further only when its name says so: a .rds or .zsav is
// compressed inside but read whole by its own reader.
const openEntry = (entry, maxBytes, depth) =>
  isCompressedName(entry.name)
    ? open(entry.bytes, entry.name, maxBytes, depth + 1)
    : [entry];

/**
 * The files in a picked file, each `{name, bytes}` (names keep their folders
 * inside the archive). A file whose name is not compressed comes back as
 * itself; one that turns out not to be compressed does too.
 * @param {Uint8Array} bytes
 * @param {string} name
 * @param {{maxBytes?: number}} [options] Most bytes to unpack in all.
 */
export async function openArchive(bytes, name, { maxBytes = 512e6 } = {}) {
  if (!isCompressedName(name)) return [{ name, bytes }];
  return open(bytes, name, maxBytes, 0);
}
