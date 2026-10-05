/* Highpoint Desk boot (Cloudflare): sign-in screen + the small runtime the desk uses
   (saved data, teammate names, lobby presence, Highpoint Bot, downloads), then loads the desk. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  async function call(path, { method = "GET", body } = {}) {
    const r = await fetch(path, { method, credentials: "same-origin", headers: body !== undefined ? { "content-type": "application/json" } : {}, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || `Request failed (${r.status})`); e.status = r.status; e.code = j.code; throw e; }
    return j;
  }
  const clone = (v) => (v == null ? v : structuredClone(v));
  const visible = () => document.visibilityState === "visible";

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
  setInterval(() => { if (visible()) cols.forEach((c) => c.listeners.size && c.refresh()); }, 8000);
  document.addEventListener("visibilitychange", () => { if (visible()) cols.forEach((c) => c.listeners.size && c.refresh()); });
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
      presence: (state) => call("/api/room/presence", { method: "POST", body: state }).then(pollPeers),
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
      const r = await fetch("/api/ai", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: msgs, system: opts.system }), signal: opts.signal });
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
  #hpGate{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:16px;overflow:auto;
    background:radial-gradient(120% 80% at 50% 110%,#FF9E3D 0%,#FF2E88 22%,#5A1F8C 48%,#141E4A 72%,#070A18 100%);font-family:var(--f-ui,"Inter",system-ui,sans-serif);color:#F4F5F8}
  #hpGate .g-card{width:min(420px,100%);padding:30px 28px;border-radius:22px;background:rgba(6,8,14,.82);border:1px solid rgba(255,255,255,.12);box-shadow:0 30px 80px rgba(0,0,0,.55);backdrop-filter:blur(14px);display:flex;flex-direction:column;gap:14px}
  #hpGate .g-brand{display:flex;flex-direction:column;align-items:center;gap:2px;margin-bottom:6px}
  #hpGate .g-brand b{font:900 30px/1 "Montserrat",var(--f-ui,system-ui);letter-spacing:.16em;font-style:italic}
  #hpGate .g-brand span{font:600 12px "Libre Caslon Text",Georgia,serif;letter-spacing:.4em;color:#FF9E3D}
  #hpGate .g-brand em{font:400 18px "Kaushan Script",cursive;color:#C9CDD5;margin-top:6px;font-style:normal}
  #hpGate .g-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border-radius:12px;background:rgba(255,255,255,.06)}
  #hpGate .g-tabs button{all:unset;cursor:pointer;text-align:center;padding:9px;border-radius:9px;font-weight:700;font-size:14px;color:#9AA1AE}
  #hpGate .g-tabs button[aria-selected="true"]{background:#fff!important;color:#0B0D12!important;box-shadow:none!important;border:0!important}
  #hpGate .g-tabs button{box-shadow:none!important;border:0!important;background:transparent}
  #hpGate label{display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:#C9CDD5;font-weight:600}
  #hpGate input{all:unset;box-sizing:border-box;width:100%;padding:12px 14px;border-radius:12px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);font-size:15px;color:#fff}
  #hpGate input:focus{border-color:#FF4FA3;box-shadow:0 0 0 3px rgba(255,79,163,.25)}
  #hpGate .g-go{all:unset;cursor:pointer;text-align:center;padding:13px;border-radius:999px;font-weight:800;font-size:15px;color:#fff;background:linear-gradient(90deg,#FF2E88,#FF9E3D);box-shadow:0 10px 26px rgba(255,46,136,.35)}
  #hpGate .g-go:disabled{opacity:.6;cursor:default}
  #hpGate .g-go:focus-visible,#hpGate .g-tabs button:focus-visible{outline:2px solid #fff;outline-offset:2px}
  #hpGate .g-err{margin:0;padding:10px 12px;border-radius:10px;background:rgba(255,90,106,.14);border:1px solid rgba(255,90,106,.4);font-size:13px}
  #hpGate .g-fine{margin:0;font-size:12px;color:#9AA1AE;text-align:center}
  .hp-acct{display:inline-flex;align-items:center;gap:8px;font-size:13px;margin-left:6px}
  .hp-acct i{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-style:normal;font-weight:800;background:linear-gradient(135deg,#FF2E88,#FF9E3D);color:#fff}
  .hp-acct button{all:unset;cursor:pointer;font-size:12.5px;color:#C9CDD5;padding:6px 8px;border-radius:8px}
  .hp-acct button:hover{background:rgba(255,255,255,.08);color:#fff}
  @media (max-width:900px){.hp-acct span{display:none}}`;
  const st = document.createElement("style"); st.textContent = css; document.head.append(st);

  function gate(msg) {
    let mode = "in";
    const g = document.createElement("div"); g.id = "hpGate"; g.setAttribute("role", "dialog"); g.setAttribute("aria-label", "Sign in to Highpoint Desk");
    document.body.append(g);
    const draw = (err = msg || "") => {
      g.innerHTML = `<form class="g-card" novalidate>
        <div class="g-brand"><b>HIGHPOINT</b><span>FINANCIAL</span><em>Elevate your future.</em></div>
        <div class="g-tabs" role="tablist"><button type="button" role="tab" data-m="in" aria-selected="${mode === "in"}">Sign in</button><button type="button" role="tab" data-m="up" aria-selected="${mode === "up"}">Create account</button></div>
        ${mode === "up" ? `<label>Your name<input id="gName" autocomplete="name" required></label>` : ""}
        <label>Email<input id="gEmail" type="email" autocomplete="email" required></label>
        <label>Password<input id="gPw" type="password" autocomplete="${mode === "up" ? "new-password" : "current-password"}" minlength="8" required></label>
        ${mode === "up" ? `<label>Team code<input id="gCode" autocomplete="off" placeholder="From your Highpoint admin"></label>` : ""}
        ${err ? `<p class="g-err" role="alert">${esc(err)}</p>` : ""}
        <button class="g-go" type="submit">${mode === "up" ? "Create my account" : "Sign in"}</button>
        <p class="g-fine">${mode === "up" ? "Your leads stay private to your login." : "Forgot your password? Ask your Highpoint admin to reset it."}</p>
      </form>`;
      g.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { mode = b.dataset.m; draw(""); }));
      const f = $("form", g);
      f.onsubmit = async (e) => {
        e.preventDefault();
        const btn = $(".g-go", g); btn.disabled = true; btn.textContent = "One moment…";
        try {
          const body = { email: $("#gEmail").value, password: $("#gPw").value };
          if (mode === "up") Object.assign(body, { name: $("#gName").value, invite: $("#gCode").value });
          const r = await call(`/api/auth/${mode === "up" ? "signup" : "login"}`, { method: "POST", body });
          g.remove(); start(r.user);
        } catch (er) { draw(er.message); }
      };
      setTimeout(() => ($("#gName") || $("#gEmail"))?.focus(), 30);
    };
    draw();
  }

  function account(u) {
    const row = document.querySelector(".topbar .row"); if (!row || row.querySelector(".hp-acct")) return;
    const a = document.createElement("div"); a.className = "hp-acct";
    a.innerHTML = `<i aria-hidden="true">${esc((u.name || u.email)[0].toUpperCase())}</i><span>${esc(u.name || u.email)}</span><button type="button" data-out>Sign out</button>`;
    a.querySelector("[data-out]").onclick = async () => { try { await call("/api/auth/logout", { method: "POST" }); } finally { location.reload(); } };
    row.append(a);
  }

  function start(u) {
    ME = u; window.hpUser = u;
    document.documentElement.classList.remove("gated");
    account(u);
    call("/api/room/presence", { method: "POST", body: { status: "Online", at: Date.now() } }).catch(() => {});
    const s = document.createElement("script"); s.src = "/desk-app.js"; document.body.append(s);
  }

  async function boot() {
    document.documentElement.classList.add("gated");
    try { const r = await call("/api/auth/me"); start(r.user); }
    catch (e) { gate(e.status === 401 ? "" : e.status === 503 ? e.message : ""); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
