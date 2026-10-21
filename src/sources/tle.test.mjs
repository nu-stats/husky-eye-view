import assert from 'node:assert/strict';
import test from 'node:test';
import { noradIdFromSatnum, parseTleText, tleCatalogNumber } from './tle.js';

// Moved from God's Eye View's src/tools/queries/space.test.mjs (#767, #1101);
// Husky Eye View has no MCP query tools.

// Element sets published for 1 January 2024.
const TLE = `ISS (ZARYA)
1 25544U 98067A   24001.50000000  .00016717  00000-0  30270-3 0  9994
2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50377579432414
CSS (TIANHE)
1 48274U 21035A   24001.50000000  .00020137  00000-0  24481-3 0  9993
2 48274  41.4697 175.8913 0005643 312.8370 141.6893 15.61287398150000
`;

test('TLE parsing rejects pairs with mismatched catalog numbers and resumes', () => {
  const text = `SAT A
1 25544U 98067A   24001.50000000  .00016717  00000-0  30270-3 0  9994
2 48274  41.4697 175.8913 0005643 312.8370 141.6893 15.61287398150000
SAT B
1 48274U 21035A   24001.50000000  .00020137  00000-0  24481-3 0  9993
2 48274  41.4697 175.8913 0005643 312.8370 141.6893 15.61287398150000
`;
  const entries = parseTleText(text);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['SAT B'],
  );
  assert.equal(tleCatalogNumber(entries[0].line1), 48274);
  assert.equal(tleCatalogNumber(entries[0].line2), 48274);
});

test('TLE parsing accepts matching Alpha-5 pairs and rejects mismatched Alpha-5 pairs', () => {
  const text = `SAT MISMATCH
1 A0000U 98067A   24001.50000000  .00016717  00000-0  30270-3 0  9994
2 A0001  41.4697 175.8913 0005643 312.8370 141.6893 15.61287398150000
SAT ALPHA5
1 A0000U 98067A   24001.50000000  .00016717  00000-0  30270-3 0  9994
2 A0000  41.4697 175.8913 0005643 312.8370 141.6893 15.61287398150000
`;
  const entries = parseTleText(text);
  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['SAT ALPHA5'],
  );
  assert.equal(tleCatalogNumber(entries[0].line1), 100000);
  assert.equal(tleCatalogNumber(entries[0].line2), 100000);
});

test('TLE parsing rejects a pair whose catalog fields are malformed and resumes', () => {
  // Read as digits up to the first non-digit, both fields would be 2554.
  const text = `SAT MALFORMED
1 2554AU 98067A   24001.50000000  .00016717  00000-0  30270-3 0  9994
2 2554B  51.6416 247.4627 0006703 130.5360 325.0288 15.50377579432414
SAT HALF MALFORMED
1 2554AU 98067A   24001.50000000  .00016717  00000-0  30270-3 0  9994
2 02554  51.6416 247.4627 0006703 130.5360 325.0288 15.50377579432414
${TLE}`;
  assert.deepEqual(
    parseTleText(text).map((entry) => entry.name),
    ['ISS (ZARYA)', 'CSS (TIANHE)'],
  );
});

test('Alpha-5 catalog numbers decode, skipping I and O', () => {
  for (const [field, id] of [
    ['A0000', 100000],
    ['A0404', 100404],
    ['H9999', 179999],
    ['J0000', 180000],
    ['N9999', 229999],
    ['P0000', 230000],
    ['T0449', 270449],
    ['Z9999', 339999],
  ]) {
    assert.equal(noradIdFromSatnum(field), id, field);
    assert.equal(tleCatalogNumber(`1 ${field}U`), id, field);
  }
});

test('a digit catalog field reads as it did before', () => {
  assert.equal(noradIdFromSatnum('25544'), 25544);
  assert.equal(noradIdFromSatnum('00404'), 404);
  assert.equal(noradIdFromSatnum('  404'), 404);
  assert.equal(tleCatalogNumber('1 25544U'), 25544);
  assert.equal(tleCatalogNumber('1   404U'), 404);
  // An OMM satrec carries the number unpadded, past five digits.
  assert.equal(noradIdFromSatnum('100000'), 100000);
});

test('a malformed catalog field is no number', () => {
  for (const field of [
    'I0000',
    'O0000',
    'a0404',
    'A00',
    '2554A',
    '255 4',
    '-1234',
    '0x1F0',
    '1.5',
    '1e3',
    '',
    '     ',
  ]) {
    assert.ok(Number.isNaN(noradIdFromSatnum(field)), JSON.stringify(field));
    assert.equal(
      tleCatalogNumber(`1 ${field.padEnd(5)}U`),
      null,
      JSON.stringify(field),
    );
  }
  assert.ok(Number.isNaN(noradIdFromSatnum(undefined)));
});
