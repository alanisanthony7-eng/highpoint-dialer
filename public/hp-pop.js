/* Highpoint pop-outs: small windows for the script, the quoter and the live call that stay up while you dial.
   Drag one by its title bar, resize it from the corner, double-click the title to tuck it away, or keep it on top of
   your other apps (Chrome and Edge). Positions are remembered, and pop-outs left open come back after a reload.
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
  const soon = (fn) => (document.hidden ? setTimeout(fn, 30) : requestAnimationFrame(fn)); // a hidden tab pauses animation frames; pop-outs kept on top still update
  const up = (s) => String(s || "").trim().toUpperCase();

  if (!document.querySelector('link[href="/hp-pop.css"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/hp-pop.css"; document.head.append(l); }

  const sv = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
  const IC = {
    script: sv('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/>'),
    quote: sv('<circle cx="12" cy="12" r="9"/><path d="M15 9.4c-.5-1.1-1.6-1.8-3-1.8-1.7 0-3 .9-3 2.2 0 3.1 6 1.6 6 4.7 0 1.3-1.3 2.2-3 2.2-1.4 0-2.6-.7-3-1.9M12 6v1.6M12 16.7v1.5"/>'),
    live: sv('<path d="M3 12h2M7 8v8M11 4v16M15 8v8M19 10v4M22 12h-1"/>'),
    min: sv('<path d="M6 12h12"/>'),
    max: sv('<rect x="5" y="5" width="14" height="14" rx="2.5"/>'),
    x: sv('<path d="M6 6l12 12M18 6 6 18"/>'),
    pip: sv('<rect x="3" y="5" width="18" height="14" rx="2.5"/><rect x="12" y="11.5" width="6.5" height="5" rx="1"/>'),
    back: sv('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  };
  const KINDS = {
    script: { title: "Script", label: "Script", key: "S", w: 360, h: 780, minW: 290, minH: 220 },
    quote: { title: "Quote", label: "Quote", key: "Q", w: 370, h: 640, minW: 300, minH: 240 },
    live: { title: "Live call", label: "Live", key: "L", w: 340, h: 520, minW: 280, minH: 200 },
  };
  const ORDER = ["script", "quote", "live"];
  const PIP_OK = "documentPictureInPicture" in window;

  /* ================= window manager ================= */
  const G = lsGet("hp.pop", {}); // per kind: x, y, w, h, min, open
  let gTimer = 0;
  const saveG = () => { clearTimeout(gTimer); gTimer = setTimeout(() => lsSet("hp.pop", G), 250); };
  const W = new Map(); // kind -> { k, el, body, built, st }
  let zTop = 360, pip = null; // pip: { k, win }

  // first-time spots: the script reads down the left, the quote sits just left of the call dock's column
  // (the dock lives bottom-right during calls), and the live call goes between them when there's room
  function defaults(k) {
    const tb = document.querySelector("header.topbar")?.getBoundingClientRect(); // open just under the top bar so its buttons stay reachable
    const vw = innerWidth, vh = innerHeight, top = Math.round(Math.min(Math.max(76, (tb?.bottom || 0) + 8), vh * 0.3)), H = vh - top - 20, fit = (x) => Math.min(KINDS[x].w, vw - 24);
    const sw = fit("script"), qw = fit("quote"), lw = fit("live");
    const script = { x: 12, y: top, w: sw, h: Math.min(KINDS.script.h, H) };
    const dockCol = vw >= 1100 ? 364 : 20;
    let qx = vw - dockCol - qw; if (qx < 12 + sw + 8) qx = vw - qw - 20;
    const quote = { x: qx, y: top, w: qw, h: Math.min(KINDS.quote.h, H) };
    const room = qx - 8 - (12 + sw + 8), lh = Math.min(KINDS.live.h, H);
    const live = room >= KINDS.live.minW ? { x: 12 + sw + 8, y: top, w: Math.min(lw, room), h: lh } : { x: Math.max(12, qx - lw - 8), y: Math.max(top, vh - lh - 20), w: lw, h: lh };
    return { script, quote, live }[k];
  }
  function geo(k) { return Object.assign(defaults(k), G[k] && G[k].w ? { x: G[k].x, y: G[k].y, w: G[k].w, h: G[k].h } : {}); }
  function place(k) {
    const w = W.get(k); if (!w || w.el.classList.contains("in-pip")) return;
    const g = geo(k), K = KINDS[k], vw = innerWidth, vh = innerHeight;
    g.w = Math.max(K.minW, Math.min(g.w, vw - 16)); g.h = Math.max(K.minH, Math.min(g.h, vh - 16));
    g.x = Math.max(8, Math.min(g.x, vw - g.w - 8)); g.y = Math.max(8, Math.min(g.y, vh - 52));
    if (g.y + g.h > vh - 8) { g.h = Math.max(K.minH, vh - 8 - g.y); if (g.y + g.h > vh - 8) g.y = Math.max(8, vh - 8 - g.h); } // keep the resize corner on screen
    Object.assign(w.el.style, { left: g.x + "px", top: g.y + "px" });
    w.el.style.setProperty("--w", g.w + "px"); w.el.style.setProperty("--h", g.h + "px");
  }
  function front(k) {
    const w = W.get(k); if (!w) return;
    if (zTop >= 398) { zTop = 360; [...W.values()].sort((a, b) => (+a.el.style.zIndex || 0) - (+b.el.style.zIndex || 0)).forEach((x) => (x.el.style.zIndex = ++zTop)); }
    w.el.style.zIndex = ++zTop;
    W.forEach((x) => x.el.classList.toggle("front", x === w));
    G[k] = { ...(G[k] || {}), at: Date.now() }; saveG();
  }
  function frontKind() { let best = null; W.forEach((x) => { if (!best || (+x.el.style.zIndex || 0) > (+best.el.style.zIndex || 0)) best = x; }); return best?.k || null; }
  const isOpen = (k) => W.has(k);
  const isMin = (k) => !!W.get(k)?.el.classList.contains("min");

  function build(k) {
    const K = KINDS[k];
    const el = document.createElement("section");
    el.className = "hpp"; el.dataset.kind = k; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", K.title);
    el.innerHTML = `<header class="hpp-h"><span class="hpp-ic">${IC[k]}</span><b class="hpp-t">${K.title}</b><span class="hpp-sub"></span><span class="hpp-sp"></span>
      <span class="hpp-switch" role="group" aria-label="Other pop-outs"></span>
      ${PIP_OK ? `<button type="button" class="hpp-hb" data-a="pip" title="Keep on top of your other windows" aria-label="Keep on top of your other windows">${IC.pip}</button>` : ""}
      <button type="button" class="hpp-hb" data-a="min" title="Tuck away" aria-label="Tuck away">${IC.min}</button>
      <button type="button" class="hpp-hb" data-a="x" title="Close" aria-label="Close ${K.title}">${IC.x}</button></header>
      <div class="hpp-body"></div><div class="hpp-rz" aria-hidden="true"></div>`;
    const w = { k, el, body: $(".hpp-body", el), built: false, st: {} };
    W.set(k, w);
    const hd = $(".hpp-h", el);
    el.addEventListener("pointerdown", () => front(k), true);
    $('[data-a="x"]', el).onclick = () => close(k);
    $('[data-a="min"]', el).onclick = () => minimize(k, !isMin(k));
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

  function open(k, opts = {}) {
    if (!KINDS[k]) return null;
    let w = W.get(k);
    if (!w) { w = build(k); place(k); }
    if (opts.tab && k === "script") { w.st.tab = opts.tab; w.st.keepTab = true; w.st.sig = ""; }
    minimize(k, opts.restore ? !!G[k]?.min : false, true);
    G[k] = { ...(G[k] || {}), open: true }; saveG();
    front(k); paint(k, true); switcher(); syncPressed();
    if (pip?.k === k) try { pip.win.focus(); } catch {}
    return w;
  }
  function close(k) {
    const w = W.get(k); if (!w) return;
    if (pip?.k === k) unpip(); // closes the on-top window too
    w.el.remove(); W.delete(k);
    G[k] = { ...(G[k] || {}), open: false }; saveG();
    const fk = frontKind(); if (fk) front(fk);
    switcher(); syncPressed();
  }
  function minimize(k, on, quiet) {
    const w = W.get(k); if (!w) return;
    w.el.classList.toggle("min", !!on);
    const b = $('[data-a="min"]', w.el); b.innerHTML = on ? IC.max : IC.min; b.title = on ? "Open" : "Tuck away"; b.setAttribute("aria-label", b.title);
    G[k] = { ...(G[k] || {}), min: !!on }; saveG();
    if (!on) paint(k, true);
    if (!quiet) syncPressed();
  }
  // a launcher button: open it, bring it forward, or close it when it's already up front
  function toggle(k) {
    if (!KINDS[k]) return;
    if (isOpen(k) && !isMin(k) && (frontKind() === k || pip?.k === k)) return close(k);
    open(k);
  }
  // phones: one sheet at a time, with buttons to switch to the others
  function switcher() {
    W.forEach((w) => {
      const s = $(".hpp-switch", w.el); if (!s) return;
      s.innerHTML = ORDER.filter((k) => k !== w.k && W.has(k)).map((k) => `<button type="button" class="hpp-hb" data-swap="${k}" title="${KINDS[k].title}" aria-label="Show ${KINDS[k].title}">${IC[k]}</button>`).join("");
      $$("[data-swap]", s).forEach((b) => (b.onclick = () => { minimize(b.dataset.swap, false); front(b.dataset.swap); }));
    });
  }
  function syncPressed() {
    const docs = [document, pip?.win?.document].filter(Boolean);
    docs.forEach((d) => $$("[data-pop]", d).forEach((b) => b.setAttribute("aria-pressed", String(isOpen(b.dataset.pop) && !isMin(b.dataset.pop)))));
  }
  addEventListener("resize", () => ORDER.forEach(place));

  /* keep one pop-out on top of other apps: Document Picture-in-Picture (Chrome and Edge 116+) */
  async function toPip(k) {
    const w = W.get(k); if (!w || !PIP_OK) return;
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
    d.documentElement.className = document.documentElement.className;
    const rs = document.documentElement.getAttribute("style"); if (rs) d.documentElement.setAttribute("style", rs);
    d.body.className = "hpp-pipbody"; d.title = "Highpoint · " + KINDS[k].title;
    w.el.classList.remove("min"); w.el.classList.add("in-pip");
    d.body.append(w.el);
    pip = { k, win };
    const pb = $('[data-a="pip"]', w.el); if (pb) { pb.innerHTML = IC.back; pb.title = "Put it back on the page"; pb.setAttribute("aria-label", pb.title); }
    d.addEventListener("click", popClick); d.addEventListener("keydown", hotkeys);
    win.addEventListener("pagehide", () => { if (pip?.win === win) unpip(true); }, { once: true });
    paint(k, true); syncPressed();
  }
  function unpip(closed) {
    if (!pip) return;
    const { k, win } = pip; pip = null;
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
  const heardF = (id) => { if (!id) return {}; const s = session(id); return s && s.leadId === id && s.consent === "agreed" && s.ex ? s.ex.F : {}; };
  const prodOf = (l) => (["FE", "MP", "IUL"].includes(l?.product) ? l.product : "FE");
  const clock = () => { const s = Math.max(0, Math.round((Date.now() - CALL.t0) / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

  /* ================= script ================= */
  const STATE_NAMES = { AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware", DC: "D.C.", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming" };
  const SRC = { lead: "From the client's file", call: "Heard on this call", quote: "From the quoter", you: "Your name" };
  const SENSITIVE = /^(routing number|account number|bank)$/i;
  const fmtDob = (s) => { if (!s) return ""; const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[2]}/${m[3]}/${m[1]}` : String(s); };
  const TABS = [["FE", "Final expense"], ["MP", "Mortgage"], ["IUL", "IUL"]];
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
      w.body.innerHTML = `<div class="hpp-bar"><div class="hpp-seg" role="group" aria-label="Product">${TABS.map(([k, t]) => `<button type="button" data-tab="${k}">${t}</button>`).join("")}</div><span class="hpp-sp"></span>
        <button type="button" class="hpp-tb" data-fs="-1" aria-label="Smaller text" title="Smaller text">A−</button><button type="button" class="hpp-tb" data-fs="1" aria-label="Bigger text" title="Bigger text">A+</button></div>
        <div class="hpp-for" data-r="for"></div><div class="hpp-alerts" data-r="alerts"></div><div class="hpp-prog" data-r="prog"></div>
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
      $('[data-r="for"]', w.body).innerHTML = l
        ? `<span>For <b>${esc(fullName(l))}</b>${l.state ? " · " + esc(up(l.state)) : ""}</span>${live ? `<span class="hpp-live"><i></i>On call</span>` : ""}${useFex ? `<span class="hpp-sp"></span><button type="button" class="hpp-chk" data-follow aria-pressed="${st.follow}" title="Highlights the line you just read and the next one, from the live transcript">Follow the call</button>` : ""}`
        : `<span>No client open. Blanks stay as <span class="hpp-gap">placeholders</span>.</span>`;
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
        const k = hit[1], yr = p.match(/since (\d{4})/i);
        add("cond=" + k, q.COND[k]?.n.replace(/\s*\(.*\)$/, "") || p, () => { if (Q.FE.conds.some((c) => c.k === k)) return () => {}; Q.FE.conds.push(yr ? { k, at: +new Date(+yr[1], 6, 1) } : { k }); return () => { Q.FE.conds = Q.FE.conds.filter((c) => c.k !== k); }; });
      }
    }
    if (v("meds") && v("meds") !== "None") {
      const names = Object.keys(q.MEDS);
      for (const m of String(v("meds")).split(/,\s*/)) {
        const nm = names.find((x) => x.toLowerCase() === m.toLowerCase()) || m.replace(/^./, (c) => c.toUpperCase()), ck = q.MEDS[nm];
        add("med=" + nm, nm, () => { const hadM = Q.FE.meds.includes(nm), hadC = !ck || Q.FE.conds.some((c) => c.k === ck); if (!hadM) Q.FE.meds.push(nm); if (!hadC) Q.FE.conds.push({ k: ck }); return () => { if (!hadM) Q.FE.meds = Q.FE.meds.filter((x) => x !== nm); if (!hadC) Q.FE.conds = Q.FE.conds.filter((c) => c.k !== ck); }; });
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
  // what's already on the client's file, in the copilot's field names
  function onFile(l) {
    const fl = l?.fields || {}, F = {}, put = (k, label) => { const x = fl[label]; if (x && !/^sample-/i.test(x)) F[k] = { value: x, line: -1 }; };
    put("tobacco", "Tobacco use"); put("health", "Health conditions"); put("meds", "Medications"); put("hw", "Height / weight"); put("coverage", "Coverage wanted"); put("budget", "Monthly budget");
    if (l?.mortgageBalance) F.mortgageBalance = { value: +l.mortgageBalance, line: -1 };
    return F;
  }

  /* The quoter follows the client you're on (the call, else the open profile) while the quote or script pop-out is up,
     so the script's prices are always this client's. Each client's quote is put away and brought back as you switch. */
  const QF = { lead: null, manual: false, auto: lsGet("hp.pop.auto", true), done: {}, chips: {}, ctx: {}, pending: [] };
  const following = () => W.has("quote") || W.has("script");
  const QUOTE = {
    build(w) {
      const st = w.st; st.more = false;
      w.body.innerHTML = `<div class="hpp-bar"><div class="hpp-seg" role="group" aria-label="Product">${[["FE", "Final expense"], ["TERM", "Term"], ["IUL", "IUL"]].map(([k, t]) => `<button type="button" data-qtab="${k}">${t}</button>`).join("")}</div></div>
        <div class="hpp-for" data-r="for"></div>
        <div class="hpp-top" data-r="top" aria-live="polite"></div>
        <div class="hpp-scroll" data-r="scroll"><div class="hpp-heard" data-r="heard"></div><div class="hpp-form" data-r="form"></div><div class="hpp-res" data-r="res"></div></div>
        <div class="hpp-foot"><button type="button" class="hpp-mini" data-q="full">Open the full quoter</button><span class="hpp-sp"></span><span class="hpp-fine" data-r="fine"></span></div>`;
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
        else if (d.rmC != null) { Q().FE.conds.splice(+d.rmC, 1); done(); }
        else if (d.rmM != null) { Q().FE.meds.splice(+d.rmM, 1); done(); }
        else if (d.pick) { pickHealth(d.pick); $('[data-f="add"]', w.body).value = ""; $(".hpp-sug", w.body).hidden = true; }
        else if (d.undo != null) { const c = (QF.chips[QF.lead] || [])[+d.undo]; if (c && !c.undone) { c.undo(); c.undone = true; done(); } }
        else if (d.use != null) { const it = QF.pending[+d.use]; if (it) applyItems([it], "call"); }
        else if (d.useAll != null) applyItems(QF.pending, "call");
        else if (d.q === "auto") { QF.auto = !QF.auto; lsSet("hp.pop.auto", QF.auto); if (QF.auto) fromCall(); QUOTE.update(w); }
        else if (d.q === "bind") { bind(ctxId(), true); }
        else if (d.q === "unbind") { if (QF.lead) QF.ctx[QF.lead] = snapQ(); QF.lead = null; QF.manual = true; QUOTE.update(w); paint("script"); }
        else if (d.q === "more") { st.more = !st.more; QUOTE.update(w); }
        else if (d.q === "full") q.open();
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
      $('[data-r="for"]', w.body).innerHTML = l
        ? `<span>For <b>${esc(fullName(l))}</b></span>${live ? `<span class="hpp-live"><i></i>On call</span>` : ""}<span class="hpp-sp"></span><button type="button" class="hpp-mini" data-q="unbind" title="Stop following this client and quote freely">Unlink</button>`
        : cl ? `<span>Quoting without a client</span><span class="hpp-sp"></span><button type="button" class="hpp-mini" data-q="bind">Quote for ${esc(cl.first || fullName(cl))}</button>` : `<span>Quoting without a client</span>`;
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
        ? `<div class="hpp-hh"><span class="hpp-lbl">Other carriers</span></div><ol class="hpp-rows">${ok.slice(1, 8).map((x, i) => `<li><span class="rk">${i + 2}</span><div><b>${esc(x.n)}</b><span>${esc(x.sub)}</span><em class="hpp-badge ${badge(x)[0]}">${badge(x)[1]}</em></div><b class="num">${fmt(x.price)}</b></li>`).join("")}</ol>
          ${ok.length > 8 ? `<p class="hpp-fine">${ok.length - 8} more in the full quoter.</p>` : ""}` : "";
      $('[data-r="res"]', w.body).innerHTML += off.length ? `<button type="button" class="hpp-mini" data-q="more" aria-expanded="${st.more}">${st.more ? "Hide" : "Show"} ${off.length} that can't offer this</button>${st.more ? `<ul class="hpp-off">${off.map((x) => `<li><b>${esc(x.n)}</b><span>${esc(x.why || "No price at this amount")}</span></li>`).join("")}</ul>` : ""}` : "";
      $('[data-r="fine"]', w.body).textContent = r.T === "FE" ? "Estimates unless marked Carrier rates" : "Estimates. Confirm with the carrier.";
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
    if (r.T === "TERM") h += `<label class="hpp-fld row"><span>Health class</span><select data-f="cls">${[["0.82", "Preferred plus"], ["1", "Preferred"], ["1.22", "Standard plus"], ["1.45", "Standard"]].map(([v, t]) => `<option value="${v}" ${v === String(Q.cls) ? "selected" : ""}>${t}</option>`).join("")}</select></label>`;
    if (FE) {
      const uw = q.uw(), tier = ["Likely Preferred", "Likely Standard", "Likely Graded", "Likely Guaranteed issue", "Likely doesn't qualify"][uw.t];
      h += `<div class="hpp-health"><div class="hpp-hh"><span class="hpp-lbl">Health</span><span class="tierpill sm ${q.TIER_CLS[uw.t]}">${tier}</span></div>
        <div class="hpp-hchips">${Q.FE.conds.map((c, i) => { const C = q.COND[c.k]; const timed = C && C.r.length > 1; return `<span class="hpp-hc c"><b>${esc(C?.n.replace(/\s*\(.*\)$/, "") || c.k)}</b>${timed ? `<select data-when="${i}" aria-label="When was it last treated?" class="${c.at ? "" : "need"}">${WHEN.map(([v, t]) => `<option value="${v}" ${String(bucket(c.at)) === String(v) ? "selected" : ""}>${t}</option>`).join("")}</select>` : ""}<button type="button" data-rm-c="${i}" aria-label="Remove">✕</button></span>`; }).join("")}${Q.FE.meds.map((m, i) => `<span class="hpp-hc m"><i>Rx</i><b>${esc(m)}</b><button type="button" data-rm-m="${i}" aria-label="Remove ${esc(m)}">✕</button></span>`).join("")}</div>
        <div class="hpp-add"><input data-f="add" placeholder="Add a condition or medication" autocomplete="off" aria-label="Add a condition or medication"><div class="hpp-sug" hidden></div></div></div>`;
    }
    return h;
  }
  function suggest(w) {
    const q = QT(), inp = $('[data-f="add"]', w.body), box = $(".hpp-sug", w.body), s = inp.value.trim().toLowerCase();
    if (!s) { box.hidden = true; return; }
    const list = [...Object.entries(q.COND).map(([k, c]) => ({ id: "c:" + k, t: c.n, h: "" })), ...Object.entries(q.MEDS).map(([m, k]) => ({ id: "m:" + m, t: m, h: q.COND[k]?.n.replace(/\s*\(.*\)$/, "") }))];
    const hits = list.filter((x) => x.t.toLowerCase().includes(s)).sort((a, b) => a.t.toLowerCase().indexOf(s) - b.t.toLowerCase().indexOf(s)).slice(0, 7);
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
    const ses = session(l.id), chips = (QF.chips[l.id] || []).filter((c) => !c.undone);
    let h = "";
    if (live && ses && ses.consent === "none") h += `<p class="hpp-fine">Fills in from the call once the client agrees to recording.</p>`;
    if (ses?.consent === "declined") h += `<p class="hpp-fine">The client declined recording, so nothing from this call is used.</p>`;
    const pend = QF.auto ? [] : QF.pending;
    if (!chips.length && !pend.length && !(live && ses?.consent === "agreed")) return h;
    h += `<div class="hpp-hh"><span class="hpp-lbl">From the call</span><span class="hpp-sp"></span><button type="button" class="hpp-chk" data-q="auto" aria-pressed="${QF.auto}" title="Update the quote as the client answers">Fill in for me</button></div>`;
    h += `<div class="hpp-hchips">${chips.slice(-10).map((c) => `<span class="hpp-hc ok" title="${c.src === "file" ? "From the client's file" : "Heard on this call"}">✓ <b>${esc(c.label)}</b>${c.src === "file" ? "<i>file</i>" : ""}<button type="button" data-undo="${(QF.chips[l.id] || []).indexOf(c)}" aria-label="Undo ${esc(c.label)}" title="Undo">↶</button></span>`).join("")}
      ${pend.map((it, i) => `<button type="button" class="hpp-hc sug" data-use="${i}">${esc(it.label)}<i>Use</i></button>`).join("")}${pend.length > 1 ? `<button type="button" class="hpp-mini" data-use-all>Use all</button>` : ""}</div>`;
    if (!chips.length && !pend.length) h += `<p class="hpp-fine">Listening. Age, tobacco, health, medications and budget fill in as the client mentions them.</p>`;
    return h;
  }
  function applyItems(list, src) {
    const id = QF.lead; if (!id || !list.length) return;
    const done = (QF.done[id] = QF.done[id] || []), chips = (QF.chips[id] = QF.chips[id] || []);
    for (const it of list) { if (done.includes(it.key)) continue; done.push(it.key); chips.push({ label: it.label, undo: it.apply(), src }); }
    QF.pending = QF.pending.filter((p) => !done.includes(p.key));
    QT().changed();
  }
  // the client's answers on this call -> the quote (or suggestions, when "Fill in for me" is off)
  function fromCall() {
    if (!QF.lead || !QT()) return;
    const F = heardF(QF.lead), done = QF.done[QF.lead] || [];
    const fresh = items(F).filter((it) => !done.includes(it.key));
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
    fromCall();
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
      $('[data-r="for"]', w.body).innerHTML = l
        ? `${live ? `<span class="hpp-live"><i></i><span class="num" data-r="clock">${clock()}</span></span>` : CALL.endedAt && CALL.txLead === l.id ? `<span class="hpp-fine">Call ended</span>` : ""}<span><b>${esc(fullName(l))}</b>${l.phone ? ` · <span class="num">${esc(D().fmtPhone?.(l.phone) || l.phone)}</span>` : ""}</span><span class="hpp-sp"></span><button type="button" class="hpp-mini" data-l="profile">Profile</button>`
        : `<span>No call right now</span>`;
      const ses = session(l?.id), ex = ses?.consent === "agreed" ? ses.ex : null;
      // the consent gate, same as the profile's
      $('[data-r="gate"]', w.body).innerHTML = live && ses && ses.consent === "none"
        ? `<div class="hpp-gate"><b>Read the disclosure first</b><span>“This call may be recorded for quality and training. Do you agree to continue?”</span><div><button type="button" class="btn sm primary" data-l="agree">Client agreed</button><button type="button" class="btn sm" data-l="decline">Client declined</button></div><em>The copilot and the quoter stay off until the client says yes.</em></div>`
        : ses?.consent === "declined" ? `<div class="hpp-alert bad"><b>Client declined recording</b>Copilot is off for this call and nothing from it is kept.</div>` : "";
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
        try { if (!w.built) { VIEWS[x].build(w); w.built = true; } VIEWS[x].update(w); } catch (e) { console.warn("pop-out", x, e); }
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
  addEventListener("hp:copilot", () => { if (following()) fromCall(); paint(); });
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
