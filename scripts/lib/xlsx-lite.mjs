/**
 * Minimal dependency-free .xlsx reader for the migration-flow builder
 * (scripts/build-migration-flows.mjs). Reads values only (shared strings,
 * inline strings, numbers), which is all the UN DESA and KNOMAD workbooks
 * need. Adapted from uxhimanshuk/ground-view (MIT), scripts/lib/xlsx-lite.mjs.
 */
import { inflateRawSync } from 'node:zlib';

function readZipEntries(buffer) {
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buffer.readUInt16LE(eocd + 10);
  let p = buffer.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buffer.readUInt32LE(p) !== 0x02014b50) throw new Error('Bad zip');
    const method = buffer.readUInt16LE(p + 10);
    const compressedSize = buffer.readUInt32LE(p + 20);
    const nameLength = buffer.readUInt16LE(p + 28);
    const extraLength = buffer.readUInt16LE(p + 30);
    const commentLength = buffer.readUInt16LE(p + 32);
    const localOffset = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLength);
    entries.set(name, { method, compressedSize, localOffset });
    p += 46 + nameLength + extraLength + commentLength;
  }
  return {
    has: (name) => entries.has(name),
    read(name) {
      const e = entries.get(name);
      if (!e) throw new Error(`Missing zip entry: ${name}`);
      const o = e.localOffset;
      const start =
        o + 30 + buffer.readUInt16LE(o + 26) + buffer.readUInt16LE(o + 28);
      const raw = buffer.subarray(start, start + e.compressedSize);
      return e.method === 0 ? raw : inflateRawSync(raw);
    },
  };
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, e) => {
    if (e[0] === '#')
      return String.fromCodePoint(
        e[1] === 'x' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1)),
      );
    return ENTITIES[e] ?? m;
  });
}

function columnIndex(ref) {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function parseSharedStrings(xml) {
  const out = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    let text = '';
    for (const t of m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) text += t[1];
    out.push(decode(text));
  }
  return out;
}

/**
 * @param {Buffer} buffer Workbook bytes.
 * @returns {{sheetNames: string[], rows(name: string): Generator<Array<string|number|undefined>>}}
 */
export function openWorkbook(buffer) {
  const zip = readZipEntries(buffer);
  const text = (name) => zip.read(name).toString('utf8');
  const workbook = text('xl/workbook.xml');
  const rels = text('xl/_rels/workbook.xml.rels');
  const targetById = new Map();
  for (const m of rels.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = /\bId="([^"]*)"/.exec(m[1])?.[1];
    const target = /\bTarget="([^"]*)"/.exec(m[1])?.[1];
    if (id && target)
      targetById.set(id, target.replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/'));
  }
  const sheets = new Map();
  for (const m of workbook.matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = /\bname="([^"]*)"/.exec(m[1])?.[1];
    const rid = /\br:id="([^"]*)"/.exec(m[1])?.[1];
    if (name && rid) sheets.set(decode(name), targetById.get(rid));
  }
  const shared = zip.has('xl/sharedStrings.xml')
    ? parseSharedStrings(text('xl/sharedStrings.xml'))
    : [];
  return {
    sheetNames: [...sheets.keys()],
    *rows(name) {
      const file = sheets.get(name);
      if (!file) throw new Error(`No such sheet: ${name}`);
      const xml = text(file);
      for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
        const row = [];
        for (const c of rowMatch[1].matchAll(
          /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
        )) {
          const attrs = c[1];
          const body = c[2];
          if (body == null) continue;
          const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
          if (!ref) continue;
          const type = /\bt="([^"]*)"/.exec(attrs)?.[1];
          let value;
          if (type === 'inlineStr') {
            value = decode(
              [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
                .map((t) => t[1])
                .join(''),
            );
          } else {
            const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
            if (v == null) continue;
            if (type === 's') value = shared[Number(v)];
            else if (type === 'str') value = decode(v);
            else if (type === 'b' || type === 'e') value = v;
            else value = Number(v);
          }
          row[columnIndex(ref)] = value;
        }
        yield row;
      }
    },
  };
}
