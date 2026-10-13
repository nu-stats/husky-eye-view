/**
 * Merge & Export: your own file, merged in the browser with a second file of
 * your own and with the app's data (Area Reports measures for tracts,
 * counties and states; tract life expectancy; city segregation; and, for
 * points, the 1930s HOLC grade and the 1900–1930 enumeration district each
 * point falls in), then written as CSV, Excel, Stata, SPSS or R files with a
 * codebook. Every row of your file is kept. The restricted research datasets
 * are never offered.
 *
 * No DOM and no Cesium: the app's files are read through `readContext(path)`
 * (a path under public/, e.g. 'context/tracts-2020/25025.geojsonl'), which
 * the panel backs with fetch and the tests with the file system.
 *
 * A table is `{name, columns, rows}`: each column `{name, label, kind:
 * 'numeric' | 'string', source?, years?, valueLabels?}`, each row an array.
 */
import { REPORT_MEASURES } from '../reports/reportMeasures.js';
import { STATES } from '../reports/areaReport.js';
import { variableName } from './stataCommands.js';
import {
  detectColumns,
  geometryBbox,
  geometryPoint,
  normalizeGeoid,
  parseCsv,
  parseGeoJson,
  readZippedShapefile,
  toNumber,
} from '../curated/userData.js';
import { readXlsxTable } from '../curated/xlsxRead.js';
import { pointInGeometry } from '../curated/curatedModel.js';
import { buildZip } from '../curated/curatedFiles.js';
import { buildWorkbook } from './excelWorkbook.js';
import {
  gzipBytes,
  programNames,
  writeDta,
  writeRData,
  writeSav,
} from './statFiles.js';

export const MAX_MERGE_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_MERGE_ROWS = 250_000;

// ---------- reading a file ----------

const ID_NAME =
  /fips|geoid|geo_?id|gisjoin|tract|(^|_)(id|code|key|county|state)($|_)|id$/i;
const NOT_GEOID = /zip|zcta|postal|phone/i;

/** A column of text: IDs, codes, and anything with leading zeros. */
function columnKind(name, values) {
  let filled = 0;
  let numbers = 0;
  for (const v of values.slice(0, 5000)) {
    if (v === null || v === undefined || v === '') continue;
    filled += 1;
    if (typeof v === 'string' && /^0\d/.test(v.trim())) return 'string';
    if (toNumber(v) !== null) numbers += 1;
  }
  if (!filled) return 'numeric';
  if (ID_NAME.test(name) || NOT_GEOID.test(name)) return 'string';
  return numbers / filled >= 0.5 ? 'numeric' : 'string';
}

/** Unique, non-empty column names. */
function uniqueColumns(columns) {
  const seen = new Set();
  return columns.map((c, i) => {
    let base = String(c ?? '').trim() || `column_${i + 1}`;
    let name = base;
    for (let k = 2; seen.has(name.toLowerCase()); k += 1) name = `${base}_${k}`;
    seen.add(name.toLowerCase());
    return name;
  });
}

/** Rows of objects (as the readers give them) into a table. */
export function tableFromRows(name, columns, objects, geometries = null) {
  if (objects.length > MAX_MERGE_ROWS)
    throw new Error(
      `The file has ${objects.length.toLocaleString('en-US')} rows; the limit is ${MAX_MERGE_ROWS.toLocaleString('en-US')}.`,
    );
  const names = uniqueColumns(columns);
  const cols = names.map((n, j) => {
    const values = objects.map((row) => row[columns[j]]);
    return { name: n, label: '', kind: columnKind(n, values), origin: name };
  });
  const rows = objects.map((row) =>
    cols.map((c, j) => {
      const v = row[columns[j]];
      if (v === null || v === undefined || v === '') return null;
      if (c.kind === 'numeric') return toNumber(v);
      return typeof v === 'string' ? v : String(v);
    }),
  );
  return { name, columns: cols, rows, geometries };
}

/** Read an uploaded file (CSV, Excel, GeoJSON or a zipped shapefile). */
export async function readTable(name, bytes) {
  if (bytes.length > MAX_MERGE_FILE_BYTES)
    throw new Error(
      `The file is ${(bytes.length / 1048576).toFixed(0)} MB; the limit is ${MAX_MERGE_FILE_BYTES / 1048576} MB.`,
    );
  const lower = String(name).toLowerCase();
  const fromFeatures = (features) => {
    const columns = [
      ...new Set(features.flatMap((f) => Object.keys(f.properties || {}))),
    ];
    return tableFromRows(
      name,
      columns,
      features.map((f) => f.properties || {}),
      features.map((f) => f.geometry || null),
    );
  };
  if (/\.(csv|tsv|txt)$/.test(lower)) {
    const { columns, rows } = parseCsv(new TextDecoder().decode(bytes));
    return tableFromRows(name, columns, rows);
  }
  if (/\.(xlsx|xlsm)$/.test(lower)) {
    const { columns, rows, sheet } = await readXlsxTable(bytes);
    return { ...tableFromRows(name, columns, rows), sheet: sheet || null };
  }
  if (/\.(geojson|json|geojsonl|ndjson)$/.test(lower))
    return fromFeatures(parseGeoJson(new TextDecoder().decode(bytes)));
  if (lower.endsWith('.zip')) {
    const zipped = await readZippedShapefile(bytes);
    if (zipped.inner) return readTable(zipped.inner.name, zipped.inner.bytes);
    return fromFeatures(zipped.features);
  }
  if (lower.endsWith('.xls'))
    throw new Error(
      'Save the workbook as .xlsx (Excel Workbook) or CSV, then upload it again.',
    );
  throw new Error(
    'Upload a CSV, an Excel workbook (.xlsx), GeoJSON, or a zipped shapefile.',
  );
}

// ---------- how a table joins to the map ----------

const LEVEL_RANK = {
  state: 1,
  county: 2,
  place: 3,
  tract: 4,
  'block group': 5,
};
export const LEVEL_NOUN = {
  state: 'state',
  county: 'county',
  place: 'city',
  tract: 'tract',
  'block group': 'block group',
};

/** The census level most values of a column share (half of the rows at least). */
function geoidLevel(values) {
  const counts = {};
  let valid = 0;
  for (const v of values) {
    const id = normalizeGeoid(v);
    if (!id) continue;
    valid += 1;
    counts[id.level] = (counts[id.level] || 0) + 1;
  }
  const level = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  return valid >= Math.max(1, values.length * 0.5) ? level : null;
}

/**
 * How a table joins to the map: `{kind: 'geoid', level, ids, how}`,
 * `{kind: 'points', points, how}` or `{kind: 'none'}`. `ids` / `points` are
 * per row (null where a row has none).
 */
export function findJoin(table) {
  const names = table.columns.map((c) => c.name);
  const at = (name) => names.indexOf(name);
  const column = (j) => table.rows.map((row) => row[j]);
  const found = detectColumns(names);
  // The finest census level among ID-like columns.
  // A column named for census IDs may hold any level; a generic "id" or
  // "code" column counts only with tract-length values (1, 2, 3 are not states).
  const CENSUS_NAME = /fips|geoid|geo_?id|gisjoin|tract|county|state/i;
  const candidates = names
    .map((n, j) => ({ n, j }))
    .filter(
      ({ n }) => (ID_NAME.test(n) || n === found.geoid) && !NOT_GEOID.test(n),
    )
    .map(({ n, j }) => ({ n, j, level: geoidLevel(column(j)) }))
    .filter(
      (c) =>
        c.level &&
        (CENSUS_NAME.test(c.n) ||
          c.n === found.geoid ||
          LEVEL_RANK[c.level] >= LEVEL_RANK.tract),
    )
    .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
  if (candidates.length) {
    const { n, j, level } = candidates[0];
    return {
      kind: 'geoid',
      level,
      ids: column(j).map((v) => {
        const id = normalizeGeoid(v);
        return id && id.level === level ? id.geoid : null;
      }),
      how: `the ${n} column`,
      column: n,
    };
  }
  if (found.statePart && found.countyPart) {
    const digits = (v, width) => {
      const text = String(v ?? '')
        .trim()
        .replace(/\.0+$/, '');
      return /^\d+$/.test(text) && text.length <= width
        ? text.padStart(width, '0')
        : null;
    };
    const s = at(found.statePart);
    const c = at(found.countyPart);
    const t = found.tractPart ? at(found.tractPart) : -1;
    const ids = table.rows.map((row) => {
      const a = digits(row[s], 2);
      const b = digits(row[c], 3);
      if (!a || !b) return null;
      if (t < 0) return `${a}${b}`;
      const tract = digits(row[t], 6);
      return tract ? `${a}${b}${tract}` : null;
    });
    if (ids.filter(Boolean).length >= table.rows.length * 0.5)
      return {
        kind: 'geoid',
        level: t >= 0 ? 'tract' : 'county',
        ids,
        how: [found.statePart, found.countyPart, found.tractPart]
          .filter(Boolean)
          .join(' + '),
        column: null,
      };
  }
  if (table.geometries?.some(Boolean)) {
    const points = table.geometries.map((g) => (g ? geometryPoint(g) : null));
    const allPoints = table.geometries.every((g) => !g || /Point/.test(g.type));
    return {
      kind: 'points',
      points,
      how: allPoints
        ? 'the points in the file'
        : 'a point inside each shape in the file',
    };
  }
  if (found.lat && found.lon) {
    const la = at(found.lat);
    const lo = at(found.lon);
    const points = table.rows.map((row) => {
      const lat = toNumber(row[la]);
      const lon = toNumber(row[lo]);
      return lat === null ||
        lon === null ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
        ? null
        : [lon, lat];
    });
    if (points.filter(Boolean).length >= table.rows.length * 0.5)
      return { kind: 'points', points, how: `${found.lat} / ${found.lon}` };
  }
  return { kind: 'none' };
}

/** One line on how a table joins. */
export function describeJoin(table, join) {
  const n = table.rows.length.toLocaleString('en-US');
  if (join.kind === 'geoid') {
    const matched = join.ids.filter(Boolean).length;
    const plural = {
      state: 'states',
      county: 'counties',
      place: 'cities',
      tract: 'tracts',
      'block group': 'block groups',
    }[join.level];
    const missing = table.rows.length - matched;
    return `${n} rows of ${plural}, joined by ${join.how}${missing ? `; ${missing.toLocaleString('en-US')} rows have no usable ID` : ''}.`;
  }
  if (join.kind === 'points') {
    const located = join.points.filter(Boolean).length;
    const missing = table.rows.length - located;
    return `${n} rows of points, located by ${join.how}${missing ? `; ${missing.toLocaleString('en-US')} rows have no location` : ''}.`;
  }
  return `${n} rows. No census IDs or coordinates: it can be merged with another of your files, but not with the map's data.`;
}

// ---------- merging two of your files ----------

/** A key cell as text: trimmed, "12.0" as "12", GEOIDs normalized. */
function keyText(v, geoid) {
  if (v === null || v === undefined) return null;
  let text =
    typeof v === 'number'
      ? Number.isInteger(v)
        ? String(v)
        : String(v)
      : String(v).trim();
  if (!text) return null;
  if (geoid) return normalizeGeoid(text)?.geoid || text;
  return text.replace(/^(-?\d+)\.0+$/, '$1');
}

/**
 * Columns of `a` and `b` that look like the same key, best first:
 * `[{left, right, share}]` (share: of a's distinct values found in b).
 */
export function suggestKeys(a, b, limit = 5) {
  const distinct = (table, j) => {
    const set = new Set();
    for (const row of table.rows) {
      const k = keyText(row[j], false);
      if (k !== null) set.add(k.toLowerCase());
      if (set.size >= 20000) break;
    }
    return set;
  };
  const bSets = b.columns.map((_, j) => distinct(b, j));
  const out = [];
  a.columns.forEach((ca, i) => {
    const aSet = distinct(a, i);
    if (aSet.size < 2) return;
    b.columns.forEach((cb, j) => {
      if (bSets[j].size < 2) return;
      let hit = 0;
      for (const v of aSet) if (bSets[j].has(v)) hit += 1;
      const share = hit / aSet.size;
      const sameName = ca.name.toLowerCase() === cb.name.toLowerCase();
      if (share >= 0.05 || sameName)
        out.push({
          left: ca.name,
          right: cb.name,
          share,
          score: share + (sameName ? 0.25 : 0),
        });
    });
  });
  return out
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map(({ left, right, share }) => ({ left, right, share }));
}

/** A column name not yet in `names` (adds `_2`, `_3`, …). */
function freeName(names, base) {
  let name = base;
  for (let k = 2; names.has(name.toLowerCase()); k += 1) name = `${base}_${k}`;
  names.add(name.toLowerCase());
  return name;
}

/**
 * Merge two of your files on a key. `keep`: 'left' (every row of the first
 * file, the default), 'inner' (rows in both) or 'outer' (every row of both).
 * Like Stata's merge, a key repeated on both sides (many-to-many) is refused;
 * one repeated on one side is allowed and reported. Returns `{table, report}`.
 */
export function mergeTables(a, b, { leftKey, rightKey, keep = 'left' }) {
  const li = a.columns.findIndex((c) => c.name === leftKey);
  const ri = b.columns.findIndex((c) => c.name === rightKey);
  if (li < 0 || ri < 0)
    throw new Error('Choose the column that links the two files in each file.');
  const geoid =
    geoidLevel(a.rows.map((r) => r[li])) !== null &&
    geoidLevel(b.rows.map((r) => r[ri])) !== null;
  const bByKey = new Map();
  b.rows.forEach((row, r) => {
    const k = keyText(row[ri], geoid);
    if (k === null) return;
    if (!bByKey.has(k)) bByKey.set(k, []);
    bByKey.get(k).push(r);
  });
  const aCounts = new Map();
  for (const row of a.rows) {
    const k = keyText(row[li], geoid);
    if (k !== null) aCounts.set(k, (aCounts.get(k) || 0) + 1);
  }
  const dupA = [...aCounts.values()].filter((n) => n > 1).length;
  const dupB = [...bByKey.values()].filter((list) => list.length > 1).length;
  const both = [...aCounts.keys()].filter(
    (k) => aCounts.get(k) > 1 && (bByKey.get(k)?.length || 0) > 1,
  );
  if (both.length)
    throw new Error(
      `${both.length.toLocaleString('en-US')} values of the key repeat in both files (for example “${both[0]}”), so rows cannot be matched one to one. Choose a key that is unique in at least one file.`,
    );
  const relation = dupA && dupB ? 'm:m' : dupA ? 'm:1' : dupB ? '1:m' : '1:1';
  // Columns: all of a, then b's (without its key), renamed where they clash.
  const names = new Set(a.columns.map((c) => c.name.toLowerCase()));
  const bCols = b.columns
    .map((c, j) => ({ c, j }))
    .filter(({ j }) => j !== ri)
    .map(({ c, j }) => {
      const clash = names.has(c.name.toLowerCase());
      return {
        j,
        column: {
          ...c,
          name: freeName(names, c.name),
          label: c.label || (clash ? `${c.name} (from ${b.name})` : ''),
        },
      };
    });
  const indicator = {
    name: freeName(names, 'hev_merge'),
    label: `In which file: ${a.name} and/or ${b.name}`,
    kind: 'numeric',
    valueLabels: {
      1: `Only in ${a.name}`.slice(0, 80),
      2: `Only in ${b.name}`.slice(0, 80),
      3: 'In both files',
    },
  };
  const columns = [...a.columns, ...bCols.map((x) => x.column), indicator];
  const rows = [];
  const usedB = new Set();
  let matched = 0;
  let onlyA = 0;
  a.rows.forEach((row) => {
    const k = keyText(row[li], geoid);
    const hits = k === null ? [] : bByKey.get(k) || [];
    if (!hits.length) {
      onlyA += 1;
      if (keep !== 'inner') rows.push([...row, ...bCols.map(() => null), 1]);
      return;
    }
    for (const r of hits) {
      usedB.add(r);
      matched += 1;
      rows.push([...row, ...bCols.map(({ j }) => b.rows[r][j]), 3]);
    }
  });
  let onlyB = 0;
  b.rows.forEach((row, r) => {
    if (usedB.has(r)) return;
    onlyB += 1;
    if (keep !== 'outer') return;
    const fill = new Array(a.columns.length).fill(null);
    fill[li] = row[ri];
    rows.push([...fill, ...bCols.map(({ j }) => row[j]), 2]);
  });
  // Rows may repeat or drop, so the first file's own shapes do not carry over:
  // the merged table joins to the map by its IDs or coordinates.
  return {
    table: {
      name: a.name,
      columns,
      rows,
      geometries: null,
      sources: [...(a.sources || []), b.name],
    },
    report: {
      relation,
      matched,
      onlyA,
      onlyB,
      dupA,
      dupB,
      rows: rows.length,
      keep,
      leftKey,
      rightKey,
      other: b.name,
    },
  };
}

// ---------- the app's data that can be attached ----------

const GROUP_OF = {
  population: 'Population and immigration',
  'foreign-born-count': 'Population and immigration',
  'foreign-born-share': 'Population and immigration',
  'foreign-born-share-2010': 'Population and immigration',
  'foreign-born-share-2000': 'Population and immigration',
  poverty: 'People & Economy (ACS)',
  unemployment: 'People & Economy (ACS)',
  bachelors: 'People & Economy (ACS)',
  renters: 'People & Economy (ACS)',
  black: 'People & Economy (ACS)',
  hispanic: 'People & Economy (ACS)',
  'no-vehicle': 'People & Economy (ACS)',
  'median-income': 'People & Economy (ACS)',
  internet: 'Internet access',
  broadband: 'Internet access',
  'asu-broadband': 'Internet access',
  'ntia-internet-use': 'Internet access',
  'life-expectancy': 'Life expectancy and health',
  'life-expectancy-2000': 'Life expectancy and health',
  'cluster-status': 'Life expectancy and health',
  pm25: 'Air and green space',
  ozone: 'Air and green space',
  'park-access': 'Air and green space',
  'segregation-bw': 'Segregation',
  'segregation-hw': 'Segregation',
  'segregation-aw': 'Segregation',
};
export const GROUP_ORDER = [
  'Population and immigration',
  'People & Economy (ACS)',
  'Life expectancy and health',
  'Air and green space',
  'Internet access',
  'Segregation',
  'History',
];

const FOLDER = {
  tract: 'context/tracts-2020/',
  county: 'context/county-life-expectancy/',
  state: 'context/states/',
};

/** Each level's data: Area Reports measures plus the extra layers. */
function catalogItems() {
  const items = [];
  for (const m of REPORT_MEASURES) {
    if (m.key.startsWith('fbt')) continue; // encoded country lists
    for (const level of m.geographies)
      items.push({
        id: `${level}:${m.id}`,
        level,
        group: GROUP_OF[m.id] || 'Other measures',
        label: `${m.label}, ${m.years}`,
        name: `${level}_${variableName(m.id)}`,
        fields: [
          {
            key: m.key,
            name: `${level}_${variableName(m.id)}`,
            label: `${m.label}, ${m.years} (${LEVEL_NOUN[level]})`,
            kind: m.format === 'category' ? 'string' : 'numeric',
          },
        ],
        source: m.source,
        years: m.years,
        folder: FOLDER[level],
        chunk:
          level === 'tract' ? 'county' : level === 'county' ? 'state' : 'all',
      });
  }
  items.push({
    id: 'tract:usaleep',
    level: 'tract',
    group: 'Life expectancy and health',
    label: 'Life expectancy at birth (years), 2010–2015 (USALEEP)',
    fields: [
      {
        key: 'life_exp_8',
        name: 'tract_life_expectancy',
        label: 'Life expectancy at birth (years), 2010–2015 (tract, USALEEP)',
        kind: 'numeric',
      },
    ],
    source:
      'U.S. Small-area Life Expectancy Estimates Project (USALEEP), NCHS; 2010 tracts (2020 tracts not among them take the value of the 2010 tract containing their center)',
    years: '2010–2015',
    folder: 'context/life-expectancy/',
    chunk: 'county',
    byLocation: true,
  });
  for (const [suffix, years] of [
    ['00', '2000'],
    ['10', '2010'],
    ['24', '2020–24'],
  ])
    items.push({
      id: `place:segregation${suffix}`,
      level: 'place',
      group: 'Segregation',
      label: `City segregation (dissimilarity), ${years}`,
      fields: [
        {
          key: `bw${suffix}`,
          name: `city_seg_bw${suffix}`,
          label: `Black–white dissimilarity index (0–100), ${years} (city)`,
          kind: 'numeric',
        },
        {
          key: `hw${suffix}`,
          name: `city_seg_hw${suffix}`,
          label: `Latino–white dissimilarity index (0–100), ${years} (city)`,
          kind: 'numeric',
        },
        {
          key: `aw${suffix}`,
          name: `city_seg_aw${suffix}`,
          label: `Asian–white dissimilarity index (0–100), ${years} (city)`,
          kind: 'numeric',
        },
        {
          key: `pop${suffix}`,
          name: `city_pop${suffix}`,
          label: `City population, ${years}`,
          kind: 'numeric',
        },
      ],
      source:
        'Longitudinal Tract Data Base (Logan, Xu and Stults 2014), S4, Brown University; ACS 2020–2024 table B03002',
      years,
      folder: 'context/segregation/',
      chunk: 'abbr',
    });
  items.push({
    id: 'point:holc',
    level: 'point',
    group: 'History',
    label: '1930s HOLC (redlining) grade at each point',
    fields: [
      {
        key: 'holc_grade',
        name: 'holc_grade',
        label: 'HOLC grade, 1930s (A best to D “hazardous”)',
        kind: 'string',
      },
      {
        key: 'holc_id',
        name: 'holc_id',
        label: 'HOLC area id',
        kind: 'string',
      },
      {
        key: 'city',
        name: 'holc_city',
        label: 'HOLC map city',
        kind: 'string',
      },
    ],
    source:
      'Mapping Inequality (Nelson, Winling et al., University of Richmond), CC BY-NC-SA 4.0 (non-commercial)',
    years: '1935–1940',
    folder: 'context/holc/',
    chunk: 'bbox',
  });
  for (const year of [1900, 1910, 1920, 1930])
    items.push({
      id: `point:ed${year}`,
      level: 'point',
      group: 'History',
      label: `Census enumeration district at each point, ${year}`,
      fields: [
        {
          key: 'ed',
          name: `ed${year}`,
          label: `Enumeration district, ${year} census`,
          kind: 'string',
        },
        {
          key: 'city',
          name: `ed${year}_city`,
          label: `Enumeration district city, ${year}`,
          kind: 'string',
        },
      ],
      source: 'Urban Transition Historical GIS Project, Brown University',
      years: String(year),
      folder: `context/enumeration-districts-${year}/`,
      chunk: 'bbox',
    });
  return items;
}
export const MERGE_CATALOG = Object.freeze(catalogItems());

/** Levels whose data a join can take: its own and the areas it sits in. */
export function levelsFor(join) {
  if (join.kind === 'points')
    return ['tract', 'county', 'state', 'place', 'point'];
  if (join.kind !== 'geoid') return [];
  return {
    'block group': ['tract', 'county', 'state'],
    tract: ['tract', 'county', 'state'],
    county: ['county', 'state'],
    place: ['place', 'state'],
    state: ['state'],
  }[join.level];
}

/** The catalog a join can take, grouped: `[{group, items}]`. */
export function mergeChoices(join) {
  const order = levelsFor(join);
  const levels = new Set(order);
  const groups = new Map();
  for (const item of MERGE_CATALOG) {
    if (!levels.has(item.level)) continue;
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push(item);
  }
  // The file's own level first (tracts), then the areas it sits in.
  const rank = (i) => order.indexOf(i.level);
  return GROUP_ORDER.filter((g) => groups.has(g))
    .concat([...groups.keys()].filter((g) => !GROUP_ORDER.includes(g)))
    .map((group) => ({
      group,
      items: groups.get(group).sort((a, b) => rank(a) - rank(b)),
    }));
}

/** Catalog items whose id or label matches a phrase (voice: "poverty"). */
export function findMergeItems(join, phrases) {
  const levels = new Set(levelsFor(join));
  const items = MERGE_CATALOG.filter((i) => levels.has(i.level));
  const out = new Set();
  const measureId = (i) => i.id.slice(i.id.indexOf(':') + 1);
  for (const phrase of phrases) {
    const p = String(phrase).toLowerCase().trim();
    if (!p) continue;
    const kebab = p.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const aliased = REPORT_MEASURES.filter((m) =>
      (m.aliases || []).some((a) => a.toLowerCase() === p),
    ).map((m) => m.id);
    // Best tier first: the exact measure, every measure the phrase starts
    // ("segregation" → all three pairs), an alias, then any label containing it.
    const tiers = [
      items.filter((i) => measureId(i) === kebab),
      items.filter((i) => measureId(i).startsWith(kebab)),
      items.filter((i) => aliased.includes(measureId(i))),
      items.filter((i) => i.label.toLowerCase().includes(p)),
    ];
    const hits = tiers.find((t) => t.length) || [];
    // A tract file asking for "poverty" gets the tract measure, not every
    // level: the finest level that has it ("segregation": the county indices).
    const order =
      join.kind === 'points'
        ? ['point', 'tract', 'place', 'county', 'state']
        : levelsFor(join);
    const level = order.find((l) => hits.some((i) => i.level === l));
    for (const i of hits.filter((h) => h.level === level)) out.add(i.id);
  }
  return [...out];
}

// ---------- reading the app's files ----------

/** Cached reads of public/context through `readContext`. */
export function contextLibrary(readContext) {
  const cache = new Map();
  const text = (p) => {
    // A missing file (an ID with no area) reads as nothing.
    if (!cache.has(p))
      cache.set(
        p,
        new Promise((resolve) => resolve(readContext(p))).catch(() => null),
      );
    return cache.get(p);
  };
  const json = async (p) => {
    const t = await text(p);
    return t ? JSON.parse(t) : null;
  };
  const features = async (p) => {
    const t = await text(p);
    if (!t) return [];
    const out = [];
    for (const line of t.split(/\r?\n/))
      if (line.trim()) out.push(JSON.parse(line));
    return out;
  };
  return { text, json, features };
}

/** Run `work` over `list` with at most `limit` at a time. */
async function pool(list, limit, work) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, list.length) }, async () => {
      while (next < list.length) {
        const i = next;
        next += 1;
        await work(list[i], i);
      }
    }),
  );
}

/** Properties by GEOID for the chunks of a folder. */
async function propertiesByGeoid(library, folder, chunkIds) {
  const out = new Map();
  await pool(chunkIds, 12, async (id) => {
    for (const f of await library.features(`${folder}${id}.geojsonl`))
      out.set(String(f.properties?.geoid ?? ''), f.properties || {});
  });
  return out;
}

// Polygons with their bboxes, for point lookups.
const withBbox = (features) =>
  features
    .filter((f) => f.geometry)
    .map((f) => ({ f, box: geometryBbox(f.geometry) }))
    .filter((x) => x.box);
const inBox = ([x, y], [w, s, e, n]) => x >= w && x <= e && y >= s && y <= n;
function locate(point, polygons) {
  for (const { f, box } of polygons)
    if (inBox(point, box) && pointInGeometry(point, f.geometry)) return f;
  return null;
}

/**
 * The state, county and tract (and, on request, city) each point falls in:
 * `{state, county, tract, place}` arrays of GEOIDs (null outside).
 */
export async function tagPoints(
  points,
  library,
  { place = false, onProgress } = {},
) {
  const n = points.length;
  const out = {
    state: new Array(n).fill(null),
    county: new Array(n).fill(null),
    tract: new Array(n).fill(null),
    place: new Array(n).fill(null),
  };
  const states = withBbox(
    await library.features('context/states/states.geojsonl'),
  );
  const byState = new Map();
  points.forEach((p, i) => {
    if (!p) return;
    const f = locate(p, states);
    if (!f) return;
    const g = String(f.properties.geoid);
    out.state[i] = g;
    if (!byState.has(g)) byState.set(g, []);
    byState.get(g).push(i);
  });
  onProgress?.('Finding each point’s county…');
  const byCounty = new Map();
  await pool([...byState], 6, async ([state, list]) => {
    const counties = withBbox(
      await library.features(
        `context/county-life-expectancy/${state}.geojsonl`,
      ),
    );
    for (const i of list) {
      const f = locate(points[i], counties);
      if (!f) continue;
      const g = String(f.properties.geoid);
      out.county[i] = g;
      if (!byCounty.has(g)) byCounty.set(g, []);
      byCounty.get(g).push(i);
    }
    if (place) {
      const abbr = STATES[state]?.[0];
      const cities = abbr
        ? withBbox(
            await library.features(`context/segregation/${abbr}.geojsonl`),
          )
        : [];
      for (const i of list) {
        const f = locate(points[i], cities);
        if (f) out.place[i] = String(f.properties.geoid);
      }
    }
  });
  onProgress?.('Finding each point’s tract…');
  await pool([...byCounty], 8, async ([county, list]) => {
    const tracts = withBbox(
      await library.features(`context/tracts-2020/${county}.geojsonl`),
    );
    for (const i of list) {
      const f = locate(points[i], tracts);
      if (f) out.tract[i] = String(f.properties.geoid);
    }
  });
  return out;
}

/** Properties of the polygon (of a bbox-chunked layer) each point falls in. */
async function pointPolygons(points, library, folder) {
  const index = (await library.json(`${folder}index.json`)) || [];
  const wanted = new Map();
  points.forEach((p, i) => {
    if (!p) return;
    for (const entry of index)
      if (entry.bbox && inBox(p, entry.bbox)) {
        if (!wanted.has(entry.id)) wanted.set(entry.id, []);
        wanted.get(entry.id).push(i);
      }
  });
  const out = new Array(points.length).fill(null);
  await pool([...wanted], 8, async ([id, list]) => {
    const polygons = withBbox(
      await library.features(`${folder}${id}.geojsonl`),
    );
    for (const i of list) {
      if (out[i]) continue;
      const f = locate(points[i], polygons);
      if (f) out[i] = f.properties || {};
    }
  });
  return out;
}

/**
 * Attach the chosen catalog items to a table. Points are first tagged with
 * their state, county and tract (columns hev_state_geoid, …). Every row is
 * kept; `hev_matched` says whether a row found its area. Returns `{table,
 * report}`.
 */
export async function attachData(
  table,
  join,
  itemIds,
  { readContext, library = contextLibrary(readContext), onProgress } = {},
) {
  const items = [...new Set(itemIds)]
    .map((id) => MERGE_CATALOG.find((i) => i.id === id))
    .filter(Boolean);
  if (!items.length)
    throw new Error('Choose at least one kind of data to attach.');
  const levels = new Set(levelsFor(join));
  const bad = items.find((i) => !levels.has(i.level));
  if (bad)
    throw new Error(
      `${bad.label} cannot be attached to ${join.kind === 'points' ? 'points' : `a file of ${join.level ? LEVEL_NOUN[join.level] : ''} rows`}.`,
    );
  const n = table.rows.length;
  const columns = [...table.columns];
  const rows = table.rows.map((r) => [...r]);
  const names = new Set(columns.map((c) => c.name.toLowerCase()));
  const add = (column, values) => {
    const name = freeName(names, column.name);
    columns.push({ ...column, name });
    values.forEach((v, i) => rows[i].push(v ?? null));
  };
  // The GEOID of each row at each level.
  const ids = { tract: null, county: null, state: null, place: null };
  let points = null;
  if (join.kind === 'points') {
    points = join.points;
    onProgress?.('Finding each point’s state…');
    const tagged = await tagPoints(points, library, {
      place: items.some((i) => i.level === 'place'),
      onProgress,
    });
    Object.assign(ids, tagged);
    add(
      {
        name: 'hev_state_geoid',
        label: 'State the point is in (FIPS)',
        kind: 'string',
        source: 'Census TIGER/Line state boundaries',
      },
      ids.state,
    );
    add(
      {
        name: 'hev_county_geoid',
        label: 'County the point is in (GEOID)',
        kind: 'string',
        source: 'Census TIGER/Line county boundaries',
      },
      ids.county,
    );
    add(
      {
        name: 'hev_tract_geoid',
        label: 'Census tract the point is in (2020 GEOID)',
        kind: 'string',
        source: 'Census TIGER/Line 2020 tract boundaries',
      },
      ids.tract,
    );
    if (items.some((i) => i.level === 'place'))
      add(
        {
          name: 'hev_city_geoid',
          label: 'City the point is in (place GEOID, cities of 75,000+)',
          kind: 'string',
          source: 'Census places',
        },
        ids.place,
      );
  } else {
    // The clean GEOID the join used (Excel drops leading zeros).
    if (!columns.some((c) => c.name === 'hev_geoid'))
      add(
        {
          name: 'hev_geoid',
          label: `Census GEOID used for the merge (${LEVEL_NOUN[join.level]}, from ${join.how})`,
          kind: 'string',
        },
        join.ids,
      );
    const own = join.ids.map((g) =>
      g && join.level === 'block group' ? g.slice(0, 11) : g,
    );
    if (['tract', 'block group'].includes(join.level)) ids.tract = own;
    if (['tract', 'block group', 'county'].includes(join.level))
      ids.county = own.map((g) => (g ? g.slice(0, 5) : null));
    if (join.level === 'place') ids.place = own;
    ids.state = own.map((g) => (g ? g.slice(0, 2) : null));
  }
  const report = { attached: [], matched: {}, notes: [] };
  // Which rows found their area: at the finest level whose data was chosen.
  const found = {};
  // Area data, level by level.
  for (const level of ['tract', 'county', 'state', 'place']) {
    const chosen = items.filter((i) => i.level === level);
    if (!chosen.length) continue;
    const rowIds = ids[level] || [];
    onProgress?.(`Reading ${LEVEL_NOUN[level]} data…`);
    for (const item of chosen) {
      const wanted = [...new Set(rowIds.filter(Boolean))];
      const chunks =
        item.chunk === 'county'
          ? [...new Set(wanted.map((g) => g.slice(0, 5)))]
          : item.chunk === 'state'
            ? [...new Set(wanted.map((g) => g.slice(0, 2)))]
            : item.chunk === 'abbr'
              ? [
                  ...new Set(
                    (ids.state || [])
                      .filter(Boolean)
                      .map((s) => STATES[s]?.[0])
                      .filter(Boolean),
                  ),
                ]
              : ['states'];
      const values = await propertiesByGeoid(library, item.folder, chunks);
      // USALEEP is on 2010 tracts: a 2020 tract whose ID is not among them
      // takes the value of the 2010 tract containing its center (split tracts
      // share their parent's estimate).
      let byLocation = 0;
      if (item.byLocation) {
        const missing = [...new Set(rowIds.filter((g) => g && !values.has(g)))];
        const byCounty = new Map();
        for (const g of missing) {
          const c = g.slice(0, 5);
          if (!byCounty.has(c)) byCounty.set(c, []);
          byCounty.get(c).push(g);
        }
        await pool([...byCounty], 8, async ([county, list]) => {
          const old = withBbox(
            await library.features(`${item.folder}${county}.geojsonl`),
          );
          if (!old.length) return;
          const now = new Map(
            (
              await library.features(`context/tracts-2020/${county}.geojsonl`)
            ).map((f) => [String(f.properties?.geoid), f.geometry]),
          );
          for (const g of list) {
            const point = now.get(g) ? geometryPoint(now.get(g)) : null;
            const f = point ? locate(point, old) : null;
            if (f) {
              values.set(g, { ...f.properties, geoid: g });
              byLocation += 1;
            }
          }
        });
      }
      let hit = 0;
      for (const field of item.fields)
        add(
          {
            name: field.name,
            label: field.label,
            kind: field.kind,
            source: item.source,
            years: item.years,
          },
          rowIds.map((g) => {
            const p = g ? values.get(g) : null;
            const v = p ? p[field.key] : null;
            return v === undefined
              ? null
              : field.kind === 'numeric'
                ? Number.isFinite(v)
                  ? v
                  : toNumber(v)
                : v === null
                  ? null
                  : String(v);
          }),
        );
      found[level] ||= new Set();
      for (const g of rowIds)
        if (g && values.has(g)) {
          hit += 1;
          found[level].add(g);
        }
      report.attached.push(item.id);
      report.matched[item.id] = hit;
      if (byLocation)
        report.notes.push(
          `USALEEP life expectancy is on 2010 tracts: ${byLocation.toLocaleString('en-US')} tract${byLocation === 1 ? '' : 's'} split or renumbered in 2020 took the value of the 2010 tract containing ${byLocation === 1 ? 'its' : 'their'} center.`,
        );
    }
  }
  // Point-in-polygon layers (HOLC, enumeration districts).
  for (const item of items.filter((i) => i.level === 'point')) {
    onProgress?.(`Finding ${item.label.toLowerCase()}…`);
    const found = await pointPolygons(points, library, item.folder);
    for (const field of item.fields)
      add(
        {
          name: field.name,
          label: field.label,
          kind: field.kind,
          source: item.source,
          years: item.years,
        },
        found.map((p) => {
          const v = p?.[field.key];
          return v === undefined || v === null || v === '' ? null : String(v);
        }),
      );
    report.attached.push(item.id);
    report.matched[item.id] = found.filter(Boolean).length;
  }
  // Did each row find its area? Points: located in a tract. Files of areas:
  // the row's own area (or the finest area chosen) is one of the map's.
  const level = ['tract', 'place', 'county', 'state'].find((l) => found[l]);
  const matchedRows =
    join.kind === 'points'
      ? ids.tract.map((g) => (g ? 3 : 1))
      : (ids[level] || ids.state).map((g) =>
          g && found[level]?.has(g) ? 3 : 1,
        );
  if (!columns.some((c) => c.name === 'hev_matched'))
    add(
      {
        name: 'hev_matched',
        label:
          join.kind === 'points'
            ? 'Point located in a US census area'
            : 'Row matched to the map’s areas',
        kind: 'numeric',
        valueLabels: { 1: 'Not matched', 3: 'Matched' },
      },
      matchedRows,
    );
  report.rows = n;
  report.matchedRows = matchedRows.filter((v) => v === 3).length;
  return {
    table: { ...table, columns, rows, geometries: table.geometries },
    report,
  };
}

/**
 * Count points per tract, county or state: one row per area (tracts in the
 * counties with points; counties in the states with points; every state),
 * with the count and a rate per 1,000 residents. The result joins by GEOID,
 * so data can be attached to it next.
 */
export async function countPoints(
  table,
  join,
  level,
  { readContext, library = contextLibrary(readContext), onProgress } = {},
) {
  if (join.kind !== 'points')
    throw new Error('Counting needs a file of points.');
  onProgress?.('Finding each point’s area…');
  const tagged = await tagPoints(join.points, library, { onProgress });
  const counts = new Map();
  for (const g of tagged[level]) if (g) counts.set(g, (counts.get(g) || 0) + 1);
  let areas = [];
  if (level === 'state')
    areas = await library.features('context/states/states.geojsonl');
  else if (level === 'county') {
    const states = [...new Set(tagged.state.filter(Boolean))];
    for (const s of states)
      areas.push(
        ...(await library.features(
          `context/county-life-expectancy/${s}.geojsonl`,
        )),
      );
  } else {
    const counties = [...new Set(tagged.county.filter(Boolean))];
    await pool(counties, 8, async (c) => {
      areas.push(
        ...(await library.features(`context/tracts-2020/${c}.geojsonl`)),
      );
    });
  }
  const props = areas
    .map((f) => f.properties || {})
    .sort((a, b) => String(a.geoid).localeCompare(String(b.geoid)));
  const noun = LEVEL_NOUN[level];
  const columns = [
    { name: 'geoid', label: `Census GEOID (${noun})`, kind: 'string' },
    {
      name: 'name',
      label: `${noun[0].toUpperCase()}${noun.slice(1)} name`,
      kind: 'string',
    },
    { name: 'state', label: 'State (postal code)', kind: 'string' },
    {
      name: 'points',
      label: `Points from ${table.name} in this ${noun}`,
      kind: 'numeric',
    },
    {
      name: 'population',
      label: 'Total population, 2020–24 (ACS)',
      kind: 'numeric',
      source: 'ACS 2020–2024 5-year',
    },
    {
      name: 'points_per_1000',
      label: 'Points per 1,000 residents',
      kind: 'numeric',
    },
  ];
  const rows = props.map((p) => {
    const g = String(p.geoid);
    const count = counts.get(g) || 0;
    const pop = Number.isFinite(p.pop24) ? p.pop24 : null;
    return [
      g,
      p.name ?? null,
      STATES[g.slice(0, 2)]?.[0] ?? null,
      count,
      pop,
      pop ? Math.round((count / pop) * 1000 * 1000) / 1000 : null,
    ];
  });
  const outside =
    join.points.filter(Boolean).length -
    [...counts.values()].reduce((s, v) => s + v, 0);
  const notes = [];
  if (level === 'tract')
    notes.push(
      'Tracts in counties with no points are not listed (they have none).',
    );
  if (outside > 0)
    notes.push(
      `${outside.toLocaleString('en-US')} points are outside US ${noun === 'city' ? 'cities' : `${noun === 'county' ? 'counties' : `${noun}s`}`}.`,
    );
  return {
    table: {
      name: `${String(table.name).replace(/\.[a-z0-9]+$/i, '')} — points per ${noun}`,
      columns,
      rows,
      geometries: null,
      sources: [table.name],
    },
    join: {
      kind: 'geoid',
      level,
      ids: rows.map((r) => r[0]),
      how: 'the geoid column',
      column: 'geoid',
    },
    report: { areas: rows.length, withPoints: counts.size, outside, notes },
  };
}

// ---------- writing ----------

export const EXPORT_FORMATS = Object.freeze({
  csv: { label: 'CSV (.csv)', ext: 'csv', mime: 'text/csv' },
  xlsx: {
    label: 'Excel (.xlsx)',
    ext: 'xlsx',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  },
  dta: { label: 'Stata (.dta)', ext: 'dta', mime: 'application/x-stata-dta' },
  sav: { label: 'SPSS (.sav)', ext: 'sav', mime: 'application/x-spss-sav' },
  rdata: {
    label: 'R (.RData)',
    ext: 'RData',
    mime: 'application/octet-stream',
  },
  rds: { label: 'R (.rds)', ext: 'rds', mime: 'application/octet-stream' },
});

const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  const t = String(v);
  return /[",\r\n]/.test(t) || /^\s|\s$/.test(t)
    ? `"${t.replace(/"/g, '""')}"`
    : t;
};

/** A table as CSV text (with a byte-order mark, so Excel reads UTF-8). */
export function tableCsv(table, names = table.columns.map((c) => c.name)) {
  return `﻿${[names.map(csvCell).join(','), ...table.rows.map((r) => r.map(csvCell).join(','))].join('\r\n')}\r\n`;
}

/** A safe file stem from a name. */
export function fileStem(name) {
  return (
    String(name || 'data')
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'data'
  );
}

/** Raw DEFLATE with the platform's CompressionStream (null where there is none). */
async function deflateRaw(bytes) {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Run a ZIP-building function `build(deflate)` with compression: the ZIP
 * writers take a synchronous deflate, the platform's is asynchronous, so the
 * first pass records each entry, they are compressed, and the second pass
 * (same entries, same order) uses the results.
 */
export async function withDeflate(build) {
  if (typeof CompressionStream !== 'function') return build(null);
  const inputs = [];
  build((bytes) => {
    inputs.push(bytes);
    return bytes;
  });
  const outputs = await Promise.all(inputs.map((b) => deflateRaw(b)));
  let k = 0;
  return build(() => outputs[k++]);
}

/** Which program a format's names follow. */
const PROGRAM = { dta: 'stata', sav: 'spss', rdata: 'r', rds: 'r' };

/** Codebook rows: name in the file, original name, label, type, source, years. */
export function codebookRows(table, format) {
  const program = PROGRAM[format];
  const { names } = program
    ? programNames(table.columns, program)
    : { names: table.columns.map((c) => c.name) };
  return table.columns.map((c, j) => [
    names[j],
    c.name,
    c.label || '',
    c.kind === 'string' ? 'text' : 'number',
    c.valueLabels
      ? Object.entries(c.valueLabels)
          .map(([k, v]) => `${k} = ${v}`)
          .join('; ')
      : '',
    c.source || (c.origin ? `Your file: ${c.origin}` : ''),
    c.years || '',
  ]);
}

const CODEBOOK_HEADER = [
  'variable',
  'original_name',
  'label',
  'type',
  'codes',
  'source',
  'years',
];

/** The merge log and terms, as README text. */
export function readmeText(
  table,
  { log = [], format, date = new Date() } = {},
) {
  const sources = [
    ...new Set(table.columns.map((c) => c.source).filter(Boolean)),
  ];
  return [
    `${table.name} — merged and exported by Husky Eye View`,
    `Written ${date.toISOString().slice(0, 16).replace('T', ' ')} UTC as ${EXPORT_FORMATS[format]?.label || format}.`,
    '',
    `${table.rows.length.toLocaleString('en-US')} rows, ${table.columns.length} variables.`,
    '',
    'What was done',
    ...log.map((line, i) => `  ${i + 1}. ${line}`),
    '',
    'Files',
    `  data file   the merged table`,
    '  codebook.csv   every variable: its name in this file, original name, label, type, codes, source and years',
    '',
    'Sources of the attached data',
    ...(sources.length
      ? sources.map((s) => `  - ${s}`)
      : ['  (none: only your own files)']),
    '',
    'Terms: every attached dataset keeps its own terms. Mapping Inequality’s HOLC maps are',
    'CC BY-NC-SA 4.0 (non-commercial, share alike). Cite each source you use. Your own files',
    'never left your computer: the merge ran in the browser.',
    '',
  ].join('\r\n');
}

/** The data file alone: `{fileName, bytes, mime, renames, notes}`. */
export async function exportTable(
  table,
  format,
  { now = new Date(), title } = {},
) {
  const spec = EXPORT_FORMATS[format];
  if (!spec) throw new Error(`No export format “${format}”.`);
  const stem = fileStem(table.name);
  const heading =
    title || `Husky Eye View: ${table.name}, ${table.rows.length} rows`;
  const dataset = {
    title: heading,
    variables: table.columns,
    rows: table.rows,
  };
  let result;
  if (format === 'csv')
    result = {
      bytes: new TextEncoder().encode(tableCsv(table)),
      renames: [],
      notes: [],
    };
  else if (format === 'xlsx') {
    const codebook = codebookRows(table, 'xlsx');
    const sheets = [
      {
        name: 'Data',
        freeze: 1,
        rows: [
          table.columns.map((c) => ({ v: c.name, s: 'header' })),
          ...table.rows.map((row) =>
            row.map((v, j) =>
              v === null || v === undefined || v === ''
                ? null
                : table.columns[j].kind === 'string'
                  ? String(v)
                  : Number.isFinite(Number(v))
                    ? Number(v)
                    : String(v),
            ),
          ),
        ],
      },
      {
        name: 'Variables',
        freeze: 1,
        widths: [26, 26, 60, 8, 30, 60, 12],
        rows: [CODEBOOK_HEADER.map((v) => ({ v, s: 'header' })), ...codebook],
      },
    ];
    result = {
      bytes: await withDeflate((deflate) =>
        buildWorkbook(sheets, { title: heading, deflate }),
      ),
      renames: [],
      notes: [],
    };
  } else if (format === 'dta') result = writeDta(dataset, { now });
  else if (format === 'sav') result = writeSav(dataset, { now });
  else {
    const r = writeRData(dataset, {
      rds: format === 'rds',
      objectName: 'hev_data',
    });
    result = { ...r, bytes: await gzipBytes(r.bytes) };
  }
  return { fileName: `${stem}.${spec.ext}`, mime: spec.mime, ...result };
}

/**
 * The data file with its codebook and README, in one ZIP:
 * `{fileName, bytes, mime, renames, notes}`.
 */
export async function exportBundle(
  table,
  format,
  { log = [], now = new Date() } = {},
) {
  const data = await exportTable(table, format, { now });
  const codebook = [CODEBOOK_HEADER, ...codebookRows(table, format)];
  const files = [
    { name: data.fileName, data: data.bytes },
    {
      name: 'codebook.csv',
      data: `﻿${codebook.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`,
    },
    {
      name: 'README.txt',
      data: readmeText(table, {
        log: [...log, ...data.notes],
        format,
        date: now,
      }),
    },
  ];
  return {
    fileName: `${fileStem(table.name)}_${EXPORT_FORMATS[format].ext.toLowerCase()}.zip`,
    bytes: await withDeflate((deflate) => buildZip(files, now, { deflate })),
    mime: 'application/zip',
    renames: data.renames,
    notes: data.notes,
  };
}
