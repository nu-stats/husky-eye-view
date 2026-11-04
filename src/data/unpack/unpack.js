// Opens compressed files people pick in a file box: .zip, .gz, .bz2, .xz, .zst, .tar and the combinations (.tar.gz,
// .tgz, .tar.bz2, .tar.xz, .tar.zst). The kind is told from the file's first bytes, not its name. Gzip and zip's usual
// "deflate" use the browser's own DecompressionStream; bzip2, xz, Zstandard and tar are read here. Checksums are
// checked, so a damaged file is refused rather than read wrong. No dependencies; runs in the browser and in Node.
import { bunzip2, isBzip2 } from './bunzip.js';
import { crc32 } from './crc32.js';
import { isXz, unxz } from './unxz.js';
import { isZstd, unzstd } from './unzstd.js';

export { crc32 };

// The extensions to add to a file box's accept list.
export const COMPRESSED_ACCEPT =
  '.zip,.gz,.tgz,.bz2,.tbz2,.tbz,.xz,.txz,.zst,.tzst,.tar';

const DEFAULT_MAX = 1.5e9;

export function kindOf(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b)
    return 'gzip';
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06)
  )
    return 'zip';
  if (isBzip2(bytes)) return 'bzip2';
  if (
    bytes.length >= 262 &&
    String.fromCharCode(...bytes.subarray(257, 262)) === 'ustar'
  )
    return 'tar';
  if (isXz(bytes)) return 'xz';
  if (isZstd(bytes)) return 'zstd';
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x37 &&
    bytes[1] === 0x7a &&
    bytes[2] === 0xbc &&
    bytes[3] === 0xaf
  )
    return '7z';
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x61 &&
    bytes[2] === 0x72 &&
    bytes[3] === 0x21
  )
    return 'rar';
  return 'plain';
}

async function inflate(bytes, format, maxBytes) {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream(format));
  const reader = stream.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error(
        `The unpacked file would be larger than ${Math.round(maxBytes / 1e6)} MB, more than a browser page can hold.`,
      );
    }
    parts.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const utf8 = new TextDecoder();

async function readZip(bytes, maxBytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The directory at the end lists every file; find its end record, searching back past a comment of up to 64 KB.
  let end = -1;
  for (
    let i = bytes.length - 22;
    i >= Math.max(0, bytes.length - 22 - 65535);
    i--
  ) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0)
    throw new Error(
      'The zip file is damaged or cut off (its list of files is missing).',
    );
  let count = view.getUint16(end + 10, true);
  let dirAt = view.getUint32(end + 16, true);
  // Zip64: more than 65,535 files or a directory past 4 GB.
  if (
    (count === 0xffff || dirAt === 0xffffffff) &&
    end >= 20 &&
    view.getUint32(end - 20, true) === 0x07064b50
  ) {
    const rec = Number(view.getBigUint64(end - 12, true));
    if (view.getUint32(rec, true) === 0x06064b50) {
      count = Number(view.getBigUint64(rec + 32, true));
      dirAt = Number(view.getBigUint64(rec + 48, true));
    }
  }
  const files = [];
  let at = dirAt;
  let total = 0;
  for (let k = 0; k < count; k++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50)
      throw new Error(
        'The zip file is damaged (its list of files is unreadable).',
      );
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    let size = view.getUint32(at + 20, true);
    let full = view.getUint32(at + 24, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    let local = view.getUint32(at + 42, true);
    const name = utf8.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    // Zip64 sizes and offsets live in an extra field.
    for (let e = at + 46 + nameLen; e + 4 <= at + 46 + nameLen + extraLen;) {
      const id = view.getUint16(e, true);
      const len = view.getUint16(e + 2, true);
      if (id === 0x0001) {
        let p = e + 4;
        if (full === 0xffffffff)
          ((full = Number(view.getBigUint64(p, true))), (p += 8));
        if (size === 0xffffffff)
          ((size = Number(view.getBigUint64(p, true))), (p += 8));
        if (local === 0xffffffff) local = Number(view.getBigUint64(p, true));
      }
      e += 4 + len;
    }
    at += 46 + nameLen + extraLen + commentLen;
    if (
      name.endsWith('/') ||
      name.startsWith('__MACOSX/') ||
      /(^|\/)\.DS_Store$/.test(name)
    )
      continue;
    if (flags & 1)
      throw new Error(
        `"${name}" in the zip file is password-protected. Unzip it on your computer first.`,
      );
    if (view.getUint32(local, true) !== 0x04034b50)
      throw new Error(
        `The zip file is damaged ("${name}" cannot be found in it).`,
      );
    const dataAt =
      local +
      30 +
      view.getUint16(local + 26, true) +
      view.getUint16(local + 28, true);
    const packed = bytes.subarray(dataAt, dataAt + size);
    total += full;
    if (total > maxBytes)
      throw new Error(
        `The unpacked files would be larger than ${Math.round(maxBytes / 1e6)} MB, more than a browser page can hold.`,
      );
    let data;
    if (method === 0) data = packed;
    else if (method === 8)
      data = await inflate(packed, 'deflate-raw', maxBytes);
    else if (method === 12) data = bunzip2(packed, { maxBytes });
    else if (method === 93) data = unzstd(packed, { maxBytes });
    else if (method === 95) data = await unxz(packed, { maxBytes });
    else
      throw new Error(
        `"${name}" in the zip file is packed a way this page cannot open (method ${method}). Unzip it on your computer first.`,
      );
    if (data.length !== full || crc32(data) !== crc)
      throw new Error(
        `The zip file is damaged ("${name}" failed its checksum).`,
      );
    files.push({ name, bytes: data });
  }
  return files;
}

function readTar(bytes) {
  const files = [];
  let longName = null;
  for (let at = 0; at + 512 <= bytes.length;) {
    const header = bytes.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const field = (from, len) =>
      utf8.decode(header.subarray(from, from + len)).replace(/\0.*$/s, '');
    const size = parseInt(field(124, 12).trim() || '0', 8);
    if (!Number.isFinite(size)) throw new Error('The tar file is damaged.');
    const type = String.fromCharCode(header[156]);
    const prefix = field(345, 155);
    let name =
      longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    longName = null;
    const data = bytes.subarray(at + 512, at + 512 + size);
    at += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') longName = utf8.decode(data).replace(/\0.*$/s, '');
    else if (type === 'x') {
      const path = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(utf8.decode(data));
      if (path) longName = path[1];
    } else if ((type === '0' || type === '\0') && !/(^|\/)\._/.test(name))
      files.push({ name, bytes: data });
  }
  return files;
}

const strip = (name, ...ends) => {
  for (const [end, to] of ends)
    if (name.toLowerCase().endsWith(end))
      return name.slice(0, -end.length) + to;
  return name;
};

// The files inside, each { name, bytes }. A plain file comes back as itself. Archives inside archives are opened too
// (a .tar.gz, or a .csv.gz inside a zip).
export async function unpack(
  bytes,
  name = 'file',
  { maxBytes = DEFAULT_MAX, depth = 0 } = {},
) {
  const kind = kindOf(bytes);
  if (kind === 'plain' || depth > 3) return [{ name, bytes }];
  if (kind === '7z' || kind === 'rar') {
    throw new Error(
      `"${name}" is a ${kind === '7z' ? '7-Zip' : 'RAR'} file, which this page cannot open. Unpack it on your computer first, or save it as .zip.`,
    );
  }
  let inner;
  if (kind === 'gzip')
    inner = [
      {
        name: strip(name, ['.tgz', '.tar'], ['.gz', '']),
        bytes: await inflate(bytes, 'gzip', maxBytes),
      },
    ];
  else if (kind === 'bzip2')
    inner = [
      {
        name: strip(name, ['.tbz2', '.tar'], ['.tbz', '.tar'], ['.bz2', '']),
        bytes: bunzip2(bytes, { maxBytes }),
      },
    ];
  else if (kind === 'xz')
    inner = [
      {
        name: strip(name, ['.txz', '.tar'], ['.xz', '']),
        bytes: await unxz(bytes, { maxBytes }),
      },
    ];
  else if (kind === 'zstd')
    inner = [
      {
        name: strip(name, ['.tzst', '.tar'], ['.zst', ''], ['.zstd', '']),
        bytes: unzstd(bytes, { maxBytes }),
      },
    ];
  else if (kind === 'zip') inner = await readZip(bytes, maxBytes);
  else inner = readTar(bytes);
  const out = [];
  for (const f of inner)
    out.push(
      ...(await unpack(f.bytes, f.name, { maxBytes, depth: depth + 1 })),
    );
  return out;
}

// The files worth offering for a box that wants some extensions (for example ['.csv', '.txt']): those that match, or,
// when none match, all of them, so a file with an unusual name can still be picked.
export function offered(files, extensions) {
  const match = files.filter((f) =>
    extensions.some((e) => f.name.toLowerCase().endsWith(e)),
  );
  return match.length ? match : files;
}
