#!/usr/bin/env node
/**
 * Merge & Export on the command line, the same way the Merge & Export panel
 * and voice tool do (no server and no browser; the app's data is read from
 * public/context).
 *
 * Convert a file to another format (labels and dates kept):
 *   node scripts/merge-export.mjs survey.sav --convert --format dta
 *   node scripts/merge-export.mjs survey.dta --convert --format rdata --codebook
 *
 * Merge it, delivered as a ZIP with the data, a Stata do-file, an R script,
 * the steps (.txt), a codebook and the inputs the scripts rebuild it from:
 *   node scripts/merge-export.mjs my_tracts.csv --add poverty,median-income,life-expectancy --format dta
 *   node scripts/merge-export.mjs sites.csv --count tract --add poverty --format rdata
 *   node scripts/merge-export.mjs survey.csv --with schools.xlsx --on school_id=SchoolID --format sav
 *   node scripts/merge-export.mjs my_tracts.csv --list            (what can be added)
 *
 *   --convert  save the file as read, in --format (with --codebook, a ZIP with codebook.csv)
 *   --add      data to attach, by name or id (tract:poverty, county:poverty, point:holc, ...)
 *   --with     a second file of yours; --on left=right names the linking columns
 *              (suggested when left out); --keep left|inner|outer (default left)
 *   --count    for points: one row per tract | county | state, with counts and rates
 *   --format   csv | xlsx | dta | sav | rdata | rds | shp (default csv); shp is a
 *              shapefile with your original file's own geography
 *   --out      where to write (default: next to the input)
 *
 * Reads CSV, Excel (.xlsx), Stata (.dta), SPSS (.sav, .zsav), R (.RData,
 * .rds), GeoJSON and zipped shapefiles.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPORT_FORMATS, MERGE_CATALOG } from '../src/analysis/mergeData.js';
import { MergeSession } from '../src/analysis/mergeSession.js';

const PUBLIC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'public',
);

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
    else if (a === '--convert') o.convert = true;
    else if (a === '--codebook') o.codebook = true;
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
if (!EXPORT_FORMATS[o.format])
  throw new Error(
    `--format is one of ${Object.keys(EXPORT_FORMATS).join(', ')}.`,
  );
const session = new MergeSession({
  readContext: (p) => readFileSync(path.join(PUBLIC, p), 'utf8'),
});
const bytesOf = (file) => new Uint8Array(readFileSync(file));
const opened = await session.open(
  path.basename(o.files[0]),
  bytesOf(o.files[0]),
);
console.log(
  `Read ${opened.file}: ${opened.describe} ${opened.notes.join(' ')}`.trim(),
);
if (o.list) {
  for (const { group, items } of session.choices()) {
    console.log(`\n${group}`);
    for (const i of items) console.log(`  ${i.id.padEnd(34)} ${i.label}`);
  }
  process.exit(0);
}
let file;
if (o.convert) {
  file = await session.exportConverted(o.format, { codebook: o.codebook });
} else {
  if (o.with) {
    const second = await session.open(
      path.basename(o.with),
      bytesOf(o.with),
      'second',
    );
    let [leftKey, rightKey] = o.on ? o.on.split('=') : [];
    if (!leftKey) ({ left: leftKey, right: rightKey } = second.keys[0] || {});
    if (!leftKey)
      throw new Error('No shared column found: give --on left=right.');
    const r = session.mergeSecond({
      leftKey,
      rightKey: rightKey || leftKey,
      keep: o.keep,
    });
    console.log(
      `Merged ${r.other} on ${r.leftKey} = ${r.rightKey} (${r.relation}): ${r.matched} matched, ${r.onlyA} only in the first file, ${r.onlyB} only in ${r.other}; ${r.rows} rows.`,
    );
  }
  if (o.count) {
    const c = await session.count(o.count);
    console.log(
      `Counted the points per ${o.count}: ${c.withPoints} of ${c.areas} areas have points. ${c.notes.join(' ')}`,
    );
  }
  if (o.add.length) {
    const ids = o.add.flatMap((a) =>
      MERGE_CATALOG.some((i) => i.id === a) ? [a] : session.findItems([a]),
    );
    if (!ids.length)
      throw new Error(
        `None of “${o.add.join(', ')}” can be added to this file (try --list).`,
      );
    const a = await session.attach(ids, (t) => console.log(`  ${t}`));
    console.log(
      `Added ${ids.join(', ')}: ${a.matchedRows} of ${a.rows} rows matched. ${a.notes.join(' ')}`.trim(),
    );
  }
  file = await session.exportMerged(o.format);
}
const out =
  o.out || path.join(path.dirname(path.resolve(o.files[0])), file.fileName);
writeFileSync(out, file.bytes);
console.log(`Wrote ${out}.`);
if (file.renames.length)
  console.log(
    `Renamed for ${o.format}: ${file.renames.map(([a, b]) => `${a} → ${b}`).join(', ')}`,
  );
