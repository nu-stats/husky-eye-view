import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUND_VIEW_SETTINGS,
  WALK_STEP_UP_M,
  clampGroundHeight,
  groundIntent,
  headingBlocked,
  isGroundViewMode,
  offsetPosition,
  walkStepAllowed,
} from './cockpitGroundView.js';
import {
  normalizeSnapshotFormat,
  snapshotScale,
  SNAPSHOT_FORMATS,
} from './viewCapture.js';

const RAD = Math.PI / 180;

test('held keys become forward, turn, climb and fast intents', () => {
  assert.deepEqual(groundIntent(new Set()), {
    forward: 0,
    turn: 0,
    climb: 0,
    fast: false,
  });
  assert.deepEqual(groundIntent(new Set(['w', 'd', 'e', 'shift'])), {
    forward: 1,
    turn: 1,
    climb: 1,
    fast: true,
  });
  // Opposite keys cancel rather than fight.
  assert.equal(groundIntent(new Set(['w', 's'])).forward, 0);
  assert.equal(groundIntent(new Set(['a'])).turn, -1);
  assert.equal(groundIntent(new Set(['q'])).climb, -1);
});

test('moving along a heading shifts latitude and longitude by meters', () => {
  const lat = 42.34 * RAD;
  const lon = -71.09 * RAD;
  const north = offsetPosition(lat, lon, 0, 111.32);
  assert.ok(Math.abs((north.latitude - lat) / RAD - 0.001) < 2e-6);
  assert.equal(north.longitude, lon);
  const east = offsetPosition(lat, lon, Math.PI / 2, 100);
  assert.ok(Math.abs(east.latitude - lat) < 1e-12);
  // 100 m east at 42.34° N is about 0.001215° of longitude.
  assert.ok(Math.abs((east.longitude - lon) / RAD - 0.001215) < 5e-6);
});

test('a walker steps down anything but up only a curb', () => {
  assert.equal(walkStepAllowed(10, 10.5), true);
  assert.equal(walkStepAllowed(10, 10 + WALK_STEP_UP_M), true);
  assert.equal(walkStepAllowed(10, 14), false, 'a wall stops you');
  assert.equal(walkStepAllowed(14, 2), true, 'stepping off a ledge is fine');
  assert.equal(walkStepAllowed(NaN, 30), true, 'unknown surface never blocks');
  assert.equal(walkStepAllowed(10, NaN), true);
});

test('a wall found ahead blocks that direction until the way clears', () => {
  assert.equal(headingBlocked(null, 0), false);
  assert.equal(headingBlocked(0, 0.3), true, 'still facing the wall');
  assert.equal(headingBlocked(0, Math.PI), false, 'backing away is free');
  assert.equal(headingBlocked(0, Math.PI / 2), false, 'side-stepping along it');
  // Angles wrap: 350° and 10° are 20° apart.
  assert.equal(headingBlocked(350 * RAD, 10 * RAD), true);
});

test('heights stay inside each mode’s range', () => {
  assert.equal(clampGroundHeight('walk', 0), 1.7);
  assert.equal(clampGroundHeight('walk', 50), 30);
  assert.equal(clampGroundHeight('drone', 2), 10);
  assert.equal(clampGroundHeight('drone', 500), 122);
  assert.equal(GROUND_VIEW_SETTINGS.drone.startHeightM, 60);
  assert.equal(isGroundViewMode('walk'), true);
  assert.equal(isGroundViewMode('flights'), false);
});

test('snapshots are PNG or JPG only, rendered up to a high-resolution width', () => {
  assert.deepEqual(Object.keys(SNAPSHOT_FORMATS), ['png', 'jpg']);
  assert.equal(normalizeSnapshotFormat('JPEG'), 'jpg');
  assert.equal(normalizeSnapshotFormat('jpg'), 'jpg');
  assert.equal(normalizeSnapshotFormat('heic'), 'png');
  assert.equal(normalizeSnapshotFormat(undefined), 'png');
  assert.equal(snapshotScale(1500), 2);
  assert.equal(snapshotScale(1000), 2.5, 'capped at 2.5× the screen');
  assert.equal(snapshotScale(3840), 1, 'a 4K screen is already sharp');
  assert.equal(snapshotScale(0), 1);
});
