/* Highpoint team + billing UI: terms agreement, plans (Early Access, Base, Pro, Full Access), the paywall,
   the billing window, upgrade prompts for features a plan doesn't include, and the admin Team panel.
   window.hpTeam.ready(user) resolves with the user once they may enter the desk.
   window.hpTeam.can(feature) / upgrade(feature) / viewLocked(view) are used by the rest of the desk. */
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

  /* ---------- plans and what they include ---------- */
  const PLAN_NAME = { early: "Early Access", base: "Base", plus: "Pro", full: "Full Access" };
  const FEAT = { crm: "CRM, calendar and lead import", clients: "Client list", quoter: "Quote & compare", screen: "Health screener", scripts: "Call scripts and Training", bot: "Highpoint Bot", iul: "IUL illustrator", dialer: "Highpoint Dialer with live transcripts and Copilot", crew: "Crew lobby and games", music: "Spotify in the desk" };
  const FEAT_SHORT = { crm: "the CRM", clients: "the client list", quoter: "the quoter", screen: "the health screener", scripts: "call scripts and Training", bot: "Highpoint Bot", iul: "the IUL illustrator", dialer: "the Highpoint Dialer", crew: "the crew lobby and games", music: "Spotify" };
  const VIEW_FEAT = { pipeline: "crm", calendar: "crm", import: "crm", contacts: "clients", quoter: "quoter", screen: "screen", scripts: "scripts", training: "scripts", assistant: "bot", iul: "iul", dialer: "dialer", crew: "crew", games: "crew" };
  const planName = (k) => PLAN_NAME[k] || PLAN_NAME.full;
  const can = (f) => { const a = window.hpUser?.access; return !a || !Array.isArray(a.features) || a.features.includes(f); };
  const viewFeature = (v) => VIEW_FEAT[v] || null;
  const viewLocked = (v) => { const f = viewFeature(v); return !!f && !can(f); };

  const css = `
  .hpt-ov{position:fixed;inset:0;z-index:2500;display:grid;place-items:center;padding:18px;background:rgba(3,6,12,.7);backdrop-filter:blur(6px);font-family:var(--f-ui,system-ui,sans-serif);color:var(--ink,#eef2f8);overflow-y:auto}
  .hpt-card{position:relative;width:min(560px,100%);max-height:calc(100dvh - 36px);overflow:auto;padding:24px 22px 20px;border-radius:18px;background:var(--surface,#0c121e);border:1px solid var(--line-2,#28354c);box-shadow:0 40px 90px rgba(0,0,0,.55)}
  .hpt-card.wide{width:min(1000px,100%)}
  .hpt-card h2{margin:0 0 6px;font:700 21px var(--f-ui,system-ui);letter-spacing:-.01em}
  .hpt-card h3{margin:20px 0 8px;font:700 11.5px var(--f-ui,system-ui);letter-spacing:.1em;text-transform:uppercase;color:var(--muted,#8c97ab)}
  .hpt-card p{margin:0 0 10px;font-size:14px;line-height:1.55;color:var(--muted,#8c97ab)}
  .hpt-card p b{color:var(--ink,#eef2f8)}
  .hpt-card a{color:var(--accent-2,#a9c1ec)}
  .hpt-x{all:unset;cursor:pointer;position:absolute;top:12px;right:14px;font-size:16px;color:var(--muted,#8c97ab);padding:5px 9px;border-radius:8px}.hpt-x:hover{background:var(--line,#1c2638);color:var(--ink,#fff)}
  .hpt-early{display:grid;grid-template-columns:1fr auto;gap:6px 16px;align-items:center;margin:14px 0 6px;padding:16px 18px;border-radius:14px;border:1px solid color-mix(in srgb,var(--accent,#3a5f9f) 70%,transparent);background:linear-gradient(135deg,color-mix(in srgb,var(--accent,#3a5f9f) 26%,transparent),transparent 70%)}
  .hpt-early .tag{grid-column:1/-1;font-size:10.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--accent-2,#a9c1ec)}
  .hpt-early b{font-size:18px}.hpt-early .pr{font:800 30px var(--f-num,system-ui);text-align:right}.hpt-early .pr small{font-size:13px;color:var(--muted);font-weight:600}
  .hpt-early p{grid-column:1/-1;margin:0}
  .hpt-early .hpt-btn{grid-column:1/-1;justify-self:start}
  .hpt-plans{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:12px 0}
  .hpt-plans.two{grid-template-columns:repeat(2,minmax(0,1fr))}.hpt-plans.one{grid-template-columns:minmax(0,1fr)}
  .hpt-plan{display:flex;flex-direction:column;gap:8px;padding:15px;border-radius:14px;background:var(--surface-2,#111a2a);border:1px solid var(--line,#1c2638)}
  .hpt-plan.cur{border-color:var(--accent,#3a5f9f);box-shadow:0 0 0 1px var(--accent,#3a5f9f)}
  .hpt-plan.pop{border-color:color-mix(in srgb,var(--accent,#3a5f9f) 60%,var(--line,#1c2638))}
  .hpt-plan .nm{display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px}
  .hpt-plan .nm em{font-style:normal;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:2px 7px;border-radius:999px;background:var(--accent-soft,#141d30);color:var(--accent-2,#a9c1ec)}
  .hpt-plan .pr{font:800 26px var(--f-num,system-ui)}.hpt-plan .pr small{font-size:12.5px;color:var(--muted,#8c97ab);font-weight:600}
  .hpt-plan ul{list-style:none;margin:0;padding:0;display:grid;gap:5px;font-size:13px;color:var(--ink,#eef2f8);flex:1}
  .hpt-plan li{display:flex;gap:7px;line-height:1.4}.hpt-plan li::before{content:"✓";color:var(--ok,#86c28a);font-weight:800;flex:none}
  .hpt-plan li.inh{color:var(--muted,#8c97ab)}.hpt-plan li.inh::before{content:"";width:9px}
  .hpt-btn{all:unset;cursor:pointer;box-sizing:border-box;text-align:center;padding:9px 15px;border-radius:10px;font-weight:700;font-size:13.5px;color:var(--ink,#fff);background:var(--surface-2,#111a2a);border:1px solid var(--line-2,#28354c)}
  .hpt-btn:hover{border-color:var(--muted,#8c97ab)}
  .hpt-btn.go{background:var(--accent,#3a5f9f);border-color:var(--accent,#3a5f9f);color:var(--accent-ink,#fff)}.hpt-btn.go:hover{filter:brightness(1.1)}
  .hpt-btn.sm{padding:6px 11px;font-size:12.5px;border-radius:8px}
  .hpt-btn.danger{color:var(--bad,#e88c76);border-color:color-mix(in srgb,var(--bad,#e88c76) 50%,transparent)}
  .hpt-btn:disabled{opacity:.55;cursor:default}
  .hpt-btn:focus-visible,.hpt-x:focus-visible{outline:2px solid var(--accent-2,#a9c1ec);outline-offset:2px}
  .hpt-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .hpt-err{padding:10px 12px;border-radius:10px;background:var(--bad-soft,#361c16);border:1px solid color-mix(in srgb,var(--bad,#e88c76) 45%,transparent);font-size:13.5px;color:var(--ink,#fff);margin:8px 0}
  .hpt-note{padding:10px 12px;border-radius:10px;background:var(--accent-soft,#141d30);border:1px solid var(--line-2,#28354c);font-size:13px;color:var(--ink,#fff);margin:8px 0;line-height:1.5}
  .hpt-chk{display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.5;color:var(--ink,#eef2f8);margin:12px 0}
  .hpt-chk input{margin-top:3px;width:17px;height:17px;accent-color:var(--accent,#3a5f9f);flex:none}
  .hpt-tbl{width:100%;border-collapse:collapse;font-size:13px}
  .hpt-tbl th{text-align:left;font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted,#8c97ab);padding:8px 6px;border-bottom:1px solid var(--line,#1c2638)}
  .hpt-tbl td{padding:8px 6px;border-bottom:1px solid var(--line,#1c2638);vertical-align:middle}
  .hpt-tbl.mx td:not(:first-child),.hpt-tbl.mx th:not(:first-child){text-align:center;width:88px}
  .hpt-tbl input[type=checkbox]{width:16px;height:16px;accent-color:var(--accent,#3a5f9f)}
  .hpt-tbl select,.hpt-in{background:var(--sunk,#080d17);border:1px solid var(--line-2,#28354c);color:var(--ink,#fff);border-radius:8px;padding:6px 8px;font:inherit;font-size:13px}
  .hpt-pill{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:700;background:var(--surface-2,#111a2a);border:1px solid var(--line-2,#28354c);white-space:nowrap}
  .hpt-pill.ok{background:var(--ok-soft,#1a261b);border-color:color-mix(in srgb,var(--ok,#86c28a) 45%,transparent);color:var(--ok,#86c28a)}
  .hpt-pill.bad{background:var(--bad-soft,#361c16);border-color:color-mix(in srgb,var(--bad,#e88c76) 45%,transparent);color:var(--bad,#e88c76)}
  .hpt-pill.warn{background:var(--warn-soft,#322412);border-color:color-mix(in srgb,var(--warn,#e2aa5e) 45%,transparent);color:var(--warn,#e2aa5e)}
  .hpt-tabs{display:flex;gap:6px;margin:8px 0 4px;flex-wrap:wrap}
  .hpt-tabs button{all:unset;cursor:pointer;padding:7px 13px;border-radius:999px;font-weight:700;font-size:13px;color:var(--muted,#8c97ab);border:1px solid var(--line,#1c2638)}
  .hpt-tabs button[aria-pressed=true]{color:var(--ink,#fff);background:var(--accent-soft,#141d30);border-color:var(--accent,#3a5f9f)}
  .hpt-wrap{overflow-x:auto}
  .hpt-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
  .hpt-grid label{display:flex;flex-direction:column;gap:5px;font-size:12px;font-weight:700;color:var(--muted,#8c97ab)}
  .hpt-link{display:flex;gap:8px;align-items:center;padding:10px 12px;border-radius:12px;background:var(--surface-2,#111a2a);border:1px solid var(--line,#1c2638);margin:6px 0;font-size:13px;flex-wrap:wrap}
  .hpt-link code{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:12.5px ui-monospace,Menlo,monospace;color:var(--accent-2,#a9c1ec)}
  .hpt-muted{color:var(--muted,#8c97ab);font-size:12.5px}
  .hpt-sec{padding:14px;border:1px solid var(--line,#1c2638);border-radius:12px;margin:10px 0;background:var(--surface-2,#111a2a)}
  .hpt-sec h3{margin-top:0}
  .rail .nav.locked{opacity:.62}.rail .nav .hpt-lock{margin-left:auto;width:13px;height:13px;flex:none;opacity:.85}
  @media (max-width:760px){.hpt-plans,.hpt-plans.two{grid-template-columns:minmax(0,1fr)}.hpt-card{padding:22px 16px 18px}.hpt-early{grid-template-columns:1fr}.hpt-early .pr{text-align:left}}`;
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
  function alertIn(node, msg) { const card = node.closest(".hpt-card"); let e = card.querySelector(".hpt-err.dyn"); if (!e) { e = document.createElement("div"); e.className = "hpt-err dyn"; card.append(e); } e.textContent = msg; }

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

  /* ---------- plan cards ----------
     b = /api/billing/status. opts.only = plan keys to show; opts.action(k) = button label */
  function plansHtml(b, opts = {}) {
    const P = Object.fromEntries((b.plans || []).map((p) => [p.key, p]));
    if (!P.base) return "";
    const cur = b.plan, live = !!b.subscribed;
    const label = (k) => (cur === k && (live || b.comp) ? "Current plan" : opts.action ? opts.action(k) : live ? `Switch to ${planName(k)}` : `Choose ${planName(k)}`);
    const list = (k) => {
      const prev = k === "plus" ? "base" : k === "full" ? "plus" : null, have = new Set(prev ? P[prev].features : []);
      const items = P[k].features.filter((f) => !have.has(f)).map((f) => `<li>${esc(FEAT[f] || f)}</li>`).join("");
      const mins = P[k].minutes != null ? `<li>${P[k].minutes.toLocaleString()} dialer minutes a month${b.overage?.on ? `, then $${(+b.overage.rate).toFixed(3).replace(/0$/, "")}/min` : ""}</li>` : "";
      return (prev ? `<li class="inh">Everything in ${planName(prev)}, plus:</li>` : "") + items + mins;
    };
    const keys = (opts.only || ["base", "plus", "full"]).filter((k) => P[k] && k !== "early");
    const showEarly = b.earlyOpen && P.early && (!opts.only || opts.only.includes("early"));
    const early = showEarly ? `<div class="hpt-early"><span class="tag">Early access${b.earlyEnds ? ` · ends ${day(b.earlyEnds)}` : ""}</span><div><b>Early Access</b><p>Everything in Full Access, for early members while early access lasts.${P.early.minutes != null ? ` Includes ${P.early.minutes.toLocaleString()} dialer minutes a month.` : ""}</p></div><div class="pr">${money(P.early.price)}<small>/month</small></div>
      <button class="hpt-btn go" type="button" data-plan="early" ${cur === "early" && (live || b.comp) ? "disabled" : ""}>${cur === "early" && (live || b.comp) ? "Current plan" : live ? "Switch to Early Access" : "Join early access"}</button></div>` : "";
    const cards = keys.map((k) => `<div class="hpt-plan${cur === k ? " cur" : ""}${k === "plus" ? " pop" : ""}"><div class="nm">${esc(planName(k))}${k === "plus" ? "<em>Popular</em>" : ""}</div><div class="pr">${money(P[k].price)}<small>/month</small></div><ul>${list(k)}</ul>
      <button class="hpt-btn${!showEarly && k === "plus" ? " go" : ""}" type="button" data-plan="${k}" ${cur === k && (live || b.comp) ? "disabled" : ""}>${esc(label(k))}</button></div>`).join("");
    const after = showEarly && keys.length ? `<h3>${opts.only ? "Or" : "Regular plans"}</h3>` : "";
    const trial = !live && b.status === "none" && b.trialDays ? `${b.trialDays}-day free trial, then billed monthly. Cancel anytime.` : "Billed monthly. Cancel anytime.";
    return `${early}${after}<div class="hpt-plans${keys.length === 2 ? " two" : keys.length === 1 ? " one" : ""}">${cards}</div><p class="hpt-muted" style="margin:0">${live ? "Switching plans takes effect right away; Stripe credits or charges the difference on your next bill." : trial}</p>`;
  }
  // a plan button: change the subscription in place, or go to Stripe Checkout
  async function choose(plan, btn, b) {
    if (b.subscribed) {
      const P = (b.plans || []).find((p) => p.key === plan);
      if (!confirm(`Switch to ${planName(plan)} for ${money(P?.price || 0)}/month? It takes effect now, and Stripe adjusts your next bill for the difference.`)) return;
      btn.disabled = true; btn.textContent = "Switching…";
      try { await call("/api/billing/change", { plan }); toast(`You're on ${planName(plan)} now`); setTimeout(() => location.reload(), 700); }
      catch (e) { btn.disabled = false; btn.textContent = "Try again"; alertIn(btn, e.message); }
      return;
    }
    if (!b.connected) { alertIn(btn, "Online payments aren't connected yet. Ask your Highpoint admin to move you to " + planName(plan) + "."); return; }
    btn.disabled = true; btn.textContent = "Opening checkout…";
    try { const r = await call("/api/billing/checkout", { plan }); if (r.url) location.href = r.url; else location.reload(); }
    catch (e) { btn.disabled = false; btn.textContent = "Try again"; alertIn(btn, e.message); }
  }
  const wire = (el, b) => el.querySelectorAll("[data-plan]").forEach((x) => (x.onclick = () => choose(x.dataset.plan, x, b)));
  const portal = async (btn) => { btn.disabled = true; const t = btn.textContent; btn.textContent = "Opening…"; try { location.href = (await call("/api/billing/portal", {})).url; } catch (e) { btn.disabled = false; btn.textContent = t; alertIn(btn, e.message); } };

  function paywall(u, b) {
    return new Promise(() => {
      const pd = u.access?.reason === "past_due";
      const m = modal(`<h2>${pd ? "Your payment didn't go through" : "Choose your plan"}</h2>
        <p>${pd ? "Update your card to keep using the Highpoint desk. Your leads and notes are saved." : "Pick a plan to start using the Highpoint desk. Your leads stay private to your login."}</p>
        ${pd && b.hasCustomer ? `<div class="hpt-row" style="margin:12px 0"><button class="hpt-btn go" type="button" id="hptPortal">Update my card</button></div>` : plansHtml(b)}
        <div class="hpt-row" style="justify-content:space-between;margin-top:14px"><button class="hpt-btn sm" type="button" id="hptOut">Sign out</button><span class="hpt-muted">Questions? Contact your Highpoint admin.</span></div>`, { close: false, wide: !pd });
      $("#hptOut", m.el).onclick = signOut;
      wire(m.el, b);
      const pt = $("#hptPortal", m.el); if (pt) pt.onclick = () => portal(pt);
    });
  }

  /* ---------- billing window (from the account menu) ---------- */
  async function openBilling() {
    let b; try { b = await call("/api/billing/status"); } catch (e) { toast(e.message); return; }
    const u = window.hpUser || {};
    const label = { active: "Active", trialing: "Free trial", past_due: "Payment failed", canceled: "Canceled", unpaid: "Unpaid", incomplete: "Incomplete", none: "No subscription" }[b.status] || b.status;
    const tone = /active|trialing/.test(b.status) ? "ok" : b.status === "none" ? "" : "bad";
    const admin = u.owner || u.role === "admin";
    const free = b.comp ? "Your admin has given you free access." : admin ? "Admins always have full access." : !b.required ? "Billing isn't turned on for the team yet, so your admin's plan choice applies." : "";
    const m = modal(`<h2>Billing</h2>
      <div class="hpt-row" style="margin:6px 0 12px"><span class="hpt-pill">${esc(planName(admin ? "full" : b.plan))}</span>${admin ? "" : `<span class="hpt-pill ${tone}">${esc(label)}</span>`}${b.periodEnd && b.subscribed ? `<span class="hpt-muted">${b.status === "trialing" ? "Trial ends" : "Renews"} ${day(b.periodEnd)}</span>` : ""}</div>
      ${free ? `<p>${esc(free)}</p>` : ""}
      ${b.minutes && b.minutes.included != null ? `<div class="hpt-note" style="margin:0 0 12px"><b>Dialer minutes:</b> ${b.minutes.used.toLocaleString()} of ${b.minutes.included.toLocaleString()} used this month · resets ${day(b.minutes.resets)}${b.minutes.overage != null ? ` · extra minutes $${b.minutes.overage.toFixed(3).replace(/0$/, "")} each` : ""}</div>` : b.minutes ? `<p class="hpt-muted">Dialer minutes used this month: ${b.minutes.used.toLocaleString()}</p>` : ""}
      ${b.hasCustomer ? `<div class="hpt-row" style="margin:6px 0 4px"><button class="hpt-btn" type="button" id="hptPortal">Manage card and invoices</button></div>` : ""}
      ${admin ? "" : !b.connected && !b.subscribed ? `<p class="hpt-muted">Online payments aren't connected yet.</p>${plansHtml(b, { action: () => "Ask your admin" })}` : plansHtml(b)}`, { wide: !admin });
    if (b.connected || b.subscribed) wire(m.el, b); else m.el.querySelectorAll("[data-plan]").forEach((x) => (x.disabled = true));
    const pt = $("#hptPortal", m.el); if (pt) pt.onclick = () => portal(pt);
  }

  /* ---------- upgrade prompt for a feature your plan doesn't include ---------- */
  async function upgrade(feature) {
    let b; try { b = await call("/api/billing/status"); } catch (e) { toast(e.message); return; }
    const has = (b.plans || []).filter((p) => p.features.includes(feature) && p.available).map((p) => p.key);
    const names = has.filter((k) => k !== "early").map(planName);
    const m = modal(`<h2>${esc((FEAT_SHORT[feature] || feature).replace(/^the /, "").replace(/^./, (c) => c.toUpperCase()))} isn't in your plan</h2>
      <p>You're on <b>${esc(planName(b.plan))}</b>. ${names.length ? `${esc(FEAT[feature] || feature)} comes with ${esc(names.join(" and "))}.` : ""}${!b.subscribed && !b.connected ? " Ask your Highpoint admin to move you to a plan that includes it." : ""}</p>
      ${plansHtml(b, { only: has })}`, { wide: has.length > 2 });
    if (b.connected || b.subscribed) wire(m.el, b); else m.el.querySelectorAll("[data-plan]").forEach((x) => { x.disabled = true; x.textContent = "Ask your admin"; });
  }

  // lock icons on the menu for pages the plan doesn't include
  const LOCK = `<svg class="hpt-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`;
  function lockNav() {
    document.querySelectorAll(".rail .nav").forEach((n) => {
      const v = n.dataset.view || (n.id === "navGames" ? "games" : ""); if (!v) return;
      const f = viewFeature(v), locked = !!f && !can(f);
      n.classList.toggle("locked", locked);
      if (locked) { n.title = `${FEAT[f]} isn't in your plan`; if (!n.querySelector(".hpt-lock")) n.insertAdjacentHTML("beforeend", LOCK); } else n.querySelector(".hpt-lock")?.remove();
    });
  }
  // the Games button and anything else outside the desk's own page switch
  document.addEventListener("click", (e) => {
    const n = e.target.closest?.(".rail .nav.locked"); if (!n) return;
    const v = n.dataset.view || (n.id === "navGames" ? "games" : ""); const f = viewFeature(v); if (!f || can(f)) return;
    e.preventDefault(); e.stopImmediatePropagation(); upgrade(f);
  }, true);

  /* ---------- Security: password and two-step verification ---------- */
  function loadQr() { return window.QRCode ? Promise.resolve() : new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"; sc.onload = res; sc.onerror = rej; document.head.append(sc); }); }
  async function openSecurity() {
    let me = window.hpUser || {}; try { me = (await call("/api/auth/me")).user || me; window.hpUser = { ...window.hpUser, twofa: me.twofa }; } catch {}
    const m = modal(`<h2>Security</h2><div id="secBody"></div>`);
    const body = $("#secBody", m.el);
    const draw = () => {
      body.innerHTML = `<div class="hpt-sec"><h3>Two-step verification</h3>
          ${me.twofa ? `<p><span class="hpt-pill ok">On</span> Signing in needs your password and a code from your authenticator app.</p><div class="hpt-row"><button class="hpt-btn sm danger" type="button" id="tfOff">Turn off</button></div>`
            : `<p id="tfIntro">Add a code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…) when you sign in, so a stolen password isn't enough to open your clients' files.</p><div class="hpt-row" id="tfRow"><button class="hpt-btn go" type="button" id="tfOn">Turn on</button></div>`}
          <div id="tfStep"></div></div>
        <div class="hpt-sec"><h3>Change password</h3><div class="hpt-grid">
          <label>Current password<input class="hpt-in" id="pwCur" type="password" autocomplete="current-password"></label>
          <label>New password<input class="hpt-in" id="pwNew" type="password" autocomplete="new-password" placeholder="At least 8 characters"></label></div>
          <div class="hpt-row" style="margin-top:10px"><button class="hpt-btn" type="button" id="pwGo">Change password</button></div><div id="pwMsg"></div></div>`;
      const step = $("#tfStep", body);
      const on = $("#tfOn", body);
      if (on) on.onclick = async () => {
        on.disabled = true;
        try {
          const r = await call("/api/auth/2fa-setup", {});
          step.innerHTML = `<div class="hpt-note" style="margin-top:12px"><b>1.</b> In your authenticator app, add an account and scan this code.<div id="tfQr" style="background:#fff;padding:10px;border-radius:10px;width:max-content;margin:10px 0"></div>Can't scan? Enter this key: <code style="font:13px ui-monospace,Menlo,monospace;letter-spacing:.06em;user-select:all">${esc(r.secret.replace(/(.{4})/g, "$1 ").trim())}</code></div>
            <div class="hpt-row" style="margin-top:8px"><span><b>2.</b> Type the 6-digit code it shows:</span><input class="hpt-in" id="tfCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" style="width:110px;letter-spacing:.25em;text-align:center"><button class="hpt-btn go" type="button" id="tfGo">Turn on</button></div><div id="tfMsg"></div>`;
          try { await loadQr(); new window.QRCode($("#tfQr", step), { text: r.uri, width: 168, height: 168, colorDark: "#0b1220", colorLight: "#ffffff" }); } catch { $("#tfQr", step).remove(); }
          $("#tfCode", step).focus();
          const go = async () => {
            const b = $("#tfGo", step); b.disabled = true;
            try {
              const x = await call("/api/auth/2fa-enable", { code: $("#tfCode", step).value });
              me.twofa = true; window.hpUser = { ...window.hpUser, twofa: true };
              step.innerHTML = `<div class="hpt-note" style="margin-top:12px"><b>Two-step verification is on.</b> Save these recovery codes somewhere safe. Each one signs you in once if you lose your phone.<pre style="margin:10px 0;font:14px/1.7 ui-monospace,Menlo,monospace;columns:2;user-select:all">${x.recovery.map(esc).join("\n")}</pre><div class="hpt-row"><button class="hpt-btn sm" type="button" id="rcCopy">Copy</button><button class="hpt-btn sm" type="button" id="rcSave">Download</button></div></div>`;
              const txt = "Highpoint recovery codes for " + (me.email || "") + "\n\n" + x.recovery.join("\n") + "\n";
              $("#rcCopy", step).onclick = async () => { try { await navigator.clipboard.writeText(txt); toast("Copied"); } catch {} };
              $("#rcSave", step).onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain" })); a.download = "highpoint-recovery-codes.txt"; a.click(); };
              $("#tfIntro", body)?.remove(); $("#tfRow", body)?.remove();
            } catch (e) { b.disabled = false; $("#tfMsg", step).innerHTML = `<div class="hpt-err">${esc(e.message)}</div>`; }
          };
          $("#tfGo", step).onclick = go; $("#tfCode", step).onkeydown = (e) => { if (e.key === "Enter") go(); };
          $("#tfCode", step).oninput = (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); if (e.target.value.length === 6) go(); };
        } catch (e) { on.disabled = false; step.innerHTML = `<div class="hpt-err">${esc(e.message)}</div>`; }
      };
      const off = $("#tfOff", body);
      if (off) off.onclick = () => {
        step.innerHTML = `<div class="hpt-row" style="margin-top:10px"><input class="hpt-in" id="tfPw" type="password" placeholder="Your password" autocomplete="current-password" style="flex:1"><button class="hpt-btn danger" type="button" id="tfOffGo">Turn off two-step</button></div><div id="tfMsg"></div>`;
        $("#tfPw", step).focus();
        $("#tfOffGo", step).onclick = async () => { try { await call("/api/auth/2fa-disable", { password: $("#tfPw", step).value }); me.twofa = false; window.hpUser = { ...window.hpUser, twofa: false }; toast("Two-step verification is off"); draw(); } catch (e) { $("#tfMsg", step).innerHTML = `<div class="hpt-err">${esc(e.message)}</div>`; } };
      };
      $("#pwGo", body).onclick = async () => {
        const msg = $("#pwMsg", body);
        try { await call("/api/auth/password", { current: $("#pwCur", body).value, next: $("#pwNew", body).value }); msg.innerHTML = `<div class="hpt-note">Password changed.</div>`; $("#pwCur", body).value = $("#pwNew", body).value = ""; }
        catch (e) { msg.innerHTML = `<div class="hpt-err">${esc(e.message)}</div>`; }
      };
    };
    draw();
  }

  /* ---------- Team panel (admins) ---------- */
  const planOpts = (cur, withEarly = true) => Object.keys(PLAN_NAME).filter((k) => withEarly || k !== "early").map((k) => `<option value="${k}" ${cur === k ? "selected" : ""}>${PLAN_NAME[k]}</option>`).join("");
  async function openTeam(tab = "agents") {
    const m = modal(`<h2>Team</h2><p class="hpt-muted" style="margin:0 0 6px">Invite downlines, choose their plan, give free access, or turn accounts off.</p>
      <div class="hpt-tabs" role="tablist"><button type="button" data-t="agents">Agents</button><button type="button" data-t="invites">Invite links</button><button type="button" data-t="billing">Plans and billing</button></div><div id="hptBody"><p class="hpt-muted">Loading…</p></div>`, { wide: true });
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
        ${members.map((x) => `<tr data-id="${esc(x.id)}"><td><b>${esc(x.name || x.email)}</b>${x.twofa ? ` <span class="hpt-pill ok" title="Two-step verification is on">2-step</span>` : ""}<div class="hpt-muted">${esc(x.email)}</div></td>
          <td>${x.owner ? "Owner" : `<select data-k="role" aria-label="Role"><option value="agent" ${x.role !== "admin" ? "selected" : ""}>Agent</option><option value="admin" ${x.role === "admin" ? "selected" : ""}>Admin</option></select>`}</td>
          <td>${x.owner || x.role === "admin" ? "Full Access" : `<select data-k="plan" aria-label="Plan">${planOpts(x.access?.plan || "full")}</select>`}</td>
          <td>${stat(x)}</td>
          <td>${x.owner ? "—" : `<input type="checkbox" data-k="comp" ${x.comp ? "checked" : ""} aria-label="Free access">`}</td>
          <td class="hpt-muted">${x.lastSeen ? day(x.lastSeen) : "—"}</td>
          <td><span style="display:flex;gap:6px;flex-wrap:wrap">${x.twofa ? `<button class="hpt-btn sm" type="button" data-k="reset2fa" title="They lost their phone? This turns off two-step verification for their login.">Reset 2-step</button>` : ""}${x.owner ? "" : `<button class="hpt-btn sm" type="button" data-k="disabled" data-v="${x.disabled ? 0 : 1}">${x.disabled ? "Turn on" : "Turn off"}</button>`}</span></td></tr>`).join("")}
      </tbody></table></div><p class="hpt-muted" style="margin-top:10px">Turning an account off signs them out right away. Their leads stay saved, and you can turn them back on anytime. The plan here decides what an agent can use when they have free access or billing is off; agents who pay change their own plan in Billing.</p>`;
      el.querySelectorAll("tr[data-id]").forEach((tr) => {
        const id = tr.dataset.id, save = async (patch) => { try { await call("/api/team/member", { id, ...patch }); toast("Saved"); show("agents"); } catch (e) { toast(e.message); show("agents"); } };
        tr.querySelectorAll("select[data-k]").forEach((s) => s.onchange = () => save({ [s.dataset.k]: s.value }));
        tr.querySelectorAll("input[data-k=comp]").forEach((c) => c.onchange = () => save({ comp: c.checked }));
        tr.querySelectorAll("button[data-k=reset2fa]").forEach((b) => b.onclick = () => { if (confirm("Turn off two-step verification for this login? They can sign in with just their password and turn it back on in Security.")) save({ reset2fa: true }); });
        tr.querySelectorAll("button[data-k=disabled]").forEach((b) => b.onclick = () => { if (b.dataset.v === "1" && !confirm("Turn off this agent's account? They'll be signed out.")) return; save({ disabled: b.dataset.v === "1" }); });
      });
    }
    async function invites(el) {
      const { invites } = await call("/api/team/invites");
      el.innerHTML = `<h3>New invite link</h3><div class="hpt-grid">
          <label>Plan<select class="hpt-in" id="iPlan">${planOpts("full")}</select></label>
          <label>Role<select class="hpt-in" id="iRole"><option value="agent">Agent</option><option value="admin">Admin</option></select></label>
          <label>Uses<select class="hpt-in" id="iUses"><option value="1">One person</option><option value="">Unlimited</option><option value="10">Up to 10</option></select></label>
          <label>Expires<select class="hpt-in" id="iDays"><option value="7">In 7 days</option><option value="30">In 30 days</option><option value="">Never</option></select></label>
          <label>Note<input class="hpt-in" id="iNote" placeholder="e.g. Maria's team" maxlength="80"></label>
          <label>Email it to (optional)<input class="hpt-in" id="iEmail" type="email" placeholder="agent@example.com"></label>
          <label style="justify-content:flex-end"><span style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="iComp" style="accent-color:var(--accent)"> Free access</span></label></div>
        <div class="hpt-row" style="margin-top:10px"><button class="hpt-btn go" type="button" id="iGo">Create invite link</button></div><div id="iNew"></div>
        <h3>Active links</h3>${invites.length ? invites.map((i) => `<div class="hpt-link"><code>${esc(i.url)}</code><span class="hpt-pill">${esc(planName(i.plan === "pro" ? "full" : i.plan === "starter" ? "base" : i.plan))}${i.role === "admin" ? " · Admin" : ""}${i.comp ? " · Free" : ""}</span><span class="hpt-muted">${i.uses}${i.max_uses ? "/" + i.max_uses : ""} used${i.expires ? " · until " + day(i.expires) : ""}${i.note ? " · " + esc(i.note) : ""}</span><button class="hpt-btn sm" type="button" data-copy="${esc(i.url)}">Copy</button><button class="hpt-btn sm" type="button" data-rev="${esc(i.code)}">Revoke</button></div>`).join("") : `<p class="hpt-muted">No active links yet.</p>`}`;
      const copy = async (t) => { try { await navigator.clipboard.writeText(t); toast("Link copied"); } catch { prompt("Copy this link:", t); } };
      $("#iGo", el).onclick = async () => {
        try {
          const to = $("#iEmail", el).value.trim();
          const r = await call("/api/team/invite", { plan: $("#iPlan", el).value, role: $("#iRole", el).value, maxUses: $("#iUses", el).value, days: $("#iDays", el).value, note: $("#iNote", el).value, comp: $("#iComp", el).checked, email: to });
          if (to && r.emailed) toast(`Invite emailed to ${to}`); else { await copy(r.url); if (to) toast("Email isn't set up yet, so the link was copied instead"); }
          show("invites");
        } catch (e) { $("#iNew", el).innerHTML = `<div class="hpt-err">${esc(e.message)}</div>`; }
      };
      el.querySelectorAll("[data-copy]").forEach((b) => b.onclick = () => copy(b.dataset.copy));
      el.querySelectorAll("[data-rev]").forEach((b) => b.onclick = async () => { if (!confirm("Revoke this link? Nobody new can join with it.")) return; await call("/api/team/revoke", { code: b.dataset.rev }); show("invites"); });
    }
    async function billing(el) {
      const s = await call("/api/team/settings");
      const names = s.featureNames || {}, feats = Object.keys(names);
      const iso = (t) => (t ? new Date(t).toISOString().slice(0, 10) : "");
      const ended = !s.early.on || (s.early.ends && s.early.ends <= Date.now());
      el.innerHTML = `${s.connected ? `<p><span class="hpt-pill ok">Stripe connected${s.testMode ? " · test mode" : ""}</span>${s.webhook ? ` <span class="hpt-muted">Payment updates arrive at ${esc(s.webhook)}</span>` : ` <span class="hpt-muted">Payment updates connect automatically on the first checkout.</span>`}</p>` : `<div class="hpt-err">Stripe isn't connected yet. In Cloudflare → Workers &amp; Pages → highpoint-dialer → Settings → Variables and Secrets, add a <b>Secret</b> named <code>STRIPE_SECRET_KEY</code> (from Stripe → Developers → API keys) for Production, then redeploy. The plans and prices below are created in Stripe for you on the first checkout.</div>`}
        <div class="hpt-sec"><h3>Prices (per agent, per month)</h3><div class="hpt-grid">
          ${["early", "base", "plus", "full"].map((k) => `<label>${PLAN_NAME[k]}<input class="hpt-in" data-price="${k}" type="number" min="1" value="${esc(s.prices[k])}"></label>`).join("")}</div>
          <div class="hpt-grid" style="margin-top:10px">
          <label>Free trial (days)<input class="hpt-in" id="bT" type="number" min="0" max="60" value="${esc(s.trialDays)}"></label>
          <label>New agents start on<select class="hpt-in" id="bD">${planOpts(s.defaultPlan)}</select></label></div>
          <label class="hpt-chk"><input type="checkbox" id="bR" ${s.required ? "checked" : ""}><span><b>Require payment.</b> Agents without an active subscription (and without free access) see the plan screen instead of the desk. Admins and free-access agents are never locked out.</span></label></div>
        <div class="hpt-sec"><h3>Early access</h3>
          <label class="hpt-chk" style="margin-top:0"><input type="checkbox" id="eOn" ${s.early.on ? "checked" : ""}><span><b>Early access is open.</b> New agents can join at ${money(s.prices.early)}/month with everything in Full Access.</span></label>
          <div class="hpt-grid"><label>Ends on (optional)<input class="hpt-in" id="eEnds" type="date" value="${esc(iso(s.early.ends))}"></label></div>
          <p class="hpt-muted" style="margin:10px 0 0">${s.earlyMembers} agent${s.earlyMembers === 1 ? " is" : "s are"} on Early Access.${ended && s.early.endedTo ? ` Early access ended ${day(s.early.ends)}${s.early.endedTo === "keep" ? "; early members kept their price." : `; early members moved to ${planName(s.early.endedTo)}.`}` : ""}</p>
          ${s.earlyMembers ? `<div class="hpt-row" style="margin-top:10px"><span class="hpt-muted">End early access and move them to</span><select class="hpt-in" id="eTo"><option value="full">Full Access (${money(s.prices.full)})</option><option value="plus">Pro (${money(s.prices.plus)})</option><option value="base">Base (${money(s.prices.base)})</option><option value="keep">Keep their ${money(s.prices.early)} price</option></select><button class="hpt-btn danger sm" type="button" id="eEnd">End early access</button></div>
            <p class="hpt-muted" style="margin:6px 0 0">Each subscription switches from its next renewal, with no extra charge for the month they already paid.</p>` : ""}</div>
        <div class="hpt-sec"><h3>Dialer minutes per month</h3><div class="hpt-grid">
          ${["early", "base", "plus", "full"].map((k) => `<label>${PLAN_NAME[k]}<input class="hpt-in" data-min="${k}" type="number" min="0" step="100" placeholder="No limit" value="${s.minutes[k] == null ? "" : esc(s.minutes[k])}"></label>`).join("")}</div>
          <p class="hpt-muted" style="margin:8px 0 0">Each connected call counts, rounded up to the minute. Leave blank for no limit. Limits only apply once payment is required; admins and free-access agents are never limited.</p>
          <label class="hpt-chk"><input type="checkbox" id="ovOn" ${s.overage.on ? "checked" : ""} ${s.connected ? "" : "disabled"}><span><b>Bill extra minutes instead of stopping.</b> Agents keep dialing past their plan's minutes and Stripe adds each extra minute to their next bill at <input class="hpt-in" id="ovRate" type="number" min="0.001" step="0.005" value="${esc(s.overage.rate)}" style="width:86px;display:inline-block;margin:0 4px"> dollars a minute.${s.connected ? "" : " (Connect Stripe first.)"}</span></label></div>
        <div class="hpt-sec"><h3>What each plan includes</h3><div class="hpt-wrap"><table class="hpt-tbl mx"><thead><tr><th>Feature</th><th>Base</th><th>Pro</th><th>Full / Early</th></tr></thead><tbody>
          ${feats.map((f) => `<tr><td>${esc(FEAT[f] || names[f])}</td>${["base", "plus"].map((p) => `<td><input type="checkbox" data-mx="${p}" value="${f}" ${f === "crm" || s.features[p].includes(f) ? "checked" : ""} ${f === "crm" ? "disabled" : ""} aria-label="${esc(PLAN_NAME[p] + ": " + (FEAT[f] || f))}"></td>`).join("")}<td><input type="checkbox" checked disabled aria-label="Full Access includes it"></td></tr>`).join("")}
          </tbody></table></div></div>
        <div class="hpt-row"><button class="hpt-btn go" type="button" id="bGo">Save</button></div><div id="bMsg"></div>
        <p class="hpt-muted" style="margin-top:10px">Price changes apply to new subscriptions and plan switches. Existing subscribers keep their price until they change plans.</p>`;
      $("#bGo", el).onclick = async () => {
        const prices = {}; el.querySelectorAll("[data-price]").forEach((i) => (prices[i.dataset.price] = +i.value));
        const features = { base: [], plus: [] }; el.querySelectorAll("[data-mx]:checked").forEach((c) => features[c.dataset.mx].push(c.value));
        const minutes = {}; el.querySelectorAll("[data-min]").forEach((i) => (minutes[i.dataset.min] = i.value === "" ? null : +i.value));
        try {
          await call("/api/team/settings", { prices, features, minutes, ...(s.connected ? { overage: { on: $("#ovOn", el).checked, rate: +$("#ovRate", el).value } } : {}), trialDays: +$("#bT", el).value, defaultPlan: $("#bD", el).value, required: $("#bR", el).checked, early: { on: $("#eOn", el).checked, ends: $("#eEnds", el).value || null } });
          toast("Saved"); show("billing");
        } catch (e) { $("#bMsg", el).innerHTML = `<div class="hpt-err">${esc(e.message)}</div>`; }
      };
      const end = $("#eEnd", el);
      if (end) end.onclick = async () => {
        const to = $("#eTo", el).value;
        if (!confirm(to === "keep" ? `End early access? Nobody new can join at ${money(s.prices.early)}, and current early members keep their price.` : `End early access and move ${s.earlyMembers} early member${s.earlyMembers === 1 ? "" : "s"} to ${planName(to)} (${money(s.prices[to])}/month) from their next renewal?`)) return;
        end.disabled = true; end.textContent = "Ending…";
        try { const r = await call("/api/team/early-end", { moveTo: to }); toast(to === "keep" ? "Early access ended" : `Moved ${r.moved} to ${planName(to)}`); if (r.failed?.length) alert("Some couldn't be moved:\n" + r.failed.join("\n")); show("billing"); }
        catch (e) { end.disabled = false; end.textContent = "End early access"; $("#bMsg", el).innerHTML = `<div class="hpt-err">${esc(e.message)}</div>`; }
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
    window.hpUser = u; lockNav();
    return u;
  }
  window.hpTeam = { ready, openBilling, openTeam, openSecurity, upgrade, can, viewLocked, viewFeature, lockNav, planName };
})();
