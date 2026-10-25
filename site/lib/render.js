// Node side of the renderer: configuration from the environment, the names table as
// resolver, and per-request host handling for the Vercel functions.
import fs from "node:fs";
import path from "node:path";
import { names, stats } from "./data.js";
import * as C from "./core.js";

export * from "./core.js";

function assetVersion() {
  if (process.env.WHOFUNDS_ASSET_VERSION) return process.env.WHOFUNDS_ASSET_VERSION;
  try {
    return fs.readFileSync(path.join(process.env.WHOFUNDS_DATA_DIR || path.join(process.cwd(), "data"), "asset-version.txt"), "utf8").trim();
  } catch {
    return "1";
  }
}

function dataYear() {
  try { return String(stats().year || "2023"); } catch { return "2023"; }
}

const envBase = new URL((process.env.WHOFUNDS_BASE_URL || "https://theguysaccount.github.io/whofunds-open-grant-graph").replace(/\/$/, ""));
C.configure({
  // "server": Vercel functions render pages per request. "static": GitHub Pages, every page
  // prebuilt or rendered in the browser. WHOFUNDS_BASE_URL is origin + path prefix.
  mode: process.env.WHOFUNDS_MODE === "static" ? "static" : "server",
  origin: envBase.origin,
  path: envBase.pathname,
  assetVersion: assetVersion(),
  year: dataYear(),
  repo: process.env.WHOFUNDS_REPO || "",
  supportUrl: process.env.WHOFUNDS_SUPPORT_URL || "",
  goatcounter: process.env.WHOFUNDS_GOATCOUNTER || "",
  analytics: process.env.WHOFUNDS_ANALYTICS || "",
});

// Called by each handler before rendering (rendering is synchronous, so concurrent
// requests in one instance cannot interleave between this call and the render).
export function setBaseFromRequest(req) {
  if (process.env.WHOFUNDS_BASE_URL) return;
  const host = String((req.headers && (req.headers["x-forwarded-host"] || req.headers.host)) || "").split(",")[0].trim();
  if (/^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
    const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
    C.configure({ origin: `${local ? "http" : "https"}://${host}`, path: "" });
  }
}

// Resolver over the full names table (server and build time).
let RESOLVER = null;
export function resolver(hasStatic = null) {
  if (RESOLVER && !hasStatic) return RESOLVER;
  const n = names();
  const r = {
    f: (e) => n.f[e] || [e, "", "", 0, 0, 0],
    o: (e) => n.o[e] || [e, "", "", "", 0, 0],
    href: (kind, e) => (hasStatic && !hasStatic(kind, e)
      ? C.L(`/${kind === "o" ? "org" : "foundation"}/?ein=${e}`)
      : kind === "o" ? C.orgUrl(e) : C.fdnUrl(e)),
  };
  if (!hasStatic) RESOLVER = r;
  return r;
}

export const orgPage = (o, N = resolver()) => C.orgPage(o, N);
export const foundationPage = (f, showAll = false, N = resolver()) => C.foundationPage(f, showAll, N);
