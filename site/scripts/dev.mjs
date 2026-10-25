// Local server that mirrors vercel.json: static files from public/ (clean URLs),
// rewrites for /org/:ein, /foundation/:ein and /search, and the /api handlers.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(SITE);
const PORT = Number(process.env.PORT || 4173);
const PUB = path.join(SITE, "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".xml": "application/xml", ".txt": "text/plain", ".gz": "application/gzip", ".ico": "image/x-icon" };
const handlers = {};
async function api(name) {
  if (!handlers[name]) handlers[name] = (await import(pathToFileURL(path.join(SITE, "api", name + ".js")).href)).default;
  return handlers[name];
}

function serveStatic(req, res, p) {
  let f = path.join(PUB, decodeURIComponent(p));
  if (!f.startsWith(PUB)) { res.statusCode = 403; return res.end(); }
  const tries = [f, f + ".html", path.join(f, "index.html")];
  for (const t of tries) {
    if (fs.existsSync(t) && fs.statSync(t).isFile()) {
      res.setHeader("Content-Type", TYPES[path.extname(t)] || "application/octet-stream");
      return fs.createReadStream(t).pipe(res);
    }
  }
  res.statusCode = 404;
  res.setHeader("Content-Type", TYPES[".html"]);
  fs.createReadStream(path.join(PUB, "404.html")).pipe(res);
}

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://local");
    let m;
    if ((m = u.pathname.match(/^\/(org|foundation)\/([^/]+)\/card\.png$/))) { req.url = `/api/${m[1]}?ein=${m[2]}&card=1`; return (await api(m[1]))(req, res); }
    if ((m = u.pathname.match(/^\/org\/([^/]+)$/))) { req.url = `/api/org?ein=${m[1]}&${u.searchParams}`; return (await api("org"))(req, res); }
    if ((m = u.pathname.match(/^\/foundation\/([^/]+)$/))) { req.url = `/api/foundation?ein=${m[1]}&${u.searchParams}`; return (await api("foundation"))(req, res); }
    if (u.pathname === "/search") { req.url = `/api/search?html=1&${u.searchParams}`; return (await api("search"))(req, res); }
    if ((m = u.pathname.match(/^\/api\/([a-z]+)$/))) return (await api(m[1]))(req, res);
    if (u.pathname.startsWith("/_vercel/")) { res.statusCode = 204; return res.end(); }
    return serveStatic(req, res, u.pathname === "/" ? "/index.html" : u.pathname);
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    res.end("server error");
  }
}).listen(PORT, () => console.log(`WHOFUNDS dev server on http://localhost:${PORT}`));
