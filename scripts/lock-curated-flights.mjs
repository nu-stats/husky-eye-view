// Lock the Curated Flights city table for the repository: encrypt the plain
// table built by scripts/build-curated-flights.mjs (git-ignored, under
// data/source/curated/) into data/curated/curated-flights.json.enc.
//
// Curated Flights has its OWN key, separate from the research datasets key.
// This script reads it from the HEV_CURATED_FLIGHTS_KEY shell variable, or
// from a private key file outside the repository (--key-file, default
// ~/Documents/HuskyEyeView-backups/curated-flights-key.txt). With --generate
// and no key yet, a random key is created in that file. The key is never
// printed: share it privately.
//
// Usage: node scripts/lock-curated-flights.mjs [--key-file <path>] [--generate]
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  decryptResearchBuffer,
  encryptResearchText,
} from '../server/providers/research.js';
import { CURATED_FILE } from '../server/providers/curatedFlights.js';

const PLAINTEXT = 'data/source/curated/curated-flights.json';
const flag = process.argv.indexOf('--key-file');
const KEY_FILE =
  flag > 0 && process.argv[flag + 1]
    ? path.resolve(process.argv[flag + 1])
    : path.join(
        os.homedir(),
        'Documents',
        'HuskyEyeView-backups',
        'curated-flights-key.txt',
      );

/** The key is the first non-comment line of the key file. */
function readKeyFile() {
  if (!existsSync(KEY_FILE)) return '';
  return (
    readFileSync(KEY_FILE, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith('#')) || ''
  );
}

let key = String(process.env.HEV_CURATED_FLIGHTS_KEY || readKeyFile()).trim();
if (!key) {
  if (!process.argv.includes('--generate')) {
    console.error(
      `No Curated Flights key: set HEV_CURATED_FLIGHTS_KEY, put it in ${KEY_FILE}, or rerun with --generate.`,
    );
    process.exit(1);
  }
  key = `hev_cf_${randomBytes(24).toString('base64url')}`;
  mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  writeFileSync(
    KEY_FILE,
    `# Husky Eye View Curated Flights key (separate from the research key). Keep private.\n${key}\n`,
    { mode: 0o600 },
  );
  console.log(`Generated a Curated Flights key in ${KEY_FILE}.`);
}

if (!existsSync(PLAINTEXT)) {
  console.error(
    `${PLAINTEXT} is missing; run node scripts/build-curated-flights.mjs first.`,
  );
  process.exit(1);
}
const text = readFileSync(PLAINTEXT, 'utf8');
const locked = encryptResearchText(text, key);
if (decryptResearchBuffer(locked, key) !== text)
  throw new Error('curated flights: round trip failed');
mkdirSync('data/curated', { recursive: true });
const out = path.join('data', 'curated', CURATED_FILE);
writeFileSync(out, locked);
console.log(
  `${out}: ${JSON.parse(text).cities.length} cities, ${locked.length} bytes`,
);
