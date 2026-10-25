// Render public/assets/og.png (1200x630) from data/stats.json with headless Chrome.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const S = JSON.parse(fs.readFileSync(path.join(SITE, "data", "stats.json"), "utf8"));
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const money = (n) => (n >= 1e9 ? "$" + (n / 1e9).toFixed(1) + "B" : "$" + Math.round(n / 1e6) + "M");
const num = (n) => Number(n).toLocaleString("en-US");
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:1200px;height:630px;background:#fbfaf7;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#15171a}
.c{position:absolute;inset:0;padding:64px 72px;display:flex;flex-direction:column}
.logo{font:800 34px ui-monospace,Menlo,monospace;letter-spacing:.02em}.logo span{color:#0b6b50}
h1{font-size:76px;line-height:1.02;letter-spacing:-.03em;margin:44px 0 18px;max-width:950px}
p{font-size:30px;line-height:1.35;color:#3a4048;margin:0;max-width:1000px}
.row{margin-top:auto;display:flex;gap:56px;font-size:24px;color:#646b75}.row b{display:block;font-size:40px;color:#15171a;letter-spacing:-.02em}
.bar{position:absolute;left:0;right:0;bottom:0;height:14px;background:#0b6b50}
</style></head><body><div class="c">
<div class="logo">WHO<span>FUNDS</span></div>
<h1>See which foundations fund any nonprofit.</h1>
<p>Every US private-foundation grant from ${S.year} IRS filings, matched to the recipient's tax ID. Public domain.</p>
<div class="row"><div><b>${num(S.foundations)}</b>foundations</div><div><b>${(S.paid_lines / 1e6).toFixed(2)}M</b>grant lines</div><div><b>${money(S.paid_dollars)}</b>in grants</div><div><b>${num(S.orgs)}</b>recipients matched</div></div>
</div><div class="bar"></div></body></html>`;
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "og-")), "og.html");
fs.writeFileSync(tmp, html);
const out = path.join(SITE, "public", "assets", "og.png");
execFileSync(CHROME, [...(process.env.CI ? ["--no-sandbox"] : []), "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
  "--window-size=1200,630", `--screenshot=${out}`, "file://" + tmp], { stdio: "ignore" });
console.log("wrote", out, fs.statSync(out).size, "bytes");
