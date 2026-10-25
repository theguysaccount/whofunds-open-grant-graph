// Data access for the WHOFUNDS functions. Everything is read-only gzipped JSON
// produced by pipeline/build_site.py and bundled with each function.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = process.env.WHOFUNDS_DATA_DIR || path.join(process.cwd(), "data");

function readGz(p) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString("utf8"));
}

let NAMES = null;
let STATS = null;
const SHARDS = new Map(); // small LRU of parsed shards
const MAX_SHARDS = 48;

export function names() {
  if (!NAMES) NAMES = readGz(path.join(ROOT, "names.json.gz"));
  return NAMES;
}

export function stats() {
  if (!STATS) STATS = JSON.parse(fs.readFileSync(path.join(ROOT, "stats.json"), "utf8"));
  return STATS;
}

export function normEin(s) {
  const d = String(s || "").replace(/[^0-9]/g, "");
  return d.length >= 7 && d.length <= 9 ? d.padStart(9, "0") : "";
}

function shard(kind, ein) {
  const key = `${kind}/${ein.slice(0, 3)}`;
  if (SHARDS.has(key)) {
    const v = SHARDS.get(key);
    SHARDS.delete(key);
    SHARDS.set(key, v);
    return v;
  }
  const p = path.join(ROOT, kind, `${ein.slice(0, 3)}.json.gz`);
  const v = fs.existsSync(p) ? readGz(p) : {};
  SHARDS.set(key, v);
  if (SHARDS.size > MAX_SHARDS) SHARDS.delete(SHARDS.keys().next().value);
  return v;
}

export function getOrg(ein) {
  return shard("org", ein)[ein] || null;
}

export function getFoundation(ein) {
  return shard("fdn", ein)[ein] || null;
}

// ---------------------------------------------------------------- search
const STOP = new Set(["the", "of", "and", "for", "inc", "in", "at", "on", "to", "a", "an", "co", "corp", "llc", "&"]);
let INDEX = null;

export function normText(s) {
  return String(s || "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildIndex() {
  const n = names();
  const rows = [];
  for (const [ein, v] of Object.entries(n.o)) rows.push({ k: "o", ein, name: v[0], city: v[1], st: v[2], w: v[4] || 0, n: v[5] || 0, s: " " + normText(v[0]) + " " });
  for (const [ein, v] of Object.entries(n.f)) rows.push({ k: "f", ein, name: v[0], city: v[1], st: v[2], w: v[5] || 0, n: v[4] || 0, s: " " + normText(v[0]) + " " });
  INDEX = rows;
  return rows;
}

export function search(q, limit = 12, kind = "") {
  const qn = normText(q);
  const ein = normEin(q);
  const out = [];
  const idx = INDEX || buildIndex();
  if (ein && /^[0-9\s-]+$/.test(String(q).trim())) {
    for (const r of idx) if (r.ein === ein) out.push({ ...r, score: 1e9 });
    return out.map(strip);
  }
  const toks = qn.split(" ").filter((t) => t && !STOP.has(t));
  if (!toks.length) return [];
  const needles = toks.map((t) => " " + t);
  const whole = " " + qn + " ";
  for (const r of idx) {
    if (kind && r.k !== kind) continue;
    let ok = true;
    for (const nd of needles) {
      if (!r.s.includes(nd)) { ok = false; break; }
    }
    if (!ok) continue;
    let score = Math.log10(1 + r.w) + Math.log2(1 + r.n);
    if (r.s === whole || r.s === " the" + whole) score += 40;
    else if (r.s.startsWith(whole.slice(0, -1)) || r.s.startsWith(" the" + whole.slice(0, -1))) score += 20;
    out.push({ ...r, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, limit).map(strip);
}

function strip(r) {
  return { kind: r.k === "o" ? "org" : "foundation", ein: r.ein, name: r.name, city: r.city, state: r.st, total: r.w, count: r.n };
}
