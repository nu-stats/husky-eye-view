#!/usr/bin/env node
/**
 * Merge & Export on the command line, the same way the Merge & Export panel
 * and voice tool do (no server and no browser; the app's data is read from
 * public/context):
 *
 *   node scripts/merge-export.mjs my_tracts.csv --add poverty,median-income,life-expectancy --format dta
 *   node scripts/merge-export.mjs sites.csv --count tract --add poverty --format rdata
 *   node scripts/merge-export.mjs survey.csv --with schools.xlsx --on school_id=SchoolID --format sav
 *   node scripts/merge-export.mjs my_tracts.csv --list            (what can be added)
 *
 *   --add      data to attach, by name or id (tract:poverty, county:poverty, point:holc, ...)
 *   --with     a second file of yours; --on left=right names the linking columns
 *              (suggested when left out); --keep left|inner|outer (default left)
 *   --count    for points: one row per tract | county | state, with counts and rates
 *   --format   csv | xlsx | dta | sav | rdata | rds (default csv)
 *   --bare     the data file alone (default: a ZIP with codebook.csv and README.txt)
 *   --out      where to write (default: next to the input)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPORT_FORMATS,
  MERGE_CATALOG,
  attachData,
  countPoints,
  describeJoin,
  exportBundle,
  exportTable,
  findJoin,
  findMergeItems,
  mergeChoices,
  mergeTables,
  readTable,
  suggestKeys,
} from '../src/analysis/mergeData.js';

const PUBLIC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
);
const readContext = (p) => readFileSync(path.join(PUBLIC, p), 'utf8');

function parse(argv) {
  const o = { add: [], keep: 'left', format: 'csv', files: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--add')
      o.add.push(
        ...argv[++i]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      );
    else if (a === '--with') o.with = argv[++i];
    else if (a === '--on') o.on = argv[++i];
    else if (a === '--keep') o.keep = argv[++i];
    else if (a === '--count') o.count = argv[++i];
    else if (a === '--format') o.format = argv[++i];
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--bare') o.bare = true;
    else if (a === '--list') o.list = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else o.files.push(a);
  }
  return o;
}

const o = parse(process.argv.slice(2));
if (o.help || !o.files.length) {
  console.log(
    readFileSync(fileURLToPath(import.meta.url), 'utf8')
      .split('*/')[0]
      .replace(/^#!.*\n\/\*\*?/, '')
      .replace(/^ \* ?/gm, ''),
  );
  process.exit(o.help ? 0 : 1);
}
const load = (file) =>
  readTable(path.basename(file), new Uint8Array(readFileSync(file)));
const log = [];
let table = await load(o.files[0]);
let join = findJoin(table);
log.push(`Read ${path.basename(o.files[0])}: ${describeJoin(table, join)}`);
console.log(log.at(-1));
if (o.list) {
  for (const { group, items } of mergeChoices(join)) {
    console.log(`\n${group}`);
    for (const i of items) console.log(`  ${i.id.padEnd(34)} ${i.label}`);
  }
  process.exit(0);
}
if (o.with) {
  const other = await load(o.with);
  let [leftKey, rightKey] = o.on ? o.on.split('=') : [];
  if (!leftKey)
    ({ left: leftKey, right: rightKey } = suggestKeys(table, other)[0] || {});
  if (!leftKey)
    throw new Error('No shared column found: give --on left=right.');
  const merged = mergeTables(table, other, {
    leftKey,
    rightKey: rightKey || leftKey,
    keep: o.keep,
  });
  const r = merged.report;
  log.push(
    `Merged ${r.other} on ${r.leftKey} = ${r.rightKey} (${r.relation}): ${r.matched} matched, ${r.onlyA} only in the first file, ${r.onlyB} only in ${r.other}; ${r.rows} rows.`,
  );
  console.log(log.at(-1));
  table = merged.table;
  join = findJoin(table);
}
if (o.count) {
  const counted = await countPoints(table, join, o.count, { readContext });
  log.push(
    `Counted the points per ${o.count}: ${counted.report.withPoints} of ${counted.report.areas} areas have points. ${counted.report.notes.join(' ')}`,
  );
  console.log(log.at(-1));
  ({ table, join } = counted);
}
if (o.add.length) {
  const ids = o.add.flatMap((a) =>
    MERGE_CATALOG.some((i) => i.id === a) ? [a] : findMergeItems(join, [a]),
  );
  if (!ids.length)
    throw new Error(
      `None of “${o.add.join(', ')}” can be added to this file (try --list).`,
    );
  const attached = await attachData(table, join, ids, {
    readContext,
    onProgress: (t) => console.log(`  ${t}`),
  });
  log.push(
    `Added ${ids.join(', ')}: ${attached.report.matchedRows} of ${attached.report.rows} rows matched. ${attached.report.notes.join(' ')}`.trim(),
  );
  console.log(log.at(-1));
  table = attached.table;
}
if (!EXPORT_FORMATS[o.format])
  throw new Error(
    `--format is one of ${Object.keys(EXPORT_FORMATS).join(', ')}.`,
  );
const file = o.bare
  ? await exportTable(table, o.format)
  : await exportBundle(table, o.format, { log });
const out =
  o.out || path.join(path.dirname(path.resolve(o.files[0])), file.fileName);
writeFileSync(out, file.bytes);
console.log(
  `Wrote ${out} (${table.rows.length} rows, ${table.columns.length} variables).`,
);
if (file.renames.length)
  console.log(
    `Renamed for ${o.format}: ${file.renames.map(([a, b]) => `${a} → ${b}`).join(', ')}`,
  );
