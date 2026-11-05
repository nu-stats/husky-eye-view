// A bzip2 decoder (.bz2 files and bzip2 entries in zip files), written from the published description of the format:
// Huffman-coded move-to-front symbols with run lengths, an inverse Burrows-Wheeler transform, then a final run-length
// step. Every block's checksum is checked, so a damaged file is refused rather than read wrong. No dependencies; runs
// in the browser and in Node.

class BitReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
    this.buf = 0;
    this.count = 0;
  }
  // Up to 24 bits, most significant first.
  bits(n) {
    while (this.count < n) {
      if (this.pos >= this.bytes.length)
        throw new Error('The .bz2 file ends too soon (it may be cut off).');
      this.buf = ((this.buf << 8) | this.bytes[this.pos++]) >>> 0;
      this.count += 8;
    }
    const v = (this.buf >>> (this.count - n)) & ((1 << n) - 1);
    this.count -= n;
    this.buf &= (1 << this.count) - 1;
    return v;
  }
  bit() {
    return this.bits(1);
  }
  // Skips to the next whole byte (streams end on a byte boundary).
  align() {
    this.count -= this.count % 8;
    this.buf &= (1 << this.count) - 1;
  }
  get atEnd() {
    return this.pos >= this.bytes.length && this.count < 8;
  }
}

// bzip2's checksum: CRC-32 with the 0x04c11db7 polynomial, most significant bit first.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let k = 0; k < 8; k++)
      c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    t[i] = c >>> 0;
  }
  return t;
})();

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
  result() {
    return this.buf.slice(0, this.length);
  }
}

function readTables(r, alphaSize) {
  const groups = r.bits(3);
  const selectorCount = r.bits(15);
  if (groups < 2 || groups > 6 || selectorCount < 1)
    throw new Error('The .bz2 file is damaged (bad table count).');
  // Which table each run of 50 symbols uses, sent move-to-front coded in unary.
  const order = Array.from({ length: groups }, (_, i) => i);
  const selectors = new Uint8Array(selectorCount);
  for (let i = 0; i < selectorCount; i++) {
    let j = 0;
    while (r.bit()) {
      j++;
      if (j >= groups)
        throw new Error('The .bz2 file is damaged (bad table selector).');
    }
    const v = order[j];
    order.splice(j, 1);
    order.unshift(v);
    selectors[i] = v;
  }
  // Code lengths for each table, sent as differences, then canonical codes in order of length and symbol.
  const tables = [];
  for (let g = 0; g < groups; g++) {
    const lengths = new Uint8Array(alphaSize);
    let len = r.bits(5);
    for (let s = 0; s < alphaSize; s++) {
      for (;;) {
        if (len < 1 || len > 20)
          throw new Error('The .bz2 file is damaged (bad code length).');
        if (!r.bit()) break;
        len += r.bit() ? -1 : 1;
      }
      lengths[s] = len;
    }
    let min = 32;
    let max = 0;
    for (const l of lengths) {
      if (l < min) min = l;
      if (l > max) max = l;
    }
    const limit = new Int32Array(max + 2).fill(-1);
    const first = new Int32Array(max + 2);
    const firstIndex = new Int32Array(max + 2);
    const perm = new Uint16Array(alphaSize);
    let code = 0;
    let idx = 0;
    for (let l = min; l <= max; l++) {
      first[l] = code;
      firstIndex[l] = idx;
      for (let s = 0; s < alphaSize; s++) if (lengths[s] === l) perm[idx++] = s;
      code += idx - firstIndex[l];
      limit[l] = code - 1;
      code <<= 1;
    }
    tables.push({ min, max, limit, first, firstIndex, perm });
  }
  return { selectors, tables };
}

function readBlock(r, maxBlock, out) {
  const expectedCrc = ((r.bits(16) << 16) | r.bits(16)) >>> 0;
  if (r.bit())
    throw new Error(
      'This .bz2 file uses the "randomized" blocks of bzip2 0.9.0 and earlier, which are not supported.',
    );
  const origPtr = r.bits(24);
  // The byte values the block uses.
  const used = r.bits(16);
  const seqToUnseq = [];
  for (let i = 0; i < 16; i++) {
    if (!(used & (0x8000 >> i))) continue;
    const bits = r.bits(16);
    for (let j = 0; j < 16; j++)
      if (bits & (0x8000 >> j)) seqToUnseq.push(i * 16 + j);
  }
  if (!seqToUnseq.length)
    throw new Error('The .bz2 file is damaged (empty symbol map).');
  const alphaSize = seqToUnseq.length + 2;
  const eob = alphaSize - 1;
  const { selectors, tables } = readTables(r, alphaSize);

  // Huffman symbols to bytes, undoing move-to-front and the RUNA/RUNB run lengths.
  const block = new Uint8Array(maxBlock);
  const counts = new Int32Array(256);
  const mtf = Uint8Array.from(seqToUnseq.keys());
  let n = 0;
  let run = 0;
  let runWeight = 1;
  let selector = 0;
  let left = 0;
  let table = tables[0];
  for (;;) {
    if (left === 0) {
      if (selector >= selectors.length)
        throw new Error(
          'The .bz2 file is damaged (ran out of table selectors).',
        );
      table = tables[selectors[selector++]];
      left = 50;
    }
    left--;
    let v = r.bits(table.min);
    let len = table.min;
    while (v > table.limit[len]) {
      len++;
      if (len > table.max)
        throw new Error('The .bz2 file is damaged (bad code).');
      v = (v << 1) | r.bit();
    }
    const sym = table.perm[table.firstIndex[len] + v - table.first[len]];
    if (sym <= 1) {
      run += (sym + 1) * runWeight;
      runWeight <<= 1;
      if (run > maxBlock)
        throw new Error('The .bz2 file is damaged (run too long).');
      continue;
    }
    if (run) {
      const b = seqToUnseq[mtf[0]];
      if (n + run > maxBlock)
        throw new Error('The .bz2 file is damaged (block too long).');
      block.fill(b, n, n + run);
      counts[b] += run;
      n += run;
      run = 0;
      runWeight = 1;
    }
    if (sym === eob) break;
    const pos = sym - 1;
    const m = mtf[pos];
    mtf.copyWithin(1, 0, pos);
    mtf[0] = m;
    const b = seqToUnseq[m];
    if (n >= maxBlock)
      throw new Error('The .bz2 file is damaged (block too long).');
    block[n++] = b;
    counts[b]++;
  }
  if (origPtr >= n)
    throw new Error('The .bz2 file is damaged (bad start position).');

  // Inverse Burrows-Wheeler transform.
  const next = new Int32Array(n);
  const start = new Int32Array(256);
  for (let b = 0, sum = 0; b < 256; b++) {
    start[b] = sum;
    sum += counts[b];
  }
  for (let i = 0; i < n; i++) next[start[block[i]]++] = i;

  // The first run-length step: four equal bytes are followed by a count of more.
  let crc = 0xffffffff;
  let pos = next[origPtr];
  let last = -1;
  let same = 0;
  out.reserve(n);
  for (let k = 0; k < n; k++) {
    const b = block[pos];
    pos = next[pos];
    if (same === 4) {
      out.reserve(b + (n - k));
      for (let c = 0; c < b; c++) {
        out.buf[out.length++] = last;
        crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ last) & 0xff]) >>> 0;
      }
      same = 0;
      last = -1;
      continue;
    }
    if (b === last) same++;
    else {
      last = b;
      same = 1;
    }
    out.buf[out.length++] = b;
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0;
  }
  crc = ~crc >>> 0;
  if (crc !== expectedCrc)
    throw new Error('The .bz2 file is damaged (a block failed its checksum).');
  return crc;
}

export function isBzip2(bytes) {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x42 &&
    bytes[1] === 0x5a &&
    bytes[2] === 0x68 &&
    bytes[3] >= 0x31 &&
    bytes[3] <= 0x39
  );
}

// Decodes a whole .bz2 file (several streams one after another are read as one, as bzip2 itself does).
export function bunzip2(bytes, { maxBytes = 1.5e9 } = {}) {
  const r = new BitReader(bytes);
  const out = new Output(maxBytes);
  let streams = 0;
  while (!r.atEnd) {
    if (r.bits(8) !== 0x42 || r.bits(8) !== 0x5a || r.bits(8) !== 0x68) {
      if (streams) break; // trailing bytes after the last stream, as bzip2 allows
      throw new Error('This is not a .bz2 file.');
    }
    const level = r.bits(8) - 0x30;
    if (level < 1 || level > 9)
      throw new Error('The .bz2 file is damaged (bad block size).');
    let combined = 0;
    for (;;) {
      const hi = r.bits(24);
      const lo = r.bits(24);
      if (hi === 0x314159 && lo === 0x265359) {
        const crc = readBlock(r, level * 100000, out);
        combined = (((combined << 1) | (combined >>> 31)) ^ crc) >>> 0;
      } else if (hi === 0x177245 && lo === 0x385090) {
        const expected = ((r.bits(16) << 16) | r.bits(16)) >>> 0;
        if (expected !== combined)
          throw new Error('The .bz2 file is damaged (whole-file checksum).');
        r.align();
        break;
      } else throw new Error('The .bz2 file is damaged (bad block marker).');
    }
    streams++;
  }
  return out.result();
}
