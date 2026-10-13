// Builds (if needed), starts the Ductus web app on a free port with the local
// demo journal on, and drives /rad in Chromium: type invented text, reload,
// check it is restored, screenshot.
// Usage: node .claude/skills/run-ductus/driver.mjs [--port 3111] [--out DIR] [--skip-build] [--headed]
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { pnpmCommand } from "./process-command.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const port = Number(opt("port", "3111"));
const out = opt("out", join(tmpdir(), "run-ductus"));
const base = `http://127.0.0.1:${port}`;
const windows = process.platform === "win32";
// Validate the port before building or starting a process.
const buildPlan = pnpmCommand("build");
const serverPlan = pnpmCommand("serve", { port });
mkdirSync(out, { recursive: true });

if (!args.includes("--skip-build") || !existsSync(".next")) {
  const build = spawnSync(buildPlan.command, buildPlan.args, { stdio: "inherit", shell: false, windowsHide: true });
  if (build.status !== 0) throw new Error("pnpm build failed");
}

// The editor needs the flag AND a local/ci/demo deployment. No database is
// involved: the journal is IndexedDB in the browser.
const server = spawn(serverPlan.command, serverPlan.args, {
  stdio: ["ignore", "inherit", "inherit"],
  shell: false,
  windowsHide: true,
  env: { ...process.env, DUCTUS_LOCAL_DEMO_JOURNAL: "1", DUCTUS_DEPLOYMENT: "local" },
});
const stop = () => {
  if (windows && server.pid) spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { shell: false, windowsHide: true });
  else server.kill("SIGTERM");
};

let browser;
try {
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${base}/rad`)).ok) break;
    } catch {}
    if (i > 60) throw new Error("server did not become ready in 30 s");
    await sleep(500);
  }
  browser = await chromium.launch({ headless: !args.includes("--headed") });
  const context = await browser.newContext({ locale: "hr-HR", viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const editor = page.getByRole("textbox", { name: "Tekst rada" });
  await page.goto(`${base}/rad`);
  await editor.waitFor();
  // contenteditable flips to "true" once the local journal has opened.
  await page.locator('[role="textbox"][contenteditable="true"]').waitFor({ timeout: 15_000 }).catch(() => {
    throw new Error("editor stays read-only: flag or deployment not honoured");
  });
  const text = "Izmisljeni probni odlomak za provjeru.";
  await editor.click();
  await page.keyboard.type(text);
  await sleep(1500); // let the local journal persist
  await page.reload();
  await editor.waitFor();
  await page.waitForFunction((t) => document.body.innerText.includes(t), text);
  const shot = join(out, "rad-restored.png");
  await page.screenshot({ path: shot, fullPage: true });
  console.log(`OK: typed text restored after reload; screenshot ${shot}`);
} finally {
  await browser?.close();
  stop();
}
