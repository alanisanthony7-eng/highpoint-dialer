import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const temp = await mkdtemp(path.join(tmpdir(), "highpoint-smoke-"));
const shots = process.argv.includes("--shots"), artifacts = path.join(root, "test", "artifacts");
let server, browser;

const waitForServer = () => new Promise((resolve, reject) => {
  let output = "", settled = false;
  const done = (err, url) => { if (settled) return; settled = true; clearTimeout(timer); err ? reject(err) : resolve(url); };
  server = spawn(process.execPath, ["test/serve.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: "0", HP_LOCAL_DB: path.join(temp, "smoke.sqlite"), HP_ADMIN_EMAILS: "smoke@hp.test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const read = (chunk) => {
    output += chunk;
    const match = output.match(/Local desk: (http:\/\/[^\s]+)/);
    if (match) done(null, match[1]);
  };
  server.stdout.on("data", read);
  server.stderr.on("data", read);
  server.once("error", done);
  server.once("exit", (code) => code && done(new Error(`Local server exited (${code}):\n${output}`)));
  const timer = setTimeout(() => done(new Error(`Local server did not start:\n${output}`)), 15000);
});

const check = (condition, message) => {
  if (!condition) throw new Error(message);
  console.log(`PASS ${message}`);
};

try {
  const base = await waitForServer();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();

  const health = await page.request.get(`${base}/api/health`);
  check(health.ok() && (await health.json()).db, "health endpoint reports a database");

  await page.goto(base, { waitUntil: "domcontentloaded" });
  const gate = page.locator("#hpGate");
  await gate.waitFor();
  check(await page.locator("main").getAttribute("aria-hidden") === "true", "signed-out desk is hidden from assistive technology");
  check(await page.locator("main").evaluate((el) => el.inert), "signed-out desk is inert");

  await gate.getByLabel("Email").fill("smoke@hp.test");
  await gate.locator("#gPw").fill("wrong-password");
  await gate.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.locator(".g-err").waitFor();
  check((await page.locator(".g-err").innerText()).length > 0, "wrong password stays gated with a useful error");

  await gate.getByRole("button", { name: "Create an account" }).click();
  await gate.getByLabel("Full name").fill("Smoke Admin");
  await gate.getByLabel("Email").fill("smoke@hp.test");
  await gate.locator("#gPw").fill("smoke-password");
  await gate.locator("#gAgree").check();
  await gate.getByRole("button", { name: "Create my account" }).click();
  await page.locator("html:not(.gated)").waitFor();
  await page.locator(".hp-acct-b").waitFor();
  await page.locator("section[data-v]:not([hidden])").waitFor();
  check(await page.locator("section[data-v]:not([hidden])").count() === 1, "signup opens exactly one active desk view");
  check(await page.locator('script[src="/hp-dialer.js"]').count() === 0, "dialer is deferred before first use");

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".hp-acct-b").waitFor();
  check(!await page.locator("html").evaluate((el) => el.classList.contains("gated")), "session survives a reload");

  await page.getByRole("button", { name: "Clients", exact: true }).click();
  await page.locator("#v-contacts:not([hidden])").waitFor();
  check(await page.locator("#v-pipeline").evaluate((el) => el.inert && el.getAttribute("aria-hidden") === "true"), "inactive desk views are inert");

  await page.locator('.nav[data-view="dialer"]').click();
  await page.locator('script[src="/hp-dialer.js"]').waitFor({ state: "attached" });
  check(await page.locator('script[src="/hp-dialer.js"]').count() === 1, "dialer loads once on first visit");

  const themes = ["executive", "modern-light", "midnight", "miami", "halloween", "brazil", "vegas", "america"];
  if (shots) await mkdir(artifacts, { recursive: true });
  for (const theme of themes) {
    const audit = await page.evaluate((id) => {
      window.hpTheme.set(id);
      const s = getComputedStyle(document.documentElement), parse = (v) => {
        v = v.trim(); if (v.startsWith("#")) { const h = v.slice(1); return h.length === 3 ? [...h].map(x => parseInt(x + x, 16)) : [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); }
        return (v.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      };
      const lum = (rgb) => { const c = rgb.map(x => { x /= 255; return x <= .03928 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
      const a = lum(parse(s.getPropertyValue("--theme-text"))), b = lum(parse(s.getPropertyValue("--theme-bg"))), contrast = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      return { id: document.documentElement.dataset.theme, saved: localStorage.getItem("hp.theme"), contrast, accent: s.getPropertyValue("--theme-accent").trim(), surface: s.getPropertyValue("--theme-surface").trim() };
    }, theme);
    check(audit.id === theme && audit.saved === theme, `${theme} switches instantly and persists`);
    check(audit.accent && audit.surface, `${theme} exposes complete semantic tokens`);
    check(audit.contrast >= 4.5, `${theme} text contrast is at least 4.5:1`);
    await page.setViewportSize({ width: 1366, height: 850 });
    await page.evaluate(() => window.hpDesk.go("pipeline"));
    check(await page.locator(".rail").evaluate((el) => getComputedStyle(el).position !== "fixed"), `${theme} desktop shell uses the side rail`);
    const atmosphere = await page.evaluate(() => {
      const visible = (selector) => {
        const el = document.querySelector(selector), s = el && getComputedStyle(el);
        return !!s && s.display !== "none" && Number.parseFloat(s.opacity || "1") > .15;
      };
      return { scene: visible(".vscene") || visible(".hp-fx-hall") || visible(".hp-fx-br") || visible(".hp-fx-vg") || visible(".hp-fx-us") || visible(".hp-fx-day"), planes: visible("#sky"), floor: visible(".hp-floor") };
    });
    check(atmosphere.scene && atmosphere.planes && atmosphere.floor, `${theme} keeps the animated aviation atmosphere`);
    check(await page.locator('script[src*="hp-tilt.js"]').count() === 1, `${theme} keeps pointer depth on dashboard surfaces`);
    if (shots) { await mkdir(path.join(artifacts, theme), { recursive: true }); await page.screenshot({ path: path.join(artifacts, theme, "desktop-pipeline.png"), fullPage: true }); }
    await page.setViewportSize({ width: 390, height: 844 });
    const mobileNav = await page.locator(".rail .nav").evaluateAll((els) => els.filter((el) => getComputedStyle(el).display !== "none").length);
    check(mobileNav === 5, `${theme} mobile shell shows five primary destinations`);
    const mobileLayout = await page.locator("main").evaluate((el) => {
      const app = el.closest(".app"), root = getComputedStyle(document.documentElement);
      return { main: Math.round(el.getBoundingClientRect().width), app: Math.round(app.getBoundingClientRect().width), grid: getComputedStyle(app).gridTemplateColumns, rail: root.getPropertyValue("--shell-rail-w").trim(), viewport: innerWidth };
    });
    check(mobileLayout.main >= 360, `${theme} mobile content uses the viewport (${JSON.stringify(mobileLayout)})`);
    if (shots) await page.screenshot({ path: path.join(artifacts, theme, "mobile-pipeline.png"), fullPage: true });
  }
  await page.locator("#navMore").click();
  check(await page.getByRole("dialog", { name: "More pages" }).isVisible(), "mobile More opens the secondary destinations");
  await page.getByRole("dialog", { name: "More pages" }).getByRole("button", { name: "Import leads" }).click();
  await page.locator("#v-import:not([hidden])").waitFor();
  check(true, "mobile More navigates to a secondary destination");
  await page.setViewportSize({ width: 1366, height: 850 });
  await page.evaluate(() => window.hpTheme.set("executive"));
  await page.locator(".hp-acct-b").click();
  await page.getByRole("menuitem", { name: "Appearance" }).click();
  check(await page.locator('.hpt-choice[aria-pressed="true"]').getAttribute("data-theme-choice") === "executive", "appearance picker identifies the active theme");
  await page.keyboard.press("Escape");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".hp-acct-b").waitFor();
  check(await page.locator("html").getAttribute("data-theme") === "executive", "selected theme survives reload");

  await page.locator(".hp-acct-b").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.locator("#hpGate").waitFor();
  check(await page.locator("html").evaluate((el) => el.classList.contains("gated")), "sign out returns to the gate");

  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(base, { waitUntil: "domcontentloaded" });
  await mobile.locator("#hpGate").waitFor();
  check(await mobile.locator(".gx-sub").evaluate((el) => getComputedStyle(el).display === "none"), "narrow login collapses the oversized hero copy");
  check(await mobile.locator(".g-card").isVisible(), "login form remains visible on a narrow screen");
} finally {
  await browser?.close().catch(() => {});
  if (server && server.exitCode == null) {
    const exited = new Promise((resolve) => server.once("exit", resolve));
    server.kill();
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  for (let i = 0; i < 4; i++) {
    try { await rm(temp, { recursive: true, force: true }); break; }
    catch (e) { if (i === 3) console.warn("Smoke cleanup:", e.message); else await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
}
