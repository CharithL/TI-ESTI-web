# First run — paste this into Claude Code

You are already in the repo folder. Everything Claude Code needs is here:

```
philosophy site\
  KICKOFF.md               <- this file (you can delete it once you're set up)
  CLAUDE.md                <- project rules; Claude Code reads this every session
  gitignore-template.txt   <- becomes .gitignore
  scripts\build-index.mjs  <- the whole build
  _preview\sample-index.html   <- what the generated index looks like
```

Open a terminal, `cd` into this folder, run `claude`, and paste the block below.

Before you start: a GitHub account, and `gh` installed and authenticated
(`gh auth login`). If you'd rather keep the repo private, see the Cloudflare
variant at the bottom.

---

```
This folder is a static site that publishes a corpus of self-contained HTML
research documents. CLAUDE.md is already here — READ IT IN FULL before doing
anything else. It contains hard rules about what may and may not be published,
and one of them matters a great deal: my source library holds around 200
copyrighted PDFs that must never be committed.

Source library (READ-ONLY — never write to it, never copy PDFs from it):
  C:\Users\chari\Downloads\plato

Do this:

1. git init. Rename gitignore-template.txt to .gitignore and add _preview/ to it.

2. Run:  node scripts/build-index.mjs --dry
   Show me the list of documents before writing anything. I want to confirm the
   set is right — in particular whether MASTER development and design should be
   dropped as superseded by the REVIEW.

3. Once I confirm, run the real build and open docs/index.html so I can see it.

4. Ask me public or private repo. If private, tell me GitHub Pages needs a paid
   plan and offer the Cloudflare Pages route instead. Then create the repo, push,
   and enable Pages serving from /docs on the default branch.

5. Give me the live URL and say how long propagation usually takes.

Constraints:
- Do not modify any HTML document. Copy them verbatim. They are hand-built and
  some are ~950 KB with embedded images; reformatting will destroy them.
- Do not add a framework, bundler or dependency. The build is one Node script
  with zero dependencies and it stays that way.
- Show me `git status` before the first commit.
```

---

## After the first run

Adding or revising a document becomes one line:

```
rebuild and deploy
```

Claude Code re-runs the build, shows what changed, commits and pushes.

## Custom domain

```
I've bought <domain>. Set it up as the custom domain for this Pages site —
the DNS records I need at the registrar, and the CNAME file.
```

GitHub issues the HTTPS certificate automatically once DNS resolves, usually
inside an hour.

## Cloudflare Pages variant

Use this instead of step 4 if you want the **repo private but the site public**,
which GitHub Pages won't do on the free plan.

```
Instead of GitHub Pages, connect this repo to Cloudflare Pages:
  build command:            node scripts/build-index.mjs
  build output directory:   docs
Walk me through the dashboard steps — I'll do the clicking.
```

## Worth asking for later

- A client-side search box over titles and subtitles (no dependency needed).
- An RSS or JSON feed, if you want the corpus followable.
- A redirect stub generator, for when a document gets renamed and its URL moves.
- A link checker that verifies every internal `#anchor` in every document still
  resolves after a rebuild.
