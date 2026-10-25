// Static (GitHub Pages) build: run build-pages.mjs on a fixture and check the output.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "whofunds-static-"));
const DATA = path.join(TMP, "data"), OUT = path.join(TMP, "dist");
const gz = (p, obj) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, zlib.gzipSync(JSON.stringify(obj))); };
const ungz = (p) => JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString("utf8"));
const ORG = "042931195", FDN = "043105768", SMALL = "990000001";

before(() => {
  gz(path.join(DATA, "names.json.gz"), {
    o: { [ORG]: ["Project Bread", "East Boston", "MA", "K30", 250000, 1], [SMALL]: ["Tiny Arts Collective", "Lowell", "MA", "A20", 500, 1] },
    f: { [FDN]: ["The Klarman Family Foundation", "Boston", "MA", 0, 2, 250500] },
  });
  gz(path.join(DATA, "org", "042.json.gz"), { [ORG]: { e: ORG, n: "Project Bread", bn: "", c: "East Boston", s: "MA", nt: "K30", sub: "03", t: 250000, nf: 1, nl: 1,
    f: [[FDN, 250000, "202443119349102064", "2023-12-31", [[250000, "Unrestricted operating support", 1, 0.9, "C", ""]]]], p: [], q: [] } });
  gz(path.join(DATA, "org", "990.json.gz"), { [SMALL]: { e: SMALL, n: "Tiny Arts Collective", bn: "", c: "Lowell", s: "MA", nt: "A20", sub: "03", t: 500, nf: 1, nl: 1,
    f: [[FDN, 500, "202443119349102064", "2023-12-31", [[500, "Programs", 0.95, 0.5, "Z", ""]]]], p: [], q: [] } });
  gz(path.join(DATA, "fdn", "043.json.gz"), { [FDN]: { e: FDN, n: "The Klarman Family Foundation", c: "Boston", s: "MA", tp: "2023-12-31", o: "202443119349102064", ts: 250500, fmv: 1e9, nr: 2, np: 2,
    k: { resolved: [2, 250500], unmatched: [0, 0], individual: [0, 0], foreign: [0, 0], unitemized: [0, 0], withheld: [0, 0] },
    app: { pre: 0, form: "", dl: "", rs: "", web: "" }, g: [[ORG, 250000, "Unrestricted operating support", 1, 0.9, "C"], [SMALL, 500, "Programs", 0.95, 0.5, "Z"]], u: [], cf: [] } });
  const sc = { resolved: [2, 250500], unmatched: [0, 0], individual: [0, 0], foreign: [0, 0], unitemized: [0, 0] };
  fs.writeFileSync(path.join(DATA, "stats.json"), JSON.stringify({ year: "2023", built: "2026-10-24", foundations: 1, paid_lines: 2, paid_dollars: 250500,
    scopes: sc, future: sc, orgs: 2, orgs_multi_funded: 0, edges: 2, strategies: [["ADDR_CONTAINMENT", 1], ["ZIP5", 1]], variants: [["bmf", 2]],
    release_rows: 2, top_received: [[ORG, "Project Bread", "MA", 250000, 1]], top_widely: [[ORG, "Project Bread", "MA", 250000, 1]],
    top_grantmakers: [[FDN, "The Klarman Family Foundation", "MA", 250500, 250500]], top_failures: [] }));
  fs.writeFileSync(path.join(DATA, "release.json"), JSON.stringify({ "whofunds_ty2023_grants.csv.gz": { sha256: "0".repeat(64), bytes: 1000 } }));
  // A ~1-byte org budget leaves organizations without landing pages (client-rendered).
  execFileSync(process.execPath, [path.join(SITE, "scripts", "build-pages.mjs")], {
    env: { ...process.env, WHOFUNDS_DATA_DIR: DATA, WHOFUNDS_OUT: OUT, WHOFUNDS_URLS_OUT: path.join(TMP, "urls.txt"),
      WHOFUNDS_BASE_URL: "https://example.test/repo", WHOFUNDS_REPO: "owner/repo", WHOFUNDS_BUDGET_ORG_MB: "0.000001" },
    stdio: "pipe",
  });
});
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test("static build writes pages, shards, search, sitemaps and the IndexNow key", () => {
  for (const f of ["index.html", "method/index.html", "data/index.html", "corrections/index.html", "about/index.html", "search/index.html",
    "404.html", ".nojekyll", "robots.txt", "sitemap.xml", "sitemap-1.xml.gz", "org/index.html", "foundation/index.html",
    "assets/app.js", "assets/core.js", "assets/entity.js", "assets/app.css", `foundation/${FDN}/index.html`]) {
    assert.ok(fs.existsSync(path.join(OUT, f)), f);
  }
  const key = fs.readFileSync(path.join(SITE, "indexnow-key.txt"), "utf8").trim();
  assert.equal(fs.readFileSync(path.join(OUT, `${key}.txt`), "utf8"), key);
  assert.match(fs.readFileSync(path.join(OUT, "robots.txt"), "utf8"), /Sitemap: https:\/\/example\.test\/repo\/sitemap\.xml/);
  const urls = zlib.gunzipSync(fs.readFileSync(path.join(OUT, "sitemap-1.xml.gz"))).toString();
  assert.match(urls, /https:\/\/example\.test\/repo\/foundation\/043105768\//);
  assert.match(urls, /https:\/\/example\.test\/repo\/org\/\?ein=990000001/);
});

test("static pages use the base path, no server endpoints, compact correction links", () => {
  const html = fs.readFileSync(path.join(OUT, "foundation", FDN, "index.html"), "utf8");
  assert.match(html, /href="\/repo\/assets\/app\.css\?v=/);
  assert.match(html, /<script type="module" src="\/repo\/assets\/entity\.js\?v=/);
  assert.match(html, /<link rel="canonical" href="https:\/\/example\.test\/repo\/foundation\/043105768\/">/);
  assert.doesNotMatch(html, /\/api\//);
  assert.match(html, /href="\/repo\/org\/\?ein=990000001"/);       // no landing page → client-rendered link
  assert.match(html, /data-csv="whofunds_043105768_grants\.csv"/);
  const home = fs.readFileSync(path.join(OUT, "index.html"), "utf8");
  assert.match(home, /action="\/repo\/search\/"/);
  assert.match(home, /"SearchAction"/);
  assert.match(fs.readFileSync(path.join(OUT, "data", "index.html"), "utf8"), /github\.com\/owner\/repo\/releases\/latest\/download\/whofunds_ty2023_grants\.csv\.gz/);
});

test("shards carry records with the names they need; search shards find names and EINs", () => {
  const o = ungz(path.join(OUT, "d", "o", "0429.json.gz"))[ORG];
  assert.equal(o.r.n, "Project Bread");
  assert.equal(o.f[FDN][0], "The Klarman Family Foundation");
  const f = ungz(path.join(OUT, "d", "f", "0431.json.gz"))[FDN];
  assert.equal(f.o[SMALL][0], "Tiny Arts Collective");
  const s = ungz(path.join(OUT, "s", "tin.json.gz"));
  assert.ok(s.some((x) => x[1] === SMALL && x[0] === "Tiny Arts Collective"));
  const e = ungz(path.join(OUT, "s", "ein", "042.json.gz"));
  assert.equal(e[ORG][0][0], "Project Bread");
});
