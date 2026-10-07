import assert from 'node:assert/strict';
import test from 'node:test';
import { contiguityNeighbors, moransI } from './moran.js';

/** A rows × cols grid of unit squares, row by row. */
const grid = (rows, cols) => {
  const cells = [];
  for (let r = 0; r < rows; r += 1)
    for (let c = 0; c < cols; c += 1)
      cells.push({
        type: 'Polygon',
        coordinates: [
          [
            [c, r],
            [c + 1, r],
            [c + 1, r + 1],
            [c, r + 1],
            [c, r],
          ],
        ],
      });
  return cells;
};

test('queen neighbors share a corner, rook neighbors an edge', () => {
  const queen = contiguityNeighbors(grid(3, 3));
  const rook = contiguityNeighbors(grid(3, 3), { rook: true });
  assert.equal(queen[4].length, 8); // the center
  assert.equal(queen[0].length, 3); // a corner
  assert.equal(rook[4].length, 4);
  assert.equal(rook[0].length, 2);
  assert.deepEqual(rook[0], [1, 3]);
});

test('a checkerboard is perfectly negative with rook weights', () => {
  const values = [];
  for (let r = 0; r < 4; r += 1)
    for (let c = 0; c < 4; c += 1) values.push((r + c) % 2);
  const result = moransI(
    values,
    contiguityNeighbors(grid(4, 4), { rook: true }),
    { permutations: 99 },
  );
  assert.ok(Math.abs(result.I + 1) < 1e-12);
  assert.equal(result.expected, -1 / 15);
});

test('a smooth gradient clusters; its permutation test says so', () => {
  const cells = grid(10, 10);
  const values = cells.map((_, i) => i % 10); // the column number
  const result = moransI(values, contiguityNeighbors(cells));
  assert.ok(result.I > 0.6, `I = ${result.I}`);
  assert.ok(result.z > 5);
  assert.equal(result.pseudoP, 0.001);
  assert.equal(result.n, 100);
  assert.equal(result.islands, 0);
  // The scatter plot's least-squares slope is I.
  const xs = result.points.map((p) => p[0]);
  const ys = result.points.map((p) => p[1]);
  const slope =
    xs.reduce((a, x, i) => a + x * ys[i], 0) /
    xs.reduce((a, x) => a + x * x, 0);
  assert.ok(Math.abs(slope - result.I) < 1e-9);
});

test('the same seed gives the same pseudo p-value', () => {
  const cells = grid(6, 6);
  const values = cells.map((_, i) => (i * 7919) % 13);
  const a = moransI(values, contiguityNeighbors(cells));
  const b = moransI(values, contiguityNeighbors(cells));
  assert.equal(a.pseudoP, b.pseudoP);
});
