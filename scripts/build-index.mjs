#!/usr/bin/env node
/**
 * build-index.mjs — collect the publishable HTML documents and generate the site.
 *
 * Reads SOURCE (the working library), copies ONLY allowlisted deliverables into
 * docs/, and writes docs/index.html in the corpus house style.
 *
 * Safe by design: it never writes to SOURCE, and it copies by allowlist, never
 * by denylist, so third-party PDFs in the library can never reach the site.
 *
 * Usage:  node scripts/build-index.mjs [--source "C:\\Users\\chari\\Downloads\\plato"] [--dry]
 */

import { readdirSync, statSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, basename, extname, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes('--dry');

const SOURCE = argOf('--source', process.env.PLATO_SOURCE || 'C:\\Users\\chari\\Downloads\\plato');
const OUT    = join(ROOT, 'docs');

/* ------------------------------------------------------------------ *
 * ALLOWLIST — a file is published only if it matches one of these.
 * Add patterns here when you add a new document family.
 * ------------------------------------------------------------------ */
const ALLOW = [
  /^REVIEW .+\.html$/i,
  /^PAPER .+\.html$/i,
  /^MASTER .+\.html$/i,
  /^NOTE .+\.html$/i,
  /^SWEEP .+\.html$/i,
  /^ANTHOLOGY .+\.html$/i,
  /^The Historicity Gate.*\.html$/i,
  /^Bromberg .*\(mind map\)\.html$/i,
  /^_[A-Z-]+.*\.html$/,          // the underscore-prefixed set in the metaphysics folder
];

/* ------------------------------------------------------------------ *
 * PUBLISH-TIME TRANSFORMS — the one exception to copying verbatim.
 * The scholar portraits were sourced for private research. The library keeps
 * them; the published copy does not. Only documents matching a pattern here
 * are transformed — every other file is still copied byte-for-byte.
 * ------------------------------------------------------------------ */
const STRIP_PORTRAITS = [
  /^REVIEW Development and Design .+\.html$/i,
  /^MASTER development and design .+\.html$/i,   // the REVIEW's earlier draft; same portraits
];

/* The Sinhala document predates the aside.sch pattern and wraps each portrait in
 * <div class="wc ..."> instead. It already ships a placeholder for the one
 * scholar it has no photo of — <div class="ph0">R</div> — so the photos are
 * replaced with that same placeholder rather than simply deleted. */
const STRIP_WC_PORTRAITS = [
  /^_SINHALA-elenchus-to-forms\.html$/i,
];

/* Drop the <div class="pic ..."> and <div class="cap ..."> blocks inside every
 * <aside class="sch ...">, leaving the card's <div class="body"> — name, dates,
 * position, key works — untouched. The cards degrade gracefully without them. */
function stripPortraits(html) {
  let removed = 0;
  const out = html.replace(/<aside class="sch[^>]*>[\s\S]*?<\/aside>/g, a =>
    a.replace(/[ \t]*<div class="pic[^"]*">[\s\S]*?<\/div>\r?\n?/g, () => { removed++; return ''; })
     .replace(/[ \t]*<div class="cap[^"]*">[\s\S]*?<\/div>\r?\n?/g, ''));
  return { html: out, removed, imgsLeft: (out.match(/<img[^>]*>/g) || []).length };
}

/* Replace each embedded portrait with the document's own lettered placeholder,
 * taking the letter from the image's alt text, or failing that from the name on
 * the card that follows it — which is how the existing <div class="ph0">R</div>
 * for Richard Robinson reads. Images that are not data URIs are left alone. */
function stripWcPortraits(html) {
  let removed = 0;
  const out = html.replace(/<img[^>]*>/g, (tag, offset, str) => {
    if (!/src="data:image/.test(tag)) return tag;
    removed++;
    const alt = tag.match(/alt="([^"]*)"/);
    const nm  = str.slice(offset, offset + 600).match(/<div class="nm">\s*(\S)/);
    const letter = ((alt && alt[1].trim()[0]) || (nm && nm[1]) || '?').toUpperCase();
    return `<div class="ph0">${letter}</div>`;
  });
  return { html: out, removed, imgsLeft: (out.match(/<img[^>]*>/g) || []).length };
}

/* Safety guard. A document flagged above could one day be restructured so the
 * pattern no longer matches — and the portraits would then go out silently.
 * Fail loud rather than leak: a blocked deploy is cheap, a leak is not. */
function guardStrip(name, removed, imgsLeft) {
  if (removed === 0 || imgsLeft > 0) {
    console.error(`\n  ! ABORT: ${name}`);
    console.error(`    stripped ${removed} portrait block(s), ${imgsLeft} <img> tag(s) still present.`);
    console.error(`    The document's markup has changed. Fix STRIP_PORTRAITS before publishing.`);
    process.exit(1);
  }
}

/* A sibling PDF is a binary, and we cannot audit its contents the way we can the
 * HTML. This one was exported before the portraits were stripped and still
 * carries them, so it is withheld and the document publishes as HTML only.
 * Re-export it from the stripped HTML, then delete the pattern to restore the
 * download — the index links a PDF only when one is actually published. */
const NO_PDF = [
  /^REVIEW Development and Design .+\.html$/i,
];

/* Directories under SOURCE that may be scanned. Everything else is ignored. */
const SCAN_DIRS = ['.', 'platos metaphysics and epistemology'];

/* A sibling PDF is published only when its HTML twin is published. */
const PAIR_PDF = true;

const GROUPS = [
  { key: 'review',    test: n => /^REVIEW /i.test(n),                 label: 'Review articles',  blurb: 'Book- and chapter-length reviews of the secondary literature.' },
  { key: 'paper',     test: n => /^PAPER /i.test(n),                  label: 'Papers',           blurb: 'Standalone arguments, drafted for submission.' },
  { key: 'master',    test: n => /^MASTER |^_MASTER/i.test(n),        label: 'Master documents', blurb: 'The long working documents each project grew out of.' },
  { key: 'note',      test: n => /^NOTE /i.test(n),                   label: 'Notes',            blurb: 'Short pieces: corrections, comparisons, single findings.' },
  { key: 'sweep',     test: n => /^SWEEP |^ANTHOLOGY /i.test(n),      label: 'Sweeps and anthologies', blurb: 'Literature surveys and collected passages.' },
  { key: 'guide',     test: n => /^_START-HERE|^_PATH|^_CANON/i.test(n), label: 'Reading guides', blurb: 'Where to start, and in what order.' },
  { key: 'map',       test: n => /^_MAP|^_MINDMAP|^_FLOWCHART|Gate|mind map/i.test(n), label: 'Maps and flowcharts', blurb: 'Structure at a glance.' },
  { key: 'other',     test: () => true,                                label: 'Studies',          blurb: 'Comparisons, disputes and method notes.' },
];

const TAG = n => {
  const m = n.match(/^_?([A-Z][A-Z-]+)/);
  if (!m) return null;
  const t = m[1].replace(/-$/, '');
  return ['REVIEW','PAPER','MASTER','NOTE','SWEEP','ANTHOLOGY','START-HERE','PATH','CANON','MAP','MINDMAP','FLOWCHART','COMPARE','DEBATE','DISPUTE','DEVELOPMENT','METHOD','ARGUMENT','FINE','SINHALA'].includes(t) ? t : null;
};

/* ------------------------------------------------------------------ */

const dec = s => s
  .replace(/&mdash;/g, '\u2014').replace(/&ndash;/g, '\u2013')
  .replace(/&middot;/g, '\u00b7').replace(/&rsquo;/g, '\u2019').replace(/&lsquo;/g, '\u2018')
  .replace(/&ldquo;/g, '\u201c').replace(/&rdquo;/g, '\u201d').replace(/&hellip;/g, '\u2026')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&#8984;/g, '\u2318').replace(/&sect;/g, '\u00a7').replace(/\s+/g, ' ').trim();

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const strip = s => dec(s.replace(/<[^>]+>/g, ' '));

function meta(html, filename) {
  const t  = html.match(/<title>([\s\S]*?)<\/title>/i);
  const ey = html.match(/class="eyebrow"[^>]*>([\s\S]{0,240}?)<\/div>/i);
  const sb = html.match(/class="sub"[^>]*>([\s\S]{0,400}?)<\/p>/i);
  const ld = html.match(/class="lede"[^>]*>([\s\S]{0,400}?)<\/p>/i);

  let title = t ? dec(strip(t[1])) : basename(filename, extname(filename));
  let dash  = title.split(/\s+\u2014\s+/);            // "Main — subtitle"
  let head  = dash[0].trim();
  let tail  = dash.slice(1).join(' \u2014 ').trim();

  const sub = sb ? strip(sb[1]) : (tail || (ld ? strip(ld[1]) : ''));
  return {
    title: head,
    eyebrow: ey ? strip(ey[1]) : '',
    sub,
    fullTitle: title,
  };
}

function slug(name) {
  return basename(name, extname(name))
    .replace(/^_/, '')
    .replace(/\s*\([^)]*\)\s*$/, '')        // drop a trailing parenthetical
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72) || 'document';
}

function collect() {
  const items = [];
  for (const d of SCAN_DIRS) {
    const dir = d === '.' ? SOURCE : join(SOURCE, d);
    if (!existsSync(dir)) { console.warn(`  ! skipped (not found): ${dir}`); continue; }
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      let st; try { st = statSync(full); } catch { continue; }
      if (!st.isFile()) continue;
      if (!ALLOW.some(rx => rx.test(name))) continue;

      const html = readFileSync(full, 'utf8');
      const m = meta(html, name);
      const s = slug(name);
      const pdfSrc = join(dir, basename(name, extname(name)) + '.pdf');
      /* Transform now, not at copy time, so --dry reports the real published
       * size and trips the guard before anything is written. */
      const xform = STRIP_PORTRAITS.some(rx => rx.test(name))    ? stripPortraits(html)
                  : STRIP_WC_PORTRAITS.some(rx => rx.test(name)) ? stripWcPortraits(html)
                  : null;
      if (xform) guardStrip(name, xform.removed, xform.imgsLeft);
      items.push({
        src: full, name, dir: d, slug: s, out: s + '.html', xform,
        pdf: PAIR_PDF && !NO_PDF.some(rx => rx.test(name)) && existsSync(pdfSrc) ? pdfSrc : null,
        bytes: xform ? Buffer.byteLength(xform.html) : st.size, mtime: st.mtimeMs,
        tag: TAG(name), lang: /^_SINHALA/i.test(name) ? 'si' : 'en',
        ...m,
      });
    }
  }
  // stable, distinctive slugs
  const seen = new Map();
  for (const it of items) {
    const n = (seen.get(it.slug) || 0) + 1;
    seen.set(it.slug, n);
    if (n > 1) { it.slug = `${it.slug}-${n}`; it.out = it.slug + '.html'; }
  }
  return items.sort((a, b) => b.mtime - a.mtime);
}

const CSS = `
:root{--bg:#faf8f3;--panel:#fffefa;--ink:#16140f;--ink-2:#4b4438;--ink-3:#7d7566;
--rule:#e6dfd0;--rule-2:#f2ecdf;--br:#2c5a4c;--vl:#7a3b1f;--kh:#3f4a86;--pl:#7a5c17;
--wf:#6b3878;--bs:#8a2f4a;--fi:#116a75;--ir:#55661a;--neg:#9a3535;
--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
--sans:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
--bg:#14130f;--panel:#1c1a15;--ink:#f0ece2;--ink-2:#c4bcab;--ink-3:#8d8574;
--rule:#332f27;--rule-2:#26231d;--br:#7fc0aa;--vl:#e0a07c;--kh:#a3aee8;--pl:#dcc07a;
--wf:#cda3d8;--bs:#e896ac;--fi:#6fc4cf;--ir:#b5c96f;--neg:#e89191}}
:root[data-theme="dark"]{--bg:#14130f;--panel:#1c1a15;--ink:#f0ece2;--ink-2:#c4bcab;
--ink-3:#8d8574;--rule:#332f27;--rule-2:#26231d;--br:#7fc0aa;--vl:#e0a07c;--kh:#a3aee8;
--pl:#dcc07a;--wf:#cda3d8;--bs:#e896ac;--fi:#6fc4cf;--ir:#b5c96f;--neg:#e89191}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);
font:17.5px/1.66 Charter,"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
-webkit-font-smoothing:antialiased}
.wrap{max-width:960px;margin:0 auto;padding:0 26px 110px}
.title{padding:76px 0 30px;border-bottom:1px solid var(--rule);margin-bottom:44px;text-align:center}
.eyebrow{font:600 11px/1 var(--sans);letter-spacing:.2em;text-transform:uppercase;color:var(--br);margin-bottom:18px}
h1{font-size:2.9rem;line-height:1.08;margin:0 0 15px;font-weight:600;letter-spacing:-.03em}
.sub{font:400 1.06rem/1.5 var(--sans);color:var(--ink-2);margin:0 auto;max-width:640px}
.intro{background:var(--panel);border:1px solid var(--rule);border-left:4px solid var(--br);
border-radius:9px;padding:20px 24px;margin:0 0 50px;font-size:16.2px;line-height:1.62;color:var(--ink-2)}
.intro p{margin:0 0 10px}.intro p:last-child{margin:0}
h2{font:600 1.42rem/1.2 var(--sans);letter-spacing:-.02em;margin:52px 0 6px;
padding-bottom:9px;border-bottom:1px solid var(--rule)}
.gblurb{font:400 14.6px/1.5 var(--sans);color:var(--ink-3);margin:0 0 22px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}
.card{background:var(--panel);border:1px solid var(--rule);border-top:4px solid var(--rule);
border-radius:10px;padding:17px 19px 15px;display:flex;flex-direction:column;min-width:0}
.card.t-review{border-top-color:var(--br)}.card.t-paper{border-top-color:var(--kh)}
.card.t-master{border-top-color:var(--vl)}.card.t-note{border-top-color:var(--pl)}
.card.t-sweep{border-top-color:var(--wf)}.card.t-guide{border-top-color:var(--fi)}
.card.t-map{border-top-color:var(--ir)}.card.t-other{border-top-color:var(--bs)}
.tag{display:inline-block;font:700 9.4px/1 var(--sans);letter-spacing:.14em;text-transform:uppercase;
color:var(--ink-3);margin-bottom:8px}
.card h3{font:600 17.4px/1.28 var(--sans);letter-spacing:-.014em;margin:0 0 7px}
.card h3 a{color:inherit;text-decoration:none}
.card h3 a:hover{text-decoration:underline;text-underline-offset:3px}
.card .d{font:400 13.9px/1.52 var(--sans);color:var(--ink-2);margin:0 0 12px;flex:1}
.foot-row{display:flex;align-items:center;gap:12px;font:400 11.6px/1 var(--mono);color:var(--ink-3);
border-top:1px solid var(--rule-2);padding-top:10px}
.foot-row a{color:var(--br);text-decoration:none}.foot-row a:hover{text-decoration:underline}
.si{font:600 9.4px/1 var(--sans);letter-spacing:.1em;color:var(--wf);border:1px solid var(--wf);
border-radius:3px;padding:3px 5px}
footer{margin-top:70px;padding-top:22px;border-top:1px solid var(--rule);
font:400 13.6px/1.6 var(--sans);color:var(--ink-3)}
@media(max-width:640px){.wrap{padding:0 18px 70px}h1{font-size:2.1rem}.title{padding:44px 0 24px}
.grid{grid-template-columns:1fr}}
`;

function render(items) {
  const groups = GROUPS.map(g => ({ ...g, items: [] }));
  for (const it of items) {
    const g = groups.find(g => g.test(it.name));
    g.items.push(it);
  }
  const live = groups.filter(g => g.items.length);
  const total = items.length;

  const card = it => `
      <article class="card t-${live.find(g => g.items.includes(it)).key}">
        ${it.tag ? `<div class="tag">${esc(it.tag)}</div>` : ''}
        <h3><a href="${esc(it.out)}">${esc(it.title)}</a></h3>
        <p class="d">${esc(it.sub || it.eyebrow || '')}</p>
        <div class="foot-row">
          <a href="${esc(it.out)}">Read</a>
          ${it.pdf ? `<a href="${esc(it.slug)}.pdf">PDF</a>` : ''}
          <span>${Math.round(it.bytes / 1024)} KB</span>
          ${it.lang === 'si' ? '<span class="si">සිංහල</span>' : ''}
        </div>
      </article>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Plato &amp; the Socratic Question — a working corpus</title>
<meta name="description" content="Long-form research documents on Plato's early dialogues: chronology, the elenchus, definition, and the introduction of the Forms.">
<style>${CSS}</style>
</head>
<body>
<div class="wrap">

<div class="title">
  <div class="eyebrow">A working corpus &middot; ${total} documents</div>
  <h1>Plato &amp; the Socratic Question</h1>
  <p class="sub">Chronology, the elenchus, the priority of definition, and the introduction of the Forms &mdash; read from the primary literature.</p>
</div>

<div class="intro">
  <p>These are working research documents, not finished publications. Each is self-contained: quotations carry their page, sources are listed at the end, and claims that are mine rather than a cited author&rsquo;s are marked as such.</p>
  <p>Several are long. Each opens with a map of its own argument, and most carry an interactive tree of the whole structure at the end.</p>
</div>

${live.map(g => `<h2>${esc(g.label)}</h2>
<p class="gblurb">${esc(g.blurb)}</p>
<div class="grid">${g.items.map(card).join('')}
</div>`).join('\n\n')}

<footer>
  <p>Generated ${new Date().toISOString().slice(0, 10)} &middot; ${total} documents. Quotations from the secondary literature are made for scholarly comment and criticism, and each is attributed with its page.</p>
</footer>

</div>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ */

console.log(`source : ${SOURCE}`);
console.log(`output : ${OUT}${DRY ? '  (dry run — nothing written)' : ''}\n`);

const items = collect();
if (!items.length) { console.error('No documents matched the allowlist. Check --source.'); process.exit(1); }

for (const it of items) {
  console.log(`  ${it.tag ? it.tag.padEnd(11) : '           '} ${it.out.padEnd(46)} ${String(Math.round(it.bytes / 1024)).padStart(4)} KB${it.pdf ? '  +pdf' : ''}`);
  if (!it.sub) console.warn(`     ! no subtitle found — card will show the eyebrow or be blank`);
}

if (!DRY) {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const it of items) {
    const dest = join(OUT, it.out);
    if (it.xform) {
      writeFileSync(dest, it.xform.html, 'utf8');
      console.log(`  stripped ${it.xform.removed} portrait block(s) from ${it.out}`);
    } else {
      copyFileSync(it.src, dest);                    // verbatim
    }
    if (it.pdf) copyFileSync(it.pdf, join(OUT, it.slug + '.pdf'));
  }
  writeFileSync(join(OUT, 'index.html'), render(items), 'utf8');
  writeFileSync(join(OUT, '.nojekyll'), '', 'utf8');   // GitHub Pages: serve files starting with _
}

console.log(`\n${items.length} documents${DRY ? ' would be' : ''} published.`);
