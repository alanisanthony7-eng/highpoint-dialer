/* Manager live board (who is on a call, listen to the live text, whisper a message) and the team leaderboard.
   Everyone: messages from a manager pop up here.  window.hpMon.openLive() (admins), window.hpMon.openBoard() (everyone). */
(() => {
  if (window.hpMon) return;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch {} } };
  async function api(path, body) {
    const r = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Request failed (${r.status})`), { status: r.status });
    return j;
  }
  const clock = (sec) => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`; };
  const hrs = (sec) => { const m = Math.round((sec || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
  const fmtPhone = (p) => (p && p.length === 10 ? `(${p.slice(0, 3)}) ${p.slice(3, 6)}-${p.slice(6)}` : p || "");

  const css = `
  .hpm-top{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:2px 0 12px}
  .hpm-sum{font-size:14px;color:var(--muted,#8c97ab)}.hpm-sum b{color:var(--ink,#eef2f8)}
  .hpm-list{display:grid;gap:10px}
  .hpm-ag{border:1px solid var(--line-2,#28354c);border-radius:14px;background:var(--sunk,#080d17);padding:13px 14px}
  .hpm-ag.talking{border-color:color-mix(in srgb,var(--ok,#33c08d) 65%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--ok,#33c08d) 25%,transparent) inset}
  .hpm-ag.off{opacity:.55}
  .hpm-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
  .hpm-dot{width:10px;height:10px;border-radius:50%;background:var(--muted,#8c97ab);flex:none}.talking .hpm-dot{background:var(--ok,#33c08d);box-shadow:0 0 0 4px color-mix(in srgb,var(--ok,#33c08d) 28%,transparent);animation:hpmP 1.6s infinite}.dialing .hpm-dot{background:var(--warn,#e0a53a)}
  @keyframes hpmP{50%{box-shadow:0 0 0 7px transparent}}
  .hpm-nm{font-weight:700;font-size:15px;color:var(--ink,#eef2f8)}.hpm-now{font-size:13.5px;color:var(--muted,#8c97ab);flex:1;min-width:150px}.hpm-now b{color:var(--ink,#eef2f8)}
  .hpm-stats{display:flex;gap:14px;font-size:12px;color:var(--muted,#8c97ab)}.hpm-stats b{display:block;font-size:15px;color:var(--ink,#eef2f8)}
  .hpm-acts{display:flex;gap:6px;flex-wrap:wrap}
  .hpm-pane{margin-top:11px;padding-top:11px;border-top:1px solid var(--line,#1c2638)}
  .hpm-tx{max-height:190px;overflow:auto;display:grid;gap:6px;font-size:13.5px;line-height:1.4;padding:2px 2px 8px}
  .hpm-tx div{padding:6px 10px;border-radius:10px;background:var(--surface,#0c121e);max-width:88%;color:var(--ink,#eef2f8)}.hpm-tx .Agent{justify-self:end;background:color-mix(in srgb,var(--accent,#3a5f9f) 30%,var(--surface,#0c121e))}
  .hpm-tx small{display:block;font-size:11px;color:var(--muted,#8c97ab);margin-bottom:1px}
  .hpm-wh{display:flex;gap:8px;margin-top:8px}.hpm-wh input{flex:1;min-width:0}
  .hpm-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.hpm-chips button{all:unset;cursor:pointer;font-size:12.5px;padding:5px 10px;border-radius:99px;border:1px solid var(--line-2,#28354c);color:var(--ink,#eef2f8)}.hpm-chips button:hover{background:var(--line,#1c2638)}
  .hpm-ok{font-size:13px;color:var(--ok,#33c08d);margin-top:6px}
  .hpm-empty{padding:30px 10px;text-align:center;color:var(--muted,#8c97ab);font-size:14px}
  .hpm-tbl{width:100%;border-collapse:collapse;font-size:14px;color:var(--ink,#eef2f8)}.hpm-tbl th{font:700 11px var(--f-ui,system-ui);letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#8c97ab);text-align:right;padding:6px 8px;border-bottom:1px solid var(--line-2,#28354c)}.hpm-tbl th:nth-child(-n+2){text-align:left}
  .hpm-tbl td{padding:11px 8px;border-bottom:1px solid var(--line,#1c2638);text-align:right;font-variant-numeric:tabular-nums}.hpm-tbl td:nth-child(-n+2){text-align:left}.hpm-tbl tr.you td{background:color-mix(in srgb,var(--accent,#3a5f9f) 16%,transparent)}.hpm-tbl tfoot td{font-weight:700;color:var(--muted,#8c97ab);border:0}
  .hpm-rk{width:38px;font-weight:800;color:var(--muted,#8c97ab)}.r1 .hpm-rk{color:#f2c94c}.r2 .hpm-rk{color:#c9d1dc}.r3 .hpm-rk{color:#d08a55}
  .hpm-sc{overflow-x:auto}
  .hpm-bar{position:fixed;z-index:3000;left:50%;top:max(12px,env(safe-area-inset-top));transform:translateX(-50%);width:min(520px,calc(100% - 20px));display:grid;gap:8px}
  .hpm-msg{display:flex;gap:12px;align-items:flex-start;padding:14px 15px;border-radius:14px;color:#fff;font:15px/1.4 var(--f-ui,system-ui,sans-serif);background:linear-gradient(135deg,#6a2cff,#d6309a);box-shadow:0 18px 50px rgba(0,0,0,.5);animation:hpmIn .25s ease-out}
  .hpm-msg span{flex:1}.hpm-msg small{display:block;opacity:.8;font-size:12px;margin-bottom:2px;letter-spacing:.04em;text-transform:uppercase}.hpm-msg b{font-size:17px;line-height:1.35}
  .hpm-msg button{all:unset;cursor:pointer;font-weight:700;font-size:13px;padding:7px 12px;border-radius:9px;background:rgba(255,255,255,.2)}.hpm-msg button:hover{background:rgba(255,255,255,.32)}
  @keyframes hpmIn{from{transform:translateY(-14px);opacity:0}}
  @media(max-width:560px){.hpm-stats{width:100%}.hpm-tbl{font-size:13px}.hpm-tbl td,.hpm-tbl th{padding-left:5px;padding-right:5px}}`;
  if (!$("#hpmCss")) { const st = document.createElement("style"); st.id = "hpmCss"; st.textContent = css; document.head.append(st); }

  function modal(html, { wide = false, onClose } = {}) {
    const ov = document.createElement("div"); ov.className = "hpt-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true");
    ov.innerHTML = `<div class="hpt-card${wide ? " wide" : ""}"><button class="hpt-x" type="button" aria-label="Close">✕</button>${html}</div>`;
    document.body.append(ov);
    let gone = false; const onEsc = (e) => { if (e.key === "Escape") done(); };
    const done = () => { if (gone) return; gone = true; document.removeEventListener("keydown", onEsc); ov.remove(); onClose?.(); };
    document.addEventListener("keydown", onEsc);
    $(".hpt-x", ov).onclick = done; ov.addEventListener("click", (e) => { if (e.target === ov) done(); }); ov.addEventListener("keydown", (e) => { if (e.key === "Escape") done(); });
    return { el: ov, close: done };
  }

  /* ---------- messages from a manager ---------- */
  let bar = null, after = +ss.get("hp.wh.after") || Date.now() - 90_000, seen = new Set();
  function show(w) {
    if (seen.has(w.id)) return; seen.add(w.id);
    if (!bar) { bar = document.createElement("div"); bar.className = "hpm-bar"; bar.setAttribute("aria-live", "assertive"); document.body.append(bar); }
    const el = document.createElement("div"); el.className = "hpm-msg"; el.setAttribute("role", "alert");
    el.innerHTML = `<span><small>${esc(w.from)} · message</small><b>${esc(w.text)}</b></span><button type="button">Got it</button>`;
    $("button", el).onclick = () => { el.remove(); if (!bar.children.length) { bar.remove(); bar = null; } };
    bar.append(el); while (bar.children.length > 3) bar.firstChild.remove();
    try { navigator.vibrate?.([120, 60, 120]); } catch {}
    setTimeout(() => { if (el.isConnected) el.querySelector("button").click(); }, 90_000);
  }
  async function pollWhispers() {
    if (document.hidden || !window.hpUser) return;
    try { const r = await api(`/api/monitor/whispers?after=${after}`); for (const w of r.whispers || []) { show(w); after = Math.max(after, w.ts); } ss.set("hp.wh.after", String(after)); } catch {}
  }
  setInterval(pollWhispers, 7000); document.addEventListener("visibilitychange", () => { if (!document.hidden) pollWhispers(); });
  setTimeout(pollWhispers, 1500);

  /* ---------- live board (admins) ---------- */
  const QUICK = ["Ask for the appointment now", "Slow down and listen", "Go back to why they called", "Offer the graded benefit", "Great call, keep going"];
  async function openLive() {
    if (!window.hpUser?.admin) return;
    let timer = null, skew = 0, data = null, peek = null, peekTimer = null, typing = "";
    const m = modal(`<h2>Live board</h2><div class="hpm-top"><span class="hpm-sum" id="hpmSum">Loading…</span></div><div class="hpm-list" id="hpmList"></div>
      <p class="hpt-muted" style="margin-top:12px;font-size:12.5px">Updates every few seconds. "Listen" shows the live transcript as text. "Whisper" sends a message that pops up on the agent's screen (and phone) without the client hearing it.</p>`, { wide: true, onClose: () => { clearInterval(timer); clearInterval(tick); clearInterval(peekTimer); } });
    const list = $("#hpmList", m.el), sum = $("#hpmSum", m.el);
    const nowS = () => Date.now() + skew;
    function rowHtml(a) {
      const c = a.call, cls = !a.online ? "off" : a.state;
      let now = a.online ? `<span class="hpm-now">Not on a call</span>` : `<span class="hpm-now">Offline</span>`;
      if (a.state === "talking") now = `<span class="hpm-now">On a call with <b>${esc(c.leadName || fmtPhone(c.to) || "a client")}</b> · <b data-clk="${c.answeredAt || c.at}">${clock((nowS() - (c.answeredAt || c.at)) / 1000)}</b>${c.dir === "in" ? " · inbound" : ""}</span>`;
      else if (a.state === "dialing") now = `<span class="hpm-now">Dialing${a.lines > 1 ? ` ${a.lines} lines` : c?.leadName ? ` <b>${esc(c.leadName)}</b>` : ""}…</span>`;
      const acts = a.me ? "" : `<span class="hpm-acts">${a.state === "talking" && c?.sid ? `<button class="hpt-btn sm" type="button" data-listen="${esc(a.identity)}">Listen</button>` : ""}${a.id && a.online ? `<button class="hpt-btn sm go" type="button" data-wh="${esc(a.identity)}">Whisper</button>` : ""}</span>`;
      return `<div class="hpm-ag ${cls}" data-ag="${esc(a.identity)}"><div class="hpm-row"><span class="hpm-dot"></span><span class="hpm-nm">${esc(a.name)}${a.me ? " (you)" : ""}</span>${now}
        <span class="hpm-stats"><span><b>${a.today.dials}</b>dials</span><span><b>${a.today.connects}</b>talked</span><span><b>${a.today.appts}</b>appts</span><span><b>${hrs(a.today.talkSec)}</b>talk</span></span>${acts}</div><div class="hpm-pane" hidden></div></div>`;
    }
    function draw() {
      if (!data) return;
      sum.innerHTML = `<b>${data.agents.filter((a) => a.online).length}</b> online · <b>${data.onCalls}</b> on a call right now`;
      if (!data.agents.length) { list.innerHTML = `<div class="hpm-empty">Nobody is signed in right now.</div>`; return; }
      // keep open panes (and what's being typed) while the rows refresh
      const keep = {}; list.querySelectorAll(".hpm-ag").forEach((e) => { const p = $(".hpm-pane", e); if (!p.hidden) keep[e.dataset.ag] = p; });
      list.innerHTML = data.agents.map(rowHtml).join("");
      for (const [id, pane] of Object.entries(keep)) { const row = list.querySelector(`[data-ag="${CSS.escape(id)}"]`); if (row) { row.querySelector(".hpm-pane").replaceWith(pane); } }
      bind();
    }
    function bind() {
      list.querySelectorAll("[data-wh]").forEach((b) => { b.onclick = () => togglePane(b.dataset.wh, "wh"); });
      list.querySelectorAll("[data-listen]").forEach((b) => { b.onclick = () => togglePane(b.dataset.listen, "listen"); });
    }
    function togglePane(identity, kind) {
      const row = list.querySelector(`[data-ag="${CSS.escape(identity)}"]`), pane = $(".hpm-pane", row), a = data.agents.find((x) => x.identity === identity);
      if (!pane.hidden && pane.dataset.kind === kind) { pane.hidden = true; pane.innerHTML = ""; if (kind === "listen") { clearInterval(peekTimer); peek = null; } return; }
      pane.hidden = false; pane.dataset.kind = kind;
      if (kind === "wh") {
        pane.innerHTML = `<div class="hpm-wh"><input class="hpt-in" maxlength="280" placeholder="Message for ${esc(a.name.split(" ")[0])}…" aria-label="Message"><button class="hpt-btn go" type="button">Send</button></div><div class="hpm-chips">${QUICK.map((q) => `<button type="button">${esc(q)}</button>`).join("")}</div><div class="hpm-ok" hidden></div>`;
        const inp = $("input", pane), ok = $(".hpm-ok", pane);
        const send = async (text) => { text = String(text || "").trim(); if (!text) return; try { await api("/api/monitor/whisper", { agent: a.id, text, sid: a.call?.sid }); inp.value = ""; ok.hidden = false; ok.textContent = `Sent to ${a.name.split(" ")[0]}.`; setTimeout(() => (ok.hidden = true), 4000); } catch (e) { ok.hidden = false; ok.style.color = "var(--bad,#e5484d)"; ok.textContent = e.message; } };
        $("button.go", pane).onclick = () => send(inp.value); inp.onkeydown = (e) => { if (e.key === "Enter") send(inp.value); };
        pane.querySelectorAll(".hpm-chips button").forEach((b) => { b.onclick = () => send(b.textContent); });
        inp.focus();
      } else {
        pane.innerHTML = `<div class="hpm-tx" id="hpmTx"><div>Loading the live transcript…</div></div>`;
        peek = a.call?.sid; clearInterval(peekTimer);
        const pull = async () => {
          if (!peek) return;
          try {
            const r = await api(`/api/dialer/calls/live?sid=${encodeURIComponent(peek)}`), box = $("#hpmTx", pane); if (!box) return;
            const lines = [...(r.transcript || []), ...(r.partial || [])].slice(-30);
            const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
            box.innerHTML = lines.length ? lines.map((l) => `<div class="${esc(l.speaker || "")}"><small>${esc(l.speaker || "Caller")}</small>${esc(l.text)}</div>`).join("") : `<div>Nothing said yet. The transcript fills in as they talk.</div>`;
            if (stick) box.scrollTop = box.scrollHeight;
          } catch (e) { const box = $("#hpmTx", pane); if (box) box.innerHTML = `<div>${esc(e.message)}</div>`; }
        };
        pull(); peekTimer = setInterval(pull, 3000);
      }
    }
    async function load() { try { const r = await api("/api/monitor/live"); skew = r.now - Date.now(); data = r; draw(); } catch (e) { sum.textContent = e.message; } }
    const tick = setInterval(() => list.querySelectorAll("[data-clk]").forEach((e) => { e.textContent = clock((nowS() - +e.dataset.clk) / 1000); }), 1000);
    load(); timer = setInterval(load, 4000);
  }

  /* ---------- leaderboard ---------- */
  async function openBoard() {
    let range = "today", admin = !!window.hpUser?.admin;
    const m = modal(`<h2>Leaderboard</h2><div class="hpt-tabs" role="tablist" style="margin:8px 0 12px"><button type="button" data-r="today">Today</button><button type="button" data-r="week">Last 7 days</button><button type="button" data-r="month">This month</button></div><div id="hpmB"><div class="hpm-empty">Loading…</div></div>`, { wide: true });
    const box = $("#hpmB", m.el);
    async function draw() {
      m.el.querySelectorAll("[data-r]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.r === range)));
      let r; try { r = await api("/api/monitor/board?range=" + range); } catch (e) { box.innerHTML = `<div class="hpm-empty">${esc(e.message)}</div>`; return; }
      if (!r.rows.length) { box.innerHTML = `<div class="hpm-empty">No activity yet for ${esc(r.label.toLowerCase())}. Numbers show up as calls are made.</div>`; }
      else box.innerHTML = `<div class="hpm-sc"><table class="hpm-tbl"><thead><tr><th></th><th>Agent</th><th>Sales</th><th>Appts</th><th>Talked to</th><th>Dials</th><th>Talk time</th></tr></thead><tbody>
        ${r.rows.map((x) => `<tr class="${x.you ? "you" : ""} r${x.rank}"><td class="hpm-rk">${x.rank}</td><td>${esc(x.name)}${x.you ? " (you)" : ""}</td><td><b>${x.sales}</b></td><td>${x.appts}</td><td>${x.connects}</td><td>${x.dials}</td><td>${hrs(x.talkSec)}</td></tr>`).join("")}
        </tbody><tfoot><tr><td></td><td>Team</td><td>${r.total.sales}</td><td>${r.total.appts}</td><td>${r.total.connects}</td><td>${r.total.dials}</td><td>${hrs(r.total.talkSec)}</td></tr></tfoot></table></div>
        <p class="hpt-muted" style="margin-top:10px;font-size:12.5px">Sales count clients moved to Sold in that period. Dials, talk time and appointments come from the dialer, in Eastern time.</p>`;
      if (admin) box.insertAdjacentHTML("beforeend", `<label class="hpt-chk" style="margin-top:12px"><input type="checkbox" id="hpmSee" ${r.agentsSee ? "checked" : ""}><span><b>Agents can see this leaderboard.</b> Turn it off and only admins see it.</span></label>`);
      $("#hpmSee", box)?.addEventListener("change", async (e) => { try { await api("/api/monitor/settings", { agentsSeeBoard: e.target.checked }); } catch { e.target.checked = !e.target.checked; } });
    }
    m.el.querySelectorAll("[data-r]").forEach((b) => { b.onclick = () => { range = b.dataset.r; draw(); }; });
    draw();
  }

  window.hpMon = { openLive, openBoard };
})();
