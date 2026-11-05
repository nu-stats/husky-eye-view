import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync, gzipSync } from 'node:zlib';
import { bunzip2 } from './bunzip.js';
import { crc32, kindOf, offered, unpack } from './unpack.js';

// Husky Explorer's copy of this test builds zips with fflate. Husky Eye View has no fflate, so this writes the same
// small zips by hand: { name: bytes } or { name: [bytes, { level }] }; level 0 and folders are stored, the rest deflated.
const strToU8 = (s) => new TextEncoder().encode(s);
function zipSync(files) {
  const local = [];
  const central = [];
  let at = 0;
  for (const [name, spec] of Object.entries(files)) {
    const [data, { level = 6 } = {}] = Array.isArray(spec) ? spec : [spec];
    const store = level === 0 || name.endsWith('/');
    const packed = store
      ? data
      : new Uint8Array(deflateRawSync(data, { level }));
    const nameBytes = strToU8(name);
    const head = new Uint8Array(30 + nameBytes.length);
    const h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(8, store ? 0 : 8, true);
    h.setUint32(14, crc32(data), true);
    h.setUint32(18, packed.length, true);
    h.setUint32(22, data.length, true);
    h.setUint16(26, nameBytes.length, true);
    head.set(nameBytes, 30);
    const dir = new Uint8Array(46 + nameBytes.length);
    const d = new DataView(dir.buffer);
    d.setUint32(0, 0x02014b50, true);
    d.setUint16(4, 20, true);
    d.setUint16(6, 20, true);
    d.setUint16(10, store ? 0 : 8, true);
    d.setUint32(16, crc32(data), true);
    d.setUint32(20, packed.length, true);
    d.setUint32(24, data.length, true);
    d.setUint16(28, nameBytes.length, true);
    d.setUint32(42, at, true);
    dir.set(nameBytes, 46);
    local.push(head, packed);
    central.push(dir);
    at += head.length + packed.length;
  }
  const dirSize = central.reduce((n, p) => n + p.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, central.length, true);
  e.setUint16(10, central.length, true);
  e.setUint32(12, dirSize, true);
  e.setUint32(16, at, true);
  const parts = [...local, ...central, end];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}

// Made with the bzip2 command (1.0.8): a small CSV, and 30,000 lines that span two 900 KB blocks.
const SMALL_CSV = 'GEOID,value\n25025,1\n25017,2\n';
const SMALL_BZ2 =
  'QlpoOTFBWSZTWSXn2fUAAApdgAAQAARygAagogQDACAAMUNNMABE0GajEepitM4ujhVCNYRGZknxn4u5IpwoSBLz7PqA';
const TWO_BLOCKS_BZ2 =
  'QlpoOTFBWSZTWTHUrCUCtHVfgAAQQARSAA6giAAjDYcgMAFYAFBo0aDIDQoNGjQZAaBSqhoxDQGmTcQkl7EJJehCSWQhJLqISS4CEkshCSWQhJLMISSzEJJaRCSWkQklj2EJJeIhJLxEJJZCEktxCSW4Qkl9EJJaiEkthCSX4QklgISSwEJJaiEkthCSXQQklsISSxEJJZiEktxCSX8xQVkmU1l0vzDFABqj34AAEEAEUgAOoIgAIw2HIDABGAFBo0aDIDQoNGjQZAaBSqhoxDQGmTcSSexJJ6EkmQkk61Ek58RJJkJJMhJJmEkmYkk0qJJpUSTGokniokniokmIkk3Ekm4SSfRJJqJJNhJJ+EkmAkkwEkmokk2EknQSSbCSTESSZiSTcSSfxdyRThQkBcWaI8A=';
const b64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const text = (bytes) => new TextDecoder().decode(bytes);

// A tar archive built by hand: one 512-byte header (name, octal size, type, "ustar") and the data padded to 512.
function tar(files) {
  const parts = [];
  for (const [name, body] of files) {
    const data = strToU8(body);
    const h = new Uint8Array(512);
    h.set(strToU8(name), 0);
    h.set(strToU8(data.length.toString(8).padStart(11, '0')), 124);
    h[156] = 0x30;
    h.set(strToU8('ustar\0'), 257);
    parts.push(h, data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  parts.push(new Uint8Array(1024));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) (out.set(p, at), (at += p.length));
  return out;
}

test('bunzip2 reads files made by the bzip2 command, across blocks', () => {
  assert.equal(text(bunzip2(b64(SMALL_BZ2))), SMALL_CSV);
  const two = text(bunzip2(b64(TWO_BLOCKS_BZ2)));
  assert.equal(two, 'GEOID,value,25025,Suffolk County\n'.repeat(30000));
});

test('bunzip2 refuses a damaged file instead of returning wrong bytes', () => {
  const bad = b64(TWO_BLOCKS_BZ2);
  bad[60] ^= 0x04;
  assert.throws(() => bunzip2(bad), /damaged|ends too soon/);
  assert.throws(
    () => bunzip2(b64(SMALL_BZ2).subarray(0, 30)),
    /damaged|ends too soon/,
  );
  assert.throws(() => bunzip2(strToU8('not bzip2')), /not a \.bz2/);
});

test('bunzip2 stops at the size limit', () => {
  assert.throws(
    () => bunzip2(b64(TWO_BLOCKS_BZ2), { maxBytes: 1000 }),
    /larger than/,
  );
});

test('kindOf tells the kind from the first bytes, not the name', () => {
  assert.equal(kindOf(gzipSync('x')), 'gzip');
  assert.equal(kindOf(zipSync({ 'a.csv': strToU8('x') })), 'zip');
  assert.equal(kindOf(b64(SMALL_BZ2)), 'bzip2');
  assert.equal(kindOf(tar([['a.csv', 'x']])), 'tar');
  assert.equal(kindOf(strToU8('GEOID,value')), 'plain');
  assert.equal(
    kindOf(new Uint8Array([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])),
    'xz',
  );
});

test('unpack opens .gz, .bz2, .zip (stored and deflated), .tar and .tar.gz', async () => {
  assert.deepEqual(
    (await unpack(strToU8(SMALL_CSV), 'plain.csv')).map((f) => [
      f.name,
      text(f.bytes),
    ]),
    [['plain.csv', SMALL_CSV]],
  );
  assert.deepEqual(
    (await unpack(gzipSync(SMALL_CSV), 'data.csv.gz')).map((f) => [
      f.name,
      text(f.bytes),
    ]),
    [['data.csv', SMALL_CSV]],
  );
  assert.deepEqual(
    (await unpack(b64(SMALL_BZ2), 'small.csv.bz2')).map((f) => [
      f.name,
      text(f.bytes),
    ]),
    [['small.csv', SMALL_CSV]],
  );
  const zip = zipSync({
    'data/a.csv': [strToU8(SMALL_CSV.repeat(50)), { level: 6 }],
    'b.txt': [strToU8('hello'), { level: 0 }],
    'data/': new Uint8Array(0),
  });
  assert.deepEqual(
    (await unpack(zip, 'x.zip')).map((f) => [f.name, text(f.bytes)]),
    [
      ['data/a.csv', SMALL_CSV.repeat(50)],
      ['b.txt', 'hello'],
    ],
  );
  const t = tar([
    ['one.csv', SMALL_CSV],
    ['two.json', '{"a":1}'],
  ]);
  assert.deepEqual(
    (await unpack(t, 'x.tar')).map((f) => f.name),
    ['one.csv', 'two.json'],
  );
  assert.deepEqual(
    (await unpack(gzipSync(t), 'x.tgz')).map((f) => [f.name, text(f.bytes)]),
    [
      ['one.csv', SMALL_CSV],
      ['two.json', '{"a":1}'],
    ],
  );
  // A .csv.gz inside a zip is opened too.
  const nested = zipSync({ 'inner.csv.gz': gzipSync(SMALL_CSV) });
  assert.deepEqual(
    (await unpack(nested, 'outer.zip')).map((f) => [f.name, text(f.bytes)]),
    [['inner.csv', SMALL_CSV]],
  );
});

test('unpack refuses a damaged zip entry, a password-protected one and formats it cannot read', async () => {
  const zip = zipSync({ 'a.csv': [strToU8(SMALL_CSV), { level: 0 }] });
  const bad = zip.slice();
  bad[bad.indexOf(0x47)] = 0x48; // change one byte of the stored data ("G" of GEOID)
  await assert.rejects(() => unpack(bad, 'bad.zip'), /checksum/);
  const locked = zip.slice();
  const view = new DataView(locked.buffer);
  for (let i = 0; i < locked.length - 4; i++)
    if (view.getUint32(i, true) === 0x02014b50) view.setUint16(i + 8, 1, true);
  await assert.rejects(
    () => unpack(locked, 'locked.zip'),
    /password-protected/,
  );
  await assert.rejects(
    () =>
      unpack(
        new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0, 0]),
        'a.rar',
      ),
    /RAR file, which this page cannot open/,
  );
  await assert.rejects(
    () => unpack(zip.subarray(0, 20), 'cut.zip'),
    /damaged or cut off/,
  );
});

test('unpack stops at the size limit', async () => {
  await assert.rejects(
    () => unpack(gzipSync('x'.repeat(5000)), 'big.gz', { maxBytes: 1000 }),
    /larger than/,
  );
  await assert.rejects(
    () =>
      unpack(zipSync({ 'a.csv': strToU8('x'.repeat(5000)) }), 'big.zip', {
        maxBytes: 1000,
      }),
    /larger than/,
  );
});

test('crc32 gives the standard check value', () => {
  assert.equal(crc32(strToU8('123456789')), 0xcbf43926);
});

test('offered keeps the files that fit the box, or all of them when none do', () => {
  const files = [
    { name: 'readme.txt' },
    { name: 'data/a.CSV' },
    { name: 'b.csv' },
  ];
  assert.deepEqual(
    offered(files, ['.csv']).map((f) => f.name),
    ['data/a.CSV', 'b.csv'],
  );
  assert.deepEqual(offered(files, ['.json']).length, 3);
});
