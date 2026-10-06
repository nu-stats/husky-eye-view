#!/usr/bin/env node
/**
 * Chicago historical homicides, 1870–1930: geocode the recorded crime
 * locations on this computer and lock the result with its own key.
 *
 * Source data: Leigh Bienen, "Homicide in Chicago, 1870–1930" (Chicago
 * Historical Homicide Project), Northwestern University, Arch,
 * https://doi.org/10.21985/N2HB3R (the full export with text fields).
 * Street geometry and address ranges: City of Chicago Data Portal, Street
 * Center Lines (pr57-gg9e). No address is sent to any outside geocoder.
 *
 * Geocoding:
 *  - "Clark & Van Buren Sts.": the node where both streets meet (exact).
 *  - "211 W. Polk St.": interpolated along the segment whose address range
 *    holds the number. Chicago renumbered its streets in 1909 (the Loop in
 *    1911), so house numbers on records before 1911 are placed on today's
 *    grid and marked approximate.
 *  - A few renamed streets (12th St → Roosevelt Rd, …) are tried when the
 *    old name is not found.
 *  - When the address column is blank or does not match, the street address
 *    or corner named in the case description is used instead (marked as
 *    taken from the case description). Anything else is left off the map.
 *
 * Cards carry no names (victims, defendants or anyone in a location note):
 * date, location as recorded, victim and defendant age / gender / race,
 * method, circumstance, homicide type and trial outcome.
 *
 * Inputs (not in git): data/source/chicago-homicides/homicide_full.csv (copy
 *   of the project CSV), street_centerlines.json (fetched here if missing).
 * Outputs: data/research/chicago_homicides.geojsonl.enc (locked),
 *   data/restricted/chicago_homicides_geocoded.geojsonl (plain, not in git).
 * Key: HEV_CHICAGO_HOMICIDES_KEY, or the private key file
 *   ~/Documents/HuskyEyeView-backups/chicago-homicides-key.txt (created with
 *   --generate; never printed).
 *
 *   node scripts/build-chicago-homicides.mjs [--generate]
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encryptResearchText } from '../server/providers/research.js';
import { readShapefile } from './lib/shapefile.mjs';

const SOURCE = 'data/source/chicago-homicides';
const CSV = path.join(SOURCE, 'homicide_full.csv');
const CENTERLINES = path.join(SOURCE, 'street_centerlines.json');
// Old-to-new house numbers from the 1909 Plan of Re-Numbering, read by
// scripts/extract-chicago-street-history.py.
const RENUMBERING = path.join(SOURCE, 'renumbering_1909.json');
// Former street names and what they became (William Martin, 1948), read by
// scripts/extract-chicago-street-history.py.
const RENAMINGS = path.join(SOURCE, 'street_renamings.json');
// Census places (fetched by scripts/fetch-segregation-sources.mjs): town centers.
const PLACES = 'data/source/segregation/places/cb_2024_us_place_500k';
const CENTERLINE_API = 'https://data.cityofchicago.org/resource/pr57-gg9e.json';
const OUT_LOCKED = 'data/research/chicago_homicides.geojsonl.enc';
const OUT_PLAIN = 'data/restricted/chicago_homicides_geocoded.geojsonl';
const KEY_FILE = path.join(
  os.homedir(),
  'Documents',
  'HuskyEyeView-backups',
  'chicago-homicides-key.txt',
);
/** Records before this year use the pre-renumbering house numbers. */
export const RENUMBERING_YEAR = 1911;
/** The new numbers took effect outside the Loop on September 1, 1909. */
export const RENUMBERING_DATE = Date.UTC(1909, 8, 1);

// ---- CSV ------------------------------------------------------------------
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  const head = rows.shift().map((h) => h.replace(/^﻿/, '').trim());
  return rows
    .filter((r) => r.some((c) => c.trim()))
    .map((r) =>
      Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])),
    );
}

// ---- Street names -----------------------------------------------------------
const DIRECTIONS = {
  N: 'N',
  NO: 'N',
  NORTH: 'N',
  S: 'S',
  SO: 'S',
  SOUTH: 'S',
  E: 'E',
  EAST: 'E',
  W: 'W',
  WEST: 'W',
};
const AVENUE_TYPES = new Set(['AV', 'AVE', 'AVES', 'AVENUE', 'AVENUES']);
const TYPES = new Set(
  'ST STS STREET STREETS AV AVE AVES AVENUE AVENUES BLVD BOUL BOULEVARD PL PLACE CT COURT RD ROAD DR DRIVE PKWY PARKWAY TER TERRACE WAY HWY AL ALLEY ROW SQ'.split(
    ' ',
  ),
);
const ordinal = (n) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}TH`;
  return `${n}${{ 1: 'ST', 2: 'ND', 3: 'RD' }[n % 10] || 'TH'}`;
};
/**
 * Well-documented renamings, tried when the recorded name is not on today's
 * map (numbered avenues are keyed with "AVE": Fifth Avenue became Wells).
 */
export const RENAMED = {
  '12TH': 'ROOSEVELT',
  '22ND': 'CERMAK',
  '39TH': 'PERSHING',
  CRAWFORD: 'PULASKI',
  ROBEY: 'DAMEN',
  'CUSTOM HOUSE': 'FEDERAL',
  FORQUER: 'ARTHINGTON',
  '3RD AVE': 'DEARBORN',
  '4TH AVE': 'FEDERAL',
  '5TH AVE': 'WELLS',
  MICH: 'MICHIGAN',
  WASH: 'WASHINGTON',
  'COTTAGE GR': 'COTTAGE GROVE',
};

/** "W. Polk St." -> {dir: 'W', name: 'POLK'}; "16th" -> {name: '16TH'}. */
export function normalizeStreet(raw) {
  const tokens = String(raw || '')
    .toUpperCase()
    .replace(/[.,'"()?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  let dir = null;
  while (tokens.length > 1 && DIRECTIONS[tokens[0]])
    dir = DIRECTIONS[tokens.shift()];
  let avenue = false;
  // The street type as written: 'AVE', 'ST' or another (PL, CT, BLVD, …).
  let type = null;
  while (tokens.length > 1 && TYPES.has(tokens.at(-1))) {
    const token = tokens.pop();
    avenue = AVENUE_TYPES.has(token) || avenue;
    type ||= AVENUE_TYPES.has(token)
      ? 'AVE'
      : /^STS?$|^STREETS?$/.test(token)
        ? 'ST'
        : token;
  }
  const name = tokens
    // "16" and the misspelt "25ST" both become 16TH / 25TH.
    .map((t) =>
      /^\d+(?:ST|ND|RD|TH|D)?$/.test(t) ? ordinal(parseInt(t, 10)) : t,
    )
    .join(' ');
  return { dir, name, avenue: avenue && /^\d/.test(name), type };
}

const LEADING_NOISE =
  /^(no\.?|n\.?\s*w\.?\s+corner(\s+of)?|s\.?\s*[ew]\.?\s+corner(\s+of)?|corner(\s+of)?|cor\.?|near|in front of|front of|rear of|rear|at|alley[-\s]+|dump at|in)\s+/i;

/** Parse a recorded location into an address or an intersection. */
export function parseLocation(raw) {
  let text = String(raw || '')
    .replace(/\s+/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/\s*\/\s*/g, ' and ')
    .trim();
  for (let i = 0; i < 3; i++) text = text.replace(LEADING_NOISE, '');
  // "No.76 Custom House Place"
  text = text.replace(/^No\.?\s*(?=\d)/i, '');
  if (!text) return null;
  // "201-203 Washington Blvd." -> 201; a number anywhere ("White Palace
  // saloon 625 W. Madison st.") starts the address.
  const address = text.match(
    /(?:^|\s)(\d{1,5})(?:-\d{1,5})?\s+((?:[NSEW]\.?\s+|NO\.?\s+|SO\.?\s+)?(?:\d{1,3}(?:st|nd|rd|th)\b|[A-Za-z])[^,;]*)$/i,
  );
  if (address && !/\b(and|near)\b/i.test(address[2]))
    return {
      kind: 'address',
      number: Number(address[1]),
      ...normalizeStreet(address[2]),
    };
  // "19th State sts.": a corner written without "and" (plural type only).
  const bare = text.match(
    /^(\d{1,3}(?:st|nd|rd|th)|[A-Za-z]{3,})\.?\s+(\d{1,3}(?:st|nd|rd|th)|[A-Za-z]{3,})\s+(?:sts|aves|avs|streets|avenues)\.?$/i,
  );
  if (bare)
    return {
      kind: 'intersection',
      near: false,
      a: normalizeStreet(bare[1]),
      b: normalizeStreet(bare[2]),
    };
  const parts = text.split(/\s+(?:and|near)\s+|,\s*/i).filter(Boolean);
  if (parts.length >= 2) {
    const a = normalizeStreet(parts[0].replace(/^.*?\b\d+\s+/, ''));
    const b = normalizeStreet(parts[1]);
    if (a.name && b.name)
      return {
        kind: 'intersection',
        near: /\bnear\b/i.test(text),
        a,
        b,
      };
  }
  return null;
}

/** Levenshtein distance, stopping once it exceeds `max`. */
function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      best = Math.min(best, row[j]);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length];
}

// ---- Centerlines -------------------------------------------------------------
async function fetchCenterlines() {
  if (existsSync(CENTERLINES))
    return JSON.parse(readFileSync(CENTERLINES, 'utf8'));
  const fields =
    'fnode_id,tnode_id,pre_dir,street_nam,street_typ,l_f_add,l_t_add,r_f_add,r_t_add,the_geom';
  const out = [];
  for (let offset = 0; ; offset += 50_000) {
    const url = `${CENTERLINE_API}?$select=${fields}&$order=trans_id&$limit=50000&$offset=${offset}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
    const page = await response.json();
    for (const s of page) {
      const coords = s.the_geom?.coordinates?.flat?.(1);
      if (!coords?.length) continue;
      out.push({
        f: s.fnode_id,
        t: s.tnode_id,
        dir: s.pre_dir || null,
        name: String(s.street_nam || '').toUpperCase(),
        lf: Number(s.l_f_add) || 0,
        lt: Number(s.l_t_add) || 0,
        rf: Number(s.r_f_add) || 0,
        rt: Number(s.r_t_add) || 0,
        c: coords.map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))]),
      });
    }
    if (page.length < 50_000) break;
  }
  mkdirSync(SOURCE, { recursive: true });
  writeFileSync(CENTERLINES, JSON.stringify(out));
  console.log(`centerlines: ${out.length} segments downloaded`);
  return out;
}

/** A point at fraction `t` (0–1) along a polyline. */
function along(coords, t) {
  const lengths = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = Math.hypot(
      coords[i][0] - coords[i - 1][0],
      coords[i][1] - coords[i - 1][1],
    );
    lengths.push(d);
    total += d;
  }
  let target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < lengths.length; i++) {
    if (target <= lengths[i] || i === lengths.length - 1) {
      const f = lengths[i] ? target / lengths[i] : 0;
      const [x0, y0] = coords[i];
      const [x1, y1] = coords[i + 1];
      return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
    }
    target -= lengths[i];
  }
  return coords[0];
}

/**
 * Parse one former-name line from William Martin's 1948 list of Chicago
 * street-name changes: "-Milton Ave., Cleveland Ave. 460W 800 to 1200N." ->
 * {from: 'MILTON', avenue: false, to: 'CLEVELAND', ranges: [{lo: 800,
 * hi: 1200, dir: 'N'}]}. Vacated streets and lines without a new name give
 * null.
 */
export function parseRenaming(line) {
  const text = String(line || '')
    .replace(/^-\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || /vacated/i.test(text)) return null;
  const comma = text.indexOf(',');
  if (comma < 1) return null;
  const oldRaw = text.slice(0, comma).split(/\s*&\s*/)[0];
  let rest = text.slice(comma + 1);
  const ranges = [];
  rest = rest.replace(
    /(\d{1,5})\s*(?:to|-)\s*(\d{1,5})\s*([NSEW])\b\.?/g,
    (_, lo, hi, dir) => {
      ranges.push({
        lo: Math.min(Number(lo), Number(hi)),
        hi: Math.max(Number(lo), Number(hi)),
        dir,
      });
      return ' ';
    },
  );
  // Cross-street positions ("460W", "at 1600 W.") and notes are not names.
  rest = rest
    .replace(/\bat\s+\d+\s*[NSEW]\b\.?/gi, ' ')
    .replace(/\b\d{1,5}\s*[NSEW]{1,2}\b\.?/g, ' ')
    .replace(/\((?:priv|pvt)[^)]*\)|\bpvt\b|\bpriv\b/gi, ' ');
  const type =
    '(?:Street|St|Avenue|Ave|Av|Boulevard|Blvd|Place|Pl|Court|Ct|Road|Rd|Drive|Dr|Parkway|Pkwy|Way|Terrace|Ter|Highway|Hwy|Lane|Ln|Row|Sq|Square)\\b\\.?';
  const newRaw = rest.match(
    new RegExp(
      `((?:[NSEW]\\.?\\s+)?(?:\\d{1,3}(?:st|nd|rd|th)|[A-Z][\\w'.]*)(?:\\s+[A-Z][\\w'.]*)*\\s+${type})`,
    ),
  )?.[1];
  if (!newRaw) return null;
  const from = normalizeStreet(oldRaw);
  const to = normalizeStreet(newRaw);
  if (!from.name || !to.name || from.name === to.name) return null;
  return {
    from: from.name,
    avenue: from.avenue,
    type: from.type,
    to: to.name,
    ranges,
  };
}

/** Group parsed renamings by former name (numbered avenues keyed "5TH AVE"). */
export function renamingIndex(lines) {
  const index = new Map();
  for (const line of lines) {
    const r = parseRenaming(line);
    if (!r) continue;
    const key = r.avenue ? `${r.from} AVE` : r.from;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(r);
  }
  return index;
}

/** Madison Street, the north–south base line (and Chicago's 0 N/S). */
const MADISON_LAT = 41.8819;
/** The Loop: kept its old numbers until 1911, and is not in the 1909 tables. */
const inLoop = ({ lon, lat }) =>
  lat > 41.8665 && lat < 41.8895 && lon > -87.6415;
/**
 * The South Division (east of the South Branch, south of Madison, or south
 * of the branch's westward turn near 22nd Street), where north–south streets
 * kept their numbers in 1909.
 */
const inSouthDivision = ({ lon, lat }) =>
  lat < MADISON_LAT && (lon > -87.6405 || lat < 41.848);

export function createGeocoder(segments, { renamings = new Map() } = {}) {
  const byName = new Map();
  const nodeXY = new Map();
  for (const s of segments) {
    if (!byName.has(s.name)) byName.set(s.name, []);
    byName.get(s.name).push(s);
    nodeXY.set(s.f, s.c[0]);
    nodeXY.set(s.t, s.c.at(-1));
  }
  const nodesOf = new Map();
  for (const [name, list] of byName) {
    const nodes = new Set();
    for (const s of list) nodes.add(s.f).add(s.t);
    nodesOf.set(name, nodes);
  }
  const runsNorthSouth = (s) =>
    Math.abs(s.c.at(-1)[1] - s.c[0][1]) > Math.abs(s.c.at(-1)[0] - s.c[0][0]);

  // The city grid: where each hundred-block falls, from every numbered
  // segment ({N,S} -> latitude, {E,W} -> longitude). Places a number on a
  // block of a street that no longer exists.
  const gridSamples = new Map();
  for (const s of segments) {
    if (!s.dir) continue;
    const ns = runsNorthSouth(s);
    if (ns !== (s.dir === 'N' || s.dir === 'S')) continue;
    for (const [from, to] of [
      [s.lf, s.lt],
      [s.rf, s.rt],
    ]) {
      if (!Math.max(from, to)) continue;
      const block = Math.floor(Math.min(from, to) / 100);
      const key = `${s.dir}${block}`;
      const start = from <= to ? s.c[0] : s.c.at(-1);
      if (!gridSamples.has(key)) gridSamples.set(key, []);
      gridSamples.get(key).push(ns ? start[1] : start[0]);
    }
  }
  const grid = new Map();
  for (const [key, values] of gridSamples) {
    values.sort((a, b) => a - b);
    grid.set(key, values[Math.floor(values.length / 2)]);
  }
  /** Latitude (N/S) or longitude (E/W) of a house number on the grid. */
  const gridCoordinate = (number, dir) => {
    const block = Math.floor(number / 100);
    const here = grid.get(`${dir}${block}`);
    const next = grid.get(`${dir}${block + 1}`);
    if (here == null) return null;
    return next == null ? here : here + ((number % 100) / 100) * (next - here);
  };

  // Spelling-tolerant lookup: the recorded name, a documented renaming, the
  // same letters without spaces (LASALLE = LA SALLE), or one letter off for
  // longer names (SEDGEWICK = SEDGWICK, PRARIE = PRAIRIE).
  const compact = new Map();
  for (const name of byName.keys()) {
    const key = name.replace(/\s+/g, '');
    if (!compact.has(key)) compact.set(key, name);
  }
  const names = [...byName.keys()];
  const resolved = new Map();
  const known = (street) => {
    const name = typeof street === 'string' ? street : street.name;
    const avenueKey =
      typeof street === 'object' && street.avenue ? `${name} AVE` : null;
    const cacheKey = avenueKey || name;
    if (resolved.has(cacheKey)) return resolved.get(cacheKey);
    let hit = null;
    if (avenueKey && byName.has(RENAMED[avenueKey])) hit = RENAMED[avenueKey];
    else if (byName.has(name)) hit = name;
    else if (byName.has(RENAMED[name])) hit = RENAMED[name];
    else if (compact.has(name.replace(/\s+/g, '')))
      hit = compact.get(name.replace(/\s+/g, ''));
    else if (name.length >= 6) {
      const close = names.filter((n) => editDistance(name, n, 1) <= 1);
      if (close.length === 1) hit = close[0];
    }
    resolved.set(cacheKey, hit);
    return hit;
  };
  /** Today's streets a former name became (Martin's list), with ranges. */
  const renamedTo = (street) => {
    const name = typeof street === 'string' ? street : street.name;
    const keys =
      typeof street === 'object' && street.avenue
        ? [`${name} AVE`, name]
        : [name];
    const out = [];
    const type = typeof street === 'object' ? street.type : null;
    for (const key of keys)
      for (const r of renamings.get(key) || []) {
        // "Armour Ave." is not "Armour St.": the types must agree when known.
        if (type && r.type && type !== r.type) continue;
        const to = byName.has(r.to) ? r.to : known(r.to);
        if (to) out.push({ name: to, ranges: r.ranges });
      }
    return out;
  };

  // A street's candidate names, best first: as recorded and the curated
  // renaming ("12th" still exists as 12th Place, but 12th & State is today's
  // Roosevelt & State). Only a name that is gone from today's map is tried
  // under the names it was later given: an existing name stays itself.
  const namesFor = (street) => {
    const name = typeof street === 'string' ? street : street.name;
    const today = known(street);
    const list = [
      [today, null],
      [byName.has(RENAMED[name]) ? RENAMED[name] : null, null],
      ...(today ? [] : renamedTo(street).map((r) => [r.name, r.name])),
    ].filter(([n]) => n);
    return list.filter(([n], i) => list.findIndex(([m]) => m === n) === i);
  };

  // Vertices of each street (with the direction of the line there) in
  // ~200 m cells, for nearest-approach corners.
  const cellsOf = new Map();
  const CELL = 0.002;
  const cellsFor = (name) => {
    if (cellsOf.has(name)) return cellsOf.get(name);
    const cells = new Map();
    for (const s of byName.get(name))
      s.c.forEach((p, i) => {
        const q = s.c[i + 1] || s.c[i - 1];
        if (!q) return;
        const key = `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push({ p, v: [q[0] - p[0], q[1] - p[1]] });
      });
    cellsOf.set(name, cells);
    return cells;
  };
  const metres = (p, q) =>
    Math.hypot(
      (p[0] - q[0]) * 111_320 * Math.cos((p[1] * Math.PI) / 180),
      (p[1] - q[1]) * 110_574,
    );
  /** Sine of the angle between two direction vectors. */
  const sine = (u, v) =>
    Math.abs(u[0] * v[1] - u[1] * v[0]) / (Math.hypot(...u) * Math.hypot(...v));
  /**
   * Where two streets that cross (at least 30° apart) come within 60 m of
   * each other without sharing a node: an overpass or a small jog.
   */
  const nearestApproach = (na, nb) => {
    const mine = cellsFor(na);
    const theirs = cellsFor(nb);
    let best = null;
    for (const [key, points] of mine) {
      const [cx, cy] = key.split(',').map(Number);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (const b of theirs.get(`${cx + dx},${cy + dy}`) || [])
            for (const a of points) {
              const d = metres(a.p, b.p);
              if (d <= 60 && sine(a.v, b.v) >= 0.5 && (!best || d < best.d))
                best = { d, p: a.p, q: b.p };
            }
    }
    return best
      ? { lon: (best.p[0] + best.q[0]) / 2, lat: (best.p[1] + best.q[1]) / 2 }
      : null;
  };

  function intersection(a, b) {
    const found = [];
    const pairs = [];
    for (const [na, ra] of namesFor(a))
      for (const [nb, rb] of namesFor(b))
        if (na !== nb)
          pairs.push({
            na,
            nb,
            rank: (ra ? 1 : 0) + (rb ? 1 : 0),
            renamed: [ra, rb].filter(Boolean).join(' and ') || null,
          });
    for (const pair of pairs) {
      const shared = [...nodesOf.get(pair.na)].filter((node) =>
        nodesOf.get(pair.nb).has(node),
      );
      if (shared.length) {
        const [x, y] = nodeXY.get(shared[0]);
        found.push({ lon: x, lat: y, multiple: shared.length > 1, ...pair });
      }
    }
    if (!found.length)
      for (const pair of pairs) {
        const near = nearestApproach(pair.na, pair.nb);
        if (near) found.push({ ...near, nearest: true, ...pair });
      }
    if (!found.length) return null;
    const best = Math.min(...found.map((f) => f.rank));
    const top = found.filter((f) => f.rank === best);
    // Two renamed candidates far apart: no telling which corner was meant.
    const far = top.some(
      (f) => Math.abs(f.lon - top[0].lon) + Math.abs(f.lat - top[0].lat) > 0.01,
    );
    if (far && best > 0) return null;
    const { lon, lat, multiple, nearest, renamed } = top[0];
    return {
      lon,
      lat,
      multiple: Boolean(multiple),
      ...(nearest && { nearest: true }),
      ...(renamed && { renamed }),
    };
  }

  /** A number on one of today's streets (exact range, then same block). */
  function addressOn(name, number, dir) {
    const candidates = byName
      .get(name)
      .filter((s) => !dir || !s.dir || s.dir === dir);
    for (const s of candidates) {
      for (const [from, to] of [
        [s.lf, s.lt],
        [s.rf, s.rt],
      ]) {
        const lo = Math.min(from, to);
        const hi = Math.max(from, to);
        if (!hi || number < lo || number > hi) continue;
        const t = hi === lo ? 0.5 : (number - from) / (to - from);
        const [x, y] = along(s.c, t);
        return { lon: x, lat: y, northSouth: runsNorthSouth(s) };
      }
    }
    // Segment ranges list the numbers actually in use, so a number can fall
    // in a gap (State St. 451 → 521). Use the closest numbered end on the
    // same hundred block.
    const block = Math.floor(number / 100);
    let best = null;
    for (const s of candidates) {
      for (const [from, to] of [
        [s.lf, s.lt],
        [s.rf, s.rt],
      ]) {
        if (!Math.max(from, to)) continue;
        for (const [end, t] of [
          [from, 0],
          [to, 1],
        ]) {
          const gap = Math.abs(end - number);
          if (Math.floor(end / 100) === block && (!best || gap < best.gap))
            best = { gap, s, t };
        }
      }
    }
    if (!best) return null;
    const [x, y] = along(best.s.c, best.t);
    return { lon: x, lat: y, northSouth: runsNorthSouth(best.s) };
  }

  /**
   * A number on a block of a street that is gone today (South Dearborn under
   * the Dan Ryan, say): the grid gives the position along the street and the
   * street's surviving line gives the other coordinate, within 3 km.
   */
  function addressOnGrid(name, number, dir) {
    const list = byName
      .get(name)
      .filter((s) => !dir || !s.dir || s.dir === dir);
    const dirs = new Set(list.map((s) => s.dir).filter(Boolean));
    const side = dir || (dirs.size === 1 ? [...dirs][0] : null);
    if (!side || !list.length) return null;
    const northSouth = side === 'N' || side === 'S';
    // The street must run the way its numbers do (N/S numbers on a north–south street).
    const mostlyNorthSouth =
      list.filter(runsNorthSouth).length * 2 >= list.length;
    if (mostlyNorthSouth !== northSouth) return null;
    const position = gridCoordinate(number, side);
    if (position == null) return null;
    const axis = northSouth ? 1 : 0;
    let best = null;
    for (const s of list)
      for (const p of s.c) {
        const gap = Math.abs(p[axis] - position);
        if (!best || gap < best.gap) best = { gap, p };
      }
    if (!best || best.gap > 0.03) return null;
    return northSouth
      ? { lon: best.p[0], lat: position, northSouth, grid: true }
      : { lon: position, lat: best.p[1], northSouth, grid: true };
  }

  /**
   * Geocode a house number: today's street, then the streets a former name
   * became (where Martin's ranges allow the number), then — with
   * `{grid: true}` — the city grid for blocks that no longer exist.
   */
  function address(number, dir, street, { grid: useGrid = false } = {}) {
    const n = known(street);
    const hit = n && addressOn(n, number, dir);
    if (hit) return hit;
    // Later names that could hold this number. A name still on the map only
    // moves to a later name whose listed range holds the number (Armour Ave.
    // 1600–5500 S is Federal St.).
    const fits = [];
    for (const r of renamedTo(street)) {
      if (n && !r.ranges.length) continue;
      const range = r.ranges.find(
        (g) =>
          number >= g.lo && number <= g.hi && (!dir || !g.dir || g.dir === dir),
      );
      if (r.ranges.length && !range) continue;
      fits.push({ name: r.name, dir: dir || range?.dir });
    }
    // Two different later streets fit ("2108 Armour" could be Armour Ave.
    // or Armour St.): no telling which was meant.
    if (new Set(fits.map((r) => r.name)).size === 1) {
      const place = addressOn(fits[0].name, number, fits[0].dir);
      if (place) return { ...place, renamed: fits[0].name };
    }
    if (useGrid && n) return addressOnGrid(n, number, dir);
    return null;
  }
  return { intersection, address };
}

// ---- Case descriptions -------------------------------------------------------
const STREET_TYPE =
  '(?:Streets|Street|Sts|St|Avenues|Avenue|Aves|Ave|Avs|Av|Boulevard|Blvd|Boul|Place|Pl|Court|Ct|Road|Rd|Drive|Dr|Parkway|Pkwy|Terrace|Ter)\\b\\.?';
const STREET_NAME =
  "(?:\\d{1,3}(?:st|nd|rd|th|d)|[A-Z][A-Za-z']+(?:\\s+[A-Z][A-Za-z']+)?)";
const DIRECTION = '(?:[NSEW]\\.?\\s+|No\\.\\s+|So\\.\\s+)';
// "211 W. Polk St." — a house number, then a street with its type.
const DESCRIPTION_ADDRESS = new RegExp(
  `\\b(\\d{1,5}(?:-\\d{1,5})?\\s+${DIRECTION}?${STREET_NAME}\\.?\\s+${STREET_TYPE})(?!\\s*(?:Station|Sta\\b|Police))`,
  'g',
);
// "Clark and Van Buren Sts.", "State & 16th St."
const DESCRIPTION_CORNER = new RegExp(
  `\\b(${DIRECTION}?${STREET_NAME}\\.?(?:\\s+${STREET_TYPE})?\\s+(?:and|&)\\s+${DIRECTION}?${STREET_NAME}\\.?\\s+${STREET_TYPE})(?!\\s*(?:Station|Sta\\b|Police))`,
  'g',
);

/**
 * The street address or corner a case description names, as text the
 * location parser reads ("211 W. Polk St."), or null. Only the location is
 * taken from the description; its names never reach the map.
 */
/**
 * The places a case description names: where the crime happened, and where
 * the victim or the defendant lived, as text the location parser reads.
 * "of 5017 Rockwell St." before the "by …" clause is the victim's home and
 * just after "by <name>" the defendant's; "home 188 De Koven St." or
 * "his home, 568 Dickson St." is the victim's. Names never leave this
 * function.
 */
export function describedPlaces(description) {
  const text = String(description || '')
    .replace(/�/g, "'")
    .replace(/\s+/g, ' ');
  const found = [
    ...text.matchAll(DESCRIPTION_CORNER),
    ...text.matchAll(DESCRIPTION_ADDRESS),
  ]
    .sort((x, y) => x.index - y.index)
    // "between Indiana and Prairie Aves." names a block, not a corner.
    .filter(
      (m) =>
        !/\bbetween\s*$/i.test(text.slice(Math.max(0, m.index - 12), m.index)),
    );
  const before = (m) => text.slice(Math.max(0, m.index - 40), m.index);
  const residenceOf = (m) =>
    /(?<!(?:vicinity|corner|front|rear)\s)\bof,?\s*$/i.test(before(m));
  const home = (m) => /\b(?:home|residence),?\s*(?:at\s+)?$/i.test(before(m));
  const by = text.search(/\sby\s/i);
  const victimHome = found.find(
    (m) => home(m) || (residenceOf(m) && (by < 0 || m.index < by)),
  );
  const defendantHome = found.find(
    (m) => residenceOf(m) && by >= 0 && m.index > by && m.index - by < 90,
  );
  // The crime location: the first place that is not someone's address,
  // else the victim's home (many died where they lived).
  const crime =
    found.find((m) => !residenceOf(m) && !home(m)) || victimHome || found[0];
  return {
    crime: crime?.[1] ?? null,
    victimHome: victimHome?.[1] ?? null,
    defendantHome: defendantHome?.[1] ?? null,
  };
}

/** The crime location a case description names, or null. */
export function locationFromDescription(description) {
  return describedPlaces(description).crime;
}

/**
 * Manhattan (street-grid) distance in kilometres between two points: east–west
 * plus north–south, which suits Chicago's square grid.
 */
export function manhattanKm(a, b) {
  const lat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  return (
    Math.abs(a.lon - b.lon) * 111.32 * Math.cos(lat) +
    Math.abs(a.lat - b.lat) * 110.574
  );
}
// ---- Landmarks and towns -----------------------------------------------------
/**
 * Well-documented places named instead of an address, each placed at the
 * street corner it stood on (geocoded like any corner, marked approximate).
 * Hospitals (where victims died, not where they were hurt), large parks,
 * rivers and canals are left off: they do not pin a place.
 */
export const LANDMARKS = [
  {
    test: /\bunion\s+stock\s*yards?\b|\bstock\s*yards\b/i,
    name: 'Union Stock Yards',
    corner: 'Halsted St. and Exchange Ave.',
  },
  {
    test: /\bhaymarket\b/i,
    name: 'Haymarket Square',
    corner: 'Randolph St. and Desplaines St.',
  },
  {
    test: /\briverview\s+park\b/i,
    name: 'Riverview Park',
    corner: 'Belmont Ave. and Western Ave.',
  },
  {
    test: /\blexington\s+hotel\b/i,
    name: 'Lexington Hotel',
    corner: 'Cermak Rd. and Michigan Ave.',
  },
  {
    test: /\bwashington\s+park\s+race\s*track\b/i,
    name: 'Washington Park Race Track',
    corner: '63rd St. and Cottage Grove Ave.',
  },
  {
    test: /\bgarfield\s+park\s+race\s*track\b/i,
    name: 'Garfield Park Race Track',
    corner: 'Madison St. and Pulaski Rd.',
  },
];

/** Center of each Illinois and Indiana census place, by lower-case name. */
export function townCenters(features) {
  const towns = new Map();
  for (const { properties, geometry } of features) {
    if (!['IL', 'IN'].includes(properties.STUSPS)) continue;
    const polygons =
      geometry?.type === 'Polygon'
        ? [geometry.coordinates]
        : geometry?.coordinates || [];
    const outer = polygons
      .map((p) => p[0])
      .sort((a, b) => b.length - a.length)[0];
    if (!outer) continue;
    const lon = outer.reduce((s, p) => s + p[0], 0) / outer.length;
    const lat = outer.reduce((s, p) => s + p[1], 0) / outer.length;
    const key = properties.NAME.toLowerCase();
    // Prefer Illinois when both states have the name.
    if (!towns.has(key) || properties.STUSPS === 'IL')
      towns.set(key, {
        lon,
        lat,
        name: properties.NAME,
        state: properties.STUSPS,
      });
  }
  return towns;
}

/**
 * A town outside Chicago named as the location: "Harvey, Ill.", "near
 * Lamont, Ill.", or a nearby town's name alone ("Chicago Heights"), within
 * 60 km of the Loop.
 */
export function townOf(text, towns) {
  const raw = String(text || '')
    .trim()
    .replace(/[.\s]+$/, '');
  const named = raw.match(
    /^(?:near\s+)?([A-Za-z .']+?),\s*(?:ill(?:inois)?|il|ind(?:iana)?|cook,?\s*co)\b/i,
  );
  const key = (named ? named[1] : raw).trim().toLowerCase();
  const town = towns.get(key);
  if (!town || key === 'chicago') return null;
  return manhattanKm(town, { lon: -87.6298, lat: 41.8781 }) <= 60 ? town : null;
}

// ---- Records ---------------------------------------------------------------
const age = (raw) => {
  const n = Number(String(raw || '').match(/^\d+/)?.[0]);
  return n > 0 && n < 120 ? `${n}` : null;
};
const person = (rawAge, gender, race) =>
  [gender || null, age(rawAge), race || null].filter(Boolean).join(', ') ||
  'not recorded';
const sentenceCase = (text) =>
  text ? text.charAt(0).toUpperCase() + text.slice(1) : '';

function yearOf(row) {
  for (const key of [
    'CircumstancesDateOfOffense',
    'CircumstancesDateOfDeath',
  ]) {
    const m = String(row[key] || '').match(/\b(18[6-9]\d|19[0-3]\d)\b/);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Card line for a residence named in the case description: its distance from
 * the crime location along the street grid (Manhattan distance).
 */
export function homeLine(home, crimeMatch) {
  // Within 30 m: the same address, spelled another way in the description.
  if (home.km < 0.03)
    return `Residence of the ${home.who}: ${home.text} — the same address as the crime location`;
  const approximate =
    home.match.startsWith('approximate') ||
    crimeMatch.startsWith('approximate');
  return `Residence of the ${home.who}: ${home.text} — ${(home.km * 0.621371).toFixed(1)} mi (${home.km.toFixed(1)} km) from the crime location by the street grid (Manhattan distance${approximate ? ', approximate' : ''})`;
}

export function recordFeature(row, place, match, recorded, homes = []) {
  const year = yearOf(row);
  const date =
    row.CircumstancesDateOfOffense ||
    row.CircumstancesDateOfDeath ||
    (year ? String(year) : '');
  const method =
    row.CircumstancesMethodOfKilling || sentenceCase(row.CircumstancesWeapon);
  const lines = [
    `Date: ${date || 'not recorded'}`,
    `Location: ${recorded} (${match})`,
    `Victim: ${person(row.VictimAge, row.VictimGender, row.VictimRace)}`,
    `Defendant: ${row.DefendantGender || row.DefendantRace || row.DefendantAge ? person(row.DefendantAge, row.DefendantGender, row.DefendantRace) : 'not recorded'}`,
    method && `Method: ${method}`,
    row.CircumstancesCircumstancesDescription &&
      `Circumstance: ${row.CircumstancesCircumstancesDescription}`,
    row.CircumstancesTypeOfHomicide &&
      `Type: ${row.CircumstancesTypeOfHomicide}`,
    row.LegalOutcomeOfTrial && `Trial outcome: ${row.LegalOutcomeOfTrial}`,
    ...homes.map((home) => homeLine(home, match)),
  ].filter(Boolean);
  return {
    type: 'Feature',
    id: `chh-${row.IndexId}`,
    properties: {
      name: `Homicide, ${date || 'date unknown'}`,
      record: row.IndexId,
      year,
      decade: year ? Math.floor(year / 10) * 10 : null,
      match,
      ...Object.fromEntries(
        homes.map((home) => [
          `${home.who}_home_km`,
          Number(home.km.toFixed(2)),
        ]),
      ),
      summary: lines.join('\n'),
      source_note:
        'Leigh Bienen, "Homicide in Chicago, 1870–1930" (Chicago Historical Homicide Project), Northwestern University, https://doi.org/10.21985/N2HB3R. Location geocoded by Husky Eye View against City of Chicago street centerlines; names omitted. Gender and race as recorded or inferred in the source, which assumed white when no race was stated.',
    },
    geometry: {
      type: 'Point',
      coordinates: [Number(place.lon.toFixed(6)), Number(place.lat.toFixed(6))],
    },
  };
}

/**
 * Old-to-new house number conversion from the 1909 renumbering tables.
 * Returns convert(number, dir, street) -> {number, dir} or null. Old numbers
 * repeated in two parts of a street (North and South Halsted, say) are told
 * apart by the recorded direction; if that leaves two answers far apart, no
 * answer is given.
 */
export function createRenumbering(sections) {
  const byName = new Map();
  for (const s of sections) {
    if (!byName.has(s.name)) byName.set(s.name, []);
    byName.get(s.name).push(s);
  }
  const compact = new Map(
    [...byName.keys()].map((name) => [name.replace(/\s+/g, ''), name]),
  );
  const names = [...byName.keys()];
  const resolve = (name) => {
    if (byName.has(name)) return name;
    const key = name.replace(/\s+/g, '');
    if (compact.has(key)) return compact.get(key);
    if (name.length >= 6) {
      const close = names.filter((n) => editDistance(name, n, 1) <= 1);
      if (close.length === 1) return close[0];
    }
    return null;
  };
  return function convert(number, dir, street) {
    const name = resolve(street.name);
    if (!name) return null;
    const sections = byName
      .get(name)
      .filter((s) => !dir || !s.dir || s.dir === dir);
    const answers = [];
    for (const s of sections) {
      // The two pairs whose old numbers sit closest below and above.
      let below = null;
      let above = null;
      for (const pair of s.pairs) {
        const [, old] = pair;
        if (old <= number && (!below || old > below[1])) below = pair;
        if (old >= number && (!above || old < above[1])) above = pair;
      }
      let value = null;
      if (below && above && below[1] === above[1]) value = below[0];
      else if (
        below &&
        above &&
        above[1] - below[1] <= 60 &&
        Math.abs(above[0] - below[0]) <= 150
      )
        value =
          below[0] +
          ((number - below[1]) * (above[0] - below[0])) / (above[1] - below[1]);
      else {
        const near = [below, above]
          .filter(Boolean)
          .filter((pair) => Math.abs(pair[1] - number) <= 6)
          .sort((a, b) => Math.abs(a[1] - number) - Math.abs(b[1] - number))[0];
        if (near) value = near[0] + (number - near[1]);
      }
      if (value != null && value > 0)
        answers.push({ number: Math.round(value), dir: s.dir || dir });
    }
    if (!answers.length) return null;
    const spread =
      Math.max(...answers.map((a) => a.number)) -
      Math.min(...answers.map((a) => a.number));
    const dirs = new Set(answers.map((a) => a.dir));
    return spread <= 200 && dirs.size === 1 ? answers[0] : null;
  };
}

/**
 * Geocode one location text: {place, match} or null. `when` says whether the
 * record predates the 1909 renumbering ({year, beforeRenumbering}); `ctx`
 * holds the geocoder and the renumbering conversion.
 */
function locate(ctx, text, when) {
  const { geocoder, renumber } = ctx;
  const loc = parseLocation(text);
  // How the street was found, added to the match label.
  const how = (place) =>
    [
      place.renamed && `street since renamed ${place.renamed}`,
      place.grid && 'placed on the city grid; that block no longer exists',
    ]
      .filter(Boolean)
      .map((note) => `, ${note}`)
      .join('');
  if (loc?.kind === 'intersection') {
    const place = geocoder.intersection(loc.a, loc.b);
    if (!place) return null;
    const kind = place.nearest
      ? 'intersection (nearest point of the two streets)'
      : loc.near
        ? 'intersection (recorded as near)'
        : 'intersection';
    return { place, match: `${kind}${how(place)}` };
  }
  if (loc?.kind !== 'address') return null;
  if (when.beforeRenumbering && renumber) {
    const converted = renumber(loc.number, loc.dir, loc);
    const place =
      converted &&
      geocoder.address(converted.number, converted.dir, loc, { grid: true });
    if (place)
      return {
        place,
        match: `address (old No. ${loc.number} is No. ${converted.number} under the 1909 renumbering${how(place)})`,
      };
  }
  // South Division north–south streets kept their numbers in 1909, so an old
  // number there is already today's (outside the Loop).
  const unchanged = (place) =>
    place.northSouth && inSouthDivision(place) && !inLoop(place);
  let place = geocoder.address(loc.number, loc.dir, loc, {
    grid: !when.beforeRenumbering,
  });
  if (!place && when.beforeRenumbering) {
    const onGrid = geocoder.address(loc.number, loc.dir, loc, { grid: true });
    if (onGrid && unchanged(onGrid)) place = onGrid;
  }
  if (!place) return null;
  let match = 'address';
  if (when.beforeRenumbering)
    match = unchanged(place)
      ? 'address (South Side north–south street: number unchanged in 1909)'
      : 'approximate: pre-1909 house number on today’s grid';
  else if (when.year && when.year < RENUMBERING_YEAR && inLoop(place))
    match = 'approximate: Loop house number before the 1911 renumbering';
  return { place, match: `${match}${how(place)}` };
}

/** When a record falls relative to the 1909 renumbering. */
function whenOf(row) {
  const year = yearOf(row);
  const parsed = Date.parse(
    `${row.CircumstancesDateOfOffense || row.CircumstancesDateOfDeath || ''} UTC`,
  );
  const beforeRenumbering = Number.isFinite(parsed)
    ? parsed < RENUMBERING_DATE
    : Boolean(year && year < 1909);
  return { year, beforeRenumbering };
}

function readKey(generate) {
  if (process.env.HEV_CHICAGO_HOMICIDES_KEY)
    return process.env.HEV_CHICAGO_HOMICIDES_KEY.trim();
  if (!existsSync(KEY_FILE)) {
    if (!generate)
      throw new Error(
        `no key: set HEV_CHICAGO_HOMICIDES_KEY or run with --generate to create ${KEY_FILE}`,
      );
    mkdirSync(path.dirname(KEY_FILE), { recursive: true });
    writeFileSync(
      KEY_FILE,
      `# Chicago historical homicides key (Husky Eye View). Keep private.\n${randomBytes(18).toString('base64url')}\n`,
    );
    console.log(`created a new key file at ${KEY_FILE} (not printed)`);
  }
  return readFileSync(KEY_FILE, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#'));
}

async function main() {
  const key = readKey(process.argv.includes('--generate'));
  const rows = parseCsv(readFileSync(CSV, 'utf8'));
  const renamings = existsSync(RENAMINGS)
    ? renamingIndex(JSON.parse(readFileSync(RENAMINGS, 'utf8')))
    : new Map();
  if (!renamings.size)
    console.warn(
      `${RENAMINGS} missing: run scripts/extract-chicago-street-history.py`,
    );
  const geocoder = createGeocoder(await fetchCenterlines(), { renamings });
  const towns = existsSync(`${PLACES}.shp`)
    ? townCenters(readShapefile(PLACES))
    : new Map();
  if (!towns.size)
    console.warn(
      `${PLACES} missing: run scripts/fetch-segregation-sources.mjs`,
    );
  const ctx = {
    geocoder,
    renumber: existsSync(RENUMBERING)
      ? createRenumbering(JSON.parse(readFileSync(RENUMBERING, 'utf8')))
      : null,
  };
  if (!ctx.renumber)
    console.warn(
      `${RENUMBERING} missing: run scripts/extract-chicago-street-history.py`,
    );
  const counts = {
    total: rows.length,
    intersection: 0,
    address: 0,
    approximate: 0,
    fromDescription: 0,
    withHomeDistance: 0,
    converted: 0,
    landmark: 0,
    town: 0,
    blank: 0,
    unmatched: 0,
  };
  const features = [];
  for (const row of rows) {
    const when = whenOf(row);
    const year = when.year;
    const recorded = row.CircumstancesAddress;
    let hit = recorded ? locate(ctx, recorded, when) : null;
    let shown = recorded;
    if (!hit) {
      // The case description often names the place the address column lacks.
      const described = locationFromDescription(row.CaseDescription);
      hit = described ? locate(ctx, described, when) : null;
      if (hit) {
        shown = described;
        hit.match = `${hit.match}, from the case description`;
        counts.fromDescription += 1;
      }
    }
    if (!hit) {
      // A landmark or a town named instead of an address.
      const text = recorded || row.CaseDescription || '';
      const landmark = LANDMARKS.find((l) => l.test.test(text));
      const corner = landmark && parseLocation(landmark.corner);
      const place = corner && geocoder.intersection(corner.a, corner.b);
      const town = !place && recorded ? townOf(recorded, towns) : null;
      if (place) {
        hit = { place, match: `landmark (approximate): ${landmark.name}` };
        shown = landmark.name;
        counts.landmark += 1;
      } else if (town) {
        hit = {
          place: town,
          match: `town only: center of ${town.name}, ${town.state}`,
        };
        counts.town += 1;
      }
    }
    if (!hit) {
      if (recorded) counts.unmatched += 1;
      else counts.blank += 1;
      continue;
    }
    if (hit.match.startsWith('intersection')) counts.intersection += 1;
    else if (hit.match.startsWith('address')) counts.address += 1;
    else if (hit.match.startsWith('approximate')) counts.approximate += 1;
    if (hit.match.includes('1909 renumbering')) counts.converted += 1;
    // Residences the description names, measured from the crime location
    // (skipped when the crime location is that same address).
    const described = describedPlaces(row.CaseDescription);
    const same = (a, b) =>
      String(a).replace(/\W+/g, '').toUpperCase() ===
      String(b).replace(/\W+/g, '').toUpperCase();
    const homes = [
      ['victim', described.victimHome],
      ['defendant', described.defendantHome],
    ]
      .filter(([, text]) => text && !same(text, shown))
      .map(([who, text]) => ({ who, text, ...locate(ctx, text, when) }))
      .filter((home) => home.place)
      .map((home) => ({ ...home, km: manhattanKm(home.place, hit.place) }));
    if (homes.length) counts.withHomeDistance += 1;
    features.push(recordFeature(row, hit.place, hit.match, shown, homes));
  }
  const text = features.map((f) => JSON.stringify(f)).join('\n');
  mkdirSync(path.dirname(OUT_PLAIN), { recursive: true });
  writeFileSync(OUT_PLAIN, text);
  writeFileSync(OUT_LOCKED, encryptResearchText(text, key));
  console.log(
    `chicago homicides: ${features.length} of ${counts.total} mapped (${counts.intersection} intersections, ${counts.address} addresses, ${counts.approximate} approximate pre-1911 addresses, ${counts.landmark} landmarks, ${counts.town} towns; ${counts.fromDescription} of these from the case description; ${counts.converted} old numbers converted with the 1909 tables; ${counts.withHomeDistance} with a residence-to-crime distance); not mapped: ${counts.blank} with no usable address in either column, ${counts.unmatched} not matched`,
  );
}

if (process.argv[1]?.endsWith('build-chicago-homicides.mjs')) await main();
