/* Highpoint Dialer — browser phone, multi-line power dialing, numbers, analytics, inbox.
   Talks to /api/dialer/* (Netlify Functions + Twilio). Runs in demo mode when the backend isn't there. */
(() => {
  "use strict";
  const API = "/api/dialer";
  const SDK = "https://cdn.jsdelivr.net/npm/@twilio/voice-sdk@2.18.5/dist/twilio.min.js";
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const d10 = (s) => { let d = String(s || "").replace(/\D/g, ""); if (d.length === 11 && d[0] === "1") d = d.slice(1); return d; };
  const fmt = (s) => { const d = d10(s); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : s || ""; };
  const dur = (sec) => { sec = Math.round(sec || 0); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return h ? `${h}h ${m}m` : `${m}:${String(s).padStart(2, "0")}`; };
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const toast = (m) => (window.hpDesk?.toast || console.log)(m);
  const I = {
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
    mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5"/></svg>',
    micoff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 2l20 20M9 9v1a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.9-.7M17 16.9A7 7 0 0 1 5 10M19 10a7 7 0 0 1-.1 1.2M12 17v5"/></svg>',
    pad: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="6" cy="5" r="1.8"/><circle cx="12" cy="5" r="1.8"/><circle cx="18" cy="5" r="1.8"/><circle cx="6" cy="11" r="1.8"/><circle cx="12" cy="11" r="1.8"/><circle cx="18" cy="11" r="1.8"/><circle cx="6" cy="17" r="1.8"/><circle cx="12" cy="17" r="1.8"/><circle cx="18" cy="17" r="1.8"/></svg>',
    vm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6.5" cy="12" r="4"/><circle cx="17.5" cy="12" r="4"/><path d="M6.5 16h11"/></svg>',
    skip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 5l10 7-10 7zM19 5v14"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>',
    sms: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  };

  /* ================= state ================= */
  const S = {
    demo: false, ready: false, twilio: false, me: null, settings: {}, prefs: lsGet("hpd.prefs", {}), trust: {},
    device: null, call: null, callLead: null, callSid: null, muted: false, padOpen: false,
    mode: lsGet("hpd.mode", "single"), lines: lsGet("hpd.lines", 1), campaign: lsGet("hpd.campaign", ""),
    power: null, // {session, lines, paused, batch, waitingDispo, attempted:Set, poll}
    sidByLead: new Map(), txByLead: new Map(), liveTimer: 0, greetings: [], numbers: [], tab: null,
    via: lsGet("hpd.via", "line"), // "line" = browser phone line (Twilio), "phone" = the agent's own phone
    ps: null, // phone session {ids, i, cur}
  };

  /* ================= API ================= */
  function authHeader() {
    try { const u = JSON.parse(localStorage.getItem("gotrue.user") || "null"); const t = u?.token?.access_token; return t ? { authorization: "Bearer " + t } : {}; } catch { return {}; }
  }
  async function api(path, { method = "GET", body, raw } = {}) {
    if (S.demo) return Demo.api(path, { method, body });
    const headers = { ...authHeader() };
    let b = body;
    if (body !== undefined && !raw) { headers["content-type"] = "application/json"; b = JSON.stringify(body); }
    const r = await fetch(API + path, { method, headers, body: b, credentials: "same-origin" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || `Request failed (${r.status})`); e.status = r.status; throw e; }
    return j;
  }

  /* ================= boot ================= */
  async function boot() {
    for (let i = 0; i < 200 && !(window.hpDesk && $("#v-dialer")); i++) await sleep(100);
    if (!$("#v-dialer")) return;
    document.body.classList.add("hpd");
    if (!window.hpSpotify && !document.querySelector('script[src*="spotify-dock"]')) { const sp = document.createElement("script"); sp.src = "/spotify-dock.js"; document.body.append(sp); }
    buildUI(); buildBar();
    try {
      const st = await api("/setup");
      Object.assign(S, { ready: st.ready, twilio: st.twilio, me: st.me, settings: st.settings, trust: st.trust || {}, prefs: { ...S.prefs, ...(st.prefs || {}) } });
    } catch (e) {
      if (e.status === 401) { setChip("err", "Sign in"); note("Sign in to use the dialer."); return; }
      // no backend (preview / not deployed yet) → demo mode
      S.demo = true; Object.assign(S, Demo.boot());
    }
    S.lines = Math.min(S.lines, S.settings.maxLines || 3);
    if (S.ready || S.demo) document.body.classList.add("hpd-on");
    if (Array.isArray(S.prefs.camps) && S.prefs.camps.length > S.camps.length) { S.camps = S.prefs.camps; lsSet("hpd.camps", S.camps); }
    buildHome(); renderPhone();
    if (S.ready) startDevice();
    refreshNumbers(); loadGreetings(); inboxBadge();
    setInterval(inboxBadge, 60000);
  }

  /* ================= UI scaffolding ================= */
  function buildUI() {
    const v = $("#v-dialer");
    const h1 = $(".head h1", v); if (h1) h1.textContent = "Highpoint Dialer";
    const p = $(".head p", v); if (p) p.textContent = "Call from your browser with local caller ID, power-dial up to 3 lines, drop voicemails, and log every call to the lead automatically.";
    const crumb = $("#crumb"); if (crumb && crumb.textContent === "WAVV dialer") crumb.textContent = "Highpoint Dialer";
    $$('.nav[data-view="dialer"]').forEach((n) => { const t = [...n.childNodes].find((c) => c.nodeType === 3 && /WAVV/i.test(c.textContent)); if (t) t.textContent = t.textContent.replace(/WAVV/i, "Highpoint"); const s = $("span", n); if (s && /WAVV/i.test(s.textContent)) s.textContent = s.textContent.replace(/WAVV/i, "Highpoint"); });

    // tabs
    const tabs = $("#dTabs");
    if (tabs) {
      tabs.style.maxWidth = "none"; tabs.style.gridTemplateColumns = "repeat(7,auto)";
      tabs.insertAdjacentHTML("beforeend", `<button type="button" data-hpd="recs" aria-pressed="false">Recordings</button><button type="button" data-hpd="numbers" aria-pressed="false">Number groups</button><button type="button" data-hpd="stats" aria-pressed="false">Analytics</button><button type="button" data-hpd="inbox" aria-pressed="false">Inbox &amp; settings <span class="hpd-pill" id="hpdInboxN" hidden></span></button><button type="button" data-hpd="dnc" aria-pressed="false">Do not call</button>`);
      $$("[data-dt]", tabs).forEach((b) => b.addEventListener("click", () => { S.tab = null; $$(".hpd-pane").forEach((x) => (x.hidden = true)); $$("[data-hpd]", tabs).forEach((x) => x.setAttribute("aria-pressed", "false")); }));
      $$("[data-hpd]", tabs).forEach((b) => (b.onclick = () => openTab(b.dataset.hpd)));
    }
    const host = $("#dPane").parentNode;
    host.insertAdjacentHTML("beforeend", `<div class="hpd-pane" id="hpdRecs" hidden></div><div class="hpd-pane" id="hpdDnc" hidden></div><div class="hpd-pane" id="hpdNumbers" hidden></div><div class="hpd-pane" id="hpdStats" hidden></div><div class="hpd-pane" id="hpdInbox" hidden></div>`);

    // phone panel replaces the WAVV launcher (kept hidden for the CSV export)
    const wavv = $("#wavvUrl")?.closest(".panel");
    const side = wavv?.parentNode || $(".side", $("#dPane"));
    side.insertAdjacentHTML("afterbegin", `<div class="panel stack hpd-phone" id="hpdPhone" style="gap:12px"></div>`);
    if (wavv) wavv.classList.add("hpd-wavv");
    document.addEventListener("keydown", hotkeys);
  }

  function openTab(t) {
    S.tab = t;
    $$("#dTabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hpd === t)));
    $("#dPane").hidden = true; $("#hPane").hidden = true;
    $$(".hpd-pane").forEach((x) => (x.hidden = x.id !== "hpd" + t[0].toUpperCase() + t.slice(1)));
    if ($("#hpdHome")) $("#hpdHome").hidden = $("#hphMusic").hidden = true;
    ({ numbers: renderNumbers, stats: renderStats, inbox: renderInbox, recs: renderRecs, dnc: renderDnc })[t]?.();
  }
  const setChip = (s, t) => { const c = $("#hpdState"); if (c) { c.dataset.s = s; c.innerHTML = `<i></i>${esc(t)}`; } };
  const note = (html, cls = "") => { const n = $("#hpdNote"); if (n) { n.className = "hpd-banner " + cls; n.innerHTML = html; n.hidden = !html; } };

  /* ================= phone panel ================= */
  function renderPhone() {
    const el = $("#hpdPhone"); if (!el) return;
    const live = !!S.call || !!S.power;
    const maxL = S.settings.maxLines || 3;
    const myNums = S.numbers.filter((n) => n.mine || S.me?.admin || n.shared);
    el.innerHTML = `
      <div class="row hpd-top"><h2>Highpoint Dialer</h2><span class="hpd-chip" id="hpdState"><i></i>Offline</span></div>
      ${!S.ready && !S.demo ? setupCard() : ""}
      <div class="hpd-seg" role="group" aria-label="Dial mode">
        <button type="button" data-mode="single" aria-pressed="${S.mode === "single"}" ${live ? "disabled" : ""}>Click to call</button>
        <button type="button" data-mode="power" aria-pressed="${S.mode === "power"}" ${live ? "disabled" : ""}>Power dial</button>
      </div>
      ${S.mode === "power" ? `<div class="hpd-linesel">Lines ${[1, 2, 3].map((n) => `<button type="button" data-lines="${n}" aria-pressed="${S.lines === n}" ${n > maxL || live ? "disabled" : ""}>${n}</button>`).join("")}<span style="margin-left:auto" class="hpd-sm">${S.lines > 1 ? "First to say hello connects" : "One at a time"}</span></div>` : ""}
      <label class="field"><span>Caller ID</span><select id="hpdCid" ${live ? "disabled" : ""}><option value="">Auto: local number for each lead</option>${myNums.map((n) => `<option value="${esc(n.e164)}" ${S.prefs.defaultCallerId === n.e164 ? "selected" : ""}>${esc(fmt(n.e164))}${n.label ? " · " + esc(n.label) : ""}${n.health?.status === "flagged" ? " (flagged)" : ""}</option>`).join("")}</select></label>
      <div class="hpd-actions" id="hpdActs"></div>
      <div id="hpdLive" class="stack" style="gap:10px" hidden>
        <div class="hpd-tiles" id="hpdTiles"></div>
        <div class="hpd-ctrls">
          <button type="button" id="hpdMute" aria-pressed="${S.muted}">${S.muted ? I.micoff : I.mic}<span>${S.muted ? "Unmute" : "Mute"}</span></button>
          <button type="button" id="hpdPadBtn" aria-pressed="${S.padOpen}">${I.pad}<span>Keypad</span></button>
          <button type="button" id="hpdVm">${I.vm}<span>Drop VM</span></button>
          <button type="button" id="hpdSkip">${S.power ? (S.power.paused ? I.play : I.pause) : I.sms}<span>${S.power ? (S.power.paused ? "Resume" : "Pause") : "Text"}</span></button>
        </div>
        <div class="hpd-pad" id="hpdPad" ${S.padOpen ? "" : "hidden"}>${"123456789*0#".split("").map((k) => `<button type="button" data-dtmf="${k}">${k}</button>`).join("")}</div>
        <div class="hpd-tx" id="hpdTx" aria-live="polite"></div>
      </div>
      <div class="hpd-banner" id="hpdNote" hidden></div>
      <div class="hpd-sm">Shortcuts: <span class="hpd-kbd">Alt</span>+<span class="hpd-kbd">C</span> call · <span class="hpd-kbd">Alt</span>+<span class="hpd-kbd">H</span> hang up · <span class="hpd-kbd">Alt</span>+<span class="hpd-kbd">V</span> drop VM · <span class="hpd-kbd">Alt</span>+<span class="hpd-kbd">M</span> mute</div>`;
    $$("[data-mode]", el).forEach((b) => (b.onclick = () => { S.mode = b.dataset.mode; lsSet("hpd.mode", S.mode); renderPhone(); }));
    $$("[data-lines]", el).forEach((b) => (b.onclick = () => { S.lines = +b.dataset.lines; lsSet("hpd.lines", S.lines); savePrefs({ lines: S.lines }); renderPhone(); }));
    $("#hpdCid").onchange = (e) => savePrefs({ defaultCallerId: e.target.value });
    $("#hpdMute").onclick = toggleMute;
    $("#hpdPadBtn").onclick = () => { S.padOpen = !S.padOpen; $("#hpdPad").hidden = !S.padOpen; $("#hpdPadBtn").setAttribute("aria-pressed", S.padOpen); };
    $$("[data-dtmf]", el).forEach((b) => (b.onclick = () => dtmf(b.dataset.dtmf)));
    $("#hpdVm").onclick = dropVm;
    $("#hpdSkip").onclick = () => { if (S.power) togglePause(); else { openTab("inbox"); setTimeout(() => $("#hpdSmsBody")?.focus(), 900); } };
    $("#hpdSetup")?.addEventListener("click", runSetup);
    renderActions(); renderLive();
    if (S.demo) setChip("demo", "Demo"); else if (S.call || S.power?.connected) setChip("live", "On call"); else if (S.power) setChip("ready", S.power.paused ? "Paused" : "Dialing"); else if (S.device?.state === "registered" || S.deviceReady) setChip("ready", "Ready"); else if (!S.ready) setChip("", "Not set up"); else setChip("", "Connecting");
    renderHome();
    if (S.demo && !$("#hpdNote").innerHTML) note(`<b>Preview mode.</b> Calls here are simulated so you can try the flow. Real calling turns on once the dialer is deployed to your site and Twilio is connected.`, "warn");
  }
  function setupCard() {
    if (!S.twilio) return `<div class="hpd-banner warn"><b>Almost there.</b> ${location.hostname !== "highpoint-dialer.pages.dev" && /\.pages\.dev$/.test(location.hostname) ? `This is a test preview, which doesn't have the phone keys. <a href="https://highpoint-dialer.pages.dev/">Open the live desk</a> to make calls.` : S.me?.admin ? "Add your Twilio keys in Cloudflare Pages (Settings → Variables and secrets: TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN), redeploy, then come back and press Connect." : "Your admin needs to connect Twilio before you can call."}</div>`;
    return S.me?.admin ? `<div class="hpd-banner warn"><b>Twilio keys found.</b> Press once to finish setup.<div style="margin-top:8px"><button class="btn primary" id="hpdSetup" type="button">Connect Twilio</button></div></div>` : `<div class="hpd-banner warn">Your admin needs to finish dialer setup.</div>`;
  }
  async function runSetup() {
    const b = $("#hpdSetup"); b.disabled = true; b.textContent = "Connecting…";
    try { const r = await api("/setup", { method: "POST" }); toast(r.trial ? "Connected. This is a Twilio trial account: you can only call verified numbers until you upgrade." : "Dialer connected"); S.ready = true; document.body.classList.add("hpd-on"); renderPhone(); startDevice(); }
    catch (e) { toast(e.message); b.disabled = false; b.textContent = "Connect Twilio"; }
  }
  function renderActions() {
    const a = $("#hpdActs"); if (!a) return;
    const lead = currentLead();
    if (S.call) { a.className = "hpd-actions"; a.innerHTML = `<button class="btn hpd-go hpd-hang" id="hpdHang" type="button">${I.phone} Hang up</button>`; $("#hpdHang").onclick = hangup; return; }
    if (S.power) {
      a.className = "hpd-actions two";
      a.innerHTML = `<button class="btn hpd-go ${S.power.connected ? "hpd-hang" : ""}" id="hpdHang" type="button" ${S.power.connected ? "" : "disabled"}>Hang up lead</button><button class="btn hpd-go" id="hpdStop" type="button">End session</button>`;
      $("#hpdHang").onclick = hangup; $("#hpdStop").onclick = stopPower; return;
    }
    a.className = "hpd-actions";
    if (S.mode === "power") {
      const n = campaignQueue().length;
      a.innerHTML = `<button class="btn primary hpd-go" id="hpdStart" type="button" ${n ? "" : "disabled"}>${I.phone} Start power dialing · ${n} lead${n === 1 ? "" : "s"}</button>`;
      $("#hpdStart").onclick = startPower;
    } else {
      a.innerHTML = `<button class="btn primary hpd-go" id="hpdCall" type="button" ${lead ? "" : "disabled"}>${I.phone} ${lead ? "Call " + esc(window.hpDesk.fullName(lead).split(" ")[0]) + " · " + esc(fmt(lead.phone)) : "Pick a lead to call"}</button>`;
      $("#hpdCall").onclick = () => lead && dialLead(lead);
      if (lead) { a.insertAdjacentHTML("beforeend", `<button class="btn" id="hpdProf" type="button" style="justify-content:center">Open lead profile</button>`); $("#hpdProf").onclick = () => openProfile(lead.id); }
    }
  }
  const currentLead = () => {
    const D = window.hpDesk; if (!D) return null;
    if (PF.id && D.leads.get(PF.id) && !CLOSED.includes(D.leads.get(PF.id).stage)) return D.leads.get(PF.id);
    return D.leads.get(D.currentId());
  };

  /* ================= device ================= */
  async function loadSdk() {
    if (window.Twilio?.Device) return;
    await new Promise((res, rej) => { const s = document.createElement("script"); s.src = SDK; s.onload = res; s.onerror = () => rej(new Error("Couldn't load the phone library")); document.head.append(s); });
  }
  async function startDevice() {
    if (S.demo) { S.device = new Demo.Device(); S.deviceReady = true; renderPhone(); return; }
    try {
      await loadSdk();
      const { token } = await api("/token");
      const dev = new Twilio.Device(token, { codecPreferences: ["opus", "pcmu"], closeProtection: "You're on a call. Leave anyway?", logLevel: 1, enableImprovedSignalingErrorPrecision: true });
      dev.on("registered", () => { S.deviceReady = true; applyDevices(); renderHome(); if (!S.call && !S.power) setChip("ready", "Ready"); });
      dev.on("unregistered", () => { S.deviceReady = false; });
      dev.on("error", (e) => { console.warn(e); if (/31205|20104|AccessToken/i.test(e.code + e.message)) refreshToken(); else note(esc(e.message || "Phone error"), "warn"); });
      dev.on("tokenWillExpire", refreshToken);
      dev.on("incoming", incoming);
      S.device = dev;
      await dev.register();
    } catch (e) { setChip("err", "Offline"); note(esc(e.message), "warn"); }
  }
  async function refreshToken() { try { const { token } = await api("/token"); S.device?.updateToken(token); } catch {} }

  async function micCheck() {
    if (S.demo) return true;
    try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); return true; }
    catch { note("<b>Microphone blocked.</b> Allow microphone access for this site in your browser's address bar, then try again.", "warn"); return false; }
  }

  /* ================= call from my own phone (no phone line needed) ================= */
  const telHref = (ph) => { const d = d10(ph); return d.length === 10 ? "tel:+1" + d : "tel:" + String(ph || "").replace(/[^\d+]/g, ""); };
  function ringMyPhone(lead) {
    const a = document.createElement("a"); a.href = telHref(lead.phone); a.rel = "noopener"; a.style.display = "none";
    document.body.append(a); a.click(); a.remove();
  }
  function phoneCall(lead) {
    if (!lead?.phone) { toast("This lead has no phone number"); return; }
    window.hpDesk.callStop();
    S.phoneLead = lead.id; S.callLead = lead.id;
    window.hpDesk.callStart(lead.id);
    openProfile(lead.id, { keepList: PF.id != null });
    ringMyPhone(lead);
    phoneCard();
  }
  function phoneCard() {
    const D = window.hpDesk, id = S.phoneLead, l = id && D.leads.get(id);
    let box = document.getElementById("hpdPhoneCard");
    if (!l) { box?.remove(); return; }
    if (!box) { box = document.createElement("div"); box.id = "hpdPhoneCard"; box.className = "hpd hpd-phonecard"; box.setAttribute("role", "status"); document.body.append(box); }
    const P = S.ps;
    box.innerHTML = `<div class="hpd-sm">${P ? `Phone session · lead ${P.i + 1} of ${P.ids.length}` : "Calling on your phone"}</div>
      <b style="font-size:17px">${esc(D.fullName(l))}</b><a class="num" href="${telHref(l.phone)}" style="color:inherit">${esc(fmt(l.phone))}</a>
      <span class="hpd-sm">Your phone should be ringing them now. When you hang up, pick a result under Log the call${P ? " and the next lead opens" : ""}.</span>
      <div class="row" style="gap:6px;flex-wrap:wrap"><a class="btn primary" href="${telHref(l.phone)}">Call again</a>${P ? `<button type="button" class="btn" id="hpdPsSkip">Skip</button><button type="button" class="btn hpd-hang" id="hpdPsEnd">End session</button>` : `<button type="button" class="btn" id="hpdPsDone">Done</button>`}</div>`;
    $("#hpdPsSkip", box)?.addEventListener("click", () => phoneNext());
    $("#hpdPsEnd", box)?.addEventListener("click", () => phoneEnd());
    $("#hpdPsDone", box)?.addEventListener("click", () => { window.hpDesk.callStop(); S.phoneLead = null; S.callLead = null; phoneCard(); renderHome(); });
  }
  function startPhoneSession() {
    const ids = campaignQueue().map((l) => l.id);
    if (!ids.length) { toast("Nobody to call in this list right now"); return; }
    S.ps = { ids, i: -1 }; phoneNext();
  }
  function phoneNext() {
    const P = S.ps; if (!P) return;
    window.hpDesk.callStop();
    const D = window.hpDesk;
    do { P.i++; } while (P.i < P.ids.length && !D.leads.get(P.ids[P.i])?.phone);
    if (P.i >= P.ids.length) { phoneEnd(true); return; }
    phoneCall(D.leads.get(P.ids[P.i])); renderHome();
  }
  function phoneEnd(done) {
    const n = S.ps ? Math.min(S.ps.i + 1, S.ps.ids.length) : 0;
    S.ps = null; S.phoneLead = null; S.callLead = null; window.hpDesk.callStop(); phoneCard(); renderHome();
    toast(done ? `List finished · ${n} lead${n === 1 ? "" : "s"} called` : "Phone session ended");
  }

  /* ================= click-to-call ================= */
  async function dialLead(lead) {
    if (S.via === "phone") { if (!S.ps) phoneCall(lead); return; }
    if (S.call || S.power) return;
    if (!S.device) { toast(S.ready ? "Phone is still connecting…" : "The dialer isn't set up yet"); return; }
    if (!(await micCheck())) return;
    note("");
    const params = { To: d10(lead.phone), LeadId: lead.id, LeadName: window.hpDesk.fullName(lead), LeadState: lead.state || "", CallerId: S.prefs.defaultCallerId || "" };
    try {
      const call = await S.device.connect({ params });
      S.call = call; S.callLead = lead.id; S.callSid = null; S.txByLead.set(lead.id, []);
      renderPhone(); tiles([{ leadId: lead.id, name: params.LeadName, to: params.To, s: "ringing", label: "Calling" }]);
      if (lead.id) openProfile(lead.id, { keepList: PF.id != null });
      call.on("ringing", () => tiles([{ leadId: lead.id, name: params.LeadName, to: params.To, s: "ringing", label: "Ringing" }]));
      call.on("accept", () => {
        S.callSid = call.parameters?.CallSid || call.sid; S.sidByLead.set(lead.id, S.callSid);
        window.hpDesk.callStart(lead.id);
        tiles([{ leadId: lead.id, name: params.LeadName, to: params.To, s: "live", label: "Connected" }]);
        setChip("live", "On call"); livePoll(); PF.liveAt = Date.now(); if (PF.id === lead.id) renderProfile();
      });
      const end = () => { endCall(); };
      call.on("disconnect", end); call.on("cancel", end); call.on("reject", end);
      call.on("error", (e) => { note(esc(e.message), "warn"); end(); });
    } catch (e) { toast(e.message); S.call = null; renderPhone(); }
  }
  function endCall() {
    const leadId = S.callLead;
    S.call = null; S.muted = false; clearTimeout(S.liveTimer);
    window.hpDesk.callStop();
    renderPhone(); renderFloat(); if (PF.id) renderProfile();
    if (leadId && S.callSid) { pullLive(S.callSid, leadId, true); note(`<b>Call ended.</b> Pick a result on the left to log it${S.settings.record ? " (recording and transcript are attached automatically)" : ""}.`); }
  }
  function hangup() {
    if (S.call) { S.call.disconnect(); return; }
    if (S.power?.connected) api("/power/hangup", { method: "POST", body: { session: S.power.session } }).catch((e) => toast(e.message));
  }
  function toggleMute() {
    const c = S.call || S.power?.conf; if (!c) return;
    S.muted = !S.muted; c.mute(S.muted);
    const b = $("#hpdMute"); b.setAttribute("aria-pressed", S.muted); b.innerHTML = `${S.muted ? I.micoff : I.mic}<span>${S.muted ? "Unmute" : "Mute"}</span>`;
  }
  function dtmf(k) { const c = S.call || S.power?.conf; if (c) c.sendDigits(k); }

  /* live transcript + machine detection while a click-to-call is up */
  async function livePoll() {
    clearTimeout(S.liveTimer);
    if (!S.call || !S.callSid) return;
    await pullLive(S.callSid, S.callLead);
    S.liveTimer = setTimeout(livePoll, 1200);
  }
  async function pullLive(sid, leadId, final) {
    try {
      const r = await api("/calls/live?sid=" + encodeURIComponent(sid));
      if (r.transcript) S.txByLead.set(leadId, r.transcript);
      drawTx(r.transcript || [], final ? [] : r.partial || []);
      const by = r.call?.answeredBy || "";
      if (!final && /machine/.test(by) && !$("#hpdNote").classList.contains("vm")) note(`<b>Voicemail detected.</b> ${S.greetings.length ? "Press Drop VM to leave your recorded message at the beep and move on." : "Record a voicemail drop in Settings to leave messages with one click."}`, "vm");
      if (r.call?.vmDropped && S.call) { toast("Voicemail dropping. You're free for the next call."); }
    } catch {}
  }
  function drawTx(lines, partial = []) { ["#hpdTx", "#hpfTx"].forEach((sel) => drawTxIn($(sel), lines, partial)); }
  function drawTxIn(box, lines, partial) {
    if (!box) return;
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    const who = (t) => (t.track === "inbound_track" ? (S.power ? "Lead" : "Agent") : (S.power ? "Agent" : "Lead"));
    box.innerHTML = lines.map((l) => `<p><span class="who ${who(l)}">${who(l) === "Agent" ? "You" : "Lead"}</span>${esc(l.text)}</p>`).join("") + partial.map((l) => `<p class="partial"><span class="who ${who(l)}">${who(l) === "Agent" ? "You" : "Lead"}</span>${esc(l.text)}…</p>`).join("");
    if (near) box.scrollTop = box.scrollHeight;
  }
  function tiles(list) {
    S.lastTiles = list; renderFloat(list);
    const t = $("#hpdTiles"); if (!t) return;
    $("#hpdLive").hidden = false;
    t.innerHTML = list.map((l) => `<div class="hpd-tile" data-s="${l.s}"><span class="d"></span><span><b>${esc(l.name || fmt(l.to))}</b></span><span class="s">${esc(l.label)}</span>${l.sub ? `<span class="sub">${esc(l.sub)}</span>` : ""}</div>`).join("");
  }
  function renderLive() {
    if (S.call || S.power) { $("#hpdLive").hidden = false; if (S.power) drawPower(S.power.last); }
  }

  /* ================= voicemail drop ================= */
  async function dropVm() {
    if (!S.greetings.length) { toast("Record a voicemail drop first (Inbox → My voicemail drops)"); openTab("inbox"); return; }
    const g = S.prefs.vmGreeting && S.greetings.find((x) => x.key === S.prefs.vmGreeting) ? S.prefs.vmGreeting : S.greetings[0].key;
    try {
      const body = S.power ? { session: S.power.session, greeting: g } : { sid: S.callSid, greeting: g };
      if (!S.power && !S.callSid) { toast("Wait for the call to connect"); return; }
      const r = await api("/vm/drop", { method: "POST", body });
      if (r.pending) note("<b>Voicemail queued.</b> It plays the moment the beep is detected. You can keep going.", "vm");
      else note("<b>Voicemail dropped.</b> It's playing to their mailbox now.", "vm");
      const lid = S.power ? S.power.connectedLead : S.callLead;
      if (lid) S.autoResult = { leadId: lid, label: "Left voicemail" };
      if (S.call && r.dropped) setTimeout(() => S.call?.disconnect(), 400);
    } catch (e) { toast(e.message); }
  }

  /* ================= power dialing ================= */
  async function startPower() {
    if (!S.device) { toast("Phone is still connecting…"); return; }
    if (!(await micCheck())) return;
    note("");
    try {
      const r = await api("/power/start", { method: "POST", body: { lines: S.lines } });
      if (r.note) note(esc(r.note), "warn");
      if (S.status !== "ready") setStatus("ready", true);
      S.power = { session: r.session, lines: r.lines, paused: false, attempted: new Set(), waitingDispo: null, connected: null, last: null, auto: new Set(), order: campaignQueue().map((l) => l.id) };
      const conf = await S.device.connect({ params: { Mode: "conf", Session: r.session } });
      S.power.conf = conf;
      conf.on("accept", () => { window.dispatchEvent(new Event("hp:callstart")); nextBatch(); });
      conf.on("disconnect", () => { if (S.power) finishPower(); });
      conf.on("error", (e) => { note(esc(e.message), "warn"); });
      renderPhone(); setChip("ready", "Dialing");
      pollPower();
    } catch (e) { toast(e.message); S.power = null; renderPhone(); }
  }
  async function nextBatch() {
    const P = S.power; if (!P || P.paused || P.connected || P.waitingDispo || P.busy) return;
    let q = campaignQueue().filter((l) => !P.attempted.has(l.id));
    if (!q.length && P.later?.length) { q = P.later.map((id) => window.hpDesk.leads.get(id)).filter(Boolean); P.later = []; }
    if (!q.length) { note("<b>Queue finished.</b> Nobody left to call in this list.", ""); stopPower(); return; }
    const pick = q.slice(0, P.lines);
    pick.forEach((l) => P.attempted.add(l.id));
    P.busy = true;
    try {
      const r = await api("/power/dial", { method: "POST", body: { session: P.session, leads: pick.map((l) => ({ id: l.id, phone: l.phone, name: window.hpDesk.fullName(l), state: l.state || "" })) } });
      P.batch = r.batch;
      for (const s of r.skipped) {
        const l = window.hpDesk.leads.get(s.leadId);
        if (s.hard) window.hpDesk.autoLog(s.leadId, "Do not call", { hp: true }); // DNC
        toast(`Skipped ${l ? window.hpDesk.fullName(l) : ""}: ${s.why}`);
      }
      if (!r.placed.length) { P.busy = false; setTimeout(nextBatch, 300); return; }
    } catch (e) { toast(e.message); P.paused = true; renderPhone(); }
    P.busy = false;
  }
  async function pollPower() {
    const P = S.power; if (!P) return;
    try {
      const st = await api("/power/state?session=" + P.session);
      P.last = st;
      // a lead just connected
      if (st.connected && P.connected !== st.connected) {
        const line = st.calls[st.connected]; P.connected = st.connected; P.connectedLead = line?.leadId;
        if (line?.leadId) { S.sidByLead.set(line.leadId, st.connected); window.hpDesk.callStart(line.leadId); PF.liveAt = Date.now(); P.connectedLead = line.leadId; openProfile(line.leadId, { keepList: true }); }
        P.waitingDispo = line?.leadId || null; S.autoResult = null;
        setChip("live", "On call"); note(""); renderActions();
        beep();
      }
      // the connected lead went away (hung up, or voicemail auto-dropped)
      if (!st.connected && P.connected) {
        const line = st.calls[P.connected]; P.connected = null; window.hpDesk.callStop();
        if (line?.result && line.leadId) { // machine handled automatically → log it and keep going
          window.hpDesk.autoLog(line.leadId, line.result, { hpSid: Object.keys(st.calls).find((k) => st.calls[k] === line) });
          P.auto.add(line.leadId); P.waitingDispo = null;
        } else if (S.autoResult?.leadId === P.waitingDispo) {
          window.hpDesk.autoLog(S.autoResult.leadId, S.autoResult.label, {}); P.waitingDispo = null; S.autoResult = null;
        } else if (P.waitingDispo) note("<b>Call ended.</b> Log the result on the left and the next leads will dial.", "");
        setChip("ready", P.paused ? "Paused" : "Dialing"); renderActions(); if (PF.id) renderProfile();
      }
      if (st.live) drawTx(st.live.lines, st.live.partial);
      // batch over with nobody connected → log no-answers and dial the next set
      const batch = Object.entries(st.calls).filter(([, l]) => l.batch === st.batch);
      const ringing = batch.some(([, l]) => ["queued", "initiated", "ringing"].includes(l.status));
      for (const [sid, l] of batch) if (!P.auto.has(l.leadId) && !l.claimed && ["completed", "busy", "no-answer", "failed", "canceled"].includes(l.status)) {
        P.auto.add(l.leadId);
        const lab = l.result || ({ busy: "Busy", "no-answer": "No answer", failed: "Bad number", canceled: "Not dialed", completed: "No answer" })[l.status];
        if (lab !== "Not dialed") window.hpDesk.autoLog(l.leadId, lab, { hpSid: sid }); else (P.later = P.later || []).push(l.leadId);
      }
      drawPower(st);
      if (!st.connected && !ringing && !P.waitingDispo && !P.paused && !P.busy && st.batch === P.batch) nextBatch();
      if (!st.active) { finishPower(); return; }
    } catch (e) { if (e.status === 404) { finishPower(); return; } }
    P.timer = setTimeout(pollPower, 900);
  }
  function drawPower(st) {
    if (!st) { tiles([{ name: "Connecting your line…", s: "ringing", label: "" }]); return; }
    const batch = Object.entries(st.calls).filter(([, l]) => l.batch === st.batch);
    const lab = (sid, l) => sid === st.connected ? (/machine/.test(l.answeredBy || "") ? "Voicemail" : "Connected") : l.result || ({ queued: "Dialing", initiated: "Dialing", ringing: "Ringing", "in-progress": "Answered", completed: l.claimed ? "Ended" : "No answer", busy: "Busy", "no-answer": "No answer", failed: "Failed", canceled: "Stopped" })[l.status] || l.status;
    tiles(batch.length ? batch.map(([sid, l]) => ({ leadId: l.leadId, name: l.name, to: l.to, s: sid === st.connected ? "live" : ["completed", "busy", "no-answer", "failed", "canceled"].includes(l.status) ? "done" : l.status, label: lab(sid, l), sub: `from ${fmt(l.from)}` })) : [{ name: S.power?.paused ? "Paused" : "Getting the next leads…", s: "ringing", label: "" }]);
  }
  function togglePause() { const P = S.power; if (!P) return; P.paused = !P.paused; if (!P.paused) nextBatch(); renderPhone(); renderFloat(S.lastTiles); }
  async function stopPower() { const P = S.power; if (!P) return; try { await api("/power/end", { method: "POST", body: { session: P.session } }); } catch {} P.conf?.disconnect(); finishPower(); }
  function finishPower() {
    const P = S.power; if (!P) return; clearTimeout(P.timer); S.power = null; S.muted = false;
    if (S.status === "ready") setStatus("acw", true);
    window.hpDesk.callStop(); window.dispatchEvent(new Event("hp:callend"));
    renderPhone(); renderFloat(); if (PF.id) renderProfile(); $("#hpdLive").hidden = true; toast(`Session done · ${P.attempted.size} lead${P.attempted.size === 1 ? "" : "s"} dialed`);
  }
  function beep() { try { const a = new AudioContext(), o = a.createOscillator(), g = a.createGain(); o.frequency.value = 880; g.gain.value = 0.06; o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.12); } catch {} }

  /* desk calls this whenever a result is logged on the left */
  function onDispo(leadId, label, note2) {
    const sid = S.sidByLead.get(leadId);
    if (sid) api("/calls/dispo", { method: "POST", body: { sid, disposition: label, note: note2 || "", leadId } }).catch(() => {});
    const P = S.power;
    if (P && P.waitingDispo === leadId) {
      P.waitingDispo = null;
      if (P.connected) hangup(); // agent logged while still talking → end that lead and move on
      setTimeout(nextBatch, 600);
    }
    if (S.call && S.callLead === leadId) S.call.disconnect();
    if (S.via === "phone" && S.phoneLead === leadId) {
      window.hpDesk.callStop();
      if (S.ps) setTimeout(phoneNext, 700); else { S.phoneLead = null; S.callLead = null; phoneCard(); }
    }
    setTimeout(() => { if (PF.id) renderProfile(); }, 300);
  }
  function meta(leadId) {
    const sid = S.sidByLead.get(leadId); const tx = S.txByLead.get(leadId) || [];
    const who = (t) => (t.track === "inbound_track" ? (S.mode === "power" ? "Lead" : "Agent") : (S.mode === "power" ? "Agent" : "Lead"));
    return sid ? { hpSid: sid, transcript: tx.map((l) => `${who(l)}: ${l.text}`).join("\n") } : {};
  }

  /* ================= incoming calls ================= */
  function incoming(call) {
    const from = call.customParameters?.get("from") || call.parameters?.From || "";
    const lead = [...(window.hpDesk?.leads.values() || [])].find((l) => d10(l.phone) === d10(from));
    const box = document.createElement("div"); box.className = "hpd-incoming hpd"; box.setAttribute("role", "alertdialog");
    box.innerHTML = `<div class="hpd-sm">Incoming call</div><b style="font-size:18px">${esc(lead ? window.hpDesk.fullName(lead) : fmt(from))}</b>${lead ? `<span class="hpd-sm">${esc(fmt(from))}</span>` : ""}<div class="row"><button class="btn primary" id="hpdAns" type="button">Answer</button><button class="btn" id="hpdRej" type="button">Decline</button></div>`;
    document.body.append(box);
    const close = () => box.remove();
    $("#hpdAns", box).onclick = () => {
      if (S.call || S.power) { toast("Finish your current call first"); return; }
      call.accept(); S.call = call; S.callLead = lead?.id || null; S.callSid = call.parameters?.CallSid;
      if (lead) { window.hpDesk.setCurrent(lead.id); S.sidByLead.set(lead.id, S.callSid); window.hpDesk.callStart(lead.id); }
      renderPhone(); tiles([{ name: lead ? window.hpDesk.fullName(lead) : fmt(from), to: from, s: "live", label: "Inbound" }]); livePoll(); close();
    };
    $("#hpdRej", box).onclick = () => { call.reject(); close(); };
    call.on("cancel", close); call.on("disconnect", () => { close(); if (S.call === call) endCall(); });
  }

  /* ================= hotkeys ================= */
  function hotkeys(e) {
    if (!e.altKey || $("#v-dialer")?.hidden) return;
    const k = e.key.toLowerCase();
    if (k === "c" || e.code === "KeyC") { e.preventDefault(); if (S.mode === "power" && !S.power) startPower(); else { const l = currentLead(); if (l && !S.call) dialLead(l); } }
    if (k === "h" || e.code === "KeyH") { e.preventDefault(); hangup(); }
    if (k === "v" || e.code === "KeyV") { e.preventDefault(); dropVm(); }
    if (k === "m" || e.code === "KeyM") { e.preventDefault(); toggleMute(); }
  }

  /* ================= prefs ================= */
  async function savePrefs(p) { Object.assign(S.prefs, p); lsSet("hpd.prefs", S.prefs); try { await api("/setup", { method: "PATCH", body: p }); } catch {} }

  /* ================= numbers tab ================= */
  async function refreshNumbers() { try { const r = await api("/numbers"); S.numbers = r.numbers; S.agents = r.agents || {}; if (!S.call && !S.power) renderPhone(); } catch {} }
  async function renderNumbers() {
    const el = $("#hpdNumbers");
    el.innerHTML = `<div class="panel">Loading numbers…</div>`;
    await refreshNumbers();
    const mine = S.numbers.filter((n) => n.mine).length;
    const T = S.trust || {};
    const agentOpts = (sel) => `<option value="">Team pool</option>` + Object.entries(S.agents || {}).map(([id, n]) => `<option value="${esc(id)}" ${sel === id ? "selected" : ""}>${esc(n)}</option>`).join("");
    el.innerHTML = `
      <div class="hpd-grid2">
        <div class="panel stack" style="gap:12px">
          <h2>Get a local number</h2>
          <p class="muted" style="margin:0;font-size:13px">Pick numbers in the area codes you call most. Leads pick up local numbers far more often. About $1.15/month each through Twilio.</p>
          <div class="hpd-flex"><input id="hpdAc" inputmode="numeric" maxlength="3" placeholder="Area code, e.g. 305" style="width:190px"><input id="hpdSt" maxlength="2" placeholder="State" style="width:100px"><input id="hpdHas" inputmode="numeric" maxlength="7" placeholder="Contains (optional)" style="width:160px"><button class="btn primary" id="hpdFind" type="button">Search</button></div>
          ${S.me?.admin ? `<label class="field" style="max-width:280px"><span>Assign new numbers to</span><select id="hpdOwner"><option value="__me">Me</option>${agentOpts("")}</select></label>` : `<span class="hpd-sm">You have ${mine} of ${S.settings.agentMaxNumbers ?? 5} numbers.</span>`}
          <div class="hpd-results" id="hpdRes"></div>
        </div>
        <div class="panel stack" style="gap:10px">
          <h2>Keep numbers off “Spam Likely”</h2>
          <ul class="hpd-check">
            <li class="${T.profile ? "done" : ""}"><span><b>Verify your business</b> in Twilio Trust Hub (Customer Profile). Unlocks <b>A-level STIR/SHAKEN</b>, the strongest “this caller is real” signal carriers get.  <a href="https://console.twilio.com/us1/account/trust-hub/customer-profiles" target="_blank" rel="noopener">Open Trust Hub</a></span></li>
            <li class="${T.shaken ? "done" : ""}"><span><b>Add every number to your SHAKEN/STIR Trust Product</b> so they're all signed A.</span></li>
            <li class="${T.cnam ? "done" : ""}"><span><b>Register caller name (CNAM)</b> so phones show “HIGHPOINT FIN” instead of “Unknown”.</span></li>
            <li class="${T.voiceIntegrity ? "done" : ""}"><span><b>Turn on Voice Integrity</b> in Trust Hub. Twilio registers your numbers with T-Mobile, AT&amp;T and Verizon's spam engines.</span></li>
            <li class="${T.fcr ? "done" : ""}"><span><b>Register numbers free at <a href="https://www.freecallerregistry.com" target="_blank" rel="noopener">freecallerregistry.com</a></b> (Hiya, First Orion, TNS).</span></li>
            <li class="done"><span><b>Built in:</b> daily caps per number, 14-day warm-up for new numbers, local presence rotation, calling-hour and per-lead attempt limits, opt-out on press 9.</span></li>
          </ul>
          ${S.me?.admin ? `<div class="hpd-flex hpd-sm">Mark done: ${["profile", "shaken", "cnam", "voiceIntegrity", "fcr"].map((k) => `<label style="display:inline-flex;gap:4px;align-items:center"><input type="checkbox" data-trust="${k}" ${T[k] ? "checked" : ""}>${{ profile: "Profile", shaken: "SHAKEN", cnam: "CNAM", voiceIntegrity: "Voice Integrity", fcr: "Registry" }[k]}</label>`).join("")}</div>` : ""}
        </div>
      </div>
      <div class="panel stack" style="gap:10px">
        <div class="row" style="justify-content:space-between"><h2>${S.me?.admin ? "All numbers" : "Your numbers"}</h2>${S.me?.admin ? `<button class="btn" id="hpdImport" type="button">Add numbers already in Twilio</button>` : ""}</div>
        <div class="tablewrap" style="overflow-x:auto"><table class="hpd-tbl"><thead><tr><th>Number</th><th>Health</th><th>Today</th><th class="hide-sm">7-day answer rate</th><th>Owner</th><th></th></tr></thead><tbody>
        ${S.numbers.map((n) => {
          const h = n.health || {}; const status = n.paused ? "paused" : h.status;
          return `<tr><td><b class="num">${esc(fmt(n.e164))}</b><br><span class="hpd-sm">${esc(n.state || "")}${n.label ? " · " + esc(n.label) : ""}</span></td>
          <td><span class="hpd-h ${status}" title="${esc((h.why || []).join("; "))}">${{ healthy: "Healthy", watch: "Watch", flagged: "Flagged", paused: "Paused" }[status] || "—"}</span>${h.why?.length ? `<br><span class="hpd-sm">${esc(h.why[0])}</span>` : ""}</td>
          <td><span class="num">${h.todayDials || 0}</span><span class="hpd-sm"> / ${h.cap || "—"}</span><div class="hpd-meter"><i style="width:${Math.min(100, ((h.todayDials || 0) / (h.cap || 1)) * 100)}%;${(h.todayDials || 0) >= (h.cap || 1) ? "background:var(--hp-warn)" : ""}"></i></div></td>
          <td class="hide-sm num">${h.week?.dials ? pct(h.week.answered, h.week.dials) + "%" : "—"}<br><span class="hpd-sm">${h.week?.dials || 0} dials</span></td>
          <td>${S.me?.admin ? `<select data-own="${esc(n.e164)}" style="width:auto">${agentOpts(n.owner)}</select>` : esc(n.mine ? "You" : n.ownerName)}</td>
          <td><div class="hpd-flex" style="justify-content:flex-end">
            ${n.mine || S.me?.admin ? `<button class="btn" data-pause="${esc(n.e164)}" type="button">${n.paused ? "Resume" : "Pause"}</button>` : ""}
            <button class="btn" data-spam="${esc(n.e164)}" type="button" title="Someone saw this number labeled as spam">Report spam label</button>
            ${S.me?.admin && n.spamReports?.length ? `<button class="btn" data-clear="${esc(n.e164)}" type="button">Clear reports</button>` : ""}
            ${n.mine || S.me?.admin ? `<button class="btn" data-rel="${esc(n.e164)}" type="button">Release</button>` : ""}
          </div></td></tr>`;
        }).join("") || `<tr><td colspan="6" class="muted">No numbers yet. Search an area code above to buy your first one.</td></tr>`}
        </tbody></table></div>
      </div>`;
    const search = async () => {
      const ac = $("#hpdAc").value.trim(), st = $("#hpdSt").value.trim(), has = $("#hpdHas").value.trim();
      if (!ac && !st) { toast("Enter an area code or a state"); return; }
      $("#hpdRes").innerHTML = `<span class="hpd-sm">Searching…</span>`;
      try {
        const r = await api(`/numbers/search?areaCode=${encodeURIComponent(ac)}&state=${encodeURIComponent(st)}&contains=${encodeURIComponent(has)}`);
        $("#hpdRes").innerHTML = (r.fallback ? `<span class="hpd-sm" style="grid-column:1/-1">${esc(ac)} is sold out right now. Here are numbers elsewhere in the same state.</span>` : "") +
          (r.results.map((n) => `<button type="button" data-buy="${esc(n.e164)}"><b>${esc(fmt(n.e164))}</b><span>${esc([n.city, n.state].filter(Boolean).join(", "))}</span><span style="color:var(--hp-b)">Buy</span></button>`).join("") || `<span class="hpd-sm">No numbers found. Try a nearby area code.</span>`);
        $$("[data-buy]", el).forEach((b) => (b.onclick = async () => {
          if (b.dataset.armed !== "1") { b.dataset.armed = "1"; $("span:last-child", b).textContent = "Tap again to buy"; return; }
          b.disabled = true; $("span:last-child", b).textContent = "Buying…";
          try {
            const owner = $("#hpdOwner")?.value; const body = { phoneNumber: b.dataset.buy };
            if (owner !== undefined && owner !== "__me") body.owner = owner; if (owner === "") body.shared = true;
            await api("/numbers/buy", { method: "POST", body }); toast(`${fmt(b.dataset.buy)} is yours`); renderNumbers();
          } catch (e) { toast(e.message); b.disabled = false; $("span:last-child", b).textContent = "Buy"; }
        }));
      } catch (e) { $("#hpdRes").innerHTML = `<span class="hpd-sm">${esc(e.message)}</span>`; }
    };
    $("#hpdFind").onclick = search; [$("#hpdAc"), $("#hpdSt"), $("#hpdHas")].forEach((i) => i.addEventListener("keydown", (e) => e.key === "Enter" && search()));
    const upd = async (body, msg) => { try { await api("/numbers/update", { method: "POST", body }); if (msg) toast(msg); renderNumbers(); } catch (e) { toast(e.message); } };
    $$("[data-pause]", el).forEach((b) => (b.onclick = () => upd({ e164: b.dataset.pause, paused: b.textContent === "Pause" })));
    $$("[data-spam]", el).forEach((b) => (b.onclick = () => upd({ e164: b.dataset.spam, spamReport: true }, "Thanks. That number is paused and rotated out until an admin reviews it.")));
    $$("[data-clear]", el).forEach((b) => (b.onclick = () => upd({ e164: b.dataset.clear, clearReports: true })));
    $$("[data-own]", el).forEach((s) => (s.onchange = () => upd({ e164: s.dataset.own, owner: s.value, shared: !s.value }, "Number reassigned")));
    $$("[data-rel]", el).forEach((b) => (b.onclick = async () => {
      if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Release for good?"; return; }
      try { await api("/numbers/release", { method: "POST", body: { e164: b.dataset.rel } }); toast("Number released"); renderNumbers(); } catch (e) { toast(e.message); }
    }));
    $("#hpdImport")?.addEventListener("click", async () => { try { const r = await api("/numbers/import", { method: "POST", body: {} }); toast(`${r.added} number${r.added === 1 ? "" : "s"} added`); renderNumbers(); } catch (e) { toast(e.message); } });
    $$("[data-trust]", el).forEach((c) => (c.onchange = async () => { S.trust[c.dataset.trust] = c.checked; try { await api("/setup", { method: "PUT", body: { settings: {}, trust: S.trust } }); } catch {} renderNumbers(); }));
  }

  /* ================= analytics tab ================= */
  async function renderStats() {
    const el = $("#hpdStats");
    const range = lsGet("hpd.range", 7), who = S.me?.admin ? lsGet("hpd.who", "me") : "me";
    el.innerHTML = `<div class="row" style="gap:8px;flex-wrap:wrap">
        <select id="hpdRange" style="width:auto">${[[1, "Today"], [7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"]].map(([v, t]) => `<option value="${v}" ${v === range ? "selected" : ""}>${t}</option>`).join("")}</select>
        ${S.me?.admin ? `<select id="hpdWho" style="width:auto"><option value="me" ${who === "me" ? "selected" : ""}>Just me</option><option value="all" ${who === "all" ? "selected" : ""}>Whole team</option></select>` : ""}
      </div><div class="panel">Loading…</div>`;
    $("#hpdRange").onchange = (e) => { lsSet("hpd.range", +e.target.value); renderStats(); };
    $("#hpdWho")?.addEventListener("change", (e) => { lsSet("hpd.who", e.target.value); renderStats(); });
    let a, calls;
    try { [a, calls] = await Promise.all([api(`/calls/analytics?days=${range}&agent=${who}`), api(`/calls?days=${Math.min(range, 30)}&agent=${who}`)]); }
    catch (e) { el.lastElementChild.textContent = e.message; return; }
    const t = a.total;
    const k = (v, l, sub = "") => `<div><span class="num">${v}</span><span class="muted">${l}</span>${sub ? `<span class="delta">${sub}</span>` : ""}</div>`;
    const maxD = Math.max(1, ...a.byDay.map((d) => d.dials));
    const W = 640, Hh = 160, bw = W / Math.max(1, a.byDay.length);
    const chart = `<svg viewBox="0 0 ${W} ${Hh + 22}" role="img" aria-label="Dials and connects per day"><defs><linearGradient id="hpdG" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#FF2E88"/><stop offset="1" stop-color="#FF9E3D"/></linearGradient></defs>
      ${a.byDay.map((d, i) => { const h1 = (d.dials / maxD) * Hh, h2 = (d.connects / maxD) * Hh, x = i * bw + bw * 0.18, w = bw * 0.64; return `<g><title>${d.day}: ${d.dials} dials, ${d.connects} conversations, ${d.appts} appts</title><rect x="${x}" y="${Hh - h1}" width="${w}" height="${h1}" rx="3" fill="rgba(255,255,255,.12)"/><rect x="${x}" y="${Hh - h2}" width="${w}" height="${h2}" rx="3" fill="url(#hpdG)"/>${a.byDay.length <= 31 && (a.byDay.length <= 10 || i % Math.ceil(a.byDay.length / 10) === 0) ? `<text x="${x + w / 2}" y="${Hh + 15}" fill="#9AA1AE" font-size="10" text-anchor="middle">${d.day.slice(5)}</text>` : ""}</g>`; }).join("")}</svg>`;
    const hours = Array.from({ length: 14 }, (_, i) => i + 8);
    const hmax = Math.max(1, ...hours.map((h) => t.hours?.[h]?.dials || 0));
    const heat = `<div class="hpd-heat">${hours.map((h) => { const v = t.hours?.[h] || {}; const r = v.dials ? v.connects / v.dials : 0; const o = 0.08 + 0.92 * ((v.dials || 0) / hmax); return `<div title="${h}:00 ET · ${v.dials || 0} dials · ${pct(v.connects || 0, v.dials || 0)}% connect" style="background:rgba(255,${Math.round(46 + 112 * r * 3)},${Math.round(136 - 80 * r)},${o.toFixed(2)})">${v.dials ? Math.round(r * 100) + "%" : ""}</div>`; }).join("")}${hours.map((h) => `<span>${((h + 11) % 12) + 1}${h < 12 ? "a" : "p"}</span>`).join("")}</div>`;
    const dis = Object.entries(t.dispo || {}).sort((x, y) => y[1] - x[1]); const dmax = Math.max(1, ...dis.map((d) => d[1]));
    const best = hours.filter((h) => (t.hours?.[h]?.dials || 0) >= 10).sort((x, y) => (t.hours[y].connects / t.hours[y].dials) - (t.hours[x].connects / t.hours[x].dials))[0];
    el.innerHTML = el.firstElementChild.outerHTML + `
      <div class="hpd-kpis">
        ${k(t.dials.toLocaleString(), "Dials")}
        ${k(t.connects.toLocaleString(), "Conversations", pct(t.connects, t.dials) + "% connect rate")}
        ${k(t.appts.toLocaleString(), "Appointments", t.appts ? Math.round(t.dials / t.appts) + " dials per appt" : "")}
        ${k(dur(t.talkSec), "Talk time", t.connects ? "avg " + dur(t.talkSec / Math.max(1, t.connects)) : "")}
        ${k(pct(t.answered, t.dials) + "%", "Answer rate", `${t.machines} voicemails`)}
        ${k(pct(t.abandoned, t.answered) + "%", "Abandoned", `limit ${S.settings.abandonCap ?? 3}%`)}
      </div>
      <div class="hpd-grid2">
        <div class="panel stack hpd-chart"><h2>Dials vs conversations</h2>${chart}</div>
        <div class="panel stack"><h2>Best hours to call</h2><p class="hpd-sm" style="margin:0">Connect rate by hour (Eastern).${best ? ` Your best hour is <b style="color:var(--hp-ink)">${((best + 11) % 12) + 1}${best < 12 ? "am" : "pm"}</b>.` : ""}</p>${heat}</div>
      </div>
      <div class="hpd-grid2">
        <div class="panel stack"><h2>Results</h2><div class="hpd-bars">${dis.map(([n, v]) => `<div class="r"><span>${esc(n)}</span><span class="t"><i style="width:${(v / dmax) * 100}%"></i></span><span class="num">${v}</span></div>`).join("") || `<span class="hpd-sm">Log some calls to see results here.</span>`}</div></div>
        <div class="panel stack"><h2>Caller ID performance</h2><table class="hpd-tbl"><thead><tr><th>Number</th><th>Dials</th><th>Answer rate</th><th class="hide-sm">Hang-ups &lt;10s</th></tr></thead><tbody>${a.numbers.slice(0, 12).map((n) => `<tr><td class="num">${esc(fmt(n.e164))}</td><td class="num">${n.dials}</td><td class="num">${pct(n.answered, n.dials)}%</td><td class="num hide-sm">${n.short}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">No dials yet</td></tr>`}</tbody></table></div>
      </div>
      <div class="hpd-grid2">
        <div class="panel stack"><h2>Productivity</h2>${prodPanel(t)}</div>
        <div class="panel stack"><h2>Campaigns</h2>${campPanel()}</div>
      </div>
      ${a.agents.length > 1 || who === "all" ? `<div class="panel stack"><h2>Team leaderboard</h2><div style="overflow-x:auto"><table class="hpd-tbl"><thead><tr><th>Agent</th><th>Dials</th><th>Conversations</th><th>Connect %</th><th>Appts</th><th class="hide-sm">Talk time</th><th class="hide-sm">Abandoned</th></tr></thead><tbody>${a.agents.map((g, i) => `<tr><td><b>${i < 3 ? ["🥇", "🥈", "🥉"][i] + " " : ""}${esc(g.name)}</b></td><td class="num">${g.dials}</td><td class="num">${g.connects}</td><td class="num">${pct(g.connects, g.dials)}%</td><td class="num"><b>${g.appts}</b></td><td class="num hide-sm">${dur(g.talkSec)}</td><td class="num hide-sm">${pct(g.abandoned, g.answered)}%</td></tr>`).join("")}</tbody></table></div></div>` : ""}
      <div class="panel stack"><div class="row" style="justify-content:space-between"><h2>Recent calls</h2><button class="btn" id="hpdCsv" type="button">Download CSV</button></div>
        <div style="overflow-x:auto"><table class="hpd-tbl"><thead><tr><th>Lead</th><th>When</th><th>Result</th><th>Talk</th><th class="hide-sm">From</th><th>Recording</th></tr></thead><tbody>
        ${calls.calls.slice(0, 80).map((c) => `<tr><td><b>${esc(c.leadName || fmt(c.to))}</b><br><span class="hpd-sm">${esc(fmt(c.to))}${who === "all" ? " · " + esc(c.agentName || "") : ""}</span></td><td class="hpd-sm">${new Date(c.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td><td><span class="hpd-pill ${/Appointment/.test(c.disposition) ? "good" : /Not interested|Bad|Do not/.test(c.disposition || "") ? "bad" : ""}">${esc(c.disposition || (c.human ? "Talked" : c.machine ? "Voicemail" : c.status || ""))}</span></td><td class="num">${c.talkSec ? dur(c.talkSec) : "—"}</td><td class="hide-sm num hpd-sm">${esc(fmt(c.from))}</td><td>${c.recordingSid ? `<button class="btn" data-play="${esc(c.sid)}" type="button">Play</button> <button class="btn" data-tx="${esc(c.sid)}" type="button">Transcript</button>` : "—"}</td></tr>`).join("") || `<tr><td colspan="6" class="muted">No calls yet</td></tr>`}
        </tbody></table></div><div id="hpdTxView"></div></div>`;
    $("#hpdRange").onchange = (e) => { lsSet("hpd.range", +e.target.value); renderStats(); };
    $("#hpdWho")?.addEventListener("change", (e) => { lsSet("hpd.who", e.target.value); renderStats(); });
    $$("[data-play]", el).forEach((b) => (b.onclick = async () => {
      if (S.demo) { toast("Recordings play here once real calls are made"); return; }
      const r = await fetch(API + "/calls/recording?sid=" + encodeURIComponent(b.dataset.play), { headers: authHeader(), credentials: "same-origin" });
      if (!r.ok) { toast("Recording isn't ready yet"); return; }
      const au = document.createElement("audio"); au.controls = true; au.autoplay = true; au.src = URL.createObjectURL(await r.blob()); au.style.height = "32px"; b.replaceWith(au);
    }));
    $$("[data-tx]", el).forEach((b) => (b.onclick = async () => {
      const r = await api("/calls/transcript?sid=" + encodeURIComponent(b.dataset.tx));
      const box = $("#hpdTxView"); box.innerHTML = `<div class="hpd-tx" style="max-height:320px;margin-top:10px"></div>`;
      const ofCall = calls.calls.find((c) => c.sid === b.dataset.tx); const pm = ofCall?.mode === "power";
      box.firstChild.innerHTML = (r.lines || []).map((l) => { const w = (l.track === "inbound_track") === pm ? "Lead" : "Agent"; return `<p><span class="who ${w}">${w === "Agent" ? "Agent" : "Lead"}</span>${esc(l.text)}</p>`; }).join("") || `<p class="hpd-sm">No transcript for this call.</p>`;
      box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }));
    $("#hpdCsv").onclick = () => {
      const rows = [["Lead", "Phone", "Agent", "When", "Result", "Talk seconds", "Caller ID", "Mode", "Answered by"], ...calls.calls.map((c) => [c.leadName, c.to, c.agentName, new Date(c.at).toISOString(), c.disposition || "", c.talkSec || 0, c.from, c.mode, c.answeredBy || ""])];
      const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
      const a2 = document.createElement("a"); a2.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a2.download = `highpoint-calls-${new Date().toISOString().slice(0, 10)}.csv`; a2.click();
    };
  }

  function prodPanel(t) {
    const ss = t.statusSec || {}; const total = Object.values(ss).reduce((x, y) => x + y, 0);
    if (!total) return `<p class="hpd-sm" style="margin:0">Set your status in the top bar (Ready, Break, Lunch…). Time in each status shows here.</p>`;
    const readyH = (ss.ready || 0) / 3600;
    const rows = STATUSES.filter(([k]) => ss[k]).map(([k, n]) => `<div class="r"><span>${n}</span><span class="t"><i style="width:${(ss[k] / total) * 100}%"></i></span><span class="num">${dur(ss[k])}</span></div>`).join("");
    return `<div class="hpd-kpis" style="grid-template-columns:repeat(3,1fr)"><div><span class="num">${dur(ss.ready || 0)}</span><span class="muted">Time ready</span></div><div><span class="num">${readyH ? Math.round(t.dials / readyH) : 0}</span><span class="muted">Dials per ready hour</span></div><div><span class="num">${pct(t.talkSec, ss.ready || 0)}%</span><span class="muted">Ready time talking</span></div></div><div class="hpd-bars">${rows}</div>`;
  }
  function campPanel() {
    const list = campaigns(); if (!list.length) return `<p class="hpd-sm" style="margin:0">Import a CSV to create your first campaign.</p>`;
    const leads = [...window.hpDesk.leads.values()];
    return `<table class="hpd-tbl"><thead><tr><th>Campaign</th><th>Leads</th><th>Called</th><th class="hide-sm">Left to call</th><th>Appts</th></tr></thead><tbody>${list.slice(0, 15).map((c) => { const ls2 = leads.filter((l) => (l.source || "No campaign") === c.name); const called = ls2.filter((l) => l.callCount).length; return `<tr><td><b>${esc(c.name)}</b><div class="hpd-meter" style="margin-top:4px"><i style="width:${pct(called, c.total)}%"></i></div></td><td class="num">${c.total}</td><td class="num">${called}</td><td class="num hide-sm">${c.ready}</td><td class="num">${ls2.filter((l) => ["appointment", "application", "sold"].includes(l.stage)).length}</td></tr>`; }).join("")}</tbody></table>`;
  }

  /* ================= inbox + voicemail drops + settings ================= */
  async function inboxBadge() { try { const r = await api("/calls/inbox"); const sms = await api("/sms").catch(() => ({ threads: [] })); const n = r.items.length + sms.threads.filter((t) => t.unread).length; const b = $("#hpdInboxN"); if (b) { b.hidden = !n; b.textContent = n; } } catch {} }
  async function loadGreetings() { try { S.greetings = (await api("/vm")).greetings; } catch {} }
  async function renderInbox() {
    const el = $("#hpdInbox"); el.innerHTML = `<div class="panel">Loading…</div>`;
    let items = [], threads = [];
    try { [items, threads] = await Promise.all([api("/calls/inbox").then((r) => r.items), api("/sms").then((r) => r.threads).catch(() => [])]); await loadGreetings(); } catch (e) { el.innerHTML = `<div class="panel">${esc(e.message)}</div>`; return; }
    const leadBy = (n) => [...(window.hpDesk?.leads.values() || [])].find((l) => d10(l.phone) === d10(n));
    const nm = (n) => { const l = leadBy(n); return l ? window.hpDesk.fullName(l) : fmt(n); };
    const set = S.settings;
    el.innerHTML = `
      <div class="hpd-grid2">
        <div class="panel stack" style="gap:10px"><h2>Missed calls &amp; voicemails</h2>
          <div class="hpd-inbox">${items.map((it) => `<div class="hpd-item"><span class="ic">${it.kind === "voicemail" ? I.vm : I.phone}</span><span><b>${esc(nm(it.from))}</b><br><span class="hpd-sm">${it.kind === "voicemail" ? `Voicemail · ${dur(it.sec)}` : "Missed call"} · ${new Date(it.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>${it.kind === "voicemail" ? `<br><button class="btn" data-vmplay="${esc(it.key)}" type="button" style="margin-top:6px">Play</button>` : ""}</span><span class="hpd-flex"><button class="btn primary" data-cb="${esc(it.from)}" type="button">Call back</button><button class="btn" data-done="${esc(it.key)}" type="button">Done</button></span></div>`).join("") || `<span class="hpd-sm">Nothing waiting. Calls to your numbers ring here while you're signed in; missed ones land in this list.</span>`}</div>
        </div>
        <div class="panel stack" style="gap:10px"><h2>Texts</h2>
          <div class="hpd-inbox">${threads.map((t) => `<button class="hpd-item" style="all:unset;cursor:pointer;display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;padding:12px;border-radius:14px;border:1px solid var(--hp-line)" data-thread="${esc(t.with)}"><span class="ic">${I.sms}</span><span><b>${esc(nm(t.with))}</b><br><span class="hpd-sm">${esc(t.preview)}</span></span>${t.unread ? `<span class="hpd-pill good">${t.unread}</span>` : ""}</button>`).join("") || `<span class="hpd-sm">No texts yet. Text a lead from the box below.</span>`}</div>
          <div id="hpdThread"></div>
          <div class="hpd-flex"><input id="hpdSmsTo" placeholder="Number" style="width:150px" inputmode="tel" value="${esc(currentLead() ? d10(currentLead().phone) : "")}"><input id="hpdSmsBody" placeholder="Message" style="flex:1;min-width:160px"><button class="btn primary" id="hpdSmsSend" type="button">Send</button></div>
          <span class="hpd-sm">Texting needs your business registered for A2P 10DLC in Twilio. Leads who reply STOP are added to Do Not Call automatically.</span>
        </div>
      </div>
      <div class="hpd-grid2">
        <div class="panel stack" style="gap:10px"><h2>My voicemail drops</h2>
          <p class="hpd-sm" style="margin:0">Record a message once. When you reach a mailbox, press Drop VM and it plays after the beep while you move to the next call.</p>
          <div class="hpd-inbox">${S.greetings.map((g) => `<div class="hpd-item"><span class="ic">${I.vm}</span><span><b>${esc(g.name)}</b><br><span class="hpd-sm">${dur(g.sec)}${S.prefs.vmGreeting === g.key ? " · default" : ""}</span></span><span class="hpd-flex"><button class="btn" data-gplay="${esc(g.id)}" type="button">Play</button>${S.prefs.vmGreeting === g.key ? "" : `<button class="btn" data-gdef="${esc(g.key)}" type="button">Make default</button>`}<button class="btn" data-gdel="${esc(g.id)}" type="button">Delete</button></span></div>`).join("") || `<span class="hpd-sm">No voicemail drops yet.</span>`}</div>
          <div class="hpd-flex"><input id="hpdGName" placeholder="Name, e.g. Final expense follow-up" style="flex:1;min-width:200px"><button class="btn primary" id="hpdRecBtn" type="button">${I.mic} Record</button></div>
          <div id="hpdRecState" class="hpd-sm"></div>
          <label class="hpd-flex hpd-sm"><input type="checkbox" id="hpdAutoVm" ${S.prefs.autoVm ? "checked" : ""}> In power dialing, leave my default voicemail automatically when a mailbox answers</label>
        </div>
        ${S.me?.admin ? settingsCard(set) : `<div class="panel stack"><h2>Do Not Call</h2><p class="hpd-sm" style="margin:0">Numbers on the list can't be called or texted by anyone on the team.</p><div class="hpd-flex"><input id="hpdDncN" placeholder="Number to block" inputmode="tel" style="flex:1"><button class="btn" id="hpdDncAdd" type="button">Add to Do Not Call</button></div></div>`}
      </div>`;
    // actions
    $$("[data-cb]", el).forEach((b) => (b.onclick = () => { const l = leadBy(b.dataset.cb); if (l) { window.hpDesk.setCurrent(l.id); $('#dTabs [data-dt="dial"]').click(); dialLead(l); } else { dialLead({ id: "", phone: b.dataset.cb, first: fmt(b.dataset.cb) }); } }));
    $$("[data-done]", el).forEach((b) => (b.onclick = async () => { await api("/calls/inbox", { method: "POST", body: { key: b.dataset.done, done: true } }); renderInbox(); inboxBadge(); }));
    $$("[data-vmplay]", el).forEach((b) => (b.onclick = async () => { const r = await fetch(API + "/calls/vmaudio?key=" + encodeURIComponent(b.dataset.vmplay), { headers: authHeader(), credentials: "same-origin" }); if (!r.ok) return toast("Couldn't load voicemail"); const au = new Audio(URL.createObjectURL(await r.blob())); au.controls = true; b.replaceWith(au); au.play(); }));
    $$("[data-thread]", el).forEach((b) => (b.onclick = async () => { const r = await api("/sms?with=" + b.dataset.thread); $("#hpdSmsTo").value = b.dataset.thread; $("#hpdThread").innerHTML = `<div class="hpd-thread">${(r.thread?.msgs || []).map((m) => `<p class="${m.dir}">${esc(m.body)}</p>`).join("")}</div>`; const th = $(".hpd-thread"); th.scrollTop = th.scrollHeight; inboxBadge(); }));
    $("#hpdSmsSend").onclick = async () => { const to = $("#hpdSmsTo").value, body = $("#hpdSmsBody").value; try { const r = await api("/sms/send", { method: "POST", body: { to, body, leadId: leadBy(to)?.id } }); $("#hpdSmsBody").value = ""; $("#hpdThread").innerHTML = `<div class="hpd-thread">${r.thread.msgs.map((m) => `<p class="${m.dir}">${esc(m.body)}</p>`).join("")}</div>`; toast("Sent"); } catch (e) { toast(e.message); } };
    $$("[data-gplay]", el).forEach((b) => (b.onclick = async () => { if (S.demo) { const g = Demo.greetingAudio(b.dataset.gplay); if (g) new Audio(g).play(); return; } const r = await fetch(API + "/vm/listen?id=" + b.dataset.gplay, { headers: authHeader(), credentials: "same-origin" }); new Audio(URL.createObjectURL(await r.blob())).play(); }));
    $$("[data-gdef]", el).forEach((b) => (b.onclick = () => { savePrefs({ vmGreeting: b.dataset.gdef }); renderInbox(); }));
    $$("[data-gdel]", el).forEach((b) => (b.onclick = async () => { if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Delete?"; return; } await api("/vm?id=" + b.dataset.gdel, { method: "DELETE" }); renderInbox(); }));
    $("#hpdAutoVm").onchange = (e) => savePrefs({ autoVm: e.target.checked, vmGreeting: S.prefs.vmGreeting || S.greetings[0]?.key || "" });
    $("#hpdRecBtn").onclick = recordGreeting;
    $("#hpdDncAdd")?.addEventListener("click", async () => { try { await api("/calls/dnc", { method: "POST", body: { number: $("#hpdDncN").value } }); toast("Added to Do Not Call"); $("#hpdDncN").value = ""; } catch (e) { toast(e.message); } });
    if (S.me?.admin) wireSettings(el);
  }

  function settingsCard(s) {
    const rules = Object.entries(s.stateRules || {}).map(([st, r]) => `${st} ${r.start}-${r.end}${r.max24h ? " max" + r.max24h : ""}${r.noSunday ? " nosun" : ""}${r.sunStart ? " sun" + r.sunStart : ""}`).join("\n");
    const f = (id, label, val, attrs = "") => `<label class="field"><span>${label}</span><input id="${id}" value="${esc(val ?? "")}" ${attrs}></label>`;
    const c = (id, label, val) => `<label class="hpd-flex hpd-sm"><input type="checkbox" id="${id}" ${val ? "checked" : ""}> ${label}</label>`;
    return `<div class="panel stack" style="gap:10px"><h2>Team dialer settings</h2>
      <div class="hpd-grid2" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px">
        ${f("hsCo", "Company name spoken in messages", s.company)}
        ${f("hsCb", "Call-back number for messages", s.callbackNumber, 'inputmode="tel" placeholder="(305) 555-0100"')}
        ${f("hsLines", "Max lines per agent (1-3)", s.maxLines, 'type="number" min="1" max="3"')}
        ${f("hsAb", "Abandoned-call limit %", s.abandonCap, 'type="number" min="1" max="10" step="0.5"')}
        ${f("hsCap", "Daily dials per number", s.dailyCapPerNumber, 'type="number" min="10" max="300"')}
        ${f("hsAtt", "Max calls per lead per 24h", s.maxAttempts24h, 'type="number" min="1" max="10"')}
        ${f("hsBuy", "Numbers an agent can buy", s.agentMaxNumbers, 'type="number" min="0" max="50"')}
        ${f("hsRamp", "Warm-up days for new numbers", s.rampDays, 'type="number" min="0" max="30"')}
      </div>
      ${c("hsRec", "Record calls (both sides)", s.record)}
      ${c("hsNotice", "Play “this call may be recorded” before connecting (needed for two-party consent states like FL, CA, PA, WA unless agents say it)", s.recordNotice)}
      ${c("hsTx", "Live transcription", s.transcribe)}
      ${c("hsLp", "Local presence (match caller ID to the lead's area code)", s.localPresence)}
      ${c("hsPool", "Agents can borrow team numbers for local presence", s.sharedPool)}
      ${c("hsAmd", "Multi-line: hang up on machines automatically and keep dialing", s.amdAutoSkip)}
      <label class="field"><span>Inbound voicemail greeting</span><input id="hsGreet" value="${esc(s.inboundGreeting)}"></label>
      <label class="field"><span>State calling rules (one per line: ST start-end, optional max3, nosun, sun12)</span><textarea id="hsRules" rows="5">${esc(rules)}</textarea></label>
      <div class="hpd-flex"><button class="btn primary" id="hsSave" type="button">Save settings</button><span class="hpd-sm">Calling windows follow the lead's local time. Confirm state rules with your compliance advisor.</span></div>
      <h2 style="margin-top:8px">Do Not Call</h2>
      <div class="hpd-flex"><textarea id="hpdDncN" rows="2" placeholder="Paste numbers to block, one per line" style="flex:1"></textarea><div class="stack" style="gap:6px"><button class="btn" id="hpdDncAdd" type="button">Add</button><button class="btn" id="hpdDncDel" type="button">Remove</button></div></div>
    </div>`;
  }
  function wireSettings(el) {
    $("#hsSave", el).onclick = async () => {
      const rules = {};
      for (const line of $("#hsRules").value.split("\n")) {
        const m = line.trim().match(/^([A-Z]{2})\s+(\d{1,2})-(\d{1,2})(.*)$/i); if (!m) continue;
        const r = { start: +m[2], end: +m[3] }; const rest = m[4] || "";
        const mx = rest.match(/max(\d+)/i); if (mx) r.max24h = +mx[1]; if (/nosun/i.test(rest)) r.noSunday = true; const ss = rest.match(/sun(\d+)/i); if (ss) r.sunStart = +ss[1];
        rules[m[1].toUpperCase()] = r;
      }
      const settings = { company: $("#hsCo").value, callbackNumber: d10($("#hsCb").value), maxLines: +$("#hsLines").value, abandonCap: +$("#hsAb").value, dailyCapPerNumber: +$("#hsCap").value, maxAttempts24h: +$("#hsAtt").value, agentMaxNumbers: +$("#hsBuy").value, rampDays: +$("#hsRamp").value, record: $("#hsRec").checked, recordNotice: $("#hsNotice").checked, transcribe: $("#hsTx").checked, localPresence: $("#hsLp").checked, sharedPool: $("#hsPool").checked, amdAutoSkip: $("#hsAmd").checked, inboundGreeting: $("#hsGreet").value, stateRules: rules };
      try { const r = await api("/setup", { method: "PUT", body: { settings } }); S.settings = r.settings; toast("Dialer settings saved"); } catch (e) { toast(e.message); }
    };
    $("#hpdDncAdd", el).onclick = async () => { const nums = $("#hpdDncN").value.split(/[\n,;]+/).map(d10).filter((x) => x.length === 10); if (!nums.length) return; await api("/calls/dnc", { method: "POST", body: { numbers: nums } }); toast(`${nums.length} added to Do Not Call`); $("#hpdDncN").value = ""; };
    $("#hpdDncDel", el).onclick = async () => { const nums = $("#hpdDncN").value.split(/[\n,;]+/).map(d10).filter((x) => x.length === 10); if (!nums.length) return; await api("/calls/dnc", { method: "DELETE", body: { numbers: nums } }); toast(`${nums.length} removed`); $("#hpdDncN").value = ""; };
  }

  /* record a greeting in the browser → 8 kHz mono WAV (what phones play) */
  async function recordGreeting() {
    const btn = $("#hpdRecBtn"), stEl = $("#hpdRecState");
    if (S.rec) { S.rec.stop(); return; }
    let stream; try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); } catch { toast("Allow the microphone to record"); return; }
    const chunks = []; const mr = new MediaRecorder(stream); S.rec = mr; const t0 = Date.now();
    mr.ondataavailable = (e) => chunks.push(e.data);
    const tick = setInterval(() => { stEl.innerHTML = `<span class="hpd-rec"><span class="dot"></span>Recording ${dur((Date.now() - t0) / 1000)} · press Stop when done</span>`; if (Date.now() - t0 > 60000) mr.stop(); }, 250);
    btn.innerHTML = "Stop";
    mr.onstop = async () => {
      clearInterval(tick); stream.getTracks().forEach((t) => t.stop()); S.rec = null; btn.innerHTML = `${I.mic} Record`;
      stEl.textContent = "Saving…";
      try {
        const buf = await new Blob(chunks).arrayBuffer();
        const ac = new AudioContext(); const decoded = await ac.decodeAudioData(buf); ac.close();
        const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * 8000), 8000);
        const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
        const pcm = (await off.startRendering()).getChannelData(0);
        const wav = toWav(pcm, 8000);
        const name = $("#hpdGName").value.trim() || "Voicemail " + (S.greetings.length + 1);
        const r = await api(`/vm/upload?name=${encodeURIComponent(name)}&sec=${Math.round(decoded.duration)}`, { method: "POST", body: wav, raw: true });
        if (!S.prefs.vmGreeting) savePrefs({ vmGreeting: r.greeting.key });
        toast("Voicemail drop saved"); renderInbox();
      } catch (e) { stEl.textContent = "Couldn't save: " + e.message; }
    };
    mr.start();
  }
  function toWav(f32, rate) {
    const n = f32.length, b = new ArrayBuffer(44 + n * 2), v = new DataView(b); let peak = 0.0001;
    for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(f32[i]));
    const gain = Math.min(4, 0.89 / peak); // normalize loudness
    const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, f32[i] * gain)) * 0x7fff, true);
    return b;
  }

  /* ================= demo backend (preview without Twilio) ================= */
  const Demo = (() => {
    const now = Date.now(); const greetings = []; const audio = {};
    const nums = [
      { e164: "+13055550142", state: "FL", areaCode: "305", label: "Miami", mine: true, owner: "me", boughtAt: now - 40 * 864e5, health: { status: "healthy", why: [], todayDials: 41, cap: 75, week: { dials: 310, answered: 52 } } },
      { e164: "+17865550188", state: "FL", areaCode: "786", label: "", mine: true, owner: "me", boughtAt: now - 6 * 864e5, health: { status: "healthy", why: ["warming up (day 7 of 14)"], todayDials: 18, cap: 38, week: { dials: 120, answered: 22 } } },
      { e164: "+19545550111", state: "FL", areaCode: "954", label: "Broward", shared: true, ownerName: "Team", boughtAt: now - 90 * 864e5, health: { status: "watch", why: ["only 5.1% of calls answered this week"], todayDials: 12, cap: 75, week: { dials: 196, answered: 10 } } },
      { e164: "+14075550123", state: "FL", areaCode: "407", label: "Orlando", shared: true, ownerName: "Team", boughtAt: now - 60 * 864e5, health: { status: "healthy", why: [], todayDials: 9, cap: 75, week: { dials: 144, answered: 27 } } },
    ];
    const settings = { company: "Highpoint Financial", callbackNumber: "3055550100", maxLines: 3, abandonCap: 3, dailyCapPerNumber: 75, rampDays: 14, record: true, recordNotice: false, transcribe: true, localPresence: true, sharedPool: true, agentMaxNumbers: 5, maxAttempts24h: 3, amdAutoSkip: true, inboundGreeting: "You've reached Highpoint Financial. Please leave your name and number and we'll call you right back.", stateRules: { FL: { start: 8, end: 20, max24h: 3 }, TX: { start: 9, end: 21, sunStart: 12 } } };
    const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
    const day = (i) => new Date(now - i * 864e5).toISOString().slice(0, 10);
    const sess = {}; let sidN = 0; const txs = {};
    const SCRIPT = [["outbound_track", "Hello?"], ["inbound_track", "Hi, is this Margaret? This is Alex with Highpoint Financial."], ["outbound_track", "Yes, this is she."], ["inbound_track", "You'd sent in a request about final expense coverage. Do you have a couple of minutes?"], ["outbound_track", "Sure, I've been meaning to look into that."]];
    class Call {
      constructor(params) { this.params = params; this.h = {}; this.parameters = { CallSid: "CA_demo" + ++sidN }; this.customParameters = new Map(); this.t = []; const sid = this.parameters.CallSid;
        if (params.Mode !== "conf") { txs[sid] = { lines: [], at: 0, by: "" }; this.t.push(setTimeout(() => this.emit("ringing"), 300), setTimeout(() => { txs[sid].at = Date.now(); this.emit("accept"); }, 2400)); }
        else this.t.push(setTimeout(() => this.emit("accept"), 500));
      }
      on(e, f) { (this.h[e] = this.h[e] || []).push(f); } emit(e, a) { (this.h[e] || []).forEach((f) => f(a)); }
      mute() {} sendDigits() {} disconnect() { this.t.forEach(clearTimeout); this.emit("disconnect"); } accept() {} reject() {}
    }
    class Device { constructor() { this.state = "registered"; } on() {} async connect({ params }) { return new Call(params); } updateToken() {} }
    function liveTx(sid) { const t = txs[sid]; if (!t?.at) return []; const n = Math.min(SCRIPT.length, Math.floor((Date.now() - t.at) / 2200)); return SCRIPT.slice(0, n).map(([track, text], i) => ({ track, text, t: t.at + i * 2200 })); }
    async function api(path, { method, body }) {
      await sleep(120);
      const p = path.split("?")[0], q = new URLSearchParams(path.split("?")[1] || "");
      if (p === "/setup") { if (method === "PUT") { Object.assign(settings, body.settings || {}); return { settings }; } return { ok: true }; }
      if (p === "/numbers") return { numbers: nums, agents: { me: "You", a2: "Jordan R.", a3: "Kiara M." } };
      if (p === "/numbers/search") { const ac = q.get("areaCode") || "305"; return { results: Array.from({ length: 9 }, () => ({ e164: `+1${ac}555${String(rnd(1000, 9999))}`, city: { 305: "Miami", 786: "Miami", 954: "Fort Lauderdale", 407: "Orlando", 813: "Tampa" }[ac] || "", state: q.get("state") || "FL" })) }; }
      if (p === "/numbers/buy") { nums.unshift({ e164: body.phoneNumber, state: "FL", areaCode: body.phoneNumber.slice(2, 5), mine: true, boughtAt: Date.now(), health: { status: "healthy", why: ["warming up (day 1 of 14)"], todayDials: 0, cap: 15, week: { dials: 0, answered: 0 } } }); return { ok: true }; }
      if (p === "/numbers/update") { const n = nums.find((x) => x.e164 === body.e164); if (n) { if ("paused" in body) n.paused = body.paused; if (body.spamReport) { n.paused = true; n.health.status = "flagged"; n.health.why = ["1 spam-label report"]; } if ("owner" in body) n.owner = body.owner; } return { ok: true }; }
      if (p === "/numbers/release") { nums.splice(nums.findIndex((x) => x.e164 === body.e164), 1); return { ok: true }; }
      if (p === "/numbers/import") return { added: 0 };
      if (p === "/calls/analytics") {
        const n = +q.get("days") || 7; const byDay = []; const T = { dials: 0, answered: 0, connects: 0, machines: 0, abandoned: 0, short: 0, talkSec: 0, appts: 0, dispo: {}, hours: {} };
        for (let i = n - 1; i >= 0; i--) { const dd = rnd(90, 260), an = Math.round(dd * (0.15 + Math.random() * 0.08)), co = Math.round(an * 0.62), ap = Math.round(co * (0.1 + Math.random() * 0.08)); byDay.push({ day: day(i), dials: dd, answered: an, connects: co, appts: ap, talkSec: co * rnd(90, 240) }); T.dials += dd; T.answered += an; T.connects += co; T.appts += ap; T.machines += an - co; T.talkSec += co * rnd(90, 240); }
        T.abandoned = Math.round(T.answered * 0.012);
        T.statusSec = { ready: n * 5.2 * 3600, acw: n * 0.6 * 3600, break: n * 0.5 * 3600, lunch: n * 0.75 * 3600, meeting: n * 0.2 * 3600 };
        for (let h = 8; h <= 21; h++) { const dd = Math.round((T.dials / 14) * (0.6 + Math.random() * 0.8)); const r = [10, 11, 16, 17, 18].includes(h) ? 0.17 : 0.09; T.hours[h] = { dials: dd, connects: Math.round(dd * r) }; }
        T.dispo = { "No answer": Math.round(T.dials * 0.62), "Left voicemail": T.machines, "Not interested": Math.round(T.connects * 0.4), "Callback scheduled": Math.round(T.connects * 0.22), "Appointment set": T.appts, "Bad number": Math.round(T.dials * 0.04) };
        const agents = q.get("agent") === "all" ? ["You", "Jordan R.", "Kiara M.", "Dre W."].map((name, i) => { const f = [1, 0.85, 0.72, 0.55][i]; return { id: "a" + i, name, dials: Math.round(T.dials * f / 2.5), connects: Math.round(T.connects * f / 2.5), appts: Math.round(T.appts * f / 2.5), talkSec: Math.round(T.talkSec * f / 2.5), answered: Math.round(T.answered * f / 2.5), abandoned: i }; }) : [];
        return { total: T, byDay, numbers: nums.map((x) => ({ e164: x.e164, label: x.label, dials: x.health.week.dials, answered: x.health.week.answered, short: rnd(1, 9) })), agents };
      }
      if (p === "/calls") { const names = ["Margaret Ellis", "Luis Ortega", "Dorothy Hayes", "Marcus Reed", "Gloria Pina", "Earl Watkins", "Sandra Lowe"]; return { calls: names.map((nm2, i) => ({ sid: "CA_x" + i, leadName: nm2, to: "305555" + (1000 + i * 37), at: now - i * 3.1e6, disposition: ["Appointment set", "No answer", "Left voicemail", "Not interested", "Callback scheduled", "No answer", "Appointment set"][i], talkSec: [412, 0, 31, 75, 198, 0, 356][i], from: nums[i % 2].e164, recordingSid: i % 2 === 0 ? "RE" : "", agentName: "You", mode: "power" })) }; }
      if (p === "/calls/transcript") return { lines: SCRIPT.map(([track, text]) => ({ track, text })) };
      if (p === "/calls/live") { const sid = q.get("sid"); const t = txs[sid]; const lines = liveTx(sid); return { call: { answeredBy: t?.by || "human" }, transcript: lines, partial: [] }; }
      if (p === "/calls/dispo" || p === "/calls/dnc") return { ok: true };
      if (p === "/calls/inbox") return method === "POST" ? { ok: true } : { items: [{ key: "k1", kind: "voicemail", from: "3055550177", at: now - 36e5, sec: 22 }, { key: "k2", kind: "missed", from: "7865550123", at: now - 2 * 36e5 }] };
      if (p === "/sms") return q.get("with") ? { thread: { msgs: [{ dir: "out", body: "Hi Luis, it's Alex from Highpoint. Still good for 3pm tomorrow?" }, { dir: "in", body: "Yes see you then" }] } } : { threads: [{ with: "7865550123", preview: "Yes see you then", unread: 1, last: now }] };
      if (p === "/sms/send") return { thread: { msgs: [{ dir: "out", body: body.body }] } };
      if (p === "/vm") { if (method === "DELETE") { const i = greetings.findIndex((g) => g.id === q.get("id")); greetings.splice(i, 1); } return { greetings }; }
      if (p === "/vm/upload") { const id = "g" + Date.now(); const g = { id, key: "me/" + id, name: q.get("name"), sec: +q.get("sec"), at: Date.now() }; greetings.unshift(g); audio[id] = URL.createObjectURL(new Blob([body], { type: "audio/wav" })); return { greeting: g }; }
      if (p === "/vm/drop") { if (body.session) { const v = sess[body.session]; const l = v?.calls[v.connected]; if (l) { l.result = "Left voicemail"; l.status = "completed"; v.connected = null; } } return { dropped: true }; }
      if (p === "/power/start") { const id = "s" + Date.now(); sess[id] = { id, lines: body.lines, active: true, calls: {}, connected: null, batch: 0 }; return { session: id, lines: body.lines }; }
      if (p === "/power/dial") {
        const v = sess[body.session]; v.batch++; const placed = [];
        const winner = Math.random() < 0.55 ? rnd(0, body.leads.length - 1) : -1; const machine = winner >= 0 && Math.random() < 0.3;
        body.leads.forEach((l, i) => { const sid = "CA_p" + ++sidN; const lp = nums.find((n) => n.areaCode === d10(l.phone).slice(0, 3)) || nums[i % 2]; v.calls[sid] = { leadId: l.id, name: l.name, to: d10(l.phone), from: lp.e164, batch: v.batch, status: "queued", t0: Date.now(), plan: i === winner ? (machine ? "machine" : "human") : "none", ring: rnd(2500, 5000) }; placed.push({ leadId: l.id, sid }); });
        return { batch: v.batch, placed, skipped: [] };
      }
      if (p === "/power/state") {
        const v = sess[q.get("session")]; if (!v) { const e = new Error("gone"); e.status = 404; throw e; }
        const t = Date.now();
        for (const [sid, l] of Object.entries(v.calls)) {
          if (l.batch !== v.batch || ["completed", "no-answer", "canceled"].includes(l.status)) continue;
          const age = t - l.t0;
          if (age > 600 && l.status === "queued") l.status = "ringing";
          if (l.plan !== "none" && age > l.ring && l.status === "ringing" && !v.connected) { l.status = "in-progress"; l.claimed = true; v.connected = sid; txs[sid] = { lines: [], at: t }; for (const [s2, o] of Object.entries(v.calls)) if (o.batch === v.batch && s2 !== sid && o.status === "ringing") o.status = "canceled"; }
          if (l.plan === "machine" && v.connected === sid && age > l.ring + 3500) { l.answeredBy = "machine_end_beep"; if (S.prefs.autoVm && S.greetings.length) { l.result = "Left voicemail"; } else l.result = "Machine – skipped"; l.status = "completed"; v.connected = null; }
          if (l.plan === "none" && age > 9000 && l.status === "ringing") l.status = "no-answer";
        }
        const live = v.connected && v.calls[v.connected].plan === "human" ? { lines: liveTx(v.connected).map((x) => ({ ...x, track: x.track === "inbound_track" ? "outbound_track" : "inbound_track" })), partial: [] } : null;
        return { ...v, live };
      }
      if (p === "/power/hangup") { for (const v of Object.values(sess)) if (v.connected) { v.calls[v.connected].status = "completed"; v.connected = null; } return { ok: true }; }
      if (p === "/power/end") { const v = sess[body.session]; if (v) v.active = false; return { ok: true }; }
      return { ok: true };
    }
    return {
      api, Device, greetingAudio: (id) => audio[id],
      boot: () => ({ ready: true, twilio: true, me: { name: "You", admin: true, identity: "me" }, settings, trust: { profile: true, shaken: true } }),
    };
  })();

  /* ================= campaigns ================= */
  const CLOSED = ["sold", "lost"];
  function campaigns() {
    const m = new Map();
    for (const l of window.hpDesk?.leads.values() || []) {
      const c = l.source || "No campaign";
      const e = m.get(c) || { name: c, total: 0, ready: 0, newest: 0 };
      e.total++; if (d10(l.phone).length === 10 && !CLOSED.includes(l.stage) && !l.dnc) e.ready++;
      e.newest = Math.max(e.newest, l.createdAt || 0); m.set(c, e);
    }
    return [...m.values()].sort((a, b) => b.newest - a.newest);
  }
  function campaignQueue() {
    if (!S.campaign) return window.hpDesk.dialQueue();
    return [...window.hpDesk.leads.values()]
      .filter((l) => (l.source || "No campaign") === S.campaign && d10(l.phone).length === 10 && !CLOSED.includes(l.stage) && !l.dnc)
      .sort((a, b) => (a.callbackAt || 0) - (b.callbackAt || 0) || (a.lastCallAt || 0) - (b.lastCallAt || 0) || (a.createdAt || 0) - (b.createdAt || 0));
  }

  /* ================= floating dialer (follows you around the desk) ================= */
  function renderFloat(list) {
    let f = $("#hpdFloat");
    if (!S.call && !S.power) { f?.remove(); return; }
    if (!f) {
      f = document.createElement("div"); f.id = "hpdFloat"; f.className = "hpd hpd-float"; document.body.append(f);
      const pos = lsGet("hpd.floatPos", null); if (pos) { f.style.left = Math.min(pos[0], innerWidth - 300) + "px"; f.style.top = Math.min(pos[1], innerHeight - 120) + "px"; f.style.right = "auto"; f.style.bottom = "auto"; }
    }
    const P = S.power;
    f.innerHTML = `
      <div class="hpd-fhead" id="hpdFDrag"><b>HP</b><span>${S.call ? "On call" : P?.connected ? "Connected" : P?.paused ? "Paused" : "Calling"}</span><span class="hpd-sm" style="margin-left:auto">${P ? esc(listName()) : ""}</span></div>
      <div class="hpd-fbtns">
        <button type="button" class="hpd-fb hang" id="hpdFHang" ${S.call || P?.connected ? "" : "disabled"}>${I.phone} Hangup</button>
        ${P ? `<button type="button" class="hpd-fb ${P.paused ? "go" : ""}" id="hpdFPause">${P.paused ? I.play + " Resume" : I.pause + " Pause"}</button>` : `<button type="button" class="hpd-fb" id="hpdFMute">${S.muted ? I.micoff : I.mic} ${S.muted ? "Unmute" : "Mute"}</button>`}
      </div>
      <div class="hpd-frows">${(list || []).map((l) => `<button type="button" class="hpd-frow" data-s="${l.s}" data-lead="${esc(l.leadId || "")}"><span><b>${esc(l.name || fmt(l.to))}</b><small>${esc(fmt(l.to))}</small></span><em>${esc(l.label)}</em></button>`).join("")}</div>
      <div class="hpd-fmini"><button type="button" id="hpdFVm" title="Drop voicemail">${I.vm}<span>Drop VM</span></button><button type="button" id="hpdFPad" title="Keypad">${I.pad}<span>Keypad</span></button>${P ? `<button type="button" id="hpdFMute2">${S.muted ? I.micoff : I.mic}<span>${S.muted ? "Unmute" : "Mute"}</span></button><button type="button" id="hpdFEnd">${I.skip}<span>End</span></button>` : ""}</div>`;
    $("#hpdFHang").onclick = hangup;
    $("#hpdFPause")?.addEventListener("click", togglePause);
    $("#hpdFMute")?.addEventListener("click", () => { toggleMute(); renderFloat(list); });
    $("#hpdFMute2")?.addEventListener("click", () => { toggleMute(); renderFloat(list); });
    $("#hpdFEnd")?.addEventListener("click", stopPower);
    $("#hpdFVm").onclick = dropVm;
    $("#hpdFPad").onclick = () => { openProfile(S.power?.connectedLead || S.callLead); setTimeout(() => { S.padOpen = true; const pd = $("#hpfPad"); if (pd) pd.hidden = false; }, 50); };
    $$(".hpd-frow", f).forEach((b) => (b.onclick = () => b.dataset.lead && openProfile(b.dataset.lead)));
    // drag
    const h = $("#hpdFDrag", f);
    h.onpointerdown = (e) => {
      const r = f.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top; h.setPointerCapture(e.pointerId);
      h.onpointermove = (m) => { const x = Math.max(4, Math.min(innerWidth - r.width - 4, m.clientX - dx)), y = Math.max(4, Math.min(innerHeight - 60, m.clientY - dy)); f.style.left = x + "px"; f.style.top = y + "px"; f.style.right = "auto"; f.style.bottom = "auto"; };
      h.onpointerup = () => { h.onpointermove = null; lsSet("hpd.floatPos", [parseInt(f.style.left), parseInt(f.style.top)]); };
    };
  }

  /* ================= lead profile (opens when a call connects) ================= */
  const FIELD_GROUPS = [
    ["Contact", [["first", "First name"], ["last", "Last name"], ["phone", "Phone", "tel"], ["phone2", "Alt phone", "tel"], ["email", "Email", "email"], ["address", "Street address"], ["city", "City"], ["state", "State"], ["zip", "Postal code"]]],
    ["Personal", [["dob", "Date of birth"], ["age", "Age", "number"]]],
    ["Coverage", [["product", "Product", "product"], ["mortgageBalance", "Mortgage balance", "number"], ["mortgagePayment", "Mortgage payment", "number"], ["lender", "Lender"]]],
  ];
  let PF = { id: null, list: [], tab: "all", q: "", compose: "note", collapsed: lsGet("hpd.pfCollapsed", {}) };

  function profileList() {
    if (S.power?.order?.length) return S.power.order;
    return campaignQueue().map((l) => l.id);
  }
  function openProfile(id, { keepList } = {}) {
    const D = window.hpDesk; if (!id || !D.leads.get(id)) return;
    if (!keepList || !PF.list.length) PF.list = profileList();
    if (!PF.list.includes(id)) PF.list = [id, ...PF.list];
    PF.id = id; D.setCurrent(id);
    let el = $("#hpdProfile");
    if (!el) { el = document.createElement("div"); el.id = "hpdProfile"; el.className = "hpd hpd-profile"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Lead profile"); document.body.append(el); }
    el.hidden = false; document.body.classList.add("hpd-pf-open");
    renderProfile();
    if (!S.demo) api("/sms?with=" + d10(D.leads.get(id).phone)).then((r) => { PF.sms = r.thread?.msgs || []; if (PF.id === id) drawTimeline(); }).catch(() => {});
    else PF.sms = [];
  }
  function closeProfile() { const el = $("#hpdProfile"); if (el) el.hidden = true; document.body.classList.remove("hpd-pf-open"); PF.id = null; }

  function renderProfile() {
    const D = window.hpDesk, l = D.leads.get(PF.id); const el = $("#hpdProfile"); if (!l || !el) return;
    const idx = PF.list.indexOf(l.id), n = PF.list.length;
    const live = (S.call && S.callLead === l.id) || (S.power?.connectedLead === l.id && S.power?.connected);
    const onAnother = (S.call || S.power?.connected) && !live;
    el.innerHTML = `
      <div class="hpf-top">
        <button type="button" class="hpf-x" id="hpfClose" aria-label="Close profile">✕</button>
        <div class="hpf-who"><span class="hpf-av">${esc(((l.first || "?")[0] + (l.last || "")[0] || "").toUpperCase())}</span><div><b>${esc(D.fullName(l))}</b><span class="hpd-sm">${esc(fmt(l.phone))}${l.state ? " · " + esc(l.state) : ""}${l.age ? " · " + esc(l.age) + " yrs" : ""}</span></div>
          ${live ? `<span class="hpd-chip" data-s="live"><i></i>On call <span id="hpfClock" class="num" style="margin-left:4px"></span></span>` : ""}</div>
        <div class="hpf-nav"><span class="hpd-sm">${esc(listName())} · ${idx + 1}/${n}</span><button type="button" id="hpfPrev" aria-label="Previous lead" ${idx <= 0 ? "disabled" : ""}>‹</button><button type="button" id="hpfNext" aria-label="Next lead" ${idx >= n - 1 ? "disabled" : ""}>›</button></div>
        <div class="hpf-acts">${live ? `<button type="button" class="btn hpd-hang" id="hpfHang">${I.phone} Hang up</button>` : `<button type="button" class="btn primary" id="hpfCall" ${onAnother || S.power ? "disabled" : ""}>${I.phone} Call</button>`}</div>
      </div>
      <div class="hpf-cols">
        <aside class="hpf-left">
          <div class="hpf-tabs" role="tablist">${[["all", "All fields"], ["dnc", "DND"], ["act", "Actions"]].map(([k, t]) => `<button type="button" role="tab" data-pft="${k}" aria-selected="${PF.tab === k}">${t}</button>`).join("")}</div>
          <div id="hpfLeft"></div>
        </aside>
        <section class="hpf-mid">
          <div class="hpf-midhead"><b>Conversations</b><button type="button" class="hpd-sm hpf-link" id="hpfScriptBtn">Script</button></div>
          <div class="hpf-script" id="hpfScript" hidden></div>
          <div class="hpf-tl" id="hpfTl"></div>
          <div class="hpf-live" id="hpfLiveWrap" ${live ? "" : "hidden"}><div class="hpd-sm" style="margin-bottom:6px">Live transcript</div><div class="hpd-tx" id="hpfTx"></div>
            <div class="hpd-pad" id="hpfPad" ${S.padOpen ? "" : "hidden"} style="margin-top:8px">${"123456789*0#".split("").map((k) => `<button type="button" data-pdtmf="${k}">${k}</button>`).join("")}</div></div>
          <div class="hpf-compose">
            <div class="hpf-ctabs">${[["note", "Note"], ["sms", "Text"]].map(([k, t]) => `<button type="button" data-pfc="${k}" aria-pressed="${PF.compose === k}">${t}</button>`).join("")}</div>
            <div class="hpd-flex" style="flex-wrap:nowrap"><textarea id="hpfMsg" rows="2" placeholder="${PF.compose === "sms" ? "Text " + esc(l.first || "this lead") + "…" : "Add a note to this lead…"}"></textarea><button type="button" class="btn primary" id="hpfSend">${PF.compose === "sms" ? "Send" : "Save"}</button></div>
          </div>
        </section>
        <aside class="hpf-right">
          <div class="hpf-card"><b>Log the call</b>
            <div class="hpf-dz">${[["na", "No answer"], ["vm", "Left voicemail"], ["bad", "Bad number"], ["cb", "Call back"], ["appt", "Appointment set"], ["ni", "Not interested"], ["dnc", "Do not call"]].map(([k, t]) => `<button type="button" class="btn ${k === "appt" ? "primary" : ""}" data-pdz="${k}">${t}</button>`).join("")}</div>
            <div class="hpd-flex" id="hpfWhen" hidden><input type="datetime-local" id="hpfAt" style="flex:1;min-width:0"><button type="button" class="btn primary" id="hpfWhenGo">Save</button></div>
            <input id="hpfNote" placeholder="Note for this call (optional)">
          </div>
          <div class="hpf-card"><div class="row" style="justify-content:space-between"><b>Appointments</b><button type="button" class="hpf-link hpd-sm" id="hpfAddAppt">+ Add</button></div><div id="hpfAppts"></div></div>
          <div class="hpf-card"><b>Lead</b><div class="hpf-kv">
            <span>Campaign</span><span>${esc(l.source || "—")}</span>
            <span>Stage</span><span><select id="hpfStage">${D.STAGES.map(([k, t]) => `<option value="${k}" ${(l.stage || "new") === k ? "selected" : ""}>${t}</option>`).join("")}</select></span>
            <span>Calls</span><span>${l.callCount || 0}${l.lastDisposition ? " · last: " + esc(l.lastDisposition) : ""}</span>
            <span>Added</span><span>${l.createdAt ? new Date(l.createdAt).toLocaleDateString() : "—"}</span>
            ${l.callbackAt ? `<span>Callback</span><span>${new Date(l.callbackAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>` : ""}
          </div></div>
        </aside>
      </div>`;
    // wiring
    $("#hpfClose").onclick = closeProfile;
    $("#hpfPrev").onclick = () => openProfile(PF.list[idx - 1], { keepList: true });
    $("#hpfNext").onclick = () => openProfile(PF.list[idx + 1], { keepList: true });
    $("#hpfCall")?.addEventListener("click", () => dialLead(l));
    $("#hpfHang")?.addEventListener("click", hangup);
    $$("[data-pft]", el).forEach((b) => (b.onclick = () => { PF.tab = b.dataset.pft; $$("[data-pft]", el).forEach((x) => x.setAttribute("aria-selected", x === b)); drawLeft(); }));
    $$("[data-pfc]", el).forEach((b) => (b.onclick = () => { PF.compose = b.dataset.pfc; renderProfile(); $("#hpfMsg").focus(); }));
    $$("[data-pdtmf]", el).forEach((b) => (b.onclick = () => dtmf(b.dataset.pdtmf)));
    $("#hpfScriptBtn").onclick = () => { const sc = $("#hpfScript"); sc.hidden = !sc.hidden; if (!sc.hidden) sc.innerHTML = scriptFor(l); };
    $("#hpfSend").onclick = () => sendCompose(l);
    $("#hpfMsg").onkeydown = (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) sendCompose(l); };
    $("#hpfStage").onchange = (e) => D.patchLead(l.id, { stage: e.target.value }).then(() => toast("Stage updated"));
    $$("[data-pdz]", el).forEach((b) => (b.onclick = () => profileDispo(l, b.dataset.pdz)));
    $("#hpfAddAppt").onclick = () => profileDispo(l, "appt", true);
    drawLeft(); drawTimeline(); drawAppts(l);
    if (live) { const tx = S.txByLead.get(l.id); if (tx) drawTx(tx); tickClock(); }
  }
  function tickClock() { clearInterval(PF.clock); const t0 = Date.now(); PF.clock = setInterval(() => { const c = $("#hpfClock"); if (!c) return clearInterval(PF.clock); const s = Math.round((Date.now() - (PF.liveAt || t0)) / 1000); c.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }, 1000); }

  function scriptFor(l) {
    const first = esc(l.first || "…");
    const s = { FE: `Hi, is this ${first}? This is [your name] with Highpoint Financial, calling about the request you sent in for final expense coverage, the plans that cover funeral and burial costs so your family isn't left with the bill. I just need to verify a couple of details and see what you qualify for.`, MP: `Hi ${first}, this is [your name] with Highpoint Financial. I'm following up on the mortgage protection form you sent back${l.lender ? " about your loan with " + esc(l.lender) : ""}. It's the coverage that pays off or keeps up the house payment if something happens to you. Is now an okay time?`, IUL: `Hi ${first}, this is [your name] with Highpoint Financial. You'd asked about building tax-advantaged savings that also carries life insurance. I'd like to learn a little about your goals and show you how an indexed universal life policy could fit.` }[l.product];
    return `<span class="label" style="display:block;margin-bottom:4px">Opener</span>${s || `Hi, is this ${first}? This is [your name] with Highpoint Financial following up on the life insurance information you requested. Do you have a couple of minutes?`}`;
  }

  function drawLeft() {
    const D = window.hpDesk, l = D.leads.get(PF.id), box = $("#hpfLeft"); if (!l || !box) return;
    if (PF.tab === "dnc") {
      box.innerHTML = `<div class="hpf-sec"><p class="hpd-sm" style="margin:0 0 10px">Do Not Call blocks this number for the whole team: no calls and no texts.</p>
        <label class="hpd-flex"><input type="checkbox" id="hpfDnc" ${l.dnc ? "checked" : ""}> Do not call or text this lead</label></div>`;
      $("#hpfDnc").onchange = async (e) => { const on = e.target.checked; await D.patchLead(l.id, { dnc: on }); if (on) api("/calls/dnc", { method: "POST", body: { number: l.phone, reason: "Marked on lead profile" } }).catch(() => {}); toast(on ? "Added to Do Not Call" : "Removed from this lead (an admin removes it from the team list)"); };
      return;
    }
    if (PF.tab === "act") {
      box.innerHTML = `<div class="hpf-sec hpf-actions">
        <button type="button" class="btn" id="hpfA1">${I.phone} Call ${esc(fmt(l.phone))}</button>
        ${l.phone2 ? `<button type="button" class="btn" id="hpfA2">${I.phone} Call alt ${esc(fmt(l.phone2))}</button>` : ""}
        <button type="button" class="btn" id="hpfA3">${I.sms} Text</button>
        <button type="button" class="btn" id="hpfA4">Book appointment</button>
        <button type="button" class="btn" id="hpfA5">Quote this lead</button>
        <button type="button" class="btn" id="hpfA6">Open classic editor</button>
        ${l.email ? `<div class="hpd-sm">Email: <span style="user-select:all">${esc(l.email)}</span></div>` : ""}</div>`;
      $("#hpfA1").onclick = () => dialLead(l);
      $("#hpfA2")?.addEventListener("click", () => dialLead({ ...l, phone: l.phone2 }));
      $("#hpfA3").onclick = () => { PF.compose = "sms"; renderProfile(); $("#hpfMsg").focus(); };
      $("#hpfA4").onclick = () => profileDispo(l, "appt", true);
      $("#hpfA5").onclick = () => { closeProfile(); D.go("quoter"); };
      $("#hpfA6").onclick = () => { closeProfile(); D.openDrawer(l.id); };
      return;
    }
    const q = PF.q.toLowerCase();
    const custom = Object.entries(l.fields || {});
    const groups = [...FIELD_GROUPS.map(([g, fs]) => [g, fs.map(([k, label, type]) => ({ k, label, type, v: l[k] }))]), ["From the lead file", custom.map(([k, v]) => ({ k: "f:" + k, label: k, v }))]];
    box.innerHTML = `<input type="search" id="hpfQ" placeholder="Search fields" value="${esc(PF.q)}" class="hpf-q">` + groups.map(([g, fs]) => {
      const shown = fs.filter((f) => !q || f.label.toLowerCase().includes(q) || String(f.v ?? "").toLowerCase().includes(q));
      if (!shown.length && (q || g !== "From the lead file")) return "";
      const closed = PF.collapsed[g] && !q;
      return `<div class="hpf-sec"><button type="button" class="hpf-sech" data-g="${esc(g)}" aria-expanded="${!closed}"><b>${esc(g)}</b><span>${g === "From the lead file" ? custom.length : ""} ${closed ? "▸" : "▾"}</span></button>
        ${closed ? "" : shown.length ? shown.map((f) => fieldRow(f)).join("") : `<p class="hpd-sm" style="margin:6px 0 0">Every column from the lead's CSV shows up here, including ones the CRM doesn't have a box for.</p>`}</div>`;
    }).join("");
    const qi = $("#hpfQ"); qi.oninput = () => { PF.q = qi.value; const pos = qi.selectionStart; drawLeft(); const n2 = $("#hpfQ"); n2.focus(); n2.setSelectionRange(pos, pos); };
    $$("[data-g]", box).forEach((b) => (b.onclick = () => { PF.collapsed[b.dataset.g] = !PF.collapsed[b.dataset.g]; lsSet("hpd.pfCollapsed", PF.collapsed); drawLeft(); }));
    $$("[data-fk]", box).forEach((inp) => (inp.onchange = async () => {
      const k = inp.dataset.fk; let v = inp.value.trim();
      const cur = D.leads.get(l.id); let patch;
      if (k.startsWith("f:")) patch = { fields: { ...(cur.fields || {}), [k.slice(2)]: v } };
      else { if (inp.type === "number") v = v === "" ? "" : Number(v); if (k === "phone" || k === "phone2") v = D.normPhone(v); patch = { [k]: v }; }
      try { await D.patchLead(l.id, patch); inp.classList.add("saved"); setTimeout(() => inp.classList.remove("saved"), 900); } catch (e) { toast("Couldn't save: " + e.message); }
    }));
  }
  function fieldRow(f) {
    if (f.type === "product") return `<label class="hpf-f"><span>${esc(f.label)}</span><select data-fk="${esc(f.k)}"><option value="">—</option>${Object.entries(window.hpDesk.PROD).map(([k, t]) => `<option value="${k}" ${f.v === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>`;
    const long = String(f.v ?? "").length > 60;
    return `<label class="hpf-f"><span>${esc(f.label)}</span>${long ? `<textarea data-fk="${esc(f.k)}" rows="3">${esc(f.v)}</textarea>` : `<input data-fk="${esc(f.k)}" type="${f.type === "number" ? "number" : f.type === "email" ? "email" : f.type === "tel" ? "tel" : "text"}" value="${esc(f.type === "tel" ? fmt(f.v) : f.v ?? "")}" placeholder="—">`}</label>`;
  }

  function drawTimeline() {
    const D = window.hpDesk, l = D.leads.get(PF.id), box = $("#hpfTl"); if (!l || !box) return;
    const items = [];
    for (const c of D.calls.values()) if (c.leadId === l.id) items.push({ t: c.at, kind: "call", c });
    for (const n of l.notes || []) if (!/^Call: /.test(n.text)) items.push({ t: n.t, kind: "note", n });
    for (const m of PF.sms || []) items.push({ t: m.at, kind: "sms", m });
    for (const a of D.appts.values()) if (a.leadId === l.id) items.push({ t: a.createdAt || a.at, kind: "appt", a });
    if (l.createdAt) items.push({ t: l.createdAt, kind: "created" });
    items.sort((a, b) => a.t - b.t);
    let lastDay = "";
    box.innerHTML = items.map((it) => {
      const day = new Date(it.t).toDateString(); const sep = day !== lastDay ? `<div class="hpf-day">${day === new Date().toDateString() ? "Today" : new Date(it.t).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</div>` : ""; lastDay = day;
      const tm = new Date(it.t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      if (it.kind === "call") { const c = it.c, good = /Appointment/.test(c.outcome), bad = /Not interested|Bad|Do not/.test(c.outcome);
        return sep + `<div class="hpf-ev call ${good ? "good" : bad ? "bad" : ""}"><div class="hpf-evh">${I.phone}<b>${esc(c.outcome)}</b>${c.dur ? `<span class="num">${dur(c.dur / 1000)}</span>` : ""}${c.hpSid ? `<button type="button" class="hpf-play" data-rec="${esc(c.hpSid)}" aria-label="Play recording">${I.play}</button>` : ""}</div>${c.note ? `<p>${esc(c.note)}</p>` : ""}${c.transcript ? `<details><summary>Transcript</summary><pre>${esc(c.transcript)}</pre></details>` : ""}<time>${tm}</time></div>`; }
      if (it.kind === "note") return sep + `<div class="hpf-ev note"><div class="hpf-evh"><b>Note</b></div><p>${esc(it.n.text)}</p><time>${tm}</time></div>`;
      if (it.kind === "sms") return sep + `<div class="hpf-ev sms ${it.m.dir}"><p>${esc(it.m.body)}</p><time>${it.m.dir === "out" ? "Text sent" : "Text received"} · ${tm}</time></div>`;
      if (it.kind === "appt") return sep + `<div class="hpf-ev appt"><div class="hpf-evh"><b>${esc(it.a.type || "Appointment")} booked</b></div><p>${new Date(it.a.at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p><time>${tm}</time></div>`;
      return sep + `<div class="hpf-ev sys"><p>Lead added${l.source ? " from " + esc(l.source) : ""}</p><time>${tm}</time></div>`;
    }).join("") || `<p class="hpd-sm" style="text-align:center;margin:30px 0">No history yet. Calls, texts and notes show up here.</p>`;
    box.scrollTop = box.scrollHeight;
    $$("[data-rec]", box).forEach((b) => (b.onclick = async () => {
      if (S.demo) { toast("Recordings play here once real calls are made"); return; }
      const r = await fetch(API + "/calls/recording?sid=" + encodeURIComponent(b.dataset.rec), { headers: authHeader(), credentials: "same-origin" });
      if (!r.ok) return toast("Recording isn't ready yet");
      const au = document.createElement("audio"); au.controls = true; au.autoplay = true; au.src = URL.createObjectURL(await r.blob()); au.className = "hpf-audio"; b.replaceWith(au);
    }));
  }
  function drawAppts(l) {
    const box = $("#hpfAppts"); if (!box) return;
    const list = [...window.hpDesk.appts.values()].filter((a) => a.leadId === l.id).sort((a, b) => a.at - b.at);
    const up = list.filter((a) => a.at >= Date.now() - 36e5 && !a.done), past = list.filter((a) => !up.includes(a));
    box.innerHTML = (up.map((a) => `<div class="hpf-appt"><b>${new Date(a.at).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</b><span class="hpd-sm">${esc(a.type || "Appointment")}</span></div>`).join("") || `<p class="hpd-sm" style="margin:6px 0">No upcoming appointments</p>`) + (past.length ? `<p class="hpd-sm" style="margin:8px 0 0">${past.length} past</p>` : "");
  }

  async function sendCompose(l) {
    const t = $("#hpfMsg").value.trim(); if (!t) return;
    if (PF.compose === "sms") {
      try { const r = await api("/sms/send", { method: "POST", body: { to: l.phone, body: t, leadId: l.id } }); PF.sms = r.thread?.msgs || [...(PF.sms || []), { dir: "out", body: t, at: Date.now() }]; if (S.demo) PF.sms = [...(PF.sms || []).filter((m) => m.at), { dir: "out", body: t, at: Date.now() }]; toast("Text sent"); }
      catch (e) { return toast(e.message); }
    } else { await window.hpDesk.patchLead(l.id, { notes: window.hpDesk.addNoteObj(window.hpDesk.leads.get(l.id), t) }); toast("Note saved"); }
    $("#hpfMsg").value = ""; drawTimeline();
  }

  async function profileDispo(l, kind, bookOnly) {
    if (kind === "cb" || kind === "appt") {
      const w = $("#hpfWhen"); if (w.hidden || PF.pending !== kind) {
        w.hidden = false; PF.pending = kind; const d = new Date(Date.now() + 864e5); d.setMinutes(0); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
        $("#hpfAt").value = d.toISOString().slice(0, 16); $("#hpfWhenGo").textContent = kind === "appt" ? "Save appointment" : "Save callback";
        $("#hpfWhenGo").onclick = () => finish(); $("#hpfAt").focus(); return;
      }
    }
    return finish();
    async function finish() {
      const at = $("#hpfAt")?.value ? new Date($("#hpfAt").value).getTime() : 0;
      const note = $("#hpfNote").value.trim();
      if (bookOnly && !(S.call && S.callLead === l.id) && !(S.power?.connectedLead === l.id)) {
        await window.hpDesk.putAppt({ leadId: l.id, leadName: window.hpDesk.fullName(l), title: window.hpDesk.fullName(l), at: at || Date.now() + 864e5, dur: 30, type: "Phone call", done: false, createdAt: Date.now() });
        await window.hpDesk.patchLead(l.id, { stage: "appointment" }); toast("Appointment booked"); renderProfile(); return;
      }
      if (kind === "dnc") api("/calls/dnc", { method: "POST", body: { number: l.phone, reason: "Agent marked Do Not Call" } }).catch(() => {});
      const lab = await window.hpDesk.dispoDirect(l.id, kind, { note, at: at || undefined });
      PF.pending = null; toast(`${window.hpDesk.fullName(l)}: ${lab}`);
      // move to the next lead in the campaign (power mode opens it when they answer)
      const i = PF.list.indexOf(l.id); const next = PF.list.slice(i + 1).find((id) => { const x = window.hpDesk.leads.get(id); return x && !CLOSED.includes(x.stage); });
      if (S.power) renderProfile(); else if (next) openProfile(next, { keepList: true }); else renderProfile();
    }
  }
  // keep the open profile fresh when lead data changes
  setInterval(() => { if (PF.id && !$("#hpdProfile")?.hidden && document.activeElement?.closest?.("#hpdProfile") == null) { drawTimeline(); drawAppts(window.hpDesk.leads.get(PF.id) || {}); } }, 4000);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && PF.id && !e.target.closest?.("input,textarea,select")) closeProfile(); });

  /* ================= agent status bar (ReadyMode-style) ================= */
  const STATUSES = [["ready", "Ready"], ["acw", "Wrap-up"], ["break", "Break"], ["lunch", "Lunch"], ["meeting", "Meeting"], ["training", "Training"], ["offline", "Offline"]];
  S.status = lsGet("hpd.status", "offline"); S.statusAt = Date.now();
  function buildBar() {
    const top = $(".topbar"); if (!top || $("#hpdBar")) return;
    const bar = document.createElement("div"); bar.id = "hpdBar"; bar.className = "hpd hpd-bar";
    bar.innerHTML = `
      <div class="hpd-srch"><input id="hpdSearch" type="search" placeholder="Search leads by name or phone" autocomplete="off" aria-label="Search leads"><div class="hpd-srchres" id="hpdSearchRes" hidden></div></div>
      <label class="hpd-status" data-s="${S.status}"><i></i><select id="hpdStatus" aria-label="Your status">${STATUSES.map(([k, t]) => `<option value="${k}" ${S.status === k ? "selected" : ""}>${t}</option>`).join("")}</select><span class="num" id="hpdStatusT">0:00</span></label>
      <span class="hpd-bg" id="hpdBg" hidden></span>
      <button type="button" class="hpd-cbchip" id="hpdCb" hidden></button>`;
    const crumb = $("#crumb", top); crumb ? crumb.after(bar) : top.prepend(bar);
    const pill = document.createElement("div"); pill.id = "hpdPhoneSt"; pill.className = "hpd hpd-phonest"; document.body.append(pill);
    $("#hpdStatus").onchange = (e) => setStatus(e.target.value);
    const si = $("#hpdSearch"), sr = $("#hpdSearchRes");
    const run = () => {
      const q = si.value.trim().toLowerCase(), qd = d10(q);
      if (q.length < 2) { sr.hidden = true; return; }
      const hits = [...window.hpDesk.leads.values()].filter((l) => window.hpDesk.fullName(l).toLowerCase().includes(q) || (qd.length >= 3 && (d10(l.phone).includes(qd) || d10(l.phone2).includes(qd))) || String(l.email || "").toLowerCase().includes(q)).slice(0, 8);
      sr.innerHTML = hits.map((l, i) => `<button type="button" data-hit="${esc(l.id)}" ${i === 0 ? 'aria-selected="true"' : ""}><b>${esc(window.hpDesk.fullName(l))}</b><span>${esc(fmt(l.phone))}${l.source ? " · " + esc(l.source) : ""}${l.stage ? " · " + esc(window.hpDesk.stageName(l.stage)) : ""}</span></button>`).join("") || `<p>No leads match</p>`;
      sr.hidden = false;
      $$("[data-hit]", sr).forEach((b) => (b.onmousedown = (e) => { e.preventDefault(); openProfile(b.dataset.hit); si.value = ""; sr.hidden = true; }));
    };
    si.oninput = run; si.onfocus = run; si.onblur = () => setTimeout(() => (sr.hidden = true), 150);
    si.onkeydown = (e) => { if (e.key === "Enter") { const f = $("[data-hit]", sr); if (f) { openProfile(f.dataset.hit); si.value = ""; sr.hidden = true; } } if (e.key === "Escape") { si.value = ""; sr.hidden = true; si.blur(); } };
    setInterval(tickBar, 1000); setInterval(callbackChip, 5000); callbackChip(); tickBar(); window.addEventListener("hp:leadchange", callbackChip);
  }
  function tickBar() {
    const t = $("#hpdStatusT"); if (t) { const s = Math.floor((Date.now() - S.statusAt) / 1000); t.textContent = s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
    const p = $("#hpdPhoneSt"); if (p) { const ok = S.demo || S.deviceReady; const on = S.call || S.power?.connected; p.dataset.s = on ? "live" : ok ? "ok" : "off"; p.textContent = `Phone status: ${on ? "On a call" : ok ? "Connected" : S.ready ? "Connecting…" : "Not set up"}`; }
    // background dialing ticker
    const bg = $("#hpdBg"); if (bg) {
      const st = S.power?.last; const ringing = st ? Object.values(st.calls).filter((l) => l.batch === st.batch && ["queued", "initiated", "ringing"].includes(l.status)).map((l) => l.name) : [];
      bg.hidden = !ringing.length; if (ringing.length) bg.innerHTML = `<span>Background dialing:</span> <b>${esc(ringing.join(", "))}</b>`;
    }
  }
  function setStatus(next, quiet) {
    const prev = S.status, sec = Math.round((Date.now() - S.statusAt) / 1000);
    if (prev === next) return;
    if (sec > 2) api("/calls/status", { method: "POST", body: { status: prev, sec } }).catch(() => {});
    S.status = next; S.statusAt = Date.now(); lsSet("hpd.status", next);
    const lab = $(".hpd-status"); if (lab) lab.dataset.s = next; const sel = $("#hpdStatus"); if (sel && sel.value !== next) sel.value = next;
    if (quiet) return;
    // Ready = dial. Anything else pauses the dialer after the current call.
    if (next === "ready") {
      if (S.power?.paused) togglePause();
      else if (!S.power && !S.call) {
        if (campaignQueue().length && S.ready !== false) { S.mode = "power"; lsSet("hpd.mode", "power"); if ($("#v-dialer")?.hidden) window.hpDesk.go("dialer"); renderPhone(); startPower(); }
        else toast("You're Ready. Pick a campaign with leads to start dialing.");
      }
    } else if (S.power && !S.power.paused) { togglePause(); toast(`Status: ${STATUSES.find((s) => s[0] === next)[1]}. Dialing paused${S.power.connected ? " after this call" : ""}.`); }
  }
  // flush time-in-status when the tab closes
  addEventListener("pagehide", () => { const sec = Math.round((Date.now() - S.statusAt) / 1000); if (sec > 2) { try { navigator.sendBeacon?.(API + "/calls/status", new Blob([JSON.stringify({ status: S.status, sec })], { type: "application/json" })); } catch {} } });
  function callbackChip() {
    const b = $("#hpdCb"); if (!b || !window.hpDesk) return;
    const due = [...window.hpDesk.leads.values()].filter((l) => l.callbackAt && l.callbackAt <= Date.now() + 15 * 6e4 && !CLOSED.includes(l.stage)).sort((a, c) => a.callbackAt - c.callbackAt);
    if (!due.length) { b.hidden = true; return; }
    const l = due[0], late = (Date.now() - l.callbackAt) / 864e5;
    const age = late < 0 ? `in ${Math.max(1, Math.round(-late * 1440))} min` : late < 1 / 24 ? "due now" : late < 1 ? `${Math.round(late * 24)}h overdue` : `${Math.round(late * 2) / 2} days old`;
    b.hidden = false; b.innerHTML = `<span>Callback</span><b>${esc(window.hpDesk.fullName(l))}</b><em>${age}</em>${due.length > 1 ? `<i>+${due.length - 1}</i>` : ""}`;
    b.onclick = () => openProfile(l.id);
  }

  /* ================= dialer home (Noctra-style layout, Highpoint look) ================= */
  const AREA_ST = (() => { const m = {}; const src = { AL: "205 251 256 334 659 938", AK: "907", AZ: "480 520 602 623 928", AR: "327 479 501 870", CA: "209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 949 951", CO: "303 719 720 970 983", CT: "203 475 860 959", DE: "302", DC: "202 771", FL: "239 305 321 324 352 386 407 448 561 645 656 689 727 728 754 772 786 813 850 863 904 941 954", GA: "229 404 470 478 678 706 762 770 912 943", HI: "808", ID: "208 986", IL: "217 224 309 312 331 447 464 618 630 708 730 773 779 815 847 861 872", IN: "219 260 317 463 574 765 812 930", IA: "319 515 563 641 712", KS: "316 620 785 913", KY: "270 364 502 606 859", LA: "225 318 337 504 985", ME: "207", MD: "227 240 301 410 443 667", MA: "339 351 413 508 617 774 781 857 978", MI: "231 248 269 313 517 586 616 679 734 810 906 947 989", MN: "218 320 507 612 651 763 952", MS: "228 601 662 769", MO: "314 417 557 573 636 660 816 975", MT: "406", NE: "308 402 531", NV: "702 725 775", NH: "603", NJ: "201 551 609 640 732 848 856 862 908 973", NM: "505 575", NY: "212 315 329 332 347 363 516 518 585 607 624 631 646 680 716 718 838 845 914 917 929 934", NC: "252 336 472 704 743 828 910 919 980 984", ND: "701", OH: "216 220 234 283 326 330 380 419 436 440 513 567 614 740 937", OK: "405 539 572 580 918", OR: "458 503 541 971", PA: "215 223 267 272 412 445 484 570 582 610 717 724 814 835 878", RI: "401", SC: "803 821 839 843 854 864", SD: "605", TN: "423 615 629 731 865 901 931", TX: "210 214 254 281 325 346 361 409 430 432 469 512 682 713 726 737 806 817 830 832 903 915 936 940 945 956 972 979", UT: "385 435 801", VT: "802", VA: "276 434 540 571 686 703 757 804 826 948", WA: "206 253 360 425 509 564", WV: "304 681", WI: "262 274 353 414 534 608 715 920", WY: "307", PR: "787 939" }; for (const [st, c] of Object.entries(src)) c.split(" ").forEach((x) => (m[x] = st)); return m; })();
  const ET = "America/New_York", CT = "America/Chicago", MT = "America/Denver", PT = "America/Los_Angeles";
  const ST_TZ = { AL: CT, AK: "America/Anchorage", AZ: "America/Phoenix", AR: CT, CA: PT, CO: MT, CT: ET, DE: ET, DC: ET, FL: ET, GA: ET, HI: "Pacific/Honolulu", ID: MT, IL: CT, IN: ET, IA: CT, KS: CT, KY: ET, LA: CT, ME: ET, MD: ET, MA: ET, MI: ET, MN: CT, MS: CT, MO: CT, MT: MT, NE: CT, NV: PT, NH: ET, NJ: ET, NM: MT, NY: ET, NC: ET, ND: CT, OH: ET, OK: CT, OR: PT, PA: ET, RI: ET, SC: ET, SD: CT, TN: CT, TX: CT, UT: MT, VT: ET, VA: ET, WA: PT, WV: ET, WI: CT, WY: MT, PR: "America/Puerto_Rico" };
  const leadState = (l) => AREA_ST[d10(l.phone).slice(0, 3)] || String(l.state || "").toUpperCase().slice(0, 2);
  function leadClock(l) {
    const st = leadState(l), tz = ST_TZ[st]; if (!tz) return { st: st || "—", txt: "", ok: true, h: 12 };
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    const h = +p.hour + +p.minute / 60; const rule = S.settings.stateRules?.[st] || {}; const start = rule.start ?? 8, end = rule.end ?? 21;
    const h12 = ((+p.hour + 11) % 12) + 1;
    return { st, h, ok: h >= start && h < end, txt: `${h12}:${p.minute} ${+p.hour < 12 ? "AM" : "PM"}`, start };
  }
  const WARM = ["contacted", "appointment", "application"];
  const dialable = (l) => d10(l.phone).length === 10 && !CLOSED.includes(l.stage) && !l.dnc;
  S.camps = lsGet("hpd.camps", []);
  // Two simple choices: which LIST to call from, and WHO in that list.
  {
    const old = lsGet("hpd.list", null);
    S.src = lsGet("hpd.src", old && /^(c|s):/.test(old) ? old : "all");
    S.filter = lsGet("hpd.filter", old && !/^(c|s):/.test(old) ? ({ followups: "callbacks", new: "never", warm: "retry" }[old] || old) : "ready");
  }
  const FILTERS = [
    ["ready", "Ready to call now", "#3BD38B", "Inside calling hours, nothing scheduled for later"],
    ["callbacks", "Callbacks due", "#FFB547", "People you promised to call back"],
    ["never", "Never called", "#8FB8FF", "Fresh leads nobody has dialed yet"],
    ["retry", "Called, not reached yet", "#FF7A59", "Dialed before, no conversation yet"],
    ["everyone", "Everyone with a number", "#9AA1AE", "All callable leads in the list"],
  ];
  function sourceLeads(src = S.src) {
    const all = [...(window.hpDesk?.leads.values() || [])];
    if (src.startsWith("c:")) { const c = S.camps.find((x) => x.id === src.slice(2)); const set = new Set(c?.ids || []); return all.filter((l) => set.has(l.id)); }
    if (src.startsWith("s:")) return all.filter((l) => (l.source || "No campaign") === src.slice(2));
    return all;
  }
  function applyFilter(arr, f = S.filter) {
    const d = arr.filter(dialable), later = (l) => l.callbackAt > Date.now();
    if (f === "ready") return d.filter((l) => (S.demo || leadClock(l).ok) && !later(l));
    if (f === "callbacks") return d.filter((l) => l.callbackAt && l.callbackAt <= Date.now());
    if (f === "never") return d.filter((l) => !l.callCount && !l.lastCallAt && !later(l));
    if (f === "retry") return d.filter((l) => (l.callCount || l.lastCallAt) && ["new", "contacted"].includes(l.stage || "new") && !later(l));
    return d;
  }
  const srcName = (src = S.src) => src === "all" ? "All my leads" : src.startsWith("c:") ? (S.camps.find((c) => c.id === src.slice(2))?.name || "Campaign") : src.slice(2);
  const filterName = (f = S.filter) => (FILTERS.find((x) => x[0] === f) || FILTERS[0])[1];
  const listName = () => `${srcName()} · ${filterName()}`;
  const listLeads = (k) => applyFilter(sourceLeads(), k); // kept for older callers
  function setSrc(v) { S.src = v; lsSet("hpd.src", v); }
  function setFilter(v) { S.filter = v; lsSet("hpd.filter", v); }
  // every dialing path (power dial, profile arrows, up next) uses this queue
  campaignQueue = function () {
    const c = S.src.startsWith("c:") && S.camps.find((x) => x.id === S.src.slice(2));
    if (c?.paused) return [];
    return applyFilter(sourceLeads(), S.filter).filter((l) => S.demo || leadClock(l).ok)
      .sort((a, b) => ((a.callbackAt && a.callbackAt <= Date.now() ? 0 : 1) - (b.callbackAt && b.callbackAt <= Date.now() ? 0 : 1)) || (a.lastCallAt || 0) - (b.lastCallAt || 0) || (a.createdAt || 0) - (b.createdAt || 0));
  };
  function saveCamps() { lsSet("hpd.camps", S.camps); savePrefs({ camps: S.camps.map((c) => ({ ...c, ids: c.ids.slice(0, 5000) })) }); }
  function campStats(c) {
    const ids = new Set(c.ids); let dialed = 0, convo = 0, talk = 0;
    for (const id of ids) { const l = window.hpDesk.leads.get(id); if (l?.lastCallAt >= c.created) dialed++; }
    for (const call of window.hpDesk.calls.values()) if (ids.has(call.leadId) && call.at >= c.created) { if (!/No answer|voicemail|Bad number|Busy|Not dialed|Machine/i.test(call.outcome)) convo++; talk += (call.dur || 0) / 1000; }
    return { dialed, convo, talk };
  }

  S.sound = lsGet("hpd.sound", { ding: 0.75, open: false, spk: "", mic: "" });
  function ding(force) { if (!force && !S.sound.ding) return; try { const a = new AudioContext(), g = a.createGain(); g.gain.value = 0.12 * S.sound.ding; g.connect(a.destination); [880, 1320].forEach((f, i) => { const o = a.createOscillator(); o.frequency.value = f; o.connect(g); o.start(a.currentTime + i * 0.12); o.stop(a.currentTime + i * 0.12 + 0.14); }); } catch {} }
  beep = () => ding();

  let usage = null;
  async function loadUsage() {
    try {
      const dom = new Date().getDate();
      const [d1, dm] = await Promise.all([api(`/calls/analytics?days=1`), api(`/calls/analytics?days=${dom}`)]);
      usage = { today: d1.total, month: dm.total };
    } catch { usage = null; }
    if (!$("#hpdHome")?.hidden) renderHome();
  }

  function buildHome() {
    if ($("#hpdHome")) return;
    const host = $("#dPane"); host.insertAdjacentHTML("beforebegin", `<div class="hpd hpd-home" id="hpdHome"></div>`);
    $("#hpdHome").insertAdjacentHTML("beforebegin", `<div class="hpd hph-music" id="hphMusic"></div>`);
    renderMusic(); window.addEventListener("hp:musicstate", renderMusic);
    host.classList.add("hpd-manualpane");
    // the old stage/product filters only drive the one-by-one queue, so they live with it
    const oldFilters = $("#v-dialer .head .row");
    if (oldFilters) { const bar = document.createElement("div"); bar.id = "hpdManualBar"; bar.className = "hpd hph-manualbar"; bar.innerHTML = `<span class="hpd-sm">One-by-one queue:</span>`; [...oldFilters.children].forEach((c) => bar.append(c)); host.before(bar); oldFilters.remove(); $("#dqStage")?.setAttribute("aria-label", "Queue stage"); }
    // desk tabs: Dial shows the home; history/our tabs hide it
    $$("#dTabs [data-dt]").forEach((b) => b.addEventListener("click", () => { $("#hpdHome").hidden = $("#hphMusic").hidden = b.dataset.dt !== "dial"; if (b.dataset.dt === "dial") renderHome(); }));
    const t = $('#dTabs [data-dt="dial"]'); if (t) t.textContent = "Dial";
    renderHome(); loadUsage(); setInterval(() => { if (!$("#hpdHome")?.hidden && !document.activeElement?.closest?.("#hpdHome")) renderHome(); }, 15000); setInterval(loadUsage, 120000);
  }

  const SP_LOGO = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.6 14.4a.6.6 0 0 1-.9.2c-2.4-1.5-5.4-1.8-9-1a.6.6 0 1 1-.3-1.2c3.9-.9 7.2-.5 9.9 1.1.3.2.4.6.3.9Zm1.2-2.7a.8.8 0 0 1-1 .3c-2.8-1.7-7-2.2-10.3-1.2a.8.8 0 1 1-.4-1.5c3.8-1.1 8.4-.6 11.5 1.4.3.2.4.7.2 1Zm.1-2.8C14.6 8.9 9.2 8.7 6.1 9.7a.9.9 0 1 1-.5-1.8c3.6-1.1 9.6-.9 13.3 1.3a.9.9 0 0 1-1 1.7Z"/></svg>';
  function renderMusic() {
    const el = $("#hphMusic"); if (!el) return;
    const sp = window.hpSpotify;
    if (!sp) { el.innerHTML = `<span class="hph-splogo">${SP_LOGO}</span><div class="hph-spt"><b>Music</b><span>Loading Spotify…</span></div>`; return; }
    el.innerHTML = `<span class="hph-splogo">${SP_LOGO}</span>
      <div class="hph-spt"><b>${sp.playing ? "Now playing on Spotify" : sp.ready ? "Spotify paused" : "Spotify"}</b><span>${sp.playing ? "Pauses on its own when a lead picks up" : sp.ready ? "Press play to bring it back" : "Open the player and pick a playlist"}</span></div>
      <button type="button" class="hph-spplay" id="hphSpPlay" aria-label="${sp.playing ? "Pause music" : "Play music"}">${sp.playing ? I.pause : I.play}</button>
      <button type="button" class="btn" id="hphSpOpen">${sp.isOpen ? "Hide player" : "Player"}</button>
      <label class="hph-spauto"><input type="checkbox" id="hphSpAuto" ${sp.autoPause ? "checked" : ""}> Spotify pauses on calls</label>`;
    $("#hphSpPlay").onclick = () => sp.togglePlay();
    $("#hphSpOpen").onclick = () => sp.toggleOpen();
    $("#hphSpAuto").onchange = (e) => { sp.autoPause = e.target.checked; };
  }
  function renderHome() {
    const el = $("#hpdHome"); if (!el || !window.hpDesk) return;
    const D = window.hpDesk, q = campaignQueue(), lines = S.via === "phone" ? 1 : Math.min(S.lines, S.settings.maxLines || 3);
    const headset = S.via === "phone" ? (S.phoneLead ? "live" : "on") : S.call || S.power?.connected ? "live" : S.power ? "dial" : (S.deviceReady || S.demo) ? "on" : "off";
    const t = usage?.today || {}, m = usage?.month || {};
    const estMin = (x) => Math.round(((x.talkSec || 0) + (x.dials || 0) * 25) / 60); // talk + ~25s ringing per dial, both legs billed per minute
    const cost = (min) => "$" + (min * 0.018).toFixed(2);
    const soldToday = [...D.leads.values()].filter((l) => l.stage === "sold" && (l.updatedAt || 0) >= new Date().setHours(0, 0, 0, 0)).length;
    const outside = applyFilter(sourceLeads(), S.filter === "ready" ? "everyone" : S.filter).filter((l) => !leadClock(l).ok).length;
    const base = sourceLeads(); const fCount = Object.fromEntries(FILTERS.map(([k]) => [k, applyFilter(base, k).length]));
    const sources = campaigns().filter((c) => c.name !== "No campaign");
    el.innerHTML = `
      <div class="hph-head">
        <p class="hpd-sm" style="margin:0">Your lines, your leads, Highpoint's own phone.</p>
        <button type="button" class="btn" id="hphPick">Campaigns</button>
      </div>
      <div class="hph-via" role="group" aria-label="Call with"><span class="hpd-sm">Call with</span><button type="button" data-via="line" aria-pressed="${S.via !== "phone"}">Browser phone line</button><button type="button" data-via="phone" aria-pressed="${S.via === "phone"}">My phone</button></div>
      ${S.via === "phone" ? `<div class="hph-setup"><div><b>Calling from your own phone</b><span>Each call opens on your phone: Phone Link on Windows, your iPhone on a Mac, or Google Voice. Leads see your cell number. One line at a time, and recording, voicemail drop and local caller ID need the browser phone line.</span></div></div>` : ""}
      ${S.via !== "phone" && !S.demo && !S.ready ? `<div class="hph-setup"><div><b>${S.twilio ? "One step left: connect your phone line" : "Phone line not connected"}</b><span>${S.twilio ? (S.me?.admin ? "Your Twilio keys are in. Press Connect once and every agent's dialer turns on." : "Your admin needs to press Connect Twilio once.") : "Your admin needs to add the Twilio keys in Cloudflare first."}</span></div>${S.twilio && S.me?.admin ? `<button type="button" class="btn primary" id="hphSetup">Connect Twilio</button>` : ""}</div>` : ""}
      ${S.via !== "phone" && !S.demo && S.ready && !S.numbers.length ? `<div class="hph-setup"><div><b>Get your first phone number</b><span>You need a number to call from. Pick one in your area code; Twilio charges about $1.15 a month.</span></div><button type="button" class="btn primary" id="hphBuy">Get a number</button></div>` : ""}
      <div class="hph-bar" data-h="${headset}"><span class="hph-dot"></span><b>${S.via === "phone" ? (S.phoneLead ? "Calling on your phone" : "Your phone is ready") : headset === "live" ? "On a call" : headset === "dial" ? "Headset on · dialing" : headset === "on" ? "Headset on" : "Headset off"}</b>
        <span class="hpd-sm">${headset === "live" ? "Talk away. The lead's profile is open." : headset === "dial" ? `Calling ${lines} at a time from ${esc(listName())}. Whoever says hello first comes straight to you.` : headset === "on" ? "Line is ready. Press Start calling." : S.ready ? "Connecting your line… allow the microphone if your browser asks." : "Press Start calling; your browser joins the line first (allow the microphone)."}</span>
        <button type="button" class="btn hph-soundbtn" id="hphSound" aria-expanded="${S.sound.open}">Sound</button></div>
      <div class="hph-sound" id="hphSoundP" ${S.sound.open ? "" : "hidden"}>
        <label><span>Speaker</span><select id="hphSpk"><option value="">System default</option></select></label>
        <label><span>Microphone</span><select id="hphMic"><option value="">System default</option></select></label>
        <label><span>Pick-up ding</span><input type="range" id="hphDing" min="0" max="1" step="0.05" value="${S.sound.ding}"><b class="num">${Math.round(S.sound.ding * 100)}%</b></label>
        <button type="button" class="btn" id="hphTest">Test ding</button>
      </div>
      <div class="hph-usage">
        <div><b class="num">${usage ? estMin(t) : "—"}</b> min today<span>${usage ? cost(estMin(t)) + " est." : ""}</span></div>
        <div><b class="num">${usage ? estMin(m) : "—"}</b> min this month<span>${usage ? cost(estMin(m)) + " est." : ""}</span></div>
        <div><b class="num">${usage ? Math.round((t.talkSec || 0) / 60) : "—"}</b> talk min<span>${usage ? `${t.dials || 0} dials · ${t.answered || 0} answered` : ""}</span></div>
      </div>
      <div class="hph-ready">
        <div><h3>${S.power ? (S.power.paused ? "Paused" : "Dialing") : "Ready to dial"}</h3><p class="hpd-sm">${q.length.toLocaleString()} lead${q.length === 1 ? "" : "s"} · ${lines} line${lines > 1 ? "s" : ""} · no time limit · calls as long as needed${outside ? ` · ${outside} outside calling hours${S.demo ? " (preview dials them anyway)" : ""}` : ""}</p></div>
        <div class="hph-ctl">
          <label class="hph-sel"><span>Calling list</span><select id="hphSrc" ${S.power ? "disabled" : ""}><option value="all" ${S.src === "all" ? "selected" : ""}>All my leads (${[...D.leads.values()].filter(dialable).length})</option>${S.camps.length ? `<optgroup label="My campaigns">${S.camps.map((c) => `<option value="c:${esc(c.id)}" ${S.src === "c:" + c.id ? "selected" : ""}>${esc(c.name)} (${c.ids.length})${c.paused ? " · paused" : ""}</option>`).join("")}</optgroup>` : ""}${sources.length ? `<optgroup label="Imported lists">${sources.map((c) => `<option value="s:${esc(c.name)}" ${S.src === "s:" + c.name ? "selected" : ""}>${esc(c.name)} (${c.total})</option>`).join("")}</optgroup>` : ""}</select></label>
          <label class="hph-sel"><span>Who to call</span><select id="hphFilter" ${S.power ? "disabled" : ""}>${FILTERS.map(([k, n]) => `<option value="${k}" ${S.filter === k ? "selected" : ""}>${n} (${fCount[k]})</option>`).join("")}</select></label>
          <div class="hph-lines" role="group" aria-label="Lines">${[1, 2, 3].map((n) => `<button type="button" data-hl="${n}" aria-pressed="${lines === n}" ${n > (S.via === "phone" ? 1 : S.settings.maxLines || 3) || S.power ? "disabled" : ""}>${n}</button>`).join("")}</div>
          ${S.via === "phone" ? (S.ps ? `<button type="button" class="btn" id="hphPsSkip">Skip</button><button type="button" class="btn hpd-hang" id="hphPsEnd">End session</button>` : `<button type="button" class="btn primary hph-go" id="hphPsGo" ${q.length ? "" : "disabled"}>${I.phone} Start calling</button>`) : S.power ? `<button type="button" class="btn" id="hphPause">${S.power.paused ? "Resume" : "Pause"}</button><button type="button" class="btn hpd-hang" id="hphStop">End session</button>` : `<button type="button" class="btn primary hph-go" id="hphGo" ${q.length && !S.call ? "" : "disabled"}>${I.phone} Start calling</button>`}
        </div>
      </div>
      <div class="hph-card"><div class="row" style="justify-content:space-between"><h3>Today</h3><span class="hpd-sm">Counted as you dial</span></div>
        <div class="hph-tiles">
          <div style="--c:#8FB8FF"><b class="num">${t.dials || 0}</b><span>Total calls</span></div>
          <div style="--c:#3BD38B"><b class="num">${t.connects || 0}</b><span>Conversations</span></div>
          <div style="--c:#B58CFF"><b class="num">${dur(t.talkSec || 0)}</b><span>Talk time</span></div>
          <div style="--c:#FFB547"><b class="num">${t.appts || 0}</b><span>Appointments</span></div>
          <div style="--c:#FF9E3D"><b class="num">${soldToday}</b><span>Sold</span></div>
          <div style="--c:#FF4FA3"><b class="num">${pct(t.answered || 0, t.dials || 0)}%</b><span>Answered</span></div>
        </div></div>
      <div class="hph-card"><div class="row" style="justify-content:space-between"><h3>Campaigns</h3><button type="button" class="hpf-link" id="hphAll">New campaign</button></div>
        ${S.camps.length ? S.camps.map((c) => { const s = campStats(c); return `<div class="hph-camp ${S.src === "c:" + c.id ? "on" : ""}"><button type="button" class="hph-campname" data-usec="${esc(c.id)}"><b>${esc(c.name)} · ${c.ids.length.toLocaleString()} leads</b><span class="${c.paused ? "p" : "a"}">${c.paused ? "Paused" : "Active"}</span></button><div class="hpd-meter"><i style="width:${pct(s.dialed, c.ids.length)}%"></i></div><span class="hph-cs"><em style="color:#8FB8FF">${s.dialed} of ${c.ids.length} dialed</em><em style="color:#3BD38B">${s.convo} conversations</em><em style="color:#B58CFF">${dur(s.talk)} talk</em></span><button type="button" class="hph-ic" data-cpause="${esc(c.id)}" aria-label="${c.paused ? "Resume" : "Pause"} campaign" title="${c.paused ? "Resume" : "Pause"}">${c.paused ? I.play : I.pause}</button><button type="button" class="hph-ic" data-cdel="${esc(c.id)}" aria-label="Delete campaign" title="Delete campaign (leads stay)">✕</button></div>`; }).join("") : `<p class="hpd-sm" style="margin:0">No campaigns yet. Press <b>Campaigns</b> to pick who to call and save them as a campaign.</p>`}
      </div>
      <div class="hph-card"><div class="row" style="justify-content:space-between"><h3>Up next</h3><span class="hpd-sm">local time where they are</span></div>
        <div class="hph-next">${q.slice(0, 12).map((l) => { const k = leadClock(l); return `<button type="button" data-open="${esc(l.id)}"><b>${esc(D.fullName(l))}</b><span class="num">${esc(fmt(l.phone))}</span><span class="num ${k.ok ? "" : "late"}">${esc(k.st)} ${esc(k.txt)}</span><span class="hph-stage s-${esc(l.stage || "new")}">${esc(D.stageName(l.stage || "new"))}</span></button>`; }).join("") || `<p class="hpd-sm" style="margin:0">Nobody to call in ${esc(listName())} right now${outside ? ` (${outside} are outside calling hours)` : ""}.</p>`}</div>
      </div>
      <button type="button" class="hpf-link hpd-sm" id="hphManual">${$("#dPane").classList.contains("hpd-showmanual") ? "Hide" : "Show"} the one-by-one call queue</button>`;
    // wiring
    $("#hphPick").onclick = openPicker; $("#hphAll").onclick = openPicker;
    $("#hphSetup")?.addEventListener("click", async (e) => {
      const b = e.currentTarget; b.disabled = true; b.textContent = "Connecting…";
      try { const r = await api("/setup", { method: "POST" }); S.ready = true; document.body.classList.add("hpd-on"); toast(r.trial ? "Connected. Twilio trial accounts can only call numbers you've verified in Twilio." : "Phone line connected"); startDevice(); refreshNumbers(); renderPhone(); }
      catch (er) { toast(er.message); b.disabled = false; b.textContent = "Connect Twilio"; }
    });
    $("#hphBuy")?.addEventListener("click", () => openTab("numbers"));
    $("#hphSound").onclick = () => { S.sound.open = !S.sound.open; lsSet("hpd.sound", S.sound); renderHome(); };
    $("#hphTest").onclick = () => ding(true);
    $("#hphDing").oninput = (e) => { S.sound.ding = +e.target.value; lsSet("hpd.sound", S.sound); e.target.nextElementSibling.textContent = Math.round(S.sound.ding * 100) + "%"; };
    fillDevices();
    $("#hphSrc").onchange = (e) => { setSrc(e.target.value); renderHome(); renderPhone(); };
    $("#hphFilter").onchange = (e) => { setFilter(e.target.value); renderHome(); renderPhone(); };
    $$("[data-hl]", el).forEach((b) => (b.onclick = () => { S.lines = +b.dataset.hl; lsSet("hpd.lines", S.lines); savePrefs({ lines: S.lines }); renderHome(); }));
    $$("[data-via]", el).forEach((b) => (b.onclick = () => { if (S.call || S.power || S.ps) { toast("Finish the current calls first"); return; } S.via = b.dataset.via; lsSet("hpd.via", S.via); renderHome(); renderPhone(); }));
    $("#hphPsGo")?.addEventListener("click", startPhoneSession);
    $("#hphPsSkip")?.addEventListener("click", () => phoneNext());
    $("#hphPsEnd")?.addEventListener("click", () => phoneEnd());
    $("#hphGo")?.addEventListener("click", () => { S.mode = "power"; lsSet("hpd.mode", "power"); renderPhone(); startPower(); });
    $("#hphPause")?.addEventListener("click", togglePause);
    $("#hphStop")?.addEventListener("click", stopPower);
    $$("[data-open]", el).forEach((b) => (b.onclick = () => openProfile(b.dataset.open)));
    $$("[data-usec]", el).forEach((b) => (b.onclick = () => { setSrc("c:" + b.dataset.usec); renderHome(); }));
    $$("[data-cpause]", el).forEach((b) => (b.onclick = () => { const c = S.camps.find((x) => x.id === b.dataset.cpause); c.paused = !c.paused; saveCamps(); renderHome(); }));
    $$("[data-cdel]", el).forEach((b) => (b.onclick = () => { if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Delete?"; b.classList.add("armed"); return; } S.camps = S.camps.filter((x) => x.id !== b.dataset.cdel); if (S.src === "c:" + b.dataset.cdel) setSrc("all"); saveCamps(); renderHome(); toast("Campaign deleted. The leads are still in your CRM."); }));
    $("#hphManual").onclick = () => { $("#dPane").classList.toggle("hpd-showmanual"); renderHome(); };
    const mb = $("#hpdManualBar"); if (mb) mb.hidden = !$("#dPane").classList.contains("hpd-showmanual") || el.hidden;
  }
  async function fillDevices() {
    const spk = $("#hphSpk"), mic = $("#hphMic"); if (!spk || !navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const add = (sel, kind, cur) => devs.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== "default").forEach((d, i) => sel.insertAdjacentHTML("beforeend", `<option value="${esc(d.deviceId)}" ${cur === d.deviceId ? "selected" : ""}>${esc(d.label || (kind === "audiooutput" ? "Speaker " : "Microphone ") + (i + 1))}</option>`));
      add(spk, "audiooutput", S.sound.spk); add(mic, "audioinput", S.sound.mic);
      spk.onchange = () => { S.sound.spk = spk.value; lsSet("hpd.sound", S.sound); applyDevices(); };
      mic.onchange = () => { S.sound.mic = mic.value; lsSet("hpd.sound", S.sound); applyDevices(); };
    } catch {}
  }
  function applyDevices() {
    const a = S.device?.audio; if (!a) return;
    try { if (S.sound.spk && a.isOutputSelectionSupported) { a.speakerDevices.set(S.sound.spk); a.ringtoneDevices.set(S.sound.spk); } } catch {}
    try { if (S.sound.mic) a.setInputDevice?.(S.sound.mic); } catch {}
  }

  /* "Who are we calling?" picker → campaigns */
  function openPicker() {
    const D = window.hpDesk; let key = S.src, f = "everyone", q = "", onlyPicked = false;
    const picked = new Set(); let lastIdx = -1;
    const m = document.createElement("div"); m.className = "hpd hph-modal"; m.setAttribute("role", "dialog"); m.setAttribute("aria-label", "Who are we calling?");
    document.body.append(m);
    const rows = () => { let r = applyFilter(sourceLeads(key), f).filter((l) => !q || [D.fullName(l), l.phone, l.state, l.source, ...(l.tags || [])].join(" ").toLowerCase().includes(q) || (d10(q).length >= 3 && d10(l.phone).includes(d10(q)))); if (onlyPicked) r = r.filter((l) => picked.has(l.id)); return r; };
    const first = (n) => { picked.clear(); rows().filter(dialable).slice(0, n).forEach((l) => picked.add(l.id)); draw(); };
    const draw = () => {
      const r = rows(), base = sourceLeads(key), counts = Object.fromEntries(FILTERS.map(([k]) => [k, applyFilter(base, k).length]));
      const pickedLeads = [...picked].map((id) => D.leads.get(id)).filter(Boolean); const out = pickedLeads.filter((l) => !leadClock(l).ok).length;
      m.innerHTML = `<div class="hph-mbox">
        <div class="hph-mtop"><h2>Who are we calling?</h2><input type="search" id="hpmQ" placeholder="Search name, phone, state, tag" value="${esc(q)}"><button type="button" class="hpf-x" id="hpmX" aria-label="Close">✕</button></div>
        <div class="hph-mbody">
          <aside><span class="hph-ml">Call from</span><button type="button" data-k="all" aria-pressed="${key === "all"}"><i style="background:#FF4FA3"></i>All my leads<b class="num">${[...D.leads.values()].length.toLocaleString()}</b></button>
            <span class="hph-ml">Imported lists</span>${campaigns().filter((c) => c.name !== "No campaign").slice(0, 12).map((c) => `<button type="button" data-k="s:${esc(c.name)}" aria-pressed="${key === "s:" + c.name}"><i style="background:#FF9E3D"></i>${esc(c.name)}<b class="num">${c.total}</b></button>`).join("")}<button type="button" id="hpmImport" class="hph-mlink">+ Import leads…</button>
            ${S.camps.length ? `<span class="hph-ml">My campaigns</span>${S.camps.map((c) => `<button type="button" data-k="c:${esc(c.id)}" aria-pressed="${key === "c:" + c.id}"><i style="background:#3BD38B"></i>${esc(c.name)}<b class="num">${c.ids.length}</b></button>`).join("")}` : ""}
            <div class="hph-keys"><span><kbd>Ctrl A</kbd> tick everyone shown</span><span><kbd>⇧ click</kbd> tick a range</span><span><kbd>Ctrl ↵</kbd> create the campaign</span><span><kbd>/</kbd> search</span></div>
          </aside>
          <section>
            <div class="hph-fchips" role="group" aria-label="Who to show">${FILTERS.map(([k, n, c, hint]) => `<button type="button" data-f="${k}" aria-pressed="${f === k}" title="${esc(hint)}"><i style="background:${c}"></i>${n}<b class="num">${counts[k].toLocaleString()}</b></button>`).join("")}</div>
            <div class="hph-mbar"><label class="hpd-flex hpd-sm"><input type="checkbox" id="hpmAll" ${r.length && r.every((l) => picked.has(l.id)) ? "checked" : ""}> ${r.length.toLocaleString()} shown</label><span class="hpd-sm" style="margin-left:auto">Pick first</span>${[25, 50, 100, 250].map((n) => `<button type="button" class="hph-pf" data-first="${n}">${n}</button>`).join("")}</div>
            <div class="hph-mtable"><table class="hpd-tbl"><thead><tr><th></th><th>Name</th><th>Phone</th><th>State · their time</th><th class="hide-sm">Last call</th><th>Stage</th></tr></thead><tbody>
            ${r.slice(0, 400).map((l, i) => { const k = leadClock(l); return `<tr data-i="${i}" data-id="${esc(l.id)}" class="${picked.has(l.id) ? "on" : ""}"><td><input type="checkbox" aria-label="Pick ${esc(D.fullName(l))}" ${picked.has(l.id) ? "checked" : ""}></td><td><b>${esc(D.fullName(l))}</b></td><td class="num">${esc(fmt(l.phone))}</td><td class="num ${k.ok ? "ok" : "late"}">${esc(k.st)} · ${esc(k.txt)}</td><td class="hide-sm hpd-sm">${l.lastCallAt ? ago(l.lastCallAt) : "Never"}</td><td><span class="hph-stage s-${esc(l.stage || "new")}">${esc(D.stageName(l.stage || "new"))}</span></td></tr>`; }).join("") || `<tr><td colspan="6" class="hpd-sm" style="padding:20px">No leads here.</td></tr>`}
            ${r.length > 400 ? `<tr><td colspan="6" class="hpd-sm">Showing the first 400. Use "Pick first" or the header checkbox to pick from all ${r.length.toLocaleString()}.</td></tr>` : ""}
            </tbody></table></div>
          </section>
        </div>
        <div class="hph-mfoot"><b>${picked.size.toLocaleString()} picked</b><button type="button" class="hpf-link" id="hpmClear">Clear</button><label class="hpd-flex hpd-sm"><input type="checkbox" id="hpmOnly" ${onlyPicked ? "checked" : ""}> Show picked only</label>
          <input id="hpmName" placeholder="Campaign name" value="${esc(new Date().toLocaleDateString([], { month: "short", day: "numeric" }) + (key.startsWith("s:") ? " · " + key.slice(2) : ""))}">
          <button type="button" class="btn" id="hpmCsv" ${picked.size ? "" : "disabled"}>Save ${picked.size} as a file</button><button type="button" class="btn primary" id="hpmGo" ${picked.size ? "" : "disabled"}>Create campaign with ${picked.size.toLocaleString()} leads</button>
          ${out ? `<p class="hph-warn">${out} of them are outside calling hours right now. The dialer skips those until it's calling time where they live.</p>` : ""}</div>
      </div>`;
      wire(r);
    };
    const close = () => { m.remove(); document.removeEventListener("keydown", keys); };
    const create = () => {
      if (!picked.size) return;
      const c = { id: Date.now().toString(36), name: ($("#hpmName").value.trim() || "Campaign").slice(0, 60), ids: [...picked], created: Date.now(), paused: false };
      S.camps.unshift(c); setSrc("c:" + c.id); setFilter("everyone"); saveCamps(); close(); renderHome(); renderPhone(); toast(`Campaign "${c.name}" ready. Press Start calling.`);
    };
    const wire = (r) => {
      $("#hpmX").onclick = close; m.onclick = (e) => { if (e.target === m) close(); };
      const qi = $("#hpmQ"); qi.oninput = () => { q = qi.value.trim().toLowerCase(); const pos = qi.selectionStart; draw(); const n = $("#hpmQ"); n.focus(); n.setSelectionRange(pos, pos); };
      $$("[data-k]", m).forEach((b) => (b.onclick = () => { key = b.dataset.k; lastIdx = -1; draw(); }));
      $$("[data-f]", m).forEach((b) => (b.onclick = () => { f = b.dataset.f; lastIdx = -1; draw(); }));
      $$("[data-first]", m).forEach((b) => (b.onclick = () => first(+b.dataset.first)));
      $("#hpmAll").onchange = (e) => { rows().forEach((l) => (e.target.checked ? picked.add(l.id) : picked.delete(l.id))); draw(); };
      $$("tr[data-id]", m).forEach((tr) => (tr.onclick = (e) => {
        const i = +tr.dataset.i, id = tr.dataset.id;
        if (e.shiftKey && lastIdx >= 0) { const [a, b] = [Math.min(lastIdx, i), Math.max(lastIdx, i)]; r.slice(a, b + 1).forEach((l) => picked.add(l.id)); }
        else picked.has(id) ? picked.delete(id) : picked.add(id);
        lastIdx = i; draw();
      }));
      $("#hpmClear").onclick = () => { picked.clear(); draw(); };
      $("#hpmOnly").onchange = (e) => { onlyPicked = e.target.checked; draw(); };
      $("#hpmImport").onclick = () => { close(); D.go("import"); };
      $("#hpmGo").onclick = create;
      $("#hpmCsv").onclick = () => {
        const L = [...picked].map((id) => D.leads.get(id)).filter(Boolean);
        const csv = [["First Name", "Last Name", "Phone", "Email", "State", "Stage", "Source"], ...L.map((l) => [l.first, l.last, d10(l.phone), l.email, l.state, D.stageName(l.stage || "new"), l.source])].map((x) => x.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
        const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `${($("#hpmName").value || "campaign").replace(/[^\w -]/g, "")}.csv`; a.click();
      };
    };
    const keys = (e) => {
      if (e.key === "Escape") return close();
      const typing = e.target.closest?.("input:not([type=checkbox]),textarea");
      if (e.key === "/" && !typing) { e.preventDefault(); $("#hpmQ")?.focus(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && !typing) { e.preventDefault(); rows().forEach((l) => picked.add(l.id)); draw(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); create(); }
    };
    document.addEventListener("keydown", keys);
    draw(); setTimeout(() => $("#hpmQ")?.focus(), 50);
  }
  const ago = (t) => { const mm = (Date.now() - t) / 6e4; if (mm < 60) return Math.max(1, Math.round(mm)) + "m ago"; const h = mm / 60; if (h < 24) return Math.round(h) + "h ago"; const dd = h / 24; return dd < 2 ? "Yesterday" : Math.round(dd) + " days ago"; };

  /* recordings + do-not-call tabs */
  async function renderRecs() {
    const el = $("#hpdRecs"); el.innerHTML = `<div class="panel">Loading…</div>`;
    let calls; try { calls = (await api(`/calls?days=30&agent=${S.me?.admin ? lsGet("hpd.who", "me") : "me"}`)).calls.filter((c) => c.recordingSid); } catch (e) { el.innerHTML = `<div class="panel">${esc(e.message)}</div>`; return; }
    el.innerHTML = `<div class="panel stack"><div class="row" style="justify-content:space-between"><h2>Recordings</h2><input type="search" id="hprQ" placeholder="Search name or number" style="max-width:260px"></div>
      <div style="overflow-x:auto"><table class="hpd-tbl"><thead><tr><th>Lead</th><th>When</th><th>Result</th><th>Length</th><th></th></tr></thead><tbody id="hprRows"></tbody></table></div><div id="hpdTxView"></div></div>`;
    const draw = () => { const q = $("#hprQ").value.trim().toLowerCase(); $("#hprRows").innerHTML = calls.filter((c) => !q || `${c.leadName} ${c.to}`.toLowerCase().includes(q)).slice(0, 200).map((c) => `<tr><td><b>${esc(c.leadName || fmt(c.to))}</b><br><span class="hpd-sm">${esc(fmt(c.to))}</span></td><td class="hpd-sm">${new Date(c.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td><td><span class="hpd-pill">${esc(c.disposition || (c.human ? "Talked" : "—"))}</span></td><td class="num">${dur(c.recordingSec || c.talkSec)}</td><td><button class="btn" data-play="${esc(c.sid)}" type="button">Play</button> <button class="btn" data-tx="${esc(c.sid)}" type="button">Transcript</button>${c.leadId ? ` <button class="btn" data-open="${esc(c.leadId)}" type="button">Profile</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="5" class="hpd-sm">No recordings yet. Every connected call is recorded automatically.</td></tr>`;
      $$("[data-play]", el).forEach((b) => (b.onclick = async () => { if (S.demo) return toast("Recordings play here once real calls are made"); const r = await fetch(API + "/calls/recording?sid=" + encodeURIComponent(b.dataset.play), { headers: authHeader(), credentials: "same-origin" }); if (!r.ok) return toast("Recording isn't ready yet"); const au = document.createElement("audio"); au.controls = true; au.autoplay = true; au.style.height = "32px"; au.src = URL.createObjectURL(await r.blob()); b.replaceWith(au); }));
      $$("[data-tx]", el).forEach((b) => (b.onclick = async () => { const r = await api("/calls/transcript?sid=" + encodeURIComponent(b.dataset.tx)); const c = calls.find((x) => x.sid === b.dataset.tx); const pm = c?.mode === "power"; $("#hpdTxView").innerHTML = `<div class="hpd-tx" style="max-height:320px;margin-top:10px">${(r.lines || []).map((l) => { const w = (l.track === "inbound_track") === pm ? "Lead" : "Agent"; return `<p><span class="who ${w}">${w}</span>${esc(l.text)}</p>`; }).join("") || `<p class="hpd-sm">No transcript for this call.</p>`}</div>`; }));
      $$("[data-open]", el).forEach((b) => (b.onclick = () => openProfile(b.dataset.open)));
    };
    $("#hprQ").oninput = draw; draw();
  }
  async function renderDnc() {
    const el = $("#hpdDnc"); let info = { count: 0 }; try { info = await api("/calls/dnc"); } catch {}
    el.innerHTML = `<div class="hpd-grid2"><div class="panel stack"><h2>Do not call</h2><p class="hpd-sm" style="margin:0">${(info.count || 0).toLocaleString()} numbers blocked for the whole team. Press-9 opt-outs, STOP replies and "Do not call" results are added automatically.</p>
      <div class="hpd-flex"><input id="hpdDncChk" placeholder="Check a number" inputmode="tel" style="flex:1"><button class="btn" id="hpdDncChkB" type="button">Check</button></div><div id="hpdDncRes" class="hpd-sm"></div>
      <textarea id="hpdDncN2" rows="4" placeholder="Paste numbers to block, one per line"></textarea>
      <div class="hpd-flex"><button class="btn primary" id="hpdDncAdd2" type="button">Add to Do Not Call</button>${S.me?.admin ? `<button class="btn" id="hpdDncDel2" type="button">Remove (admin)</button>` : ""}</div></div>
      ${info.numbers?.length ? `<div class="panel stack"><h2>Blocked numbers</h2><div class="hpd-sm" style="max-height:360px;overflow:auto;columns:2">${info.numbers.slice(0, 2000).map((n) => `<div class="num">${esc(fmt(n))}</div>`).join("")}</div></div>` : ""}</div>`;
    const nums = () => $("#hpdDncN2").value.split(/[\n,;]+/).map(d10).filter((x) => x.length === 10);
    $("#hpdDncChkB").onclick = async () => { const n = d10($("#hpdDncChk").value); if (n.length !== 10) return; const r = await api("/calls/dnc?n=" + n); $("#hpdDncRes").textContent = r.check ? `${fmt(n)} is on Do Not Call.` : `${fmt(n)} is not blocked.`; };
    $("#hpdDncAdd2").onclick = async () => { const n = nums(); if (!n.length) return; await api("/calls/dnc", { method: "POST", body: { numbers: n } }); toast(`${n.length} added to Do Not Call`); renderDnc(); };
    $("#hpdDncDel2")?.addEventListener("click", async () => { const n = nums(); if (!n.length) return; await api("/calls/dnc", { method: "DELETE", body: { numbers: n } }); toast(`${n.length} removed`); renderDnc(); });
  }

  window.hpDialer = { openProfile: (id) => openProfile(id), get ready() { return S.via === "phone" || (!!S.device && (S.ready || S.demo)); }, dialLead, onDispo, meta, refresh: () => renderPhone(), get busy() { return !!(S.call || S.power || (S.via === "phone" && S.phoneLead && !S.ps)); } };
  window.addEventListener("hp:leadchange", () => { if (!S.call && !S.power) renderActions(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
