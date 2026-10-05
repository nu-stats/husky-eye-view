import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import {
  PdfDocument,
  buildXlsx,
  buildZip,
  crc32,
  pdfTextWidth,
  pdfWrap,
} from './curatedFiles.js';
import { niceScale, flightFileBase } from './curatedOutputs.js';

const text = (bytes) => new TextDecoder().decode(bytes);

/** Read a stored ZIP back into {name: bytes} (enough to check our writer). */
function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = {};
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const method = view.getUint16(at + 8, true);
    const crc = view.getUint32(at + 14, true);
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const extra = view.getUint16(at + 28, true);
    const name = text(bytes.subarray(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength + extra;
    let data = bytes.subarray(start, start + size);
    if (method === 8) data = inflateRawSync(data);
    assert.equal(crc32(data), crc, `${name} CRC`);
    files[name] = data;
    at = start + size;
  }
  assert.equal(
    view.getUint32(at, true),
    0x02014b50,
    'central directory follows',
  );
  return files;
}

test('CRC-32 matches the standard check value', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('the ZIP writer stores files that read back intact, UTF-8 names included', () => {
  const zip = buildZip([
    { name: 'a.txt', data: 'hello' },
    { name: 'charts/µ-chart.png', data: new Uint8Array([137, 80, 78, 71]) },
  ]);
  const files = readZip(zip);
  assert.equal(text(files['a.txt']), 'hello');
  assert.deepEqual([...files['charts/µ-chart.png']], [137, 80, 78, 71]);
});

test('the XLSX workbook has its parts, numbers as numbers and escaped text', () => {
  const files = readZip(
    buildXlsx([
      {
        name: 'Comparison',
        rows: [
          ['City', 'Value'],
          ['Detroit <MI> & "co"', 72.2],
          ['Omaha', null],
        ],
      },
      { name: 'About/Notes', rows: [['Method'], ['weighted']] },
    ]),
  );
  for (const part of [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/workbook.xml',
    'xl/_rels/workbook.xml.rels',
    'xl/styles.xml',
    'xl/worksheets/sheet1.xml',
    'xl/worksheets/sheet2.xml',
  ])
    assert.ok(files[part], part);
  const sheet = text(files['xl/worksheets/sheet1.xml']);
  assert.match(sheet, /<c r="B2"><v>72.2<\/v><\/c>/);
  assert.match(sheet, /Detroit &lt;MI&gt; &amp; &quot;co&quot;/);
  assert.match(sheet, /<c r="B3"\/>/, 'an empty value is an empty cell');
  assert.match(
    text(files['xl/workbook.xml']),
    /name="About Notes"/,
    'sheet names drop / characters',
  );
});

test('PDF text widths follow Helvetica metrics and wrapping respects them', () => {
  assert.equal(pdfTextWidth('i', 10), 2.22);
  assert.equal(pdfTextWidth('W', 10), 9.44);
  const lines = pdfWrap('one two three four five six seven', 12, 60);
  assert.ok(lines.length > 1);
  for (const line of lines)
    assert.ok(pdfTextWidth(line, 12) <= 60 || !line.includes(' '));
});

test('the PDF writer produces a valid skeleton with fonts, pages and images', () => {
  const pdf = new PdfDocument({ title: 'Report (test)' });
  pdf.text(54, 70, 'Life expectancy · 72.2 µg/m³ – “quoted” (paren)', {
    size: 14,
    bold: true,
  });
  pdf.rect(54, 80, 100, 10, { fill: '#C8102E' });
  pdf.line(54, 100, 300, 100);
  pdf.addPage();
  pdf.jpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), 2, 2, 54, 54, 100, 100);
  const bytes = pdf.build();
  const body = new TextDecoder('latin1').decode(bytes);
  assert.ok(body.startsWith('%PDF-1.4'));
  assert.ok(body.trimEnd().endsWith('%%EOF'));
  assert.match(body, /\/Count 2/);
  assert.match(
    body,
    /\/BaseFont \/Helvetica-Bold \/Encoding \/WinAnsiEncoding/,
  );
  assert.match(body, /\/Filter \/DCTDecode/);
  assert.match(body, /\\\(paren\\\)/, 'parentheses are escaped');
  assert.ok(body.includes('\xb5g/m\xb3'), 'µ and ³ map to WinAnsi');
  // Every xref offset points at its object.
  const xref = body.slice(body.lastIndexOf('xref'));
  const offsets = [...xref.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
    Number(m[1]),
  );
  offsets.forEach((offset, i) =>
    assert.ok(body.startsWith(`${i + 1} 0 obj`, offset), `object ${i + 1}`),
  );
  const startxref = Number(/startxref\n(\d+)/.exec(body)[1]);
  assert.ok(body.startsWith('xref', startxref));
});

test('chart axes get round maxima and steps; file names are slugs', () => {
  assert.deepEqual(niceScale(78.07 * 1.08), { max: 100, step: 20 });
  assert.deepEqual(niceScale(9.8), { max: 10, step: 2 });
  assert.deepEqual(niceScale(0), { max: 1, step: 0.2 });
  assert.equal(
    flightFileBase(
      { cities: [{ name: 'St. Louis' }, { name: 'Omaha' }] },
      new Date('2026-10-04T12:00:00Z'),
    ),
    'husky-eye-view_curated-flight_st-louis-vs-omaha_2026-10-04',
  );
});
