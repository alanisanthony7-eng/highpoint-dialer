/* Highpoint Pro: command palette (Ctrl/⌘ K), readable content layer, smart top bar. */
(() => {
  "use strict";
  if (window.__hpPro) return; window.__hpPro = true;
  document.documentElement.classList.add("hp-pro");
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const d10 = (s) => { let d = String(s || "").replace(/\D/g, ""); if (d.length === 11 && d[0] === "1") d = d.slice(1); return d; };
  const fmt = (s) => { const d = d10(s); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : s || ""; };
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const IC = {
    page: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/></svg>',
    lead: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  };

  // dark layer over the sunset so every page reads cleanly
  const addScrim = () => { if (!$(".hp-scrim")) document.body.insertAdjacentHTML("beforeend", '<div class="hp-scrim" aria-hidden="true"></div>'); };

  /* ---------- command palette ---------- */
  let pal = null;
  function actions() {
    const D = window.hpDesk, go = (v) => () => D?.go(v);
    const click = (sel) => () => $(sel)?.click();
    const list = [
      { t: "New lead", s: "Add a lead by hand", run: click("[data-new]"), k: "new add create lead" },
      { t: "Import leads", s: "Upload a CSV or paste a list", run: go("import"), k: "import csv upload" },
      { t: "Start dialing", s: "Open the power dialer", run: () => { D?.go("dialer"); setTimeout(() => $("#hphGo")?.click(), 300); }, k: "dial call power start" },
      { t: "Pick who to call", s: "Build a campaign from your leads", run: () => { D?.go("dialer"); setTimeout(() => $("#hphPick")?.click(), 300); }, k: "campaign pick list" },
      { t: "Dialer analytics", s: "Dials, conversations, best hours", run: () => { D?.go("dialer"); setTimeout(() => $('[data-hpd="stats"]')?.click(), 300); }, k: "analytics stats report" },
      { t: "Buy a local number", s: "Number groups", run: () => { D?.go("dialer"); setTimeout(() => $('[data-hpd="numbers"]')?.click(), 300); }, k: "number buy phone caller id" },
      { t: window.hpSpotify?.playing ? "Pause music" : "Play music", s: "Spotify", run: () => window.hpSpotify?.togglePlay(), k: "music spotify play pause" },
      { t: "Sign out", s: "End this session", run: () => $(".hp-acct [data-out]")?.click(), k: "logout sign out" },
    ];
    return list;
  }
  function pages() {
    return $$(".rail .nav[data-view]").map((n) => ({ t: n.textContent.trim(), s: "Go to page", run: () => window.hpDesk?.go(n.dataset.view), k: n.textContent.toLowerCase(), view: n.dataset.view }));
  }
  function leadHits(q) {
    const D = window.hpDesk; if (!D || q.length < 2) return [];
    const qd = d10(q), ql = q.toLowerCase();
    return [...D.leads.values()].filter((l) => D.fullName(l).toLowerCase().includes(ql) || (qd.length >= 3 && d10(l.phone).includes(qd)) || String(l.email || "").toLowerCase().includes(ql)).slice(0, 8)
      .map((l) => ({ t: D.fullName(l), s: [fmt(l.phone), l.source, D.stageName(l.stage || "new")].filter(Boolean).join(" · "), run: () => (window.hpDialer?.openProfile ? window.hpDialer.openProfile(l.id) : D.openDrawer(l.id)), lead: true }));
  }
  function openPalette(initial = "") {
    if (pal) return;
    const box = document.createElement("div"); box.className = "hpk"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "Search and jump");
    box.innerHTML = `<div class="hpk-box"><div class="hpk-top">${IC.search}<input id="hpkQ" placeholder="Search leads, pages and actions…" autocomplete="off" aria-controls="hpkList"><span class="hp-kbd">Esc</span></div><div class="hpk-list" id="hpkList" role="listbox"></div><div class="hpk-foot"><span><span class="hp-kbd">↑</span> <span class="hp-kbd">↓</span> move</span><span><span class="hp-kbd">↵</span> open</span><span><span class="hp-kbd">${isMac ? "⌘" : "Ctrl"} K</span> anytime</span></div></div>`;
    document.body.append(box);
    pal = { box, items: [], act: 0 };
    const input = $("#hpkQ", box); input.value = initial;
    const draw = () => {
      const q = input.value.trim(), ql = q.toLowerCase();
      const match = (x) => !ql || x.t.toLowerCase().includes(ql) || x.k?.includes(ql);
      const groups = [["Leads", leadHits(q), IC.lead], ["Actions", actions().filter(match).slice(0, q ? 6 : 5), IC.bolt], ["Pages", pages().filter(match).slice(0, q ? 6 : 12), IC.page]].filter((g) => g[1].length);
      pal.items = []; let html = "";
      for (const [name, list, ic] of groups) {
        html += `<div class="hpk-grp">${name}</div>`;
        for (const it of list) { const i = pal.items.push(it) - 1; html += `<div class="hpk-it" role="option" id="hpk-${i}" data-i="${i}"><span class="ic">${ic}</span><span class="tx"><b>${esc(it.t)}</b><span>${esc(it.s)}</span></span></div>`; }
      }
      $("#hpkList", box).innerHTML = html || `<div class="hpk-empty">Nothing matches “${esc(q)}”.</div>`;
      pal.act = 0; mark();
      $$(".hpk-it", box).forEach((el) => { el.onmousemove = () => { pal.act = +el.dataset.i; mark(false); }; el.onclick = () => run(+el.dataset.i); });
    };
    const mark = (scroll = true) => { $$(".hpk-it", box).forEach((el) => el.classList.toggle("act", +el.dataset.i === pal.act)); const a = $(`#hpk-${pal.act}`, box); if (a) { input.setAttribute("aria-activedescendant", a.id); if (scroll) a.scrollIntoView({ block: "nearest" }); } };
    const run = (i) => { const it = pal.items[i]; closePalette(); it?.run(); };
    input.oninput = draw;
    input.onkeydown = (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); pal.act = Math.min(pal.items.length - 1, pal.act + 1); mark(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); pal.act = Math.max(0, pal.act - 1); mark(); }
      else if (e.key === "Enter") { e.preventDefault(); run(pal.act); }
      else if (e.key === "Escape") { e.preventDefault(); closePalette(); }
    };
    box.onmousedown = (e) => { if (e.target === box) closePalette(); };
    draw(); setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 0);
  }
  function closePalette() { if (!pal) return; pal.box.remove(); pal = null; }
  window.hpPalette = { open: openPalette, close: closePalette };
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); pal ? closePalette() : openPalette(); }
    else if (e.key === "/" && !pal && !e.target.closest?.("input,textarea,select,[contenteditable]")) { e.preventDefault(); openPalette(); }
  });

  // the top-bar search box becomes the palette's front door
  function wireSearch() {
    const si = $("#hpdSearch"); if (!si || si.dataset.pro) return !!si;
    si.dataset.pro = "1"; si.placeholder = "Search or jump to…"; si.readOnly = true;
    si.insertAdjacentHTML("afterend", `<span class="hp-kbd">${isMac ? "⌘" : "Ctrl"} K</span>`);
    const open = (e) => { e.preventDefault(); si.blur(); openPalette(); };
    si.addEventListener("mousedown", open); si.addEventListener("focus", open);
    return true;
  }

  const boot = () => {
    addScrim();
    if (!wireSearch()) { const mo = new MutationObserver(() => { addScrim(); if (wireSearch()) mo.disconnect(); }); mo.observe(document.body, { childList: true, subtree: true }); }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
