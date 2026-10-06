import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGeocoder,
  createRenumbering,
  describedPlaces,
  homeLine,
  locationFromDescription,
  manhattanKm,
  parseLocation,
  parseRenaming,
  renamingIndex,
  townOf,
} from '../scripts/build-chicago-homicides.mjs';

test('case descriptions give the crime location, not a residence', () => {
  assert.equal(
    locationFromDescription(
      'Anderson, Robert, 18 years old, killed with blow of baseball bat, 211 W. Polk St., by John McQuade, who escaped. W. 12th St. Station.',
    ),
    '211 W. Polk St.',
  );
  assert.equal(
    locationFromDescription(
      'Fisher, Peter, 52 yrs., died home 28th St. and Maplewood Av., from assault committed Feb. 11.',
    ),
    '28th St. and Maplewood Av.',
  );
  assert.equal(
    locationFromDescription(
      'Smith, John, of 5017 Rockwell St., shot dead in saloon, 2449 State St., by a stranger.',
    ),
    '2449 State St.',
  );
  // A police station is not a crime location.
  assert.equal(
    locationFromDescription('Shot by Officer Black, of 35th St. Station.'),
    null,
  );
  assert.equal(
    locationFromDescription('Fatally shot during riot at Kensington.'),
    null,
  );
});

test('recorded locations parse into addresses and corners', () => {
  assert.deepEqual(parseLocation('211 W. Polk St.'), {
    kind: 'address',
    number: 211,
    dir: 'W',
    name: 'POLK',
    avenue: false,
    type: 'ST',
  });
  const corner = parseLocation('12th & State sts.');
  assert.equal(corner.kind, 'intersection');
  assert.equal(corner.a.name, '12TH');
  assert.equal(corner.b.name, 'STATE');
});

test('the geocoder fills range gaps on a block and retries renamed streets', () => {
  const segments = [
    // State St. numbers 401–451 and 521–549: 464 falls in the gap.
    {
      f: 'a',
      t: 'b',
      dir: 'S',
      name: 'STATE',
      lf: 401,
      lt: 451,
      rf: 0,
      rt: 0,
      c: [
        [0, 0],
        [0, -1],
      ],
    },
    {
      f: 'b',
      t: 'c',
      dir: 'S',
      name: 'STATE',
      lf: 521,
      lt: 549,
      rf: 0,
      rt: 0,
      c: [
        [0, -1],
        [0, -2],
      ],
    },
    // 12th Place still exists; 12th St. is today's Roosevelt Rd.
    {
      f: 'x',
      t: 'y',
      dir: 'W',
      name: '12TH',
      lf: 1,
      lt: 99,
      rf: 0,
      rt: 0,
      c: [
        [5, 5],
        [6, 5],
      ],
    },
    {
      f: 'b',
      t: 'z',
      dir: 'W',
      name: 'ROOSEVELT',
      lf: 1,
      lt: 99,
      rf: 0,
      rt: 0,
      c: [
        [0, -1],
        [-1, -1],
      ],
    },
  ];
  const geocoder = createGeocoder(segments);
  assert.deepEqual(geocoder.address(464, 'S', { name: 'STATE' }), {
    lon: 0,
    lat: -1,
    northSouth: true,
  });
  assert.equal(geocoder.address(700, 'S', { name: 'STATE' }), null);
  assert.deepEqual(geocoder.intersection({ name: '12TH' }, { name: 'STATE' }), {
    lon: 0,
    lat: -1,
    multiple: false,
  });
});

test('residences are told apart from the crime location and measured on the grid', () => {
  assert.deepEqual(
    describedPlaces(
      'Smith, Mary, 20, of 6222 Ashland Av., died from abortion performed at 4759 Justine St. by Mrs. Jones, midwife, of 4800 Loomis St., who was arrested.',
    ),
    {
      crime: '4759 Justine St.',
      victimHome: '6222 Ashland Av.',
      defendantHome: '4800 Loomis St.',
    },
  );
  assert.equal(
    describedPlaces('Windwood, John, died, home, 184 Huron St., from assault.')
      .victimHome,
    '184 Huron St.',
  );
  // One mile east plus one mile north on Chicago's grid is two miles.
  const km = manhattanKm(
    { lon: -87.65, lat: 41.85 },
    {
      lon: -87.65 + 1.609 / (111.32 * Math.cos((41.857 * Math.PI) / 180)),
      lat: 41.85 + 1.609 / 110.574,
    },
  );
  assert.ok(Math.abs(km - 3.218) < 0.01);
  assert.match(
    homeLine(
      { who: 'victim', text: '6222 Ashland Av.', km, match: 'address' },
      'address',
    ),
    /^Residence of the victim: 6222 Ashland Av\. — 2\.0 mi \(3\.2 km\) from the crime location by the street grid \(Manhattan distance\)$/,
  );
  assert.match(
    homeLine(
      { who: 'victim', text: '185 Sangomon St.', km: 0.004, match: 'address' },
      'address',
    ),
    /the same address as the crime location$/,
  );
});

test("Martin's street-name changes parse into a former name, today's name and ranges", () => {
  assert.deepEqual(
    parseRenaming('-Milton Ave., Cleveland Ave. 460W 800 to 1200N.'),
    {
      from: 'MILTON',
      avenue: false,
      type: 'AVE',
      to: 'CLEVELAND',
      ranges: [{ lo: 800, hi: 1200, dir: 'N' }],
    },
  );
  assert.deepEqual(parseRenaming('-Armour Ave., 1600 to 5500S Federal St.'), {
    from: 'ARMOUR',
    avenue: false,
    type: 'AVE',
    to: 'FEDERAL',
    ranges: [{ lo: 1600, hi: 5500, dir: 'S' }],
  });
  assert.equal(
    parseRenaming(
      '-Water St., West Water St. both vacated 525W 400N to 600W 600N.',
    ),
    null,
  );
});

test("former names reach today's street only where the type and range fit", () => {
  const segment = (f, t, dir, name, lo, hi, c) => ({
    f,
    t,
    dir,
    name,
    lf: lo,
    lt: hi,
    rf: 0,
    rt: 0,
    c,
  });
  const segments = [
    // Today's short North Armour, and Federal St. where Armour Ave. ran.
    segment('a', 'b', 'N', 'ARMOUR', 600, 757, [
      [-87.66, 41.89],
      [-87.66, 41.895],
    ]),
    segment('c', 'd', 'S', 'FEDERAL', 3800, 3999, [
      [-87.63, 41.826],
      [-87.63, 41.823],
    ]),
    segment('e', 'f', 'W', 'WEBSTER', 2000, 2199, [
      [-87.68, 41.921],
      [-87.683, 41.921],
    ]),
  ];
  const renamings = renamingIndex([
    '-Armour Ave., 1600 to 5500S Federal St.',
    '-Armour St., 1600 to 2200W Webster Ave.',
  ]);
  const geocoder = createGeocoder(segments, { renamings });
  const avenue = geocoder.address(3901, null, { name: 'ARMOUR', type: 'AVE' });
  assert.equal(avenue.renamed, 'FEDERAL');
  // "Armour Ave." is not Armour St. (now Webster), even though 2108 fits.
  assert.equal(
    geocoder.address(2108, null, { name: 'ARMOUR', type: 'AVE' }),
    null,
  );
  // With no type written, both fit: no guess.
  assert.equal(geocoder.address(2108, null, { name: 'ARMOUR' }), null);
});

test('old house numbers convert with the 1909 renumbering tables', () => {
  const convert = createRenumbering([
    {
      heading: 'W POLK',
      dir: 'W',
      name: 'POLK',
      pairs: [
        [300, 100],
        [340, 120],
        [400, 150],
      ],
    },
    { heading: 'E POLK', dir: 'E', name: 'POLK', pairs: [[10, 100]] },
  ]);
  assert.deepEqual(convert(110, 'W', { name: 'POLK' }), {
    number: 320,
    dir: 'W',
  });
  // Without a direction the two parts of the street disagree: no answer.
  assert.equal(convert(100, null, { name: 'POLK' }), null);
  assert.equal(convert(100, 'W', { name: 'NOWHERE' }), null);
});

test('towns named instead of an address are found near Chicago only', () => {
  const towns = new Map([
    ['harvey', { lon: -87.65, lat: 41.61, name: 'Harvey', state: 'IL' }],
    ['peoria', { lon: -89.6, lat: 40.69, name: 'Peoria', state: 'IL' }],
  ]);
  assert.equal(townOf('Harvey, Ill.', towns).name, 'Harvey');
  assert.equal(townOf('Peoria, Ill.', towns), null);
  assert.equal(townOf('Racine Ave', towns), null);
});
