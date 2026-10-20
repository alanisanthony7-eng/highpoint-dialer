/* Highpoint call tools: the script, the quoter and the live call, kept up while you dial.
   By default they live in one side panel on the right. The page makes room for it instead of being covered, and you
   can show one tool or stack two or three (drag the dividers to share the height, drag the panel's left edge to
   widen it). Any tool can also pop out into its own window you can drag and resize, and in Chrome and Edge a window
   can stay on top of your other apps. On phones each tool is a sheet at the bottom of the screen.
   They follow the call:
   - Script: fills in the client's details and the quoter's prices, and tracks where you are as you read it.
   - Quote: follows the client on the call and fills itself from what they say, once they agree to recording.
   - Live call: the transcript, what the copilot heard, objections with talking points, and the consent buttons.
   Shortcuts: Alt+S script, Alt+Q quote, Alt+L live call. Any button with data-pop="script|quote|live" opens one. */
(() => {
  "use strict";
  if (window.hpPop) return;
  const $ = (s, r) => r.querySelector(s), $$ = (s, r) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const D = () => window.hpDesk, DL = () => window.hpDialer, QT = () => window.hpQuoter, CO = () => window.hpCopilot;
  const toast = (m) => (D()?.toast || console.log)(m);
  const usd = (n, d = 0) => (n == null || !isFinite(n) ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const isPhone = () => matchMedia("(max-width: 640px)").matches;
  let pipOpen = false; // set while a tool is kept on top of other apps
  const soon = (fn) => (document.hidden || pipOpen ? setTimeout(fn, 30) : requestAnimationFrame(fn)); // the page's animation frames can pause while you work in another app; the on-top window still updates
  const up = (s) => String(s || "").trim().toUpperCase();
  const HTML = document.documentElement;

  if (!document.querySelector('link[href="/hp-pop.css"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/hp-pop.css"; document.head.append(l); }

  const sv = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const IC = {
    script: sv('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/>'),
    quote: sv('<circle cx="12" cy="12" r="9"/><path d="M15 9.4c-.5-1.1-1.6-1.8-3-1.8-1.7 0-3 .9-3 2.2 0 3.1 6 1.6 6 4.7 0 1.3-1.3 2.2-3 2.2-1.4 0-2.6-.7-3-1.9M12 6v1.6M12 16.7v1.5"/>'),
    live: sv('<path d="M3 12h2M7 8v8M11 4v16M15 8v8M19 10v4M22 12h-1"/>'),
    min: sv('<path d="M6 12h12"/>'),
    max: sv('<rect x="5" y="5" width="14" height="14" rx="2.5"/>'),
    x: sv('<path d="M6 6l12 12M18 6 6 18"/>'),
    out: sv('<path d="M14 4h6v6"/><path d="M20 4l-8 8"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
    dock: sv('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M14 4v16"/>'),
    pip: sv('<rect x="3" y="5" width="18" height="14" rx="2.5"/><rect x="12" y="11.5" width="6.5" height="5" rx="1"/>'),
    back: sv('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  };
  const KINDS = {
    script: { title: "Script", label: "Script", key: "S", w: 360, h: 640, minW: 290, minH: 220, wt: 1.25 },
    quote: { title: "Quote", label: "Quote", key: "Q", w: 370, h: 620, minW: 300, minH: 240, wt: 1 },
    live: { title: "Live call", label: "Live", key: "L", w: 340, h: 520, minW: 280, minH: 200, wt: 0.9 },
  };
  const ORDER = ["script", "quote", "live"];
  const PIP_OK = "documentPictureInPicture" in window;

  /* ================= where each tool lives: the side panel (default) or its own window ================= */
  const G = lsGet("hp.pop", {}); // per tool: open, mode ("dock" | "float"), and the window's x, y, w, h, min
  const PN = Object.assign({ w: 380, wt: {} }, lsGet("hp.pop.panel", {})); // the side panel: width, and each tool's share of its height
  let gTimer = 0, pTimer = 0;
  const saveG = () => { clearTimeout(gTimer); gTimer = setTimeout(() => lsSet("hp.pop", G), 250); };
  const savePN = () => { clearTimeout(pTimer); pTimer = setTimeout(() => lsSet("hp.pop.panel", PN), 250); };
  const W = new Map(); // tool -> { k, el, body, built, st, docked }
  const ST = {}; // each tool's view state, kept when it moves between the panel and a window
  let zTop = 360, pip = null, panel = null; // pip: { k, win }
  const floating = (k) => isPhone() || G[k]?.mode === "float";
  const panelW = () => Math.round(Math.max(320, Math.min(PN.w || 380, 640, innerWidth * 0.5)));

  /* ---------- the side panel ---------- */
  function panelEl() {
    if (panel) return panel;
    panel = document.createElement("aside");
    panel.className = "hpp-panel"; panel.hidden = true; panel.setAttribute("aria-label", "Call tools");
    panel.innerHTML = `<div class="hpp-pgrip" title="Drag to resize" aria-hidden="true"></div>
      <header class="hpp-ptop"><div class="hpp-ptabs" role="group" aria-label="Tools in the panel">${ORDER.map((k) => `<button type="button" data-ptab="${k}" aria-pressed="false" title="${KINDS[k].title} · Alt+${KINDS[k].key}">${IC[k]}<span>${KINDS[k].label}</span></button>`).join("")}</div>
        <span class="hpp-sp"></span><button type="button" class="hpp-hb" data-pa="out" title="Pop out into its own window" aria-label="Pop this tool out into its own window">${IC.out}</button><button type="button" class="hpp-hb" data-pa="close" title="Close the panel" aria-label="Close the panel">${IC.x}</button></header>
      <div class="hpp-stack"></div>`;
    $("[data-pa=close]", panel).onclick = () => ORDER.forEach((k) => { if (W.get(k)?.docked) close(k); });
    $("[data-pa=out]", panel).onclick = () => { const k = ORDER.find((x) => W.get(x)?.docked); if (k) setMode(k, "float"); };
    $$("[data-ptab]", panel).forEach((b) => (b.onclick = () => toggle(b.dataset.ptab)));
    const grip = $(".hpp-pgrip", panel);
    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return; e.preventDefault(); grip.setPointerCapture(e.pointerId); grip.classList.add("on"); HTML.classList.add("hpp-sizing");
      grip.onpointermove = (m) => { PN.w = Math.round(Math.max(320, Math.min(640, innerWidth * 0.5, innerWidth - m.clientX))); layout(); };
      grip.onpointerup = grip.onpointercancel = () => { grip.onpointermove = grip.onpointerup = grip.onpointercancel = null; grip.classList.remove("on"); HTML.classList.remove("hpp-sizing"); savePN(); };
    });
    document.body.append(panel);
    return panel;
  }
  // put the docked tools in order, top to bottom, with a divider between each pair
  function stack() {
    const p = panelEl(), st = $(".hpp-stack", p), shown = ORDER.filter((k) => W.get(k)?.docked);
    $$(".hpp-div", st).forEach((d) => d.remove());
    shown.forEach((k, i) => { // only move what's out of place, so the others keep their scroll position
      const el = W.get(k).el, at = st.children[i] || null;
      if (at !== el) st.insertBefore(el, at);
      el.style.flex = `${PN.wt[k] || KINDS[k].wt} 1 0px`;
    });
    shown.slice(0, -1).forEach((k, i) => W.get(k).el.after(divider(k, shown[i + 1])));
    $$("[data-ptab]", p).forEach((b) => b.setAttribute("aria-pressed", String(shown.includes(b.dataset.ptab))));
    p.hidden = !shown.length;
    p.classList.toggle("single", shown.length === 1); // one tool: the panel's own header is enough
    layout();
  }
  function divider(a, b) {
    const d = document.createElement("div"); d.className = "hpp-div"; d.setAttribute("role", "separator"); d.setAttribute("aria-orientation", "horizontal"); d.title = "Drag to share the space";
    d.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return; e.preventDefault(); d.setPointerCapture(e.pointerId); d.classList.add("on");
      const A = W.get(a).el, B = W.get(b).el, ha = A.getBoundingClientRect().height, hb = B.getBoundingClientRect().height, sy = e.clientY;
      const wa = PN.wt[a] || KINDS[a].wt, wb = PN.wt[b] || KINDS[b].wt;
      d.onpointermove = (m) => { const na = Math.max(110, Math.min(ha + hb - 110, ha + m.clientY - sy)); PN.wt[a] = (wa + wb) * na / (ha + hb); PN.wt[b] = (wa + wb) - PN.wt[a]; A.style.flex = `${PN.wt[a]} 1 0px`; B.style.flex = `${PN.wt[b]} 1 0px`; };
      d.onpointerup = d.onpointercancel = () => { d.onpointermove = d.onpointerup = d.onpointercancel = null; d.classList.remove("on"); savePN(); };
    });
    d.addEventListener("dblclick", () => { delete PN.wt[a]; delete PN.wt[b]; savePN(); stack(); }); // back to the default split
    return d;
  }
  // the page makes room for the panel; on a laptop the client profile also takes the menu's space during a call
  function layout() {
    const on = !!panel && !panel.hidden && !isPhone(), w = panelW();
    HTML.classList.toggle("hpp-docked", on);
    HTML.style.setProperty("--hpp-w", on ? w + "px" : "0px");
    if (panel) panel.style.width = w + "px";
    HTML.classList.toggle("hpp-tight", !isPhone() && innerWidth - (on ? w : 0) - 262 < 900);
    const d = document.getElementById("hpdDock"); // a floating call card the agent dragged under the panel moves out of its way
    if (d && on && !d.classList.contains("callbar") && d.style.left) { const r = d.getBoundingClientRect(), lim = innerWidth - w - 12; if (r.right > lim) d.style.left = Math.max(8, lim - r.width) + "px"; }
  }

  /* ---------- a tool in the panel ---------- */
  function buildPane(k) {
    const K = KINDS[k], el = document.createElement("section");
    el.className = "hpp-pane"; el.dataset.kind = k; el.setAttribute("aria-label", K.title);
    el.innerHTML = `<div class="hpp-ph"><span class="hpp-ic">${IC[k]}</span><b class="hpp-t">${K.title}</b><span class="hpp-sub"></span><span class="hpp-sp"></span>
      <button type="button" class="hpp-hb" data-a="float" title="Pop out into its own window" aria-label="Pop the ${K.title.toLowerCase()} out into its own window">${IC.out}</button>
      <button type="button" class="hpp-hb" data-a="x" title="Close" aria-label="Close the ${K.title.toLowerCase()}">${IC.x}</button></div><div class="hpp-body"></div>`;
    $('[data-a="x"]', el).onclick = () => close(k);
    $('[data-a="float"]', el).onclick = () => setMode(k, "float");
    return { k, el, body: $(".hpp-body", el), built: false, st: (ST[k] = ST[k] || {}), docked: true };
  }

  /* ---------- a tool in its own window ---------- */
  function defaults(k) {
    const vw = innerWidth, vh = innerHeight, K = KINDS[k], w = Math.min(K.w, vw - 24), h = Math.min(K.h, vh - 40);
    const i = ORDER.indexOf(k), x = Math.max(12, vw - panelW() * (HTML.classList.contains("hpp-docked") ? 1 : 0) - w - 24 - i * 28);
    return { x, y: Math.max(12, Math.min(80 + i * 28, vh - h - 12)), w, h };
  }
  function geo(k) { return Object.assign(defaults(k), G[k] && G[k].w ? { x: G[k].x, y: G[k].y, w: G[k].w, h: G[k].h } : {}); }
  function place(k) {
    const w = W.get(k); if (!w || w.docked || w.el.classList.contains("in-pip")) return;
    const g = geo(k), K = KINDS[k], vw = innerWidth, vh = innerHeight;
    g.w = Math.max(K.minW, Math.min(g.w, vw - 16)); g.h = Math.max(K.minH, Math.min(g.h, vh - 16));
    g.x = Math.max(8, Math.min(g.x, vw - g.w - 8)); g.y = Math.max(8, Math.min(g.y, vh - 52));
    if (g.y + g.h > vh - 8) { g.h = Math.max(K.minH, vh - 8 - g.y); if (g.y + g.h > vh - 8) g.y = Math.max(8, vh - 8 - g.h); } // keep the resize corner on screen
    Object.assign(w.el.style, { left: g.x + "px", top: g.y + "px" });
    w.el.style.setProperty("--w", g.w + "px"); w.el.style.setProperty("--h", g.h + "px");
  }
  const wins = () => [...W.values()].filter((x) => !x.docked);
  function front(k) {
    const w = W.get(k); if (!w || w.docked) return;
    if (zTop >= 398) { zTop = 360; wins().sort((a, b) => (+a.el.style.zIndex || 0) - (+b.el.style.zIndex || 0)).forEach((x) => (x.el.style.zIndex = ++zTop)); }
    w.el.style.zIndex = ++zTop;
    wins().forEach((x) => x.el.classList.toggle("front", x === w));
    G[k] = { ...(G[k] || {}), at: Date.now() }; saveG();
  }
  function frontKind() { let best = null; wins().forEach((x) => { if (!best || (+x.el.style.zIndex || 0) > (+best.el.style.zIndex || 0)) best = x; }); return best?.k || null; }
  const isOpen = (k) => W.has(k);
  const isMin = (k) => !!W.get(k)?.el.classList.contains("min");

  function buildWin(k) {
    const K = KINDS[k];
    const el = document.createElement("section");
    el.className = "hpp"; el.dataset.kind = k; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", K.title);
    el.innerHTML = `<header class="hpp-h"><span class="hpp-ic">${IC[k]}</span><b class="hpp-t">${K.title}</b><span class="hpp-sub"></span><span class="hpp-sp"></span>
      <span class="hpp-switch" role="group" aria-label="Other tools"></span>
      <button type="button" class="hpp-hb hpp-nophone" data-a="dock" title="Put it back in the side panel" aria-label="Put the ${K.title.toLowerCase()} back in the side panel">${IC.dock}</button>
      ${PIP_OK ? `<button type="button" class="hpp-hb hpp-nophone" data-a="pip" title="Keep on top of your other windows" aria-label="Keep on top of your other windows">${IC.pip}</button>` : ""}
      <button type="button" class="hpp-hb" data-a="min" title="Tuck away" aria-label="Tuck away">${IC.min}</button>
      <button type="button" class="hpp-hb" data-a="x" title="Close" aria-label="Close the ${K.title.toLowerCase()}">${IC.x}</button></header>
      <div class="hpp-body"></div><div class="hpp-rz" aria-hidden="true"></div>`;
    const w = { k, el, body: $(".hpp-body", el), built: false, st: (ST[k] = ST[k] || {}), docked: false };
    const hd = $(".hpp-h", el);
    el.addEventListener("pointerdown", () => front(k), true);
    $('[data-a="x"]', el).onclick = () => close(k);
    $('[data-a="min"]', el).onclick = () => minimize(k, !isMin(k));
    $('[data-a="dock"]', el).onclick = () => setMode(k, "dock");
    $('[data-a="pip"]', el)?.addEventListener("click", () => (pip?.k === k ? unpip() : toPip(k)));
    hd.addEventListener("dblclick", (e) => { if (!e.target.closest("button") && !el.classList.contains("in-pip")) minimize(k, !isMin(k)); });
    // drag by the title bar; snaps to the screen edges
    hd.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest("button") || isPhone() || el.classList.contains("in-pip")) return;
      const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      hd.setPointerCapture(e.pointerId); el.classList.add("moving");
      hd.onpointermove = (m) => { el.style.left = Math.max(8 - r.width + 80, Math.min(innerWidth - 80, m.clientX - dx)) + "px"; el.style.top = Math.max(0, Math.min(innerHeight - 44, m.clientY - dy)) + "px"; };
      hd.onpointerup = hd.onpointercancel = () => {
        hd.onpointermove = hd.onpointerup = hd.onpointercancel = null; el.classList.remove("moving");
        const b = el.getBoundingClientRect(); let x = b.left, y = b.top;
        if (x < 28) x = 8; if (innerWidth - b.right < 28) x = innerWidth - b.width - 8; if (y < 28) y = 8; if (b.bottom <= innerHeight && innerHeight - b.bottom < 28 && !isMin(k)) y = innerHeight - b.height - 8;
        G[k] = { ...(G[k] || {}), ...geo(k), x: Math.round(x), y: Math.round(y) }; saveG(); place(k);
      };
    });
    // resize from the corner
    const rz = $(".hpp-rz", el);
    rz.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return; e.preventDefault(); e.stopPropagation();
      const r = el.getBoundingClientRect(), sx = e.clientX, sy = e.clientY; rz.setPointerCapture(e.pointerId); el.classList.add("moving");
      rz.onpointermove = (m) => { el.style.setProperty("--w", Math.max(KINDS[k].minW, Math.min(innerWidth - r.left - 8, r.width + m.clientX - sx)) + "px"); el.style.setProperty("--h", Math.max(KINDS[k].minH, Math.min(innerHeight - r.top - 8, r.height + m.clientY - sy)) + "px"); };
      rz.onpointerup = rz.onpointercancel = () => { rz.onpointermove = rz.onpointerup = rz.onpointercancel = null; el.classList.remove("moving"); const b = el.getBoundingClientRect(); G[k] = { ...(G[k] || {}), x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) }; saveG(); };
    });
    document.body.append(el);
    return w;
  }

  /* ---------- open, close, move between panel and window ---------- */
  const NEEDS = { script: "scripts", quote: "quoter", live: "dialer" };
  function open(k, opts = {}) {
    if (!KINDS[k]) return null;
    if (window.hpTeam?.can?.(NEEDS[k]) === false) { if (!opts.restore) window.hpTeam.upgrade(NEEDS[k]); return null; } // not in this plan
    const fl = floating(k);
    let w = W.get(k);
    if (w && w.docked === fl) { drop(k); w = null; } // it's moving between the panel and a window
    if (!w) { w = fl ? buildWin(k) : buildPane(k); W.set(k, w); if (fl) place(k); }
    if (opts.tab && k === "script") { w.st.tab = opts.tab; w.st.keepTab = true; w.st.sig = ""; }
    if (fl) { minimize(k, opts.restore ? !!G[k]?.min : false, true); front(k); switcher(); }
    else { stack(); if (!opts.restore) { w.el.classList.remove("hpp-flash"); void w.el.offsetWidth; w.el.classList.add("hpp-flash"); } }
    G[k] = { ...(G[k] || {}), open: true }; saveG();
    paint(k, true); syncPressed();
    if (pip?.k === k) try { pip.win.focus(); } catch {}
    return w;
  }
  function drop(k) { // take a tool off the screen, wherever it is
    const w = W.get(k); if (!w) return;
    if (pip?.k === k) unpip(); // closes the on-top window too
    w.el.remove(); W.delete(k); w.built = false;
    if (w.docked) stack();
  }
  function close(k) {
    if (!W.has(k)) return;
    drop(k);
    G[k] = { ...(G[k] || {}), open: false }; saveG();
    const fk = frontKind(); if (fk) front(fk);
    switcher(); syncPressed();
  }
  function setMode(k, mode) {
    G[k] = { ...(G[k] || {}), mode }; saveG();
    if (W.has(k)) open(k);
    if (mode === "float" && !isPhone()) toast(`${KINDS[k].title} is in its own window. Use the panel button in its title bar to put it back.`);
  }
  function minimize(k, on, quiet) {
    const w = W.get(k); if (!w || w.docked) return;
    w.el.classList.toggle("min", !!on);
    const b = $('[data-a="min"]', w.el); b.innerHTML = on ? IC.max : IC.min; b.title = on ? "Open" : "Tuck away"; b.setAttribute("aria-label", b.title);
    G[k] = { ...(G[k] || {}), min: !!on }; saveG();
    if (!on) paint(k, true);
    if (!quiet) syncPressed();
  }
  // a launcher: show the tool, or hide it when it's already showing (a window behind others comes forward first)
  function toggle(k) {
    if (!KINDS[k]) return;
    const w = W.get(k);
    if (w?.docked) return close(k);
    if (w && !isMin(k) && (frontKind() === k || pip?.k === k)) return close(k);
    open(k);
  }
  // phones: one sheet at a time, with buttons to switch to the others
  function switcher() {
    wins().forEach((w) => {
      const s = $(".hpp-switch", w.el); if (!s) return;
      s.innerHTML = ORDER.filter((k) => k !== w.k && W.has(k)).map((k) => `<button type="button" class="hpp-hb" data-swap="${k}" title="${KINDS[k].title}" aria-label="Show the ${KINDS[k].title.toLowerCase()}">${IC[k]}</button>`).join("");
      $$("[data-swap]", s).forEach((b) => (b.onclick = () => { minimize(b.dataset.swap, false); front(b.dataset.swap); }));
    });
  }
  function syncPressed() {
    const docs = [document, pip?.win?.document].filter(Boolean);
    docs.forEach((d) => $$("[data-pop]", d).forEach((b) => b.setAttribute("aria-pressed", String(isOpen(b.dataset.pop) && !isMin(b.dataset.pop)))));
  }
  addEventListener("resize", () => {
    ORDER.forEach((k) => { const w = W.get(k); if (w && w.docked === floating(k)) open(k, { restore: true }); }); // crossed the phone size: move between panel and sheet
    ORDER.forEach(place); layout();
  });

  /* keep one window on top of other apps: Document Picture-in-Picture (Chrome and Edge 116+) */
  async function toPip(k) {
    const w = W.get(k); if (!w || w.docked || !PIP_OK) return;
    if (pip) unpip();
    const r = w.el.getBoundingClientRect();
    let win;
    try { win = await window.documentPictureInPicture.requestWindow({ width: Math.round(Math.max(320, r.width)), height: Math.round(Math.max(360, isMin(k) ? KINDS[k].h : r.height)) }); }
    catch (e) { toast("Your browser didn't open the on-top window. Try Chrome or Edge."); return; }
    const d = win.document;
    const css = [];
    for (const s of document.styleSheets) {
      try { css.push([...s.cssRules].map((x) => x.cssText).join("\n")); } // already in the current look's colors
      catch { if (s.href) { const l = d.createElement("link"); l.rel = "stylesheet"; l.href = s.href; d.head.append(l); } }
    }
    const st = d.createElement("style"); st.textContent = css.join("\n"); d.head.append(st);
    d.documentElement.className = HTML.className;
    const rs = HTML.getAttribute("style"); if (rs) d.documentElement.setAttribute("style", rs);
    d.body.className = "hpp-pipbody"; d.title = "Highpoint · " + KINDS[k].title;
    w.el.classList.remove("min"); w.el.classList.add("in-pip");
    d.body.append(w.el);
    pip = { k, win }; pipOpen = true;
    const pb = $('[data-a="pip"]', w.el); if (pb) { pb.innerHTML = IC.back; pb.title = "Put it back on the page"; pb.setAttribute("aria-label", pb.title); }
    d.addEventListener("click", popClick); d.addEventListener("keydown", hotkeys);
    win.addEventListener("pagehide", () => { if (pip?.win === win) unpip(true); }, { once: true });
    paint(k, true); syncPressed();
  }
  function unpip(closed) {
    if (!pip) return;
    const { k, win } = pip; pip = null; pipOpen = false;
    const w = W.get(k);
    if (w) {
      w.el.classList.remove("in-pip"); document.body.append(w.el); place(k);
      const pb = $('[data-a="pip"]', w.el); if (pb) { pb.innerHTML = IC.pip; pb.title = "Keep on top of your other windows"; pb.setAttribute("aria-label", pb.title); }
      paint(k, true);
    }
    if (!closed) try { win.close(); } catch {}
    syncPressed();
  }

  /* ================= what's happening on the call ================= */
  const CALL = { live: false, t0: 0, leadId: null, txLead: null, lines: [], partial: [], endedAt: 0 };
  const lead = (id) => (id ? D()?.leads?.get(id) || null : null);
  const fullName = (l) => (l ? D().fullName(l) : "");
  const liveId = () => DL()?.liveLead || null;
  const ctxId = () => liveId() || DL()?.profileId || null;
  const session = (id) => { try { return CO()?.session(id) || null; } catch { return null; } };
  const heardF = (id) => { if (!id) return {}; const from = window.hpCopilot?.fields?.(id); if (from && Object.keys(from).length) return from; const s = session(id); return s && s.leadId === id && s.consent === "agreed" && s.ex ? s.ex.F : {}; };
  const prodOf = (l) => (["FE", "MP", "IUL"].includes(l?.product) ? l.product : "FE");
  const clock = () => { const s = Math.max(0, Math.round((Date.now() - CALL.t0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  /* ================= script ================= */
  const STATE_NAMES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "D.C.", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };
  const SRC = { lead: "From the client's file", call: "Heard on this call", quote: "From the quoter", you: "Your name" };
  const SENSITIVE = /^(routing number|account number|bank)$/i;
  const fmtDob = (s) => { if (!s) return ""; const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[2]}/${m[3]}/${m[1]}` : String(s); };
  const TABS = [["FE", "Final expense", "FE"], ["MP", "Mortgage", "MP"], ["IUL", "IUL", "IUL"]];
  const lbl = (t, sh) => (sh && sh !== t ? `<span class="l">${t}</span><span class="s">${sh}</span>` : t); // short label when the tool is narrow
  const QTAB = { FE: "FE", MP: "TERM", IUL: "IUL" };
  // objections the copilot recognizes -> the matching answer in a script
  const OBJ_RE = { price: /afford|expensive|price|budget/i, family: /spouse|family|talk (?:it )?over|wife|husband/i, think: /think about/i, covered: /already have|through work|bank already|already covered/i, trust: /scam|legit|trust/i, mail: /mail/i, ni: /not interested/i };

  // the quoter's numbers for the script's price lines, priced in the product the script is for
  function pitch(tab, l) {
    const q = QT(); if (!q) return null;
    if (l && QF.lead !== l.id) return null; // the quoter is on someone else: leave the price lines blank
    const Q = q.Q, was = Q.tab; Q.tab = QTAB[tab];
    try {
      const r = q.result(), best = r.rows.find((x) => x.price != null); if (!best) return null;
      if (r.T === "FE") {
        const face = r.B ? best.price : r.amt; if (!face) return null;
        let faces = [face - 5000, face, face + 5000]; if (faces[0] < 5000) faces = [face, face + 5000, face + 10000];
        const prem = faces.map((a) => q.priceAt(best.n, a));
        return { carrier: best.n, sub: best.sub, faces, prem, face, premium: q.priceAt(best.n, face) };
      }
      return { carrier: best.n, sub: best.sub, face: r.amt, premium: best.price, plan: r.T === "TERM" ? `${Q.TERM.term}-year term` : { protection: "protection", balanced: "balanced", cash: "cash value" }[Q.IUL.focus] + " design" };
    } catch { return null; } finally { Q.tab = was; }
  }
  function fills(l, tab) {
    const f = {}, set = (k, v, src) => { if (v != null && String(v).trim() !== "") f[k] = { v: String(v).trim(), src }; };
    if (l) { set("name", l.first, "lead"); set("first", l.first, "lead"); set("address", l.address, "lead"); set("dob", fmtDob(l.dob), "lead"); set("state", STATE_NAMES[up(l.state)] || l.state, "lead"); }
    set("agent", String(window.hpUser?.name || "").split(" ")[0], "you");
    const H = heardF(l?.id), fl = l?.fields || {};
    set("beneficiary", H.beneficiary?.value || fl.Beneficiary, H.beneficiary ? "call" : "lead");
    set("start_date", String(H.draft?.value || fl["Draft date"] || "").replace(/^Around /, "").replace(/\s*\(Social Security\)/, ""), H.draft ? "call" : "lead");
    set("needs", H.concern?.value || fl["Main concern"], H.concern ? "call" : "lead");
    const p = pitch(tab, l);
    if (p) {
      set("carrier", p.carrier, "quote");
      if (p.faces) {
        p.faces.forEach((a, i) => { if (p.prem[i] != null) { set(`plan ${i + 1}`, `${usd(a)} in coverage`, "quote"); set(`premium ${i + 1}`, usd(p.prem[i], 2), "quote"); } });
        if (p.premium != null) { set("premium", usd(p.premium, 2), "quote"); set("x", usd(p.premium, 2), "quote"); set("face", usd(p.face), "quote"); }
        set("plan", p.sub, "quote");
      } else { set("face", usd(p.face), "quote"); set("premium", usd(p.premium, 2), "quote"); set("plan", p.plan, "quote"); }
    }
    return f;
  }
  function fillText(t, f) {
    return esc(t).replace(/\{([^}]+)\}/g, (m, raw) => {
      const k = raw.trim().toLowerCase();
      if (SENSITIVE.test(k)) return `<span class="hpp-gap lock" title="Never read real account numbers aloud. The client reads them from their own checkbook or banking app.">${esc(raw)}</span>`;
      const v = f[k];
      return v ? `<span class="hpp-fill" data-src="${v.src}" title="${esc(SRC[v.src] || "")}">${esc(v.v)}</span>` : `<span class="hpp-gap" title="Fill this in">${esc(raw)}</span>`;
    });
  }
  const FACT_KEYS = [[/receive this money|beneficiar/i, ["beneficiary"]], [/anything in place|coverage through work|follow you|have (?:anything|coverage)/i, ["existing"]], [/burial or cremation|leave behind/i, ["coverage", "concern"]], [/health|medication|hospital/i, ["health", "meds"]], [/monthly amount|comfortable|set aside/i, ["budget"]], [/left on the mortgage|monthly payment/i, ["mortgageBalance", "mortgagePayment"]], [/saving toward|retirement|goal/i, ["goal"]]];
  function factValue(text, l) {
    const hit = FACT_KEYS.find(([re]) => re.test(text)); if (!hit) return "";
    const H = heardF(l?.id), FL = CO()?.FIELDS || {};
    return hit[1].map((k) => { const v = H[k]?.value ?? (FL[k]?.core ? l?.[FL[k].core] : l?.fields?.[FL[k]?.label]); return v == null || v === "" ? "" : FL[k]?.num ? usd(+v) : String(v); }).filter(Boolean).join(" · ");
  }

  const SCRIPT = {
    build(w) {
      follow();
      const st = w.st; st.fs = lsGet("hp.pop.fs", 0); st.follow = lsGet("hp.pop.follow", true); st.openSt = st.openSt || new Set([0]); st.userAt = 0;
      w.body.innerHTML = `<div class="hpp-bar"><div class="hpp-seg sm" role="group" aria-label="Product">${TABS.map(([k, t, sh]) => `<button type="button" data-tab="${k}" title="${t}">${lbl(t, sh)}</button>`).join("")}</div><span class="hpp-sp"></span>
        <span data-r="follow"></span><span class="hpp-sizes" role="group" aria-label="Text size"><button type="button" class="hpp-tb" data-fs="-1" aria-label="Smaller text" title="Smaller text">A−</button><button type="button" class="hpp-tb" data-fs="1" aria-label="Bigger text" title="Bigger text">A+</button></span></div>
        <div class="hpp-note" data-r="for"></div><div class="hpp-alerts" data-r="alerts"></div><div class="hpp-prog" data-r="prog"></div>
        <div class="hpp-scroll hpp-script" data-r="scroll"></div>`;
      const sc = $('[data-r="scroll"]', w.body);
      sc.addEventListener("scroll", () => { if (!st.auto) st.userAt = Date.now(); }, { passive: true });
      w.body.addEventListener("click", (e) => {
        const t = e.target.closest("[data-tab],[data-fs],[data-st-h],[data-seg],[data-follow],[data-find]"); if (!t) return;
        if (t.dataset.tab) { st.tab = t.dataset.tab; st.sig = ""; }
        else if (t.dataset.fs) { st.fs = Math.max(-1, Math.min(3, st.fs + +t.dataset.fs)); lsSet("hp.pop.fs", st.fs); }
        else if (t.dataset.stH != null) { const i = +t.dataset.stH; st.openSt.has(i) ? st.openSt.delete(i) : st.openSt.add(i); t.closest(".hpp-st").classList.toggle("open"); t.setAttribute("aria-expanded", st.openSt.has(i)); return; }
        else if (t.dataset.seg != null) { const i = +t.dataset.seg; st.openSt.add(i); const s = $(`.hpp-st[data-st="${i}"]`, sc); if (s) { s.classList.add("open"); st.userAt = Date.now(); s.scrollIntoView({ block: "start", behavior: "smooth" }); } return; }
        else if (t.dataset.follow != null) { st.follow = !st.follow; lsSet("hp.pop.follow", st.follow); }
        else if (t.dataset.find) { const o = $(`[data-obj-k="${t.dataset.find}"]`, sc); if (o) { const s = o.closest(".hpp-st"); if (s) { s.classList.add("open"); st.openSt.add(+s.dataset.st); } st.userAt = Date.now(); o.scrollIntoView({ block: "center", behavior: "smooth" }); o.classList.add("hot"); } return; }
        SCRIPT.update(w);
      });
    },
    update(w) {
      const st = w.st, l = lead(ctxId());
      if ((l?.id || null) !== st.leadSeen) { st.leadSeen = l?.id || null; if (!st.keepTab) st.tab = null; st.keepTab = false; st.sig = ""; st.lastAt = null; }
      const tab = st.tab || prodOf(l), live = !!l && CALL.live && liveId() === l.id;
      w.el.style.setProperty("--fs", String(st.fs));
      $$("[data-tab]", w.body).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === tab)));
      $(".hpp-sub", w.el).textContent = l ? fullName(l) : "";
      const useFex = tab === "FE" && window.HP_FEX && window.HP_FEX_TRACK;
      $('[data-r="for"]', w.body).innerHTML = l ? "" : `No client open. Blanks stay as <span class="hpp-gap">placeholders</span>.`;
      $('[data-r="follow"]', w.body).innerHTML = useFex && l ? `<button type="button" class="hpp-chk" data-follow aria-pressed="${st.follow}" title="Highlights the line you just read and the next one, from the live transcript">Follow</button>` : "";
      // objection and wording alerts from the copilot
      const ses = session(l?.id), ex = ses?.consent === "agreed" ? ses.ex : null, n = ses?.lines?.length || 0;
      let al = "";
      const o = ex?.objs?.[ex.objs.length - 1];
      if (o && n - o.line <= 6) al += `<div class="hpp-alert"><b>Objection · ${esc(o.label)}</b><ul>${o.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>${OBJ_RE[o.id] ? `<button type="button" class="hpp-mini" data-find="${o.id}">Find it in the script</button>` : ""}</div>`;
      const fl = ex?.flags?.[ex.flags.length - 1];
      if (fl && n - fl.line <= 6) al += `<div class="hpp-alert bad"><b>Check this wording · ${esc(fl.label)}</b>${esc(fl.tip)}</div>`;
      $('[data-r="alerts"]', w.body).innerHTML = al;
      // the script itself; rebuilt only when the tab, the client or a filled-in value changes
      const f = fills(l, tab), sc = $('[data-r="scroll"]', w.body);
      const heardSig = tab === "FE" ? "" : JSON.stringify(heardF(l?.id));
      const sig = tab + "|" + (l?.id || "") + "|" + JSON.stringify(f) + "|" + heardSig;
      if (sig !== st.sig) {
        st.sig = sig; const keep = sc.scrollTop;
        sc.innerHTML = useFex ? fexHTML(f, st) : libHTML(tab, f, l);
        sc.scrollTop = keep; st.lastAt = null;
      }
      // where the call is in the script
      const prog = $('[data-r="prog"]', w.body);
      if (useFex) {
        const S = window.HP_FEX.stages;
        const track = st.follow && live && CALL.txLead === l.id && ses?.consent !== "declined" && CALL.lines.length ? window.HP_FEX_TRACK.track(CALL.lines, S) : null;
        const now = track ? (track.next ? track.next.stage : track.stage) : -1;
        prog.innerHTML = `<div class="hpp-segs" style="grid-template-columns:repeat(${S.length},1fr)">${S.map((s, i) => `<button type="button" data-seg="${i}" class="${track && i < now ? "done" : i === now ? "now" : ""}" title="${esc(s.title)}" aria-label="Go to ${esc(s.title)}"></button>`).join("")}</div>
          <span>${track ? (track.done ? "Script complete" : track.stage < 0 ? "Listening for the intro…" : `Stage ${track.stage + 1} of ${S.length} · ${esc(track.title)}`) : live && st.follow ? "Listening for the intro…" : "Tap a stage to jump to it"}</span>`;
        $$(".hpp-say", sc).forEach((p) => { const i = +p.dataset.say; p.classList.toggle("said", !!track && i <= track.at); p.classList.toggle("next", !!track && !track.done && i === track.at + 1); });
        if (track && track.at !== st.lastAt) {
          st.lastAt = track.at;
          const nx = $(".hpp-say.next", sc) || $(`.hpp-say[data-say="${track.at}"]`, sc);
          const sec = nx?.closest(".hpp-st");
          if (sec && !sec.classList.contains("open")) { sec.classList.add("open"); st.openSt.add(+sec.dataset.st); }
          if (nx && Date.now() - st.userAt > 6000) { st.auto = true; nx.scrollIntoView({ block: "center", behavior: "smooth" }); setTimeout(() => (st.auto = false), 700); }
        }
      } else prog.innerHTML = "";
      // MP / IUL: light up the objection the client just raised
      $$("[data-obj-k]", sc).forEach((x) => x.classList.toggle("hot", !!o && n - o.line <= 6 && x.dataset.objK === o.id));
    },
  };
  function objKey(text) { return Object.keys(OBJ_RE).find((k) => OBJ_RE[k].test(text)) || ""; }
  function fexHTML(f, st) {
    let gi = 0;
    return window.HP_FEX.stages.map((s, si) => {
      const open = st.openSt.has(si), says = s.items.filter((x) => x.k === "say").length;
      const body = s.items.map((it) => it.k === "h" ? `<h4 class="hpp-h4">${esc(it.x)}</h4>` : it.k === "note" ? `<p class="hpp-note">${esc(it.x)}</p>` : it.k === "obj" ? `<p class="hpp-obj" data-obj-k="${objKey(it.x)}">${esc(it.x)}</p>` : `<p class="hpp-say" data-say="${gi++}">${fillText(it.x, f)}</p>`).join("");
      return `<section class="hpp-st${open ? " open" : ""}" data-st="${si}"><button type="button" class="hpp-st-h" data-st-h="${si}" aria-expanded="${open}"><span class="n">${si + 1}</span><span class="t">${esc(s.title)}</span><em>${says} lines</em></button><div class="hpp-st-b">${body}</div></section>`;
    }).join("");
  }
  function libHTML(tab, f, l) {
    const s = window.HP_SCRIPTS?.[tab]; if (!s) return `<p class="hpp-empty">This script isn't loaded yet.</p>`;
    return `<section class="hpp-sec"><h4 class="hpp-h4">Opener</h4><p class="hpp-say">${fillText(s.open, f)}</p></section>
      <section class="hpp-sec"><h4 class="hpp-h4">Fact finder</h4><ul class="hpp-facts">${s.facts.map((q) => { const v = factValue(q, l); return `<li class="${v ? "ok" : ""}"><span>${esc(q)}</span>${v ? `<b title="Heard on the call or on file">✓ ${esc(v)}</b>` : ""}</li>`; }).join("")}</ul></section>
      <section class="hpp-sec"><h4 class="hpp-h4">Objections</h4>${s.obj.map(([q, a]) => `<div class="hpp-objq" data-obj-k="${objKey(q)}"><b>“${esc(q)}”</b><span>${esc(a)}</span></div>`).join("")}</section>
      <section class="hpp-sec"><h4 class="hpp-h4">Close</h4><p class="hpp-say">${fillText(s.close, f)}</p></section>`;
  }

  /* ================= quote ================= */
  const CMAP = [[/^high blood pressure/i, "hbp"], [/^type 1 diabetes/i, "dmi"], [/^(?:type 2 )?diabetes/i, "dm"], [/^copd/i, "copd"], [/^heart attack/i, "mi"], [/^congestive heart failure/i, "chf"], [/^stroke/i, "stroke"], [/^cancer/i, "cancerPast"], [/^kidney/i, "ckd"], [/^on oxygen/i, "o2"], [/^high cholesterol/i, "chol"], [/^asthma/i, "asthma"], [/^afib/i, "afib"], [/^sleep apnea/i, "apnea"], [/^depression/i, "depression"], [/^dementia/i, "dementia"], [/^hepatitis/i, "hepc"], [/^heart stent/i, "cad"], [/^neuropathy/i, "dmc"]];
  const WHEN = [["", "When?"], [0.5, "In the last year"], [1.5, "1–2 years ago"], [2.5, "2–3 years ago"], [4, "3–5 years ago"], [7, "5+ years ago"]];
  const YR = 365.25 * 864e5;
  const bucket = (at) => { if (!at) return ""; const y = (Date.now() - at) / YR; return y < 1 ? 0.5 : y < 2 ? 1.5 : y < 3 ? 2.5 : y < 5 ? 4 : 7; };
  const money = (s) => { const m = String(s ?? "").replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(k|thousand)?/i); return m ? Math.round(+m[1] * (m[2] ? 1000 : 1)) : null; };
  const snapQ = () => { const Q = QT().Q; return JSON.parse(JSON.stringify({ tab: Q.tab, age: Q.age, sex: Q.sex, tob: Q.tob, state: Q.state, cls: Q.cls, FE: Q.FE, TERM: Q.TERM, IUL: Q.IUL })); };
  function loadQ(s) {
    const Q = QT().Q;
    for (const k of ["tab", "age", "sex", "tob", "state", "cls"]) if (s[k] != null) Q[k] = s[k];
    for (const k of ["FE", "TERM", "IUL"]) if (s[k]) { for (const kk of Object.keys(Q[k])) delete Q[k][kk]; Object.assign(Q[k], JSON.parse(JSON.stringify(s[k]))); }
  }
  const sexOf = (l) => { const v = String(l?.sex || l?.gender || l?.fields?.Gender || l?.fields?.Sex || ""); return /^f/i.test(v) ? "F" : /^m/i.test(v) ? "M" : ""; };
  const dobParts = (s) => { const t = String(s || ""); let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return { m: m[2].padStart(2, "0"), d: m[3].padStart(2, "0"), y: m[1] }; m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? { m: m[1].padStart(2, "0"), d: m[2].padStart(2, "0"), y: m[3] } : null; };
  const ageOf = (l) => { if (+l?.age) return +l.age; const p = dobParts(l?.dob); if (!p) return null; const b = new Date(+p.y, +p.m - 1, +p.d), n = new Date(); let a = n.getFullYear() - b.getFullYear(); if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) a--; return a > 0 && a < 120 ? a : null; };

  /* What the client said (or what's on file), turned into quoter changes. Each change remembers how to undo itself. */
  function items(F) {
    const q = QT(), Q = q.Q, out = [], add = (key, label, apply) => out.push({ key, label, apply });
    const v = (k) => F[k]?.value, ln = (k) => F[k]?.line ?? -1;
    if (v("age") != null && +v("age") >= 18 && +v("age") <= 99) add("age=" + v("age"), `Age ${v("age")}`, () => { const was = { age: Q.age, dob: { ...Q.FE.dob } }; Q.age = +v("age"); if (q.age() !== Q.age) Q.FE.dob = { m: "", d: "", y: "" }; return () => { Q.age = was.age; Q.FE.dob = was.dob; }; });
    const dp = dobParts(v("dob"));
    if (dp) add("dob=" + v("dob"), `Born ${v("dob")}`, () => { const was = { age: Q.age, dob: { ...Q.FE.dob } }; Q.FE.dob = dp; Q.age = q.age() || Q.age; return () => { Q.age = was.age; Q.FE.dob = was.dob; }; });
    if (v("tobacco")) { const yes = /^yes/i.test(v("tobacco")); add("tob=" + yes, yes ? "Uses tobacco" : "No tobacco", () => { const was = { tob: Q.tob, nic: Q.FE.nic }; Q.tob = yes ? "1" : "0"; Q.FE.nic = yes ? (q.NIC[Q.FE.nic]?.[1] ? Q.FE.nic : "cig") : "none"; return () => { Q.tob = was.tob; Q.FE.nic = was.nic; }; }); }
    if (v("health") && v("health") !== "None reported") {
      const parts = String(v("health")).split(/;\s*/), dia = parts.some((p) => /diabet/i.test(p));
      for (const p of parts) {
        const hit = CMAP.find(([re]) => re.test(p)); if (!hit || (hit[1] === "dmc" && !dia)) continue;
        const yr = p.match(/since (\d{4})/i), it = condItem(hit[1], yr ? +new Date(+yr[1], 6, 1) : null, undefined, p);
        if (it) out.push(it);
      }
    }
    if (v("meds") && v("meds") !== "None") {
      const names = Object.keys(q.MEDS);
      for (const m of String(v("meds")).split(/,\s*/)) {
        const nm = names.find((x) => x.toLowerCase() === m.toLowerCase()) || medVocab().names.get(m.toLowerCase().replace(/-/g, " ")) || m.replace(/^./, (c) => c.toUpperCase());
        out.push(medItem(nm));
      }
    }
    const hw = String(v("hw") || ""), ht = hw.match(/(\d)'(\d+)"/), wt = hw.match(/(\d+) lbs/);
    if (ht || wt) add("hw=" + hw, hw, () => { const was = { ft: Q.FE.ft, inch: Q.FE.inch, lb: Q.FE.lb }; if (ht) { Q.FE.ft = ht[1]; Q.FE.inch = ht[2]; } if (wt) Q.FE.lb = wt[1]; return () => Object.assign(Q.FE, was); });
    const cov = money(v("coverage")), bud = money(v("budget"));
    if (cov) add("cov=" + cov, `${usd(cov)} coverage`, () => {
      const T = Q.tab === "FE" ? "FE" : Q.tab, was = { mode: Q.FE.mode, amt: Q[T].amt };
      Q[T].amt = T === "FE" ? Math.min(50000, Math.max(5000, Math.round(cov / 5000) * 5000)) : Math.max(50000, Math.round(cov / 5000) * 5000);
      if (T === "FE" && ln("coverage") >= ln("budget")) Q.FE.mode = "face";
      return () => { Q.FE.mode = was.mode; Q[T].amt = was.amt; };
    });
    if (bud && Q.tab === "FE") add("bud=" + bud, `${usd(bud)}/mo budget`, () => { const was = { mode: Q.FE.mode, budget: Q.FE.budget }; Q.FE.budget = Math.min(500, Math.max(50, Math.floor(bud / 50) * 50)); if (ln("budget") > ln("coverage")) Q.FE.mode = "budget"; return () => Object.assign(Q.FE, was); });
    const bal = +v("mortgageBalance");
    if (bal > 0 && Q.tab === "TERM") add("bal=" + bal, `Mortgage ${usd(bal)}`, () => { const was = Q.TERM.amt; Q.TERM.amt = Math.max(50000, Math.ceil(bal / 5000) * 5000); return () => { Q.TERM.amt = was; }; });
    return out;
  }
  /* ---------- health heard on the call ----------
     Two listeners, both only after the client agrees to recording, both only on what the CLIENT says about themselves:
     1. Word lists (instant, offline): the ways people say each condition, and every medication the quoter knows
        (its own list plus Aetna Accendo's drug list). Skips "no ...", "never had ...", "used to take ...", and
        anything about a family member. Picks up when ("since 2015", "two years ago", "last year").
     2. Highpoint Bot reads the conversation for what the lists miss (how people really talk, misspelled drugs).
     Everything lands in the quoter's Health section with a tag saying where it came from, and ✕ removes it for good. */
  const SAID = [
    [/\btype\s*(?:1|one)\s*diabet\w*|\bjuvenile diabet\w*|\binsulin[- ]dependent\b/i, "dmi"],
    [/\b(?:i'?m|am|i'?ve been)\s+(?:a\s+)?diabetic\b|\b(?<!pre[- ]?)diabet(?:es|ic)\b|\bsugar diabetes\b|\bmy (?:blood )?sugar(?:'s| is)? (?:high|up|bad)\b/i, "dm"],
    [/\b(?:on|take|taking|use|using)\s+insulin\b|\binsulin shots?\b/i, "dmi"],
    [/\b(?:neuropathy|retinopathy)\b/i, "dmc"],
    [/\bhigh blood pressure\b|\bhypertension\b|\bblood pressure (?:pills?|meds?|medicine|medication)\b/i, "hbp"],
    [/\b(?:high )?cholesterol\b/i, "chol"],
    [/\bheart attacks?\b|\bmyocardial infarction\b/i, "mi"],
    [/\b[Mm]ini[- ]?[Ss]trokes?\b|\b[Tt]ransient [Ii]schemic\b|\bT\.?I\.?A\b/, "tia"],
    [/\b(?<!mini[- ]?)strokes?\b/i, "stroke"],
    [/\bstents?\b|\b(?:heart|triple|double|quadruple|coronary) bypass\b|\bhad (?:a )?bypass\b|\bangina\b|\bcoronary artery\b|\bblocked arter(?:y|ies)\b/i, "cad"],
    [/\bcongestive heart failure\b|\bheart failure\b|\bc\.?h\.?f\.?\b|\bweak heart\b/i, "chf"],
    [/\ba-?fib\b|\batrial fibrillation\b|\birregular heart ?beat\b|\barrhythmia\b/i, "afib"],
    [/\bc\.?o\.?p\.?d\.?\b|\bemphysema\b|\bchronic bronchitis\b/i, "copd"],
    [/\b(?:on|use|using|need|carry|wear)\s+(?:my\s+|an?\s+)?oxygen\b|\boxygen (?:tank|machine|concentrator)\b/i, "o2"],
    [/\basthma\b|\binhaler\b/i, "asthma"],
    [/\bsleep apnea\b|\bc-?pap\b/i, "apnea"],
    [/\bskin cancer\b|\bbasal cell\b|\bsquamous cell\b|\bmelanoma\b/i, "skin"],
    [/\bchemo(?:therapy)?\b|\bradiation (?:treatments?|therapy)\b|\b(?:have|got|fighting|battling|being treated for|treating)\s+(?:\w+\s+){0,2}cancer\b/i, "cancerNow"],
    [/\bcancer\b|\btumou?r\b|\bin remission\b|\bcancer[- ]free\b/i, "cancerPast"],
    [/\bdialysis\b/i, "dialysis"],
    [/\bkidney (?:disease|failure|problems?|issues?)\b|\bc\.?k\.?d\.?\b|\bbad kidneys\b/i, "ckd"],
    [/\bcirrhosis\b|\bliver (?:disease|failure|problems?)\b/i, "liver"],
    [/\bhep(?:atitis)?\s*c\b/i, "hepc"],
    [/\balzheimer'?s?\b|\bdementia\b/i, "dementia"],
    [/\bparkinson'?s?\b/i, "parkinsons"],
    [/\bmultiple sclerosis\b/i, "ms"],
    [/\blupus\b/i, "lupus"],
    [/\brheumatoid\b/i, "ra"],
    [/\bbi-?polar\b/i, "bipolar"],
    [/\bschizophreni\w*/i, "schizo"],
    [/\bdepress(?:ion|ed)\b|\banxiety\b|\bpanic attacks?\b/i, "depression"],
    [/\b(?:alcohol|drug|substance)\s+(?:abuse|treatment|rehab|problem)\b|\balcoholi(?:c|sm)\b|\bwent to rehab\b/i, "alcohol"],
    [/\bh\.?i\.?v\b|(?<!(?:hearing|walking|visual|study|teaching|mobility|band|first)[\s-]?)\baids\b/i, "hiv"],
    [/\b(?:kidney|liver|heart|lung|organ) transplant\b/i, "transplant"],
    [/\bamputat\w*/i, "amput"],
    [/\bwheel ?chair\b|\bmobility scooter\b|\bneed help (?:bathing|dressing|eating|getting dressed)\b/i, "wheelchair"],
    [/\b(?:hip|knee) replacement\b/i, "joint"],
    [/\b(?:hypo|hyper)?thyroid\b/i, "thyroid"],
    [/\b(?:live|living|stay|staying|i'?m|am|been) (?:in|at) (?:a |the )?nursing home\b|\b(?:in|on|under) hospice\b|\bin the hospital (?:right )?now\b/i, "nursing"],
    [/\bterminal(?:ly ill| illness| cancer| diagnosis)\b|\b(?:i'?m|am) terminal\b|\b(?:months|weeks) to live\b/i, "terminal"],
    [/\b(?:surgery|procedure|biopsy|tests?) (?:coming up|scheduled|next (?:week|month))\b|\bwaiting (?:on|for) (?:test|biopsy) results\b/i, "pending"],
  ];
  const H_FAMILY = /\b(?:my|his|her|their|our)\s+(?:\w+\s+)?(?:mother|mom|mama|father|dad|daddy|brother|sister|husband|wife|aunt|uncle|grand(?:ma|pa|mother|father)|son|daughter|sibling|cousin|friend|neighbor|parents|family|kids|children|partner|boyfriend|girlfriend|spouse)s?\b|\b(?:he|she|they)(?:'s|\s+(?:has|had|have|takes?|took|was|is|got|gets|uses?))\b/i;
  const H_NEG = /\b(?:no|not|never|nope|nah|without|don'?t|do not|haven'?t|hasn'?t|didn'?t|doesn'?t|ain'?t|negative for|free of|ruled out|none of|nothing like)\b/i;
  const H_HYPO = /\b(?:in case|if i (?:ever )?(?:get|got|had|have)|what if|worried about|afraid of|scared of|prevent|risk of|chance of|check(?:ed)? for|tested for|screen(?:ed|ing)? for)\b/i;
  const H_AFTER = /^[^.;!?]{0,30}?\b(?:runs in|in (?:my|the|our) family|on (?:my|his|her) side)\b/i;
  const H_PAST_MED = /\b(?:used to|stopped|no longer|quit|came off|off of|not on|weaned off|ran out of)\b/i;
  const H_WASPAST = /\b(?:had|did|finished|went through|was|beat|beaten|survived|survivor|remission|cancer[- ]free|all clear)\b/i;
  const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, couple: 2, few: 3, several: 4 };
  function whenSaid(t) { // -> a date, or null
    let m;
    if ((m = t.match(/\b(?:since|in|back in|around|about|of)\s+((?:19|20)\d{2})\b/i))) return +new Date(+m[1], 6, 1);
    if ((m = t.match(/\b(\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|couple|few|several)(?:\s+(?:and a half|or so))?\s+(?:of\s+)?years?\s+(?:ago|back|now)\b/i))) return Date.now() - (NUM[m[1].toLowerCase()] || +m[1]) * YR;
    if ((m = t.match(/\b(?:for|about|almost|over)\s+(\d{1,2}|a|one|two|three|four|five|six|seven|eight|nine|ten|twenty|couple|few|several)\s+(?:of\s+)?years\b/i))) return Date.now() - (NUM[m[1].toLowerCase()] || +m[1]) * YR;
    if ((m = t.match(/\b(\d{1,2}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|couple|few|several)\s+months?\s+(?:ago|back)\b/i))) return Date.now() - ((NUM[m[1].toLowerCase()] || +m[1]) / 12) * YR;
    if (/\blast year\b/i.test(t)) return Date.now() - YR;
    if (/\bthis year\b|\brecently\b|\bjust (?:had|got|found out|diagnosed)\b|\blast (?:month|week)\b/i.test(t)) return Date.now() - 0.3 * YR;
    return null;
  }
  const tcase = (x) => String(x).toLowerCase().replace(/(^|[\s\-\/(])([a-z])/g, (a, b, c) => b + c.toUpperCase());
  let MEDV = null; // every medication the quoter knows: spoken name (lower case) -> the name the quoter files it under
  function medVocab() {
    if (MEDV) return MEDV;
    const q = QT(), names = new Map(), rows = window.HP_DRUGS?.accendo?.rows || [], full = new Set(rows.map((r) => String(r[0]).toLowerCase()));
    for (const m of Object.keys(q.MEDS)) names.set(m.toLowerCase().replace(/-/g, " "), m);
    for (const r of rows) {
      const raw = String(r[0]), n = raw.split(/[(,/]/)[0].replace(/\s*-\s*/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
      if (n.length < 5 || /\d/.test(n) || n.split(" ").length > 2 || names.has(n)) continue;
      names.set(n, full.has(n) ? tcase(n) : tcase(raw)); // file it under the drug list's own name so Accendo's check still matches
    }
    MEDV = { names };
    return MEDV;
  }
  // the medications named in a bit of speech: [{ name, index }]
  function medsIn(text) {
    const V = medVocab(), toks = [...String(text).matchAll(/[a-z][a-z']*/gi)], out = [];
    for (let i = 0; i < toks.length; i++) {
      const a = toks[i][0].toLowerCase(), b = toks[i + 1]?.[0].toLowerCase();
      const two = b ? V.names.get(a + " " + b) : null, one = V.names.get(a);
      if (two) { out.push({ name: two, index: toks[i].index }); i++; } else if (one) out.push({ name: one, index: toks[i].index });
    }
    return out;
  }
  const MORE_EXACT = { dmi: "dm", cancerNow: "cancerPast" }; // diabetes on insulin replaces plain diabetes, and so on
  function condItem(k, at, src, quote) {
    const q = QT(), Q = q.Q, C = q.COND[k]; if (!C) return null;
    return { key: "cond=" + k, label: C.n.replace(/\s*\(.*\)$/, ""), src, quote, at, apply: () => {
      const cur = Q.FE.conds.find((c) => c.k === k);
      if (cur) { if (at && !cur.at) { cur.at = at; return () => { delete cur.at; }; } return () => {}; }
      const lessI = Q.FE.conds.findIndex((c) => c.k === MORE_EXACT[k]), less = lessI >= 0 ? Q.FE.conds[lessI] : null;
      const nc = { k }; if (at || less?.at) nc.at = at || less.at;
      if (less) Q.FE.conds.splice(lessI, 1, nc); else Q.FE.conds.push(nc);
      return () => { Q.FE.conds = Q.FE.conds.filter((c) => c !== nc); if (less && !Q.FE.conds.some((c) => c.k === less.k)) Q.FE.conds.push(less); };
    } };
  }
  function medItem(nm, src, quote) {
    const q = QT(), Q = q.Q, ck = q.MEDS[nm];
    return { key: "med=" + nm, label: nm, src, quote, apply: () => {
      const hadM = Q.FE.meds.includes(nm); if (!hadM) Q.FE.meds.push(nm);
      const undoC = ck ? condItem(ck, null).apply() : () => {}; // Lantus means diabetes on insulin, and so on
      return () => { if (!hadM) Q.FE.meds = Q.FE.meds.filter((x) => x !== nm); undoC(); };
    } };
  }
  // the part of a sentence a word belongs to: "No, I have high blood pressure" -> "I have"
  const clauseOf = (before) => before.split(/[;:]|,\s*(?=(?:i|i'm|i've|i'd|im|ive|my|me|he|she|they|we|but|yes|yeah|yep|well|although|though|except|also|plus|oh)\b)|\b(?:and|but|plus|also)\s+(?=(?:i|i'm|i've|im|ive|my|he|she|they|we)\b)/i).pop();
  const LINEC = new WeakMap(); // line -> what it said, so long calls don't re-read every line
  function lineHealth(ln, prev) {
    const text = ln.text || "", ptext = prev?.who === "Agent" ? prev.text || "" : "";
    const c = LINEC.get(ln); if (c && c.text === text && c.ptext === ptext) return c.res;
    const res = []; // [kind, value, at, quote]
    for (const part of text.split(/(?<=[.;!?])\s+|\s+but\s+/i)) { // one thought at a time
      const at = whenSaid(part), t = part.trim(); if (!t) continue;
      for (const [re, k] of SAID) {
        const m = re.exec(t); if (!m) continue;
        const cl = clauseOf(t.slice(0, m.index)), after = t.slice(m.index + m[0].length);
        if (H_FAMILY.test(cl) || H_NEG.test(cl.slice(-45)) || H_HYPO.test(cl) || H_AFTER.test(after)) continue;
        let kk = k;
        if (k === "cancerPast" && /\bskin cancer|basal|squamous|melanoma/i.test(t)) continue;
        if (k === "cancerNow" && (H_WASPAST.test(cl) || (at && Date.now() - at > YR))) kk = "cancerPast";
        if (k === "dm" && /type\s*(?:1|one)/i.test(t)) continue;
        res.push(["c", kk, at, t]);
      }
      for (const { name, index } of medsIn(t)) {
        const cl = clauseOf(t.slice(0, index));
        if (H_FAMILY.test(cl) || H_NEG.test(cl.slice(-35)) || H_PAST_MED.test(cl.slice(-35)) || H_HYPO.test(cl)) continue;
        res.push(["m", name, null, t]);
      }
    }
    // "Yes" to the agent's question about exactly one condition
    if (ptext && /^\s*(?:yes|yeah|yep|yup|uh[- ]?huh|mm[- ]?hmm|i do|i did|i have|i am|correct|that'?s right|sure do|right)\b/i.test(text) && /\?|\b(?:any|ever|do you|have you|are you)\b/i.test(ptext)) {
      const asked = [...new Set(SAID.filter(([re]) => re.test(ptext)).map(([, k]) => k))];
      if (asked.length === 1) res.push(["c", asked[0], whenSaid(text), ptext.trim() + " — " + text.trim()]);
    }
    LINEC.set(ln, { text, ptext, res });
    return res;
  }
  // the word-list listener: lines are the copilot's (after consent, sensitive numbers already hidden)
  function healthHeard(lines) {
    const out = new Map();
    lines.forEach((ln, i) => {
      if (ln.who !== "Lead") return;
      for (const [kind, v, at, quote] of lineHealth(ln, lines[i - 1])) {
        const it = kind === "c" ? condItem(v, at, "call", quote) : medItem(v, "call", quote);
        if (!it) continue;
        const had = out.get(it.key);
        if (!had || (at && kind === "c" && !had.at)) out.set(it.key, it); // a later mention that says when wins
      }
    });
    if (out.has("cond=dmi")) out.delete("cond=dm"); // the more specific answer wins
    if (out.has("cond=cancerNow")) out.delete("cond=cancerPast");
    return [...out.values()];
  }

  // Highpoint Bot: reads the recent conversation when the client talks about health, at most every few seconds
  const AIH = { lead: null, seen: 0, at: 0, busy: false, items: [], status: "", timer: 0, n: 0 };
  const HEALTHY = /\b(?:health\w*|doctors?|pills?|medic\w*|meds|prescri\w*|diagnos\w*|conditions?|surgery|surgeries|hospital\w*|heart|sugar|pressure|cancer|tumou?r|kidneys?|lungs?|breath\w*|insulin|oxygen|strokes?|seizures?|blood|cholesterol|thyroid|depress\w*|anxiety|arthritis|liver|dementia|alzheimer'?s?|memory|wheel ?chair|walker|cane|chemo|radiation|stents?|bypass|pacemaker|transplant|dialysis|neuropathy|rehab|inhaler|copd|emphysema|asthma|apnea|cpap|lupus|parkinson'?s?|hepatitis|hiv|amputat\w*|replacement|shots?|injections?|specialist|cardiologist|oncologist|nephrologist|pulmonologist)\b|\b\w{3,}(?:pril|sartan|olol|statin|formin|gliptin|glutide|azole|dipine|xetine|zepam|zolam|mab|nib|xaban|gatran|sone|lone|thyroxine|parin|mide|zide|pine|done|tine|pam)\b/i;
  const talksHealth = (t) => HEALTHY.test(t) || medsIn(t).length > 0;
  function aiHealth() {
    clearTimeout(AIH.timer);
    const id = QF.lead, ses = session(id); if (!id || !ses || ses.consent !== "agreed" || !QT()) return;
    if (AIH.lead !== id) Object.assign(AIH, { lead: id, seen: 0, items: [], status: "", n: 0 });
    const lines = ses.lines || [];
    const fresh = lines.slice(AIH.seen).filter((x) => x.who === "Lead");
    if (!fresh.length || !fresh.some((x) => talksHealth(x.text || ""))) return;
    if (AIH.busy || AIH.status === "off" || AIH.n >= 40) return;
    const wait = 6000 - (Date.now() - AIH.at); if (wait > 0) { AIH.timer = setTimeout(aiHealth, wait + 50); return; }
    AIH.busy = true; AIH.at = Date.now(); AIH.n++; const upto = lines.length;
    const q = QT(), keys = Object.entries(q.COND).map(([k, c]) => `${k}: ${c.n}`).join("\n");
    const tx = lines.slice(-40).map((x) => `${x.who === "Agent" ? "Agent" : "Client"}: ${x.text}`).join("\n").slice(-6000);
    const system = "You pull underwriting facts for a final expense life insurance quote out of a call transcript. Use only what the CLIENT says about THEMSELVES. Skip anything they deny, anything about family members, and anything the agent says that the client didn't confirm. Reply with JSON only.";
    const prompt = `Condition keys you may use:\n${keys}\n\nReturn {"conditions":[{"key":"<one of the keys>","years_ago":<years since diagnosed or last treated, a number, or null if not said>,"quote":"<the client's words>"}],"medications":["<each drug the client takes now, spelled correctly>"]}. Use empty arrays if nothing. Pick the most specific key (insulin -> dmi; cancer being treated now -> cancerNow). Leave out drugs they stopped taking.\n\nTranscript:\n"""${tx}"""`;
    fetch("/api/ai", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ system, messages: [{ role: "user", content: prompt }] }) })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (AIH.lead !== id) return;
        if (!ok) { AIH.status = ["unavailable", "bad_key", "no_credit", "plan", "billing"].includes(j.code) ? "off" : "err"; return; }
        const out = JSON.parse((String(j.text || "").match(/\{[\s\S]*\}/) || ["{}"])[0]);
        const V = medVocab(), got = [];
        for (const c of Array.isArray(out.conditions) ? out.conditions : []) { const y = c?.years_ago; if (q.COND[c?.key]) got.push(condItem(c.key, y != null && y !== "" && +y >= 0 ? Date.now() - +y * YR : null, "ai", c.quote ? String(c.quote).slice(0, 200) : "")); }
        for (const m of Array.isArray(out.medications) ? out.medications : []) { const n = String(m?.name ?? m ?? "").trim().replace(/\s+/g, " "); if (n.length < 3 || n.length > 40 || /[^a-z \-']/i.test(n)) continue; got.push(medItem(V.names.get(n.toLowerCase().replace(/-/g, " ")) || tcase(n), "ai")); }
        if (got.some((g) => g?.key === "cond=dmi")) { const i = got.findIndex((g) => g?.key === "cond=dm"); if (i >= 0) got.splice(i, 1); }
        AIH.items = [...AIH.items.filter((x) => !got.some((g) => g?.key === x.key)), ...got.filter(Boolean)];
        AIH.status = "ok"; AIH.seen = upto;
        fromCall(); paint("quote");
      })
      .catch(() => { AIH.status = "err"; })
      .finally(() => { AIH.busy = false; if (AIH.lead === id && (session(id)?.lines?.length || 0) > upto) AIH.timer = setTimeout(aiHealth, 1500); });
  }

  // what's already on the client's file, in the copilot's field names
  function onFile(l) {
    const fl = l?.fields || {}, F = {}, put = (k, label) => { const x = fl[label]; if (x && !/^sample-/i.test(x)) F[k] = { value: x, line: -1 }; };
    put("tobacco", "Tobacco use"); put("health", "Health conditions"); put("meds", "Medications"); put("hw", "Height / weight"); put("coverage", "Coverage wanted"); put("budget", "Monthly budget");
    if (l?.mortgageBalance) F.mortgageBalance = { value: +l.mortgageBalance, line: -1 };
    return F;
  }

  /* The quoter follows the client you're on (the call, else the open profile) while the quote or script pop-out is up,
     so the script's prices are always this client's. Each client's quote is put away and brought back as you switch. */
  const QF = { lead: null, manual: false, auto: lsGet("hp.pop.auto", true), done: {}, chips: {}, src: {}, ctx: {}, pending: [] };
  const following = () => W.has("quote") || W.has("script");
  const QUOTE = {
    build(w) {
      const st = w.st; st.more = false;
      w.body.innerHTML = `<div class="hpp-bar"><div class="hpp-seg sm" role="group" aria-label="Product">${[["FE", "Final expense", "FE"], ["TERM", "Term"], ["IUL", "IUL"]].map(([k, t, sh]) => `<button type="button" data-qtab="${k}" title="${t}">${lbl(t, sh)}</button>`).join("")}</div><span class="hpp-sp"></span><span data-r="link"></span></div>
        <div class="hpp-top" data-r="top" aria-live="polite"></div>
        <div class="hpp-scroll" data-r="scroll"><div class="hpp-heard" data-r="heard"></div>
          <section class="hpp-health" data-r="health" aria-label="Health"></section>
          <div class="hpp-form"><button type="button" class="hpp-sum" data-q="form" data-r="sum"></button><div class="hpp-fbody" data-r="form"></div></div>
          <div class="hpp-res" data-r="res"></div>
          <div class="hpp-foot"><button type="button" class="hpp-mini" data-q="full">Open the full quoter</button><span class="hpp-fine" data-r="fine"></span></div></div>`;
      const Q = () => QT().Q, done = () => { QT().changed(); QUOTE.update(w); }; // your own clicks show right away
      w.body.addEventListener("click", (e) => {
        const t = e.target.closest("button"); if (!t || !w.body.contains(t)) return;
        const d = t.dataset, q = QT(); if (!q) return;
        if (d.qtab) { Q().tab = d.qtab; Q().sort = null; done(); }
        else if (d.sex) { Q().sex = d.sex; done(); }
        else if (d.tob) { Q().tob = d.tob; Q().FE.nic = d.tob === "1" ? (q.NIC[Q().FE.nic]?.[1] ? Q().FE.nic : "cig") : "none"; done(); }
        else if (d.mode) { Q().FE.mode = d.mode; done(); }
        else if (d.step) { const r = q.result(), cur = Q()[r.T][r.K]; Q()[r.T][r.K] = Math.max(r.min, Math.min(r.max, cur + +d.step * r.step)); done(); }
        else if (d.amt) { const r = q.result(); Q()[r.T][r.K] = +d.amt; done(); }
        else if (d.plan) q.setPlan(d.plan);
        else if (d.rmC != null) { const c = Q().FE.conds[+d.rmC]; if (c) { Q().FE.conds.splice(+d.rmC, 1); forget("cond=" + c.k); } done(); }
        else if (d.rmM != null) { const m = Q().FE.meds[+d.rmM]; if (m) { Q().FE.meds.splice(+d.rmM, 1); forget("med=" + m); } done(); }
        else if (d.pick) { pickHealth(d.pick); done(); const a = $('[data-f="add"]', w.body); if (a) { a.value = ""; a.focus(); } const sg = $(".hpp-sug", w.body); if (sg) sg.hidden = true; }
        else if (d.useK) { const it = QF.pending.find((p) => p.key === d.useK); if (it) { applyItems([it], "call"); QUOTE.update(w); } }
        else if (d.undo != null) { const c = (QF.chips[QF.lead] || [])[+d.undo]; if (c && !c.undone) { c.undo(); c.undone = true; done(); } }
        else if (d.use != null) { const it = QF.pending[+d.use]; if (it) applyItems([it], "call"); }
        else if (d.useAll != null) applyItems(QF.pending, "call");
        else if (d.q === "auto") { QF.auto = !QF.auto; lsSet("hp.pop.auto", QF.auto); if (QF.auto) fromCall(); QUOTE.update(w); }
        else if (d.q === "bind") { bind(ctxId(), true); }
        else if (d.q === "unbind") { if (QF.lead) QF.ctx[QF.lead] = snapQ(); QF.lead = null; QF.manual = true; QUOTE.update(w); paint("script"); }
        else if (d.q === "more") { st.more = !st.more; QUOTE.update(w); }
        else if (d.q === "full") q.open();
        else if (d.q === "form") { st.formOpen = !(st.formOpen ?? !QF.lead); QUOTE.update(w); if (st.formOpen) $('[data-r="form"] input, [data-r="form"] button', w.body)?.focus(); }
        else if (d.q === "copy") { const b = st.best; if (b) copy(b.text); }
        else if (d.q === "crm") { const b = st.best, id = QF.lead || ctxId(); if (b && id) q.attach(id, b.q); else toast("Open a client first, then add the quote"); }
      });
      w.body.addEventListener("change", (e) => {
        const t = e.target, f = t.dataset.f, q = QT(); if (!q) return;
        if (f === "age") { const a = Math.min(90, Math.max(18, Math.round(+t.value) || Q().age)); Q().age = a; if (q.age() !== a) Q().FE.dob = { m: "", d: "", y: "" }; done(); }
        else if (f === "state") { Q().state = t.value; done(); }
        else if (f === "cls") { Q().cls = t.value; done(); }
        else if (f === "amt") { const r = q.result(), n = money(t.value); if (n) { Q()[r.T][r.K] = Math.max(r.min, Math.min(r.max, r.B ? Math.floor(n / r.step) * r.step : Math.round(n / r.step) * r.step)); } done(); }
        else if (t.dataset.when != null) { const c = Q().FE.conds[+t.dataset.when]; if (c) { if (t.value) c.at = Date.now() - +t.value * YR; else delete c.at; done(); } }
      });
      const add = () => $('[data-f="add"]', w.body);
      w.body.addEventListener("input", (e) => { if (e.target.dataset.f === "add") suggest(w); });
      w.body.addEventListener("keydown", (e) => {
        if (e.target.dataset.f === "add" && e.key === "Enter") { e.preventDefault(); const b = $(".hpp-sug [data-pick]", w.body); if (b) b.click(); }
        if (e.target.dataset.f === "add" && e.key === "Escape") { add().value = ""; $(".hpp-sug", w.body).hidden = true; }
        if (e.target.dataset.f === "amt" && e.key === "Enter") e.target.blur();
        if (e.target.dataset.f === "age" && e.key === "Enter") e.target.blur();
      });
      w.body.addEventListener("pointerdown", (e) => { if (e.target.closest(".hpp-sug button")) e.preventDefault(); });
      w.body.addEventListener("focusout", (e) => { if (e.target.dataset?.f === "add") setTimeout(() => { const s = $(".hpp-sug", w.body); if (s) s.hidden = true; }, 150); });
      follow();
    },
    update(w) {
      const q = QT(), st = w.st; if (!q) { w.body.innerHTML = `<p class="hpp-empty">The quoter is still loading…</p>`; w.built = false; return; }
      const Q = q.Q, r = q.result(), l = lead(QF.lead), live = !!l && CALL.live && liveId() === l.id;
      $$("[data-qtab]", w.body).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.qtab === r.T)));
      $(".hpp-sub", w.el).textContent = l ? fullName(l) : "";
      const cid = ctxId(), cl = lead(cid);
      $('[data-r="link"]', w.body).innerHTML = l
        ? `<button type="button" class="hpp-mini" data-q="unbind" title="Stop following ${esc(fullName(l))} and quote freely">Unlink</button>`
        : cl ? `<button type="button" class="hpp-mini" data-q="bind" title="Quote with ${esc(fullName(cl))}'s details">Use ${esc(cl.first || fullName(cl))}</button>` : `<span class="hpp-fine">No client</span>`;
      // client details: a one-line summary; tap it to edit (open by default when you're quoting without a client)
      const fopen = st.formOpen ?? !QF.lead, FE = r.T === "FE", tob = FE ? !!q.NIC[Q.FE.nic]?.[1] : Q.tob === "1";
      const planName = (r.plans.find(([v]) => String(v) === String(r.plan)) || [])[1] || "";
      const sumEl = $('[data-r="sum"]', w.body);
      sumEl.setAttribute("aria-expanded", String(fopen));
      sumEl.innerHTML = `<span>${[Q.age, Q.sex === "F" ? "Female" : "Male", tob ? "Tobacco" : "No tobacco", Q.state, r.B ? usd(r.amt) + "/mo" : usd(r.amt), planName].filter(Boolean).map(esc).join(" · ")}</span><em>${fopen ? "Done" : "Edit"}</em>`;
      $('[data-r="form"]', w.body).hidden = !fopen;
      // the form: rebuilt when values change, unless you're typing in it
      const form = $('[data-r="form"]', w.body), doc = w.el.ownerDocument, ae = doc.activeElement, inForm = form.contains(ae);
      const sig = JSON.stringify([r.T, r.B, r.amt, r.plan, Q.age, Q.sex, Q.tob, Q.state, Q.cls, Q.FE.conds, Q.FE.meds, Q.FE.nic]);
      const editing = inForm && ae.matches('input[data-f="age"],input[data-f="amt"]') && ae.value !== ae.defaultValue; // never wipe what you're typing
      if (sig !== st.fsig && !editing) {
        const keepAdd = inForm && ae.dataset.f === "add" ? ae.value : null, keepSel = inForm && ae.matches("select") ? (ae.dataset.f ? `[data-f="${ae.dataset.f}"]` : `[data-when="${ae.dataset.when}"]`) : null;
        st.fsig = sig; form.innerHTML = formHTML(q, r);
        if (keepAdd != null) { const a = $('[data-f="add"]', form); a.value = keepAdd; a.focus(); if (keepAdd) suggest(w); }
        else if (keepSel) $(keepSel, form)?.focus();
      }
      // what we heard on the call
      $('[data-r="heard"]', w.body).innerHTML = heardHTML(l, live);
      // health: always open on final expense
      const hb = $('[data-r="health"]', w.body), hIn = hb.contains(ae), ses = l ? session(l.id) : null;
      hb.hidden = !FE;
      if (FE) {
        const hp = (QF.auto ? [] : QF.pending).filter((p) => /^(?:cond|med)=/.test(p.key)).map((p) => p.key);
        const hsig = JSON.stringify([Q.FE.conds, Q.FE.meds, q.uw().t, QF.src[QF.lead] || {}, hp, live, ses?.consent, AIH.status, !!l]);
        if (hsig !== st.hsig) {
          const keepAdd = hIn && ae.dataset.f === "add" ? ae.value : null, keepSel = hIn && ae.matches("select[data-when]") ? `[data-when="${ae.dataset.when}"]` : null;
          st.hsig = hsig; hb.innerHTML = healthHTML(q, l, live, ses);
          if (keepAdd != null) { const a = $('[data-f="add"]', hb); a.value = keepAdd; a.focus(); if (keepAdd) suggest(w); }
          else if (keepSel) $(keepSel, hb)?.focus();
        }
      }
      // results
      const ok = r.rows.filter((x) => x.price != null), off = r.rows.filter((x) => x.price == null);
      const fmt = (p) => (r.B ? usd(p) : usd(p, 2)), badge = (x) => (x.exact ? ["x", "Carrier rates"] : x.checked ? ["c", "Market-checked"] : ["r", "Rough estimate"]);
      const best = ok[0];
      if (best) {
        const amtTxt = r.B ? `${usd(r.amt)}/mo` : usd(r.amt);
        const summary = (r.B ? `${usd(best.price)} ${best.sub} final expense` : r.summary + (best.sub ? ` · ${best.sub}` : "")) + `, age ${Q.age} ${Q.sex}${Q.tob === "1" ? " tobacco" : ""}, ${Q.state}`;
        st.best = { text: `${best.n}: ${amtTxt} ${best.sub} — ${r.B ? usd(best.price) + " of coverage" : usd(best.price, 2) + "/mo"}${best.exact ? "" : " (estimate)"}`, q: { product: r.T === "TERM" ? "MP" : r.T, carrier: best.n, exact: best.exact, monthly: r.B ? r.amt : best.price, summary } };
      } else st.best = null;
      const forWho = l || lead(ctxId());
      // the answer stays pinned at the top; the form and the other carriers scroll underneath
      $('[data-r="top"]', w.body).innerHTML = best
        ? `<div class="hpp-best"><div class="hpp-best-r"><div><span class="hpp-lbl">Lead with</span><b>${esc(best.n)}</b><span>${esc(best.sub)} <em class="hpp-badge ${badge(best)[0]}">${badge(best)[1]}</em></span></div><div class="hpp-best-p"><b class="num">${fmt(best.price)}</b><span>${r.B ? `coverage for ${usd(r.amt)}/mo` : `a month for ${usd(r.amt)}`}</span></div></div>
            <div class="hpp-best-a"><button type="button" class="btn sm" data-q="copy">Copy</button><button type="button" class="btn sm primary" data-q="crm" ${forWho ? "" : "disabled"}>${forWho ? `Add to ${esc(forWho.first || "client")}'s file` : "Add to a client"}</button></div></div>`
        : `<div class="hpp-alert"><b>No carrier fits yet</b>${r.T === "FE" && q.uw().t >= 4 ? "Based on the health answers, this client likely doesn't qualify for final expense right now." : `Nothing in the model offers this at age ${Q.age}. Try another plan or amount.`}</div>`;
      $('[data-r="res"]', w.body).innerHTML = ok.length > 1
        ? `<div class="hpp-hh"><span class="hpp-lbl">Other carriers</span></div><ol class="hpp-rows">${ok.slice(1, 8).map((x, i) => `<li><span class="rk">${i + 2}</span><div><b>${esc(x.n)}</b><span>${esc(x.sub)}</span>${badge(x)[0] !== "c" ? `<em class="hpp-badge ${badge(x)[0]}">${badge(x)[1]}</em>` : ""}</div><b class="num">${fmt(x.price)}</b></li>`).join("")}</ol>
          ${ok.length > 8 ? `<p class="hpp-fine">${ok.length - 8} more in the full quoter.</p>` : ""}` : "";
      $('[data-r="res"]', w.body).innerHTML += off.length ? `<button type="button" class="hpp-mini" data-q="more" aria-expanded="${st.more}">${st.more ? "Hide" : "Show"} ${off.length} that can't offer this</button>${st.more ? `<ul class="hpp-off">${off.map((x) => `<li><b>${esc(x.n)}</b><span>${esc(x.why || "No price at this amount")}</span></li>`).join("")}</ul>` : ""}` : "";
      $('[data-r="fine"]', w.body).textContent = r.T === "FE" ? "Market-checked estimates unless marked" : "Estimates. Confirm with the carrier.";
    },
  };
  function formHTML(q, r) {
    const Q = q.Q, FE = r.T === "FE", seg = (attr, cur, opts) => `<div class="hpp-seg sm">${opts.map(([v, t]) => `<button type="button" data-${attr}="${v}" aria-pressed="${String(cur) === String(v)}">${t}</button>`).join("")}</div>`;
    const amtVal = r.B ? `${usd(r.amt)}/mo` : usd(r.amt);
    let h = `<div class="hpp-grid">
      <label class="hpp-fld"><span>Age</span><input type="number" inputmode="numeric" min="18" max="90" data-f="age" value="${esc(Q.age)}" aria-label="Age"></label>
      <div class="hpp-fld"><span>Sex</span>${seg("sex", Q.sex, [["M", "Male"], ["F", "Female"]])}</div>
      <div class="hpp-fld"><span>Tobacco</span>${seg("tob", FE ? (q.NIC[Q.FE.nic]?.[1] ? "1" : "0") : Q.tob, [["0", "No"], ["1", "Yes"]])}</div>
      <label class="hpp-fld"><span>State</span><select data-f="state" aria-label="State">${q.STATES.map((s) => `<option ${s === Q.state ? "selected" : ""}>${s}</option>`).join("")}</select></label></div>
      <div class="hpp-amt">${FE ? seg("mode", Q.FE.mode === "budget" ? "budget" : "face", [["face", "Coverage"], ["budget", "Budget"]]) : `<span class="hpp-lbl">Coverage</span>`}
        <div class="hpp-step"><button type="button" data-step="-1" aria-label="Less">−</button><input data-f="amt" inputmode="numeric" value="${esc(amtVal)}" aria-label="${r.B ? "Monthly budget" : "Coverage amount"}"><button type="button" data-step="1" aria-label="More">+</button></div></div>
      <div class="hpp-quick">${r.quick.map(([v, t]) => `<button type="button" class="hpp-chip" data-amt="${v}" aria-pressed="${+v === +r.amt}">${t}</button>`).join("")}</div>
      <div class="hpp-plans">${seg("plan", r.plan, r.plans)}</div>`;
    if (r.T === "TERM") h += `<label class="hpp-fld inl"><span>Health class</span><select data-f="cls">${[["0.82", "Preferred plus"], ["1", "Preferred"], ["1.22", "Standard plus"], ["1.45", "Standard"]].map(([v, t]) => `<option value="${v}" ${v === String(Q.cls) ? "selected" : ""}>${t}</option>`).join("")}</select></label>`;
    return h;
  }
  const SHORT = { cad: "Coronary artery disease / stent", afib: "AFib / irregular heartbeat", copd: "COPD / emphysema", dmc: "Diabetes with complications", o2: "Uses oxygen", cancerNow: "Cancer (current)", cancerPast: "Cancer (past)", skin: "Skin cancer (basal/squamous)", ckd: "Kidney disease", dialysis: "Dialysis", liver: "Liver disease / cirrhosis", dementia: "Dementia / Alzheimer's", depression: "Depression / anxiety", alcohol: "Alcohol / drug treatment", hiv: "HIV / AIDS", amput: "Amputation", wheelchair: "Wheelchair / daily help", joint: "Hip or knee replacement", pending: "Pending surgery or tests", nursing: "Nursing home / hospice", hbp: "High blood pressure", chf: "Heart failure", tia: "TIA (mini-stroke)" };
  const TIER = ["Likely Preferred", "Likely Standard", "Likely Graded", "Likely Guaranteed issue", "Likely doesn't qualify"];
  const HSRC = { call: ["heard", "Heard on this call"], ai: ["AI", "Highpoint Bot picked this up from the call"], file: ["file", "From the client's file"] };
  function healthHTML(q, l, live, ses) {
    const Q = q.Q, uw = q.uw(), from = (l && QF.src[l.id]) || {};
    const tag = (key) => { const f = from[key]; if (!f) return ""; const [t, why] = HSRC[f.src] || HSRC.call; return `<i class="src ${esc(f.src)}" title="${esc(f.via ? `Added because the client takes ${f.via}` : why + (f.quote ? `: “${f.quote.slice(0, 160)}”` : ""))}">${f.via ? "Rx" : t}</i>`; };
    let status = "";
    if (l && live && ses?.consent === "agreed") status = `<span class="hpp-listen" title="${AIH.status === "off" ? "Picking up conditions and medications as the client says them" : "Picking up conditions and medications as the client says them, with Highpoint Bot reading along"}">Listening</span>`;
    else if (l && live && ses && ses.consent !== "declined") status = `<span class="hpp-fine">Fills in after the client agrees to recording</span>`;
    const pend = (QF.auto ? [] : QF.pending).filter((p) => /^(?:cond|med)=/.test(p.key));
    // conditions: one row each (name, when, where it came from, remove); medications: compact chips under them
    const conds = Q.FE.conds.map((c, i) => { const C = q.COND[c.k]; const timed = C && C.r.length > 1; return `<li class="hpp-hrow"><b title="${esc(C?.n || c.k)}">${esc(SHORT[c.k] || C?.n.replace(/\s*\(.*\)$/, "") || c.k)}</b>${timed ? `<select data-when="${i}" aria-label="When was ${esc(C.n)} last treated?" class="${c.at ? "" : "need"}">${WHEN.map(([v, t]) => `<option value="${v}" ${String(bucket(c.at)) === String(v) ? "selected" : ""}>${t}</option>`).join("")}</select>` : "<span></span>"}${tag("cond=" + c.k) || "<span></span>"}<button type="button" data-rm-c="${i}" aria-label="Remove ${esc(C?.n || c.k)}" title="Remove">✕</button></li>`; }).join("");
    const meds = Q.FE.meds.map((m, i) => `<span class="hpp-hc m"><i class="rx">Rx</i><b title="${esc(m)}">${esc(m)}</b>${tag("med=" + m)}<button type="button" data-rm-m="${i}" aria-label="Remove ${esc(m)}" title="Remove">✕</button></span>`).join("");
    return `<div class="hpp-hh"><span class="hpp-lbl">Health</span><span class="tierpill sm ${q.TIER_CLS[uw.t]}">${TIER[uw.t]}</span><span class="hpp-sp"></span>${status}</div>
      ${pend.length ? `<div class="hpp-hchips">${pend.map((it) => `<button type="button" class="hpp-hc sug" data-use-k="${esc(it.key)}" title="${esc(it.quote ? `Heard: “${it.quote.slice(0, 160)}”` : "Heard on this call")}">${esc(it.label)}<i>Use</i></button>`).join("")}</div>` : ""}
      ${conds ? `<ul class="hpp-hrows">${conds}</ul>` : ""}${meds ? `<div class="hpp-hchips">${meds}</div>` : ""}${conds || meds ? "" : `<p class="hpp-fine">No conditions or medications yet.${l && live ? " They fill in as the client mentions them." : ""}</p>`}
      <div class="hpp-add"><input data-f="add" placeholder="Add a condition or medication" autocomplete="off" aria-label="Add a condition or medication"><div class="hpp-sug" hidden></div></div>`;
  }
  // you took off something the call put in: it stays off (it's already in the done list, so the call won't add it again)
  function forget(key) {
    const id = QF.lead; if (!id) return;
    QF.pending = QF.pending.filter((p) => p.key !== key);
    if (QF.src[id]) delete QF.src[id][key];
  }
  let HLIST = null; // what you can add: every condition, the quoter's medications, and Aetna Accendo's drug list
  function healthList() {
    if (HLIST) return HLIST;
    const q = QT(), seen = new Set();
    HLIST = [...Object.entries(q.COND).map(([k, c]) => ({ id: "c:" + k, t: c.n, h: "" }))];
    for (const [m, k] of Object.entries(q.MEDS)) { seen.add(m.toLowerCase()); HLIST.push({ id: "m:" + m, t: m, h: q.COND[k]?.n.replace(/\s*\(.*\)$/, "") }); }
    for (const r of window.HP_DRUGS?.accendo?.rows || []) { const n = tcase(r[0]); if (seen.has(n.toLowerCase())) continue; seen.add(n.toLowerCase()); HLIST.push({ id: "m:" + n, t: n, h: "Aetna Accendo drug list" }); }
    return HLIST;
  }
  function suggest(w) {
    const q = QT(), inp = $('[data-f="add"]', w.body), box = $(".hpp-sug", w.body), s = inp.value.trim().toLowerCase();
    if (!s) { box.hidden = true; return; }
    const have = new Set([...q.Q.FE.conds.map((c) => "c:" + c.k), ...q.Q.FE.meds.map((m) => "m:" + m)]);
    const hits = healthList().filter((x) => !have.has(x.id) && x.t.toLowerCase().includes(s)).map((x) => [x, x.t.toLowerCase().indexOf(s)]).sort((a, b) => a[1] - b[1] || a[0].t.length - b[0].t.length).slice(0, 8).map(([x]) => x);
    box.innerHTML = hits.map((x) => `<button type="button" data-pick="${esc(x.id)}">${esc(x.t)}${x.h ? `<span> · ${esc(x.h)}</span>` : ""}</button>`).join("") || `<span class="hpp-fine">No match. Try another word.</span>`;
    box.hidden = false;
  }
  function pickHealth(id) {
    const q = QT(), FE = q.Q.FE, [kind, v] = [id.slice(0, 1), id.slice(2)];
    if (kind === "c" && !FE.conds.some((c) => c.k === v)) FE.conds.push({ k: v });
    if (kind === "m") { if (!FE.meds.includes(v)) FE.meds.push(v); const k = q.MEDS[v]; if (k && !FE.conds.some((c) => c.k === k)) FE.conds.push({ k }); }
    q.changed();
  }
  function heardHTML(l, live) {
    if (!l) return "";
    const ses = session(l.id), chips = (QF.chips[l.id] || []).filter((c) => !c.undone && !/^(?:cond|med)=/.test(c.key || ""));
    let h = "";
    if (live && ses && ses.consent === "none") h += `<p class="hpp-fine">Fills in from the call once the client agrees to recording.</p>`;
    if (ses?.consent === "declined") h += `<p class="hpp-fine">The client declined recording, so nothing from this call is used.</p>`;
    const pend = QF.auto ? [] : QF.pending.filter((p) => !/^(?:cond|med)=/.test(p.key));
    if (!chips.length && !pend.length && !(live && ses?.consent === "agreed")) return h;
    h += `<div class="hpp-hh"><span class="hpp-lbl">From the call</span><span class="hpp-sp"></span><button type="button" class="hpp-chk" data-q="auto" aria-pressed="${QF.auto}" title="Update the quote as the client answers">Fill in for me</button></div>`;
    h += `<div class="hpp-hchips">${chips.slice(-10).map((c) => `<span class="hpp-hc ok" title="${c.src === "file" ? "From the client's file" : "Heard on this call"}">✓ <b>${esc(c.label)}</b>${c.src === "file" ? "<i>file</i>" : ""}<button type="button" data-undo="${(QF.chips[l.id] || []).indexOf(c)}" aria-label="Undo ${esc(c.label)}" title="Undo">↶</button></span>`).join("")}
      ${pend.map((it, i) => `<button type="button" class="hpp-hc sug" data-use="${i}">${esc(it.label)}<i>Use</i></button>`).join("")}${pend.length > 1 ? `<button type="button" class="hpp-mini" data-use-all>Use all</button>` : ""}</div>`;
    if (!chips.length && !pend.length) h += `<p class="hpp-fine">Listening for age, tobacco, coverage and budget.</p>`;
    return h;
  }
  function applyItems(list, src) {
    const id = QF.lead; if (!id || !list.length) return;
    const done = (QF.done[id] = QF.done[id] || []), chips = (QF.chips[id] = QF.chips[id] || []), from = (QF.src[id] = QF.src[id] || {});
    for (const it of list) {
      if (!it || done.includes(it.key)) continue;
      const how = it.src || src, f = { src: how, quote: it.quote || "" };
      done.push(it.key); from[it.key] = f;
      if (it.key.startsWith("med=")) { const ck = QT().MEDS[it.key.slice(4)]; if (ck && !from["cond=" + ck]) from["cond=" + ck] = { src: how, quote: it.quote || "", via: it.label }; }
      chips.push({ key: it.key, label: it.label, undo: it.apply(), src: how });
    }
    QF.pending = QF.pending.filter((p) => !done.includes(p.key));
    QT().changed();
  }
  // the client's answers on this call -> the quote (or suggestions, when "Fill in for me" is off)
  function fromCall() {
    if (!QF.lead || !QT()) return;
    const F = heardF(QF.lead), done = QF.done[QF.lead] || [], ses = session(QF.lead);
    const heard = ses?.consent === "agreed" ? healthHeard(ses.lines || []) : [];
    const ai = AIH.lead === QF.lead ? AIH.items : [];
    const all = [...items(F), ...heard, ...ai].filter(Boolean), dated = new Map(all.filter((it) => it.at).map((it) => [it.key, it]));
    const seen = new Set(), fresh = all.map((it) => (!it.at && dated.get(it.key)) || it).filter((it) => !done.includes(it.key) && !seen.has(it.key) && seen.add(it.key));
    // a condition already in from the call, now with a when ("two years ago"): fill in the when, unless you already picked one
    let dateFix = false;
    for (const [key, it] of dated) { if (!done.includes(key) || !QF.src[QF.lead]?.[key]) continue; const c = QT().Q.FE.conds.find((x) => "cond=" + x.k === key); if (c && !c.at) { c.at = it.at; dateFix = true; } }
    if (dateFix && !(QF.auto && fresh.length)) QT().changed();
    if (QF.auto) { if (fresh.length) applyItems(fresh, "call"); }
    else QF.pending = fresh;
  }
  // follow a client: put away the last client's quote, bring back this one's (or start from their file)
  function bind(id, force) {
    const q = QT(); if (!q || !id || (QF.lead === id && !force)) return;
    if (QF.manual && !force) return; // you unlinked it: leave it alone until you link again or a new call starts
    if (QF.lead) QF.ctx[QF.lead] = snapQ();
    QF.lead = id; QF.manual = false; QF.pending = [];
    const l = lead(id);
    if (QF.ctx[id]) loadQ(QF.ctx[id]);
    else if (l) {
      const s = snapQ();
      s.tab = l.product === "MP" ? "TERM" : l.product === "IUL" ? "IUL" : "FE";
      const a = ageOf(l); if (a) s.age = a;
      const sx = sexOf(l); if (sx) s.sex = sx;
      if (q.STATES.includes(up(l.state))) s.state = up(l.state);
      s.tob = "0"; Object.assign(s.FE, { dob: dobParts(l.dob) || { m: "", d: "", y: "" }, ft: "", inch: "", lb: "", nic: "none", conds: [], meds: [] });
      loadQ(s);
      const fileItems = items(onFile(l));
      if (fileItems.length) { QF.done[id] = []; QF.chips[id] = []; applyItems(fileItems, "file"); }
    }
    q.setLead(id); q.changed();
    fromCall(); aiHealth();
  }
  const follow = () => { if (following()) { const id = ctxId(); if (id) bind(id); } };

  /* ================= live call ================= */
  const LIVE = {
    build(w) {
      w.st.userAt = 0;
      w.body.innerHTML = `<div class="hpp-for" data-r="for"></div>
        <div class="hpp-scroll hpp-livebox" data-r="scroll"><div data-r="gate"></div><div class="hpp-alerts" data-r="alerts"></div><div data-r="heard"></div><div class="hpp-tx" data-r="tx" aria-live="polite"></div></div>
        <button type="button" class="hpp-jump" data-r="jump" hidden>Jump to the latest ↓</button>`;
      const sc = $('[data-r="scroll"]', w.body), jump = $('[data-r="jump"]', w.body);
      sc.addEventListener("scroll", () => { const near = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 60; w.st.pinned = near; jump.hidden = near; }, { passive: true });
      jump.onclick = () => { sc.scrollTop = sc.scrollHeight; w.st.pinned = true; jump.hidden = true; };
      w.st.pinned = true;
      w.body.addEventListener("click", (e) => {
        const t = e.target.closest("[data-l]"); if (!t) return;
        if (t.dataset.l === "agree") CO()?.agree();
        else if (t.dataset.l === "decline") CO()?.decline();
        else if (t.dataset.l === "profile") { const id = CALL.txLead || ctxId(); if (id) DL()?.openProfile(id); }
      });
    },
    update(w) {
      const id = (CALL.live && liveId()) || CALL.txLead || ctxId(), l = lead(id), live = CALL.live && !!l && liveId() === l.id;
      $(".hpp-sub", w.el).textContent = l ? fullName(l) : "";
      const pfOpen = !!l && DL()?.profileId === l.id && !document.getElementById("hpdProfile")?.hidden; // the profile already shows this client and the consent buttons
      $('[data-r="for"]', w.body).innerHTML = l
        ? `${live ? `<span class="hpp-live"><i></i>On call <span class="num" data-r="clock">${clock()}</span></span>` : CALL.endedAt && CALL.txLead === l.id ? `<span>Call ended</span>` : `<span>Not on a call</span>`}<span class="hpp-sp"></span>${pfOpen ? "" : `<button type="button" class="hpp-mini" data-l="profile">Open profile</button>`}`
        : `<span>No call right now</span>`;
      const ses = session(l?.id), ex = ses?.consent === "agreed" ? ses.ex : null;
      // the consent gate, same as the profile's
      $('[data-r="gate"]', w.body).innerHTML = live && ses && ses.consent === "none" && !pfOpen
        ? `<div class="hpp-gate"><b>Read the disclosure first</b><span>“This call may be recorded for quality and training. Do you agree to continue?”</span><div><button type="button" class="btn sm primary" data-l="agree">Client agreed</button><button type="button" class="btn sm" data-l="decline">Client declined</button></div><em>The copilot and the quoter stay off until the client says yes.</em></div>`
        : ses?.consent === "declined" && !pfOpen ? `<div class="hpp-alert bad"><b>Client declined recording</b>Copilot is off for this call and nothing from it is kept.</div>` : "";
      // objection, wording check, and the next thing to ask
      let al = "";
      if (ex && ses) {
        const n = ses.lines.length, o = ex.objs[ex.objs.length - 1], fl = ex.flags?.[ex.flags.length - 1];
        if (o && n - o.line <= 6) al += `<div class="hpp-alert"><b>Objection · ${esc(o.label)}</b><ul>${o.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul></div>`;
        if (fl && n - fl.line <= 6) al += `<div class="hpp-alert bad"><b>Check this wording · ${esc(fl.label)}</b>${esc(fl.tip)}</div>`;
        const CK = CO()?.CHECK?.[ses.product] || [], FL = CO()?.FIELDS || {};
        const have = (k) => ex.F[k] || (k === "age" && ex.F.dob) || (FL[k]?.core ? l?.[FL[k].core] : l?.fields?.[FL[k]?.label]);
        const miss = CK.find((k) => k !== "consent" && !have(k));
        if (miss && FL[miss]?.ask && !(o && n - o.line <= 6)) al += `<div class="hpp-ask"><span>Ask next</span>${esc(FL[miss].ask)}</div>`;
      }
      $('[data-r="alerts"]', w.body).innerHTML = al;
      // what the copilot heard
      const FL = CO()?.FIELDS || {}, keys = ex ? Object.keys(ex.F).filter((k) => k !== "consent" && FL[k]) : [];
      $('[data-r="heard"]', w.body).innerHTML = keys.length
        ? `<div class="hpp-hh"><span class="hpp-lbl">Heard</span><span class="hpp-sp"></span><button type="button" class="hpp-mini" data-pop="quote">Quote it</button></div><div class="hpp-kv">${keys.map((k) => `<span>${esc(FL[k].label)}</span><b>${esc(FL[k].num ? usd(+ex.F[k].value) : ex.F[k].value)}</b>`).join("")}</div>`
        : "";
      // the transcript
      const box = $('[data-r="tx"]', w.body), sc = $('[data-r="scroll"]', w.body);
      const lines = l && CALL.txLead === l.id ? CALL.lines : [], part = l && CALL.txLead === l.id && live ? CALL.partial : [];
      const row = (x, p) => `<p class="${x.who === "Agent" ? "me" : "them"}${p ? " partial" : ""}"><span>${x.who === "Agent" ? "You" : esc(l?.first || "Client")}</span>${esc(x.text)}${p ? "…" : ""}</p>`;
      box.innerHTML = lines.length || part.length ? lines.map((x) => row(x)).join("") + part.map((x) => row(x, true)).join("")
        : `<p class="hpp-empty">${live ? "Listening… the transcript shows up here as you talk." : "When a call connects, the live transcript shows up here."}</p>`;
      if (w.st.pinned !== false) sc.scrollTop = sc.scrollHeight;
    },
  };

  /* ================= painting ================= */
  const VIEWS = { script: SCRIPT, quote: QUOTE, live: LIVE };
  const dirty = new Set(); let queued = false;
  function paint(k, now) {
    if (k) dirty.add(k); else ORDER.forEach((x) => dirty.add(x));
    if (queued) return; queued = true;
    soon(() => {
      queued = false;
      for (const x of [...dirty]) {
        dirty.delete(x);
        const w = W.get(x); if (!w || (w.el.classList.contains("min") && !now)) continue;
        try {
          if (!w.built) { Object.assign(w.st, { sig: "", fsig: "", lastAt: null }); VIEWS[x].build(w); w.built = true; } // a new home (panel or window) draws everything fresh
          VIEWS[x].update(w);
        } catch (e) { console.warn("pop-out", x, e); }
      }
    });
  }

  /* ================= events ================= */
  addEventListener("hp:callstart", () => setTimeout(() => {
    const id = liveId() || D()?.currentId?.();
    if (id !== CALL.leadId) { CALL.lines = []; CALL.partial = []; CALL.txLead = null; }
    Object.assign(CALL, { live: true, t0: Date.now(), leadId: id, endedAt: 0 });
    if (following() && id) { QF.manual = false; bind(id); }
    paint();
  }, 80));
  addEventListener("hp:callend", () => { CALL.live = false; CALL.endedAt = Date.now(); CALL.partial = []; paint(); });
  addEventListener("hp:tx", (e) => {
    const { leadId, lines, partial } = e.detail || {}; if (!leadId || !Array.isArray(lines)) return;
    if (leadId !== CALL.txLead) { CALL.txLead = leadId; if (!CALL.live && DL()?.busy) Object.assign(CALL, { live: true, t0: Date.now(), leadId }); }
    CALL.lines = lines; CALL.partial = Array.isArray(partial) ? partial : [];
    paint("live"); paint("script");
  });
  addEventListener("hp:copilot", () => { if (following()) { fromCall(); aiHealth(); } paint(); });
  addEventListener("hp:quote", () => { paint("quote"); paint("script"); });
  addEventListener("hp:profile", () => { follow(); paint("script"); paint("live"); });
  setInterval(() => { if (CALL.live && W.has("live")) { const c = W.get("live").el.querySelector('[data-r="clock"]'); if (c) c.textContent = clock(); } }, 1000);

  // any button with data-pop opens that pop-out: top bar, call dock, profile, quoter page, the live view's "Quote it"
  function popClick(e) { const b = e.target.closest?.("[data-pop]"); if (!b || !KINDS[b.dataset.pop]) return; e.preventDefault(); toggle(b.dataset.pop); }
  document.addEventListener("click", popClick);
  function hotkeys(e) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const k = { KeyS: "script", KeyQ: "quote", KeyL: "live" }[e.code]; if (!k) return;
    e.preventDefault(); toggle(k);
  }
  document.addEventListener("keydown", hotkeys);
  async function copy(t) { try { await navigator.clipboard.writeText(t); toast("Copied"); } catch { toast("Copy isn't available here"); } }

  // launch buttons for other parts of the desk
  const launchers = (cls) => ORDER.map((k) => `<button type="button" class="${cls}-pop" data-pop="${k}" aria-pressed="${isOpen(k) && !isMin(k)}" title="Pop out the ${KINDS[k].title.toLowerCase()} (Alt+${KINDS[k].key})">${IC[k]}<span>${KINDS[k].label}</span></button>`).join("");
  function addTop() {
    const row = document.querySelector("header.topbar .row"); if (!row) return false;
    if (row.querySelector(".hpp-launch")) return true;
    const g = document.createElement("div"); g.className = "hpp-launch"; g.setAttribute("role", "group"); g.setAttribute("aria-label", "Pop-outs"); g.innerHTML = launchers("hpp-l");
    row.insertBefore(g, row.querySelector(".hp-acct") || null);
    return true;
  }
  if (!addTop()) { const mo = new MutationObserver(() => { if (addTop()) mo.disconnect(); }); mo.observe(document.body, { childList: true, subtree: true }); }
  new MutationObserver(() => { if (!document.querySelector(".hpp-launch")) addTop(); }).observe(document.querySelector("header.topbar") || document.body, { childList: true, subtree: true });

  window.hpPop = {
    open, close, toggle, isOpen, minimize,
    closeAll: () => ORDER.forEach(close),
    launchers, dockRow: () => `<div class="hpdk-pops" role="group" aria-label="Pop-outs">${launchers("hpdk")}</div>`,
    get state() { return { call: { ...CALL, lines: CALL.lines.length }, open: [...W.keys()], pip: pip?.k || null }; },
  };

  // bring back what was open last time (one at a time on a phone)
  const reopen = ORDER.filter((k) => G[k]?.open).sort((a, b) => (G[a].at || 0) - (G[b].at || 0));
  (isPhone() ? reopen.slice(-1) : reopen).forEach((k) => open(k, { restore: true }));
})();
