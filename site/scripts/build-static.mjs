// Render the site-wide pages (home, method, data, corrections, about, 404) from
// data/stats.json. Every number on these pages comes from stats.json; none is typed by hand.
// Server mode (Vercel) writes into public/ and copies the release CSVs to /downloads.
// Static mode (WHOFUNDS_MODE=static, GitHub Pages) writes directory-style pages into
// WHOFUNDS_OUT and links downloads to the GitHub release.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const SITE_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SRC_PUB = path.join(SITE_DIR, "public");
const PUB = process.env.WHOFUNDS_OUT ? path.resolve(process.env.WHOFUNDS_OUT) : SRC_PUB;
const DATA = path.resolve(process.env.WHOFUNDS_DATA_DIR || path.join(SITE_DIR, "data"));
process.chdir(SITE_DIR);
// Asset version = hash of the CSS, the scripts, the shared templates and the data build,
// written before any page renders so every page (static and server-rendered) references the
// same cache-busting query, and shard URLs change with each data release.
const versioned = [path.join(SRC_PUB, "assets", "app.css"), path.join(SRC_PUB, "assets", "app.js"),
  path.join(SRC_PUB, "assets", "entity.js"), path.join(SITE_DIR, "lib", "core.js"), path.join(DATA, "stats.json")];
const ASSET_V = versioned.reduce((h, f) => (fs.existsSync(f) ? h.update(fs.readFileSync(f)) : h), crypto.createHash("sha1")).digest("hex").slice(0, 10);
fs.writeFileSync(path.join(DATA, "asset-version.txt"), ASSET_V);
process.env.WHOFUNDS_ASSET_VERSION = ASSET_V;
const { layout, esc, money, num, pct, fmtEin, orgUrl, fdnUrl, pageUrl, L, searchForm, alertBox, issueUrl, STRATEGY, SITE } = await import("../lib/render.js");
const STATIC = SITE.mode === "static";
const downloadUrl = (fn) => (STATIC ? `https://github.com/${SITE.repo}/releases/latest/download/${fn}` : L(`/downloads/${fn}`));
const RELEASE = path.resolve(SITE_DIR, "..", "data", "release");
const S = JSON.parse(fs.readFileSync(path.join(DATA, "stats.json"), "utf8"));
const REL = fs.existsSync(path.join(DATA, "release.json")) ? JSON.parse(fs.readFileSync(path.join(DATA, "release.json"), "utf8")) : {};

const sc = S.scopes;
const paidL = S.paid_lines, paidD = S.paid_dollars;
const CODE = { ADDR_EXACT_NAME: "A", ADDR_CONTAINMENT: "C", ZIP5: "Z", CITY_STATE: "S", ALIAS: "L", NAME_EXACT_NATIONAL: "N", NAME_TOKEN: "T", EIN_IN_TEXT: "E" };
const outOfScope = (i) => sc.individual[i] + sc.foreign[i] + sc.unitemized[i];

function write(rel, html) {
  // "method.html" -> "method/index.html" for static hosting (clean URLs without rewrites).
  if (STATIC && /^[a-z]+\.html$/.test(rel) && rel !== "index.html" && rel !== "404.html") rel = rel.replace(/\.html$/, "/index.html");
  const p = path.join(PUB, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, html);
}

function bar(i, label) {
  const total = i === 0 ? paidL : paidD;
  const f = (v) => (i === 0 ? num(v) : money(v));
  const segs = [["Matched to a recipient EIN", sc.resolved[i], "s-res"], ["US organization, no confident match", sc.unmatched[i], "s-un"], ["Individuals (never shown)", sc.individual[i], "s-ind"], ["Outside the US", sc.foreign[i], "s-for"], ["Not itemized on the filing", sc.unitemized[i], "s-uni"]];
  return `<div class="block"><p class="small muted">${esc(label)}</p>
<div class="scope" role="img" aria-label="${esc(label)}: ${pct(sc.resolved[i], total)} matched">${segs.map(([l, v, c]) => (v ? `<span class="seg ${c}" style="flex:${v} 0 0" title="${esc(l)}: ${f(v)} (${pct(v, total)})"></span>` : "")).join("")}</div>
<ul class="legend small">${segs.map(([l, v, c]) => `<li><span class="key ${c}"></span>${esc(l)} <b>${f(v)}</b> <span class="muted">${pct(v, total)}</span></li>`).join("")}</ul></div>`;
}

// ---------------------------------------------------------------- home
const examples = S.top_widely.filter((r) => r[1].length < 40).slice(0, 6);
const home = layout({
  title: "",
  description: `See which private foundations fund any US nonprofit. ${num(S.release_rows)} grant lines from ${num(S.foundations)} Form 990-PF returns (tax year ${S.year}), matched to recipient EINs, every line linked to its IRS filing. Free, public domain.`,
  path: pageUrl(""),
  page: "home",
  jsonLd: {
    "@context": "https://schema.org", "@type": "WebSite", name: "WHOFUNDS", url: SITE.base + "/",
    potentialAction: { "@type": "SearchAction", target: `${SITE.origin}${pageUrl("search")}?q={search_term_string}`, "query-input": "required name=search_term_string" },
  },
  body: `
<section class="wrap hero">
  <p class="kicker">Open data · IRS Form 990-PF · Tax year ${S.year}</p>
  <h1>See which foundations fund any nonprofit.</h1>
  <p class="lede">Every grant that US private foundations reported on their ${S.year} returns, matched to the recipient's IRS tax ID. Search an organization to see who paid it, how much and for what, with the filing behind every line. Free, no login, public domain.</p>
  ${searchForm("home", "", true)}
  <p class="examples">Try: ${examples.map((r) => `<a href="${orgUrl(r[0])}">${esc(r[1])}</a>`).join(" ")}</p>
</section>
<section class="wrap">
  <div class="tiles">
    <div class="tile"><div class="v">${num(S.foundations)}</div><div class="l">private foundations' ${S.year} returns read</div></div>
    <div class="tile"><div class="v">${num(paidL)}</div><div class="l">grant lines paid during the year</div></div>
    <div class="tile"><div class="v">${money(paidD)}</div><div class="l">in grants, as filed</div></div>
    <div class="tile"><div class="v">${num(S.orgs)}</div><div class="l">recipient organizations matched to an EIN</div></div>
    <div class="tile"><div class="v">${num(S.orgs_multi_funded)}</div><div class="l">of them funded by 2+ foundations</div></div>
  </div>
</section>
<section class="wrap block">
  <h2>How it works</h2>
  <ol class="steps">
    <li><strong>Every private foundation files a 990-PF.</strong> Part XV lists each grant by payee name and address, but there is no field for the payee's tax ID.</li>
    <li><strong>WHOFUNDS recovers the missing ID.</strong> Each payee is matched to the IRS Business Master File. Every match keeps its score, its margin over the runner-up and a link to the source filing. When unsure, it refuses to guess.</li>
    <li><strong>You see who funds whom.</strong> Search any organization for its funders, the foundations that fund its peers, and the filing behind every line. Or download the whole graph.</li>
  </ol>
</section>
<section class="wrap block">
  <h2>The honest number</h2>
  <p class="note">A grant graph that hides its miss rate isn't a measurement. Here is how much of the record WHOFUNDS can resolve, by line and by dollar. Grants to individuals and foreign payees are out of scope for a US-EIN resolver, so they're counted separately from genuine misses.</p>
  ${bar(0, `By grant line: ${num(paidL)} lines`)}
  ${bar(1, `By dollar: ${money(paidD)}`)}
  <p class="small"><a href="${pageUrl("method")}">Read how matching works and where it fails →</a></p>
</section>
<section class="wrap block">
  <div class="tiles" style="background:none;border:0;gap:14px">
    <div class="tile" style="border:1px solid var(--rule);border-radius:10px"><h2>For fundraisers</h2><p class="small">Search a peer organization you admire. Its page lists every foundation that paid it, plus the foundations that fund organizations like it but not it yet, and whether each says it only funds preselected groups.</p></div>
    <div class="tile" style="border:1px solid var(--rule);border-radius:10px"><h2>For journalists and researchers</h2><p class="small">Download the full graph as CSV under CC0. Every edge has a source-filing URL, a match score and a strategy, so any single edge can be disputed without impeaching the dataset. <a href="${pageUrl("data")}">Get the data →</a></p></div>
    <div class="tile" style="border:1px solid var(--rule);border-radius:10px"><h2>For everyone</h2><p class="small">Spot a wrong match? Every match has a “Wrong?” link, and the <a href="${pageUrl("corrections")}">fix-it queue</a> lists the payees the resolver refused to guess. Corrections are public.</p></div>
  </div>
</section>
${!STATIC || SITE.supportUrl ? `<div class="wrap">${alertBox("", "")}</div>` : ""}
`,
});
write("index.html", home);

// ---------------------------------------------------------------- method
const strat = S.strategies.map(([k, v]) => `<tr><td><span class="chip">${esc(STRATEGY[CODE[k]]?.[0] || k)}</span></td><td class="num">${num(v)}</td><td class="num">${pct(v, sc.resolved[0])}</td><td>${esc(STRATEGY[CODE[k]]?.[1] || "")}</td></tr>`).join("");
const variantsRow = S.variants.map(([k, v]) => `<tr><td>${esc({ bmf: "IRS Business Master File name", efile: "Name on the organization's own e-filed return", bmf_segment: "Part of a BMF name (e.g. before a dash)", alias: "Curated alias (pipeline/aliases.csv)", filed_ein: "EIN the foundation wrote on the grant line" }[k] || k)}</td><td class="num">${num(v)}</td><td class="num">${pct(v, sc.resolved[0])}</td></tr>`).join("");
const fails = S.top_failures.slice(0, 15).map(([n, st, c, d]) => `<tr><td class="num">${num(c)}</td><td class="num">${money(d)}</td><td>${esc(n)}</td><td>${esc(st)}</td></tr>`).join("");
const topRec = S.top_received.slice(0, 15).map(([e, n, st, t, k]) => `<tr><td class="num">${money(t)}</td><td class="num">${num(k)}</td><td><a href="${orgUrl(e)}">${esc(n)}</a></td><td><code>${fmtEin(e)}</code></td></tr>`).join("");
const topWide = S.top_widely.slice(0, 15).map(([e, n, st, t, k]) => `<tr><td class="num">${num(k)}</td><td class="num">${money(t)}</td><td><a href="${orgUrl(e)}">${esc(n)}</a></td><td><code>${fmtEin(e)}</code></td></tr>`).join("");
const topFdn = S.top_grantmakers.slice(0, 15).map(([e, n, st, paid, res]) => `<tr><td class="num">${money(paid)}</td><td class="num">${pct(res, paid)}</td><td><a href="${fdnUrl(e)}">${esc(n)}</a></td><td><code>${fmtEin(e)}</code></td></tr>`).join("");
write("method.html", layout({
  title: "Method and limits",
  description: "How WHOFUNDS matches Form 990-PF grantees to IRS EINs, how often it succeeds and fails, and what it refuses to do.",
  path: pageUrl("method"),
  page: "method",
  body: `<div class="wrap page prose">
<p class="kicker">Method · tax year ${S.year} · built ${esc(S.built)}</p>
<h1>How the grant graph is built, and where it fails</h1>
<p class="lede">Form 990 Schedule I records a grantee's EIN. Form 990-PF Part XV, filed by every private foundation, doesn't. A foundation grant in the public record is a name and a mailing address: a string, not an edge. WHOFUNDS turns those strings into edges, and publishes its miss rate next to them.</p>

<h2>Inputs</h2>
<ul>
<li><strong>${num(S.foundations)} Form 990-PF returns</strong> for tax year ${S.year}, one per foundation (the latest submission when a return was amended), from the GivingTuesday 990 Data Lake's index of IRS e-file XML.</li>
<li><strong>The IRS Business Master File</strong> (all ~1.98 million registered exempt organizations), plus the names each organization files its own returns under (tax years 2022–2024), which fixes cases where the BMF carries a parent system's name.</li>
</ul>

<h2>What gets matched</h2>
${bar(0, "By grant line")}
${bar(1, "By dollar")}
<p>The two numbers differ, and quoting only the flattering one is how this field fools itself. The largest out-of-scope dollars are pharmaceutical patient-assistance foundations, whose payees are individual patients, and international grantmakers, whose payees have no US EIN. A US-EIN resolver can't resolve those in principle, so they're counted apart from genuine misses. Future-year commitments (Part XV line 3b) are parsed but excluded from every total: ${num(S.future.resolved[0] + S.future.unmatched[0] + S.future.individual[0] + S.future.foreign[0] + S.future.unitemized[0])} lines, ${money(S.future.resolved[1] + S.future.unmatched[1] + S.future.individual[1] + S.future.foreign[1] + S.future.unitemized[1])}.</p>

<h2>How each match was found</h2>
<table><thead><tr><th>Strategy</th><th>Edges</th><th>Share</th><th>Meaning</th></tr></thead><tbody>${strat}</tbody></table>
<p>Every candidate gets an IDF-weighted name similarity that tolerates one-letter typos, plurals and split words ("Music Works" vs "MusicWorks"). Acronyms are checked against initials. A match is accepted only above a threshold that rises as address evidence weakens, and only with a lead over the runner-up EIN that grows as the name match gets weaker. When unsure, the line is recorded as unmatched instead of guessed.</p>
<table><thead><tr><th>Which name matched</th><th>Edges</th><th>Share</th></tr></thead><tbody>${variantsRow}</tbody></table>

<h2>Rules that cost recall on purpose</h2>
<ul>
<li><strong>An organization isn't its foundation.</strong> “Oakland University” and “Oakland University Foundation” share a campus and most of a name, but they file different returns. If one side carries FOUNDATION, FRIENDS, ALUMNI, AUXILIARY, BOOSTERS, PTA, ACTION, VOTES and the like and the other doesn't, the pair is vetoed.</li>
<li><strong>Numbers must agree.</strong> PTA 12 isn't PTA 21. Post 123 isn't Post 132.</li>
<li><strong>A shared address isn't enough.</strong> A campus can host a dozen organizations. A weak name match at a shared address needs a large margin over every other organization at that address.</li>
<li><strong>A national name match needs a distinctive, nationally unique name.</strong> It also needs either the same state or a large national organization behind it.</li>
<li><strong>Duplicate names defer to the dominant entity.</strong> When dozens of BMF records share a name (a university and the trusts it administers), the one with at least ten times the revenue stands for the name.</li>
</ul>

<h2>Privacy</h2>
<p>Part XV can name individuals: scholarship students, patients, people in hardship. WHOFUNDS never publishes them. Payees filed as persons lose their name and street address at extraction. Lines that name a person inside a business-name field (“Jane Doe - Dean College”, “Curry College FBO …”) are classified as individual and dropped. An unmatched payee name is shown only when no part of it could be a person's name. Purposes that identify a beneficiary are withheld. Foundation contact persons and officers aren't republished.</p>

<h2>The query that couldn't be run before</h2>
<h3>Largest recipients of private-foundation money</h3>
<table><thead><tr><th>Received</th><th>Funders</th><th>Organization</th><th>EIN</th></tr></thead><tbody>${topRec}</tbody></table>
<p class="small">Fiscal sponsors and donor-advised-fund sponsors rank high because they're pass-throughs. The edge into them is real. The edge out of them isn't on any 990-PF, which is a structural limit of this record, not of this implementation.</p>
<h3>Most widely funded, by number of distinct foundations</h3>
<table><thead><tr><th>Funders</th><th>Received</th><th>Organization</th><th>EIN</th></tr></thead><tbody>${topWide}</tbody></table>
<h3>Largest grantmakers, and how much of each is resolvable</h3>
<table><thead><tr><th>Paid</th><th>Matched</th><th>Foundation</th><th>EIN</th></tr></thead><tbody>${topFdn}</tbody></table>
<h3>Where the resolver still refuses</h3>
<p>These are published so someone else can fix them. Most are national organizations with many legally separate local EINs, or common names that appear with an address matching none of them. <a href="${pageUrl("corrections")}">Help resolve them.</a></p>
<table><thead><tr><th>Lines</th><th>Dollars</th><th>Name as filed (normalized)</th><th>State</th></tr></thead><tbody>${fails}</tbody></table>

<h2>Known limits</h2>
<ul>
<li><strong>Part XV names a payee, not always a legal entity.</strong> Filers write a school within a university, a program name or a fiscal sponsor. Where no registered entity was named, no correct match exists.</li>
<li><strong>One tax year is one snapshot.</strong> Foundations file on staggered fiscal years, so a ${S.year} cross-section spans about eighteen months of period-end dates.</li>
<li><strong>The BMF lists only currently registered organizations.</strong> Grantees that have since dissolved, merged or lost exemption can't be matched.</li>
<li><strong>Government payees aren't in the BMF.</strong> Public school districts, cities and many public universities are therefore usually unmatched.</li>
<li><strong>The source is degrading.</strong> In September 2025 comments to the IRS, fourteen organizations and scholars reported thousands of 990 and 990-PF filings with missing or partial grants data in the XML. A grant that never reaches the XML can't be recovered by any method.</li>
</ul>

<h2>Why facts and not ratings</h2>
<p>Effectiveness standards for philanthropy keep failing at the same step: they need the measured party to submit something. The grant graph needs nothing from anyone, because the IRS already compels the filing. So this ledger carries filed facts and their provenance, and no verdicts. Scores, rankings and recommendations are worth arguing about, which is exactly why they shouldn't live in the ledger.</p>

<h2>Re-derive it yourself</h2>
<pre>python3 pipeline/sources.py download --year ${S.year}      # IRS BMF + data lake indexes
python3 pipeline/extract_pf_grants.py data/work/pf_index_${S.year}.csv 300000 data/work/run/pf_grants.csv.gz
python3 pipeline/resolve_eins.py data/work/run/pf_grants.csv.gz data/work/run/pf_grants_resolved.csv.gz
python3 pipeline/build_site.py data/work/run --year ${S.year}</pre>
<p>Both inputs are free and public with no API key, deliberately so. The one complete commercial grant dataset is sold under a licence that forbids redistribution and machine learning.</p>
</div>`,
}));

// ---------------------------------------------------------------- data
const files = [];
if (!STATIC) fs.mkdirSync(path.join(PUB, "downloads"), { recursive: true });
for (const [fn, meta] of Object.entries(REL)) {
  const src = path.join(RELEASE, fn);
  if (STATIC) files.push([fn, meta]);
  else if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(PUB, "downloads", fn));
    files.push([fn, meta]);
  }
}
const label = { grants: "Every published grant line, with provenance", organizations: "Recipient organizations matched to an EIN", foundations: "Every foundation return read, with matched / unmatched / out-of-scope totals" };
write("data.html", layout({
  title: "Download the data",
  description: `The WHOFUNDS grant graph for tax year ${S.year} as CSV, public domain (CC0): ${num(S.release_rows)} grant lines with recipient EINs, match scores and source-filing links.`,
  path: pageUrl("data"),
  page: "data",
  jsonLd: { "@context": "https://schema.org", "@type": "Dataset", name: `WHOFUNDS grant graph, tax year ${S.year}`, description: "US private-foundation grants from Form 990-PF Part XV, with recipient EINs recovered from the IRS Business Master File, match scores and source-filing links.", license: "https://creativecommons.org/publicdomain/zero/1.0/", url: SITE.origin + pageUrl("data"), isAccessibleForFree: true, temporalCoverage: `${S.year}/${Number(S.year) + 1}`, creator: { "@type": "Organization", name: "WHOFUNDS" }, distribution: files.map(([fn]) => ({ "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: STATIC ? downloadUrl(fn) : SITE.origin + downloadUrl(fn) })) },
  body: `<div class="wrap page prose">
<p class="kicker">Open data · CC0 · tax year ${S.year}</p>
<h1>Download the grant graph</h1>
<p class="lede">Public domain. Use it for anything, including commercial products and machine learning. Attribution is appreciated but not required.</p>
<table><thead><tr><th>File</th><th>Contents</th><th>Size</th><th>SHA-256</th></tr></thead><tbody>
${files.map(([fn, m]) => `<tr><td><a href="${esc(downloadUrl(fn))}" data-ev="download" data-kind="release">${esc(fn)}</a></td><td>${esc(label[(fn.match(/_(grants|organizations|foundations)\./) || [])[1]] || "")}</td><td class="num">${(m.bytes / 1e6).toFixed(1)} MB</td><td><code class="small">${esc(m.sha256.slice(0, 16))}…</code></td></tr>`).join("")}
</tbody></table>
<h2>Grant lines file</h2>
<p>${num(S.release_rows)} rows: every grant paid during the year that WHOFUNDS can publish. Matched lines carry a recipient EIN. Unmatched and foreign lines carry the name as filed, but only where no part of it could identify a person. Lines to individuals aren't in any file.</p>
<table><thead><tr><th>Column</th><th>Meaning</th></tr></thead><tbody>
<tr><td><code>filer_ein</code>, <code>filer_name</code></td><td>The foundation that filed the 990-PF</td></tr>
<tr><td><code>object_id</code>, <code>source_filing_url</code>, <code>source_xml_url</code></td><td>The exact e-filed return each line came from</td></tr>
<tr><td><code>section</code>, <code>line_no</code></td><td><code>paid</code> (Part XV 3a), and the line's position in it</td></tr>
<tr><td><code>scope</code></td><td><code>resolved</code>, <code>unmatched</code> or <code>foreign</code></td></tr>
<tr><td><code>recipient_ein</code>, <code>recipient_name</code></td><td>The matched organization (IRS BMF name)</td></tr>
<tr><td><code>recipient_name_as_filed</code></td><td>The payee as the foundation wrote it (when safe to show)</td></tr>
<tr><td><code>amount</code>, <code>purpose</code></td><td>As filed (purposes that identify a beneficiary are blank)</td></tr>
<tr><td><code>match_score</code>, <code>margin</code></td><td>Name similarity of the chosen EIN, and its lead over the runner-up</td></tr>
<tr><td><code>runner_up_ein</code>, <code>runner_up_score</code></td><td>The best rejected EIN, so a disputed edge can be checked</td></tr>
<tr><td><code>strategy</code>, <code>matched_variant</code></td><td>Which block found it, and which name of the organization matched</td></tr>
</tbody></table>
<h2>Cite</h2>
<pre>WHOFUNDS grant graph, tax year ${S.year} (built ${esc(S.built)}). Public domain (CC0). ${esc(SITE.origin + pageUrl("data"))}</pre>
<h2>Re-derive it</h2>
<p>The pipeline is five standard-library Python scripts reading the GivingTuesday 990 Data Lake (anonymous S3) and the IRS BMF. See <a href="${pageUrl("method")}">method</a>${SITE.repo ? `, and the source at <a href="https://github.com/${esc(SITE.repo)}">github.com/${esc(SITE.repo)}</a>` : ""}. ${STATIC ? "A scheduled job checks the sources for new filings and republishes the release and this site when they change." : ""}</p>
</div>`,
}));

// ---------------------------------------------------------------- corrections
fs.mkdirSync(path.join(PUB, "assets"), { recursive: true });
if (fs.existsSync(path.join(DATA, "fixit.json"))) fs.copyFileSync(path.join(DATA, "fixit.json"), path.join(PUB, "assets", "fixit.json"));
const queueHtml = STATIC
  ? `<p>Reports are public GitHub issues labelled <code>correction</code>. <a class="btn" href="https://github.com/${esc(SITE.repo)}/issues?q=label%3Acorrection" rel="noopener">See every report</a> <a class="btn" href="${esc(issueUrl("Correction: ", "Page or EIN:\n\nWhat's wrong:\n\nCorrect organization or EIN:\n\nEvidence:\n\nPlease don't include personal contact details; this issue is public."))}" rel="noopener">Report something else</a></p>`
  : `<div id="queue" class="ledger-wrap"><p class="muted" style="padding:12px">Loading…</p></div>`;
write("corrections.html", layout({
  title: "Fix a match",
  description: "Help resolve grants WHOFUNDS refused to guess, and see every correction reported so far.",
  path: pageUrl("corrections"),
  page: "corrections",
  body: `<div class="wrap page">
<p class="kicker">Corrections · public queue</p>
<h1>Fix a match</h1>
<p class="lede">The resolver refuses rather than guesses, so ${num(sc.unmatched[0])} grant lines (${money(sc.unmatched[1])}) to US organizations are still unmatched. Below are some it nearly matched. If you know whether the filed name and the IRS record are the same organization, say so. Every answer is logged publicly and reviewed before it changes the graph.</p>
<section class="block"><h2>Nearly matched: same organization?</h2><ol class="list" id="fixit"><li class="muted">Loading…</li></ol>
<p class="small muted">Shown: a random dozen of the 500 largest refused matches. Reload for more.</p></section>
<section class="block"><h2>Reported so far</h2>${queueHtml}
<p class="small muted">${STATIC ? "A GitHub account is needed to file an issue. Please don't post personal contact details or anything about private individuals." : "Emails and free-text notes are never shown here."} To report a wrong match on a page, use its “Wrong?” link.</p></section>
</div>`,
}));

// ---------------------------------------------------------------- about + 404
write("about.html", layout({
  title: "About",
  description: "WHOFUNDS is an open, public-domain grant graph of US private foundations, built from IRS filings.",
  path: pageUrl("about"),
  page: "about",
  body: `<div class="wrap page prose">
<h1>About WHOFUNDS</h1>
<p class="lede">WHOFUNDS is an open ledger of who funds whom in American philanthropy, built entirely from public IRS filings and published into the public domain.</p>
<h2>Principles</h2>
<ul>
<li><strong>Facts and provenance, never verdicts.</strong> No ratings, rankings by quality or recommendations. Every edge links to the filing it came from.</li>
<li><strong>Show the miss rate.</strong> Resolution is reported by line and by dollar, with out-of-scope payees counted separately from genuine misses.</li>
<li><strong>Refuse rather than guess.</strong> A wrong edge could misattribute funding. An unmatched line is honest.</li>
<li><strong>No private individuals.</strong> Grants to people are counted, never shown.</li>
<li><strong>Corrections are the point.</strong> Any single edge can be disputed publicly without impeaching the dataset.</li>
</ul>
<h2>What it isn't</h2>
<p>It isn't advice about where to give or apply, it isn't affiliated with the IRS or any foundation, and it doesn't cover public-charity grants (Form 990 Schedule I) yet.</p>
<h2>Privacy</h2>
<p>${STATIC
  ? `No cookies, no accounts and no tracking scripts${SITE.goatcounter ? ", except cookieless page counts (GoatCounter), which are skipped if your browser sends Do Not Track or Global Privacy Control" : ""}. The site is a set of static pages built from public IRS data.`
  : "No cookies and no accounts. Page views are counted with Vercel Web Analytics, which is cookieless, and they're skipped entirely if your browser sends Do Not Track or Global Privacy Control. Emails you leave for alerts or corrections are stored privately, never shown, never shared and never sold."}</p>
</div>`,
}));
write("404.html", layout({ title: "Not found", description: "Page not found.", path: L("/404"), page: "404", noindex: true, body: `<div class="wrap page"><h1>Not found</h1><p class="lede">That page isn't here. Search instead:</p>${searchForm("404", "", true)}</div>` }));

// search page (static mode renders results in the browser from /s/ shards)
if (STATIC) {
  write("search.html", layout({ title: "Search", description: "Search US nonprofits and private foundations by name or EIN.", path: pageUrl("search"), page: "search", noindex: true,
    body: `<div class="wrap page"><h1 id="search-title">Search</h1>${searchForm("page", "", true)}<p class="small muted" id="search-note"></p><ol class="results" id="results"></ol></div>` }));
}

// favicon
write("assets/favicon.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#0b6b50"/><path d="M14 20h8l4 22 6-18h4l6 18 4-22h8l-8 30h-7l-5-15-5 15h-7z" fill="#fff"/></svg>`);

console.log("static pages written; asset version", ASSET_V);
