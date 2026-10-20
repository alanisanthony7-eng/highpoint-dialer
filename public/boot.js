/* Highpoint Desk boot (Cloudflare): sign-in screen + the small runtime the desk uses
   (saved data, teammate names, lobby presence, Highpoint Bot, downloads), then loads the desk. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  /* connection status: a small pill appears while the desk can't reach the server, and everything resyncs when it's back */
  const net = (() => {
    let down = false, pill = null, onBack = new Set();
    const show = (on) => {
      if (on === down) return; down = on;
      if (!pill) { pill = document.createElement("div"); pill.className = "hp-net"; pill.setAttribute("role", "status"); pill.setAttribute("aria-live", "polite"); document.body.append(pill); }
      pill.innerHTML = on ? `<i></i>Reconnecting… your changes will save when you're back online` : `<i class="ok"></i>Back online`;
      pill.classList.toggle("show", true); pill.classList.toggle("ok", !on);
      if (!on) { onBack.forEach((f) => { try { f(); } catch {} }); setTimeout(() => !down && pill.classList.remove("show"), 1800); }
    };
    addEventListener("offline", () => show(true)); addEventListener("online", () => show(false));
    return { fail: () => show(true), ok: () => down && show(false), onBack: (f) => onBack.add(f), get down() { return down; } };
  })();
  async function call(path, { method = "GET", body } = {}) {
    let r;
    for (let i = 0; ; i++) {
      try { r = await fetch(path, { method, credentials: "same-origin", headers: body !== undefined ? { "content-type": "application/json" } : {}, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) }); net.ok(); break; }
      catch (e) { net.fail(); if (method !== "GET" && method !== "PUT" && method !== "DELETE" || i >= 2) throw Object.assign(new Error("You're offline. Check your connection and try again."), { status: 0 }); await new Promise((res) => setTimeout(res, 800 * (i + 1))); }
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || `Request failed (${r.status})`); e.status = r.status; e.code = j.code; throw e; }
    return j;
  }
  const clone = (v) => (v == null ? v : structuredClone(v));
  const visible = () => document.visibilityState === "visible";
  const deskShell = () => [document.querySelector(".rail"), document.querySelector("main"), document.querySelector("#drawer"), document.querySelector("#scrim")].filter(Boolean);
  function setDeskAvailable(on) {
    deskShell().forEach((el) => {
      el.inert = !on;
      if (on) {
        el.removeAttribute("aria-hidden");
        if (el.dataset.hpGateHidden) { el.hidden = false; delete el.dataset.hpGateHidden; }
      } else {
        el.setAttribute("aria-hidden", "true");
        if (!el.hidden) { el.hidden = true; el.dataset.hpGateHidden = "1"; }
      }
    });
  }

  /* ---------- saved data ---------- */
  class Col {
    constructor(name) { this.name = name; this.docs = new Map(); this.version = ""; this.listeners = new Set(); this.loaded = false; this.gen = 0; }
    snap() { const docs = [...this.docs.entries()].map(([id, v]) => ({ id, exists: true, data: () => clone(v) })); return { docs, size: docs.length, empty: !docs.length }; }
    emit() { const s = this.snap(); this.listeners.forEach((l) => { try { l.cb(s); } catch (e) { console.error(e); } }); }
    async refresh() {
      const g = this.gen;
      try {
        const r = await call(`/api/docs/${this.name}?v=${encodeURIComponent(this.version)}`);
        if (g !== this.gen) return;
        if (r.unchanged) { if (!this.loaded) { this.loaded = true; this.emit(); } return; }
        this.docs = new Map(r.docs.map((d) => [d.id, d.data])); this.version = r.version; this.loaded = true; this.emit();
      } catch (e) { this.listeners.forEach((l) => l.err?.(e)); if (e.status === 401) location.reload(); }
    }
    onSnapshot(cb, err) { const l = { cb, err }; this.listeners.add(l); if (this.loaded) cb(this.snap()); else this.refresh(); return () => this.listeners.delete(l); }
    async write(id, method, data) {
      this.gen++; if (method === "PUT") this.docs.set(id, clone(data)); else this.docs.delete(id); this.version = ""; this.emit();
      try { await call(`/api/docs/${this.name}/${encodeURIComponent(id)}`, { method, body: method === "PUT" ? JSON.stringify(data) : undefined }); }
      catch (e) { this.gen++; this.refresh(); throw e; }
    }
    doc(id) {
      return {
        id,
        set: (d) => this.write(id, "PUT", d),
        delete: () => this.write(id, "DELETE"),
        get: async () => { if (!this.loaded) await this.refresh(); const v = this.docs.get(id); return { id, exists: v !== undefined, data: () => clone(v) }; },
        onSnapshot: (cb, err) => this.onSnapshot((s) => { const v = this.docs.get(id); cb({ id, exists: v !== undefined, data: () => clone(v) }); }, err),
      };
    }
  }
  const cols = new Map();
  const col = (n) => { if (!cols.has(n)) cols.set(n, new Col(n)); return cols.get(n); };
  // one request checks every open collection; only the ones that changed come back
  let syncing = false;
  async function syncAll() {
    if (syncing || !visible()) return; const live = [...cols.values()].filter((c) => c.listeners.size && c.loaded);
    if (!live.length) return; syncing = true;
    const gens = new Map(live.map((c) => [c.name, c.gen]));
    try {
      const r = await call("/api/docs/_sync?c=" + live.map((c) => `${c.name}:${c.version}`).join(","));
      for (const c of live) { const x = r.cols?.[c.name]; if (!x || gens.get(c.name) !== c.gen) continue; if (x.unchanged) continue; c.docs = new Map(x.docs.map((d) => [d.id, d.data])); c.version = x.version; c.emit(); }
    } catch (e) { if (e.status === 401) location.reload(); }
    finally { syncing = false; }
  }
  setInterval(syncAll, 6000);
  document.addEventListener("visibilitychange", () => { if (visible()) syncAll(); });
  net.onBack(() => { cols.forEach((c) => c.listeners.size && (c.loaded ? null : c.refresh())); syncAll(); });
  const db = { collection: col, doc: (path) => { const [c, id] = String(path).split("/"); return col(c).doc(id); } };

  /* ---------- people + lobby ---------- */
  let ME = null;
  const user = { id: async () => ME.id, profiles: async (ids) => call("/api/users?ids=" + ids.map(encodeURIComponent).join(",")) };
  const room = (() => {
    const peerCbs = new Set(), topicCbs = new Map(); let last = null, pTimer = 0, eTimer = 0;
    const pollPeers = async () => { if (!peerCbs.size || !visible()) return; try { const r = await call("/api/room/peers"); peerCbs.forEach((cb) => cb({ peers: r.peers })); } catch {} };
    const pollEvents = async () => {
      if (!topicCbs.size || !visible()) return;
      try {
        const r = await call("/api/room/events" + (last == null ? "" : "?after=" + last));
        if (last == null) { last = r.last || 0; return; }
        for (const e of r.events) { last = Math.max(last, e.id); (topicCbs.get(e.topic) || []).forEach((cb) => cb({ data: e.data, by: e.by, isMe: e.isMe, at: e.at })); }
      } catch {}
    };
    return {
      presence: (() => { let lastKey = "", lastAt = 0, t = 0; return (state) => { const k = state?.status || ""; const now = Date.now(); if (k === lastKey && now - lastAt < 45000) return Promise.resolve(); clearTimeout(t); return new Promise((res) => { t = setTimeout(() => { lastKey = k; lastAt = Date.now(); call("/api/room/presence", { method: "POST", body: state }).then(pollPeers).catch(() => {}).finally(res); }, 1200); }); }; })(),
      onPeers(cb) { peerCbs.add(cb); if (!pTimer) pTimer = setInterval(pollPeers, 20000); pollPeers(); return () => peerCbs.delete(cb); },
      on(topic, cb) { if (!topicCbs.has(topic)) topicCbs.set(topic, []); topicCbs.get(topic).push(cb); if (!eTimer) eTimer = setInterval(pollEvents, 10000); pollEvents(); return () => {}; },
      emit: (topic, data) => call("/api/room/emit", { method: "POST", body: { topic, data } }),
    };
  })();
  setInterval(() => { if (visible() && ME) call("/api/room/presence", { method: "POST", body: { status: "Online", at: Date.now() } }).catch(() => {}); }, 60000);

  /* ---------- Highpoint Bot ---------- */
  async function sample(turns, opts = {}) {
    const msgs = (Array.isArray(turns) ? turns : [{ role: "user", content: String(turns) }]).map((t) => ({ role: t.role === "assistant" ? "assistant" : "user", content: typeof t.content === "string" ? t.content : JSON.stringify(t.content) }));
    try {
      const r = await fetch("/api/ai", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: msgs, system: opts.system, mode: opts.mode }), signal: opts.signal });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.error || "Assistant unavailable"), { code: j.code || (r.status === 429 ? "rate_limited" : "error") });
      opts.onText?.({ text: j.text }); return { text: j.text };
    } catch (e) { if (e.name === "AbortError") throw Object.assign(new Error("Stopped"), { code: "cancelled", text: "" }); throw e; }
  }

  /* ---------- downloads ---------- */
  const downloads = {
    async save({ filename, data, mimeType }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType || (/\.csv$/i.test(filename) ? "text/csv" : "application/octet-stream") });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    },
  };
  window.claude = { use: async (k) => ({ db, user, room, sample, downloads })[k] ?? null };

  /* ---------- sign-in screen ---------- */
  const css = `
  #hpGate{position:fixed;inset:0;z-index:1000;overflow-y:auto;color:#F4F5F8;font-family:var(--f-ui,"Inter",system-ui,sans-serif);background:#141E4A}
  #hpGate .gx-bg{position:fixed;inset:0;z-index:0;pointer-events:none}
  #hpGate .gx-bg .vscene{display:block!important;position:absolute!important;inset:0}
  #hpGate .gx-bg::after{content:"";position:absolute;inset:0;z-index:2;background:linear-gradient(90deg,rgba(5,6,16,.84) 0%,rgba(5,6,16,.5) 46%,rgba(5,6,16,.06) 100%),linear-gradient(0deg,rgba(5,6,16,.55) 0%,rgba(5,6,16,0) 35%)}
  #hpGate .gx-content{position:relative;z-index:1;min-height:100%}
  #hpGate .gx{min-height:100vh;min-height:100dvh;box-sizing:border-box;display:grid;grid-template-columns:minmax(0,1.15fr) minmax(340px,440px);gap:48px;align-items:center;padding:calc(48px + env(safe-area-inset-top)) max(clamp(20px,6vw,96px),env(safe-area-inset-right)) calc(48px + env(safe-area-inset-bottom)) max(clamp(20px,6vw,96px),env(safe-area-inset-left))}
  #hpGate .gx-hero{display:flex;flex-direction:column;gap:22px;max-width:620px;animation:gxIn .7s cubic-bezier(.2,.8,.2,1) both}
  #hpGate .gx-lock{display:flex;align-items:center;gap:16px}
  #hpGate .gx-lock svg{width:96px;height:auto;filter:drop-shadow(0 6px 18px rgba(0,0,0,.5))}
  #hpGate .gx-lock div{display:flex;flex-direction:column;line-height:1}
  #hpGate .gx-lock b{font:900 30px "Montserrat",var(--f-ui,system-ui);letter-spacing:.18em;font-style:italic}
  #hpGate .gx-lock span{font:400 13px "Libre Caslon Text",Georgia,serif;letter-spacing:.55em;color:#FF9E3D;margin-top:8px}
  #hpGate h1{margin:0;font:900 italic clamp(44px,6.2vw,88px)/.95 "Montserrat",var(--f-ui,system-ui);letter-spacing:-.02em;text-transform:uppercase;text-wrap:balance;
    background:linear-gradient(180deg,#FFFFFF 0%,#FFE1EF 55%,#FFB36B 100%);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 6px 24px rgba(255,46,136,.35))}
  #hpGate .gx-sub{margin:0;font-size:17px;line-height:1.55;color:#D9DCE3;max-width:52ch}
  #hpGate .gx-chips{display:flex;flex-wrap:wrap;gap:10px}
  #hpGate .gx-chips span{display:inline-flex;align-items:center;gap:8px;padding:9px 14px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);font-size:13.5px;font-weight:600;backdrop-filter:blur(6px)}
  #hpGate .gx-chips i{width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,#FF2E88,#FF9E3D);box-shadow:0 0 10px #FF2E88}
  #hpGate .g-card{display:flex;flex-direction:column;gap:14px;padding:30px 28px 26px;border-radius:24px;background:rgba(6,7,14,.78);border:1px solid rgba(255,255,255,.13);
    box-shadow:0 40px 90px rgba(0,0,0,.6),inset 0 1px 0 rgba(255,255,255,.06);backdrop-filter:blur(18px);position:relative;overflow:hidden;animation:gxIn .7s .08s cubic-bezier(.2,.8,.2,1) both}
  #hpGate .g-card::before{content:"";position:absolute;inset:0 0 auto 0;height:3px;background:linear-gradient(90deg,#FF2E88,#FF9E3D)}
  #hpGate .g-card h2{margin:0;font:800 24px var(--f-ui,system-ui);letter-spacing:-.01em}
  #hpGate .g-card .g-lead{margin:-6px 0 4px;font-size:14px;color:#AEB3BF}
  #hpGate .g-sw{display:flex;gap:6px;font-size:13.5px;color:#AEB3BF;justify-content:center}
  #hpGate .g-sw a{color:#FF9E3D;font-weight:700;cursor:pointer;text-decoration:none}
  #hpGate .g-sw a:hover,#hpGate .g-sw a:focus-visible{text-decoration:underline;outline:none}
  #hpGate label{display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:#C9CDD5;font-weight:700;letter-spacing:.02em}
  #hpGate .g-in{all:unset;box-sizing:border-box;width:100%;padding:13px 15px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);font-size:15px;color:#fff;transition:border-color .15s,box-shadow .15s}
  #hpGate .g-in::placeholder{color:#7D8494}
  #hpGate .g-in:focus{border-color:#FF4FA3;box-shadow:0 0 0 3px rgba(255,79,163,.22)}
  #hpGate .g-pw{position:relative}
  #hpGate .g-eye{all:unset;cursor:pointer;position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:12px;font-weight:700;color:#AEB3BF;padding:4px 6px;border-radius:6px}
  #hpGate .g-eye:hover{color:#fff}
  #hpGate .g-go{all:unset;cursor:pointer;box-sizing:border-box;text-align:center;padding:14px;border-radius:999px;font-weight:800;font-size:15.5px;color:#fff;background:linear-gradient(90deg,#FF2E88,#FF9E3D);box-shadow:0 12px 30px rgba(255,46,136,.35);transition:transform .15s,filter .15s}
  #hpGate .g-go:hover{transform:translateY(-1px);filter:brightness(1.06)}
  #hpGate .g-go:disabled{opacity:.65;cursor:default;transform:none}
  #hpGate .g-go:focus-visible,#hpGate .g-eye:focus-visible{outline:2px solid #fff;outline-offset:3px}
  #hpGate .g-err{margin:0;padding:10px 12px;border-radius:10px;background:rgba(255,90,106,.14);border:1px solid rgba(255,90,106,.45);font-size:13.5px;color:#FFD2D7}
  #hpGate .g-agree{flex-direction:row;align-items:flex-start;gap:10px;font-weight:500;font-size:12.5px;line-height:1.5;letter-spacing:0;color:#C9CDD5}
  #hpGate .g-agree input{margin-top:2px;width:17px;height:17px;flex:none;accent-color:#FF2E88}
  #hpGate .g-agree a{color:#FF9E3D}
  #hpGate .g-fine{margin:2px 0 0;font-size:12px;color:#8C92A0;text-align:center;line-height:1.5}
  #hpGate .g-fine a,#hpGate .g-forgot{color:#C9CDD5;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
  #hpGate .g-fine a:hover{color:#fff}
  #hpGate .g-ok{margin:0;padding:10px 12px;border-radius:10px;background:rgba(59,211,139,.12);border:1px solid rgba(59,211,139,.4);font-size:13.5px;color:#C9F5DD}
  #hpGate .gx-foot{position:fixed;left:max(clamp(20px,6vw,96px),env(safe-area-inset-left));bottom:calc(18px + env(safe-area-inset-bottom));font-size:12px;color:rgba(255,255,255,.55)}
  @keyframes gxIn{from{opacity:0;transform:translateY(14px)}}
  @media (max-width:900px){#hpGate .gx-bg::after{background:rgba(5,6,16,.6)}#hpGate .gx{grid-template-columns:1fr;gap:26px;padding:32px 18px 60px;align-content:start}
    #hpGate h1{font-size:clamp(38px,11vw,56px)}#hpGate .gx-sub{font-size:15px}#hpGate .gx-lock svg{width:72px}#hpGate .gx-lock b{font-size:24px}#hpGate .gx-foot{position:static;padding:0 18px 20px}}
  @media (max-width:480px){#hpGate .gx{padding:calc(18px + env(safe-area-inset-top)) max(14px,env(safe-area-inset-right)) calc(24px + env(safe-area-inset-bottom)) max(14px,env(safe-area-inset-left));gap:14px}
    #hpGate .gx-hero{gap:8px}#hpGate .gx-hero .gx-lock{justify-content:center}#hpGate .gx-hero h1{font-size:clamp(30px,10vw,42px);text-align:center}#hpGate .gx-hero .gx-sub{display:none}#hpGate .gx-hero .gx-chips{display:none}
    #hpGate .g-card{padding:24px 18px 20px;border-radius:20px}#hpGate .gx-foot{padding:0 14px calc(14px + env(safe-area-inset-bottom));text-align:center}}
  @media (prefers-reduced-motion:reduce){#hpGate .gx-hero,#hpGate .g-card{animation:none}}
  .hp-net{position:fixed;left:50%;bottom:22px;z-index:2000;transform:translate(-50%,30px);opacity:0;pointer-events:none;display:flex;align-items:center;gap:10px;padding:10px 16px;border-radius:999px;font:600 13px var(--f-ui,system-ui);color:#fff;background:rgba(14,10,24,.92);border:1px solid rgba(255,79,163,.45);box-shadow:0 12px 30px rgba(0,0,0,.5),0 0 18px -6px rgba(255,46,136,.7);transition:transform .3s cubic-bezier(.2,.8,.2,1),opacity .3s}
  .hp-net.show{transform:translate(-50%,0);opacity:1}
  .hp-net i{width:9px;height:9px;border-radius:50%;background:#FF9E3D;box-shadow:0 0 10px #FF9E3D;animation:hpNetP 1s ease-in-out infinite}
  .hp-net.ok{border-color:rgba(59,211,139,.5)}.hp-net i.ok{background:#3BD38B;box-shadow:0 0 10px #3BD38B;animation:none}
  @keyframes hpNetP{50%{opacity:.35}}
  .hp-acct{position:relative;display:inline-flex;align-items:center;margin-left:4px;flex:none}
  .hp-acct-b{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:8px;padding:3px 10px 3px 3px;border-radius:999px;font-size:13px;font-weight:600;color:#E4E6EC;border:1px solid transparent;white-space:nowrap}
  .hp-acct-b:hover,.hp-acct-b[aria-expanded=true]{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.12)}
  .hp-acct-b:focus-visible{outline:2px solid #FF4FA3;outline-offset:2px}
  .hp-acct-b svg{width:14px;height:14px;opacity:.7}
  .hp-acct i{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-style:normal;font-weight:800;background:linear-gradient(135deg,#FF2E88,#FF9E3D);color:#fff;flex:none}
  .hp-acct-m{position:absolute;right:0;top:calc(100% + 8px);z-index:1200;min-width:220px;padding:6px;border-radius:14px;background:rgba(16,10,26,.97);border:1px solid rgba(255,79,163,.35);box-shadow:0 18px 40px rgba(0,0,0,.55);backdrop-filter:blur(12px)}
  .hp-acct-m[hidden]{display:none}
  .hp-acct-who{display:flex;flex-direction:column;gap:2px;padding:8px 10px 10px;margin-bottom:4px;border-bottom:1px solid rgba(255,255,255,.08);font-size:13px}
  .hp-acct-who span{font-size:12px;color:#8C92A0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .hp-acct-m button{all:unset;cursor:pointer;display:block;box-sizing:border-box;width:100%;padding:9px 10px;border-radius:9px;font-size:13.5px;color:#E4E6EC}
  .hp-acct-m button:hover,.hp-acct-m button:focus-visible{background:rgba(255,79,163,.14);color:#fff}
  .hp-acct-m button small{display:block;margin-top:2px;font-size:11.5px;color:#9BA1AE}
  @media (max-width:1100px){.hp-acct-b span,.hp-acct-b svg{display:none}.hp-acct-b{padding:2px}}`;
  const st = document.createElement("style"); st.textContent = css; document.head.append(st);

  const MARK = `<svg viewBox="0 0 132 96" aria-hidden="true"><text x="18" y="66" font-family="Libre Caslon Text, Georgia, serif" font-size="70" fill="#FFFFFF">H</text><text x="58" y="86" font-family="Libre Caslon Text, Georgia, serif" font-size="70" fill="#FFFFFF">P</text><path d="M4 80 C40 74 78 56 112 22 C82 58 44 78 4 80Z" fill="#FFFFFF"/><g class="hp-jet" transform="translate(111.2 14.8) rotate(-38)"><path fill="#FFFFFF" d="M-2 4.15 H13.4 C16 4.15 17.7 3.55 18.6 4.15 17.7 4.75 16 5.25 13.4 5.25 H-2Z"/><path fill="#FFFFFF" d="M6.2 4.7 9.7-.5 11.8 4.7 9.7 9.9Z"/><path fill="#FF9E3D" d="M-2.4 4.7 2.2 1.7v6Z"/><path fill="#FFFFFF" d="M16.4 4.15 19.6 3.15v2Z"/></g></svg>`;
  function gate(msg, opts = {}) {
    const inviteToken = new URLSearchParams(location.search).get("invite") || "";
    let mode = opts.mode || (inviteToken ? "up" : "in"), showPw = false, inviteInfo = null, ticket = null, info = "", recov = false;
    const resetToken = opts.reset || "";
    if (inviteToken) call("/api/auth/invite?code=" + encodeURIComponent(inviteToken)).then((r) => { inviteInfo = r; draw(""); }).catch((e) => { inviteInfo = { error: e.message }; draw(""); });
    const keep = {};
    const g = document.createElement("div"); g.id = "hpGate"; g.setAttribute("role", "dialog"); g.setAttribute("aria-modal", "true"); g.setAttribute("aria-label", "Sign in to Highpoint");
    g.innerHTML = `<div class="gx-bg"></div><button class="g-theme" type="button" aria-label="Choose appearance">Appearance</button><div class="gx-content"></div>`;
    // borrow the desk's live sunset scene (its gradients only paint when it isn't inside the hidden desk)
    const scene = document.querySelector(".vscene"), home = scene && { parent: scene.parentNode, next: scene.nextSibling };
    if (scene) $(".gx-bg", g).append(scene);
    g.giveBack = () => { if (scene && home) home.parent.insertBefore(scene, home.next); };
    document.body.append(g);
    $(".g-theme", g).onclick = (e) => window.hpTheme?.openPicker(e.currentTarget);
    const box = $(".gx-content", g);
    const HERO = `        <section class="gx-hero">
          <div class="gx-lock">${MARK}<div><b>HIGHPOINT</b><span>FINANCIAL</span></div></div>
          <h1>Elevate Your Future.</h1>
          <p class="gx-sub">The Highpoint agent desk. Your leads, your dialer, your quotes and follow-ups for Final Expense, Mortgage Protection and IUL, in one place.</p>
          <div class="gx-chips"><span><i></i>3-line power dialer</span><span><i></i>Local caller ID</span><span><i></i>Private lead CRM</span><span><i></i>FE · MP · IUL quotes</span></div>
        </section>`;
    const PLAN = { early: "Early Access", base: "Base", plus: "Pro", full: "Full Access", starter: "Base", pro: "Full Access" };
    const leave = (u) => { g.style.transition = "opacity .35s"; g.style.opacity = "0"; setTimeout(() => { g.giveBack(); g.remove(); }, 360); start(u); };
    // forgot password, the reset link, and the second step of two-factor sign-in
    const special = (err) => {
      const card = mode === "forgot"
        ? `<h2>Reset your password</h2><p class="g-lead">Enter the email you sign in with. We'll email you a link to choose a new password.</p>
           <label for="gEmail">Email<input class="g-in" id="gEmail" type="email" autocomplete="email" placeholder="you@example.com" value="${esc(keep.gEmail || "")}"></label>
           ${err ? `<p class="g-err" role="alert">${esc(err)}</p>` : ""}<button class="g-go" type="submit">Email me a link</button>
           <p class="g-sw">Remembered it? <a data-m="in" tabindex="0" role="button">Sign in</a></p>`
        : mode === "sent"
        ? `<h2>Check your email</h2><p class="g-lead">If there's a Highpoint login for <b>${esc(keep.gEmail || "that email")}</b>, a link to reset your password is on its way. It works for one hour.</p>
           <p class="g-fine" style="text-align:left">Nothing after a few minutes? Check spam, or ask your Highpoint admin to reset it.</p>
           <p class="g-sw"><a data-m="in" tabindex="0" role="button">Back to sign in</a></p>`
        : mode === "reset"
        ? `<h2>Choose a new password</h2><p class="g-lead">At least 8 characters. You'll be signed out everywhere else.</p>
           <label for="gPw">New password<span class="g-pw"><input class="g-in" id="gPw" type="${showPw ? "text" : "password"}" autocomplete="new-password" placeholder="At least 8 characters" style="padding-right:64px"><button type="button" class="g-eye" aria-label="${showPw ? "Hide" : "Show"} password">${showPw ? "Hide" : "Show"}</button></span></label>
           <label for="gPw2">Type it again<input class="g-in" id="gPw2" type="${showPw ? "text" : "password"}" autocomplete="new-password"></label>
           ${err ? `<p class="g-err" role="alert">${esc(err)}</p>` : ""}<button class="g-go" type="submit">Save and sign in</button>`
        : `<h2>Two-step verification</h2><p class="g-lead">${recov ? "Enter one of the recovery codes you saved when you turned on two-step verification." : "Enter the 6-digit code from your authenticator app."}</p>
           <label for="gCode2">${recov ? "Recovery code" : "Code"}<input class="g-in" id="gCode2" ${recov ? 'autocomplete="off" placeholder="abcde-12345"' : 'inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" style="letter-spacing:.3em;font-size:20px;text-align:center"'}></label>
           ${err ? `<p class="g-err" role="alert">${esc(err)}</p>` : ""}<button class="g-go" type="submit">Verify</button>
           <p class="g-sw"><a data-recov tabindex="0" role="button">${recov ? "Use my authenticator app" : "Use a recovery code instead"}</a></p>
           <p class="g-fine">Lost your phone? Your Highpoint admin can turn two-step verification off for your login.</p>`;
      box.innerHTML = `<div class="gx">${HERO}<form class="g-card" novalidate>${card}</form></div><p class="gx-foot">© ${new Date().getFullYear()} Highpoint Financial</p>`;
      g.querySelectorAll("[data-m]").forEach((b) => { const go = () => { mode = b.dataset.m; draw(""); }; b.onclick = go; b.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }; });
      const rv = $("[data-recov]", g); if (rv) rv.onclick = () => { recov = !recov; draw(""); };
      const eye = $(".g-eye", g); if (eye) eye.onclick = () => { const a = $("#gPw").value, b2 = $("#gPw2").value; showPw = !showPw; draw(err); $("#gPw").value = a; $("#gPw2").value = b2; $("#gPw").focus(); };
      const cd = $("#gCode2", g); if (cd && !recov) cd.oninput = () => { cd.value = cd.value.replace(/\D/g, "").slice(0, 6); if (cd.value.length === 6) $("form", g).requestSubmit(); };
      $("form", g).onsubmit = async (e) => {
        e.preventDefault();
        const btn = $(".g-go", g); if (!btn || btn.disabled) return; btn.disabled = true;
        try {
          if (mode === "forgot") {
            keep.gEmail = $("#gEmail").value.trim(); btn.textContent = "Sending…";
            const r = await call("/api/auth/forgot", { method: "POST", body: { email: keep.gEmail } });
            if (r.email === false) { draw("Password emails aren't set up for your team yet. Ask your Highpoint admin to reset your password."); return; }
            mode = "sent"; draw("");
          } else if (mode === "reset") {
            const a = $("#gPw").value, b2 = $("#gPw2").value;
            if (a.length < 8) { draw("Use at least 8 characters."); return; }
            if (a !== b2) { draw("Those two passwords don't match."); return; }
            btn.textContent = "Saving…";
            const r = await call("/api/auth/reset-password", { method: "POST", body: { token: resetToken, password: a } });
            history.replaceState(null, "", location.pathname);
            if (r.user) leave(r.user); else { mode = "in"; info = "Password changed. Sign in with your new password."; draw(""); }
          } else if (mode === "2fa") {
            btn.textContent = "Checking…";
            const r = await call("/api/auth/2fa-login", { method: "POST", body: { ticket, code: $("#gCode2").value.trim() } });
            leave(r.user);
            if (r.recoveryLeft != null && r.recoveryLeft <= 2) setTimeout(() => window.hpDesk?.toast?.(`You have ${r.recoveryLeft} recovery code${r.recoveryLeft === 1 ? "" : "s"} left. Make new ones in Security.`), 4000);
          }
        } catch (er) { if (er.code === "expired") { mode = "in"; ticket = null; } draw(er.message); }
      };
      setTimeout(() => (g.querySelector("#gCode2") || g.querySelector("#gPw") || g.querySelector("#gEmail"))?.focus(), 30);
    };
    const draw = (err = msg || "") => {
      ["gName", "gEmail", "gCode"].forEach((id) => { const el = document.getElementById(id); if (el) keep[id] = el.value; });
      const agreeEl = document.getElementById("gAgree"); if (agreeEl) keep.gAgree = agreeEl.checked;
      if (["forgot", "sent", "reset", "2fa"].includes(mode)) return special(err);
      const up = mode === "up";
      box.innerHTML = `<div class="gx">
${HERO}
        <form class="g-card" novalidate>
          <h2>${up ? "Join the Highpoint team" : "Welcome back"}</h2>
          <p class="g-lead">${up ? (inviteToken ? (inviteInfo?.error ? "" : `You're invited to the Highpoint desk${inviteInfo?.plan ? ` (${PLAN[inviteInfo.plan] || "Full Access"} plan)` : ""}. Create your agent login.`) : "Create your agent login. You'll need the team code from your admin.") : "Sign in to pick up where you left off."}</p>
          ${up && inviteInfo?.error ? `<p class="g-err" role="alert">${esc(inviteInfo.error)}</p>` : ""}
          ${up ? `<label for="gName">Full name<input class="g-in" id="gName" autocomplete="name" placeholder="First and last name" value="${esc(keep.gName || "")}"></label>` : ""}
          <label for="gEmail">Email<input class="g-in" id="gEmail" type="email" autocomplete="email" placeholder="you@example.com" value="${esc(keep.gEmail || "")}"></label>
          <label for="gPw">Password<span class="g-pw"><input class="g-in" id="gPw" type="${showPw ? "text" : "password"}" autocomplete="${up ? "new-password" : "current-password"}" placeholder="${up ? "At least 8 characters" : "Your password"}" style="padding-right:64px"><button type="button" class="g-eye" aria-label="${showPw ? "Hide" : "Show"} password">${showPw ? "Hide" : "Show"}</button></span></label>
          ${up && !inviteToken ? `<label for="gCode">Team code<input class="g-in" id="gCode" autocomplete="off" placeholder="From your Highpoint admin" value="${esc(keep.gCode || "")}"></label>` : ""}
          ${up ? `<label class="g-agree" for="gAgree"><input type="checkbox" id="gAgree" ${keep.gAgree ? "checked" : ""}><span>I agree to the <a href="/terms.html" target="_blank" rel="noopener">Terms of Service</a> and <a href="/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>, and I'm responsible for following calling and texting laws (TCPA, Do Not Call, recording consent).</span></label>` : ""}
          ${err ? `<p class="g-err" role="alert">${esc(err)}</p>` : info && !up ? `<p class="g-ok" role="status">${esc(info)}</p>` : ""}
          <button class="g-go" type="submit">${up ? "Create my account" : "Sign in"}</button>
          <p class="g-sw">${up ? `Already on the team? <a data-m="in" tabindex="0" role="button">Sign in</a>` : `New agent? <a data-m="up" tabindex="0" role="button">Create an account</a>`}</p>
          <p class="g-fine">${up ? "Your leads are private to your login. Nobody else on the team sees them." : `<a data-m="forgot" tabindex="0" role="button" class="g-forgot">Forgot your password?</a>`}</p>
        </form>
      </div>
      <p class="gx-foot">© ${new Date().getFullYear()} Highpoint Financial</p>`;
      g.querySelectorAll("[data-m]").forEach((b) => { const go = () => { mode = b.dataset.m; draw(""); }; b.onclick = go; b.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } }; });
      $(".g-eye", g).onclick = () => { const v = $("#gPw").value; showPw = !showPw; draw(err); $("#gPw").value = v; $("#gPw").focus(); };
      const f = $("form", g);
      f.onsubmit = async (e) => {
        e.preventDefault();
        const btn = $(".g-go", g); btn.disabled = true; btn.textContent = up ? "Creating your account…" : "Signing in…";
        const pw = $("#gPw").value;
        try {
          const email = $("#gEmail").value.trim();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { draw("Enter a valid email address."); return; }
          if (up && pw.length < 8) { draw("Use at least 8 characters for your password."); return; }
          const body = { email, password: pw };
          if (up) {
            if (!$("#gAgree").checked) { draw("Please agree to the Terms of Service and Privacy Policy."); return; }
            Object.assign(body, { name: $("#gName").value, invite: $("#gCode")?.value || "", inviteToken, agree: true });
          }
          const r = await call(`/api/auth/${up ? "signup" : "login"}`, { method: "POST", body });
          if (r.twofa) { ticket = r.ticket; keep.gEmail = body.email; mode = "2fa"; recov = false; draw(""); return; }
          if (inviteToken) history.replaceState(null, "", location.pathname);
          info = ""; leave(r.user);
        } catch (er) { draw(er.message); }
      };
      setTimeout(() => (err && $("#gPw")) ? $("#gPw").focus() : ($("#gName") || $("#gEmail"))?.focus(), 30);
    };
    draw();
  }

  function account(u) {
    const row = document.querySelector(".topbar .row"); if (!row || row.querySelector(".hp-acct")) return;
    const a = document.createElement("div"); a.className = "hp-acct";
    a.innerHTML = `<button type="button" class="hp-acct-b" aria-haspopup="menu" aria-expanded="false" aria-label="Account menu"><i aria-hidden="true">${esc((u.name || u.email)[0].toUpperCase())}</i><span>${esc((u.name || u.email).split(" ")[0])}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
      <div class="hp-acct-m" role="menu" hidden><div class="hp-acct-who"><b>${esc(u.name || u.email)}</b><span>${esc(u.email)}</span></div>${u.admin ? `<button type="button" role="menuitem" data-team>Team</button>` : ""}<button type="button" role="menuitem" data-sec>Security<small>${u.twofa ? "Two-step verification is on" : "Password and two-step verification"}</small></button><button type="button" role="menuitem" data-bill>Billing</button><button type="button" role="menuitem" data-look>Appearance<small>${esc(window.hpTheme?.label || "Executive")} theme</small></button><button type="button" role="menuitem" data-out>Sign out</button></div>`;
    const btn = a.querySelector(".hp-acct-b"), menu = a.querySelector(".hp-acct-m");
    const open = (on) => { menu.hidden = !on; btn.setAttribute("aria-expanded", on); if (on) menu.querySelector("[role=menuitem]")?.focus(); };
    btn.onclick = (e) => { e.stopPropagation(); open(menu.hidden); };
    document.addEventListener("click", (e) => { if (!a.contains(e.target)) open(false); });
    a.addEventListener("keydown", (e) => { if (e.key === "Escape") { open(false); btn.focus(); } });
    a.querySelector("[data-bill]").onclick = () => { open(false); window.hpTeam?.openBilling(); };
    a.querySelector("[data-sec]").onclick = () => { open(false); window.hpTeam?.openSecurity(); };
    a.querySelector("[data-look]").onclick = (e) => { open(false); window.hpTheme?.openPicker(e.currentTarget); };
    const tb = a.querySelector("[data-team]"); if (tb) tb.onclick = () => { open(false); window.hpTeam?.openTeam(); };
    a.querySelector("[data-out]").onclick = async () => { try { await call("/api/auth/logout", { method: "POST" }); } finally { location.reload(); } };
    row.append(a);
  }

  function loadTeam() { return window.hpTeam ? Promise.resolve() : new Promise((res) => { const s = document.createElement("script"); s.src = "/hp-team.js"; s.onload = res; s.onerror = res; document.body.append(s); }); }
  async function start(u) {
    await loadTeam();
    if (window.hpTeam) u = await window.hpTeam.ready(u);
    ME = u; window.hpUser = u;
    window.hpTheme?.syncAccess?.(u);
    document.documentElement.classList.remove("gated");
    setDeskAvailable(true);
    account(u);
    call("/api/room/presence", { method: "POST", body: { status: "Online", at: Date.now() } }).catch(() => {});
    // characters load right after sign-in (not on the sign-in screen), then the desk, in order
    for (const src of ["/hp-avatar.js", "/hp-rates.js", "/hp-est.js", "/hp-drugs.js", "/hp-fex-script.js", "/desk-app.js", "/hp-pop.js"]) { if (src === "/hp-avatar.js" && window.hpAvatar) continue; const s = document.createElement("script"); s.src = src; s.async = false; document.body.append(s); }
  }

  async function boot() {
    document.documentElement.classList.add("gated");
    setDeskAvailable(false);
    window.hpNeon?.intro();
    const rt = new URLSearchParams(location.search).get("reset");
    if (rt) { gate("", { mode: "reset", reset: rt }); return; } // a password reset link
    try { const r = await call("/api/auth/me"); start(r.user); }
    catch (e) { gate(e.status === 401 ? "" : e.message || "Highpoint couldn't reach the server. Try again in a moment."); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
