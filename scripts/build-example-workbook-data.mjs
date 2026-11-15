#!/usr/bin/env node
/**
 * Data for the worked example workbook (course/assignments/data/weighted-averages-example.xlsx):
 * the 10 cities with the most residents born in one country in 2020-2024, from the
 * city file and the group tables made by scripts/build-city-assignment-data.mjs.
 *
 *   node scripts/build-example-workbook-data.mjs <group tables folder> <country> <output.json>
 *   e.g. node scripts/build-example-workbook-data.mjs C:/temp/groups Poland C:/temp/example.json
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [folder, group, output] = process.argv.slice(2);
if (!folder || !group || !output) throw new Error('Usage: <group tables folder> <country> <output.json>');

const tsv = (f) => readFileSync(`${folder}/${f}`, 'utf8').trim().split('\n').map((l) => l.split('\t'));
const tables = ['2000', '2006_10', '2020_24'].map((p) => tsv(`group-${p}.tsv`));
const column = tables[0][0].indexOf(group);
if (column < 0) throw new Error(`${group} is not in the group tables`);
const weights = tables.map((t) => Object.fromEntries(t.slice(1, -1).map((r) => [r[0], Number(r[column])])));

const csv = readFileSync('course/assignments/data/cities-over-75k.csv', 'utf8').trim().split('\n');
const head = csv[0].split(',');
const cities = {};
for (const line of csv.slice(1)) {
  const f = line.match(/("[^"]*"|[^,]*)(,|$)/g).map((s) => s.replace(/,$/, '').replace(/^"|"$/g, ''));
  cities[f[0]] = f;
}
const at = (name) => head.indexOf(name);
const ids = Object.keys(weights[2]).sort((a, b) => weights[2][b] - weights[2][a] || (a < b ? -1 : 1)).slice(0, 10);

const rows = ids.map((id) => ({
  city: cities[id][1],
  state: cities[id][2],
  p: ['2000', '2006_10', '2020_24'].map((p, k) => ({
    w: weights[k][id],
    fb: Number(cities[id][at(`foreign_born_percent_${p}`)]),
    pov: Number(cities[id][at(`poverty_percent_${p}`)]),
    unemp: Number(cities[id][at(`unemployment_percent_${p}`)]),
  })),
}));

// National foreign-born share: state totals of foreign-born / state totals of population.
const nat = ['fb2000', 'fb2010', 'fb2024'].map((f) => {
  const states = Object.values(JSON.parse(readFileSync(`data/source/census/foreign-born/${f}.json`, 'utf8')).state);
  return Number(((100 * states.reduce((s, v) => s + v[1], 0)) / states.reduce((s, v) => s + v[0], 0)).toFixed(1));
});

writeFileSync(output, JSON.stringify({ group, rows, nat }));
console.log(rows.map((r) => `${r.city}, ${r.state} ${r.p[2].w}`).join('\n'));
