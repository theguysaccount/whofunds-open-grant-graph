# STATE: 2026-10-24

**Works:**
- The live static site on GitHub Pages: search, org and foundation pages, prospects and peers, CSV export, share, corrections via issues.
- The TY2023 graph: 123,403 foundations and 2,017,591 paid grant lines ($122.7B). 61.6% of lines and 51.3% of dollars resolve to an EIN, against 47.4% and 37.8% in v0.1.
- The CC0 data release.
- A weekly refresh that fails safe, daily IndexNow submissions, and 22 Python + 8 Node tests.

**Origin:** v0.1 existed only as a report page. Its scripts and outputs weren't available, so the pipeline was rebuilt from the public sources, proved on a 3,700-foundation slice (MA), then run nationally.

**Known gaps:**
- 23.5% of lines ($15.9B) are unmatched US payees: federated brands' local affiliates, government payees, typos at wrong addresses. The 500 largest are on /corrections.
- The BMF names group-exemption members after their parent. Display uses e-file names or the filed names instead, but small subordinates with neither show the parent's name.
- Corrections are collected (GitHub issues) but nothing applies them automatically yet.
- Only about 10k entities have crawlable static HTML. The rest render in the browser (`org/?ein=`), which search engines index more slowly.
- No custom domain. Google has no sitemap ping, so discovery there relies on links and Search Console, which needs a human.

**Worth reusing:**
- `pipeline/resolve_eins.py`: a deterministic, explainable 990-PF → EIN resolver. It has e-file name variants, separator vetoes and a dominant-entity rule, with a ~5 GB footprint.
- `pipeline/aliases.csv`: every EIN in it is verified against the BMF.
- `site/lib/core.js`: isomorphic templates (server, build time and browser).
- `site/scripts/build-pages.mjs`: a 1 GB-budget static build pattern for large entity sets.
