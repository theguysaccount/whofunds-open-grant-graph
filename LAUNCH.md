# LAUNCH: machine-driven

WHOFUNDS launches and grows without a human in the loop. Nothing in this file needs to be done by hand for the site to stay live, current and discoverable. The optional steps at the end only add reach or revenue.

## 1. What's live

- **Site:** https://theguysaccount.github.io/whofunds-open-grant-graph/ (GitHub Pages, deployed by `.github/workflows/pages.yml`)
- **Data:** https://github.com/theguysaccount/whofunds-open-grant-graph/releases/latest (CC0 CSVs + `site-data.tar.gz`, published by `.github/workflows/refresh.yml`)

## 2. How a deploy happens

1. `refresh.yml` runs every Monday at 07:23 UTC, or by hand from the Actions tab with "force".
2. It fingerprints the sources: the data-lake index build, the BMF `Last-Modified` headers and the pipeline code hash. It stops if they match the last release.
3. If they don't match, it runs download → extract → resolve → build. Then come the tests, including a scan that no individual is in the release, and the guard against the last release.
4. Only then does it run `gh release create … --latest` and `gh workflow run pages.yml`.
5. `pages.yml` downloads the latest `site-data.tar.gz`, runs the site tests, builds the static site (`site/scripts/build-pages.mjs`, ~800 MB) and deploys it to Pages. Then it submits the landing pages to IndexNow.

Any failure stops before anything is published, and the site keeps the last good release. GitHub emails the repository owner about failed runs.

Re-run anything by hand:
```bash
gh workflow run refresh.yml -f force=true   # rebuild data from the sources
gh workflow run pages.yml                    # rebuild and redeploy the site from the latest release
gh workflow run indexnow.yml                 # today's IndexNow batch
```

## 3. How people find it (no posting, no outreach)

The product's distribution is search. Its pages are titled for the searches fundraisers and researchers already make:

| Query shape | Page that answers it |
|---|---|
| `who funds <organization>`, `<organization> funders`, `<organization> foundation grants` | `org/<ein>/`, or `org/?ein=` |
| `<foundation> grants`, `<foundation> grant recipients`, `<foundation> 990` | `foundation/<ein>/`, or `foundation/?ein=` |
| `<EIN>`, `<organization> EIN` | every page shows the EIN; search accepts EINs |
| `private foundation grants dataset`, `990-PF grants csv` | `data/` (JSON-LD `Dataset`) and the GitHub release |

What runs automatically:
- **Sitemaps.** There are 12 gzipped sitemaps with ~461k URLs, every published entity. Landing pages come first.
- **Structured data.** `WebSite` + `SearchAction` on home, `NGO` with `funder` on org pages, `Organization` on foundation pages, `Dataset` with `DataDownload` on the data page.
- **IndexNow** (Bing, Yandex, Seznam, Naver). The landing pages go in after every deploy. Then `indexnow.yml` submits the next 10,000 sitemap URLs each day. The rotation follows the calendar, not the release, so it reaches every URL about every 47 days. The key file is published at the site root.
- **Open data channels.** Each release is a GitHub release with CSV assets and notes, so its download counts are a public, machine-readable usage signal.

## 4. The first 14 days (automatic)

| Day | What the automation does | What to look at (optional) |
|---|---|---|
| 0 | Data release published, site deployed, the first 10,000 landing pages submitted to IndexNow | Actions tab all green |
| 1–14 | `indexnow.yml` submits 10,000 more URLs per day (140k by day 14) | Bing results for `site:theguysaccount.github.io/whofunds-open-grant-graph` |
| 7, 14 | `refresh.yml` checks the sources; it rebuilds only if the IRS, the data lake or the pipeline code changed | New release appears, or "nothing to do" |
| any | Visitors file corrections as `correction` issues | The issues list |

Signals of use that need no analytics account:
- release asset download counts (`gh api repos/theguysaccount/whofunds-open-grant-graph/releases`);
- correction issues;
- stars and forks;
- Bing indexing.

## 5. Optional: things a human could add (none blocks anything)

| Step | Why | How |
|---|---|---|
| Custom domain | A shorter URL with its own robots.txt and better trust signals | Pages → Custom domain, then DNS. For an apex domain: A `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` and AAAA `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`. For `www`: CNAME `theguysaccount.github.io`. Then set repository variable `WHOFUNDS_BASE_URL=https://<domain>` and re-run `pages.yml`. |
| Google Search Console | Google ignores IndexNow, and submitting the sitemap is faster than waiting for links | Verify the domain (needs a Google account), then submit `sitemap.xml` |
| `WHOFUNDS_SUPPORT_URL` | The monetization slot: an alerts signup, payment link or donation page | Repository variable. Re-run `pages.yml`. |
| `WHOFUNDS_GOATCOUNTER` | Cookieless analytics, including the `funder_open` activation event | Create a GoatCounter site, set the repository variable to `https://<code>.goatcounter.com/count`. |
| Review corrections | Accepted corrections should become aliases or fixes in `pipeline/aliases.csv` | Label an issue `accepted`, then edit the alias table. The next refresh picks it up, since code changes trigger a rebuild. |

## 6. Activation metric

**`funder_open`**: a visitor on an organization page opens a funder's page or its source filing. It's instrumented in `site/public/assets/app.js` and records once a GoatCounter (or, in server mode, Vercel Analytics) key is set. Until then it lands in `window.__whofundsEvents` only.
