// Census outlines for ID-only uploads are fetched once and kept in a bounded,
// least-recently-used cache, so a long session does not hold every county.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  USER_SHAPES_CACHE_LIMIT,
  _resetUserShapesForTest,
  _userShapesCachedPathsForTest,
  stateShapes,
  tractShapes,
} from './userShapes.js';

beforeEach(() => _resetUserShapesForTest());

function fakeFetch() {
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(String(url));
    const geoid = String(url).split('/').pop().replace('.geojsonl', '');
    return {
      ok: true,
      text: async () =>
        `${JSON.stringify({ properties: { geoid }, geometry: null })}\n`,
    };
  };
  return { fetched, fetchImpl };
}

test('a file is fetched once and served from the cache after', async () => {
  const { fetched, fetchImpl } = fakeFetch();
  const first = await stateShapes(fetchImpl);
  const second = await stateShapes(fetchImpl);
  assert.equal(fetched.length, 1);
  assert.deepEqual([...first.keys()], [...second.keys()]);
});

test('the cache is bounded and drops the least recently used file first', async () => {
  const { fetched, fetchImpl } = fakeFetch();
  await stateShapes(fetchImpl);
  for (let i = 0; i < USER_SHAPES_CACHE_LIMIT; i++) {
    await tractShapes(String(10000 + i), fetchImpl);
    // Every flight reads the state file first, which keeps it fresh.
    if (i === USER_SHAPES_CACHE_LIMIT / 2) await stateShapes(fetchImpl);
  }
  const paths = _userShapesCachedPathsForTest();
  assert.equal(paths.length, USER_SHAPES_CACHE_LIMIT);
  assert.ok(paths.includes('states/states.geojsonl'), 'recently used stays');
  assert.ok(!paths.includes('tracts-2020/10000.geojsonl'), 'oldest evicted');
  const before = fetched.length;
  await tractShapes('10000', fetchImpl);
  assert.equal(fetched.length, before + 1, 'an evicted file is fetched again');
});
