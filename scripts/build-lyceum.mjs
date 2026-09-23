#!/usr/bin/env node
/**
 * build-lyceum.mjs — the front door.
 *
 * Writes docs/index.html: one page carrying the two sites built by the other
 * scripts, over the drawing in scripts/assets-lyceum/. It owns docs/index.html
 * and docs/assets-lyceum/ and touches nothing else, so it can be run at any time.
 *
 * Usage:  node scripts/build-lyceum.mjs [--dry]
 */

import { readdirSync, existsSync, mkdirSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs');
const ASSETS = join(ROOT, 'scripts', 'assets-lyceum');
const DRY = process.argv.includes('--dry');

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Each site counts its own published pages, so the numbers here can never drift
 * from what was actually built. A site that has not been built yet is skipped. */
const countPages = dir => {
  const d = join(OUT, dir);
  if (!existsSync(d)) return 0;
  return readdirSync(d).filter(f => f.endsWith('.html') && f !== 'index.html').length;
};

const SITES = [
  {
    href: 'plato/', key: 'plato',
    name: 'τί ἐστι;', lang: 'grc', roman: 'Ti Esti',
    line: 'Plato and the Socratic Question',
    blurb: 'Chronology, the elenchus, the priority of definition, and the introduction of the Forms — read from the primary literature.',
    img: 'card-ti-esti.jpg',
    credit: 'Raphael, The School of Athens, 1509–11',
  },
  {
    href: 'descartes/', key: 'descartes',
    name: 'Cogito?', lang: 'en', roman: 'Descartes',
    line: 'Nine research chats, reviewed',
    blurb: 'The method of doubt, the immunity of the cogito, Hintikka on performance, Dicker on substance, Alquié and Gueroult, and what stands before the cogito.',
    img: 'card-cogito.jpg',
    credit: 'Frans Hals, Portrait of René Descartes',
  },
];

const CSS = `
:root{
--bg:#f1e6d2;--panel:rgba(255,250,241,.82);--ink:#2a1b10;--ink-2:#5a3116;--ink-3:#7a5a40;
--cu:#853b0b;--rule:rgba(133,59,11,.26);--rule-2:rgba(133,59,11,.12);--umber:#1f130a;
--serif:Constantia,"Palatino Linotype",Palatino,"Book Antiqua",Charter,"Iowan Old Style",Georgia,serif;
--sans:Candara,Optima,"Gill Sans","Gill Sans MT","Segoe UI",ui-sans-serif,sans-serif;
--mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
--shadow:0 1px 0 rgba(255,255,255,.6) inset,0 16px 32px -24px rgba(70,35,10,.6)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
--bg:#171009;--panel:rgba(44,31,20,.78);--ink:#f0e4cf;--ink-2:#d8bf9b;--ink-3:#a88d6c;
--cu:#e2a26b;--rule:rgba(226,162,107,.28);--rule-2:rgba(226,162,107,.12);
--shadow:0 16px 34px -22px rgba(0,0,0,.85)}}
:root[data-theme="dark"]{
--bg:#171009;--panel:rgba(44,31,20,.78);--ink:#f0e4cf;--ink-2:#d8bf9b;--ink-3:#a88d6c;
--cu:#e2a26b;--rule:rgba(226,162,107,.28);--rule-2:rgba(226,162,107,.12);
--shadow:0 16px 34px -22px rgba(0,0,0,.85)}
*{box-sizing:border-box}
body{margin:0;color:var(--ink);background:var(--bg);
font:17px/1.66 var(--serif);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a:focus-visible{outline:2px solid var(--cu);outline-offset:3px}

/* the drawing, with the name over it */
.hero{position:relative;isolation:isolate;overflow:hidden;display:flex;align-items:center;justify-content:center;
min-height:clamp(560px,88vh,880px);background:var(--umber);color:#f7ecda;text-align:center}
.hero-img{position:absolute;inset:0;z-index:-2;background:#2a1c10 url("assets-lyceum/lyceum-bg.webp") 50% 42%/cover no-repeat}
.hero::before{content:"";position:absolute;inset:0;z-index:-1;background:
linear-gradient(180deg,rgba(24,13,5,.5) 0%,rgba(24,13,5,.12) 26%,rgba(24,13,5,.42) 62%,rgba(18,10,4,.93) 100%),
linear-gradient(0deg,rgba(221,153,51,.08),rgba(221,153,51,.08))}
.hero-in{position:relative;width:100%;max-width:1100px;padding:0 28px 6vh}
h1{margin:0;font:700 clamp(3.4rem,12vw,10rem)/.95 var(--serif);letter-spacing:.06em;
color:#fbf2e3;text-shadow:0 4px 44px rgba(0,0,0,.7)}
.rom{display:flex;align-items:center;justify-content:center;gap:16px;margin:26px 0 0;
font:700 12.5px/1 var(--sans);letter-spacing:.34em;text-transform:uppercase;color:#e8b27a;text-shadow:0 1px 10px rgba(0,0,0,.9)}
.rom::before,.rom::after{content:"";width:46px;height:1px;background:#e8b27a}
.rom i{font:italic 400 1.4rem/1 var(--serif);letter-spacing:0;text-transform:none;color:#ecdcc3}
.credit{position:absolute;right:16px;bottom:10px;margin:0;font:400 10.5px/1.4 var(--sans);
letter-spacing:.05em;color:rgba(247,236,218,.55)}
.meander{height:26px;border-top:1px solid #6b4424;border-bottom:1px solid #6b4424;
background:var(--umber) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='24'%3E%3Cpath d='M0 20H28M22 20V4H7v12h11V9h-6' fill='none' stroke='%23c48a52' stroke-width='2'/%3E%3C/svg%3E") 0 50%/28px 24px repeat-x}

.wrap{max-width:1040px;margin:0 auto;padding:64px 26px 40px}
.lede{margin:0 auto 52px;max-width:680px;text-align:center;font:italic 400 1.16rem/1.6 var(--serif);color:var(--ink-2)}

.sites{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:26px}
.site{position:relative;display:flex;flex-direction:column;background:var(--panel);border:1px solid var(--rule);
border-radius:3px;box-shadow:var(--shadow);overflow:hidden;text-decoration:none;color:inherit;
transition:transform .28s cubic-bezier(.2,.7,.2,1),box-shadow .28s,border-color .28s}
.site:hover{transform:translateY(-4px);border-color:var(--cu);box-shadow:0 26px 44px -26px rgba(70,35,10,.65)}
.site .shot{margin:0;overflow:hidden;border-bottom:1px solid var(--rule);background:#2a1c10}
.site .shot img{display:block;width:100%;height:auto;aspect-ratio:3/2;object-fit:cover;
transition:transform .6s cubic-bezier(.2,.7,.2,1)}
.site:hover .shot img{transform:scale(1.04)}
.site .body{padding:24px 26px 22px}
.site .nm{margin:0 0 6px;font:700 clamp(1.9rem,3.4vw,2.6rem)/1.05 var(--serif);color:var(--cu)}
.site .rm{margin:0 0 14px;font:700 10px/1 var(--sans);letter-spacing:.26em;text-transform:uppercase;color:var(--ink-3)}
.site .ln{margin:0 0 10px;font:600 1.02rem/1.4 var(--sans);color:var(--ink)}
.site .bl{margin:0;font:400 14.6px/1.6 var(--sans);color:var(--ink-2)}
.site .foot{display:flex;align-items:center;gap:12px;margin-top:18px;padding-top:14px;border-top:1px solid var(--rule-2)}
.site .enter{font:700 10.5px/1 var(--sans);letter-spacing:.18em;text-transform:uppercase;color:var(--cu);
border:1px solid var(--cu);border-radius:2px;padding:9px 15px 8px}
.site:hover .enter{background:var(--cu);color:var(--bg)}
.site .count{margin-left:auto;font:400 11.5px/1 var(--mono);color:var(--ink-3)}
.site .shot figcaption{position:absolute;left:0;right:0;top:0;padding:0;overflow:hidden;height:0}

.foot-note{max-width:1040px;margin:0 auto;padding:10px 26px 0;font:400 13px/1.6 var(--sans);color:var(--ink-3);text-align:center}
.site-foot{background:var(--umber);color:#cdb391;margin-top:54px}
.site-foot .in{max-width:1040px;margin:0 auto;padding:28px 26px 36px;font:400 13.4px/1.65 var(--sans)}
.site-foot p{margin:0 0 8px}.site-foot p:last-child{margin:0}
.site-foot i{font-family:var(--serif)}
.site-foot a{color:#e8b27a}
@media (max-width:640px){
.wrap{padding:44px 18px 30px}
.hero-in{padding:0 18px 5vh}
.rom{gap:12px;letter-spacing:.26em}.rom::before,.rom::after{width:26px}.rom i{font-size:1.15rem}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

function render() {
  const cards = SITES.map(s => {
    const n = countPages(s.key);
    return `
      <a class="site" href="${esc(s.href)}">
        <figure class="shot"><img src="assets-lyceum/${esc(s.img)}" alt="${esc(s.credit)}" width="900" height="600" loading="lazy" decoding="async"></figure>
        <div class="body">
          <div class="nm"${s.lang === 'grc' ? ' lang="grc"' : ''}>${esc(s.name)}</div>
          <div class="rm">${esc(s.roman)}</div>
          <p class="ln">${esc(s.line)}</p>
          <p class="bl">${esc(s.blurb)}</p>
          <div class="foot">
            <span class="enter">Enter</span>
            ${n ? `<span class="count">${n} pages</span>` : ''}
          </div>
        </div>
      </a>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>ΛΥΚΕΙΟΝ · The Lyceum</title>
<meta name="description" content="The Lyceum — long-form philosophy research in two corpora: τί ἐστι; on Plato and the Socratic question, and Cogito? on Descartes.">
<meta name="theme-color" content="#1f130a">
<link rel="preload" as="image" href="assets-lyceum/lyceum-bg.webp">
<style>${CSS}</style>
</head>
<body>

<header class="hero">
  <div class="hero-img" role="img" aria-label="Philosophers ancient and modern on the steps of the School of Athens"></div>
  <div class="hero-in">
    <h1 lang="grc">ΛΥΚΕΙΟΝ</h1>
    <p class="rom">The Lyceum <i>where the reading is kept</i></p>
  </div>
  <p class="credit">After Raphael, <i>The School of Athens</i></p>
</header>
<div class="meander" aria-hidden="true"></div>

<main class="wrap">
  <p class="lede">Two corpora, each read from the primary literature and written up in full: the Socratic question in Plato, and the first certainty in Descartes.</p>
  <div class="sites">${cards}
  </div>
</main>

<p class="foot-note">Each corpus keeps its own index, its own documents and its own reading order.</p>

<div class="meander" aria-hidden="true"></div>
<footer class="site-foot"><div class="in">
  <p><b lang="grc">ΛΥΚΕΙΟΝ</b> &middot; The Lyceum. Generated ${new Date().toISOString().slice(0, 10)}. Quotations throughout are made for scholarly comment and criticism, and each is attributed with its page.</p>
  <p>Card images: Raphael, <i>The School of Athens</i> (1509&ndash;1511), and Frans Hals, <i>Portrait of Ren&eacute; Descartes</i> &mdash; both public domain, via <a href="https://commons.wikimedia.org/">Wikimedia Commons</a>.</p>
</div></footer>

</body>
</html>
`;
}

console.log(`output : ${OUT}${DRY ? '  (dry run — nothing written)' : ''}`);
for (const s of SITES) console.log(`  ${s.href.padEnd(12)} ${countPages(s.key) || '—'} pages`);

if (!DRY) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'index.html'), render(), 'utf8');
  writeFileSync(join(OUT, '.nojekyll'), '', 'utf8');
  if (existsSync(ASSETS)) cpSync(ASSETS, join(OUT, 'assets-lyceum'), { recursive: true });
}
console.log(`\nfront page ${DRY ? 'would be ' : ''}written.`);
