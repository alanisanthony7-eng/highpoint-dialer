/* Lead posting URLs on the Import leads page: make a secret URL for each lead vendor (or your own website form),
   copy it, send a test lead, see what arrived, and get the setup details to send the vendor. Leads posted there
   show up in the CRM within seconds; a toast says when one lands. */
(() => {
  "use strict";
  if (window.hpLeadPost?.reload) return;
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toast = (m) => window.hpDesk?.toast?.(m);
  async function call(path, body) {
    const r = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Request failed (${r.status})`), { status: r.status });
    return j;
  }
  const PROD = { FE: "Final Expense", MP: "Mortgage Protection", IUL: "IUL" };
  const STAGE = { new: "New", contacted: "Contacted", appointment: "Appointment", application: "Application" };
  const fmtPhone = (p) => (window.hpDesk?.fmtPhone ? window.hpDesk.fmtPhone(p) : p || "");
  const ago = (t) => { if (!t) return "never"; const s = (Date.now() - t) / 1000; if (s < 60) return "just now"; if (s < 3600) return Math.floor(s / 60) + "m ago"; if (s < 86400) return Math.floor(s / 3600) + "h ago"; return new Date(t).toLocaleDateString([], { month: "short", day: "numeric" }); };
  const when = (t) => new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  const css = `
  .hplp{gap:14px}
  .hplp-head{display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap}
  .hplp-head p{margin:4px 0 0;max-width:68ch}
  .hplp-list{display:grid;gap:10px}
  .hplp-url{border:1px solid var(--line-2);border-radius:12px;padding:12px 14px;display:grid;gap:9px;background:color-mix(in srgb,var(--surface) 70%,transparent)}
  .hplp-url.off{opacity:.62}
  .hplp-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .hplp-top b{font-size:14.5px}
  .hplp .pill{background:color-mix(in srgb,var(--accent) 22%,transparent);color:var(--ink)}
  .hplp .pill.off{background:color-mix(in srgb,var(--bad) 22%,transparent)}
  .hplp-line{display:flex;gap:8px;align-items:center;min-width:0}
  .hplp-line code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;padding:7px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg,rgba(0,0,0,.25));color:var(--ink)}
  .hplp-acts{display:flex;gap:6px;flex-wrap:wrap}
  .hplp-form{border:1px dashed var(--line-2);border-radius:12px;padding:14px;display:grid;gap:12px}
  .hplp-who{display:flex;gap:16px;flex-wrap:wrap;font-size:13.5px}
  .hplp-who label,.hplp-agents label{display:inline-flex;gap:6px;align-items:center}
  .hplp-who input,.hplp-agents input{width:auto}
  .hplp-agents{display:flex;gap:6px 14px;flex-wrap:wrap;font-size:13px;padding:10px 12px;border-radius:10px;border:1px solid var(--line)}
  .hplp-log td{font-size:13px;vertical-align:top}
  .hplp-log a{color:var(--accent-2,var(--ink));cursor:pointer;text-decoration:underline;text-underline-offset:2px}
  .hplp-st{display:inline-block;font-style:normal;font-weight:700;font-size:11.5px;padding:2px 8px;border-radius:99px;white-space:nowrap}
  .hplp-st.added{background:color-mix(in srgb,var(--ok) 24%,transparent)}
  .hplp-st.duplicate{background:color-mix(in srgb,var(--warn) 26%,transparent)}
  .hplp-st.rejected,.hplp-st.flagged{background:color-mix(in srgb,var(--bad) 26%,transparent)}
  .hplp details summary{cursor:pointer;font-weight:700;font-size:13.5px}
  .hplp pre{margin:8px 0 0;white-space:pre-wrap;word-break:break-word;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;padding:12px;border-radius:10px;border:1px solid var(--line);background:var(--bg,rgba(0,0,0,.25));color:var(--ink);max-height:360px;overflow:auto}
  .hplp-empty{padding:14px;border:1px dashed var(--line-2);border-radius:12px;font-size:13.5px}
  `;
  const style = document.createElement("style"); style.textContent = css; document.head.append(style);

  let D = { urls: [], log: [], admin: false, agents: [] }, editing = null; // null, "new", or a URL id
  const agentName = (id) => D.agents.find((a) => a.id === id)?.name || "Agent";

  function spec(u) {
    const url = u?.url || "https://…/api/leads/in/YOUR-SECRET";
    return `Lead posting for ${u?.name || "your leads"}

URL:     ${url}
Method:  POST (a GET with a query string also works)
Formats: JSON, form post (application/x-www-form-urlencoded or multipart), or XML

Field names (common spellings are recognized automatically):
  first_name, last_name (or name), phone, alt_phone, email,
  address, city, state, zip, dob, age, product,
  mortgage_balance, mortgage_payment, lender, notes / comments
Consent (kept with the lead): trustedform_cert_url, jornaya_leadid,
  tcpa_consent (the language the consumer agreed to), ip_address
Anything else you send is saved on the lead too.

Several leads at once: a JSON array, or {"leads": [ ... ]}, up to 100 per request.

Responses (JSON):
  200 {"success":true,"status":"added","id":"…"}
  200 {"success":false,"status":"duplicate","id":"…"}   already in the CRM (same phone)
  400 {"success":false,"status":"rejected","error":"…"} missing or invalid phone, bad data

Example:
curl -X POST '${url}' \\
  -H 'content-type: application/json' \\
  -d '{"first_name":"Jane","last_name":"Doe","phone":"(555) 555-0142","state":"FL","dob":"1958-04-12","trustedform_cert_url":"https://cert.trustedform.com/…"}'`;
  }

  function formHTML(u) {
    const v = u || { name: "", product: "", stage: "new", assign: "me", agents: [] };
    return `<div class="hplp-form" id="lpForm">
      <div class="grid3">
        <label class="field"><span>Vendor or source name</span><input id="lpName" maxlength="60" placeholder="e.g. EverQuote FEX, my website" value="${esc(v.name)}"></label>
        <label class="field"><span>Product</span><select id="lpProd"><option value="">From the lead (or blank)</option>${Object.entries(PROD).map(([k, n]) => `<option value="${k}" ${v.product === k ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <label class="field"><span>Put new leads in stage</span><select id="lpStage">${Object.entries(STAGE).map(([k, n]) => `<option value="${k}" ${v.stage === k ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      </div>
      ${D.admin ? `<div class="stack" style="gap:8px"><span class="label">Who gets the leads</span>
        <div class="hplp-who"><label><input type="radio" name="lpAssign" value="me" ${v.assign !== "rr" ? "checked" : ""}> Me</label><label><input type="radio" name="lpAssign" value="rr" ${v.assign === "rr" ? "checked" : ""}> Round robin between agents</label></div>
        <div class="hplp-agents" id="lpAgents" ${v.assign === "rr" ? "" : "hidden"}>${D.agents.map((a) => `<label><input type="checkbox" value="${esc(a.id)}" ${v.agents.includes(a.id) ? "checked" : ""}> ${esc(a.name)}</label>`).join("") || `<span class="muted">No agents yet.</span>`}</div></div>` : ""}
      <div class="row" style="justify-content:flex-end;gap:8px"><span class="muted" id="lpMsg" style="margin-right:auto"></span><button class="btn" id="lpCancel" type="button">Cancel</button><button class="btn primary" id="lpSave" type="button">${u ? "Save" : "Make the URL"}</button></div>
    </div>`;
  }

  function urlHTML(u) {
    const tags = [u.product ? PROD[u.product] : "", STAGE[u.stage] || "New", u.assign === "rr" ? `Round robin · ${u.agents.length} agent${u.agents.length === 1 ? "" : "s"}` : ""].filter(Boolean);
    return `<div class="hplp-url ${u.on ? "" : "off"}" data-id="${esc(u.id)}">
      <div class="hplp-top"><b>${esc(u.name)}</b>${tags.map((t) => `<span class="pill">${esc(t)}</span>`).join("")}${u.on ? "" : `<span class="pill off">Paused</span>`}<span class="muted" style="margin-left:auto;font-size:12.5px">${u.count} lead${u.count === 1 ? "" : "s"} · last ${esc(ago(u.last))}</span></div>
      ${u.assign === "rr" ? `<div class="muted" style="font-size:12.5px">To ${u.agents.map(agentName).map(esc).join(", ")}</div>` : ""}
      <div class="hplp-line"><code title="${esc(u.url)}">${esc(u.url)}</code><button class="btn sm primary" type="button" data-act="copy">Copy URL</button></div>
      <div class="hplp-acts">
        <button class="btn sm" type="button" data-act="test">Send a test lead</button>
        <button class="btn sm" type="button" data-act="spec">Copy setup for the vendor</button>
        <button class="btn sm" type="button" data-act="edit">Edit</button>
        <button class="btn sm" type="button" data-act="pause">${u.on ? "Pause" : "Turn back on"}</button>
        <button class="btn sm" type="button" data-act="rotate" title="Makes a new secret URL. The old one stops working right away.">New secret URL</button>
        <button class="btn sm danger" type="button" data-act="delete">Delete</button>
      </div>
    </div>`;
  }

  function logHTML() {
    if (!D.log.length) return "";
    const st = (x) => x.status === "added" ? (x.flagged ? `<i class="hplp-st flagged">Added · flagged ${x.flagged === "litigator" ? "litigator" : "DNC"}</i>` : `<i class="hplp-st added">Added${x.test ? " · test" : ""}</i>`) : x.status === "duplicate" ? `<i class="hplp-st duplicate">Duplicate</i>` : `<i class="hplp-st rejected">Rejected</i>`;
    return `<div class="stack" style="gap:8px"><h3 style="margin:6px 0 0">Recent arrivals</h3>
      <div class="tablewrap"><table class="hplp-log"><thead><tr><th>When</th><th>From</th><th>Client</th><th>Phone</th><th>Result</th></tr></thead><tbody>
      ${D.log.slice(0, 25).map((x) => `<tr><td class="num">${esc(when(x.at))}</td><td>${esc(x.url || "")}${x.to ? `<div class="muted">to ${esc(x.to)}</div>` : ""}</td><td>${x.leadId && window.hpDesk?.leads?.has(x.leadId) ? `<a data-open="${esc(x.leadId)}">${esc(x.name || "Client")}</a>` : esc(x.name || "—")}</td><td class="num">${esc(fmtPhone(x.phone))}</td><td>${st(x)}${x.status !== "added" && x.note ? `<div class="muted">${esc(x.note)}${x.keys?.length ? ` · sent: ${esc(x.keys.join(", "))}` : ""}</div>` : ""}</td></tr>`).join("")}
      </tbody></table></div></div>`;
  }

  async function load() { try { D = await call("/api/leads/urls"); } catch (e) { D.error = e.message; } }
  function render() {
    const host = $("#hpPostUrls"); if (!host) return;
    if (D.error && !D.urls.length) { host.innerHTML = `<div class="panel"><h2>Lead posting URLs</h2><p class="muted">${esc(D.error)}</p></div>`; return; }
    host.innerHTML = `<div class="panel stack hplp">
      <div class="hplp-head"><div><h2 style="margin:0">Lead posting URLs</h2><p class="muted">Give a lead vendor one of these URLs, or point your own website form at it. Leads land in your CRM the moment they're posted, with duplicates caught${D.scrub ? " and every number checked against the Do Not Call and litigator lists" : ""}.</p></div>
        ${editing === "new" ? "" : `<button class="btn primary" id="lpNew" type="button">New posting URL</button>`}</div>
      ${editing === "new" ? formHTML(null) : ""}
      <div class="hplp-list">${D.urls.map((u) => (editing === u.id ? formHTML(u) : urlHTML(u))).join("") || (editing === "new" ? "" : `<div class="hplp-empty muted">No posting URLs yet. Make one for each vendor so you can see which leads came from where.</div>`)}</div>
      ${logHTML()}
      <details><summary>What to send your lead vendor</summary><pre id="lpSpec">${esc(spec(D.urls[0]))}</pre></details>
    </div>`;
    wire(host);
  }
  const copy = async (text, msg) => { try { await navigator.clipboard.writeText(text); toast(msg); } catch { toast("Couldn't copy. Select the text and copy it."); } };
  // a second click within 4 seconds confirms (no pop-up dialogs)
  function confirmClick(btn, label) { if (btn.dataset.sure) return true; const t = btn.textContent; btn.dataset.sure = "1"; btn.textContent = label; setTimeout(() => { delete btn.dataset.sure; btn.textContent = t; }, 4000); return false; }

  function wire(host) {
    const nb = $("#lpNew", host); if (nb) nb.onclick = () => { editing = "new"; render(); $("#lpName")?.focus(); };
    const form = $("#lpForm", host);
    if (form) {
      $$('input[name="lpAssign"]', form).forEach((r) => (r.onchange = () => { $("#lpAgents").hidden = $('input[name="lpAssign"]:checked', form).value !== "rr"; }));
      $("#lpCancel", form).onclick = () => { editing = null; render(); };
      $("#lpSave", form).onclick = async (e) => {
        const btn = e.currentTarget, body = { name: $("#lpName").value.trim() || "Lead vendor", product: $("#lpProd").value, stage: $("#lpStage").value };
        if (D.admin) { body.assign = $('input[name="lpAssign"]:checked', form)?.value || "me"; body.agents = $$("#lpAgents input:checked").map((i) => i.value); }
        btn.disabled = true;
        try {
          const r = await call("/api/leads/urls", editing === "new" ? { op: "create", ...body } : { op: "update", id: editing, ...body });
          const made = editing === "new"; editing = null; await load(); render();
          if (made) { await copy(r.url.url, `${r.url.name}: URL made and copied. Send it to your vendor.`); }
        } catch (err) { $("#lpMsg").textContent = err.message; btn.disabled = false; }
      };
    }
    $$(".hplp-url", host).forEach((card) => {
      const u = D.urls.find((x) => x.id === card.dataset.id); if (!u) return;
      card.querySelectorAll("[data-act]").forEach((b) => (b.onclick = async () => {
        const act = b.dataset.act;
        try {
          if (act === "copy") return copy(u.url, "Posting URL copied");
          if (act === "spec") return copy(spec(u), "Setup details copied. Paste them to your vendor.");
          if (act === "edit") { editing = u.id; render(); return; }
          if (act === "test") { b.disabled = true; const r = await call("/api/leads/test", { id: u.id }); toast(r.result.status === "added" ? "Test lead added to your CRM as Test Lead" : r.result.error || "The test lead didn't go through"); await load(); render(); return; }
          if (act === "pause") { await call("/api/leads/urls", { op: "update", id: u.id, on: !u.on }); toast(u.on ? `${u.name} paused. Posts are turned away until you turn it back on.` : `${u.name} is taking leads again`); }
          if (act === "rotate") { if (!confirmClick(b, "Old URL stops working. Click again")) return; const r = await call("/api/leads/urls", { op: "rotate", id: u.id }); await copy(r.url.url, "New URL copied. Send it to your vendor; the old one no longer works."); }
          if (act === "delete") { if (!confirmClick(b, "Click again to delete")) return; await call("/api/leads/urls", { op: "delete", id: u.id }); toast(`${u.name} deleted`); }
          await load(); render();
        } catch (e) { toast(e.message); b.disabled = false; }
      }));
    });
    $$("[data-open]", host).forEach((a) => (a.onclick = () => window.hpDesk?.openDrawer?.(a.dataset.open)));
  }

  // a toast when a posted lead arrives (the CRM syncs on its own)
  let since = Date.now(), timer = 0;
  function watch() {
    const L = window.hpDesk?.leads; if (!L) return;
    const fresh = [...L.values()].filter((l) => l.posted?.at > since && !l.posted.test).sort((a, b) => a.posted.at - b.posted.at);
    if (!fresh.length) return;
    since = Math.max(...fresh.map((l) => l.posted.at));
    const l = fresh[fresh.length - 1], name = [l.first, l.last].filter(Boolean).join(" ") || "a new client";
    toast(fresh.length === 1 ? `New lead from ${l.posted.via}: ${name}` : `${fresh.length} new leads came in (latest from ${l.posted.via}: ${name})`);
    if (!$("#v-import")?.hidden) { clearTimeout(timer); timer = setTimeout(async () => { if (editing) return; await load(); render(); }, 800); }
  }
  setInterval(watch, 4000);

  async function start() {
    if (!$("#hpPostUrls")) return;
    await load(); render();
    // refresh when the Import page is opened
    new MutationObserver(async () => { if (!$("#v-import").hidden && !editing) { await load(); render(); } }).observe($("#v-import"), { attributes: true, attributeFilter: ["hidden"] });
  }
  window.hpLeadPost = { reload: async () => { await load(); render(); } };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
