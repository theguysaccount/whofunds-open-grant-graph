# WHOFUNDS: the open grant graph of US private foundations

**Live:** https://theguysaccount.github.io/whofunds-open-grant-graph/ · **Data (CC0):** [latest release](https://github.com/theguysaccount/whofunds-open-grant-graph/releases/latest) · **Screens:** [desktop and phone](docs/screens/)

Every grant on every Form 990-PF for a tax year, with the recipient's missing EIN recovered from the IRS Business Master File. Form 990-PF lists each grant by payee name and address but has no field for the payee's tax ID, so a foundation grant can't be joined to anything. WHOFUNDS recovers the ID, publishes the graph into the public domain and shows its own miss rate.

Each edge carries:
- the match score;
- the margin over the runner-up EIN;
- the strategy and name variant that found it;
- a link to the exact filing.

There are no ratings and no recommendations, only filed facts and their provenance. Grants to individuals are counted but never published.

The site answers "who funds X?" for organizations and "where did Y's money go?" for foundations. It also lists the foundations that fund an organization's closest peers but not the organization itself, a prospect list built from filings.

## How it runs (no human in the loop)

| What | Where | When |
|---|---|---|
| Rebuild the graph from public sources, test it, guard it, publish a data release | `.github/workflows/refresh.yml` | weekly check; rebuilds only when the IRS BMF, the GivingTuesday indexes or this pipeline's code changed |
| Build the static site from the latest release and deploy it to GitHub Pages | `.github/workflows/pages.yml` | after each release, and on site changes |
| Tell search engines (IndexNow) about new pages | `pages.yml` (landing pages), `.github/workflows/indexnow.yml` (10,000 URLs a day) | after deploys, daily |
| Tests (pipeline + site) | `.github/workflows/test.yml` | every push |

The refresh **fails safe**. Any failed step stops before anything is published: a source outage, a failing test (including a scan that the release holds no individuals), or the guard. The guard refuses a rebuild whose line count, matched count or foundation count falls sharply against the last good release. The live site keeps serving the last release.

It also **advances the tax year by itself**. It uses the newest year whose data-lake index is at least 90% as complete as the year before, so TY2024 replaces TY2023 once those filings are mostly in.

## Layout

```
pipeline/                Python 3.9+, standard library only
  sources.py             fingerprint public sources, pick the tax year, download inputs, guard a release
  fetch_index.py         990-PF filings for a tax year (one per EIN, latest submission wins)
  build_names.py         names each EIN files its own returns under (e-file index) → alternate names
  extract_pf_grants.py   download + parse Part XV grant lines (privacy rules applied here)
  resolve_eins.py        match each line to an EIN, or classify it individual / foreign / unitemized / unmatched
  build_site.py          graph, peers, prospects, site data, stats, CC0 release files
  aliases.csv            curated common-name → EIN table; every EIN checked against the BMF
  bmf_lookup.py          helper for curating aliases
  names_first.txt, names_last.txt   Census given names and surnames (public domain): keeps people out
site/
  lib/core.js            page templates, shared by build time and the browser
  lib/render.js, api/    optional server-rendered mode (Vercel functions)
  public/assets/         CSS, app.js (search, share, corrections), entity.js (client rendering)
  scripts/build-pages.mjs   static site for GitHub Pages: landing pages + gzipped shards + search shards + sitemaps
  scripts/indexnow.mjs   IndexNow submissions
tests/                   pipeline tests (Python)    site/tests/  site tests (Node)
```

The static site has to fit GitHub Pages' 1 GB limit, and full HTML for every entity would be about 7.5 GB. So it works in layers:
- **Landing pages.** The highest-value foundations and organizations get static HTML, filled to a byte budget.
- **Shards.** Every entity is also in gzipped JSON shards, rendered in the browser by the same templates.
- **Search.** It runs in the browser over gzipped 3-letter-prefix shards.

## Run it locally

Inputs are public and anonymous. No API keys are needed.

```bash
python3 pipeline/sources.py download --year 2023     # IRS BMF + data-lake indexes (~1.3 GB)
python3 pipeline/extract_pf_grants.py data/work/pf_index_2023.csv 400000 data/work/run/pf_grants.csv.gz --workers 24
python3 pipeline/resolve_eins.py data/work/run/pf_grants.csv.gz data/work/run/pf_grants_resolved.csv.gz --workers 8
python3 pipeline/build_site.py data/work/run --year 2023
cd site && npm ci && WHOFUNDS_BASE_URL=http://localhost:8000/whofunds WHOFUNDS_REPO=owner/repo node scripts/build-pages.mjs
```

Extraction takes about 15 minutes cold (the XML is cached under `data/raw/xml`). The resolver needs about 5 GB of RAM with `--workers 1`, and more with forked workers. Its output is deterministic: identical across worker counts, Python hash seeds and Python versions (float sums are exact), and tested. A local build reproduces the CI release line for line.

To prove a change on a slice first, run `python3 pipeline/fetch_index.py 2023 --states MA` (3,700 foundations) and point the next steps at `data/work/pf_index_2023_MA.csv`.

## Test

```bash
python3 -m unittest discover -s tests -v   # normalisation, placeholders, individuals, resolver rules, determinism, extractor privacy, release scan
cd site && npm test                        # rendering, escaping, search, HTTP handlers, correction privacy, share cards
```

Screenshots of the key pages at desktop (1280px) and phone (390px) widths: `cd site && node scripts/screens.mjs <site url>` writes `docs/screens/`.

## Optional settings (repository variables)

Nothing is required, and each setting adds one feature when present:
- `WHOFUNDS_SUPPORT_URL`: a funder-alerts signup or donation link. It shows a "Get funder alerts" box on pages and a "Support WHOFUNDS" link in the footer. This is the monetization slot.
- `WHOFUNDS_GOATCOUNTER`: `https://<code>.goatcounter.com/count`, for cookieless page and event counts. It's skipped for Do Not Track and Global Privacy Control. The activation event is `funder_open`.

## Corrections

Every match on the site has a "Wrong?" link, which opens a prefilled public issue labelled `correction`. The [fix-it page](https://theguysaccount.github.io/whofunds-open-grant-graph/corrections/) lists the 500 largest matches the resolver refused to guess.

## Privacy rules (enforced in code, covered by tests)

- Payees filed as persons lose their name, street and purpose inside the extractor.
- Lines that name a person in a business-name field are dropped as `individual`. Examples: "Jane Doe - Dean College", "X College FBO …", "SMITH, JOHN".
- An unmatched name is shown only if no fragment could be a person, and care-of tails are removed.
- Beneficiary-identifying purposes are withheld, and honoree names replaced.
- Foundation contact persons, phone numbers and officers are never extracted.

## Sources

[GivingTuesday 990 Data Lake](https://990data.givingtuesday.org/) (IRS e-file XML, anonymous S3) and the [IRS Exempt Organizations Business Master File](https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf). Public records under 26 U.S.C. § 6104.

## Licence

CC0 1.0 for data and code. See [LICENSE](LICENSE).
