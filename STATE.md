# STATE: 2026-11-10

**Works:**
- Live on GitHub Pages: search, org and foundation pages, prospects and peers, CSV export, share, corrections via issues.
- The TY2023 graph (release data-20261109-1848): 123,521 foundations and 2,018,330 paid grant lines ($122.7B). 61.6% of lines and 51.3% of dollars resolve to an EIN, against 47.4% and 37.8% in v0.1.
- It runs itself. Since launch, three scheduled refreshes rebuilt, tested, released and redeployed with no human: Oct 26 for a code change, Nov 2 for a new data-lake index, Nov 9 for a new IRS BMF. IndexNow submits 10,000 URLs a day. 25 Python + 11 Node tests.

**Origin:** v0.1 existed only as a report page. Its scripts and outputs weren't available, so the pipeline was rebuilt from the public sources, proved on a 3,700-foundation slice (MA), then run nationally.

**Known gaps:**
- 23.5% of lines ($15.9B) are unmatched US payees: federated brands' local affiliates, government payees, typos at wrong addresses. The 500 largest are on /corrections.
- The BMF names group-exemption members after their parent. Display uses e-file names or the filed names instead, but small subordinates with neither show the parent's name.
- Corrections are collected as GitHub issues, but nothing applies them automatically. None filed yet.
- About 17k entities have static HTML. The other ~495k render in the browser (`org/?ein=`), which search engines index more slowly.
- There's no custom domain or Google Search Console, and both need a human. Google can still find the sitemap through the account's root robots.txt.

**Worth reusing:** `pipeline/resolve_eins.py` (a deterministic, explainable 990-PF → EIN resolver, ~5 GB), `pipeline/aliases.csv` (verified against the BMF), `site/lib/core.js` (isomorphic templates) and `site/scripts/build-pages.mjs` (a 1 GB-budget static build for large entity sets).
