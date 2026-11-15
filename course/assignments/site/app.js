'use strict';
// Community context site. Plain JavaScript, no libraries. Reads data/cities.json and data/groups.json.

const PERIODS = ['2000', '2006_10', '2020_24'];
const PERIOD_LABEL = { '2000': '2000 Census', '2006_10': '2006-2010 survey', '2020_24': '2020-2024 survey' };
const GIVEN = ['population', 'foreign_born_percent']; // always shown
const MENU = ['poverty_percent', 'unemployment_percent', 'median_household_income', 'bachelors_percent', 'renter_percent', 'black_percent', 'hispanic_percent']; // the student chooses three
// Part 3: the three crime rates (reported crimes per 100,000 residents, FBI), no choice.
const CRIME = ['overall_crime_rate', 'violent_crime_rate', 'property_crime_rate'];
const VARIABLES = [...GIVEN, ...MENU, ...CRIME];
const COUNTS = ['population', 'median_household_income']; // whole numbers, shown with thousands separators
const TOP = 50;
// National values the course provides. The student types the others.
const national = {
  population: { '2000': '281421906', '2006_10': '303965272', '2020_24': '334922499' }, // 50 states and DC, same tables as the city data
  foreign_born_percent: { '2000': '11.1', '2006_10': '12.7', '2020_24': '14.1' },
};
for (const v of [...MENU, ...CRIME]) national[v] = { '2000': '', '2006_10': '', '2020_24': '' };

// Median household income is in each period's own dollars (1999, 2010, 2024). The switch on
// Start here restates 2000 and 2006-2010 in 2024 dollars with the annual consumer price index
// (CPI-U, U.S. city average, BLS: 1999 = 166.575, 2010 = 218.056, 2024 = 313.689).
const CPI = { '2000': 166.575, '2006_10': 218.056, '2020_24': 313.689 };
const factor = (p) => ($('real') && $('real').checked ? CPI['2020_24'] / CPI[p] : 1);
const isMoney = (v) => v === 'median_household_income';
function values(p, v) {
  const raw = cities.values[p][v] || cities.code.map(() => null); // crime rates are empty until Part 3 opens
  return isMoney(v) && factor(p) !== 1 ? raw.map((x) => (x === null ? null : Math.round(x * factor(p)))) : raw;
}

let cities, groups;
const $ = (id) => document.getElementById(id);

// ---- when each part is open: data/schedule.json (you edit this one file; see the README) ----
// Each part has opens, closes (both optional, ISO date and time with the Boston offset) and locked (true = closed now).
// The page asks the web server for the time (its Date header), so changing the computer's clock does not open a
// part early, and it re-reads the schedule every minute, so a lock takes effect while students have the page open.
let clockOffset = 0, schedule = {};
const nowMs = () => Date.now() + clockOffset;
const fmtTime = (iso) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' Eastern time';
function partState(part) {
  const s = schedule['part' + part] || {};
  const name = 'Part ' + part;
  if (s.locked) return { open: false, text: s.message || name + ' is closed for now. Your instructor will tell you when it opens.' };
  if (s.opens && nowMs() < Date.parse(s.opens)) return { open: false, text: name + ' opens ' + fmtTime(s.opens) + '.' };
  if (s.closes && nowMs() >= Date.parse(s.closes)) return { open: false, text: name + ' closed ' + fmtTime(s.closes) + '.' };
  return { open: true, text: '' };
}
const partOpen = (part) => partState(part).open;
async function loadSchedule() {
  try {
    // the time in the address gets past GitHub's 10-minute cache, so a change reaches students quickly
    const r = await fetch('data/schedule.json?t=' + Date.now(), { cache: 'no-store' });
    if (r.ok) schedule = await r.json();
    const d = Date.parse(r.headers.get('date') || '');
    if (Number.isFinite(d)) clockOffset = d - Date.now();
  } catch (x) { /* no schedule file: everything is open */ }
}
function partLabels() {
  const base = { 2: 'Part 2: living conditions (you choose three indicators)', 3: 'Part 3: crime (the three crime rates)' };
  [2, 3].forEach((n) => { $('part').options[n - 2].textContent = base[n] + (partOpen(String(n)) ? '' : ' (closed)'); });
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const int = (n) => Math.round(n).toLocaleString('en-US');
const dec = (n, d = 1) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const cell = (v) => (v === null || v === undefined ? '' : Number.isInteger(v) ? int(v) : dec(v, 2));

let current = null; // what is on screen: { group, rankBy, vars, rows }

// ---- the student's Northeastern email: typed, kept in this browser only, never sent anywhere ----
// It seeds her random draws and goes into her completion record (gates.js); it is not checked here.
let studentEmail = '';
const emailOk = (e) => /^[^@\s]+@(northeastern\.edu|husky\.neu\.edu)$/i.test(e);
function saveEmail() {
  const e = $('email').value.trim().toLowerCase();
  if (!emailOk(e)) { $('emailmsg').textContent = 'Use your Northeastern email (it ends in @northeastern.edu).'; return; }
  studentEmail = e;
  try { localStorage.setItem('hev-email-v1', e); } catch (x) { /* works for this visit */ }
  $('email').value = e;
  $('emailmsg').textContent = 'Saved. If you change it later, your questions start over.';
  applyAssignment();
  showHow();
  render();
  // After the email, the next thing she sees is the video and the instructions.
  showTab('how');
  window.scrollTo(0, 0);
}
// The video and the instructions open once the email is saved (they are part of the tool, not a
// separate handout). The text comes from data/instructions.html, built from STUDENT-INSTRUCTIONS.md.
let instructionsLoaded = false;
async function showHow() {
  const ok = emailOk(studentEmail);
  $('howneed').hidden = ok;
  $('howhave').hidden = !ok;
  if (!ok || instructionsLoaded) return;
  instructionsLoaded = true;
  try {
    // The two handouts (the assignment, then getting and checking the data) come first.
    $('handouts').innerHTML = await fetch('data/handouts.html').then((r) => r.text());
    $('instructions').innerHTML = await fetch('data/instructions.html').then((r) => r.text());
  } catch (x) {
    instructionsLoaded = false;
    $('instructions').innerHTML = '<p class="err">The instructions did not load. Reload the page.</p>';
  }
}

// With ASSIGN_GROUP (gates.js) the group is fixed by the email.
function applyAssignment() {
  if (typeof ASSIGN_GROUP === 'undefined' || !ASSIGN_GROUP || !emailOk(studentEmail) || !groups) return;
  $('group').value = String(seedOf(studentEmail) % groups.names.length);
  $('group').disabled = true;
}

function fill(select, items, selected) {
  select.innerHTML = items.map(([value, label]) => `<option value="${esc(value)}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`).join('');
}

// The tool needs a computer (wide tables, typing look-ups next to a second window). On a phone it
// shows a reminder and does not load. Tablets and computers are let through. A nudge only: a phone
// set to "desktop site" gets past it.
function isPhone() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPod|Windows Phone|Android.+Mobile|Mobile.+Firefox|BlackBerry|Opera Mini/i.test(ua)) return true;
  const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  return coarse && Math.min(screen.width, screen.height) < 600;
}
function phoneStop() {
  document.querySelector('main').innerHTML =
    '<h1>Immigration and Crime: Community Context</h1>' +
    '<div class="panel" id="phonestop"><h2>Please use a computer</h2>' +
    '<p>This tool will not work on a smartphone. Its tables are wide, and the look-ups ask you to work with a second window open.</p>' +
    '<p>Open this same link on a laptop or desktop computer, with Chrome, Edge, Firefox or Safari.</p></div>';
}

async function start() {
  if (isPhone()) { phoneStop(); return; }
  try {
    [cities, groups] = await Promise.all(['data/cities.json', 'data/groups.json'].map((f) =>
      fetch(f).then((r) => { if (!r.ok) throw new Error(`${f}: ${r.status}`); return r.json(); })));
  } catch (e) {
    $('group').innerHTML = '<option>Could not load the data</option>';
    $('problem').textContent = 'The data files did not load (' + e.message + '). Open this page from a web server, not by double-clicking the file. See README.md.';
    return;
  }
  // National values for the menu indicators (computed from the Census Bureau's U.S.-level tables); optional.
  try {
    const n = await fetch('data/national.json').then((r) => (r.ok ? r.json() : null));
    if (n) for (const p of PERIODS) for (const v of MENU) if (n[p] && n[p][v] !== undefined) national[v][p] = v.endsWith('_percent') ? Number(n[p][v]).toFixed(1) : String(n[p][v]);
  } catch (e) { /* the student can type them */ }
  const order = groups.names.map((n, i) => [n, i]).sort((a, b) => a[0].localeCompare(b[0]));
  fill($('group'), [['', 'Choose a group...'], ...order.map(([n, i]) => [String(i), n])], '');
  fill($('rank'), PERIODS.map((p) => [p, PERIOD_LABEL[p]]), '2020_24');
  // Variables 1 and 2 are given; the student chooses variable 3.
  fill($('v1'), [['population', 'population']], 'population');
  fill($('v2'), [['foreign_born_percent', 'foreign_born_percent']], 'foreign_born_percent');
  $('v1').disabled = $('v2').disabled = true;
  // No indicator is pre-selected: each student has to choose her own three.
  try { const saved = localStorage.getItem('hev-email-v1'); if (saved && emailOk(saved)) { studentEmail = saved; $('email').value = saved; } } catch (e) { /* no saved email */ }
  $('emailsave').addEventListener('click', saveEmail);
  $('email').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveEmail(); });
  await loadSchedule();
  partLabels();
  setInterval(async () => { const before = JSON.stringify([partOpen('2'), partOpen('3')]); await loadSchedule(); partLabels(); if (JSON.stringify([partOpen('2'), partOpen('3')]) !== before) render(); }, 60000);
  applyAssignment();
  showHow();
  setPart();
  $('part').addEventListener('change', () => { setPart(); render(); });
  ['group', 'rank', 'v1', 'v2', 'v3', 'v4', 'v5'].forEach((id) => $(id).addEventListener('change', render));
  $('csv').addEventListener('click', downloadCsv);
  $('real').addEventListener('change', render);
  document.querySelectorAll('nav.tabs button[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('howdone').addEventListener('click', () => { showTab('start'); window.scrollTo(0, 0); });
  // A link ending in #how (the one in the posted instructions) opens the Video and instructions tab.
  if (location.hash === '#how') showTab('how');
  $('savenotes').addEventListener('click', saveNotes);
  $('figgo').addEventListener('click', downloadFigure);
  ['figvar', 'fignat'].forEach((id) => $(id).addEventListener('change', () => { $('figtitle').value = figDefaultTitle(); }));
  $('calclink').addEventListener('click', (e) => {
    e.preventDefault();
    const box = $('calcsummary');
    box.hidden = !box.hidden;
    $('calclink').setAttribute('aria-expanded', String(!box.hidden));
  });
  render();
}

// The 50 cities with the largest group, by the chosen period. Ties: lower city code first.
function topCities(g, rankBy) {
  const size = groups.size[rankBy][g];
  const idx = cities.code.map((_, i) => i);
  idx.sort((a, b) => size[b] - size[a] || (cities.code[a] < cities.code[b] ? -1 : 1));
  return idx.slice(0, TOP);
}

// Part 2: the student chooses three indicators (boxes start blank). Part 3: the three crime rates are given.
function setPart() {
  const crime = $('part').value === '3';
  ['v3', 'v4', 'v5'].forEach((id, k) => {
    if (crime) fill($(id), [[CRIME[k], CRIME[k]]], CRIME[k]);
    else fill($(id), [['', ''], ...MENU.map((v) => [v, v])], '');
    $(id).disabled = crime;
  });
  $('crimenote').hidden = !crime;
  document.querySelectorAll('.crimegap').forEach((e) => (e.hidden = !crime));
}

function render() {
  const gv = $('group').value;
  const vars = [$('v3').value, $('v4').value, $('v5').value]; // the three chosen
  const shown = [...GIVEN, ...vars];
  const picked = vars.filter((v) => v !== '');
  $('problem').textContent = new Set(picked).size < picked.length ? 'Choose three different indicators.' : '';
  const ps = partState($('part').value);
  const chosen = ps.open && emailOk(studentEmail) && gv !== '' && picked.length === 3 && new Set(picked).size === 3;
  const needText = !ps.open ? ps.text + ' The results appear here when it is open.' : !emailOk(studentEmail) ? 'Enter your Northeastern email on the <b>Start here</b> tab first.' : 'Choose your group and your three indicators on the <b>Start here</b> tab first.';
  document.querySelectorAll('.need').forEach((e) => (e.innerHTML = needText));
  document.querySelectorAll('.need').forEach((e) => (e.hidden = chosen));
  document.querySelectorAll('.have').forEach((e) => (e.hidden = !chosen));
  if (!chosen) { current = null; drawData(); if (typeof gatesRender === 'function') gatesRender(); return; }
  const g = Number(gv);
  const rankBy = $('rank').value;
  const rows = topCities(g, rankBy);
  current = { g, rankBy, vars, shown, rows };
  $('title-top').textContent = `${groups.names[g]}: the ${TOP} cities where the group is largest (ranked by ${PERIOD_LABEL[rankBy]})`;
  $('title-weighted').textContent = `Weighted averages for ${groups.names[g]} (top ${TOP} cities, ranked by ${PERIOD_LABEL[rankBy]})`;
  if (typeof gatesPrepare === 'function') gatesPrepare();
  drawTop();
  drawNational();
  drawCalcs();
  drawCoverage();
  drawData();
  if (typeof gatesRender === 'function') gatesRender();
}

// ---- tabs ----
function showTab(name) {
  document.querySelectorAll('nav.tabs button[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('section.tab').forEach((s) => (s.hidden = s.id !== 'tab-' + name));
}

// ---- Data tab: every city, sortable ----
let dataSort = { col: 0, dir: 1 };
function dataColumns() {
  const cols = [
    { name: 'city_code', get: (i) => cities.code[i], text: true },
    { name: 'city', get: (i) => cities.city[i], text: true },
    { name: 'state', get: (i) => cities.state[i], text: true },
  ];
  PERIODS.forEach((p) => cols.push({ name: `group_size_${p}`, get: (i) => ($('group').value !== '' ? groups.size[p][Number($('group').value)][i] : null) }));
  // a part's columns appear only while that part is open (Part 2: the Census indicators, Part 3: the crime rates)
  VARIABLES.filter((v) => partOpen(CRIME.includes(v) ? '3' : '2')).forEach((v) => PERIODS.forEach((p) => cols.push({ name: `${v}_${p}`, get: (i) => values(p, v)[i], v, p })));
  return cols;
}
function drawData() {
  if (!cities) return;
  const cols = dataColumns();
  const idx = cities.code.map((_, i) => i);
  const c = cols[dataSort.col];
  idx.sort((a, b) => {
    const x = c.get(a), y = c.get(b);
    if (x === null || x === undefined) return 1;
    if (y === null || y === undefined) return -1;
    const r = c.text ? String(x).localeCompare(String(y)) : x - y;
    return r * dataSort.dir || (cities.code[a] < cities.code[b] ? -1 : 1);
  });
  const arrow = (k) => (k === dataSort.col ? (dataSort.dir > 0 ? ' ▲' : ' ▼') : '');
  let h = '<thead><tr>' + cols.map((x, k) => `<th class="${x.text ? 'l' : ''}" data-col="${k}">${esc(x.name)}${arrow(k)}</th>`).join('') + '</tr></thead><tbody>';
  for (const i of idx) h += '<tr>' + cols.map((x) => `<td class="${x.text ? 'l' : ''}">${x.text ? esc(x.get(i)) : x.v && typeof shownCell === 'function' ? shownCell(i, x.v, x.p) : cell(x.get(i))}</td>`).join('') + '</tr>';
  $('data').innerHTML = h + '</tbody>';
  $('data').querySelectorAll('th').forEach((th) => th.addEventListener('click', () => {
    const k = Number(th.dataset.col);
    dataSort = { col: k, dir: k === dataSort.col ? -dataSort.dir : (cols[k].text ? 1 : -1) };
    drawData();
  }));
}

function drawTop() {
  const { g, shown: vars, rows } = current;
  let h = '<thead><tr><th class="l" rowspan="2">rank</th><th class="l" rowspan="2">city</th><th class="l" rowspan="2">state</th><th class="l" rowspan="2">city_code</th>';
  h += '<th colspan="3">group size (people born in the group\'s country)</th>';
  vars.forEach((v) => (h += `<th colspan="3">${esc(v)}</th>`));
  h += '</tr><tr>' + [...Array(1 + vars.length)].map(() => PERIODS.map((p) => `<th>${PERIOD_LABEL[p]}</th>`).join('')).join('') + '</tr></thead><tbody>';
  rows.forEach((i, k) => {
    h += `<tr><td class="l">${k + 1}</td><td class="l">${esc(cities.city[i])}</td><td class="l">${esc(cities.state[i])}</td><td class="l">${esc(cities.code[i])}</td>`;
    PERIODS.forEach((p) => (h += `<td>${int(groups.size[p][g][i])}</td>`));
    vars.forEach((v) => PERIODS.forEach((p) => (h += `<td>${typeof shownCell === 'function' ? shownCell(i, v, p) : cell(values(p, v)[i])}</td>`)));
    h += '</tr>';
  });
  $('top').innerHTML = h + '</tbody>';
}

// National values are typed as text (a number box changes when the mouse wheel passes over it).
function natNumber(v, p) {
  const s = national[v] ? String(national[v][p]).trim() : '';
  if (s === '' || !Number.isFinite(Number(s))) return null;
  return isMoney(v) && factor(p) !== 1 ? Math.round(Number(s) * factor(p)) : Number(s);
}
function natText(v, p) {
  const s = String(national[v][p]);
  return COUNTS.includes(v) && natNumber(v, p) !== null ? int(natNumber(v, p)) : s;
}

function drawNational() {
  const t = $('national');
  let h = '<thead><tr><th class="l">variable</th>' + PERIODS.map((p) => `<th>${PERIOD_LABEL[p]}</th>`).join('') + '</tr></thead><tbody>';
  current.shown.forEach((v) => {
    h += `<tr><td class="l">${v}</td>` + PERIODS.map((p) => `<td><input type="text" inputmode="decimal" autocomplete="off" aria-label="${v} ${PERIOD_LABEL[p]}" data-v="${v}" data-p="${p}" value="${esc(natText(v, p))}"></td>`).join('') + '</tr>';
  });
  t.innerHTML = h + '</tbody>';
  t.querySelectorAll('input').forEach((el) => el.addEventListener('input', () => {
    const typed = el.value.replace(/[,\s]/g, '');
    const f = isMoney(el.dataset.v) ? factor(el.dataset.p) : 1; // stored in the period's own dollars
    national[el.dataset.v][el.dataset.p] = typed !== '' && Number.isFinite(Number(typed)) && f !== 1 ? String(Number(typed) / f) : typed;
    drawCalcs();
  }));
}

// Weighted average pieces for one variable and period.
function calc(v, p) {
  const { g, rows } = current;
  const weight = groups.size[p][g];
  const value = values(p, v);
  let sumW = 0, sumWV = 0, sumV = 0, n = 0;
  for (const i of rows) {
    if (value[i] === null || value[i] === undefined) continue; // no value: left out
    sumW += weight[i]; sumWV += weight[i] * value[i]; sumV += value[i]; n++;
  }
  return { sumW, sumWV, n, weighted: sumW > 0 ? sumWV / sumW : null, plain: n > 0 ? sumV / n : null };
}

// The final weighted averages, laid out like the national values table (variable by period).
function drawResults() {
  const fmt = (v, x) => (x === null ? '' : COUNTS.includes(v) || isMoney(v) ? int(x) : dec(x));
  // No variable column: this table sits right beside the national values table and its rows line up with it.
  let h = '<thead><tr>' + PERIODS.map((p) => `<th>${PERIOD_LABEL[p]}</th>`).join('') + '</tr></thead><tbody>';
  current.shown.forEach((v) => {
    h += '<tr>' + PERIODS.map((p) => `<td><input type="text" readonly tabindex="-1" aria-label="weighted average ${v} ${PERIOD_LABEL[p]}" value="${esc(fmt(v, calc(v, p).weighted))}"></td>`).join('') + '</tr>';
  });
  $('results').innerHTML = h + '</tbody>';
}

function drawCalcs() {
  if (!current) return;
  drawResults();
  drawFigPanel();
  let h = '';
  current.vars.forEach((v) => {
    const res = PERIODS.map((p) => calc(v, p));
    const nat = PERIODS.map((p) => (natNumber(v, p)));
    const row = (label, f, cls = '') => `<tr class="${cls}"><td class="l">${label}</td>` + PERIODS.map((p, k) => `<td>${f(res[k], k)}</td>`).join('') + '</tr>';
    h += `<h3>${esc(v)}</h3><div class="tablewrap" style="max-width:760px"><table class="calc"><thead><tr><th class="l"></th>` +
      PERIODS.map((p) => `<th>${PERIOD_LABEL[p]}</th>`).join('') + '</tr></thead><tbody>' +
      row('Number of cities with a value', (r) => r.n) +
      row('Sum of the group sizes (the weights)', (r) => int(r.sumW)) +
      row('Sum of (group size x value)', (r) => int(r.sumWV)) +
      row('Weighted average = sum of (group size x value) / sum of the group sizes', (r) => (r.weighted === null ? 'no group residents' : dec(r.weighted)), 'key') +
      row('Plain average of the cities', (r) => (r.plain === null ? '' : dec(r.plain))) +
      row('National value', (r, k) => (nat[k] === null ? '<span class="muted">type it in Step 1</span>' : COUNTS.includes(v) ? int(nat[k]) : String(nat[k]))) +
      row('Weighted average minus plain average', (r) => (r.weighted === null || r.plain === null ? '' : dec(r.weighted - r.plain))) +
      '</tbody></table></div>';
  });
  $('calcs').innerHTML = h;
}

// ---- Make a figure: one indicator's weighted averages, optionally beside the national values ----
const figLabel = (v) => v.replace(/_/g, ' ');
const figFmt = (v, x) => (x === null || x === undefined ? '' : isMoney(v) ? '$' + int(x) : COUNTS.includes(v) ? int(x) : v.endsWith('_percent') ? dec(x) + '%' : dec(x));
function figDefaultTitle() {
  const v = $('figvar').value;
  const dollars = isMoney(v) && $('real').checked ? ' (2024 dollars)' : '';
  return `${figLabel(v)}${dollars} in the cities where people born in ${groups.names[current.g]} live${$('fignat').checked ? ', compared with the nation' : ''}: 2000, 2006-2010 and 2020-2024`;
}
function drawFigPanel() {
  const sel = $('figvar');
  const keep = sel.value;
  sel.innerHTML = current.vars.map((v) => `<option value="${esc(v)}">${esc(figLabel(v))}</option>`).join('');
  if (current.vars.includes(keep)) sel.value = keep;
  $('figtitle').value = figDefaultTitle();
}
function figRows() {
  const v = $('figvar').value;
  return PERIODS.map((p) => ({ label: PERIOD_LABEL[p], weighted: calc(v, p).weighted, national: natNumber(v, p) }));
}
function figCanvas() {
  const v = $('figvar').value;
  const withNat = $('fignat').checked;
  const data = figRows();
  const W = 1000, H = 620, L = 100, R = 30, T = 120, B = 110;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
  x.fillStyle = '#111'; x.textBaseline = 'alphabetic';
  // title, wrapped
  x.font = 'bold 22px Arial, sans-serif';
  const words = $('figtitle').value.split(/\s+/); let line = '', y = 34;
  for (const w of words) {
    if (x.measureText(line + w).width > W - 60 && line) { x.fillText(line.trim(), 30, y); y += 28; line = ''; }
    line += w + ' ';
  }
  x.fillText(line.trim(), 30, y);
  // scale
  const vals = data.flatMap((d) => [d.weighted, withNat ? d.national : null]).filter((n) => n !== null && n !== undefined);
  const max = Math.max(...vals, 1);
  const raw = max / 5, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) * mag;
  const top = Math.ceil(max / step) * step;
  const ph = H - T - B, pw = W - L - R;
  const yOf = (n) => T + ph - (n / top) * ph;
  x.font = '14px Arial, sans-serif'; x.textAlign = 'right'; x.strokeStyle = '#ddd'; x.lineWidth = 1;
  for (let t = 0; t <= top + 1e-9; t += step) {
    x.beginPath(); x.moveTo(L, yOf(t)); x.lineTo(W - R, yOf(t)); x.stroke();
    x.fillStyle = '#444'; x.fillText(figFmt(v, t).replace(/\.0%$/, '%'), L - 8, yOf(t) + 5);
  }
  x.strokeStyle = '#111'; x.beginPath(); x.moveTo(L, T); x.lineTo(L, T + ph); x.lineTo(W - R, T + ph); x.stroke();
  // bars
  const series = [{ key: 'weighted', name: 'Weighted average (average member of the group)', color: '#c8102e' }];
  if (withNat) series.push({ key: 'national', name: 'National value', color: '#555' });
  const gw = pw / data.length, bw = Math.min(110, (gw * 0.7) / series.length);
  x.textAlign = 'center';
  data.forEach((d, k) => {
    const x0 = L + gw * k + (gw - bw * series.length) / 2;
    series.forEach((s, m) => {
      const val = d[s.key];
      if (val === null || val === undefined) return;
      const bx = x0 + bw * m;
      x.fillStyle = s.color; x.fillRect(bx, yOf(val), bw - 6, T + ph - yOf(val));
      x.fillStyle = '#111'; x.font = 'bold 15px Arial, sans-serif'; x.fillText(figFmt(v, val), bx + (bw - 6) / 2, yOf(val) - 6);
    });
    x.fillStyle = '#111'; x.font = '16px Arial, sans-serif'; x.fillText(d.label, L + gw * k + gw / 2, T + ph + 26);
  });
  // y axis label
  x.save(); x.translate(24, T + ph / 2); x.rotate(-Math.PI / 2); x.font = '15px Arial, sans-serif'; x.fillStyle = '#111';
  x.fillText(figLabel(v) + (isMoney(v) && $('real').checked ? ' (2024 dollars)' : ''), 0, 0); x.restore();
  // legend
  x.textAlign = 'left'; x.font = '15px Arial, sans-serif';
  let lx = L, ly = H - 52;
  series.forEach((s) => { x.fillStyle = s.color; x.fillRect(lx, ly - 12, 14, 14); x.fillStyle = '#111'; x.fillText(s.name, lx + 20, ly); lx += 40 + x.measureText(s.name).width; });
  // sources
  x.fillStyle = '#555'; x.font = '12px Arial, sans-serif';
  x.fillText('Sources: U.S. Census Bureau, Census 2000 (SF3); American Community Survey 5-year estimates 2006-2010 and 2020-2024.', L, H - 30);
  x.fillText('Whole-city values, weighted by the number of group members in each of the 50 cities.', L, H - 14);
  return c;
}
function figSave(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function downloadFigure() {
  if (!current) return;
  const v = $('figvar').value;
  const base = `figure-${v}-${groups.names[current.g].replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  const kind = $('figkind').value;
  const withNat = $('fignat').checked;
  if (kind === 'chart' || kind === 'both') figCanvas().toBlob((b) => figSave(b, base + '.png'), 'image/png');
  if (kind === 'table' || kind === 'both') {
    const q = (s) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
    const lines = [q($('figtitle').value), ['period', 'weighted_average'].concat(withNat ? ['national_value'] : []).join(',')];
    const rnd = (x) => (x === null || x === undefined ? '' : COUNTS.includes(v) || isMoney(v) ? Math.round(x) : Math.round(x * 10) / 10);
    figRows().forEach((d) => lines.push([d.label, rnd(d.weighted), ...(withNat ? [rnd(d.national)] : [])].map(q).join(',')));
    lines.push('', q('Sources: U.S. Census Bureau, Census 2000 (SF3); American Community Survey 2006-2010 and 2020-2024. Whole-city values, weighted by group size in the 50 cities.'));
    const blob = new Blob(['﻿', lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    setTimeout(() => figSave(blob, base + '.csv'), kind === 'both' ? 400 : 0);
  }
}

function drawCoverage() {
  const { g, rows } = current;
  let h = '<thead><tr><th class="l">period</th><th>group residents in these 50 cities</th><th>group residents in the United States</th><th>share</th></tr></thead><tbody>';
  PERIODS.forEach((p) => {
    const inTop = rows.reduce((s, i) => s + groups.size[p][g][i], 0);
    const us = groups.us[p][g];
    h += `<tr><td class="l">${PERIOD_LABEL[p]}</td><td>${int(inTop)}</td><td>${int(us)}</td><td>${us > 0 ? dec((100 * inTop) / us) + '%' : ''}</td></tr>`;
  });
  $('coverage').innerHTML = h + '</tbody>';
}

function downloadCsv() {
  if (!current) return;
  const { g, shown: vars, rows } = current;
  const q = (s) => (/[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
  const head = ['group', 'rank', 'city_code', 'city', 'state'];
  PERIODS.forEach((p) => head.push(`group_size_${p}`));
  vars.forEach((v) => PERIODS.forEach((p) => head.push(`${v}${isMoney(v) && $('real').checked ? '_2024_dollars' : ""}_${p}`)));
  const lines = [head.join(',')];
  rows.forEach((i, k) => {
    const r = [groups.names[g], k + 1, cities.code[i], cities.city[i], cities.state[i]];
    PERIODS.forEach((p) => r.push(groups.size[p][g][i]));
    vars.forEach((v) => PERIODS.forEach((p) => r.push(typeof isMasked === 'function' && isMasked(i, v, p) ? '' : values(p, v)[i] ?? '')));
    lines.push(r.map(q).join(','));
  });
  const text = lines.join('\r\n') + '\r\n';
  const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `top-${TOP}-cities-${groups.names[g].replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}-ranked-${current.rankBy}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Test tab: save the answers as a text file (nothing is sent anywhere).
function saveNotes() {
    const answers = [...document.querySelectorAll('#feedback [data-q]')].map((e) => `${e.dataset.q}:\r\n${e.value.trim() || '(no answer)'}\r\n`);
  const text = ['Community context site: test notes', '', ...answers].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = 'community-context-test-notes.txt';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

start();
