/* Highpoint team + billing UI: terms agreement, plan paywall, billing window, and the admin Team panel.
   window.hpTeam.ready(user) resolves with the user once they may enter the desk. */
(() => {
  "use strict";
  if (window.hpTeam) return;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "$" + (+n).toFixed(0);
  const day = (t) => t ? new Date(t).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "—";
  async function call(path, body) {
    const r = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Request failed (${r.status})`), { status: r.status, code: j.code });
    return j;
  }
  const toast = (m) => (window.hpDesk?.toast ? window.hpDesk.toast(m) : null);

  const css = `
  .hpt-ov{position:fixed;inset:0;z-index:2500;display:grid;place-items:center;padding:18px;background:rgba(5,4,12,.72);backdrop-filter:blur(6px);font-family:var(--f-ui,"Inter",system-ui,sans-serif);color:#F4F5F8;overflow-y:auto}
  .hpt-card{position:relative;width:min(560px,100%);max-height:calc(100dvh - 36px);overflow:auto;padding:26px 24px 22px;border-radius:22px;background:linear-gradient(180deg,rgba(26,16,40,.97),rgba(11,9,20,.98));border:1px solid rgba(255,79,163,.4);box-shadow:0 40px 90px rgba(0,0,0,.6),0 0 24px -6px rgba(255,46,136,.6)}
  .hpt-card.wide{width:min(980px,100%)}
  .hpt-card::before{content:"";position:absolute;inset:0 0 auto 0;height:3px;border-radius:22px 22px 0 0;background:linear-gradient(90deg,#FF2E88,#FF9E3D)}
  .hpt-card h2{margin:0 0 6px;font:800 22px var(--f-ui,system-ui)}
  .hpt-card h3{margin:18px 0 8px;font:800 14px var(--f-ui,system-ui);letter-spacing:.06em;text-transform:uppercase;color:#FFB5D8}
  .hpt-card p{margin:0 0 10px;font-size:14px;line-height:1.55;color:#C9CDD5}
  .hpt-card a{color:#FF9E3D}
  .hpt-x{all:unset;cursor:pointer;position:absolute;top:14px;right:16px;font-size:18px;color:#AEB3BF;padding:4px 8px;border-radius:8px}.hpt-x:hover{background:rgba(255,255,255,.08);color:#fff}
  .hpt-plans{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}
  .hpt-plan{display:flex;flex-direction:column;gap:8px;padding:16px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12)}
  .hpt-plan.cur{border-color:rgba(255,79,163,.7);box-shadow:0 0 0 1px rgba(255,79,163,.35)}
  .hpt-plan b{font-size:16px}.hpt-plan .pr{font:800 28px var(--f-ui,system-ui)}.hpt-plan .pr small{font-size:13px;color:#AEB3BF;font-weight:600}
  .hpt-plan ul{margin:0;padding-left:18px;font-size:13px;color:#C9CDD5;line-height:1.6}
  .hpt-btn{all:unset;cursor:pointer;box-sizing:border-box;text-align:center;padding:10px 16px;border-radius:999px;font-weight:800;font-size:14px;color:#fff;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16)}
  .hpt-btn:hover{background:rgba(255,255,255,.14)}
  .hpt-btn.go{background:linear-gradient(90deg,#FF2E88,#FF9E3D);border:0;box-shadow:0 10px 26px rgba(255,46,136,.3)}
  .hpt-btn.sm{padding:6px 11px;font-size:12.5px}
  .hpt-btn:disabled{opacity:.55;cursor:default}
  .hpt-btn:focus-visible,.hpt-x:focus-visible{outline:2px solid #fff;outline-offset:2px}
  .hpt-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .hpt-err{padding:10px 12px;border-radius:10px;background:rgba(255,90,106,.14);border:1px solid rgba(255,90,106,.45);font-size:13.5px;color:#FFD2D7;margin:8px 0}
  .hpt-chk{display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.5;color:#E3E6EC;margin:12px 0}
  .hpt-chk input{margin-top:3px;width:18px;height:18px;accent-color:#FF2E88;flex:none}
  .hpt-tbl{width:100%;border-collapse:collapse;font-size:13px}
  .hpt-tbl th{text-align:left;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8C92A0;padding:8px 6px;border-bottom:1px solid rgba(255,255,255,.1)}
  .hpt-tbl td{padding:9px 6px;border-bottom:1px solid rgba(255,255,255,.06);vertical-align:middle}
  .hpt-tbl select,.hpt-in{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16);color:#fff;border-radius:9px;padding:6px 8px;font:inherit;font-size:13px}
  .hpt-tbl select option,.hpt-in option{background:#1a1028}
  .hpt-pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:700;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);white-space:nowrap}
  .hpt-pill.ok{background:rgba(36,214,150,.12);border-color:rgba(36,214,150,.4);color:#7CF5C4}
  .hpt-pill.bad{background:rgba(255,90,106,.12);border-color:rgba(255,90,106,.45);color:#FFB3BC}
  .hpt-pill.warn{background:rgba(255,158,61,.12);border-color:rgba(255,158,61,.45);color:#FFD2A6}
  .hpt-tabs{display:flex;gap:6px;margin:6px 0 4px}
  .hpt-tabs button{all:unset;cursor:pointer;padding:8px 14px;border-radius:999px;font-weight:700;font-size:13.5px;color:#C9CDD5;border:1px solid rgba(255,255,255,.12)}
  .hpt-tabs button[aria-pressed=true]{color:#fff;background:linear-gradient(90deg,rgba(255,46,136,.35),rgba(255,158,61,.3));border-color:rgba(255,79,163,.6)}
  .hpt-wrap{overflow-x:auto}
  .hpt-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
  .hpt-grid label{display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:700;color:#C9CDD5}
  .hpt-link{display:flex;gap:8px;align-items:center;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);margin:6px 0;font-size:13px}
  .hpt-link code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12.5px ui-monospace,Menlo,monospace;color:#FFD3E8}
  .hpt-muted{color:#8C92A0;font-size:12.5px}
  @media (max-width:640px){.hpt-plans{grid-template-columns:1fr}.hpt-card{padding:22px 16px 18px}}`;
  const st = document.createElement("style"); st.textContent = css; document.head.append(st);

  function modal(html, { wide = false, close = true } = {}) {
    const ov = document.createElement("div"); ov.className = "hpt-ov"; ov.setAttribute("role", "dialog"); ov.setAttribute("aria-modal", "true");
    ov.innerHTML = `<div class="hpt-card${wide ? " wide" : ""}">${close ? `<button class="hpt-x" type="button" aria-label="Close">✕</button>` : ""}${html}</div>`;
    document.body.append(ov);
    const done = () => ov.remove();
    if (close) { $(".hpt-x", ov).onclick = done; ov.addEventListener("click", (e) => { if (e.target === ov) done(); }); ov.addEventListener("keydown", (e) => { if (e.key === "Escape") done(); }); }
    setTimeout(() => (ov.querySelector("input,button.hpt-btn,select") || ov.querySelector("button"))?.focus(), 30);
    return { el: ov, close: done };
  }
  const signOut = async () => { try { await call("/api/auth/logout", {}); } finally { location.href = "/"; } };

  /* ---------- terms (existing agents who haven't agreed yet) ---------- */
  function agree() {
    return new Promise((res) => {
      const m = modal(`<h2>Before you continue</h2>
        <p>We've added Terms of Service and a Privacy Policy for the Highpoint desk. They cover how your leads' information is protected, and that you are responsible for following calling and texting laws (TCPA, Do Not Call, call-recording consent) when you use the dialer.</p>
        <label class="hpt-chk"><input type="checkbox" id="hptAg"><span>I agree to the <a href="/terms.html" target="_blank" rel="noopener">Terms of Service</a> and <a href="/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</span></label>
        <div class="hpt-err" id="hptE" hidden></div>
        <div class="hpt-row" style="justify-content:space-between"><button class="hpt-btn" type="button" id="hptOut">Sign out</button><button class="hpt-btn go" type="button" id="hptGo">Continue</button></div>`, { close: false });
      $("#hptOut", m.el).onclick = signOut;
      $("#hptGo", m.el).onclick = async () => {
        const e = $("#hptE", m.el);
        if (!$("#hptAg", m.el).checked) { e.hidden = false; e.textContent = "Check the box to agree."; return; }
        try { await call("/api/auth/agree", { agree: true }); m.close(); res(); } catch (er) { e.hidden = false; e.textContent = er.message; }
      };
    });
  }

  /* ---------- plans ---------- */
  function plansHtml(b, current) {
    const p = b.prices || { starter: 39, pro: 79 };
    const trial = b.status === "none" && b.trialDays ? `<p class="hpt-muted" style="margin:0">${b.trialDays}-day free trial, then billed monthly. Cancel anytime.</p>` : `<p class="hpt-muted" style="margin:0">Billed monthly. Cancel anytime.</p>`;
    const card = (k, name, items) => `<div class="hpt-plan${current === k ? " cur" : ""}"><b>${name}</b><div class="pr">${money(p[k])}<small>/month</small></div><ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul><button class="hpt-btn ${k === "pro" ? "go" : ""}" type="button" data-plan="${k}">${current === k && /active|trialing/.test(b.status) ? "Current plan" : "Choose " + name}</button></div>`;
    return `<div class="hpt-plans">${card("starter", "Starter", ["Private lead CRM", "Quoter and health screening", "Scripts and Highpoint Bot", "Calendar and follow-ups"])}${card("pro", "Pro", ["Everything in Starter", "Power dialer with local caller ID", "Your own phone numbers", "Voicemail drop and call history"])}</div>${trial}<p class="hpt-muted" style="margin-top:6px">Phone minutes and numbers may be billed separately by your admin.</p>`;
  }
  async function checkout(plan, btn) {
    btn.disabled = true; btn.textContent = "Opening checkout…";
    try { const r = await call("/api/billing/checkout", { plan }); location.href = r.url; }
    catch (e) { btn.disabled = false; btn.textContent = "Try again"; alertIn(btn, e.message); }
  }
  function alertIn(node, msg) { const card = node.closest(".hpt-card"); let e = card.querySelector(".hpt-err.dyn"); if (!e) { e = document.createElement("div"); e.className = "hpt-err dyn"; card.append(e); } e.textContent = msg; }

  function paywall(u, b) {
    return new Promise(() => {
      const pd = u.access?.reason === "past_due";
      const m = modal(`<h2>${pd ? "Your payment didn't go through" : "Choose your plan"}</h2>
        <p>${pd ? "Update your card to keep using the Highpoint desk. Your leads and notes are saved." : "Pick a plan to start using the Highpoint desk. Your leads stay private to your login."}</p>
        ${pd && b.hasCustomer ? `<div class="hpt-row" style="margin:12px 0"><button class="hpt-btn go" type="button" id="hptPortal">Update my card</button></div>` : plansHtml(b, u.plan)}
        <div class="hpt-row" style="justify-content:space-between;margin-top:14px"><button class="hpt-btn sm" type="button" id="hptOut">Sign out</button><span class="hpt-muted">Questions? Contact your Highpoint admin.</span></div>`, { close: false });
      $("#hptOut", m.el).onclick = signOut;
      m.el.querySelectorAll("[data-plan]").forEach((x) => x.onclick = () => checkout(x.dataset.plan, x));
      const pt = $("#hptPortal", m.el); if (pt) pt.onclick = async () => { pt.disabled = true; try { location.href = (await call("/api/billing/portal", {})).url; } catch (e) { pt.disabled = false; alertIn(pt, e.message); } };
    });
  }

  /* ---------- billing window (from the account menu) ---------- */
  async function openBilling() {
    let b; try { b = await call("/api/billing/status"); } catch (e) { toast(e.message); return; }
    const u = window.hpUser || {};
    const label = { active: "Active", trialing: "Free trial", past_due: "Payment failed", canceled: "Canceled", unpaid: "Unpaid", incomplete: "Incomplete", none: "No subscription" }[b.status] || b.status;
    const tone = /active|trialing/.test(b.status) ? "ok" : b.status === "none" ? "" : "bad";
    const free = b.comp ? "Your admin has given you free access." : u.owner || u.role === "admin" ? "Admins always have full access." : !b.required ? "Billing isn't turned on for the team yet, so you have full access." : "";
    const m = modal(`<h2>Billing</h2>
      <div class="hpt-row" style="margin:6px 0 12px"><span class="hpt-pill">${esc((b.plan || "pro").replace(/^./, (c) => c.toUpperCase()))} plan</span><span class="hpt-pill ${tone}">${esc(label)}</span>${b.periodEnd ? `<span class="hpt-muted">${b.status === "trialing" ? "Trial ends" : "Renews"} ${day(b.periodEnd)}</span>` : ""}</div>
      ${free ? `<p>${esc(free)}</p>` : ""}
      ${b.hasCustomer ? `<div class="hpt-row" style="margin:6px 0 4px"><button class="hpt-btn go" type="button" id="hptPortal">Manage plan, card and invoices</button></div>` : !b.connected ? `<p class="hpt-muted">Online payments aren't connected yet.</p>` : plansHtml(b, b.plan)}`);
    m.el.querySelectorAll("[data-plan]").forEach((x) => x.onclick = () => checkout(x.dataset.plan, x));
    const pt = $("#hptPortal", m.el); if (pt) pt.onclick = async () => { pt.disabled = true; pt.textContent = "Opening…"; try { location.href = (await call("/api/billing/portal", {})).url; } catch (e) { pt.disabled = false; pt.textContent = "Try again"; alertIn(pt, e.message); } };
  }

  /* ---------- Team panel (admins) ---------- */
  async function openTeam(tab = "agents") {
    const m = modal(`<h2>Team</h2><p class="hpt-muted" style="margin:0 0 6px">Invite downlines, choose their plan, give free access, or turn accounts off.</p>
      <div class="hpt-tabs" role="tablist"><button type="button" data-t="agents">Agents</button><button type="button" data-t="invites">Invite links</button><button type="button" data-t="billing">Billing settings</button></div><div id="hptBody"><p class="hpt-muted">Loading…</p></div>`, { wide: true });
    const body = $("#hptBody", m.el);
    const show = async (t) => {
      tab = t; m.el.querySelectorAll("[data-t]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.t === t));
      body.innerHTML = `<p class="hpt-muted">Loading…</p>`;
      try { await ({ agents, invites, billing })[t](body); } catch (e) { body.innerHTML = `<div class="hpt-err">${esc(e.message)}</div>`; }
    };
    m.el.querySelectorAll("[data-t]").forEach((b) => b.onclick = () => show(b.dataset.t));
    show(tab);

    async function agents(el) {
      const { members } = await call("/api/team/members");
      const stat = (x) => x.disabled ? `<span class="hpt-pill bad">Off</span>` : x.owner ? `<span class="hpt-pill ok">Owner</span>` : x.comp ? `<span class="hpt-pill ok">Free</span>` : x.access?.ok ? `<span class="hpt-pill ok">${x.status === "trialing" ? "Trial" : x.status === "active" ? "Paid" : "Access on"}</span>` : `<span class="hpt-pill ${x.status === "past_due" ? "bad" : "warn"}">${x.status === "past_due" ? "Payment failed" : "Unpaid"}</span>`;
      el.innerHTML = `<div class="hpt-wrap"><table class="hpt-tbl"><thead><tr><th>Agent</th><th>Role</th><th>Plan</th><th>Status</th><th>Free access</th><th>Last seen</th><th></th></tr></thead><tbody>
        ${members.map((x) => `<tr data-id="${esc(x.id)}"><td><b>${esc(x.name || x.email)}</b><div class="hpt-muted">${esc(x.email)}</div></td>
          <td>${x.owner ? "Owner" : `<select data-k="role" aria-label="Role"><option value="agent" ${x.role !== "admin" ? "selected" : ""}>Agent</option><option value="admin" ${x.role === "admin" ? "selected" : ""}>Admin</option></select>`}</td>
          <td>${x.owner ? "Pro" : `<select data-k="plan" aria-label="Plan"><option value="starter" ${x.plan === "starter" ? "selected" : ""}>Starter</option><option value="pro" ${x.plan !== "starter" ? "selected" : ""}>Pro</option></select>`}</td>
          <td>${stat(x)}</td>
          <td>${x.owner ? "—" : `<input type="checkbox" data-k="comp" ${x.comp ? "checked" : ""} aria-label="Free access">`}</td>
          <td class="hpt-muted">${x.lastSeen ? day(x.lastSeen) : "—"}</td>
          <td>${x.owner ? "" : `<button class="hpt-btn sm" type="button" data-k="disabled" data-v="${x.disabled ? 0 : 1}">${x.disabled ? "Turn on" : "Turn off"}</button>`}</td></tr>`).join("")}
      </tbody></table></div><p class="hpt-muted" style="margin-top:10px">Turning an account off signs them out right away. Their leads stay saved, and you can turn them back on anytime. Plan changes here don't change what Stripe charges; agents change their own subscription in Billing.</p>`;
      el.querySelectorAll("tr[data-id]").forEach((tr) => {
        const id = tr.dataset.id, save = async (patch) => { try { await call("/api/team/member", { id, ...patch }); toast("Saved"); show("agents"); } catch (e) { toast(e.message); show("agents"); } };
        tr.querySelectorAll("select[data-k]").forEach((s) => s.onchange = () => save({ [s.dataset.k]: s.value }));
        tr.querySelectorAll("input[data-k=comp]").forEach((c) => c.onchange = () => save({ comp: c.checked }));
        tr.querySelectorAll("button[data-k=disabled]").forEach((b) => b.onclick = () => { if (b.dataset.v === "1" && !confirm("Turn off this agent's account? They'll be signed out.")) return; save({ disabled: b.dataset.v === "1" }); });
      });
    }
    async function invites(el) {
      const { invites } = await call("/api/team/invites");
      el.innerHTML = `<h3>New invite link</h3><div class="hpt-grid">
          <label>Plan<select class="hpt-in" id="iPlan"><option value="pro">Pro (with dialer)</option><option value="starter">Starter</option></select></label>
          <label>Role<select class="hpt-in" id="iRole"><option value="agent">Agent</option><option value="admin">Admin</option></select></label>
          <label>Uses<select class="hpt-in" id="iUses"><option value="1">One person</option><option value="">Unlimited</option><option value="10">Up to 10</option></select></label>
          <label>Expires<select class="hpt-in" id="iDays"><option value="7">In 7 days</option><option value="30">In 30 days</option><option value="">Never</option></select></label>
          <label>Note<input class="hpt-in" id="iNote" placeholder="e.g. Maria's team" maxlength="80"></label>
          <label style="justify-content:flex-end"><span style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="iComp" style="accent-color:#FF2E88"> Free access</span></label></div>
        <div class="hpt-row" style="margin-top:10px"><button class="hpt-btn go" type="button" id="iGo">Create invite link</button></div><div id="iNew"></div>
        <h3>Active links</h3>${invites.length ? invites.map((i) => `<div class="hpt-link"><code>${esc(i.url)}</code><span class="hpt-pill">${i.plan === "starter" ? "Starter" : "Pro"}${i.role === "admin" ? " · Admin" : ""}${i.comp ? " · Free" : ""}</span><span class="hpt-muted">${i.uses}${i.max_uses ? "/" + i.max_uses : ""} used${i.expires ? " · until " + day(i.expires) : ""}${i.note ? " · " + esc(i.note) : ""}</span><button class="hpt-btn sm" type="button" data-copy="${esc(i.url)}">Copy</button><button class="hpt-btn sm" type="button" data-rev="${esc(i.code)}">Revoke</button></div>`).join("") : `<p class="hpt-muted">No active links yet.</p>`}`;
      const copy = async (t) => { try { await navigator.clipboard.writeText(t); toast("Link copied"); } catch { prompt("Copy this link:", t); } };
      $("#iGo", el).onclick = async () => {
        try {
          const r = await call("/api/team/invite", { plan: $("#iPlan", el).value, role: $("#iRole", el).value, maxUses: $("#iUses", el).value, days: $("#iDays", el).value, note: $("#iNote", el).value, comp: $("#iComp", el).checked });
          await copy(r.url); show("invites");
        } catch (e) { $("#iNew", el).innerHTML = `<div class="hpt-err">${esc(e.message)}</div>`; }
      };
      el.querySelectorAll("[data-copy]").forEach((b) => b.onclick = () => copy(b.dataset.copy));
      el.querySelectorAll("[data-rev]").forEach((b) => b.onclick = async () => { if (!confirm("Revoke this link? Nobody new can join with it.")) return; await call("/api/team/revoke", { code: b.dataset.rev }); show("invites"); });
    }
    async function billing(el) {
      const s = await call("/api/team/settings");
      el.innerHTML = `${s.connected ? `<p><span class="hpt-pill ok">Stripe connected${s.testMode ? " · test mode" : ""}</span>${s.webhook ? ` <span class="hpt-muted">Payment updates arrive at ${esc(s.webhook)}</span>` : ` <span class="hpt-muted">Payment updates connect automatically on the first checkout.</span>`}</p>` : `<div class="hpt-err">Stripe isn't connected yet. In Cloudflare → Workers &amp; Pages → highpoint-dialer → Settings → Variables and Secrets, add a <b>Secret</b> named <code>STRIPE_SECRET_KEY</code> (from Stripe → Developers → API keys) for Production, then redeploy.</div>`}
        <div class="hpt-grid" style="margin-top:8px">
          <label>Starter price ($/month)<input class="hpt-in" id="bS" type="number" min="1" value="${esc(s.prices.starter)}"></label>
          <label>Pro price ($/month)<input class="hpt-in" id="bP" type="number" min="1" value="${esc(s.prices.pro)}"></label>
          <label>Free trial (days)<input class="hpt-in" id="bT" type="number" min="0" max="60" value="${esc(s.trialDays)}"></label>
          <label>New agents start on<select class="hpt-in" id="bD"><option value="pro" ${s.defaultPlan !== "starter" ? "selected" : ""}>Pro</option><option value="starter" ${s.defaultPlan === "starter" ? "selected" : ""}>Starter</option></select></label></div>
        <label class="hpt-chk"><input type="checkbox" id="bR" ${s.required ? "checked" : ""}><span><b>Require payment.</b> When this is on, agents without an active subscription (and without free access) see the plan screen instead of the desk. Admins and free-access agents are never locked out.</span></label>
        <div class="hpt-row"><button class="hpt-btn go" type="button" id="bGo">Save billing settings</button></div><div id="bMsg"></div>
        <p class="hpt-muted" style="margin-top:10px">Price changes apply to new subscriptions. Existing subscribers keep their price until they change plans.</p>`;
      $("#bGo", el).onclick = async () => {
        try { await call("/api/team/settings", { prices: { starter: +$("#bS", el).value, pro: +$("#bP", el).value }, trialDays: +$("#bT", el).value, defaultPlan: $("#bD", el).value, required: $("#bR", el).checked }); toast("Billing settings saved"); show("billing"); }
        catch (e) { $("#bMsg", el).innerHTML = `<div class="hpt-err">${esc(e.message)}</div>`; }
      };
    }
  }

  /* ---------- entry check ---------- */
  async function ready(u) {
    const q = new URLSearchParams(location.search);
    if (q.get("billing")) {
      try { await call("/api/billing/sync", {}); } catch {}
      history.replaceState(null, "", location.pathname);
      try { u = (await call("/api/auth/me")).user || u; } catch {}
      setTimeout(() => toast(q.get("billing") === "success" ? "You're subscribed. Welcome to the desk!" : "Checkout canceled."), 2500);
    }
    if (u.needsAgree) { await agree(); try { u = (await call("/api/auth/me")).user || u; } catch {} }
    if (u.access && !u.access.ok) { let b = {}; try { b = await call("/api/billing/status"); } catch {} await paywall(u, b); }
    return u;
  }
  window.hpTeam = { ready, openBilling, openTeam };
})();
