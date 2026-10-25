// GET /api/corrections: the public correction queue. Free text and emails are
// never shown here; only what the report is about and a suggested EIN.
import { recent } from "../lib/store.js";
import { json } from "../lib/http.js";

export default async function handler(req, res) {
  try {
    const items = (await recent("corrections", 80)).map((r) => {
      const sug = String(r.suggested || "").replace(/[^0-9]/g, "");
      return {
        at: r.at, type: r.type, status: r.status || "pending", issue: r.issue, org_ein: r.org_ein || "",
        fdn_ein: r.fdn_ein || "", object_id: r.object_id || "", near_ein: r.near_ein || "", state: r.state || "",
        suggested_ein: sug.length === 9 ? sug : "", has_note: Boolean(r.note),
      };
    });
    json(res, 200, { items }, "public, max-age=60, s-maxage=120");
  } catch (e) {
    console.error("corrections failed", e && e.message);
    json(res, 200, { items: [], error: "Queue temporarily unavailable" }, "no-store");
  }
}
