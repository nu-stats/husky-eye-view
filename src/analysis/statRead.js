/**
 * Reading the statistics programs' own files, for Merge & Export's
 * conversions: Stata .dta (formats 113–119: Stata 8 to 19), SPSS .sav
 * (uncompressed or compressed) and .zsav, and R .RData / .rds (R's XDR
 * serialization, versions 2 and 3, gzip-compressed or not).
 *
 * Each reader returns `{columns, rows, title, notes}`: a column is `{name,
 * label, kind: 'numeric' | 'string' | 'date' | 'datetime', valueLabels?}`,
 * a row an array (null for missing). Dates are days since 1970-01-01 and
 * date-times milliseconds since 1970-01-01 UTC, whatever the program's own
 * origin. No DOM and no Node APIs: the browser, the worker and the tests
 * share it.
 */

const DAY_MS = 86_400_000;
// Days from 1960-01-01 (Stata's origin) to 1970-01-01.
const STATA_DAYS = 3653;
const STATA_MS = STATA_DAYS * DAY_MS;
// Seconds from 1582-10-14 (SPSS's origin) to 1970-01-01.
const SPSS_SECONDS = 12_219_379_200;

const decoder = (encoding) => {
  try {
    return new TextDecoder(encoding);
  } catch {
    return new TextDecoder('windows-1252');
  }
};

/** A byte reader with a position. */
class Reader {
  constructor(bytes, little = true) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.little = little;
    this.at = 0;
  }

  need(n) {
    if (this.at + n > this.bytes.length)
      throw new Error('The file ends early: it may be damaged.');
  }

  u8() {
    this.need(1);
    return this.view.getUint8(this.at++);
  }

  i8() {
    this.need(1);
    return this.view.getInt8(this.at++);
  }

  u16() {
    this.need(2);
    const v = this.view.getUint16(this.at, this.little);
    this.at += 2;
    return v;
  }

  i16() {
    this.need(2);
    const v = this.view.getInt16(this.at, this.little);
    this.at += 2;
    return v;
  }

  u32() {
    this.need(4);
    const v = this.view.getUint32(this.at, this.little);
    this.at += 4;
    return v;
  }

  i32() {
    this.need(4);
    const v = this.view.getInt32(this.at, this.little);
    this.at += 4;
    return v;
  }

  u64() {
    this.need(8);
    const v = Number(this.view.getBigUint64(this.at, this.little));
    this.at += 8;
    return v;
  }

  f32() {
    this.need(4);
    const v = this.view.getFloat32(this.at, this.little);
    this.at += 4;
    return v;
  }

  f64() {
    this.need(8);
    const v = this.view.getFloat64(this.at, this.little);
    this.at += 8;
    return v;
  }

  take(n) {
    this.need(n);
    const out = this.bytes.subarray(this.at, this.at + n);
    this.at += n;
    return out;
  }

  /** Unsigned integer of `n` bytes (n ≤ 6), in the file's byte order. */
  uint(n) {
    this.need(n);
    let v = 0;
    for (let k = 0; k < n; k += 1) {
      const b = this.bytes[this.at + (this.little ? k : n - 1 - k)];
      v += b * 2 ** (8 * k);
    }
    this.at += n;
    return v;
  }
}

/** Text up to the first NUL, decoded. */
function cString(bytes, dec) {
  const end = bytes.indexOf(0);
  return dec.decode(end < 0 ? bytes : bytes.subarray(0, end));
}

const latin1 = (bytes) => decoder('latin1').decode(bytes);

/**
 * Text that may be UTF-8 or Windows-1252 (old Stata files are either,
 * depending on the program that wrote them): UTF-8 when it is valid.
 */
function smartDecoder() {
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  const ansi = decoder('windows-1252');
  return {
    decode(bytes) {
      try {
        return utf8.decode(bytes);
      } catch {
        return ansi.decode(bytes);
      }
    },
  };
}

// ---------- Stata .dta ----------

/** Read a Stata .dta file (formats 113–119). */
export function readDta(bytes) {
  if (latin1(bytes.subarray(0, 11)) === '<stata_dta>')
    return readDtaTagged(bytes);
  return readDtaBinary(bytes);
}

/** Stata's missing values: above these, a number is '.', '.a' … '.z'. */
const STATA_MAX = {
  byte: 100,
  int: 32740,
  long: 2147483620,
  float: 1.7014117e38,
  double: 8.988465674311579e307,
};

/** A Stata number's kind from its display format (%td dates, %tc times). */
function stataKind(format) {
  // "%td", "%tdCCYY-NN-DD", old "%d" / "%dM_D_Y"; "%tc" / "%tC" times.
  const f = String(format || '')
    .toLowerCase()
    .replace(/^%-?/, '');
  if (f.startsWith('td') || f === 'd' || /^d[a-z_]/.test(f)) return 'date';
  if (f.startsWith('tc')) return 'datetime';
  return 'numeric';
}

function stataValue(kind, v) {
  if (v === null) return null;
  if (kind === 'date') return v - STATA_DAYS;
  if (kind === 'datetime') return v - STATA_MS;
  return v;
}

/** Value-label tables: `n, txtlen, off[n], val[n], txt` (all formats ≥ 105). */
function readLabelTable(r, dec) {
  const n = r.i32();
  const txtLen = r.i32();
  const off = [];
  for (let k = 0; k < n; k += 1) off.push(r.i32());
  const val = [];
  for (let k = 0; k < n; k += 1) val.push(r.i32());
  const txt = r.take(txtLen);
  const out = {};
  for (let k = 0; k < n; k += 1)
    out[val[k]] = cString(txt.subarray(off[k]), dec);
  return out;
}

/** Formats 117 (Stata 13), 118 (14–19) and 119 (15–19, many variables). */
function readDtaTagged(bytes) {
  const text = latin1(bytes.subarray(0, 200));
  const release = Number(text.slice(28, 31));
  if (![117, 118, 119].includes(release))
    throw new Error(`Stata file format ${release} is not supported.`);
  // "<stata_dta><header><release>118</release><byteorder>LSF": the order at 52.
  const little = text.slice(52, 55) === 'LSF';
  const r = new Reader(bytes, little);
  const dec = release === 117 ? smartDecoder() : decoder('utf-8');
  r.at = text.indexOf('<K>') + 3;
  const K = release === 119 ? r.u32() : r.u16();
  r.at += '</K><N>'.length;
  const N = release === 117 ? r.u32() : r.u64();
  r.at += '</N><label>'.length;
  const labelLength = release === 117 ? r.u8() : r.u16();
  const title = dec.decode(r.take(labelLength));
  r.at += '</label><timestamp>'.length;
  r.take(r.u8());
  r.at += '</timestamp></header><map>'.length;
  const map = [];
  for (let k = 0; k < 14; k += 1) map.push(r.u64());
  const nameWidth = release === 117 ? 33 : 129;
  r.at = map[2] + '<variable_types>'.length;
  const types = [];
  for (let k = 0; k < K; k += 1) types.push(r.u16());
  r.at = map[3] + '<varnames>'.length;
  const names = [];
  for (let k = 0; k < K; k += 1) names.push(cString(r.take(nameWidth), dec));
  r.at = map[5] + '<formats>'.length;
  const formats = [];
  for (let k = 0; k < K; k += 1)
    formats.push(cString(r.take(release === 117 ? 49 : 57), dec));
  r.at = map[6] + '<value_label_names>'.length;
  const labelNames = [];
  for (let k = 0; k < K; k += 1)
    labelNames.push(cString(r.take(nameWidth), dec));
  r.at = map[7] + '<variable_labels>'.length;
  const labels = [];
  for (let k = 0; k < K; k += 1)
    labels.push(cString(r.take(release === 117 ? 81 : 321), dec));
  // strL contents (GSO blocks), by (variable, observation).
  const strls = new Map();
  r.at = map[10] + '<strls>'.length;
  while (latin1(bytes.subarray(r.at, r.at + 3)) === 'GSO') {
    r.at += 3;
    const v = r.u32();
    const o = release === 117 ? r.u32() : r.u64();
    const t = r.u8();
    const len = r.u32();
    let data = r.take(len);
    if (t === 130 && data[data.length - 1] === 0)
      data = data.subarray(0, data.length - 1);
    strls.set(`${v},${o}`, dec.decode(data));
  }
  // Value labels.
  const tables = {};
  r.at = map[11] + '<value_labels>'.length;
  while (latin1(bytes.subarray(r.at, r.at + 5)) === '<lbl>') {
    r.at += 5;
    r.i32();
    const name = cString(r.take(nameWidth), dec);
    r.take(3);
    tables[name] = readLabelTable(r, dec);
    r.at += '</lbl>'.length;
  }
  const columns = names.map((name, j) => {
    const t = types[j];
    const string = t <= 2045 || t === 32768;
    const kind = string ? 'string' : stataKind(formats[j]);
    const column = { name, label: labels[j], kind };
    if (!string && labelNames[j] && tables[labelNames[j]])
      column.valueLabels = tables[labelNames[j]];
    return column;
  });
  r.at = map[9] + '<data>'.length;
  const rows = new Array(N);
  const refBytes = release === 117 ? [4, 4] : release === 118 ? [2, 6] : [3, 5];
  for (let i = 0; i < N; i += 1) {
    const row = new Array(K);
    for (let j = 0; j < K; j += 1) {
      const t = types[j];
      let v;
      if (t <= 2045) {
        const s = cString(r.take(t), dec);
        v = s === '' ? null : s;
      } else if (t === 32768) {
        const vv = r.uint(refBytes[0]);
        const oo = r.uint(refBytes[1]);
        const s = vv === 0 && oo === 0 ? '' : (strls.get(`${vv},${oo}`) ?? '');
        v = s === '' ? null : s;
      } else if (t === 65526) {
        const x = r.f64();
        v = x > STATA_MAX.double ? null : x;
      } else if (t === 65527) {
        const x = r.f32();
        v = x > STATA_MAX.float ? null : Math.fround(x);
      } else if (t === 65528) {
        const x = r.i32();
        v = x > STATA_MAX.long ? null : x;
      } else if (t === 65529) {
        const x = r.i16();
        v = x > STATA_MAX.int ? null : x;
      } else if (t === 65530) {
        const x = r.i8();
        v = x > STATA_MAX.byte ? null : x;
      } else throw new Error(`Unknown Stata storage type ${t}.`);
      row[j] =
        columns[j].kind === 'string' ? v : stataValue(columns[j].kind, v);
    }
    rows[i] = row;
  }
  return { columns, rows, title, notes: [] };
}

/** Formats 113–115 (Stata 8–12). */
function readDtaBinary(bytes) {
  const release = bytes[0];
  if (![113, 114, 115].includes(release))
    throw new Error(
      release > 105 && release < 113
        ? `This .dta file is from Stata 7 or older (format ${release}): open it in Stata and save it again.`
        : 'This is not a Stata .dta file.',
    );
  const little = bytes[1] === 2;
  const r = new Reader(bytes, little);
  const dec = smartDecoder();
  r.at = 4;
  const K = r.i16();
  const N = r.i32();
  const title = cString(r.take(81), dec);
  r.take(18);
  const types = [];
  for (let k = 0; k < K; k += 1) types.push(r.u8());
  const names = [];
  for (let k = 0; k < K; k += 1) names.push(cString(r.take(33), dec));
  r.take(2 * (K + 1));
  const formats = [];
  for (let k = 0; k < K; k += 1)
    formats.push(cString(r.take(release === 113 ? 12 : 49), dec));
  const labelNames = [];
  for (let k = 0; k < K; k += 1) labelNames.push(cString(r.take(33), dec));
  const labels = [];
  for (let k = 0; k < K; k += 1) labels.push(cString(r.take(81), dec));
  // Expansion fields (characteristics): skipped.
  for (;;) {
    const type = r.u8();
    const len = r.i32();
    if (type === 0 && len === 0) break;
    r.take(len);
  }
  const columns = names.map((name, j) => {
    const string = types[j] <= 244;
    const kind = string ? 'string' : stataKind(formats[j]);
    return { name, label: labels[j], kind, labelName: labelNames[j] };
  });
  const rows = new Array(N);
  for (let i = 0; i < N; i += 1) {
    const row = new Array(K);
    for (let j = 0; j < K; j += 1) {
      const t = types[j];
      let v;
      if (t <= 244) {
        const s = cString(r.take(t), dec);
        v = s === '' ? null : s;
      } else if (t === 255) {
        const x = r.f64();
        v = x > STATA_MAX.double ? null : x;
      } else if (t === 254) {
        const x = r.f32();
        v = x > STATA_MAX.float ? null : x;
      } else if (t === 253) {
        const x = r.i32();
        v = x > STATA_MAX.long ? null : x;
      } else if (t === 252) {
        const x = r.i16();
        v = x > STATA_MAX.int ? null : x;
      } else {
        const x = r.i8();
        v = x > STATA_MAX.byte ? null : x;
      }
      row[j] =
        columns[j].kind === 'string' ? v : stataValue(columns[j].kind, v);
    }
    rows[i] = row;
  }
  const tables = {};
  while (r.at + 4 <= bytes.length) {
    const len = r.i32();
    if (len <= 0 || r.at + 36 + len > bytes.length) break;
    const name = cString(r.take(33), dec);
    r.take(3);
    tables[name] = readLabelTable(r, dec);
  }
  for (const c of columns) {
    if (c.kind !== 'string' && c.labelName && tables[c.labelName])
      c.valueLabels = tables[c.labelName];
    delete c.labelName;
  }
  return { columns, rows, title, notes: [] };
}

// ---------- SPSS .sav / .zsav ----------

const SPSS_DATE_FORMATS = new Set([20, 23, 24, 28, 29, 30, 38, 39]);
const SPSS_DATETIME_FORMATS = new Set([22, 41]);
const CODE_PAGES = {
  65001: 'utf-8',
  1252: 'windows-1252',
  28591: 'iso-8859-1',
  1250: 'windows-1250',
  1251: 'windows-1251',
  932: 'shift_jis',
  936: 'gbk',
  949: 'euc-kr',
  950: 'big5',
};

/** Inflate zlib data with the platform's DecompressionStream. */
async function inflate(bytes, format = 'deflate') {
  if (typeof DecompressionStream !== 'function')
    throw new Error('This browser cannot open compressed files.');
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Read an SPSS system file (.sav, compressed or not, or .zsav). */
export async function readSav(bytes) {
  const magic = latin1(bytes.subarray(0, 4));
  if (magic !== '$FL2' && magic !== '$FL3')
    throw new Error('This is not an SPSS .sav file.');
  let r = new Reader(bytes, true);
  r.at = 64;
  const layout = r.i32();
  if (layout !== 2 && layout !== 3) {
    r = new Reader(bytes, false);
    r.at = 64;
    r.i32();
  }
  r.i32(); // nominal case size
  const compression = r.i32();
  r.i32(); // weight index
  let ncases = r.i32();
  const bias = r.f64();
  r.take(17);
  const rawTitle = r.take(64);
  r.take(3);
  const vars = []; // one per dictionary slot (variables and continuations)
  const valueLabelSets = [];
  const extensions = {};
  let charCode = null;
  let sysmis = -Number.MAX_VALUE;
  for (;;) {
    const type = r.i32();
    if (type === 2) {
      const width = r.i32();
      const hasLabel = r.i32();
      const nMissing = r.i32();
      const print = r.i32();
      r.i32();
      const shortName = r.take(8);
      let label = null;
      if (hasLabel) {
        const len = r.i32();
        label = r.take(Math.ceil(len / 4) * 4).subarray(0, len);
      }
      const missing = [];
      for (let k = 0; k < Math.abs(nMissing); k += 1) missing.push(r.take(8));
      vars.push({ width, print, shortName, label, nMissing, missing });
    } else if (type === 3) {
      const count = r.i32();
      const entries = [];
      for (let k = 0; k < count; k += 1) {
        const raw = r.take(8);
        const len = r.u8();
        const text = r.take(Math.ceil((len + 1) / 8) * 8 - 1).subarray(0, len);
        entries.push({ raw, text });
      }
      if (r.i32() !== 4)
        throw new Error('The SPSS file’s value labels are damaged.');
      const n = r.i32();
      const indexes = [];
      for (let k = 0; k < n; k += 1) indexes.push(r.i32());
      valueLabelSets.push({ entries, indexes });
    } else if (type === 6) {
      r.take(r.i32() * 80);
    } else if (type === 7) {
      const subtype = r.i32();
      const size = r.i32();
      const count = r.i32();
      const data = r.take(size * count);
      extensions[subtype] = data;
      if (subtype === 3 && count >= 8)
        charCode = new DataView(data.buffer, data.byteOffset).getInt32(
          28,
          r.little,
        );
      if (subtype === 4 && count >= 1)
        sysmis = new DataView(data.buffer, data.byteOffset).getFloat64(
          0,
          r.little,
        );
    } else if (type === 999) {
      r.i32();
      break;
    } else throw new Error(`The SPSS file has an unknown record (${type}).`);
  }
  const encodingName = extensions[20]
    ? latin1(extensions[20]).trim()
    : CODE_PAGES[charCode] || 'windows-1252';
  const dec = decoder(encodingName.toLowerCase());
  const longNames = new Map();
  if (extensions[13])
    for (const pair of dec.decode(extensions[13]).split('\t')) {
      const at = pair.indexOf('=');
      if (at > 0)
        longNames.set(
          pair.slice(0, at).trim().toUpperCase(),
          pair.slice(at + 1).trim(),
        );
    }
  const veryLong = new Map();
  if (extensions[14])
    for (const pair of dec.decode(extensions[14]).split(/\0\t?|\t/)) {
      const at = pair.indexOf('=');
      if (at > 0)
        veryLong.set(
          pair.slice(0, at).trim().toUpperCase(),
          Number(pair.slice(at + 1)),
        );
    }
  // Variables: each with its first slot and slot count; very long strings
  // span several variables of 255 bytes (252 bytes of text each but the last).
  const variables = [];
  const bySlot = new Map();
  for (let slot = 0; slot < vars.length; slot += 1) {
    const v = vars[slot];
    if (v.width === -1) continue;
    const short = latin1(v.shortName).trim().toUpperCase();
    bySlot.set(slot + 1, variables.length);
    variables.push({ slot, short, ...v, segments: [{ slot, width: v.width }] });
  }
  const merged = [];
  for (let k = 0; k < variables.length; k += 1) {
    const v = variables[k];
    const total = veryLong.get(v.short);
    if (total && total > 255) {
      const count = Math.floor((total + 251) / 252);
      for (let s = 1; s < count && k + 1 < variables.length; s += 1) {
        k += 1;
        v.segments.push({ slot: variables[k].slot, width: variables[k].width });
      }
      v.totalWidth = total;
    }
    merged.push(v);
  }
  // Slots per dictionary entry: numbers 1, strings ceil(width/8).
  const slotsOf = (width) => (width === 0 ? 1 : Math.ceil(width / 8));
  const columns = merged.map((v) => {
    const fmtType = (v.print >> 16) & 0xff;
    const string = v.width > 0;
    const kind = string
      ? 'string'
      : SPSS_DATE_FORMATS.has(fmtType)
        ? 'date'
        : SPSS_DATETIME_FORMATS.has(fmtType)
          ? 'datetime'
          : 'numeric';
    return {
      name: longNames.get(v.short) || v.short,
      label: v.label ? dec.decode(v.label) : '',
      kind,
    };
  });
  // Value labels for numeric variables.
  for (const set of valueLabelSets)
    for (const index of set.indexes) {
      const k = merged.findIndex((v) => v.slot + 1 === index);
      if (k < 0 || columns[k].kind === 'string') continue;
      const labels = (columns[k].valueLabels ||= {});
      for (const { raw, text } of set.entries) {
        const value = new DataView(raw.buffer, raw.byteOffset).getFloat64(
          0,
          r.little,
        );
        labels[value] = dec.decode(text);
      }
    }
  // User-missing values read as missing, as haven and SPSS's own analyses do.
  const missingTest = merged.map((v) => {
    if (!v.nMissing || v.width > 0) return null;
    const nums = v.missing.map((m) =>
      new DataView(m.buffer, m.byteOffset).getFloat64(0, r.little),
    );
    if (v.nMissing > 0) return (x) => nums.includes(x);
    const [lo, hi, extra] = nums;
    return (x) => (x >= lo && x <= hi) || (v.nMissing === -3 && x === extra);
  });
  // The data stream: raw, bytecode-compressed, or zlib blocks of bytecode.
  let data = bytes.subarray(r.at);
  if (compression === 2) {
    const zr = new Reader(bytes, r.little);
    zr.at = r.at;
    zr.u64();
    const trailerAt = zr.u64();
    zr.at = trailerAt;
    zr.u64();
    zr.u64();
    zr.i32();
    const blocks = zr.i32();
    const parts = [];
    for (let k = 0; k < blocks; k += 1) {
      zr.u64();
      const compressedAt = zr.u64();
      zr.i32();
      const compressedSize = zr.i32();
      parts.push(
        await inflate(
          bytes.subarray(compressedAt, compressedAt + compressedSize),
        ),
      );
    }
    const size = parts.reduce((s, p) => s + p.length, 0);
    data = new Uint8Array(size);
    let at = 0;
    for (const p of parts) {
      data.set(p, at);
      at += p.length;
    }
  }
  const slots = vars.length;
  const SPACES = new Uint8Array(8).fill(0x20);
  let pos = 0;
  // One 8-byte unit at a time: a number, 8 bytes of text, or null (SYSMIS).
  let codes = null;
  let codeAt = 8;
  let ended = false;
  const nextUnit = () => {
    if (compression === 0) {
      if (pos + 8 > data.length) {
        ended = true;
        return undefined;
      }
      const u = data.subarray(pos, pos + 8);
      pos += 8;
      return u;
    }
    for (;;) {
      if (codeAt >= 8) {
        if (pos + 8 > data.length) {
          ended = true;
          return undefined;
        }
        codes = data.subarray(pos, pos + 8);
        pos += 8;
        codeAt = 0;
      }
      const c = codes[codeAt++];
      if (c === 0) continue;
      if (c === 252) {
        ended = true;
        return undefined;
      }
      if (c === 253) {
        const u = data.subarray(pos, pos + 8);
        pos += 8;
        return u;
      }
      if (c === 254) return SPACES;
      if (c === 255) return null;
      return c - bias;
    }
  };
  const unitNumber = (u) => {
    if (u === null) return null;
    if (typeof u === 'number') return u;
    const x = new DataView(u.buffer, u.byteOffset).getFloat64(0, r.little);
    return x === sysmis || !Number.isFinite(x) ? null : x;
  };
  const rows = [];
  if (ncases < 0) ncases = Infinity;
  for (let i = 0; i < ncases && !ended; i += 1) {
    // One case: a unit per dictionary slot; a short read is the end.
    const units = new Array(slots);
    let complete = true;
    for (let s = 0; s < slots; s += 1) {
      const u = nextUnit();
      if (u === undefined) {
        complete = false;
        break;
      }
      units[s] = u;
    }
    if (!complete) break;
    const row = merged.map((v, k) => {
      if (v.width === 0) {
        const x = unitNumber(units[v.slot]);
        if (x === null || missingTest[k]?.(x)) return null;
        if (columns[k].kind === 'date') return (x - SPSS_SECONDS) / 86400;
        if (columns[k].kind === 'datetime') return (x - SPSS_SECONDS) * 1000;
        return x;
      }
      // Text: the variable's slots (and its segments' slots), in order.
      const parts = [];
      v.segments.forEach((seg, n) => {
        const pieces = [];
        for (let s = 0; s < slotsOf(seg.width); s += 1) {
          const u = units[seg.slot + s];
          pieces.push(u && typeof u !== 'number' ? u : SPACES);
        }
        const joined = new Uint8Array(pieces.length * 8);
        pieces.forEach((p, q) => joined.set(p, q * 8));
        parts.push(joined.subarray(0, seg.width));
      });
      const size = parts.reduce((t, p) => t + p.length, 0);
      const all = new Uint8Array(size);
      let at = 0;
      for (const p of parts) {
        all.set(p, at);
        at += p.length;
      }
      const s = dec.decode(all).replace(/[\s\0]+$/, '');
      return s === '' ? null : s;
    });
    rows.push(row);
  }
  return { columns, rows, title: dec.decode(rawTitle).trim(), notes: [] };
}

// ---------- R .RData / .rds ----------

const R = {
  NIL: 0,
  SYM: 1,
  LIST: 2,
  CLO: 3,
  ENV: 4,
  PROM: 5,
  LANG: 6,
  SPECIAL: 7,
  BUILTIN: 8,
  CHAR: 9,
  LGL: 10,
  INT: 13,
  REAL: 14,
  CPLX: 15,
  STR: 16,
  DOT: 17,
  VEC: 19,
  EXPR: 20,
  BCODE: 21,
  EXTPTR: 22,
  WEAKREF: 23,
  RAW: 24,
  S4: 25,
  ALTREP: 238,
  ATTRLANG: 239,
  ATTRLIST: 240,
  BASEENV: 241,
  EMPTYENV: 242,
  BCREPREF: 243,
  BCREPDEF: 244,
  GENERICREF: 245,
  CLASSREF: 246,
  PERSIST: 247,
  PACKAGE: 248,
  NAMESPACE: 249,
  BASENS: 250,
  MISSINGARG: 251,
  UNBOUND: 252,
  GLOBALENV: 253,
  NILVALUE: 254,
  REF: 255,
};
const R_NA_INT = -2147483648;

/** R's XDR serialization: a tree of {type, value, attrs}. */
function parseR(bytes) {
  const r = new Reader(bytes, false);
  const header = latin1(bytes.subarray(0, 2));
  if (header === 'A\n')
    throw new Error(
      'This R file is in ASCII form: save it with save() or saveRDS() as usual (binary).',
    );
  if (header === 'B\n')
    throw new Error(
      'This R file uses native binary form: save it again with save() or saveRDS().',
    );
  if (header !== 'X\n') throw new Error('This is not an R data file.');
  r.at = 2;
  const version = r.i32();
  r.i32();
  r.i32();
  if (version === 3) r.take(r.i32());
  else if (version !== 2)
    throw new Error(`R serialization version ${version} is not supported.`);
  const refs = [];
  const dec = decoder('utf-8');
  const latin = decoder('latin1');
  const item = () => {
    const flags = r.i32();
    const type = flags & 0xff;
    const levels = flags >>> 12;
    const isObj = Boolean(flags & (1 << 8));
    const hasAttr = Boolean(flags & (1 << 9));
    const hasTag = Boolean(flags & (1 << 10));
    switch (type) {
      case R.NILVALUE:
      case R.EMPTYENV:
      case R.BASEENV:
      case R.GLOBALENV:
      case R.UNBOUND:
      case R.MISSINGARG:
      case R.BASENS:
        return { type };
      case R.REF: {
        const index = flags >> 8 || r.i32();
        return refs[index - 1];
      }
      case R.PERSIST: {
        const node = { type, value: item() };
        refs.push(node);
        return node;
      }
      case R.SYM: {
        const node = { type: R.SYM, name: null };
        refs.push(node);
        node.name = item().value;
        return node;
      }
      case R.PACKAGE:
      case R.NAMESPACE: {
        const node = { type, value: item() };
        refs.push(node);
        return node;
      }
      case R.ENV: {
        const node = { type: R.ENV };
        refs.push(node);
        r.i32();
        node.enclos = item();
        node.frame = item();
        node.hashtab = item();
        node.attrs = item();
        return node;
      }
      case R.LIST:
      case R.LANG:
      case R.CLO:
      case R.PROM:
      case R.DOT:
      case R.ATTRLANG:
      case R.ATTRLIST: {
        const attrs = hasAttr ? item() : null;
        const tag = hasTag ? item() : null;
        const car = item();
        const cdr = item();
        const pairs = [[tag?.name ?? null, car], ...(cdr?.pairs || [])];
        return { type, pairs, attrs: pairList(attrs) };
      }
      case R.CHAR: {
        const n = r.i32();
        if (n === -1) return { type, value: null };
        const raw = r.take(n);
        const utf8 = levels & (1 << 3);
        const isLatin = levels & (1 << 2);
        return { type, value: (isLatin && !utf8 ? latin : dec).decode(raw) };
      }
      case R.ALTREP: {
        const info = item();
        const state = item();
        const attr = item();
        const cls = info.pairs?.[0]?.[1]?.name;
        return { ...altrep(cls, state), attrs: pairList(attr), isObj };
      }
      case R.S4:
        return { type, attrs: hasAttr ? pairList(item()) : {} };
      case R.BCODE:
        throw new Error(
          'The R file contains compiled functions; save only the data (e.g. save(mydata, file = …)).',
        );
      case R.EXTPTR:
      case R.WEAKREF: {
        const node = { type };
        refs.push(node);
        if (type === R.EXTPTR) {
          item();
          item();
        } else {
          r.i32();
        }
        node.attrs = hasAttr ? pairList(item()) : {};
        return node;
      }
      default:
        break;
    }
    // Vectors.
    const n = r.i32();
    let value;
    if (type === R.LGL || type === R.INT) {
      value = new Array(n);
      for (let k = 0; k < n; k += 1) {
        const v = r.i32();
        value[k] = v === R_NA_INT ? null : v;
      }
    } else if (type === R.REAL) {
      value = new Array(n);
      // NA_real_ (and NaN) read as missing.
      for (let k = 0; k < n; k += 1) {
        const v = r.f64();
        value[k] = Number.isNaN(v) ? null : v;
      }
    } else if (type === R.CPLX) {
      value = new Array(n);
      for (let k = 0; k < n; k += 1) value[k] = `${r.f64()}+${r.f64()}i`;
    } else if (type === R.STR) {
      value = new Array(n);
      for (let k = 0; k < n; k += 1) value[k] = item().value;
    } else if (type === R.VEC || type === R.EXPR) {
      value = new Array(n);
      for (let k = 0; k < n; k += 1) value[k] = item();
    } else if (type === R.RAW) {
      value = r.take(n);
    } else
      throw new Error(
        `The R file holds an object of type ${type} that cannot be read.`,
      );
    return { type, value, isObj, attrs: hasAttr ? pairList(item()) : {} };
  };
  // ALTREP objects R writes for compact vectors.
  const altrep = (cls, state) => {
    if (cls === 'compact_intseq' || cls === 'compact_realseq') {
      const [n, start, step] = state.value;
      return {
        type: cls === 'compact_intseq' ? R.INT : R.REAL,
        value: Array.from({ length: n }, (_, k) => start + k * step),
      };
    }
    if (String(cls).startsWith('wrap_')) return state.value[0];
    if (cls === 'deferred_string') {
      const source = state.pairs?.[0]?.[1] || state;
      return {
        type: R.STR,
        value: (source.value || []).map((v) => (v === null ? null : String(v))),
      };
    }
    throw new Error(
      `The R file uses a compact form (${cls}) that cannot be read; save it with R 3.5 or later's defaults.`,
    );
  };
  const pairList = (node) => {
    const out = {};
    for (const [name, value] of node?.pairs || []) if (name) out[name] = value;
    return out;
  };
  return item();
}

const classes = (node) => node?.attrs?.class?.value || [];

/** An R data frame (or a list of equal-length vectors) as a table. */
function frameTable(node, title) {
  const names =
    node.attrs.names?.value || node.value.map((_, k) => `V${k + 1}`);
  const columns = [];
  const columnValues = [];
  node.value.forEach((col, j) => {
    const cls = classes(col);
    const label = col?.attrs?.label?.value?.[0] || '';
    const column = { name: names[j] || `V${j + 1}`, label, kind: 'numeric' };
    let values = col?.value || [];
    if (cls.includes('factor')) {
      const levels = col.attrs.levels?.value || [];
      column.valueLabels = Object.fromEntries(levels.map((l, k) => [k + 1, l]));
    } else if (cls.includes('Date')) column.kind = 'date';
    else if (cls.includes('POSIXct')) {
      column.kind = 'datetime';
      values = values.map((v) => (v === null ? null : v * 1000));
    } else if (col?.type === R.STR) column.kind = 'string';
    else if (col?.type === R.LGL)
      column.valueLabels = { 0: 'FALSE', 1: 'TRUE' };
    else if (col?.type !== R.INT && col?.type !== R.REAL) {
      column.kind = 'string';
      values = values.map((v) =>
        v === null || v === undefined ? null : String(v?.value ?? v),
      );
    }
    // haven's labelled vectors: a named "labels" attribute.
    const labels = col?.attrs?.labels;
    if (
      labels?.value &&
      labels.attrs?.names?.value &&
      column.kind === 'numeric'
    )
      column.valueLabels = Object.fromEntries(
        labels.value.map((v, k) => [v, labels.attrs.names.value[k]]),
      );
    columns.push(column);
    columnValues.push(values);
  });
  const n = Math.max(0, ...columnValues.map((v) => v.length));
  const rows = Array.from({ length: n }, (_, i) =>
    columnValues.map((v) => (v[i] === undefined ? null : v[i])),
  );
  return { columns, rows, title, notes: [] };
}

const isFrame = (node) =>
  node?.type === R.VEC &&
  (classes(node).includes('data.frame') ||
    (node.value.length > 0 &&
      node.value.every((c) =>
        [R.INT, R.REAL, R.STR, R.LGL].includes(c?.type),
      ) &&
      new Set(node.value.map((c) => c.value.length)).size === 1 &&
      node.attrs?.names));

/**
 * Read an R .RData (the largest data frame in it) or .rds file. gzip is
 * handled here; bzip2 and xz are not.
 */
export async function readRData(bytes) {
  let data = bytes;
  if (data[0] === 0x1f && data[1] === 0x8b) data = await inflate(data, 'gzip');
  else if (
    latin1(data.subarray(0, 3)) === 'BZh' ||
    (data[0] === 0xfd && latin1(data.subarray(1, 6)) === '7zXZ\0')
  )
    throw new Error(
      'This R file is compressed with bzip2 or xz. In R, save it again with save(…, compress = TRUE) or saveRDS(…) (gzip), then upload it.',
    );
  const head = latin1(data.subarray(0, 5));
  const notes = [];
  if (head === 'RDX2\n' || head === 'RDX3\n') {
    const root = parseR(data.subarray(5));
    const objects = (root.pairs || []).filter(([, v]) => isFrame(v));
    if (!objects.length)
      throw new Error('The .RData file has no data frame in it.');
    objects.sort(
      (a, b) =>
        b[1].value[0].value.length * b[1].value.length -
        a[1].value[0].value.length * a[1].value.length,
    );
    if (objects.length > 1)
      notes.push(
        `The .RData file holds ${objects.length} data frames (${objects.map(([n]) => n).join(', ')}); this is ${objects[0][0]}, the largest.`,
      );
    const table = frameTable(objects[0][1], objects[0][0]);
    return { ...table, notes };
  }
  const root = parseR(data);
  if (!isFrame(root))
    throw new Error('The .rds file does not hold a data frame.');
  return frameTable(root, '');
}
