#!/usr/bin/env node
/**
 * build-descartes.mjs — builds docs/descartes/: the Descartes chat reviews from
 * Downloads\Descartes\chat-reviews. Adapted from build-index.mjs, whose notes
 * below still describe the shared machinery.
 *
 * Reads SOURCE (the working library), copies ONLY allowlisted deliverables into
 * docs/, and writes docs/index.html in the corpus house style.
 *
 * Safe by design: it never writes to SOURCE, and it copies by allowlist, never
 * by denylist, so third-party PDFs in the library can never reach the site.
 *
 * Usage:  node scripts/build-index.mjs [--source "C:\\Users\\chari\\Downloads\\plato"] [--dry]
 */

import { readdirSync, statSync, mkdirSync, copyFileSync, cpSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, basename, extname, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argOf = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DRY = args.includes('--dry');

const SOURCE = argOf('--source', process.env.DESCARTES_SOURCE || 'C:\\Users\\chari\\Downloads\\Descartes\\chat-reviews');
const OUT    = join(ROOT, 'docs', 'descartes');   // a second site inside the same Pages site

/* The author's own index.html would collide with the generated one, so it is
 * published under its own name. */
const RENAME = { 'index.html': 'reading-order' };

/* ------------------------------------------------------------------ *
 * ALLOWLIST — a file is published only if it matches one of these.
 * Add patterns here when you add a new document family.
 * ------------------------------------------------------------------ */
const ALLOW = [
  /^\d\d-[a-z0-9-]+\.html$/i,    // the numbered chat reviews
  /^index\.html$/i,              // the author's own index, republished as reading-order
];

/* ------------------------------------------------------------------ *
 * PUBLISH-TIME TRANSFORMS — the one exception to copying verbatim.
 * The scholar portraits were sourced for private research. The library keeps
 * them; the published copy does not. Only documents matching a pattern here
 * are transformed — every other file is still copied byte-for-byte.
 * ------------------------------------------------------------------ */
const STRIP_PORTRAITS = [];   // none of these documents carries an image

/* The Sinhala document predates the aside.sch pattern and wraps each portrait in
 * <div class="wc ..."> instead. It already ships a placeholder for the one
 * scholar it has no photo of — <div class="ph0">R</div> — so the photos are
 * replaced with that same placeholder rather than simply deleted. */
const STRIP_WC_PORTRAITS = [];

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
const NO_PDF = [];   // these documents have no sibling PDFs

/* Card artwork. scripts/art-credits.json maps a slug to a public-domain artwork,
 * and scripts/assets/art/<slug>.jpg is the cropped card image. A document with no
 * entry, or no file, simply gets a card without a picture. */
const ASSETS = join(ROOT, 'scripts', 'assets-descartes');
const ART_FILE = join(ROOT, 'scripts', 'art-credits-descartes.json');
const ART = existsSync(ART_FILE) ? JSON.parse(readFileSync(ART_FILE, 'utf8')) : {};
const artFor = slug => (ART[slug] && existsSync(join(ASSETS, 'art', slug + '.jpg')) ? ART[slug] : null);

/* A banner is added to the top of each published document at publish time; the
 * library copies are never touched. Documents that run as a full-screen app are
 * skipped — a banner in the page flow would break them. */
const NO_BANNER = new Set();   // every document here is an ordinary scrolling page

/* The artwork is shown whole, so that a tall portrait and a wide fresco both sit
 * in the same band without being cropped to a strip. Behind it, the same backdrop
 * on every document: Frans Hals's Descartes, darkened and slightly blurred so
 * the site name and the document's own artwork stay dominant. */
const BANNER_CSS = `<style>
.cogito-banner{position:relative;display:block;width:100%;height:clamp(190px,27vw,320px);
margin:0 0 28px;overflow:hidden;background:#1f130a;isolation:isolate}
.cogito-banner img{border:0;max-width:none}
.cogito-banner .cogito-bg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 42%;
filter:blur(1.5px) saturate(.8) brightness(.46)}
.cogito-banner .cogito-fg{position:absolute;top:0;bottom:0;right:clamp(14px,7vw,110px);height:100%;width:auto;
max-width:52%;object-fit:contain;box-shadow:0 0 48px rgba(0,0,0,.55)}
.cogito-banner .cogito-shade{position:absolute;inset:0;
background:linear-gradient(90deg,rgba(20,11,4,.8),rgba(20,11,4,.16) 58%),
linear-gradient(0deg,rgba(20,11,4,.5),transparent 42%)}
.cogito-banner .cogito-home{position:absolute;z-index:2;left:clamp(16px,4.5vw,52px);top:50%;transform:translateY(-50%);
font:700 clamp(2rem,4.8vw,3.5rem)/1 Constantia,"Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;
color:#fbf2e3;text-decoration:none;text-shadow:0 2px 26px rgba(0,0,0,.65)}
.cogito-banner .cogito-home span{color:#e8b27a;font-weight:400}
.cogito-banner .cogito-home:hover{color:#e8b27a}
.cogito-banner .cogito-cap{position:absolute;z-index:2;right:14px;bottom:9px;margin:0;max-width:62%;text-align:right;
font:400 10.5px/1.45 ui-sans-serif,system-ui,"Segoe UI",sans-serif;letter-spacing:.04em;color:rgba(247,236,218,.7)}
@media (max-width:640px){
.cogito-banner{height:clamp(150px,42vw,210px)}
.cogito-banner .cogito-fg{max-width:60%;right:10px}
.cogito-banner .cogito-home{font-size:1.75rem;left:15px}
.cogito-banner .cogito-cap{display:none}}
@media print{.cogito-banner{display:none}}
</style>`;

/* Insert after <body> when there is one. Three documents are fragments that open
 * with <title> and <style>, so there the anchor is the first </style> — putting
 * the banner before the <title> would push it out of the head and lose it. */
/* These documents already carry their own masthead — <div class="dc-banner"> with
 * the Cogito? link, the motto and the chat caption — so a second banner would only
 * repeat it. Where that masthead exists the painting goes behind it instead, under
 * gradients that keep the existing text legible. The full banner below is the
 * fallback for a document written without one. */
function paintMasthead(html, slug, art) {
  return `<style>
.dc-banner{position:relative;isolation:isolate;overflow:hidden}
.dc-banner::before{content:"";position:absolute;inset:0;z-index:-2;
background:#1f130a url("assets/banner/${slug}.jpg") 50% 34%/cover no-repeat}
.dc-banner::after{content:"";position:absolute;inset:0;z-index:-1;
background:linear-gradient(90deg,rgba(20,11,4,.88),rgba(20,11,4,.34) 55%,rgba(20,11,4,.6)),
linear-gradient(0deg,rgba(20,11,4,.72),rgba(20,11,4,.08) 62%)}
.dc-banner .dc-art-credit{position:absolute;z-index:1;right:12px;bottom:8px;margin:0;
font:400 10.5px/1.4 ui-sans-serif,system-ui,"Segoe UI",sans-serif;letter-spacing:.04em;color:rgba(247,236,218,.62)}
@media print{.dc-banner::before,.dc-banner::after{display:none}}
</style>`;
}

function addBanner(html, slug, art) {
  if (/class="dc-banner"/.test(html)) {
    const css = paintMasthead(html, slug, art);
    const credit = `<p class="dc-art-credit">${esc(art.caption)}</p>`;
    const painted = html.replace(/(<div class="dc-banner">)/, `$1\n  ${credit}`);
    const i = painted.search(/<\/style>/i);
    if (i >= 0) { const j = i + '</style>'.length; return painted.slice(0, j) + '\n' + css + painted.slice(j); }
    const b = painted.match(/<body[^>]*>/i);
    if (b) return painted.replace(b[0], b[0] + '\n' + css);
    return null;
  }
  const block = `${BANNER_CSS}
<div class="cogito-banner">
  <img class="cogito-bg" src="assets/banner-bg.jpg" alt="" aria-hidden="true">
  <img class="cogito-fg" src="assets/banner/${slug}.jpg" alt="${esc(art.caption)}">
  <div class="cogito-shade"></div>
  <a class="cogito-home" href="./" title="Cogito? — all pages">Cogito<span>?</span></a>
  <p class="cogito-cap">${esc(art.caption)}</p>
</div>`;
  const body = html.match(/<body[^>]*>/i);
  if (body) return html.replace(body[0], body[0] + '\n' + block);
  const i = html.search(/<\/style>/i);
  if (i >= 0) { const j = i + '</style>'.length; return html.slice(0, j) + '\n' + block + html.slice(j); }
  return null;
}

/* Private notes, for the author only. Hypothesis loads only in a browser that has
 * been switched on by visiting any page with ?notes=on (and off with ?notes=off);
 * the setting is per browser and covers all three sites, which share an origin.
 * Every other reader never fetches Hypothesis and never sees its sidebar. */
const NOTES_JS = `<script>
(function () {
  try {
    var q = location.search;
    if (/[?&]notes=on(&|$)/.test(q)) localStorage.setItem('lyceum-notes', 'on');
    if (/[?&]notes=off(&|$)/.test(q)) localStorage.removeItem('lyceum-notes');
    if (localStorage.getItem('lyceum-notes') !== 'on') return;
  } catch (e) { return; }
  var c = document.createElement('script');
  c.type = 'application/json'; c.className = 'js-hypothesis-config';
  c.textContent = JSON.stringify({ openSidebar: false, showHighlights: 'always' });
  document.head.appendChild(c);
  var s = document.createElement('script');
  s.src = 'https://hypothes.is/embed.js'; s.async = true;
  document.head.appendChild(s);
})();
</script>`;
const addNotes = html => {
  const i = html.toLowerCase().lastIndexOf('</body>');
  return i >= 0 ? html.slice(0, i) + NOTES_JS + '\n' + html.slice(i) : html + '\n' + NOTES_JS + '\n';
};

/* Directories under SOURCE that may be scanned. Everything else is ignored. */
const SCAN_DIRS = ['.'];

/* A sibling PDF is published only when its HTML twin is published. */
const PAIR_PDF = true;

/* The nine reviews in the order they were written, read as one argument: what the
 * doubt is and whether it holds, what the cogito is once reconstructed, and how
 * Descartes ought to be studied. The author's own index opens the site. */
const GROUPS = [
  { key: 'start',  test: n => /^index\.html$/i.test(n),  label: 'Start here',
    blurb: 'The reading order, the threads that run through the nine, and what the reviews found.' },
  { key: 'doubt',  test: n => /^0[123]-/.test(n),        label: 'The doubt',
    blurb: 'How far the doubt reaches, what it is answerable to, and what it cannot touch.' },
  { key: 'cogito', test: n => /^0[456]-/.test(n),        label: 'The cogito',
    blurb: 'The first certainty reconstructed: as inference, as performance, and on the substance theory.' },
  { key: 'method', test: () => true,                     label: 'Reading Descartes',
    blurb: 'How he has been studied, what the quarrel was in French, and what stands before the cogito.' },
];

const TAG = n => (/^index\.html$/i.test(n) ? 'READING ORDER' : 'REVIEW');

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
      const s = RENAME[name.toLowerCase()] || slug(name);
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

/* The painting pinned behind the catalogue. Each scene backs the groups it lists;
 * a group not listed anywhere joins the last scene. Files: scripts/assets/scene/. */
const SCENES = [
  { img: 'scene', caption: 'Rembrandt, The Anatomy Lesson of Dr Nicolaes Tulp, 1632',
    groups: ['start', 'doubt', 'cogito', 'method'] },
];

/* Depth by parallax: the painting is shown as three layers cut from the same file
 * — the figure in front, the group behind him, and the room behind them. As you
 * scroll they drift at different rates, the near one furthest, which is what the
 * eye reads as depth. Motion follows the scroll position only: no rocking, no
 * turning, no pointer. Skipped under prefers-reduced-motion. */
const SCENE_JS = `<script>
(() => {
  const scenes = [...document.querySelectorAll('.scene')];
  if (!scenes.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  // total drift and size for each layer, near to far. Drift is measured against
  // progress through the whole catalogue, not raw pixels, so no layer ever slides
  // out of frame however long the page is.
  /* One layer here. The Anatomy Lesson is a crowded composition: cutting it into
   * masked layers put the same faces in two of them, and the offset copies read
   * as a doubled image rather than as depth. A single layer drifting behind the
   * cards keeps the parallax without any duplication. */
  const DEPTH = { back: [90, 1] };
  let queued = false;
  function frame() {
    queued = false;
    const vh = innerHeight;
    for (const s of scenes) {
      const r = s.getBoundingClientRect();
      if (r.bottom < -vh || r.top > 2 * vh) continue;
      const t = clamp(-r.top / Math.max(1, r.height - vh), 0, 1);
      for (const layer of s.querySelectorAll('.layer')) {
        const d = DEPTH[layer.dataset.depth];
        if (d) layer.style.transform = 'translate3d(0,' + (-t * d[0]).toFixed(1) + 'px,0) scale(' + d[1] + ')';
      }
      const veil = s.querySelector('.scene-veil');
      if (veil) veil.style.opacity = (0.95 - clamp(1 - r.top / vh, 0, 1) * 0.33).toFixed(3);
    }
  }
  function request() { if (!queued) { queued = true; requestAnimationFrame(frame); } }
  addEventListener('scroll', request, { passive: true });
  addEventListener('resize', request);
  request();
})();
</script>`;

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
--veil:linear-gradient(180deg,#f1e6d2 0%,rgba(241,230,210,.8) 18%,rgba(241,230,210,.7) 50%,rgba(241,230,210,.8) 82%,#f1e6d2 100%);
--noise:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 .36 0 0 0 0 .22 0 0 0 0 .09 0 0 0 .16 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
--bg:#171009;--panel:rgba(44,31,20,.74);--panel-solid:#2a1e13;
--ink:#f0e4cf;--ink-2:#d8bf9b;--ink-3:#a88d6c;
--cu:#e2a26b;--rule:rgba(226,162,107,.28);--rule-2:rgba(226,162,107,.12);
--br:#7fc0aa;--vl:#e0a07c;--kh:#a3aee8;--pl:#dcc07a;--wf:#cda3d8;--bs:#e896ac;--fi:#6fc4cf;--ir:#b5c96f;--neg:#e89191;
--shadow:0 14px 30px -20px rgba(0,0,0,.8);
--veil:linear-gradient(180deg,#171009 0%,rgba(23,16,9,.82) 18%,rgba(23,16,9,.72) 50%,rgba(23,16,9,.82) 82%,#171009 100%);
--noise:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 .86 0 0 0 0 .62 0 0 0 .07 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}}
:root[data-theme="dark"]{
--bg:#171009;--panel:rgba(44,31,20,.74);--panel-solid:#2a1e13;
--ink:#f0e4cf;--ink-2:#d8bf9b;--ink-3:#a88d6c;
--cu:#e2a26b;--rule:rgba(226,162,107,.28);--rule-2:rgba(226,162,107,.12);
--br:#7fc0aa;--vl:#e0a07c;--kh:#a3aee8;--pl:#dcc07a;--wf:#cda3d8;--bs:#e896ac;--fi:#6fc4cf;--ir:#b5c96f;--neg:#e89191;
--shadow:0 14px 30px -20px rgba(0,0,0,.8);
--veil:linear-gradient(180deg,#171009 0%,rgba(23,16,9,.82) 18%,rgba(23,16,9,.72) 50%,rgba(23,16,9,.82) 82%,#171009 100%);
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
.hero-img{position:absolute;inset:0;z-index:-2;background:#3b2717 url("assets/hero-1280.jpg") 50% 46%/cover no-repeat;
transform-origin:50% 42%;animation:drift 20s cubic-bezier(.2,.6,.2,1) both}
@media (min-width:900px){.hero-img{background-image:url("assets/hero-1920.jpg")}}
.hero::before{content:"";position:absolute;inset:0;z-index:-1;background:
linear-gradient(180deg,rgba(24,13,5,.62) 0%,rgba(24,13,5,.06) 22%,rgba(24,13,5,.12) 36%,rgba(20,11,4,.8) 60%,rgba(18,10,4,.97) 100%),
linear-gradient(90deg,rgba(24,13,5,.6) 0%,rgba(24,13,5,.1) 38%,transparent 60%),
linear-gradient(0deg,rgba(221,153,51,.1),rgba(221,153,51,.1))}
.hero-in{position:relative;width:100%;max-width:1100px;margin:0 auto;padding:0 32px 68px;text-align:center}
/* the site's name — τί ἐστι; — is the largest thing on the page */
.hero-title{animation:rise 1s .12s cubic-bezier(.2,.7,.2,1) both}
.hero h1{margin:0;font:700 clamp(4.4rem,15vw,13rem)/.92 var(--serif);letter-spacing:-.005em;
color:#fbf2e3;text-shadow:0 4px 44px rgba(0,0,0,.6);white-space:nowrap}
.hero h1 .q{font-weight:400;color:#e8b27a}
.gloss{display:flex;align-items:center;justify-content:center;gap:16px;margin:22px 0 0;
font:700 12.5px/1 var(--sans);letter-spacing:.34em;text-transform:uppercase;color:#e8b27a;text-shadow:0 1px 10px rgba(0,0,0,.9)}
.gloss::before,.gloss::after{content:"";width:44px;height:1px;background:#e8b27a}
.gloss i{font:italic 400 1.45rem/1 var(--serif);letter-spacing:0;text-transform:none;color:#ecdcc3}
.credit{position:absolute;right:18px;bottom:12px;margin:0;font:400 10.5px/1.3 var(--sans);
letter-spacing:.05em;color:rgba(247,236,218,.58)}

/* Greek-key band */
.meander{height:26px;border-top:1px solid #6b4424;border-bottom:1px solid #6b4424;
background:var(--umber) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='24'%3E%3Cpath d='M0 20H28M22 20V4H7v12h11V9h-6' fill='none' stroke='%23c48a52' stroke-width='2'/%3E%3C/svg%3E") 0 50%/28px 24px repeat-x}

/* catalogue */
.wrap{max-width:960px;margin:0 auto;padding:62px 26px 56px}
/* one collection within τί ἐστι; */
.part{margin:0 0 34px;text-align:center;scroll-margin-top:24px}
.part-eyebrow{display:inline-flex;align-items:center;gap:12px;margin:0 0 14px;
font:700 11px/1 var(--sans);letter-spacing:.28em;text-transform:uppercase;color:var(--ink-3)}
.part-eyebrow::before,.part-eyebrow::after{content:"";width:28px;height:1px;background:var(--cu)}
.part-title{margin:0 0 12px;font:700 clamp(2.1rem,4.6vw,3.3rem)/1.05 var(--serif);letter-spacing:-.01em;color:var(--cu)}
.part-title .amp{font-style:italic;font-weight:400}
.part-sub{margin:0 auto;max-width:600px;font:italic 400 1.12rem/1.55 var(--serif);color:var(--ink-2)}
.intro{position:relative;margin:0 0 12px;padding:26px 30px;background:var(--panel);border:1px solid var(--rule);
box-shadow:var(--shadow);font-size:17px;line-height:1.7;color:var(--ink-2)}
.intro::before{content:"";position:absolute;inset:6px;border:1px solid var(--rule-2);pointer-events:none}
.intro p{margin:0 0 12px}.intro p:last-child{margin:0}
.intro p:first-child::first-letter{float:left;padding:7px 10px 0 0;font:700 3.4em/.82 var(--serif);color:var(--cu)}
.group{display:flex;align-items:center;gap:18px;margin:70px 0 8px;scroll-margin-top:24px;
font:700 1.5rem/1.2 var(--serif);letter-spacing:.09em;text-transform:uppercase;color:var(--cu);text-align:center}
.group::before,.group::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,transparent,var(--cu))}
.group::after{background:linear-gradient(270deg,transparent,var(--cu))}
.gblurb{margin:0 0 26px;text-align:center;font:italic 400 15.5px/1.5 var(--serif);color:var(--ink-3)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:18px}

/* scenes — a painting pinned full-screen behind each pair of groups. The art is
 * sticky for the length of its section; the veil keeps the cards readable and
 * fades to the page colour at top and bottom so one scene hands over to the next. */
.scene{position:relative}
.scene-art{position:sticky;top:0;height:100vh;height:100svh;margin-bottom:-100vh;margin-bottom:-100svh;
overflow:hidden;pointer-events:none}
/* One layer, overscanned so its edges never enter the frame as it drifts, and
 * blurred enough that the cards stay clear. The masked multi-layer treatment used
 * on the Plato site is deliberately not used here: the Anatomy Lesson is too
 * crowded for it — the same faces landed in two layers and read as a doubled
 * image rather than as depth. */
.scene-art .layer{position:absolute;left:-6%;top:-16%;width:112%;height:134%;max-width:none;object-fit:cover;
will-change:transform}
.scene-art .layer[data-depth="back"]{filter:blur(6px) saturate(.85) brightness(.94)}
.scene-veil{position:absolute;inset:0;background:var(--veil);opacity:.72;will-change:opacity}
.scene > .wrap{position:relative;z-index:1;padding-top:8px;padding-bottom:110px}
.scene .group,.scene .gblurb{text-shadow:0 0 18px var(--bg),0 0 4px var(--bg)}
.scene .card{-webkit-backdrop-filter:blur(6px) saturate(1.05);backdrop-filter:blur(6px) saturate(1.05)}
.card{--acc:var(--cu);position:relative;display:flex;flex-direction:column;min-width:0;
padding:22px 22px 16px;background:var(--panel);border:1px solid var(--rule);border-radius:2px;box-shadow:var(--shadow);
transition:transform .25s cubic-bezier(.2,.7,.2,1),box-shadow .25s,border-color .25s;
animation:rise .8s cubic-bezier(.2,.7,.2,1) both;animation-delay:calc(var(--i,0) * 55ms + 350ms)}
.card::before{content:"";position:absolute;inset:5px;border:1px solid var(--rule-2);pointer-events:none;transition:border-color .25s;z-index:1}
/* the artwork sits flush inside the card's inner rule (card padding 22 - inset 5) */
.art{margin:-17px -17px 15px;overflow:hidden;border-bottom:1px solid var(--rule);background:#2a1c10}
.art img{display:block;width:100%;height:auto;aspect-ratio:3/2;object-fit:cover;
filter:saturate(.94) contrast(1.02);transition:transform .5s cubic-bezier(.2,.7,.2,1)}
.card:hover .art img{transform:scale(1.035)}
.card:hover{transform:translateY(-3px);border-color:var(--cu);box-shadow:0 22px 36px -24px rgba(70,35,10,.6)}
.card:hover::before{border-color:var(--rule)}
.card.t-review{--acc:var(--br)}.card.t-paper{--acc:var(--kh)}.card.t-master{--acc:var(--vl)}.card.t-note{--acc:var(--pl)}
.card.t-sweep{--acc:var(--wf)}.card.t-guide{--acc:var(--fi)}.card.t-map{--acc:var(--ir)}.card.t-other{--acc:var(--bs)}
.tag{display:flex;align-items:center;gap:8px;margin:0 0 11px;
font:700 9.6px/1 var(--sans);letter-spacing:.2em;text-transform:uppercase;color:var(--acc)}
.tag::before{content:"";width:6px;height:6px;background:var(--acc);transform:rotate(45deg)}
.card h4{margin:0 0 9px;font:700 15.6px/1.32 var(--serif);letter-spacing:.05em;text-transform:uppercase;color:var(--cu)}
.card h4 a{color:inherit;text-decoration:none;
background:linear-gradient(currentColor,currentColor) 0 100%/0 1px no-repeat;transition:background-size .3s}
.card h4 a:hover{background-size:100% 1px}
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
.site-foot details{margin-top:14px}
.site-foot summary{cursor:pointer;font-weight:700;letter-spacing:.04em}
.site-foot details ul{margin:10px 0 0;padding-left:18px;columns:2;column-gap:34px;font-size:12.6px;line-height:1.5}
.site-foot details li{margin:0 0 5px;break-inside:avoid}
@media (max-width:640px){.site-foot details ul{columns:1}}

/* translate, not transform, so the finished animation does not pin the hover lift */
@keyframes rise{from{opacity:0;translate:0 14px}to{opacity:1;translate:none}}
@keyframes drift{from{transform:scale(1.09)}to{transform:scale(1)}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}html{scroll-behavior:auto}}

@media (max-width:820px){
.hero{min-height:clamp(600px,94vh,860px)}
.hero-in{padding:0 20px 46px}
.hero h1{font-size:min(26vw,11rem)}
.gloss{gap:12px;letter-spacing:.26em}.gloss::before,.gloss::after{width:28px}.gloss i{font-size:1.2rem}
.credit{right:12px;bottom:8px}
.wrap{padding:44px 18px 40px}
.scene > .wrap{padding-top:4px;padding-bottom:80px}
.intro{padding:20px}
.group{gap:12px;margin-top:54px;font-size:1.2rem}
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
  const credits = items.map(it => artFor(it.slug)).filter(Boolean);

  const card = (it, i, g) => `
      <article class="card t-${g.key}" style="--i:${Math.min(i, 8)}">
        ${artFor(it.slug) ? `<div class="art"><img src="assets/art/${esc(it.slug)}.jpg" alt="${esc(artFor(it.slug).caption)}" loading="lazy" decoding="async" width="720" height="480"></div>` : ''}
        ${it.tag ? `<div class="tag">${esc(it.tag)}</div>` : ''}
        <h4><a href="${esc(it.out)}">${esc(it.title)}</a></h4>
        <p class="d">${esc(it.sub || it.eyebrow || '')}</p>
        <div class="foot-row">
          <a class="btn" href="${esc(it.out)}">Read</a>
          ${it.pdf ? `<a class="btn" href="${esc(it.slug)}.pdf">PDF</a>` : ''}
          ${it.lang === 'si' ? '<span class="si" lang="si">සිංහල</span>' : ''}
          <span class="kb">${Math.round(it.bytes / 1024)} KB</span>
        </div>
      </article>`;

  const groupHtml = g => `<h3 class="group" id="${g.key}">${esc(g.label)}</h3>
<p class="gblurb">${esc(g.blurb)}</p>
<div class="grid">${g.items.map((it, i) => card(it, i, g)).join('')}
</div>`;

  // each painting backs the live groups it lists; unlisted groups join the last scene
  const scenes = SCENES
    .filter(s => existsSync(join(ASSETS, 'scene', s.img + '.jpg')))
    .map(s => ({ ...s, groups: live.filter(g => s.groups.includes(g.key)) }))
    .filter(s => s.groups.length);
  const placed = new Set(scenes.flatMap(s => s.groups.map(g => g.key)));
  const rest = live.filter(g => !placed.has(g.key));
  if (rest.length && scenes.length) scenes[scenes.length - 1].groups.push(...rest);

  const sceneHtml = scenes.length
    ? scenes.map(s => `<section class="scene">
  <div class="scene-art" aria-hidden="true">
    <img class="layer" data-depth="back" src="assets/scene/${s.img}.jpg" alt="" loading="lazy" decoding="async">
    <div class="scene-veil"></div>
  </div>
  <div class="wrap">
${s.groups.map(groupHtml).join('\n\n')}
  </div>
</section>`).join('\n\n')
    : `<div class="wrap">\n${live.map(groupHtml).join('\n\n')}\n</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cogito? · Descartes</title>
<meta name="description" content="Cogito? — nine research chats on Descartes, each reviewed against the literature: the method of doubt, the immunity of the cogito, Hintikka's performative reading, Dicker on substance, Alquié and Gueroult, and Menn on Augustine.">
<meta name="theme-color" content="#1f130a">
<link rel="preload" as="image" href="assets/hero-1920.jpg" media="(min-width: 900px)">
<link rel="preload" as="image" href="assets/hero-1280.jpg" media="(max-width: 899px)">
<style>${CSS}</style>
</head>
<body>

<header class="hero">
  <div class="hero-img" role="img" aria-label="Pierre-Louis Dumesnil, Queen Christina of Sweden and Descartes"></div>
  <div class="hero-in">
    <div class="hero-title">
      <h1>Cogito<span class="q">?</span></h1>
      <p class="gloss">Descartes <i>Do I think?</i></p>
    </div>
  </div>
  <p class="credit">Pierre-Louis Dumesnil, <i>Queen Christina of Sweden and Descartes</i></p>
</header>
<div class="meander" aria-hidden="true"></div>

<main>

<div class="wrap">
<div class="part" id="plato">
  <div class="part-eyebrow">Nine chats, reviewed &middot; ${total} pages</div>
  <h2 class="part-title">The Descartes Project</h2>
  <p class="part-sub">Nine research chats on Descartes, each reviewed against the library, set in the order that makes them one argument.</p>
</div>

<div class="intro">
  <p>Each page reviews one research chat against the literature: an abstract, the question, a works table, part openers, text panels with page-numbered quotations, an internal audit, and a map of the argument.</p>
  <p>The reviews are candid about what the chats got wrong. They are reliable on argument and less reliable on locators &mdash; a quotation assigned to the wrong objector or the wrong Replies, a paraphrase presented as a quotation. Where that happens, the page says so.</p>
</div>
</div>

${sceneHtml}

</main>

<div class="meander" aria-hidden="true"></div>
<footer class="site-foot"><div class="in">
  <p><b>Cogito?</b> &middot; the Descartes project. Generated ${new Date().toISOString().slice(0, 10)} &middot; ${total} pages. Quotations from the secondary literature are made for scholarly comment and criticism, and each is attributed with its page.</p>
  <p>Also here: <a href="../plato/"><b lang="grc">τί ἐστι;</b></a> &mdash; Plato and the Socratic Question, and <a href="../">the Lyceum</a>.</p>
  <p>Banner: Pierre-Louis Dumesnil the Younger, <i>Queen Christina of Sweden and Descartes</i> &mdash; public domain, via <a href="https://commons.wikimedia.org/wiki/File:Dispute_of_Queen_Cristina_Vasa_and_Rene_Descartes.png">Wikimedia Commons</a>.</p>
  <p>Behind the banner on every page: Frans Hals, <i>Portrait of Ren&eacute; Descartes</i> &mdash; public domain.</p>
  ${scenes.length ? `<p>Behind the catalogue: ${scenes.map(s => esc(s.caption)).join('; ')} &mdash; all public domain.</p>` : ''}
  ${credits.length ? `<details>
    <summary>Card artwork &mdash; ${credits.length} public-domain works</summary>
    <ul>${credits.map(c => `
      <li>${esc(c.caption)} &mdash; <a href="${esc(c.source)}">Commons</a></li>`).join('')}
    </ul>
  </details>` : ''}
</div></footer>

${scenes.length ? SCENE_JS : ''}
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
    let html = it.xform ? it.xform.html : null;
    if (it.xform) console.log(`  stripped ${it.xform.removed} portrait block(s) from ${it.out}`);

    const art = NO_BANNER.has(it.slug) ? null : artFor(it.slug);
    if (art && existsSync(join(ASSETS, 'banner', it.slug + '.jpg'))) {
      const withBanner = addBanner(html ?? readFileSync(it.src, 'utf8'), it.slug, art);
      if (withBanner) html = withBanner;
      else console.warn(`     ! ${it.out}: no <body> or </style> to anchor a banner — published without one`);
    }

    html = addNotes(html ?? readFileSync(it.src, 'utf8'));
    if (html !== null) writeFileSync(dest, html, 'utf8');
    else copyFileSync(it.src, dest);                 // verbatim
    if (it.pdf) copyFileSync(it.pdf, join(OUT, it.slug + '.pdf'));
  }
  writeFileSync(join(OUT, 'index.html'), render(items), 'utf8');
  writeFileSync(join(OUT, '.nojekyll'), '', 'utf8');   // GitHub Pages: serve files starting with _

  /* Design assets for the index (the hero image and the card artworks) live in
   * scripts/assets/. They are part of the site, not the library, so ALLOW does
   * not apply to them. Copied recursively — assets/art/ holds one file per slug. */
  if (existsSync(ASSETS)) cpSync(ASSETS, join(OUT, 'assets'), { recursive: true });
}

console.log(`\n${items.length} documents${DRY ? ' would be' : ''} published.`);
