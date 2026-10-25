# DECISIONS

Each entry: the decision, why, and what would change it. Newest at the bottom.

### D1. Rebuild the pipeline from public sources instead of waiting for the v0.1 scripts
The v0.1 scripts and outputs weren't available. Both inputs are public and anonymous: GivingTuesday 990 Data Lake XML and the IRS BMF. Rebuilding took about an hour, and it gives us a pipeline we can run, test and publish. The script names `extract_pf_grants.py` and `resolve_eins.py` are kept for continuity with the v0.1 report.
*Would change if* the originals turn up and resolve better. Then diff the two outputs edge by edge and keep the better rules.

### D2. Population = TY2023 990-PF in the 2026-08-25 data lake index, one filing per EIN
That's 123,403 foundations, not v0.1's 93,853. The index has grown with late filers since v0.1 was built. When an EIN has several TY2023 returns, the latest submission (amended over original) wins. Proved on a 3,700-foundation slice (Massachusetts) first, then run in full: 2,068,633 lines, zero fetch or parse errors.

### D3. Privacy is enforced in code, at extraction time
- Recipients filed as natural persons (`RecipientPersonNm`) lose name, street and purpose inside the extractor. Only the amount and state survive, for out-of-scope totals.
- Lines that *name* a person inside a business-name field are classified `individual` and blanked before the resolver writes its output. That covers "Jane Doe - Dean College", "Curry College FBO A. Smith", "TAIBAT O AHMED" + SCHOLARSHIP, and "Smith, John". The checks use 1990 Census given names and 2010 Census surnames (public domain).
- Unresolved names are published only if no fragment could be a person (`safe_to_display`). It's deliberately conservative: some real orgs ("Pine Street Inn") are withheld when unresolved.
- Purposes that identify a beneficiary (FBO, "tuition for", "on behalf of") are withheld. Honoree names ("in memory of …") are replaced with "[name withheld]".
- Part XV 2a contact persons, phone numbers and e-mails are never extracted. Officers are never published.
*Trade-off accepted:* lower display recall for unresolved lines, in exchange for not publishing people.

### D4. Matching: conservative, explainable, refuses when unsure
Five address blocks plus two national ones, IDF-weighted name similarity, separator vetoes, number agreement, and thresholds and margins that tighten as evidence weakens (see `pipeline/resolve_eins.py` docstring and the site's /method page).
New since v0.1:
- **Name variants from e-file return headers.** The BMF lists every Mass General Brigham affiliate as "MASS GENERAL BRIGHAM INCORPORATED". MGH's own 990-T says "THE MASSACHUSETTS GENERAL HOSPITAL".
- **A dominant-entity rule.** Yale's main EIN stands in for the ~40 BMF entries named "YALE UNIVERSITY".
- **A strict national rare-token strategy** for typos with the wrong address.
- **Margins that scale with weak matches.** This killed the shared-campus errors, e.g. "Jewish Big Brothers Big Sisters" → JCC of Greater Boston.

Every edge carries its score, margin, runner-up EIN, strategy and which name variant matched. Refused lines keep their nearest candidate for the public fix-it queue, never as an edge.

### D5. Display names come from what the org files under, not the BMF
The BMF name can be a parent system's name or a 1764 charter name. The most recent e-file header name is used for display, with the BMF name shown as "IRS BMF name".

### D6. Architecture: Vercel (Pro team already linked) + server-rendered pages from bundled, sharded data
- About 430k entity pages is too many for static files under CLI upload limits (15k files per deploy).
- Static pages generated at build time would mean multi-GB output and long builds.
- So one Node function renders `/org/:ein` and `/foundation/:ein` from gzipped JSON shards bundled with it (about 1,000 files). Responses are CDN-cached for a day.
- Search is a second function over 2-letter token shards.
- No database, no framework, no build step beyond `pipeline/build_site.py`.
*Superseded by D18* for production hosting. The server-rendered mode still works (`site/api`, `cd site && vercel deploy`) and is the upgrade path if per-request rendering is ever needed.

### D7. Analytics: Vercel Web Analytics (cookieless) + custom events
Events are `search`, `funder_open` (the activation event), `share`, `alert_signup`, `correction_submit` and `download`. There's no cookie banner because nothing personal is stored or tracked across sites.

### D8. Corrections + alert signups → a private Vercel Blob store via one function
Corrections show publicly on /corrections without the submitter's e-mail. Alert e-mails are never shown. No e-mail is sent in v1; it's a waitlist that measures demand.

### D9. Licence: CC0 for data and code
The brief says CC0 for the graph and the scripts. Keeping one licence avoids confusion for re-users.

### D10. No payments in v1
Prospect alerts need a second tax year to be worth paying for (new funders appear between filings). v1 measures demand with signups. Stripe stays out until there's something to sell.

### D11. Defaults for the open questions (the maintainer can override)
- **Public good or paid wedge?** Both, in that order. The CC0 graph and free site are the distribution. Prospect alerts and exports are the paid layer, through the optional support slot (D22).
- **Add 990 Schedule I?** Not in v1, because recipient EINs are already filed there and it's a different product surface. It's the obvious v1.1, since it would add community foundations, DAF sponsors and universities as funders with little resolution work.

### D12. A curated alias table, kept small and verified
`pipeline/aliases.csv` has 293 rows covering about 110 organizations. Each EIN was checked against the BMF with `pipeline/bmf_lookup.py` before it went in, and each row has a note. Scope:
- unitary national organizations whose chapters aren't separate entities (Red Cross, American Cancer Society, Alzheimer's Association, MSF USA, Blood Cancer United (formerly LLS));
- universities and hospitals whose legal name hides the common one (Stanford, Columbia, Penn, Notre Dame, MGH, Brigham and Women's);
- donor-advised-fund sponsors (Fidelity, Schwab and Vanguard Charitable);
- the Salvation Army, mapped by state to its four territorial and five divisional EINs. Missouri is left out because it's split between two divisions.

Federated brands (Habitat, YMCA, United Way, Boys & Girls Clubs, Big Brothers Big Sisters, Catholic Charities, Planned Parenthood affiliates, Boy Scouts councils) deliberately get no national alias. Their grants belong to local affiliates, so an alias would be a wrong edge, not a recovered one. Ambiguous short forms were removed: ACS could be the American Chemical Society, USC could be South Carolina, and the bare names PENN, CORNELL, NOTRE DAME and JOHNS HOPKINS are dropped too. An alias scores 1.10, which beats national name matches but loses to a different EIN at the exact filed address.

### D13. Placeholders are classified, not matched
"VARIOUS NEEDY PATIENTS", "Eligible patients (see schedule #2)" and "HIPAA prevents listing names" are counted as **individual**. "SEE ATTACHED", "ATCH 4" and "GRANTS" are counted as **unitemized**, including when typed into the person-name field. One such line was a $458M "GRANTS / SEE ATTACHED PDF" entry. None of these is a payee that can be resolved.

### D14. When the filer writes the EIN on the line, use it
Some filers type the payee EIN into the name ("CHILDRENS HOSPITAL LOS ANGELES FED ID 95 1690977"). The `EIN_IN_TEXT` strategy accepts the EIN when it exists in the BMF and the name agrees at a score of at least 0.3.

### D15. Mega-funders: real edges, but not peers or prospects
AmazonSmile's final 990-PF has 363,675 lines (303k matched recipients). Bank of America's charitable foundation has 59k (largely matching gifts). These edges are real and stay on every recipient's page. But a funder with more than 3,000 recipients says nothing about similarity between organizations, and you can't apply to it. So those funders are left out of "organizations like you" and "foundations that fund your peers". Foundation pages list the 2,000 largest lines, and the CSV release has every line.

### D16. Share cards are generated per page
`/org/:ein/card.png` and `/foundation/:ein/card.png` show "Who funds X? N foundations · $Y". They're rendered on demand by the same functions (so the data isn't bundled twice), using `@vercel/og` 0.8.5 because 1.0.x's Node build fails under ESM. CDN cache is 7 days. A shared link previews the answer, not a logo.

### D17. Server mode keeps its own storage
In server mode, corrections and alert signups go to a private Vercel Blob store through `/api/collect`. Emails are never displayed, and the public queue strips notes and emails. The static site has no server, so it uses public GitHub issues instead (D20).

### D18. Production hosting: GitHub Pages, fully machine-driven
The requirement is a site that runs and grows with no human in the loop and no spending. GitHub Pages plus Actions does that: free hosting, scheduled builds with the built-in token, and no third-party credentials to hold. The catch is the 1 GB site limit, while full HTML for all 512k entities is ~7.5 GB. So the site is layered:
- **static landing pages** for the highest-value foundations (by matched recipients) and organizations (by funders), filled to a byte budget, with lists capped at 25–50 rows;
- **gzipped JSON shards** for every entity, with names embedded, rendered in the browser by the same templates (`site/lib/core.js` is isomorphic);
- **client-side search** over gzipped 3-letter-prefix shards.

The total is ~720 MB. Landing pages' "Show all" loads the full record from the shard.
*Trade-off:* long-tail pages are client-rendered (`org/?ein=`), which search engines index more slowly than HTML.

### D19. Refresh weekly, rebuild only on change, fail safe
`refresh.yml` fingerprints the sources: the data-lake index build, the BMF Last-Modified headers and a hash of the pipeline code. If anything changed, it rebuilds on a free runner. The resolver streams rows and runs single-process in ~5 GB. Then it runs every test, including a scan that the release has no individuals, and a guard against the last good release (line, match and foundation counts can't fall sharply). Only after all of that does it publish a release and dispatch the site deploy. Any failure stops before publishing.
The tax year moves to the newest index at least 90% as complete as the year before it.

### D20. Corrections are public GitHub issues on the static site
"Wrong?" builds a prefilled issue in the browser, so it costs nothing in page weight and the issue tracker is the public queue. It needs a GitHub account, which is acceptable friction for v1.
*Not done:* applying corrections automatically. They should be reviewed before they change edges.

### D21. The resolver must be deterministic
Re-derivability is the point of an open dataset. Python's per-process hash seed changed the order of set iteration. That changed which rare tokens drove candidate blocks, and changed float sums in the last bit, which decided margins sitting exactly on a threshold. Sorting fixed both. The result cache was also keyed on squashed names ("2 LIFE" vs "2LIFE"); it's now keyed on token tuples. Output is now byte-identical across worker counts and hash seeds, and a test enforces it.

### D22. Monetization: one optional slot, no payments code
`WHOFUNDS_SUPPORT_URL` (a repository variable) turns on a "Get funder alerts" box and a footer support link. It can point to an alerts signup, a payment link or a donation page. Nothing is sold until it's set. A paid prospect-alerts product needs a second tax year to be worth paying for (D10).

### D23. Discovery: IndexNow, sitemaps, structured data. No outreach.
v1 does no social posting and no outreach. Discovery comes from:
- gzipped sitemaps listing every entity URL;
- JSON-LD on every page (WebSite with SearchAction, NGO/Organization with funders, Dataset);
- IndexNow submissions: the landing pages after each deploy, then 10,000 sitemap URLs a day.

robots.txt on a project site sits outside the host root, so crawlers don't read it, which is why IndexNow carries the load. Google ignores IndexNow; it'll find the site through links, or faster through Search Console (needs a human).
