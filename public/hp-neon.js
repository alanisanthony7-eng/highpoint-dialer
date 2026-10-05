/* Highpoint neon: the startup sign, and the live flicker on every neon part of the desk.
   window.hpNeon.intro()  -> plays the neon-sign intro once per browser session
   Tags headings / logo / script lines as neon tubes, gives each sign one loose tube,
   powers titles on when a page opens, and makes a random tube stutter now and then. */
(() => {
  "use strict";
  if (window.hpNeon) return;
  const RM = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ================= intro ================= */
  const SIGN = `
<g id="nnMark" style="--core:#FFE1F0;--glow:#FF2E88" transform="translate(302 18) scale(3)">
  <text class="t" x="18" y="66" font-family="Libre Caslon Text, Georgia, serif" font-size="70" stroke-width=".95">H</text>
  <text class="t" x="58" y="86" font-family="Libre Caslon Text, Georgia, serif" font-size="70" stroke-width=".95">P</text>
  <path class="t" d="M4 80 C40 74 78 56 112 22" stroke-width="1.15"/>
  <path class="t" d="M104 22 L128 12 L118 30 L113 24 Z" stroke-width=".95"/>
</g>
<g id="nnWord" style="--core:#E8F6FF;--glow:#3DB8FF">
  <text class="t" x="500" y="392" text-anchor="middle" font-family="Montserrat, Arial Black, sans-serif" font-weight="900" font-style="italic" font-size="78" letter-spacing="9" stroke-width="2.3">HIGHPOINT</text>
</g>
<g id="nnFin" style="--core:#FFEBD2;--glow:#FF9E3D">
  <path class="t" d="M330 424 H410 M590 424 H670" stroke-width="2"/>
  <text class="f" x="500" y="433" text-anchor="middle" font-family="Libre Caslon Text, Georgia, serif" font-size="25" letter-spacing="14">FINANCIAL</text>
</g>
<g id="nnTag" style="--core:#FFE1F0;--glow:#FF2E88">
  <text class="f" x="500" y="510" text-anchor="middle" font-family="Kaushan Script, cursive" font-size="50">Elevate your future.</text>
</g>`;
  async function intro({ force } = {}) {
    if (!force && ss.get("hpv.neon")) return;
    ss.set("hpv.neon", "1"); ss.set("hpv.led", "1");
    const o = document.createElement("div"); o.id = "nnIntro"; o.setAttribute("aria-hidden", "true");
    o.innerHTML = `<div class="nn-haze"></div><div class="nn-stage"><svg viewBox="0 0 1000 540">${SIGN}</svg><svg class="nn-refl" viewBox="0 330 1000 210" aria-hidden="true">${SIGN.replace(/id="nn/g, 'data-r="nn')}</svg></div><div class="bar"><i></i></div><span class="skip">Tap to skip</span>`;
    document.documentElement.append(o);
    let done = false;
    const finish = () => { if (done) return; done = true; o.classList.add("out"); setTimeout(() => o.remove(), 900); removeEventListener("keydown", finish); };
    o.addEventListener("click", finish); addEventListener("keydown", finish);
    const fontsReady = document.fonts ? Promise.race([Promise.all(['900 italic 78px "Montserrat"', '70px "Libre Caslon Text"', '50px "Kaushan Script"'].map((f) => document.fonts.load(f).catch(() => {}))), wait(900)]) : Promise.resolve();
    await fontsReady; if (done) return;
    requestAnimationFrame(() => o.classList.add("go"));
    const haze = o.querySelector(".nn-haze");
    const grp = (id) => [o.querySelector(`#${id}`), o.querySelector(`[data-r="${id}"]`)].filter(Boolean);
    const set = (id, on) => grp(id).forEach((g) => g.classList.toggle("lit", on));
    let litCount = 0;
    const glow = () => { haze.style.opacity = String(Math.min(1, litCount / 3)); };
    // each tube flickers like a cold neon transformer kicking in
    const flick = async (id, pattern) => { for (let i = 0; i < pattern.length; i++) { if (done) return; set(id, i % 2 === 0); await wait(pattern[i]); } set(id, true); litCount++; glow(); };
    if (RM) { ["nnMark", "nnWord", "nnFin", "nnTag"].forEach((id) => set(id, true)); litCount = 4; glow(); await wait(900); return finish(); }
    await wait(260);
    await flick("nnMark", [70, 90, 50, 260, 40, 60]);
    await wait(120);
    await flick("nnWord", [50, 140, 80, 60, 40, 220]);
    await wait(80);
    await flick("nnFin", [60, 70, 40]);
    await wait(120);
    await flick("nnTag", [90, 60, 50, 120]);
    // one buzzing stutter once everything is lit
    await wait(520); if (done) return;
    for (const ms of [45, 70, 35]) { set("nnWord", false); await wait(ms); set("nnWord", true); await wait(ms * 1.4); }
    await wait(700);
    finish();
  }

  /* ================= live neon on the desk ================= */
  const TEXT = [
    ["#hpGate h1", ""], ["section[data-v] .head h1", ""], [".hero h1", ""], ["#v-pipeline .hero h1", ""],
    [".rail .lockup .hp", "nn-soft"], [".rail .lockup .fin", "nn-o nn-soft"], [".rail .lockup .tag", "nn-soft"],
    ["#hpGate .gx-lock b", "nn-soft"], ["#hpGate .gx-lock span", "nn-o nn-soft"],
    [".hero .eyebrow", "nn-o nn-soft"], ["section[data-v] .head h2", "nn-soft"], [".amtbtn", ""],
  ];
  const SVGS = [".rail .lockup .mark", "#hpGate .gx-lock svg"];
  // give each sign one loose tube that flickers on its own
  const addLoose = (el) => {
    if (el.dataset.nnLoose) return; el.dataset.nnLoose = "1";
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let best = null, n;
    while ((n = walker.nextNode())) if (/[A-Za-z]{3,}/.test(n.nodeValue) && (!best || n.nodeValue.length > best.nodeValue.length)) best = n;
    if (!best) return;
    const t = best.nodeValue, idx = []; for (let i = 1; i < t.length - 1; i++) if (/[A-Za-z]/.test(t[i])) idx.push(i);
    if (!idx.length) return;
    const i = idx[(Math.random() * idx.length) | 0];
    const span = document.createElement("span"); span.className = "nn-bad"; span.textContent = t[i]; span.style.setProperty("--nn-d", (-Math.random() * 7).toFixed(2) + "s");
    // one wrapper keeps the word together even when the heading is a flex row
    const wrap = document.createElement("span"); wrap.className = "nn-word"; wrap.append(document.createTextNode(t.slice(0, i)), span, document.createTextNode(t.slice(i + 1)));
    best.parentNode.replaceChild(wrap, best);
  };
  function tag(root = document) {
    for (const [sel, extra] of TEXT) root.querySelectorAll(sel).forEach((el) => {
      if (el.classList.contains("nn-text")) return;
      el.classList.add("nn-text", ...extra.split(" ").filter(Boolean));
      if (!RM && el.matches("h1")) addLoose(el);
    });
    for (const sel of SVGS) root.querySelectorAll(sel).forEach((el) => el.classList.add("nn-svg"));
  }
  // power a page's sign on the first time it opens this session
  const powered = new Set();
  function powerOn(section) {
    if (RM || !section || powered.has(section.id)) return; powered.add(section.id);
    const signs = section.querySelectorAll(".nn-text"); signs.forEach((el, k) => { el.classList.remove("nn-power"); void el.offsetWidth; el.style.animationDelay = k * 90 + "ms"; el.classList.add("nn-power"); setTimeout(() => { el.classList.remove("nn-power"); el.style.animationDelay = ""; }, 1400 + k * 90); });
  }
  // a random lit tube stutters every few seconds, like a real sign
  function stutterLoop() {
    if (RM) return;
    const next = () => setTimeout(() => {
      if (document.visibilityState === "visible") {
        const vis = [...document.querySelectorAll(".nn-text,.nn-svg")].filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.bottom > 0 && r.top < innerHeight && !el.closest("[hidden]"); });
        const el = vis[(Math.random() * vis.length) | 0];
        if (el && !el.classList.contains("nn-power")) { el.classList.add("nn-stutter"); setTimeout(() => el.classList.remove("nn-stutter"), 1000); }
      }
      next();
    }, 2200 + Math.random() * 4200);
    next();
  }
  function watch() {
    tag();
    const mo = new MutationObserver((muts) => {
      let again = false;
      for (const m of muts) {
        if (m.type === "attributes" && m.attributeName === "hidden" && m.target.matches?.("section[data-v]") && !m.target.hidden) powerOn(m.target);
        if (m.type === "childList" && m.addedNodes.length) again = true;
      }
      if (again) { clearTimeout(watch.t); watch.t = setTimeout(() => tag(), 30); }
    });
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden"] });
    stutterLoop();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();

  window.hpNeon = { intro, tag };
})();
