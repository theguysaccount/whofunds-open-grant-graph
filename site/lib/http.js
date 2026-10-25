// Tiny helpers shared by the API handlers (plain Node req/res, so they run the
// same on Vercel and under scripts/dev.mjs).
export function params(req) {
  const u = new URL(req.url || "/", "http://local");
  return { path: u.pathname, q: u.searchParams };
}

export const CACHE_PAGE = "public, max-age=600, s-maxage=86400, stale-while-revalidate=604800";

export function send(res, status, body, type = "text/html; charset=utf-8", cache = CACHE_PAGE) {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", status === 200 ? cache : "public, max-age=60, s-maxage=300");
  res.end(body);
}

export function json(res, status, obj, cache = "no-store") {
  send(res, status, JSON.stringify(obj), "application/json; charset=utf-8", cache);
}

export async function readBody(req, limit = 20000) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new Error("body too large");
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(raw || "{}"); } catch { return Object.fromEntries(new URLSearchParams(raw)); }
}

export function einFrom(req, key) {
  const { path, q } = params(req);
  const v = q.get(key) || (path.match(/\/(?:org|foundation)\/([0-9-]{7,10})/) || [])[1] || "";
  const d = v.replace(/[^0-9]/g, "");
  return d.length >= 7 && d.length <= 9 ? d.padStart(9, "0") : "";
}
