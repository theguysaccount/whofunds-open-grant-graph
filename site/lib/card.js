// 1200x630 share card for an organization or foundation page (PNG via @vercel/og).
// Loaded lazily so page renders never pay for the image library.
import { names } from "./data.js";
import { money, num, fmtEin, place, SITE } from "./render.js";

const el = (type, style, children) => ({ type, props: { style, children } });
const fit = (s, max) => (s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s);

function frame(kicker, title, stat, detail) {
  const size = title.length > 70 ? 46 : title.length > 44 ? 56 : 68;
  return el("div", { width: 1200, height: 630, display: "flex", flexDirection: "column", background: "#fbfaf7", color: "#15171a", padding: "60px 72px 0", fontFamily: "Geist" }, [
    el("div", { display: "flex", fontSize: 30, fontWeight: 700, letterSpacing: 1 }, [el("span", {}, "WHO"), el("span", { color: "#0b6b50" }, "FUNDS")]),
    el("div", { display: "flex", marginTop: 34, fontSize: 22, color: "#646b75", letterSpacing: 1, textTransform: "uppercase" }, kicker),
    el("div", { display: "flex", marginTop: 14, fontSize: size, fontWeight: 700, lineHeight: 1.08, letterSpacing: -1.5 }, title),
    el("div", { display: "flex", marginTop: 26, fontSize: 40, fontWeight: 700, color: "#0b6b50" }, stat),
    el("div", { display: "flex", marginTop: 14, fontSize: 25, color: "#3a4048", lineHeight: 1.35 }, detail),
    el("div", { display: "flex", marginTop: "auto", marginBottom: 26, fontSize: 21, color: "#646b75" }, `From IRS Form 990-PF filings, tax year ${SITE.year} · every grant linked to its filing · public domain`),
    el("div", { display: "flex", position: "absolute", left: 0, right: 0, bottom: 0, height: 12, background: "#0b6b50" }, ""),
  ]);
}

export function orgCard(o) {
  const N = names();
  const top = o.f.slice(0, 3).map((f) => (N.f[f[0]] || [f[0]])[0]).join(" · ");
  return frame(
    fit(`Organization · EIN ${fmtEin(o.e)} · ${place(o.c, o.s)}`, 70),
    fit(`Who funds ${o.n}?`, 96),
    `${num(o.nf)} private foundation${o.nf === 1 ? "" : "s"} · ${money(o.t)}`,
    fit(top ? `Including ${top}` : "", 150),
  );
}

export function foundationCard(f) {
  const N = names();
  const paid = ["resolved", "unmatched", "individual", "foreign", "unitemized"].reduce((s, x) => s + f.k[x][1], 0);
  const top = f.g.slice(0, 3).map((g) => (N.o[g[0]] || [g[0]])[0]).join(" · ");
  return frame(
    fit(`Private foundation · EIN ${fmtEin(f.e)} · ${place(f.c, f.s)}`, 70),
    fit(`Where ${f.n}'s grants went`, 96),
    `${money(paid)} to ${num(f.nr)} matched organization${f.nr === 1 ? "" : "s"}`,
    fit(top ? `Top recipients: ${top}` : "", 150),
  );
}

export async function png(tree) {
  const { ImageResponse } = await import("@vercel/og");
  const r = new ImageResponse(tree, { width: 1200, height: 630 });
  return Buffer.from(await r.arrayBuffer());
}
