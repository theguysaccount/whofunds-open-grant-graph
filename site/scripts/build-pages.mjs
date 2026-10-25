// Build the static WHOFUNDS site for GitHub Pages (or any static host) into dist/.
//
//   WHOFUNDS_BASE_URL=https://<user>.github.io/<repo> WHOFUNDS_REPO=<user>/<repo> node scripts/build-pages.mjs
//
// GitHub Pages caps a site at 1 GB, and every entity page as HTML would be ~7.5 GB. So:
//  * static landing pages (full HTML, crawlable) for the highest-value entities, up to a
//    byte budget: foundations ranked by matched recipients, organizations by funders;
//  * every entity also lives in gzipped JSON shards (d/o, d/f) with the names it needs, and
//    is rendered in the browser by the same templates (assets/core.js) at org/?ein=...;
//  * search runs in the browser over gzipped 3-letter-prefix shards (s/).
// Optional: WHOFUNDS_SUPPORT_URL (alerts/donation link), WHOFUNDS_GOATCOUNTER (cookieless analytics).
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.resolve(process.env.WHOFUNDS_DATA_DIR || path.join(SITE_DIR, "data"));
const OUT = path.resolve(process.env.WHOFUNDS_OUT || path.join(SITE_DIR, "dist"));
const BUDGET_ORG = Number(process.env.WHOFUNDS_BUDGET_ORG_MB || 300) * 1e6;
const BUDGET_FDN = Number(process.env.WHOFUNDS_BUDGET_FDN_MB || 230) * 1e6;
const ORG_ROWS = 20;   // funder rows rendered into a static org page ("Show all" loads the rest)
const FDN_ROWS = 50;   // grant rows rendered into a static foundation page
process.env.WHOFUNDS_MODE = "static";
if (!process.env.WHOFUNDS_BASE_URL) throw new Error("WHOFUNDS_BASE_URL is required (e.g. https://user.github.io/repo)");

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "assets"), { recursive: true });

// 1. Site-wide pages (home, method, data, corrections, about, search, 404) + asset version.
execFileSync(process.execPath, [path.join(SITE_DIR, "scripts", "build-static.mjs")], { env: { ...process.env, WHOFUNDS_OUT: OUT }, stdio: "inherit" });
const ASSET_V = fs.readFileSync(path.join(DATA, "asset-version.txt"), "utf8").trim();
process.env.WHOFUNDS_ASSET_VERSION = ASSET_V;
const R = await import("../lib/render.js");
const C = await import("../lib/core.js");
const { SITE } = R;
for (const f of ["app.css", "app.js", "entity.js", "favicon.svg", "og.png"]) {
  const src = path.join(SITE_DIR, "public", "assets", f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(OUT, "assets", f));
}
fs.copyFileSync(path.join(SITE_DIR, "lib", "core.js"), path.join(OUT, "assets", "core.js"));
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");

// 2. Load every record.
const readGz = (p) => JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString("utf8"));
const N = readGz(path.join(DATA, "names.json.gz"));
const orgs = [], fdns = [];
for (const f of fs.readdirSync(path.join(DATA, "org"))) for (const r of Object.values(readGz(path.join(DATA, "org", f)))) orgs.push(r);
for (const f of fs.readdirSync(path.join(DATA, "fdn"))) for (const r of Object.values(readGz(path.join(DATA, "fdn", f)))) fdns.push(r);
log(`records: ${orgs.length} orgs, ${fdns.length} foundations`);

// 3. Choose static landing pages within the byte budgets (rendered once to measure).
const staticSet = { o: new Set(), f: new Set() };
const isStatic = (kind, e) => staticSet[kind].has(e);
const N0 = R.resolver(isStatic);
const pages = { o: new Map(), f: new Map() };
fdns.sort((a, b) => (b.nr - a.nr) || ((b.g.length + b.u.length) - (a.g.length + a.u.length)));
orgs.sort((a, b) => (b.nf - a.nf) || (b.t - a.t));
const limitOrg = { limit: ORG_ROWS }, limitFdn = { limit: FDN_ROWS };
const orgHtml = (o) => C.layout({ ...C.orgMeta(o, N0), body: C.orgBody(o, N0, limitOrg) });
const fdnHtml = (f) => C.layout({ ...C.foundationMeta(f, N0), body: C.foundationBody(f, false, N0, limitFdn) });
let used = 0;
for (const f of fdns) {
  if (!f.g.length && !f.u.length) continue;
  staticSet.f.add(f.e);
  const html = fdnHtml(f);
  if (used + html.length > BUDGET_FDN) { staticSet.f.delete(f.e); break; }
  used += html.length;
}
let usedO = 0;
for (const o of orgs) {
  staticSet.o.add(o.e);
  const html = orgHtml(o);
  if (usedO + html.length > BUDGET_ORG) { staticSet.o.delete(o.e); break; }
  usedO += html.length;
}
log(`static pages: ${staticSet.f.size} foundations (${(used / 1e6).toFixed(0)} MB est.), ${staticSet.o.size} orgs (${(usedO / 1e6).toFixed(0)} MB est.)`);

// 4. Render static pages for real now that the static set is final (links depend on it).
let bytes = 0;
for (const o of orgs) {
  if (!staticSet.o.has(o.e)) continue;
  const html = orgHtml(o);
  const dir = path.join(OUT, "org", o.e);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
  bytes += html.length;
}
for (const f of fdns) {
  if (!staticSet.f.has(f.e)) continue;
  const html = fdnHtml(f);
  const dir = path.join(OUT, "foundation", f.e);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), html);
  bytes += html.length;
}
log(`wrote static entity pages: ${(bytes / 1e6).toFixed(0)} MB`);

// 5. Client-rendered shells for everything else (and the shards they read).
const shell = (kind) => C.layout({
  title: kind === "o" ? "Who funds this organization?" : "Where this foundation's grants went",
  description: "Private-foundation grants from IRS Form 990-PF filings, matched to recipient EINs.",
  path: C.L(`/${kind === "o" ? "org" : "foundation"}/`), page: kind === "o" ? "org-shell" : "foundation-shell",
  body: `<div class="wrap page" id="entity-root"><p class="muted">Loading…</p><noscript><p>This page needs JavaScript. Every record is also in the <a href="${C.pageUrl("data")}">CSV download</a>.</p></noscript></div>`,
});
for (const [kind, dirName] of [["o", "org"], ["f", "foundation"]]) {
  fs.mkdirSync(path.join(OUT, dirName), { recursive: true });
  fs.writeFileSync(path.join(OUT, dirName, "index.html"), shell(kind));
}
const st = (kind, e) => (isStatic(kind, e) ? 1 : 0);
const fName = (e) => { const v = N.f[e] || [e, "", "", 0, 0, 0]; return [...v.slice(0, 6), st("f", e)]; };
const oName = (e) => { const v = N.o[e] || [e, "", "", "", 0, 0]; return [...v.slice(0, 6), st("o", e)]; };
function writeShards(kind, recs, namesFor) {
  const groups = new Map();
  for (const r of recs) {
    const k = r.e.slice(0, 4);
    if (!groups.has(k)) groups.set(k, {});
    groups.get(k)[r.e] = { r, ...namesFor(r), s: st(kind, r.e) };
  }
  let raw = 0, gz = 0;
  const dir = path.join(OUT, "d", kind);
  fs.mkdirSync(dir, { recursive: true });
  for (const [k, obj] of groups) {
    const buf = Buffer.from(JSON.stringify(obj));
    const z = zlib.gzipSync(buf, { level: 9 });
    fs.writeFileSync(path.join(dir, `${k}.json.gz`), z);
    raw += buf.length; gz += z.length;
  }
  log(`shards ${kind}: ${groups.size} files, ${(raw / 1e6).toFixed(0)} MB raw, ${(gz / 1e6).toFixed(0)} MB gz`);
}
writeShards("o", orgs, (o) => {
  const f = {}, on = {};
  for (const x of o.f) f[x[0]] = fName(x[0]);
  for (const x of o.q) f[x[0]] = fName(x[0]);
  for (const x of o.p) on[x[0]] = oName(x[0]);
  return { f, o: on };
});
writeShards("f", fdns, (fd) => {
  const f = {}, on = {};
  f[fd.e] = fName(fd.e);
  for (const x of fd.g) on[x[0]] = oName(x[0]);
  for (const x of fd.cf) f[x[0]] = fName(x[0]);
  return { f, o: on };
});

// 6. Search shards: entity under the first 3 letters of each distinctive token.
const STOP = new Set(["the", "of", "and", "for", "inc", "in", "at", "on", "to", "a", "an", "co", "corp", "llc", "foundation",
  "fund", "trust", "charitable", "family", "association", "society", "church", "center", "school", "county", "community"]);
const norm = (s) => String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
const buckets = new Map();
const addEntry = (name, entry) => {
  const toks = new Set(norm(name).split(" ").filter((t) => t.length >= 2));
  const keys = new Set();
  for (const t of toks) if (!STOP.has(t)) keys.add(t.slice(0, 3));
  if (!keys.size) for (const t of toks) keys.add(t.slice(0, 3)); // all-common names ("The Family Foundation")
  for (const k of keys) { if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(entry); }
};
for (const [e, v] of Object.entries(N.o)) addEntry(v[0], [v[0], e, "o", v[1], v[2], v[4] || 0, v[5] || 0, st("o", e)]);
for (const [e, v] of Object.entries(N.f)) addEntry(v[0], [v[0], e, "f", v[1], v[2], v[5] || 0, v[4] || 0, st("f", e)]);
let sraw = 0, sgz = 0;
fs.mkdirSync(path.join(OUT, "s"), { recursive: true });
for (const [k, list] of buckets) {
  list.sort((a, b) => b[5] - a[5]);
  const buf = Buffer.from(JSON.stringify(list));
  const z = zlib.gzipSync(buf, { level: 9 });
  fs.writeFileSync(path.join(OUT, "s", `${k}.json.gz`), z);
  sraw += buf.length; sgz += z.length;
}
// Direct EIN lookups: ein -> [kind, static] in 1000 small shards.
const einIx = new Map();
const addEin = (e, entry) => { const k = e.slice(0, 3); if (!einIx.has(k)) einIx.set(k, {}); (einIx.get(k)[e] ||= []).push(entry); };
for (const [e, v] of Object.entries(N.o)) addEin(e, [v[0], e, "o", v[1], v[2], v[4] || 0, v[5] || 0, st("o", e)]);
for (const [e, v] of Object.entries(N.f)) addEin(e, [v[0], e, "f", v[1], v[2], v[5] || 0, v[4] || 0, st("f", e)]);
fs.mkdirSync(path.join(OUT, "s", "ein"), { recursive: true });
for (const [k, obj] of einIx) fs.writeFileSync(path.join(OUT, "s", "ein", `${k}.json.gz`), zlib.gzipSync(Buffer.from(JSON.stringify(obj)), { level: 9 }));
log(`search: ${buckets.size} shards, ${(sraw / 1e6).toFixed(0)} MB raw, ${(sgz / 1e6).toFixed(0)} MB gz`);

// 7. Sitemaps (gzipped), robots.txt, IndexNow key and URL list.
const abs = (p) => SITE.origin + p;
const urls = ["", "method", "data", "corrections", "about"].map((p) => abs(C.pageUrl(p)));
for (const f of fdns) if (staticSet.f.has(f.e)) urls.push(abs(C.fdnUrl(f.e)));
for (const o of orgs) if (staticSet.o.has(o.e)) urls.push(abs(C.orgUrl(o.e)));
const staticCount = urls.length;
for (const f of fdns) if (!staticSet.f.has(f.e) && (f.g.length || f.u.length)) urls.push(abs(C.L(`/foundation/?ein=${f.e}`)));
for (const o of orgs) if (!staticSet.o.has(o.e)) urls.push(abs(C.L(`/org/?ein=${o.e}`)));
const today = new Date().toISOString().slice(0, 10);
const maps = [];
for (let i = 0; i < urls.length; i += 40000) {
  const name = `sitemap-${maps.length + 1}.xml.gz`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.slice(i, i + 40000).map((u) => `<url><loc>${u.replace(/&/g, "&amp;")}</loc><lastmod>${today}</lastmod></url>`).join("\n") + "\n</urlset>\n";
  fs.writeFileSync(path.join(OUT, name), zlib.gzipSync(Buffer.from(xml), { level: 9 }));
  maps.push(name);
}
fs.writeFileSync(path.join(OUT, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  maps.map((m) => `<sitemap><loc>${abs(C.L("/" + m))}</loc><lastmod>${today}</lastmod></sitemap>`).join("\n") + "\n</sitemapindex>\n");
fs.writeFileSync(path.join(OUT, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${abs(C.L("/sitemap.xml"))}\n`);
const keyFile = path.join(SITE_DIR, "indexnow-key.txt");
if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(16).toString("hex") + "\n");
const key = fs.readFileSync(keyFile, "utf8").trim();
fs.writeFileSync(path.join(OUT, `${key}.txt`), key);
// The deploy workflow submits these to IndexNow (static landing pages first).
fs.writeFileSync(process.env.WHOFUNDS_URLS_OUT || path.join(SITE_DIR, "dist-urls.txt"), urls.join("\n") + "\n");
log(`sitemaps: ${maps.length} files, ${urls.length} URLs (${staticCount} static); IndexNow key file ${key}.txt`);

// 8. Size report (GitHub Pages limit: 1 GB).
let total = 0, files = 0;
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { total += fs.statSync(p).size; files++; } } };
walk(OUT);
log(`dist: ${files} files, ${(total / 1e6).toFixed(0)} MB`);
if (total > 980e6) { console.error("dist exceeds the GitHub Pages size limit"); process.exit(1); }
