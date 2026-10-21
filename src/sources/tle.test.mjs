import assert from 'node:assert/strict';
import test from 'node:test';
import { noradIdFromSatnum, tleCatalogNumber } from './tle.js';

// Moved from God's Eye View's src/tools/queries/space.test.mjs (#767);
// Husky Eye View has no MCP query tools.

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
