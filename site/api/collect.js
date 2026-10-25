// POST /api/collect: correction reports, fix-it votes and alert-waitlist signups.
// Stores the minimum: no IP address, no user agent, no cookies.
import { append } from "../lib/store.js";
import { json, readBody } from "../lib/http.js";

const EMAIL = /^[^\s@<>()]{1,64}@[^\s@<>()]{1,190}\.[A-Za-z]{2,24}$/;
const ein = (s) => {
  const d = String(s || "").replace(/[^0-9]/g, "");
  return d.length >= 7 && d.length <= 9 ? d.padStart(9, "0") : "";
};
const clip = (s, n) => String(s || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

export default async function handler(req, res) {
  if (req.method !== "POST") return json(res, 405, { ok: false, error: "POST only" });
  let b;
  try { b = await readBody(req); } catch { return json(res, 413, { ok: false, error: "Too large" }); }
  if (b.website) return json(res, 200, { ok: true }); // honeypot: bots fill every field
  const at = new Date().toISOString();
  try {
    if (b.type === "alert") {
      const email = clip(b.email, 254);
      if (!EMAIL.test(email)) return json(res, 400, { ok: false, error: "Please enter a valid email address." });
      await append("alerts", { at, email, ein: ein(b.ein), page: clip(b.page, 120) });
      return json(res, 200, { ok: true, message: "Thanks. We'll email you once, when alerts launch." });
    }
    if (b.type === "correction" || b.type === "fixit_vote") {
      const email = clip(b.email, 254);
      const rec = {
        at, type: b.type, status: "pending",
        org_ein: ein(b.org_ein), fdn_ein: ein(b.fdn_ein), object_id: clip(b.object_id, 20).replace(/[^0-9]/g, ""),
        issue: ["wrong_org", "chapter", "individual", "other", "same", "different"].includes(b.issue) ? b.issue : "other",
        suggested: clip(b.suggested, 200), note: clip(b.note, 1000), filed_name: clip(b.filed_name, 200),
        state: clip(b.state, 3), near_ein: ein(b.near_ein), page: clip(b.page, 120),
        email: EMAIL.test(email) ? email : "",
      };
      if (!rec.org_ein && !rec.fdn_ein && !rec.near_ein) return json(res, 400, { ok: false, error: "Missing which match this is about." });
      await append("corrections", rec);
      return json(res, 200, { ok: true, message: "Thanks. It's in the public queue for review." });
    }
    return json(res, 400, { ok: false, error: "Unknown type" });
  } catch (e) {
    console.error("collect failed", e && e.message);
    return json(res, 503, { ok: false, error: "Couldn't save right now. Please try again in a minute." });
  }
}
