// Builds the in-app pipeline guide (public/guide/index.html) from docs/pipeline-guide/template.html.
// The how-to text on each step comes from the matching card in the user manual (docs/ktec-usage-guide.html),
// so the two stay in step: edit the manual, then run `node scripts/build-pipeline-guide.mjs`.
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manual = readFileSync(join(root, 'docs/ktec-usage-guide.html'), 'utf8');
const template = readFileSync(join(root, 'docs/pipeline-guide/template.html'), 'utf8');

// The manual's own styles for cards, role chips, buttons and status pills (everything before the hero band)
const styleStart = manual.indexOf('<style>') + '<style>'.length;
const styleEnd = manual.indexOf('/* ---------- Hero band');
if (styleStart < 7 || styleEnd < 0) throw new Error('Could not find the manual styles');
const baseCss = manual.slice(styleStart, styleEnd);

// Every heading the template asks for, then the whole <div class="card"> that holds it
const wanted = [...template.matchAll(/'([^']+)', '(?:[a-z]+ ?)+'\]/g)].map((m) => m[1]);
const cards = {};
for (const title of wanted) {
  const at = manual.indexOf(`<h3>${title.replace(/&/g, '&amp;')}</h3>`);
  if (at < 0) throw new Error(`No card in the manual with the heading: ${title}`);
  const start = manual.lastIndexOf('<div class="card"', at);
  let depth = 0;
  let i = start;
  const tag = /<\/?div\b[^>]*>/g;
  tag.lastIndex = start;
  let m;
  while ((m = tag.exec(manual))) {
    depth += m[0][1] === '/' ? -1 : 1;
    if (depth === 0) { i = m.index + m[0].length; break; }
  }
  cards[title] = manual.slice(start, i).replace(/ data-roles="[^"]*"/, '').replace(/ style="[^"]*"/, '');
}

const html = template
  .replace('/*BASE*/', () => baseCss)
  .replace('/*CARDS*/', () => JSON.stringify(cards).replace(/<\//g, '<\\/'));

const out = join(root, 'public/guide');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'index.html'), html);

// GSAP ships with the app, so the guide needs nothing from outside the site
const require = createRequire(import.meta.url);
const gsapDir = dirname(require.resolve('gsap/package.json'));
for (const f of ['gsap.min.js', 'ScrollTrigger.min.js']) copyFileSync(join(gsapDir, 'dist', f), join(out, f));
console.log(`public/guide/index.html: ${Object.keys(cards).length} how-to cards`);
