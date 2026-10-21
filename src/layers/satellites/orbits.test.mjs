import test from 'node:test';
import assert from 'node:assert/strict';
import { twoline2satrec } from 'satellite.js';
import { noradIdFromSatnum } from '../../sources/tle.js';
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

test('a satellite numbered above 99999 keeps its number and is found by it', () => {
  // The ISS set (1 January 2024) with its catalog field in Alpha-5: A0000 is
  // 100000 (God's Eye View #767). Number(satnum) was NaN for every such set.
  const line1 =
    '1 A0000U 98067A   24001.50000000  .00016717  00000-0  30270-3 0  9994';
  const line2 =
    '2 A0000  51.6416 247.4627 0006703 130.5360 325.0288 15.50377579432414';
  assert.ok(Number.isNaN(Number(twoline2satrec(line1, line2).satnum)));
  const state = { _catalog: new Map() };
  const orbits = createOrbits({ state, services: {}, parts: {}, source: {} });
  for (const entry of orbits.parseTLE(`ISS (ZARYA)\n${line1}\n${line2}`)) {
    const satrec = twoline2satrec(entry.line1, entry.line2);
    state._catalog.set(noradIdFromSatnum(satrec.satnum), {
      name: entry.name,
      satrec,
    });
  }
  assert.deepEqual([...state._catalog.keys()], [100000]);
  assert.deepEqual(orbits.resolveSatelliteForPass('100000'), {
    status: 'ok',
    noradId: 100000,
    name: 'ISS (ZARYA)',
  });
  // A pass over New York City is searched against the decoded number.
  const pass = orbits.getNextSatellitePass(100000, {
    latDeg: 40.7,
    lonDeg: -74,
    fromMs: Date.UTC(2024, 0, 1, 12),
  });
  assert.equal(pass.status, 'ok');
});
