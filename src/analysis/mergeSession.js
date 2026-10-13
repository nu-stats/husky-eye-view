/**
 * One Merge & Export session: your file, the steps taken on it, and the
 * exports. The worker (mergeWorker.js), the terminal command and the tests
 * drive it; it never touches the page.
 *
 * Two uses: **convert** (your file, as read, in another format) and **merge**
 * (your file with a second file and the app's data, delivered with a
 * Stata do-file, an R script and a description of every step).
 */
import {
  EXPORT_FORMATS,
  READ_FORMATS,
  attachData,
  codebookRows,
  contextLibrary,
  countPoints,
  describeJoin,
  expandRows,
  expands,
  LEVEL_NOUN,
  levelOfGeoid,
  exportTable,
  fileStem,
  findJoin,
  findMergeItems,
  mergeChoices,
  mergeTables,
  readTable,
  suggestKeys,
  withDeflate,
  MERGE_CATALOG,
} from './mergeData.js';
import { replicationFiles } from './mergeScript.js';
import { writeShapefile } from './shapefileWrite.js';
import { buildZip } from '../curated/curatedFiles.js';
import { geometryPoint } from '../curated/userData.js';
import { STATES } from '../reports/areaReport.js';

export { READ_FORMATS };

const CODEBOOK_HEADER = [
  'variable',
  'original_name',
  'label',
  'type',
  'codes',
  'source',
  'years',
];
const csvCell = (v) => {
  if (v === null || v === undefined) return '';
  const t = String(v);
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const codebookCsv = (table, format) =>
  `﻿${[CODEBOOK_HEADER, ...codebookRows(table, format)].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

/** The app's file with a GEOID's outline (by the ID's own level), or null. */
function outlineChunk(g) {
  const level = levelOfGeoid(g);
  if (level === 'tract') return `context/tracts-2020/${g.slice(0, 5)}.geojsonl`;
  if (level === 'county')
    return `context/county-life-expectancy/${g.slice(0, 2)}.geojsonl`;
  if (level === 'state') return 'context/states/states.geojsonl';
  if (level === 'place') {
    const abbr = STATES[g.slice(0, 2)]?.[0];
    return abbr ? `context/segregation/${abbr}.geojsonl` : null;
  }
  return null;
}

/** Polygons drawn at most; above this the map shows a dot per area. */
export const MAX_MAP_POLYGONS = 1500;
/** Dots drawn at most. */
export const MAX_MAP_POINTS = 50_000;

export class MergeSession {
  constructor({ readContext }) {
    this.library = contextLibrary(readContext);
    this.reset(true);
  }

  reset(all = false) {
    if (all) {
      this.base = null;
      this.current = null;
    } else if (this.base)
      this.current = { table: this.base.table, join: this.base.join };
    this.second = null;
    this.steps = this.base ? [this.steps?.[0]].filter(Boolean) : [];
  }

  /** Read your file (or the second one). */
  async open(name, bytes, which = 'first') {
    const table = await readTable(name, bytes);
    if (which === 'second') {
      this.second = { name, table, bytes };
      return {
        ok: true,
        rows: table.rows.length,
        columns: table.columns.length,
        columnNames: table.columns.map((c) => c.name),
        keys: suggestKeys(this.current.table, table),
      };
    }
    const join = findJoin(table);
    // Each row's row in your file, carried through every merge, so the
    // shapefile keeps your file's own geography.
    table.origin = table.rows.map((_, i) => i);
    this.shapes = null;
    this.base = { name, table, join, bytes };
    this.current = { table, join };
    this.second = null;
    this.steps = [
      { op: 'read', name, table, bytes, describe: describeJoin(table, join) },
    ];
    return { ok: true, ...this.summary() };
  }

  summary() {
    if (!this.current) return { file: null };
    const { table, join } = this.current;
    return {
      file: this.base.name,
      rows: table.rows.length,
      columns: table.columns.map((c) => ({
        name: c.name,
        kind: c.kind,
        label: c.label || '',
      })),
      join: {
        kind: join.kind,
        level: join.level || null,
        how: join.how || null,
      },
      describe: describeJoin(table, join),
      notes: table.notes || [],
      sheet: table.sheet || null,
      steps: this.log(),
    };
  }

  /** The steps as one line each. */
  log() {
    return this.steps.map((s) => {
      if (s.op === 'read') return `Read ${s.name}: ${s.describe}`;
      if (s.op === 'merge')
        return `Merged ${s.report.other} on ${s.report.leftKey} = ${s.report.rightKey} (${s.report.relation}): ${s.report.matched} matched; ${s.report.rows} rows.`;
      if (s.op === 'attach')
        return `Added ${s.items.map((i) => i.label).join('; ')}: ${s.report.matchedRows} of ${s.report.rows} rows matched.`;
      if (s.op === 'expand')
        return `Made one row per ${LEVEL_NOUN[s.report.to]} in each ${LEVEL_NOUN[s.report.from]}: ${s.report.rowsBefore} rows became ${s.report.rows}.`;
      return `Counted the points per ${s.report.level}: ${s.report.withPoints} of ${s.report.areas} areas have points.`;
    });
  }

  choices() {
    return this.current
      ? mergeChoices(this.current.join).map(({ group, items }) => ({
          group,
          items: items.map(({ id, label, level, source, expands: grows }) => ({
            id,
            label,
            level,
            source,
            expands: Boolean(grows),
          })),
        }))
      : [];
  }

  findItems(phrases) {
    return this.current ? findMergeItems(this.current.join, phrases) : [];
  }

  mergeSecond({ leftKey, rightKey, keep }) {
    const before = this.current.table;
    const { table, report } = mergeTables(before, this.second.table, {
      leftKey,
      rightKey,
      keep,
    });
    this.steps.push({
      op: 'merge',
      before,
      other: this.second.table,
      after: table,
      report,
      bytes: this.second.bytes,
    });
    this.current = { table, join: findJoin(table) };
    this.second = null;
    return report;
  }

  async attach(ids, onProgress) {
    // Smaller units than the file's own (tract data for a county file):
    // first one row per tract (or county) in each area, then the data.
    let expanded = null;
    const wanted = [...new Set(ids)]
      .map((id) => MERGE_CATALOG.find((i) => i.id === id))
      .filter(Boolean);
    const finer = ['tract', 'county'].find((l) =>
      wanted.some((i) => i.level === l && expands(this.current.join, l)),
    );
    if (finer) {
      const before = this.current.table;
      const result = await expandRows(before, this.current.join, finer, {
        library: this.library,
        onProgress,
      });
      this.steps.push({
        op: 'expand',
        before,
        after: result.table,
        report: result.report,
      });
      this.current = { table: result.table, join: result.join };
      expanded = result.report;
    }
    const before = this.current.table;
    const join = this.current.join;
    const { table, report } = await attachData(before, join, ids, {
      library: this.library,
      onProgress,
    });
    const items = [...new Set(ids)]
      .map((id) => MERGE_CATALOG.find((i) => i.id === id))
      .filter(Boolean);
    this.steps.push({
      op: 'attach',
      before,
      after: table,
      join,
      items,
      report,
    });
    this.current = { table, join };
    const notes = [...report.notes];
    if (expanded)
      notes.unshift(
        `Each ${LEVEL_NOUN[expanded.from]} became one row per ${LEVEL_NOUN[expanded.to]} in it: ${expanded.rowsBefore.toLocaleString('en-US')} rows became ${expanded.rows.toLocaleString('en-US')}, each keeping its ${LEVEL_NOUN[expanded.from]}’s values${expanded.empty ? ` (${expanded.empty.toLocaleString('en-US')} without ${LEVEL_NOUN[expanded.to] === 'county' ? 'counties' : `${LEVEL_NOUN[expanded.to]}s`} ${expanded.empty === 1 ? 'stays' : 'stay'} one row)` : ''}.`,
      );
    return {
      rows: report.rows,
      matchedRows: report.matchedRows,
      attached: report.attached,
      notes,
      expanded: Boolean(expanded),
    };
  }

  async count(level, onProgress) {
    const before = this.current.table;
    const result = await countPoints(before, this.current.join, level, {
      library: this.library,
      onProgress,
    });
    this.steps.push({
      op: 'count',
      before,
      after: result.table,
      report: result.report,
    });
    this.current = { table: result.table, join: result.join };
    return result.report;
  }

  preview(n = 6, last = 12) {
    const { table } = this.current;
    const offset = Math.max(0, table.columns.length - last);
    return {
      rows: table.rows.length,
      columns: table.columns
        .slice(offset)
        .map((c) => ({ name: c.name, label: c.label || '', kind: c.kind })),
      sample: table.rows.slice(0, n).map((r) => r.slice(offset)),
      offset,
    };
  }

  /**
   * What to draw: polygons (few areas), a dot per area (many), or points;
   * each with the value of `column`. Outlines come from the app's files.
   */
  async mapData(column) {
    if (!this.current) return { mode: 'none', records: [] };
    const { table, join } = this.current;
    const j = table.columns.findIndex((c) => c.name === column);
    const value = (i) =>
      j >= 0 && typeof table.rows[i][j] === 'number' ? table.rows[i][j] : null;
    if (join.kind === 'points') {
      const records = [];
      for (
        let i = 0;
        i < join.points.length && records.length < MAX_MAP_POINTS;
        i += 1
      )
        if (join.points[i])
          records.push({ point: join.points[i], value: value(i) });
      return {
        mode: 'points',
        records,
        total: join.points.filter(Boolean).length,
      };
    }
    if (join.kind !== 'geoid') return { mode: 'none', records: [] };
    const byId = new Map();
    join.ids.forEach((g, i) => {
      if (!g) return;
      // The map preview draws a block group as its tract.
      const id = levelOfGeoid(g) === 'block group' ? g.slice(0, 11) : g;
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(value(i));
    });
    const chunks = [
      ...new Set([...byId.keys()].map(outlineChunk).filter(Boolean)),
    ];
    if (!chunks.length) return { mode: 'none', records: [] };
    const shapes = new Map();
    for (const path of chunks)
      for (const f of await this.library.features(path)) {
        const g = String(f.properties?.geoid ?? '');
        if (byId.has(g)) shapes.set(g, f.geometry);
      }
    const mean = (vals) => {
      const nums = vals.filter((v) => v !== null);
      return nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null;
    };
    const polygons = shapes.size <= MAX_MAP_POLYGONS;
    const records = [];
    for (const [g, geometry] of shapes)
      records.push(
        polygons
          ? { geoid: g, geometry, value: mean(byId.get(g)) }
          : {
              geoid: g,
              point: geometryPoint(geometry),
              value: mean(byId.get(g)),
            },
      );
    return {
      mode: polygons ? 'polygons' : 'dots',
      records,
      total: shapes.size,
    };
  }

  /**
   * The geography of your original file, one shape per row of it: its own
   * shapes (GeoJSON, shapefile), else the Census outline of each area it
   * names (tracts, counties, states, cities), else its points. Nothing else:
   * block groups (the app has no outlines for them) and rows without an ID
   * or location get no shape. Returns `{shapes, source}`.
   */
  async originalShapes() {
    if (this.shapes) return this.shapes;
    const { table, join } = this.base;
    const n = table.rows.length;
    let shapes = new Array(n).fill(null);
    let source;
    if (table.geometries?.some(Boolean)) {
      shapes = table.geometries.map((g) => g || null);
      source = `the shapes in ${this.base.name}`;
    } else if (join.kind === 'points') {
      shapes = join.points.map((p) =>
        p ? { type: 'Point', coordinates: p } : null,
      );
      source = `the points in ${this.base.name} (${join.how})`;
    } else if (join.kind === 'geoid') {
      const level = join.level;
      // Each ID's own outline (block groups have none in the app).
      const chunks = [
        ...new Set(join.ids.filter(Boolean).map(outlineChunk).filter(Boolean)),
      ];
      const outline = new Map();
      for (const path of chunks)
        for (const f of await this.library.features(path)) {
          const g = String(f.properties?.geoid ?? '');
          if (!outline.has(g)) outline.set(g, f.geometry);
        }
      shapes = join.ids.map((g) => (g ? outline.get(g) || null : null));
      const noun = {
        tract: '2020 census tract',
        county: 'county',
        state: 'state',
        place: 'city (cities of 75,000+)',
        mixed: 'area, at its own level',
      }[level];
      source = noun
        ? `the Census outline of each ${noun} in ${this.base.name} (matched by ${join.how})`
        : `none: the app has no outlines for ${level}s, so the rows have no shape`;
    } else
      throw new Error(
        'Your file has no census IDs, coordinates or shapes, so there is no geography for a shapefile.',
      );
    this.shapes = { shapes, source };
    return this.shapes;
  }

  /** A table's shapefile parts, named `stem.shp` …, from your file's shapes. */
  async shapefileParts(table, stem) {
    if (!table.origin)
      throw new Error(
        'After counting points per area, the rows are areas, not your file’s rows, so they have no shapes of your file; choose another format, or download the shapefile before counting.',
      );
    const { shapes, source } = await this.originalShapes();
    const geometries = table.origin.map((i) =>
      i === null || i === undefined ? null : shapes[i],
    );
    const written = writeShapefile(table, geometries);
    const files = Object.entries(written.files).map(([ext, data]) => ({
      name: `${stem}.${ext}`,
      data,
    }));
    return { files, renames: written.renames, notes: written.notes, source };
  }

  /** Option 1: the file as read, in another format (and its codebook). */
  async exportConverted(format, { codebook = false, now = new Date() } = {}) {
    const table = this.base.table;
    if (format === 'shp') {
      const stem = fileStem(table.name);
      const parts = await this.shapefileParts(table, stem);
      const files = [
        ...parts.files,
        ...(codebook
          ? [{ name: 'codebook.csv', data: codebookCsv(table, format) }]
          : []),
      ];
      return {
        fileName: `${stem}_shp.zip`,
        bytes: await withDeflate((deflate) =>
          buildZip(files, now, { deflate }),
        ),
        mime: 'application/zip',
        renames: parts.renames,
        notes: parts.notes,
      };
    }
    const file = await exportTable(table, format, {
      now,
      title: table.title || undefined,
    });
    if (!codebook) return file;
    const files = [
      { name: file.fileName, data: file.bytes },
      { name: 'codebook.csv', data: codebookCsv(table, format) },
    ];
    return {
      fileName: `${fileStem(table.name)}_${EXPORT_FORMATS[format].ext.toLowerCase()}.zip`,
      bytes: await withDeflate((deflate) => buildZip(files, now, { deflate })),
      mime: 'application/zip',
      renames: file.renames,
      notes: file.notes,
    };
  }

  /**
   * Option 2: the merged data in a format, with the do-file, the R script,
   * the description of every step, the codebook and the inputs, in a ZIP.
   */
  async exportMerged(format, { now = new Date() } = {}) {
    const table = {
      ...this.current.table,
      name: `${fileStem(this.base.name)}_merged`,
    };
    let data;
    let dataFiles;
    if (format === 'shp') {
      const parts = await this.shapefileParts(table, table.name);
      data = {
        renames: parts.renames,
        notes: parts.notes,
        shapes: parts.source,
      };
      dataFiles = parts.files;
    } else {
      data = await exportTable(table, format, { now });
      dataFiles = [{ name: data.fileName, data: data.bytes }];
    }
    const { files: scripts } = replicationFiles(
      this.steps,
      this.current.table,
      { format, date: now, shapes: data.shapes },
    );
    const files = [
      ...dataFiles,
      ...scripts,
      { name: 'codebook.csv', data: codebookCsv(this.current.table, format) },
    ];
    return {
      fileName: `${fileStem(this.base.name)}_merged_${EXPORT_FORMATS[format].ext.toLowerCase()}.zip`,
      bytes: await withDeflate((deflate) => buildZip(files, now, { deflate })),
      mime: 'application/zip',
      renames: data.renames,
      notes: data.notes,
    };
  }

  /** The current table as CSV, for the analysis boxes. */
  async csvForAnalysis() {
    return exportTable(
      { ...this.current.table, name: `${fileStem(this.base.name)}_merged` },
      'csv',
    );
  }
}
