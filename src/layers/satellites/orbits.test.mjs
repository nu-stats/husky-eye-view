import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrbits } from './orbits.js';

const ISS = [
  'ISS (ZARYA)',
  '1 25544U 98067A   26286.50000000  .00016717  00000-0  10270-3 0  9001',
  '2 25544  51.6400 208.9163 0006317  69.9862  25.2906 15.50000000 10001',
];
const HUBBLE = [
  'HST',
  '1 20580U 90037B   26286.50000000  .00000800  00000-0  40000-4 0  9002',
  '2 20580  28.4700 100.0000 0002000 100.0000 260.0000 15.10000000 10002',
];

test('a TLE set missing a line does not drop the valid sets after it', () => {
  const { parseTLE } = createOrbits({
    state: {},
    services: {},
    parts: {},
    source: {},
  });
  // A broken set (its line 2 is missing) before two good ones: stepping by
  // three lines lost both (God's Eye View #936).
  const text = [
    'BROKEN SAT',
    '1 99999U 00000A   26286.50000000  .00000000  00000-0  00000-0 0  9003',
    ...ISS,
    ...HUBBLE,
  ].join('\n');
  assert.deepEqual(
    parseTLE(text).map((entry) => entry.name),
    ['ISS (ZARYA)', 'HST'],
  );
  assert.deepEqual(parseTLE([...ISS, ...HUBBLE].join('\n')).length, 2);
});
