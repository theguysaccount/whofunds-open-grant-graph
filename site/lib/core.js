// WHOFUNDS page templates. Pure functions, no Node imports: the same file renders
// pages on the server (Vercel), at build time (static landing pages for GitHub Pages)
// and in the browser (every other entity page, from gzipped JSON shards).
//
// Names of the *other* entities on a page (a funder's name on an org page, say) come
// from a resolver `N` with N.f(ein) -> [name, city, state, preselected, grantees, paid]
// and N.o(ein) -> [name, city, state, ntee, received, funders]; N.href(kind, ein) gives
// the link (static landing page or client-rendered page).

export const SITE = {
  name: "WHOFUNDS",
  mode: "server",
  origin: "https://example.org",
  path: "",
  get base() { return this.origin + this.path; },
  year: "2023",
  assetVersion: "1",
  repo: "",
  supportUrl: "",
  goatcounter: "",
  analytics: "",
};

export function configure(opts) {
  for (const [k, v] of Object.entries(opts || {})) if (v !== undefined && k !== "base") SITE[k] = v;
  SITE.path = String(SITE.path || "").replace(/\/$/, "");
  return SITE;
}

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function money(n, exact = false) {
  n = Number(n) || 0;
  if (exact || Math.abs(n) < 10000) return "$" + Math.round(n).toLocaleString("en-US");
  const units = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [v, u] of units) {
    if (Math.abs(n) >= v) {
      const x = n / v;
      return "$" + (x >= 100 ? Math.round(x) : x >= 10 ? x.toFixed(1).replace(/\.0$/, "") : x.toFixed(2).replace(/0$/, "").replace(/\.0$/, "")) + u;
    }
  }
  return "$" + Math.round(n);
}
export const num = (n) => (Number(n) || 0).toLocaleString("en-US");
export const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + "%" : "0%");
export const fmtEin = (e) => (e && e.length === 9 ? `${e.slice(0, 2)}-${e.slice(2)}` : e || "");
export const place = (c, s) => [c, s].filter(Boolean).join(", ");
export const filingUrl = (ein, oid) => `https://projects.propublica.org/nonprofits/organizations/${ein}/${oid}/full`;
export const xmlUrl = (oid) => `https://gt990datalake-rawdata.s3.amazonaws.com/EfileData/XmlFiles/${oid}_public.xml`;
export const L = (p) => SITE.path + p;
const dir = (p) => (SITE.mode === "static" ? p + "/" : p);
export const orgUrl = (ein) => L(dir(`/org/${ein}`));
export const fye = (d) => (d && d.length >= 7 ? `FYE ${d.slice(5, 7)}/${d.slice(0, 4)}` : "");
export const fdnUrl = (ein) => L(dir(`/foundation/${ein}`));
export const pageUrl = (name) => L(name === "" ? "/" : dir(`/${name}`));
export const issueUrl = (title, body, labels = "correction") =>
  `https://github.com/${SITE.repo}/issues/new?labels=${encodeURIComponent(labels)}&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;

export const STRATEGY = {
  A: ["Same address", "Filed street or PO box and ZIP match the IRS record exactly."],
  C: ["Same street", "Same house number and street in the same ZIP; suite or unit differ."],
  Z: ["Same ZIP", "Same 5-digit ZIP code; name matched closely."],
  S: ["Same city", "Same city and state; name matched very closely."],
  L: ["Known alias", "Filed name is a documented common name for this organization."],
  N: ["Exact name", "Exact, nationally unique name; address on the filing did not match."],
  T: ["Distinctive name", "Near-exact distinctive name, nationally unique; address did not match."],
  E: ["EIN on filing", "The foundation wrote this organization's EIN on the grant line itself."],
};

const NTEE = {
  A: "Arts, culture & humanities", B: "Education", C: "Environment", D: "Animal-related", E: "Health care",
  F: "Mental health & crisis", G: "Diseases & disorders", H: "Medical research", I: "Crime & legal",
  J: "Employment", K: "Food, agriculture & nutrition", L: "Housing & shelter", M: "Public safety & disaster",
  N: "Recreation & sports", O: "Youth development", P: "Human services", Q: "International affairs",
  R: "Civil rights & advocacy", S: "Community improvement", T: "Philanthropy & grantmaking",
  U: "Science & technology", V: "Social science", W: "Public & societal benefit", X: "Religion-related",
  Y: "Mutual & membership benefit", Z: "Unknown",
};
export const ntee = (c) => (c ? NTEE[c[0]] || "" : "");

function matchChip(code, score, margin) {
  const [label, why] = STRATEGY[code] || ["Matched", ""];
  // Static pages carry thousands of rows: a short tooltip there, the full explanation on /method.
  const tip = SITE.mode === "static"
    ? `Name score ${Number(score).toFixed(2)}, lead ${Number(margin).toFixed(2)}`
    : `${why} Name score ${Number(score).toFixed(2)}; lead over the next-best IRS record ${Number(margin).toFixed(2)}.`;
  const weak = code === "N" || code === "T" || Number(score) < 0.8;
  return `<span class="chip${weak ? " chip-weak" : ""}" title="${esc(tip)}"><span class="chip-l">${esc(label)}</span> <span class="chip-s">${Number(score).toFixed(2)}</span></span>`;
}

// ---------------------------------------------------------------- layout
export function layout({ title, description, path, body, jsonLd = null, noindex = false, page = "", ogTitle = "", ogImage = "" }) {
  const url = SITE.origin + (path || L("/"));
  const t = title ? `${title} · ${SITE.name}` : `${SITE.name}: who funds whom, from IRS records`;
  const v = SITE.assetVersion;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
${noindex ? '<meta name="robots" content="noindex,follow">' : ""}
<meta property="og:site_name" content="${SITE.name}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(ogTitle || title || "WHOFUNDS")}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
<meta property="og:image" content="${esc(SITE.mode === "static" || !ogImage ? SITE.base + "/assets/og.png" : ogImage)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#fbfaf7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0f1113" media="(prefers-color-scheme: dark)">
<link rel="icon" href="${L("/assets/favicon.svg")}" type="image/svg+xml">
<meta name="whofunds" data-base="${esc(SITE.path)}" data-mode="${SITE.mode}" data-repo="${esc(SITE.repo)}" data-v="${esc(SITE.assetVersion)}"${SITE.analytics === "vercel" ? ' data-analytics="vercel"' : ""}${SITE.goatcounter ? ' data-analytics="goatcounter"' : ""}${SITE.supportUrl ? ` data-support="${esc(SITE.supportUrl)}"` : ""}>
<link rel="stylesheet" href="${L("/assets/app.css")}?v=${v}">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, "\\u003c")}</script>` : ""}
<script defer src="${L("/assets/app.js")}?v=${v}"></script>
${SITE.mode === "static" ? `<script type="module" src="${L("/assets/entity.js")}?v=${v}"></script>` : ""}
${SITE.goatcounter ? `<script data-goatcounter="${esc(SITE.goatcounter)}" async src="https://gc.zgo.at/count.js"></script>` : ""}
</head>
<body data-page="${esc(page)}">
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="wrap top-in">
    <a class="logo" href="${pageUrl("")}" aria-label="WHOFUNDS home">WHO<span>FUNDS</span></a>
    <nav class="nav" aria-label="Main">
      <a href="${pageUrl("method")}"${page === "method" ? ' aria-current="page"' : ""}>Method</a>
      <a href="${pageUrl("data")}"${page === "data" ? ' aria-current="page"' : ""}>Data</a>
      <a href="${pageUrl("corrections")}"${page === "corrections" ? ' aria-current="page"' : ""}>Fix a match</a>
    </nav>
    ${page === "home" ? "" : searchForm("top", "")}
  </div>
</header>
<main id="main">
${body}
</main>
<footer class="foot">
  <div class="wrap">
    <p><strong>WHOFUNDS</strong> records what private foundations reported paying on IRS Form 990-PF (tax year ${SITE.year}) and which IRS-registered organization each payee most likely is. It holds facts and their sources, with no ratings and no recommendations.</p>
    <p>Data: <a href="https://990data.givingtuesday.org/">GivingTuesday 990 Data Lake</a> e-file XML and the <a href="https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf">IRS Business Master File</a>. Grants to individuals are never shown. Everything here is public domain (<a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0</a>).</p>
    <p class="foot-links"><a href="${pageUrl("method")}">Method &amp; limits</a> · <a href="${pageUrl("data")}">Download the data</a> · <a href="${pageUrl("corrections")}">Corrections</a> · <a href="${pageUrl("about")}">About</a>${SITE.repo ? ` · <a href="https://github.com/${esc(SITE.repo)}">Source</a>` : ""}${SITE.supportUrl ? ` · <a href="${esc(SITE.supportUrl)}" data-ev="support_open">Support WHOFUNDS</a>` : ""}</p>
  </div>
</footer>
</body>
</html>`;
}

export function searchForm(id, value, big = false) {
  return `<form class="search${big ? " search-big" : ""}" action="${pageUrl("search")}" method="get" role="search">
  <label class="sr" for="q-${id}">Search organizations and foundations</label>
  <input id="q-${id}" name="q" type="search" value="${esc(value)}" placeholder="${big ? "Search any nonprofit or foundation" : "Search"}" autocomplete="off" spellcheck="false" data-typeahead>
  <button type="submit">Search</button>
  <div class="ta" role="listbox" hidden></div>
</form>`;
}

// ---------------------------------------------------------------- org page
export function orgPage(o, N, opts = {}) {
  return layout({ ...orgMeta(o, N), body: orgBody(o, N, opts) });
}

export function orgMeta(o, N) {
  const nf = o.nf;
  const title = `Who funds ${o.n}?`;
  const fdnList = o.f.slice(0, 6).map((f) => N.f(f[0])[0]).join(", ");
  const description = `${nf} private foundation${nf === 1 ? "" : "s"} reported paying ${o.n} (${place(o.c, o.s)}) ${money(o.t)} on ${SITE.year} Form 990-PF returns${fdnList ? `, including ${fdnList}` : ""}. Every grant links to its IRS filing.`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NGO",
    name: o.n,
    taxID: fmtEin(o.e),
    address: o.c || o.s ? { "@type": "PostalAddress", addressLocality: o.c, addressRegion: o.s, addressCountry: "US" } : undefined,
    url: SITE.origin + N.href("o", o.e),
    funder: o.f.slice(0, 10).map((f) => ({ "@type": "Organization", name: N.f(f[0])[0], taxID: fmtEin(f[0]) })),
  };
  return { title, description, jsonLd, path: N.href("o", o.e), page: "org", ogTitle: title,
    ogImage: `${SITE.origin}${orgUrl(o.e)}/card.png?v=${SITE.assetVersion}` };
}

// opts.limit: render only the first N funder rows (static landing pages); the rest are
// loaded in the browser from the shard when "Show all" is pressed.
export function orgBody(o, N, opts = {}) {
  const nf = o.nf;
  const title = `Who funds ${o.n}?`;
  const lede = `<strong>${num(nf)} private foundation${nf === 1 ? "" : "s"}</strong> reported paying ${esc(o.n)} <strong>${money(o.t, o.t < 1e6)}</strong> on returns for tax year ${SITE.year}.`;
  const SHOW = 20;
  const list = opts.limit ? o.f.slice(0, opts.limit) : o.f;
  const rows = list.map((f, i) => funderRow(f, N, o, i >= SHOW)).join("");
  const more = o.f.length > SHOW ? `<p><button class="btn" data-expand="funders"${list.length < o.f.length ? ' data-load="org"' : ""}>Show all ${num(o.f.length)} funders</button></p>` : "";
  const jump = `<p class="jump small"><a href="#funders">${num(nf)} funder${nf === 1 ? "" : "s"}</a>${o.q.length ? ` · <a href="#prospects">${o.q.length} foundations that fund peers</a>` : ""}${o.p.length ? ` · <a href="#peers">${o.p.length} closest peers</a>` : ""}</p>`;
  const prospects = o.q.length
    ? `<section class="block" id="prospects">
  <h2>Foundations that fund organizations like ${esc(o.n)}</h2>
  <p class="note">These foundations paid at least two of the 25 organizations that share the most funders with ${esc(o.n)}, but don't appear on its own funder list for ${SITE.year}. This is a factual overlap from filings, not a recommendation or an endorsement.</p>
  <ol class="list">${o.q.map(([fe, k, amt]) => {
      const f = N.f(fe);
      return `<li><a href="${N.href("f", fe)}" data-ev="prospect_open">${esc(f[0])}</a> <span class="muted">${esc(place(f[1], f[2]))}</span><br><span class="small">Paid ${k} of the 25 closest peers · ${money(amt)} to them${f[3] ? ' · <span class="tag">Says it funds preselected organizations only</span>' : ""}</span></li>`;
    }).join("")}</ol>
</section>`
    : "";
  const peers = o.p.length
    ? `<section class="block" id="peers">
  <h2>Organizations with the most funders in common</h2>
  <ol class="list">${o.p.map(([pe, k]) => {
      const p = N.o(pe);
      return `<li><a href="${N.href("o", pe)}" data-ev="peer_open">${esc(p[0])}</a> <span class="muted">${esc(place(p[1], p[2]))}</span><br><span class="small">${k} shared funder${k === 1 ? "" : "s"} · ${p[5]} funder${p[5] === 1 ? "" : "s"} in all</span></li>`;
    }).join("")}</ol>
</section>`
    : "";
  return `
<div class="wrap page" data-entity="org" data-ein="${o.e}" data-name="${esc(o.n)}">
  <p class="kicker">Organization · EIN ${fmtEin(o.e)}${o.c || o.s ? " · " + esc(place(o.c, o.s)) : ""}${ntee(o.nt) ? " · " + esc(ntee(o.nt)) : ""}</p>
  <h1>${esc(title)}</h1>
  <p class="lede">${lede}</p>
  <div class="actions">
    <button class="btn btn-primary" data-share data-share-text="${esc(`${nf} private foundation${nf === 1 ? "" : "s"} funded ${o.n} in tax year ${SITE.year}. See who, with the IRS filing behind each grant:`)}">Share this list</button>
    ${SITE.mode === "server" || SITE.supportUrl ? '<a class="btn" href="#alerts">Get funder alerts</a>' : ""}
    ${csvButton(`/api/export?ein=${o.e}`, `whofunds_${o.e}_funders.csv`)}
  </div>
  ${jump}
  <section class="block" id="funders">
    <h2>Funders <span class="count">${num(nf)}</span></h2>
    <div class="ledger-wrap"><table class="ledger" data-collapsible="funders">
      <thead><tr><th scope="col">Foundation</th><th scope="col" class="r">Paid</th><th scope="col">Purpose as filed</th><th scope="col">Match</th><th scope="col">Source</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    ${more}
    <p class="small muted">Amounts are as filed on each foundation's 990-PF for a tax year beginning in ${SITE.year}. The match shows how the payee on the filing was linked to this EIN (<a href="${pageUrl("method")}">what each match type means</a>); hover or tap it for the score. Wrong? ${correctLink(o, null, "Report it")}.</p>
  </section>
  ${prospects}
  ${peers}
  ${SITE.mode === "server" || SITE.supportUrl ? alertBox(o.e, o.n) : ""}
  <section class="block prov">
    <h2>Where this comes from</h2>
    <p>Each row is a grant line from Part XV of a private foundation's Form 990-PF. The 990-PF has no field for the recipient's tax ID, so WHOFUNDS matched the payee's name and address to the IRS Business Master File${o.bn ? ` (where this EIN is registered as “${esc(o.bn)}”)` : ""}. <a href="${pageUrl("method")}">How matching works and where it fails.</a></p>
    <p class="small">Other views of this organization: <a href="https://projects.propublica.org/nonprofits/organizations/${o.e}">ProPublica Nonprofit Explorer</a> · <a href="https://apps.irs.gov/app/eos/details/?ein=${o.e}">IRS Tax Exempt Organization Search</a></p>
  </section>
</div>
${SITE.mode === "server" ? correctionDialog() : ""}`;
}

function funderRow(f, N, o, hidden = false) {
  const [fe, amt, oid, tpe, lines] = f;
  const meta = N.f(fe);
  const first = lines[0];
  const purposes = lines.map((l) => l[1]).filter(Boolean);
  const uniqP = [...new Set(purposes)];
  const clip = (t) => (SITE.mode === "static" && t.length > 140 ? t.slice(0, 139).trimEnd() + "…" : t);
  const purposeHtml = uniqP.length
    ? esc(clip(uniqP[0])) + (uniqP.length > 1 ? ` <span class="muted">+${uniqP.length - 1} more</span>` : "")
    : '<span class="muted">—</span>';
  const filed = lines.map((l) => l[5]).filter(Boolean)[0];
  const multi = lines.length > 1 ? `<br><span class="small muted">${lines.length} grant lines</span>` : "";
  return `<tr${hidden ? ' class="more"' : ""}>
<td data-label="Foundation"><a href="${N.href("f", fe)}" data-ev="funder_open" data-fe="${fe}">${esc(meta[0])}</a><br><span class="small muted">${esc(place(meta[1], meta[2]))}${meta[3] ? ' · <span class="tag">Preselected only</span>' : ""}</span></td>
<td data-label="Paid" class="r num">${money(amt, true)}${multi}</td>
<td data-label="Purpose">${purposeHtml}${filed ? `<br><span class="small muted">Filed as “${esc(filed)}”</span>` : ""}</td>
<td data-label="Match">${matchChip(first[4], first[2], first[3])} ${correctLink(o, f, "Wrong?", meta[0])}</td>
<td data-label="Source"><a href="${filingUrl(fe, oid)}" data-ev="funder_open" data-fe="${fe}" data-kind="filing" rel="noopener" target="_blank">990-PF</a>${SITE.mode === "static" ? "" : ` <a class="small muted" href="${xmlUrl(oid)}" rel="noopener nofollow" target="_blank">XML</a>`}<br><span class="muted small nowrap">${esc(fye(tpe))}</span></td>
</tr>`;
}

// "Wrong?" link: a dialog posting to /api/collect on the server; a prefilled public GitHub
// issue on the static site (the issue tracker is the public correction queue).
function correctLink(o, f, text, fdnName = "") {
  if (SITE.mode === "static") {
    // app.js turns this into a prefilled public GitHub issue on click (keeps pages small).
    return `<a href="#" class="small" data-wrong="${o.e}"${f ? ` data-fe="${f[0]}" data-oid="${esc(f[2])}"` : ""}>${esc(text)}</a>`;
  }
  if (SITE.mode === "server") {
    return `<a href="#" class="small" data-correct="${o.e}"${f ? ` data-fe="${f[0]}" data-oid="${esc(f[2])}"` : ""}${fdnName ? ` aria-label="Report a wrong match for ${esc(fdnName)}"` : ""}>${esc(text)}</a>`;
  }
  const title = f ? `Wrong match: ${fdnName} → ${o.n} (EIN ${fmtEin(o.e)})` : `Wrong match on ${o.n} (EIN ${fmtEin(o.e)})`;
  const body = [
    `Page: ${SITE.base}${orgUrl(o.e).slice(SITE.path.length)}`,
    f ? `Foundation EIN: ${fmtEin(f[0])}` : "",
    f ? `Filing: ${filingUrl(f[0], f[2])}` : "",
    "", "What's wrong (pick one): different organization / wrong chapter or affiliate / names a private individual / other", "",
    "Correct organization or EIN, if you know it:", "", "Evidence or note:", "",
    "Please don't include personal contact details; this issue is public.",
  ].filter((x) => x !== null).join("\n");
  return `<a class="small" href="${esc(issueUrl(title, body))}" target="_blank" rel="noopener" data-ev="correction_open">${esc(text)}</a>`;
}

function csvButton(serverHref, filename) {
  if (SITE.mode === "server") return `<a class="btn" href="${serverHref}" data-ev="download" rel="nofollow">Download CSV</a>`;
  return `<button class="btn" data-csv="${esc(filename)}" data-ev="download">Download CSV</button>`;
}

export function alertBox(ein, name) {
  if (SITE.mode === "static") {
    // Monetization slot: shown only when WHOFUNDS_SUPPORT_URL is configured.
    return `<section class="block alert-box" id="alerts">
  <h2>Get funder alerts</h2>
  <p>Funder alerts for ${esc(name || "organizations like yours")}: an email when a new 990-PF shows a new funder for it or its peers.</p>
  <p><a class="btn btn-primary" href="${esc(SITE.supportUrl)}" data-ev="support_open" rel="noopener">Get alerts</a></p>
</section>`;
  }
  return `<section class="block alert-box" id="alerts">
  <h2>Get funder alerts</h2>
  <p>We're building alerts for when a new 990-PF shows a new funder for ${esc(name || "an organization")} or its peers. Leave an email and we'll write <em>once</em>, when alerts launch. It isn't shared and isn't shown anywhere.</p>
  <form class="inline-form" data-collect="alert">
    <input type="hidden" name="ein" value="${esc(ein || "")}">
    <label class="sr" for="alert-email">Email</label>
    <input id="alert-email" name="email" type="email" required placeholder="you@yourorg.org" autocomplete="email">
    <button class="btn btn-primary" type="submit">Notify me</button>
    <p class="form-msg small" role="status" aria-live="polite"></p>
  </form>
</section>`;
}

export function correctionDialog() {
  return `<dialog class="dlg" id="correct-dlg" aria-labelledby="correct-title">
<form method="dialog" class="dlg-in" data-collect="correction">
  <h2 id="correct-title">Report a wrong match</h2>
  <p class="small">Corrections are reviewed and listed publicly on <a href="${pageUrl("corrections")}">/corrections</a> without your email.</p>
  <input type="hidden" name="org_ein"><input type="hidden" name="fdn_ein"><input type="hidden" name="object_id"><input type="hidden" name="page">
  <fieldset><legend>What's wrong?</legend>
    <label><input type="radio" name="issue" value="wrong_org" checked> This grant went to a different organization</label>
    <label><input type="radio" name="issue" value="chapter"> Right name, wrong chapter or affiliate</label>
    <label><input type="radio" name="issue" value="individual"> This line names or concerns a private individual</label>
    <label><input type="radio" name="issue" value="other"> Something else</label>
  </fieldset>
  <label>Correct organization or EIN (if you know it)<input name="suggested" maxlength="200"></label>
  <label>Evidence or note<textarea name="note" rows="3" maxlength="1000"></textarea></label>
  <label>Your email (optional, private, only to ask a follow-up)<input name="email" type="email" maxlength="200" autocomplete="email"></label>
  <div class="dlg-actions"><button class="btn" value="cancel" formnovalidate>Cancel</button><button class="btn btn-primary" type="submit" value="send">Submit correction</button></div>
  <p class="form-msg small" role="status" aria-live="polite"></p>
</form>
</dialog>`;
}

// ---------------------------------------------------------------- foundation page
export function foundationPage(f, showAll, N, opts = {}) {
  return layout({ ...foundationMeta(f, N, showAll), body: foundationBody(f, showAll, N, opts) });
}

function totals(k) {
  const order = ["resolved", "unmatched", "individual", "foreign", "unitemized"];
  return [order.reduce((s, x) => s + k[x][1], 0), order.reduce((s, x) => s + k[x][0], 0)];
}

export function foundationMeta(f, N, showAll = false) {
  const [paid, lines] = totals(f.k);
  const title = `Where ${f.n}'s grants went`;
  const topNames = f.g.slice(0, 5).map((g) => N.o(g[0])[0]).join(", ");
  const description = `${f.n} (${place(f.c, f.s)}) reported ${money(paid)} in grants across ${num(lines)} lines on its ${SITE.year} Form 990-PF${topNames ? `, to recipients including ${topNames}` : ""}. Matched to recipient EINs, with sources.`;
  const jsonLd = { "@context": "https://schema.org", "@type": "Organization", name: f.n, taxID: fmtEin(f.e), url: SITE.origin + N.href("f", f.e),
    address: { "@type": "PostalAddress", addressLocality: f.c, addressRegion: f.s, addressCountry: "US" } };
  return { title, description, jsonLd, path: N.href("f", f.e), page: "foundation", ogTitle: title, noindex: showAll,
    ogImage: `${SITE.origin}${fdnUrl(f.e)}/card.png?v=${SITE.assetVersion}` };
}

export function foundationBody(f, showAll, N, opts = {}) {
  const k = f.k;
  const [paid, lines] = totals(k);
  const title = `Where ${f.n}'s grants went`;
  const all0 = [
    ...f.g.map((g) => ({ r: true, amt: g[1], g })),
    ...f.u.map((u) => ({ r: false, amt: u[3], u })),
  ].sort((a, b) => b.amt - a.amt);
  const all = opts.limit ? all0.slice(0, opts.limit) : all0;
  const LIMIT = opts.limit ? Math.min(300, opts.limit) : 300;
  const shown = SITE.mode === "static" || showAll ? all : all.slice(0, LIMIT);
  const rows = shown.map((x, i) => {
    const more = SITE.mode === "static" && i >= LIMIT ? ' class="more"' : "";
    if (x.r) {
      const [oe, amt, purpose, score, margin, code] = x.g;
      const o = N.o(oe);
      const pp = SITE.mode === "static" && purpose && purpose.length > 140 ? purpose.slice(0, 139).trimEnd() + "…" : purpose;
      return `<tr${more}><td data-label="Recipient"><a href="${N.href("o", oe)}">${esc(o[0])}</a><br><span class="small muted">${esc(place(o[1], o[2]))} · EIN ${fmtEin(oe)}</span></td><td data-label="Paid" class="r num">${money(amt, true)}</td><td data-label="Purpose">${pp ? esc(pp) : '<span class="muted">—</span>'}</td><td data-label="Match">${matchChip(code, score, margin)}</td></tr>`;
    }
    const [nm, city, st, amt, purpose, kind] = x.u;
    return `<tr class="unres${more ? " more" : ""}"><td data-label="Recipient">${esc(nm)}<br><span class="small muted">${esc(place(city, st))} · ${kind === "f" ? "outside the US" : "no confident EIN match"}</span></td><td data-label="Paid" class="r num">${money(amt, true)}</td><td data-label="Purpose">${purpose ? esc(purpose) : '<span class="muted">—</span>'}</td><td data-label="Match"><span class="chip chip-none">${kind === "f" ? "Foreign" : "Unmatched"}</span>${kind === "f" ? "" : ` <a href="${pageUrl("corrections")}" class="small">Help match</a>`}</td></tr>`;
  }).join("");
  const seg = (label, v, cls) => (v[1] > 0 ? `<span class="seg ${cls}" style="flex:${v[1]} 0 0" title="${esc(label)}: ${money(v[1])} (${pct(v[1], paid)})"></span>` : "");
  const scopeBar = paid > 0 ? `<div class="scope" role="img" aria-label="Share of dollars matched to an EIN: ${pct(k.resolved[1], paid)}">
  ${seg("Matched to an EIN", k.resolved, "s-res")}${seg("US organization, no confident match", k.unmatched, "s-un")}${seg("Individuals (not shown)", k.individual, "s-ind")}${seg("Outside the US", k.foreign, "s-for")}${seg("Not itemized on the filing", k.unitemized, "s-uni")}
</div>
<ul class="legend small">
  <li><span class="key s-res"></span>Matched to an EIN <b>${money(k.resolved[1])}</b> <span class="muted">${num(k.resolved[0])} lines</span></li>
  ${k.unmatched[0] ? `<li><span class="key s-un"></span>No confident match <b>${money(k.unmatched[1])}</b> <span class="muted">${num(k.unmatched[0])}</span></li>` : ""}
  ${k.individual[0] ? `<li><span class="key s-ind"></span>Individuals, not shown <b>${money(k.individual[1])}</b> <span class="muted">${num(k.individual[0])}</span></li>` : ""}
  ${k.foreign[0] ? `<li><span class="key s-for"></span>Outside the US <b>${money(k.foreign[1])}</b> <span class="muted">${num(k.foreign[0])}</span></li>` : ""}
  ${k.unitemized[0] ? `<li><span class="key s-uni"></span>Not itemized <b>${money(k.unitemized[1])}</b> <span class="muted">${num(k.unitemized[0])}</span></li>` : ""}
</ul>` : "";
  const app = f.app || {};
  const appHtml = `<section class="block">
  <h2>What its filing says about applications</h2>
  ${app.pre ? `<p><span class="tag">Preselected only</span> It checked the 990-PF box saying it only gives to preselected organizations and does not accept unsolicited requests.</p>` : `<p>It did <em>not</em> check the 990-PF box for “only contributes to preselected organizations.”</p>`}
  <dl class="dl">
    ${app.form ? `<dt>Form of application</dt><dd>${esc(app.form)}</dd>` : ""}
    ${app.dl ? `<dt>Deadlines</dt><dd>${esc(app.dl)}</dd>` : ""}
    ${app.rs ? `<dt>Restrictions</dt><dd>${esc(app.rs)}</dd>` : ""}
    ${app.web && !/^(N\/?A|NONE)$/i.test(app.web) ? `<dt>Website on filing</dt><dd>${esc(app.web)}</dd>` : ""}
  </dl>
  <p class="small muted">Contact names and phone numbers are on the <a href="${filingUrl(f.e, f.o)}" target="_blank" rel="noopener">filing itself</a>. WHOFUNDS doesn't republish them.</p>
</section>`;
  const withheld = k.withheld[0]
    ? `<p class="small muted">${num(k.withheld[0])} more line${k.withheld[0] === 1 ? " (" + money(k.withheld[1]) + ") isn't" : "s (" + money(k.withheld[1]) + ") aren't"} listed because the payee name as filed could identify a private person.</p>`
    : "";
  const cofunders = f.cf.length ? `<section class="block"><h2>Foundations that fund the same organizations</h2><ol class="list">${f.cf.map(([fe2, n]) => {
    const x = N.f(fe2);
    return `<li><a href="${N.href("f", fe2)}">${esc(x[0])}</a> <span class="muted">${esc(place(x[1], x[2]))}</span><br><span class="small">${n} recipient${n === 1 ? "" : "s"} in common</span></li>`;
  }).join("")}</ol></section>` : "";
  return `
<div class="wrap page" data-entity="foundation" data-ein="${f.e}" data-name="${esc(f.n)}">
  <p class="kicker">Private foundation · EIN ${fmtEin(f.e)}${f.c || f.s ? " · " + esc(place(f.c, f.s)) : ""} · Return for the year ending ${esc(f.tp)}</p>
  <h1>${esc(title)}</h1>
  <p class="lede">It reported <strong>${money(paid, paid < 1e6)}</strong> in grants paid across <strong>${num(lines)} line${lines === 1 ? "" : "s"}</strong>. WHOFUNDS matched <strong>${pct(k.resolved[1], paid)}</strong> of those dollars to ${num(f.nr)} recipient organization${f.nr === 1 ? "" : "s"}.</p>
  <div class="actions">
    <button class="btn btn-primary" data-share data-share-text="${esc(`Where ${f.n}'s grants went in tax year ${SITE.year}, every line linked to the IRS filing:`)}">Share</button>
    <a class="btn" href="${filingUrl(f.e, f.o)}" target="_blank" rel="noopener">View the 990-PF</a>
    ${csvButton(`/api/export?fdn=${f.e}`, `whofunds_${f.e}_grants.csv`)}
  </div>
  ${scopeBar}
  ${appHtml}
  <section class="block">
    <h2>Grants paid <span class="count">${num(f.np || all.length)} published lines</span></h2>
    <div class="ledger-wrap"><table class="ledger" data-collapsible="grants">
      <thead><tr><th scope="col">Recipient</th><th scope="col" class="r">Paid</th><th scope="col">Purpose as filed</th><th scope="col">Match</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="muted">No grant lines that can be shown.</td></tr>'}</tbody>
    </table></div>
    ${all0.length > all.length ? `<p><button class="btn" data-expand="grants" data-load="foundation">Show all ${num(all0.length)} lines</button></p>`
      : all.length > LIMIT ? (SITE.mode === "static" ? `<p><button class="btn" data-expand="grants">Show all ${num(all.length)} lines</button></p>` : !showAll ? `<p><a class="btn" href="${fdnUrl(f.e)}?all=1" rel="nofollow">Show all ${num(all.length)} lines</a></p>` : "") : ""}
    ${f.np && f.np > all0.length ? `<p class="small muted">The page lists the ${num(all0.length)} largest of ${num(f.np)} published lines. <a href="${pageUrl("data")}">The CSV release</a> has every line.</p>` : ""}
    ${withheld}
  </section>
  ${cofunders}
  <section class="block prov"><h2>Where this comes from</h2><p>Grant lines are from Part XV of this foundation's <a href="${filingUrl(f.e, f.o)}" target="_blank" rel="noopener">Form 990-PF</a> (<a href="${xmlUrl(f.o)}" target="_blank" rel="noopener nofollow">XML</a>). The filing names each payee but gives no tax ID, so WHOFUNDS matched payees to the IRS Business Master File. Lines it couldn't match confidently are listed as filed. <a href="${pageUrl("method")}">Method and limits.</a></p></section>
</div>`;
}

// ---------------------------------------------------------------- search + errors
export function searchPage(q, results) {
  const items = results.map((r) => `<li class="res">
  <a href="${r.kind === "org" ? orgUrl(r.ein) : fdnUrl(r.ein)}"><span class="kind kind-${r.kind}">${r.kind === "org" ? "Organization" : "Foundation"}</span> ${esc(r.name)}</a>
  <span class="small muted">${esc(place(r.city, r.state))} · EIN ${fmtEin(r.ein)} · ${r.kind === "org" ? `${money(r.total)} from ${r.count} foundation${r.count === 1 ? "" : "s"}` : `${money(r.total)} in grants, ${r.count} matched recipient${r.count === 1 ? "" : "s"}`}</span>
</li>`).join("");
  const body = `<div class="wrap page">
  <h1>${q ? `Results for “${esc(q)}”` : "Search"}</h1>
  ${searchForm("page", q, true)}
  ${q && !results.length ? `<p class="lede">No organization or foundation matched. Try fewer words, or search by EIN.</p><p class="small muted">WHOFUNDS lists organizations that at least one private foundation reported paying in tax year ${SITE.year} (and that could be matched to an EIN), plus every foundation that filed a 990-PF.</p>` : ""}
  <ol class="results" id="results">${items}</ol>
</div>`;
  return layout({ title: q ? `Search: ${q}` : "Search", description: "Search US nonprofits and private foundations by name or EIN.", path: pageUrl("search"), body, noindex: true, page: "search" });
}

export function notFoundPage(kind, ein) {
  const body = `<div class="wrap page"><h1>Not in the ${SITE.year} graph</h1>
<p class="lede">${kind === "org" ? `No private-foundation grant on a ${SITE.year} 990-PF was matched to EIN ${esc(fmtEin(ein))}.` : `No ${SITE.year} Form 990-PF was found for EIN ${esc(fmtEin(ein))}.`}</p>
<p>That can mean it received no foundation grants that year, that its funders' filings named it in a way WHOFUNDS couldn't match confidently, or that the EIN is mistyped. <a href="${pageUrl("corrections")}">Help fix unmatched grants</a> or search again:</p>
${searchForm("nf", "", true)}</div>`;
  return layout({ title: "Not found", description: "Not in the WHOFUNDS graph.", path: L("/"), body, noindex: true, page: "404" });
}
