// Browser side of the static site: renders org/foundation pages from gzipped JSON
// shards with the same templates the build uses (core.js), loads full lists behind
// "Show all", and exports a page's rows as CSV. No framework, no third parties.
import * as C from "./core.js";

const meta = document.querySelector('meta[name="whofunds"]');
const ds = meta ? meta.dataset : {};
C.configure({ mode: "static", origin: location.origin, path: ds.base || "", repo: ds.repo || "", assetVersion: ds.v || "1", supportUrl: ds.support || "" });

const cache = new Map();
async function readJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  // Static hosts serve .json.gz as application/gzip (no Content-Encoding), so inflate here
  // unless the host already did.
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    return JSON.parse(await new Response(stream).text());
  }
  return JSON.parse(new TextDecoder().decode(buf));
}
function entry(kind, ein) {
  const key = `${kind}/${ein.slice(0, 4)}`;
  if (!cache.has(key)) cache.set(key, readJson(`${C.SITE.path}/d/${kind}/${ein.slice(0, 4)}.json.gz?v=${C.SITE.assetVersion}`).catch(() => ({})));
  return cache.get(key).then((all) => all[ein] || null);
}
function resolver(x) {
  const f = x.f || {}, o = x.o || {};
  return {
    f: (e) => f[e] || [e, "", "", 0, 0, 0, 0],
    o: (e) => o[e] || [e, "", "", "", 0, 0, 0],
    href: (kind, e) => {
      const v = kind === "o" ? o[e] : f[e];
      return v && v[6] ? (kind === "o" ? C.orgUrl(e) : C.fdnUrl(e)) : C.L(`/${kind === "o" ? "org" : "foundation"}/?ein=${e}`);
    },
  };
}

function setHead(m) {
  document.title = `${m.title} · WHOFUNDS`;
  const set = (sel, attr, val) => { const el = document.querySelector(sel); if (el) el.setAttribute(attr, val); };
  set('meta[name="description"]', "content", m.description);
  set('link[rel="canonical"]', "href", C.SITE.origin + m.path);
  set('meta[property="og:title"]', "content", m.title);
  set('meta[property="og:description"]', "content", m.description);
  set('meta[property="og:url"]', "content", C.SITE.origin + m.path);
  const ld = document.createElement("script");
  ld.type = "application/ld+json";
  ld.textContent = JSON.stringify(m.jsonLd);
  document.head.appendChild(ld);
}

function rendered() {
  document.dispatchEvent(new CustomEvent("whofunds:rendered"));
}

// ---- client-rendered pages: /org/?ein=... and /foundation/?ein=...
async function renderShell(kind) {
  const root = document.getElementById("entity-root");
  const raw = String(new URLSearchParams(location.search).get("ein") || "").replace(/[^0-9]/g, "");
  const ein = raw.padStart(9, "0");
  const k = kind === "org" ? "o" : "f";
  const x = raw && /^[0-9]{9}$/.test(ein) ? await entry(k, ein) : null;
  if (!x) {
    root.innerHTML = !raw
      ? `<h1>Find ${kind === "org" ? "an organization" : "a foundation"}</h1><p class="lede">Search by name or EIN.</p>${C.searchForm("nf", "", true)}`
      : `<h1>Not in the ${C.SITE.year} graph</h1><p class="lede">${kind === "org"
        ? `No private-foundation grant on a ${C.SITE.year} 990-PF was matched to EIN ${C.esc(C.fmtEin(ein))}.`
        : `No ${C.SITE.year} Form 990-PF was found for EIN ${C.esc(C.fmtEin(ein))}.`}</p>${C.searchForm("nf", "", true)}`;
    document.title = raw ? "Not found · WHOFUNDS" : "Search · WHOFUNDS";
    rendered();
    return;
  }
  if (x.s) { location.replace(kind === "org" ? C.orgUrl(ein) : C.fdnUrl(ein)); return; }
  const N = resolver(x);
  const m = kind === "org" ? C.orgMeta(x.r, N) : C.foundationMeta(x.r, N);
  setHead(m);
  root.outerHTML = kind === "org" ? C.orgBody(x.r, N) : C.foundationBody(x.r, false, N);
  rendered();
}

// ---- "Show all" on static landing pages: load the full record and re-render the body.
document.addEventListener("click", async (e) => {
  const b = e.target.closest && e.target.closest("[data-load]");
  if (!b) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const page = document.querySelector("[data-entity]");
  const kind = b.getAttribute("data-load");
  b.disabled = true;
  b.textContent = "Loading…";
  const x = await entry(kind === "org" ? "o" : "f", page.getAttribute("data-ein"));
  if (!x) { b.textContent = "Couldn't load the full list"; return; }
  const N = resolver(x);
  const tmp = document.createElement("div");
  tmp.innerHTML = kind === "org" ? C.orgBody(x.r, N) : C.foundationBody(x.r, false, N);
  const fresh = tmp.querySelector("[data-entity]");
  page.replaceWith(fresh);
  const t = fresh.querySelector("[data-collapsible]");
  if (t) t.classList.add("expanded");
  fresh.querySelectorAll("[data-expand]").forEach((n) => n.parentNode.removeChild(n));
  rendered();
}, true);

// ---- CSV export of the current page, from the full record.
const STRAT = { A: "ADDR_EXACT_NAME", C: "ADDR_CONTAINMENT", Z: "ZIP5", S: "CITY_STATE", L: "ALIAS", N: "NAME_EXACT_NATIONAL", T: "NAME_TOKEN", E: "EIN_IN_TEXT" };
const cell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const row = (a) => a.map(cell).join(",") + "\n";
document.addEventListener("click", async (e) => {
  const b = e.target.closest && e.target.closest("[data-csv]");
  if (!b) return;
  e.preventDefault();
  const page = document.querySelector("[data-entity]");
  const kind = page.getAttribute("data-entity");
  const x = await entry(kind === "org" ? "o" : "f", page.getAttribute("data-ein"));
  if (!x) return;
  const N = resolver(x), r = x.r;
  let out = "";
  if (kind === "org") {
    out += row(["recipient_ein", "recipient_name", "funder_ein", "funder_name", "funder_city", "funder_state", "amount", "purpose", "tax_period_end", "match_strategy", "match_score", "margin", "source_filing_url"]);
    for (const [fe, , oid, tpe, lines] of r.f) {
      const m = N.f(fe);
      for (const l of lines) out += row([r.e, r.n, fe, m[0], m[1], m[2], l[0], l[1], tpe, STRAT[l[4]] || l[4], l[2], l[3], C.filingUrl(fe, oid)]);
    }
  } else {
    out += row(["funder_ein", "funder_name", "recipient_ein", "recipient_name", "recipient_city", "recipient_state_or_country", "amount", "purpose", "status", "match_strategy", "match_score", "margin", "source_filing_url"]);
    for (const g of r.g) { const o = N.o(g[0]); out += row([r.e, r.n, g[0], o[0], o[1], o[2], g[1], g[2], "matched", STRAT[g[5]] || g[5], g[3], g[4], C.filingUrl(r.e, r.o)]); }
    for (const u of r.u) out += row([r.e, r.n, "", u[0], u[1], u[2], u[3], u[4], u[5] === "f" ? "foreign" : "unmatched", "", "", "", C.filingUrl(r.e, r.o)]);
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([out], { type: "text/csv;charset=utf-8" }));
  a.download = b.getAttribute("data-csv");
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});

const pageKind = document.body.getAttribute("data-page");
if (pageKind === "org-shell") renderShell("org");
if (pageKind === "foundation-shell") renderShell("foundation");
