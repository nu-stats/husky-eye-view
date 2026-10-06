import test from 'node:test';
import assert from 'node:assert/strict';

import {
  blockOf,
  blockLabel,
  readAsuBlocks,
  readNtiaBlocks,
} from '../scripts/build-internet-history-layers.mjs';
import {
  areaSegregationSummary,
  asuCountySummary,
  ntiaStateSummary,
} from './data/infrastructure.js';
import { areaIndices } from '../scripts/build-segregation-layers.mjs';

test('county segregation uses every tract of the county, with the city minimums', () => {
  const tract = (black, white) => ({
    pop: black + white,
    black,
    white,
    asian: 0,
    hispanic: 0,
  });
  // Five tracts in county 17031 (fully separated pairs), two in 17043.
  const rows = new Map([
    ['17031000100', tract(600, 0)],
    ['17031000200', tract(600, 0)],
    ['17031000300', tract(0, 700)],
    ['17031000400', tract(0, 700)],
    ['17031000500', tract(0, 700)],
    ['17043000100', tract(2000, 2000)],
    ['17043000200', tract(2000, 2000)],
  ]);
  const byYear = { '00': rows, 10: rows, 24: rows };
  const counties = areaIndices(byYear, (t) => t.slice(0, 5));
  assert.equal(counties['17031'].bw24, 100);
  assert.equal(counties['17031'].tracts24, 5);
  // Too few tracts: no index, but the population is kept.
  assert.equal(counties['17043'].bw24, null);
  assert.equal(counties['17043'].pop24, 8000);
  const states = areaIndices(byYear, (t) => t.slice(0, 2));
  assert.equal(states['17'].tracts24, 7);
  assert.ok(states['17'].bw24 > 0 && states['17'].bw24 < 100);
});

test('county and state segregation cards list every year', () => {
  const card = areaSegregationSummary({
    name: 'Cook County, IL',
    seg_bw00: 82.2,
    seg_hw00: 62.5,
    seg_aw00: 44.2,
    seg_bw24: 77,
    seg_hw24: 56,
    seg_aw24: 43.5,
    seg_pop24: 5182063,
  });
  assert.equal(
    card,
    [
      'Cook County, IL — dissimilarity index (0–100):',
      '2000: Black–white 82.2 · Latino–white 62.5 · Asian–white 44.2',
      '2020–24: Black–white 77.0 · Latino–white 56.0 · Asian–white 43.5',
      'Population 2020–24: 5,182,063',
    ].join('\n'),
  );
  assert.match(
    areaSegregationSummary({}, 'This county'),
    /no segregation index/,
  );
});

test('survey years fall into five-year blocks from 2000 on', () => {
  assert.equal(blockOf(1998), null);
  assert.equal(blockOf(2000), 2000);
  assert.equal(blockOf(2003), 2000);
  assert.equal(blockOf(2009), 2005);
  assert.equal(blockOf(2013), 2010);
  assert.equal(blockOf(2019), 2015);
  assert.equal(blockOf(2023), 2020);
  assert.equal(blockLabel(2015), '2015–19');
});

test('NTIA adults 15+ are averaged per block with the SE of the mean', () => {
  const head =
    'dataset,variable,description,universe,usProp,usPropSE,MAProp,MAPropSE';
  const text = [
    head,
    'Nov 2021,internetUser,Uses the Internet,isAdult,0.8,0.002,0.82,0.012',
    'Nov 2023,internetUser,Uses the Internet,isAdult,0.83,0.002,0.84,0.016',
    // Other universes and pre-2000 surveys are ignored.
    'Nov 2023,internetUser,Uses the Internet,isPerson,0.83,0.002,0.99,0.01',
    'Dec 1998,internetUser,Uses the Internet,isAdult,0.3,0.002,0.31,0.01',
    'Oct 2010,homeInternetUser,At home,isAdult,0.7,0.002,0.75,,',
  ].join('\n');
  const ma = readNtiaBlocks(text).MA;
  assert.equal(ma.use_2020, 83);
  assert.equal(ma.use_2020_years, '2021, 2023');
  assert.equal(ma.use_2020_se, 1); // sqrt(1.2² + 1.6²) / 2
  assert.equal(ma.use_2000, undefined);
  assert.equal(ma.home_2010, 75);
  assert.equal(ma.home_2010_se, undefined);
});

test('ASU county broadband is averaged per block; 1997 is dropped', () => {
  const text = [
    'cfips,year,broadband',
    '25025,1997,0.1',
    '25025,2017,0.6',
    '25025,2018,0.8',
    '25025,2012,0.5',
  ].join('\n');
  const county = readAsuBlocks(text)['25025'];
  assert.equal(county.asu2015, 70);
  assert.equal(county.asu2015_years, '2017, 2018');
  assert.equal(county.asu2010, 50);
  assert.equal(county.asu2000, undefined);
});

test('state and county cards read the block values', () => {
  const state = {
    name: 'Massachusetts',
    use_2020: 82.7,
    use_2020_se: 0.87,
    use_2020_years: '2021, 2023',
    home_2020: 79.7,
    phone_2020: 79.6,
  };
  const card = ntiaStateSummary(2020, state);
  assert.match(
    card,
    /^2020–24: 82\.7% \(±1\.4\) of adults 15\+ in Massachusetts used the internet \(average of the 2021 and 2023 surveys\)\./,
  );
  assert.match(card, /at home 79\.7%/);
  assert.match(card, /use a mobile phone 79\.6%/);
  assert.match(
    ntiaStateSummary(2005, state),
    /No NTIA estimate for Massachusetts in 2005–09/,
  );
  assert.equal(
    asuCountySummary(2015, { asu2015: 70, asu2015_years: '2017, 2018' }),
    '2015–18: 70.0% of households had broadband at home (ASU estimates, 2017, 2018).',
  );
  assert.equal(
    asuCountySummary(2000, {}),
    'No ASU estimate for this county in 2000–04.',
  );
});
