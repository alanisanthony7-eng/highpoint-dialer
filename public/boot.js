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
  #hpGate{position:fixed;inset:0;z-index:1000;overflow-y:auto;color:#F4F5F8;font-family:var(--f-ui,"Inter",system-ui,sans-serif);background:#141E4A}
  #hpGate .gx-bg{position:fixed;inset:0;z-index:0;pointer-events:none}
  #hpGate .gx-bg .vscene{display:block!important;position:absolute!important;inset:0}
  #hpGate .gx-bg::after{content:"";position:absolute;inset:0;z-index:2;background:linear-gradient(90deg,rgba(5,6,16,.84) 0%,rgba(5,6,16,.5) 46%,rgba(5,6,16,.06) 100%),linear-gradient(0deg,rgba(5,6,16,.55) 0%,rgba(5,6,16,0) 35%)}
  #hpGate .gx-content{position:relative;z-index:1;min-height:100%}
  #hpGate .gx{min-height:100vh;min-height:100dvh;box-sizing:border-box;display:grid;grid-template-columns:minmax(0,1.15fr) minmax(340px,440px);gap:48px;align-items:center;padding:48px clamp(20px,6vw,96px)}
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
  #hpGate .g-fine{margin:2px 0 0;font-size:12px;color:#8C92A0;text-align:center;line-height:1.5}
  #hpGate .gx-foot{position:fixed;left:clamp(20px,6vw,96px);bottom:18px;font-size:12px;color:rgba(255,255,255,.55)}
  @keyframes gxIn{from{opacity:0;transform:translateY(14px)}}
  @media (max-width:900px){#hpGate .gx-bg::after{background:rgba(5,6,16,.6)}#hpGate .gx{grid-template-columns:1fr;gap:26px;padding:32px 18px 60px;align-content:start}
    #hpGate h1{font-size:clamp(38px,11vw,56px)}#hpGate .gx-sub{font-size:15px}#hpGate .gx-lock svg{width:72px}#hpGate .gx-lock b{font-size:24px}#hpGate .gx-foot{position:static;padding:0 18px 20px}}
  @media (prefers-reduced-motion:reduce){#hpGate .gx-hero,#hpGate .g-card{animation:none}}
  .hp-acct{display:inline-flex;align-items:center;gap:8px;font-size:13px;margin-left:6px}
  .hp-acct i{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;font-style:normal;font-weight:800;background:linear-gradient(135deg,#FF2E88,#FF9E3D);color:#fff}
  .hp-acct button{all:unset;cursor:pointer;font-size:12.5px;color:#C9CDD5;padding:6px 8px;border-radius:8px}
  .hp-acct button:hover{background:rgba(255,255,255,.08);color:#fff}
  @media (max-width:900px){.hp-acct span{display:none}}`;
  const st = document.createElement("style"); st.textContent = css; document.head.append(st);

  const MARK = `<svg viewBox="0 0 132 96" aria-hidden="true"><text x="18" y="66" font-family="Libre Caslon Text, Georgia, serif" font-size="70" fill="#FFFFFF">H</text><text x="58" y="86" font-family="Libre Caslon Text, Georgia, serif" font-size="70" fill="#FFFFFF">P</text><path d="M4 80 C40 74 78 56 112 22 C82 58 44 78 4 80Z" fill="#FFFFFF"/><path d="M104 22 L128 12 L118 30 L113 24 Z" fill="#FFFFFF"/><path d="M113 24 L118 30 L112 31Z" fill="#FF9E3D"/></svg>`;
  function gate(msg) {
    let mode = "in", showPw = false;
    const keep = {};
    const g = document.createElement("div"); g.id = "hpGate"; g.setAttribute("role", "dialog"); g.setAttribute("aria-label", "Sign in to Highpoint");
    g.innerHTML = `<div class="gx-bg"></div><div class="gx-content"></div>`;
    // borrow the desk's live sunset scene (its gradients only paint when it isn't inside the hidden desk)
    const scene = document.querySelector(".vscene"), home = scene && { parent: scene.parentNode, next: scene.nextSibling };
    if (scene) $(".gx-bg", g).append(scene);
    g.giveBack = () => { if (scene && home) home.parent.insertBefore(scene, home.next); };
    document.body.append(g);
    const box = $(".gx-content", g);
    const draw = (err = msg || "") => {
      ["gName", "gEmail", "gCode"].forEach((id) => { const el = document.getElementById(id); if (el) keep[id] = el.value; });
      const up = mode === "up";
      box.innerHTML = `<div class="gx">
        <section class="gx-hero">
          <div class="gx-lock">${MARK}<div><b>HIGHPOINT</b><span>FINANCIAL</span></div></div>
          <h1>Elevate your future.</h1>
          <p class="gx-sub">The Highpoint agent desk. Your leads, your dialer, your quotes and follow-ups for Final Expense, Mortgage Protection and IUL, in one place.</p>
          <div class="gx-chips"><span><i></i>3-line power dialer</span><span><i></i>Local caller ID</span><span><i></i>Private lead CRM</span><span><i></i>FE · MP · IUL quotes</span></div>
        </section>
        <form class="g-card" novalidate>
          <h2>${up ? "Join the Highpoint team" : "Welcome back"}</h2>
          <p class="g-lead">${up ? "Create your agent login. You'll need the team code from your admin." : "Sign in to pick up where you left off."}</p>
          ${up ? `<label for="gName">Full name<input class="g-in" id="gName" autocomplete="name" placeholder="First and last name" value="${esc(keep.gName || "")}"></label>` : ""}
          <label for="gEmail">Email<input class="g-in" id="gEmail" type="email" autocomplete="email" placeholder="you@example.com" value="${esc(keep.gEmail || "")}"></label>
          <label for="gPw">Password<span class="g-pw"><input class="g-in" id="gPw" type="${showPw ? "text" : "password"}" autocomplete="${up ? "new-password" : "current-password"}" placeholder="${up ? "At least 8 characters" : "Your password"}" style="padding-right:64px"><button type="button" class="g-eye" aria-label="${showPw ? "Hide" : "Show"} password">${showPw ? "Hide" : "Show"}</button></span></label>
          ${up ? `<label for="gCode">Team code<input class="g-in" id="gCode" autocomplete="off" placeholder="From your Highpoint admin" value="${esc(keep.gCode || "")}"></label>` : ""}
          ${err ? `<p class="g-err" role="alert">${esc(err)}</p>` : ""}
          <button class="g-go" type="submit">${up ? "Create my account" : "Sign in"}</button>
          <p class="g-sw">${up ? `Already on the team? <a data-m="in" tabindex="0" role="button">Sign in</a>` : `New agent? <a data-m="up" tabindex="0" role="button">Create an account</a>`}</p>
          <p class="g-fine">${up ? "Your leads are private to your login. Nobody else on the team sees them." : "Forgot your password? Your Highpoint admin can reset it."}</p>
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
          const body = { email: $("#gEmail").value, password: pw };
          if (up) Object.assign(body, { name: $("#gName").value, invite: $("#gCode").value });
          const r = await call(`/api/auth/${up ? "signup" : "login"}`, { method: "POST", body });
          g.style.transition = "opacity .35s"; g.style.opacity = "0"; setTimeout(() => { g.giveBack(); g.remove(); }, 360); start(r.user);
        } catch (er) { draw(er.message); }
      };
      setTimeout(() => (err && $("#gPw")) ? $("#gPw").focus() : ($("#gName") || $("#gEmail"))?.focus(), 30);
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
