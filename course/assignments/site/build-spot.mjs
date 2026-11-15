#!/usr/bin/env node
/**
 * Makes data/spot.json: fingerprints for the spot-check look-ups (gate 3).
 *
 * For every city and every value a student could be asked to look up, the file holds a salted
 * SHA-256 fingerprint of each answer the page accepts (the true value rounded the way the student
 * types it, and one step either side). The values themselves are not in this file.
 *
 *   percentages  rounded to one decimal; accepted: the value, 0.1 below, 0.1 above
 *   population   rounded to a whole number; accepted: the value, 1 below, 1 above
 *   crime rates  rounded to a whole number; accepted: within 1 either way. For 2000 the student looks
 *                up the year itself; for a pooled period (2006-2010, 2020-2024) she is asked for one
 *                single year inside it, so those slots are keyed by the year (2006 ... 2024).
 *
 * The page hashes what the student types the same way (gates.js: fingerprint()). Run again whenever
 * data/cities.json changes:   node course/assignments/site/build-spot.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cities = JSON.parse(readFileSync(join(here, 'data', 'cities.json'), 'utf8'));
const SALT = 'hev-community-context-spot-v1'; // public on purpose: the check is a teaching nudge, not security

// [variable, period, kind]: kind "tenth" = percent to one decimal, "whole" = whole number.
const slots = [];
for (const p of ['2000', '2006_10', '2020_24']) {
  slots.push(['population', p, 'whole']);
  for (const v of ['foreign_born_percent', 'poverty_percent', 'unemployment_percent']) slots.push([v, p, 'tenth']);
}
const CRIME = ['overall_crime_rate', 'violent_crime_rate', 'property_crime_rate'];
for (const v of CRIME) slots.push([v, '2000', 'whole']);
// A pooled rate (2006-2010, 2020-2024) is a weighted average of the yearly rates, so the student is
// asked for one year inside the period instead. The period of such a slot is the year itself.
const crimeYears = Object.values(cities.crime_years).flat().map(String);
for (const y of crimeYears) for (const v of CRIME) slots.push([v, y, 'whole']);

const key = (x, kind) => (kind === 'tenth' ? Math.round(x * 10) : Math.round(x));
const fp = (code, v, p, k) => createHash('sha256').update(`${SALT}|${code}|${v}|${p}|${k}`).digest('hex').slice(0, 12);

const h = cities.code.map((code, i) =>
  slots.map(([v, p, kind]) => {
    const x = crimeYears.includes(p) ? cities.year_values[p][v][i] : cities.values[p][v][i];
    if (x === null || x === undefined) return '';
    const k = key(x, kind);
    // joined with "." so GitHub's secret scanner does not mistake a long run of hex for a token
    return [k - 1, k, k + 1].map((a) => fp(code, v, p, a)).join('.');
  }),
);
writeFileSync(join(here, 'data', 'spot.json'), JSON.stringify({ salt: SALT, slots, h }));
console.log(`${cities.code.length} cities x ${slots.length} look-ups written to data/spot.json`);
