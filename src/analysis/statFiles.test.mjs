import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import {
  gzipBytes,
  programNames,
  utf8Prefix,
  writeDta,
  writeRData,
  writeSav,
} from './statFiles.js';

const DATASET = {
  title: 'Test merge',
  variables: [
    { name: 'geoid', label: 'Census GEOID', kind: 'string' },
    { name: 'my value', label: 'Your value', kind: 'numeric' },
    { name: 'if', label: 'Reserved', kind: 'numeric' },
    { name: 'note', label: 'São Paulo — ünïcödé', kind: 'string' },
    {
      name: 'hev_merge',
      label: 'Matched',
      kind: 'numeric',
      valueLabels: { 1: 'No match', 3: 'Matched' },
    },
  ],
  rows: [
    ['25025010405', 12.5, 0, 'a', 3],
    ['25025010406', null, -1.5, 'ünï', 3],
    ['99999999999', 7, null, null, 1],
  ],
};

const text = (bytes) => new TextDecoder().decode(bytes);

test('names follow each program’s rules, unique and close to the originals', () => {
  const vars = ['my value', 'if', '1st', 'a'.repeat(40), 'A', 'a', 'x.y'].map(
    (name) => ({ name }),
  );
  const stata = programNames(vars, 'stata');
  assert.deepEqual(stata.names.slice(0, 3), ['my_value', 'if_v', 'v1st']);
  assert.equal(stata.names[3].length, 32);
  assert.deepEqual(stata.names.slice(4, 6), ['A', 'a']); // Stata names are case-sensitive
  const spss = programNames(vars, 'spss');
  assert.equal(spss.names[1], 'if'); // IF is not reserved in SPSS
  assert.notEqual(spss.names[5].toUpperCase(), spss.names[4].toUpperCase());
  assert.equal(spss.names[6], 'x.y');
  const r = programNames(vars, 'r');
  assert.deepEqual(r.names.slice(0, 3), ['my_value', 'if.', 'X1st']);
  assert.ok(r.renames.some(([from, to]) => from === 'if' && to === 'if.'));
});

test('utf8Prefix never splits a character', () => {
  assert.equal(text(utf8Prefix('ab—cd', 3)), 'ab');
  assert.equal(text(utf8Prefix('ab—cd', 5)), 'ab—');
});

test('Stata .dta: format 118 with a map that points at every section', () => {
  const { bytes, renames } = writeDta(DATASET, {
    now: new Date(2026, 9, 10, 9, 5),
  });
  // One character per byte, so string positions are byte offsets.
  const all = new TextDecoder('latin1').decode(bytes);
  assert.ok(
    all.startsWith(
      '<stata_dta><header><release>118</release><byteorder>LSF</byteorder><K>',
    ),
  );
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const kAt = all.indexOf('<K>') + 3;
  assert.equal(view.getUint16(kAt, true), 5);
  assert.equal(Number(view.getBigUint64(all.indexOf('<N>') + 3, true)), 3);
  assert.ok(all.includes('10 Oct 2026 09:05'));
  const mapAt = all.indexOf('<map>') + 5;
  const tags = [
    '<stata_dta>',
    '<map>',
    '<variable_types>',
    '<varnames>',
    '<sortlist>',
    '<formats>',
    '<value_label_names>',
    '<variable_labels>',
    '<characteristics>',
    '<data>',
    '<strls>',
    '<value_labels>',
    '</stata_dta>',
  ];
  tags.forEach((tag, i) => {
    const at = Number(view.getBigUint64(mapAt + i * 8, true));
    assert.equal(all.slice(at, at + tag.length), tag, `map entry ${i}`);
  });
  assert.equal(Number(view.getBigUint64(mapAt + 13 * 8, true)), bytes.length);
  // geoid str11, numbers double; one row is 11 + 8 + 8 + 5 ('ünï' is 5 bytes) + 8.
  const typesAt = all.indexOf('<variable_types>') + 16;
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((j) => view.getUint16(typesAt + j * 2, true)),
    [11, 65526, 65526, 5, 65526],
  );
  const dataAt = all.indexOf('<data>') + 6;
  const rowBytes = 11 + 8 + 8 + 5 + 8;
  assert.equal(all.indexOf('</data>') - dataAt, 3 * rowBytes);
  // The missing value of row 2 is Stata's '.' (2^1023).
  const missingAt = dataAt + rowBytes + 11;
  assert.deepEqual(
    [...bytes.slice(missingAt, missingAt + 8)],
    [0, 0, 0, 0, 0, 0, 0xe0, 0x7f],
  );
  assert.ok(all.includes('<lbl>'));
  assert.ok(renames.some(([from, to]) => from === 'if' && to === 'if_v'));
});

test('SPSS .sav: header, long names, UTF-8 and cases', () => {
  const { bytes } = writeSav(DATASET, { now: new Date(2026, 9, 10, 9, 5, 7) });
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  assert.equal(text(bytes.slice(0, 4)), '$FL2');
  assert.equal(view.getInt32(64, true), 2); // layout code
  // Segments: geoid 2, numbers 1 each, note 1 ('ünï' fits in 8).
  assert.equal(view.getInt32(68, true), 6);
  assert.equal(view.getInt32(80, true), 3); // cases
  assert.equal(view.getFloat64(84, true), 100);
  assert.equal(text(bytes.slice(92, 109)), '10 Oct 2609:05:07');
  const all = text(bytes);
  assert.ok(all.includes('MY_VALUE=my_value'));
  assert.ok(all.includes('UTF-8'));
  assert.ok(all.includes('São Paulo — ünïcödé'));
  // Cases end the file: 3 rows of 6 segments.
  const end = bytes.length;
  const last = view.getFloat64(end - 8, true);
  assert.equal(last, 1);
  // Row 2's missing value is SYSMIS.
  const row2 = end - 6 * 8 * 2;
  assert.equal(view.getFloat64(row2 + 16, true), -Number.MAX_VALUE);
});

// A reader for the part of R's XDR serialization the writer uses.
function readR(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  const i32 = () => {
    const v = view.getInt32(at, false);
    at += 4;
    return v;
  };
  const item = () => {
    const flags = i32();
    const type = flags & 0xff;
    const hasAttr = Boolean(flags & (1 << 9));
    const hasTag = Boolean(flags & (1 << 10));
    if (type === 254) return null;
    if (type === 9) {
      const n = i32();
      if (n < 0) return { na: true };
      const s = new TextDecoder().decode(bytes.slice(at, at + n));
      at += n;
      return s;
    }
    if (type === 1) return { sym: item() };
    if (type === 2) {
      const attr = hasAttr ? item() : null;
      const tag = hasTag ? item().sym : null;
      const car = item();
      const cdr = item();
      return { pairs: [[tag, car], ...(cdr?.pairs || [])], attr };
    }
    const n = i32();
    let value;
    if (type === 14) {
      value = [];
      for (let k = 0; k < n; k += 1) {
        const hi = view.getUint32(at, false);
        const lo = view.getUint32(at + 4, false);
        value.push(
          hi === 0x7ff00000 && lo === 1954 ? null : view.getFloat64(at, false),
        );
        at += 8;
      }
    } else if (type === 13) {
      value = [];
      for (let k = 0; k < n; k += 1) value.push(i32());
    } else if (type === 16) {
      value = [];
      for (let k = 0; k < n; k += 1) {
        const s = item();
        value.push(s?.na ? null : s);
      }
    } else if (type === 19) {
      value = [];
      for (let k = 0; k < n; k += 1) value.push(item());
    } else throw new Error(`type ${type}`);
    const attrs = hasAttr ? Object.fromEntries(item().pairs) : {};
    return { type, value, attrs };
  };
  const header = new TextDecoder().decode(bytes.slice(0, 5));
  if (header === 'RDX2\n') at = 5;
  assert.equal(new TextDecoder().decode(bytes.slice(at, at + 2)), 'X\n');
  at += 2;
  assert.equal(i32(), 2);
  i32();
  i32();
  return { rdata: header === 'RDX2\n', root: item() };
}

test('R .RData and .rds: a data.frame with labels, NA and value codes', async () => {
  const rdata = readR(writeRData(DATASET).bytes);
  assert.equal(rdata.rdata, true);
  const [[name, frame]] = rdata.root.pairs;
  assert.equal(name, 'hev_data');
  assert.deepEqual(frame.attrs.names.value, [
    'geoid',
    'my_value',
    'if.',
    'note',
    'hev_merge',
  ]);
  assert.deepEqual(frame.attrs.class.value, ['data.frame']);
  assert.deepEqual(frame.attrs['row.names'].value, [-2147483648, -3]);
  const [geoid, value, , note, merge] = frame.value;
  assert.deepEqual(geoid.value, ['25025010405', '25025010406', '99999999999']);
  assert.deepEqual(value.value, [12.5, null, 7]);
  assert.deepEqual(note.value, ['a', 'ünï', null]);
  assert.deepEqual(value.attrs.label.value, ['Your value']);
  assert.deepEqual(merge.attrs.labels.value, [1, 3]);
  assert.deepEqual(merge.attrs.labels.attrs.names.value, [
    'No match',
    'Matched',
  ]);
  const rds = readR(
    gunzipSync(await gzipBytes(writeRData(DATASET, { rds: true }).bytes)),
  );
  assert.equal(rds.rdata, false);
  assert.deepEqual(rds.root.value[1].value, [12.5, null, 7]);
});
