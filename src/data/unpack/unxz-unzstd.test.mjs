import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { unpack } from './unpack.js';
import { unxz } from './unxz.js';
import { unzstd, xxh64 } from './unzstd.js';

// The files in fixtures/ were made with XZ Utils 5.8.3 and the Zstandard CLI 1.5.7 from these two texts:
//   s64.xz, s32.xz, s256.xz   xz -C crc64 / crc32 / sha256 small.csv
//   gen.xz                    xz --block-size=40000 gen.csv (two blocks)
//   s.zst, two.zst            zstd small.csv; two.zst is s.zst twice (two frames)
//   gen1.zst, gen19.zst, gen22.zst   zstd -1 / -19 --no-check / --ultra -22 gen.csv
//   both.tar.xz, both.tar.zst   tar --format=ustar of small.csv and gen.csv, then xz / zstd
const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) =>
  new Uint8Array(readFileSync(join(here, 'fixtures', name)));
const text = (bytes) => new TextDecoder().decode(bytes);
const SMALL = 'GEOID,value\n25025,1\n25017,2\n';
let GEN = '';
for (let i = 0; i < 4000; i++)
  GEN += `${25000 + ((i * 37) % 211)},${(i * 7919) % 1009},county ${i % 13}\n`;

test('unxz reads files made by xz with each kind of check, and across blocks', async () => {
  for (const f of ['s64.xz', 's32.xz', 's256.xz'])
    assert.equal(text(await unxz(fixture(f))), SMALL, f);
  assert.equal(text(await unxz(fixture('gen.xz'))), GEN);
});

test('unxz refuses a damaged or cut-off file instead of returning wrong bytes', async () => {
  const bad = fixture('gen.xz');
  bad[5000] ^= 0x08;
  await assert.rejects(() => unxz(bad), /damaged/);
  await assert.rejects(
    () => unxz(fixture('gen.xz').subarray(0, 4000)),
    /damaged/,
  );
  const flipped = fixture('s64.xz');
  flipped[flipped.length - 20] ^= 0x01; // inside the CRC-64 of the only block
  await assert.rejects(() => unxz(flipped), /damaged/);
  await assert.rejects(
    () => unxz(new TextEncoder().encode('not xz')),
    /not an \.xz/,
  );
  await assert.rejects(
    () => unxz(fixture('gen.xz'), { maxBytes: 1000 }),
    /larger than/,
  );
});

test('unzstd reads files made by zstd at fast, high and ultra levels, with and without a checksum, and two frames', () => {
  assert.equal(text(unzstd(fixture('s.zst'))), SMALL);
  assert.equal(text(unzstd(fixture('two.zst'))), SMALL + SMALL);
  for (const f of ['gen1.zst', 'gen19.zst', 'gen22.zst'])
    assert.equal(text(unzstd(fixture(f))), GEN, f);
});

test('unzstd refuses a damaged or cut-off file instead of returning wrong bytes', () => {
  const bad = fixture('gen1.zst');
  bad[9000] ^= 0x10;
  assert.throws(() => unzstd(bad), /damaged/);
  assert.throws(() => unzstd(fixture('gen1.zst').subarray(0, 9000)), /damaged/);
  assert.throws(
    () => unzstd(new TextEncoder().encode('not zstd')),
    /not a \.zst/,
  );
  assert.throws(
    () => unzstd(fixture('gen1.zst'), { maxBytes: 1000 }),
    /larger than/,
  );
});

test('xxh64 gives the published check values', () => {
  assert.equal(xxh64(new Uint8Array(0)), 0xef46db3751d8e999n);
  assert.equal(xxh64(new TextEncoder().encode('a')), 0xd24ec4f1a98c6e5bn);
  assert.equal(xxh64(new TextEncoder().encode('abc')), 0x44bc2cf5ad770999n);
});

test('unpack opens .xz, .zst, .tar.xz and .tar.zst and names what is inside', async () => {
  assert.deepEqual(
    (await unpack(fixture('s64.xz'), 'small.csv.xz')).map((f) => [
      f.name,
      text(f.bytes),
    ]),
    [['small.csv', SMALL]],
  );
  assert.deepEqual(
    (await unpack(fixture('s.zst'), 'small.csv.zst')).map((f) => [
      f.name,
      text(f.bytes),
    ]),
    [['small.csv', SMALL]],
  );
  for (const f of ['both.tar.xz', 'both.tar.zst']) {
    const files = await unpack(fixture(f), f);
    assert.deepEqual(
      files.map((x) => x.name),
      ['small.csv', 'gen.csv'],
      f,
    );
    assert.equal(text(files[1].bytes), GEN);
  }
  await assert.rejects(
    () =>
      unpack(
        new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4]),
        'a.7z',
      ),
    /7-Zip/,
  );
});
