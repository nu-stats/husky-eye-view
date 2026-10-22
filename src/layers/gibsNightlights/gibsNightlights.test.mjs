// Adapted from the Sheldondouthat/satwq-reality-os fork of God's Eye View
// (MIT); the US-only box tests are Husky Eye View's.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import {
  createGibsNightlightsLayer,
  createGibsNightlightsSource,
  NIGHTLIGHTS_COVERAGE,
} from './index.js';
import { US_IMAGERY_BOXES } from '../../data/usArea.js';

test('gibs-nightlights layer id/name/source wiring', () => {
  assert.equal(typeof createGibsNightlightsSource().getSnapshot, 'function');
  const layer = createGibsNightlightsLayer({ eventTarget: null });
  assert.equal(layer.id, 'gibs-nightlights');
  assert.equal(layer.name, 'Night Lights');
  assert.equal(layer.source, 'NASA GIBS · US only');
  assert.equal(layer.updateInterval, 6 * 3600 * 1000);
  const controls = layer.getRowControls();
  assert.match(controls.info, /2016.*US only/);
  assert.equal(controls.infoTitle, NIGHTLIGHTS_COVERAGE);
  assert.match(NIGHTLIGHTS_COVERAGE, /lower 48, Alaska, Hawaii, Puerto Rico/);
});

test('Black Marble tiles load only inside the US boxes', async () => {
  const added = [];
  const viewer = {
    imageryLayers: {
      add(imageryLayer) {
        added.push(imageryLayer);
      },
      remove(imageryLayer) {
        added.splice(added.indexOf(imageryLayer), 1);
      },
    },
  };
  const layer = createGibsNightlightsLayer({ eventTarget: null });
  layer.init(viewer);
  layer.enable(viewer);
  assert.equal(await layer.update(viewer), true);
  assert.equal(added.length, US_IMAGERY_BOXES.length);
  added.forEach((imageryLayer, index) => {
    const provider = imageryLayer.imageryProvider;
    assert.match(
      provider.url,
      /^https:\/\/gibs\.earthdata\.nasa\.gov\/wmts\/epsg3857\/best\/VIIRS_Black_Marble\/default\/2016-01-01\/GoogleMapsCompatible_Level8\/\{z\}\/\{y\}\/\{x\}\.png$/,
    );
    const expected = Cesium.Rectangle.fromDegrees(...US_IMAGERY_BOXES[index]);
    assert.ok(
      Cesium.Rectangle.equalsEpsilon(provider.rectangle, expected, 1e-9),
    );
    assert.ok(
      Cesium.Rectangle.equalsEpsilon(imageryLayer.rectangle, expected, 1e-9),
    );
  });
  // Nothing covers Europe, so Cesium requests no tile there.
  const paris = Cesium.Cartographic.fromDegrees(2.35, 48.85);
  assert.equal(
    added.some((imageryLayer) =>
      Cesium.Rectangle.contains(imageryLayer.rectangle, paris),
    ),
    false,
  );
  layer.destroy(viewer);
  assert.equal(added.length, 0);
});
