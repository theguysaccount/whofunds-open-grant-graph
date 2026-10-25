// Append-only private storage for corrections and alert signups.
// On Vercel: a private Vercel Blob store connected to the project (OIDC auth).
// Locally (no Blob credentials): JSON files under site/.local-store/ (gitignored).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const LOCAL = process.env.WHOFUNDS_LOCAL_STORE || path.join(process.cwd(), ".local-store");
const hasBlob = () => Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);

export function storeMode() {
  return hasBlob() ? "blob" : "local";
}

export async function append(prefix, record) {
  const day = new Date().toISOString().slice(0, 10);
  const name = `${prefix}/${day}/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.json`;
  const body = JSON.stringify(record);
  if (hasBlob()) {
    const { put } = await import("@vercel/blob");
    await put(name, body, { access: "private", contentType: "application/json", addRandomSuffix: false });
  } else {
    const p = path.join(LOCAL, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
  }
  return name;
}

export async function recent(prefix, limit = 60) {
  if (hasBlob()) {
    const { list, get } = await import("@vercel/blob");
    const { blobs } = await list({ prefix: prefix + "/", limit: 1000 });
    blobs.sort((a, b) => String(b.pathname).localeCompare(String(a.pathname)));
    const out = [];
    for (const b of blobs.slice(0, limit)) {
      const r = await get(b.pathname, { access: "private" });
      if (r && r.statusCode === 200) out.push(JSON.parse(await new Response(r.stream).text()));
    }
    return out;
  }
  const dir = path.join(LOCAL, prefix);
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const d of fs.readdirSync(dir)) for (const f of fs.readdirSync(path.join(dir, d))) files.push(path.join(dir, d, f));
  files.sort().reverse();
  return files.slice(0, limit).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
}
