/* My scripts: agents bring their own call scripts (paste, or upload .txt / .md / .docx / .html).
   A script is stored as stages of lines, the same shape as the built-in FEX script, so it shows on the Scripts page,
   in the script pop-out, fills {name} {agent} {address} {dob} {premium}... from the client, and (optionally) follows the live call.
   Stored in the agent's own synced database; a copy is kept in this browser so it still works offline. */
(() => {
  if (window.hpMyScripts) return;
  const KEY = "hp.myscripts";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const toast = (m) => { const t = document.getElementById("toast"); if (!t) return; t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600); };

  let items = lsGet(KEY, []).filter((x) => x && x.id && Array.isArray(x.stages));
  const subs = new Set();
  let col = null;
  const emit = () => subs.forEach((f) => { try { f(items); } catch {} });
  const mirror = () => lsSet(KEY, items);

  (async () => {
    try {
      const db = await window.claude?.use?.("db"); if (!db) return;
      col = db.collection("scripts");
      col.onSnapshot((snap) => {
        const next = []; snap.docs.forEach((d) => { const v = d.data(); if (v && Array.isArray(v.stages)) next.push({ ...v, id: d.id }); });
        // scripts saved before the database answered stay until it has them
        const have = new Set(next.map((x) => x.id));
        items = [...next, ...items.filter((x) => x.local && !have.has(x.id))].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
        mirror(); emit();
        items.filter((x) => x.local).forEach((x) => col.doc(x.id).set(strip(x)).then(() => { x.local = false; mirror(); }).catch(() => {}));
      }, () => {});
    } catch { col = null; }
  })();

  const strip = (s) => { const { id, local, ...rest } = s; return rest; };

  /* ---------- turning pasted text into stages ---------- */
  const NOTE_RE = /^(?:(?:note|notes|tip|agent note|stage direction|direction)\s*[:\-–]|pause\b|\([^)]*\)$|\[[^\]]{21,}\]$)/i;
  const OBJ_RE = /^(?:objection|obj|client says|if they say|if client says|they say)\s*[:\-–]/i;
  const HEAD_RE = /^(?:#{1,2}\s+|stage\s*\d*\s*[:\-–]\s*|step\s*\d+\s*[:\-–.]\s*|part\s*\d+\s*[:\-–.]\s*|section\s*[:\-–]\s*)(.+)$/i;
  const SUB_RE = /^(?:#{3,6}\s+)(.+)$/;
  const isCapsHead = (l) => l.length >= 3 && l.length <= 48 && /[A-Z]/.test(l) && l === l.toUpperCase() && !/[.?!,]$/.test(l) && /^[A-Z0-9 &/'’\-–:]+$/.test(l);
  const clean = (s) => s.replace(/ /g, " ").replace(/[ \t]+/g, " ").trim();
  // [name] and <name> become {name}; the fields the desk knows how to fill are left as they are
  const braces = (s) => s.replace(/\[([A-Za-z][A-Za-z ]{0,20})\]/g, (m, k) => "{" + k.toLowerCase().trim() + "}").replace(/<([A-Za-z][A-Za-z ]{0,20})>/g, (m, k) => "{" + k.toLowerCase().trim() + "}");

  function parse(text, fallbackTitle) {
    const raw = String(text || "").replace(/\r/g, "").split("\n");
    const stages = []; let cur = null, buf = [];
    const stage = (title) => { cur = { title: clean(title).replace(/[:\-–]\s*$/, "") || "Script", items: [] }; stages.push(cur); };
    const add = (k, x) => { x = clean(x); if (!x) return; if (!cur) stage(fallbackTitle || "Script"); cur.items.push({ k, x: braces(x) }); };
    const flush = () => { if (!buf.length) return; add(kind(buf[0]), strip2(buf.join(" "))); buf = []; };
    const kind = (l) => OBJ_RE.test(l) ? "obj" : NOTE_RE.test(l) ? "note" : "say";
    const strip2 = (l) => l.replace(OBJ_RE, "").replace(/^(?:notes?|tip|agent note|stage direction|direction)\s*[:\-–]\s*/i, "").replace(/^[•·▪◦*]\s+/, "").replace(/^>\s*/, "");
    for (let line of raw) {
      line = clean(line);
      if (!line) { flush(); continue; }
      let m;
      if ((m = line.match(SUB_RE))) { flush(); add("h", m[1]); continue; }
      if ((m = line.match(HEAD_RE))) { flush(); stage(m[1]); continue; }
      if (isCapsHead(line)) { flush(); stage(line.replace(/:$/, "").toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())); continue; }
      if (/^[•·▪◦*\-–]\s+/.test(line) || /^\d+[.)]\s+/.test(line) || OBJ_RE.test(line) || NOTE_RE.test(line) || /^>/.test(line)) { flush(); buf.push(line.replace(/^(?:[•·▪◦*\-–]|\d+[.)])\s+/, "")); flush(); continue; }
      buf.push(line);
    }
    flush();
    return stages.filter((s) => s.items.length);
  }
  const count = (stages) => stages.reduce((n, s) => n + s.items.filter((i) => i.k === "say").length, 0);

  /* ---------- reading files ---------- */
  async function inflate(bytes) {
    const ds = new DecompressionStream("deflate-raw");
    const out = new Response(new Blob([bytes]).stream().pipeThrough(ds));
    return new Uint8Array(await out.arrayBuffer());
  }
  async function docxText(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let i = u8.length - 22; while (i >= 0 && dv.getUint32(i, true) !== 0x06054b50) i--;
    if (i < 0) throw new Error("That doesn't look like a Word file.");
    let p = dv.getUint32(i + 16, true); const n = dv.getUint16(i + 10, true);
    for (let k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl));
      if (name === "word/document.xml") {
        const lnl = dv.getUint16(off + 26, true), lel = dv.getUint16(off + 28, true), start = off + 30 + lnl + lel;
        const data = u8.subarray(start, start + csize);
        const xml = new TextDecoder().decode(method === 0 ? data : await inflate(data));
        return xml.replace(/<w:tab\/>/g, " ").replace(/<w:br[^>]*\/>/g, "\n").replace(/<\/w:p>/g, "\n\n").replace(/<[^>]+>/g, "")
          .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
      }
      p += 46 + nl + el + cl;
    }
    throw new Error("Couldn't find the text in that Word file.");
  }
  async function readFile(file) {
    const n = (file.name || "").toLowerCase();
    if (file.size > 3e6) throw new Error("That file is too big for a script (3 MB max).");
    if (n.endsWith(".docx")) return docxText(await file.arrayBuffer());
    if (n.endsWith(".pdf") || n.endsWith(".doc")) throw new Error("PDF and old .doc files can't be read here. Save it as .docx or .txt, or paste the text.");
    let t = await file.text();
    if (/\.(html?|rtf)$/.test(n)) t = t.replace(/<(?:br|\/p|\/div|\/li|\/h\d)[^>]*>/gi, "\n").replace(/<[^>]+>/g, "").replace(/\\par\b/g, "\n").replace(/\\[a-z]+-?\d* ?|[{}]/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
    return t;
  }

  /* ---------- storage ---------- */
  async function save(s) {
    const rec = { id: s.id || uid(), name: clean(s.name || "My script").slice(0, 60), product: ["FE", "MP", "IUL"].includes(s.product) ? s.product : "", stages: s.stages, source: s.source || "", updatedAt: Date.now() };
    const i = items.findIndex((x) => x.id === rec.id);
    // a script marked as the default for a product takes that spot from any other
    if (rec.product) items.forEach((x) => { if (x.id !== rec.id && x.product === rec.product) { x.product = ""; col?.doc(x.id).set(strip(x)).catch(() => {}); } });
    if (i >= 0) items[i] = rec; else items.push(rec);
    items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    mirror(); emit();
    if (col) { try { await col.doc(rec.id).set(strip(rec)); } catch { rec.local = true; mirror(); } } else { rec.local = true; mirror(); }
    return rec;
  }
  async function remove(id) {
    items = items.filter((x) => x.id !== id); mirror(); emit();
    try { await col?.doc(id).delete(); } catch {}
  }

  /* ---------- the import window ---------- */
  function css() {
    if (document.getElementById("hpmsCss")) return;
    const st = document.createElement("style"); st.id = "hpmsCss";
    st.textContent = `.hpms-bg{position:fixed;inset:0;z-index:2000;background:rgba(3,6,12,.62);display:grid;place-items:center;padding:12px}
.hpms{width:min(760px,100%);max-height:calc(100vh - 24px);overflow:auto;border-radius:18px;background:var(--bg2,#0b1220);color:var(--ink,#eaf0fb);border:1px solid var(--line,rgba(255,255,255,.14));box-shadow:0 24px 70px rgba(0,0,0,.5);padding:18px;display:flex;flex-direction:column;gap:12px}
.hpms h3{margin:0;font-size:18px}.hpms p{margin:0;font-size:13px;opacity:.78}
.hpms label{display:flex;flex-direction:column;gap:5px;font-size:12.5px}
.hpms input[type=text],.hpms select,.hpms textarea{all:unset;box-sizing:border-box;width:100%;padding:9px 11px;border-radius:10px;background:rgba(255,255,255,.06);border:1px solid var(--line,rgba(255,255,255,.14));font-size:14px}
.hpms textarea{min-height:200px;max-height:42vh;overflow:auto;white-space:pre-wrap;font-size:13.5px;line-height:1.45}
.hpms .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.hpms .sp{flex:1}
.hpms .prev{border:1px solid var(--line,rgba(255,255,255,.12));border-radius:12px;padding:10px 12px;font-size:13px;max-height:200px;overflow:auto;background:rgba(0,0,0,.18)}
.hpms .prev b{display:block;margin-top:6px}.hpms .prev b:first-child{margin-top:0}.hpms .prev span{opacity:.65;font-weight:400}
.hpms details{font-size:12.5px;opacity:.85}.hpms details pre{white-space:pre-wrap;margin:6px 0 0;font:inherit;opacity:.85}
.hpms .err{color:#ff9a9a;font-size:13px}`;
    document.head.append(st);
  }
  const EXAMPLE = `INTRO
Hey {name}? This is {agent} with Highpoint Financial, calling about the final expense request you sent in.
Note: Smile and slow down.
Is this still a good number for you?

OBJECTIONS
Objection: I already have coverage
That's great, what company is it with and how much does it pay?

CLOSE
Based on what you told me, {plan} for {face} is {premium} a month. Which day works for the draft?`;

  function openImport(existing) {
    css();
    const ed = existing ? { ...existing } : null;
    const bg = document.createElement("div"); bg.className = "hpms-bg";
    bg.innerHTML = `<div class="hpms" role="dialog" aria-modal="true" aria-label="${ed ? "Edit script" : "Import a script"}">
      <h3>${ed ? "Edit script" : "Import your own script"}</h3>
      <p>Paste your script or upload a Word (.docx), text, Markdown or HTML file. Headings (a line in CAPS, <b>#</b>, or <b>Stage 2: Name</b>) start a new stage. <b>Note:</b> lines are for you only, <b>Objection:</b> lines mark a rebuttal, everything else is read aloud. Use <b>{name}</b>, <b>{agent}</b>, <b>{address}</b>, <b>{dob}</b>, <b>{premium}</b> and <b>{face}</b> to fill in the client's details; <b>[name]</b> works too.</p>
      <div class="row"><label style="flex:2;min-width:200px">Name<input type="text" id="hpmsName" maxlength="60" placeholder="My final expense script" value="${esc(ed?.name || "")}"></label>
        <label style="flex:1;min-width:170px">Default for<select id="hpmsProd"><option value="">Just keep it</option><option value="FE">Final expense leads</option><option value="MP">Mortgage protection leads</option><option value="IUL">IUL leads</option></select></label></div>
      <div class="row"><label class="btn" style="cursor:pointer">Upload a file<input type="file" id="hpmsFile" accept=".txt,.md,.markdown,.docx,.html,.htm,.rtf,text/plain" hidden></label><button type="button" class="btn" id="hpmsEx">Try an example</button><span class="sp"></span><span class="err" id="hpmsErr"></span></div>
      <label>Script text<textarea id="hpmsText" spellcheck="false" placeholder="Paste your script here"></textarea></label>
      <div class="prev" id="hpmsPrev"></div>
      <div class="row"><button type="button" class="btn" id="hpmsCancel">Cancel</button><span class="sp"></span><button type="button" class="btn primary" id="hpmsSave">Save script</button></div></div>`;
    document.body.append(bg);
    const $ = (s) => bg.querySelector(s);
    $("#hpmsProd").value = ed?.product || "";
    const toText = (stages) => stages.map((s) => s.title.toUpperCase() + "\n" + s.items.map((i) => (i.k === "note" ? "Note: " : i.k === "obj" ? "Objection: " : i.k === "h" ? "### " : "") + i.x).join("\n\n")).join("\n\n");
    $("#hpmsText").value = ed ? ed.source || toText(ed.stages) : "";
    const draw = () => {
      const stages = parse($("#hpmsText").value, $("#hpmsName").value);
      $("#hpmsPrev").innerHTML = stages.length
        ? `<b>${stages.length} stage${stages.length === 1 ? "" : "s"} · ${count(stages)} lines to read</b>` + stages.map((s) => `<b>${esc(s.title)} <span>${s.items.filter((i) => i.k === "say").length} lines${s.items.some((i) => i.k === "obj") ? " · rebuttals" : ""}</span></b>`).join("")
        : `<span>Nothing to preview yet. Paste a script or upload a file.</span>`;
      return stages;
    };
    const close = () => { bg.remove(); document.removeEventListener("keydown", esc2, true); };
    const esc2 = (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("keydown", esc2, true);
    bg.addEventListener("mousedown", (e) => { if (e.target === bg) close(); });
    $("#hpmsText").addEventListener("input", draw);
    $("#hpmsEx").onclick = () => { $("#hpmsText").value = EXAMPLE; if (!$("#hpmsName").value) $("#hpmsName").value = "Example script"; draw(); };
    $("#hpmsFile").onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = ""; if (!f) return;
      $("#hpmsErr").textContent = "";
      try {
        $("#hpmsText").value = (await readFile(f)).replace(/\n{3,}/g, "\n\n").trim();
        if (!$("#hpmsName").value) $("#hpmsName").value = f.name.replace(/\.[^.]+$/, "").slice(0, 60);
        draw();
      } catch (er) { $("#hpmsErr").textContent = er.message || "Couldn't read that file."; }
    };
    $("#hpmsCancel").onclick = close;
    $("#hpmsSave").onclick = async () => {
      const stages = draw(), name = $("#hpmsName").value.trim();
      if (!name) { $("#hpmsErr").textContent = "Give the script a name."; $("#hpmsName").focus(); return; }
      if (!count(stages)) { $("#hpmsErr").textContent = "There are no lines to read in that text."; return; }
      const rec = await save({ id: ed?.id, name, product: $("#hpmsProd").value, stages, source: $("#hpmsText").value.slice(0, 120000) });
      close(); toast(`Saved “${rec.name}”`);
    };
    draw(); setTimeout(() => $("#hpmsText").focus(), 0);
  }

  window.hpMyScripts = {
    list: () => items.slice(),
    get: (id) => items.find((x) => x.id === id) || null,
    forProduct: (p) => items.find((x) => x.product === p) || null,
    save, remove, parse, openImport, onChange: (f) => { subs.add(f); return () => subs.delete(f); },
  };
})();
