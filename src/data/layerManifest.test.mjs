import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LAYER_MANIFEST,
  REGISTERED_LAYER_IDS,
  RESEARCH_GROUP,
  layerManifestEntry,
} from './layerManifest.js';
import { LAYER_STATE_REGISTRY } from './layerState.js';

test('ids, share-link tokens and spoken names are each unique', () => {
  const ids = LAYER_MANIFEST.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  const tokens = LAYER_MANIFEST.map((entry) => entry.token);
  assert.equal(new Set(tokens).size, tokens.length);
  const aliases = LAYER_MANIFEST.flatMap((entry) => entry.aliases);
  assert.equal(new Set(aliases).size, aliases.length, 'an alias names one layer');
  for (const alias of aliases) assert.equal(alias, alias.toLowerCase());
});

test('the share-link registry is the manifest sorted by id', () => {
  assert.deepEqual(
    [...REGISTERED_LAYER_IDS],
    LAYER_MANIFEST.map((entry) => entry.id).sort(),
  );
  assert.deepEqual(
    LAYER_STATE_REGISTRY.map((entry) => entry.id),
    [...REGISTERED_LAYER_IDS],
  );
  for (const entry of LAYER_STATE_REGISTRY) {
    const source = layerManifestEntry(entry.id);
    assert.equal(entry.token, source.token);
    assert.equal(entry.disposition, source.disposition);
    assert.equal(entry.optionOwner, source.optionOwner);
  }
});

test('flags are used only where they mean something', () => {
  for (const entry of LAYER_MANIFEST) {
    if (entry.live) assert.ok(entry.id.startsWith('local-'), entry.id);
    if (entry.vintage)
      assert.ok(!entry.live, `${entry.id}: a live feed has no vintage`);
    if (entry.optionOwner)
      assert.ok(layerManifestEntry(entry.optionOwner), entry.id);
  }
  assert.ok(LAYER_MANIFEST.some((entry) => entry.group === RESEARCH_GROUP));
  // The project's own research groups come before the inherited live feeds.
  const groups = [
    ...new Set(LAYER_MANIFEST.map((entry) => entry.group).filter(Boolean)),
  ];
  assert.equal(groups[0], 'Life Expectancy & Health');
  assert.ok(groups.indexOf(RESEARCH_GROUP) < groups.indexOf('Live Feeds'));
});

test('every research group heading carries a plain-language note', async () => {
  const { LAYER_GROUP_NOTES } = await import('./layerManifest.js');
  const groups = new Set(LAYER_MANIFEST.map((entry) => entry.group));
  for (const group of [
    'Life Expectancy & Health',
    'People & Economy (Census)',
    'Internet Access Over Time',
    'Air & Green Space',
    RESEARCH_GROUP,
    'Fly, Drone & Walk',
  ]) {
    assert.ok(groups.has(group), group);
    assert.ok(LAYER_GROUP_NOTES[group]?.length > 10, group);
  }
  // Helicopters sit with the first-person views, not the live feeds.
  assert.equal(layerManifestEntry('lowflyers').group, 'Fly, Drone & Walk');
});