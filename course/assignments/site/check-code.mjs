#!/usr/bin/env node
/**
 * Recomputes a student's completion code from the record line shown with it.
 *   node course/assignments/site/check-code.mjs "<record line>"
 * Prints the code that record should have; compare it with the code the student pasted.
 * Evidence of effort, not proof: the page code is public.
 */
import { createHash } from 'node:crypto';
const record = process.argv[2];
if (!record) throw new Error('Give the record line in quotes');
const hex = createHash('sha256').update(`hev-completion|${record}`).digest('hex').slice(0, 12).toUpperCase();
console.log(`${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`);
