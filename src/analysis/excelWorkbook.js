/**
 * A workbook writer for Excel Analysis and session data, without libraries:
 * cells with values or live formulas (array formulas too, for LINEST),
 * a few styles, frozen headers, column widths, and native Excel charts
 * (scatter with a trendline, column). Built on the ZIP writer the Curated
 * Flights downloads use. Excel recalculates every formula when it opens the
 * file; each formula also carries the value Husky Eye View computed, so
 * viewers that do not recalculate still show numbers.
 *
 * A sheet: {name, rows: [[cell]], widths?: [chars], freeze?: rows,
 *   charts?: [chart]}. A cell: null | number | string |
 *   {v, f?, array?: 'B5:D9', s?: style}. Styles: 'header', 'title',
 *   'bold', 'note', 'num' (0.0000), 'int' (#,##0).
 */
import { buildZip } from '../curated/curatedFiles.js';

const STYLE_IDS = { header: 1, title: 2, bold: 3, note: 4, num: 5, int: 6 };

export const xmlEscape = (value) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

/** 0 → "A", 26 → "AA". */
export function columnLetter(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** A sheet name as formulas need it: 'Model 1' quoted, Data bare. */
export const sheetRef = (name) =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
    ? name
    : `'${String(name).replace(/'/g, "''")}'`;

/** An absolute range: Data!$J$2:$J$1601 (rows and columns 0-based). */
export function rangeRef(sheet, col, row, toCol = col, toRow = row) {
  const one = (c, r) => `$${columnLetter(c)}$${r + 1}`;
  return `${sheetRef(sheet)}!${one(col, row)}${toCol === col && toRow === row ? '' : `:${one(toCol, toRow)}`}`;
}

/** Excel's 31-character sheet names, without the characters it forbids. */
export const safeSheetName = (name, i = 0) =>
  String(name || `Sheet${i + 1}`)
    .replace(/[\\/?*[\]:]/g, ' ')
    .slice(0, 31);

const number = (v) =>
  typeof v === 'number' && Number.isFinite(v) ? String(v) : null;

// Functions added after Excel 2007 are stored as _xlfn.NAME, or Excel shows
// #NAME? (checked in Excel 16).
const NEWER_FUNCTIONS =
  /(?<![\w.])(STDEV\.S|STDEV\.P|VAR\.S|VAR\.P|PERCENTILE\.INC|PERCENTILE\.EXC|QUARTILE\.INC|QUARTILE\.EXC|RANK\.EQ|RANK\.AVG|MODE\.SNGL|NORM\.S\.DIST|NORM\.DIST|NORM\.S\.INV|T\.DIST\.2T|T\.DIST\.RT|T\.INV\.2T|F\.DIST\.RT|CHISQ\.DIST\.RT|CONCAT|TEXTJOIN|IFS|MAXIFS|MINIFS|SWITCH)\(/g;

/** A formula as the file stores it. */
export const storedFormula = (f) =>
  String(f).replace(NEWER_FUNCTIONS, '_xlfn.$1(');

function cellXml(cell, ref) {
  if (cell === null || cell === undefined || cell === '') return '';
  const spec = typeof cell === 'object' ? cell : { v: cell };
  const style = spec.s ? ` s="${STYLE_IDS[spec.s] || 0}"` : '';
  const formula = spec.f
    ? spec.array
      ? `<f t="array" ref="${spec.array}">${xmlEscape(storedFormula(spec.f))}</f>`
      : `<f>${xmlEscape(storedFormula(spec.f))}</f>`
    : '';
  const v = spec.v;
  if (
    v === null ||
    v === undefined ||
    (typeof v === 'number' && !Number.isFinite(v))
  )
    return formula
      ? `<c r="${ref}"${style}>${formula}</c>`
      : style
        ? `<c r="${ref}"${style}/>`
        : '';
  if (typeof v === 'number')
    return `<c r="${ref}"${style}>${formula}<v>${number(v)}</v></c>`;
  if (typeof v === 'boolean')
    return `<c r="${ref}"${style} t="b">${formula}<v>${v ? 1 : 0}</v></c>`;
  if (formula)
    return `<c r="${ref}"${style} t="str">${formula}<v>${xmlEscape(v)}</v></c>`;
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
}

function sheetXml(sheet, drawingRel) {
  const rows = sheet.rows || [];
  const body = rows
    .map((row, r) => {
      const cells = (row || [])
        .map((cell, c) => cellXml(cell, `${columnLetter(c)}${r + 1}`))
        .join('');
      return cells ? `<row r="${r + 1}">${cells}</row>` : '';
    })
    .join('');
  const width = Math.max(0, ...rows.map((row) => row?.length || 0));
  const widths = Array.from({ length: width }, (_, c) => {
    const given = sheet.widths?.[c];
    const longest = Math.max(
      0,
      ...rows.slice(0, 500).map((row) => {
        const cell = row?.[c];
        const v = cell && typeof cell === 'object' ? cell.v : cell;
        return typeof v === 'number'
          ? Math.min(12, String(v).length)
          : String(v ?? '').length;
      }),
    );
    const w = given ?? Math.min(48, Math.max(9, longest + 2));
    return `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>`;
  }).join('');
  const freeze = sheet.freeze
    ? `<pane ySplit="${sheet.freeze}" topLeftCell="A${sheet.freeze + 1}" activePane="bottomLeft" state="frozen"/>`
    : '';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheetViews><sheetView workbookViewId="0">${freeze}</sheetView></sheetViews>` +
    (widths ? `<cols>${widths}</cols>` : '') +
    `<sheetData>${body}</sheetData>` +
    (drawingRel ? `<drawing r:id="${drawingRel}"/>` : '') +
    '</worksheet>'
  );
}

// ---------- charts ----------

const C_NS =
  'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const richText = (text, size = 1200, bold = true) =>
  `<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}" b="${bold ? 1 : 0}"/></a:pPr><a:r><a:rPr lang="en-US" sz="${size}" b="${bold ? 1 : 0}"/><a:t>${xmlEscape(text)}</a:t></a:r></a:p></c:rich></c:tx>`;

const chartTitle = (text, size) =>
  text ? `<c:title>${richText(text, size)}<c:overlay val="0"/></c:title>` : '';

const numRef = (ref, values) =>
  `<c:numRef><c:f>${xmlEscape(ref)}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${values.length}"/>${values
    .map((v, i) =>
      Number.isFinite(v) ? `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>` : '',
    )
    .join('')}</c:numCache></c:numRef>`;

const strRef = (ref, values) =>
  `<c:strRef><c:f>${xmlEscape(ref)}</c:f><c:strCache><c:ptCount val="${values.length}"/>${values
    .map((v, i) => `<c:pt idx="${i}"><c:v>${xmlEscape(v)}</c:v></c:pt>`)
    .join('')}</c:strCache></c:strRef>`;

const RED = 'C8102E';

function valueAxis(id, cross, position, title, between = 'midCat') {
  return (
    `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${position}"/>` +
    `<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="D9D9D9"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>` +
    (title
      ? `<c:title>${richText(title, 1000, false)}<c:overlay val="0"/></c:title>`
      : '') +
    '<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>' +
    `<c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:crossBetween val="${between}"/></c:valAx>`
  );
}

/** A chart part: scatter (with a linear trendline) or column. */
export function chartXml(chart) {
  let plot;
  if (chart.type === 'scatter') {
    const s = chart.series;
    plot =
      '<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>' +
      `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${xmlEscape(s.name || '')}</c:v></c:tx>` +
      '<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr>' +
      `<c:marker><c:symbol val="circle"/><c:size val="4"/><c:spPr><a:solidFill><a:srgbClr val="${RED}"><a:alpha val="60000"/></a:srgbClr></a:solidFill><a:ln w="3175"><a:noFill/></a:ln></c:spPr></c:marker>` +
      (chart.trendline
        ? '<c:trendline><c:spPr><a:ln w="19050"><a:solidFill><a:srgbClr val="1F1F1F"/></a:solidFill><a:prstDash val="dash"/></a:ln></c:spPr><c:trendlineType val="linear"/><c:dispRSqr val="1"/><c:dispEq val="1"/><c:trendlineLbl><c:numFmt formatCode="General" sourceLinked="0"/></c:trendlineLbl></c:trendline>'
        : '') +
      `<c:xVal>${numRef(s.xRef, s.x)}</c:xVal><c:yVal>${numRef(s.yRef, s.y)}</c:yVal><c:smooth val="0"/></c:ser>` +
      '<c:axId val="5001"/><c:axId val="5002"/></c:scatterChart>' +
      valueAxis(5001, 5002, 'b', chart.xTitle) +
      valueAxis(5002, 5001, 'l', chart.yTitle);
  } else {
    const s = chart.series;
    plot =
      '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>' +
      `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:v>${xmlEscape(s.name || '')}</c:v></c:tx>` +
      `<c:spPr><a:solidFill><a:srgbClr val="${RED}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>` +
      `<c:cat>${strRef(s.catRef, s.categories)}</c:cat><c:val>${numRef(s.valRef, s.values)}</c:val></c:ser>` +
      '<c:gapWidth val="15"/><c:axId val="6001"/><c:axId val="6002"/></c:barChart>' +
      '<c:catAx><c:axId val="6001"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/>' +
      (chart.xTitle
        ? `<c:title>${richText(chart.xTitle, 1000, false)}<c:overlay val="0"/></c:title>`
        : '') +
      '<c:numFmt formatCode="General" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="6002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>' +
      valueAxis(6002, 6001, 'l', chart.yTitle, 'between');
  }
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<c:chartSpace ${C_NS}><c:roundedCorners val="0"/><c:chart>` +
    chartTitle(chart.title, 1300) +
    `<c:autoTitleDeleted val="${chart.title ? 0 : 1}"/><c:plotArea><c:layout/>${plot}</c:plotArea>` +
    '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>'
  );
}

function drawingXml(charts) {
  const anchors = charts
    .map((chart, i) => {
      const { col, row, cols = 8, rows = 18 } = chart.at;
      return (
        '<xdr:twoCellAnchor editAs="oneCell">' +
        `<xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
        `<xdr:to><xdr:col>${col + cols}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row + rows}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>` +
        `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Chart ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
        '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
        `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${i + 1}"/></a:graphicData></a:graphic>` +
        '</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>'
      );
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
    anchors +
    '</xdr:wsDr>'
  );
}

const rels = (items) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  items
    .map(
      ([id, type, target]) =>
        `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`,
    )
    .join('') +
  '</Relationships>';

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0000"/></numFmts>' +
  '<fonts count="5"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
  '<font><i/><sz val="10"/><color rgb="FF595959"/><name val="Calibri"/><family val="2"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FF1F1F1F"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

/**
 * The workbook's bytes (an .xlsx file). `deflate` (raw DEFLATE, such as
 * Node's zlib.deflateRawSync) keeps large data sheets small.
 */
export function buildWorkbook(sheets, { title = '', deflate = null } = {}) {
  const files = [];
  const overrides = [
    [
      '/xl/workbook.xml',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
    ],
    [
      '/xl/styles.xml',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml',
    ],
    [
      '/docProps/core.xml',
      'application/vnd.openxmlformats-package.core-properties+xml',
    ],
  ];
  let chartCount = 0;
  let drawingCount = 0;
  sheets.forEach((sheet, i) => {
    const n = i + 1;
    overrides.push([
      `/xl/worksheets/sheet${n}.xml`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml',
    ]);
    let drawingRel = null;
    if (sheet.charts?.length) {
      drawingCount += 1;
      const d = drawingCount;
      drawingRel = 'rId1';
      files.push({
        name: `xl/worksheets/_rels/sheet${n}.xml.rels`,
        data: rels([['rId1', 'drawing', `../drawings/drawing${d}.xml`]]),
      });
      files.push({
        name: `xl/drawings/drawing${d}.xml`,
        data: drawingXml(sheet.charts),
      });
      overrides.push([
        `/xl/drawings/drawing${d}.xml`,
        'application/vnd.openxmlformats-officedocument.drawing+xml',
      ]);
      const chartRels = [];
      sheet.charts.forEach((chart, k) => {
        chartCount += 1;
        files.push({
          name: `xl/charts/chart${chartCount}.xml`,
          data: chartXml(chart),
        });
        overrides.push([
          `/xl/charts/chart${chartCount}.xml`,
          'application/vnd.openxmlformats-officedocument.drawingml.chart+xml',
        ]);
        chartRels.push([
          `rId${k + 1}`,
          'chart',
          `../charts/chart${chartCount}.xml`,
        ]);
      });
      files.push({
        name: `xl/drawings/_rels/drawing${d}.xml.rels`,
        data: rels(chartRels),
      });
    }
    files.push({
      name: `xl/worksheets/sheet${n}.xml`,
      data: sheetXml(sheet, drawingRel),
    });
  });
  const names = sheets.map((sheet, i) => safeSheetName(sheet.name, i));
  files.unshift(
    {
      name: '[Content_Types].xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        overrides
          .map(
            ([part, type]) =>
              `<Override PartName="${part}" ContentType="${type}"/>`,
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
        // Core properties live in the package namespace, not officeDocument's.
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'docProps/core.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
        `<dc:title>${xmlEscape(title)}</dc:title><dc:creator>Husky Eye View</dc:creator>` +
        '</cp:coreProperties>',
    },
    {
      name: 'xl/workbook.xml',
      data:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<bookViews><workbookView/></bookViews><sheets>' +
        names
          .map(
            (name, i) =>
              `<sheet name="${xmlEscape(name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
          )
          .join('') +
        // Excel recomputes every formula when the file opens.
        '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: rels([
        ...names.map((_, i) => [
          `rId${i + 1}`,
          'worksheet',
          `worksheets/sheet${i + 1}.xml`,
        ]),
        [`rId${names.length + 1}`, 'styles', 'styles.xml'],
      ]),
    },
    { name: 'xl/styles.xml', data: STYLES },
  );
  return buildZip(files, new Date(), { deflate });
}
