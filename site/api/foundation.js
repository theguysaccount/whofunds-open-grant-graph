import { getFoundation } from "../lib/data.js";
import { foundationPage, notFoundPage, setBaseFromRequest } from "../lib/render.js";
import { einFrom, params, send } from "../lib/http.js";

export default async function handler(req, res) {
  setBaseFromRequest(req);
  const ein = einFrom(req, "ein");
  const f = ein ? getFoundation(ein) : null;
  if (!f) return send(res, 404, notFoundPage("foundation", ein));
  if (params(req).q.get("card") === "1") {
    const { foundationCard, png } = await import("../lib/card.js");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800");
    res.statusCode = 200;
    return res.end(await png(foundationCard(f)));
  }
  send(res, 200, foundationPage(f, params(req).q.get("all") === "1"));
}
