// MapCraft ▸ Show in 3D: the scene's drawing settings are checked and become
// extruded polygons, columns, draped shapes and ground lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  MAX_SCENE_HEIGHT,
  craftSceneDataSource,
  craftSceneTitle,
  isCraftScene,
  readSceneStyle,
} from './craftScene.js';
import { loadGeoFile } from './geoFileImport.js';

const square = (x, y, d = 0.01) => [
  [x, y],
  [x + d, y],
  [x + d, y + d],
  [x, y + d],
  [x, y],
];

const SCENE = {
  type: 'FeatureCollection',
  mapcraft3d: { version: 1, title: 'Poverty\u0007 by tract', height: 'pct' },
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [
          square(-71.1, 42.3, 0.02),
          square(-71.095, 42.305, 0.005),
        ],
      },
      properties: {
        name: 'Tract 1',
        mc3d: {
          fill: '#fc8d59',
          opacity: 0.8,
          stroke: '#333333',
          height: 1500,
        },
        secret: 'never read',
      },
    },
    {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[square(-71, 42.3)], [square(-70.9, 42.3)]],
      },
      properties: { mc3d: { fill: '#91bfdb' } },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-71.05, 42.35] },
      properties: {
        name: 'Site',
        mc3d: { fill: '#ff0000', height: 300, radius: 40 },
      },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-71.04, 42.35] },
      properties: { mc3d: { fill: '#00ff00' } },
    },
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [-71, 42],
          [-71.01, 42.01],
        ],
      },
      properties: { mc3d: { stroke: '#0000ff', height: 99 } },
    },
  ],
};

const clone = (value) => JSON.parse(JSON.stringify(value));

test('only version 1 scenes are scenes', () => {
  assert.equal(isCraftScene(SCENE), true);
  assert.equal(isCraftScene({ ...SCENE, mapcraft3d: { version: 2 } }), false);
  assert.equal(
    isCraftScene({ type: 'FeatureCollection', features: [] }),
    false,
  );
  assert.equal(
    isCraftScene({ type: 'Feature', mapcraft3d: { version: 1 } }),
    false,
  );
  assert.equal(craftSceneTitle(SCENE), 'Poverty by tract');
  assert.equal(craftSceneTitle({ mapcraft3d: { title: 42 } }), '');
});

test('drawing settings are checked and clamped', () => {
  assert.deepEqual(readSceneStyle(undefined, '#123456'), {
    fill: '#123456',
    stroke: '#123456',
    opacity: 0.9,
    height: 0,
    radius: 25,
  });
  assert.deepEqual(
    readSceneStyle({
      fill: 'red; background: url(x)',
      stroke: '#ABCDEF',
      opacity: 7,
      height: 1e9,
      radius: -3,
    }),
    {
      fill: '#39d0ff',
      stroke: '#ABCDEF',
      opacity: 1,
      height: MAX_SCENE_HEIGHT,
      radius: 1,
    },
  );
  assert.equal(readSceneStyle({ height: -5 }).height, 0);
  assert.equal(readSceneStyle({ height: 'NaN' }).height, 0);
  assert.equal(readSceneStyle({ opacity: 'x' }).opacity, 0.9);
});

test('blocks stand on the ground, columns rise from it, the rest lies on it', () => {
  const source = craftSceneDataSource(clone(SCENE));
  const [block, flatA, flatB, column, dot, line] = source.entities.values;
  assert.equal(source.entities.values.length, 6);
  assert.equal(source.craftScene3d, true);
  // A tract with a hole, extruded relative to the terrain.
  assert.equal(block.name, 'Tract 1');
  assert.equal(block.properties, undefined);
  assert.equal(block.polygon.extrudedHeight.getValue(), 1500);
  assert.equal(
    block.polygon.extrudedHeightReference.getValue(),
    Cesium.HeightReference.RELATIVE_TO_GROUND,
  );
  assert.equal(
    block.polygon.heightReference.getValue(),
    Cesium.HeightReference.RELATIVE_TO_GROUND,
  );
  const hierarchy = block.polygon.hierarchy.getValue();
  assert.equal(hierarchy.positions.length, 4, 'closing vertex dropped');
  assert.equal(hierarchy.holes.length, 1);
  const color = block.polygon.material.color.getValue();
  assert.ok(Math.abs(color.alpha - 0.8) < 1e-9);
  // A MultiPolygon without a height: two draped parts.
  for (const part of [flatA, flatB]) {
    assert.equal(part.polygon.extrudedHeight, undefined);
    assert.equal(
      part.polygon.classificationType.getValue(),
      Cesium.ClassificationType.BOTH,
    );
  }
  // A column 300 m tall, centered 150 m up.
  assert.equal(column.cylinder.length.getValue(), 300);
  assert.equal(column.cylinder.topRadius.getValue(), 40);
  const c = Cesium.Cartographic.fromCartesian(
    column.position.getValue(Cesium.JulianDate.now()),
  );
  assert.ok(Math.abs(c.height - 150) < 1e-6);
  assert.equal(
    dot.point.heightReference.getValue(),
    Cesium.HeightReference.CLAMP_TO_GROUND,
  );
  // Lines stay on the ground whatever height they carry.
  assert.equal(line.polyline.clampToGround.getValue(), true);
  assert.equal(line.polyline.positions.getValue().length, 2);
});

test('the My files loader draws a scene in 3D and names it by its title', async () => {
  const loaded = await loadGeoFile(
    new File([JSON.stringify(SCENE)], 'Poverty 3D.geojson'),
    {
      viewer: {
        scene: {
          frameState: { mode: Cesium.SceneMode.SCENE3D },
          primitives: new Cesium.PrimitiveCollection(),
          globe: { getHeight: () => 10 },
        },
      },
    },
  );
  assert.equal(loaded.name, 'Poverty by tract (3D)');
  assert.equal(loaded.format, 'geojson');
  assert.equal(loaded.entityCount, 6);
  const values = loaded.dataSource.entities.values;
  assert.equal(values[0].polygon.extrudedHeight.getValue(), 1500);
  assert.ok(values.every((e) => e.properties === undefined));
  loaded.revoke();

  // A column-only file still counts as something to draw.
  const columns = clone(SCENE);
  columns.features = [SCENE.features[2]];
  const only = await loadGeoFile(
    new File([JSON.stringify(columns)], 'c.geojson'),
    {
      viewer: {
        scene: {
          frameState: { mode: Cesium.SceneMode.SCENE3D },
          primitives: new Cesium.PrimitiveCollection(),
          globe: { getHeight: () => 10 },
        },
      },
    },
  );
  assert.equal(only.entityCount, 1);
  only.revoke();
});
