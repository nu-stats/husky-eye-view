import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RESIDUAL_RAMP,
  geographyOf,
  legendRows,
  mapChoices,
  modelLines,
  parseMapCsv,
  residualBreaks,
  sessionTable,
  tableColumns,
  variableChoices,
} from './analysisMap.js';
import { buildDoFile, checkCommandLines } from './stataCommands.js';

test('a Stata map file reads as GEOIDs with numbers (missing as null)', () => {
  const { columns, rows } = parseMapCsv(
    'geoid,hev_fit,hev_res\r\n25001012700,16.36,6.84\r\n"25001013700",15.88,\r\n',
  );
  assert.deepEqual(columns, ['hev_fit', 'hev_res']);
  assert.deepEqual(rows, [
    { geoid: '25001012700', hev_fit: 16.36, hev_res: 6.84 },
    { geoid: '25001013700', hev_fit: 15.88, hev_res: null },
  ]);
  assert.deepEqual(parseMapCsv('name,x\nA,1'), { columns: [], rows: [] });
});

test('each model that ran offers its residuals and fitted values', () => {
  const steps = [
    { step: 1, rc: 0, line: 'summarize poverty' },
    { step: 2, rc: 111, line: 'regress nothing here' },
    { step: 3, rc: 0, line: 'reg foreign_born_share poverty' },
    {
      step: 4,
      rc: 0,
      line: 'spregress foreign_born_share poverty, ml dvarlag(W)',
    },
  ];
  assert.deepEqual(modelLines(steps), [
    'reg foreign_born_share poverty',
    'spregress foreign_born_share poverty, ml dvarlag(W)',
  ]);
  const choices = mapChoices({
    steps,
    files: ['analysis.do', 'map_m2.csv', 'map_m1.csv', 'map_vars.csv'],
  });
  assert.deepEqual(
    choices.map((c) => [c.file, c.column, Boolean(c.residual)]),
    [
      ['map_m1.csv', 'hev_res', true],
      ['map_m1.csv', 'hev_fit', false],
      ['map_m2.csv', 'hev_res', true],
      ['map_m2.csv', 'hev_fit', false],
    ],
  );
  assert.match(
    choices[2].label,
    /^Model 2 \(spregress foreign_born_share poverty,…\): residuals/,
  );
  assert.deepEqual(variableChoices(['ztest']), [
    {
      file: 'map_vars.csv',
      column: 'ztest',
      label: 'ztest (made in this session)',
    },
  ]);
});

test('residual classes are symmetric about zero; legends read as ranges', () => {
  const breaks = residualBreaks([-2, -1, 0, 1, 2]);
  assert.equal(breaks.length, 4);
  assert.ok(Math.abs(breaks[0] + breaks[3]) < 1e-12);
  assert.ok(Math.abs(breaks[1] + breaks[2]) < 1e-12);
  assert.deepEqual(residualBreaks([3]), [0]);
  assert.deepEqual(
    legendRows({ breaks: [-15, -5, 5, 15], colors: RESIDUAL_RAMP }).map(
      (r) => r.label,
    ),
    ['below -15', '-15 to -5', '-5 to 5', '5 to 15', '15 and above'],
  );
});

test('GEOID lengths tell the geography', () => {
  assert.equal(geographyOf(['25', '36']), 'state');
  assert.equal(geographyOf(['25025']), 'county');
  assert.equal(geographyOf(['25025010100', '25025010200']), 'tract');
  assert.equal(geographyOf(['25025', '25025010100']), null);
});

test('the do-file saves each model’s fitted values and residuals by GEOID', () => {
  const vars = [
    { name: 'geoid', label: 'Census GEOID', kind: 'string' },
    { name: 'poverty', label: 'Poverty', kind: 'numeric' },
    { name: 'income', label: 'Income', kind: 'numeric' },
  ];
  const { commands } = checkCommandLines(
    ['regress poverty income', 'egen zinc = std(income)'],
    vars,
  );
  const text = buildDoFile({
    title: 'T',
    variables: vars,
    commands,
    areaCount: 10,
  });
  assert.ok(text.includes('capture predict double hev_fit if e(sample)'));
  assert.ok(
    text.includes(
      'capture export delimited hev_id geoid hev_fit hev_res using "map_m1.csv" if e(sample), replace',
    ),
  );
  assert.ok(
    text.includes(
      'capture export delimited hev_id geoid zinc using "map_vars.csv", replace',
    ),
  );
  // Areas without a GEOID (any other layer) go back by row alone.
  const plain = buildDoFile({
    title: 'T',
    variables: vars.slice(1),
    commands: checkCommandLines(['regress poverty income'], vars.slice(1))
      .commands,
  });
  assert.ok(
    plain.includes(
      'capture export delimited hev_id hev_fit hev_res using "map_m1.csv"',
    ),
  );
});

test('the data table joins model results by GEOID and shows the variables used', () => {
  const data =
    'geoid,state_fips,name,lon,lat,poverty,income,renters\n' +
    '"25001012700","25","Tract 127, Barnstable",-70.1,41.7,10,50000,30\n' +
    '"25001013700","25","Tract 137, Barnstable",-70.2,41.6,20,40000,40\n';
  const table = sessionTable(data, [
    {
      k: 1,
      table: parseMapCsv('geoid,hev_fit,hev_res\n25001012700,12.5,-2.5\n'),
    },
  ]);
  assert.equal(table.rows[0].name, 'Tract 127, Barnstable');
  assert.equal(table.rows[0]['m1 residual'], -2.5);
  assert.equal(table.rows[1]['m1 residual'], undefined);
  assert.deepEqual(
    tableColumns(table.columns, 'regress poverty income', table.rows),
    ['name', 'geoid', 'poverty', 'income', 'm1 residual', 'm1 fitted'],
  );
  // No variables named (an uploaded do-file): the first numeric measures.
  assert.deepEqual(tableColumns(table.columns, '', table.rows).slice(2, 5), [
    'poverty',
    'income',
    'renters',
  ]);
});
