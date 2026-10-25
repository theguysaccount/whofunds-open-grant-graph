// Tell IndexNow search engines (Bing, Yandex, Seznam, Naver...) which URLs exist.
//
//   node scripts/indexnow.mjs --file dist-urls.txt          # after a deploy: the first 10,000 (landing pages first)
//   node scripts/indexnow.mjs --sitemap <site>/sitemap.xml  # daily: the next 10,000 sitemap URLs, one pass per release
//
// The key file (<key>.txt) is published at the site root by build-pages.mjs. A failed
// submission is reported but never fails the workflow: the site itself is already live.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BATCH = 10000;
const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : ""; };
const key = fs.readFileSync(path.join(SITE_DIR, "indexnow-key.txt"), "utf8").trim();
const base = (process.env.WHOFUNDS_BASE_URL || "").replace(/\/$/, "");
if (!base) throw new Error("WHOFUNDS_BASE_URL is required");

async function sitemapUrls(indexUrl) {
  const idx = await (await fetch(indexUrl)).text();
  const maps = [...idx.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const lastmod = (idx.match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1] || new Date().toISOString().slice(0, 10);
  const urls = [];
  for (const m of maps) {
    const buf = Buffer.from(await (await fetch(m)).arrayBuffer());
    const xml = (buf[0] === 0x1f && buf[1] === 0x8b ? zlib.gunzipSync(buf) : buf).toString("utf8");
    for (const x of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) urls.push(x[1].replace(/&amp;/g, "&"));
  }
  return { urls, lastmod };
}

let urls;
if (opt("--file")) {
  urls = fs.readFileSync(opt("--file"), "utf8").split("\n").filter(Boolean).slice(0, BATCH);
} else if (opt("--sitemap")) {
  const { urls: all, lastmod } = await sitemapUrls(opt("--sitemap"));
  const day = Math.floor((Date.now() - Date.parse(lastmod)) / 86400000);
  const start = day * BATCH;
  if (start >= all.length) { console.log(`all ${all.length} URLs already submitted for the ${lastmod} release`); process.exit(0); }
  urls = all.slice(start, start + BATCH);
  console.log(`release ${lastmod}, day ${day}: URLs ${start}-${start + urls.length} of ${all.length}`);
} else {
  throw new Error("use --file <urls.txt> or --sitemap <sitemap.xml url>");
}

const host = new URL(base).host;
const body = { host, key, keyLocation: `${base}/${key}.txt`, urlList: urls.filter((u) => new URL(u).host === host) };
const res = await fetch("https://api.indexnow.org/indexnow", {
  method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body),
});
console.log(`IndexNow: ${res.status} ${res.statusText} for ${body.urlList.length} URLs`);
if (![200, 202].includes(res.status)) console.log((await res.text()).slice(0, 500));
