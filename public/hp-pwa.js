/* Install the desk as an app and get alerts on this phone or computer.
   window.hpPwa.open() shows the "Phone alerts" screen (account menu). */
(() => {
  if (window.hpPwa) return;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ls = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
  async function api(path, body) {
    const r = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Request failed (${r.status})`), { status: r.status });
    return j;
  }
  const toast = (m) => (window.hpDesk?.toast ? window.hpDesk.toast(m) : null);
  const ua = navigator.userAgent || "";
  const IOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const canPush = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const label = () => {
    const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Device";
    const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
    return standalone() ? `${os} · Highpoint app` : `${os} · ${br}`;
  };
  const unb64u = (s) => { s = String(s).replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const b = atob(s); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };

  /* ---------- service worker ---------- */
  let regP = null;
  const register = () => (regP ||= "serviceWorker" in navigator ? navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready).catch(() => null) : Promise.resolve(null));
  register();

  // links from alerts and app shortcuts: /?view=calendar, /?lead=<id>, /?view=dialer
  function route(href) {
    let u; try { u = new URL(href, location.href); } catch { return; }
    const view = u.searchParams.get("view"), lead = u.searchParams.get("lead");
    if (view) $(`.nav[data-view="${CSS.escape(view)}"]`)?.click();
    if (lead && window.hpDesk?.openDrawer) setTimeout(() => window.hpDesk.openDrawer(lead), 250);
    if (u.searchParams.get("text")) $(`.nav[data-view="dialer"]`)?.click();
  }
  if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("message", (e) => {
    const m = e.data || {};
    if (m.type === "open") route(m.url);
    if (m.type === "push" && m.data && m.data.event !== "whisper") toast([m.data.title, m.data.body].filter(Boolean).join(": ")); // the page shows it too when it's open
  });
  setTimeout(() => { if (/[?&](view|lead|text)=/.test(location.search)) { route(location.href); history.replaceState(null, "", location.pathname); } }, 900);

  /* ---------- this device ---------- */
  async function mySub() { const reg = await register(); return reg ? reg.pushManager.getSubscription().catch(() => null) : null; }
  async function turnOn() {
    const reg = await register(); if (!reg) throw new Error("This browser can't show alerts.");
    const perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (perm !== "granted") throw new Error(perm === "denied" ? "Alerts are blocked for this site. Allow notifications in your browser's site settings, then try again." : "You didn't allow notifications.");
    const { key } = await api("/api/push/key");
    let sub = await reg.pushManager.getSubscription();
    if (sub) { const cur = new Uint8Array(sub.options?.applicationServerKey || []), want = unb64u(key); if (cur.length && (cur.length !== want.length || cur.some((v, i) => v !== want[i]))) { await sub.unsubscribe(); sub = null; } }
    sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: unb64u(key) });
    await api("/api/push/subscribe", { subscription: sub.toJSON(), label: label() });
    return sub;
  }
  async function turnOff() { const sub = await mySub(); if (sub) { const ep = sub.endpoint; await sub.unsubscribe().catch(() => {}); await api("/api/push/unsubscribe", { endpoint: ep }); } }

  /* ---------- the screen ---------- */
  const css = `
  .hpa-st{display:flex;gap:10px;align-items:flex-start;margin:6px 0 14px}.hpa-st b{display:block;font-size:15px;color:var(--ink,#eef2f8)}
  .hpa-box{padding:14px 15px;border-radius:12px;border:1px solid var(--line-2,#28354c);background:var(--sunk,#080d17);margin:10px 0}
  .hpa-box p{margin:0 0 8px}.hpa-box p:last-child{margin:0}
  .hpa-ev{display:grid;gap:2px;margin:6px 0 2px}.hpa-ev label{display:flex;gap:10px;align-items:center;padding:8px 4px;font-size:14px;color:var(--ink,#eef2f8);cursor:pointer}.hpa-ev input{width:18px;height:18px;accent-color:var(--accent,#3a5f9f)}
  .hpa-dev{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--line,#1c2638);font-size:14px;color:var(--ink,#eef2f8)}.hpa-dev:last-child{border:0}.hpa-dev small{display:block;color:var(--muted,#8c97ab);font-size:12px}
  .hpa-nudge{position:fixed;z-index:2400;left:50%;transform:translateX(-50%);bottom:max(16px,env(safe-area-inset-bottom));width:min(460px,calc(100% - 24px));display:flex;gap:12px;align-items:center;padding:13px 14px;border-radius:14px;background:var(--surface,#0c121e);border:1px solid var(--line-2,#28354c);box-shadow:0 18px 50px rgba(0,0,0,.55);color:var(--ink,#eef2f8);font:14px/1.4 var(--f-ui,system-ui,sans-serif)}
  .hpa-nudge span{flex:1}.hpa-nudge b{display:block}.hpa-nudge small{color:var(--muted,#8c97ab)}
  @media(max-width:520px){.hpa-nudge{flex-wrap:wrap}.hpa-nudge span{flex-basis:100%}}`;
  if (!$("#hpaCss")) { const st = document.createElement("style"); st.id = "hpaCss"; st.textContent = css; document.head.append(st); }

  function modal(html) {
    const ov = document.createElement("div"); ov.className = "hpt-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true");
    ov.innerHTML = `<div class="hpt-card"><button class="hpt-x" type="button" aria-label="Close">✕</button>${html}</div>`;
    document.body.append(ov);
    let gone = false; const onEsc = (e) => { if (e.key === "Escape") done(); };
    const done = () => { if (gone) return; gone = true; document.removeEventListener("keydown", onEsc); ov.remove(); };
    document.addEventListener("keydown", onEsc);
    $(".hpt-x", ov).onclick = done; ov.addEventListener("click", (e) => { if (e.target === ov) done(); }); ov.addEventListener("keydown", (e) => { if (e.key === "Escape") done(); });
    return { el: ov, close: done };
  }

  async function open() {
    dismissNudge();
    const m = modal(`<h2>Phone alerts</h2><p>Get a ping the moment something needs you, even when the desk is closed.</p><div id="hpaBody"><p>Loading…</p></div>`);
    const body = $("#hpaBody", m.el);
    async function draw(msg) {
      let st = { devices: [], prefs: {}, events: {} }, sub = null;
      try { st = await api("/api/push/status"); sub = canPush() ? await mySub() : null; } catch (e) { body.innerHTML = `<div class="hpt-err">${esc(e.message)}</div>`; return; }
      const here = sub && st.devices.some((d) => d.endpoint === sub.endpoint);
      const denied = canPush() && Notification.permission === "denied";
      let status, action = "";
      if (!canPush()) {
        status = IOS && !standalone()
          ? `<span class="hpt-pill warn">Almost</span><div><b>Add the desk to your Home Screen first</b><span class="hpt-muted">iPhone only shows alerts for apps on the Home Screen. In Safari tap <b>Share</b>, then <b>Add to Home Screen</b>, open Highpoint from there, and come back to this screen.</span></div>`
          : `<span class="hpt-pill bad">Not available</span><div><b>This browser can't show alerts</b><span class="hpt-muted">Try Chrome, Edge or Safari, or install the desk as an app.</span></div>`;
      } else if (denied) {
        status = `<span class="hpt-pill bad">Blocked</span><div><b>Alerts are blocked on this device</b><span class="hpt-muted">Open your browser's site settings for this page, allow Notifications, then come back.</span></div>`;
      } else if (here) {
        status = `<span class="hpt-pill ok">On</span><div><b>This device gets alerts</b><span class="hpt-muted">${esc(label())}</span></div>`;
        action = `<div class="hpt-row" style="margin-top:8px"><button class="hpt-btn go" type="button" id="hpaTest">Send a test alert</button><button class="hpt-btn" type="button" id="hpaOff">Turn off on this device</button></div>`;
      } else {
        status = `<span class="hpt-pill">Off</span><div><b>This device doesn't get alerts yet</b><span class="hpt-muted">Your browser will ask for permission.</span></div>`;
        action = `<div class="hpt-row" style="margin-top:8px"><button class="hpt-btn go" type="button" id="hpaOn">Turn on alerts on this device</button></div>`;
      }
      const install = standalone() ? "" : window.__hpInstall
        ? `<div class="hpa-box"><p><b>Install the desk as an app</b></p><p class="hpt-muted">Opens in its own window with the Highpoint icon on your home screen or desktop.</p><div class="hpt-row"><button class="hpt-btn" type="button" id="hpaInst">Install app</button></div></div>`
        : IOS ? `<div class="hpa-box"><p><b>Install the desk as an app</b></p><p class="hpt-muted">In Safari tap <b>Share</b>, then <b>Add to Home Screen</b>. Alerts only work on iPhone once it's installed this way.</p></div>`
        : `<div class="hpa-box"><p><b>Install the desk as an app</b></p><p class="hpt-muted">In Chrome or Edge, open the browser menu and choose <b>Install Highpoint Desk</b> (or the install icon in the address bar).</p></div>`;
      const ev = Object.entries(st.events || {}).map(([k, t]) => `<label><input type="checkbox" data-ev="${esc(k)}" ${st.prefs[k] !== false ? "checked" : ""}><span>${esc(t)}</span></label>`).join("");
      body.innerHTML = `${msg ? `<div class="hpt-note" style="margin-bottom:8px">${esc(msg)}</div>` : ""}
        <div class="hpa-st">${status}</div>${action}
        <h3>Tell me when</h3><div class="hpa-ev">${ev}</div>
        ${install}
        ${st.devices.length ? `<h3>Devices with alerts</h3>${st.devices.map((d) => `<div class="hpa-dev"><span>${esc(d.label)}${sub && d.endpoint === sub.endpoint ? " (this one)" : ""}<small>Added ${new Date(d.at).toLocaleDateString([], { month: "short", day: "numeric" })}</small></span><button class="hpt-btn sm" type="button" data-rm="${esc(d.endpoint)}">Remove</button></div>`).join("")}` : ""}
        <div id="hpaErr"></div>`;
      const err = (e) => { $("#hpaErr", body).innerHTML = `<div class="hpt-err">${esc(e.message || e)}</div>`; };
      const guard = (btn, fn) => { btn.onclick = async () => { btn.disabled = true; try { await fn(); } catch (e) { err(e); btn.disabled = false; } }; };
      const on = $("#hpaOn", body), off = $("#hpaOff", body), test = $("#hpaTest", body), inst = $("#hpaInst", body);
      if (on) guard(on, async () => { await turnOn(); ls.set("hp.alerts.nudge", "done"); await draw("Alerts are on for this device."); });
      if (off) guard(off, async () => { await turnOff(); await draw("Alerts are off for this device."); });
      if (test) guard(test, async () => { const r = await api("/api/push/test", {}); await draw(r.sent ? "Sent. It should arrive in a few seconds." : "The alert couldn't be delivered. Try turning alerts off and on again."); });
      if (inst) inst.onclick = async () => { const p = window.__hpInstall; if (!p) return; p.prompt(); try { await p.userChoice; } catch {} window.__hpInstall = null; draw(); };
      body.querySelectorAll("[data-ev]").forEach((c) => { c.onchange = async () => { try { await api("/api/push/prefs", { events: { [c.dataset.ev]: c.checked } }); } catch (e) { err(e); c.checked = !c.checked; } }; });
      body.querySelectorAll("[data-rm]").forEach((b) => { b.onclick = async () => { b.disabled = true; try { if (sub && b.dataset.rm === sub.endpoint) await sub.unsubscribe().catch(() => {}); await api("/api/push/unsubscribe", { endpoint: b.dataset.rm }); await draw(); } catch (e) { err(e); b.disabled = false; } }; });
    }
    draw();
  }

  /* ---------- a one-time nudge a little after sign-in ---------- */
  let nudgeEl = null;
  function dismissNudge() { nudgeEl?.remove(); nudgeEl = null; }
  async function maybeNudge() {
    if (!canPush() || (IOS && !standalone())) return; // iPhone only after the app is installed
    if (ls.get("hp.alerts.nudge") === "done" || Notification.permission === "denied") return;
    const at = +ls.get("hp.alerts.nudge.at") || 0; if (Date.now() - at < 14 * 864e5) return;
    if (await mySub()) { ls.set("hp.alerts.nudge", "done"); return; }
    nudgeEl = document.createElement("div"); nudgeEl.className = "hpa-nudge"; nudgeEl.setAttribute("role", "status");
    nudgeEl.innerHTML = `<span><b>Get a ping on this device</b><small>New leads, bookings and texts, even when the desk is closed.</small></span><button class="hpt-btn go sm" type="button" id="hpaYes">Turn on</button><button class="hpt-btn sm" type="button" id="hpaNo">Not now</button>`;
    document.body.append(nudgeEl);
    $("#hpaNo", nudgeEl).onclick = () => { ls.set("hp.alerts.nudge.at", String(Date.now())); dismissNudge(); };
    $("#hpaYes", nudgeEl).onclick = () => { ls.set("hp.alerts.nudge.at", String(Date.now())); open(); };
  }
  setTimeout(() => { if (window.hpUser) maybeNudge().catch(() => {}); }, 25000);

  window.hpPwa = { open, route, canPush, standalone };
})();
