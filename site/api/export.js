// CSV export of one organization's funders or one foundation's grants (same
// columns as the CC0 release, restricted to that entity).
import { getFoundation, getOrg, names } from "../lib/data.js";
import { filingUrl } from "../lib/render.js";
import { params, send } from "../lib/http.js";

const CODES = { A: "ADDR_EXACT_NAME", C: "ADDR_CONTAINMENT", Z: "ZIP5", S: "CITY_STATE", L: "ALIAS", N: "NAME_EXACT_NATIONAL", T: "NAME_TOKEN", E: "EIN_IN_TEXT" };
const cell = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const row = (a) => a.map(cell).join(",") + "\n";

export default function handler(req, res) {
  const { q } = params(req);
  const d = (s) => String(s || "").replace(/[^0-9]/g, "").padStart(9, "0");
  const N = names();
  let out = "";
  let fn = "whofunds.csv";
  if (q.get("ein")) {
    const o = getOrg(d(q.get("ein")));
    if (!o) return send(res, 404, "not found\n", "text/plain; charset=utf-8");
    fn = `whofunds_${o.e}_funders.csv`;
    out += row(["recipient_ein", "recipient_name", "funder_ein", "funder_name", "funder_city", "funder_state", "amount", "purpose", "tax_period_end", "match_strategy", "match_score", "margin", "source_filing_url"]);
    for (const [fe, , oid, tpe, lines] of o.f) {
      const m = N.f[fe] || [fe, "", ""];
      for (const l of lines) out += row([o.e, o.n, fe, m[0], m[1], m[2], l[0], l[1], tpe, CODES[l[4]] || l[4], l[2], l[3], filingUrl(fe, oid)]);
    }
  } else if (q.get("fdn")) {
    const f = getFoundation(d(q.get("fdn")));
    if (!f) return send(res, 404, "not found\n", "text/plain; charset=utf-8");
    fn = `whofunds_${f.e}_grants.csv`;
    out += row(["funder_ein", "funder_name", "recipient_ein", "recipient_name", "recipient_city", "recipient_state_or_country", "amount", "purpose", "status", "match_strategy", "match_score", "margin", "source_filing_url"]);
    for (const g of f.g) {
      const o = N.o[g[0]] || [g[0], "", ""];
      out += row([f.e, f.n, g[0], o[0], o[1], o[2], g[1], g[2], "matched", CODES[g[5]] || g[5], g[3], g[4], filingUrl(f.e, f.o)]);
    }
    for (const u of f.u) out += row([f.e, f.n, "", u[0], u[1], u[2], u[3], u[4], u[5] === "f" ? "foreign" : "unmatched", "", "", "", filingUrl(f.e, f.o)]);
  } else {
    return send(res, 400, "ein or fdn required\n", "text/plain; charset=utf-8");
  }
  res.setHeader("Content-Disposition", `attachment; filename="${fn}"`);
  send(res, 200, out, "text/csv; charset=utf-8");
}
