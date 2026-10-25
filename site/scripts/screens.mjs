// Save screenshots of the key screens to docs/screens/ with headless Chrome. It drives Chrome
// over the DevTools protocol so phone shots get a real 390px mobile viewport (the plain
// --screenshot flag can't make a window narrower than 500px).
//   node scripts/screens.mjs https://owner.github.io/whofunds-open-grant-graph
//   node scripts/screens.mjs <base> "home=/,org=/org/?ein=823296958"   # name=path pairs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(SITE, "..", "docs", "screens");
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const base = (process.argv[2] || "http://localhost:4173").replace(/\/$/, "");
const pages = (process.argv[3] || "home=/,org=/org/042931195/,org-longtail=/org/?ein=823296958,foundation=/foundation/043105768/,search=/search/?q=food%20bank,method=/method/,corrections=/corrections/,data=/data/")
  .split(",").map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)]);   // paths keep their own "="
const sizes = [["desktop", 1280, 1800, false], ["phone", 390, 1600, true]];
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "screens-"));
const chrome = spawn(CHROME, [...(process.env.CI ? ["--no-sandbox"] : []), "--headless=new", "--disable-gpu", "--hide-scrollbars",
  "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise((resolve, reject) => {
  let buf = "";
  chrome.stderr.on("data", (d) => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
  chrome.on("exit", () => reject(new Error("Chrome exited: " + buf.slice(-500))));
});

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const waiting = new Map();
const listeners = new Set();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) {
    const { resolve, reject } = waiting.get(m.id);
    waiting.delete(m.id);
    if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
  } else for (const l of listeners) l(m);
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++seq;
  waiting.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});
const once = (method, sessionId) => new Promise((resolve) => {
  const l = (m) => { if (m.method === method && m.sessionId === sessionId) { listeners.delete(l); resolve(m.params); } };
  listeners.add(l);
});

try {
  const { userAgent } = await send("Browser.getVersion");
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, p] of pages) {
    for (const [label, width, height, mobile] of sizes) {
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile }, sessionId);
      await send("Emulation.setUserAgentOverride", { userAgent: mobile ? PHONE_UA : userAgent.replace("HeadlessChrome", "Chrome") }, sessionId);
      const loaded = once("Page.loadEventFired", sessionId);
      await send("Page.navigate", { url: base + p }, sessionId);
      await loaded;
      await new Promise((r) => setTimeout(r, 2500));   // client-rendered pages and search fetch shards after load
      const { data } = await send("Page.captureScreenshot", { format: "png" }, sessionId);
      const file = path.join(OUT, `${name}-${label}.png`);
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      console.log("saved", path.relative(path.resolve(SITE, ".."), file));
    }
  }
} finally {
  ws.close();
  const exited = new Promise((r) => chrome.once("exit", r));
  chrome.kill();
  await exited;
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
