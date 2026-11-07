/* WAVV (embedded dialer) — the browser half. The server half is src/wavv/wavv.mjs.
   Does nothing at all until the owner adds WAVV_SDK_KEY in Cloudflare (GET /api/wavv/status says so).
   Once it is on:
     - every page load mints one single-use token from /api/wavv/token and hands it to WAVV's init()
     - lead cards get "Call with WAVV" and "Text with WAVV" buttons (the SDK can compose a text but never sends it)
     - WAVV asking to show a contact (screen pop, a click inside WAVV) opens that lead's card
     - WAVV calls drive the same hp:callstart / hp:callend events as the built-in dialer, and `connected`
       tells the music dock to pause only while a person is actually on the line
     - WAVV can search the desk's leads from its own search box
   The SDK itself is WAVV's MIT-licensed @wavv/sdk, compiled from source into /vendor/wavv-sdk. */
(() => {
  if (window.hpWavv) return;
  const desk = () => window.hpDesk;
  const toast = (m, ms) => { try { desk()?.toast?.(m, ms); } catch {} };
  const digits = (s) => { let d = String(s || "").replace(/\D/g, ""); if (d.length === 11 && d[0] === "1") d = d.slice(1); return d; };

  let sdk = null, starting = null, status = null;
  const answered = new Set(), live = new Set(); // WAVV call ids
  const W = {
    get available() { return !!status?.configured; },
    get ready() { return !!sdk; },
    get active() { return live.size > 0; },
    // a person is on the line (answered and not yet ended). A ringing lead does not count.
    get connected() { return [...answered].some((id) => live.has(id)); },
    start, callLead, textLead, callList, show, decorate,
  };
  window.hpWavv = W;

  async function http(path, body) {
    const r = await fetch("/api/wavv" + path, { method: body ? "POST" : "GET", credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? "{}" : undefined, cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || "WAVV request failed (" + r.status + ")"), { status: r.status });
    return j;
  }

  function contactOf(l) {
    const first = l.first || "", last = l.last || "";
    return {
      id: String(l.id), name: (first + " " + last).trim() || desk()?.fullName?.(l) || "Lead", number: digits(l.phone),
      firstName: first || undefined, lastName: last || undefined, address: l.address || undefined, city: l.city || undefined, state: l.state || undefined, zip: l.zip || undefined,
    };
  }

  function wire(m) {
    const seen = (c) => c?.callId || c?.number || "";
    m.dialer.onCallStarted((c) => { live.add(seen(c)); window.dispatchEvent(new Event("hp:callstart")); });
    m.dialer.onCallIncoming((c) => { live.add(seen(c)); window.dispatchEvent(new Event("hp:callstart")); });
    m.dialer.onCallAnswered((c) => { live.add(seen(c)); answered.add(seen(c)); });
    m.dialer.onCallEnded((c) => {
      const id = seen(c); live.delete(id); answered.delete(id);
      if (!live.size) window.dispatchEvent(new Event("hp:callend"));
    });
    // WAVV owns dispositions. A Do Not Call outcome also goes on the desk's lead so no other dialer rings it.
    m.dialer.onDispositionSet((d) => {
      const lead = d.contactId && desk()?.leads?.get?.(d.contactId);
      if (lead && /do.?not.?call|dnc/i.test([d.category, d.name, d.tag].join(" ")) && !lead.dnc) desk().patchLead(lead.id, { dnc: true }).catch(() => {});
    });
    // screen pop and clicks inside WAVV: put the lead on screen (leads that aren't in this book are ignored)
    m.onOpenContact(({ contactId }) => { if (desk()?.leads?.get?.(contactId)) desk().openDrawer(contactId); });
    // WAVV's own search box finds this desk's leads
    m.onContactSearch(({ query }) => {
      const q = String(query || "").toLowerCase().trim(), qd = digits(q);
      if (q.length < 2) return [];
      const out = [];
      for (const l of desk()?.leads?.values?.() || []) {
        if (l.dnc || !digits(l.phone)) continue;
        const name = ((l.first || "") + " " + (l.last || "")).toLowerCase();
        if (name.includes(q) || (qd.length >= 3 && digits(l.phone).includes(qd))) { out.push(contactOf(l)); if (out.length >= 20) break; }
      }
      return out;
    });
  }

  // One start per page: status -> import the SDK -> mint a token -> init. A failed start can be retried.
  function start() {
    if (sdk) return Promise.resolve(sdk);
    if (starting) return starting;
    starting = (async () => {
      status = status || await http("/status");
      if (!status.configured) throw new Error("WAVV isn't connected yet.");
      const m = await import("/vendor/wavv-sdk/index.js");
      const { token } = await http("/token", true);
      await m.init({ token });
      wire(m);
      sdk = m;
      return m;
    })().catch((e) => { starting = null; throw e; });
    return starting;
  }

  async function guard(fn) {
    try { const m = await start(); return await fn(m); }
    catch (e) { toast(typeof e === "string" ? "WAVV: " + e : e?.message || "WAVV couldn't start."); return false; }
  }

  function callLead(l) {
    if (!l) return false;
    if (!digits(l.phone)) { toast("No phone number on this lead"); return false; }
    if (l.dnc) { toast("This number is on Do Not Call"); return false; }
    if (window.hpDialer?.busy) { toast("Finish the current call first"); return false; }
    return guard(async (m) => { await m.dialer.call({ contact: contactOf(l) }); return true; });
  }
  function textLead(l, body) {
    if (!l || !digits(l.phone)) { toast("No phone number on this lead"); return false; }
    if (l.dnc) { toast("This number is on Do Not Call"); return false; }
    return guard(async (m) => { await m.messenger.compose({ contact: contactOf(l), body }); return true; });
  }
  // a small saved call list (WAVV recommends REST for big ones)
  function callList(name, leads) {
    const contacts = (leads || []).filter((l) => l && !l.dnc && digits(l.phone)).slice(0, 200).map(contactOf);
    if (!contacts.length) { toast("No callable leads in that list"); return false; }
    return guard(async (m) => { await m.dialer.createCallList({ name: String(name || "Highpoint list").slice(0, 80), contacts, show: true }); return contacts.length; });
  }
  function show(what) {
    return guard(async (m) => {
      if (what === "messenger") return m.messenger.show();
      if (what === "callboards") return m.callboards.show();
      if (what === "history") return m.show("CALL_HISTORY");
      return m.dialer.show();
    });
  }

  // Lead card buttons. desk-app.js calls this each time the drawer opens.
  function decorate(l) {
    if (!status?.configured || !l?.id) return;
    const head = document.querySelector("#drawer .dh");
    if (!head || head.querySelector(".hpw-row")) return;
    const row = document.createElement("div");
    row.className = "hpw-row";
    row.style.cssText = "display:flex;gap:6px;margin-top:8px";
    const mk = (label, title, fn) => { const b = document.createElement("button"); b.type = "button"; b.className = "btn sm"; b.textContent = label; b.title = title; b.onclick = fn; return b; };
    const call = mk("Call with WAVV", "Dial this lead in the WAVV dialer", async (e) => { const b = e.currentTarget; b.disabled = true; try { await callLead(l); } finally { b.disabled = false; } });
    const text = mk("Text with WAVV", "Open a WAVV text to this lead. You press send.", () => textLead(l));
    row.append(call, text);
    (head.firstElementChild || head).append(row);
  }

  // The Dial page: a WAVV bar above the dialer home. renderHome() rewrites #hpdHome every 15 s, so the bar is its own sibling.
  function queueNow() { try { return (window.hpDialer?.queue?.() || desk()?.dialQueue?.() || []).slice(); } catch { return []; } }
  function mountBar() {
    if (!status?.configured) return;
    const home = document.getElementById("hpdHome");
    if (!home) return;
    let bar = document.getElementById("hpwBar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "hpwBar"; bar.className = "hpd";
      bar.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 14px;margin:0 0 10px;border-radius:14px;border:1px solid var(--hp-line,rgba(255,255,255,.12));background:rgba(255,255,255,.04)";
      bar.innerHTML = '<b style="margin-right:6px">WAVV</b><span class="muted" id="hpwState" style="font-size:12px;margin-right:auto">Starting…</span>'
        + '<button type="button" class="btn primary sm" data-w="open">Open WAVV dialer</button>'
        + '<button type="button" class="btn sm" data-w="queue" title="Put today\'s call queue into WAVV as a call list">Send queue to WAVV</button>'
        + '<button type="button" class="btn sm" data-w="messenger">Messages</button>'
        + '<button type="button" class="btn sm" data-w="history">Call history</button>';
      bar.addEventListener("click", async (e) => {
        const b = e.target.closest("[data-w]"); if (!b) return;
        b.disabled = true;
        try {
          const w = b.dataset.w;
          if (w === "queue") {
            const q = queueNow();
            const n = await callList("Highpoint queue " + new Date().toLocaleDateString(), q);
            if (n) toast(n + " leads sent to WAVV" + (q.length > 200 ? " (first 200)" : ""));
          } else await show(w === "open" ? "dialer" : w);
        } finally { b.disabled = false; }
      });
      (document.getElementById("hphMusic") || home).insertAdjacentElement("beforebegin", bar);
      new MutationObserver(() => { bar.hidden = home.hidden; }).observe(home, { attributes: true, attributeFilter: ["hidden"] });
    }
    bar.hidden = home.hidden;
    const st = bar.querySelector("#hpwState");
    const want = sdk ? "Connected" : "Connecting…";
    if (st && st.textContent !== want && !st.dataset.err) st.textContent = want; // only on change, or the observer would loop on its own write
  }
  new MutationObserver(() => mountBar()).observe(document.body, { childList: true, subtree: true });

  // learn at idle whether WAVV is on; if it is, get the SDK running so screen pops and call events work from the start
  async function boot() {
    try { status = await http("/status"); } catch { return; }
    mountBar();
    if (status.configured) start().then(mountBar, () => { const st = document.querySelector("#hpwState"); if (st) { st.dataset.err = "1"; st.textContent = "Couldn't connect. Press Open WAVV dialer to see why."; } });
  }
  if ("requestIdleCallback" in window) requestIdleCallback(boot, { timeout: 4000 }); else setTimeout(boot, 1500);
})();
