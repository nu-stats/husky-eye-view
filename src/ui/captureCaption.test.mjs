import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  captionLayerNames,
  captionLayerText,
  captionLines,
  captureFileName,
  captureTimestamp,
  cockpitViewLabel,
  placeSlug,
} from './captureCaption.js';
import {
  captionStripHeight,
  clipExtension,
  formatClipTime,
  pickClipType,
} from './viewCapture.js';

const DATE = new Date(2026, 9, 4, 14, 32, 7);

test('timestamps and file names use local time and a place slug', () => {
  assert.equal(captureTimestamp(DATE), '2026-10-04 14:32');
  assert.equal(placeSlug('Roxbury, Boston, MA'), 'roxbury-boston-ma');
  assert.equal(placeSlug('Pérez Art Museum'), 'perez-art-museum');
  assert.equal(
    captureFileName({
      place: 'Roxbury, Boston, MA',
      date: DATE,
      extension: 'png',
    }),
    'husky-eye-view_roxbury-boston-ma_2026-10-04_143207.png',
  );
  // No place yet (still resolving): the name still says when it was taken.
  assert.equal(
    captureFileName({ place: '', date: DATE, extension: '.mp4' }),
    'husky-eye-view_2026-10-04_143207.mp4',
  );
});

test('the strip names at most four layers, then a count', () => {
  assert.equal(captionLayerText([]), '');
  assert.equal(captionLayerText(['A', 'B']), 'Layers: A, B');
  assert.equal(
    captionLayerText(['A', 'B', 'C', 'D', 'E', 'F']),
    'Layers: A, B, C, D +2 more',
  );
});

test('only map-data layers are named, not live feeds or tools', () => {
  assert.deepEqual(
    captionLayerNames([
      { name: 'Live Flights', group: 'Live Feeds' },
      { name: 'Life Expectancy (tracts) ', group: 'Neighborhood Data (US)' },
      { name: 'Radio', group: 'Utilities' },
      { name: 'GVA 2015', group: 'Research Data' },
      { name: 'Ungrouped', group: '' },
    ]),
    ['Life Expectancy (tracts)', 'GVA 2015'],
  );
});

test('caption lines read view first, then place, time and layers', () => {
  assert.deepEqual(
    captionLines({
      view: 'HELICOPTER N835DH · 650 FT',
      place: 'Roxbury, Boston',
      date: DATE,
      layers: ['Life Expectancy'],
    }),
    [
      'HUSKY EYE VIEW · HELICOPTER N835DH · 650 FT',
      'Roxbury, Boston · 2026-10-04 14:32 · Layers: Life Expectancy',
    ],
  );
  assert.deepEqual(captionLines({ date: DATE }), [
    'HUSKY EYE VIEW',
    '2026-10-04 14:32',
  ]);
});

test('the cockpit label names the aircraft family, id and altitude', () => {
  assert.equal(cockpitViewLabel(null), 'COCKPIT');
  assert.equal(
    cockpitViewLabel({
      layerId: 'lowflyers',
      klass: 'helicopter',
      callsign: 'N835DH',
      altitudeM: 198.12,
    }),
    'HELICOPTER N835DH · 650 FT',
  );
  assert.equal(
    cockpitViewLabel({ layerId: 'lowflyers', registration: 'N12345' }),
    'LOW FLYER N12345',
  );
  assert.equal(
    cockpitViewLabel({
      layerId: 'flights',
      callsign: 'DAL123',
      altitudeM: 10668,
    }),
    'AIRCRAFT DAL123 · 35,000 FT',
  );
  assert.equal(
    cockpitViewLabel({ layerId: 'military', icao24: 'ae1234', onGround: true }),
    'MILITARY AIRCRAFT ae1234 · 0 FT',
  );
});

test('walking and drone views say so, with height above the ground', () => {
  assert.equal(
    cockpitViewLabel({ layerId: 'walk', altitudeM: 1.7 }),
    'WALKING VIEW · 6 FT ABOVE GROUND',
  );
  assert.equal(
    cockpitViewLabel({ layerId: 'drone', altitudeM: 60 }),
    'DRONE VIEW · 197 FT ABOVE GROUND',
  );
});

test('clips prefer MP4 and fall back to WebM, or report none', () => {
  assert.equal(
    pickClipType(() => true),
    'video/mp4;codecs=avc1.640028',
  );
  assert.equal(
    pickClipType((type) => type.startsWith('video/webm')),
    'video/webm;codecs=vp9',
  );
  assert.equal(
    pickClipType(() => false),
    null,
  );
  assert.equal(clipExtension('video/mp4;codecs=avc1.64002a'), 'mp4');
  assert.equal(clipExtension('video/webm;codecs=vp9'), 'webm');
});

test('the strip scales with the frame and the clock shows the limit', () => {
  assert.equal(captionStripHeight(480), 40);
  assert.equal(captionStripHeight(1080), 65);
  assert.equal(captionStripHeight(2160), 130);
  assert.equal(formatClipTime(7.9), '0:07 / 1:00');
  assert.equal(formatClipTime(65, 90), '1:05 / 1:30');
});
