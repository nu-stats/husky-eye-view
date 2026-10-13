import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { readDta, readRData, readSav } from './statRead.js';
import { gzipBytes, writeDta, writeRData, writeSav } from './statFiles.js';

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
);
const fixture = (name) =>
  new Uint8Array(readFileSync(path.join(FIXTURES, name)));
const day = (iso) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;
const ms = (iso) => Date.parse(`${iso}Z`);

/** What every haven fixture holds (text widths differ by format). */
function expectHavenData(
  t,
  { textWidth = 300, accents = true, labels = true } = {},
) {
  const col = (name) => t.columns.findIndex((c) => c.name === name);
  assert.equal(t.rows.length, 4);
  assert.deepEqual(
    t.rows.map((r) => r[col('id')]),
    [1, 2, 3, null],
  );
  assert.deepEqual(
    t.rows.map((r) => r[col('value')]),
    [1.5, null, -2.25, 1e10],
  );
  assert.equal(t.columns[col('value')].label, 'A value — with a label');
  assert.equal(
    t.rows[1][col('name')],
    accents ? 'São Paulo — ünï' : 'Sao Paulo',
  );
  assert.equal(t.rows[2][col('name')], null);
  assert.equal(t.rows[0][col('longtext')].length, textWidth);
  assert.equal(t.columns[col('when')].kind, 'date');
  assert.deepEqual(
    t.rows.map((r) => r[col('when')]),
    [day('2020-01-31'), null, day('1960-01-01'), day('1999-12-31')],
  );
  assert.equal(t.columns[col('stamp')].kind, 'datetime');
  assert.deepEqual(
    t.rows.map((r) => r[col('stamp')]),
    [ms('2021-06-01T12:30:00'), 0, null, ms('2000-02-29T23:59:59')],
  );
  const sex = t.columns[col('sex')];
  assert.deepEqual(Object.values(sex.valueLabels), ['Female', 'Male']);
  assert.deepEqual(
    t.rows.map((r) => r[col('sex')]),
    [1, 2, null, 2],
  );
  if (labels)
    assert.deepEqual(t.columns[col('grade')].valueLabels, {
      1: 'Low',
      2: 'Mid',
      3: 'High',
    });
  assert.equal(t.columns[col('grade')].label, 'Grade of the area');
}

test('Stata files from Stata 8 to 19 (formats 113–119) read with labels and dates', () => {
  for (const v of [8, 10, 11])
    expectHavenData(readDta(fixture(`haven-v${v}.dta`)), {
      textWidth: 244,
      accents: false,
    });
  for (const v of [13, 14, 15])
    expectHavenData(readDta(fixture(`haven-v${v}.dta`)));
});

test('SPSS files read uncompressed, compressed and as .zsav, long text joined', async () => {
  for (const f of ['haven-none.sav', 'haven-byte.sav', 'haven-z.zsav'])
    expectHavenData(await readSav(fixture(f)));
});

test('R .rds and .RData read; the .RData’s largest data frame is used', async () => {
  expectHavenData(await readRData(fixture('haven-d.rds')), { labels: false });
  const rdata = await readRData(fixture('haven-d.RData'));
  expectHavenData(rdata, { labels: false });
  assert.match(
    rdata.notes.join(' '),
    /2 data frames \(plain, other\); this is plain/,
  );
});

test('what the writers write, the readers read back, dates and labels included', async () => {
  const dataset = {
    title: 'Round trip',
    variables: [
      { name: 'geoid', label: 'GEOID', kind: 'string' },
      { name: 'rate', label: 'A rate — %', kind: 'numeric' },
      { name: 'when', label: 'Date', kind: 'date' },
      { name: 'at', label: 'Time', kind: 'datetime' },
      {
        name: 'code',
        label: 'Coded',
        kind: 'numeric',
        valueLabels: { 1: 'One', 2: 'Two' },
      },
    ],
    rows: [
      ['01001020100', 12.5, day('2024-02-29'), ms('2024-02-29T10:00:00'), 1],
      ['25025010405', null, null, null, 2],
    ],
  };
  const check = (t) => {
    assert.deepEqual(t.rows, dataset.rows);
    assert.deepEqual(
      t.columns.map((c) => c.kind),
      ['string', 'numeric', 'date', 'datetime', 'numeric'],
    );
    assert.equal(t.columns[1].label, 'A rate — %');
    assert.deepEqual(t.columns[4].valueLabels, { 1: 'One', 2: 'Two' });
  };
  check(readDta(writeDta(dataset).bytes));
  check(await readSav(writeSav(dataset).bytes));
  const r = await readRData(await gzipBytes(writeRData(dataset).bytes));
  assert.deepEqual(r.rows, dataset.rows);
  assert.deepEqual(
    r.columns.map((c) => c.kind),
    ['string', 'numeric', 'date', 'datetime', 'numeric'],
  );
  const rds = await readRData(
    gunzipSync(await gzipBytes(writeRData(dataset, { rds: true }).bytes)),
  );
  assert.deepEqual(rds.rows, dataset.rows);
});

test('damaged and unsupported files explain themselves', async () => {
  assert.throws(
    () => readDta(new Uint8Array([110, 2, 1, 0])),
    /Stata 7 or older/,
  );
  await assert.rejects(
    readSav(new TextEncoder().encode('not a sav file')),
    /not an SPSS/,
  );
  await assert.rejects(
    readRData(new TextEncoder().encode('BZh91AY&SY')),
    /bzip2 or xz/,
  );
  assert.throws(
    () => readDta(fixture('haven-v14.dta').slice(0, 600)),
    /ends early/,
  );
});
