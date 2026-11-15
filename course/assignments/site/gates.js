'use strict';
// Knowledge-check gates for the Weighted averages tab (spec: ../knowledge-check/knowledge-check.md).
// The results stay hidden until the student passes: A predict, B video + questions, C spot-check look-ups.
// A teaching nudge, not security: the page code is public, and the wait below is kept in the
// browser (clearing site data or using another browser gets around it).

// ---- SETTINGS (change them here, in this one place) --------------------------------------
// The weighted-average video. A YouTube or Vimeo "embed" address (https://www.youtube.com/embed/...)
// or a direct .mp4 / .webm file both work. While it is empty the page shows a marked placeholder.
const VIDEO_URL = 'media/weighted-average.mp4'; // captions: the same name ending in .vtt
// An optional link for extra practice (for example a worksheet). Empty = no link shown.
const PRACTICE_URL = '';
// What happens after a student misses the same question twice:
//   'wait' = she must wait WAIT_MINUTES, then gets a new question (with the video and practice shown meanwhile)
//   'task' = she must first work out a small three-city weighted average, then gets a new question
const AFTER_TWO_WRONG = 'wait';
const WAIT_MINUTES = 60;
// Look-ups: this many wrong entries for the same value start the same wait (each entry is checked against a fingerprint, so this stops guessing in a loop).
const SPOT_TRIES = 3;
// Missing the same question twice is a lockout. After this many lockouts (counted over the whole visit, across
// groups) the page stops and asks the student to meet with the instructor, who gives her the release word.
const MEETING_AFTER = 3;
// true = the group is fixed by the student's email (nobody can borrow a friend's group); false = she picks her own group.
const ASSIGN_GROUP = false;
// Fingerprint of the release word (the word itself is not written in any published file). Make a new one with
//   node course/assignments/site/make-release.mjs "your word"   and paste the printed line here:
const RELEASE_FINGERPRINT = '61b968d6a11782c2'; // release word set with make-release.mjs
// ------------------------------------------------------------------------------------------

const SPOT_VARS = ['population', 'foreign_born_percent', 'poverty_percent', 'unemployment_percent']; // Census values that may be hidden
// Crime rates come from FBI tables, not a survey, so a crime look-up names the years plainly.
const YEARS_LABEL = { '2000': '2000', '2006_10': '2006-2010', '2020_24': '2020-2024' };
const WHERE = {
  census: "the Census Bureau's public data site (data.census.gov). Search for the city, then open the profile for the survey named above",
  crime: "the FBI's published table of offenses known to law enforcement, by city, for the year named above. Find the city, add up the offenses (violent: murder, rape, robbery and aggravated assault; property: burglary, larceny-theft and motor vehicle theft; overall: both; arson is not counted), divide by the city's population in that table, and multiply by 100,000",
};
const WHAT = {
  population: 'the total population of the city',
  foreign_born_percent: 'the foreign-born residents as a percent of all residents of the city',
  poverty_percent: 'the people below the poverty level, as a percent of the people for whom poverty is determined',
  unemployment_percent: 'the unemployed as a percent of the civilian labor force',
  overall_crime_rate: 'reported crimes of all kinds per 100,000 residents (arson not counted)',
  violent_crime_rate: 'reported violent crimes per 100,000 residents',
  property_crime_rate: 'reported property crimes per 100,000 residents (arson not counted)',
};

const gateStates = {}; // one per group + period + part + indicators; kept in the browser so a reload keeps the same draw
let gate = null; // the state for what is on screen
let gateKey = '';
let spotData = null;
let lockTimer = null;

// Random draws are seeded by the student's email, so the same student always gets the same questions
// and look-ups for the same choices (reloading or clearing site data does not re-roll them), and a
// classmate with another email gets different ones.
let rngState = 0;
function seedOf(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng() { rngState = (rngState + 0x6D2B79F5) | 0; let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pickOne = (a) => a[Math.floor(rng() * a.length)];
const STORE = 'hev-gates-v1:';
const LOCKS = 'hev-lockouts-v1';
const lockCount = () => { try { return Number(localStorage.getItem(LOCKS)) || 0; } catch (e) { return 0; } };
const setLockCount = (n) => { try { localStorage.setItem(LOCKS, String(n)); } catch (e) { /* kept for this page only */ } };
const saveGate = () => { try { localStorage.setItem(STORE + gateKey, JSON.stringify(gate)); } catch (e) { /* private window: the gates still work, they just do not survive a reload */ } };
const loadGate = (key) => { try { const s = localStorage.getItem(STORE + key); return s ? JSON.parse(s) : null; } catch (e) { return null; } };

// ---- numbers from the student's own data ----
function stats(v, p) {
  const { g, rows } = current;
  const w = groups.size[p][g], x = values(p, v);
  const ok = rows.filter((i) => x[i] !== null && x[i] !== undefined);
  const sumW = ok.reduce((s, i) => s + w[i], 0);
  const weighted = sumW > 0 ? ok.reduce((s, i) => s + w[i] * x[i], 0) / sumW : null;
  const plain = ok.length ? ok.reduce((s, i) => s + x[i], 0) / ok.length : null;
  return { ok, w, x, sumW, weighted, plain };
}
// "about the same" when the two averages differ by less than 2% of the plain average
function direction(weighted, plain) {
  if (weighted === null || plain === null) return 'same';
  if (Math.abs(weighted - plain) < 0.02 * Math.abs(plain)) return 'same';
  return weighted > plain ? 'higher' : 'lower';
}
const DIR_TEXT = { higher: 'higher than', lower: 'lower than', same: 'about the same as' };

function reasonFor(v) {
  const s = stats(v, '2020_24');
  const dir = direction(s.weighted, s.plain);
  if (!s.ok.length || s.sumW === 0) return 'Your group has no residents in the cities that have a value, so there is nothing to weight.';
  const byWeight = s.ok.slice().sort((a, b) => s.w[b] - s.w[a]);
  const top = byWeight[0];
  const share = Math.round((100 * s.w[top]) / s.sumW);
  const below = s.ok.filter((i) => s.x[i] < s.x[top]).length;
  const n = s.ok.length;
  const name = cities.city[top];
  if (dir === 'same') return `${name} holds ${share}% of the weight, but the cities where your group is largest have values close to the average city, so weighting changes very little.`;
  const topSide = s.x[top] > s.plain ? 'higher' : 'lower';
  if (topSide === dir) {
    const rank = dir === 'higher' ? `higher than ${below} of the other ${n - 1} cities` : `lower than ${n - 1 - below} of the other ${n - 1} cities`;
    return `${name} holds ${share}% of the weight (it has the largest group of your cities), and its value is ${rank}, so it pulls the weighted average ${dir === 'higher' ? 'up' : 'down'}.`;
  }
  const t3 = byWeight.slice(0, 3);
  const w3 = t3.reduce((a, i) => a + s.w[i], 0);
  const m3 = t3.reduce((a, i) => a + s.w[i] * s.x[i], 0) / w3;
  const names = t3.map((i) => cities.city[i]).join(', ');
  if ((m3 > s.plain ? 'higher' : 'lower') === dir) return `The three cities with the largest groups (${names}) hold ${Math.round((100 * w3) / s.sumW)}% of the weight, and together their values are ${dir} than the plain average, so they pull the weighted average ${dir === 'higher' ? 'up' : 'down'}.`;
  return `Many cities with large groups, together, have values ${dir} than the plain average, so they pull the weighted average ${dir === 'higher' ? 'up' : 'down'}.`;
}

// ---- questions ----
function coverageChoices(c) {
  const pool = shuffle([c - 15, c - 9, c + 9, c + 15, Math.round(c / 2), c + 22, c - 22].filter((d) => d >= 1 && d <= 99 && Math.abs(d - c) >= 4));
  const out = [];
  for (const d of pool) if (!out.some((o) => Math.abs(o - d) < 4)) out.push(d);
  for (let d = 5; out.length < 3; d += 7) if (d !== c && !out.includes(d) && Math.abs(d - c) >= 4) out.push(d);
  return [c, ...out.slice(0, 3)].sort((a, b) => a - b).map((d) => `${d}%`);
}
function buildQuestions() {
  const v1 = current.vars[0];
  const s = stats(v1, '2020_24');
  const dir = direction(s.weighted, s.plain);
  const g = current.g;
  const w24 = groups.size['2020_24'][g];
  const ranked = current.rows.slice().sort((a, b) => w24[b] - w24[a] || (cities.code[a] < cities.code[b] ? -1 : 1));
  const topCity = cities.city[ranked[0]];
  const others = shuffle(ranked.slice(1).map((i) => cities.city[i]).filter((c) => c !== topCity)).slice(0, 4);
  const us = groups.us['2020_24'][g];
  const inTop = current.rows.reduce((a, i) => a + w24[i], 0);
  const cov = us > 0 ? Math.round((100 * inTop) / us) : 0;
  const crime = $('part').value === '3';
  const Q = {
    own1: { text: 'Which of your top 50 cities carries the most weight in 2020-2024?', hint: 'Look at the group size column for 2020-2024 on the Top 50 tab.', choices: [topCity, ...others], correct: topCity, why: "It has the largest group size in 2020-2024, and a city's weight is its group size." },
    own2: { text: `Is your weighted average of ${v1} in 2020-2024 higher than, lower than, or about the same as the plain average of the 50 cities?`, hint: 'Think about which cities carry the most weight, and whether their values are above or below the typical city. Step A told you the direction.', choices: ['Higher', 'Lower', 'About the same'], correct: { higher: 'Higher', lower: 'Lower', same: 'About the same' }[dir], why: 'The weighted average leans toward the cities where your group is largest.', fixed: true },
    own3: { text: `Your group has ${int(us)} residents in the United States in 2020-2024. About what share of them live in your 50 cities?`, hint: 'Add up the 2020-2024 group sizes of your 50 cities (download the table as CSV and sum the column), then divide by the U.S. total in the question.', choices: coverageChoices(cov), fixed: true, correct: `${cov}%`, why: 'That is the coverage line on the results page: your results describe those cities, not everyone in the group.' },
    c4: { text: 'City A has 900 group members and a poverty rate of 10%. City B has 100 and 30%. The weighted average poverty rate is closest to:', hint: 'Multiply each rate by its group size, add the two products, and divide by the total group size.', choices: ['10%', '12%', '20%', '30%'], correct: '12%', why: '(900 x 10 + 100 x 30) / 1,000 = 12.', fixed: true },
    c5: { text: 'Why not just average the 50 city percentages?', hint: 'Think about what the plain average does with a city that has very few group members.', choices: ['It treats a city with 50 group members the same as a city with 50,000.', 'It is too slow.', 'Percentages cannot be averaged.', 'It gives the same answer anyway.'], correct: 'It treats a city with 50 group members the same as a city with 50,000.', why: 'The plain average counts every city the same; the weighted average counts each city by how many group members live there.' },
    c6: { text: 'If the city with the largest group had twice as many group members and nothing else changed, the weighted average would move:', hint: 'A bigger weight gives a city more say in the average.', choices: ["toward that city's value", "away from that city's value", 'not change'], correct: "toward that city's value", why: 'A bigger weight gives that city more say in the average.' },
    c7: { text: 'The pooled 2020-2024 crime rate for a city equals:', hint: 'Rates are built from total offenses and total residents, not from averaging yearly rates.', choices: ['all offenses over the years divided by all residents over the years, times 100,000', 'the simple average of the yearly rates', "the latest year's rate"], correct: 'all offenses over the years divided by all residents over the years, times 100,000', why: 'That equals the population-weighted average of the yearly rates.' },
    c8: { text: 'A city has no violent crime rate for 2000 (for example, it did not report). What does this site do?', hint: 'Think about what makes sense for a city with no value at all.', choices: ["Leaves it out of that variable's averages, and does not count its weight", 'Counts it as zero', 'Stops'], correct: "Leaves it out of that variable's averages, and does not count its weight", why: 'A blank is left out of the calculation, and so is its weight; the page shows how many cities had a value.' },
    c9: { text: 'Which is true?', hint: 'One is about people in the group; the other counts each city once.', choices: ['The weighted average describes the average member of the group; the plain average describes the average city.', 'They are always equal.', 'The plain average is always larger.'], correct: 'The weighted average describes the average member of the group; the plain average describes the average city.', why: 'When the group is spread unevenly across cities, the two can be far apart.' },
    c10: { text: 'A city of 400,000 people has 800 reported crimes in a year. The rate per 100,000 residents is:', hint: 'Divide the crimes by the residents, then multiply by 100,000.', choices: ['20', '200', '2,000', '8,000'], correct: '200', why: '800 / 400,000 x 100,000 = 200.', fixed: true },
  };
  const pool = ['own2', 'own3', 'c4', 'c5', 'c6', 'c9'].concat(crime ? ['c7', 'c8', 'c10'] : []);
  const mix = shuffle(pool);
  return { bank: Q, qs: ['own1', ...mix.slice(0, 4)].map((id) => makeQ(id, Q)), unused: mix.slice(4) };
}
function makeQ(id, Q) {
  const q = Q[id];
  return { id, text: q.text, hint: q.hint, why: q.why, correct: q.correct, choices: q.fixed ? q.choices : shuffle(q.choices), picked: null, right: false, wrong: false, tries: 0, needTask: false, task: null };
}

// A small three-city weighted average (the group sizes add up to 1,000, so the answer has one decimal).
function newTask() {
  const a = pickOne([1, 2, 3, 4, 5, 6, 7]), b = pickOne([1, 2, 3, 4, 5, 6, 7, 8].filter((x) => x + a <= 9));
  const sizes = [a * 100, b * 100, (10 - a - b) * 100];
  const rates = shuffle([5, 8, 10, 12, 15, 18, 20, 25, 30, 35, 40]).slice(0, 3);
  const answer = sizes.reduce((s, w, k) => s + w * rates[k], 0) / 1000;
  return { sizes, rates, answer, typed: '', msg: '' };
}
const taskOk = (t) => { const x = Number(String(t.typed).replace(/[,%\s]/g, '')); return t.typed.trim() !== '' && Number.isFinite(x) && Math.abs(x - t.answer) <= 0.06; };

// ---- spot checks ----
function pickSpots() {
  const shown = current.shown;
  const crimeVars = shown.filter((v) => CRIME.includes(v));
  const cand = (i) => {
    const out = [];
    for (const v of shown.filter((x) => SPOT_VARS.includes(x))) for (const p of PERIODS) if (cities.values[p][v][i] != null) out.push({ v, p });
    for (const v of crimeVars) for (const p of PERIODS) {
      if (cities.values[p][v][i] == null) continue;
      // 2000 is one year, so the student looks that year up. A pooled rate is a weighted average of the
      // yearly rates, so she is asked for one single year inside the period (drawn from the years with a value).
      if (p === '2000') out.push({ v, p });
      else {
        const ys = (cities.crime_years[p] || []).filter((y) => cities.year_values[y][v][i] != null);
        if (ys.length) out.push({ v, p, ys });
      }
    }
    return out;
  };
  const ready = shuffle(current.rows).filter((i) => cand(i).length);
  return ready.slice(0, 3).map((i) => {
    const c = { ...pickOne(cand(i)) };
    if (c.ys) { c.y = String(pickOne(c.ys)); delete c.ys; }
    return { i, ...c, typed: '', ok: false };
  });
}
const isMasked = (i, v, p) => !!(gate && !gate.done && gate.spots.some((s) => s.i === i && s.v === v && s.p === p));
const shownCell = (i, v, p) => (isMasked(i, v, p) ? '<span class="lookup">look up</span>' : cell(values(p, v)[i]));

async function fingerprint(code, v, p, k) {
  if (!(window.crypto && crypto.subtle)) throw new Error('This browser cannot check answers here. Open the page from its https address.');
  const bytes = new TextEncoder().encode(`${spotData.salt}|${code}|${v}|${p}|${k}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}
async function checkSpot(s) {
  if (!spotData) spotData = await fetch('data/spot.json').then((r) => r.json());
  const x = Number(String(s.typed).replace(/[,%\s]/g, ''));
  if (s.typed.trim() === '' || !Number.isFinite(x)) return false;
  const want = s.y || s.p; // a pooled crime rate is checked against the one year the student was asked for
  const slot = spotData.slots.findIndex(([v, p]) => v === s.v && p === want);
  const kind = spotData.slots[slot][2];
  const k = kind === 'tenth' ? Math.round(x * 10) : Math.round(x);
  const stored = spotData.h[s.i][slot];
  if (!stored) return false;
  const f = await fingerprint(cities.code[s.i], s.v, want, k);
  return stored.split('.').includes(f);
}

// ---- hooks called by app.js ----
function gatesPrepare() {
  gateKey = [studentEmail, current.g, current.rankBy, $('part').value, ...current.vars].join('|');
  if (!gateStates[gateKey]) {
    let s = loadGate(gateKey);
    if (s) rngState = s.rs | 0;
    else {
      rngState = seedOf(gateKey);
      const b = buildQuestions();
      s = { pred: null, revealed: false, qs: b.qs, bank: b.bank, unused: b.unused, spots: pickSpots(), done: false, wrongQ: 0, wrongSpot: 0, wrongTask: 0, lockedUntil: 0, lockedQ: -1, practice: null, spotLockUntil: 0, lockouts: 0, meeting: false, meetings: 0, relMsg: '', rs: 0 };
    }
    s.rs = rngState;
    gateStates[gateKey] = s;
  }
  gate = gateStates[gateKey];
  rngState = gate.rs | 0;
}

const locked = () => gate.lockedUntil && Date.now() < gate.lockedUntil;
const spotLocked = () => gate.spotLockUntil && Date.now() < gate.spotLockUntil;
function releaseLock() {
  // the wait is over: the question she missed twice is replaced by a new one
  if (gate.spotLockUntil && Date.now() >= gate.spotLockUntil) { gate.spotLockUntil = 0; gate.spots.forEach((s) => { s.tries = 0; s.msg = ''; }); }
  if (gate.lockedUntil && Date.now() >= gate.lockedUntil) {
    const n = gate.lockedQ, q = gate.qs[n];
    if (q) { const id = gate.unused.shift(); gate.qs[n] = makeQ(id || q.id, gate.bank); }
    gate.lockedUntil = 0; gate.lockedQ = -1;
  }
}

function gatesRender() {
  const box = $('gates'), results = $('resultsblock');
  clearInterval(lockTimer);
  if (!box) return;
  if (!current || !gate) { box.innerHTML = ''; return; }
  releaseLock();
  results.hidden = !gate.done;
  const v1 = current.vars[0];
  let h = '';
  if (!gate.done) h += '<p>The results appear when you pass three short steps. They check that you know how the numbers are made.</p>';

  // Step A
  h += '<h3>Step A. Predict</h3>';
  if (!gate.revealed) {
    h += `<p>Before you see anything: in 2020-2024, will the weighted average of <b>${esc(v1)}</b> be higher than, lower than, or about the same as the plain average of your 50 cities? (Your own choice; there is no wrong pick here.)</p><div class="opts">` +
      ['higher', 'lower', 'same'].map((d) => `<label><input type="radio" name="pred" value="${d}"${gate.pred === d ? ' checked' : ''}> ${{ higher: 'Higher', lower: 'Lower', same: 'About the same' }[d]}</label>`).join('') +
      '</div><p><button type="button" id="reveal">Show me</button></p>';
  } else {
    const s = stats(v1, '2020_24'); const dir = direction(s.weighted, s.plain);
    h += `<p>You predicted: <b>${{ higher: 'higher', lower: 'lower', same: 'about the same' }[gate.pred]}</b>. The weighted average is <b>${DIR_TEXT[dir]}</b> the plain average.</p><p class="muted">${esc(reasonFor(v1))}</p>`;
  }

  // Step B
  if (gate.revealed) {
    h += '<h3>Step B. Video and questions</h3>' + videoHtml();
    if (gate.meeting) h += meetingHtml();
    else if (locked()) h += lockHtml();
    else h += '<div id="questions">' + gate.qs.map((q, n) => questionHtml(q, n)).join('') + '</div>';
  }

  // Step C
  if (gate.revealed && !gate.meeting && !locked() && gate.qs.every((q) => q.right)) {
    h += '<h3>Step C. Look three values up</h3><p>Three values from your top 50 are hidden in the Top 50 and Data tabs (they say "look up"). Find each one on the public source, type it, and press Check. A small difference in rounding is fine.</p>';
    h += spotLocked() ? spotLockHtml() : gate.spots.map((s, n) => spotHtml(s, n)).join('');
  }

  if (gate.done) h = completionHtml();
  box.innerHTML = h;
  wireGates();
  gate.rs = rngState;
  saveGate();
  if (locked() || spotLocked()) lockTimer = setInterval(() => { if (locked() || spotLocked()) { const e = $('lockleft'); if (e) e.textContent = leftText(locked() ? gate.lockedUntil : gate.spotLockUntil); } else { clearInterval(lockTimer); gatesRender(); } }, 1000);
}

const leftText = (until) => { const s = Math.max(0, Math.ceil((until - Date.now()) / 1000)); return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`; };
const TEXT_VERSION = '<details><summary>Read it instead</summary><div class="muted"><p>You want to know what a neighborhood is like for the typical member of an immigrant group. You collect one number for each city, like the poverty rate. The plain average adds them up and divides by the number of cities, so every city counts the same.</p><p>Say city A has 100 group members and a rate of 10%, city B has 100 and 20%, and city C has 800 and 30%. The plain average is 20%. But eight out of ten people in this group live in city C, so a typical member lives in a city at 30%, not 20%.</p><p>The weighted average gives each city a weight equal to its group size: multiply each rate by its weight (1,000 + 2,000 + 24,000 = 27,000), add up the weights (1,000), and divide: 27%.</p><p>weighted average = sum of (weight x value) / sum of weights. The weighted average describes the average member of the group; the plain average describes the average city. On your results page each number is built this way: two rows and one division.</p></div></details>';
function videoHtml() {
  let slot;
  if (!VIDEO_URL) slot = '<div class="videoslot"><b>VIDEO PLACEHOLDER</b><br>The weighted-average video (about 90 seconds) will appear here. It has not been recorded yet. Read the text version below.</div>';
  else if (/\.(mp4|webm)(\?|$)/i.test(VIDEO_URL)) slot = `<video class="videoslot vid" controls preload="metadata" playsinline src="${esc(VIDEO_URL)}"><track kind="captions" src="${esc(VIDEO_URL.replace(/\.(mp4|webm)(\?.*)?$/i, '.vtt'))}" srclang="en" label="English" default></video>`;
  else slot = `<iframe class="videoslot" src="${esc(VIDEO_URL)}" title="Weighted average video" allowfullscreen></iframe>`;
  return slot + TEXT_VERSION;
}
function questionHtml(q, n) {
  if (q.needTask) return taskHtml(q, n);
  const state = q.right ? '<span class="good">Right.</span>' : q.wrong ? `<span class="bad">Not quite.</span> Hint: ${esc(q.hint)} Try again.` : '';
  return `<div class="question"><p><b>${n + 1}.</b> ${esc(q.text)}</p><div class="opts">` +
    q.choices.map((c, k) => `<label><input type="radio" name="q${n}" value="${k}"${q.picked === c ? ' checked' : ''}${q.right ? ' disabled' : ''}> ${esc(c)}</label>`).join('') +
    `</div>${q.right ? '' : `<button type="button" class="qcheck" data-q="${n}">Check</button>`} <span class="verdict" aria-live="polite">${state}</span></div>`;
}
function practiceHtml(pr, id, label) {
  return `<div class="tablewrap" style="max-width:420px"><table class="calc"><thead><tr><th class="l">City</th><th>Group members</th><th>Rate (%)</th></tr></thead><tbody>` +
    ['A', 'B', 'C'].map((c, k) => `<tr><td class="l">${c}</td><td>${int(pr.sizes[k])}</td><td>${pr.rates[k]}</td></tr>`).join('') + '</tbody></table></div>' +
    `<p>${label} <input type="text" class="${id}in" inputmode="decimal" autocomplete="off" value="${esc(pr.typed)}"> <button type="button" class="${id}check">Check</button> <span class="${pr.msg && pr.msg.startsWith('Right') ? 'good' : 'bad'}">${esc(pr.msg)}</span></p>`;
}
function taskHtml(q, n) {
  return `<div class="question"><p><b>${n + 1}.</b> <span class="bad">Not quite, twice.</span> The right answer was: <b>${esc(q.correct)}</b>. ${esc(q.why)}</p><p>To get a new question, work this out first. The text version of the video above shows how.</p>` +
    practiceHtml(q.task, 'task', 'What is the weighted average rate?').replace(/class="(task(?:in|check))"/g, `class="$1" data-q="${n}"`) + '</div>';
}
function lockHtml() {
  const at = new Date(gate.lockedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (!gate.practice) gate.practice = newTask();
  return `<div class="question lockbox"><p><b>Take a break.</b> You missed question ${gate.lockedQ + 1} twice, so the questions open again in <b id="lockleft">${leftText(gate.lockedUntil)}</b> (at ${esc(at)}). Then you get a new question.</p>` +
    '<p>Use the time: watch the video again, or open "Read it instead" above, and try the practice example below as many times as you like.</p>' +
    (PRACTICE_URL ? `<p><a href="${esc(PRACTICE_URL)}" target="_blank" rel="noopener">More practice</a></p>` : '') +
    '<h4>Practice</h4>' + practiceHtml(gate.practice, 'prac', 'Weighted average rate:') + '<p><button type="button" id="pracnew">Another example</button></p></div>';
}
function meetingHtml() {
  return `<div class="question lockbox"><p><b>Something is not landing.</b> You have missed questions twice, ${MEETING_AFTER} times. Please meet with your instructor. They will go over how a weighted average is made and give you a release word to continue.</p>` +
    '<p>While you wait, watch the video again or open "Read it instead" above.</p>' +
    `<p>Release word: <input type="text" id="relin" autocomplete="off"> <button type="button" id="relgo">Continue</button> <span class="bad">${esc(gate.relMsg || '')}</span></p></div>`;
}
function spotLockHtml() {
  const at = new Date(gate.spotLockUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `<div class="question lockbox"><p><b>Take a break.</b> Several entries did not match, so the look-ups open again in <b id="lockleft">${leftText(gate.spotLockUntil)}</b> (at ${esc(at)}).</p><p>Use the time to check, for each city: that you have the right city and state, the right survey or year, and the right units (a percent to one decimal, a whole number for population, crimes per 100,000 residents for crime).</p></div>`;
}
function spotHtml(s, n) {
  const src = CRIME.includes(s.v) ? WHERE.crime : WHERE.census;
  const unit = s.v === 'population' ? 'a whole number' : CRIME.includes(s.v) ? 'a number (crimes per 100,000 residents)' : 'a percent (one decimal)';
  const pooled = !!s.y;
  return `<div class="question"><p><b>${n + 1}.</b> <b>${esc(cities.city[s.i])}, ${esc(cities.state[s.i])}</b>: <code>${esc(s.v)}</code>, ${esc(pooled ? `the year ${s.y}` : PERIOD_LABEL[s.p])}.</p>` +
    (pooled ? `<p class="muted">The hidden cell is the ${esc(YEARS_LABEL[s.p])} rate, which is a weighted average of the rates of the single years in that period (each year weighted by the city's population that year). One year cannot be read off it, so look up the year ${esc(s.y)} on its own.</p>` : '') +
    `<p class="muted">This is ${esc(WHAT[s.v])}. Look it up in ${esc(src)}. Type ${unit}.</p>` +
    `<input type="text" class="spotin" data-s="${n}" inputmode="decimal" autocomplete="off" value="${esc(s.typed)}"${s.ok ? ' disabled' : ''}> ` +
    (s.ok ? '<span class="good">Matches.</span>' : `<button type="button" class="spotcheck" data-s="${n}">Check</button> <span class="verdict bad" id="sv${n}" aria-live="polite">${s.msg ? esc(s.msg) : ''}</span>`) + '</div>';
}

function wireGates() {
  const box = $('gates');
  box.querySelectorAll('input[name=pred]').forEach((r) => r.addEventListener('change', () => { gate.pred = r.value; }));
  const rev = $('reveal');
  if (rev) rev.addEventListener('click', () => {
    if (!gate.pred) { rev.insertAdjacentHTML('afterend', ' <span class="bad">Pick one first.</span>'); return; }
    gate.revealed = true; gatesRender();
  });
  box.querySelectorAll('.qcheck').forEach((b) => b.addEventListener('click', () => {
    const n = Number(b.dataset.q), q = gate.qs[n];
    const sel = box.querySelector(`input[name=q${n}]:checked`);
    if (!sel) return;
    q.picked = q.choices[Number(sel.value)];
    q.right = q.picked === q.correct; q.wrong = !q.right;
    if (q.wrong) {
      q.tries++; gate.wrongQ++;
      if (q.tries >= 2) {
        gate.lockouts = (gate.lockouts || 0) + 1;
        setLockCount(lockCount() + 1);
        if (lockCount() >= MEETING_AFTER) { gate.meeting = true; gate.lockedQ = n; }
        else if (AFTER_TWO_WRONG === 'task') { q.needTask = true; q.task = newTask(); }
        else { gate.lockedUntil = Date.now() + WAIT_MINUTES * 60000; gate.lockedQ = n; gate.practice = newTask(); }
      }
    }
    gatesRender();
  }));
  // 'task' mode: the three-city task before a new question
  box.querySelectorAll('.taskin').forEach((el) => el.addEventListener('input', () => { gate.qs[Number(el.dataset.q)].task.typed = el.value; }));
  box.querySelectorAll('.taskcheck').forEach((b) => b.addEventListener('click', () => {
    const n = Number(b.dataset.q), q = gate.qs[n];
    if (taskOk(q.task)) { const id = gate.unused.shift(); gate.qs[n] = makeQ(id || q.id, gate.bank); }
    else { gate.wrongTask++; q.task.msg = 'Not quite. Multiply each rate by its group size, add the three products, and divide by the total group size (1,000).'; }
    gatesRender();
  }));
  // 'wait' mode: unlimited practice while she waits (not counted)
  box.querySelectorAll('.pracin').forEach((el) => el.addEventListener('input', () => { gate.practice.typed = el.value; }));
  box.querySelectorAll('.praccheck').forEach((b) => b.addEventListener('click', () => {
    gate.practice.msg = taskOk(gate.practice) ? `Right: ${gate.practice.answer.toFixed(1)}.` : `Not yet. Multiply each rate by its group size, add the products, and divide by 1,000. (Answer: ${gate.practice.answer.toFixed(1)}.)`;
    gatesRender();
  }));
  const rg = $('relgo');
  if (rg) rg.addEventListener('click', async () => {
    const word = $('relin').value.trim().toLowerCase();
    const bytes = new TextEncoder().encode(`hev-release-v1|${word}`);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
    if (word && hex === RELEASE_FINGERPRINT) {
      const n = gate.lockedQ, q = gate.qs[n];
      if (q) { const id = gate.unused.shift(); gate.qs[n] = makeQ(id || q.id, gate.bank); }
      gate.meeting = false; gate.lockedQ = -1; gate.meetings = (gate.meetings || 0) + 1; gate.relMsg = ''; setLockCount(0);
    } else gate.relMsg = 'That is not the release word.';
    gatesRender();
  });
  const pn = $('pracnew'); if (pn) pn.addEventListener('click', () => { gate.practice = newTask(); gatesRender(); });
  // Step C
  box.querySelectorAll('.spotin').forEach((el) => el.addEventListener('input', () => { gate.spots[Number(el.dataset.s)].typed = el.value; }));
  box.querySelectorAll('.spotin').forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') box.querySelector(`.spotcheck[data-s="${el.dataset.s}"]`)?.click(); }));
  box.querySelectorAll('.spotcheck').forEach((b) => b.addEventListener('click', async () => {
    const s = gate.spots[Number(b.dataset.s)];
    let ok = false;
    try { ok = await checkSpot(s); } catch (e) { s.msg = e.message; gatesRender(); return; }
    s.ok = ok; s.msg = ok ? '' : 'That does not match. Check the city, the period, and the units.';
    if (!ok) {
      gate.wrongSpot++; s.tries = (s.tries || 0) + 1;
      if (s.tries >= SPOT_TRIES) { gate.spotLockUntil = Date.now() + WAIT_MINUTES * 60000; s.tries = 0; }
    }
    if (gate.spots.every((x) => x.ok)) { gate.done = true; await makeCode(); drawTop(); drawData(); }
    gatesRender();
  }));
}

// ---- completion code ----
function recordText() {
  const g = current.g;
  const qs = gate.qs.map((q) => `${q.id}=${q.picked}`).join(';');
  const sp = gate.spots.map((s) => `${cities.code[s.i]}:${s.v}:${s.y || s.p}=${String(s.typed).trim()}`).join(';');
  return [`email ${studentEmail}`, groups.names[g], PERIOD_LABEL[current.rankBy], `part ${$('part').value}`, current.vars.join(','), `prediction ${gate.pred}`, qs, sp, `wrong tries: questions ${gate.wrongQ}, look-ups ${gate.wrongSpot}, tasks ${gate.wrongTask}; lockouts ${gate.lockouts || 0}, meetings ${gate.meetings || 0}`].join(' | ');
}
async function makeCode() {
  const record = recordText();
  const bytes = new TextEncoder().encode(`hev-completion|${record}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12).toUpperCase();
  gate.record = record;
  gate.code = `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}
function completionHtml() {
  return `<h3>You passed all three steps</h3><p>Your results are below. Paste this completion code, and the record line under it, at the top of your submission, before your write-up.</p>` +
    `<p class="code"><b>${esc(gate.code)}</b></p><p class="muted recordline" id="record">${esc(gate.record)}</p><p class="noprint"><button type="button" id="copycode">Copy the code and record</button> <span id="copied" class="good"></span></p>`;
}
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'copycode') {
    const text = `Code: ${gate.code}\nRecord: ${gate.record}`;
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => { $('copied').textContent = 'Copied.'; }, () => { $('copied').textContent = 'Select the text above and copy it.'; });
  }
});
