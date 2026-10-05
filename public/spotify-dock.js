/* Highpoint · Spotify dock
   A floating Spotify player for the agent desk. Paste any Spotify playlist, album,
   track, artist, show or episode link. Music pauses automatically when you start a
   call in the dialer and (optionally) resumes when the call ends. */
(() => {
  if (window.__hpSpotify) return; window.__hpSpotify = true;

  const KEY = "hp.spotify";
  const DEFAULT_URI = "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"; // a Spotify-curated hits playlist
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const save = s => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} };
  const st = Object.assign({ uri: DEFAULT_URI, open: false, autoPause: true, autoResume: true, x: null, y: null }, load());

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
    background:rgba(10,10,14,.92);border:1px solid rgba(255,255,255,.12);border-radius:18px;
    box-shadow:0 30px 70px -20px rgba(0,0,0,.9);-webkit-backdrop-filter:blur(22px);backdrop-filter:blur(22px);
    color:#F2F4F8;font:13px/1.4 var(--f-ui,system-ui,-apple-system,"Segoe UI",sans-serif);overflow:hidden;
    transform-origin:bottom right;transition:transform .35s cubic-bezier(.2,.8,.2,1),opacity .25s}
  #spDock[hidden]{display:block!important;transform:scale(.6) translateY(20px);opacity:0;pointer-events:none}
  #spDock .sp-head{display:flex;align-items:center;gap:8px;padding:10px 10px 10px 14px;cursor:grab;user-select:none}
  #spDock .sp-head:active{cursor:grabbing}
  #spDock .sp-head b{flex:1;font-size:13px;letter-spacing:.02em}
  #spDock .sp-head svg.logo{width:18px;height:18px;color:#1DB954}
  #spDock .sp-x{all:unset;cursor:pointer;width:28px;height:28px;display:grid;place-items:center;border-radius:8px;color:#A3A9B6}
  #spDock .sp-x:hover{background:rgba(255,255,255,.08);color:#fff}
  #spDock .sp-body{padding:0 12px 12px;display:flex;flex-direction:column;gap:10px}
  #spDock .sp-frame{border-radius:12px;overflow:hidden;background:#121212;min-height:152px}
  #spDock .sp-frame iframe{display:block;border:0;width:100%}
  #spDock .sp-row{display:flex;gap:8px}
  #spDock input[type=text]{flex:1;min-width:0;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:10px;
    color:#F2F4F8;padding:8px 10px;font:inherit}
  #spDock input[type=text]:focus{outline:none;border-color:#1DB954;box-shadow:0 0 0 3px rgba(29,185,84,.18)}
  #spDock .sp-go{all:unset;cursor:pointer;padding:8px 12px;border-radius:10px;background:#1DB954;color:#05120A;font-weight:700}
  #spDock .sp-go:hover{filter:brightness(1.08)}
  #spDock .sp-opts{display:flex;flex-wrap:wrap;gap:6px 14px;color:#A3A9B6;font-size:12px}
  #spDock .sp-opts label{display:inline-flex;align-items:center;gap:6px;cursor:pointer}
  #spDock .sp-opts label{display:inline-flex!important;flex-direction:row!important;width:auto!important;margin:0}
  #spDock .sp-opts input{accent-color:#1DB954;width:auto!important;height:auto!important;flex:none!important;margin:0;padding:0;box-shadow:none!important}
  #spDock .sp-fine{color:#6B7180;font-size:11px;margin:0}
  #spDock .sp-fine a{color:#A3A9B6}
  #spNote{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:70;background:#0E0E14;color:#F2F4F8;
    border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:8px 14px;font:13px var(--f-ui,system-ui,sans-serif);
    box-shadow:0 12px 30px -10px rgba(0,0,0,.9);display:flex;align-items:center;gap:8px;transition:opacity .3s}
  #spNote[hidden]{display:flex!important;opacity:0;pointer-events:none}
  #spNote i{width:8px;height:8px;border-radius:50%;background:#1DB954}
  html.gated #spDock,html.gated #spNote{display:none!important}
  @media (max-width:640px){#spDock{right:12px;left:12px;width:auto;bottom:86px}}`;
  const styleEl = document.createElement("style"); styleEl.textContent = css; document.head.appendChild(styleEl);

  const LOGO = `<svg class="logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.6 14.4a.62.62 0 0 1-.86.2c-2.35-1.44-5.3-1.76-8.79-.96a.62.62 0 1 1-.28-1.21c3.81-.87 7.08-.5 9.72 1.11.3.18.39.56.21.86Zm1.22-2.72a.78.78 0 0 1-1.07.26c-2.69-1.65-6.79-2.13-9.97-1.17a.78.78 0 1 1-.45-1.49c3.63-1.1 8.15-.57 11.23 1.33.37.22.48.7.26 1.07Zm.1-2.83C14.7 8.94 9.36 8.76 6.28 9.7a.94.94 0 1 1-.55-1.8c3.54-1.07 9.43-.87 13.15 1.34a.94.94 0 0 1-.96 1.61Z"/></svg>`;

  /* ---------- dock ---------- */
  const dock = document.createElement("section");
  dock.id = "spDock"; dock.setAttribute("aria-label", "Spotify player"); dock.hidden = !st.open;
  dock.innerHTML = `
    <div class="sp-head">${LOGO}<b>Spotify</b>
      <button class="sp-x" data-min aria-label="Hide player" title="Hide (music keeps playing)"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 12h12"/></svg></button>
    </div>
    <div class="sp-body">
      <div class="sp-frame"><div id="spEmbed"></div></div>
      <form class="sp-row" data-form autocomplete="off">
        <input type="text" id="spLink" placeholder="Paste a Spotify playlist, album or song link" aria-label="Spotify link">
        <button class="sp-go" type="submit">Play</button>
      </form>
      <div class="sp-opts">
        <label><input type="checkbox" id="spAutoPause"> Pause when a call starts</label>
        <label><input type="checkbox" id="spAutoResume"> Resume after the call</label>
      </div>
      <p class="sp-fine">Log in to Spotify in this browser for full songs (otherwise Spotify plays 30-second previews). In Spotify: Share → Copy link, then paste it above.</p>
    </div>`;
  document.body.appendChild(dock);
  const note = document.createElement("div"); note.id = "spNote"; note.hidden = true; note.setAttribute("role", "status");
  document.body.appendChild(note);
  let noteT = 0;
  const notify = t => { note.innerHTML = `<i></i>${t}`; note.hidden = false; clearTimeout(noteT); noteT = setTimeout(() => note.hidden = true, 2600); };

  const $ = s => dock.querySelector(s);
  $("#spAutoPause").checked = st.autoPause; $("#spAutoResume").checked = st.autoResume;
  $("#spAutoPause").onchange = e => { st.autoPause = e.target.checked; save(st); };
  $("#spAutoResume").onchange = e => { st.autoResume = e.target.checked; save(st); };
  $("[data-min]").onclick = () => setOpen(false);

  /* drag the dock by its header */
  (() => {
    const head = $(".sp-head"); let sx, sy, ox, oy, dragging = false;
    const place = () => { if (st.x == null) return; dock.style.left = st.x + "px"; dock.style.top = st.y + "px"; dock.style.right = "auto"; dock.style.bottom = "auto"; };
    place();
    head.addEventListener("pointerdown", e => { if (e.target.closest("button") || innerWidth < 640) return; dragging = true; const r = dock.getBoundingClientRect(); sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top; head.setPointerCapture(e.pointerId); });
    head.addEventListener("pointermove", e => { if (!dragging) return; st.x = Math.max(6, Math.min(innerWidth - dock.offsetWidth - 6, ox + e.clientX - sx)); st.y = Math.max(6, Math.min(innerHeight - 60, oy + e.clientY - sy)); place(); });
    head.addEventListener("pointerup", () => { if (dragging) { dragging = false; save(st); } });
  })();

  /* ---------- Spotify iFrame API ---------- */
  let ctrl = null, playing = false, pausedByCall = false, apiReady = false, pendingUri = st.uri;
  window.onSpotifyIframeApiReady = IFrameAPI => {
    apiReady = true;
    IFrameAPI.createController($("#spEmbed"), { uri: pendingUri, width: "100%", height: 152 }, c => {
      ctrl = c;
      c.addListener("playback_update", e => { const was = playing; playing = !e.data.isPaused; topBtn && topBtn.classList.toggle("playing", playing); if (was !== playing) window.dispatchEvent(new Event("hp:musicstate")); });
      c.addListener("ready", () => window.dispatchEvent(new Event("hp:musicstate")));
    });
  };
  function loadApi() {
    if (document.getElementById("spApi")) return;
    const s = document.createElement("script"); s.id = "spApi"; s.async = true;
    s.src = "https://open.spotify.com/embed/iframe-api/v1";
    s.onerror = () => { $(".sp-frame").innerHTML = `<p class="sp-fine" style="padding:14px">Couldn't reach Spotify. Check your connection and reload.</p>`; };
    document.head.appendChild(s);
  }
  function setOpen(v) { st.open = v; save(st); dock.hidden = !v; if (v) loadApi(); window.dispatchEvent(new Event("hp:musicstate")); }

  $("[data-form]").onsubmit = e => {
    e.preventDefault();
    const uri = toUri($("#spLink").value);
    if (!uri) { notify("That doesn't look like a Spotify link"); return; }
    st.uri = uri; save(st); $("#spLink").value = "";
    if (ctrl) { ctrl.loadUri(uri); setTimeout(() => ctrl.play(), 600); } else { pendingUri = uri; loadApi(); }
  };

  /* ---------- auto pause on calls ---------- */
  window.addEventListener("hp:callstart", () => {
    if (!st.autoPause || !ctrl || !playing) return;
    ctrl.pause(); pausedByCall = true; notify("Music paused for your call");
  });
  window.addEventListener("hp:callend", () => {
    if (!pausedByCall) return; pausedByCall = false;
    if (st.autoResume && ctrl) { ctrl.resume(); notify("Music back on"); }
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
  if (!addTopButton()) { const mo = new MutationObserver(() => { if (addTopButton()) mo.disconnect(); }); mo.observe(document.body, { childList: true, subtree: true }); }
  if (st.open) loadApi();
  window.hpSpotify = {
    open: () => setOpen(true), close: () => setOpen(false), toggleOpen: () => setOpen(dock.hidden),
    pause: () => ctrl && ctrl.pause(), play: () => ctrl && ctrl.resume(),
    togglePlay: () => { if (ctrl) ctrl.togglePlay(); else { setOpen(true); } },
    get playing() { return playing; }, get ready() { return !!ctrl; }, get isOpen() { return !dock.hidden; },
    get autoPause() { return st.autoPause; }, set autoPause(v) { st.autoPause = !!v; save(st); const c = document.getElementById("spAutoPause"); if (c) c.checked = !!v; },
    get uri() { return st.uri; },
  };
  window.dispatchEvent(new Event("hp:musicstate"));
})();
