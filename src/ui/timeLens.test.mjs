import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_LENS_RADIUS,
  TIME_LENS_BASE_LAYER,
  TIME_LENS_LAYERS,
  clampLensRadius,
  lensClipPath,
  timeLensLabel,
} from './timeLens.js';
import { REGISTERED_LAYER_IDS } from '../data/layerState.js';

test('the lens clip path is a circle in whole pixels', () => {
  assert.equal(lensClipPath(452.4, 577.6, 215.2), 'circle(215px at 452px 578px)');
});

test('the lens radius stays between the minimum and 45% of the window', () => {
  assert.equal(clampLensRadius(10, 1200, 900), MIN_LENS_RADIUS);
  assert.equal(clampLensRadius(1000, 1200, 900), 405);
  assert.equal(clampLensRadius(200, 1200, 900), 200);
  // A tiny window still allows the minimum.
  assert.equal(clampLensRadius(500, 100, 100), MIN_LENS_RADIUS);
});

test('the lens shows registered layers of today over the HOLC map', () => {
  assert.equal(TIME_LENS_BASE_LAYER, 'local-holc-redlining');
  assert.ok(TIME_LENS_LAYERS.length >= 10);
  for (const [id, label] of TIME_LENS_LAYERS) {
    assert.ok(REGISTERED_LAYER_IDS.includes(id), id);
    assert.notEqual(id, TIME_LENS_BASE_LAYER);
    assert.equal(timeLensLabel(id), label);
  }
  assert.equal(TIME_LENS_LAYERS[0][0], 'local-acs-poverty');
  assert.equal(timeLensLabel('unknown-layer'), 'unknown-layer');
});
