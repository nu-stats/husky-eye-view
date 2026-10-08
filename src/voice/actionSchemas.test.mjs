import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { GEV_ACTION_SCHEMAS, createActionTools } from './actionSchemas.js';
import { GEV_REALTIME_TOOLS } from '../../server/providers/openai/tools.js';
import { REGISTERED_LAYER_IDS } from '../data/layerState.js';
import { layerManifestEntry } from '../data/layerManifest.js';

// Every registered layer except those the manifest turns off (ships, for now).
const VOICE_LAYER_IDS = REGISTERED_LAYER_IDS.filter(
  (id) => !layerManifestEntry(id)?.off,
);

const stable = (value) =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => [key, stable(child)]),
        )
      : value;

test('the complete Realtime tool payload retains its pre-extraction contract and wording', () => {
  // The layer enums are the layer registry (pinned by the next test), so a
  // newly registered layer does not move this digest.
  const registry = VOICE_LAYER_IDS.join();
  const layerList = (key, value) =>
    Array.isArray(value) && value.join() === registry
      ? 'REGISTERED_LAYER_IDS'
      : value;
  const digest = createHash('sha256')
    .update(JSON.stringify(stable(GEV_REALTIME_TOOLS), layerList))
    .digest('hex');
  assert.equal(
    digest,
    // Updated 2026-10-04: start_ground_view (Walking / Drone views) and the
    // Curated Flights tools plan_curated_flight / control_curated_flight
    // (layers include the ACS 2020–2024 social measures). 2026-10-06: the
    // flight layers add the three segregation indices, then 'my-data' (the
    // user's uploaded file). 2026-10-07: generate_area_report (Area Reports).
    // 2026-10-06 (later): ships and Walking View off, so the frame-layers enum
    // drops 'ais-live-vessels' and start_ground_view offers only 'drone'.
    // 2026-10-07: run_stata_analysis and open_in_stata (Stata on this computer),
    // then spshape2dta / spmatrix contiguity weights in its description;
    // run_r_analysis and open_in_r (R on this computer); a layer choice for
    // all four Stata and R tools. Later: run_stata_analysis / run_r_analysis
    // take the user's words (request) for the plain-English translator.
    // 2026-10-08: run_spss_analysis and open_in_spss (SPSS on this computer).
    '6b044773064ce88d58b2b17920976a6617c3d5e60c18f35e03d681c0f488bfc6',
  );
});

test('every registered data layer is voice-controllable, including future ones', () => {
  for (const name of [
    'set_layer_visibility',
    'show_data_layers_menu',
    'get_entity_context',
  ]) {
    const schema = GEV_ACTION_SCHEMAS.find((item) => item.name === name);
    assert.deepEqual(
      [...schema.parameters.properties.layerId.enum],
      [...VOICE_LAYER_IDS],
      name,
    );
  }
});

test('descriptions customize wording without changing immutable shared arguments', () => {
  const descriptions = {
    fly_to_location: {
      description: 'Navigate',
      parameters: { properties: { query: { description: 'A place' } } },
    },
  };
  const tools = createActionTools(descriptions);
  const tool = tools.find((tool) => tool.name === 'fly_to_location');
  assert.equal(tool.description, 'Navigate');
  assert.equal(tool.parameters.properties.query.description, 'A place');
  assert.equal(tool.parameters.properties.query.type, 'string');
  tool.parameters.properties.query.type = 'number';
  assert.equal(
    createActionTools()[0].parameters.properties.query.type,
    'string',
  );
  assert.throws(() => {
    GEV_ACTION_SCHEMAS[0].parameters.properties.query.type = 'number';
  }, TypeError);
  assert.equal(
    JSON.stringify(GEV_ACTION_SCHEMAS).includes('"description"'),
    false,
  );
});

test('metadata cannot add tools, fields, types or enum values', () => {
  for (const descriptions of [
    { execute_shell: { description: 'not an action' } },
    {
      fly_to_location: {
        parameters: { properties: { description: 'new field' } },
      },
    },
    { fly_to_location: { $position: -1, description: 'invalid position' } },
    { fly_to_location: { name: 'other' } },
    {
      fly_to_location: {
        parameters: { properties: { arbitrary: { description: 'new field' } } },
      },
    },
    {
      fly_to_location: {
        parameters: { properties: { query: { type: 'number' } } },
      },
    },
    { fly_to_location: { parameters: { required: { 0: 'another' } } } },
    { fly_to_location: { description: { nested: 'invalid' } } },
  ])
    assert.throws(() => createActionTools(descriptions), TypeError);
});
