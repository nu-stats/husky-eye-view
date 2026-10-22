// The URL and fallback tests are from the Sheldondouthat/satwq-reality-os fork
// of God's Eye View (MIT); the route tests cover Husky Eye View's US filter.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hmsSmokeProxy,
  hmsSmokeUtcDateParts,
  hmsSmokeDayUrl,
  hmsSmokeCandidateUrls,
  pickHmsSmokeCandidate,
  HMS_SMOKE_ROUTE,
} from '../../server/providers/hmsSmoke.js';

test('hmsSmokeUtcDateParts derives UTC calendar parts, not local time', () => {
  // 2026-09-26 12:00 UTC — local timezone must not shift the day.
  const parts = hmsSmokeUtcDateParts(new Date(Date.UTC(2026, 8, 26, 12, 0, 0)));
  assert.deepEqual(parts, { y: '2026', m: '09', ymd: '20260926' });
  const edge = hmsSmokeUtcDateParts(new Date(Date.UTC(2026, 0, 5, 23, 59, 59)));
  assert.equal(edge.ymd, '20260105');
});

test('hmsSmokeDayUrl builds the exact HMS path shape', () => {
  assert.equal(
    hmsSmokeDayUrl({ y: '2026', m: '09', ymd: '20260926' }),
    'https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/2026/09/hms_smoke20260926.kml',
  );
});

test('hmsSmokeCandidateUrls returns today-then-yesterday in UTC', () => {
  const [today, yesterday] = hmsSmokeCandidateUrls(
    new Date(Date.UTC(2026, 8, 26, 12, 0, 0)),
  );
  assert.equal(today.date, '20260926');
  assert.ok(today.url.endsWith('/2026/09/hms_smoke20260926.kml'));
  assert.equal(yesterday.date, '20260925');
  assert.ok(yesterday.url.endsWith('/2026/09/hms_smoke20260925.kml'));
});

test('hmsSmokeCandidateUrls crosses month and year boundaries', () => {
  const [today, yesterday] = hmsSmokeCandidateUrls(
    new Date(Date.UTC(2026, 9, 1, 0, 30, 0)),
  );
  assert.equal(today.date, '20261001');
  assert.ok(today.url.endsWith('/2026/10/hms_smoke20261001.kml'));
  assert.equal(yesterday.date, '20260930');
  assert.ok(yesterday.url.endsWith('/2026/09/hms_smoke20260930.kml'));

  const [ny, nye] = hmsSmokeCandidateUrls(
    new Date(Date.UTC(2026, 0, 1, 6, 0, 0)),
  );
  assert.equal(ny.date, '20260101');
  assert.ok(ny.url.endsWith('/2026/01/hms_smoke20260101.kml'));
  assert.equal(nye.date, '20251231');
  assert.ok(nye.url.endsWith('/2025/12/hms_smoke20251231.kml'));
});

test('pickHmsSmokeCandidate prefers today, falls back to yesterday', () => {
  const todayOk = { date: '20260926', url: 'u1', ok: true, looksLikeKml: true };
  const yestOk = { date: '20260925', url: 'u2', ok: true, looksLikeKml: true };
  assert.equal(pickHmsSmokeCandidate([todayOk, yestOk]), todayOk);
  assert.equal(
    pickHmsSmokeCandidate([{ ...todayOk, ok: false }, yestOk]),
    yestOk,
  );
  // HTTP-ok but not KML (error page) is not a success — keep falling back.
  assert.equal(
    pickHmsSmokeCandidate([{ ...todayOk, looksLikeKml: false }, yestOk]),
    yestOk,
  );
  assert.equal(
    pickHmsSmokeCandidate([
      { ...todayOk, ok: false },
      { ...yestOk, ok: false },
    ]),
    null,
  );
  assert.equal(pickHmsSmokeCandidate([]), null);
});

const square = (lon, lat, half = 0.5) =>
  [
    [lon - half, lat - half],
    [lon + half, lat - half],
    [lon + half, lat + half],
    [lon - half, lat + half],
    [lon - half, lat - half],
  ]
    .map(([x, y]) => `${x},${y},0`)
    .join(' ');

const placemark = (style, lon, lat) =>
  `<Placemark><description>smoke</description><styleUrl>#${style}</styleUrl>` +
  `<Polygon><outerBoundaryIs><LinearRing><coordinates>${square(lon, lat)}</coordinates>` +
  `</LinearRing></outerBoundaryIs></Polygon></Placemark>`;

// Kansas and Alaska stay; Alberta (Canada) and Chihuahua (Mexico) go.
const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
${placemark('Smoke_Light_style', -98.5, 38.5)}
${placemark('Smoke_Heavy_style', -147.7, 64.8)}
${placemark('Smoke_Medium_style', -114, 55)}
${placemark('Smoke_Heavy_style', -106.5, 28.5)}
</Document></kml>`;

function install(options = {}, hook = 'configureServer') {
  let handler;
  const plugin = hmsSmokeProxy(options);
  plugin[hook]({
    middlewares: {
      use(path, callback) {
        assert.equal(path, HMS_SMOKE_ROUTE);
        handler = callback;
      },
    },
  });
  return async (url = '/', method = 'GET', peer = 'local') => {
    const res = {
      writeHead(status, headers) {
        this.status = status;
        this.headers = headers;
      },
      end(body) {
        this.body = JSON.parse(body);
      },
    };
    await handler({ url, method, socket: { remoteAddress: peer } }, res);
    return res;
  };
}

test('hmsSmokeProxy is a dev and preview plugin on /api/hms-smoke', () => {
  const plugin = hmsSmokeProxy();
  assert.equal(plugin.name, 'hms-smoke');
  assert.equal(typeof plugin.configureServer, 'function');
  assert.equal(typeof plugin.configurePreviewServer, 'function');
  assert.equal(HMS_SMOKE_ROUTE, '/api/hms-smoke');
});

for (const hook of ['configureServer', 'configurePreviewServer']) {
  test(`${hook}: the route sends only the US polygons, as JSON, and caches them`, async () => {
    const urls = [];
    let now = Date.UTC(2026, 9, 21, 12);
    const request = install(
      {
        now: () => now,
        fetchImpl: async (url, options) => {
          urls.push(url);
          assert.equal(options.redirect, 'error');
          return new Response(KML);
        },
      },
      hook,
    );
    const first = await request();
    assert.equal(first.status, 200);
    assert.equal(first.headers['Content-Type'], 'application/json');
    assert.equal(first.headers['X-HMS-Date'], '20261021');
    assert.equal(first.body.schemaVersion, 1);
    assert.equal(first.body.date, '20261021');
    assert.equal(first.body.total, 4);
    assert.equal(first.body.dropped, 2);
    assert.deepEqual(
      first.body.polygons.map((p) => [p.density, p.ring[0]]),
      [
        ['light', [-99, 38]],
        ['heavy', [-148.2, 64.3]],
      ],
    );
    assert.deepEqual(urls, [
      'https://satepsanone.nesdis.noaa.gov/pub/FIRE/web/HMS/Smoke_Polygons/KML/2026/10/hms_smoke20261021.kml',
    ]);
    // Within the hour: from the cache.
    now += 30 * 60_000;
    assert.equal((await request()).status, 200);
    assert.equal(urls.length, 1);
  });
}

test('today missing: yesterday is used; NOAA down: the last good day is served stale, then 503', async () => {
  let now = Date.UTC(2026, 9, 21, 0, 5);
  let mode = 'today-missing';
  const request = install({
    now: () => now,
    fetchImpl: async (url) => {
      if (mode === 'down') throw new Error('network down');
      if (url.endsWith('20261021.kml'))
        return new Response('not found', { status: 404 });
      return new Response(KML);
    },
  });
  const first = await request();
  assert.equal(first.status, 200);
  assert.equal(first.body.date, '20261020');
  assert.equal(first.body.stale, undefined);

  mode = 'down';
  now += 2 * 3_600_000;
  const stale = await request();
  assert.equal(stale.status, 200);
  assert.equal(stale.body.stale, true);
  assert.equal(stale.headers['X-Data-Stale'], 'true');
  assert.equal(stale.body.date, '20261020');

  const cold = install({
    fetchImpl: async () => new Response('<html>error</html>'),
  });
  const unavailable = await cold();
  assert.equal(unavailable.status, 503);
  assert.deepEqual(unavailable.body, { error: 'hms_unavailable' });
});

test('the route takes GET only, has no sub-routes, and limits each client', async () => {
  const request = install({ fetchImpl: async () => new Response(KML) });
  const post = await request('/', 'POST');
  assert.equal(post.status, 405);
  assert.equal(post.headers.Allow, 'GET');
  assert.equal((await request('/other')).status, 404);
  const statuses = [];
  for (let i = 0; i < 31; i++)
    statuses.push((await request('/', 'GET', 'peer')).status);
  assert.equal(statuses.at(-1), 429);
  assert.equal(statuses.filter((status) => status === 200).length, 30);
});

test('an oversized upstream body is refused, not read', async () => {
  const request = install({
    maxBytes: 100,
    fetchImpl: async () => new Response(KML),
  });
  assert.equal((await request()).status, 503);
});
