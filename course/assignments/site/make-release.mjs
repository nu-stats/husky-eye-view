#!/usr/bin/env node
/**
 * Makes the fingerprint for the release word (the word you give a student at the meeting).
 *   node course/assignments/site/make-release.mjs "your word"
 * Paste the printed line over RELEASE_FINGERPRINT at the top of gates.js. The page keeps only
 * the fingerprint, not the word. (A nudge, not security: the page code is public.)
 */
import { createHash } from 'node:crypto';
const word = process.argv[2];
if (!word) throw new Error('Give the release word in quotes');
const fp = createHash('sha256').update(`hev-release-v1|${word.trim().toLowerCase()}`).digest('hex').slice(0, 16);
console.log(`const RELEASE_FINGERPRINT = '${fp}'; // release word set with make-release.mjs`);
