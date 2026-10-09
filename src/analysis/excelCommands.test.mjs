import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { analysisVariables } from './stataCommands.js';
import {
  buildExcelAnalysis,
  checkExcelLine,
  checkExcelLines,
  dataSheets,
  isExcelModelLine,
  kurtosis,
  leastSquares,
  mean,
  sd,
  skewness,
  tInverse,
  tTwoTailed,
  fUpper,
} from './excelCommands.js';
import { buildWorkbook, storedFormula } from './excelWorkbook.js';
import { translatePlainEnglish } from './plainEnglish.js';
import { readXlsx, readXlsxTable } from '../curated/xlsxRead.js';
import { readUpload } from '../curated/userData.js';
import {
  prepareExcelSession,
  readSessionData,
  runExcelSession,
} from '../../server/analysis/excelSession.js';
import { prepareSession } from '../../server/analysis/stataSession.js';
import { storeUpload, uploadRows } from '../../server/analysis/userTable.js';

const vars = analysisVariables('tract');
const lookup = () =>
  new Map(
    vars.map((v) => [v.name.toLowerCase(), { name: v.name, kind: v.kind }]),
  );

// The data Excel 16's LINEST was checked against.
const x = Array.from({ length: 30 }, (_, i) => i + 1);
const y = x.map((v, i) => 2 + 0.5 * v + ((i * 7) % 5) - 2);

test('least squares matches Excel’s LINEST, and the distributions match Excel’s', () => {
  const fit = leastSquares(y, [x]);
  assert.ok(Math.abs(fit.b[1] - 0.513348164627364) < 1e-12);
  assert.ok(Math.abs(fit.b[0] - 1.79310344827586) < 1e-12);
  assert.ok(Math.abs(fit.r2 - 0.90857211112379) < 1e-12);
  assert.equal(fit.n, 30);
  assert.equal(fit.dfResidual, 28);
  // T.DIST.2T(2,10), T.INV.2T(0.05,10), F.DIST.RT(1,1,1).
  assert.ok(Math.abs(tTwoTailed(2, 10) - 0.0733880347707404) < 1e-9);
  assert.ok(Math.abs(tInverse(0.05, 10) - 2.22813885198627) < 1e-9);
  assert.ok(Math.abs(fUpper(1, 1, 1) - 0.5) < 1e-9);
  assert.ok(Math.abs(mean([1, 2, 3, 4]) - 2.5) < 1e-12);
  assert.ok(Math.abs(sd([2, 4, 4, 4, 5, 5, 7, 9]) - 2.138089935) < 1e-8);
  // KURT and SKEW of 1..10 (Excel: -1.2, 0).
  const ten = Array.from({ length: 10 }, (_, i) => i + 1);
  assert.ok(Math.abs(kurtosis(ten) + 1.2) < 1e-12);
  assert.ok(Math.abs(skewness(ten)) < 1e-12);
});

test('Excel Analysis lines: ToolPak commands, conditions and single formulas', () => {
  for (const line of [
    'DESCRIPTIVE foreign_born_share poverty median_income',
    'descriptive statistics poverty',
    'CORRELATION poverty unemployment bachelors',
    'REGRESSION foreign_born_share ON poverty unemployment',
    'regress foreign_born_share poverty unemployment',
    'HISTOGRAM poverty BINS 12',
    'SCATTER foreign_born_share poverty',
    'SCATTER foreign_born_share AGAINST poverty',
    'FREQUENCY state',
    'AVERAGE poverty BY state',
    'MEDIAN median_income BY state',
    'STANDARDIZE poverty bachelors',
    'RANK poverty',
    'REGRESSION foreign_born_share ON poverty IF population >= 1000 AND poverty > 5',
    '=CORREL(poverty, bachelors)',
    '=AVERAGE(poverty)',
    '=PERCENTILE.INC(median_income, 0.9)',
  ])
    assert.equal(checkExcelLine(line, lookup()).ok, true, line);
  for (const line of [
    'REGRESSION poverty ON nothing_here',
    'DESCRIPTIVE state',
    'CORRELATION poverty',
    'REGRESSION poverty ON poverty',
    'HISTOGRAM poverty BINS 200',
    '=INDIRECT("A1")',
    '=AVERAGE(poverty) + HYPERLINK("x")',
    'DESCRIPTIVE poverty IF poverty is high',
    'TTEST poverty',
  ])
    assert.equal(checkExcelLine(line, lookup()).ok, false, line);
  const run = checkExcelLines(
    ['STANDARDIZE poverty', 'DESCRIPTIVE z_poverty'],
    vars,
  );
  assert.equal(run.ok, true, run.problems.join(' '));
  assert.deepEqual(run.commands[0].creates, ['z_poverty']);
  assert.equal(isExcelModelLine('REGRESSION y ON x'), true);
  assert.equal(isExcelModelLine('DESCRIPTIVE y'), false);
});

test('a session becomes a workbook: a sheet per command, live formulas, LINEST and charts', () => {
  const variables = [
    { name: 'geoid', label: 'GEOID', kind: 'string' },
    { name: 'x', label: 'x', kind: 'numeric' },
    { name: 'y', label: 'y', kind: 'numeric' },
    { name: 'state', label: 'State', kind: 'string' },
  ];
  const rows = x.map((v, i) => [
    String(25001 + i),
    v,
    y[i],
    i % 2 ? 'MA' : 'RI',
  ]);
  const { commands } = checkExcelLines(
    [
      'DESCRIPTIVE x y',
      'REGRESSION y ON x',
      'HISTOGRAM y',
      'SCATTER y x',
      'AVERAGE y BY state',
      'STANDARDIZE y',
      '=CORREL(x, y)',
      'REGRESSION y ON x IF x > 10',
    ],
    variables,
  );
  const out = buildExcelAnalysis({
    title: 'Test',
    data: { variables, rows },
    commands,
  });
  assert.deepEqual(
    out.sheets.map((s) => s.name),
    [
      'About',
      'Data',
      'Variables',
      '1 Descriptive',
      '2 Regression',
      '3 Histogram',
      '4 Scatter',
      '5 Average by',
      '8 Regression',
      'Formulas',
      'New variables',
    ],
  );
  assert.ok(
    out.steps.every((s) => s.rc === 0),
    JSON.stringify(out.steps),
  );
  const regression = out.sheets.find((s) => s.name === '2 Regression');
  const linest = regression.rows.flat().find((cell) => cell?.array);
  assert.match(
    linest.f,
    /^LINEST\('2 Regression'!\$B\$\d+:\$B\$\d+,'2 Regression'!\$C\$\d+:\$C\$\d+,TRUE,TRUE\)$/,
  );
  assert.ok(Math.abs(linest.v - 0.513348164627364) < 1e-12);
  assert.equal(regression.charts.length, 1);
  const describe = out.sheets.find((s) => s.name === '1 Descriptive');
  assert.equal(describe.rows[4][1].f, 'AVERAGE(Data!$B$2:$B$31)');
  // With IF, the values are computed for those rows only (no live formulas).
  const subset = out.sheets.find((s) => s.name === '8 Regression');
  assert.ok(!subset.rows.flat().some((cell) => cell?.f && !cell.array));
  assert.deepEqual(
    out.mapFiles.map((f) => f.name),
    ['map_m1.csv', 'map_m2.csv', 'map_vars.csv'],
  );
  assert.match(
    out.mapFiles[0].csv,
    /^hev_id,geoid,hev_fit,hev_res\r\n1,25001,/,
  );
  assert.match(out.log, /> REGRESSION y ON x\nRegression: y on x — 30 rows/);
  assert.match(out.log, /=CORREL\(x, y\) = 0\.95319/);
  assert.equal(
    storedFormula('STDEV.S(A1:A3)/SQRT(COUNT(A1:A3))'),
    '_xlfn.STDEV.S(A1:A3)/SQRT(COUNT(A1:A3))',
  );
});

test('workbooks read back: numbers stay numbers, IDs stay text, compressed or not', async () => {
  const variables = [
    { name: 'geoid', label: 'GEOID', kind: 'string' },
    { name: 'value', label: 'A value', kind: 'numeric' },
    { name: 'name', label: 'Name & "quotes" <tags>', kind: 'string' },
  ];
  const rows = [
    ['01001', 12.5, 'Autauga & Co.'],
    ['01003', null, 'Baldwin'],
  ];
  for (const deflate of [null, deflateRawSync]) {
    const bytes = buildWorkbook(
      dataSheets({ title: 'T', data: { variables, rows } }),
      { deflate },
    );
    const sheets = await readXlsx(bytes);
    assert.deepEqual(
      sheets.map((s) => s.name),
      ['About', 'Data', 'Variables'],
    );
    const table = await readXlsxTable(
      buildWorkbook(
        [{ name: 'Data', rows: [['geoid', 'value', 'name'], ...rows] }],
        { deflate },
      ),
    );
    assert.deepEqual(table.columns, ['geoid', 'value', 'name']);
    assert.deepEqual(table.rows[0], {
      geoid: '01001',
      value: 12.5,
      name: 'Autauga & Co.',
    });
    assert.equal(table.rows[1].value, '');
    // An empty last cell is not stored, so the row ends before it.
    assert.deepEqual(sheets[2].rows[2], ['value', 'A value', 'number']);
  }
  // Curated Flights' "Your data" takes a workbook too.
  const dataset = await readUpload(
    'places.xlsx',
    buildWorkbook([
      {
        name: 'S',
        rows: [
          ['countyfips', 'rate'],
          [25025, 9.5],
          [25017, 7.1],
        ],
      },
    ]),
  );
  assert.equal(dataset.level, 'county');
  assert.equal(dataset.records[0].geoid, '25025');
});

test('your own file: GEOIDs found (lost leading zeros too), joined to the map, analyzed by any box', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hev-excel-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { HEV_ANALYSIS_DIR: root };
  const csv =
    'County FIPS,Uninsured %,Clinic name\n25025,6.1,A\n25017,3.9,B\n25001,4.2,C\n6037,8.0,LA\nxx,1,none\n';
  const stored = await storeUpload(
    { name: 'clinics.csv', bytes: new TextEncoder().encode(csv) },
    { env },
  );
  assert.equal(stored.ok, true, stored.problems.join(' '));
  assert.equal(stored.geography, 'county');
  assert.deepEqual(
    stored.variables.map((v) => v.name),
    ['geoid', 'county_fips', 'uninsured', 'clinic_name'],
  );
  const ma = uploadRows({ uploadId: stored.id, state: '25' }, { env });
  assert.equal(ma.rows.length, 3);
  assert.ok(ma.variables.some((v) => v.name === 'lon'));
  const everywhere = uploadRows({ uploadId: stored.id }, { env });
  assert.equal(everywhere.rows.length, 4);
  assert.match(everywhere.notes.join(' '), /1 of 5 rows/);
  // An Excel workbook works the same.
  const xlsx = buildWorkbook([
    {
      name: 'Rates',
      rows: [
        ['tract', 'rate'],
        ['25025010405', 3.5],
        ['25025010500', 4.5],
        ['25025010600', 5.5],
      ],
    },
  ]);
  const workbook = await storeUpload(
    { name: 'tracts.xlsx', bytes: xlsx },
    { env },
  );
  assert.equal(workbook.ok, true, workbook.problems.join(' '));
  assert.equal(workbook.geography, 'tract');
  assert.equal(workbook.sheet, 'Rates');
  // Excel Analysis on the upload: the workbook, the log and the map file.
  const session = prepareExcelSession(
    {
      uploadId: stored.id,
      state: 'MA',
      commands: ['DESCRIPTIVE uninsured', 'REGRESSION uninsured ON lat'],
    },
    { env },
  );
  assert.equal(session.ok, true, session.problems?.join(' '));
  assert.match(session.session.title, /clinics\.csv, 3 rows in Massachusetts/);
  const data = readSessionData(session.session);
  assert.equal(data.rows.length, 3);
  const result = await runExcelSession(session.session);
  assert.equal(result.ok, true, result.problems.join(' '));
  // The regression is the first model, so its map file is map_m1.csv.
  for (const file of [
    'analysis.xlsx',
    'data.xlsx',
    'data.csv',
    'commands.txt',
    'analysis.log',
    'map_m1.csv',
  ])
    assert.ok(result.files.includes(file), file);
  const back = await readXlsx(
    new Uint8Array(
      readFileSync(path.join(session.session.folder, 'analysis.xlsx')),
    ),
  );
  assert.deepEqual(
    back.map((s) => s.name),
    ['About', 'Data', 'Variables', '1 Descriptive', '2 Regression'],
  );
  // A file without GEOIDs is analyzed whole, without the map.
  const plain = await storeUpload(
    {
      name: 'scores.csv',
      bytes: new TextEncoder().encode('score,hours\n70,2\n80,4\n90,6\n85,5\n'),
    },
    { env },
  );
  assert.equal(plain.geography, null);
  const plainRun = prepareExcelSession(
    { uploadId: plain.id, commands: ['REGRESSION score ON hours'] },
    { env },
  );
  assert.equal(plainRun.ok, true);
  assert.equal((await runExcelSession(plainRun.session)).ok, true);
});

test('every Stata, R and SPSS session also saves data.xlsx', async (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'hev-xlsx-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = prepareSession(
    { geography: 'state', commands: ['summarize segregation_bw'] },
    { env: { HEV_ANALYSIS_DIR: root } },
  );
  assert.equal(run.ok, true);
  const file = path.join(run.session.folder, 'data.xlsx');
  assert.ok(existsSync(file));
  const sheets = await readXlsx(new Uint8Array(readFileSync(file)));
  assert.deepEqual(
    sheets.map((s) => s.name),
    ['About', 'Data', 'Variables'],
  );
  assert.equal(sheets[1].rows.length, run.session.areas + 1);
});

test('plain English becomes Excel Analysis commands that pass the checks', () => {
  const both = (text) => translatePlainEnglish(text, vars, 'excel');
  assert.deepEqual(
    both('regress percent foreign-born on poverty and unemployment').lines,
    ['REGRESSION foreign_born_share ON poverty unemployment'],
  );
  assert.deepEqual(
    both(
      'effect of poverty on percent foreign born where population is at least 1,000',
    ).lines,
    ['REGRESSION foreign_born_share ON poverty IF population >= 1000'],
  );
  assert.match(
    both('logistic regression of renters on poverty').problems[0],
    /least-squares regression only/,
  );
  assert.match(
    both('spatial regression DV = poverty, IV: unemployment').problems[0],
    /no spatial regression/,
  );
  for (const text of [
    'what is the average %foreign-born and poverty rate',
    'correlation between poverty, unemployment and median household income',
    'scatter plot of foreign born share against poverty',
    'histogram of poverty',
    'standardize median income then regress poverty on z_median_income',
    'frequencies of state',
    'mean of poverty by state',
    'how many tracts',
  ]) {
    const out = both(text);
    assert.equal(out.ok, true, `${text}: ${out.problems.join(' ')}`);
    const check = checkExcelLines(out.lines, vars);
    assert.equal(check.ok, true, `${text}: ${check.problems.join(' ')}`);
  }
});
