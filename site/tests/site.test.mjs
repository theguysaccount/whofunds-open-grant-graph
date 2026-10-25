// Site tests: rendering, search and the HTTP handlers, against a small fixture
// dataset written to a temp directory.   node --test tests/
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "whofunds-test-"));
const DATA = path.join(TMP, "data");
const STORE = path.join(TMP, "store");
const gz = (p, obj) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, zlib.gzipSync(JSON.stringify(obj))); };

const ORG = "042931195", FDN = "043105768", FDN2 = "046131201", PEER = "042931196";
gz(path.join(DATA, "names.json.gz"), {
  o: { [ORG]: ["Project Bread", "East Boston", "MA", "K30", 400051, 2], [PEER]: ["Greater Boston Food Bank", "Boston", "MA", "K31", 9000, 3],
       "123456780": ['Evil <script>alert(1)</script> Org', "Nowhere", "MA", "", 10, 1] },
  f: { [FDN]: ["The Klarman Family Foundation", "Boston", "MA", 0, 2, 250051], [FDN2]: ["Fidelity Foundation", "Boston", "MA", 1, 1, 150000],
       "999999990": ["Prospect Foundation", "Salem", "MA", 1, 5, 70000] },
});
gz(path.join(DATA, "org", "042.json.gz"), {
  [ORG]: { e: ORG, n: "Project Bread", bn: "Project Bread - the Walk for Hunger", c: "East Boston", s: "MA", nt: "K30", sub: "03", t: 400051, nf: 2, nl: 3,
    f: [[FDN, 250051, "202443119349102064", "2023-12-31", [[250000, "Unrestricted operating support", 1, 0.9, "C", ""], [51, "Employee matching gift", 1, 0.9, "C", ""]]],
        [FDN2, 150000, "202403029349100710", "2023-12-31", [[150000, "", 0.97, 0.7, "Z", "PROJECT BREAD WALK"]]]],
    p: [[PEER, 2]], q: [["999999990", 3, 70000]] },
});
gz(path.join(DATA, "org", "123.json.gz"), {
  "123456780": { e: "123456780", n: 'Evil <script>alert(1)</script> Org', bn: "", c: "Nowhere", s: "MA", nt: "", sub: "03", t: 10, nf: 1, nl: 1,
    f: [[FDN, 10, "202443119349102064", "2023-12-31", [[10, '<img src=x onerror=alert(1)>', 1, 1, "A", ""]]]], p: [], q: [] },
});
gz(path.join(DATA, "fdn", "043.json.gz"), {
  [FDN]: { e: FDN, n: "The Klarman Family Foundation", c: "Boston", s: "MA", tp: "2023-12-31", o: "202443119349102064", ts: 260051, fmv: 1e9, nr: 1,
    k: { resolved: [2, 250051], unmatched: [1, 5000], individual: [4, 8000], foreign: [0, 0], unitemized: [0, 0], withheld: [1, 900] },
    app: { pre: 0, form: "Letter of inquiry", dl: "None", rs: "Massachusetts only", web: "klarmanfoundation.org" },
    g: [[ORG, 250000, "Unrestricted operating support", 1, 0.9, "C"]], u: [["Some Unmatched Arts Council", "Lowell", "MA", 5000, "Programs", "u"]], cf: [[FDN2, 1]] },
});
fs.writeFileSync(path.join(DATA, "stats.json"), JSON.stringify({ year: "2023" }));
fs.writeFileSync(path.join(DATA, "asset-version.txt"), "test");
process.env.WHOFUNDS_DATA_DIR = DATA;
process.env.WHOFUNDS_LOCAL_STORE = STORE;
process.env.WHOFUNDS_BASE_URL = "https://example.test";

const data = await import("../lib/data.js");
const render = await import("../lib/render.js");

test("org page: promise, funders, provenance, structured data", () => {
  const html = render.orgPage(data.getOrg(ORG));
  assert.match(html, /<h1>Who funds Project Bread\?<\/h1>/);
  assert.match(html, /2 private foundations<\/strong> reported paying Project Bread/);
  assert.match(html, /href="\/foundation\/043105768" data-ev="funder_open"/);
  assert.match(html, /projects\.propublica\.org\/nonprofits\/organizations\/043105768\/202443119349102064\/full/);
  assert.match(html, /gt990datalake-rawdata\.s3\.amazonaws\.com\/EfileData\/XmlFiles\/202443119349102064_public\.xml/);
  assert.match(html, /<link rel="canonical" href="https:\/\/example\.test\/org\/042931195">/);
  assert.match(html, /Same street/);
  assert.match(html, /Paid 3 of the 25 closest peers/);
  assert.match(html, /Filed as “PROJECT BREAD WALK”/);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
  assert.equal(ld.taxID, "04-2931195");
  assert.equal(ld.funder.length, 2);
  assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/);
});

test("org page escapes hostile names and purposes", () => {
  const html = render.orgPage(data.getOrg("123456780"));
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /Evil &lt;script&gt;/);
});

test("foundation page: scope bar, application info, withheld note", () => {
  const html = render.foundationPage(data.getFoundation(FDN));
  assert.match(html, /Where The Klarman Family Foundation&#39;s grants went/);
  assert.match(html, /did <em>not<\/em> check the 990-PF box/);
  assert.match(html, /Some Unmatched Arts Council/);
  assert.match(html, /Individuals, not shown/);
  assert.match(html, /1 more line \(\$900\) isn't listed because the payee name as filed could identify a private person/);
  assert.doesNotMatch(html, /Outside the US <b>\$0<\/b>/);
  assert.match(html, /href="\/org\/042931195"/);
});

test("search: prefixes, EIN, kind filter, empty", () => {
  assert.equal(data.search("proj bre")[0].ein, ORG);
  assert.equal(data.search("04-2931195")[0].ein, ORG);
  assert.equal(data.search("klarman", 5, "f")[0].kind, "foundation");
  assert.equal(data.search("klarman", 5, "o").length, 0);
  assert.deepEqual(data.search("the of"), []);
});

let server, base;
before(async () => {
  const port = 4300 + Math.floor(Math.random() * 500);
  server = spawn(process.execPath, [path.join(SITE, "scripts", "dev.mjs")], { env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((res, rej) => {
    server.stdout.on("data", (d) => String(d).includes("dev server") && res());
    server.on("exit", (c) => rej(new Error("server exited " + c)));
    setTimeout(() => rej(new Error("server start timeout")), 8000);
  });
  base = `http://localhost:${port}`;
});
after(() => { server && server.kill(); fs.rmSync(TMP, { recursive: true, force: true }); });

test("http: pages, 404s, search API, CSV export", async () => {
  let r = await fetch(`${base}/org/${ORG}`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("cache-control"), /s-maxage=86400/);
  r = await fetch(`${base}/foundation/${FDN}`);
  assert.equal(r.status, 200);
  assert.equal((await fetch(`${base}/org/000000001`)).status, 404);
  const s = await (await fetch(`${base}/api/search?q=project`)).json();
  assert.equal(s.results[0].ein, ORG);
  const csvRes = await fetch(`${base}/api/export?ein=${ORG}`);
  assert.match(csvRes.headers.get("content-disposition"), /whofunds_042931195_funders\.csv/);
  const csv = await csvRes.text();
  assert.equal(csv.trim().split("\n").length, 4); // header + 3 grant lines
  assert.match(csv, /ADDR_CONTAINMENT/);
});

test("http: alert signup validates and stores privately", async () => {
  const post = (b) => fetch(`${base}/api/collect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  assert.equal((await post({ type: "alert", email: "not-an-email" })).status, 400);
  const ok = await post({ type: "alert", email: "dev@example.org", ein: ORG });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).ok, true);
  const bot = await post({ type: "alert", email: "bot@example.org", website: "http://spam" });
  assert.equal(bot.status, 200);
  const files = fs.readdirSync(path.join(STORE, "alerts"), { recursive: true }).filter((f) => f.endsWith(".json"));
  assert.equal(files.length, 1); // the honeypot submission was dropped
  const rec = JSON.parse(fs.readFileSync(path.join(STORE, "alerts", files[0]), "utf8"));
  assert.deepEqual(Object.keys(rec).sort(), ["at", "ein", "email", "page"]); // no IP, no user agent
});

test("http: corrections queue never exposes email or notes", async () => {
  const post = (b) => fetch(`${base}/api/collect`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  assert.equal((await post({ type: "correction", issue: "wrong_org" })).status, 400);
  const r = await post({ type: "correction", org_ein: ORG, fdn_ein: FDN, object_id: "202443119349102064", issue: "chapter",
    suggested: "04-2931196", note: "call me at 555-0100", email: "secret@example.org" });
  assert.equal(r.status, 200);
  const q = await (await fetch(`${base}/api/corrections`)).json();
  assert.equal(q.items.length, 1);
  const body = JSON.stringify(q);
  assert.doesNotMatch(body, /secret@example\.org|555-0100/);
  assert.equal(q.items[0].suggested_ein, "042931196");
  assert.equal(q.items[0].has_note, true);
});

test("http: share card is a PNG and pages point og:image at it", async () => {
  const r = await fetch(`${base}/org/${ORG}/card.png`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "image/png");
  const buf = Buffer.from(await r.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  const html = await (await fetch(`${base}/org/${ORG}`)).text();
  assert.match(html, /<meta property="og:image" content="https:\/\/example\.test\/org\/042931195\/card\.png\?v=/);
  assert.equal((await fetch(`${base}/foundation/${FDN}/card.png`)).headers.get("content-type"), "image/png");
});
