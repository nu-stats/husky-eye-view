// A Zstandard decoder (.zst files), written from the public format standard (RFC 8878): frames of blocks, each
// block a section of literals (raw, repeated, or Huffman-coded) and a section of sequences (literal length, match
// length, offset; FSE-coded) that copy from what was already written. The frame checksum (XXH64) is verified when
// the file has one, so a damaged file is refused rather than read wrong. Dictionaries are not supported (ordinary
// .zst files do not use them). No dependencies; runs in the browser and in Node.

const fail = (why) => {
  throw new Error(`The .zst file is damaged (${why}).`);
};

class Output {
  constructor(limit) {
    this.limit = limit;
    this.buf = new Uint8Array(1 << 20);
    this.length = 0;
  }
  reserve(n) {
    if (this.length + n > this.limit)
      throw new Error(
        `The unpacked file would be larger than ${Math.round(this.limit / 1e6)} MB, more than a browser page can hold.`,
      );
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(
      Math.min(size, Math.max(this.limit, this.length + n)),
    );
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
  }
}

const highBit = (v) => 31 - Math.clz32(v);

// Bits of bytes[start..end) as one little-endian number; `bits(pos, n)` gives the n bits starting at bit `pos`
// (bits before the start read as zero, as the standard allows when a Huffman stream is nearly done).
function bitsFrom(bytes, start, end) {
  const byte = (i) => (i >= start && i < end ? bytes[i] : 0);
  const small = (pos, n) => {
    if (pos < 0) return n + pos <= 0 ? 0 : small(0, n + pos) << -pos;
    const at = start + (pos >> 3);
    const word =
      (byte(at) |
        (byte(at + 1) << 8) |
        (byte(at + 2) << 16) |
        (byte(at + 3) << 24)) >>>
      0;
    return (word >>> (pos & 7)) & ((1 << n) - 1);
  };
  return (pos, n) =>
    n === 0
      ? 0
      : n <= 24
        ? small(pos, n)
        : small(pos + 16, n - 16) * 65536 + small(pos, 16);
}

// A stream read from its end backward, as FSE and Huffman streams are.
class Backward {
  constructor(bytes, start, end) {
    if (end <= start) fail('empty bit stream');
    const last = bytes[end - 1];
    if (!last) fail('bit stream has no end marker');
    this.pos = (end - start - 1) * 8 + highBit(last);
    this.get = bitsFrom(bytes, start, end);
  }
  read(n) {
    this.pos -= n;
    return this.get(this.pos, n);
  }
  peek(n) {
    return this.get(this.pos - n, n);
  }
}

// FSE: a decoding table from normalized counts (RFC 8878 section 4.1.1).
function fseTable(counts, log) {
  const size = 1 << log;
  const symbol = new Uint8Array(size);
  const bits = new Uint8Array(size);
  const base = new Uint16Array(size);
  const next = new Uint16Array(counts.length);
  let high = size - 1;
  for (let s = 0; s < counts.length; s++) {
    if (counts[s] === -1) {
      symbol[high--] = s;
      next[s] = 1;
    } else next[s] = counts[s];
  }
  const step = (size >> 1) + (size >> 3) + 3;
  let pos = 0;
  for (let s = 0; s < counts.length; s++) {
    for (let i = 0; i < counts[s]; i++) {
      symbol[pos] = s;
      do pos = (pos + step) & (size - 1);
      while (pos > high);
    }
  }
  if (pos !== 0) fail('bad FSE table');
  for (let i = 0; i < size; i++) {
    const n = next[symbol[i]]++;
    bits[i] = log - highBit(n);
    base[i] = (n << bits[i]) - size;
  }
  return { log, symbol, bits, base };
}

function rleTable(s) {
  return {
    log: 0,
    symbol: Uint8Array.of(s),
    bits: Uint8Array.of(0),
    base: Uint16Array.of(0),
  };
}

// Reads normalized counts from bytes[at..]; returns { table, at } (RFC 8878 section 4.1.1).
function readFse(bytes, at, end, maxSymbol, maxLog) {
  const get = bitsFrom(bytes, at, end);
  let pos = 0;
  const log = get(0, 4) + 5;
  pos = 4;
  if (log > maxLog) fail('FSE table too large');
  let remaining = (1 << log) + 1;
  let threshold = 1 << log;
  let nbBits = log + 1;
  const counts = [];
  while (remaining > 1) {
    if (counts.length > maxSymbol) fail('bad FSE table');
    const max = 2 * threshold - 1 - remaining;
    let value = get(pos, nbBits - 1);
    if (value < max) pos += nbBits - 1;
    else {
      value = get(pos, nbBits);
      if (value >= threshold) value -= max;
      pos += nbBits;
    }
    const count = value - 1;
    remaining -= count < 0 ? -count : count;
    counts.push(count);
    if (count === 0) {
      for (;;) {
        const r = get(pos, 2);
        pos += 2;
        for (let k = 0; k < r; k++) counts.push(0);
        if (r !== 3) break;
      }
    }
    while (remaining < threshold) {
      nbBits--;
      threshold >>= 1;
    }
  }
  if (remaining !== 1 || counts.length > maxSymbol + 1) fail('bad FSE table');
  const next = at + Math.ceil(pos / 8);
  if (next > end) fail('it ends too soon');
  return { table: fseTable(counts, log), at: next };
}

// Huffman: weights to a lookup table indexed by the next maxBits bits.
function huffmanTable(weights) {
  let total = 0;
  for (const w of weights) if (w) total += 1 << (w - 1);
  if (!total) fail('bad Huffman table');
  const maxBits = highBit(total) + 1;
  const left = (1 << maxBits) - total;
  if (left & (left - 1)) fail('bad Huffman table');
  weights.push(highBit(left) + 1);
  if (maxBits > 11) fail('Huffman codes too long');
  const size = 1 << maxBits;
  const symbol = new Uint8Array(size);
  const length = new Uint8Array(size);
  let pos = 0;
  for (let w = 1; w <= maxBits; w++) {
    for (let s = 0; s < weights.length; s++) {
      if (weights[s] !== w) continue;
      const span = 1 << (w - 1);
      symbol.fill(s, pos, pos + span);
      length.fill(maxBits + 1 - w, pos, pos + span);
      pos += span;
    }
  }
  if (pos !== size) fail('bad Huffman table');
  return { maxBits, symbol, length };
}

function readHuffman(bytes, at, end) {
  const head = bytes[at++];
  const weights = [];
  if (head >= 128) {
    const n = head - 127;
    if (at + Math.ceil(n / 2) > end) fail('it ends too soon');
    for (let i = 0; i < n; i++)
      weights.push(
        i & 1 ? bytes[at + (i >> 1)] & 15 : bytes[at + (i >> 1)] >> 4,
      );
    at += Math.ceil(n / 2);
  } else {
    const stop = at + head;
    if (stop > end) fail('it ends too soon');
    const { table, at: data } = readFse(bytes, at, stop, 255, 6);
    const r = new Backward(bytes, data, stop);
    let s1 = r.read(table.log);
    let s2 = r.read(table.log);
    for (;;) {
      if (weights.length > 255) fail('bad Huffman weights');
      weights.push(table.symbol[s1]);
      s1 = table.base[s1] + r.read(table.bits[s1]);
      if (r.pos < 0) {
        weights.push(table.symbol[s2]);
        break;
      }
      weights.push(table.symbol[s2]);
      s2 = table.base[s2] + r.read(table.bits[s2]);
      if (r.pos < 0) {
        weights.push(table.symbol[s1]);
        break;
      }
    }
    at = stop;
  }
  if (weights.length > 255) fail('bad Huffman weights');
  return { huffman: huffmanTable(weights), at };
}

function decodeHuffmanStream(bytes, start, end, h, out, outAt, count) {
  const r = new Backward(bytes, start, end);
  for (let i = 0; i < count; i++) {
    const idx = r.peek(h.maxBits);
    out[outAt + i] = h.symbol[idx];
    r.pos -= h.length[idx];
  }
  if (r.pos !== 0) fail('Huffman stream size does not match');
}

const LL_BASE = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28,
  32, 40, 48, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536,
];
const LL_BITS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 6,
  7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
];
const ML_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
  24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 37, 39, 41, 43, 47, 51, 59,
  67, 83, 99, 131, 259, 515, 1027, 2051, 4099, 8195, 16387, 32771, 65539,
];
const ML_BITS = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 7, 8, 9, 10, 11, 12, 13,
  14, 15, 16,
];
const LL_DEFAULT = fseTable(
  [
    4, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2,
    3, 2, 1, 1, 1, 1, 1, -1, -1, -1, -1,
  ],
  6,
);
const ML_DEFAULT = fseTable(
  [
    1, 4, 3, 2, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1, -1, -1,
    -1, -1, -1, -1,
  ],
  6,
);
const OF_DEFAULT = fseTable(
  [
    1, 1, 1, 1, 1, 1, 2, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, -1,
    -1, -1, -1, -1,
  ],
  5,
);

function pickTable(
  mode,
  bytes,
  at,
  end,
  previous,
  fallback,
  maxSymbol,
  maxLog,
) {
  if (mode === 0) return { table: fallback, at };
  if (mode === 1) {
    if (bytes[at] > maxSymbol) fail('bad symbol');
    return { table: rleTable(bytes[at]), at: at + 1 };
  }
  if (mode === 2) return readFse(bytes, at, end, maxSymbol, maxLog);
  if (!previous) fail('repeated table with none before');
  return { table: previous, at };
}

function block(bytes, at, end, out, frame) {
  // Literals.
  const b0 = bytes[at];
  const type = b0 & 3;
  const format = (b0 >> 2) & 3;
  let literals;
  if (type < 2) {
    let size;
    if (!(format & 1)) ((size = b0 >> 3), (at += 1));
    else if (format === 1)
      ((size = (b0 >> 4) + (bytes[at + 1] << 4)), (at += 2));
    else
      ((size = (b0 >> 4) + (bytes[at + 1] << 4) + (bytes[at + 2] << 12)),
        (at += 3));
    if (type === 0) {
      if (at + size > end) fail('it ends too soon');
      literals = bytes.subarray(at, at + size);
      at += size;
    } else {
      literals = new Uint8Array(size).fill(bytes[at]);
      at += 1;
    }
  } else {
    let regen;
    let packed;
    let streams = format === 0 ? 1 : 4;
    if (format < 2) {
      const v = b0 | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
      regen = (v >> 4) & 0x3ff;
      packed = (v >> 14) & 0x3ff;
      at += 3;
    } else if (format === 2) {
      const v =
        (b0 |
          (bytes[at + 1] << 8) |
          (bytes[at + 2] << 16) |
          (bytes[at + 3] << 24)) >>>
        0;
      regen = (v >>> 4) & 0x3fff;
      packed = (v >>> 18) & 0x3fff;
      at += 4;
    } else {
      regen = (b0 >> 4) | (bytes[at + 1] << 4) | ((bytes[at + 2] & 0x3f) << 12);
      packed =
        (bytes[at + 2] >> 6) | (bytes[at + 3] << 2) | (bytes[at + 4] << 10);
      at += 5;
    }
    const stop = at + packed;
    if (stop > end) fail('it ends too soon');
    if (type === 2) {
      const h = readHuffman(bytes, at, stop);
      frame.huffman = h.huffman;
      at = h.at;
    } else if (!frame.huffman) fail('repeated Huffman table with none before');
    literals = new Uint8Array(regen);
    if (streams === 1)
      decodeHuffmanStream(bytes, at, stop, frame.huffman, literals, 0, regen);
    else {
      const s1 = bytes[at] | (bytes[at + 1] << 8);
      const s2 = bytes[at + 2] | (bytes[at + 3] << 8);
      const s3 = bytes[at + 4] | (bytes[at + 5] << 8);
      const each = Math.ceil(regen / 4);
      let p = at + 6;
      const sizes = [s1, s2, s3, stop - (at + 6 + s1 + s2 + s3)];
      if (sizes[3] <= 0 || each * 3 > regen) fail('bad literal streams');
      for (let k = 0; k < 4; k++) {
        decodeHuffmanStream(
          bytes,
          p,
          p + sizes[k],
          frame.huffman,
          literals,
          k * each,
          k < 3 ? each : regen - 3 * each,
        );
        p += sizes[k];
      }
    }
    at = stop;
  }

  // Sequences.
  let count = bytes[at++];
  if (count === undefined) fail('it ends too soon');
  if (count >= 255)
    ((count = bytes[at] + (bytes[at + 1] << 8) + 0x7f00), (at += 2));
  else if (count >= 128)
    ((count = ((count - 128) << 8) + bytes[at]), (at += 1));
  if (count === 0) {
    if (at !== end) fail('block size does not match');
    out.reserve(literals.length);
    out.buf.set(literals, out.length);
    out.length += literals.length;
    return;
  }
  const modes = bytes[at++];
  if (modes & 3) fail('reserved bits set');
  const ll = pickTable(modes >> 6, bytes, at, end, frame.ll, LL_DEFAULT, 35, 9);
  const of = pickTable(
    (modes >> 4) & 3,
    bytes,
    ll.at,
    end,
    frame.of,
    OF_DEFAULT,
    31,
    8,
  );
  const ml = pickTable(
    (modes >> 2) & 3,
    bytes,
    of.at,
    end,
    frame.ml,
    ML_DEFAULT,
    52,
    9,
  );
  frame.ll = ll.table;
  frame.of = of.table;
  frame.ml = ml.table;
  const r = new Backward(bytes, ml.at, end);
  const L = ll.table;
  const O = of.table;
  const M = ml.table;
  let sl = r.read(L.log);
  let so = r.read(O.log);
  let sm = r.read(M.log);
  const reps = frame.reps;
  let lit = 0;
  for (let i = 0; i < count; i++) {
    const ofCode = O.symbol[so];
    const mlCode = M.symbol[sm];
    const llCode = L.symbol[sl];
    if (ofCode > 31) fail('bad offset code');
    const ofValue = 2 ** ofCode + r.read(ofCode);
    const matchLen = ML_BASE[mlCode] + r.read(ML_BITS[mlCode]);
    const litLen = LL_BASE[llCode] + r.read(LL_BITS[llCode]);
    let offset;
    if (ofValue > 3) {
      offset = ofValue - 3;
      reps[2] = reps[1];
      reps[1] = reps[0];
      reps[0] = offset;
    } else {
      const idx = ofValue - 1 + (litLen === 0 ? 1 : 0);
      if (idx === 0) offset = reps[0];
      else {
        offset = idx === 3 ? reps[0] - 1 : reps[idx];
        if (idx !== 1) reps[2] = reps[1];
        reps[1] = reps[0];
        reps[0] = offset;
      }
    }
    if (i < count - 1) {
      sl = L.base[sl] + r.read(L.bits[sl]);
      sm = M.base[sm] + r.read(M.bits[sm]);
      so = O.base[so] + r.read(O.bits[so]);
    }
    if (lit + litLen > literals.length) fail('too few literals');
    out.reserve(litLen + matchLen);
    const buf = out.buf;
    buf.set(literals.subarray(lit, lit + litLen), out.length);
    out.length += litLen;
    lit += litLen;
    if (offset < 1 || offset > out.length - frame.start)
      fail('match before the start');
    let from = out.length - offset;
    for (let k = 0; k < matchLen; k++) buf[out.length++] = buf[from++];
  }
  if (r.pos !== 0) fail('sequence stream size does not match');
  const rest = literals.length - lit;
  out.reserve(rest);
  out.buf.set(literals.subarray(lit), out.length);
  out.length += rest;
}

// XXH64 (seed 0), the frame checksum; its low 32 bits are stored.
const P1 = 11400714785074694791n;
const P2 = 14029467366897019727n;
const P3 = 1609587929392839161n;
const P4 = 9650029242287828579n;
const P5 = 2870177450012600261n;
const M64 = (1n << 64n) - 1n;
const rotl = (v, r) => ((v << r) | (v >> (64n - r))) & M64;
const round = (acc, lane) => (rotl((acc + lane * P2) & M64, 31n) * P1) & M64;
export function xxh64(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = bytes.length;
  let i = 0;
  let h;
  if (n >= 32) {
    let v1 = (P1 + P2) & M64;
    let v2 = P2;
    let v3 = 0n;
    let v4 = (M64 + 1n - P1) & M64;
    for (; i + 32 <= n; i += 32) {
      v1 = round(v1, view.getBigUint64(i, true));
      v2 = round(v2, view.getBigUint64(i + 8, true));
      v3 = round(v3, view.getBigUint64(i + 16, true));
      v4 = round(v4, view.getBigUint64(i + 24, true));
    }
    h = (rotl(v1, 1n) + rotl(v2, 7n) + rotl(v3, 12n) + rotl(v4, 18n)) & M64;
    for (const v of [v1, v2, v3, v4]) h = ((h ^ round(0n, v)) * P1 + P4) & M64;
  } else h = P5;
  h = (h + BigInt(n)) & M64;
  for (; i + 8 <= n; i += 8)
    h = (rotl(h ^ round(0n, view.getBigUint64(i, true)), 27n) * P1 + P4) & M64;
  if (i + 4 <= n) {
    h =
      (rotl(h ^ ((BigInt(view.getUint32(i, true)) * P1) & M64), 23n) * P2 +
        P3) &
      M64;
    i += 4;
  }
  for (; i < n; i++)
    h = (rotl(h ^ ((BigInt(bytes[i]) * P5) & M64), 11n) * P1) & M64;
  h ^= h >> 33n;
  h = (h * P2) & M64;
  h ^= h >> 29n;
  h = (h * P3) & M64;
  h ^= h >> 32n;
  return h;
}

export function isZstd(bytes) {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x28 &&
    bytes[1] === 0xb5 &&
    bytes[2] === 0x2f &&
    bytes[3] === 0xfd
  );
}

// Decodes a whole .zst file (several frames one after another are read as one; skippable frames are skipped).
export function unzstd(bytes, { maxBytes = 1.5e9 } = {}) {
  const out = new Output(maxBytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  let frames = 0;
  while (at < bytes.length) {
    if (at + 4 > bytes.length) fail('bytes after the end');
    const magic = view.getUint32(at, true);
    if ((magic & 0xfffffff0) >>> 0 === 0x184d2a50) {
      at += 8 + view.getUint32(at + 4, true);
      continue;
    }
    if (magic !== 0xfd2fb528) {
      if (frames) fail('bytes after the end');
      throw new Error('This is not a .zst file.');
    }
    at += 4;
    const d = bytes[at++];
    const fcsFlag = d >> 6;
    const single = (d >> 5) & 1;
    if (d & 8) fail('reserved bit set');
    const hasChecksum = (d >> 2) & 1;
    const dictSize = [0, 1, 2, 4][d & 3];
    if (!single) at++; // window descriptor: the whole output is kept, so the window size is not needed
    let dictId = 0;
    for (let k = 0; k < dictSize; k++) dictId += bytes[at + k] * 256 ** k;
    at += dictSize;
    if (dictId)
      throw new Error(
        'This .zst file needs a separate dictionary file, which this page cannot use.',
      );
    at += [single, 2, 4, 8][fcsFlag];
    const frame = {
      start: out.length,
      reps: [1, 4, 8],
      huffman: null,
      ll: null,
      of: null,
      ml: null,
    };
    for (;;) {
      if (at + 3 > bytes.length) fail('it ends too soon');
      const h = bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
      at += 3;
      const last = h & 1;
      const type = (h >> 1) & 3;
      const size = h >> 3;
      if (type === 0) {
        if (at + size > bytes.length) fail('it ends too soon');
        out.reserve(size);
        out.buf.set(bytes.subarray(at, at + size), out.length);
        out.length += size;
        at += size;
      } else if (type === 1) {
        out.reserve(size);
        out.buf.fill(bytes[at], out.length, out.length + size);
        out.length += size;
        at += 1;
      } else if (type === 2) {
        if (at + size > bytes.length) fail('it ends too soon');
        block(bytes, at, at + size, out, frame);
        at += size;
      } else fail('reserved block type');
      if (last) break;
    }
    if (hasChecksum) {
      const want = view.getUint32(at, true);
      const got = Number(
        xxh64(out.buf.subarray(frame.start, out.length)) & 0xffffffffn,
      );
      if (got !== want) fail('checksum');
      at += 4;
    }
    frames++;
  }
  return out.buf.slice(0, out.length);
}
