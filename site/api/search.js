import { search } from "../lib/data.js";
import { searchPage, setBaseFromRequest } from "../lib/render.js";
import { json, params, send } from "../lib/http.js";

export default function handler(req, res) {
  setBaseFromRequest(req);
  const { q } = params(req);
  const query = (q.get("q") || "").slice(0, 120);
  const kind = q.get("kind") === "org" ? "o" : q.get("kind") === "foundation" ? "f" : "";
  if (q.get("html") === "1") {
    return send(res, 200, searchPage(query, query ? search(query, 40, kind) : []), "text/html; charset=utf-8",
      "public, max-age=300, s-maxage=3600");
  }
  json(res, 200, { q: query, results: query.length >= 2 ? search(query, Number(q.get("limit")) || 8, kind) : [] },
    "public, max-age=300, s-maxage=3600");
}
