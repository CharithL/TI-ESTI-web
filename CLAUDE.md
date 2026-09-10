# plato-corpus — project instructions

A static site publishing a corpus of long-form philosophy research documents on
Plato's early dialogues. Read this file before doing anything in this repo.

---

## 1 · Hard rules

These are not style preferences. Breaking any of them causes real harm.

**1.1 — Never publish third-party PDFs.**
The source library contains roughly two hundred PDFs of copyrighted books and
journal articles (Vlastos, Allen, Fine, Dancy, Thesleff, Brandwood, the Cambridge
and Oxford companions, and so on). **None of these may ever be copied into this
repo, committed, or served.** They are the author's personal research library.
Publishing them would be straightforward copyright infringement.

The only PDFs that may be published are the ones generated from the author's own
HTML documents — a PDF is publishable **only** when an HTML file of the same
basename is also being published.

**1.2 — Copy by allowlist, never by denylist.**
`scripts/build-index.mjs` holds an `ALLOW` array of filename patterns. A file is
published only if it matches one. Do not replace this with "copy everything
except…" logic. If a new document family is added, add a pattern to `ALLOW`.

**1.3 — The source folder is read-only.**
`SOURCE` is the author's working library. Never write, move, rename or delete
anything inside it. The build reads from it and writes only to `docs/`.

**1.4 — Never commit anything from outside `docs/` and `scripts/`.**
Check `git status` before every commit. If something unexpected is staged, stop.

---

## 2 · Layout

```
SOURCE   C:\Users\chari\Downloads\plato          read-only working library
repo/
  CLAUDE.md                 this file
  scripts/build-index.mjs   the only build step
  docs/                     GENERATED — the published site, never hand-edited
  .gitignore
```

`docs/` is wiped and rebuilt on every run. Do not put anything there by hand;
it will be destroyed. Anything that must persist goes in `scripts/` or the
template inside the build script.

---

## 3 · The documents

Each source document is a **single self-contained HTML file** — inline CSS,
inline JavaScript, images as base64 data URIs. There is no bundler, no
framework, no dependency, and there must never be one. The build copies files
and writes an index; that is all it does.

Sizes range from 9 KB to about 950 KB. The large ones carry embedded portraits
and an interactive argument map. They are slow to open in an editor. **Do not
reformat, minify, prettify or "clean up" these files.** Copy them verbatim.

House style, if you need to match it (the index page already does):

| token | light | role |
|---|---|---|
| `--bg` | `#faf8f3` | page |
| `--panel` | `#fffefa` | cards |
| `--ink` | `#16140f` | body text |
| `--ink-2` | `#4b4438` | secondary |
| `--ink-3` | `#7d7566` | meta |
| `--rule` | `#e6dfd0` | borders |

Body serif is `Charter, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`
at 17.5px/1.66. UI sans is the system stack. Content column is `max-width:960px`.
Accent colours are per-document-type and defined at the top of the build script.

---

## 4 · Build and deploy

```bash
node scripts/build-index.mjs --dry      # list what would be published, write nothing
node scripts/build-index.mjs            # rebuild docs/
```

Override the source folder with `--source "<path>"` or the `PLATO_SOURCE`
environment variable.

Deploy is a push. GitHub Pages serves `docs/` on the default branch.

```bash
node scripts/build-index.mjs
git add -A && git status          # ALWAYS look at this before committing
git commit -m "rebuild: <what changed>"
git push
```

`docs/.nojekyll` is written by the build and must stay — without it GitHub Pages
refuses to serve files whose names begin with an underscore.

---

## 5 · Routine tasks

**A new document was added to the library.**
Check its filename matches an `ALLOW` pattern. Run `--dry` first and confirm it
appears with a sensible title and subtitle. If the subtitle is blank the script
warns; fix it by adding a `<p class="sub">` to the source document — ask the
author first, since that means editing the library.

**A document was revised.**
Just rebuild and push. Slugs are derived from filenames, so a revision keeps its
URL. **Renaming a source file changes its URL and breaks inbound links** — if a
file must be renamed, say so explicitly and offer to add a redirect stub.

**The index needs a new grouping or a copy change.**
Edit the `GROUPS` array or the `render()` template in `scripts/build-index.mjs`,
never `docs/index.html`.

---

## 6 · Known issues in the source library

Flag these to the author; do not fix them unilaterally.

- `NOTE The Determinable (equivalence-questions and the category gate).html`
  has `<title>The Matrix — …</title>`. The filename and the title disagree; the
  file appears to have been derived from the Matrix note and its title never
  updated. The index shows the title, so this reads wrong on the site.
- `MASTER development and design (developmental vs unitarian).html` (786 KB) is
  an earlier version of `REVIEW Development and Design …` (951 KB). Publishing
  both shows two cards with nearly the same name. Decide whether the MASTER is
  superseded and should be dropped from `ALLOW`.
- Two `_SINHALA-*` documents are Sinhala translations. The index tags them
  `සිංහල`. Keep the tag; the pages themselves need `lang="si"` on `<html>` if
  they don't already have it.

---

## 7 · Before making the repo public

- [ ] The author has decided whether the **scholar portraits** in the two REVIEW
      documents stay. They were sourced for private use; a public site is a wider
      distribution. Removing them is a search for `<aside class="sch"` and
      deleting the `<div class="pic ...">` and `<div class="cap ...">` blocks —
      the cards degrade gracefully without them.
- [ ] `git log --stat` shows no third-party PDF has ever been committed. If one
      has, history must be rewritten before the repo goes public, not just the
      file deleted.
- [ ] Quotation is scholarly, attributed and page-cited throughout. This is
      normal academic practice and is not the concern; the PDFs and the
      photographs are.
