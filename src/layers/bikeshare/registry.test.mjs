// BIKESHARE REGISTRY — a city entry is only useful if the proxy will serve it.
//
// A registry entry and the GBFS proxy allowlist are edited in different files,
// so a city can look correctly registered while every one of its requests is
// rejected at the proxy. These cases hold the two together: each entry is
// checked against the same host and path predicates the proxy enforces, so a
// new city that the proxy would refuse fails here rather than silently
// rendering an empty layer.
//
// Ported from upstream God's Eye View PR #641, without its non-US (Toronto)
// cases; the moved-feed cases cover the US systems that left BCycle.
//
// Run with: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GBFS_CITY_REGISTRY, CITY_BY_ID } from './registry.js';
import { isAllowedGbfsHost, isAllowedGbfsPath } from '../../data/gbfsSource.js';

test('every registered city is reachable through the GBFS proxy allowlist', () => {
  for (const city of GBFS_CITY_REGISTRY) {
    for (const raw of [city.stationInformationUrl, city.stationStatusUrl]) {
      const url = new URL(raw);
      assert.equal(
        isAllowedGbfsHost(url.hostname),
        true,
        `${city.id}: host ${url.hostname} is not allowlisted`,
      );
      assert.equal(
        isAllowedGbfsPath(url.pathname),
        true,
        `${city.id}: path ${url.pathname} is not allowlisted`,
      );
    }
  }
});

test('systems that left BCycle point at their current feeds', () => {
  const expected = {
    'tucson-tugo':
      'https://tucson.publicbikesystem.net/customer/gbfs/v2/en/station_information.json',
    'fort-worth-trinity':
      'https://fortworth.publicbikesystem.net/customer/gbfs/v2/en/station_information.json',
    'buffalo-reddy':
      'https://reddybikeshare.socialbicycles.com/opendata/station_information.json',
  };
  for (const [id, informationUrl] of Object.entries(expected)) {
    const city = CITY_BY_ID.get(id);
    assert.ok(city, `${id} is missing from the registry`);
    assert.equal(city.stationInformationUrl, informationUrl);
    assert.equal(
      city.stationStatusUrl,
      informationUrl.replace('station_information', 'station_status'),
    );
  }
});

test('retired feeds are no longer registered', () => {
  for (const id of ['columbus-cogo', 'fort-lauderdale-broward'])
    assert.equal(CITY_BY_ID.has(id), false, `${id} is still registered`);
  for (const city of GBFS_CITY_REGISTRY) {
    for (const raw of [city.stationInformationUrl, city.stationStatusUrl]) {
      assert.doesNotMatch(
        raw,
        /cogobikeshare\.com|bcycle_(?:broward|tugo|fortworth|reddy)\//,
        `${city.id} still uses a retired feed`,
      );
    }
  }
});
