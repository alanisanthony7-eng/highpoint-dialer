/* Highpoint · Spotify dock
   Each agent connects their own Spotify account to their Highpoint login (Connect Spotify).
   - Premium: plays right in the desk (Spotify's Web Playback SDK), with your playlists, controls and
     auto-pause when a call starts. Premium is detected by Spotify itself when the player starts.
   - Spotify Free, not connected, or not set up by the admin: Spotify's embedded player (paste a link;
     full songs only if you're logged in to Spotify in this browser, otherwise 30-second previews).
   Settings (link, auto-pause, auto-resume) are saved to your login, so they follow you to any computer. */
(() => {
  if (window.__hpSpotify) return; window.__hpSpotify = true;

  const DEFAULT_URI = "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"; // a Spotify-curated hits playlist
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function api(path, body) {
    const r = await fetch("/api/spotify/" + path, { method: body ? "POST" : "GET", credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "Spotify request failed"), { status: r.status, code: j.code });
    return j;
  }

  /* Turn any Spotify link or URI into spotify:type:id */
  function toUri(input) {
    const s = String(input || "").trim();
    let m = s.match(/^spotify:(playlist|album|track|artist|show|episode):([A-Za-z0-9]{10,})$/);
    if (m) return `spotify:${m[1]}:${m[2]}`;
    m = s.match(/open\.spotify\.com\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(?:embed\/)?(playlist|album|track|artist|show|episode)\/([A-Za-z0-9]{10,})/i);
    if (m) return `spotify:${m[1].toLowerCase()}:${m[2]}`;
    return null;
  }

  /* ---------- styles ---------- */
  const css = `
  .sp-btn{display:inline-flex;align-items:center;gap:7px}
  .sp-btn svg{width:16px;height:16px}
  .sp-btn .sp-dot{width:7px;height:7px;border-radius:50%;background:#1DB954;box-shadow:0 0 8px #1DB954;display:none}
  .sp-btn.playing .sp-dot{display:inline-block}
  #spDock{position:fixed;right:18px;bottom:18px;z-index:60;width:min(380px,calc(100vw - 24px));
    background:rgba(10,10,14,.94);border:1px solid rgba(255,255,255,.12);border-radius:18px;
    box-shadow:0 30px 70px -20px rgba(0,0,0,.9);-webkit-backdrop-filter:blur(22px);backdrop-filter:blur(22px);
    color:#F2F4F8;font:13px/1.4 var(--f-ui,system-ui,-apple-system,"Segoe UI",sans-serif);overflow:hidden;
    transform-origin:bottom right;transition:transform .35s cubic-bezier(.2,.8,.2,1),opacity .25s}
  #spDock[hidden]{display:block!important;transform:scale(.6) translateY(20px);opacity:0;pointer-events:none}
  #spDock .sp-head{display:flex;align-items:center;gap:8px;padding:10px 10px 10px 14px;cursor:grab;user-select:none}
  #spDock .sp-head:active{cursor:grabbing}
  #spDock .sp-head b{font-size:13px;letter-spacing:.02em}
  #spDock .sp-head .sp-who{flex:1;min-width:0;color:#8B92A0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #spDock .sp-head svg.logo{width:18px;height:18px;color:#1DB954;flex:none}
  #spDock .sp-x{all:unset;cursor:pointer;width:28px;height:28px;display:grid;place-items:center;border-radius:8px;color:#A3A9B6}
  #spDock .sp-x:hover{background:rgba(255,255,255,.08);color:#fff}
  #spDock .sp-body{padding:0 12px 12px;display:flex;flex-direction:column;gap:10px}
  #spDock .sp-frame{border-radius:12px;overflow:hidden;background:#121212;min-height:152px}
  #spDock .sp-frame iframe{display:block;border:0;width:100%}
  #spDock .sp-now{display:grid;grid-template-columns:64px minmax(0,1fr);gap:12px;align-items:center;padding:10px;border-radius:12px;background:#121212}
  #spDock .sp-art{width:64px;height:64px;border-radius:8px;background:#232323 center/cover no-repeat;display:grid;place-items:center;color:#1DB954}
  #spDock .sp-art svg{width:26px;height:26px}
  #spDock .sp-tt{min-width:0}#spDock .sp-tt b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#spDock .sp-tt span{display:block;color:#A3A9B6;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #spDock .sp-ctl{grid-column:1/-1;display:flex;justify-content:center;align-items:center;gap:14px}
  #spDock .sp-ctl button{all:unset;cursor:pointer;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;color:#E6E8EE}
  #spDock .sp-ctl button:hover{background:rgba(255,255,255,.08)}
  #spDock .sp-ctl button.main{width:42px;height:42px;background:#fff;color:#000}
  #spDock .sp-ctl button.main:hover{transform:scale(1.04);background:#fff}
  #spDock .sp-ctl svg{width:18px;height:18px}
  #spDock .sp-row{display:flex;gap:8px}
  .sp-vol{display:flex;align-items:center;gap:8px;padding:0 4px}
  .sp-mute{all:unset;cursor:pointer;width:28px;height:28px;display:grid;place-items:center;border-radius:8px;color:#C9CDD5;flex:none}
  .sp-mute:hover{background:rgba(255,255,255,.08);color:#fff}.sp-mute svg{width:18px;height:18px}
  input.sp-range{-webkit-appearance:none!important;appearance:none!important;flex:1;min-width:60px;width:auto!important;height:16px!important;min-height:0!important;margin:0!important;padding:0!important;border:0!important;box-shadow:none!important;outline:none;cursor:pointer;background:transparent!important}
  input.sp-range::-webkit-slider-runnable-track{height:4px;border-radius:999px;background:linear-gradient(90deg,#1DB954 var(--v,70%),rgba(255,255,255,.22) var(--v,70%))}
  input.sp-range::-moz-range-track{height:4px;border-radius:999px;background:linear-gradient(90deg,#1DB954 var(--v,70%),rgba(255,255,255,.22) var(--v,70%))}
  input.sp-range::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;margin-top:-5px;border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.5);border:0}
  input.sp-range::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:#fff;border:0}
  input.sp-range:focus{outline:none!important;box-shadow:none!important;border:0!important;background:transparent!important}
  input.sp-range:focus-visible{outline:2px solid #1DB954!important;outline-offset:3px}
  #spDock input[type=text],#spDock select{flex:1;min-width:0;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:10px;color:#F2F4F8;padding:8px 10px;font:inherit}
  #spDock select option{background:#16161c}
  #spDock input[type=text]:focus,#spDock select:focus{outline:none;border-color:#1DB954;box-shadow:0 0 0 3px rgba(29,185,84,.18)}
  #spDock .sp-go{all:unset;cursor:pointer;padding:8px 12px;border-radius:10px;background:#1DB954;color:#05120A;font-weight:700;text-align:center}
  #spDock .sp-go:hover{filter:brightness(1.08)}
  #spDock .sp-go.wide{display:block;padding:10px 12px}
  #spDock .sp-link{all:unset;cursor:pointer;color:#A3A9B6;text-decoration:underline;text-underline-offset:2px}
  #spDock .sp-link:hover{color:#fff}
  #spDock .sp-opts{display:flex;flex-wrap:wrap;gap:6px 14px;color:#A3A9B6;font-size:12px}
  #spDock .sp-opts label{display:inline-flex!important;flex-direction:row!important;align-items:center;gap:6px;cursor:pointer;width:auto!important;margin:0}
  #spDock .sp-opts input{accent-color:#1DB954;width:auto!important;height:auto!important;flex:none!important;margin:0;padding:0;box-shadow:none!important}
  #spDock .sp-fine{color:#6B7180;font-size:11.5px;margin:0;line-height:1.45}
  #spDock .sp-fine a{color:#A3A9B6}
  #spDock .sp-msg{padding:9px 11px;border-radius:10px;background:rgba(29,185,84,.1);border:1px solid rgba(29,185,84,.3);color:#D9F7E3;font-size:12.5px;line-height:1.45}
  #spDock .sp-msg.warn{background:rgba(255,170,60,.1);border-color:rgba(255,170,60,.35);color:#FFE2BD}
  #spNote{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:70;background:#0E0E14;color:#F2F4F8;
    border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:8px 14px;font:13px var(--f-ui,system-ui,sans-serif);
    box-shadow:0 12px 30px -10px rgba(0,0,0,.9);display:flex;align-items:center;gap:8px;transition:opacity .3s;max-width:calc(100vw - 24px)}
  #spNote[hidden]{display:flex!important;opacity:0;pointer-events:none}
  #spNote i{width:8px;height:8px;border-radius:50%;background:#1DB954;flex:none}
  html.gated #spDock,html.gated #spNote,html.gated .sp-btn{display:none!important}
  @media (max-width:640px){#spDock{right:12px;left:12px;width:auto;bottom:86px}}`;
  const styleEl = document.createElement("style"); styleEl.textContent = css; document.head.appendChild(styleEl);

  const LOGO = `<svg class="logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.6 14.4a.62.62 0 0 1-.86.2c-2.35-1.44-5.3-1.76-8.79-.96a.62.62 0 1 1-.28-1.21c3.81-.87 7.08-.5 9.72 1.11.3.18.39.56.21.86Zm1.22-2.72a.78.78 0 0 1-1.07.26c-2.69-1.65-6.79-2.13-9.97-1.17a.78.78 0 1 1-.45-1.49c3.63-1.1 8.15-.57 11.23 1.33.37.22.48.7.26 1.07Zm.1-2.83C14.7 8.94 9.36 8.76 6.28 9.7a.94.94 0 1 1-.55-1.8c3.54-1.07 9.43-.87 13.15 1.34a.94.94 0 0 1-.96 1.61Z"/></svg>`;
  const IC = {
    vol: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>`,
    volLow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>`,
    mute: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="M22 9l-6 6M16 9l6 6"/></svg>`,
    play: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"/></svg>`,
    pause: `<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>`,
    prev: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 5h2v14H7zM19 5.8v12.4a.8.8 0 0 1-1.25.66L10 13.2a1.4 1.4 0 0 1 0-2.4l7.75-5.66A.8.8 0 0 1 19 5.8Z"/></svg>`,
    next: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15 5h2v14h-2zM5 5.8v12.4a.8.8 0 0 0 1.25.66L14 13.2a1.4 1.4 0 0 0 0-2.4L6.25 5.14A.8.8 0 0 0 5 5.8Z"/></svg>`,
    note: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>`,
  };

  /* ---------- state ---------- */
  // per login, per browser: where the dock sits and whether it's open; per login everywhere: the rest (saved to the account)
  let uid = "", srv = { configured: false, connected: false }, mode = "embed"; // "sdk" plays in the desk (Premium); "embed" is Spotify's embedded player
  const st = { uri: DEFAULT_URI, open: false, autoPause: true, autoResume: true, x: null, y: null, volume: 0.7, lastVol: 0.7 };
  const lkey = () => "hp.spotify." + (uid || "anon");
  const loadLocal = () => { try { return JSON.parse(localStorage.getItem(lkey())) || {}; } catch { return {}; } };
  const saveLocal = () => { try { localStorage.setItem(lkey(), JSON.stringify({ open: st.open, x: st.x, y: st.y, uri: st.uri, autoPause: st.autoPause, autoResume: st.autoResume, volume: st.volume, lastVol: st.lastVol })); } catch {} };
  let prefT = 0;
  const savePrefs = () => { saveLocal(); clearTimeout(prefT); prefT = setTimeout(() => api("prefs", { uri: st.uri, autoPause: st.autoPause, autoResume: st.autoResume }).catch(() => {}), 600); };

  /* ---------- dock ---------- */
  const dock = document.createElement("section");
  dock.id = "spDock"; dock.setAttribute("aria-label", "Spotify player"); dock.hidden = true;
  dock.innerHTML = `
    <div class="sp-head">${LOGO}<b>Spotify</b><span class="sp-who" data-who></span>
      <button class="sp-x" data-min aria-label="Hide player" title="Hide (music keeps playing)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 12h12"/></svg></button>
    </div>
    <div class="sp-body" data-body></div>`;
  const note = document.createElement("div"); note.id = "spNote"; note.hidden = true; note.setAttribute("role", "status");
  let noteT = 0;
  const notify = (t, ms = 2600) => { note.innerHTML = `<i></i>${t}`; note.hidden = false; clearTimeout(noteT); noteT = setTimeout(() => (note.hidden = true), ms); };
  const $ = (s) => dock.querySelector(s);
  const body = () => $("[data-body]");

  /* drag the dock by its header */
  function placeDock() { if (st.x == null) return; dock.style.left = st.x + "px"; dock.style.top = st.y + "px"; dock.style.right = "auto"; dock.style.bottom = "auto"; }
  (() => {
    const head = $(".sp-head"); let sx, sy, ox, oy, dragging = false;
    head.addEventListener("pointerdown", (e) => { if (e.target.closest("button") || innerWidth < 640) return; dragging = true; const r = dock.getBoundingClientRect(); sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top; head.setPointerCapture(e.pointerId); });
    head.addEventListener("pointermove", (e) => { if (!dragging) return; st.x = Math.max(6, Math.min(innerWidth - dock.offsetWidth - 6, ox + e.clientX - sx)); st.y = Math.max(6, Math.min(innerHeight - 60, oy + e.clientY - sy)); placeDock(); });
    head.addEventListener("pointerup", () => { if (dragging) { dragging = false; saveLocal(); } });
  })();
  $("[data-min]").onclick = () => setOpen(false);
  function setOpen(v) { st.open = v; saveLocal(); dock.hidden = !v; if (v) start(); changed(); }
  const changed = () => { topBtn?.classList.toggle("playing", playing); window.dispatchEvent(new Event("hp:musicstate")); };

  /* ---------- what the dock shows ---------- */
  const optsHTML = () => `<div class="sp-opts"><label><input type="checkbox" data-ap ${st.autoPause ? "checked" : ""}> Pause when a call starts</label><label><input type="checkbox" data-ar ${st.autoResume ? "checked" : ""}> Resume after the call</label></div>`;
  function wireOpts() {
    const ap = $("[data-ap]"), ar = $("[data-ar]");
    if (ap) ap.onchange = (e) => { st.autoPause = e.target.checked; savePrefs(); changed(); };
    if (ar) ar.onchange = (e) => { st.autoResume = e.target.checked; savePrefs(); };
  }
  let msg = null; // { text, warn }
  function render() {
    $("[data-who]").textContent = srv.connected ? "· " + (srv.name || "Connected") : "";
    const m = msg ? `<div class="sp-msg${msg.warn ? " warn" : ""}">${msg.text}</div>` : "";
    if (mode === "sdk") {
      body().innerHTML = `${m}<div class="sp-now"><div class="sp-art" data-art>${IC.note}</div><div class="sp-tt"><b data-tt>${sdkReady ? "Ready to play" : "Starting the player…"}</b><span data-ta>${sdkReady ? "Pick a playlist or press play" : "Connecting to Spotify"}</span></div>
          <div class="sp-ctl"><button type="button" data-prev aria-label="Previous">${IC.prev}</button><button type="button" class="main" data-pp aria-label="Play">${IC.play}</button><button type="button" data-next aria-label="Next">${IC.next}</button></div></div>
        <div class="sp-vol">${volHTML()}</div>
        <div class="sp-row"><select data-pl aria-label="Your playlists"><option value="">Your playlists…</option></select></div>
        ${optsHTML()}
        <p class="sp-fine">Playing on “Highpoint Desk” with your Spotify Premium. <button type="button" class="sp-link" data-disc>Disconnect Spotify</button></p>`;
      $("[data-pp]").onclick = () => togglePlay();
      $("[data-prev]").onclick = () => player?.previousTrack();
      $("[data-next]").onclick = () => player?.nextTrack();
      $("[data-pl]").onchange = (e) => { if (e.target.value) { st.uri = e.target.value; savePrefs(); playUri(st.uri); } };
      fillPlaylists(); paintNow(lastState);
    } else {
      const connect = srv.configured && !srv.connected
        ? `<button type="button" class="sp-go wide" data-connect>Connect your Spotify</button><p class="sp-fine">Connects Spotify to your Highpoint login only. With Spotify Premium, music plays right here in the desk.</p>`
        : "";
      const free = srv.connected && srv.product === "free"
        ? `<p class="sp-fine">Your Spotify account is Free. Spotify only lets Premium accounts play inside other apps, so this is Spotify's own player: full songs if you're logged in to Spotify in this browser, previews if not. <button type="button" class="sp-link" data-disc>Disconnect Spotify</button></p>` : "";
      body().innerHTML = `${m}${connect}<div class="sp-frame"><div id="spEmbed"></div></div>
        <form class="sp-row" data-form autocomplete="off"><input type="text" data-link placeholder="Paste a Spotify playlist, album or song link" aria-label="Spotify link"><button class="sp-go" type="submit">Play</button></form>
        ${optsHTML()}
        ${free || (srv.configured ? "" : `<p class="sp-fine">Log in to Spotify in this browser for full songs (otherwise Spotify plays 30-second previews). In Spotify: Share → Copy link, then paste it above.</p>`)}`;
      ctrl = null; embedApi ? mountEmbed() : loadEmbedApi();
    }
    wireVol(dock);
    const fm = $("[data-form]"); if (fm) fm.onsubmit = (e) => {
      e.preventDefault();
      const uri = toUri($("[data-link]").value);
      if (!uri) { notify("That doesn't look like a Spotify link"); return; }
      st.uri = uri; savePrefs(); $("[data-link]").value = "";
      if (mode === "sdk") playUri(uri); else if (ctrl) { ctrl.loadUri(uri); setTimeout(() => ctrl.play(), 600); } else mountEmbed();
    };
    const cn = $("[data-connect]"); if (cn) cn.onclick = () => { location.href = "/api/spotify/login"; };
    dock.querySelectorAll("[data-disc]").forEach((b) => (b.onclick = disconnect));
    wireOpts();
  }

  /* ---------- volume (the desk's own player only; Spotify's embedded player has no volume control) ---------- */
  const volIcon = () => (st.volume <= 0.001 ? IC.mute : st.volume < 0.45 ? IC.volLow : IC.vol);
  const volHTML = () => `<button type="button" class="sp-mute" data-mute aria-label="${st.volume <= 0.001 ? "Unmute" : "Mute"}" title="${st.volume <= 0.001 ? "Unmute" : "Mute"}">${volIcon()}</button><input type="range" class="sp-range" data-vol min="0" max="100" step="1" value="${Math.round(st.volume * 100)}" aria-label="Music volume" style="--v:${Math.round(st.volume * 100)}%">`;
  function setVolume(v, from) {
    v = Math.max(0, Math.min(1, +v || 0));
    if (v > 0.001) st.lastVol = v;
    st.volume = v; saveLocal();
    try { player?.setVolume(Math.max(v, 0.0001)); } catch {}
    window.dispatchEvent(new CustomEvent("hp:musicvol", { detail: { volume: v, from } }));
  }
  // keep every volume control on the page in step
  function syncVol(root) {
    root.querySelectorAll("[data-vol]").forEach((r) => { if (document.activeElement !== r) r.value = Math.round(st.volume * 100); r.style.setProperty("--v", Math.round(st.volume * 100) + "%"); });
    root.querySelectorAll("[data-mute]").forEach((b) => { b.innerHTML = volIcon(); b.setAttribute("aria-label", st.volume <= 0.001 ? "Unmute" : "Mute"); b.title = st.volume <= 0.001 ? "Unmute" : "Mute"; });
  }
  function wireVol(root) {
    root.querySelectorAll("[data-vol]").forEach((r) => (r.oninput = () => { r.style.setProperty("--v", r.value + "%"); setVolume(r.value / 100, r); }));
    root.querySelectorAll("[data-mute]").forEach((b) => (b.onclick = () => setVolume(st.volume <= 0.001 ? st.lastVol || 0.7 : 0, b)));
  }
  window.addEventListener("hp:musicvol", () => syncVol(document));

  /* ---------- Spotify's embedded player (Free, or not connected) ---------- */
  let ctrl = null, embedApi = null, playing = false, pausedByCall = false;
  window.onSpotifyIframeApiReady = (IFrameAPI) => { embedApi = IFrameAPI; if (mode === "embed" && !dock.hidden) mountEmbed(); };
  function loadEmbedApi() {
    if (document.getElementById("spApi")) return;
    const s = document.createElement("script"); s.id = "spApi"; s.async = true; s.src = "https://open.spotify.com/embed/iframe-api/v1";
    s.onerror = () => { const f = $(".sp-frame"); if (f) f.innerHTML = `<p class="sp-fine" style="padding:14px">Couldn't reach Spotify. Check your connection and reload.</p>`; };
    document.head.appendChild(s);
  }
  function mountEmbed() {
    const host = $("#spEmbed"); if (!host || !embedApi) return;
    embedApi.createController(host, { uri: st.uri, width: "100%", height: 152 }, (c) => {
      ctrl = c;
      c.addListener("playback_update", (e) => { const was = playing; playing = !e.data.isPaused; if (was !== playing) changed(); });
      c.addListener("ready", changed);
    });
  }

  /* ---------- Premium: Spotify's Web Playback SDK ---------- */
  let player = null, deviceId = null, sdkReady = false, lastState = null, tok = null;
  async function token() {
    if (tok && tok.exp > Date.now() + 60_000) return tok.access;
    const j = await api("token"); tok = { access: j.access_token, exp: j.expires_at }; return tok.access;
  }
  async function web(path, opts = {}) { // Spotify Web API with this agent's token
    const r = await fetch("https://api.spotify.com/v1" + path, { ...opts, headers: { authorization: "Bearer " + (await token()), ...(opts.body ? { "content-type": "application/json" } : {}) } });
    if (r.status === 204) return {};
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error?.message || "Spotify error"), { status: r.status, reason: j.error?.reason });
    return j;
  }
  function loadSdk() {
    if (window.Spotify?.Player) return initSdk();
    if (document.getElementById("spSdk")) return;
    window.onSpotifyWebPlaybackSDKReady = initSdk;
    const s = document.createElement("script"); s.id = "spSdk"; s.async = true; s.src = "https://sdk.scdn.co/spotify-player.js";
    s.onerror = () => toEmbed("Couldn't load Spotify's player, so this is Spotify's preview player for now.");
    document.head.appendChild(s);
  }
  function initSdk() {
    if (player) return;
    player = new window.Spotify.Player({ name: "Highpoint Desk", getOAuthToken: (cb) => token().then(cb).catch(() => {}), volume: Math.max(st.volume, 0.0001) });
    player.addListener("ready", ({ device_id }) => {
      deviceId = device_id; sdkReady = true;
      if (srv.product !== "premium") { srv.product = "premium"; api("product", { product: "premium" }).catch(() => {}); }
      if (mode === "sdk") render();
    });
    player.addListener("not_ready", () => { sdkReady = false; });
    player.addListener("account_error", () => { srv.product = "free"; api("product", { product: "free" }).catch(() => {}); toEmbed(""); });
    player.addListener("authentication_error", () => { srv.connected = false; srv.lost = true; toEmbed("Spotify signed you out. Connect again to keep listening.", true); });
    player.addListener("initialization_error", () => toEmbed("This browser can't run Spotify's player (try Chrome, Edge or Firefox), so this is Spotify's own player.", true));
    player.addListener("playback_error", ({ message }) => notify("Spotify: " + (message || "couldn't play that")));
    player.addListener("player_state_changed", (s) => {
      const prevId = lastState?.track_window?.current_track?.id; lastState = s;
      const was = playing; playing = !!s && !s.paused; paintNow(s);
      if (was !== playing || prevId !== s?.track_window?.current_track?.id) changed();
    });
    player.connect();
  }
  function toEmbed(text, warn) {
    if (player) { try { player.disconnect(); } catch {} player = null; }
    sdkReady = false; deviceId = null; mode = "embed"; msg = text ? { text: esc(text), warn } : null; playing = false;
    render(); changed();
  }
  function paintNow(s) {
    if (mode !== "sdk" || dock.hidden) return;
    const t = s?.track_window?.current_track, art = $("[data-art]"), pp = $("[data-pp]");
    if (pp) { pp.innerHTML = s && !s.paused ? IC.pause : IC.play; pp.setAttribute("aria-label", s && !s.paused ? "Pause" : "Play"); }
    if (!t) return;
    $("[data-tt]").textContent = t.name || "";
    $("[data-ta]").textContent = (t.artists || []).map((a) => a.name).join(", ");
    const img = t.album?.images?.[t.album.images.length > 1 ? 1 : 0]?.url;
    if (art) { art.style.backgroundImage = img ? `url("${img}")` : ""; art.innerHTML = img ? "" : IC.note; }
  }
  let plCache = null;
  async function fillPlaylists() {
    const sel = $("[data-pl]"); if (!sel) return;
    try {
      if (!plCache) plCache = (await web("/me/playlists?limit=40")).items || [];
      sel.innerHTML = `<option value="">Your playlists…</option>` + plCache.filter(Boolean).map((p) => `<option value="${esc(p.uri)}" ${p.uri === st.uri ? "selected" : ""}>${esc(p.name)}</option>`).join("");
    } catch { sel.innerHTML = `<option value="">Playlists unavailable — paste a link below</option>`; }
  }
  async function playUri(uri) {
    if (!deviceId) { notify("Spotify is still starting. Try again in a second."); return; }
    try { await player.activateElement?.(); } catch {}
    const kind = uri.split(":")[1], bodyJson = JSON.stringify(kind === "track" || kind === "episode" ? { uris: [uri] } : { context_uri: uri });
    try { await web(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, { method: "PUT", body: bodyJson }); }
    catch (e) {
      if (e.status === 404) { try { await web("/me/player", { method: "PUT", body: JSON.stringify({ device_ids: [deviceId], play: false }) }); await sleep(600); await web(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, { method: "PUT", body: bodyJson }); return; } catch (e2) { e = e2; } }
      if (e.status === 403 && /PREMIUM/i.test(e.reason || e.message)) { srv.product = "free"; api("product", { product: "free" }).catch(() => {}); toEmbed(""); return; }
      notify("Spotify: " + e.message);
    }
  }
  function togglePlay() {
    if (mode === "sdk" && player) { if (!lastState) playUri(st.uri); else { player.activateElement?.(); player.togglePlay(); } return; }
    if (ctrl) ctrl.togglePlay(); else setOpen(true);
  }
  async function disconnect() {
    if (!confirm("Disconnect Spotify from your Highpoint login?")) return;
    try { await api("disconnect", {}); } catch {}
    srv.connected = false; srv.product = null; srv.name = null; plCache = null; tok = null;
    toEmbed("Spotify is disconnected from your login.");
  }

  /* ---------- auto pause on calls ---------- */
  /* Pause only while a lead is actually on the line. Ringing leads, no-answers and the gap
     between one lead and the next never touch the music; resume waits a beat so a quick
     hang-up -> next connect doesn't flap play/pause. */
  let callLive = false, watchT = 0, resumeT = 0;
  const connected = () => { const d = window.hpDialer; return d && d.ready ? !!d.connected : true; };
  function pauseForCall() {
    if (pausedByCall || !st.autoPause || !playing) return;
    if (mode === "sdk" && player) player.pause(); else if (ctrl) ctrl.pause(); else return;
    pausedByCall = true; notify("Music paused for your call");
  }
  function resumeAfterCall() {
    if (!pausedByCall) return; pausedByCall = false;
    if (!st.autoResume) return;
    if (mode === "sdk" && player) player.resume(); else if (ctrl) ctrl.resume(); else return;
    notify("Music back on");
  }
  function watch() {
    if (!callLive) return;
    if (connected()) { clearTimeout(resumeT); resumeT = 0; pauseForCall(); }
    else if (pausedByCall && !resumeT) resumeT = setTimeout(() => { resumeT = 0; if (callLive && !connected()) resumeAfterCall(); }, 2500);
    watchT = setTimeout(watch, 350);
  }
  window.addEventListener("hp:callstart", () => { callLive = true; clearTimeout(resumeT); resumeT = 0; clearTimeout(watchT); watch(); });
  window.addEventListener("hp:callend", () => {
    // a ring ending or a call wrapping up: resume only once nothing is connected
    clearTimeout(resumeT);
    resumeT = setTimeout(() => {
      resumeT = 0;
      if (connected()) return;
      resumeAfterCall();
      if (!window.hpDialer?.session) { callLive = false; clearTimeout(watchT); }
    }, 1200);
  });

  /* ---------- top bar button ---------- */
  let topBtn = null;
  function addTopButton() {
    const row = document.querySelector("header.topbar .row");
    if (!row || row.querySelector(".sp-btn")) return !!row;
    topBtn = document.createElement("button");
    topBtn.className = "btn sp-btn"; topBtn.type = "button"; topBtn.title = "Spotify";
    topBtn.innerHTML = `${LOGO.replace('class="logo"', 'style="color:#1DB954"')}<span>Music</span><i class="sp-dot"></i>`;
    topBtn.onclick = () => setOpen(dock.hidden);
    row.insertBefore(topBtn, row.firstChild);
    return true;
  }

  /* ---------- start: after sign-in, for this login ---------- */
  let started = false;
  function start() {
    if (started) return; started = true;
    if (mode === "sdk") loadSdk();
    render();
  }
  async function boot() {
    for (let i = 0; i < 600 && !window.hpUser; i++) await sleep(100);
    const u = window.hpUser; if (!u) return;
    if (window.hpTeam?.can?.("music") === false) { window.hpSpotify = { locked: true, playing: false, ready: false, isOpen: false, autoPause: false, open() {}, close() {}, toggleOpen() { window.hpTeam.upgrade("music"); }, togglePlay() { window.hpTeam.upgrade("music"); }, pause() {}, play() {} }; changed(); return; }
    uid = u.id;
    Object.assign(st, loadLocal());
    try { srv = await api("status"); Object.assign(st, { uri: srv.prefs?.uri || st.uri, autoPause: srv.prefs?.autoPause ?? st.autoPause, autoResume: srv.prefs?.autoResume ?? st.autoResume }); }
    catch (e) { if (e.status === 402) { window.hpSpotify = { locked: true, playing: false, ready: false, isOpen: false, open() {}, close() {}, toggleOpen() {}, togglePlay() {}, pause() {}, play() {} }; changed(); return; } }
    mode = srv.configured && srv.connected && srv.product !== "free" ? "sdk" : "embed";
    // back from Spotify's login
    const q = new URLSearchParams(location.search), back = q.get("spotify");
    if (back) {
      q.delete("spotify"); history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash);
      const say = { connected: "Spotify is connected to your login", canceled: "Spotify wasn't connected", notallowed: "Spotify hasn't approved your account for this app yet. Ask your Highpoint admin to add your Spotify email to the Spotify app (Spotify allows a few people per app until it's approved for more).", error: "Spotify didn't connect. Try again.", off: "Spotify isn't set up for the team yet. Ask your Highpoint admin.", signin: "Sign in to the desk first, then connect Spotify." }[back];
      if (say) notify(say, back === "notallowed" ? 9000 : 3500);
      if (back === "connected" || back === "notallowed") st.open = true;
      if (back === "notallowed") msg = { text: "Spotify hasn't approved your account for this app yet. Ask your Highpoint admin to add the email you use for Spotify in the Spotify Developer Dashboard (User Management).", warn: true };
    }
    if (srv.lost) msg = { text: "Spotify signed you out. Connect again to keep listening.", warn: true };
    document.body.append(dock, note);
    placeDock();
    if (!addTopButton()) { const mo = new MutationObserver(() => { if (addTopButton()) mo.disconnect(); }); mo.observe(document.body, { childList: true, subtree: true }); }
    window.hpSpotify = {
      open: () => setOpen(true), close: () => setOpen(false), toggleOpen: () => setOpen(dock.hidden),
      pause: () => (mode === "sdk" ? player?.pause() : ctrl?.pause()), play: () => (mode === "sdk" ? player?.resume() : ctrl?.resume()),
      togglePlay,
      get playing() { return playing; }, get ready() { return mode === "sdk" ? sdkReady : !!ctrl; }, get isOpen() { return !dock.hidden; },
      get autoPause() { return st.autoPause; }, set autoPause(v) { st.autoPause = !!v; savePrefs(); const c = $("[data-ap]"); if (c) c.checked = !!v; },
      get uri() { return st.uri; }, get connected() { return !!srv.connected; }, get configured() { return !!srv.configured; }, get premium() { return mode === "sdk"; },
      get track() { const t = lastState?.track_window?.current_track; if (!t) return null; const im = t.album?.images || []; return { name: t.name || "", artist: (t.artists || []).map((a) => a.name).join(", "), art: (im[im.length > 1 ? 1 : 0] || im[0])?.url || "" }; },
      next: () => player?.nextTrack(), prev: () => player?.previousTrack(),
      get volume() { return st.volume; }, set volume(v) { setVolume(v); }, toggleMute: () => setVolume(st.volume <= 0.001 ? st.lastVol || 0.7 : 0),
      volHTML, wireVol, connect: () => { location.href = "/api/spotify/login"; },
    };
    dock.hidden = !st.open;
    if (st.open) start();
    else if (mode === "sdk") loadSdk(); // Premium: get the player ready so play works from the Music card right away
    changed();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
