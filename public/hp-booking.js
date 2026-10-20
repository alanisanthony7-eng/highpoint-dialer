/* Calendar page: the agent's public booking link (weekly hours, call length, notice) and Google Calendar:
   a feed of desk appointments to subscribe to, and busy times read from Google's secret iCal address. */
(() => {
  "use strict";
  if (window.hpBooking?.reload) return;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (m) => window.hpDesk?.toast?.(m);
  async function call(path, body) {
    const r = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Request failed (${r.status})`), { status: r.status });
    return j;
  }
  const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const ZONES = [["America/New_York", "Eastern"], ["America/Chicago", "Central"], ["America/Denver", "Mountain"], ["America/Phoenix", "Arizona"], ["America/Los_Angeles", "Pacific"], ["America/Anchorage", "Alaska"], ["Pacific/Honolulu", "Hawaii"]];
  const opt = (list, v) => list.map(([k, n]) => `<option value="${esc(k)}" ${String(v) === String(k) ? "selected" : ""}>${esc(n)}</option>`).join("");
  const ago = (t) => { const s = (Date.now() - t) / 1000; return s < 90 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : Math.round(s / 3600) + " h ago"; };

  const css = `
  .hpbk{gap:16px;margin-top:16px}
  .hpbk-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap}
  .hpbk-top p{margin:4px 0 0;max-width:70ch}
  .hpbk-sw{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:13.5px;cursor:pointer}
  .hpbk-sw input{width:auto}
  .hpbk-line{display:flex;gap:8px;align-items:center;min-width:0;flex-wrap:wrap}
  .hpbk-line code{flex:1 1 200px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;padding:8px 10px;border-radius:8px;border:1px solid var(--line);background:var(--sunk,rgba(0,0,0,.25));color:var(--ink)}
  .hpbk-off code{opacity:.55}
  .hpbk-cols{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:16px}
  .hpbk-box{border:1px solid var(--line-2);border-radius:12px;padding:14px;display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-content:start;min-width:0}
  .hpbk-box h3{margin:0}
  .hpbk-hours{display:grid;gap:6px}
  .hpbk-hours div{display:grid;grid-template-columns:118px 1fr 18px 1fr;gap:8px;align-items:center;font-size:13.5px}
  .hpbk-hours label{display:inline-flex;gap:7px;align-items:center}
  .hpbk-hours input[type=checkbox]{width:auto}
  .hpbk-hours input[type=time]{min-height:34px;padding:4px 8px}
  .hpbk-hours .off input[type=time]{opacity:.35}
  .hpbk-next{font-size:13px}
  .hpbk-next b{font-weight:600}
  .hpbk ol{margin:0;padding-left:20px;font-size:13px;color:var(--muted);display:grid;gap:3px}
  .hpbk ol b{color:var(--ink)}
  .hpbk-st{font-size:12.5px}
  .hpbk-st.bad{color:var(--bad)}
  .hpbk-cols>*{min-width:0}
  @media (max-width:900px){.hpbk-cols{grid-template-columns:minmax(0,1fr)}}
  @media (max-width:480px){.hpbk-hours div{grid-template-columns:1fr 1fr;row-gap:4px}.hpbk-hours div label{grid-column:1/-1}.hpbk-hours div span{display:none}}
  `;
  const st = document.createElement("style"); st.textContent = css; document.head.append(st);

  let D = null, preview = null;
  async function load() {
    try { D = await call("/api/book/settings"); D.error = ""; } catch (e) { D = { error: e.message }; }
    try { preview = D.settings?.on ? (await call("/api/book/preview")).days : null; } catch { preview = null; }
  }
  function nextTimes() {
    if (!preview) return "";
    const all = preview.flatMap((d) => d.slots).slice(0, 6);
    const f = (t) => new Date(t).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
    return all.length ? `<span class="hpbk-next muted">Next open times: <b>${all.map(f).map(esc).join(" · ")}</b></span>` : `<span class="hpbk-next" style="color:var(--warn)">No open times in the window you set. Add hours or look ahead further.</span>`;
  }
  function render() {
    const host = $("#bkHost"); if (!host || !D) return;
    if (D.error) { host.innerHTML = `<div class="panel hpbk"><h2>Booking link</h2><p class="muted">${esc(D.error)}</p></div>`; return; }
    const s = D.settings, tzs = [...new Map([[s.tz, s.tz.split("/").pop().replace(/_/g, " ")], ...ZONES]).entries()];
    host.innerHTML = `<div class="panel stack hpbk">
      <div class="hpbk-top"><div><h2 style="margin:0">Booking link</h2><p class="muted">Send clients this link (in a text, an email or your voicemail) and they can book a call with you on their own. Open times come from your hours below, minus your desk appointments${s.busyUrl ? " and busy times on your Google Calendar" : ""}.</p></div>
        <label class="hpbk-sw"><input type="checkbox" id="bkOn" ${s.on ? "checked" : ""}> ${s.on ? "Taking bookings" : "Off"}</label></div>
      <div class="hpbk-line ${s.on ? "" : "hpbk-off"}"><code title="${esc(D.link)}">${esc(D.link)}</code><button class="btn sm primary" type="button" id="bkCopy">Copy link</button><a class="btn sm" href="${esc(D.link)}" target="_blank" rel="noopener">Open</a></div>
      ${s.on ? nextTimes() : `<span class="muted hpbk-next">Turn it on to start taking bookings.</span>`}
      <div class="hpbk-cols">
        <div class="hpbk-box">
          <h3>Your hours</h3>
          <div class="grid2">
            <label class="field"><span>Time zone</span><select id="bkTz">${opt(tzs, s.tz)}</select></label>
            <label class="field"><span>Call type</span><select id="bkType">${opt([["Phone call", "Phone call"], ["Zoom", "Zoom"]], s.type)}</select></label>
          </div>
          <div class="hpbk-hours">${DOW.map((n, i) => { const w = s.hours[i]; return `<div class="${w ? "" : "off"}" data-d="${i}"><label><input type="checkbox" ${w ? "checked" : ""}> ${n}</label><input type="time" value="${esc(w?.[0] || "09:00")}" aria-label="${n} start" step="900"><span class="muted">to</span><input type="time" value="${esc(w?.[1] || "17:00")}" aria-label="${n} end" step="900"></div>`; }).join("")}</div>
        </div>
        <div class="hpbk-box">
          <h3>Calls</h3>
          <div class="grid2">
            <label class="field"><span>Call length</span><select id="bkLen">${opt([10, 15, 20, 30, 45, 60].map((x) => [x, x + " minutes"]), s.length)}</select></label>
            <label class="field"><span>Break between calls</span><select id="bkBuf">${opt([0, 5, 10, 15, 30].map((x) => [x, x ? x + " minutes" : "None"]), s.buffer)}</select></label>
            <label class="field"><span>Earliest booking</span><select id="bkNotice">${opt([[0, "Any time"], [1, "1 hour ahead"], [2, "2 hours ahead"], [4, "4 hours ahead"], [12, "12 hours ahead"], [24, "1 day ahead"], [48, "2 days ahead"]], s.notice)}</select></label>
            <label class="field"><span>Show times up to</span><select id="bkAhead">${opt([7, 14, 21, 30, 45].map((x) => [x, x + " days out"]), s.ahead)}</select></label>
            <label class="field"><span>Most bookings a day</span><select id="bkMax">${opt([[0, "No limit"], ...[2, 4, 6, 8, 10, 15].map((x) => [x, String(x)])], s.maxPerDay)}</select></label>
            <label class="field"><span>Link name</span><input id="bkSlug" value="${esc(s.slug)}" maxlength="40"></label>
          </div>
          <label class="field"><span>Headline</span><input id="bkTitle" maxlength="90" placeholder="Talk with ${esc((window.hpUser?.name || "me").split(" ")[0])} about life insurance" value="${esc(s.title)}"></label>
          <label class="field"><span>A line about the call</span><textarea id="bkIntro" rows="2" maxlength="600" placeholder="Pick a time for a short phone call. I'll go over your options and get you a quote. No cost, no obligation.">${esc(s.intro)}</textarea></label>
        </div>
      </div>
      <div class="hpbk-box">
        <h3>Google Calendar</h3>
        <div class="hpbk-cols">
          <div class="stack" style="gap:8px">
            <b style="font-size:13.5px">See your desk appointments in Google Calendar</b>
            ${D.feed ? `<div class="hpbk-line"><code title="${esc(D.feed)}">${esc(D.feed)}</code><button class="btn sm primary" type="button" id="bkFeedCopy">Copy</button><button class="btn sm" type="button" id="bkFeedNew" title="Makes a new link. The old one stops working.">New link</button></div>
              <ol><li>In Google Calendar on a computer, next to <b>Other calendars</b>, click <b>+</b> then <b>From URL</b>.</li><li>Paste the link and click <b>Add calendar</b>.</li><li>Google refreshes it every few hours. Keep the link private: it shows client names and numbers.</li></ol>`
              : `<span class="muted" style="font-size:13px">A private calendar link with your appointments and callbacks. Google Calendar, Apple Calendar and Outlook can all subscribe to it.</span><div><button class="btn sm" type="button" id="bkFeedNew">Make my calendar link</button></div>`}
          </div>
          <div class="stack" style="gap:8px">
            <b style="font-size:13.5px">Block times you're busy in Google Calendar</b>
            <div class="hpbk-line"><input id="bkBusy" placeholder="Secret address in iCal format (https://calendar.google.com/…/basic.ics)" value="${esc(s.busyUrl)}" style="flex:1 1 240px"><button class="btn sm" type="button" id="bkBusyCheck">Check</button></div>
            ${D.busy ? `<span class="hpbk-st ${D.busy.error ? "bad" : "muted"}">${D.busy.error ? esc(D.busy.error) : `Read ${esc(ago(D.busy.at))}: ${D.busy.count} busy time${D.busy.count === 1 ? "" : "s"} blocked.`}</span>` : ""}
            <ol><li>In Google Calendar, open <b>Settings</b>, then your calendar under <b>Settings for my calendars</b>.</li><li>Under <b>Integrate calendar</b>, copy <b>Secret address in iCal format</b> and paste it here.</li><li>Only busy times are used. Event details are never shown to clients.</li></ol>
          </div>
        </div>
      </div>
      <div class="row" style="justify-content:flex-end;gap:10px"><span class="muted" id="bkMsg" style="margin-right:auto"></span><button class="btn primary" type="button" id="bkSave">Save booking settings</button></div>
    </div>`;
    wire(host);
  }
  const copy = async (t, m) => { try { await navigator.clipboard.writeText(t); toast(m); } catch { toast("Couldn't copy. Select the text and copy it."); } };
  function collect() {
    return {
      tz: $("#bkTz").value, type: $("#bkType").value, length: +$("#bkLen").value, buffer: +$("#bkBuf").value, notice: +$("#bkNotice").value, ahead: +$("#bkAhead").value, maxPerDay: +$("#bkMax").value,
      slug: $("#bkSlug").value.trim(), title: $("#bkTitle").value.trim(), intro: $("#bkIntro").value.trim(), busyUrl: $("#bkBusy").value.trim(),
      hours: $$(".hpbk-hours > div").map((row) => { const [cb, a, b] = row.querySelectorAll("input"); return cb.checked ? [a.value, b.value] : null; }),
    };
  }
  function wire(host) {
    $("#bkCopy").onclick = () => copy(D.link, D.settings.on ? "Booking link copied" : "Booking link copied. Turn it on so clients can book.");
    $("#bkOn").onchange = async (e) => { try { const body = { ...collect(), on: e.target.checked }; if (!body.slug) delete body.slug; await call("/api/book/settings", body); toast(e.target.checked ? "Your booking link is taking bookings" : "Booking link turned off"); await load(); render(); } catch (err) { toast(err.message); e.target.checked = !e.target.checked; } };
    $$(".hpbk-hours > div").forEach((row) => (row.querySelector("input[type=checkbox]").onchange = (e) => row.classList.toggle("off", !e.target.checked)));
    $("#bkSave").onclick = async (e) => {
      const b = e.currentTarget, body = collect(); b.disabled = true; $("#bkMsg").textContent = "";
      if (body.hours.some((w) => w && w[0] >= w[1])) { $("#bkMsg").textContent = "Each day's end time needs to be after its start time."; b.disabled = false; return; }
      try { await call("/api/book/settings", body); toast("Booking settings saved"); await load(); render(); }
      catch (err) { $("#bkMsg").textContent = err.message; b.disabled = false; }
    };
    const fc = $("#bkFeedCopy"); if (fc) fc.onclick = () => copy(D.feed, "Calendar link copied. Add it in Google Calendar with From URL.");
    $("#bkFeedNew").onclick = async (e) => {
      const b = e.currentTarget;
      if (D.feed && !b.dataset.sure) { b.dataset.sure = "1"; b.textContent = "Old link stops working. Click again"; setTimeout(() => { delete b.dataset.sure; b.textContent = "New link"; }, 4000); return; }
      try { const r = await call("/api/book/settings", { op: "feed" }); D = { ...D, ...r }; render(); await copy(r.feed, "Calendar link made and copied"); } catch (err) { toast(err.message); }
    };
    $("#bkBusyCheck").onclick = async (e) => {
      const b = e.currentTarget, url = $("#bkBusy").value.trim(); if (!url) { toast("Paste your calendar's secret address first"); return; }
      b.disabled = true; b.textContent = "Checking…";
      try { const r = await call("/api/book/check-busy", { url }); toast(`Calendar found: ${r.count} busy time${r.count === 1 ? "" : "s"} in the next 2 weeks. Save to use it.`); }
      catch (err) { toast(err.message); }
      b.disabled = false; b.textContent = "Check";
    };
  }
  async function start() {
    if (!$("#bkHost")) return;
    await load(); render();
    new MutationObserver(async () => { if (!$("#v-calendar").hidden && !$("#bkHost").contains(document.activeElement)) { await load(); render(); } }).observe($("#v-calendar"), { attributes: true, attributeFilter: ["hidden"] });
  }
  window.hpBooking = { reload: async () => { await load(); render(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
