/**
 * File builders for Curated Flights downloads, written without libraries:
 * a ZIP writer (stored entries), a minimal XLSX workbook on top of it, and a
 * small PDF writer (Helvetica text, rectangles, lines and JPEG images).
 * Everything returns bytes; nothing is uploaded or stored anywhere.
 */

/** 2026-10-04 in the viewer's local time (file names, report dates). */
export function localDate(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// ---------- ZIP (stored, no compression; PNG/JPEG are compressed already) ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1)
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const encoder = new TextEncoder();
const toBytes = (data) =>
  typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data);

function dosDateTime(date) {
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const day =
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, day };
}

/**
 * Build a ZIP archive from `[{name, data}]` (data: string or bytes).
 * `deflate` (raw DEFLATE, e.g. Node's zlib.deflateRawSync) compresses the
 * entries it makes smaller; without it every entry is stored.
 */
export function buildZip(files, date = new Date(), { deflate = null } = {}) {
  const { time, day } = dosDateTime(date);
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = toBytes(file.data);
    const crc = crc32(data);
    const packed =
      deflate && data.length > 256 ? new Uint8Array(deflate(data)) : null;
    const method = packed && packed.length < data.length ? 8 : 0;
    const body = method ? packed : data;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), name, body);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, method, true);
    entry.setUint16(12, time, true);
    entry.setUint16(14, day, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, body.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  return concat([...chunks, ...central, new Uint8Array(end.buffer)]);
}

function concat(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// ---------- XLSX ----------

const xmlEscape = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Control characters are not allowed in XML 1.0.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function columnName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

function sheetXml(rows) {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          const style = r === 0 ? ' s="1"' : '';
          if (value === null || value === undefined || value === '')
            return `<c r="${ref}"${style}/>`;
          if (typeof value === 'number' && Number.isFinite(value))
            return `<c r="${ref}"${style}><v>${value}</v></c>`;
          return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  const widths = (rows[0] || [])
    .map((_, c) => {
      const longest = Math.max(
        ...rows.map((row) => String(row[c] ?? '').length),
      );
      return `<col min="${c + 1}" max="${c + 1}" width="${Math.min(60, Math.max(10, longest + 2))}" customWidth="1"/>`;
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    (widths ? `<cols>${widths}</cols>` : '') +
    `<sheetData>${body}</sheetData></worksheet>`
  );
}

/**
 * A workbook from `[{name, rows}]`, where rows[0] is the header row. Numbers
 * stay numbers so the values can be charted or averaged in Excel.
 */
export function buildXlsx(sheets) {
  const safeName = (name, i) =>
    String(name || `Sheet${i + 1}`)
      .replace(/[\\/?*[\]:]/g, ' ')
      .slice(0, 31);
  const files = [
    {
      name: '[Content_Types].xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
          )
          .join('') +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets
          .map(
            (sheet, i) =>
              `<sheet name="${xmlEscape(safeName(sheet.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
          )
          .join('') +
        '</sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>',
    },
    {
      name: 'xl/styles.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
        '</styleSheet>',
    },
    ...sheets.map((sheet, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: sheetXml(sheet.rows),
    })),
  ];
  return buildZip(files);
}

// ---------- PDF ----------

// Helvetica advance widths (1/1000 em) for character codes 32-126.
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
];
// WinAnsi codes for the non-ASCII characters this app's text uses.
const WIN_ANSI = {
  '€': 0x80,
  '‚': 0x82,
  '„': 0x84,
  '…': 0x85,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '™': 0x99,
  '°': 0xb0,
  '±': 0xb1,
  '²': 0xb2,
  '³': 0xb3,
  µ: 0xb5,
  '·': 0xb7,
  '×': 0xd7,
  é: 0xe9,
  è: 0xe8,
  á: 0xe1,
  ó: 0xf3,
  ñ: 0xf1,
  ü: 0xfc,
  É: 0xc9,
};

/** Text width in points for Helvetica at `size` (bold is ~5% wider). */
export function pdfTextWidth(text, size, bold = false) {
  let units = 0;
  for (const char of String(text)) {
    const code = char.charCodeAt(0);
    units += code >= 32 && code <= 126 ? HELVETICA_WIDTHS[code - 32] : 556;
  }
  return (units / 1000) * size * (bold ? 1.05 : 1);
}

/** Break text into lines no wider than `width` points. */
export function pdfWrap(text, size, width, bold = false) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && pdfTextWidth(next, size, bold) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

function pdfString(text) {
  let out = '';
  for (const char of String(text)) {
    const code = char.charCodeAt(0);
    const byte = code < 128 ? code : (WIN_ANSI[char] ?? 0x3f);
    const c = String.fromCharCode(byte);
    out += c === '(' || c === ')' || c === '\\' ? `\\${c}` : c;
  }
  return `(${out})`;
}

const rgb = (hex) => {
  const value = parseInt(String(hex).replace('#', ''), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
    .map((c) => (c / 255).toFixed(3))
    .join(' ');
};

/**
 * A minimal PDF document (US Letter, points, origin top-left for callers).
 * Pages hold drawing ops; JPEG images are embedded as-is (DCTDecode).
 */
export class PdfDocument {
  constructor({ width = 612, height = 792, title = '' } = {}) {
    this.width = width;
    this.height = height;
    this.title = title;
    this.pages = [];
    this.images = [];
    this.addPage();
  }
  addPage() {
    this.page = { ops: [], images: new Set() };
    this.pages.push(this.page);
    return this;
  }
  text(
    x,
    y,
    text,
    { size = 11, bold = false, color = '#111111', align = 'left' } = {},
  ) {
    const width = pdfTextWidth(text, size, bold);
    const left =
      align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
    this.page.ops.push(
      `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${rgb(color)} rg ${left.toFixed(2)} ${(this.height - y).toFixed(2)} Td ${pdfString(text)} Tj ET`,
    );
    return this;
  }
  /** Wrapped paragraph; returns the y below it. */
  paragraph(x, y, text, width, { size = 11, leading = 1.35, ...style } = {}) {
    let line = y;
    for (const piece of pdfWrap(text, size, width, style.bold)) {
      this.text(x, line, piece, { size, ...style });
      line += size * leading;
    }
    return line;
  }
  rect(x, y, w, h, { fill = '#000000' } = {}) {
    this.page.ops.push(
      `${rgb(fill)} rg ${x.toFixed(2)} ${(this.height - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`,
    );
    return this;
  }
  line(x1, y1, x2, y2, { color = '#cccccc', width = 0.75 } = {}) {
    this.page.ops.push(
      `${rgb(color)} RG ${width} w ${x1.toFixed(2)} ${(this.height - y1).toFixed(2)} m ${x2.toFixed(2)} ${(this.height - y2).toFixed(2)} l S`,
    );
    return this;
  }
  /** Embed JPEG bytes (with their pixel size) and draw them in a box. */
  jpeg(bytes, pixelWidth, pixelHeight, x, y, w, h) {
    const image = { bytes: toBytes(bytes), pixelWidth, pixelHeight };
    this.images.push(image);
    const name = `Im${this.images.length}`;
    image.name = name;
    this.page.images.add(image);
    this.page.ops.push(
      `q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(this.height - y - h).toFixed(2)} cm /${name} Do Q`,
    );
    return this;
  }
  /** Serialize to bytes. */
  build() {
    const latin1 = (text) => {
      const out = new Uint8Array(text.length);
      for (let i = 0; i < text.length; i += 1)
        out[i] = text.charCodeAt(i) & 255;
      return out;
    };
    const objects = [];
    const add = (parts) => {
      objects.push(parts);
      return objects.length;
    };
    const catalog = add(null);
    const pagesId = add(null);
    const fontRegular = add([
      latin1(
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      ),
    ]);
    const fontBold = add([
      latin1(
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      ),
    ]);
    for (const image of this.images) {
      image.id = add([
        latin1(
          `<< /Type /XObject /Subtype /Image /Width ${image.pixelWidth} /Height ${image.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
        ),
        image.bytes,
        latin1('\nendstream'),
      ]);
    }
    const pageIds = [];
    for (const page of this.pages) {
      const content = latin1(page.ops.join('\n'));
      const contentId = add([
        latin1(`<< /Length ${content.length} >>\nstream\n`),
        content,
        latin1('\nendstream'),
      ]);
      const xobjects = [...page.images]
        .map((image) => `/${image.name} ${image.id} 0 R`)
        .join(' ');
      pageIds.push(
        add([
          latin1(
            `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.width} ${this.height}] ` +
              `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >>${xobjects ? ` /XObject << ${xobjects} >>` : ''} >> /Contents ${contentId} 0 R >>`,
          ),
        ]),
      );
    }
    objects[pagesId - 1] = [
      latin1(
        `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`,
      ),
    ];
    const info = add([
      latin1(
        `<< /Title ${pdfString(this.title)} /Producer (Husky Eye View) >>`,
      ),
    ]);
    objects[catalog - 1] = [
      latin1(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`),
    ];

    const chunks = [latin1('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n')];
    let offset = chunks[0].length;
    const offsets = [];
    objects.forEach((parts, index) => {
      offsets.push(offset);
      const head = latin1(`${index + 1} 0 obj\n`);
      const tail = latin1('\nendobj\n');
      for (const part of [head, ...parts, tail]) {
        chunks.push(part);
        offset += part.length;
      }
    });
    const xref =
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
      offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('') +
      `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
    chunks.push(latin1(xref));
    return concat(chunks);
  }
}
