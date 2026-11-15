#!/usr/bin/env node
/**
 * Turns STUDENT-INSTRUCTIONS.md into data/instructions.html, which the Instructions tab loads.
 * The Markdown file stays the one place the instructions are written (it is also what the handout
 * PDF is made from), so edit that file and run this script again:
 *
 *   node course/assignments/site/build-instructions.mjs
 *
 * It understands the small part of Markdown the file uses: headings, paragraphs, bullet lists
 * (one level of nesting), tables, horizontal rules, bold, italics, code and links (including
 * <https://...> addresses).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), 'utf8').replace(/\r\n/g, '\n');

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// inline: `code`, **bold**, *italic*, [text](url)
const inline = (s) => {
  const code = [];
  let t = s.replace(/`([^`]+)`/g, (_, c) => `\u0000${code.push(`<code>${esc(c)}</code>`) - 1}\u0000`);
  // <https://...> is a link that shows its own address
  t = t.replace(/<(https?:\/\/[^>\s]+)>/g, (_, u) => `\u0000${code.push(`<a href="${u}" target="_blank" rel="noopener">${esc(u)}</a>`) - 1}\u0000`);
  t = esc(t)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) =>
      (url.startsWith('#') ? `<a href="${url}">${text}</a>` : `<a href="${url}" target="_blank" rel="noopener">${text}</a>`))
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\*([^*]+)\*/g, '<i>$1</i>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, n) => code[Number(n)]);
};

function toHtml(md) {
const lines = md.split('\n');
const out = [];
const open = []; // open list tags, outermost first ('ul' or 'ol')
const closeLists = (to = 0) => { while (open.length > to) out.push(`</${open.pop()}>`); };
const openList = (tag, depth) => {
  if (open.length === depth && open[depth - 1] !== tag) closeLists(depth - 1);
  while (open.length < depth) { out.push(`<${tag}>`); open.push(tag); }
};

for (let i = 0; i < lines.length; i++) {
  const raw = lines[i];
  const line = raw.trim();
  if (line === '') { closeLists(); continue; }
  if (line === '---') { closeLists(); out.push('<hr>'); continue; }
  const head = line.match(/^(#{1,4})\s+(.*)$/);
  if (head) {
    closeLists();
    const level = Math.min(head[1].length + 1, 5); // # becomes h2: the page already has an h1
    const text = head[2].replace(/\s*\{#.*\}$/, '');
    const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); // so the links inside the page work
    out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
    continue;
  }
  // table: a header row, a |---| row, then body rows
  if (line.startsWith('|') && (lines[i + 1] || '').trim().match(/^\|[\s:|-]+\|$/)) {
    closeLists();
    const cells = (r) => r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    const head2 = cells(line);
    i += 2;
    const body = [];
    while (i < lines.length && lines[i].trim().startsWith('|')) body.push(cells(lines[i++]));
    i--;
    out.push('<div class="tablewrap"><table>');
    out.push(`<thead><tr>${head2.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>`);
    for (const r of body) out.push(`<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`);
    out.push('</tbody></table></div>');
    continue;
  }
  if (line.startsWith('> ')) { closeLists(); out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`); continue; }
  const bullet = raw.match(/^(\s*)[-*]\s+(.*)$/);
  if (bullet) {
    openList('ul', bullet[1].length >= 2 ? 2 : 1);
    closeLists(bullet[1].length >= 2 ? 2 : 1);
    out.push(`<li>${inline(bullet[2])}</li>`);
    continue;
  }
  const numbered = raw.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (numbered) {
    const depth = numbered[1].length >= 3 ? 2 : 1;
    const fresh = open.length < depth || open[depth - 1] !== 'ol';
    closeLists(depth);
    openList('ol', depth);
    // a list cut by a table carries on with its own number (7. after the table, not 1.)
    if (fresh && numbered[2] !== '1') out[out.length - 1] = `<ol start="${numbered[2]}">`;
    out.push(`<li>${inline(numbered[3])}</li>`);
    continue;
  }
  closeLists();
  out.push(`<p>${inline(line.replace(/\s{2,}$/, ''))}</p>`);
}
closeLists();

return out.join('\n');
}

writeFileSync(join(here, 'data', 'instructions.html'), toHtml(read('STUDENT-INSTRUCTIONS.md')));

// The two handouts (the assignment, and getting and checking the data) open first on the tab.
// The figure-download section is left out until the tool has that button.
const dropSection = (md, heading) => {
  const start = md.indexOf('### ' + heading);
  if (start < 0) return md;
  const end = md.indexOf('\n### ', start + 4);
  return md.slice(0, start) + (end < 0 ? '' : md.slice(end + 1));
};
const handouts = [
  read('HANDOUT-ASSIGNMENT.md')
    .replace('(see the separate data instructions handout)', '(see Getting and checking the data, below)')
    .replace(/ In the tool you choose the indicator.*?\(see the data instructions handout\)\./, ''),
  read('HANDOUT-DATA.md'),
].join('\n\n---\n\n');
writeFileSync(join(here, 'data', 'handouts.html'), toHtml(handouts));
console.log('data/instructions.html and data/handouts.html written');
