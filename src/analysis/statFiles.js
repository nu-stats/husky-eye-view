/**
 * Data files for the statistics programs, written directly (no Stata, SPSS
 * or R needed): Stata .dta (format 118, read by Stata 14 and later), SPSS
 * .sav (an uncompressed system file, UTF-8), and R .RData / .rds (R's own
 * serialization, version 2, readable by every R since 2.3).
 *
 * A dataset is `{title, variables, rows}`: each variable `{name, label,
 * kind: 'numeric' | 'string', valueLabels?: {code: text}}`, each row an array
 * in variable order (null for a missing value). Each writer returns
 * `{bytes, renames, notes}`: `renames` lists names the program would not
 * accept, as `[from, to]`. No DOM and no Node APIs: the browser and the tests
 * share it.
 */

const encoder = new TextEncoder();

// ---------- bytes ----------

/** A growable little- or big-endian byte buffer. */
class Bytes {
  constructor(littleEndian = true, size = 1 << 16) {
    this.little = littleEndian;
    this.buffer = new Uint8Array(size);
    this.view = new DataView(this.buffer.buffer);
    this.length = 0;
  }

  reserve(n) {
    if (this.length + n <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
    this.view = new DataView(next.buffer);
  }

  bytes(data) {
    this.reserve(data.length);
    this.buffer.set(data, this.length);
    this.length += data.length;
  }

  ascii(text) {
    this.bytes(encoder.encode(text));
  }

  /** `data` (bytes) in exactly `width` bytes, padded with `fill`. */
  fixed(data, width, fill = 0) {
    this.reserve(width);
    const n = Math.min(data.length, width);
    this.buffer.set(data.subarray(0, n), this.length);
    this.buffer.fill(fill, this.length + n, this.length + width);
    this.length += width;
  }

  u8(v) {
    this.reserve(1);
    this.view.setUint8(this.length, v);
    this.length += 1;
  }

  u16(v) {
    this.reserve(2);
    this.view.setUint16(this.length, v, this.little);
    this.length += 2;
  }

  i32(v) {
    this.reserve(4);
    this.view.setInt32(this.length, v, this.little);
    this.length += 4;
  }

  u64(v) {
    this.reserve(8);
    this.view.setBigUint64(this.length, BigInt(v), this.little);
    this.length += 8;
  }

  f64(v) {
    this.reserve(8);
    this.view.setFloat64(this.length, v, this.little);
    this.length += 8;
  }

  /** Overwrite a uint64 already written at `at`. */
  setU64(at, v) {
    this.view.setBigUint64(at, BigInt(v), this.little);
  }

  done() {
    return this.buffer.slice(0, this.length);
  }
}

/** UTF-8 bytes of `text`, cut to at most `max` bytes on a character boundary. */
export function utf8Prefix(text, max) {
  const bytes = encoder.encode(String(text ?? ''));
  if (bytes.length <= max) return bytes;
  let end = max;
  // Back off continuation bytes (10xxxxxx) so no character is split.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return bytes.slice(0, end);
}

const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);

/** A cell as text for a string variable ('' when missing). */
const cellText = (v) =>
  v === null ||
  v === undefined ||
  (typeof v === 'number' && !Number.isFinite(v))
    ? ''
    : String(v);

/** Cell as a number for a numeric variable (null when missing or not a number). */
function cellNumber(v) {
  if (isNumber(v)) return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// ---------- names ----------

const STATA_RESERVED = new Set(
  '_all _b byte _coef _cons double float if in int long _n _N _pi _pred _rc _skip strL using with'.split(
    ' ',
  ),
);
const SPSS_RESERVED = new Set(
  'ALL AND BY EQ GE GT LE LT NE NOT OR TO WITH'.split(' '),
);
const R_RESERVED = new Set(
  'if else repeat while function for next break in TRUE FALSE NULL Inf NaN NA NA_integer_ NA_real_ NA_character_ NA_complex_'.split(
    ' ',
  ),
);

/**
 * Names a program accepts, unique, as close to the originals as possible.
 * Returns `{names, renames}`.
 */
export function programNames(variables, program) {
  const used = new Set();
  // SPSS and dBase (shapefile) names are case-insensitive.
  const keyOf = (n) =>
    program === 'spss' || program === 'dbf' ? n.toUpperCase() : n;
  const names = [];
  const renames = [];
  for (const v of variables) {
    const original = String(v.name ?? '');
    let base = original;
    if (program === 'stata') {
      base = base.replace(/[^A-Za-z0-9_]/g, '_');
      if (!/^[A-Za-z_]/.test(base)) base = `v${base}`;
      base = base.slice(0, 32);
      if (STATA_RESERVED.has(base) || /^str\d+$/.test(base))
        base = `${base.slice(0, 30)}_v`;
    } else if (program === 'dbf') {
      // dBase (shapefile) fields: ASCII letters, digits and _, at most 10.
      base = base.replace(/[^A-Za-z0-9_]/g, '_');
      if (!/^[A-Za-z]/.test(base)) base = `v${base}`;
      base = base.slice(0, 10);
    } else if (program === 'spss') {
      base = base.replace(/[^A-Za-z0-9_.@#$]/g, '_');
      if (!/^[A-Za-z@#$]/.test(base)) base = `v${base}`;
      base = base.slice(0, 64).replace(/[._]+$/, '') || 'v';
      if (SPSS_RESERVED.has(base.toUpperCase())) base = `${base}_v`;
    } else {
      // R: syntactic names (make.names), so d$name works.
      base = base.replace(/[^A-Za-z0-9._]/g, '_');
      if (!/^([A-Za-z]|\.(?!\d))/.test(base)) base = `X${base}`;
      if (R_RESERVED.has(base)) base = `${base}.`;
    }
    let name = base || 'v';
    const limit =
      program === 'stata'
        ? 32
        : program === 'spss'
          ? 64
          : program === 'dbf'
            ? 10
            : 10000;
    for (let k = 2; used.has(keyOf(name)); k += 1) {
      const suffix = `_${k}`;
      name = `${base.slice(0, limit - suffix.length)}${suffix}`;
    }
    used.add(keyOf(name));
    names.push(name);
    if (name !== original) renames.push([original, name]);
  }
  return { names, renames };
}

// ---------- Stata .dta (format 118) ----------

const DTA_DOUBLE = 65526;
const DTA_MAX_STR = 2045;
// Stata's system missing for a double: 2^1023.
const DTA_MISSING = new Uint8Array([0, 0, 0, 0, 0, 0, 0xe0, 0x7f]);
const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const two = (n) => String(n).padStart(2, '0');

/** A Stata .dta file (format 118). */
export function writeDta(
  { title = '', variables, rows },
  { now = new Date() } = {},
) {
  const notes = [];
  const { names, renames } = programNames(variables, 'stata');
  const K = variables.length;
  if (K > 32767) throw new Error('Stata files hold at most 32,767 variables.');
  // String widths in bytes; numbers are doubles.
  let truncated = 0;
  const types = variables.map((v, j) => {
    if (v.kind !== 'string') return DTA_DOUBLE;
    let width = 1;
    for (const row of rows) {
      const n = encoder.encode(cellText(row[j])).length;
      if (n > width) width = n;
    }
    if (width > DTA_MAX_STR) {
      truncated += 1;
      width = DTA_MAX_STR;
    }
    return width;
  });
  if (truncated)
    notes.push(
      `${truncated} text variable${truncated === 1 ? '' : 's'} had values over ${DTA_MAX_STR} bytes, cut to fit.`,
    );
  const out = new Bytes(true, Math.max(1 << 16, rows.length * K * 8 + 4096));
  const map = new Array(14).fill(0);
  const tag = (text) => out.ascii(text);
  map[0] = out.length;
  tag('<stata_dta><header><release>118</release><byteorder>LSF</byteorder><K>');
  out.u16(K);
  tag('</K><N>');
  out.u64(rows.length);
  tag('</N><label>');
  const label = utf8Prefix(title, 320);
  out.u16(label.length);
  out.bytes(label);
  tag('</label><timestamp>');
  const stamp = `${two(now.getDate())} ${MONTHS[now.getMonth()]} ${now.getFullYear()} ${two(now.getHours())}:${two(now.getMinutes())}`;
  out.u8(stamp.length);
  tag(stamp);
  tag('</timestamp></header>');
  map[1] = out.length;
  tag('<map>');
  const mapAt = out.length;
  for (let i = 0; i < 14; i += 1) out.u64(0);
  tag('</map>');
  map[2] = out.length;
  tag('<variable_types>');
  for (const t of types) out.u16(t);
  tag('</variable_types>');
  map[3] = out.length;
  tag('<varnames>');
  for (const n of names) out.fixed(encoder.encode(n), 129);
  tag('</varnames>');
  map[4] = out.length;
  tag('<sortlist>');
  for (let i = 0; i <= K; i += 1) out.u16(0);
  tag('</sortlist>');
  map[5] = out.length;
  tag('<formats>');
  types.forEach((t, j) => {
    const kind = variables[j].kind;
    const format =
      t !== DTA_DOUBLE
        ? `%${Math.min(t, 244)}s`
        : kind === 'date'
          ? '%td'
          : kind === 'datetime'
            ? '%tc'
            : '%10.0g';
    out.fixed(encoder.encode(format), 57);
  });
  tag('</formats>');
  // Value labels: one table per labelled variable, named after it.
  const labelled = variables.map((v, j) =>
    v.valueLabels &&
    types[j] === DTA_DOUBLE &&
    Object.keys(v.valueLabels).length
      ? names[j]
      : '',
  );
  map[6] = out.length;
  tag('<value_label_names>');
  for (const n of labelled) out.fixed(encoder.encode(n), 129);
  tag('</value_label_names>');
  map[7] = out.length;
  tag('<variable_labels>');
  for (const v of variables) out.fixed(utf8Prefix(v.label || '', 320), 321);
  tag('</variable_labels>');
  map[8] = out.length;
  tag('<characteristics></characteristics>');
  map[9] = out.length;
  tag('<data>');
  const dateShift = variables.map((v) =>
    v.kind === 'date' ? 3653 : v.kind === 'datetime' ? 3653 * 86_400_000 : 0,
  );
  for (const row of rows)
    for (let j = 0; j < K; j += 1) {
      if (types[j] === DTA_DOUBLE) {
        const n = cellNumber(row[j]);
        if (n === null) out.bytes(DTA_MISSING);
        // Dates: days (or ms) since 1960 in Stata, since 1970 here.
        else out.f64(dateShift[j] ? n + dateShift[j] : n);
      } else out.fixed(utf8Prefix(cellText(row[j]), types[j]), types[j]);
    }
  tag('</data>');
  map[10] = out.length;
  tag('<strls></strls>');
  map[11] = out.length;
  tag('<value_labels>');
  variables.forEach((v, j) => {
    if (!labelled[j]) return;
    const entries = Object.entries(v.valueLabels)
      .map(([code, text]) => [Number(code), utf8Prefix(text, 32000)])
      .filter(([code]) => Number.isInteger(code))
      .sort((a, b) => a[0] - b[0]);
    const txtLen = entries.reduce((s, [, t]) => s + t.length + 1, 0);
    tag('<lbl>');
    out.i32(8 + 8 * entries.length + txtLen);
    out.fixed(encoder.encode(labelled[j]), 129);
    out.fixed(new Uint8Array(0), 3);
    out.i32(entries.length);
    out.i32(txtLen);
    let off = 0;
    for (const [, t] of entries) {
      out.i32(off);
      off += t.length + 1;
    }
    for (const [code] of entries) out.i32(code);
    for (const [, t] of entries) {
      out.bytes(t);
      out.u8(0);
    }
    tag('</lbl>');
  });
  tag('</value_labels>');
  map[12] = out.length;
  tag('</stata_dta>');
  map[13] = out.length;
  map.forEach((v, i) => out.setU64(mapAt + i * 8, v));
  return { bytes: out.done(), renames, notes };
}

// ---------- SPSS .sav ----------

const SAV_MAX_STR = 255;
const SPSS_EPOCH = 12_219_379_200;
const SYSMIS = -Number.MAX_VALUE;
const spaces = (n) => new Uint8Array(n).fill(0x20);

/** Print/write format: F (numbers) or A (text). */
function savFormat(kind, width, decimals = 0) {
  return kind === 'string'
    ? (1 << 16) | (width << 8)
    : (5 << 16) | (width << 8) | decimals;
}

/** Display width and decimals for a numeric column. */
function numericFormat(rows, j) {
  let decimals = 0;
  let digits = 1;
  for (const row of rows.slice(0, 20000)) {
    const n = cellNumber(row[j]);
    if (n === null) continue;
    const text = String(Math.abs(n));
    if (/e/i.test(text)) {
      decimals = Math.max(decimals, 6);
      continue;
    }
    const [int, frac = ''] = text.split('.');
    digits = Math.max(digits, int.length);
    decimals = Math.max(decimals, Math.min(frac.length, 6));
  }
  const width = Math.min(40, digits + (decimals ? decimals + 1 : 0) + 1);
  return { width: Math.max(width, 8), decimals };
}

/** An SPSS system file (.sav), uncompressed, UTF-8. */
export function writeSav(
  { title = '', variables, rows },
  { now = new Date() } = {},
) {
  const notes = [];
  const { names, renames } = programNames(variables, 'spss');
  // Short (8-byte) names, unique, with the long names in record 7.13.
  const shortUsed = new Set();
  const shorts = names.map((n) => {
    const base = n
      .toUpperCase()
      .replace(/[^A-Z0-9_.@#$]/g, '_')
      .slice(0, 8);
    let s = base;
    for (let k = 2; shortUsed.has(s); k += 1)
      s = `${base.slice(0, 8 - String(k).length)}${k}`;
    shortUsed.add(s);
    return s;
  });
  let truncated = 0;
  const widths = variables.map((v, j) => {
    if (v.kind !== 'string') return 0;
    let width = 1;
    for (const row of rows) {
      const n = encoder.encode(cellText(row[j])).length;
      if (n > width) width = n;
    }
    if (width > SAV_MAX_STR) {
      truncated += 1;
      width = SAV_MAX_STR;
    }
    return width;
  });
  if (truncated)
    notes.push(
      `${truncated} text variable${truncated === 1 ? '' : 's'} had values over ${SAV_MAX_STR} bytes, cut to fit.`,
    );
  const segments = widths.map((w) => (w ? Math.ceil(w / 8) : 1));
  const caseSize = segments.reduce((s, n) => s + n, 0);
  const out = new Bytes(
    true,
    Math.max(1 << 16, rows.length * caseSize * 8 + 8192),
  );
  // File header.
  out.ascii('$FL2');
  out.fixed(encoder.encode('@(#) SPSS DATA FILE Husky Eye View'), 60, 0x20);
  out.i32(2);
  out.i32(caseSize);
  out.i32(0);
  out.i32(0);
  out.i32(rows.length);
  out.f64(100);
  const mon = MONTHS[now.getMonth()];
  out.ascii(`${two(now.getDate())} ${mon} ${two(now.getFullYear() % 100)}`);
  out.ascii(
    `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`,
  );
  out.fixed(utf8Prefix(title, 64), 64, 0x20);
  out.fixed(new Uint8Array(0), 3);
  // Variable records, with continuation records for long strings.
  const formats = variables.map((v, j) => {
    if (widths[j]) return savFormat('string', widths[j]);
    // DATE11 and DATETIME20.
    if (v.kind === 'date') return (20 << 16) | (11 << 8);
    if (v.kind === 'datetime') return (22 << 16) | (20 << 8);
    const { width, decimals } = numericFormat(rows, j);
    return savFormat('numeric', width, decimals);
  });
  // SPSS dates are seconds since 1582-10-14.
  const toSpss = variables.map((v) =>
    v.kind === 'date'
      ? (n) => n * 86400 + SPSS_EPOCH
      : v.kind === 'datetime'
        ? (n) => n / 1000 + SPSS_EPOCH
        : null,
  );
  const position = [];
  let index = 1;
  variables.forEach((v, j) => {
    position.push(index);
    index += segments[j];
    const label = utf8Prefix(v.label || '', 255);
    out.i32(2);
    out.i32(widths[j]);
    out.i32(label.length ? 1 : 0);
    out.i32(0);
    out.i32(formats[j]);
    out.i32(formats[j]);
    out.fixed(encoder.encode(shorts[j]), 8, 0x20);
    if (label.length) {
      out.i32(label.length);
      out.fixed(label, Math.ceil(label.length / 4) * 4, 0x20);
    }
    for (let k = 1; k < segments[j]; k += 1) {
      out.i32(2);
      out.i32(-1);
      out.i32(0);
      out.i32(0);
      out.i32(0);
      out.i32(0);
      out.bytes(spaces(8));
    }
  });
  // Value labels (numeric variables): record 3, then record 4 naming the variable.
  variables.forEach((v, j) => {
    if (widths[j] || !v.valueLabels) return;
    const entries = Object.entries(v.valueLabels).filter(([code]) =>
      Number.isFinite(Number(code)),
    );
    if (!entries.length) return;
    out.i32(3);
    out.i32(entries.length);
    for (const [code, text] of entries) {
      out.f64(Number(code));
      const t = utf8Prefix(text, 120);
      out.u8(t.length);
      out.fixed(t, Math.ceil((t.length + 1) / 8) * 8 - 1, 0x20);
    }
    out.i32(4);
    out.i32(1);
    out.i32(position[j]);
  });
  // 7.3 machine integers (IEEE, little-endian, UTF-8 = code page 65001).
  out.i32(7);
  out.i32(3);
  out.i32(4);
  out.i32(8);
  for (const v of [20, 0, 0, -1, 1, 1, 2, 65001]) out.i32(v);
  // 7.4 machine floating point: system missing, highest, lowest.
  out.i32(7);
  out.i32(4);
  out.i32(8);
  out.i32(3);
  out.f64(SYSMIS);
  out.f64(Number.MAX_VALUE);
  out.bytes(new Uint8Array([0xfe, 0xff, 0xff, 0xff, 0xff, 0xff, 0xef, 0xff]));
  // 7.11 display: measure (nominal text, scale numbers), width, alignment.
  out.i32(7);
  out.i32(11);
  out.i32(4);
  out.i32(variables.length * 3);
  variables.forEach((v, j) => {
    out.i32(widths[j] ? 1 : 3);
    out.i32(widths[j] ? Math.min(Math.max(widths[j], 8), 40) : 10);
    out.i32(widths[j] ? 0 : 1);
  });
  // 7.13 long names, 7.20 the character encoding.
  const longNames = encoder.encode(
    names.map((n, j) => `${shorts[j]}=${n}`).join('\t'),
  );
  out.i32(7);
  out.i32(13);
  out.i32(1);
  out.i32(longNames.length);
  out.bytes(longNames);
  const charset = encoder.encode('UTF-8');
  out.i32(7);
  out.i32(20);
  out.i32(1);
  out.i32(charset.length);
  out.bytes(charset);
  out.i32(999);
  out.i32(0);
  // The cases.
  for (const row of rows)
    variables.forEach((v, j) => {
      if (widths[j]) {
        out.fixed(
          utf8Prefix(cellText(row[j]), widths[j]),
          segments[j] * 8,
          0x20,
        );
      } else {
        const n = cellNumber(row[j]);
        out.f64(n === null ? SYSMIS : toSpss[j] ? toSpss[j](n) : n);
      }
    });
  return { bytes: out.done(), renames, notes };
}

// ---------- R .RData / .rds ----------

const SXP = {
  NIL: 254,
  SYM: 1,
  LIST: 2,
  CHAR: 9,
  INT: 13,
  REAL: 14,
  STR: 16,
  VEC: 19,
};
const HAS_OBJECT = 1 << 8;
const HAS_ATTR = 1 << 9;
const HAS_TAG = 1 << 10;
const UTF8_LEVEL = 1 << 3;
const ASCII_LEVEL = 1 << 6;
const NA_INTEGER = -2147483648;
// R's NA_real_: a NaN whose low word is 1954.
const NA_REAL = new Uint8Array([0x7f, 0xf0, 0, 0, 0, 0, 0x07, 0xa2]);

/** Writes R's XDR (big-endian) serialization, version 2. */
class RSerializer {
  constructor() {
    this.out = new Bytes(false);
  }

  flags(type, { object = false, attr = false, tag = false, levels = 0 } = {}) {
    this.out.i32(
      type |
        (object ? HAS_OBJECT : 0) |
        (attr ? HAS_ATTR : 0) |
        (tag ? HAS_TAG : 0) |
        (levels << 12),
    );
  }

  charsxp(text) {
    if (text === null) {
      this.flags(SXP.CHAR);
      this.out.i32(-1);
      return;
    }
    const bytes = encoder.encode(text);
    const ascii = bytes.every((b) => b < 0x80);
    this.flags(SXP.CHAR, { levels: ascii ? ASCII_LEVEL : UTF8_LEVEL });
    this.out.i32(bytes.length);
    this.out.bytes(bytes);
  }

  symbol(name) {
    this.flags(SXP.SYM);
    this.charsxp(name);
  }

  /** A pairlist of attributes: [[name, write()], ...]. */
  attributes(pairs) {
    for (const [name, write] of pairs) {
      this.flags(SXP.LIST, { tag: true });
      this.symbol(name);
      write();
    }
    this.out.i32(SXP.NIL);
  }

  strings(values, attrs = []) {
    this.flags(SXP.STR, {
      attr: attrs.length > 0,
      object: attrs.some(([n]) => n === 'class'),
    });
    this.out.i32(values.length);
    for (const v of values) this.charsxp(v);
    if (attrs.length) this.attributes(attrs);
  }

  reals(values, attrs = []) {
    this.flags(SXP.REAL, {
      attr: attrs.length > 0,
      object: attrs.some(([n]) => n === 'class'),
    });
    this.out.i32(values.length);
    for (const v of values) {
      if (v === null) this.out.bytes(NA_REAL);
      else this.out.f64(v);
    }
    if (attrs.length) this.attributes(attrs);
  }

  ints(values) {
    this.flags(SXP.INT);
    this.out.i32(values.length);
    for (const v of values) this.out.i32(v);
  }

  /** A data.frame with a "label" attribute on each labelled column. */
  dataFrame(variables, rows, names) {
    this.flags(SXP.VEC, { object: true, attr: true });
    this.out.i32(variables.length);
    variables.forEach((v, j) => {
      const attrs = v.label
        ? [['label', () => this.strings([String(v.label)])]]
        : [];
      // Coded values keep their meanings as a named vector (haven's "labels").
      const coded = Object.entries(v.valueLabels || {}).filter(([code]) =>
        Number.isFinite(Number(code)),
      );
      if (coded.length && v.kind !== 'string')
        attrs.push([
          'labels',
          () =>
            this.reals(
              coded.map(([code]) => Number(code)),
              [
                [
                  'names',
                  () => this.strings(coded.map(([, text]) => String(text))),
                ],
              ],
            ),
        ]);
      if (v.kind === 'string')
        this.strings(
          rows.map((row) => {
            const t = cellText(row[j]);
            return t === '' ? null : t;
          }),
          attrs,
        );
      else if (v.kind === 'date')
        // Date: days since 1970-01-01.
        this.reals(
          rows.map((row) => cellNumber(row[j])),
          [...attrs, ['class', () => this.strings(['Date'])]],
        );
      else if (v.kind === 'datetime')
        // POSIXct: seconds since 1970-01-01 UTC.
        this.reals(
          rows.map((row) => {
            const n = cellNumber(row[j]);
            return n === null ? null : n / 1000;
          }),
          [
            ...attrs,
            ['class', () => this.strings(['POSIXct', 'POSIXt'])],
            ['tzone', () => this.strings(['UTC'])],
          ],
        );
      else
        this.reals(
          rows.map((row) => cellNumber(row[j])),
          attrs,
        );
    });
    this.attributes([
      ['names', () => this.strings(names)],
      ['class', () => this.strings(['data.frame'])],
      // Compact row names: c(NA_integer_, -n).
      ['row.names', () => this.ints([NA_INTEGER, -rows.length])],
    ]);
  }

  header() {
    this.out.ascii('X\n');
    this.out.i32(2);
    this.out.i32(4 * 65536 + 4 * 256); // written as R 4.4.0
    this.out.i32(2 * 65536 + 3 * 256); // readable by R 2.3.0 and later
  }
}

/**
 * An R data file: `.RData` (load() gives an object named `objectName`) or,
 * with `rds`, an `.rds` file for readRDS(). Uncompressed; gzip it for R's
 * usual compressed files (`gzipBytes`).
 */
export function writeRData(
  { variables, rows },
  { objectName = 'hev_data', rds = false } = {},
) {
  const { names, renames } = programNames(variables, 'r');
  const s = new RSerializer();
  if (rds) {
    s.header();
    s.dataFrame(variables, rows, names);
  } else {
    s.out.ascii('RDX2\n');
    s.header();
    s.flags(SXP.LIST, { tag: true });
    s.symbol(objectName);
    s.dataFrame(variables, rows, names);
    s.out.i32(SXP.NIL);
  }
  return { bytes: s.out.done(), renames, notes: [] };
}

/** gzip bytes with the platform's CompressionStream (browsers, Node 18+). */
export async function gzipBytes(bytes) {
  if (typeof CompressionStream !== 'function') return bytes;
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
