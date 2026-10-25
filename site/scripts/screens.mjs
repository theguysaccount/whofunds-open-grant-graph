// Save screenshots of the key screens to docs/screens/ with headless Chrome.
//   node scripts/screens.mjs https://whofunds-xyz.vercel.app
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(SITE, "..", "docs", "screens");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const base = (process.argv[2] || "http://localhost:4173").replace(/\/$/, "");
const pages = (process.argv[3] || "home=/,org=/org/042931195,foundation=/foundation/043105768,search=/search?q=food%20bank,method=/method,corrections=/corrections,data=/data")
  .split(",").map((p) => p.split("="));
const sizes = [["desktop", 1280, 1800], ["phone", 390, 1600]];
fs.mkdirSync(OUT, { recursive: true });
for (const [name, p] of pages) {
  for (const [label, w, h] of sizes) {
    const file = path.join(OUT, `${name}-${label}.png`);
    const args = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", `--window-size=${w},${h}`,
      "--virtual-time-budget=4000", `--screenshot=${file}`, base + p];
    if (label === "phone") args.unshift("--user-agent=Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1");
    execFileSync(CHROME, args, { stdio: "ignore" });
    console.log("saved", path.relative(path.resolve(SITE, ".."), file));
  }
}
