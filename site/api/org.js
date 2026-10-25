import { getOrg } from "../lib/data.js";
import { orgPage, notFoundPage, setBaseFromRequest } from "../lib/render.js";
import { einFrom, params, send } from "../lib/http.js";

export default async function handler(req, res) {
  setBaseFromRequest(req);
  const ein = einFrom(req, "ein");
  const o = ein ? getOrg(ein) : null;
  if (!o) return send(res, 404, notFoundPage("org", ein));
  if (params(req).q.get("card") === "1") {
    const { orgCard, png } = await import("../lib/card.js");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800");
    res.statusCode = 200;
    return res.end(await png(orgCard(o)));
  }
  send(res, 200, orgPage(o));
}
