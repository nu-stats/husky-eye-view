import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { openArchive, storeZip } from './openArchive.js';
import {
  COMPRESSED_ACCEPT,
  acceptExtensions,
  isCompressedName,
  withCompressed,
} from './names.js';
import { unpack } from './unpack.js';
import { readZip, readZippedShapefile } from '../../curated/userData.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) =>
  new Uint8Array(readFileSync(join(here, 'fixtures', name)));
const u8 = (text) => new TextEncoder().encode(text);
const text = (bytes) => new TextDecoder().decode(bytes);
const CSV = 'GEOID,value\n25025,1\n25017,2\n';

function tar(files) {
  const parts = [];
  for (const [name, data] of files) {
    const h = new Uint8Array(512);
    h.set(u8(name), 0);
    h.set(u8(data.length.toString(8).padStart(11, '0')), 124);
    h[156] = 0x30;
    h.set(u8('ustar\0'), 257);
    parts.push(h, data, new Uint8Array((512 - (data.length % 512)) % 512));
  }
  parts.push(new Uint8Array(1024));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// A one-point shapefile (main file, index, attributes) in WGS 84.
function pointShapefile() {
  const shp = new Uint8Array(100 + 28);
  const v = new DataView(shp.buffer);
  v.setInt32(0, 9994);
  v.setInt32(24, shp.length / 2);
  v.setInt32(28, 1000, true);
  v.setInt32(32, 1, true);
  v.setInt32(100, 1);
  v.setInt32(104, 10);
  v.setInt32(108, 1, true);
  v.setFloat64(112, -71.09, true);
  v.setFloat64(120, 42.34, true);
  const shx = new Uint8Array(100 + 8);
  shx.set(shp.subarray(0, 100));
  new DataView(shx.buffer).setInt32(24, shx.length / 2);
  new DataView(shx.buffer).setInt32(100, 50);
  new DataView(shx.buffer).setInt32(104, 10);
  // dBASE III: one character field NAME (10 wide), one record.
  const dbf = new Uint8Array(32 + 32 + 1 + 11 + 1);
  const d = new DataView(dbf.buffer);
  dbf[0] = 3;
  d.setUint32(4, 1, true);
  d.setUint16(8, 32 + 32 + 1, true);
  d.setUint16(10, 11, true);
  dbf.set(u8('NAME'), 32);
  dbf[32 + 11] = 0x43;
  dbf[32 + 16] = 10;
  dbf[64] = 0x0d;
  dbf.set(u8(' Northeast '), 65);
  dbf[76] = 0x1a;
  return [
    ['tracts/pt.shp', shp],
    ['tracts/pt.shx', shx],
    ['tracts/pt.dbf', dbf],
    ['tracts/pt.prj', u8('GEOGCS["GCS_WGS_1984"]')],
  ].map(([name, bytes]) => ({ name, bytes }));
}

test('names: compressed extensions, accept lists widened once', () => {
  for (const name of [
    'a.zip',
    'a.csv.gz',
    'a.TGZ',
    'a.tar.zst',
    'a.xz',
    'a.tbz2',
  ])
    assert.ok(isCompressedName(name), name);
  for (const name of [
    'a.csv',
    'a.kmz',
    'a.xlsx',
    'a.rds',
    'a.zsav',
    'a.gzip.csv',
  ])
    assert.ok(!isCompressedName(name), name);
  const widened = withCompressed('.csv,.zip');
  assert.equal(widened.split(',').filter((e) => e === '.zip').length, 1);
  for (const ext of COMPRESSED_ACCEPT.split(','))
    assert.ok(widened.split(',').includes(ext), ext);
  assert.deepEqual(acceptExtensions('.do,text/plain, .R'), ['.do', '.r']);
});

test('storeZip writes a zip both zip readers take', async () => {
  const files = [
    { name: 'a.csv', bytes: u8(CSV) },
    { name: 'dir/b.txt', bytes: u8('hello') },
  ];
  const zip = storeZip(files);
  assert.deepEqual(
    (await unpack(zip, 'x.zip')).map((f) => [f.name, text(f.bytes)]),
    [
      ['a.csv', CSV],
      ['dir/b.txt', 'hello'],
    ],
  );
  const entries = readZip(zip);
  assert.equal(text(await entries[1].read()), 'hello');
});

test('openArchive opens single-file compression and archives of data files', async () => {
  assert.deepEqual(
    (await openArchive(gzipSync(CSV), 'data.csv.gz')).map((f) => [
      f.name,
      text(f.bytes),
    ]),
    [['data.csv', CSV]],
  );
  const two = storeZip([
    { name: 'a.csv', bytes: u8(CSV) },
    { name: 'b.csv', bytes: u8(CSV) },
  ]);
  assert.deepEqual(
    (await openArchive(two, 'two.zip')).map((f) => f.name),
    ['a.csv', 'b.csv'],
  );
  assert.deepEqual(
    (await openArchive(fixture('both.tar.xz'), 'both.tar.xz')).map(
      (f) => f.name,
    ),
    ['small.csv', 'gen.csv'],
  );
  // A plain file, or one whose name is not compressed, comes back as itself.
  const plain = u8(CSV);
  assert.equal((await openArchive(plain, 'a.csv'))[0].bytes, plain);
  const gzipped = gzipSync(CSV);
  assert.equal((await openArchive(gzipped, 'model.rds'))[0].bytes, gzipped);
});

test('openArchive keeps a zipped shapefile whole, wherever it is', async () => {
  const parts = pointShapefile();
  const zip = storeZip(parts);
  const [kept] = await openArchive(zip, 'tracts.zip');
  assert.equal(kept.bytes, zip);
  assert.equal(kept.name, 'tracts.zip');
  const [fromGz] = await openArchive(gzipSync(zip), 'tracts.zip.gz');
  assert.equal(fromGz.name, 'tracts.zip');
  assert.deepEqual(fromGz.bytes, zip);
  const outer = storeZip([
    { name: 'inner/tracts.zip', bytes: zip },
    { name: 'notes.csv', bytes: u8(CSV) },
  ]);
  assert.deepEqual(
    (await openArchive(outer, 'outer.zip')).map((f) => f.name),
    ['inner/tracts.zip', 'notes.csv'],
  );
  const shape = await readZippedShapefile(fromGz.bytes);
  assert.equal(shape.features.length, 1);
  assert.deepEqual(shape.features[0].geometry.coordinates, [-71.09, 42.34]);
  assert.equal(shape.features[0].properties.NAME, 'Northeast');
});

test('openArchive puts shapefile parts from a tar into one zip', async () => {
  const tarred = tar([
    ...pointShapefile().map((p) => [p.name, p.bytes]),
    ['readme.txt', u8('about')],
  ]);
  const files = await openArchive(gzipSync(tarred), 'tracts.tar.gz');
  assert.deepEqual(
    files.map((f) => f.name),
    ['pt.zip', 'readme.txt'],
  );
  const shape = await readZippedShapefile(files[0].bytes);
  assert.equal(shape.features[0].properties.NAME, 'Northeast');
});

test('openArchive keeps KMZ and Excel files inside an archive whole', async () => {
  const kmz = storeZip([{ name: 'doc.kml', bytes: u8('<kml/>') }]);
  const outer = storeZip([
    { name: 'map.kmz', bytes: kmz },
    { name: 'book.xlsx', bytes: kmz },
  ]);
  const files = await openArchive(outer, 'outer.zip');
  assert.deepEqual(
    files.map((f) => f.name),
    ['map.kmz', 'book.xlsx'],
  );
  assert.deepEqual(files[0].bytes, kmz);
});
