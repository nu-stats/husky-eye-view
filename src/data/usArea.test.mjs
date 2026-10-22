import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ringTouchesUs,
  US_AREA_RINGS,
  US_IMAGERY_BOXES,
  US_ISLAND_BOXES,
} from './usArea.js';

/** A closed square ring around [lon, lat], `half` degrees each way. */
const square = (lon, lat, half = 0.5) => [
  [lon - half, lat - half],
  [lon + half, lat - half],
  [lon + half, lat + half],
  [lon - half, lat + half],
  [lon - half, lat - half],
];

test('smoke over the US is kept: lower 48, Alaska, Hawaii, Puerto Rico, Virgin Islands', () => {
  for (const [name, lon, lat] of [
    ['Kansas', -98.5, 38.5],
    ['Boston', -71.06, 42.36],
    ['Florida Keys', -81.5, 24.7],
    ['Fairbanks', -147.7, 64.8],
    ['Kodiak', -153.4, 57.5],
    ['Big Island', -155.5, 19.6],
    ['Puerto Rico', -66.5, 18.2],
    ['St. Croix', -64.75, 17.75],
    ['Aleutians west of 180', 173.2, 52.9],
  ])
    assert.equal(ringTouchesUs(square(lon, lat, 0.2)), true, name);
});

test('smoke wholly in Canada, Mexico or at sea is dropped', () => {
  for (const [name, lon, lat, half = 0.4] of [
    ['Alberta', -114, 55],
    ['Quebec', -72, 48.5],
    ['Ontario north of Lake Superior', -86, 50],
    ['Chihuahua', -106.5, 28.5],
    ['Sonora', -110.5, 29.5],
    ['Monterrey', -100.3, 25.7],
    ['Yucatan', -89, 20.5],
    ['mid-Atlantic', -50, 35],
    ['Bahamas', -77.5, 24.5],
    ['Anegada, British Virgin Islands', -64.33, 18.73, 0.1],
    ['Chukotka', -172.5, 65.5],
  ])
    assert.equal(ringTouchesUs(square(lon, lat, half)), false, name);
});

test('a plume that crosses the border is kept whole', () => {
  // From British Columbia south into Washington.
  assert.equal(
    ringTouchesUs([
      [-121, 50.5],
      [-119, 50.5],
      [-119, 48.6],
      [-121, 48.6],
      [-121, 50.5],
    ]),
    true,
  );
  // A long thin plume from the Gulf to Chihuahua: every vertex is outside the
  // US, but its edges cross Texas.
  assert.equal(
    ringTouchesUs([
      [-94, 28],
      [-106, 30],
      [-106, 30.05],
      [-94, 28.05],
    ]),
    true,
  );
  // A plume larger than the lower 48: no vertex is in the US, the US is in it.
  assert.equal(ringTouchesUs(square(-98, 39, 30)), true);
});

test('degenerate rings are never US smoke', () => {
  assert.equal(ringTouchesUs(null), false);
  assert.equal(ringTouchesUs([]), false);
  assert.equal(
    ringTouchesUs([
      [-98, 38],
      [-97, 38],
    ]),
    false,
  );
});

test('the US area parts carry bounding boxes that hold them', () => {
  assert.ok(US_AREA_RINGS.length >= 9);
  for (const { ring, bbox } of US_AREA_RINGS) {
    assert.ok(ring.length >= 3);
    for (const [lon, lat] of ring) {
      assert.ok(lon >= bbox[0] && lon <= bbox[2]);
      assert.ok(lat >= bbox[1] && lat <= bbox[3]);
    }
  }
});

test('imagery boxes are valid, cover the island boxes, and never overlap', () => {
  for (const box of US_ISLAND_BOXES) assert.ok(US_IMAGERY_BOXES.includes(box));
  for (const [west, south, east, north] of US_IMAGERY_BOXES) {
    assert.ok(west < east && south < north);
    assert.ok(west >= -180 && east <= 180 && south >= -90 && north <= 90);
  }
  for (let i = 0; i < US_IMAGERY_BOXES.length; i++) {
    for (let j = i + 1; j < US_IMAGERY_BOXES.length; j++) {
      const a = US_IMAGERY_BOXES[i];
      const b = US_IMAGERY_BOXES[j];
      const overlap =
        Math.min(a[2], b[2]) > Math.max(a[0], b[0]) &&
        Math.min(a[3], b[3]) > Math.max(a[1], b[1]);
      assert.equal(overlap, false, `${a} overlaps ${b}`);
    }
  }
});
