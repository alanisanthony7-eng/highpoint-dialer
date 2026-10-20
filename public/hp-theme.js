/* Highpoint themes v3: Midnight default, owner-only Executive, seasonal Halloween.
   This synchronous bootstrap runs before stylesheets, so the first paint already has the saved theme. */
(() => {
  "use strict";
  if (window.hpTheme) return;
  const KEY = "hp.theme", OWNER_KEY = "hp.theme.owner";
  const DEFAULT = "midnight";
  const THEMES = {
    executive: { id: "executive", label: "Executive", note: "Owner look: black, navy and gold", color: "#070C18", owner: true },
    "modern-light": { id: "modern-light", label: "Modern Light", note: "Daylight slate and cobalt glass", color: "#C5D4E8" },
    midnight: { id: "midnight", label: "Midnight", note: "Near-black, indigo and electric blue", color: "#070A12" },
    miami: { id: "miami", label: "Miami", note: "Pink, coral and sunset neon", color: "#12091C" },
    halloween: { id: "halloween", label: "Halloween", note: "Haunted hangar night", color: "#12080A" },
  };
  const alias = (v) => v === "classic" ? "executive" : v;
  const valid = (v) => Object.prototype.hasOwnProperty.call(THEMES, v);
  const ownerSaved = () => { try { return localStorage.getItem(OWNER_KEY) === "1"; } catch { return false; } };
  const allowed = (id, owner) => valid(id) && (id !== "executive" || owner);
  const list = (owner) => Object.values(THEMES).filter((t) => !t.owner || owner);
  const read = () => {
    try {
      const q = new URLSearchParams(location.search), requested = alias(q.get("theme") || q.get("look"));
      const saved = alias(localStorage.getItem(KEY) || localStorage.getItem("hp.look"));
      const owner = ownerSaved();
      const id = allowed(requested, true) ? requested : allowed(saved, owner) ? saved : DEFAULT;
      localStorage.setItem(KEY, id); localStorage.removeItem("hp.look");
      if (q.has("theme") || q.has("look")) { q.delete("theme"); q.delete("look"); const tail = q.toString(); history.replaceState(null, "", location.pathname + (tail ? "?" + tail : "") + location.hash); }
      return id;
    } catch { return DEFAULT; }
  };
  const meta = () => document.querySelector('meta[name="theme-color"]');
  const api = {
    version: 3, owner: ownerSaved(), look: read(), label: "",
    get themes() { return list(this.owner); },
    set(id) {
      id = alias(id);
      if (!allowed(id, this.owner || ownerSaved())) id = this.look && allowed(this.look, this.owner) ? this.look : DEFAULT;
      if (!valid(id)) id = DEFAULT;
      this.look = id; this.label = THEMES[id].label;
      document.documentElement.dataset.theme = id;
      document.documentElement.style.colorScheme = id === "modern-light" ? "light" : "dark";
      document.title = id === "miami" ? "Highpoint Miami Desk" : id === "halloween" ? "Highpoint Halloween Desk" : "Highpoint Desk";
      try { localStorage.setItem(KEY, id); } catch {}
      const m = meta(); if (m) m.content = THEMES[id].color;
      document.dispatchEvent(new CustomEvent("hp:theme", { detail: THEMES[id] }));
    },
    syncAccess(user) {
      this.owner = !!(user && user.admin);
      try { if (this.owner) localStorage.setItem(OWNER_KEY, "1"); else localStorage.removeItem(OWNER_KEY); } catch {}
      if (this.look === "executive" && !this.owner) this.set(DEFAULT);
    },
    toggle() { const ids = this.themes.map((t) => t.id), i = ids.indexOf(this.look); this.set(ids[(i + 1) % ids.length]); },
    openPicker(anchor) {
      document.querySelector(".hpt-picker")?.remove();
      const d = document.createElement("div"); d.className = "hpt-picker"; d.setAttribute("role", "dialog"); d.setAttribute("aria-modal", "true"); d.setAttribute("aria-label", "Choose appearance");
      d.innerHTML = `<button class="hpt-backdrop" aria-label="Close appearance picker"></button><div class="hpt-box"><div class="hpt-head"><div><b>Choose your look</b><span>Same desk and data, different atmosphere.</span></div><button class="hpt-close" aria-label="Close">×</button></div><div class="hpt-grid">${this.themes.map(t => `<button class="hpt-choice" data-theme-choice="${t.id}" aria-pressed="${t.id === this.look}"><i class="hpt-preview ${t.id}"><span></span><span></span><span></span></i><b>${t.label}</b><small>${t.note}</small></button>`).join("")}</div></div>`;
      const close = () => { d.remove(); anchor?.focus?.(); };
      d.querySelector(".hpt-backdrop").onclick = close; d.querySelector(".hpt-close").onclick = close;
      d.querySelectorAll("[data-theme-choice]").forEach(b => b.onclick = () => { this.set(b.dataset.themeChoice); d.querySelectorAll("[data-theme-choice]").forEach(x => x.setAttribute("aria-pressed", String(x === b))); setTimeout(close, 160); });
      d.onkeydown = e => { if (e.key === "Escape") close(); };
      document.body.append(d); d.querySelector('[aria-pressed="true"]')?.focus();
    },
  };
  window.hpTheme = api;
  api.set(api.look);
})();

/* Legacy recolor fallback retained below for old cached HTML. It exits immediately when v2 is present.
   Highpoint looks: "classic" (Highpoint navy and blue, the default for everyone) and "miami" (pink and orange neon).
   Same desk, same code, same data. The classic look recolors the Miami brand colors as the page loads:
   pinks and magentas become Highpoint blue, purples become navy, oranges become sky blue.
   That covers stylesheets, inline styles and SVG, including anything the desk adds later.
   Left alone: reds and the status colors (good, warning, error), greys, photos and avatars (skin and hair).
   Anyone can switch to Miami with ?look=miami (remembered in that browser), the account menu, or the command palette.
   Must load first in <head>, without defer, so nothing paints in the wrong colors. */
(() => {
  "use strict";
  if (window.hpTheme) return;
  const KEY = "hp.look";
  const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const save = (v) => { try { localStorage.setItem(KEY, v); } catch {} };
  try { const q = new URLSearchParams(location.search).get("look"); if (q === "classic" || q === "miami") save(q); } catch {}
  const look = read() === "miami" ? "miami" : "classic";
  window.hpTheme = {
    look,
    label: look === "classic" ? "Highpoint Classic" : "Miami",
    set(v) { save(v === "classic" ? "classic" : "miami"); try { const u = new URL(location.href); u.searchParams.delete("look"); history.replaceState(null, "", u); } catch {} location.reload(); },
    toggle() { this.set(look === "classic" ? "miami" : "classic"); },
  };
  if (look !== "classic") return;

  const html = document.documentElement;
  html.classList.add("hp-classic");
  // keep the page hidden until it's recolored, so Miami colors never flash
  const veil = document.createElement("style");
  veil.textContent = "html.hp-classic body{visibility:hidden!important}";
  (document.head || html).appendChild(veil);

  /* ---------- color math ---------- */
  // status colors keep their meaning: amber warnings, red errors, and their soft backgrounds
  const KEEP = new Set(["255,181,71", "226,170,94", "50,36,18", "255,90,106", "232,140,118", "54,28,22"]);
  function hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    if (!d) return [0, 0, l];
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60; if (h < 0) h += 360;
    return [h, s, l];
  }
  function rgb(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
    const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  // returns the classic color, or null to leave the color as it is.
  // `scene` = the sunset backdrop, where red is decoration rather than an error color, so it turns blue too
  function shift(r, g, b, scene) {
    if (KEEP.has(`${r},${g},${b}`)) return null;
    const [h, s, l] = hsl(r, g, b);
    if (s < 0.18 || l < 0.03 || l > 0.97) return null; // greys, near-black, near-white
    let to;
    if (h >= 255 && h < 290) to = 226;      // purples and plums → navy
    else if (h >= 290 && h < 345) to = 217; // pinks and magentas → Highpoint blue
    else if (h >= 12 && h < 66) to = 206;   // oranges, ambers, golds → sky blue
    else if (scene && (h >= 345 || h < 12)) to = 217; // sunset reds → blue
    else return null;                       // reds, greens, cyans and blues stay
    return rgb(to, Math.min(1, s * 0.8), l);
  }
  const hex2 = (n) => n.toString(16).padStart(2, "0");
  // #hex colors (but never url(#id) references) and rgb()/rgba() colors
  const HEX = /(?<!url\(\s*["']?)#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi;
  const RGB = /rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*((?:[,/]\s*[\d.]+%?\s*)?)\)/gi;
  const ENC = /%23([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/gi; // colors inside data: URI SVGs ("#" written as %23)
  const hexOut = (pre, scene) => (m, h) => {
    const full = h.length <= 4 ? h.split("").map((c) => c + c).join("") : h;
    const a = full.length === 8 ? full.slice(6) : "";
    const c = shift(parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16), scene);
    return c ? pre + c.map(hex2).join("") + a : m;
  };
  function recolor(str, scene = false) {
    if (!str || (str.indexOf("#") < 0 && str.indexOf("rgb") < 0 && str.indexOf("%23") < 0)) return str;
    return str
      .replace(HEX, hexOut("#", scene))
      .replace(ENC, hexOut("%23", scene))
      .replace(RGB, (m, r, g, b, a) => {
        const c = shift(+r, +g, +b, scene);
        if (!c) return m;
        const alpha = a ? a.replace(/^[,/]\s*/, "").trim() : "";
        return alpha ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})` : `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
      });
  }

  /* ---------- what to leave alone ---------- */
  const KEEPSEL = "[data-hp-keep], .hpa"; // avatars and the character creator keep real skin and hair colors
  const kept = (el) => !!(el && el.closest && el.closest(KEEPSEL));

  /* ---------- stylesheets ---------- */
  const SCENE = /vscene|vsvg/; // the sunset backdrop
  function rules(list) {
    for (const r of list) {
      if (r.style && r.style.cssText) { const t = r.style.cssText, n = recolor(t, SCENE.test(r.selectorText || "")); if (n !== t) r.style.cssText = n; }
      if (r.cssRules) rules(r.cssRules);
    }
  }
  function sheet(s) {
    if (!s) return false; // a <link> that hasn't loaded yet has no sheet: try again on load
    if (s.ownerNode && kept(s.ownerNode)) return true;
    let list; try { list = s.cssRules; } catch { return true; } // another site's stylesheet (fonts): nothing to recolor
    if (!list) return false; // not loaded yet
    rules(list);
    return true;
  }
  const waiting = new Set();
  function styleEl(node) { // <link rel=stylesheet> or <style>
    if (kept(node)) return;
    if (node.tagName === "STYLE") { if (node !== veil) sheet(node.sheet); return; }
    if (!/stylesheet/i.test(node.rel || "") || waiting.has(node)) return;
    if (!sheet(node.sheet)) {
      waiting.add(node);
      const go = () => { waiting.delete(node); sheet(node.sheet); maybeReveal(); };
      node.addEventListener("load", go, { once: true });
      node.addEventListener("error", () => { waiting.delete(node); maybeReveal(); }, { once: true });
    }
  }

  /* ---------- inline styles and SVG paint ---------- */
  const ATTRS = ["style", "fill", "stroke", "stop-color", "flood-color", "lighting-color"];
  const ATTRSEL = ATTRS.map((a) => `[${a}]`).join(",");
  function attrs(el) {
    if (kept(el)) return;
    const scene = !!el.closest(".vscene");
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v) { const n = recolor(v, scene); if (n !== v) el.setAttribute(a, n); }
    }
  }
  function tree(el) {
    if (el.nodeType !== 1 || kept(el)) return;
    if (el.tagName === "STYLE" || el.tagName === "LINK") styleEl(el);
    if (el.hasAttribute && ATTRS.some((a) => el.hasAttribute(a))) attrs(el);
    if (el.firstElementChild) {
      for (const s of el.querySelectorAll("style,link[rel~=stylesheet]")) styleEl(s);
      for (const n of el.querySelectorAll(ATTRSEL)) attrs(n);
    }
  }

  // everything the page adds from here on: parsed markup, desk renders, late stylesheets
  new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "attributes") { attrs(m.target); continue; }
      if (m.target.nodeType === 1 && m.target.tagName === "STYLE") { styleEl(m.target); continue; } // a <style> whose text changed
      for (const n of m.addedNodes) {
        if (n.nodeType === 1) tree(n);
        else if (n.nodeType === 3 && n.parentNode && n.parentNode.tagName === "STYLE") styleEl(n.parentNode);
      }
    }
  }).observe(html, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });

  /* ---------- reveal once the page's own stylesheets are recolored ---------- */
  let ready = false, shown = false;
  function reveal() { if (shown) return; shown = true; veil.remove(); }
  function maybeReveal() { if (ready && !waiting.size) reveal(); }
  setTimeout(reveal, 3000); // never leave the page hidden
  function onReady() {
    for (const s of document.querySelectorAll("style,link[rel~=stylesheet]")) styleEl(s);
    for (const s of document.styleSheets) if (!waiting.has(s.ownerNode)) sheet(s);
    tree(document.body);
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = "#060B16";
    if (/Miami/.test(document.title)) document.title = document.title.replace(/\s*Miami\s*/, " ").trim();
    ready = true; maybeReveal();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onReady, { once: true }); else onReady();

  window.hpTheme.recolor = recolor; // for tests and debugging
})();
