import test from 'node:test';
import assert from 'node:assert/strict';
import {
  US_BOX,
  fitView,
  insideShape,
  legendRows,
  project,
  unproject,
  worldShape,
} from './flatMap.js';

test('the 2D map projects and unprojects (Web Mercator)', () => {
  for (const p of [
    [-71.09, 42.34],
    [-122.42, 37.77],
    [0, 0],
  ]) {
    const [lon, lat] = unproject(project(p));
    assert.ok(Math.abs(lon - p[0]) < 1e-9 && Math.abs(lat - p[1]) < 1e-9);
  }
  assert.deepEqual(project([-180, 0]), [0, 0.5]);
  // North is up.
  assert.ok(project([0, 45])[1] < project([0, 0])[1]);
});

test('the 2D map fits a box and finds the area under a point', () => {
  const view = fitView(US_BOX, 800, 500);
  const [x0, y1] = project([US_BOX[0], US_BOX[1]]);
  const [x1, y0] = project([US_BOX[2], US_BOX[3]]);
  // The box fills the width or the height, inside the padding.
  assert.ok((x1 - x0) * view.k <= 800 - 56 + 1e-6);
  assert.ok((y1 - y0) * view.k <= 500 - 56 + 1e-6);
  assert.ok(
    Math.abs((x1 - x0) * view.k - 744) < 1e-6 ||
      Math.abs((y1 - y0) * view.k - 444) < 1e-6,
  );
  // A square with a hole: inside the ring, not in the hole.
  const shape = worldShape({
    type: 'Polygon',
    coordinates: [
      [
        [-72, 41],
        [-70, 41],
        [-70, 43],
        [-72, 43],
        [-72, 41],
      ],
      [
        [-71.2, 41.8],
        [-70.8, 41.8],
        [-70.8, 42.2],
        [-71.2, 42.2],
        [-71.2, 41.8],
      ],
    ],
  });
  const at = (lon, lat) => insideShape(shape, ...project([lon, lat]));
  assert.equal(at(-71.6, 42.5), true);
  assert.equal(at(-71, 42), false);
  assert.equal(at(-69, 42), false);
});

test('the legend reads its quantile classes in words', () => {
  assert.deepEqual(
    legendRows([5, 10], ['a', 'b', 'c', 'd']).map((r) => [r.color, r.text]),
    [
      ['a', 'under 5'],
      ['b', '5 – under 10'],
      ['c', '10 and over'],
    ],
  );
});
