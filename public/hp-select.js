/* Highpoint dropdowns: every <select> on the site opens a dark glass menu that matches the desk
   instead of the browser's white list. The real <select> stays in place (same look, same value,
   same change events), so all existing code keeps working. */
(() => {
  "use strict";
  if (window.__hpSelect) return; window.__hpSelect = true;

  const css = `
  select{color-scheme:dark}
  select[data-hps]{-webkit-appearance:none!important;appearance:none!important;padding-right:38px!important;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%23FF9E3D' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M4 6l4 4 4-4'/%3E%3C/svg%3E")!important;
    background-repeat:no-repeat!important;background-position:right 13px center!important;background-size:14px 14px!important;cursor:pointer}
  select[data-hps][aria-expanded="true"]{border-color:#FF4FA3!important;box-shadow:0 0 0 3px rgba(255,79,163,.2)!important}
  input[type=date],input[type=datetime-local],input[type=time],input[type=month]{color-scheme:dark}
  .hps-menu{position:fixed;z-index:2147483000;min-width:180px;max-width:min(420px,calc(100vw - 16px));max-height:320px;overflow-y:auto;overscroll-behavior:contain;
    padding:6px;border-radius:14px;background:rgba(10,11,18,.97);border:1px solid rgba(255,255,255,.13);
    box-shadow:0 22px 60px rgba(0,0,0,.6),0 0 0 1px rgba(255,46,136,.08);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
    color:#F4F5F8;font:500 14px/1.3 var(--f-ui,"Inter",system-ui,sans-serif);scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.2) transparent;
    animation:hpsIn .14s cubic-bezier(.2,.8,.2,1)}
  .hps-menu.up{animation-name:hpsUp}
  @keyframes hpsIn{from{opacity:0;transform:translateY(-6px) scale(.98)}}
  @keyframes hpsUp{from{opacity:0;transform:translateY(6px) scale(.98)}}
  .hps-opt{display:flex;align-items:center;gap:10px;padding:9px 12px 9px 10px;border-radius:9px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;user-select:none}
  .hps-opt .hps-ck{flex:none;width:16px;height:16px;display:grid;place-items:center;color:#FF4FA3;opacity:0}
  .hps-opt .hps-ck svg{width:14px;height:14px}
  .hps-opt span{overflow:hidden;text-overflow:ellipsis}
  .hps-opt[aria-selected="true"]{color:#fff;font-weight:700}
  .hps-opt[aria-selected="true"] .hps-ck{opacity:1}
  .hps-opt.act{background:linear-gradient(90deg,rgba(255,46,136,.28),rgba(255,158,61,.16))}
  .hps-opt[aria-disabled="true"]{opacity:.38;cursor:default;background:none}
  .hps-grp{padding:10px 12px 4px;font:800 10.5px var(--f-ui,system-ui);letter-spacing:.12em;text-transform:uppercase;color:#9AA1AE}
  .hps-grp:first-child{padding-top:4px}
  .hps-sep{height:1px;margin:4px 6px;background:rgba(255,255,255,.08)}
  @media (prefers-reduced-motion:reduce){.hps-menu{animation:none}}
  @media (prefers-color-scheme:light){.hps-menu{color-scheme:dark}}`;
  const st = document.createElement("style"); st.id = "hps-style"; st.textContent = css; document.head.append(st);

  const CHECK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>';
  let open = null; // {sel, menu, items, act}

  const usable = (sel) => sel instanceof HTMLSelectElement && !sel.multiple && sel.size <= 1 && !sel.disabled && !sel.closest("[data-native-select]");

  function build(sel) {
    const menu = document.createElement("div");
    menu.className = "hps-menu"; menu.setAttribute("role", "listbox");
    menu.id = "hps-" + Math.random().toString(36).slice(2, 8);
    const label = sel.getAttribute("aria-label") || sel.labels?.[0]?.textContent?.trim();
    if (label) menu.setAttribute("aria-label", label);
    const items = [];
    const addOpt = (o) => {
      const d = document.createElement("div");
      d.className = "hps-opt"; d.setAttribute("role", "option"); d.id = menu.id + "-" + items.length;
      d.setAttribute("aria-selected", String(o.selected));
      if (o.disabled || o.parentElement?.disabled) d.setAttribute("aria-disabled", "true");
      d.innerHTML = `<span class="hps-ck">${CHECK}</span><span></span>`;
      d.lastChild.textContent = o.label || o.textContent;
      d._opt = o; items.push(d); return d;
    };
    for (const ch of sel.children) {
      if (ch.tagName === "OPTGROUP") {
        const g = document.createElement("div"); g.className = "hps-grp"; g.textContent = ch.label; g.setAttribute("role", "presentation"); menu.append(g);
        for (const o of ch.children) if (o.tagName === "OPTION" && !o.hidden) menu.append(addOpt(o));
      } else if (ch.tagName === "OPTION" && !ch.hidden) menu.append(addOpt(ch));
      else if (ch.tagName === "HR") { const s = document.createElement("div"); s.className = "hps-sep"; menu.append(s); }
    }
    return { menu, items };
  }

  function place(sel, menu) {
    const r = sel.getBoundingClientRect();
    menu.style.minWidth = Math.max(180, r.width) + "px";
    menu.style.left = "0px"; menu.style.top = "0px";
    const mh = Math.min(menu.scrollHeight, 320), below = innerHeight - r.bottom - 10, above = r.top - 10;
    const up = below < Math.min(mh, 220) && above > below;
    menu.classList.toggle("up", up);
    menu.style.maxHeight = Math.max(140, Math.min(320, up ? above : below)) + "px";
    const w = menu.offsetWidth;
    menu.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + "px";
    menu.style.top = (up ? r.top - Math.min(menu.scrollHeight, parseFloat(menu.style.maxHeight)) - 6 : r.bottom + 6) + "px";
  }

  function setAct(i, scroll = true) {
    if (!open) return;
    const { items } = open; if (!items.length) return;
    open.items.forEach((x) => x.classList.remove("act"));
    open.act = Math.max(0, Math.min(items.length - 1, i));
    const el = items[open.act]; el.classList.add("act");
    open.sel.setAttribute("aria-activedescendant", el.id);
    if (scroll) el.scrollIntoView({ block: "nearest" });
  }
  function step(dir) {
    if (!open) return; let i = open.act;
    for (let n = 0; n < open.items.length; n++) { i += dir; if (i < 0 || i >= open.items.length) return; if (open.items[i].getAttribute("aria-disabled") !== "true") return setAct(i); }
  }

  function show(sel) {
    if (open?.sel === sel) return close();
    close();
    if (!sel.options.length) return;
    const { menu, items } = build(sel);
    document.body.append(menu);
    open = { sel, menu, items, act: -1, typed: "", typedAt: 0 };
    sel.setAttribute("aria-expanded", "true"); sel.setAttribute("aria-controls", menu.id);
    place(sel, menu);
    const cur = items.findIndex((x) => x._opt.selected);
    setAct(cur >= 0 ? cur : items.findIndex((x) => x.getAttribute("aria-disabled") !== "true"));
    menu.addEventListener("pointermove", (e) => { const o = e.target.closest(".hps-opt"); if (o && o.getAttribute("aria-disabled") !== "true") setAct(items.indexOf(o), false); });
    menu.addEventListener("pointerdown", (e) => e.preventDefault());
    menu.addEventListener("click", (e) => { const o = e.target.closest(".hps-opt"); if (o && o.getAttribute("aria-disabled") !== "true") choose(items.indexOf(o)); });
  }
  function choose(i) {
    if (!open) return;
    const { sel, items } = open, o = items[i]?._opt;
    close();
    if (!o || o.disabled) return;
    if (sel.value !== o.value || sel.selectedIndex !== o.index) {
      sel.selectedIndex = o.index;
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    sel.focus({ preventScroll: true });
  }
  function close() {
    if (!open) return;
    open.menu.remove(); open.sel.setAttribute("aria-expanded", "false"); open.sel.removeAttribute("aria-activedescendant");
    open = null;
  }

  // open our menu instead of the browser's
  document.addEventListener("mousedown", (e) => {
    const sel = e.target.closest?.("select");
    if (sel && usable(sel) && e.button === 0) { e.preventDefault(); sel.focus({ preventScroll: true }); show(sel); return; }
    if (open && !e.target.closest?.(".hps-menu")) close();
  }, true);
  document.addEventListener("touchend", (e) => {
    const sel = e.target.closest?.("select");
    if (sel && usable(sel)) { e.preventDefault(); sel.focus({ preventScroll: true }); show(sel); }
  }, { capture: true, passive: false });
  document.addEventListener("keydown", (e) => {
    const sel = e.target;
    if (open && (sel === open.sel || open.menu.contains(sel))) {
      const k = e.key;
      if (k === "ArrowDown") { e.preventDefault(); step(1); }
      else if (k === "ArrowUp") { e.preventDefault(); step(-1); }
      else if (k === "Home") { e.preventDefault(); setAct(0); }
      else if (k === "End") { e.preventDefault(); setAct(open.items.length - 1); }
      else if (k === "PageDown") { e.preventDefault(); setAct(open.act + 8); }
      else if (k === "PageUp") { e.preventDefault(); setAct(open.act - 8); }
      else if (k === "Enter" || k === " " && !open.typed) { e.preventDefault(); choose(open.act); }
      else if (k === "Escape") { e.preventDefault(); e.stopPropagation(); close(); }
      else if (k === "Tab") { choose(open.act); }
      else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault(); const now = Date.now();
        open.typed = (now - open.typedAt < 700 ? open.typed : "") + k.toLowerCase(); open.typedAt = now;
        const i = open.items.findIndex((x) => x.textContent.trim().toLowerCase().startsWith(open.typed) && x.getAttribute("aria-disabled") !== "true");
        if (i >= 0) setAct(i);
      }
      return;
    }
    if (sel instanceof HTMLSelectElement && usable(sel) && (e.key === "Enter" || e.key === " " || (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) || e.key === "F4")) { e.preventDefault(); show(sel); }
  }, true);
  addEventListener("resize", () => open && place(open.sel, open.menu));
  addEventListener("scroll", (e) => { if (open && !open.menu.contains(e.target)) { if (!document.contains(open.sel)) close(); else place(open.sel, open.menu); } }, true);
  document.addEventListener("focusout", () => setTimeout(() => { if (open && document.activeElement !== open.sel && !open.menu.contains(document.activeElement)) close(); }, 0));
  // if the page re-renders and the select disappears, drop the menu
  new MutationObserver(() => { if (open && !document.contains(open.sel)) close(); }).observe(document.documentElement, { childList: true, subtree: true });
  // give every select the right roles for screen readers
  const mark = (root) => root.querySelectorAll?.("select:not([data-hps])").forEach((s) => { if (s.multiple || s.size > 1) return; s.dataset.hps = "1"; s.setAttribute("aria-haspopup", "listbox"); s.setAttribute("aria-expanded", "false"); });
  mark(document); new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && (n.tagName === "SELECT" ? mark(n.parentNode) : mark(n))))).observe(document.documentElement, { childList: true, subtree: true });
})();
