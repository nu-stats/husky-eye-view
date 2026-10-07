import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { pickAnother } from './dogSurprise.js';

test('another photo is never the one just shown', () => {
  for (let previous = 0; previous < 5; previous += 1)
    for (const r of [0, 0.2, 0.5, 0.99])
      assert.notEqual(
        pickAnother(5, previous, () => r),
        previous,
      );
  assert.equal(pickAnother(1, 0), 0);
  assert.ok(pickAnother(3, -1, () => 0.99) < 3);
});

test('every listed photo is in public/dogs', () => {
  const list = JSON.parse(
    readFileSync(new URL('../../public/dogs/index.json', import.meta.url)),
  );
  assert.ok(list.length > 0);
  for (const name of list)
    assert.ok(
      readFileSync(new URL(`../../public/dogs/${name}`, import.meta.url))
        .length > 1000,
    );
});
