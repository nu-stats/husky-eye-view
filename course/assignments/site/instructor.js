'use strict';
// Instructor controls on the Start here tab: open or lock Part 2 (Census) and Part 3 (crime), each on its own.
// Opened with the small "Instructor" link at the bottom of Start here (or the address followed by #instructor).
// Saving writes data/schedule.json in the site's GitHub repository with the instructor's own key, so the change
// reaches every student (the page has no server of its own). The key stays in the instructor's browser.

const REPO = 'nu-stats/community-context';
const FILE = 'data/schedule.json';
const KEY_STORE = 'hev-instructor-key-v1';
const PART_NAME = { 2: 'Part 2: Census data', 3: 'Part 3: crime data' };

// ---- Boston time <-> ISO with offset ----
const TZ = 'America/New_York';
function nyParts(ms) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return o;
}
const nyOffsetMin = (ms) => { const p = nyParts(ms); return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms) / 60000); };
// "2026-11-21T00:00" (Boston wall time) -> "2026-11-21T00:00:00-05:00"
function wallToIso(wall) {
  if (!wall) return null;
  const [d, t] = wall.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const asUtc = Date.UTC(y, mo - 1, da, h, mi);
  let off = nyOffsetMin(asUtc);
  off = nyOffsetMin(asUtc - off * 60000);
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off);
  return `${d}T${t.slice(0, 5)}:00${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}
// ISO -> "2026-11-21T00:00" in Boston time, for the date-time box
function isoToWall(iso) {
  if (!iso) return '';
  const p = nyParts(Date.parse(iso));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

// ---- the panel ----
function partHtml(n) {
  const s = schedule['part' + n] || {};
  const st = partState(String(n));
  return `<h4>${PART_NAME[n]}</h4>
    <p>Right now: ${st.open ? '<span class="good">open</span>' : '<span class="bad">closed</span>'}${st.open ? '' : ` <span class="muted">(${esc(st.text)})</span>`}</p>
    <p><label><input type="radio" name="mode${n}" value="dates"${s.locked ? '' : ' checked'}> Open, following the dates below</label><br>
       <label><input type="radio" name="mode${n}" value="locked"${s.locked ? ' checked' : ''}> Locked now (closed until you open it again)</label></p>
    <p><label>Opens <input type="datetime-local" id="opens${n}" value="${isoToWall(s.opens)}"></label> <span class="muted">empty = open now</span></p>
    <p><label>Closes <input type="datetime-local" id="closes${n}" value="${isoToWall(s.closes)}"></label> <span class="muted">empty = never closes</span></p>
    <p><label>Message students see while it is locked<br><input type="text" id="msg${n}" value="${esc(s.message || '')}" style="width:100%"></label></p>`;
}
function drawInstr() {
  document.querySelectorAll('.instr-part').forEach((el) => { el.innerHTML = partHtml(el.dataset.part); });
}
function openInstr() {
  showTab('start');
  $('instr').hidden = false;
  try { const k = localStorage.getItem(KEY_STORE); if (k) { $('ghkey').value = k; $('ghremember').checked = true; } } catch (x) { /* no storage */ }
  drawInstr();
  $('instr').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function readForm() {
  const out = { _help: schedule._help || 'Set from the Instructor controls on the Start here tab.' };
  for (const n of [2, 3]) {
    const locked = document.querySelector(`input[name=mode${n}]:checked`).value === 'locked';
    out['part' + n] = {
      opens: wallToIso($('opens' + n).value),
      closes: wallToIso($('closes' + n).value),
      locked,
      message: $('msg' + n).value.trim(),
    };
  }
  return out;
}

const b64 = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
async function saveSchedule() {
  const msg = $('schedmsg');
  const key = $('ghkey').value.trim();
  if (!key) { msg.innerHTML = '<span class="bad">Paste your saving key first (see "How to get your saving key").</span>'; return; }
  const next = readForm();
  for (const n of [2, 3]) {
    const p = next['part' + n];
    if (p.opens && p.closes && Date.parse(p.closes) <= Date.parse(p.opens)) { msg.innerHTML = `<span class="bad">${PART_NAME[n]}: the closing time is before the opening time.</span>`; return; }
  }
  msg.textContent = 'Saving...';
  const api = `https://api.github.com/repos/${REPO}/contents/${FILE}`;
  const headers = { Authorization: `Bearer ${key}`, Accept: 'application/vnd.github+json' };
  try {
    const cur = await fetch(api + '?ref=main', { headers, cache: 'no-store' });
    if (cur.status === 401) throw new Error('GitHub did not accept the key. Check that you copied all of it, and that it has not expired.');
    if (!cur.ok) throw new Error(`GitHub answered ${cur.status} when reading the settings.`);
    const sha = (await cur.json()).sha;
    const body = { message: 'Open/lock settings changed from the Instructor controls', content: b64(JSON.stringify(next, null, 2) + '\n'), sha, branch: 'main' };
    const put = await fetch(api, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!put.ok) {
      // show GitHub's own answer, so the cause is clear
      let why = '';
      try { why = (await put.json()).message || ''; } catch (x) { /* no body */ }
      const need = put.headers.get('x-accepted-github-permissions') || '';
      const hint = put.status === 403 || put.status === 404
        ? ' On GitHub, open the key, click Edit, check that Repository access lists community-context and that Permissions shows Contents: Read and write, then click Update.'
        : '';
      throw new Error(`GitHub answered ${put.status}${why ? ': "' + why + '"' : ''}${need ? ' (it needs ' + need + ')' : ''}.${hint}`);
    }
    try { if ($('ghremember').checked) localStorage.setItem(KEY_STORE, key); else localStorage.removeItem(KEY_STORE); } catch (x) { /* no storage */ }
    schedule = next; // this page shows the new settings right away
    partLabels();
    render();
    drawInstr();
    msg.innerHTML = '<span class="good">Saved.</span> Students see it within about two minutes.';
  } catch (e) {
    msg.innerHTML = `<span class="bad">Not saved. ${esc(e.message)}</span>`;
  }
}

$('instrlink').addEventListener('click', (e) => { e.preventDefault(); openInstr(); });
$('instrbtn').addEventListener('click', openInstr);
$('instrclose').addEventListener('click', () => { $('instr').hidden = true; });
$('schedsave').addEventListener('click', saveSchedule);
if (location.hash === '#instructor') {
  // wait for the schedule to load (app.js start)
  const wait = setInterval(() => { if ($('part').options.length) { clearInterval(wait); openInstr(); } }, 200);
}
