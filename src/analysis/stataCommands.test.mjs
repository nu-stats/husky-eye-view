import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATA_COMMAND_NAMES,
  analysisVariables,
  buildDoFile,
  checkCommandLine,
  checkCommandLines,
  readIfClause,
  readableLog,
  stepResults,
  variableName,
} from './stataCommands.js';
import {
  findStata,
  geometryCentroid,
  datasetCsv,
} from '../../server/analysis/stataSession.js';
import { writeShapefile } from '../../server/analysis/shapefile.js';

const vars = analysisVariables('tract');
const known = new Set(vars.map((v) => v.name));

test('the requested commands are offered, with their common abbreviations', () => {
  for (const name of [
    'regress',
    'egen',
    'fre',
    'fs',
    'logit',
    'correlate',
    'summarize',
    'spregress',
    'spreg',
    'nbreg',
    'poisson',
    'tabulate',
    'twoway',
  ])
    assert.ok(STATA_COMMAND_NAMES.includes(name), name);
  assert.equal(
    checkCommandLine('reg poverty bachelors', known).line,
    'regress poverty bachelors',
  );
  assert.equal(checkCommandLine('tab state', known).name, 'tabulate');
  assert.equal(
    checkCommandLine('sum poverty, detail', known).name,
    'summarize',
  );
});

test('the dataset names each measure as a Stata variable with a label', () => {
  assert.equal(
    variableName('foreign-born-share-2010'),
    'foreign_born_share_2010',
  );
  for (const name of [
    'geoid',
    'state_fips',
    'county_fips',
    'tract',
    'lon',
    'lat',
    'poverty',
    'foreign_born_share',
  ])
    assert.ok(known.has(name), name);
  assert.ok(
    !known.has('life_expectancy'),
    'life expectancy is a county measure',
  );
  assert.ok(
    analysisVariables('county').some((v) => v.name === 'life_expectancy'),
  );
  for (const v of vars) {
    assert.match(v.name, /^[A-Za-z_][A-Za-z0-9_]{0,31}$/);
    assert.doesNotMatch(v.label, /["`$\\]/);
  }
});

test('if, in and options pass; anything that reaches past the data does not', () => {
  for (const line of [
    'regress foreign_born_share poverty unemployment if median_income != ., vce(robust)',
    'summarize poverty in 1/100',
    'tab state if !missing(poverty)',
    'poisson foreign_born_count poverty, exposure(population) irr',
    'logit renters poverty if state == "MA"',
    'regress poverty i.state c.bachelors##c.unemployment',
    'spregress foreign_born_share poverty, gs2sls dvarlag(W)',
    'twoway (scatter poverty bachelors) (lfit poverty bachelors), title("Poverty and degrees")',
    'egen pov_z = std(poverty)',
    'correlate poverty bachelors renters',
  ])
    assert.equal(checkCommandLine(line, known).ok, true, line);
  for (const line of [
    'shell del *.*',
    '!dir',
    'regress poverty bachelors; shell calc',
    "summarize `x'",
    'summarize $S_FN',
    'regress poverty bachelors, saving(C:\\temp\\x)',
    'twoway scatter poverty bachelors, saving(out)',
    'summarize poverty using other.dta',
    'regress poverty bachelors\nshell calc',
    'python: print(1)',
    'quietly shell calc',
    'egen x = mean(poverty) // note',
    'summarize "unclosed',
    'erase data.dta',
    'use other.dta',
  ])
    assert.equal(checkCommandLine(line, known).ok, false, line);
});

test('unknown variables are named before Stata runs; egen adds its new one', () => {
  const bad = checkCommandLine('regress poverty nonsense', known);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /nonsense/);
  const run = checkCommandLines(
    ['egen pov_z = std(poverty)', 'regress foreign_born_share pov_z'],
    vars,
  );
  assert.equal(run.ok, true);
  assert.equal(run.commands[0].creates, 'pov_z');
  assert.equal(
    checkCommandLines(['egen poverty = std(poverty)'], vars).ok,
    false,
  );
});

test('the do-file keeps every step going, logs its result, and runs on Stata 18 and later', () => {
  const { commands } = checkCommandLines(
    [
      'regress poverty bachelors',
      'fre state',
      'twoway scatter poverty bachelors',
      'spregress poverty bachelors if median_income != ., gs2sls dvarlag(W)',
    ],
    vars,
  );
  const text = buildDoFile({
    title: 'Test',
    variables: vars,
    commands,
    areaCount: 1600,
    folder: 'C:\\x\\y',
  });
  assert.match(text, /^version 18$/m);
  assert.match(text, /^cd "C:\\x\\y"$/m);
  assert.match(text, /stringcols\(1 2 3 4 5 6\)/);
  assert.match(text, /capture noisily regress poverty bachelors/);
  assert.match(text, /ssc install fre/);
  assert.match(text, /graph export "graph1\.png"/);
  // The spatial model's weights cover exactly the areas it uses.
  assert.match(
    text,
    /preserve\nkeep if !missing\(poverty, bachelors\) & \(median_income != \.\)\n/,
  );
  assert.match(text, /spmatrix create idistance W, replace/);
  assert.match(text, /etable, estimates\(`hev_models'\)/);
  assert.match(text, /HEV_DONE/);
  const big = buildDoFile({
    title: 'Big',
    variables: vars,
    commands: commands.slice(3),
    areaCount: 9000,
  });
  assert.match(big, /Spatial models need 5000 areas or fewer/);
  const open = buildDoFile({
    title: 'Open',
    variables: vars,
    interactive: true,
  });
  assert.match(open, /cmdlog using "session_commands\.do"/);
  assert.match(open, /log using "session\.log"/);
});

test('the log the panel and voice see starts at the first step, without the license banner', () => {
  const log = [
    'Stata license: Single-user perpetual',
    'Serial number: 123',
    '. cd "C:\\Users\\someone"',
    '. * Step 1: summarize poverty',
    '. capture noisily summarize poverty',
    'poverty | 1,598 11.2',
    '. local hev_rc = _rc',
    '. display as text "HEV_STEP 1 rc=" `hev_rc\'',
    'HEV_STEP 1 rc=0',
    'HEV_DONE',
  ].join('\n');
  const readable = readableLog(log);
  assert.doesNotMatch(readable, /Serial|license|Users/);
  assert.match(readable, /poverty \| 1,598/);
  assert.deepEqual(stepResults(log), [{ step: 1, rc: 0 }]);
});

test('Stata 19 is preferred to 18, and MP to SE, wherever it is installed', () => {
  const files = new Set([
    'C:\\Program Files\\Stata18\\StataMP-64.exe',
    'C:\\Program Files\\Stata19\\StataSE-64.exe',
  ]);
  const found = findStata({
    env: { ProgramFiles: 'C:\\Program Files' },
    platform: 'win32',
    exists: (f) => files.has(f),
    list: () => ['Stata18', 'Stata19', 'Other'],
  });
  assert.equal(found.version, 19);
  assert.equal(found.edition, 'SE');
  assert.deepEqual(found.batch('analysis.do'), ['/e', 'do', 'analysis.do']);
  const only18 = findStata({
    env: { ProgramFiles: 'C:\\Program Files' },
    platform: 'win32',
    exists: (f) => f.includes('Stata18'),
    list: () => ['Stata18'],
  });
  assert.equal(only18.version, 18);
  assert.equal(
    findStata({
      env: { HEV_STATA_PATH: 'D:\\Stata\\StataBE-64.exe' },
      platform: 'win32',
      exists: () => true,
    }).edition,
    'BE',
  );
  assert.equal(
    findStata({
      env: {},
      platform: 'win32',
      exists: () => false,
      list: () => [],
    }),
    null,
  );
});

test('areas get centroids and the CSV keeps leading zeros and quotes names', () => {
  const [lon, lat] = geometryCentroid({
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [0, 0],
      ],
    ],
  });
  assert.equal(lon, 1);
  assert.equal(lat, 1);
  const csv = datasetCsv(
    [{ name: 'geoid' }, { name: 'name' }, { name: 'poverty' }],
    [['01001020100', 'Census Tract 201, Autauga County, AL', null]],
  );
  assert.equal(
    csv,
    'geoid,name,poverty\r\n01001020100,"Census Tract 201, Autauga County, AL",',
  );
});

test('spshape2dta links the session shapefile and spmatrix builds the weights', () => {
  assert.equal(
    checkCommandLine('spshape2dta areas', known).line,
    'spshape2dta areas',
  );
  assert.equal(checkCommandLine('spshape2dta', known).ok, true);
  assert.equal(checkCommandLine('spshape2dta other', known).ok, false);
  for (const line of [
    'spmatrix create contiguity W if !missing(poverty), normalize(row)',
    'spmatrix summarize W',
    'spmatrix drop W',
  ])
    assert.equal(checkCommandLine(line, known).ok, true, line);
  for (const line of [
    'spmatrix export W using w.txt',
    'spmatrix import W using w.txt',
    'spmatrix userdefined W = f()',
    'spmatrix spfrommata W = M',
  ])
    assert.equal(checkCommandLine(line, known).ok, false, line);
  const { commands } = checkCommandLines(
    [
      'spshape2dta areas',
      'spmatrix create contiguity W if !missing(poverty, bachelors)',
      'spregress poverty bachelors if !missing(poverty, bachelors), gs2sls dvarlag(W)',
    ],
    vars,
  );
  const text = buildDoFile({
    title: 'Contiguity',
    variables: vars,
    commands,
    areaCount: 1600,
  });
  assert.match(text, /spshape2dta areas, replace/);
  assert.match(
    text,
    /merge 1:1 _n using "areas\.dta", keepusing\(_ID _CX _CY\)/,
  );
  assert.match(text, /spset, modify shpfile\(areas_shp\)/);
  // The user's W is used: no automatic distance weights replace it.
  assert.doesNotMatch(text, /spmatrix create idistance/);
});

test('an if condition keeps the commas inside its parentheses', () => {
  assert.equal(
    readIfClause('y x if !missing(y, x), vce(robust)'),
    '!missing(y, x)',
  );
  assert.equal(
    readIfClause('y x if inlist(state, "MA", "RI") in 1/50'),
    'inlist(state, "MA", "RI")',
  );
  assert.equal(readIfClause('y x if poverty != .'), 'poverty != .');
  assert.equal(readIfClause('y x, robust'), null);
  const { commands } = checkCommandLines(
    [
      'spregress poverty bachelors if !missing(poverty, bachelors), gs2sls dvarlag(W)',
    ],
    vars,
  );
  const text = buildDoFile({
    title: 'If',
    variables: vars,
    commands,
    areaCount: 100,
  });
  assert.ok(
    text.includes(
      'keep if !missing(poverty, bachelors) & (!missing(poverty, bachelors))\n',
    ),
  );
});

test('the results table names the estimation and outcome, with notes one per line', () => {
  const { commands } = checkCommandLines(
    [
      'regress poverty bachelors',
      'spregress poverty bachelors if !missing(poverty, bachelors), ml dvarlag(W)',
    ],
    vars,
  );
  const text = buildDoFile({
    title: 'Table',
    variables: vars,
    commands,
    areaCount: 100,
  });
  assert.ok(text.includes('column(index)'));
  assert.ok(text.includes('eqrecode(poverty = xb)'));
  assert.ok(
    text.includes(
      'title("Table 1. OLS regression; Spatial lag model (maximum likelihood): ',
    ),
  );
  assert.ok(!text.includes('Husky Eye View:'));
  assert.ok(text.includes('"(`hev_n\') OLS regression"'));
  assert.ok(text.includes('collect stars _r_p 0.001 "***"'));
  assert.ok(
    text.includes(
      'collect recode colname poverty = hev_rho, fortags(coleq[W])',
    ),
  );
  assert.ok(text.includes('"Spatial lag (ρ)"'));
  assert.ok(
    text.includes('collect recode colname "var(e.poverty)" = hev_sigma2'),
  );
  assert.ok(text.includes('collect remap colname[hev_sigma2] = hev_omitted'));
  assert.ok(!/Residual variance/.test(text));
  // Notes: no N line; stars, then standard errors, each its own note.
  assert.ok(!/collect notes "N /.test(text));
  const notes = text.match(/collect notes "[^"]*"/g);
  assert.equal(
    notes[0],
    'collect notes "*** p < .001, ** p < .01, * p < .05."',
  );
  assert.equal(notes[1], 'collect notes "Standard errors in parentheses."');
  assert.ok(text.includes('result[N r2 r2_p ll]'));
  assert.ok(
    text.indexOf('collect label levels cmdset') <
      text.indexOf('collect export "results.docx"'),
    'labels are set before the table is saved',
  );
});

test('the shapefile is a polygon file with clockwise outer rings and one row per area', () => {
  const ccw = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
    [0, 0],
  ];
  const { shp, shx, dbf, prj } = writeShapefile([
    { geoid: '25025010405', geometry: { type: 'Polygon', coordinates: [ccw] } },
    {
      geoid: '25025010406',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[ccw], [ccw.map(([x, y]) => [x + 2, y])]],
      },
    },
  ]);
  assert.equal(shp.readInt32BE(0), 9994);
  assert.equal(shp.readInt32LE(32), 5);
  assert.equal(shp.readInt32BE(24) * 2, shp.length);
  assert.equal(shx.length, 100 + 8 * 2);
  // First record: one part, five points, wound clockwise (x goes 0 -> 0 -> 1).
  assert.equal(shp.readInt32LE(108 + 36), 1);
  assert.equal(shp.readInt32LE(108 + 40), 5);
  assert.equal(shp.readDoubleLE(108 + 48 + 16 + 8), 1);
  assert.equal(dbf.readUInt32LE(4), 2);
  assert.match(dbf.toString('ascii'), /25025010405 *25025010406/);
  assert.match(prj, /WGS_1984/);
});
