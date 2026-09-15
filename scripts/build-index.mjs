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

/* The index is styled as a classical publisher's catalogue: the School of Athens
 * as a hero, a Greek-key band, parchment, copper serif heads and bookplate cards.
 * No web fonts — Constantia/Palatino and Candara/Optima ship with Windows and macOS. */
const CSS = `
:root{
--bg:#f1e6d2;--panel:rgba(255,250,241,.8);--panel-solid:#fbf5ea;
--ink:#2a1b10;--ink-2:#5a3116;--ink-3:#7a5a40;
--cu:#853b0b;--rule:rgba(133,59,11,.26);--rule-2:rgba(133,59,11,.12);--umber:#1f130a;
--br:#2c5a4c;--vl:#7a3b1f;--kh:#3f4a86;--pl:#7a5c17;--wf:#6b3878;--bs:#8a2f4a;--fi:#116a75;--ir:#55661a;--neg:#9a3535;
--serif:Constantia,"Palatino Linotype",Palatino,"Book Antiqua",Charter,"Iowan Old Style",Georgia,serif;
--sans:Candara,Optima,"Gill Sans","Gill Sans MT","Segoe UI",ui-sans-serif,sans-serif;
--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
--shadow:0 1px 0 rgba(255,255,255,.6) inset,0 14px 28px -22px rgba(70,35,10,.55);
--noise:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .36 0 0 0 0 .22 0 0 0 0 .09 0 0 0 .16 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
--bg:#171009;--panel:rgba(44,31,20,.74);--panel-solid:#2a1e13;
--ink:#f0e4cf;--ink-2:#d8bf9b;--ink-3:#a88d6c;
--cu:#e2a26b;--rule:rgba(226,162,107,.28);--rule-2:rgba(226,162,107,.12);
--br:#7fc0aa;--vl:#e0a07c;--kh:#a3aee8;--pl:#dcc07a;--wf:#cda3d8;--bs:#e896ac;--fi:#6fc4cf;--ir:#b5c96f;--neg:#e89191;
--shadow:0 14px 30px -20px rgba(0,0,0,.8);
--noise:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 .86 0 0 0 0 .62 0 0 0 .07 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}}
:root[data-theme="dark"]{
--bg:#171009;--panel:rgba(44,31,20,.74);--panel-solid:#2a1e13;
--ink:#f0e4cf;--ink-2:#d8bf9b;--ink-3:#a88d6c;
--cu:#e2a26b;--rule:rgba(226,162,107,.28);--rule-2:rgba(226,162,107,.12);
--br:#7fc0aa;--vl:#e0a07c;--kh:#a3aee8;--pl:#dcc07a;--wf:#cda3d8;--bs:#e896ac;--fi:#6fc4cf;--ir:#b5c96f;--neg:#e89191;
--shadow:0 14px 30px -20px rgba(0,0,0,.8);
--noise:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 .86 0 0 0 0 .62 0 0 0 .07 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;color:var(--ink);background-color:var(--bg);
background-image:radial-gradient(1100px 620px at 8% 0%,rgba(221,153,51,.16),transparent 62%),
radial-gradient(900px 760px at 100% 55%,rgba(133,59,11,.08),transparent 60%),var(--noise);
font:17px/1.66 var(--serif);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a:focus-visible{outline:2px solid var(--cu);outline-offset:3px}

/* hero — the fresco, shaded so Plato and Aristotle stay clear under the arch */
.hero{position:relative;isolation:isolate;overflow:hidden;display:flex;align-items:flex-end;
min-height:clamp(560px,86vh,800px);background:var(--umber);color:#f7ecda}
.hero-img{position:absolute;inset:0;z-index:-2;background:#3b2717 url("assets/school-of-athens-1280.jpg") 50% 80%/cover no-repeat;
transform-origin:50% 42%;animation:drift 20s cubic-bezier(.2,.6,.2,1) both}
@media (min-width:900px){.hero-img{background-image:url("assets/school-of-athens-1920.jpg")}}
.hero::before{content:"";position:absolute;inset:0;z-index:-1;background:
linear-gradient(180deg,rgba(24,13,5,.62) 0%,rgba(24,13,5,.06) 22%,rgba(24,13,5,.12) 36%,rgba(20,11,4,.8) 60%,rgba(18,10,4,.97) 100%),
linear-gradient(90deg,rgba(24,13,5,.6) 0%,rgba(24,13,5,.1) 38%,transparent 60%),
linear-gradient(0deg,rgba(221,153,51,.1),rgba(221,153,51,.1))}
.topbar{position:absolute;top:0;left:0;right:0}
.topbar .in,.hero-in{max-width:1100px;margin:0 auto;padding-left:32px;padding-right:32px}
.topbar .in{padding-top:26px}
.mark{display:inline-flex;align-items:baseline;gap:12px;color:#f3dcb8;text-decoration:none;animation:rise .9s both}
.mark b{font:700 1.55rem/1 var(--serif);letter-spacing:.02em}
.mark span{font:700 10px/1 var(--sans);letter-spacing:.26em;text-transform:uppercase;color:rgba(243,220,184,.7)}
.hero-in{position:relative;width:100%;padding-bottom:68px;
display:grid;grid-template-columns:240px minmax(0,1fr);gap:56px;align-items:end}
.toc{position:relative;background:rgba(251,244,232,.94);color:#3a2413;border-radius:2px;padding:20px 20px 12px;
box-shadow:0 24px 50px -24px rgba(0,0,0,.75);animation:rise .9s .3s cubic-bezier(.2,.7,.2,1) both}
.toc::before{content:"";position:absolute;inset:5px;border:1px solid rgba(133,59,11,.22);pointer-events:none}
.toc b{display:block;font:700 10.5px/1 var(--sans);letter-spacing:.22em;text-transform:uppercase;color:#853b0b;margin:0 0 10px}
.toc a{position:relative;display:flex;justify-content:space-between;gap:12px;padding:8px 0;
border-top:1px solid rgba(133,59,11,.14);font:700 14px/1.2 var(--sans);color:#3a2413;text-decoration:none;
transition:color .2s,padding-left .2s}
.toc a span{font:400 12px/1.2 var(--mono);color:#9b7352}
.toc a:hover{color:#853b0b;padding-left:6px}
.hero-title{max-width:650px;animation:rise 1s .12s cubic-bezier(.2,.7,.2,1) both}
.hero .eyebrow{display:flex;align-items:center;gap:14px;margin:0 0 18px;
font:700 11px/1 var(--sans);letter-spacing:.3em;text-transform:uppercase;color:#e8b27a;text-shadow:0 1px 10px rgba(0,0,0,.9)}
.hero .eyebrow::before{content:"";width:34px;height:1px;background:#e8b27a}
.hero h1{margin:0 0 18px;font:700 clamp(2.5rem,5.6vw,4.6rem)/1 var(--serif);letter-spacing:-.012em;
color:#fbf2e3;text-shadow:0 2px 30px rgba(0,0,0,.5)}
.hero h1 .amp{font-style:italic;font-weight:400;color:#e8b27a}
.hero .sub{margin:0;max-width:540px;font:italic 400 1.14rem/1.55 var(--serif);color:#ecdcc3}
.credit{position:absolute;right:18px;bottom:12px;margin:0;font:400 10.5px/1.3 var(--sans);
letter-spacing:.05em;color:rgba(247,236,218,.58)}

/* Greek-key band */
.meander{height:26px;border-top:1px solid #6b4424;border-bottom:1px solid #6b4424;
background:var(--umber) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='24'%3E%3Cpath d='M0 20H28M22 20V4H7v12h11V9h-6' fill='none' stroke='%23c48a52' stroke-width='2'/%3E%3C/svg%3E") 0 50%/28px 24px repeat-x}

/* catalogue */
.wrap{max-width:960px;margin:0 auto;padding:62px 26px 56px}
.intro{position:relative;margin:0 0 12px;padding:26px 30px;background:var(--panel);border:1px solid var(--rule);
box-shadow:var(--shadow);font-size:17px;line-height:1.7;color:var(--ink-2)}
.intro::before{content:"";position:absolute;inset:6px;border:1px solid var(--rule-2);pointer-events:none}
.intro p{margin:0 0 12px}.intro p:last-child{margin:0}
.intro p:first-child::first-letter{float:left;padding:7px 10px 0 0;font:700 3.4em/.82 var(--serif);color:var(--cu)}
h2{display:flex;align-items:center;gap:18px;margin:70px 0 8px;scroll-margin-top:24px;
font:700 1.5rem/1.2 var(--serif);letter-spacing:.09em;text-transform:uppercase;color:var(--cu);text-align:center}
h2::before,h2::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,transparent,var(--cu))}
h2::after{background:linear-gradient(270deg,transparent,var(--cu))}
.gblurb{margin:0 0 26px;text-align:center;font:italic 400 15.5px/1.5 var(--serif);color:var(--ink-3)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:18px}
.card{--acc:var(--cu);position:relative;display:flex;flex-direction:column;min-width:0;
padding:22px 22px 16px;background:var(--panel);border:1px solid var(--rule);border-radius:2px;box-shadow:var(--shadow);
transition:transform .25s cubic-bezier(.2,.7,.2,1),box-shadow .25s,border-color .25s;
animation:rise .8s cubic-bezier(.2,.7,.2,1) both;animation-delay:calc(var(--i,0) * 55ms + 350ms)}
.card::before{content:"";position:absolute;inset:5px;border:1px solid var(--rule-2);pointer-events:none;transition:border-color .25s}
.card:hover{transform:translateY(-3px);border-color:var(--cu);box-shadow:0 22px 36px -24px rgba(70,35,10,.6)}
.card:hover::before{border-color:var(--rule)}
.card.t-review{--acc:var(--br)}.card.t-paper{--acc:var(--kh)}.card.t-master{--acc:var(--vl)}.card.t-note{--acc:var(--pl)}
.card.t-sweep{--acc:var(--wf)}.card.t-guide{--acc:var(--fi)}.card.t-map{--acc:var(--ir)}.card.t-other{--acc:var(--bs)}
.tag{display:flex;align-items:center;gap:8px;margin:0 0 11px;
font:700 9.6px/1 var(--sans);letter-spacing:.2em;text-transform:uppercase;color:var(--acc)}
.tag::before{content:"";width:6px;height:6px;background:var(--acc);transform:rotate(45deg)}
.card h3{margin:0 0 9px;font:700 15.6px/1.32 var(--serif);letter-spacing:.05em;text-transform:uppercase;color:var(--cu)}
.card h3 a{color:inherit;text-decoration:none;
background:linear-gradient(currentColor,currentColor) 0 100%/0 1px no-repeat;transition:background-size .3s}
.card h3 a:hover{background-size:100% 1px}
.card .d{flex:1;margin:0 0 16px;font:400 14.6px/1.55 var(--sans);color:var(--ink-2)}
.foot-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding-top:12px;border-top:1px solid var(--rule-2)}
.btn{display:inline-block;padding:8px 14px 7px;border:1px solid var(--cu);border-radius:2px;
font:700 10.5px/1 var(--sans);letter-spacing:.18em;text-transform:uppercase;color:var(--cu);text-decoration:none;
transition:background-color .2s,color .2s}
.btn:hover,.btn:focus-visible{background:var(--cu);color:var(--panel-solid)}
.si{padding:4px 6px;border:1px solid var(--wf);border-radius:2px;font:700 10px/1 var(--sans);letter-spacing:.06em;color:var(--wf)}
.kb{margin-left:auto;font:400 11.5px/1 var(--mono);color:var(--ink-3)}

.site-foot{background:var(--umber);color:#cdb391}
.site-foot .in{max-width:960px;margin:0 auto;padding:30px 26px 40px;font:400 13.8px/1.65 var(--sans)}
.site-foot p{margin:0 0 8px}.site-foot p:last-child{margin:0}
.site-foot i{font-family:var(--serif)}
.site-foot a{color:#e8b27a}

/* translate, not transform, so the finished animation does not pin the hover lift */
@keyframes rise{from{opacity:0;translate:0 14px}to{opacity:1;translate:none}}
@keyframes drift{from{transform:scale(1.09)}to{transform:scale(1)}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}html{scroll-behavior:auto}}

@media (max-width:820px){
.hero{min-height:clamp(600px,94vh,860px)}
.topbar .in,.hero-in{padding-left:20px;padding-right:20px}
.topbar .in{padding-top:20px}
.hero-in{grid-template-columns:1fr;gap:24px;padding-bottom:46px}
.hero-title{order:-1}
.toc{padding:14px 16px 10px}
.toc .links{display:flex;flex-wrap:wrap;column-gap:16px}
.toc a{border-top:0;padding:5px 0}
.toc a span{display:none}
.credit{right:12px;bottom:8px}
.wrap{padding:44px 18px 40px}
.intro{padding:20px}
h2{gap:12px;margin-top:54px;font-size:1.2rem}
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

  const card = (it, i, g) => `
      <article class="card t-${g.key}" style="--i:${Math.min(i, 8)}">
        ${it.tag ? `<div class="tag">${esc(it.tag)}</div>` : ''}
        <h3><a href="${esc(it.out)}">${esc(it.title)}</a></h3>
        <p class="d">${esc(it.sub || it.eyebrow || '')}</p>
        <div class="foot-row">
          <a class="btn" href="${esc(it.out)}">Read</a>
          ${it.pdf ? `<a class="btn" href="${esc(it.slug)}.pdf">PDF</a>` : ''}
          ${it.lang === 'si' ? '<span class="si" lang="si">සිංහල</span>' : ''}
          <span class="kb">${Math.round(it.bytes / 1024)} KB</span>
        </div>
      </article>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Plato &amp; the Socratic Question — a working corpus</title>
<meta name="description" content="Long-form research documents on Plato's early dialogues: chronology, the elenchus, definition, and the introduction of the Forms.">
<meta name="theme-color" content="#1f130a">
<link rel="preload" as="image" href="assets/school-of-athens-1920.jpg" media="(min-width: 900px)">
<link rel="preload" as="image" href="assets/school-of-athens-1280.jpg" media="(max-width: 899px)">
<style>${CSS}</style>
</head>
<body>

<header class="hero">
  <div class="hero-img" role="img" aria-label="Raphael, The School of Athens"></div>
  <div class="topbar"><div class="in">
    <a class="mark" href="./"><b lang="grc">τί ἐστι;</b><span>What is it?</span></a>
  </div></div>
  <div class="hero-in">
    <nav class="toc" aria-label="Sections">
      <b>Contents</b>
      <div class="links">
        ${live.map(g => `<a href="#${g.key}">${esc(g.label)}<span>${g.items.length}</span></a>`).join('\n        ')}
      </div>
    </nav>
    <div class="hero-title">
      <div class="eyebrow">A working corpus &middot; ${total} documents</div>
      <h1>Plato <span class="amp">&amp;</span> the Socratic Question</h1>
      <p class="sub">Chronology, the elenchus, the priority of definition, and the introduction of the Forms &mdash; read from the primary literature.</p>
    </div>
  </div>
  <p class="credit">Raphael, <i>The School of Athens</i>, 1509&ndash;11</p>
</header>
<div class="meander" aria-hidden="true"></div>

<main class="wrap">

<div class="intro">
  <p>These are working research documents, not finished publications. Each is self-contained: quotations carry their page, sources are listed at the end, and claims that are mine rather than a cited author&rsquo;s are marked as such.</p>
  <p>Several are long. Each opens with a map of its own argument, and most carry an interactive tree of the whole structure at the end.</p>
</div>

${live.map(g => `<h2 id="${g.key}">${esc(g.label)}</h2>
<p class="gblurb">${esc(g.blurb)}</p>
<div class="grid">${g.items.map((it, i) => card(it, i, g)).join('')}
</div>`).join('\n\n')}

</main>

<div class="meander" aria-hidden="true"></div>
<footer class="site-foot"><div class="in">
  <p>Generated ${new Date().toISOString().slice(0, 10)} &middot; ${total} documents. Quotations from the secondary literature are made for scholarly comment and criticism, and each is attributed with its page.</p>
  <p>Banner: Raphael, <i>The School of Athens</i> (1509&ndash;1511), Apostolic Palace, Vatican &mdash; public domain, via <a href="https://commons.wikimedia.org/wiki/File:%22The_School_of_Athens%22_by_Raffaello_Sanzio_da_Urbino.jpg">Wikimedia Commons</a>.</p>
</div></footer>

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

  /* Design assets for the index (the hero image) live in scripts/assets/. They are
   * part of the site, not the library, so ALLOW does not apply to them. */
  const ASSETS = join(ROOT, 'scripts', 'assets');
  if (existsSync(ASSETS)) {
    mkdirSync(join(OUT, 'assets'), { recursive: true });
    for (const n of readdirSync(ASSETS)) copyFileSync(join(ASSETS, n), join(OUT, 'assets', n));
  }
}

console.log(`\n${items.length} documents${DRY ? ' would be' : ''} published.`);
