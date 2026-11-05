// An xz decoder (.xz files), written from the public xz file format description and the LZMA2 / LZMA method it
// carries: a range coder with adaptive bit probabilities, literals and matches over a sliding dictionary, in chunks.
// Each block's check (CRC-32, CRC-64 or SHA-256) is verified, so a damaged file is refused rather than read wrong.
// Only the LZMA2 filter is read (what `xz` uses for ordinary files); the branch-code and delta filters are refused
// with a plain message. No dependencies; runs in the browser and in Node.
import { crc32 } from './crc32.js';

const fail = (why) => {
  throw new Error(`The .xz file is damaged (${why}).`);
};

// CRC-64 (ECMA-182, as xz uses it), as two 32-bit halves so it stays fast without BigInt.
const CRC64 = (() => {
  const lo = new Uint32Array(256);
  const hi = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let l = i;
    let h = 0;
    for (let k = 0; k < 8; k++) {
      const bit = l & 1;
      l = ((l >>> 1) | ((h & 1) << 31)) >>> 0;
      h >>>= 1;
      if (bit) {
        l = (l ^ 0xd7870f42) >>> 0;
        h = (h ^ 0xc96c5795) >>> 0;
      }
    }
    lo[i] = l;
    hi[i] = h;
  }
  return { lo, hi };
})();
function crc64(bytes) {
  let l = 0xffffffff;
  let h = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    const t = (l ^ bytes[i]) & 0xff;
    l = (((l >>> 8) | (h << 24)) ^ CRC64.lo[t]) >>> 0;
    h = ((h >>> 8) ^ CRC64.hi[t]) >>> 0;
  }
  return [~l >>> 0, ~h >>> 0];
}

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

// The LZMA decoder state for one block. The output buffer is the dictionary; positions count from the last reset.
class Lzma {
  constructor(out) {
    this.out = out;
    this.dictStart = out.length;
    this.dictSize = 0;
    this.props = null;
  }
  setProps(byte) {
    if (byte > 224) fail('bad LZMA settings');
    this.lc = byte % 9;
    this.lp = Math.floor(byte / 9) % 5;
    this.pb = Math.floor(byte / 45);
    if (this.lc + this.lp > 4) fail('bad LZMA settings');
    this.props = byte;
  }
  resetState() {
    const p = (n) => new Uint16Array(n).fill(1024);
    this.literal = p(0x300 << (this.lc + this.lp));
    this.isMatch = p(192);
    this.isRep = p(12);
    this.isRepG0 = p(12);
    this.isRepG1 = p(12);
    this.isRepG2 = p(12);
    this.isRep0Long = p(192);
    this.posSlot = p(256);
    this.posSpecial = p(115);
    this.align = p(16);
    const len = () => ({
      choice: p(2),
      low: p(256),
      mid: p(256),
      high: p(256),
    });
    this.matchLen = len();
    this.repLen = len();
    this.state = 0;
    this.reps = [0, 0, 0, 0];
  }
  // Range decoder over bytes[at..end).
  startRange(bytes, at, end) {
    if (end > bytes.length || bytes[at] !== 0) fail('bad range coder start');
    this.bytes = bytes;
    this.at = at + 5;
    this.end = end;
    this.range = 0xffffffff;
    this.code =
      ((bytes[at + 1] << 24) |
        (bytes[at + 2] << 16) |
        (bytes[at + 3] << 8) |
        bytes[at + 4]) >>>
      0;
  }
  bit(probs, i) {
    const p = probs[i];
    const bound = (this.range >>> 11) * p;
    let b;
    if (this.code < bound) {
      this.range = bound;
      probs[i] = p + ((2048 - p) >>> 5);
      b = 0;
    } else {
      this.range -= bound;
      this.code -= bound;
      probs[i] = p - (p >>> 5);
      b = 1;
    }
    if (this.range < 0x1000000) {
      this.range = (this.range << 8) >>> 0;
      this.code = ((this.code << 8) | this.bytes[this.at++]) >>> 0;
    }
    return b;
  }
  direct(n) {
    let v = 0;
    for (; n > 0; n--) {
      this.range >>>= 1;
      let b = 0;
      if (this.code >= this.range) {
        this.code -= this.range;
        b = 1;
      }
      v = ((v << 1) | b) >>> 0;
      if (this.range < 0x1000000) {
        this.range = (this.range << 8) >>> 0;
        this.code = ((this.code << 8) | this.bytes[this.at++]) >>> 0;
      }
    }
    return v;
  }
  tree(probs, base, bits) {
    let m = 1;
    for (let i = 0; i < bits; i++) m = (m << 1) | this.bit(probs, base + m);
    return m - (1 << bits);
  }
  reverse(probs, base, bits) {
    let m = 1;
    let v = 0;
    for (let i = 0; i < bits; i++) {
      const b = this.bit(probs, base + m);
      m = (m << 1) | b;
      v |= b << i;
    }
    return v;
  }
  length(L, posState) {
    if (!this.bit(L.choice, 0)) return this.tree(L.low, posState << 3, 3);
    if (!this.bit(L.choice, 1)) return 8 + this.tree(L.mid, posState << 3, 3);
    return 16 + this.tree(L.high, 0, 8);
  }
  // Decodes one LZMA chunk that unpacks to `size` bytes.
  chunk(size) {
    const out = this.out;
    out.reserve(size);
    const buf = () => out.buf;
    const stop = out.length + size;
    const pbMask = (1 << this.pb) - 1;
    const lpMask = (1 << this.lp) - 1;
    while (out.length < stop) {
      const pos = out.length - this.dictStart;
      const posState = pos & pbMask;
      const s = this.state;
      if (!this.bit(this.isMatch, (s << 4) + posState)) {
        const prev = pos > 0 ? buf()[out.length - 1] : 0;
        const base =
          0x300 * (((pos & lpMask) << this.lc) + (prev >>> (8 - this.lc)));
        let sym = 1;
        if (s >= 7) {
          if (this.reps[0] >= pos) fail('match before the start');
          let match = buf()[out.length - this.reps[0] - 1];
          while (sym < 0x100) {
            const mb = (match >>> 7) & 1;
            match <<= 1;
            const b = this.bit(this.literal, base + ((1 + mb) << 8) + sym);
            sym = (sym << 1) | b;
            if (mb !== b) break;
          }
        }
        while (sym < 0x100)
          sym = (sym << 1) | this.bit(this.literal, base + sym);
        buf()[out.length++] = sym & 0xff;
        this.state = s < 4 ? 0 : s < 10 ? s - 3 : s - 6;
        continue;
      }
      let len;
      if (this.bit(this.isRep, s)) {
        if (pos === 0) fail('repeat at the start');
        if (!this.bit(this.isRepG0, s)) {
          if (!this.bit(this.isRep0Long, (s << 4) + posState)) {
            this.state = s < 7 ? 9 : 11;
            buf()[out.length] = buf()[out.length - this.reps[0] - 1];
            out.length++;
            continue;
          }
        } else {
          let d;
          if (!this.bit(this.isRepG1, s)) d = this.reps[1];
          else {
            if (!this.bit(this.isRepG2, s)) d = this.reps[2];
            else {
              d = this.reps[3];
              this.reps[3] = this.reps[2];
            }
            this.reps[2] = this.reps[1];
          }
          this.reps[1] = this.reps[0];
          this.reps[0] = d;
        }
        len = this.length(this.repLen, posState);
        this.state = s < 7 ? 8 : 11;
      } else {
        this.reps[3] = this.reps[2];
        this.reps[2] = this.reps[1];
        this.reps[1] = this.reps[0];
        len = this.length(this.matchLen, posState);
        this.state = s < 7 ? 7 : 10;
        const slot = this.tree(this.posSlot, (len < 4 ? len : 3) << 6, 6);
        let dist;
        if (slot < 4) dist = slot;
        else {
          const n = (slot >>> 1) - 1;
          dist = ((2 | (slot & 1)) << n) >>> 0;
          if (slot < 14) dist += this.reverse(this.posSpecial, dist - slot, n);
          else {
            dist += this.direct(n - 4) << 4;
            dist += this.reverse(this.align, 0, 4);
            if (dist === 0xffffffff) fail('end marker inside LZMA2');
          }
          dist >>>= 0;
        }
        this.reps[0] = dist;
      }
      len += 2;
      const d = this.reps[0];
      if (d >= pos || d >= this.dictSize) fail('match before the start');
      if (out.length + len > stop) fail('match past the end of a chunk');
      const b = buf();
      let from = out.length - d - 1;
      for (let k = 0; k < len; k++) b[out.length++] = b[from++];
    }
    if (this.at !== this.end) fail('chunk size does not match');
  }
}

// One block's LZMA2 data from bytes[at...]; returns where the data ended.
function lzma2(bytes, at, out, dictSize) {
  const lz = new Lzma(out);
  lz.dictSize = dictSize;
  let needDictReset = true;
  let needProps = true;
  for (;;) {
    if (at >= bytes.length) fail('it ends too soon');
    const control = bytes[at++];
    if (control === 0) return at;
    if (control === 1 || control === 2) {
      if (control === 1) {
        lz.dictStart = out.length;
        needDictReset = false;
        needProps = true;
      } else if (needDictReset) fail('no dictionary reset');
      const size = ((bytes[at] << 8) | bytes[at + 1]) + 1;
      at += 2;
      if (at + size > bytes.length) fail('it ends too soon');
      out.reserve(size);
      out.buf.set(bytes.subarray(at, at + size), out.length);
      out.length += size;
      at += size;
      continue;
    }
    if (control < 0x80) fail('bad chunk');
    const reset = (control >>> 5) & 3;
    const size =
      ((control & 0x1f) << 16) + (bytes[at] << 8) + bytes[at + 1] + 1;
    const packed = (bytes[at + 2] << 8) + bytes[at + 3] + 1;
    at += 4;
    if (reset === 3) {
      lz.dictStart = out.length;
      needDictReset = false;
    } else if (needDictReset) fail('no dictionary reset');
    if (reset >= 2) {
      lz.setProps(bytes[at++]);
      needProps = false;
    } else if (needProps) fail('no LZMA settings');
    if (reset >= 1) lz.resetState();
    lz.startRange(bytes, at, at + packed);
    lz.chunk(size);
    at += packed;
  }
}

function varint(bytes, at) {
  let v = 0;
  let shift = 0;
  for (let i = 0; i < 9; i++) {
    const b = bytes[at.i++];
    v += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80)) return v;
    shift += 7;
  }
  fail('bad number');
}

const u32 = (b, i) =>
  (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const CHECK_SIZE = { 0: 0, 1: 4, 4: 8, 10: 32 };

async function check(type, data, stored) {
  if (type === 1) return crc32(data) === u32(stored, 0);
  if (type === 4) {
    const [l, h] = crc64(data);
    return l === u32(stored, 0) && h === u32(stored, 4);
  }
  if (type === 10) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    return digest.every((b, i) => b === stored[i]);
  }
  return true;
}

export function isXz(bytes) {
  return (
    bytes.length >= 6 &&
    bytes[0] === 0xfd &&
    bytes[1] === 0x37 &&
    bytes[2] === 0x7a &&
    bytes[3] === 0x58 &&
    bytes[4] === 0x5a &&
    bytes[5] === 0x00
  );
}

// Decodes a whole .xz file (several streams one after another are read as one, as xz itself does).
export async function unxz(bytes, { maxBytes = 1.5e9 } = {}) {
  const out = new Output(maxBytes);
  let at = 0;
  let streams = 0;
  while (at < bytes.length) {
    // Zero padding between streams, in fours.
    if (streams && bytes[at] === 0) {
      at += 4;
      continue;
    }
    if (!isXz(bytes.subarray(at))) {
      if (streams) fail('bytes after the end');
      throw new Error('This is not an .xz file.');
    }
    const flags = bytes.subarray(at + 6, at + 8);
    if (crc32(flags) !== u32(bytes, at + 8)) fail('stream header checksum');
    const type = flags[1] & 0x0f;
    if (flags[0] !== 0 || !(type in CHECK_SIZE))
      throw new Error('This .xz file uses a check this page cannot read.');
    at += 12;
    for (;;) {
      if (at >= bytes.length) fail('it ends too soon');
      if (bytes[at] === 0) break; // the index: the stream's blocks are done
      // Block header.
      const headerSize = (bytes[at] + 1) * 4;
      const header = bytes.subarray(at, at + headerSize);
      if (
        crc32(header.subarray(0, headerSize - 4)) !==
        u32(header, headerSize - 4)
      )
        fail('block header checksum');
      const bflags = header[1];
      const cursor = { i: 2 };
      if (bflags & 0x40) varint(header, cursor);
      if (bflags & 0x80) varint(header, cursor);
      const filters = (bflags & 3) + 1;
      let dictSize = 0;
      for (let f = 0; f < filters; f++) {
        const id = varint(header, cursor);
        const propSize = varint(header, cursor);
        if (id !== 0x21 || f !== filters - 1) {
          throw new Error(
            'This .xz file was made with an extra filter (for programs or deltas) that this page cannot read. Unpack it on your computer first.',
          );
        }
        const d = header[cursor.i];
        if (propSize !== 1 || d > 40) fail('bad LZMA2 settings');
        dictSize =
          d === 40 ? 0xffffffff : (2 | (d & 1)) * 2 ** (Math.floor(d / 2) + 11);
        cursor.i += propSize;
      }
      at += headerSize;
      const start = out.length;
      at = lzma2(bytes, at, out, dictSize);
      while (at % 4) if (bytes[at++] !== 0) fail('bad padding');
      const size = CHECK_SIZE[type];
      if (
        !(await check(
          type,
          out.buf.subarray(start, out.length),
          bytes.subarray(at, at + size),
        ))
      )
        fail('a block failed its check');
      at += size;
    }
    // Index and footer: skip the index (its size is in the footer), checking the footer's own checksum.
    let footer = at;
    while (
      footer + 12 <= bytes.length &&
      !(
        bytes[footer + 10] === 0x59 &&
        bytes[footer + 11] === 0x5a &&
        u32(bytes, footer + 4) * 4 + 4 === footer - at
      )
    )
      footer += 4;
    if (footer + 12 > bytes.length) fail('stream footer missing');
    if (crc32(bytes.subarray(footer + 4, footer + 10)) !== u32(bytes, footer))
      fail('stream footer checksum');
    at = footer + 12;
    streams++;
  }
  return out.buf.slice(0, out.length);
}
