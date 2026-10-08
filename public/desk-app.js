(()=>{
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const money=(n,d=0)=>isFinite(n)?"$"+Number(n).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d}):"—";
const ls={get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch{return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}};
const STAGES=[["new","New","var(--muted)"],["contacted","Contacted","var(--info)"],["appointment","Appointment","var(--warn)"],["application","Application","var(--accent)"],["sold","Sold","var(--ok)"],["lost","Not interested","var(--bad)"]];
const stageName=id=>(STAGES.find(s=>s[0]===id)||STAGES[0])[1];
const stageColor=id=>(STAGES.find(s=>s[0]===id)||STAGES[0])[2];
const PROD={FE:"Final Expense",MP:"Mortgage Protection",IUL:"IUL"};
const prodPill=p=>`<span class="pill p-${PROD[p]?p:"none"}">${({FE:"FEX",MP:"Mortgage",IUL:"IUL"})[p]||"No product"}</span>`;
const fullName=l=>[l.first,l.last].filter(Boolean).join(" ")||"Unnamed lead";
const digits=s=>String(s||"").replace(/\D/g,"");
const normPhone=s=>{let d=digits(s);if(d.length===11&&d[0]==="1")d=d.slice(1);return d};
const fmtPhone=s=>{const d=normPhone(s);return d.length===10?`(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`:(s||"")};
const ago=t=>{if(!t)return"—";const m=(Date.now()-t)/6e4;if(m<1)return"just now";if(m<60)return Math.round(m)+"m ago";const h=m/60;if(h<24)return Math.round(h)+"h ago";const d=h/24;return d<30?Math.round(d)+"d ago":new Date(t).toLocaleDateString()};
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
let toastT;function toast(m){const t=$("#toast");t.textContent=m;t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>t.hidden=true,2600)}

/* ---------- data layer ---------- */
const leads=new Map(); let db=null, col=null, live=false;
function setSync(txt){$("#syncState").textContent=txt}
async function initDb(){
  try{ if(window.claude?.use) db=await window.claude.use("db"); }catch{ db=null }
  if(!db){ setSync("Not saving: sign in to keep leads."); renderAll(); return }
  col=db.collection("leads");
  col.onSnapshot(snap=>{
    leads.clear(); snap.docs.forEach(d=>{const v=d.data(); if(v) leads.set(d.id,{...v,id:d.id})});
    live=true; setSync(`${leads.size} lead${leads.size===1?"":"s"} · saved & synced`); renderAll();
  },e=>{ setSync("Sync stopped: "+(e?.message||"reload the page")); });
  initAppts(); initCalls(); initLogos(); initCrew();
}
async function putLead(l){
  const id=l.id||uid(); const body={...l}; delete body.id; body.updatedAt=Date.now(); if(!body.createdAt)body.createdAt=body.updatedAt;
  if(col){ await col.doc(id).set(body) } else { leads.set(id,{...body,id}); renderAll() }
  return id;
}
async function patchLead(id,patch){
  const cur=leads.get(id); if(!cur) throw new Error("Lead not found");
  const next={...cur,...patch}; await putLead(next); return next;
}
async function removeLead(id){ if(col) await col.doc(id).delete(); else { leads.delete(id); renderAll() } }
function addNoteObj(l,text){ return [...(l.notes||[]),{t:Date.now(),text}] }

/* ---------- navigation ---------- */
let view=(location.hash||"").slice(1);
if(!["pipeline","contacts","import","dialer","quoter","iul","assistant","screen","scripts","calendar","crew"].includes(view)) view=ls.get("hp.view","pipeline");
const CRUMB={crew:"Crew lobby",calendar:"Calendar",quoter:"Quote & compare",iul:"IUL illustrator",pipeline:"My CRM",contacts:"Clients",screen:"Screen a client",assistant:"Highpoint Bot",scripts:"Scripts",dialer:"Highpoint Dialer",import:"Import leads"};
function syncNav(){ $$(".nav").forEach(b=>b.setAttribute("aria-current",b.dataset.view===view?"page":"false")); $("#crumb").textContent=CRUMB[view]||""; }
function go(v){ if(!document.getElementById("v-"+v))v="pipeline"; view=v; ls.set("hp.view",v); $$("section[data-v]").forEach(s=>s.hidden=s.id!=="v-"+v); syncNav(); renderAll(); if(typeof crewPresence==="function")crewPresence(v); window.scrollTo(0,0); if(typeof stagger==="function")stagger($("#v-"+v)) }
$$(".nav").forEach(b=>b.onclick=()=>{if(b.dataset.view)go(b.dataset.view)});
$$("[data-new]").forEach(b=>b.onclick=()=>openDrawer(null));
$$("[data-goto]").forEach(b=>b.onclick=()=>go(b.dataset.goto));

/* ---------- pipeline ---------- */
function filteredLeads(){return [...leads.values()]}
function renderPipeline(){
  const pf=$("#pipeProduct").value; const all=filteredLeads().filter(l=>!pf||l.product===pf);
  const all2=filteredLeads(), mStart=new Date(new Date().getFullYear(),new Date().getMonth(),1).getTime();
  const soldM=all2.filter(l=>l.stage==="sold"&&(l.updatedAt||0)>=mStart).length, closed=all2.filter(l=>l.stage==="sold"||l.stage==="lost").length;
  $("#kpis").innerHTML=`<div><span class="label">Leads in book</span><span class="num" data-count="${all2.length}" data-key="k1" data-fmt="int">${all2.length.toLocaleString()}</span></div><div><span class="label">Appointments</span><span class="num" data-count="${all2.filter(l=>l.stage==="appointment").length}" data-key="k2" data-fmt="int">${all2.filter(l=>l.stage==="appointment").length}</span></div><div><span class="label">Sold this month</span><span class="num gold" data-count="${soldM}" data-key="k3" data-fmt="int">${soldM}</span></div><div><span class="label">Close rate</span><span class="num">${closed?Math.round(all2.filter(l=>l.stage==="sold").length/closed*100)+"%":"—"}</span></div>`;
  setTimeout(()=>countUp($("#kpis")));
  $("#strip").innerHTML=STAGES.map(([id,n,c])=>`<div><span class="label"><i style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${c};margin-right:5px"></i>${n}</span><span class="num">${all.filter(l=>(l.stage||"new")===id).length}</span></div>`).join("");
  $("#board").innerHTML=STAGES.map(([id,n,c])=>{
    const items=all.filter(l=>(l.stage||"new")===id).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
    return `<div class="col" data-stage="${id}"><header><h3><i style="background:${c}"></i>${n}</h3><span class="muted num">${items.length}</span></header>
      ${items.slice(0,150).map(l=>`<div class="card" draggable="true" data-id="${esc(l.id)}" tabindex="0"><span class="nm">${esc(fullName(l))}</span><span class="meta"><span class="num">${esc(fmtPhone(l.phone))}</span>${l.age?`<span>${esc(l.age)} yrs</span>`:""}</span><span class="meta">${prodPill(l.product)}<span>${esc(l.state||"")}</span></span></div>`).join("")}
      ${items.length>150?`<div class="empty-col">+${items.length-150} more in Contacts</div>`:""}
      ${!items.length?`<div class="empty-col">${leads.size?"No leads here":(id==="new"?"Import a CSV or add a lead to start":"—")}</div>`:""}</div>`}).join("");
  $$("#board .card").forEach(c=>{
    c.onclick=()=>openDrawer(c.dataset.id); c.onkeydown=e=>{if(e.key==="Enter")openDrawer(c.dataset.id)};
    c.ondragstart=e=>{e.dataTransfer.setData("text/plain",c.dataset.id);e.dataTransfer.effectAllowed="move"};
  });
  $$("#board .col").forEach(cl=>{
    cl.ondragover=e=>{e.preventDefault();cl.classList.add("over")};
    cl.ondragleave=()=>cl.classList.remove("over");
    cl.ondrop=async e=>{e.preventDefault();cl.classList.remove("over");const id=e.dataTransfer.getData("text/plain");const l=leads.get(id);if(!l||l.stage===cl.dataset.stage)return;
      try{await patchLead(id,{stage:cl.dataset.stage,notes:addNoteObj(l,`Moved to ${stageName(cl.dataset.stage)}`)});if(cl.dataset.stage==="sold"){celebrate(`Sold! ${fullName(l)} is on the books.`);awardXP(100,"policy sold")}else toast(`${fullName(l)} → ${stageName(cl.dataset.stage)}`)}catch(err){toast("Couldn't move lead: "+err.message)}};
  });
}
$("#pipeProduct").onchange=renderPipeline;

/* ---------- contacts ---------- */
const stageOpts=(withAll)=>(withAll?`<option value="">All stages</option>`:"")+STAGES.map(([i,n])=>`<option value="${i}">${n}</option>`).join("");
$("#fStage").innerHTML=stageOpts(true); $("#impStage").innerHTML=stageOpts(false); $("#dqStage").innerHTML=stageOpts(false);
function contactRows(){
  const q=$("#q").value.trim().toLowerCase(), st=$("#fStage").value, pr=$("#fProduct").value, so=$("#fSource").value;
  const qd=digits(q);
  return filteredLeads().filter(l=>(!st||(l.stage||"new")===st)&&(!pr||l.product===pr)&&(!so||l.source===so)&&(!q||[fullName(l),l.email,l.state,l.source,(l.tags||[]).join(" ")].join(" ").toLowerCase().includes(q)||(qd.length>=3&&normPhone(l.phone).includes(qd))))
    .sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));
}
function renderContacts(){
  const sources=[...new Set(filteredLeads().map(l=>l.source).filter(Boolean))].sort();
  const cur=$("#fSource").value; $("#fSource").innerHTML=`<option value="">All sources</option>`+sources.map(s=>`<option ${s===cur?"selected":""}>${esc(s)}</option>`).join("");
  const rows=contactRows();
  $("#contactCount").textContent=`${rows.length} of ${leads.size} leads`;
  $("#rows").innerHTML=rows.slice(0,500).map(l=>`<tr data-id="${esc(l.id)}" tabindex="0"><td><b>${esc(fullName(l))}</b></td><td class="num">${esc(fmtPhone(l.phone))}</td><td>${prodPill(l.product)}</td><td><span class="stage"><i style="background:${stageColor(l.stage)}"></i>${stageName(l.stage)}</span></td><td>${esc(l.state||"")}</td><td class="num">${esc(l.age||"")}</td><td>${esc(l.source||"")}</td><td class="muted">${ago(l.updatedAt)}</td></tr>`).join("")
    || `<tr><td colspan="8" class="muted" style="text-align:center;padding:28px">${leads.size?"No leads match these filters.":"No leads yet. Use Import to upload a CSV, or add one with + New lead."}</td></tr>`;
  $$("#rows tr[data-id]").forEach(r=>{r.onclick=()=>openDrawer(r.dataset.id);r.onkeydown=e=>{if(e.key==="Enter")openDrawer(r.dataset.id)}});
}
["#q","#fStage","#fProduct","#fSource"].forEach(s=>$(s).addEventListener("input",renderContacts));

/* ---------- CSV ---------- */
function parseCSV(text){
  text=text.replace(/^﻿/,"");
  const first=text.split(/\r?\n/,1)[0]||""; const delim=(first.split("\t").length>first.split(",").length)?"\t":",";
  const rows=[];let row=[],f="",q=false;
  for(let i=0;i<text.length;i++){const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){f+='"';i++} else q=false } else f+=c }
    else if(c==='"') q=true; else if(c===delim){row.push(f);f=""} else if(c==="\n"||c==="\r"){ if(c==="\r"&&text[i+1]==="\n")i++; row.push(f);rows.push(row);row=[];f="" } else f+=c }
  if(f!==""||row.length){row.push(f);rows.push(row)}
  return rows.filter(r=>r.some(x=>x.trim()!==""));
}
const csvCell=v=>{v=String(v??"");return /[",\n\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};
const toCSV=(head,rows)=>[head,...rows].map(r=>r.map(csvCell).join(",")).join("\r\n");
async function offerFile(filename,data){
  let dl=null; try{ dl=await window.claude?.use?.("downloads") }catch{}
  if(!dl){ toast("Downloads aren't available in this view."); return }
  try{ await dl.save({filename,data}); }catch(e){ if(e?.code!=="cancelled"&&e?.code!=="declined") toast("File not saved: "+(e?.message||e?.code||"")) }
}
const EXPORT_COLS=["first","last","phone","email","state","zip","age","dob","product","stage","source","mortgageBalance","mortgagePayment","lender"];
$("#exportAll").onclick=()=>{const rows=contactRows();if(!rows.length){toast("No leads to export");return}
  offerFile(`leads-${new Date().toISOString().slice(0,10)}.csv`,toCSV([...EXPORT_COLS,"notes"],rows.map(l=>[...EXPORT_COLS.map(k=>k==="stage"?stageName(l.stage):l[k]??""),(l.notes||[]).map(n=>n.text).join(" | ")])))};

/* ---------- import ---------- */
const FIELDS=[["","Skip this column"],["first","First name"],["last","Last name"],["full","Full name (split)"],["phone","Phone"],["phone2","Alt phone"],["email","Email"],["address","Street address"],["city","City"],["state","State"],["zip","ZIP"],["age","Age"],["dob","Date of birth"],["mortgageBalance","Mortgage balance"],["mortgagePayment","Mortgage payment"],["lender","Lender"],["product","Product"],["notes","Notes"]];
const SYN={first:/^(first|fname|first ?name|given)/,last:/^(last|lname|last ?name|surname)/,full:/^(name|full ?name|contact ?name|lead ?name)$/,phone:/(^phone|cell|mobile|primary ?phone|phone ?1|telephone|^tel)/,phone2:/(alt|secondary|home ?phone|phone ?2|other ?phone)/,email:/e-?mail/,address:/(address|street)/,city:/^city/,state:/^(state|st)$/,zip:/(zip|postal)/,age:/^age$/,dob:/(dob|birth)/,mortgageBalance:/(mortgage ?(amount|balance)|loan ?(amount|balance)|balance)/,mortgagePayment:/(payment|monthly)/,lender:/(lender|bank)/,product:/(product|lead ?type|campaign)/,notes:/(note|comment)/};
let imp=null;
function guessField(h){h=h.trim().toLowerCase();for(const k of ["phone2","first","last","email","dob","mortgageBalance","mortgagePayment","lender","zip","city","state","age","full","phone","address","product","notes"])if(SYN[k].test(h))return k;return ""}
function loadImport(text,name){
  const rows=parseCSV(text); if(rows.length<2){toast("That file needs a header row and at least one lead.");return}
  const head=rows[0].map(h=>h.trim()); const body=rows.slice(1);
  const used=new Set(); const map=head.map(h=>{const g=guessField(h);if(g&&!used.has(g)){used.add(g);return g}return ""});
  imp={head,body,map,name}; $("#impSource").value=$("#impSource").value||(name?name.replace(/\.[^.]+$/,""):"Pasted list");
  $("#impStep2").hidden=false; $("#impProgress").hidden=true; renderImport();
}
function renderImport(){
  if(!imp)return;
  $("#impMeta").textContent=`${imp.body.length} rows · ${imp.head.length} columns${imp.name?` · ${imp.name}`:""}`;
  $("#mapgrid").innerHTML=imp.head.map((h,i)=>`<label class="field"><span>${esc(h||"Column "+(i+1))}</span><select data-ci="${i}">${FIELDS.map(([k,n])=>`<option value="${k}" ${imp.map[i]===k?"selected":""}>${n}</option>`).join("")}</select><small>e.g. ${esc(imp.body.find(r=>r[i])?.[i]||"—")}</small></label>`).join("");
  $$("#mapgrid select").forEach(s=>s.onchange=()=>{imp.map[+s.dataset.ci]=s.value;renderImport()});
  const recs=buildRecords().slice(0,5);
  $("#pvHead").innerHTML="<tr><th>Name</th><th>Phone</th><th>Email</th><th>State</th><th>Age</th><th>Product</th></tr>";
  $("#pvBody").innerHTML=recs.map(r=>`<tr><td>${esc(fullName(r))}</td><td class="num">${esc(fmtPhone(r.phone))}</td><td>${esc(r.email||"")}</td><td>${esc(r.state||"")}</td><td>${esc(r.age||"")}</td><td>${prodPill(r.product)}</td></tr>`).join("");
  const all=buildRecords(); const {fresh,dupes,nophone}=splitDupes(all);
  $("#impSummary").textContent=`${fresh.length} will be imported${dupes?` · ${dupes} duplicates skipped`:""}${nophone?` · ${nophone} without a phone`:""}`;
  $("#impGo").disabled=!fresh.length;
}
function ageFromDob(s){const d=new Date(s);if(isNaN(d))return"";const n=new Date();let a=n.getFullYear()-d.getFullYear();if(n<new Date(n.getFullYear(),d.getMonth(),d.getDate()))a--;return a>0&&a<120?a:""}
function prodFrom(s){s=String(s||"").toLowerCase();if(/fe|final|burial|funeral/.test(s))return"FE";if(/mort|mp\b/.test(s))return"MP";if(/iul|index|universal/.test(s))return"IUL";return""}
function buildRecords(){
  if(!imp)return[];
  return imp.body.map(r=>{const o={};imp.map.forEach((k,i)=>{const v=(r[i]||"").trim();if(!v)return;if(!k){const h=imp.head[i]||("Column "+(i+1));(o.fields=o.fields||{})[h]=v;return}
      if(k==="full"){const p=v.split(/\s+/);if(!o.first)o.first=p.shift();if(!o.last)o.last=p.join(" ")}
      else if(k==="product")o.product=prodFrom(v);
      else if(k==="mortgageBalance"||k==="mortgagePayment")o[k]=Number(v.replace(/[^\d.]/g,""))||"";
      else if(k==="age")o.age=parseInt(v)||"";
      else o[k]=v});
    if(o.phone)o.phone=normPhone(o.phone); if(o.phone2)o.phone2=normPhone(o.phone2);
    if(!o.age&&o.dob)o.age=ageFromDob(o.dob);
    if(o.state)o.state=o.state.length<=3?o.state.toUpperCase():o.state;
    if(o.first)o.first=o.first.replace(/\b\w/g,c=>c.toUpperCase()); if(o.last)o.last=o.last.replace(/\b\w/g,c=>c.toUpperCase());
    return o}).filter(o=>o.first||o.last||o.phone||o.email);
}
function splitDupes(all){
  const have=new Set([...leads.values()].map(l=>normPhone(l.phone)).filter(Boolean)); const seen=new Set();
  const dd=$("#impDedupe").checked; let dupes=0,nophone=0; const fresh=[];
  for(const r of all){ if(!r.phone)nophone++; const p=r.phone; if(dd&&p&&(have.has(p)||seen.has(p))){dupes++;continue} if(p)seen.add(p); fresh.push(r) }
  return {fresh,dupes,nophone};
}
$("#impDedupe").onchange=renderImport;
$("#csvFile").onchange=e=>{const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>loadImport(String(rd.result),f.name);rd.readAsText(f);e.target.value=""};
const drop=$("#drop");
drop.ondragover=e=>{e.preventDefault();drop.classList.add("over")};drop.ondragleave=()=>drop.classList.remove("over");
drop.ondrop=e=>{e.preventDefault();drop.classList.remove("over");const f=e.dataTransfer.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>loadImport(String(rd.result),f.name);rd.readAsText(f)};
document.addEventListener("paste",e=>{if(view!=="import")return;if(e.target.closest("input,textarea"))return;const t=e.clipboardData?.getData("text");if(t&&t.includes("\n")){e.preventDefault();loadImport(t,"")}});
$("#impCancel").onclick=()=>{imp=null;$("#impStep2").hidden=true};
$("#impGo").onclick=async()=>{
  const {fresh}=splitDupes(buildRecords()); if(!fresh.length)return;
  const src=$("#impSource").value.trim()||"Import", stg=$("#impStage").value, dp=$("#impProduct").value;
  $("#impGo").disabled=true; $("#impProgress").hidden=false; let done=0,fail=0; const total=fresh.length;
  const upd=()=>{$("#impBar").style.width=(done/total*100)+"%";$("#impProgText").textContent=`Imported ${done} of ${total}${fail?` · ${fail} failed`:""}`};
  const queue=fresh.map(r=>({...r,product:r.product||dp,stage:stg,source:src,notes:r.notes?[{t:Date.now(),text:String(r.notes)}]:[],callCount:0}));
  let i=0; async function worker(){while(i<queue.length){const r=queue[i++];try{await putLead(r)}catch(e){fail++;if(e?.code==="quota_exceeded"){i=queue.length;toast("Your lead storage is full. Delete old leads to import more.")}}done++;upd()}}
  await Promise.all(Array.from({length:6},worker));
  toast(`Imported ${done-fail} leads into ${stageName(stg)}`);if(done-fail>0)setTimeout(()=>awardXP(Math.min(50,5+Math.ceil((done-fail)/20)),"leads imported"),600); imp=null; $("#impStep2").hidden=true; go("pipeline");
};

/* ---------- drawer ---------- */
let drawerId=null;
function openDrawer(id){
  drawerId=id; const l=id?leads.get(id):{stage:"new",product:""}; if(id&&!l)return;
  const f=(k,lab,type="text",extra="")=>`<label class="field"><span>${lab}</span><input id="d_${k}" type="${type}" value="${esc(l[k]??"")}" ${extra}></label>`;
  $("#drawer").innerHTML=`
   <div class="dh"><div><h2>${id?esc(fullName(l)):"New lead"}</h2>${id?`<div class="muted" style="font-size:12px;margin-top:3px">${esc(l.source||"Added by hand")} · created ${ago(l.createdAt)}</div>`:""}</div><button class="btn" id="dClose" aria-label="Close">✕</button></div>
   <div class="db">
     <div class="grid2">
       <label class="field"><span>Stage</span><select id="d_stage">${STAGES.map(([i,n])=>`<option value="${i}" ${(l.stage||"new")===i?"selected":""}>${n}</option>`).join("")}</select></label>
       <label class="field"><span>Product</span><select id="d_product"><option value="">Not set</option>${Object.entries(PROD).map(([k,n])=>`<option value="${k}" ${l.product===k?"selected":""}>${n}</option>`).join("")}</select></label>
     </div>
     <div class="grid2">${f("first","First name")}${f("last","Last name")}</div>
     <div class="grid2">${f("phone","Phone","tel")}${f("email","Email","email")}</div>
     <div class="grid3">${f("state","State")}${f("zip","ZIP")}${f("age","Age","number")}</div>
     <div class="grid2">${f("dob","Date of birth")}${f("source","Source")}</div>
     <div class="grid3">${f("mortgageBalance","Mortgage bal.","number")}${f("mortgagePayment","Payment","number")}${f("lender","Lender")}</div>
     ${id?`<div class="stack"><span class="label">Notes & activity</span>
       <div class="row" style="flex-wrap:nowrap"><input id="d_note" placeholder="Add a note"><button class="btn" id="dAddNote">Add</button></div>
       <div class="log">${(l.notes||[]).slice().reverse().map(n=>`<div><time>${new Date(n.t).toLocaleString()}</time>${esc(n.text)}</div>`).join("")||`<span class="muted">No notes yet.</span>`}</div></div>
     ${(l.quotes||[]).length?`<div class="stack"><span class="label">Quotes</span><div class="log">${l.quotes.slice().reverse().map(q=>`<div><time>${new Date(q.t).toLocaleDateString()} · ${esc(PROD[q.product]||q.product)}</time><b class="num">${money(q.monthly,2)}/mo</b> · ${esc(q.summary)}</div>`).join("")}</div></div>`:""}`:""}
   </div>
   <div class="df">${id?`<button class="btn danger" id="dDel">Delete lead</button>`:"<span></span>"}<div class="row"><button class="btn" id="dCancel">Cancel</button><button class="btn primary" id="dSave">${id?"Save changes":"Add lead"}</button></div></div>`;
  if(id)showDock(id);
  $("#drawer").hidden=false; $("#scrim").hidden=false; $("#d_first").focus();
  $("#dClose").onclick=$("#dCancel").onclick=closeDrawer;
  $("#dSave").onclick=async()=>{
    const v=k=>$("#d_"+k).value.trim(); const cur=id?leads.get(id):{};
    const rec={...cur,first:v("first"),last:v("last"),phone:normPhone(v("phone")),email:v("email"),state:v("state").toUpperCase(),zip:v("zip"),age:v("age")?Number(v("age")):"",dob:v("dob"),source:v("source"),mortgageBalance:v("mortgageBalance")?Number(v("mortgageBalance")):"",mortgagePayment:v("mortgagePayment")?Number(v("mortgagePayment")):"",lender:v("lender"),stage:$("#d_stage").value,product:$("#d_product").value};
    if(!rec.first&&!rec.last&&!rec.phone){toast("Add at least a name or phone number.");return}
    if(id&&cur.stage!==rec.stage)rec.notes=addNoteObj(cur,`Moved to ${stageName(rec.stage)}`);
    if(!id){rec.notes=[];rec.callCount=0;if(!rec.source)rec.source="Added by hand"}
    try{await putLead(rec);if(rec.stage==="sold"&&cur.stage!=="sold"){celebrate(`Sold! ${fullName(rec)} is on the books.`);awardXP(100,"policy sold")}else toast(id?"Saved":"Lead added");closeDrawer()}catch(e){toast("Couldn't save: "+(e.message||e.code))}
  };
  if(id){
    $("#dAddNote").onclick=async()=>{const t=$("#d_note").value.trim();if(!t)return;try{await patchLead(id,{notes:addNoteObj(leads.get(id),t)});openDrawer(id)}catch(e){toast("Couldn't add note")}};
    $("#d_note").onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();$("#dAddNote").click()}};
    $("#dDel").onclick=()=>{const b=$("#dDel");if(b.dataset.armed){removeLead(id).then(()=>{toast("Lead deleted");closeDrawer()})}else{b.dataset.armed="1";b.textContent="Click again to delete"}};
  }
}
function closeDrawer(){$("#drawer").hidden=true;$("#scrim").hidden=true;drawerId=null}
$("#scrim").onclick=closeDrawer; document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("#drawer").hidden)closeDrawer()});

/* ---------- dialer ---------- */
let dCurId=null; const sess=ls.get("hp.sess",{d:0,c:0,a:0,day:""}); const today=new Date().toDateString(); if(sess.day!==today){sess.d=sess.c=sess.a=0;sess.day=today}
function saveSess(){ls.set("hp.sess",sess);$("#sDials").textContent=sess.d;$("#sContacts").textContent=sess.c;$("#sAppts").textContent=sess.a}
$("#dqStage").value=ls.get("hp.dqStage","new");
function dialQueue(){const st=$("#dqStage").value,pr=$("#dqProduct").value;
  return filteredLeads().filter(l=>(l.stage||"new")===st&&(!pr||l.product===pr)&&normPhone(l.phone))
    .sort((a,b)=>(a.callbackAt||0)-(b.callbackAt||0)||(a.lastCallAt||0)-(b.lastCallAt||0)||(a.createdAt||0)-(b.createdAt||0))}
const SCRIPTS={
  FE:l=>`Hi, is this ${esc(l.first||"…")}? This is [your name] calling about the request you sent in for information on final expense coverage, the plans that help cover funeral and burial costs so your family isn't left with the bill. I just need to verify a couple of details and see what you qualify for. Is your date of birth still ${esc(l.dob||"[DOB]")}?`,
  MP:l=>`Hi ${esc(l.first||"…")}, this is [your name]. I'm following up on the mortgage protection form you sent back${l.lender?` about your loan with ${esc(l.lender)}`:""}. It's the coverage that pays off or keeps up the house payment if something happens to you. Did I catch you at an okay time to go over it for a few minutes?`,
  IUL:l=>`Hi ${esc(l.first||"…")}, this is [your name]. You'd asked about building tax-advantaged savings that also carries life insurance. I'd like to learn a little about your goals and then show you how an indexed universal life policy could fit. Do you have a few minutes now?`,
  "":l=>`Hi, is this ${esc(l.first||"…")}? This is [your name] following up on the information you requested about life insurance. Do you have a couple of minutes?`};
function dialerUpsell(){const v=$("#v-dialer");if(!v)return false;let n=$("#dUpsell");const need=window.hpUser?.access&&!window.hpUser.access.dialer;
  if(!need){if(n)n.remove();return false}
  if(!n){n=document.createElement("div");n.id="dUpsell";n.className="notice";n.style.margin="0 0 14px";n.innerHTML=`<b>The dialer is part of the Pro plan.</b> You're on Starter, so calling is turned off. <button type="button" class="btn sm primary" style="margin-left:8px">Upgrade in Billing</button>`;n.querySelector("button").onclick=()=>window.hpTeam?.openBilling();v.querySelector(".head")?.after(n)}
  return true}
function renderDialer(){dialerUpsell();
  const q=dialQueue(); $("#dqCount").textContent=`${q.length} to call`;
  if(!q.find(l=>l.id===dCurId)) dCurId=q[0]?.id||null;
  $("#queue").innerHTML=q.slice(0,300).map(l=>`<button data-id="${esc(l.id)}" aria-current="${l.id===dCurId}"><span>${esc(fullName(l))}</span><span class="muted num">${l.callCount?l.callCount+"×":""}${l.callbackAt?` · ${new Date(l.callbackAt).toLocaleDateString(undefined,{month:"short",day:"numeric"})}`:""}</span></button>`).join("")||`<div class="empty-col">No leads with phone numbers in ${stageName($("#dqStage").value)}.</div>`;
  $$("#queue button").forEach(b=>b.onclick=()=>{dCurId=b.dataset.id;renderDialer()});
  const l=leads.get(dCurId);
  if(!l){$("#dCur").innerHTML=`<h2>Queue is empty</h2><p class="muted" style="margin:0">Pick another stage above, or import leads to start dialing.</p>`;saveSess();return}
  $("#dCur").innerHTML=`
    <div class="row" style="justify-content:space-between;align-items:flex-start"><div><h2 style="font-size:20px">${esc(fullName(l))}</h2><div class="muted" style="margin-top:3px">${[l.age&&l.age+" yrs",l.state,l.source].filter(Boolean).map(esc).join(" · ")}</div></div>${prodPill(l.product)}</div>
    <div class="row" style="justify-content:space-between"><span class="bigphone">${esc(fmtPhone(l.phone))}</span><div class="row"><button class="btn" id="dcCopy">Copy</button><button class="btn primary" id="dcStart">${callT0&&callLead===l.id?(window.hpDialer?.ready?"On call":"End timer"):(window.hpDialer?.ready?"Call now":"Start call")}</button></div></div>
    <div class="calltimer ${callT0&&callLead===l.id?"live":""}" id="dcTimer"><i></i><span class="num" id="dcClock">${callT0&&callLead===l.id?fmtDur(Date.now()-callT0):"00:00"}</span><span class="muted">${callT0&&callLead===l.id?"On call · log the outcome to save it":(window.hpDialer?.ready?"Press Call now to dial from your browser. Talk time, recording and transcript save with the call.":"Press Start call when you dial. Duration is saved with the call.")}</span></div>
    ${l.mortgageBalance?`<div class="muted">Mortgage <b class="num" style="color:var(--ink)">${money(l.mortgageBalance)}</b>${l.mortgagePayment?` · payment <b class="num" style="color:var(--ink)">${money(l.mortgagePayment)}</b>/mo`:""}${l.lender?` · ${esc(l.lender)}`:""}</div>`:""}
    <div class="script"><span class="label" style="display:block;margin-bottom:4px">Opener</span>${(SCRIPTS[l.product]||SCRIPTS[""])(l)}</div>
    <div class="stack"><span class="label">Log the call</span>
      <div class="dispo">
        <button class="btn" data-dz="na">No answer</button><button class="btn" data-dz="vm">Left voicemail</button><button class="btn" data-dz="bad">Bad number</button>
        <button class="btn" data-dz="cb">Call back</button><button class="btn primary" data-dz="appt">Appointment set</button><button class="btn sold" data-dz="sold">Sold</button><button class="btn" data-dz="ni">Not interested</button>
      </div>
      <div class="row" id="cbRow" hidden><input type="datetime-local" id="cbAt" style="flex:1;width:auto"><button class="btn primary" id="cbSave">Save callback</button></div>
      <input id="dcNote" placeholder="Note for this call (optional)">
    </div>
    ${(l.notes||[]).length?`<div class="log">${l.notes.slice(-3).reverse().map(n=>`<div><time>${new Date(n.t).toLocaleString()}</time>${esc(n.text)}</div>`).join("")}</div>`:""}
    <button class="btn" id="dcOpen" style="align-self:flex-start">Open full lead</button>`;
  $("#dcCopy").onclick=async()=>{try{await navigator.clipboard.writeText(fmtPhone(l.phone));toast("Number copied")}catch{const s=getSelection(),r=document.createRange();r.selectNodeContents($(".bigphone"));s.removeAllRanges();s.addRange(r);toast("Number selected, press Ctrl/Cmd+C")}};
  $("#dcOpen").onclick=()=>openDrawer(l.id);
  $("#dcStart").onclick=async()=>{if(window.hpDialer?.ready){if(window.hpDialer.busy){toast("Finish the current call first");return}window.hpDialer.dialLead(l);return}if(callT0&&callLead===l.id){callStop();renderDialer();return}callT0=Date.now();callLead=l.id;window.dispatchEvent(new Event("hp:callstart"));try{await navigator.clipboard.writeText(normPhone(l.phone))}catch{}toast("Timer started · number copied");tickCall();renderDialer()};
  $$("[data-dz]").forEach(b=>b.onclick=()=>dispo(l,b.dataset.dz));
  saveSess(); window.dispatchEvent(new Event("hp:leadchange"));
}
async function dispo(l,kind){
  if((kind==="cb"||kind==="appt")&&$("#cbRow").hidden){$("#cbRow").hidden=false;const d=new Date(Date.now()+864e5);d.setMinutes(0);d.setMinutes(d.getMinutes()-d.getTimezoneOffset());$("#cbAt").value=d.toISOString().slice(0,16);$("#cbSave").textContent=kind==="appt"?"Save appointment":"Save callback";$("#cbSave").onclick=()=>dispo(l,kind==="appt"?"apptgo":"cbgo");return}
  const note=$("#dcNote").value.trim();
  const lab={na:"No answer",vm:"Left voicemail",bad:"Bad number",cbgo:"Callback scheduled",apptgo:"Appointment set",appt:"Appointment set",sold:"Sold",ni:"Not interested"}[kind];
  const patch={callCount:(l.callCount||0)+1,lastCallAt:Date.now(),lastDisposition:lab,notes:addNoteObj(l,`Call: ${lab}${note?" — "+note:""}`)};
  if(kind==="sold")patch.stage="sold"; else if(kind==="apptgo"||kind==="appt")patch.stage="appointment"; else if(kind==="ni"||kind==="bad")patch.stage="lost"; else if(l.stage==="new")patch.stage="contacted";
  if(kind==="cbgo"){const t=new Date($("#cbAt").value).getTime();patch.callbackAt=isNaN(t)?Date.now()+864e5:t;patch.notes=addNoteObj(l,`Call: Callback set for ${new Date(patch.callbackAt).toLocaleString()}${note?" — "+note:""}`)}
  sess.d++; if(["cbgo","appt","apptgo","ni","sold"].includes(kind))sess.c++; if(kind==="appt"||kind==="apptgo")sess.a++;
  const at=new Date($("#cbAt")?.value||"").getTime();
  const dur=callLead===l.id&&callT0?Date.now()-callT0:0; callStop();
  const hpm=window.hpDialer?.meta(l.id)||{}; window.hpDialer?.onDispo(l.id,lab,note);
  logCall({leadId:l.id,name:fullName(l),phone:normPhone(l.phone),product:l.product||"",at:Date.now(),outcome:lab,dur,note,transcript:"",summary:"",...hpm});
  const q=dialQueue(); const idx=q.findIndex(x=>x.id===l.id); const nextId=q[idx+1]?.id||null;
  try{await patchLead(l.id,patch);dCurId=nextId;
    if((kind==="apptgo"||kind==="cbgo")&&!isNaN(at))await putAppt({leadId:l.id,leadName:fullName(l),title:fullName(l),at,dur:30,type:kind==="cbgo"?"Callback":"Phone call",done:false,createdAt:Date.now()});
    if(kind==="sold"){celebrate(`Sold! ${fullName(l)} is on the books.`);awardXP(100,"policy sold")}else if(kind==="apptgo"||kind==="appt"){celebrate(`Appointment set with ${fullName(l)}`);awardXP(30,"appointment set")}else{toast(`${fullName(l)}: ${lab}`);awardXP(5,"call logged")}renderDialer()}catch(e){toast("Couldn't log the call: "+e.message)}
}
$("#dqStage").onchange=()=>{ls.set("hp.dqStage",$("#dqStage").value);dCurId=null;renderDialer()};$("#dqProduct").onchange=()=>{dCurId=null;renderDialer()};
$("#wavvCsv")?.addEventListener("click",()=>{const q=dialQueue();if(!q.length){toast("Queue is empty");return}
  offerFile(`queue-${$("#dqStage").value}-${new Date().toISOString().slice(0,10)}.csv`,toCSV(["First Name","Last Name","Phone","Email","State","Notes"],q.map(l=>[l.first||"",l.last||"",normPhone(l.phone),l.email||"",l.state||"",[PROD[l.product],l.source].filter(Boolean).join(" · ")])))});

/* ---------- Highpoint Dialer hooks ---------- */
window.hpDesk={leads,dialQueue,fullName,normPhone,fmtPhone,toast,patchLead,renderDialer,openDrawer,
  currentId:()=>dCurId,setCurrent(id){dCurId=id;if(view==="dialer")renderDialer()},
  get calls(){return calls},get appts(){return appts},putAppt,addNoteObj,stageName,STAGES,PROD,go,
  async dispoDirect(id,kind,o={}){const l=leads.get(id);if(!l)return;const note=o.note||"";
    const lab={na:"No answer",vm:"Left voicemail",bad:"Bad number",cb:"Callback scheduled",appt:"Appointment set",sold:"Sold",ni:"Not interested",dnc:"Do not call"}[kind];
    const patch={callCount:(l.callCount||0)+1,lastCallAt:Date.now(),lastDisposition:lab,notes:addNoteObj(l,`Call: ${lab}${o.at?" for "+new Date(o.at).toLocaleString():""}${note?" — "+note:""}`)};
    if(kind==="sold")patch.stage="sold";else if(kind==="appt")patch.stage="appointment";else if(kind==="ni"||kind==="bad"||kind==="dnc")patch.stage="lost";else if((l.stage||"new")==="new")patch.stage="contacted";
    if(kind==="cb")patch.callbackAt=o.at||Date.now()+864e5;
    sess.d++;if(["cb","appt","ni","sold"].includes(kind))sess.c++;if(kind==="appt")sess.a++;saveSess();
    const dur=callLead===id&&callT0?Date.now()-callT0:0;callStop();
    const hpm=window.hpDialer?.meta(id)||{};window.hpDialer?.onDispo(id,lab,note);
    logCall({leadId:id,name:fullName(l),phone:normPhone(l.phone),product:l.product||"",at:Date.now(),outcome:lab,dur,note,transcript:"",summary:"",...hpm});
    await patchLead(id,patch);
    if((kind==="appt"||kind==="cb")&&o.at)await putAppt({leadId:id,leadName:fullName(l),title:fullName(l),at:o.at,dur:30,type:kind==="cb"?"Callback":"Phone call",done:false,createdAt:Date.now()});
    if(kind==="sold"){celebrate(`Sold! ${fullName(l)} is on the books.`);awardXP(100,"policy sold")}else if(kind==="appt"){celebrate(`Appointment set with ${fullName(l)}`);awardXP(30,"appointment set")}else awardXP(5,"call logged");
    if(view==="dialer"&&dTab==="dial")renderDialer();return lab},
  callStart(id){if(callT0)return;callT0=Date.now();callLead=id;window.dispatchEvent(new Event("hp:callstart"));tickCall();if(view==="dialer"&&dTab==="dial")renderDialer()},
  callStop(){callStop();if(view==="dialer"&&dTab==="dial")renderDialer()},
  async autoLog(id,lab,meta={}){const l=leads.get(id);if(!l)return;const patch={callCount:(l.callCount||0)+1,lastCallAt:Date.now(),lastDisposition:lab,notes:addNoteObj(l,`Call: ${lab} (Highpoint Dialer)`)};
    if(lab==="Bad number"||lab==="Do not call")patch.stage="lost";sess.d++;saveSess();
    logCall({leadId:id,name:fullName(l),phone:normPhone(l.phone),product:l.product||"",at:Date.now(),outcome:lab,dur:0,note:"",transcript:"",summary:"",...meta});
    try{await patchLead(id,patch)}catch{}if(view==="dialer"&&dTab==="dial")renderDialer()}};
if(!window.hpDialer&&!document.querySelector('script[src="/hp-dialer.js"]')){const c=document.createElement("link");c.rel="stylesheet";c.href="/hp-dialer.css";document.head.append(c);const sc=document.createElement("script");sc.src="/hp-dialer.js";document.body.append(sc)}

/* ---------- quoting engines (illustrative) ---------- */
function interp(xs,ys,x){if(x<=xs[0])return ys[0];for(let i=1;i<xs.length;i++)if(x<=xs[i]){const t=(x-xs[i-1])/(xs[i]-xs[i-1]);return ys[i-1]+t*(ys[i]-ys[i-1])}const n=xs.length-1;return ys[n]+(x-xs[n])*(ys[n]-ys[n-1])/(xs[n]-xs[n-1])}
const FE_AGES=[45,50,55,60,65,70,75,80,85], FE_RATE=[2.4,2.9,3.4,4.1,5.0,6.4,8.4,11.4,15.5];
const FE_PLANS={level:["Level benefit",1,"Full death benefit from day one for clients who answer no to the health questions."],graded:["Graded benefit",1.35,"For clients with some health history. Partial benefit in years 1–2 for natural causes, full benefit after."],gi:["Guaranteed issue",1.75,"No health questions. Return of premium plus interest in years 1–2, full benefit after."]};
function feQuote({age,sex,tob,face,plan}){age=Math.min(85,Math.max(45,age));const r=interp(FE_AGES,FE_RATE,age)*(sex==="F"?0.78:1)*(tob?1.45:1)*FE_PLANS[plan][1];return Math.round((face/1000*r+3)*100)/100}
const MP_AGES=[20,30,35,40,45,50,55,60,65,70], MP_RATE=[0.45,0.50,0.60,0.80,1.20,1.85,3.00,4.90,8.40,14.5], MP_TERMS={10:0.72,15:0.82,20:1,25:1.25,30:1.45};
const TERM_MAXAGE={10:75,15:70,20:65,25:55,30:50};
/* Ethos term (public/hp-est.js, from ethos.com's own estimator): min = best class, max = standard. Log-interpolated by age and term. */
function ethosTerm({age,sex,tob,cls,face,term}){const E=window.HP_EST?.ethosTerm;if(!E)return null;const g=E.grid[sex+(tob?"1":"0")];if(!g)return null;
  const at=(t)=>{const rows=g[t];if(!rows)return null;const a=Math.max(age,rows[0][0]);if(a>rows[rows.length-1][0])return null;let i=rows.findIndex(r=>a<=r[0]);if(i<1)i=1;const [x0,a0,b0]=rows[i-1],[x1,a1,b1]=rows[i],k=x1===x0?0:(a-x0)/(x1-x0),L=(u,v)=>Math.exp(Math.log(u)+k*(Math.log(v)-Math.log(u)));return a<=rows[0][0]?[rows[0][1],rows[0][2]]:[L(a0,a1),L(b0,b1)]};
  let r=at(String(term));if(!r){const lo=term-5,hi=term+5,A=at(String(lo)),B=at(String(hi));if(!A||!B)return null;r=[Math.sqrt(A[0]*B[0]),Math.sqrt(A[1]*B[1])]}
  const pos=tob?({0.82:.5,1:.5,1.22:.75,1.45:1})[cls]??.5:({0.82:0,1:1/3,1.22:2/3,1.45:1})[cls]??1/3;let m=Math.exp(Math.log(r[0])+pos*(Math.log(r[1])-Math.log(r[0])));
  const F=E.face[sex],fr=(ag)=>{const d=F[ag],xs=[100,250,500,1000],ys=xs.map(x=>x===250?1:(d[x][0]+d[x][1])/2),f=face/1000;let i=f<=250?1:f<=500?2:3;return ys[i-1]+(f-xs[i-1])*(ys[i]-ys[i-1])/(xs[i]-xs[i-1])};
  const t=Math.min(1,Math.max(0,(age-35)/15));m*=Math.max(.2,fr("35")*(1-t)+fr("50")*t);return Math.round(m*100)/100}
function mpQuote({age,sex,tob,health,face,term,rop}){if(age+term>85||age>TERM_MAXAGE[term]||age<18)return null;const ann=face/1000*interp(MP_AGES,MP_RATE,age)*MP_TERMS[term]*health*(sex==="F"?0.8:1)*(tob?2.5:1)*(rop?2.4:1)+60;return Math.round(ann*0.088*100)/100}
const IU_AGES=[18,25,30,35,40,45,50,55,60,65,70,75], IU_TGT=[8,9,10.5,12.5,15,18.5,23,29,37,48,62,80];
const FOCUS={protection:[0.55,"Maximize death benefit coverage with limited cash value."],balanced:[0.9,"A middle ground: solid coverage with steady cash value growth."],cash:[1.45,"Maximize cash value by minimizing the amount of protection."]};

/* carriers: Highpoint's carrier partners. Factors are relative pricing estimates for this model, not carrier rates. */
const FE_CARRIERS=[
 {n:"Transamerica",f:.97,plans:["level","graded"]},{n:"Mutual of Omaha",f:1.02,plans:["level","graded"],ages:[45,80],face:[2000,40000],gradedMax:20000},{n:"Aetna",f:.99,plans:["level","graded"]},{n:"Aetna Accendo",f:1,plans:["level","graded"]},
 {n:"American Amicable",f:1.04,plans:["level","graded"],ages:[50,85],face:[2500,50000],faceOld:[76,25000],gradedMax:25000,noDE:true},{n:"Royal Neighbors",f:1.01,plans:["level","graded"]},{n:"Foresters",f:1.06,plans:["level","graded"]},
 {n:"American Home Life",f:1.03,plans:["level","graded"]},{n:"Corebridge",f:1.05,plans:["level","graded","gi"],ages:[50,80],giAges:[50,85],face:[5000,35000],giMax:25000,smoker:[70,30000],noNY:true},{n:"Ethos",f:1.08,plans:["level","gi"],face:[1000,30000],noNY:true},{n:"Fidelity Life",f:1.06,plans:["level","gi"]}];
const TERM_CARRIERS=[{n:"Corebridge (AIG)",f:.96},{n:"Transamerica",f:.98},{n:"Mutual of Omaha",f:1.03},{n:"Ethos",f:1.05},{n:"Foresters",f:1.07},{n:"American Amicable",f:1.1}];
const IUL_CARRIERS=[{k:"ta",n:"Transamerica",f:1,coi:1,load:.06,fee:90},{k:"fg",n:"F&G",f:.97,coi:.97,load:.065,fee:96},{k:"moo",n:"Mutual of Omaha",f:1.03,coi:1.02,load:.055,fee:84},
 {k:"eth",n:"Ethos",f:.9,coi:1.06,load:.08,fee:110,prot:true},{k:"aig",n:"AIG",f:.93,coi:1.04,load:.075,fee:102,prot:true}];
const STATES="AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
$$(".stateSel").forEach(s=>s.innerHTML=STATES.map(x=>`<option ${x==="CA"?"selected":""}>${x}</option>`).join(""));
const ABBR={"Transamerica":"TA","Mutual of Omaha":"MO","Aetna":"AE","American Amicable":"AA","Royal Neighbors":"RN","Foresters":"FF","American Home Life":"AHL","AIG":"AIG","Corebridge":"CB","Fidelity Life":"FL","Aetna Accendo":"AC","Ethos":"ETH","Corebridge (AIG)":"CB","F&G":"F&G"};
const initials=n=>ABBR[n]||n.split(/\s+/).map(w=>w[0]).join("").slice(0,3).toUpperCase();
let LOGOS=ls.get("hp.logos",{});
const cbadge=n=>LOGOS[n]?`<span class="cb logo"><img src="/_blob/${encodeURIComponent(LOGOS[n])}" alt="${esc(n)} logo" loading="lazy" onerror="this.parentNode.classList.add('broken')"></span>`:`<span class="cb" aria-hidden="true">${esc(initials(n))}</span>`;
const kfmt=v=>v>=1e6?"$"+(v/1e6).toFixed(v%1e6?2:0).replace(/\.?0+$/,"")+"M":v>=1e3?"$"+(v/1e3).toFixed(v%1e3?1:0)+"K":"$"+v;

/* IUL projection */
function ilTarget(age,sex,risk,focus,c){return interp(IU_AGES,IU_TGT,age)*(sex==="F"?0.88:1)*risk*FOCUS[focus][0]*c.f}
function corridor(a){return a<=40?2.5:a<=60?2.5-(a-40)*.035:a<=75?1.8-(a-60)*.04:a<=95?1.2-(a-75)*.0075:1}
function ilProject({age,sex,risk,face,annual,payTo,rate,dbo,c,inc}){
  const sx=sex==="F"?0.85:1; let cv=0,paid=0,taken=0,lapse=null; const rows=[];
  const stopPay=inc?Math.min(payTo,inc.start):payTo;
  for(let a=age,yr=1;a<100;a++,yr++){
    const prem=a<stopPay?annual:0; paid+=prem;
    const base=dbo==="B"?face+cv:Math.max(face-taken,10000);
    const db0=Math.max(base,cv*corridor(a)); const nar=Math.max(db0-cv,0);
    const coi=nar/1000*0.32*Math.exp(0.088*(a-25))*sx*Math.max(1,risk)*c.coi;
    cv=(cv+prem*(1-c.load)-c.fee-coi)*(1+rate/100);
    let w=0; if(inc&&a>=inc.start&&a<inc.end){w=inc.amt;cv-=w;taken+=w}
    if(cv<0){lapse=a+1;cv=0;rows.push({yr,age:a+1,paid,cv:0,sv:0,db:0,taken});break}
    const sc=yr<=10?annual*(1-(yr-1)/10)*0.9:0;
    const db=Math.max(dbo==="B"?face+cv:Math.max(face-taken,10000),cv*corridor(a+1));
    rows.push({yr,age:a+1,paid,cv,sv:Math.max(cv-sc,0),db,taken});
  }
  return {rows,lapse};
}
function ilSolveIncome(p){let lo=0,hi=Math.max(p.annual*4,20000);
  while(!ilProject({...p,inc:{...p.inc,amt:hi}}).lapse&&hi<5e6)hi*=2;
  for(let i=0;i<34;i++){const m=(lo+hi)/2;const r=ilProject({...p,inc:{...p.inc,amt:m}});if(r.lapse)hi=m;else lo=m}
  return Math.floor(lo/100)*100;
}

/* ---------- shared amount control ---------- */
function amountCtl(id,{get,set,min,max,step,fmt,suffix}){
  const show=$("#"+id+"Show"), inp=$("#"+id+"In"), rng=$("#"+id);
  rng.min=min();rng.max=max();rng.step=step();
  const paint=()=>{const v=get();rng.min=min();rng.max=max();rng.step=step();rng.value=v;show.innerHTML=`${fmt(v)}${suffix?`<span class="suf">${suffix()}</span>`:""}`;const pn=Math.max(0,Math.min(1,(v-min())/(max()-min())));rng.style.setProperty("--p",(pn*100)+"%");rng.style.setProperty("--pn",pn);rng._jet&&rng._jet.sync();const mn=$("#"+id+"MinL"),mx=$("#"+id+"MaxL");if(mn)mn.textContent=kfmt(min());if(mx)mx.textContent=kfmt(max())};
  rng.oninput=()=>{set(+rng.value)};
  show.onclick=()=>{show.hidden=true;inp.hidden=false;inp.value=get();inp.focus();inp.select()};
  const done=()=>{if(inp.hidden)return;const v=Number(String(inp.value).replace(/[^\d.]/g,""));inp.hidden=true;show.hidden=false;if(v>0)set(Math.min(Math.max(v,min()),max()*20));else paint()};
  inp.onblur=done; inp.onkeydown=e=>{if(e.key==="Enter"){e.preventDefault();done()}if(e.key==="Escape"){inp.hidden=true;show.hidden=false}};
  return paint;
}
function leadOptions(sel){const cur=sel.value;const l=[...leads.values()].sort((a,b)=>fullName(a).localeCompare(fullName(b)));
  sel.innerHTML=`<option value="">${l.length?"No client selected":"No clients yet"}</option>`+l.slice(0,1000).map(x=>`<option value="${esc(x.id)}" ${x.id===cur?"selected":""}>${esc(fullName(x))}${x.age?" · "+esc(x.age):""}</option>`).join("")}
async function attachQuote(leadId,q){const l=leads.get(leadId);if(!l){toast("Pick a client first, then add the quote");return false}
  try{await patchLead(leadId,{quotes:[...(l.quotes||[]),{...q,t:Date.now()}],product:l.product||q.product,notes:addNoteObj(l,`Quoted ${q.carrier?q.carrier+" · ":""}${q.summary}: ${money(q.monthly,2)}/mo (${q.exact?"carrier rate":"estimate"})`)});toast(`Quote added to ${fullName(l)}`);awardXP(5,"quote saved");return true}catch(e){toast("Couldn't save: "+e.message);return false}}
async function copyText(t){try{await navigator.clipboard.writeText(t);toast("Copied")}catch{toast("Copy isn't available here")}}

/* ---------- Quote & compare ---------- */
const Q=ls.get("hp.q",{tab:"FE",age:65,sex:"M",tob:"0",state:"CA",cls:"1",FE:{amt:15000,plan:"level"},TERM:{amt:250000,term:20},IUL:{amt:250000,focus:"protection"},sort:null});
if(!Q.FE)Q.FE={amt:15000,plan:"level"}; if(!Q.TERM)Q.TERM={amt:250000,term:20}; if(!Q.IUL)Q.IUL={amt:250000,focus:"protection"};
const saveQ=()=>ls.set("hp.q",Q);
const QCFG={
 FE:{min:5000,max:50000,step:5000,base:[5000,10000,15000,20000,25000,30000,40000,50000],quick:[[10000,"$10K"],[15000,"$15K"],[25000,"$25K"]],
   plans:Object.entries(FE_PLANS).map(([k,v])=>[k,v[0].replace(" benefit","")]),cur:()=>Q.FE.plan,setPlan:v=>Q.FE.plan=v,desc:()=>FE_PLANS[Q.FE.plan][2],
   rows:()=>FE_CARRIERS.map(c=>{const ok=c.plans.includes(Q.FE.plan);const ageOk=Q.FE.plan==="gi"?(Q.age>=50&&Q.age<=80):(Q.age>=45&&Q.age<=85);
     return{n:c.n,sub:FE_PLANS[Q.FE.plan][0],why:!ok?"No "+FE_PLANS[Q.FE.plan][0].toLowerCase()+" plan":!ageOk?(Q.FE.plan==="gi"?"Typical ages 50–80":"Typical ages 45–85"):"",
       price:f=>Math.round((feQuote({age:Q.age,sex:Q.sex,tob:Q.tob==="1",face:f,plan:Q.FE.plan})-3)*c.f*100+ (3+c.f*1.5)*100)/100}}),
   summary:()=>`${money(Q.FE.amt)} ${FE_PLANS[Q.FE.plan][0].toLowerCase()} final expense`},
 TERM:{min:50000,max:2000000,step:5000,base:[100000,150000,250000,300000,500000,750000,1000000,1500000,2000000],quick:[[100000,"$100K"],[250000,"$250K"],[500000,"$500K"]],
   plans:[10,15,20,25,30].map(t=>[t,t+" years"]),cur:()=>Q.TERM.term,setPlan:v=>Q.TERM.term=+v,desc:()=>`Level premium for ${Q.TERM.term} years. Typical maximum issue age for this length is ${TERM_MAXAGE[Q.TERM.term]}. Match the term to the years left on the mortgage.`,
   rows:()=>TERM_CARRIERS.map(c=>{const t=Q.TERM.term;const okAge=Q.age>=18&&Q.age<=TERM_MAXAGE[t]&&Q.age+t<=85;
     return{n:c.n,sub:`${t}-year term · ${$("#qClass").selectedOptions[0].text}`,why:okAge?"":`Typical max issue age ${TERM_MAXAGE[t]}`,
       checked:c.n==="Ethos",
       price:f=>{const e=ethosTerm({age:Q.age,sex:Q.sex,tob:Q.tob==="1",cls:+Q.cls,face:f,term:t});if(e!=null)return c.n==="Ethos"?e:Math.round(e*c.f/1.05*100)/100;if(c.n==="Ethos")return null;const m=mpQuote({age:Q.age,sex:Q.sex,tob:Q.tob==="1",health:+Q.cls,face:f,term:t,rop:false});return m?Math.round(m*c.f*0.85*100)/100:null}}}),
   summary:()=>`${money(Q.TERM.amt)} ${Q.TERM.term}-year term`},
 IUL:{min:50000,max:3000000,step:5000,base:[100000,250000,500000,750000,1000000,1500000,2000000,3000000],quick:[[100000,"$100K"],[250000,"$250K"],[500000,"$500K"]],
   plans:Object.entries(FOCUS).map(([k])=>[k,{protection:"Protection",balanced:"Balanced",cash:"Cash value"}[k]]),cur:()=>Q.IUL.focus,setPlan:v=>Q.IUL.focus=v,desc:()=>FOCUS[Q.IUL.focus][1]+" Premiums shown are the estimated monthly target to fund this death benefit.",
   rows:()=>IUL_CARRIERS.map(c=>{const ok=Q.age>=18&&Q.age<=75;const risk=Q.tob==="1"?1.55:+Q.cls;
     return{n:c.n,sub:(c.prot?"Protection IUL":"Accumulation IUL")+" · "+{protection:"protection",balanced:"balanced",cash:"cash value"}[Q.IUL.focus]+" design",why:ok?"":"Typical ages 18–75",
       price:f=>Math.round(f/1000*ilTarget(Q.age,Q.sex,risk,Q.IUL.focus,c)/12*100)/100,carrier:c}}),
   summary:()=>`${money(Q.IUL.amt)} IUL, ${Q.IUL.focus==="cash"?"cash value":Q.IUL.focus} design`}
};
let qPaint=null;
function cmpAmounts(cfg,amt){const others=cfg.base.filter(v=>v!==amt);const below=others.filter(v=>v<amt),above=others.filter(v=>v>amt);
  let b=below.slice(-2),a=above.slice(0,2);if(b.length<2)a=above.slice(0,4-b.length);if(a.length<2)b=below.slice(-(4-a.length));return [...b,amt,...a]}

/* ---------- FE underwriting model (general market patterns, estimates) ---------- */
const TIERS=["Preferred","Standard","Graded","Guaranteed issue","Doesn't qualify"];
const TIER_CLS=["t0","t1","t2","t3","t4"];
const TIER_MULT=[.9,1,1.35,1.75];
/* r: [[yearsWithin, tier],...]; first match wins; 99 = any time */
const COND={
 hbp:{n:"High blood pressure (controlled)",r:[[99,0]]},
 chol:{n:"High cholesterol",r:[[99,0]]},
 dm:{n:"Diabetes (oral meds or diet)",r:[[99,1]]},
 dmi:{n:"Diabetes on insulin",r:[[99,1]]},
 dmc:{n:"Diabetes with complications (neuropathy, retinopathy)",r:[[2,2],[99,1]]},
 mi:{n:"Heart attack",r:[[1,3],[2,2],[99,1]]},
 stroke:{n:"Stroke",r:[[1,3],[2,2],[99,1]]},
 tia:{n:"TIA (mini-stroke)",r:[[1,2],[99,1]]},
 cad:{n:"Angina, coronary artery disease, stent or bypass",r:[[1,2],[2,1],[99,1]]},
 chf:{n:"Congestive heart failure",r:[[1,3],[99,2]]},
 afib:{n:"Atrial fibrillation or irregular heartbeat",r:[[1,2],[99,1]]},
 copd:{n:"COPD, emphysema or chronic bronchitis",r:[[2,2],[99,1]]},
 o2:{n:"Uses oxygen",r:[[99,3]]},
 asthma:{n:"Asthma",r:[[99,0]]},
 apnea:{n:"Sleep apnea",r:[[99,0]]},
 cancerNow:{n:"Current cancer (excluding basal/squamous skin)",r:[[99,3]]},
 cancerPast:{n:"Past cancer (excluding basal/squamous skin)",r:[[2,3],[3,2],[99,1]]},
 skin:{n:"Basal or squamous cell skin cancer",r:[[99,0]]},
 ckd:{n:"Chronic kidney disease",r:[[99,2]]},
 dialysis:{n:"Kidney dialysis",r:[[99,3]]},
 liver:{n:"Cirrhosis or liver disease",r:[[99,3]]},
 hepc:{n:"Hepatitis C",r:[[2,2],[99,1]]},
 dementia:{n:"Alzheimer's or dementia",r:[[99,3]]},
 parkinsons:{n:"Parkinson's disease",r:[[99,2]]},
 ms:{n:"Multiple sclerosis",r:[[99,2]]},
 lupus:{n:"Lupus",r:[[99,2]]},
 ra:{n:"Rheumatoid arthritis",r:[[99,1]]},
 bipolar:{n:"Bipolar disorder",r:[[99,1]]},
 schizo:{n:"Schizophrenia",r:[[99,2]]},
 depression:{n:"Depression or anxiety",r:[[99,0]]},
 alcohol:{n:"Alcohol or drug abuse treatment",r:[[2,3],[5,2],[99,1]]},
 hiv:{n:"HIV / AIDS",r:[[99,3]]},
 transplant:{n:"Organ transplant",r:[[99,2]]},
 amput:{n:"Amputation due to disease",r:[[2,2],[99,1]]},
 wheelchair:{n:"Uses a wheelchair or needs help with daily activities",r:[[99,3]]},
 joint:{n:"Hip or knee replacement",r:[[99,0]]},
 thyroid:{n:"Thyroid condition",r:[[99,0]]},
 pending:{n:"Pending surgery or tests",r:[[99,2]]},
 nursing:{n:"Nursing home, hospice or currently hospitalized",r:[[99,4]]},
 terminal:{n:"Terminal illness",r:[[99,4]]}
};
const MEDS={"Lantus":"dmi","Humalog":"dmi","Novolog":"dmi","Levemir":"dmi","Tresiba":"dmi","Basaglar":"dmi","Insulin":"dmi",
 "Metformin":"dm","Glipizide":"dm","Glimepiride":"dm","Jardiance":"dm","Farxiga":"dm","Januvia":"dm","Trulicity":"dm","Ozempic":"dm","Mounjaro":"dm",
 "Lisinopril":"hbp","Amlodipine":"hbp","Losartan":"hbp","Hydrochlorothiazide":"hbp","Metoprolol":"hbp","Carvedilol":"hbp","Valsartan":"hbp",
 "Atorvastatin":"chol","Simvastatin":"chol","Rosuvastatin":"chol","Pravastatin":"chol",
 "Eliquis":"afib","Xarelto":"afib","Warfarin":"afib","Amiodarone":"afib","Diltiazem":"afib",
 "Plavix":"cad","Clopidogrel":"cad","Brilinta":"cad","Nitroglycerin":"cad","Isosorbide":"cad","Ranexa":"cad",
 "Furosemide":"chf","Lasix":"chf","Entresto":"chf","Spironolactone":"chf",
 "Albuterol":"asthma","Spiriva":"copd","Trelegy":"copd","Symbicort":"copd","Breo":"copd","Advair":"copd",
 "Donepezil":"dementia","Aricept":"dementia","Memantine":"dementia","Namenda":"dementia",
 "Carbidopa-levodopa":"parkinsons","Sinemet":"parkinsons",
 "Seroquel":"bipolar","Quetiapine":"bipolar","Lithium":"bipolar","Abilify":"bipolar","Risperidone":"schizo","Clozapine":"schizo","Haloperidol":"schizo",
 "Sertraline":"depression","Lexapro":"depression","Prozac":"depression","Wellbutrin":"depression","Trazodone":"depression",
 "Tamoxifen":"cancerPast","Letrozole":"cancerPast","Anastrozole":"cancerPast","Keytruda":"cancerNow",
 "Biktarvy":"hiv","Genvoya":"hiv","Triumeq":"hiv",
 "Suboxone":"alcohol","Buprenorphine":"alcohol","Methadone":"alcohol","Naltrexone":"alcohol",
 "Hydroxychloroquine":"lupus","Methotrexate":"ra","Humira":"ra","Tacrolimus":"transplant","Prograf":"transplant",
 "Levothyroxine":"thyroid","Synthroid":"thyroid","Ocrevus":"ms","Tecfidera":"ms"};
const NIC={none:["None",false],cig:["Cigarettes",true],cigar:["Cigars",true],pipe:["Pipe",true],chew:["Chewing tobacco",true],vape:["Vape or e-cigarette",true],nrt:["Nicotine patch or gum",true],mj:["Marijuana",false]};
const PAY={eft:"Bank draft / EFT",ssc:"Direct Express / SS card",cc:"Credit or debit card",dc:"Direct bill (mailed)"};
FE_CARRIERS.forEach(c=>c.pref=["Transamerica","Aetna","American Home Life","American Amicable","Royal Neighbors","Foresters","Corebridge","Ethos","Fidelity Life","Aetna Accendo"].includes(c.n));

if(!Q.FE.v2){Q.FE.plan="best";Q.FE.v2=1}if(!["best","level","graded","gi"].includes(Q.FE.plan))Q.FE.plan="best";
Object.assign(Q.FE,Object.assign({mode:"face",budget:50,dob:{m:"",d:"",y:""},ft:"",inch:"",lb:"",nic:"none",pay:"eft",conds:[],meds:[]},Q.FE),{});
// snap saved amounts to the slider steps ($5,000 coverage, $50 budget)
Q.FE.budget=Math.min(500,Math.max(50,Math.round((+Q.FE.budget||50)/50)*50));Q.FE.amt=Math.min(50000,Math.max(5000,Math.round((+Q.FE.amt||15000)/5000)*5000));
for(const k of["TERM","IUL"])Q[k].amt=Math.max(50000,Math.round((+Q[k].amt||250000)/5000)*5000);
["dob"].forEach(k=>{if(!Q.FE[k])Q.FE[k]={m:"",d:"",y:""}});
const FAV=new Set(ls.get("hp.favs",[])); const CARR=ls.get("hp.carriers",{}); let feCmp=new Set(), feOpen=new Set(), fePending=null;
const yrsSince=t=>(Date.now()-t)/(365.25*864e5);
function feAge(){const {m,d,y}=Q.FE.dob;if(!(m&&d&&y&&String(y).length===4))return null;const b=new Date(+y,+m-1,+d);if(isNaN(b))return null;const n=new Date();let a=n.getFullYear()-b.getFullYear();if(n<new Date(n.getFullYear(),b.getMonth(),b.getDate()))a--;return a>0&&a<120?a:null}
function feBMI(){const h=(+Q.FE.ft||0)*12+(+Q.FE.inch||0),w=+Q.FE.lb||0;return h>=48&&w>=70?Math.round(w/(h*h)*703*10)/10:null}
function feUW(){const reasons=[];let t=0;
  for(const c of Q.FE.conds){const C=COND[c.k];if(!C)continue;const y=c.at?yrsSince(c.at):0;const rule=C.r.find(r=>y<r[0])||C.r[C.r.length-1];
    reasons.push({txt:`${C.n}${c.at?` · last treated ${new Date(c.at).toLocaleDateString([],{month:"short",year:"numeric"})}`:""}`,tier:rule[1]});t=Math.max(t,rule[1])}
  const bmi=feBMI();if(bmi){const bt=bmi<17?2:bmi<38?0:bmi<43?1:bmi<48?2:3;if(bt)reasons.push({txt:`Build: BMI ${bmi}`,tier:bt});t=Math.max(t,bt)}
  return{t,reasons,bmi}}
const CUW={"American Amicable":{afib:[[99,1]],dmi:[[99,1]],bipolar:[[99,1]],schizo:[[99,1]],depression:[[99,0]]},
  "Mutual of Omaha":{afib:[[1,2],[99,1]],cancerPast:[[4,2],[99,1]],mi:[[2,2],[99,1]],stroke:[[2,2],[99,1]],cad:[[2,2],[99,1]],dm:[[99,1]]}};
function carrierT(c,uw){const o=CUW[c.n];if(!o)return uw.t;let t=0;
  for(const x of Q.FE.conds){const C=COND[x.k];if(!C)continue;const r=o[x.k]||C.r;const y=x.at?yrsSince(x.at):0;t=Math.max(t,(r.find(q=>y<q[0])||r[r.length-1])[1])}
  for(const r of uw.reasons)if(/^Build/.test(r.txt))t=Math.max(t,r.tier);return t}
function carrierPlan(c,t,filter,age){const opts=[];
  const lvlOk=age>=45&&age<=85,giOk=age>=50&&age<=80;
  if(c.plans.includes("level")&&t<=1&&lvlOk)opts.push(t===0&&c.pref?0:1);
  if(c.plans.includes("graded")&&t<=2&&lvlOk)opts.push(2);
  if(c.plans.includes("gi")&&t<=3&&giOk)opts.push(3);
  const f=filter==="level"?opts.filter(x=>x<=1):filter==="graded"?opts.filter(x=>x===2):filter==="gi"?opts.filter(x=>x===3):opts;
  return f.length?Math.min(...f):null}
function feFee(c){return 3+c.f*1.5}
/* exact carrier rates (public/hp-rates.js). Returns {m: monthly bank draft, cls} or null when the carrier wouldn't issue it. */
function taFexQuote({age,sex,tob,tier,face,state}){const R=window.HP_RATES?.taFex;if(!R||tier>1||state==="NY")return null;
  if(age<R.minAge||age>R.maxAge||face<5000||face>(age<=75?100000:25000))return null;
  const units=Math.round(face/1000);const band=face<10000?1:face<25000?2:face<50000?3:4;const row=R.bands[band]?.[age-18];if(!row)return null;
  let i,cls;if(band===1){i=(sex==="M"?2:0)+(tob?1:0);cls=tob?"Select Smoker":"Select Nonsmoker"}
  else{const prem=tier===0&&!tob&&state!=="CA";i=(sex==="M"?3:0)+(tob?2:prem?0:1);cls=tob?"Smoker":prem?"Premier":"Select Nonsmoker"}
  return{m:Math.round((row[i]*units+R.fee)*R.monthly*100)/100,cls}}
/* market-checked estimates (public/hp-est.js): curves of real Toolkits quotes at $10,000, interpolated between ages */
function estM10(c,sex,cls,age){const E=window.HP_EST,f=E.fee[c],cv=(s,k)=>E.curves[c]?.[s]?.[k]||[];
  let p=cv(sex,cls),sh=0;if(p.length<2){const o=cv(sex==="M"?"F":"M",cls);if(o.length>=2){p=o;sh=sex==="F"?-5:5}}
  if(p.length<2){if(cls==="std"){const q=estM10(c,sex,"pref",age);return q==null?null:f+(q-f)*1.3}return null}
  const a=age+sh,n=p.length;const i=a<=p[0][0]?1:a>=p[n-1][0]?n-1:p.findIndex(x=>a<=x[0]);const [x0,y0]=p[i-1],[x1,y1]=p[i],t=(a-x0)/(x1-x0);
  return f+Math.exp(Math.log(y0-f)+t*(Math.log(y1-f)-Math.log(y0-f)))}
function estQuote(c,{age,sex,tob,tier}){const E=window.HP_EST;if(!E?.curves?.[c])return null;const f=E.fee[c];
  const single=!["M","F"].some(s=>E.curves[c][s]?.std);const m=estM10(c,sex,tier===0||single||tier>1?"pref":"std",age);if(m==null)return null;
  let unit=(m-f)/10;if(tob)unit*=E.tob[c]||1.39;if(tier===2)unit*=1.35;if(tier===3)unit*=E.gi?.[c]||1.5;return{unit,fee:f}}
function taFexBudget(o,budget){const max=o.age<=75?100000:25000;let best=null;
  for(let f=5000;f<=max;f+=1000){const q=taFexQuote({...o,face:f});if(q&&q.m<=budget)best=f}return best}
function fePer1000(c,tier){const tob=NIC[Q.FE.nic]?.[1];return (feQuote({age:Q.age,sex:Q.sex,tob,face:1000,plan:"level"})-3)*TIER_MULT[tier]*c.f}
function feCfg(){const B=Q.FE.mode==="budget";const uw=feUW();
  return{budget:B,uw,min:B?50:5000,max:B?500:50000,step:B?50:5000,
   base:B?[50,100,150,200,250,300,400,500]:[5000,10000,15000,20000,25000,30000,40000,50000],
   quick:B?[[50,"$50/mo"],[100,"$100/mo"],[150,"$150/mo"]]:[[10000,"$10K"],[15000,"$15K"],[25000,"$25K"]],
   plans:[["best","Best available"],["level","Level"],["graded","Graded"],["gi","Guaranteed issue"]],cur:()=>Q.FE.plan,setPlan:v=>Q.FE.plan=v,
   desc:()=>({best:"Each carrier is shown with the best plan this client likely qualifies for, based on the health answers below.",level:FE_PLANS.level[2],graded:FE_PLANS.graded[2],gi:FE_PLANS.gi[2]})[Q.FE.plan],
   rows:()=>FE_CARRIERS.filter(c=>!CARR[c.n]?.off).map(c=>{const ct=carrierT(c,uw);let tier=carrierPlan(c,ct,Q.FE.plan,Q.age);
     const why=tier==null?(ct>=4?"Doesn't qualify (health)":Q.age<45||Q.age>85?"Outside typical issue ages":ct>3?"Doesn't qualify":"No plan for this health profile"):"";
     const xo=c.n==="Transamerica"&&tier!=null&&tier<=1?{age:Q.age,sex:Q.sex,tob:!!NIC[Q.FE.nic]?.[1],tier,state:Q.state}:null;
     const xq=xo&&taFexQuote({...xo,face:B?10000:Q.FE.amt});
     if(xo)return{n:c.n,c,tier,exact:true,sub:`Level · ${xq?xq.cls:TIERS[tier]}`,plan:"FE Express",why:Q.state==="NY"?"Not sold in New York":"",reasons:uw.reasons,
       price:a=>B?taFexBudget(xo,a):taFexQuote({...xo,face:a})?.m??null};
     let tierX=tier,dz=null;
     if(c.n==="Aetna Accendo"&&tier!=null){dz=accendoDrugs(Q.FE.meds);if(dz.tier>=4)return{n:c.n,c,tier:null,sub:"",why:"Declined: Accendo drug list",reasons:[...uw.reasons,...dz.hits.map(h=>({txt:`${h.m}: not accepted for ${h.plans.join(", ")}${h.any?"":" if prescribed for "+h.cond}`,tier:h.any?Math.min(3,h.t):1}))],price:()=>null};
       if(dz.tier>tier){tierX=dz.tier>=2?2:1}}
     tier=tierX;
     const tobX=!!NIC[Q.FE.nic]?.[1], ag=tier===3&&c.giAges?c.giAges:c.ages;
     const lim=tier==null?"":c.noDE&&Q.FE.pay==="ssc"?"Doesn't take Direct Express cards":c.noNY&&Q.state==="NY"?"Not sold in New York":ag&&(Q.age<ag[0]||Q.age>ag[1])?`Issue ages ${ag[0]}–${ag[1]}`:c.smoker&&tobX&&tier<3&&Q.age>c.smoker[0]?`Tobacco users only to age ${c.smoker[0]}`:"";
     if(lim)return{n:c.n,c,tier,sub:"",why:lim,reasons:uw.reasons,price:()=>null};
     const eq=tier!=null&&estQuote(c.n,{age:Q.age,sex:Q.sex,tob:!!NIC[Q.FE.nic]?.[1],tier});
     const one=eq&&!["M","F"].some(s=>window.HP_EST.curves[c.n][s]?.std);
     const rs=dz?.hits?.length?[...uw.reasons,...dz.hits.map(h=>({txt:`Accendo drug list: ${h.m} not accepted for ${h.plans.join(", ")}${h.any?"":" if prescribed for "+h.cond}`,tier:h.any?Math.min(3,h.t>=2?2:1):1}))]:uw.reasons;
     const fmax=tier===3&&c.giMax?c.giMax:tier===2&&c.gradedMax?c.gradedMax:c.smoker&&tobX&&tier<3?Math.min(c.smoker[1],c.face?.[1]??1e9):c.faceOld&&Q.age>=c.faceOld[0]?c.faceOld[1]:c.face?.[1];
     const fok=a=>a>=(c.face?.[0]??0)&&(fmax==null||a<=fmax);
     if(eq)return{n:c.n,c,tier,checked:true,sub:tier<=1?(one?"Level":`Level · ${TIERS[tier]}`):tier===2&&c.n==="Aetna Accendo"?"Modified":TIERS[tier],why,reasons:rs,
       price:a=>{if(B){const f=Math.max(0,Math.floor((a-eq.fee)/eq.unit*1000/500)*500);return f&&(!c.face||f>=c.face[0])?Math.min(f,fmax??f):null}if(!fok(a))return null;return Math.round((a/1000*eq.unit+eq.fee)*100)/100}};
     return{n:c.n,c,tier,sub:tier==null?"":`${tier<=1?"Level · ":""}${TIERS[tier]}`,why,reasons:uw.reasons,
       price:a=>tier==null?null:B?Math.min(fmax??1e9,Math.max(0,Math.floor((a-feFee(c))/fePer1000(c,tier)*1000/500)*500))||null:fok(a)?Math.round((a/1000*fePer1000(c,tier)+feFee(c))*100)/100:null}}),
   summary:()=>B?`${money(Q.FE.budget)}/mo final expense budget`:`${money(Q.FE.amt)} final expense`,
   amtKey:B?"budget":"amt"}}

/* ---------- FE panel UI ---------- */
function renderFEPanel(){const F=Q.FE;const age=feAge();const uw=feUW();
  $("#feM").value=F.dob.m;$("#feD").value=F.dob.d;$("#feY").value=F.dob.y;$("#feAgeOut").textContent=age?`(age ${age})`:"";
  $("#feFt").value=F.ft;$("#feIn").value=F.inch;$("#feLb").value=F.lb;$("#feBmi").textContent=uw.bmi?`BMI ${uw.bmi}`:"";
  $("#feNic").value=F.nic;$("#fePay").value=F.pay;
  $$("#feMode button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.m===F.mode));
  $("#qAmtTitle").textContent=F.mode==="budget"&&Q.tab==="FE"?"Monthly budget":"Coverage amount";
  $("#feChips").innerHTML=F.conds.map((c,i)=>`<div class="hchip c"><span class="ico">+</span><div><b>${esc(COND[c.k]?.n||c.k)}</b><span>${c.at?"Last treated "+new Date(c.at).toLocaleDateString([],{month:"short",year:"numeric"}):"Date not set"}</span></div><button class="wbtn" data-ce="${i}" aria-label="Edit date">✎</button><button class="wbtn" data-cx="${i}" aria-label="Remove">✕</button></div>`).join("")+
    F.meds.map((m,i)=>`<div class="hchip m"><span class="ico">Rx</span><div><b>${esc(m)}</b><span>${MEDS[m]?"Usually for "+esc(COND[MEDS[m]].n.toLowerCase()):"Medication"}</span></div><button class="wbtn" data-mx="${i}" aria-label="Remove">✕</button></div>`).join("")||`<p class="muted" style="margin:0;font-size:13px">No conditions or medications added. A clean health history qualifies for the best level plans.</p>`;
  $("#feUw").innerHTML=`<span class="tierpill ${TIER_CLS[uw.t]}">${uw.t===0?"Likely Preferred":uw.t===1?"Likely Standard":uw.t===2?"Likely Graded":uw.t===3?"Likely Guaranteed issue":"Likely doesn't qualify"}</span>${uw.reasons.filter(r=>r.tier>0).slice(0,3).map(r=>`<span class="muted" style="font-size:12.5px">${esc(r.txt)} → ${TIERS[r.tier]}</span>`).join("")}`;
  $$("#feChips [data-cx]").forEach(b=>b.onclick=()=>{F.conds.splice(+b.dataset.cx,1);saveQ();renderQuoter()});
  $$("#feChips [data-mx]").forEach(b=>b.onclick=()=>{F.meds.splice(+b.dataset.mx,1);saveQ();renderQuoter()});
  $$("#feChips [data-ce]").forEach(b=>b.onclick=()=>askDate(F.conds[+b.dataset.ce].k,+b.dataset.ce));
  $("#feDate").hidden=!fePending;
}
function askDate(k,idx=null){fePending={k,idx};const box=$("#feDate");box.hidden=false;const now=new Date();
  $("#feDateT").textContent=COND[k].n;
  $("#feDM").innerHTML=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m,i)=>`<option value="${i}" ${i===now.getMonth()?"selected":""}>${m}</option>`).join("");
  $("#feDY").innerHTML=Array.from({length:40},(_,i)=>now.getFullYear()-i).map(y=>`<option>${y}</option>`).join("");
  if(idx!=null&&Q.FE.conds[idx].at){const d=new Date(Q.FE.conds[idx].at);$("#feDM").value=d.getMonth();$("#feDY").value=d.getFullYear()}
  $("#feDM").focus()}
function suggest(inp,list,pick){const q=inp.value.trim().toLowerCase();const box=inp.nextElementSibling;
  if(!q){box.hidden=true;return}const hits=list.filter(x=>x.label.toLowerCase().includes(q)).slice(0,7);
  box.innerHTML=hits.map((h,i)=>`<button type="button" data-i="${i}">${esc(h.label)}${h.hint?`<span class="muted"> · ${esc(h.hint)}</span>`:""}</button>`).join("")||`<span class="muted" style="padding:8px 12px;display:block">No match. Try another word.</span>`;box.hidden=false;
  box.querySelectorAll("[data-i]").forEach(b=>b.onmousedown=e=>{e.preventDefault();pick(hits[+b.dataset.i]);inp.value="";box.hidden=true})}
const CLIST=Object.entries(COND).map(([k,v])=>({k,label:v.n}));
const MLIST=Object.keys(MEDS).map(m=>({m,label:m,hint:COND[MEDS[m]].n}));
const tcase=s=>s.toLowerCase().replace(/(^|[\s\-\/(])([a-z])/g,(a,b,c)=>b+c.toUpperCase());
{const seen=new Set(MLIST.map(x=>x.m.toLowerCase()));for(const r of window.HP_DRUGS?.accendo?.rows||[]){const n=tcase(r[0]);if(seen.has(n.toLowerCase()))continue;seen.add(n.toLowerCase());MLIST.push({m:n,label:n,hint:"On Aetna Accendo's drug list"})}}
/* Accendo drug list check: hard = blocked for any condition; soft = blocked only if prescribed for the listed condition */
function accendoDrugs(meds){const R=window.HP_DRUGS?.accendo?.rows;if(!R||!meds.length)return{tier:0,hits:[]};const hits=[];let tier=0;
  for(const m of meds){const k=m.toLowerCase();for(const [d,cond,p,s,mo] of R){if(d.toLowerCase()!==k)continue;const any=/^any condition$/i.test(cond);const t=p&&s&&mo?4:p&&s?2:p?1:0;hits.push({m,cond,any,t,plans:[p&&"Preferred",s&&"Standard",mo&&"Modified"].filter(Boolean)});if(any)tier=Math.max(tier,t)}}
  return{tier,hits}}
$("#feCondQ").addEventListener("input",e=>suggest(e.target,CLIST,h=>{askDate(h.k)}));
$("#feMedQ").addEventListener("input",e=>suggest(e.target,MLIST,h=>{const F=Q.FE;if(!F.meds.includes(h.m))F.meds.push(h.m);const k=MEDS[h.m];if(k&&!F.conds.some(c=>c.k===k)){saveQ();renderQuoter();askDate(k);toast(`Added ${h.m}. When was ${COND[k].n.toLowerCase()} last treated?`)}else{saveQ();renderQuoter()}}));
[$("#feCondQ"),$("#feMedQ")].forEach(i=>i.addEventListener("blur",()=>setTimeout(()=>i.nextElementSibling.hidden=true,150)));
$("#feDSave").onclick=()=>{if(!fePending)return;const at=new Date(+$("#feDY").value,+$("#feDM").value,15).getTime();const F=Q.FE;
  if(fePending.idx!=null)F.conds[fePending.idx].at=at;else{const ex=F.conds.findIndex(c=>c.k===fePending.k);if(ex>=0)F.conds[ex].at=at;else F.conds.push({k:fePending.k,at})}
  fePending=null;saveQ();renderQuoter()};
$("#feDCancel").onclick=()=>{fePending=null;$("#feDate").hidden=true};
const DOBF=[["#feM","m",2,1],["#feD","d",2,3],["#feY","y",4,99]];
DOBF.forEach(([sel,k,len,maxFirst],i)=>{const el=$(sel);
  el.addEventListener("input",e=>{let v=el.value.replace(/\D/g,"");
    const raw=el.value;if(i===0&&/\d{1,2}\D\d{1,2}\D\d{2,4}/.test(raw)){const [m,d,y]=raw.split(/\D+/);Q.FE.dob={m:m.padStart(2,"0"),d:d.padStart(2,"0"),y:y.length===2?(+y>30?"19":"20")+y:y};const a=feAge();if(a)Q.age=a;saveQ();renderQuoter();$("#feY").focus();return}
    if(v.length>len)v=v.slice(0,len);
    if(i<2&&v.length===1&&+v>maxFirst)v="0"+v;
    el.value=v;Q.FE.dob[k]=v;const a=feAge();if(a)Q.age=a;saveQ();
    const full=v.length===len;
    if(k!=="y"||full)renderQuoter();
    if(full&&i<2){const nx=$(DOBF[i+1][0]);nx.focus();nx.select()}});
  el.addEventListener("keydown",e=>{if(e.key==="Backspace"&&!el.value&&i>0){e.preventDefault();const pv=$(DOBF[i-1][0]);pv.focus();pv.value=pv.value.slice(0,-1);Q.FE.dob[DOBF[i-1][1]]=pv.value;saveQ()}
    if((e.key==="/"||e.key==="-"||e.key===".")&&i<2){e.preventDefault();if(el.value.length===1){el.value="0"+el.value;Q.FE.dob[k]=el.value;saveQ()}const nx=$(DOBF[i+1][0]);nx.focus();nx.select()}});
  el.addEventListener("focus",()=>el.select());
});
[["#feFt","ft"],["#feIn","inch"],["#feLb","lb"]].forEach(([s,k])=>$(s).addEventListener("change",()=>{Q.FE[k]=$(s).value;saveQ();renderQuoter()}));
$("#feNic").addEventListener("change",()=>{Q.FE.nic=$("#feNic").value;Q.tob=NIC[Q.FE.nic][1]?"1":"0";saveQ();renderQuoter()});
$("#fePay").addEventListener("change",()=>{Q.FE.pay=$("#fePay").value;saveQ();renderQuoter()});
$$("#feMode button").forEach(b=>b.onclick=()=>{Q.FE.mode=b.dataset.m;Q.sort=null;saveQ();renderQuoter()});
$("#feClear").onclick=()=>{Object.assign(Q.FE,{dob:{m:"",d:"",y:""},ft:"",inch:"",lb:"",nic:"none",pay:"eft",conds:[],meds:[]});Q.tob="0";saveQ();renderQuoter();toast("Cleared")};
$("#feNic").innerHTML=Object.entries(NIC).map(([k,v])=>`<option value="${k}">${v[0]}</option>`).join("");
$("#fePay").innerHTML=Object.entries(PAY).map(([k,v])=>`<option value="${k}">${v}</option>`).join("");

/* compare + customize carriers */
function openCompare(rows,amts,cfg){const sel=rows.filter(r=>feCmp.has(r.n));if(sel.length<2){toast("Pick 2 or 3 carriers to compare");return}
  const b=openWin("cmp",{title:"Compare",sub:`${sel.length} carriers`,w:Math.min(760,innerWidth-24),h:560});
  const fmt=v=>v==null?"—":cfg.budget?money(v):money(v,2);
  b.innerHTML=`<div class="tablewrap"><table><thead><tr><th></th>${sel.map(r=>`<th><div class="crow">${cbadge(r.n)}<b>${esc(r.n)}</b></div></th>`).join("")}</tr></thead><tbody>
   <tr><td class="muted">Plan</td>${sel.map(r=>`<td><span class="tierpill ${TIER_CLS[r.tier]}">${esc(r.sub)}</span></td>`).join("")}</tr>
   ${amts.map(a=>`<tr><td class="muted">${cfg.budget?money(a)+"/mo":kfmt(a)}</td>${sel.map(r=>`<td class="num"><b>${fmt(r.p[a])}</b>${cfg.budget?"":" /mo"}</td>`).join("")}</tr>`).join("")}
   <tr><td class="muted">Benefit</td>${sel.map(r=>`<td style="white-space:normal;font-size:12.5px">${esc(FE_PLANS[r.tier<=1?"level":r.tier===2?"graded":"gi"][2])}</td>`).join("")}</tr>
   <tr><td class="muted">E-App</td>${sel.map(r=>`<td>${CARR[r.n]?.url?`<a class="btn sm primary" href="${esc(CARR[r.n].url)}" target="_blank" rel="noopener">E-App ↗</a>`:'<span class="muted">Add link in Customize carriers</span>'}</td>`).join("")}</tr></tbody></table></div>
   <p class="disclaim">${sel.some(r=>r.exact)?"Transamerica level: carrier rates. Others: estimates.":"Estimates, not carrier rates."}</p>`}
function allCarrierNames(){return [...new Set([...FE_CARRIERS,...TERM_CARRIERS,...IUL_CARRIERS].map(c=>c.n))]}
async function saveLogos(){ls.set("hp.logos",LOGOS);if(db){try{await db.doc("settings/logos").set({map:LOGOS,updatedAt:Date.now()})}catch(e){toast("Couldn't save logos: "+(e.message||e.code))}}}
function initLogos(){if(!db)return;db.doc("settings/logos").onSnapshot(d=>{const v=d.exists?d.data():null;if(v&&v.map){LOGOS={...v.map};ls.set("hp.logos",LOGOS);if(view==="quoter")renderQuoter();if(view==="iul")renderIul();if(WINS.get("carriers"))openCarriers()}},()=>{})}
let assetsApi;async function getAssets(){if(assetsApi===undefined){try{assetsApi=await window.claude?.use?.("assets")}catch{assetsApi=null}}return assetsApi}
function openCarriers(){const b=openWin("carriers",{title:"Customize carriers",sub:"Logos, on/off and E-App links",w:560,h:660});
  const fe=new Set(FE_CARRIERS.map(c=>c.n));
  b.innerHTML=`<p class="muted" style="font-size:12.5px;margin:0">Upload each carrier's official logo (PNG, JPG or SVG from the carrier's agent portal or marketing center). Logos are shared with everyone on this desk.</p>`+allCarrierNames().map(n=>`<div class="carrow">${cbadge(n)}<div style="flex:1;min-width:0"><b>${esc(n)}</b>
     <div class="row" style="gap:6px;margin-top:6px"><label class="btn sm" style="cursor:pointer">${LOGOS[n]?"Replace logo":"Upload logo"}<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" data-logo="${esc(n)}" hidden></label>${LOGOS[n]?`<button class="btn sm" data-rmlogo="${esc(n)}">Remove</button>`:""}</div>
     ${fe.has(n)?`<input data-url="${esc(n)}" placeholder="https:// your E-App or agent portal link" value="${esc(CARR[n]?.url||"")}" inputmode="url">`:""}</div>
     ${fe.has(n)?`<div class="seg2"><button type="button" data-on="${esc(n)}" aria-pressed="${!CARR[n]?.off}">On</button><button type="button" data-off="${esc(n)}" aria-pressed="${!!CARR[n]?.off}">Off</button></div>`:""}</div>`).join("");
  const save=()=>{ls.set("hp.carriers",CARR);renderQuoter()};
  b.querySelectorAll("[data-url]").forEach(i=>i.onchange=()=>{const v=i.value.trim();if(v&&!/^https:\/\//.test(v)){toast("Links must start with https://");return}(CARR[i.dataset.url]??={}).url=v;save();toast("Link saved")});
  b.querySelectorAll("[data-on]").forEach(x=>x.onclick=()=>{(CARR[x.dataset.on]??={}).off=false;save();openCarriers()});
  b.querySelectorAll("[data-off]").forEach(x=>x.onclick=()=>{(CARR[x.dataset.off]??={}).off=true;save();openCarriers()});
  b.querySelectorAll("[data-logo]").forEach(inp=>inp.onchange=async()=>{const f=inp.files[0];if(!f)return;const n=inp.dataset.logo;
    if(!/^image\/(png|jpeg|webp|svg\+xml)$/.test(f.type)){toast("Use a PNG, JPG, WebP or SVG file");return}
    if(f.size>(f.type==="image/svg+xml"?2:4)*1048576){toast("That file is too large. Use one under 4 MB (2 MB for SVG).");return}
    const A=await getAssets();if(!A){toast("Sign in to upload logos.");return}
    try{toast("Uploading "+n+" logo…");const r=await A.upload(f);const old=LOGOS[n];LOGOS[n]=r.id;await saveLogos();if(old){A.delete(old).catch(()=>{})}toast(n+" logo added");openCarriers();renderQuoter()}
    catch(e){toast(e?.code==="quota_exceeded"?"Logo storage is full. Remove an old logo first.":e?.code==="unsupported_type"||e?.code==="invalid_request"?"That file type didn't work. Try a PNG.":"Upload failed: "+(e?.message||e?.code))}});
  b.querySelectorAll("[data-rmlogo]").forEach(x=>x.onclick=async()=>{const n=x.dataset.rmlogo,id=LOGOS[n];delete LOGOS[n];await saveLogos();const A=await getAssets();if(A&&id)A.delete(id).catch(()=>{});toast("Logo removed");openCarriers();renderQuoter()});
}
$("#qCarriers").onclick=openCarriers;
if($("#wavvCopy"))$("#wavvCopy").onclick=()=>copyText("ANT");

function renderQuoter(){
  leadOptions($("#qLead")); const T=Q.tab, cfg=T==="FE"?feCfg():QCFG[T], st=Q[T], K=cfg.amtKey||"amt", B=!!cfg.budget;
  $$("#qTabs button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.q===T));
  $$("[data-only]").forEach(e=>e.hidden=e.dataset.only!==T);
  $$("[data-hide]").forEach(e=>e.hidden=e.dataset.hide===T);
  $("#qAge").value=Q.age;$("#qSex").value=Q.sex;$("#qTob").value=Q.tob;$("#qState").value=Q.state;$("#qClass").value=Q.cls;
  if(T==="FE")renderFEPanel(); else $("#qAmtTitle").textContent="Coverage amount";
  if(!(st[K]>=cfg.min&&st[K]<=cfg.max*20))st[K]=B?60:cfg.base[2];
  const amt=st[K]; const fmtA=v=>B?money(v)+"/mo":money(v);
  qPaint=amountCtl("qAmt",{get:()=>st[K],set:v=>{st[K]=Math.round(v/cfg.step)*cfg.step||cfg.step;Q.sort=null;saveQ();renderQuoter()},min:()=>cfg.min,max:()=>cfg.max,step:()=>cfg.step,fmt:v=>money(v),suffix:()=>B?"/mo":""});qPaint();
  $("#qQuick").innerHTML=cfg.quick.map(([v,l])=>`<button type="button" class="chip2" data-amt="${v}">${l}</button>`).join("")+(T==="TERM"&&leads.get($("#qLead").value)?.mortgageBalance?`<button type="button" class="chip2" data-amt="${leads.get($("#qLead").value).mortgageBalance}">Mortgage balance</button>`:"");
  $$("#qQuick [data-amt]").forEach(b=>b.onclick=()=>{st[K]=Math.round(+b.dataset.amt/cfg.step)*cfg.step;Q.sort=null;saveQ();renderQuoter()});
  $("#qPlans").innerHTML=cfg.plans.map(([k,l])=>`<button type="button" data-p="${k}" aria-pressed="${String(cfg.cur())===String(k)}">${l}</button>`).join("");
  $$("#qPlans button").forEach(b=>b.onclick=()=>{cfg.setPlan(b.dataset.p);saveQ();renderQuoter()});
  $("#qPlanDesc").textContent=cfg.desc();
  const amts=cmpAmounts(cfg,amt); const sortBy=amts.includes(Q.sort)?Q.sort:amt;
  const rows=cfg.rows().map(r=>({...r,p:Object.fromEntries(amts.map(a=>[a,r.why?null:r.price(a)]))}));
  const val=(r,a)=>r.p[a]==null?(B?-1:1e12):r.p[a];
  rows.sort((a,b)=>(T==="FE"?(FAV.has(b.n)-FAV.has(a.n)):0)||(B?val(b,sortBy)-val(a,sortBy):val(a,sortBy)-val(b,sortBy)));
  const elig=rows.filter(r=>r.p[amt]!=null);const best=elig.length?elig.reduce((m,r)=>B?(r.p[amt]>m.p[amt]?r:m):(r.p[amt]<m.p[amt]?r:m)):null;
  const cell=v=>v==null?"—":B?money(v):money(v,2);
  const summ=r=>B?`${money(r.p[amt])} of coverage for ${money(amt)}/mo`:`${money(r.p[amt],2)}/mo`;
  const q=best?{product:T==="TERM"?"MP":T,carrier:best.n,exact:!!best.exact,monthly:B?amt:best.p[amt],summary:(B?`${money(best.p[amt])} ${best.sub||""} final expense`:cfg.summary()+(best.sub?` · ${best.sub}`:""))+`, age ${Q.age} ${Q.sex}${Q.tob==="1"?" tobacco":""}, ${Q.state}`}:null;
  $("#qLeadWith").innerHTML=best?`<div class="leadwith panel"><span class="lw">Lead with</span>${cbadge(best.n)}<div class="lwname"><b>${esc(best.n)}</b><span class="muted">${fmtA(amt)} · ${esc(best.sub)}</span></div><div class="lwprice"><b class="num" data-count="${best.p[amt]}" data-key="lw" data-fmt="${B?"money0":"money2"}">${cell(best.p[amt])}</b><span class="muted">${B?"coverage · most for the money":"/mo · cheapest"}</span></div><div class="row"><button class="btn sm" id="qCopy">Copy</button>${CARR[best.n]?.url?`<a class="btn sm" href="${esc(CARR[best.n].url)}" target="_blank" rel="noopener">E-App ↗</a>`:""}<button class="btn sm primary" id="qCrm">+ CRM</button>${T==="IUL"?`<button class="btn sm" id="qIllu">Illustrate</button>`:""}</div></div>`
    :`<div class="notice">${T==="FE"&&feUW().t>=4?"Based on the health answers, this client likely doesn't qualify for final expense right now.":`No carrier in this model offers this plan at age ${Q.age}.`} Try another plan type${T==="TERM"?" or a shorter term":""}.</div>`;
  if(best){$("#qCopy").onclick=()=>copyText(`${best.n}: ${fmtA(amt)} ${best.sub} — ${summ(best)}${best.exact?"":" (estimate)"}`);
    $("#qCrm").onclick=()=>attachQuote($("#qLead").value,q);
    if($("#qIllu"))$("#qIllu").onclick=()=>{IL.carrier=best.carrier.k;IL.mode="coverage";IL.cov=amt;IL.focus=Q.IUL.focus;IL.age=Q.age;IL.sex=Q.sex;saveIL();go("iul")}}
  const FEX=T==="FE";
  $("#qCmpBar").innerHTML=FEX?`<button class="btn sm" id="qCmpGo" ${feCmp.size<2?"disabled":""}>Compare selected (${feCmp.size})</button>${feCmp.size?`<button class="btn sm" id="qCmpClr">Clear</button>`:""}<span class="muted" style="font-size:12.5px">Tick up to 3 carriers. Tap ★ to pin favorites to the top.</span>`:"";
  if($("#qCmpGo"))$("#qCmpGo").onclick=()=>openCompare(rows,amts,cfg); if($("#qCmpClr"))$("#qCmpClr").onclick=()=>{feCmp.clear();renderQuoter()};
  $("#qTable").innerHTML=`<table><thead><tr>${FEX?"<th></th>":""}<th>Carrier</th>${amts.map(a=>`<th class="amtcol ${a===amt?"you":""}"><button type="button" data-sort="${a}" aria-pressed="${a===sortBy}">${a===amt?(B?"Your budget<br>":"Your amount<br>"):""}${B?money(a)+"/mo":kfmt(a)}${a===sortBy?" ↓":""}</button></th>`).join("")}<th></th></tr></thead><tbody>
    ${rows.map((r,i)=>{const open=FEX&&feOpen.has(r.n);return `<tr class="${r.why?"off":""}">${FEX?`<td class="lead"><button class="star ${FAV.has(r.n)?"on":""}" data-fav="${esc(r.n)}" aria-label="Favorite ${esc(r.n)}">★</button>${r.why?"":`<input type="checkbox" data-cmp="${esc(r.n)}" ${feCmp.has(r.n)?"checked":""} aria-label="Compare ${esc(r.n)}">`}</td>`:""}<td><div class="crow">${r.why?"":`<span class="rank">#${i+1}</span>`}${cbadge(r.n)}<div><b>${esc(r.n)}</b>${r.exact&&!r.why?`<span class="xrate" title="${esc(window.HP_RATES.taFex.source)}">Carrier rates · ${esc(window.HP_RATES.taFex.asOf)}</span>`:r.checked&&!r.why?`<span class="xrate chk" title="${T==="TERM"?"From Ethos's own online estimator (Texas)":"Estimate built from real Insurance Toolkits quotes (Texas, bank draft)"}">${T==="TERM"?"Ethos online rates":"Market-checked estimate"}</span>`:(FEX||T==="TERM")&&!r.why?`<span class="xrate rough" title="Highpoint model only. Not checked against real quotes yet.">Rough estimate</span>`:""}${FEX&&!r.why?`<span class="tierpill sm ${TIER_CLS[r.tier]}">${esc(r.sub)}</span>`:`<span class="muted">${esc(r.why||r.sub)}</span>`}</div></div></td>${amts.map(a=>`<td class="num ${a===amt?"you":""}">${cell(r.p[a])}</td>`).join("")}<td><div class="row" style="flex-wrap:nowrap;gap:6px;justify-content:flex-end">${r.why?"":`${FEX&&CARR[r.n]?.url?`<a class="btn sm primary" href="${esc(CARR[r.n].url)}" target="_blank" rel="noopener">E-App</a>`:""}<button class="btn sm" data-crm="${i}">+ CRM</button>`}${FEX?`<button class="wbtn chev ${open?"open":""}" data-open="${esc(r.n)}" aria-label="Details">⌄</button>`:""}</div></td></tr>
      ${open?`<tr class="detail"><td colspan="${amts.length+3}"><div class="det">${r.why?`<b>${esc(r.why)}</b>`:`<b>${esc(r.sub)}</b> · ${esc(FE_PLANS[r.tier<=1?"level":r.tier===2?"graded":"gi"][2])}`}${r.reasons.length?`<ul>${r.reasons.map(x=>`<li>${esc(x.txt)} <span class="tierpill sm ${TIER_CLS[x.tier]}">${TIERS[x.tier]}</span></li>`).join("")}</ul>`:`<p class="muted" style="margin:6px 0 0">No health items entered.</p>`}<p class="muted" style="margin:6px 0 0;font-size:12px">Payment: ${esc(PAY[Q.FE.pay])}. Confirm this carrier accepts it. Nicotine: ${esc(NIC[Q.FE.nic][0])}.</p></div></td></tr>`:""}`}).join("")}</tbody></table>`;
  $$("#qTable [data-sort]").forEach(b=>b.onclick=()=>{Q.sort=+b.dataset.sort;saveQ();renderQuoter()});
  $$("#qTable [data-crm]").forEach(b=>b.onclick=()=>{const r=rows[+b.dataset.crm];attachQuote($("#qLead").value,{...q,carrier:r.n,exact:!!r.exact,monthly:B?amt:r.p[amt],summary:(B?`${money(r.p[amt])} ${r.sub} final expense`:cfg.summary()+(r.sub?` · ${r.sub}`:""))+`, age ${Q.age}`})});
  $$("#qTable [data-fav]").forEach(b=>b.onclick=()=>{const n=b.dataset.fav;FAV.has(n)?FAV.delete(n):FAV.add(n);ls.set("hp.favs",[...FAV]);renderQuoter()});
  $$("#qTable [data-cmp]").forEach(b=>b.onchange=()=>{const n=b.dataset.cmp;if(b.checked){if(feCmp.size>=3){b.checked=false;toast("Compare up to 3 carriers");return}feCmp.add(n)}else feCmp.delete(n);renderQuoter()});
  $$("#qTable [data-open]").forEach(b=>b.onclick=()=>{const n=b.dataset.open;feOpen.has(n)?feOpen.delete(n):feOpen.add(n);renderQuoter()});
  $("#qNote").innerHTML=Q.state==="NY"?`<div class="notice">Many carriers file different products in New York, or don't offer these plans there. Confirm availability before quoting.</div>`:T==="FE"&&Q.age<45?`<div class="notice">Final expense plans usually start at age 45 or 50. For a ${Q.age}-year-old, quote term or IUL instead.</div>`:T==="FE"&&Q.FE.pay==="ssc"?`<div class="notice">Not every carrier drafts from a Direct Express / Social Security card. Confirm before you submit.</div>`:"";
  countUp($("#qLeadWith"));$("#qDisc").textContent=T==="FE"?`Transamerica level quotes use Transamerica's FE Express rate chart (${window.HP_RATES?.taFex?.asOf||""}): exact monthly bank-draft premiums, $42 policy fee included. The risk class still comes from Transamerica's own health questions. Aetna, Foresters, Corebridge, Ethos, American Home Life and Fidelity Life are "market-checked" estimates built from real Insurance Toolkits quotes (Texas, bank draft): usually within a few dollars for clean nonsmokers, rougher for smokers, graded and guaranteed-issue plans. Other carriers are estimates from Highpoint's model. Confirm before presenting.`:T==="TERM"?`Ethos prices come from Ethos's own online estimator (Texas, October 2026): its lowest price is used for Preferred plus and its highest for Standard, with Preferred and Standard plus in between. Other term carriers are rough estimates scaled from the Ethos curve. Tobacco prices are rougher. Run the carrier's own quote before presenting.`:`Estimates from Highpoint's rate model using typical market curves and relative pricing for each carrier. They are not carrier rates. Run the carrier's own quote before presenting. Monthly bank-draft premiums; policy fees included.`;
}
$$("#qTabs button").forEach(b=>b.onclick=()=>{Q.tab=b.dataset.q;Q.sort=null;saveQ();renderQuoter()});
[["#qAge","age",v=>Math.min(90,Math.max(18,+v||18))],["#qSex","sex"],["#qTob","tob"],["#qState","state"],["#qClass","cls"]].forEach(([s,k,f])=>$(s).addEventListener("change",()=>{Q[k]=f?f($(s).value):$(s).value;saveQ();renderQuoter()}));
$("#qLead").addEventListener("change",()=>{const l=leads.get($("#qLead").value);if(!l)return;if(l.age)Q.age=+l.age;if(l.state&&STATES.includes(l.state))Q.state=l.state;if(l.product==="MP")Q.tab="TERM";else if(l.product==="FE"||l.product==="IUL")Q.tab=l.product;if(Q.tab==="TERM"&&l.mortgageBalance)Q.TERM.amt=Math.round(l.mortgageBalance/5000)*5000;saveQ();renderQuoter()});

/* ---------- IUL illustrator ---------- */
const IL=Object.assign({carrier:"ta",age:35,sex:"M",state:"CA",risk:"1",focus:"cash",mode:"premium",prem:300,cov:250000,inc:false,incStart:65,incEnd:90,rate:5.5,payTo:"100",dbo:"A"},ls.get("hp.il",{}));
const saveIL=()=>ls.set("hp.il",IL);
let ilLast=null;
function ilParams(){const c=IUL_CARRIERS.find(x=>x.k===IL.carrier)||IUL_CARRIERS[0];const risk=+IL.risk;
  const tgt=ilTarget(IL.age,IL.sex,risk,IL.focus,c); let face,annual;
  if(IL.mode==="premium"){annual=IL.prem*12;face=Math.max(25000,Math.round(annual/tgt*1000/1000)*1000)}else{face=IL.cov;annual=Math.round(face/1000*tgt*100)/100}
  const pt=+IL.payTo; const payTo=pt<=20?IL.age+pt:pt;
  return {c,age:IL.age,sex:IL.sex,risk,face,annual,payTo,rate:+IL.rate,dbo:IL.dbo,inc:IL.inc?{start:Math.max(IL.incStart,IL.age+5),end:Math.max(IL.incEnd,IL.incStart+1),amt:0}:null}}
function renderIul(){
  leadOptions($("#ilLead"));
  const p=ilParams(); const c=p.c;
  $("#ilTitle").textContent=`${c.n} IUL`;
  $("#ilCarriers").innerHTML=IUL_CARRIERS.filter(x=>!x.prot).map(x=>`<button type="button" data-c="${x.k}" aria-pressed="${x.k===IL.carrier}">${esc(x.n)}</button>`).join("");
  $("#ilProt").innerHTML=IUL_CARRIERS.filter(x=>x.prot).map(x=>`<button type="button" class="chip2" data-c="${x.k}" aria-pressed="${x.k===IL.carrier}">${esc(x.n)}</button>`).join("");
  $$("#ilCarriers [data-c],#ilProt [data-c]").forEach(b=>b.onclick=()=>{IL.carrier=b.dataset.c;saveIL();renderIul()});
  $("#ilAge").value=IL.age;$("#ilSex").value=IL.sex;$("#ilState").value=IL.state;$("#ilRisk").value=IL.risk;$("#ilRate").value=IL.rate;$("#ilRateOut").textContent=IL.rate+"%";$("#ilPayTo").value=IL.payTo;$("#ilDbo").value=IL.dbo;$("#ilIncStart").value=IL.incStart;$("#ilIncEnd").value=IL.incEnd;
  $$("#ilFocus button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.f===IL.focus));$("#ilFocusDesc").textContent=FOCUS[IL.focus][1];
  $$("#ilMode button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.m===IL.mode));
  $$("#ilInc button").forEach(b=>b.setAttribute("aria-pressed",String(+IL.inc)===b.dataset.on));$("#ilIncAges").hidden=!IL.inc;
  const prem=IL.mode==="premium";
  amountCtl("ilAmt",{get:()=>prem?IL.prem:IL.cov,set:v=>{if(prem)IL.prem=Math.max(25,Math.round(v/5)*5);else IL.cov=Math.max(25000,Math.round(v/5000)*5000);saveIL();renderIul()},min:()=>prem?50:25000,max:()=>prem?5000:3000000,step:()=>prem?5:5000,fmt:v=>money(v),suffix:()=>prem?"/mo":""})();
  $("#ilDerived").innerHTML=prem?`Coverage <b class="num" style="color:var(--ink)">${money(p.face)}</b>`:`Premium <b class="num" style="color:var(--ink)">${money(p.annual/12,2)}</b>/mo`;
  let incAmt=0; if(p.inc){p.inc.amt=incAmt=ilSolveIncome(p)}
  const r=ilProject(p); const at=a=>r.rows.find(x=>x.age===a);
  const r65=at(65), last=r.rows[r.rows.length-1];
  ilLast={product:"IUL",carrier:c.n,monthly:Math.round(p.annual/12*100)/100,summary:`${c.n} IUL ${money(p.face)} death benefit, ${IL.focus==="cash"?"cash value":IL.focus} design, age ${IL.age} ${IL.sex}${IL.age<65&&r65?`, est. cash value at 65 ${money(r65.cv)}`:""}${incAmt?`, est. income ${money(incAmt)}/yr from ${p.inc.start}`:""}`};
  $("#ilTiles").innerHTML=`
    <div class="panel"><span class="label">Monthly premium</span><b class="num" data-count="${p.annual/12}" data-key="t1">${money(p.annual/12,2)}</b><span class="muted">${p.inc?`until age ${Math.min(p.payTo,p.inc.start)}`:+IL.payTo>=100?"for life":`until age ${p.payTo}`}</span></div>
    <div class="panel"><span class="label">Death benefit</span><b class="num" data-count="${p.face}" data-key="t2" data-fmt="k">${kfmt(Math.round(p.face/1000)*1000)}</b><span class="muted">${IL.dbo==="B"?"plus cash value":"level"}</span></div>
    <div class="panel"><span class="label">Cash value at 65</span><b class="num gold" ${IL.age<65&&r65?`data-count="${r65.cv}" data-key="t3" data-fmt="k"`:""}>${IL.age<65&&r65?kfmt(Math.round(r65.cv/1000)*1000):"—"}</b><span class="muted">${IL.age<65&&r65?`${money(r65.paid)} paid in`:"Client is 65 or older"}</span></div>
    <div class="panel"><span class="label">${p.inc?"Retirement income":"Cash value at 85"}</span><b class="num">${p.inc?(incAmt?money(incAmt):"$0"):(at(85)?kfmt(Math.round(at(85).cv/1000)*1000):"—")}</b><span class="muted">${p.inc?`per year, ages ${p.inc.start}–${p.inc.end}`:"if premiums continue"}</span></div>`;
  $("#ilWarn").innerHTML=r.lapse?`<div class="notice bad"><b>Projected to lapse at age ${r.lapse}</b> with these assumptions. Raise the premium, pay longer, or switch to a cash value design.</div>`:p.inc&&!incAmt?`<div class="notice">This design doesn't build enough cash value to support income. Try a higher premium or the cash value focus.</div>`:"";
  const yrs=[...new Set([1,5,10,15,20,25,30,40,50,60].filter(y=>y<=r.rows.length).concat(r65&&IL.age<65?[r65.yr]:[]))].sort((a,b)=>a-b);
  $("#ilTable").innerHTML=`<thead><tr><th>Year</th><th>Age</th><th>Premiums paid</th><th>Cash value</th><th>Surrender value</th><th>Death benefit</th>${p.inc?"<th>Income taken</th>":""}</tr></thead><tbody>${yrs.map(y=>{const d=r.rows[y-1];return`<tr style="cursor:default" ${d.age===65?'class="hl"':""}><td class="num">${y}</td><td class="num">${d.age}</td><td class="num">${money(d.paid)}</td><td class="num"><b>${money(d.cv)}</b></td><td class="num">${money(d.sv)}</td><td class="num">${money(d.db)}</td>${p.inc?`<td class="num">${d.taken?money(d.taken):"—"}</td>`:""}</tr>`}).join("")}</tbody>`;
  drawIlChart(r.rows,!!p.inc); countUp($("#ilTiles"));
}
function drawIlChart(rows,showInc){
  const W=760,H=260,L=60,R=14,T=14,B=30; const n=rows.length; if(!n){$("#ilChart").innerHTML="";return}
  const S=[["paid","Premiums paid","var(--muted)","4 4"],["taken","Income taken","var(--warn)",""],["cv","Cash value","var(--accent-2)",""],["db","Death benefit","var(--info)",""]].filter(s=>s[0]!=="taken"||showInc);
  const maxV=Math.max(1,...rows.flatMap(d=>S.map(s=>d[s[0]])));const e=Math.pow(10,Math.floor(Math.log10(maxV)));const top=Math.ceil(maxV/e*2)/2*e;
  const x=i=>L+(n<=1?0:i/(n-1))*(W-L-R), y=v=>T+(1-v/top)*(H-T-B);
  const fmtA=v=>v>=1e6?"$"+(v/1e6).toFixed(1).replace(".0","")+"M":v>=1e3?"$"+Math.round(v/1e3)+"K":"$0";
  const ticks=[0,.25,.5,.75,1].map(f=>f*top), step=Math.max(1,Math.round(n/8));
  const path=k=>rows.map((d,i)=>`${i?"L":"M"}${x(i).toFixed(1)},${y(d[k]).toFixed(1)}`).join("");
  $("#ilChart").innerHTML=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Projected values by policy year">
    ${ticks.map(v=>`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L-8}" y="${y(v)+4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--f-num)">${fmtA(v)}</text>`).join("")}
    ${rows.map((d,i)=>i%step===0?`<text x="${x(i)}" y="${H-9}" text-anchor="middle" font-size="11" fill="var(--muted)" font-family="var(--f-num)">${d.age}</text>`:"").join("")}
    <path d="${path("cv")}L${x(n-1)},${y(0)}L${x(0)},${y(0)}Z" fill="var(--accent-3)" fill-opacity=".14"/>
    ${S.map(s=>`<path d="${path(s[0])}" fill="none" stroke="${s[2]}" stroke-width="${s[0]==="cv"?2.4:1.8}" ${s[3]?`stroke-dasharray="${s[3]}"`:""}/>`).join("")}
    <line id="ilCross" x1="0" x2="0" y1="${T}" y2="${H-B}" stroke="var(--muted)" stroke-width="1" visibility="hidden"/>
    <rect x="${L}" y="${T}" width="${W-L-R}" height="${H-T-B}" fill="transparent" id="ilHit"/></svg>`;
  $("#ilLegend").innerHTML=S.map(s=>`<span><i style="border-top:2px ${s[3]?"dashed":"solid"} ${s[2]}"></i>${s[1]}</span>`).join("")+`<span class="muted">Ages along the bottom</span>`;
  const svg=$("#ilChart svg"), hit=$("#ilHit"), tip=$("#ilTip"), cross=$("#ilCross");
  const move=ev=>{const b=svg.getBoundingClientRect();const px=(ev.clientX-b.left)/b.width*W;const i=Math.max(0,Math.min(n-1,Math.round((px-L)/(W-L-R)*(n-1))));const d=rows[i];
    cross.setAttribute("x1",x(i));cross.setAttribute("x2",x(i));cross.setAttribute("visibility","visible");
    tip.hidden=false;tip.innerHTML=`<b>Year ${d.yr} · age ${d.age}</b>`+S.map(s=>`<div><i style="background:${s[2]}"></i>${s[1]}<span class="num">${money(d[s[0]])}</span></div>`).join("");
    const left=(x(i)/W)*b.width; tip.style.left=Math.min(Math.max(8,left+12),b.width-tip.offsetWidth-8)+"px"};
  hit.addEventListener("pointermove",move);hit.addEventListener("pointerdown",move);hit.addEventListener("pointerleave",()=>{tip.hidden=true;cross.setAttribute("visibility","hidden")});
}
[["#ilAge","age",v=>Math.min(75,Math.max(18,+v||18))],["#ilSex","sex"],["#ilState","state"],["#ilRisk","risk"],["#ilPayTo","payTo"],["#ilDbo","dbo"],["#ilIncStart","incStart",v=>Math.min(85,Math.max(50,+v||65))],["#ilIncEnd","incEnd",v=>Math.min(100,Math.max(55,+v||90))]].forEach(([s,k,f])=>$(s).addEventListener("change",()=>{IL[k]=f?f($(s).value):$(s).value;saveIL();renderIul()}));
$("#ilRate").addEventListener("input",()=>{IL.rate=+$("#ilRate").value;saveIL();renderIul()});
$$("#ilFocus button").forEach(b=>b.onclick=()=>{IL.focus=b.dataset.f;saveIL();renderIul()});
$$("#ilMode button").forEach(b=>b.onclick=()=>{const p=ilParams();if(b.dataset.m==="coverage"&&IL.mode==="premium")IL.cov=Math.round(p.face/5000)*5000;if(b.dataset.m==="premium"&&IL.mode==="coverage")IL.prem=Math.max(50,Math.round(p.annual/12/5)*5);IL.mode=b.dataset.m;saveIL();renderIul()});
$$("#ilInc button").forEach(b=>b.onclick=()=>{IL.inc=b.dataset.on==="1";saveIL();renderIul()});
$("#ilLead").addEventListener("change",()=>{const l=leads.get($("#ilLead").value);if(!l)return;if(l.age)IL.age=Math.min(75,Math.max(18,+l.age));if(l.state&&STATES.includes(l.state))IL.state=l.state;saveIL();renderIul()});
$("#ilSave").onclick=()=>{if(ilLast)attachQuote($("#ilLead").value,ilLast)};

/* ---------- assistant ---------- */
let sample=null, aiTurns=[], aiBusy=null;
function addMsg(cls,text){const d=document.createElement("div");d.className="msg "+cls;d.textContent=text;$("#msgs").append(d);$("#msgs").scrollTop=1e9;return d}
const leadBrief=l=>({id:l.id,name:fullName(l),phone:fmtPhone(l.phone),stage:stageName(l.stage),product:PROD[l.product]||"",age:l.age||"",state:l.state||"",source:l.source||"",calls:l.callCount||0,lastDisposition:l.lastDisposition||"",lastTouch:ago(l.updatedAt),callback:l.callbackAt?new Date(l.callbackAt).toLocaleString():""});
const TOOLS=[
 {name:"search_leads",description:"Find leads in the CRM. Filter by free-text query (name, phone, state, source), stage id, or product. Returns up to `limit` brief records with ids, sorted by most recently touched.",
  inputSchema:{type:"object",properties:{query:{type:"string"},stage:{type:"string",enum:STAGES.map(s=>s[0])},product:{type:"string",enum:["FE","MP","IUL"]},untouched_days:{type:"number",description:"Only leads not updated in at least this many days"},limit:{type:"number"}}},
  execute(i){const q=String(i.query||"").toLowerCase(),qd=digits(q);let r=[...leads.values()].filter(l=>(!i.stage||(l.stage||"new")===i.stage)&&(!i.product||l.product===i.product)&&(!i.untouched_days||Date.now()-(l.updatedAt||0)>=Number(i.untouched_days)*864e5)&&(!q||[fullName(l),l.state,l.source,l.email].join(" ").toLowerCase().includes(q)||(qd.length>=3&&normPhone(l.phone).includes(qd))));
    r.sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));return{total:r.length,leads:r.slice(0,Math.min(Number(i.limit)||15,40)).map(leadBrief)}}},
 {name:"get_lead",description:"Full record for one lead by id, including mortgage details, last 10 notes and quotes.",inputSchema:{type:"object",properties:{id:{type:"string"}},required:["id"]},
  execute(i){const l=leads.get(String(i.id));if(!l)throw new Error("No lead with that id");return{...leadBrief(l),email:l.email||"",dob:l.dob||"",mortgageBalance:l.mortgageBalance||"",mortgagePayment:l.mortgagePayment||"",lender:l.lender||"",notes:(l.notes||[]).slice(-10).map(n=>new Date(n.t).toLocaleDateString()+": "+n.text),quotes:(l.quotes||[]).map(q=>`${q.product} ${money(q.monthly,2)}/mo ${q.summary}`)}}},
 {name:"update_lead",description:"Change one lead's stage and/or add a note. Only use when the agent asks you to. Returns the updated brief.",inputSchema:{type:"object",properties:{id:{type:"string"},stage:{type:"string",enum:STAGES.map(s=>s[0])},note:{type:"string"}},required:["id"]},
  async execute(i,ctx){const l=leads.get(String(i.id));if(!l)throw new Error("No lead with that id");if(ctx.signal.aborted)throw new Error("cancelled");const patch={};let notes=l.notes||[];
    if(i.stage&&STAGES.some(s=>s[0]===i.stage)&&i.stage!==l.stage){patch.stage=i.stage;notes=[...notes,{t:Date.now(),text:`Moved to ${stageName(i.stage)} (assistant)`}]}
    if(i.note)notes=[...notes,{t:Date.now(),text:String(i.note).slice(0,1000)}];patch.notes=notes;const n=await patchLead(l.id,patch);return leadBrief(n)}},
 {name:"quote",description:"Run the built-in ballpark quoter. product FE needs age, sex (M/F), tobacco, face (dollars), plan (level|graded|gi). MP needs age, sex, tobacco, face, term (10|15|20|25|30), health (preferred_plus|preferred|standard_plus|standard), rop (bool). IUL needs age, sex, tobacco, monthly, pay_to_age (default 100), rate (percent); uses a balanced design. Returns monthly premium or a projection. Estimates are illustrative.",
  inputSchema:{type:"object",properties:{product:{type:"string",enum:["FE","MP","IUL"]},age:{type:"number"},sex:{type:"string"},tobacco:{type:"boolean"},face:{type:"number"},plan:{type:"string"},term:{type:"number"},health:{type:"string"},rop:{type:"boolean"},monthly:{type:"number"},pay_to_age:{type:"number"},rate:{type:"number"}},required:["product","age"]},
  execute(i){const sex=String(i.sex||"M").toUpperCase().startsWith("F")?"F":"M",tob=!!i.tobacco,age=Number(i.age);
    if(i.product==="FE")return{monthly:feQuote({age,sex,tob,face:Number(i.face)||10000,plan:FE_PLANS[i.plan]?i.plan:"level"})};
    if(i.product==="MP"){const h={preferred_plus:.85,preferred:1,standard_plus:1.25,standard:1.5}[i.health]||1;const term=MP_TERMS[i.term]?Number(i.term):20;const m=mpQuote({age,sex,tob,health:h,face:Number(i.face)||250000,term,rop:!!i.rop});return m?{monthly:m,term}:{error:"Term not available at this age"}}
    const c=IUL_CARRIERS[0],risk=tob?1.55:1,annual=(Number(i.monthly)||300)*12,face=Math.round(annual/ilTarget(age,sex,risk,"balanced",c)*1000/1000)*1000;const r=ilProject({age,sex,risk,face,annual,payTo:Number(i.pay_to_age)||100,rate:Number(i.rate)||5.5,dbo:"A",c,inc:null});const at=a=>Math.round(r.rows.find(x=>x.age===a)?.cv||0);return{deathBenefit:face,cashValueAt65:at(65),at75:at(75),at85:at(85),lapseAge:r.lapse}}}
];
function aiContext(){const by=STAGES.map(([i,n])=>`${n}: ${[...leads.values()].filter(l=>(l.stage||"new")===i).length}`).join(", ");
  return `You are the built-in assistant in "Highpoint Agent Desk", the CRM used by agents at Highpoint Financial LLC, licensed life insurance agents who sell final expense (FE), mortgage protection (MP) and indexed universal life (IUL). Today is ${new Date().toDateString()}. The book has ${leads.size} leads (${by}). Stage ids: ${STAGES.map(s=>s[0]).join(", ")}.
Use the tools to look up leads instead of guessing, and only change a lead when the agent asks. Quotes from the quote tool are ballpark estimates, not carrier quotes; say so when you give numbers. When writing client-facing texts, keep them compliant: no guarantees of approval or returns, no pretending to be from a government program, and include "Reply STOP to opt out" in texts. Keep answers short and practical, plain text, no markdown headings. Refer to leads by name, never show ids. For underwriting questions, give your best general read of how carriers typically treat the condition (level, graded, guaranteed issue, or rate class), the details that change the answer, and remind the agent to confirm in the carrier's current underwriting guide, since guidelines change.`}
async function ask(text){
  if(aiBusy)return; text=text.trim(); if(!text)return;
  if(!sample){try{sample=await window.claude?.use?.("sample")}catch{}}
  addMsg("me",text); $("#aiIn").value="";
  if(!sample){addMsg("sys","The assistant isn't available right now. Sign in and try again.");return}
  const turns=[...aiTurns,{role:"user",content:aiTurns.length?text:aiContext()+"\n\nAgent: "+text}];
  const out=addMsg("ai","Thinking…"); aiBusy=new AbortController(); $("#aiSend").textContent="Stop";
  try{const res=await sample(turns,{onText:({text})=>{out.textContent=text;$("#msgs").scrollTop=1e9},signal:aiBusy.signal,tools:TOOLS,cache:false});
    out.textContent=res.text; aiTurns=[...turns,{role:"assistant",content:res.text}];
    if(aiTurns.length>24)aiTurns=[aiTurns[0],aiTurns[1],...aiTurns.slice(-20)];
  }catch(e){
    if(e?.code==="cancelled"){out.textContent=e.text||"Stopped.";if(e.text)aiTurns=[...turns,{role:"assistant",content:e.text}]}
    else if(e?.code==="not_granted"){out.remove();addMsg("sys","The assistant needs your permission to run. Send a message again and allow it.")}
    else if(e?.code==="rate_limited"){out.textContent=e.text||"";addMsg("sys","Too many requests right now. Wait a minute and try again.")}
    else if(e?.code==="tools_unavailable"){out.textContent="";try{const r=await sample(turns,{onText:({text})=>out.textContent=text,cache:false});out.textContent=r.text;aiTurns=[...turns,{role:"assistant",content:r.text}]}catch(e2){out.textContent="Couldn't reach the assistant: "+(e2?.message||e2?.code)}}
    else out.textContent=(e?.text?e.text+"\n\n":"")+"Couldn't finish: "+(e?.message||e?.code||"unknown error");
  }finally{aiBusy=null;$("#aiSend").textContent="Send"}
}
$("#aiForm").onsubmit=e=>{e.preventDefault();if(aiBusy){aiBusy.abort();return}ask($("#aiIn").value)};
$("#aiIn").onkeydown=e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("#aiForm").requestSubmit()}};
$$("[data-ask]").forEach(b=>b.onclick=()=>ask(b.dataset.ask));
$("#aiClear").onclick=()=>{if(aiBusy)aiBusy.abort();aiTurns=[];$("#msgs").innerHTML="";addMsg("ai","New chat. What do you need?")};


/* ---------- screen a client ---------- */
function renderScreen(){const cur=$("#scrLead").value;const l=[...leads.values()].sort((a,b)=>fullName(a).localeCompare(fullName(b)));
  $("#scrLead").innerHTML=`<option value="">Don't attach</option>`+l.slice(0,1000).map(x=>`<option value="${esc(x.id)}" ${x.id===cur?"selected":""}>${esc(fullName(x))}</option>`).join("")}
$("#scrLead").onchange=()=>{const l=leads.get($("#scrLead").value);if(!l)return;if(l.age)$("#scrAge").value=l.age;if(l.product)$("#scrProd").value=l.product};
$("#scrForm").onsubmit=e=>{e.preventDefault();const v=k=>$("#"+k).value.trim();const l=leads.get(v("scrLead"));
  const p=`Screen this client like a field underwriter for ${({FE:"final expense",MP:"mortgage protection",IUL:"IUL"})[v("scrProd")]}.${l?` The client is ${fullName(l)} (in my CRM).`:""}
Age ${v("scrAge")}, ${v("scrSex")}, ${v("scrHt")}, ${v("scrWt")} lbs, tobacco: ${v("scrTob")}.
Conditions: ${v("scrCond")||"none"}.
Medications: ${v("scrMeds")||"none"}.
Hospital stays/surgeries in last 5 years: ${v("scrHosp")||"none"}.
Tell me: the likely plan type or rate class, which answers on a typical application would knock them out of level or preferred, the follow-up questions I should ask, and which carrier types tend to be most lenient for this profile. Keep it short.${l?" Then add a one-line note to this client's file summarizing the screen.":""}`;
  go("assistant"); ask(p)};

/* ---------- scripts ---------- */
const SCRIPT_LIB={
 FE:{open:"Hi, is this {first}? This is {agent} with Highpoint Financial. I'm getting back to you on the request you sent in about final expense coverage, the plans that take care of funeral and burial costs so your family isn't left with the bill. I just need to confirm a few details and see what you qualify for. Is now an okay time?",
  facts:["Who would you want to receive this money?","Do you have anything in place now, and how much would it pay?","Have you thought about burial or cremation? (helps size the face amount)","Any health conditions, medications or hospital stays in the last few years?","What monthly amount would be comfortable without straining your budget?"],
  obj:[["I need to think about it.","Of course. Usually that means either the price or the plan isn't quite right. Which one is it for you? If it's the amount, we can adjust the coverage to fit."],["I can't afford it.","I understand. That's why we start with your budget, not a number I pick. What would feel comfortable each month? Even a smaller plan keeps the bill off your family."],["Send me something in the mail.","I can, but the price depends on your health answers, so anything I mail would be a guess. Let's take two minutes now and you'll have a real number to look at."]],
  close:"Based on everything you told me, the {plan} plan for {face} at {premium} a month fits what you want. Which day works best for the draft, the 1st or the 3rd?"},
 MP:{open:"Hi {first}, this is {agent} with Highpoint Financial. You sent back the mortgage protection form about your home loan. It's the coverage that pays off the mortgage, or keeps up the payment, if something happens to you. Did I catch you at an okay time to go over it?",
  facts:["About how much is left on the mortgage, and what's the monthly payment?","How many years are left on the loan?","If you passed away or couldn't work, who else is on the mortgage and could they make the payment alone?","Any coverage through work? Would it follow you if you left that job?","Any health conditions, medications or tobacco use?"],
  obj:[["I already have coverage through work.","That's great to have. Most group plans only cover one or two times salary and end when the job ends. This one stays with you and is tied to the house. Want to see how they work together?"],["The bank already offers this.","Lender plans usually decrease as the balance drops and pay the bank, not your family. This plan pays your family directly and the benefit stays level."],["We'll do it later.","Rates are based on today's age and health, so waiting usually costs more. Let's at least lock in what you qualify for today."]],
  close:"So the plan that pays off the {face} balance with living benefits comes to {premium} a month. Do you want to set the draft for the day after your paycheck?"},
 IUL:{open:"Hi {first}, this is {agent} with Highpoint Financial. You'd asked about building savings that also includes life insurance. I'd like to learn a little about your goals and then show you how an indexed universal life policy could fit. Do you have a few minutes?",
  facts:["What are you saving toward: retirement income, kids' college, or leaving something behind?","What are you doing now for retirement (401(k), IRA, nothing yet)?","Roughly what monthly amount could you set aside long term?","Is protecting your family if something happens part of the goal?","Any health conditions or tobacco use?"],
  obj:[["Isn't this just like investing in the market?","No. The cash value isn't invested in the market. It earns interest based on an index, with a cap on the upside and a floor, often 0%, so a down year doesn't lose credited value. Fees and charges still apply."],["I already have a 401(k).","Keep it. This is a different bucket: it's life insurance first, and the cash value can be accessed through policy loans that are generally not taxed when the policy is set up and kept correctly."],["It sounds expensive.","It works best with a consistent amount you won't miss. Let's find the number that fits and I'll show you the carrier illustration for exactly that."]],
  close:"The illustration at {premium} a month gives you {face} of protection and builds cash value toward your retirement goal. Shall we start the application so the carrier can confirm your rate?"}
};
let scTab="FE";
function renderScripts(){
  $$("#scTabs .tab").forEach(b=>b.setAttribute("aria-selected",b.dataset.sc===scTab));
  const s=SCRIPT_LIB[scTab]; const hl=t=>esc(t).replace(/\{(\w+)\}/g,'<b style="color:var(--accent-2)">[$1]</b>');
  $("#scBody").innerHTML=`
   <div class="panel"><h3>Opener</h3><p style="margin:0">${hl(s.open)}</p><button class="btn copy" data-copy="open">Copy</button></div>
   <div class="panel"><h3>Fact finder</h3><ul>${s.facts.map(f=>`<li>${esc(f)}</li>`).join("")}</ul></div>
   <div class="panel wide"><h3>Objections</h3>${s.obj.map(([q,a])=>`<div class="obj"><b>"${esc(q)}"</b><span class="muted">${esc(a)}</span></div>`).join("")}</div>
   <div class="panel wide"><h3>Close</h3><p style="margin:0">${hl(s.close)}</p><button class="btn copy" data-copy="close">Copy</button></div>`;
  $$("#scBody [data-copy]").forEach(b=>b.onclick=async()=>{const t=s[b.dataset.copy];try{await navigator.clipboard.writeText(t);toast("Script copied")}catch{toast("Select the text to copy it")}});
}
$$("#scTabs .tab").forEach(b=>b.onclick=()=>{scTab=b.dataset.sc;renderScripts()});

/* ---------- motion ---------- */
const RM=matchMedia("(prefers-reduced-motion: reduce)").matches;
function stagger(sec){if(!sec)return;[...sec.children].forEach((c,i)=>{c.style.setProperty("--i",Math.min(i,10));c.style.animation="none";void c.offsetWidth;c.style.animation=""})}
(function sky(){if(RM)return;const cv=$("#sky"),x=cv.getContext("2d");let W,H,stars=[],t=0;
  const size=()=>{W=cv.width=innerWidth*devicePixelRatio;H=cv.height=innerHeight*devicePixelRatio;cv.style.width=innerWidth+"px";cv.style.height=innerHeight+"px";
    stars=Array.from({length:0},()=>({x:Math.random()*W,y:Math.random()*H*.75,r:(Math.random()*1.1+.3)*devicePixelRatio,p:Math.random()*6.28,s:.4+Math.random()*1.2,v:(Math.random()*.06+.02)*devicePixelRatio}))};
  size();addEventListener("resize",size);
  const frame=()=>{t+=.016;x.clearRect(0,0,W,H);
    for(const s of stars){s.x+=s.v;if(s.x>W)s.x=0;const a=.25+.55*(.5+.5*Math.sin(t*s.s+s.p));x.globalAlpha=a*.7;x.fillStyle=s.r>1.1*devicePixelRatio?"#FFD1EC":"#FFFFFF";x.beginPath();x.arc(s.x,s.y,s.r,0,6.283);x.fill()}
    if(Math.random()<.004&&jets.length<2){jets.push({x:-60*devicePixelRatio,y:H*(.3+Math.random()*.4),a:-(.18+Math.random()*.16),v:(2.2+Math.random()*1.2)*devicePixelRatio,trail:[]})}
    if(false){shoot.push({x:Math.random()*W*.7,y:Math.random()*H*.3,l:0})}
    for(const j of jets){j.x+=Math.cos(j.a)*j.v;j.y+=Math.sin(j.a)*j.v;j.a-=.0004;j.trail.push([j.x,j.y]);if(j.trail.length>220)j.trail.shift();
      for(let k=1;k<j.trail.length;k++){x.globalAlpha=(k/j.trail.length)*.35;x.strokeStyle="rgba(255,255,255,.8)";x.lineWidth=(1+k/j.trail.length*1.6)*devicePixelRatio;x.beginPath();x.moveTo(j.trail[k-1][0],j.trail[k-1][1]+2*devicePixelRatio);x.lineTo(j.trail[k][0],j.trail[k][1]+2*devicePixelRatio);x.stroke()}
      x.save();x.globalAlpha=.95;x.translate(j.x,j.y);x.rotate(j.a);const u=devicePixelRatio;if(JET_IMG.complete)x.drawImage(JET_IMG,-30*u,-11*u,60*u,22*u);x.restore()}
    jets=jets.filter(j=>j.x<W+80*devicePixelRatio&&j.y>-80*devicePixelRatio);
    for(const m of shoot){m.l+=1;const k=m.l*14*devicePixelRatio;x.globalAlpha=Math.max(0,1-m.l/40);const g=x.createLinearGradient(m.x+k,m.y+k*.35,m.x+k-120*devicePixelRatio,m.y+k*.35-42*devicePixelRatio);g.addColorStop(0,"#E9F0FC");g.addColorStop(1,"rgba(233,240,252,0)");x.strokeStyle=g;x.lineWidth=1.4*devicePixelRatio;x.beginPath();x.moveTo(m.x+k,m.y+k*.35);x.lineTo(m.x+k-120*devicePixelRatio,m.y+k*.35-42*devicePixelRatio);x.stroke()}
    shoot=shoot.filter(m=>m.l<40);x.globalAlpha=1;
    if(!document.hidden)requestAnimationFrame(frame);else setTimeout(()=>requestAnimationFrame(frame),500)};
  let shoot=[],jets=[{x:W*.05,y:H*.6,a:-.24,v:2.6*devicePixelRatio,trail:[]}];requestAnimationFrame(frame)})();
function celebrate(label){if(RM)return;const cv=$("#burst"),x=cv.getContext("2d");const d=devicePixelRatio;cv.width=innerWidth*d;cv.height=innerHeight*d;cv.style.width=innerWidth+"px";cv.style.height=innerHeight+"px";
  const cols=["#FF2E88","#FF9E3D","#FFFFFF","#FF4FA3","#FFC27E"];const P=Array.from({length:140},(_,i)=>({x:innerWidth*d/2,y:innerHeight*d*.42,vx:(Math.random()-.5)*16*d,vy:(-Math.random()*14-4)*d,r:(Math.random()*5+3)*d,c:cols[i%cols.length],a:Math.random()*6.28,va:(Math.random()-.5)*.3,bill:i%9===0}));
  let f=0;const step=()=>{f++;x.clearRect(0,0,cv.width,cv.height);for(const p of P){p.vy+=.35*d;p.vx*=.99;p.x+=p.vx;p.y+=p.vy;p.a+=p.va;x.save();x.translate(p.x,p.y);x.rotate(p.a);x.globalAlpha=Math.max(0,1-f/110);
      if(p.bill){x.fillStyle="#2F7A3B";x.fillRect(-12*d,-6*d,24*d,12*d);x.fillStyle="#C9E8CC";x.font=`700 ${9*d}px sans-serif`;x.textAlign="center";x.textBaseline="middle";x.fillText("$",0,.5*d)}
      else{x.fillStyle=p.c;x.fillRect(-p.r/2,-p.r/4,p.r,p.r/2)}x.restore()}
    {const k=Math.min(1,f/80),jx=(-.1+k*1.25)*cv.width,jy=(.9-k*k*.85)*cv.height,ang=Math.atan2(-(1.7*k*.85)*cv.height,1.25*cv.width);x.save();x.globalAlpha=Math.max(0,1-Math.max(0,f-80)/30);
      x.strokeStyle="rgba(201,216,244,.5)";x.lineWidth=3*d;x.beginPath();for(let q=0;q<=k;q+=.02){const px=(-.1+q*1.25)*cv.width,py=(.9-q*q*.85)*cv.height;q?x.lineTo(px,py):x.moveTo(px,py)}x.stroke();
      x.translate(jx,jy);x.rotate(ang);if(JET_IMG.complete)x.drawImage(JET_IMG,-90*d,-33*d,180*d,66*d);x.restore()}
    if(f<110)requestAnimationFrame(step);else x.clearRect(0,0,cv.width,cv.height)};requestAnimationFrame(step);
  if(label)toast(label)}
const countPrev=new Map();
function countUp(root){if(!root)return;root.querySelectorAll("[data-count]").forEach(el=>{const key=el.dataset.key||el.id;const to=+el.dataset.count;const from=countPrev.has(key)?countPrev.get(key):to*.6;countPrev.set(key,to);
  if(RM||from===to)return;const fmt=el.dataset.fmt||"money2";const f0=performance.now(),dur=520;const fm=v=>fmt==="money0"?money(v):fmt==="k"?kfmt(Math.round(v/1000)*1000):fmt==="int"?Math.round(v).toLocaleString():money(v,2);
  const tick=n=>{const k=Math.min(1,(n-f0)/dur),e=1-Math.pow(1-k,3);el.textContent=fm(from+(to-from)*e);if(k<1)requestAnimationFrame(tick)};requestAnimationFrame(tick)})}

/* ---------- floating windows ---------- */
const WINS=new Map(); let wz=80;
const ICO={min:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>',max:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 15l7-7 7 7"/></svg>',x:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18"/></svg>'};
function openWin(id,{title,sub="",w=420,h=560,x,y,chips="",min=false,onClose}={}){
  let el=WINS.get(id);
  if(!el){el=document.createElement("div");el.className="win";el.setAttribute("role","dialog");el.setAttribute("aria-label",title);
    el.innerHTML=`<div class="whead"><span class="wt"></span><span class="wsub"></span><span class="wchips"></span><button class="wbtn" data-a="min" aria-label="Minimize">${ICO.min}</button><button class="wbtn" data-a="x" aria-label="Close">${ICO.x}</button></div><div class="wbody"></div>`;
    document.body.append(el);WINS.set(id,el);
    const n=WINS.size; el.style.left=(x??Math.max(12,innerWidth-w-28-(n-1)*28))+"px"; el.style.top=(y??Math.max(70,110+(n-1)*28))+"px";
    el.style.setProperty("--w",w+"px");el.style.setProperty("--h",h+"px");
    el.addEventListener("pointerdown",()=>{el.style.zIndex=++wz});
    el.querySelector('[data-a="x"]').onclick=()=>{el.remove();WINS.delete(id);onClose&&onClose()};
    el.querySelector('[data-a="min"]').onclick=()=>{el.classList.toggle("min");el.querySelector('[data-a="min"]').innerHTML=el.classList.contains("min")?ICO.max:ICO.min};
    const hd=el.querySelector(".whead");let sx,sy,ox,oy,drag=false;
    hd.addEventListener("pointerdown",e=>{if(e.target.closest("button"))return;drag=true;sx=e.clientX;sy=e.clientY;ox=el.offsetLeft;oy=el.offsetTop;hd.setPointerCapture(e.pointerId)});
    hd.addEventListener("pointermove",e=>{if(!drag)return;el.style.left=Math.min(innerWidth-80,Math.max(-el.offsetWidth+120,ox+e.clientX-sx))+"px";el.style.top=Math.min(innerHeight-44,Math.max(0,oy+e.clientY-sy))+"px"});
    hd.addEventListener("pointerup",()=>drag=false);
  }
  el.querySelector(".wt").textContent=title;el.querySelector(".wsub").textContent=sub;el.querySelector(".wchips").innerHTML=chips;
  el.classList.toggle("min",!!min);el.querySelector('[data-a="min"]').innerHTML=min?ICO.max:ICO.min;el.style.zIndex=++wz;
  return el.querySelector(".wbody");
}
const closeWin=id=>{const el=WINS.get(id);if(el){el.remove();WINS.delete(id)}};

/* ---------- client info dock ---------- */
let dockId=null;
function showDock(id,{expand=false}={}){const l=leads.get(id);if(!l)return;dockId=id;
  const b=openWin("client",{title:"Client info",sub:fullName(l),w:340,h:520,x:innerWidth-370,y:innerHeight-(expand?560:120),min:!expand,onClose:()=>dockId=null});
  const q=(l.quotes||[]).slice(-1)[0];
  b.innerHTML=`<div class="ci-phone">${esc(fmtPhone(l.phone))||"No phone"}</div>
   <div class="ci-row"><span>Stage</span><span class="stage"><i style="background:${stageColor(l.stage)}"></i>${stageName(l.stage)}</span></div>
   <div class="ci-row"><span>Product</span>${prodPill(l.product)}</div>
   <div class="ci-row"><span>Age · State</span><span>${esc([l.age,l.state].filter(Boolean).join(" · ")||"—")}</span></div>
   ${l.mortgageBalance?`<div class="ci-row"><span>Mortgage</span><span class="num">${money(l.mortgageBalance)}</span></div>`:""}
   ${q?`<div class="ci-row"><span>Last quote</span><span class="num">${money(q.monthly,2)}/mo</span></div>`:""}
   <div class="log">${(l.notes||[]).slice(-3).reverse().map(n=>`<div><time>${new Date(n.t).toLocaleString()}</time>${esc(n.text)}</div>`).join("")||'<span class="muted">No notes yet.</span>'}</div>
   <div class="row"><button class="btn sm" id="ciCopy">Copy number</button><button class="btn sm" id="ciAppt">Book appointment</button><button class="btn sm primary" id="ciOpen">Open lead</button></div>`;
  $("#ciCopy").onclick=()=>copyText(fmtPhone(l.phone));$("#ciOpen").onclick=()=>openDrawer(id);$("#ciAppt").onclick=()=>apptForm({leadId:id});
}

/* ---------- pilot rank / XP ---------- */
const RANKS=[[0,"Cadet"],[250,"Second Officer"],[750,"First Officer"],[2000,"Captain"],[5000,"Senior Captain"],[10000,"Chief Pilot"]];
const XP=Object.assign({xp:0,day:"",first:false},ls.get("hp.xp",{}));
const rankOf=x=>{let i=0;RANKS.forEach((r,k)=>{if(x>=r[0])i=k});return i};
const WINGS='<svg viewBox="0 0 72 44" aria-hidden="true"><path d="M36 14c-3 0-5 2-5 5s2 5 5 5 5-2 5-5-2-5-5-5z" fill="#F4F7FB"/><path d="M31 19C22 12 10 11 2 13c6 2 9 4 12 6-4 0-7 1-10 2 6 1 12 2 17 1-3 1-5 2-7 4 7 0 13-1 17-5z" fill="#C9D8F4"/><path d="M41 19c9-7 21-8 29-6-6 2-9 4-12 6 4 0 7 1 10 2-6 1-12 2-17 1 3 1 5 2 7 4-7 0-13-1-17-5z" fill="#C9D8F4"/><path d="M36 24v12" stroke="#9CC3F0" stroke-width="2"/></svg>';
function renderRank(){const i=rankOf(XP.xp),nx=RANKS[i+1];const pct=nx?((XP.xp-RANKS[i][0])/(nx[0]-RANKS[i][0])*100):100;
  $("#rankCard").innerHTML=`${typeof myDoc!=="undefined"&&myDoc&&myDoc.char?`<span class="rav">${avatarSVG(myDoc.char,38)}</span>`:WINGS}<div style="flex:1;min-width:0"><b>${RANKS[i][1]}</b><small class="num">${XP.xp.toLocaleString()} XP${nx?` · ${(nx[0]-XP.xp).toLocaleString()} to ${nx[1]}`:" · top rank"}</small><div class="xpbar"><i style="width:${pct}%"></i></div></div>`}
function awardXP(n,why){const before=rankOf(XP.xp);XP.xp+=n;ls.set("hp.xp",XP);if(typeof crewOnXP==="function")crewOnXP(n,why);renderRank();
  const r=$("#rankCard").getBoundingClientRect();const p=document.createElement("div");p.className="xppop";p.textContent=`+${n} XP · ${why}`;
  const vis=r.width>0;p.style.left=(vis?r.left+10:innerWidth/2-80)+"px";p.style.top=(vis?r.top-34:90)+"px";document.body.append(p);setTimeout(()=>p.remove(),1700);
  const after=rankOf(XP.xp);if(after>before)setTimeout(()=>celebrate(`Promoted to ${RANKS[after][1]}!`),400)}

/* ---------- calendar ---------- */
const appts=new Map(); let acol=null; const CAL={y:new Date().getFullYear(),m:new Date().getMonth(),sel:new Date().toDateString()};
async function initAppts(){if(!db)return;acol=db.collection("appts");acol.onSnapshot(s=>{appts.clear();s.docs.forEach(d=>{const v=d.data();if(v)appts.set(d.id,{...v,id:d.id})});if(view==="calendar")renderCalendar()},()=>{})}
async function putAppt(a){const id=a.id||uid();const b={...a};delete b.id;if(acol)await acol.doc(id).set(b);else{appts.set(id,{...b,id});renderCalendar()}return id}
async function delAppt(id){if(acol)await acol.doc(id).delete();else{appts.delete(id);renderCalendar()}}
const sameDay=(t,ds)=>new Date(t).toDateString()===ds;
const hm=t=>new Date(t).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
function apptRow(a){return`<div class="appt ${a.done?"done":""}"><time>${hm(a.at)}<br><span class="muted" style="font-size:11px">${a.dur||30} min</span></time><div class="who"><b>${esc(a.title||a.leadName||"Appointment")}</b><span>${esc([a.type,a.leadName&&a.title!==a.leadName?a.leadName:""].filter(Boolean).join(" · "))}</span></div><div class="acts"><button class="wbtn" data-done="${esc(a.id)}" aria-label="${a.done?"Mark not done":"Mark done"}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l5 5 9-10"/></svg></button>${a.leadId?`<button class="wbtn" data-lead="${esc(a.leadId)}" aria-label="Open client"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg></button>`:""}<button class="wbtn" data-del="${esc(a.id)}" aria-label="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg></button></div></div>`}
function renderCalendar(){
  const first=new Date(CAL.y,CAL.m,1),start=new Date(first);start.setDate(1-first.getDay());const today=new Date().toDateString();
  $("#calTitle").textContent=first.toLocaleDateString([],{month:"long",year:"numeric"});
  const all=[...appts.values()].sort((a,b)=>a.at-b.at);
  let cells='<span class="dow">SUN</span><span class="dow">MON</span><span class="dow">TUE</span><span class="dow">WED</span><span class="dow">THU</span><span class="dow">FRI</span><span class="dow">SAT</span>';
  for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);const ds=d.toDateString();const n=all.filter(a=>sameDay(a.at,ds)).length;
    cells+=`<button type="button" data-day="${ds}" class="${d.getMonth()!==CAL.m?"out":""} ${ds===today?"today":""} ${ds===CAL.sel?"sel":""}" aria-label="${d.toDateString()}${n?`, ${n} appointments`:""}">${d.getDate()}<span class="dots">${"<i></i>".repeat(Math.min(n,3))}</span></button>`}
  $("#calGrid").innerHTML=cells;
  $$("#calGrid [data-day]").forEach(b=>b.onclick=()=>{CAL.sel=b.dataset.day;renderCalendar()});
  const selD=new Date(CAL.sel);const dayList=all.filter(a=>sameDay(a.at,CAL.sel));
  $("#calDayT").textContent=CAL.sel===today?"Today":selD.toLocaleDateString([],{weekday:"long",month:"short",day:"numeric"});
  $("#calDay").innerHTML=dayList.map(apptRow).join("")||`<p class="muted" style="margin:0">Nothing booked. Use + New appointment or set one from the dialer.</p>`;
  const now=Date.now(),wk=now+7*864e5;const up=all.filter(a=>a.at>now&&a.at<wk&&!a.done&&!sameDay(a.at,CAL.sel));
  $("#calUpN").textContent=up.length;$("#calUp").innerHTML=up.map(a=>apptRow(a).replace("<time>",`<time><span class="muted" style="font-size:11px">${new Date(a.at).toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"})}</span><br>`)).join("")||`<p class="muted" style="margin:0">No appointments in the next 7 days.</p>`;
  $$("#v-calendar [data-done]").forEach(b=>b.onclick=async()=>{const a=appts.get(b.dataset.done);if(!a)return;await putAppt({...a,done:!a.done});if(!a.done)awardXP(10,"appointment kept")});
  $$("#v-calendar [data-del]").forEach(b=>b.onclick=()=>{if(b.dataset.armed){delAppt(b.dataset.del);toast("Appointment deleted")}else{b.dataset.armed=1;b.style.color="var(--bad)";b.setAttribute("aria-label","Click again to delete");toast("Click the trash again to delete")}});
  $$("#v-calendar [data-lead]").forEach(b=>b.onclick=()=>showDock(b.dataset.lead,{expand:true}));
}
function apptForm({leadId="",at=null,type="Phone call"}={}){
  const b=openWin("apptform",{title:"New appointment",w:380,h:560});
  const d=new Date(at||(()=>{const x=new Date(CAL.sel);const n=new Date();x.setHours(n.getHours()+1,0,0,0);return x})());d.setMinutes(d.getMinutes()-d.getTimezoneOffset());
  const opts=[...leads.values()].sort((a,c)=>fullName(a).localeCompare(fullName(c))).slice(0,1000).map(l=>`<option value="${esc(l.id)}" ${l.id===leadId?"selected":""}>${esc(fullName(l))}</option>`).join("");
  b.innerHTML=`<label class="field"><span>Client</span><select id="apLead"><option value="">No client</option>${opts}</select></label>
    <label class="field"><span>Title</span><input id="apTitle" placeholder="e.g. IUL review"></label>
    <div class="grid2"><label class="field"><span>When</span><input id="apAt" type="datetime-local" value="${d.toISOString().slice(0,16)}"></label><label class="field"><span>Length</span><select id="apDur"><option>15</option><option selected>30</option><option>45</option><option>60</option></select></label></div>
    <label class="field"><span>Type</span><select id="apType">${["Phone call","Zoom","In person","Callback"].map(t=>`<option ${t===type?"selected":""}>${t}</option>`).join("")}</select></label>
    <button class="btn primary wide" id="apSave">Book it</button>`;
  $("#apSave").onclick=async()=>{const lid=$("#apLead").value,l=leads.get(lid),t=new Date($("#apAt").value).getTime();if(isNaN(t)){toast("Pick a date and time");return}
    try{await putAppt({leadId:lid,leadName:l?fullName(l):"",title:$("#apTitle").value.trim()||(l?fullName(l):"Appointment"),at:t,dur:+$("#apDur").value,type:$("#apType").value,done:false,createdAt:Date.now()});
      if(l&&$("#apType").value!=="Callback"&&l.stage!=="appointment"&&l.stage!=="application"&&l.stage!=="sold")await patchLead(lid,{stage:"appointment",notes:addNoteObj(l,`Appointment booked for ${new Date(t).toLocaleString()}`)});
      closeWin("apptform");CAL.sel=new Date(t).toDateString();CAL.y=new Date(t).getFullYear();CAL.m=new Date(t).getMonth();toast("Booked");if(view==="calendar")renderCalendar()}catch(e){toast("Couldn't book: "+e.message)}};
}
$("#calPrev").onclick=()=>{CAL.m--;if(CAL.m<0){CAL.m=11;CAL.y--}renderCalendar()};
$("#calNext").onclick=()=>{CAL.m++;if(CAL.m>11){CAL.m=0;CAL.y++}renderCalendar()};
$("#calToday").onclick=()=>{const n=new Date();CAL.y=n.getFullYear();CAL.m=n.getMonth();CAL.sel=n.toDateString();renderCalendar()};
$("#calNew").onclick=()=>apptForm();

/* ---------- games ---------- */
function gameXP(n,why){if(typeof crewOnGame==="function")crewOnGame(why,n);const t=new Date().toDateString();if(XP.day!==t){XP.day=t;XP.first=false}if(!XP.first){XP.first=true;n+=25;why+=" (incl. +25 first game today)"}awardXP(n,why)}
function openGames(){const b=openWin("games",{title:"Crew lounge",sub:"Each game opens in its own window",w:400,h:420,chips:`<span class="lvl">${RANKS[rankOf(XP.xp)][1]}</span>`});
  b.innerHTML=`<button class="gcard" id="gW"><span class="thumb">F L Y</span><div><b>Flight Words</b><span>Guess the 5-letter word in six tries.</span></div></button>
   <button class="gcard" id="gB"><span class="thumb">A♠ K♥</span><div><b>Blackjack</b><span>Beat the dealer to 21. Hit, stand, double.</span></div></button>
   <p class="muted" style="font-size:12px;margin:0">Games run on this device. XP counts toward your pilot rank.</p>`;
  $("#gW").onclick=openWords;$("#gB").onclick=openBJ}
const WORDS="PLANE PILOT CLOUD LEVEL CLAIM TERMS RIDER TRUST ASSET YIELD VALUE SPEED FLAPS CABIN ROUTE RADAR ALOFT WINGS CREST PEAKS HEDGE BONDS MONEY QUOTE LEADS CLOSE AGENT SKIES GLIDE BOOST ORBIT TOWER PITCH DRAFT BOARD GUARD HEIRS FUNDS GRANT SAVER RAISE STACK CHART LIFTS HEART TRAIL SOLAR NORTH GLOBE ASCEND SHARE PROOF STEER FLEET JUMBO RUDDER".split(" ").filter(w=>w.length===5);
const WD={};
function openWords(){const today=new Date().toDateString();const idx=Math.abs([...today].reduce((a,c)=>a*31+c.charCodeAt(0)|0,7))%WORDS.length;
  if(WD.day!==today)Object.assign(WD,ls.get("hp.words",{}),{});if(WD.day!==today){WD.day=today;WD.ans=WORDS[idx];WD.rows=[];WD.cur="";WD.over=false}
  const b=openWin("words",{title:"Flight Words",w:330,h:640,chips:`<span class="lvl">${RANKS[rankOf(XP.xp)][1]}</span>`});
  const save=()=>ls.set("hp.words",{day:WD.day,ans:WD.ans,rows:WD.rows,cur:"",over:WD.over});
  const score=g=>{const a=WD.ans.split(""),r=Array(5).fill("n"),used=Array(5).fill(false);g.split("").forEach((c,i)=>{if(c===a[i]){r[i]="g";used[i]=true}});g.split("").forEach((c,i)=>{if(r[i]==="g")return;const j=a.findIndex((x,k)=>x===c&&!used[k]);if(j>=0){r[i]="y";used[j]=true}});return r};
  const draw=(flipRow=-1)=>{const keyS={};WD.rows.forEach(g=>{score(g).forEach((s,i)=>{const c=g[i];if(keyS[c]!=="g")keyS[c]=s==="g"?"g":keyS[c]==="y"?"y":s})});
    let grid="";for(let r=0;r<6;r++){const g=WD.rows[r]||(r===WD.rows.length?WD.cur.padEnd(5):"     ");const sc=WD.rows[r]?score(WD.rows[r]):null;
      grid+=`<div class="wrow">${[...g].map((c,i)=>`<div class="wcell ${sc?sc[i]:c.trim()?"f":""} ${r===flipRow?"flip":""}" style="--k:${i}">${c.trim()}</div>`).join("")}</div>`}
    const rows=["QWERTYUIOP","ASDFGHJKL","⏎ZXCVBNM⌫"];
    b.innerHTML=`<p class="muted" style="margin:0;font-size:12.5px">Blue = right spot, gold = in the word, gray = not in it. Aviation and money words.</p><div class="wgrid">${grid}</div>
      <div class="bjmsg" id="wMsg">${WD.over?(WD.rows.includes(WD.ans)?"Wheels up! You got it.":`The word was ${WD.ans}.`):""}</div>
      <div class="kb">${rows.map(r=>`<div>${[...r].map(k=>`<button type="button" data-k="${k}" class="${keyS[k]||""}" aria-label="${k==="⏎"?"Enter":k==="⌫"?"Backspace":k}">${k==="⏎"?"Enter":k}</button>`).join("")}</div>`).join("")}</div>`;
    b.querySelectorAll("[data-k]").forEach(x=>x.onclick=()=>key(x.dataset.k))};
  const key=k=>{if(WD.over)return;if(k==="⌫"){WD.cur=WD.cur.slice(0,-1);draw();return}
    if(k==="⏎"){if(WD.cur.length<5){$("#wMsg").textContent="Five letters, please.";return}WD.rows.push(WD.cur);WD.cur="";const win=WD.rows[WD.rows.length-1]===WD.ans;if(win||WD.rows.length>=6){WD.over=true}save();draw(WD.rows.length-1);
      if(win){gameXP(30-(WD.rows.length-1)*4,"Flight Words");celebrate()}else if(WD.over)gameXP(5,"Flight Words");return}
    if(/^[A-Z]$/.test(k)&&WD.cur.length<5){WD.cur+=k;draw()}};
  const win=WINS.get("words");win.tabIndex=-1;win.onkeydown=e=>{if(e.target.closest("input,textarea,select"))return;const k=e.key.toUpperCase();if(k==="ENTER")key("⏎");else if(k==="BACKSPACE")key("⌫");else if(/^[A-Z]$/.test(k))key(k)};win.focus();
  draw();
}
const BJ=Object.assign({chips:1000,bet:50},ls.get("hp.bj",{}));let bjShoe=[],bjD=[],bjP=[],bjState="bet",bjMsg="Set your bet and deal.";
function bjNewShoe(){bjShoe=[];for(let d=0;d<6;d++)for(const s of"♠♥♦♣")for(const r of["A","2","3","4","5","6","7","8","9","10","J","Q","K"])bjShoe.push(r+s);for(let i=bjShoe.length-1;i>0;i--){const j=Math.random()*(i+1)|0;[bjShoe[i],bjShoe[j]]=[bjShoe[j],bjShoe[i]]}}
const bjVal=h=>{let t=0,a=0;h.forEach(c=>{const r=c.slice(0,-1);t+=r==="A"?11:/[JQK]/.test(r)?10:+r;if(r==="A")a++});while(t>21&&a){t-=10;a--}return t};
const bjCard=(c,hide)=>hide?'<div class="pcard back"></div>':`<div class="pcard ${/[♥♦]/.test(c)?"r":""}"><span>${c.slice(0,-1)}</span><span class="s">${c.slice(-1)}</span></div>`;
function openBJ(){const b=openWin("bj",{title:"Blackjack",w:400,h:680,chips:`<span class="lvl">${RANKS[rankOf(XP.xp)][1]}</span>`});
  const draw=()=>{const hide=bjState==="play";
    b.innerHTML=`<div class="statrow"><div><span>Chips</span><b>${BJ.chips.toLocaleString()}</b></div><div><span>Bet</span><b>${BJ.bet}</b></div><div><span>Shoe</span><b>${bjShoe.length||312}</b></div></div>
     <div class="felt"><span class="muted" style="font-size:12px">Dealer${bjD.length?` · ${hide?bjVal([bjD[0]])+"+":bjVal(bjD)}`:""}</span><div class="hand">${bjD.map((c,i)=>bjCard(c,hide&&i===1)).join("")}</div>
       <span class="muted" style="font-size:12px">You${bjP.length?` · ${bjVal(bjP)}`:""}</span><div class="hand">${bjP.map(c=>bjCard(c)).join("")}</div></div>
     <div class="bjmsg">${esc(bjMsg)}</div>
     ${bjState==="play"?`<div class="row" style="justify-content:center"><button class="btn" id="bjH">Hit</button><button class="btn primary" id="bjS">Stand</button>${bjP.length===2&&BJ.chips>=BJ.bet?`<button class="btn" id="bjDb">Double</button>`:""}</div>`
      :`<div class="chips">${[10,25,50,100,250].map(v=>`<button type="button" class="chipc" data-bet="${v}" aria-pressed="${BJ.bet===v}">${v}</button>`).join("")}</div><button class="btn primary wide" id="bjDeal">${BJ.chips<10?"Refill to 1,000":"Deal"}</button>`}
     <p class="muted" style="font-size:12px;margin:0">Dealer stands on 17. Blackjack pays 3:2. Six-deck shoe, reshuffled near the end.</p>`;
    b.querySelectorAll("[data-bet]").forEach(x=>x.onclick=()=>{BJ.bet=+x.dataset.bet;ls.set("hp.bj",BJ);draw()});
    if($("#bjDeal"))$("#bjDeal").onclick=deal;if($("#bjH"))$("#bjH").onclick=hit;if($("#bjS"))$("#bjS").onclick=stand;if($("#bjDb"))$("#bjDb").onclick=dbl};
  const settle=(res)=>{bjState="bet";const pay={bj:BJ.bet*1.5,win:BJ.bet,push:0,lose:-BJ.bet}[res];BJ.chips+=pay;ls.set("hp.bj",BJ);
    bjMsg={bj:`Blackjack! You win ${BJ.bet*1.5}.`,win:`You win ${BJ.bet}.`,push:"Push. Bet returned.",lose:bjVal(bjP)>21?`Bust. You lose ${BJ.bet}.`:`Dealer wins. You lose ${BJ.bet}.`}[res];
    draw();gameXP(res==="bj"?10:res==="win"?5:3,"hand played");if(res==="bj")celebrate()};
  const deal=()=>{if(BJ.chips<10){BJ.chips=1000;ls.set("hp.bj",BJ);bjMsg="Chips refilled.";draw();return}if(BJ.bet>BJ.chips)BJ.bet=10;bjMsg="";if(bjShoe.length<60){bjNewShoe();bjMsg="Fresh shoe shuffled."}
    bjP=[bjShoe.pop(),bjShoe.pop()];bjD=[bjShoe.pop(),bjShoe.pop()];bjState="play";bjMsg=bjMsg==="Fresh shoe shuffled."?"Fresh shoe shuffled. Hit or stand?":"Hit or stand?";
    if(bjVal(bjP)===21){bjState="done";return settle(bjVal(bjD)===21?"push":"bj")}draw()};
  const hit=()=>{bjP.push(bjShoe.pop());if(bjVal(bjP)>21)return settle("lose");draw()};
  const stand=()=>{while(bjVal(bjD)<17)bjD.push(bjShoe.pop());const p=bjVal(bjP),d=bjVal(bjD);settle(d>21||p>d?"win":p===d?"push":"lose")};
  const dbl=()=>{BJ.bet*=2;bjP.push(bjShoe.pop());if(bjVal(bjP)>21){settle("lose");BJ.bet/=2;return}stand();BJ.bet/=2;ls.set("hp.bj",BJ)};
  if(!bjShoe.length)bjNewShoe();draw();
}

/* ---------- splash ---------- */


$("#calAdd").onclick=()=>apptForm();
$("#navGames").onclick=openGames;
function floatScript(tab){const s=SCRIPT_LIB[tab];const b=openWin("script",{title:"Script",sub:{FE:"Final Expense",MP:"Mortgage Protection",IUL:"IUL"}[tab],w:380,h:540});
  const hl=t=>esc(t).replace(/\{(\w+)\}/g,'<b style="color:var(--sky)">[$1]</b>');
  b.innerHTML=`<div><span class="label">Opener</span><p style="margin:4px 0 0;line-height:1.6">${hl(s.open)}</p></div><div><span class="label">Fact finder</span><ul style="margin:4px 0 0;padding-left:18px;line-height:1.6">${s.facts.map(f=>`<li>${esc(f)}</li>`).join("")}</ul></div><div><span class="label">Objections</span>${s.obj.map(([q,a])=>`<p style="margin:6px 0 0"><b>"${esc(q)}"</b><br><span class="muted">${esc(a)}</span></p>`).join("")}</div><div><span class="label">Close</span><p style="margin:4px 0 0;line-height:1.6">${hl(s.close)}</p></div>`}
$("#scFloat").onclick=()=>floatScript(scTab);
$("#dScript").onclick=()=>{const l=leads.get(dCurId);floatScript(l?.product==="MP"?"MP":l?.product==="IUL"?"IUL":"FE")};
renderRank();

/* ===================== MODERN LAYER: living jet, segments, LED startup ===================== */
const JET_BODY=`<defs>
<linearGradient id="jb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8A8F9C"/><stop offset=".14" stop-color="#3A3E48"/><stop offset=".5" stop-color="#0E0F13"/><stop offset=".8" stop-color="#050507"/><stop offset="1" stop-color="#000"/></linearGradient>
<linearGradient id="jm" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3A3E47"/><stop offset=".55" stop-color="#121419"/><stop offset="1" stop-color="#030304"/></linearGradient>
<linearGradient id="jd" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2A2D34"/><stop offset=".5" stop-color="#0B0C0F"/><stop offset="1" stop-color="#000"/></linearGradient>
<linearGradient id="jw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2E3138"/><stop offset="1" stop-color="#060708"/></linearGradient>
<linearGradient id="js" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1A1C22"/><stop offset=".5" stop-color="#3A3E47"/><stop offset="1" stop-color="#1A1C22"/></linearGradient>
<radialGradient id="jx" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#FFF1D0"/><stop offset=".35" stop-color="#FFB070" stop-opacity=".8"/><stop offset="1" stop-color="#FF6A3C" stop-opacity="0"/></radialGradient></defs>
<path d="M7 5.2 L32 3.2 L33 6 L9 7.4 Z" fill="url(#jm)" stroke="#000" stroke-width=".4"/>
<path d="M22 27 L12 5 Q12.2 4 13.6 4.2 L21.5 4.6 L40 26.5 Z" fill="url(#jm)" stroke="#000" stroke-width=".45"/>
<path d="M17.6 8 L24.5 8.2 L31.8 17 L24.8 17 Z" fill="url(#js)"/><path d="M26.3 19.4 L33.4 19.4 L36.4 23 L29.3 23 Z" fill="url(#js)" opacity=".85"/>
<path d="M8 33.5 C8 29.2 16 26.6 31 25.6 L120 24.2 C135 24 149 27.4 156.5 32.2 C150.5 36.4 136.5 39.4 121 39.6 L31 40.2 C16 40.2 8 37.9 8 33.5 Z" fill="url(#jb)" stroke="#000" stroke-width=".5"/>
<path d="M30 27.4 L120 26 C133 25.9 145 28.4 152 31.4" stroke="#C4C9D2" stroke-width="1.1" fill="none" stroke-linecap="round" opacity=".55"/>
<path d="M14 36.6 C40 38.4 100 38.2 152 33.6" stroke="#2A2D34" stroke-width="1.1" fill="none" opacity=".9"/>
<path d="M133 26.6 C138 27 143.5 28.4 147 30 L143.6 31 L131.4 30.8 Z" fill="url(#jd)"/>
<path d="M134.4 27.6 L141.5 28.9" stroke="#5A5F6A" stroke-width=".7" stroke-linecap="round" opacity=".8"/>
<rect x="121.6" y="27.6" width="6.6" height="10.4" rx="1.8" fill="none" stroke="#3A3E47" stroke-width=".5"/>
<g fill="url(#jd)">${[50,59.5,69,78.5,88,97.5,107].map(x=>`<ellipse cx="${x}" cy="30.4" rx="2.15" ry="2.7"/>`).join("")}</g>
<g fill="#9AA0AC" opacity=".35">${[50,59.5,69,78.5,88,97.5,107].map(x=>`<ellipse cx="${x-.6}" cy="29.4" rx=".7" ry=".8"/>`).join("")}</g>
<path d="M44 26.6 L50 22.8 L56 22.8 L54 26.2 Z" fill="url(#jm)"/>
<rect x="28" y="14.6" width="34" height="10.4" rx="5.2" fill="url(#jm)" stroke="#000" stroke-width=".45"/>
<ellipse cx="61" cy="19.8" rx="2.1" ry="4.6" fill="url(#jd)"/><ellipse cx="61.3" cy="19.8" rx="1" ry="2.6" fill="#26282E"/>
<path d="M30 16.6 H58" stroke="#C4C9D2" stroke-width=".8" opacity=".5" stroke-linecap="round"/>
<path d="M28.6 17 L24.6 17.6 L24.6 22.2 L28.6 22.8 Z" fill="#1A1C22"/>
<path d="M66 38.2 L106 38 L82 47.2 Q79 48.4 76 48.2 L62 47.6 Z" fill="url(#jw)" stroke="#000" stroke-width=".45"/>
<path d="M62 47.6 L56.5 41.2 L59.2 41 L65.4 47.6 Z" fill="url(#js)"/>
<path d="M68 39.6 L101 39.4" stroke="#8A8F9C" stroke-width=".7" opacity=".35"/>`;
const JET_GEAR=`<g class="gear"><path d="M81 40 V50.5 M139 37.5 V50.5" stroke="#1A1C22" stroke-width="1.5"/><circle cx="81" cy="52.6" r="3.3" fill="#141A26"/><circle cx="81" cy="52.6" r="1.2" fill="#2A2D34"/><circle cx="139" cy="52.6" r="2.7" fill="#141A26"/><circle cx="139" cy="52.6" r="1" fill="#2A2D34"/></g>`;
const JET_SVG=`<svg viewBox="0 0 160 58" xmlns="http://www.w3.org/2000/svg">${JET_BODY}${JET_GEAR}</svg>`;
const JET_URI="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(`<svg viewBox="0 0 160 58" xmlns="http://www.w3.org/2000/svg">${JET_BODY}</svg>`);
document.documentElement.style.setProperty("--jet-uri",`url("${JET_URI}")`);
const JET_IMG=new Image(); JET_IMG.src=JET_URI;

/* ----- living jet slider ----- */
function makeJetSlider(rng){
  if(!rng||rng._jet)return rng&&rng._jet;
  const rw=rng.closest(".runway"); if(!rw)return;
  const cv=document.createElement("canvas");cv.className="puffs";
  const lt=document.createElement("div");lt.className="rlights t";const lb=document.createElement("div");lb.className="rlights b";
  const N=26;lt.innerHTML=lb.innerHTML="<i></i>".repeat(N);
  const sh=document.createElement("div");sh.className="pshadow";sh.innerHTML=JET_SVG;
  const pl=document.createElement("div");pl.className="plane";pl.innerHTML=`<div class="pbody">${JET_SVG}</div>`;
  rw.append(cv,lt,lb,sh,pl);
  const L1=[...lt.children],L2=[...lb.children];
  const st={x:null,vx:0,y:0,vy:0,a:0,va:0,raf:0,last:0,parts:[],prevPn:null,lit:-1};
  const ctx=cv.getContext("2d");
  const target=()=>{const pn=Math.max(0,Math.min(1,parseFloat(rng.style.getPropertyValue("--pn"))||0));const w=rng.clientWidth,tw=110;return{tx:rng.offsetLeft+tw/2+pn*(w-tw),pn}};
  const size=()=>{const d=devicePixelRatio||1;if(cv.width!==rw.clientWidth*d){cv.width=rw.clientWidth*d;cv.height=rw.clientHeight*d}};
  function frame(ts){
    const dt=Math.min(2.2,(ts-(st.last||ts))/16.67)||1;st.last=ts;
    if(!rw.offsetParent){st.raf=0;return}
    size();const {tx,pn}=target();const cy=rng.offsetTop+rng.offsetHeight/2;
    if(st.x==null){st.x=tx;st.prevPn=pn}
    if(RM){st.x=tx;st.y=pn>.55?Math.pow((pn-.55)/.45,1.1)*26:0;st.a=pn>.55?-9:0}
    else{
      st.vx=(st.vx+(tx-st.x)*.14*dt)*Math.pow(.74,dt);st.x+=st.vx*dt;
      const lift=pn>.55?Math.pow((pn-.55)/.45,1.1)*26:0;
      st.vy=(st.vy+(lift-st.y)*.1*dt)*Math.pow(.76,dt);st.y+=st.vy*dt;
      const tA=Math.max(-14,Math.min(5,-st.vx*.25-(pn>.55?Math.min(1,(pn-.55)/.45)*11:0)-st.vy*.8));
      st.va=(st.va+(tA-st.a)*.18*dt)*Math.pow(.7,dt);st.a+=st.va*dt;
    }
    const air=st.y>2.5;pl.classList.toggle("air",air);
    const lf=Math.min(1,st.y/26);
    pl.style.transform=`translate(${st.x-55}px,${cy-26-st.y}px) rotate(${st.a}deg)`;
    sh.style.transform=`translate(${st.x-55+lf*8}px,${cy+8}px) scale(${1-lf*.35},.18)`;sh.style.opacity=.5-lf*.35;
    const w=rw.clientWidth,lit=Math.round(((st.x-14)/(w-28))*N);
    if(lit!==st.lit){st.lit=lit;L1.forEach((e,i)=>e.classList.toggle("on",i<lit));L2.forEach((e,i)=>e.classList.toggle("on",i<lit))}
    if(st.prevPn!=null&&st.prevPn<=.55&&pn>.55&&!RM){rw.classList.remove("v1");void rw.offsetWidth;rw.classList.add("v1");for(let i=0;i<3;i++)st.parts.push(puff(st,cy,1.1))}
    st.prevPn=pn;
    const spd=Math.abs(st.vx);
    if(!RM){if(spd>1.2&&Math.random()<.35)st.parts.push(puff(st,cy,.7));
      if(air&&Math.random()<.35)st.parts.push(puff(st,cy,.5,true))}
    const d=devicePixelRatio||1;ctx.clearRect(0,0,cv.width,cv.height);
    st.parts=st.parts.filter(p=>p.life<1);
    for(const p of st.parts){p.life+=p.dl*dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.r+=p.gr*dt;
      ctx.globalAlpha=(1-p.life)*p.a;ctx.fillStyle=p.trail?"#CFE0F7":"#E6EDF7";ctx.beginPath();ctx.arc(p.x*d,p.y*d,p.r*d,0,6.283);ctx.fill()}
    ctx.globalAlpha=1;
    const settled=Math.abs(st.vx)<.03&&Math.abs(tx-st.x)<.4&&Math.abs(st.vy)<.03&&Math.abs(st.va)<.03&&!st.parts.length&&!air;
    st.raf=settled?0:requestAnimationFrame(frame);
  }
  function puff(s,cy,k,trail){const ang=s.a*Math.PI/180,tailX=s.x-34*Math.cos(ang),tailY=cy-s.y-12-34*Math.sin(ang);
    return{x:tailX+(Math.random()-.5)*4,y:tailY+(Math.random()-.5)*4,vx:trail?-(1.6+Math.random()):-Math.sign(s.vx||1)*(.6+Math.random()*1.4)*k,vy:(Math.random()-.5)*.6*k,r:trail?1.1:1.2+Math.random()*1.2*k,gr:trail?.03:.05*k,life:0,dl:trail?.03:.06,a:trail?.4:.3,trail}}
  const sync=()=>{if(!st.raf)st.raf=requestAnimationFrame(t=>{st.last=t;frame(t)})};
  rng.addEventListener("input",sync);rng.addEventListener("pointerdown",sync);addEventListener("resize",sync);
  rng._jet={sync};return rng._jet;
}

/* ----- segmented controls with sliding thumb (spring) ----- */
const segPos=new Map();
function updateSegs(){document.querySelectorAll(".bigseg,.seg2").forEach(seg=>{
  const on=seg.querySelector('button[aria-pressed="true"]');let th=seg.querySelector(":scope>.segthumb");
  if(!on||!seg.offsetParent){return}
  if(!th){th=document.createElement("span");th.className="segthumb";seg.prepend(th);const p=segPos.get(seg.id||seg);if(p){th.style.transition="none";th.style.width=p.w+"px";th.style.transform=`translateX(${p.x}px)`;void th.offsetWidth;th.style.transition=""}}
  seg.classList.add("has-thumb");const x=on.offsetLeft,w=on.offsetWidth;
  th.style.width=w+"px";th.style.transform=`translateX(${x}px)`;segPos.set(seg.id||seg,{x,w});
  if(!seg._ro&&window.ResizeObserver){seg._ro=new ResizeObserver(()=>{if(!segQ)segQ=requestAnimationFrame(()=>{segQ=0;updateSegs()})});seg._ro.observe(seg)}})}
addEventListener("load",()=>setTimeout(updateSegs,60));document.fonts&&document.fonts.ready.then(()=>updateSegs());
let segQ=0;const segMO=new MutationObserver(()=>{if(!segQ)segQ=requestAnimationFrame(()=>{segQ=0;updateSegs()})});
segMO.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:["aria-pressed","hidden"]});
addEventListener("resize",()=>{segPos.clear();document.querySelectorAll(".segthumb").forEach(t=>t.remove());updateSegs()});

/* ----- LED startup sign ----- */
function ledIntro(){
  if(window.hpNeon)return; // the neon sign intro runs at startup now
  let seen=false;try{seen=sessionStorage.getItem("hpv.led")}catch{}
  if(seen||RM)return; try{sessionStorage.setItem("hpv.led","1")}catch{}
  const wrap=document.createElement("div");wrap.id="led";wrap.setAttribute("aria-hidden","true");wrap.innerHTML=`<canvas></canvas><span class="skip">Tap to skip</span>`;document.body.append(wrap);
  const cv=wrap.querySelector("canvas"),x=cv.getContext("2d");
  const narrow=innerWidth<640, COLS=narrow?96:150, ROWS=narrow?64:66, CELL=narrow?8:7, d=devicePixelRatio||1;
  cv.width=COLS*CELL*d;cv.height=ROWS*CELL*d;
  let dots=[];
  function build(){
  const off=document.createElement("canvas");off.width=COLS;off.height=ROWS;const o=off.getContext("2d");
  o.fillStyle="#fff";o.textAlign="center";o.textBaseline="alphabetic";
  const cx=COLS/2, mono=ROWS*.5;
  o.font=`700 ${mono}px "Libre Caslon Text", Georgia, serif`;o.fillText("H",cx-mono*.17,ROWS*.5);o.fillText("P",cx+mono*.2,ROWS*.62);
  o.beginPath();o.moveTo(cx-mono*.95,ROWS*.6);o.bezierCurveTo(cx-mono*.3,ROWS*.56,cx+mono*.35,ROWS*.36,cx+mono*.9,ROWS*.1);o.bezierCurveTo(cx+mono*.4,ROWS*.4,cx-mono*.3,ROWS*.58,cx-mono*.95,ROWS*.6);o.fill();
  o.beginPath();o.moveTo(cx+mono*.82,ROWS*.11);o.lineTo(cx+mono*1.12,ROWS*.02);o.lineTo(cx+mono*.98,ROWS*.2);o.closePath();o.fill();
  o.font=`800 ${ROWS*.15}px -apple-system,"Segoe UI",Arial,sans-serif`;o.fillText("HIGHPOINT",cx,ROWS*.84);
  o.font=`700 ${ROWS*.09}px -apple-system,"Segoe UI",Arial,sans-serif`;o.fillText("F I N A N C I A L",cx,ROWS*.97);
  const px=o.getImageData(0,0,COLS,ROWS).data;
  dots=[];for(let r=0;r<ROWS;r++)for(let c=0;c<COLS;c++){const a=px[(r*COLS+c)*4+3];dots.push({c,r,on:a>110,t:Math.random()*700,row:r})}
  }
  let t0=0;let done=false;
  const lit=(dot,t)=>{if(!dot.on)return 0;if(t<dot.t)return 0;if(t<dot.t+60)return Math.random()<.5?1:.2;
    if(t>800&&t<950)return 0;if(t>950&&t<1100)return 1;if(t>1100&&t<1190)return 0;if(t>1190&&t<1290)return 1;if(t>1290&&t<1350)return .15;return 1};
  function draw(now){if(done)return;const t=now-t0;x.clearRect(0,0,cv.width,cv.height);
    const scan=(t>1400)?((t-1400)/900)*(COLS+20)-10:-99;const R=CELL*d*.36;
    for(const dot of dots){let v=lit(dot,t);const X=(dot.c+.5)*CELL*d,Y=(dot.r+.5)*CELL*d;
      if(v&&Math.abs(dot.c-scan)<3)v=1.35;
      if(v<=0){x.shadowBlur=0;x.fillStyle="#1A0A24";x.beginPath();x.arc(X,Y,R,0,6.283);x.fill();continue}
      x.shadowBlur=10*d*Math.min(v,1.2);x.shadowColor=dot.row>ROWS*.72?"rgba(255,158,61,.95)":"rgba(255,46,136,.95)";
      x.fillStyle=v>1?"#FFFFFF":dot.row>ROWS*.72?`rgba(255,158,61,${.35+.65*v})`:`rgba(255,79,163,${.35+.65*v})`;x.beginPath();x.arc(X,Y,R*(v>1?1.15:1),0,6.283);x.fill()}
    x.shadowBlur=0;
    if(t<2500)requestAnimationFrame(draw);else finish()}
  function finish(){if(done)return;done=true;wrap.classList.add("out");setTimeout(()=>wrap.remove(),700)}
  wrap.onclick=finish;addEventListener("keydown",finish,{once:true});
  (document.fonts?.load?document.fonts.load('700 40px "Libre Caslon Text"').catch(()=>{}):Promise.resolve()).finally(()=>{build();t0=performance.now();requestAnimationFrame(draw)});
}

makeJetSlider($("#qAmt"));makeJetSlider($("#ilAmt"));ledIntro();

/* ---------- call timer + call history + transcripts ---------- */
let callT0=0,callLead=null,callTick=0;
const fmtDur=ms=>{const s=Math.round(ms/1000);return`${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`};
function tickCall(){clearInterval(callTick);callTick=setInterval(()=>{const c=$("#dcClock");if(c&&callT0)c.textContent=fmtDur(Date.now()-callT0)},1000)}
function callStop(){const was=!!callT0;callT0=0;callLead=null;clearInterval(callTick);if(was)window.dispatchEvent(new Event("hp:callend"))}
const calls=new Map(); let ccol=null;
function initCalls(){if(!db)return;ccol=db.collection("calls");ccol.onSnapshot(s=>{calls.clear();s.docs.forEach(d=>{const v=d.data();if(v)calls.set(d.id,{...v,id:d.id})});if(view==="dialer"&&dTab==="hist")renderHist();const w=WINS.get("call");if(w&&openCallId)renderCallWin(openCallId,true)},()=>{})}
async function logCall(c){const id=uid();if(ccol){try{await ccol.doc(id).set(c)}catch(e){toast("Couldn't save the call log: "+e.message)}}else{calls.set(id,{...c,id})}return id}
async function patchCall(id,p){const c=calls.get(id);if(!c)return;const n={...c,...p};delete n.id;if(ccol)await ccol.doc(id).set(n);else calls.set(id,{...n,id})}
let dTab="dial";
$$("#dTabs button").forEach(b=>b.onclick=()=>{dTab=b.dataset.dt;$$("#dTabs button").forEach(x=>x.setAttribute("aria-pressed",x===b));$("#dPane").hidden=dTab!=="dial";$("#hPane").hidden=dTab!=="hist";if(dTab==="hist")renderHist()});
function histRows(){const q=$("#hQ").value.trim().toLowerCase(),qd=digits(q),o=$("#hOut").value,r=+$("#hRange").value;const from=r?(r===1?new Date(new Date().toDateString()).getTime():Date.now()-r*864e5):0;
  return [...calls.values()].filter(c=>c.at>=from&&(!o||c.outcome===o)&&(!q||[c.name,c.note,c.transcript,c.summary].join(" ").toLowerCase().includes(q)||(qd.length>=3&&String(c.phone).includes(qd)))).sort((a,b)=>b.at-a.at)}
function renderHist(){
  const outs=[...new Set([...calls.values()].map(c=>c.outcome))].sort();const cur=$("#hOut").value;$("#hOut").innerHTML=`<option value="">All outcomes</option>`+outs.map(o=>`<option ${o===cur?"selected":""}>${esc(o)}</option>`).join("");
  const rows=histRows();const talk=rows.reduce((a,c)=>a+(c.dur||0),0);const conv=rows.filter(c=>!["No answer","Left voicemail","Bad number"].includes(c.outcome)).length;
  $("#hStats").innerHTML=`<div><span class="num">${rows.length}</span><span class="muted">Calls</span></div><div><span class="num">${conv}</span><span class="muted">Conversations</span></div><div><span class="num">${fmtDur(talk)}</span><span class="muted">Talk time</span></div><div><span class="num">${rows.filter(c=>c.outcome==="Appointment set").length}</span><span class="muted">Appointments</span></div>`;
  $("#hRows").innerHTML=rows.slice(0,400).map(c=>`<tr data-call="${esc(c.id)}" tabindex="0"><td><b>${esc(c.name)}</b><br><span class="muted num">${esc(fmtPhone(c.phone))}</span></td><td class="muted">${new Date(c.at).toLocaleString([],{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}</td><td><span class="opill ${/Appointment/.test(c.outcome)?"good":/Not interested|Bad/.test(c.outcome)?"bad":""}">${esc(c.outcome)}</span>${c.note?`<br><span class="muted" style="font-size:12px">${esc(c.note.slice(0,60))}</span>`:""}</td><td class="num">${c.dur?fmtDur(c.dur):"—"}</td><td>${c.transcript?`<span class="opill good">✓ ${c.summary?"Summarized":"Added"}</span>`:'<span class="muted">Add</span>'}</td><td>›</td></tr>`).join("")||`<tr><td colspan="6" class="muted" style="text-align:center;padding:28px;white-space:normal">No calls here yet. Every outcome you log in the dialer shows up in this list with its time, duration and notes.</td></tr>`;
  $$("#hRows [data-call]").forEach(r=>{r.onclick=()=>renderCallWin(r.dataset.call);r.onkeydown=e=>{if(e.key==="Enter")renderCallWin(r.dataset.call)}});
}
["#hQ","#hOut","#hRange"].forEach(s=>$(s).addEventListener("input",renderHist));
$("#hCsv").onclick=()=>{const rows=histRows();if(!rows.length){toast("No calls to export");return}offerFile(`call-log-${new Date().toISOString().slice(0,10)}.csv`,toCSV(["Contact","Phone","Time","Outcome","Duration (sec)","Note","Summary","Transcript"],rows.map(c=>[c.name,c.phone,new Date(c.at).toLocaleString(),c.outcome,Math.round((c.dur||0)/1000),c.note||"",c.summary||"",c.transcript||""])))};
let openCallId=null;
function renderCallWin(id,soft){const c=calls.get(id);if(!c)return;openCallId=id;
  const b=openWin("call",{title:"Call",sub:c.name,w:520,h:700,onClose:()=>openCallId=null});
  if(soft&&b.contains(document.activeElement))return;
  b.innerHTML=`<div class="ci-row"><span>When</span><span>${new Date(c.at).toLocaleString()}</span></div><div class="ci-row"><span>Outcome</span><span class="opill">${esc(c.outcome)}</span></div><div class="ci-row"><span>Duration</span><span class="num">${c.dur?fmtDur(c.dur):"Not timed"}</span></div>${c.note?`<div class="ci-row"><span>Note</span><span>${esc(c.note)}</span></div>`:""}${c.wavvId?`<div class="ci-row"><span>Source</span><span>WAVV${c.direction==="inbound"?" · inbound":""}${c.recorded?` · <a href="/api/wavv/recording?id=${encodeURIComponent(c.wavvId)}" target="_blank" rel="noopener">Play recording</a>`:""}</span></div>`:""}
   <div class="stack"><span class="label">Transcript</span>
     <textarea id="ctTxt" rows="9" placeholder="Paste the call transcript here (from WAVV's call recording, your phone or a notetaker). You can also upload a .txt, .vtt or .srt file.">${esc(c.transcript||"")}</textarea>
     <div class="row"><label class="btn sm" for="ctFile" style="cursor:pointer">Upload transcript file</label><input type="file" id="ctFile" accept=".txt,.vtt,.srt,text/plain" hidden><button class="btn sm" id="ctSave">Save transcript</button><button class="btn sm primary" id="ctSum">Summarize with Highpoint Bot</button></div></div>
   <div class="stack"><span class="label">Summary</span><div class="script" id="ctOut" style="white-space:pre-wrap;min-height:60px">${c.summary?esc(c.summary):'<span class="muted">No summary yet. Add a transcript and press Summarize: you get the key points, objections, health details mentioned, the next step, and a suggested note.</span>'}</div>
   ${c.summary?`<button class="btn sm" id="ctNote">Add summary to client notes</button>`:""}</div>`;
  $("#ctFile").onchange=e=>{const f=e.target.files[0];if(!f)return;const rd=new FileReader();rd.onload=()=>{let t=String(rd.result);if(/\.(vtt|srt)$/i.test(f.name))t=t.replace(/^WEBVTT.*$/m,"").replace(/^\d+\s*$/gm,"").replace(/^[\d:.,]+\s*-->\s*[\d:.,]+.*$/gm,"").replace(/\n{2,}/g,"\n").trim();$("#ctTxt").value=t;toast("Transcript loaded. Press Save transcript.")};rd.readAsText(f)};
  $("#ctSave").onclick=async()=>{await patchCall(id,{transcript:$("#ctTxt").value.trim()});toast("Transcript saved")};
  if($("#ctNote"))$("#ctNote").onclick=async()=>{const l=leads.get(c.leadId);if(!l){toast("This client is no longer in your CRM");return}await patchLead(l.id,{notes:addNoteObj(l,"Call summary: "+c.summary.slice(0,900))});toast("Added to "+fullName(l)+"'s notes")};
  $("#ctSum").onclick=async()=>{const t=$("#ctTxt").value.trim();if(t.length<40){toast("Paste or upload a transcript first");return}
    if(!sample){try{sample=await window.claude?.use?.("sample")}catch{}}
    if(!sample){toast("Sign in to summarize calls");return}
    await patchCall(id,{transcript:t});const out=$("#ctOut");out.textContent="Summarizing…";
    try{const r=await sample(`You summarize life insurance sales calls for an agent at Highpoint Financial. Client: ${c.name}. Product interest: ${PROD[c.product]||"unknown"}. Logged outcome: ${c.outcome}.
Write plain text with these short labeled lines, no markdown:
Summary: 2-3 sentences.
Client details: age, health, budget, beneficiaries, coverage they have, if mentioned.
Objections: what they pushed back on.
Next step: the single most useful follow-up and when.
Suggested note: one line for the CRM.
If something wasn't mentioned, write "not mentioned". Transcript:
"""${t.slice(0,24000)}"""`,{onText:({text})=>{out.textContent=text},cache:false,modelTier:"quick"});
      await patchCall(id,{summary:r.text.trim()});out.textContent=r.text.trim();awardXP(5,"call reviewed");renderCallWin(id)}
    catch(e){out.textContent=e?.code==="not_granted"?"The assistant isn't available right now. Try again.":"Couldn't summarize: "+(e?.message||e?.code)}};
}

/* ===================== CREW: character renderer ===================== */
const AV={
 skin:["#FBE0CC","#F2C9A6","#E2A97E","#C98B5E","#A86B43","#8A5232","#6B3C22","#4A2A18"],
 hairColor:["#1A1210","#3B2416","#6B4226","#A0662E","#D9A441","#E9D9B0","#B9B9C2","#FF4FA3","#3DF5FF","#B15CFF"],
 hair:["short","slick","buzz","curly","waves","afro","long","bob","ponytail","braids","mohawk","bald"],
 brows:["natural","thick","thin"],
 face:["none","stubble","mustache","goatee","beard"],
 shades:["none","aviators","wayfarers","round","visor"],
 hat:["none","cap","backcap","panama","headband"],
 top:["tropical","suit","leather","polo","blazer","hoodie","blouse","bomber"],
 topColor:["#FF2E88","#3DF5FF","#FF9E3D","#B15CFF","#FFFFFF","#F5E6C8","#1B1B26","#2E6BFF","#2FBF71","#FFE45E"],
 acc:["none","chain","earrings","both"],
 mouth:["smile","grin","smirk","neutral"],
 bg:["sunset","neon","marina","skyline","palms","purple"]
};
const AV_LABEL={short:"Short",slick:"Slicked back",buzz:"Buzz",curly:"Curly",waves:"Waves",afro:"Afro",long:"Long",bob:"Bob",ponytail:"Ponytail",braids:"Braids",mohawk:"Mohawk",bald:"Bald",
 none:"None",stubble:"Stubble",mustache:"Mustache",goatee:"Goatee",beard:"Beard",aviators:"Aviators",wayfarers:"Wayfarers",round:"Round",visor:"Neon visor",
 cap:"Cap",backcap:"Backwards cap",panama:"Panama hat",headband:"Headband",tropical:"Tropical shirt",suit:"Pastel suit",leather:"Leather jacket",polo:"Polo",blazer:"Blazer & tie",hoodie:"Hoodie",blouse:"Blouse",bomber:"Bomber jacket",
 chain:"Gold chain",earrings:"Earrings",both:"Chain + earrings",smile:"Smile",grin:"Big grin",smirk:"Smirk",neutral:"Cool",
 sunset:"Sunset beach",neon:"Neon strip",marina:"Marina",skyline:"Night skyline",palms:"Palm drive",purple:"Purple haze",natural:"Natural",thick:"Bold",thin:"Fine"};
const AV_DEFAULT={skin:2,hair:"short",hairColor:0,brows:"natural",face:"none",shades:"aviators",hat:"none",top:"tropical",topColor:0,acc:"none",mouth:"smile",bg:"sunset"};
function avRandom(){const r=a=>a[Math.random()*a.length|0];return{skin:Math.random()*AV.skin.length|0,hair:r(AV.hair),hairColor:Math.random()*7|0,brows:r(AV.brows),face:r(AV.face),shades:r(AV.shades),hat:Math.random()<.35?r(AV.hat):"none",top:r(AV.top),topColor:Math.random()*AV.topColor.length|0,acc:r(AV.acc),mouth:r(AV.mouth),bg:r(AV.bg)}}
function shade(hex,k){const n=parseInt(hex.slice(1),16);let r=n>>16,g=n>>8&255,b=n&255;const f=v=>Math.max(0,Math.min(255,Math.round(k<0?v*(1+k):v+(255-v)*k)));return"#"+[f(r),f(g),f(b)].map(v=>v.toString(16).padStart(2,"0")).join("")}
let avN=0;
function avatarSVG(c0,size=200){const c={...AV_DEFAULT,...(c0||{})};const u="a"+(++avN);
  const sk=AV.skin[c.skin]||AV.skin[2],skD=shade(sk,-.16),hc=AV.hairColor[c.hairColor]||AV.hairColor[0],hcL=shade(hc,.25),tc=AV.topColor[c.topColor]||AV.topColor[0],tcD=shade(tc,-.25),tcL=shade(tc,.3);
  const BG={sunset:`<linearGradient id="${u}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A0845"/><stop offset=".55" stop-color="#C2185B"/><stop offset=".8" stop-color="#FF9E3D"/><stop offset="1" stop-color="#FF9E3D"/></linearGradient>`,
    neon:`<linearGradient id="${u}bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#12051F"/><stop offset=".5" stop-color="#3A0F5E"/><stop offset="1" stop-color="#0D3B5E"/></linearGradient>`,
    marina:`<linearGradient id="${u}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7FE7FF"/><stop offset=".6" stop-color="#FFB3D9"/><stop offset="1" stop-color="#2E6BFF"/></linearGradient>`,
    skyline:`<linearGradient id="${u}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05030F"/><stop offset="1" stop-color="#2A0845"/></linearGradient>`,
    palms:`<linearGradient id="${u}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF6F3C"/><stop offset=".6" stop-color="#FF2E88"/><stop offset="1" stop-color="#5A0F6E"/></linearGradient>`,
    purple:`<radialGradient id="${u}bg" cx=".5" cy=".35" r=".8"><stop offset="0" stop-color="#B15CFF"/><stop offset="1" stop-color="#1A0730"/></radialGradient>`}[c.bg]||"";
  const bgDeco={sunset:`<circle cx="100" cy="150" r="46" fill="#FF9E3D" opacity=".75"/><g fill="#C2185B" opacity=".55"><rect x="40" y="150" width="120" height="4"/><rect x="40" y="160" width="120" height="5"/><rect x="40" y="171" width="120" height="6"/></g>`,
    neon:`<g stroke-width="2.5" fill="none" opacity=".75"><rect x="18" y="26" width="46" height="18" rx="9" stroke="#FF4FA3"/><path d="M150 18 l4 10 l11 1 l-8 7 l3 11 l-10 -6 l-10 6 l3 -11 l-8 -7 l11 -1z" stroke="#FFD1EC"/><circle cx="170" cy="78" r="9" stroke="#FF9E3D"/></g>`,
    marina:`<g fill="#fff" opacity=".7"><path d="M24 140 l20 -36 v36z"/><path d="M150 132 l16 -30 v30z"/></g><rect x="0" y="150" width="200" height="70" fill="#2E6BFF" opacity=".55"/>`,
    skyline:`<g fill="#1A0730">${[[10,80,22],[34,60,18],[54,95,26],[132,70,20],[154,52,24],[178,88,22]].map(([x,y,w])=>`<rect x="${x}" y="${y}" width="${w}" height="${220-y}"/>`).join("")}</g><g fill="#FF9E3D" opacity=".8">${Array.from({length:22},(_,i)=>`<rect x="${[14,20,38,58,66,74,136,142,158,166,182,190][i%12]}" y="${70+(i*13)%90}" width="3" height="4"/>`).join("")}</g><circle cx="160" cy="34" r="10" fill="#FFF1FA" opacity=".85"/>`,
    palms:`<g fill="#2A0845" opacity=".85"><path d="M30 220 C32 170 36 140 44 112 l4 1 C40 142 38 172 38 220Z"/><path d="M44 112 c-14 -10 -30 -8 -40 0 c12 -6 26 -6 40 0z M46 112 c6 -14 20 -22 34 -20 c-12 4 -24 10 -34 20z M45 113 c-4 -14 -14 -24 -28 -26 c12 6 22 14 28 26z"/><path d="M170 220 C168 176 164 150 158 124 l-4 1 C160 150 162 176 162 220Z"/><path d="M156 124 c14 -10 30 -8 40 0 c-12 -6 -26 -6 -40 0z M154 124 c-6 -14 -20 -22 -34 -20 c12 4 24 10 34 20z"/></g>`,
    purple:`<g fill="#FF4FA3" opacity=".35"><circle cx="40" cy="40" r="3"/><circle cx="168" cy="60" r="2"/><circle cx="150" cy="28" r="2.5"/><circle cx="24" cy="110" r="2"/></g>`}[c.bg]||"";
  const longBack={long:`<path d="M58 92 C52 150 62 182 80 192 L120 192 C138 182 148 150 142 92 C138 58 120 44 100 44 C80 44 62 58 58 92Z" fill="${hc}"/>`,
    bob:`<path d="M58 94 C56 132 64 146 78 148 L122 148 C136 146 144 132 142 94 C138 60 120 46 100 46 C80 46 62 60 58 94Z" fill="${hc}"/>`,
    afro:`<circle cx="100" cy="76" r="54" fill="${hc}"/><circle cx="62" cy="96" r="20" fill="${hc}"/><circle cx="138" cy="96" r="20" fill="${hc}"/>`,
    ponytail:`<path d="M128 70 C156 74 160 110 150 140 C146 120 140 100 126 90Z" fill="${hc}"/>`,
    braids:`<g fill="${hc}">${[66,76,124,134].map(x=>`<rect x="${x-5}" y="78" width="10" height="${x<100?104:104}" rx="5"/>`).join("")}</g>`}[c.hair]||"";
  const hairFront={short:`<path d="M65 88 C62 56 82 42 102 43 C124 44 140 58 136 88 C130 72 118 64 100 64 C84 64 72 72 65 88Z" fill="${hc}"/>`,
    slick:`<path d="M65 86 C64 54 86 42 104 42 C126 43 140 58 136 86 C128 66 110 56 92 58 C80 60 70 70 65 86Z" fill="${hc}"/><path d="M86 52 C100 47 116 49 128 58" stroke="${hcL}" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".7"/>`,
    buzz:`<path d="M67 84 C68 60 84 50 100 50 C118 50 132 60 133 84 C120 72 82 72 67 84Z" fill="${hc}" opacity=".85"/>`,
    curly:`<g fill="${hc}">${[[70,74],[78,60],[90,52],[104,50],[118,54],[129,64],[134,78],[66,86],[84,62],[112,60]].map(([x,y])=>`<circle cx="${x}" cy="${y}" r="11"/>`).join("")}</g>`,
    waves:`<path d="M66 86 C64 58 84 46 100 46 C118 46 136 56 134 86 C126 70 114 64 100 64 C86 64 74 70 66 86Z" fill="${hc}"/><g stroke="${hcL}" stroke-width="1.6" fill="none" opacity=".6"><path d="M76 66 q6 -4 12 0 q6 4 12 0 q6 -4 12 0 q6 4 12 0"/><path d="M80 56 q6 -4 12 0 q6 4 12 0 q6 -4 12 0"/></g>`,
    afro:`<path d="M66 86 C66 70 80 62 100 62 C120 62 134 70 134 86 C126 76 74 76 66 86Z" fill="${hc}"/>`,
    long:`<path d="M64 92 C62 60 82 44 102 44 C124 44 140 60 136 94 C130 72 112 60 96 62 C82 64 70 76 64 92Z" fill="${hc}"/>`,
    bob:`<path d="M64 90 C62 58 82 44 102 44 C124 44 140 58 136 90 C124 70 76 70 64 90Z" fill="${hc}"/><path d="M66 90 C74 72 90 66 104 66 C90 72 80 80 74 96Z" fill="${hc}"/>`,
    ponytail:`<path d="M65 88 C62 56 82 42 102 43 C124 44 140 58 136 88 C130 70 116 62 100 62 C84 62 72 70 65 88Z" fill="${hc}"/>`,
    braids:`<path d="M65 88 C62 56 82 42 102 43 C124 44 140 58 136 88 C130 72 118 64 100 64 C84 64 72 72 65 88Z" fill="${hc}"/><g stroke="${hcL}" stroke-width="1.5" opacity=".6"><path d="M84 48 v20 M96 45 v20 M108 45 v20 M120 48 v20"/></g>`,
    mohawk:`<path d="M90 70 C88 44 94 26 100 22 C106 26 112 44 110 70Z" fill="${hc}"/><path d="M67 84 C70 70 80 66 88 66 L88 74 C80 74 72 78 67 84Z M133 84 C130 70 120 66 112 66 L112 74 C120 74 128 78 133 84Z" fill="${hc}" opacity=".45"/>`,
    bald:`<path d="M80 56 C90 50 110 50 120 56" stroke="#fff" stroke-width="3" fill="none" opacity=".25" stroke-linecap="round"/>`}[c.hair]||"";
  const brow={natural:2.4,thick:3.6,thin:1.6}[c.brows]||2.4;
  const eyes=`<g fill="#1A1210"><ellipse cx="86" cy="96" rx="3.4" ry="3.8"/><ellipse cx="114" cy="96" rx="3.4" ry="3.8"/></g><g fill="#fff"><circle cx="87.2" cy="94.8" r="1.1"/><circle cx="115.2" cy="94.8" r="1.1"/></g>`;
  const brows=`<g stroke="${shade(hc,-.1)}" stroke-width="${brow}" stroke-linecap="round" fill="none"><path d="M78 86 q8 -5 16 -1"/><path d="M106 85 q8 -4 16 1"/></g>`;
  const SH={none:eyes,
    aviators:`<g><path d="M74 90 h22 c2 0 3 2 2 5 c-2 8 -7 12 -13 12 c-7 0 -12 -6 -12 -13 c0 -2 0 -4 1 -4z" fill="url(#${u}gl)" stroke="#D9A441" stroke-width="1.4"/><path d="M104 90 h22 c1 0 1 2 1 4 c0 7 -5 13 -12 13 c-6 0 -11 -4 -13 -12 c-1 -3 0 -5 2 -5z" fill="url(#${u}gl)" stroke="#D9A441" stroke-width="1.4"/><path d="M96 92 q4 -3 8 0" stroke="#D9A441" stroke-width="1.6" fill="none"/><path d="M78 94 l6 -2" stroke="#fff" stroke-width="1.5" opacity=".7"/></g>`,
    wayfarers:`<g fill="#14101C"><path d="M72 88 h26 v8 c0 6 -4 10 -12 10 c-8 0 -14 -4 -14 -10z"/><path d="M102 88 h26 v8 c0 6 -6 10 -14 10 c-8 0 -12 -4 -12 -10z"/><rect x="96" y="89" width="8" height="3"/></g><path d="M76 92 l6 0" stroke="#FFD1EC" stroke-width="1.6" opacity=".8"/>`,
    round:`<g fill="url(#${u}gl)" stroke="#E9D9B0" stroke-width="1.6"><circle cx="86" cy="96" r="10"/><circle cx="114" cy="96" r="10"/></g><path d="M96 95 q4 -3 8 0" stroke="#E9D9B0" stroke-width="1.6" fill="none"/>`,
    visor:`<path d="M70 88 C80 84 120 84 130 88 L128 102 C118 106 82 106 72 102Z" fill="url(#${u}vz)" stroke="#fff" stroke-width=".8" opacity=".95"/><path d="M76 92 H124" stroke="#fff" stroke-width="1.2" opacity=".6"/>`}[c.shades]||eyes;
  const MOUTH={smile:`<path d="M90 118 q10 8 20 0" stroke="#7A2B2B" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
    grin:`<path d="M88 116 q12 12 24 0 z" fill="#fff" stroke="#7A2B2B" stroke-width="2" stroke-linejoin="round"/>`,
    smirk:`<path d="M92 119 q8 3 17 -3" stroke="#7A2B2B" stroke-width="2.6" fill="none" stroke-linecap="round"/>`,
    neutral:`<path d="M92 119 h16" stroke="#7A2B2B" stroke-width="2.4" stroke-linecap="round"/>`}[c.mouth];
  const FACE={none:"",stubble:`<path d="M70 104 C72 124 86 134 100 134 C114 134 128 124 130 104 C126 118 114 126 100 126 C86 126 74 118 70 104Z" fill="${hc}" opacity=".22"/>`,
    mustache:`<path d="M86 112 C92 108 98 110 100 112 C102 110 108 108 114 112 C110 116 104 114 100 114 C96 114 90 116 86 112Z" fill="${hc}"/>`,
    goatee:`<path d="M92 124 C94 132 106 132 108 124 C104 128 96 128 92 124Z" fill="${hc}"/><path d="M88 112 C94 109 98 110 100 112 C102 110 106 109 112 112 C108 115 92 115 88 112Z" fill="${hc}"/>`,
    beard:`<path d="M68 98 C68 126 84 138 100 138 C116 138 132 126 132 98 C128 112 120 120 112 120 C108 116 92 116 88 120 C80 120 72 112 68 98Z" fill="${hc}"/>`}[c.face]||"";
  const HAT={none:"",cap:`<path d="M64 80 C64 52 84 40 100 40 C118 40 136 52 136 80Z" fill="${tcD}"/><path d="M60 80 H150 C150 86 140 88 130 88 H64Z" fill="${tc}"/><circle cx="100" cy="42" r="3" fill="${tcL}"/>`,
    backcap:`<path d="M64 80 C64 52 84 40 100 40 C118 40 136 52 136 80Z" fill="${tcD}"/><path d="M40 82 H70 L68 76 C56 76 46 78 40 82Z" fill="${tc}"/><rect x="88" y="74" width="24" height="6" rx="3" fill="${tcL}"/>`,
    panama:`<ellipse cx="100" cy="72" rx="56" ry="10" fill="#F5E6C8"/><path d="M70 72 C70 46 84 38 100 38 C116 38 130 46 130 72Z" fill="#F5E6C8"/><rect x="70" y="62" width="60" height="8" fill="${tc}"/>`,
    headband:`<rect x="64" y="70" width="72" height="9" rx="4.5" fill="${tc}"/><rect x="64" y="72" width="72" height="2" fill="#fff" opacity=".5"/>`}[c.hat]||"";
  const tie=c.top==="blazer";
  const TOP={tropical:`<path d="M26 220 C30 170 64 150 100 150 C136 150 170 170 174 220Z" fill="${tc}"/><g fill="${tcD}" opacity=".8"><ellipse cx="54" cy="190" rx="12" ry="5" transform="rotate(-30 54 190)"/><ellipse cx="146" cy="186" rx="12" ry="5" transform="rotate(30 146 186)"/><ellipse cx="74" cy="208" rx="10" ry="4" transform="rotate(20 74 208)"/><ellipse cx="128" cy="210" rx="10" ry="4" transform="rotate(-25 128 210)"/></g><g fill="${tcL}" opacity=".9"><circle cx="62" cy="172" r="4"/><circle cx="140" cy="168" r="4"/><circle cx="110" cy="200" r="3.5"/></g><path d="M100 150 L84 178 L92 152Z M100 150 L116 178 L108 152Z" fill="${tcL}"/><path d="M100 152 V220" stroke="${tcD}" stroke-width="1.5"/>`,
    suit:`<path d="M26 220 C30 170 64 150 100 150 C136 150 170 170 174 220Z" fill="${tc}"/><path d="M84 152 L100 220 L116 152 C110 150 90 150 84 152Z" fill="${tc===AV.topColor[4]?"#3DF5FF":"#FFFFFF"}"/><path d="M84 152 L72 168 L98 210Z M116 152 L128 168 L102 210Z" fill="${tcD}"/>`,
    leather:`<path d="M26 220 C30 170 64 150 100 150 C136 150 170 170 174 220Z" fill="#1E1A26"/><path d="M84 150 L100 172 L116 150 L130 160 L112 186 L100 172 L88 186 L70 160Z" fill="#2E2838"/><path d="M106 178 V220" stroke="#B9B9C2" stroke-width="2"/><path d="M90 152 Q100 160 110 152" fill="${tc}"/>`,
    polo:`<path d="M26 220 C30 170 64 150 100 150 C136 150 170 170 174 220Z" fill="${tc}"/><path d="M86 150 L100 162 L114 150 L120 160 L100 166 L80 160Z" fill="${tcL}"/><path d="M100 164 V188" stroke="${tcD}" stroke-width="2"/><circle cx="100" cy="172" r="1.6" fill="${tcD}"/><circle cx="100" cy="180" r="1.6" fill="${tcD}"/>`,
    blazer:`<path d="M26 220 C30 170 64 150 100 150 C136 150 170 170 174 220Z" fill="${tc}"/><path d="M86 152 L100 220 L114 152Z" fill="#FFFFFF"/><path d="M96 158 L104 158 L106 200 L100 210 L94 200Z" fill="${tc===AV.topColor[1]?"#FF2E88":"#3DF5FF"}"/><path d="M86 152 L72 170 L96 214Z M114 152 L128 170 L104 214Z" fill="${tcD}"/>`,
    hoodie:`<path d="M26 220 C30 170 64 150 100 150 C136 150 170 170 174 220Z" fill="${tc}"/><path d="M70 152 C76 140 124 140 130 152 C122 166 78 166 70 152Z" fill="${tcD}"/><path d="M92 162 V190 M108 162 V190" stroke="${tcL}" stroke-width="2.4" stroke-linecap="round"/><rect x="74" y="196" width="52" height="24" rx="6" fill="${tcD}" opacity=".5"/>`,
    blouse:`<path d="M26 220 C30 170 64 150 100 150 C136 150 170 170 174 220Z" fill="${tc}"/><path d="M84 150 L100 178 L116 150" fill="${sk}"/><path d="M84 150 L100 178 L116 150" fill="none" stroke="${tcL}" stroke-width="3"/>`,
    bomber:`<path d="M26 220 C30 170 64 150 100 150 C136 150 170 170 174 220Z" fill="${tc}"/><path d="M78 152 C86 146 114 146 122 152 L118 160 C110 156 90 156 82 160Z" fill="#1E1A26"/><path d="M100 158 V220" stroke="#B9B9C2" stroke-width="2"/><g fill="${tcD}"><rect x="50" y="196" width="18" height="4" rx="2"/><rect x="132" y="196" width="18" height="4" rx="2"/></g>`}[c.top];
  const ACC=(c.acc==="chain"||c.acc==="both")?`<path d="M82 156 C88 176 112 176 118 156" stroke="#E9C25A" stroke-width="2.6" fill="none" stroke-dasharray="3 1.5"/><circle cx="100" cy="174" r="3.6" fill="#E9C25A"/>`:"";
  const EAR=(c.acc==="earrings"||c.acc==="both")?`<circle cx="66" cy="108" r="2.8" fill="#E9C25A"/><circle cx="134" cy="108" r="2.8" fill="#E9C25A"/>`:"";
  return`<svg viewBox="0 0 200 220" width="${size}" height="${size*1.1}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Crew character"><defs>${BG}
   <linearGradient id="${u}gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF4FA3"/><stop offset=".5" stop-color="#B15CFF"/><stop offset="1" stop-color="#FF2E88"/></linearGradient>
   <linearGradient id="${u}vz" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#FF2E88"/><stop offset="1" stop-color="#B15CFF"/></linearGradient>
   <clipPath id="${u}cl"><rect width="200" height="220" rx="28"/></clipPath></defs>
   <g clip-path="url(#${u}cl)"><rect width="200" height="220" fill="url(#${u}bg)"/>${bgDeco}${longBack}
   <rect x="88" y="120" width="24" height="38" rx="9" fill="${skD}"/>${TOP}${ACC}
   <ellipse cx="66" cy="98" rx="7" ry="9" fill="${skD}"/><ellipse cx="134" cy="98" rx="7" ry="9" fill="${skD}"/>${EAR}
   <ellipse cx="100" cy="94" rx="34" ry="41" fill="${sk}"/>
   <ellipse cx="80" cy="110" rx="7" ry="4" fill="#FF6F9C" opacity=".22"/><ellipse cx="120" cy="110" rx="7" ry="4" fill="#FF6F9C" opacity=".22"/>
   ${FACE}${c.shades==="none"?brows:brows.replace('stroke-width','opacity=".9" stroke-width')}<path d="M100 100 q-3 8 0 10" stroke="${skD}" stroke-width="2.2" fill="none" stroke-linecap="round"/>${MOUTH}${SH}${hairFront}${HAT}</g></svg>`;
}

/* ===================== CREW: stats, achievements, lobby ===================== */
const CREW_ACH=[
 ["first_flight","First Flight","Log your first call","✈",s=>s.dials>=1],
 ["wheels_up","Wheels Up","Set your first appointment","🛫",s=>s.appts>=1],
 ["closer","The Closer","Close your first sale","🏆",s=>s.sales>=1],
 ["dial_50","Frequent Flyer","Log 50 calls","📞",s=>s.dials>=50],
 ["dial_250","Mile High Dialer","Log 250 calls","🚀",s=>s.dials>=250],
 ["appt_10","Booked Solid","Set 10 appointments","📅",s=>s.appts>=10],
 ["kept_10","Right On Time","Keep 10 appointments","⏱",s=>s.kept>=10],
 ["sales_5","Five-Star Closer","Close 5 sales","⭐",s=>s.sales>=5],
 ["sales_25","Top Producer","Close 25 sales","💎",s=>s.sales>=25],
 ["quote_10","Quote Machine","Save 10 quotes to clients","🧮",s=>s.quotes>=10],
 ["import_5","Lead Magnet","Import 5 lead lists","🧲",s=>s.imports>=5],
 ["reviewer","Black Box","Summarize 5 call transcripts","🎧",s=>s.reviews>=5],
 ["night_owl","Night Owl","Log a call after 9 PM","🌙",s=>s.night>=1],
 ["early_bird","Early Bird","Log a call before 7 AM","🌅",s=>s.early>=1],
 ["wordsmith","Wordsmith","Win 5 games of Flight Words","🔤",s=>s.wordWins>=5],
 ["card_shark","Card Shark","Win 10 blackjack hands","🃏",s=>s.bjWins>=10],
 ["captain","Captain's Wings","Reach Captain rank","🎖",s=>s.xp>=2000],
 ["chief","Chief Pilot","Reach Chief Pilot rank","👑",s=>s.xp>=10000],
 ["styled","Fresh Fit","Create your character","🕶",(s,d)=>!!d.char]];
const STATUS={pipeline:"In the CRM",contacts:"Browsing clients",dialer:"On the dialer",quoter:"Quoting",iul:"Running an IUL illustration",assistant:"Talking to Highpoint Bot",screen:"Screening a client",scripts:"Reading scripts",calendar:"Checking the calendar",import:"Importing leads",crew:"In the lobby"};
let userApi=null,myId=null,roomApi=null,crewPeers=[],crewCol=null,crewSort="xp",crewQ=Promise.resolve(),crewTimer=0,crewReady=false;
const crew=new Map(); var myDoc=null; const nameCache={};
const emptyStats=()=>({xp:0,dials:0,appts:0,sales:0,quotes:0,imports:0,kept:0,reviews:0,night:0,early:0,words:0,wordWins:0,hands:0,bjWins:0});
function myStats(){return Object.assign(emptyStats(),myDoc?.stats||{})}
function handleOf(id){const d=crew.get(id);return(d?.handle)||nameCache[id]||"Crew member"}
async function resolveNames(ids){if(!userApi)return;const need=ids.filter(i=>i&&!(i in nameCache));if(!need.length)return;try{const ps=await userApi.profiles(need);need.forEach(i=>{nameCache[i]=ps?.[i]?.name||""})}catch{}}
async function initCrew(){
  try{userApi=await window.claude?.use?.("user")}catch{userApi=null}
  if(!db||!userApi){renderCrew();return}
  myId=await userApi.id(); crewCol=db.collection("crew");
  crewCol.onSnapshot(s=>{crew.clear();s.docs.forEach(d=>{const v=d.data();if(v)crew.set(d.id,v)});
    const mine=myId&&crew.get(myId);if(mine){myDoc=JSON.parse(JSON.stringify(mine));const sx=myStats().xp;if(sx>XP.xp){XP.xp=sx;ls.set("hp.xp",XP)}renderRank()}
    crewReady=true;resolveNames([...crew.keys()]).then(()=>{if(view==="crew")renderCrew()});if(view==="crew")renderCrew()},e=>{crewReady=true;if(view==="crew")renderCrew()});
  try{roomApi=await window.claude?.use?.("room")}catch{roomApi=null}
  if(roomApi){roomApi.onPeers(ch=>{crewPeers=ch.peers.filter(p=>p.kind==="viewer");if(view==="crew")renderOnline()},()=>{});
    roomApi.on("props",m=>{if(m.isMe||m.data?.to!==myId)return;const who=m.by?handleOf(m.by):"Someone";toast(`${who} sent you props 🔥`);celebrate()},()=>{});
    crewPresence(view)}
}
function crewPresence(v){if(roomApi)roomApi.presence({status:STATUS[v]||"Online",at:Date.now()}).catch(()=>{})}
function crewSave(){if(!crewCol||!myId)return;clearTimeout(crewTimer);crewTimer=setTimeout(()=>{const body={...myDoc,stats:myStats(),updatedAt:Date.now()};
  crewQ=crewQ.then(()=>crewCol.doc(myId).set(body)).catch(e=>console.warn("crew save",e))},1200)}
function crewCheckAch(){const s=myStats();myDoc.ach=myDoc.ach||{};const fresh=[];
  for(const [k,n,,ic,ok] of CREW_ACH)if(!myDoc.ach[k]&&ok(s,myDoc)){myDoc.ach[k]=Date.now();fresh.push([n,ic])}
  fresh.forEach(([n,ic],i)=>setTimeout(()=>{toast(`${ic} Achievement unlocked: ${n}`);if(i===0)celebrate()},900+i*1600))}
function crewBump(inc){if(!myId)return;if(!myDoc)myDoc={char:null,handle:"",motto:"",stats:emptyStats(),ach:{},createdAt:Date.now()};
  const s=myStats();for(const k in inc)s[k]=(s[k]||0)+inc[k];s.xp=XP.xp;myDoc.stats=s;crewCheckAch();crewSave()}
function crewOnXP(n,why){const h=new Date().getHours();const inc={};
  if(why.startsWith("call logged"))Object.assign(inc,{dials:1},h>=21?{night:1}:{},h<7?{early:1}:{});
  else if(why.startsWith("appointment set"))Object.assign(inc,{dials:1,appts:1},h>=21?{night:1}:{},h<7?{early:1}:{});
  else if(why.startsWith("policy sold"))inc.sales=1;else if(why.startsWith("quote saved"))inc.quotes=1;else if(why.startsWith("leads imported"))inc.imports=1;
  else if(why.startsWith("appointment kept"))inc.kept=1;else if(why.startsWith("call reviewed"))inc.reviews=1;
  crewBump(inc)}
function crewOnGame(why,n){if(why.startsWith("Flight Words"))crewBump(n>5?{words:1,wordWins:1}:{words:1});else if(why.startsWith("hand played"))crewBump(n>=5?{hands:1,bjWins:1}:{hands:1})}

/* ----- lobby render ----- */
const online=id=>crewPeers.some(p=>p.by===id);
const peerOf=id=>crewPeers.find(p=>p.by===id);
function statBox(v,l){return`<div><b class="num">${(v||0).toLocaleString()}</b><span>${l}</span></div>`}
function achRow(d,max=8){const a=d.ach||{};const got=CREW_ACH.filter(x=>a[x[0]]);return got.slice(0,max).map(x=>`<span class="ach" title="${esc(x[1])}: ${esc(x[2])}">${x[3]}</span>`).join("")+(got.length>max?`<span class="ach more">+${got.length-max}</span>`:"")}
function rankName(xp){return RANKS[rankOf(xp||0)][1]}
function renderOnline(){const el=$("#crewOnline");if(!el)return;const seen=new Set();const list=crewPeers.filter(p=>p.by&&!seen.has(p.by)&&seen.add(p.by));
  el.innerHTML=`<span class="label">Online now · ${list.length}</span><div class="onl">${list.map(p=>{const d=crew.get(p.by);return`<button class="onchip" data-prof="${esc(p.by)}">${d?.char?avatarSVG(d.char,40):`<span class="noav">${esc((handleOf(p.by)||"?")[0])}</span>`}<span><b>${esc(handleOf(p.by))}${p.isMe?" (you)":""}</b><small>${esc(String(p.presence?.status||"Online"))}</small></span><i class="live"></i></button>`}).join("")||`<span class="muted">No one else is online right now. You'll see teammates here the moment they open the desk.</span>`}</div>`;
  el.querySelectorAll("[data-prof]").forEach(b=>b.onclick=()=>openProfile(b.dataset.prof));
  $$("#crewGrid [data-online]").forEach(e=>e.classList.toggle("on",online(e.dataset.online)))}
function renderCrew(){const root=$("#crewBody");if(!root)return;
  if(!db||!userApi||!myId){root.innerHTML=`<div class="panel crew-empty"><h2>Sign in to join the crew</h2><p class="muted">Sign in to make your character, track your stats and see who's online.</p></div>`;return}
  if(!crewReady){root.innerHTML=`<div class="panel crew-empty"><p class="muted">Loading the crew…</p></div>`;return}
  const me=myDoc||{};const s=myStats();const others=[...crew.entries()].filter(([id,d])=>d&&(d.char||d.handle));
  const sortKey={xp:"xp",dials:"dials",appts:"appts",sales:"sales"}[crewSort];
  const board=[...crew.entries()].map(([id,d])=>[id,d,Object.assign(emptyStats(),d.stats||{})]).sort((a,b)=>b[2][sortKey]-a[2][sortKey]).slice(0,10);
  root.innerHTML=`
   <div class="panel" id="crewOnline"></div>
   <div class="crewtop">
     <div class="panel mecard">
       <div class="meav">${me.char?avatarSVG(me.char,190):`<div class="noavbig">?</div>`}</div>
       <div class="meinfo">
         <span class="label">${me.char?"Your character":"Welcome aboard"}</span>
         <h2>${esc(me.handle||nameCache[myId]||"New recruit")}</h2>
         <div class="rankline">${WINGS}<b>${rankName(XP.xp)}</b><span class="muted num">${XP.xp.toLocaleString()} XP</span></div>
         ${me.motto?`<p class="motto">“${esc(me.motto)}”</p>`:""}
         <div class="sgrid">${statBox(s.dials,"Calls")}${statBox(s.appts,"Appointments")}${statBox(s.sales,"Sales")}${statBox(s.quotes,"Quotes")}${statBox(s.kept,"Appts kept")}${statBox(Object.keys(me.ach||{}).length,"Achievements")}</div>
         <div class="row"><button class="btn primary" id="crewEdit">${me.char?"Customize character":"Create your character"}</button><button class="btn" id="crewMine">View all achievements</button></div>
       </div>
     </div>
     <div class="panel lbpanel">
       <div class="row" style="justify-content:space-between"><h2>Leaderboard</h2></div>
       <div class="bigseg mini" id="crewSort"><button type="button" data-s="xp" aria-pressed="${crewSort==="xp"}">XP</button><button type="button" data-s="dials" aria-pressed="${crewSort==="dials"}">Calls</button><button type="button" data-s="appts" aria-pressed="${crewSort==="appts"}">Appts</button><button type="button" data-s="sales" aria-pressed="${crewSort==="sales"}">Sales</button></div>
       <ol class="lb">${board.map(([id,d,st],i)=>`<li data-prof="${esc(id)}" class="${id===myId?"me":""}"><span class="pos">${i+1}</span>${d.char?avatarSVG(d.char,36):`<span class="noav sm">${esc(handleOf(id)[0])}</span>`}<span class="nm"><b>${esc(handleOf(id))}</b><small>${rankName(st.xp)}</small></span><b class="num val">${st[sortKey].toLocaleString()}</b></li>`).join("")||`<li class="muted">No stats yet.</li>`}</ol>
     </div>
   </div>
   <div class="row" style="justify-content:space-between;margin:18px 0 10px"><h2>The crew</h2><span class="muted">${crew.size} member${crew.size===1?"":"s"}</span></div>
   <div class="crewgrid" id="crewGrid">${[...crew.entries()].sort((a,b)=>(b[1].stats?.xp||0)-(a[1].stats?.xp||0)).map(([id,d])=>{const st=Object.assign(emptyStats(),d.stats||{});return`
     <button class="ccard ${id===myId?"me":""}" data-prof="${esc(id)}"><i class="dot ${online(id)?"on":""}" data-online="${esc(id)}"></i>${d.char?avatarSVG(d.char,120):`<span class="noavbig sm">?</span>`}
      <b>${esc(handleOf(id))}${id===myId?" (you)":""}</b><small class="muted">${esc(nameCache[id]&&d.handle?nameCache[id]:"")||"&nbsp;"}</small>
      <span class="rk">${rankName(st.xp)} · ${st.xp.toLocaleString()} XP</span>
      <span class="mini3"><span><b class="num">${st.dials}</b>calls</span><span><b class="num">${st.appts}</b>appts</span><span><b class="num">${st.sales}</b>sales</span></span>
      <span class="achs">${achRow(d,6)||'<span class="muted" style="font-size:11.5px">No badges yet</span>'}</span></button>`}).join("")||`<p class="muted">No one has joined yet. Create your character to be first on the board.</p>`}</div>`;
  $("#crewEdit").onclick=openCreator;$("#crewMine").onclick=()=>openProfile(myId);
  $$("#crewSort button").forEach(b=>b.onclick=()=>{crewSort=b.dataset.s;renderCrew()});
  root.querySelectorAll("[data-prof]").forEach(b=>b.onclick=()=>openProfile(b.dataset.prof));
  renderOnline();
}
const propsAt={};
function openProfile(id){const d=crew.get(id)||(id===myId?myDoc:null);if(!d&&id!==myId){toast("This crew member hasn't set up a profile yet");return}
  const dd=d||{};const st=Object.assign(emptyStats(),dd.stats||{});const p=peerOf(id);
  const b=openWin("prof",{title:"Crew profile",sub:handleOf(id),w:560,h:720});
  b.innerHTML=`<div class="profhead">${dd.char?avatarSVG(dd.char,150):`<span class="noavbig">?</span>`}<div><h2 style="margin:0">${esc(handleOf(id))}</h2>${nameCache[id]&&dd.handle?`<div class="muted">${esc(nameCache[id])}</div>`:""}<div class="rankline">${WINGS}<b>${rankName(st.xp)}</b><span class="muted num">${st.xp.toLocaleString()} XP</span></div>${dd.motto?`<p class="motto">“${esc(dd.motto)}”</p>`:""}<div class="muted" style="font-size:12.5px">${p?`<i class="live"></i> ${esc(String(p.presence?.status||"Online"))}`:"Offline"}</div></div></div>
   <div class="sgrid">${statBox(st.dials,"Calls")}${statBox(st.appts,"Appointments")}${statBox(st.sales,"Sales")}${statBox(st.quotes,"Quotes saved")}${statBox(st.kept,"Appts kept")}${statBox(st.reviews,"Calls reviewed")}${statBox(st.wordWins,"Word wins")}${statBox(st.bjWins,"Blackjack wins")}${statBox(st.imports,"Lead imports")}</div>
   <span class="label">Achievements · ${Object.keys(dd.ach||{}).length} of ${CREW_ACH.length}</span>
   <div class="achgrid">${CREW_ACH.map(([k,n,desc,ic])=>{const t=(dd.ach||{})[k];return`<div class="achcard ${t?"got":""}"><span class="ach">${ic}</span><div><b>${esc(n)}</b><small>${esc(desc)}${t?` · ${new Date(t).toLocaleDateString()}`:""}</small></div></div>`}).join("")}</div>
   ${id!==myId&&roomApi?`<button class="btn primary wide" id="propsBtn">Send props 🔥</button>`:""}`;
  if($("#propsBtn"))$("#propsBtn").onclick=async()=>{if(Date.now()-(propsAt[id]||0)<15000){toast("Give it a few seconds before sending more props");return}propsAt[id]=Date.now();
    try{await roomApi.emit("props",{to:id});toast(`Props sent to ${handleOf(id)}`)}catch(e){toast(p?"Couldn't send props right now":`${handleOf(id)} needs to be online to get props`)}};
}
function openCreator(){if(!myId){toast("Sign in to create your character");return}
  const draft={char:{...AV_DEFAULT,...(myDoc?.char||avRandom())},handle:myDoc?.handle||"",motto:myDoc?.motto||""};let tab="Look";
  const b=openWin("creator",{title:"Character creator",sub:"Make it yours",w:Math.min(820,innerWidth-24),h:760});
  const groups={Look:[["skin","Skin tone","sw"],["mouth","Expression"],["brows","Brows"]],Hair:[["hair","Hair style"],["hairColor","Hair color","swh"],["face","Facial hair"]],Style:[["top","Outfit"],["topColor","Outfit color","swt"],["acc","Accessories"]],Extras:[["shades","Shades"],["hat","Headwear"],["bg","Background"]]};
  const draw=()=>{b.innerHTML=`<div class="creator"><div class="cprev"><div id="cpAv">${avatarSVG(draft.char,240)}</div><button class="btn" id="cpRand">🎲 Randomize</button></div>
     <div class="cctl"><label class="field"><span>Callsign (what the crew sees)</span><input id="cpHandle" maxlength="20" placeholder="e.g. Maverick" value="${esc(draft.handle)}"></label>
      <label class="field"><span>Motto (optional)</span><input id="cpMotto" maxlength="60" placeholder="e.g. Every no gets me closer to a yes" value="${esc(draft.motto)}"></label>
      <div class="bigseg mini" id="cpTabs">${Object.keys(groups).map(g=>`<button type="button" data-t="${g}" aria-pressed="${g===tab}">${g}</button>`).join("")}</div>
      <div class="cgroups">${groups[tab].map(([k,lab,sw])=>`<div class="cg"><span class="label">${lab}</span><div class="opts2">${(sw==="sw"?AV.skin.map((c,i)=>`<button type="button" class="swatch" data-k="${k}" data-val="${i}" aria-pressed="${draft.char[k]===i}" style="background:${c}" aria-label="Skin tone ${i+1}"></button>`):sw==="swh"?AV.hairColor.map((c,i)=>`<button type="button" class="swatch" data-k="${k}" data-val="${i}" aria-pressed="${draft.char[k]===i}" style="background:${c}" aria-label="Hair color ${i+1}"></button>`):sw==="swt"?AV.topColor.map((c,i)=>`<button type="button" class="swatch" data-k="${k}" data-val="${i}" aria-pressed="${draft.char[k]===i}" style="background:${c}" aria-label="Outfit color ${i+1}"></button>`):AV[k].map(v=>`<button type="button" class="chip2" data-k="${k}" data-val="${v}" aria-pressed="${draft.char[k]===v}">${AV_LABEL[v]||v}</button>`)).join("")}</div></div>`).join("")}</div>
      <button class="btn primary wide" id="cpSave">Save character</button><p class="muted" style="font-size:12px;margin:0">Your character, callsign, motto, stats and achievements are visible to everyone who can open this desk.</p></div></div>`;
    b.querySelectorAll("[data-k]").forEach(x=>x.onclick=()=>{const k=x.dataset.k;draft.char[k]=/^(skin|hairColor|topColor)$/.test(k)?+x.dataset.val:x.dataset.val;draft.handle=$("#cpHandle").value;draft.motto=$("#cpMotto").value;draw()});
    $$("#cpTabs button").forEach(x=>x.onclick=()=>{tab=x.dataset.t;draft.handle=$("#cpHandle").value;draft.motto=$("#cpMotto").value;draw()});
    $("#cpRand").onclick=()=>{draft.char=avRandom();draft.handle=$("#cpHandle").value;draft.motto=$("#cpMotto").value;draw()};
    $("#cpSave").onclick=async()=>{const h=$("#cpHandle").value.trim().replace(/\s+/g," "),m=$("#cpMotto").value.trim();
      if(h.length<2){toast("Pick a callsign with at least 2 characters");$("#cpHandle").focus();return}
      if(!/^[\p{L}\p{N} ._'-]+$/u.test(h)){toast("Callsigns can use letters, numbers, spaces and . _ ' -");return}
      if([...crew.entries()].some(([id,d])=>id!==myId&&(d.handle||"").toLowerCase()===h.toLowerCase())){toast("Someone on the crew already has that callsign");return}
      myDoc=Object.assign(myDoc||{stats:emptyStats(),ach:{},createdAt:Date.now()},{char:draft.char,handle:h,motto:m});crewCheckAch();
      clearTimeout(crewTimer);try{await (crewQ=crewQ.then(()=>crewCol.doc(myId).set({...myDoc,stats:myStats(),updatedAt:Date.now()})));toast("Character saved");closeWin("creator");renderCrew();renderRank()}catch(e){toast("Couldn't save: "+(e.message||e.code))}};
  };draw();
}

/* ===================== CREW AVATAR 2.0 (original soft-shaded style) ===================== */
const AV2={
 skin:["#FFE7D6","#FDDCC4","#F9D0B2","#F5C6A5","#F0BA94","#EAAE86","#E4A27A","#DC9A6E","#D48E63","#C98459","#BD784E","#B06C45","#A3623D","#955736","#874D2F","#7A4429","#6D3B23","#61331E","#552C1A","#4A2617","#F2C4A0","#E0B48F","#C9A27E","#B38E6D"],
 hairColor:["#14100E","#2B1D16","#3D2A1E","#55392A","#6E4A33","#8A5A3B","#A8703F","#C48A4A","#D9A65C","#E8C27A","#F2DCA6","#B5462F","#8C2F23","#C9C9D1","#F2F2F5","#FF4FA3","#3DF5FF","#B15CFF","#2E6BFF","#2FBF71"],
 eyeColor:["#3B2416","#6B4226","#8A6A3B","#4E7A3C","#3E7CB1","#6FA8DC","#7A7F87","#2B2B2B"],
 clothColor:["#FFFFFF","#F5E6C8","#FFD1EC","#FF4FA3","#FF2E88","#FF9E3D","#FFE45E","#2FBF71","#3DF5FF","#2E6BFF","#16295A","#B15CFF","#7A4AA0","#8C2F23","#1B1B26","#5A5F6E"],
 face:["oval","round","square","heart","long"],
 hair:["buzz","crop","fade","slick","quiff","spiky","curlytop","waves","afro","twists","locs","braids","bun","ponytail","bob","long","longwavy","mohawk","bald"],
 beard:["none","stubble","mustache","handlebar","goatee","soulpatch","chinstrap","circle","short","full"],
 eyes:["round","almond","sleepy","wide"],
 brows:["straight","arched","thick","thin","angled"],
 nose:["button","straight","wide","pointed"],
 mouth:["smile","grin","smirk","neutral","laugh"],
 glasses:["none","aviators","wayfarers","round","cateye","clear","visor"],
 hat:["none","cap","backcap","beanie","bucket","panama","headband"],
 top:["tee","tropical","polo","hoodie","blouse","turtleneck","buttondown","vneck"],
 outer:["none","suit","blazer","leather","bomber","denim"],
 acc:["none","chain","earrings","both"],
 bg:["sunset","neon","marina","skyline","palms","purple","pink","mint","navy"]
};
const AV2_LABEL={oval:"Oval",round:"Round",square:"Square",heart:"Heart",long:"Long",buzz:"Buzz",crop:"Crop",fade:"Fade",slick:"Slicked",quiff:"Quiff",spiky:"Spiky",curlytop:"Curly top",waves:"Waves",afro:"Afro",twists:"Twists",locs:"Locs",braids:"Braids",bun:"Top bun",ponytail:"Ponytail",bob:"Bob",long:"Long",longwavy:"Long wavy",mohawk:"Mohawk",bald:"Bald",
 none:"None",stubble:"Stubble",mustache:"Mustache",handlebar:"Handlebar",goatee:"Goatee",soulpatch:"Soul patch",chinstrap:"Chin strap",circle:"Circle",short:"Short beard",full:"Full beard",
 almond:"Almond",sleepy:"Relaxed",wide:"Wide",straight:"Straight",arched:"Arched",thick:"Thick",thin:"Thin",angled:"Angled",button:"Button",pointed:"Pointed",
 smile:"Smile",grin:"Grin",smirk:"Smirk",neutral:"Cool",laugh:"Laugh",aviators:"Aviators",wayfarers:"Wayfarers",cateye:"Cat-eye",clear:"Clear frames",visor:"Neon visor",
 cap:"Cap",backcap:"Backwards cap",beanie:"Beanie",bucket:"Bucket hat",panama:"Panama",headband:"Headband",
 tee:"Tee",tropical:"Tropical",polo:"Polo",hoodie:"Hoodie",blouse:"Blouse",turtleneck:"Turtleneck",buttondown:"Button-down",vneck:"V-neck",suit:"Pastel suit",blazer:"Blazer & tie",leather:"Leather",bomber:"Bomber",denim:"Denim",
 chain:"Gold chain",earrings:"Earrings",both:"Both",sunset:"Sunset",neon:"Neon",marina:"Marina",skyline:"Skyline",palms:"Palms",purple:"Purple haze",pink:"Pink",mint:"Mint",navy:"Navy"};
const AV2_DEF={v:2,skin:7,face:"oval",hair:"crop",hairColor:1,beard:"none",beardColor:1,eyes:"almond",eyeColor:0,brows:"straight",nose:"button",mouth:"smile",glasses:"none",hat:"none",hatColor:10,top:"tee",topColor:0,outer:"none",outerColor:3,acc:"none",bg:"sunset"};
function av2Migrate(c){if(!c)return{...AV2_DEF};if(c.v===2)return{...AV2_DEF,...c};
  const hmap={short:"crop",slick:"slick",buzz:"buzz",curly:"curlytop",waves:"waves",afro:"afro",long:"long",bob:"bob",ponytail:"ponytail",braids:"braids",mohawk:"mohawk",bald:"bald"};
  const tmap={tropical:["tropical","none"],suit:["tee","suit"],leather:["tee","leather"],polo:["polo","none"],blazer:["buttondown","blazer"],hoodie:["hoodie","none"],blouse:["blouse","none"],bomber:["tee","bomber"]};
  const cmap=[3,8,5,11,0,1,14,9,7,6];const t=tmap[c.top]||["tee","none"];
  return{...AV2_DEF,skin:Math.min(23,(c.skin||0)*2+1),hair:hmap[c.hair]||"crop",hairColor:[0,2,5,7,9,10,13,15,16,17][c.hairColor]??1,beard:{none:"none",stubble:"stubble",mustache:"mustache",goatee:"goatee",beard:"full"}[c.face]||"none",beardColor:[0,2,5,7,9,10,13,15,16,17][c.hairColor]??1,
   glasses:{none:"none",aviators:"aviators",wayfarers:"wayfarers",round:"round",visor:"visor"}[c.shades]||"none",hat:{none:"none",cap:"cap",backcap:"backcap",panama:"panama",headband:"headband"}[c.hat]||"none",hatColor:cmap[c.topColor]??10,
   top:t[0],outer:t[1],topColor:t[1]==="none"?(cmap[c.topColor]??0):0,outerColor:cmap[c.topColor]??3,acc:c.acc||"none",mouth:{smile:"smile",grin:"grin",smirk:"smirk",neutral:"neutral"}[c.mouth]||"smile",bg:c.bg||"sunset"}}
function av2Random(){const r=a=>a[Math.random()*a.length|0],ri=n=>Math.random()*n|0;const hc=ri(14);
  return{...AV2_DEF,skin:ri(24),face:r(AV2.face),hair:r(AV2.hair),hairColor:hc,beard:Math.random()<.4?r(AV2.beard):"none",beardColor:hc,eyes:r(AV2.eyes),eyeColor:ri(8),brows:r(AV2.brows),nose:r(AV2.nose),mouth:r(AV2.mouth),
   glasses:Math.random()<.45?r(AV2.glasses):"none",hat:Math.random()<.3?r(AV2.hat):"none",hatColor:ri(16),top:r(AV2.top),topColor:ri(16),outer:Math.random()<.45?r(AV2.outer):"none",outerColor:ri(16),acc:r(AV2.acc),bg:r(AV2.bg)}}
const sh2=(h,k)=>shade(h,k);
const FACE_P={oval:[44,.2,168],round:[48,0,162],square:[46,1,168],heart:[47,-.25,170],long:[41,.35,176]};
function facePath(f,c={}){let [hw,jw,ch]=FACE_P[f]||FACE_P.oval;hw+=7*(c.faceW||0);jw+=.75*(c.jawW||0);ch+=12*(c.chinL||0);const L=120-hw,R=120+hw,k=Math.max(.42,.62+jw*.25);
  return{d:`M${L} 110 C${L} 70 ${120-hw*.56} 56 120 56 C${120+hw*.56} 56 ${R} 70 ${R} 110 C${R} ${134+jw*14} ${120+hw*k} ${ch-5} 120 ${ch} C${120-hw*k} ${ch-5} ${L} ${134+jw*14} ${L} 110Z`,hw,ch}}
let av2N=0;
/* opts: {mannequin:true, focus:"hair"|"beard"|...} renders a neutral head preview for option tiles */
/* ---------- advanced creator helpers (sliders default to 0 = original look) ---------- */
function mix3(a,b,t){const p=h=>{const n=parseInt(String(h).slice(1),16);return[n>>16,n>>8&255,n&255]};const x=p(a),y=p(b);return"#"+x.map((v,i)=>Math.round(v+(y[i]-v)*t).toString(16).padStart(2,"0")).join("")}
function av3Resolve(c){return c}
function av3HairGrad(u,hc,hcL,hcD,c,M){const tip=!M&&c.dyeHex?c.dyeHex:hcD;return`<linearGradient id="${u}hr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hcL}"/><stop offset=".6" stop-color="${hc}"/><stop offset="1" stop-color="${tip}"/></linearGradient>`}
function av3EyeT(c,x,y,i){const t=(c.eyeTilt||0)*8*(i?-1:1);return`rotate(${t} ${x} ${y})`}
function av3Shadow(){return""}
function av3Liner(){return""}
function av3Pierce(){return""}
function av3Layers(){return{face:"",neck:"",pattern:""}}
function avatar2SVG(c0,size=200,opts={}){const c=av3Resolve(av2Migrate(c0));const u="b"+(++av2N);const M=!!opts.mannequin;
  const sk=M?"#E9ECF2":(c.skinHex||AV2.skin[c.skin]||AV2.skin[7]),skL=sh2(sk,.22),skD=sh2(sk,-.18),skDD=sh2(sk,-.32);
  const hc=c.hairHex||(AV2.hairColor[c.hairColor]??AV2.hairColor[1]),hcL=sh2(hc,.28),hcD=sh2(hc,-.3);
  const bc=c.beardHex||(AV2.hairColor[c.beardColor]??hc),bcD=sh2(bc,-.25);
  const tc=c.topHex||(AV2.clothColor[c.topColor]??"#fff"),tcD=sh2(tc,-.2),tcL=sh2(tc,.25),oc=c.outerHex||(AV2.clothColor[c.outerColor]??"#FF4FA3"),ocD=sh2(oc,-.22),ocL=sh2(oc,.22),htc=c.hatHex||(AV2.clothColor[c.hatColor]??"#16295A"),htD=sh2(htc,-.22);
  const F=facePath(c.face,c);const hw=F.hw,ch=F.ch;
  const show=k=>!M||opts.focus===k||(opts.focus==="haircolor"&&k==="hair")||(opts.focus==="beardcolor"&&k==="beard");
  /* ---------- defs ---------- */
  const bgs={sunset:["#2A0845","#C2185B","#FF9E3D"],neon:["#12051F","#3A0F5E","#0D3B5E"],marina:["#7FE7FF","#FFB3D9","#2E6BFF"],skyline:["#05030F","#1A0730","#2A0845"],palms:["#FF6F3C","#FF2E88","#5A0F6E"],purple:["#B15CFF","#5A1F8C","#1A0730"],pink:["#FFD1EC","#FF8CC6","#FF4FA3"],mint:["#D6FFF6","#8EF0DA","#3DBFA6"],navy:["#2E4A8C","#16295A","#0A1533"],custom:[c.bgHex1||"#12051F",mix3(c.bgHex1||"#12051F",c.bgHex2||"#FF2E88",.55),c.bgHex2||"#FF2E88"]}[c.bg]||["#2A0845","#C2185B","#FF9E3D"];
  const defs=`<defs>
   <linearGradient id="${u}bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bgs[0]}"/><stop offset=".6" stop-color="${bgs[1]}"/><stop offset="1" stop-color="${bgs[2]}"/></linearGradient>
   <radialGradient id="${u}sk" cx=".42" cy=".36" r=".75"><stop offset="0" stop-color="${skL}"/><stop offset=".55" stop-color="${sk}"/><stop offset="1" stop-color="${skD}"/></radialGradient>
   <linearGradient id="${u}nk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${skDD}"/><stop offset=".45" stop-color="${skD}"/><stop offset="1" stop-color="${sk}"/></linearGradient>
   ${av3HairGrad(u,hc,hcL,hcD,c,M)}
   <linearGradient id="${u}tp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tcL}"/><stop offset="1" stop-color="${tcD}"/></linearGradient>
   <linearGradient id="${u}ot" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${ocL}"/><stop offset="1" stop-color="${ocD}"/></linearGradient>
   <linearGradient id="${u}gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF4FA3"/><stop offset=".5" stop-color="#B15CFF"/><stop offset="1" stop-color="#FF2E88"/></linearGradient>
   <linearGradient id="${u}dk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A2A36"/><stop offset="1" stop-color="#08080C"/></linearGradient>
   <clipPath id="${u}cl"><rect width="240" height="264" rx="34"/></clipPath><clipPath id="${u}fc"><path d="${F.d}"/></clipPath></defs>`;
  const hairF=`url(#${u}hr)`;
  /* ---------- background ---------- */
  const deco={sunset:`<circle cx="120" cy="196" r="62" fill="#FF9E3D" opacity=".6"/><g fill="${bgs[1]}" opacity=".5"><rect y="196" width="240" height="5"/><rect y="208" width="240" height="7"/><rect y="222" width="240" height="9"/></g>`,
   neon:`<g fill="none" stroke-width="3" opacity=".6"><rect x="20" y="30" width="58" height="22" rx="11" stroke="#FF4FA3"/><path d="M190 22 l5 12 l13 1 l-10 8 l4 13 l-12 -7 l-12 7 l4 -13 l-10 -8 l13 -1z" stroke="#FFD1EC"/></g>`,
   skyline:`<g fill="#0B0618">${[[0,120,30],[28,96,26],[52,140,30],[176,110,28],[200,86,40]].map(([x,y,w])=>`<rect x="${x}" y="${y}" width="${w}" height="${264-y}"/>`).join("")}</g><g fill="#FF9E3D" opacity=".75">${Array.from({length:18},(_,i)=>`<rect x="${[6,14,34,40,58,66,182,190,206,214,224][i%11]}" y="${100+(i*17)%120}" width="3" height="4"/>`).join("")}</g>`,
   palms:`<g fill="#2A0845" opacity=".8"><path d="M30 264 C32 210 38 176 46 148 l5 1 C44 178 40 212 40 264Z"/><path d="M46 148 c-16 -12 -34 -10 -46 0 c14 -8 30 -8 46 0z M48 148 c8 -16 24 -26 40 -24 c-14 6 -28 12 -40 24z"/><path d="M210 264 C208 214 204 182 196 156 l-5 1 C198 184 200 214 200 264Z"/><path d="M194 156 c16 -12 34 -10 46 0 c-14 -8 -30 -8 -46 0z M192 156 c-8 -16 -24 -26 -40 -24 c14 6 28 12 40 24z"/></g>`,
   marina:`<rect y="190" width="240" height="74" fill="#2E6BFF" opacity=".45"/><g fill="#fff" opacity=".75"><path d="M28 182 l24 -44 v44z"/><path d="M184 176 l20 -36 v36z"/></g>`}[c.bg]||"";
  /* ---------- hair (back layer) ---------- */
  const back={long:`<path d="M${120-hw-8} 108 C${120-hw-14} 170 ${120-hw-4} 214 ${120-hw+16} 230 L${120+hw-16} 230 C${120+hw+4} 214 ${120+hw+14} 170 ${120+hw+8} 108 C${120+hw+4} 66 150 46 120 46 C90 46 ${120-hw-4} 66 ${120-hw-8} 108Z" fill="${hairF}"/>`,
   longwavy:`<path d="M${120-hw-10} 106 C${120-hw-24} 140 ${120-hw-2} 160 ${120-hw-18} 190 C${120-hw-8} 214 ${120-hw+8} 226 ${120-hw+22} 232 L${120+hw-22} 232 C${120+hw-8} 226 ${120+hw+8} 214 ${120+hw+18} 190 C${120+hw+2} 160 ${120+hw+24} 140 ${120+hw+10} 106 C${120+hw+4} 64 150 44 120 44 C90 44 ${120-hw-4} 64 ${120-hw-10} 106Z" fill="${hairF}"/>`,
   bob:`<path d="M${120-hw-8} 108 C${120-hw-12} 152 ${120-hw-4} 172 ${120-hw+10} 176 L${120+hw-10} 176 C${120+hw+4} 172 ${120+hw+12} 152 ${120+hw+8} 108 C${120+hw+4} 64 150 46 120 46 C90 46 ${120-hw-4} 64 ${120-hw-8} 108Z" fill="${hairF}"/>`,
   afro:`<circle cx="120" cy="92" r="${hw+30}" fill="${hairF}"/>`,
   locs:`<g fill="${hairF}">${[-36,-26,-16,16,26,36].map((dx,i)=>`<rect x="${120+dx*1.05-6}" y="96" width="12" height="${118+(i%2)*14}" rx="6"/>`).join("")}</g>`,
   braids:`<g fill="${hairF}">${[-40,-30,30,40].map(dx=>`<rect x="${120+dx-6}" y="92" width="12" height="124" rx="6"/>`).join("")}</g><g fill="${hcD}" opacity=".5">${[-40,-30,30,40].map(dx=>Array.from({length:8},(_,k)=>`<rect x="${120+dx-6}" y="${100+k*15}" width="12" height="2"/>`).join("")).join("")}</g>`,
   ponytail:`<path d="M${120+hw-6} 80 C${120+hw+30} 86 ${120+hw+34} 138 ${120+hw+16} 178 C${120+hw+12} 148 ${120+hw+4} 116 ${120+hw-10} 100Z" fill="${hairF}"/>`}[c.hair]||"";
  /* ---------- hair (front) ---------- */
  const L=120-hw,R=120+hw;
  const cap=(top,side)=>`M${L-2} ${side} C${L-4} ${top+24} ${120-hw*.6} ${top} 120 ${top} C${120+hw*.6} ${top} ${R+4} ${top+24} ${R+2} ${side}`;
  const front={
   buzz:`<path d="${cap(58,100)} C${R-6} 84 ${120+hw*.5} 74 120 74 C${120-hw*.5} 74 ${L+6} 84 ${L-2} 100Z" fill="${hairF}" opacity=".9"/><path d="${cap(58,100)}" fill="none" stroke="${hcD}" stroke-opacity=".25" stroke-dasharray="1 2.5" stroke-width="6"/>`,
   crop:`<path d="${cap(50,104)} C${R-4} 84 ${120+hw*.4} 76 120 78 C${120-hw*.3} 80 ${L+10} 74 ${L-2} 104Z" fill="${hairF}"/><path d="M${L+8} 80 C${L+24} 66 ${120} 62 ${R-14} 70" stroke="${hcL}" stroke-width="2.5" fill="none" opacity=".6" stroke-linecap="round"/>`,
   fade:`<path d="${cap(50,96)} C${R-6} 80 ${120+hw*.4} 72 120 72 C${120-hw*.4} 72 ${L+6} 80 ${L-2} 96Z" fill="${hairF}"/><path d="M${L-2} 96 C${L-2} 110 ${L} 118 ${L+2} 124 M${R+2} 96 C${R+2} 110 ${R} 118 ${R-2} 124" stroke="${hc}" stroke-opacity=".35" stroke-width="5"/>`,
   slick:`<path d="${cap(46,102)} C${R-4} 76 ${120+hw*.3} 66 ${120-6} 68 C${120-hw*.5} 70 ${L+8} 80 ${L-2} 102Z" fill="${hairF}"/><g stroke="${hcL}" stroke-width="2" fill="none" opacity=".55" stroke-linecap="round"><path d="M${L+12} 76 C${120-10} 56 ${R-20} 56 ${R-6} 72"/><path d="M${L+20} 84 C${120} 64 ${R-24} 64 ${R-10} 80"/></g>`,
   quiff:`<path d="${cap(44,100)} C${R-4} 80 ${120+hw*.5} 74 120 76 C${120-hw*.4} 74 ${L+6} 82 ${L-2} 100Z" fill="${hairF}"/><path d="M${L+10} 70 C${L+14} 36 ${R-4} 26 ${R+2} 54 C${R-10} 44 ${120} 44 ${L+10} 70Z" fill="${hairF}"/><path d="M${L+20} 56 C${120} 34 ${R-14} 36 ${R-4} 50" stroke="${hcL}" stroke-width="2.4" fill="none" opacity=".6"/>`,
   spiky:`<path d="${cap(56,100)} C${R-4} 82 ${120+hw*.4} 76 120 76 C${120-hw*.4} 76 ${L+4} 82 ${L-2} 100Z" fill="${hairF}"/><path d="M${L+2} 74 L${L+6} 46 L${L+18} 62 L${L+24} 34 L${120-6} 56 L${120+4} 28 L${120+14} 54 L${R-18} 32 L${R-10} 60 L${R+2} 44 L${R+2} 76Z" fill="${hairF}"/>`,
   curlytop:`<path d="${cap(60,100)} C${R-4} 86 ${120} 80 ${L-2} 100Z" fill="${hairF}"/><g fill="${hairF}">${[[-36,74],[-26,60],[-12,52],[4,48],[20,52],[32,60],[40,72],[-20,68],[10,64],[-4,64],[26,70]].map(([dx,y])=>`<circle cx="${120+dx}" cy="${y}" r="12"/>`).join("")}</g><g fill="${hcL}" opacity=".35">${[[-26,56],[4,44],[30,56]].map(([dx,y])=>`<circle cx="${120+dx}" cy="${y}" r="4"/>`).join("")}</g>`,
   waves:`<path d="${cap(52,98)} C${R-6} 80 ${120+hw*.4} 74 120 74 C${120-hw*.4} 74 ${L+6} 80 ${L-2} 98Z" fill="${hairF}"/><g stroke="${hcL}" stroke-width="1.8" fill="none" opacity=".55"><path d="M${L+8} 74 q7 -5 14 0 q7 5 14 0 q7 -5 14 0 q7 5 14 0 q7 -5 14 0"/><path d="M${L+14} 64 q7 -5 14 0 q7 5 14 0 q7 -5 14 0 q7 5 14 0"/></g>`,
   afro:`<path d="M${L} 100 C${L} 82 ${120-hw*.4} 74 120 74 C${120+hw*.4} 74 ${R} 82 ${R} 100 C${R} 90 ${120} 84 ${L} 100Z" fill="${hairF}"/>`,
   twists:`<path d="${cap(54,100)} C${R-4} 84 ${120} 78 ${L-2} 100Z" fill="${hairF}"/><g fill="${hairF}">${[-38,-28,-18,-8,2,12,22,32,40].map((dx,i)=>`<rect x="${120+dx-5}" y="${40+(i%2)*6}" width="10" height="${30}" rx="5" transform="rotate(${dx*.5} ${120+dx} 60)"/>`).join("")}</g>`,
   locs:`<path d="${cap(50,100)} C${R-4} 82 ${120} 76 ${L-2} 100Z" fill="${hairF}"/><g fill="${hairF}">${[-30,-18,-6,6,18,30].map(dx=>`<rect x="${120+dx-6}" y="60" width="12" height="${46}" rx="6"/>`).join("")}</g>`,
   braids:`<path d="${cap(54,100)} C${R-4} 84 ${120} 80 ${L-2} 100Z" fill="${hairF}"/><g stroke="${hcL}" stroke-width="1.6" opacity=".5">${[-30,-15,0,15,30].map(dx=>`<path d="M${120+dx} 58 V84"/>`).join("")}</g>`,
   bun:`<circle cx="120" cy="40" r="20" fill="${hairF}"/><path d="${cap(54,100)} C${R-4} 82 ${120} 76 ${L-2} 100Z" fill="${hairF}"/><path d="M${L+10} 78 C${120-10} 62 ${R-20} 62 ${R-8} 74" stroke="${hcL}" stroke-width="2" fill="none" opacity=".5"/>`,
   ponytail:`<path d="${cap(52,100)} C${R-4} 80 ${120+hw*.3} 72 120 74 C${120-hw*.3} 72 ${L+6} 82 ${L-2} 100Z" fill="${hairF}"/><path d="M${L+10} 76 C${120-10} 60 ${R-20} 60 ${R-8} 72" stroke="${hcL}" stroke-width="2" fill="none" opacity=".5"/>`,
   bob:`<path d="${cap(48,106)} C${R-2} 88 ${120+hw*.2} 74 ${120-12} 76 C${120-hw*.6} 80 ${L+4} 92 ${L-4} 112Z" fill="${hairF}"/>`,
   long:`<path d="${cap(48,108)} C${R-2} 86 ${120+hw*.3} 74 ${120+4} 74 C${120-hw*.4} 76 ${L+4} 90 ${L-4} 116Z" fill="${hairF}"/><path d="M${120+2} 52 C${120+8} 64 ${120+6} 72 ${120+4} 76" stroke="${hcD}" stroke-width="1.6" fill="none" opacity=".5"/>`,
   longwavy:`<path d="${cap(46,108)} C${R-2} 84 ${120+hw*.3} 72 ${120} 74 C${120-hw*.3} 72 ${L+2} 86 ${L-4} 110Z" fill="${hairF}"/>`,
   mohawk:`<path d="M${120-10} 82 C${120-12} 46 ${120-6} 22 120 16 C${120+6} 22 ${120+12} 46 ${120+10} 82Z" fill="${hairF}"/><path d="${cap(58,98)} C${R-6} 86 ${120} 82 ${L-2} 98Z" fill="${hc}" opacity=".35"/>`,
   bald:`<path d="M${120-22} 70 C${120-10} 64 ${120+10} 64 ${120+22} 70" stroke="#fff" stroke-width="4" fill="none" opacity=".3" stroke-linecap="round"/>`}[c.hair]||"";
  /* ---------- face features ---------- */
  const EY=114+5*(c.eyeY||0),EX=19+4*(c.eyeX||0);
  const eyeRy={round:7.4,almond:6.2,sleepy:5,wide:8.4}[c.eyes]||6.2;const ic=c.eyeHex||AV2.eyeColor[c.eyeColor]||AV2.eyeColor[0],ic2=c.hetero?(c.eye2Hex||"#3E7CB1"):ic;
  const eye=x=>c.eyes==="almond"?`<path d="M${x-10} ${EY} Q${x} ${EY-eyeRy*1.5} ${x+10} ${EY} Q${x} ${EY+eyeRy*1.2} ${x-10} ${EY}Z" fill="#fff"/>`:`<ellipse cx="${x}" cy="${EY}" rx="9.6" ry="${eyeRy}" fill="#fff"/>`;
  const eyes=[120-EX,120+EX].map((x,i)=>`<g transform="${av3EyeT(c,x,EY,i)}">${M?"":av3Shadow(c,x,EY,i)}${eye(x)}<circle cx="${x+.6}" cy="${EY+.4}" r="5.4" fill="${i?ic2:ic}"/><circle cx="${x+.6}" cy="${EY+.4}" r="2.7" fill="#0B0B10"/><circle cx="${x+2.4}" cy="${EY-1.8}" r="1.6" fill="#fff"/>
     <path d="M${x-10.5} ${EY-(c.eyes==="sleepy"?1:eyeRy*.55)} Q${x} ${EY-eyeRy-(c.eyes==="sleepy"?-1.5:3)} ${x+10.5} ${EY-(c.eyes==="sleepy"?1:eyeRy*.55)}" stroke="#2A1A14" stroke-width="2.2" fill="${c.eyes==="sleepy"?skD:"none"}" stroke-linecap="round"/>${M?"":av3Liner(c,x,EY,i,eyeRy)}</g>`).join("");
  const bw=({straight:3,arched:3,thick:4.8,thin:1.8,angled:3.4}[c.brows]||3)*(1+.55*(c.browThick||0));const bcol=M?"#9AA0AC":(c.browHex||sh2(hc,-.08));
  const brow=(x,s)=>({straight:`M${x-11*s} 98 Q${x} 95 ${x+11*s} 97`,arched:`M${x-11*s} 100 Q${x-2*s} 90 ${x+11*s} 97`,thick:`M${x-12*s} 99 Q${x} 94 ${x+12*s} 97`,thin:`M${x-10*s} 98 Q${x} 94 ${x+10*s} 97`,angled:`M${x-11*s} 101 L${x+3*s} 93 L${x+11*s} 96`}[c.brows]||"");
  let brows=`<g stroke="${bcol}" stroke-width="${bw}" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${brow(120-EX,-1).replace(/M(\S+)/,"M$1")}"/><path d="${brow(120+EX,1)}"/></g>`;
  brows=`<g transform="translate(0 ${-4*(c.browY||0)})">${brows}${M?"":av3Pierce(c,"brow",EX,EY)}</g>`;
  let nose={button:`<path d="M116 136 Q120 140 124 136" stroke="${skDD}" stroke-width="2.2" fill="none" stroke-linecap="round"/><ellipse cx="120" cy="132" rx="5" ry="4" fill="${skL}" opacity=".5"/>`,
   straight:`<path d="M118 116 L116 134 Q120 138 124 135" stroke="${skDD}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
   wide:`<path d="M112 134 Q114 140 120 138 Q126 140 128 134" stroke="${skDD}" stroke-width="2.3" fill="none" stroke-linecap="round"/><path d="M118 118 Q114 128 114 132" stroke="${skD}" stroke-width="2" fill="none" opacity=".6"/>`,
   pointed:`<path d="M119 116 L114 135 Q118 137 124 134" stroke="${skDD}" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`}[c.nose];
  nose=`<g transform="translate(120 ${128+4*(c.noseY||0)}) scale(${1+.32*(c.noseW||0)} ${1+.3*(c.noseL||0)}) translate(-120 -128)">${nose}${M?"":av3Pierce(c,"nose")}</g>`;
  const lip=M?"#B9BFCB":(c.lipA>0?mix3(sh2(sk,-.38),c.lipHex||"#C2185B",Math.min(1,c.lipA)):sh2(sk,-.38));const MY=152;
  let mouth={smile:`<path d="M106 ${MY} Q120 ${MY+12} 134 ${MY}" stroke="${lip}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
   grin:`<path d="M104 ${MY-2} Q120 ${MY+16} 136 ${MY-2} Z" fill="#fff" stroke="${lip}" stroke-width="2.4" stroke-linejoin="round"/><path d="M108 ${MY+2} H132" stroke="#E6E6EE" stroke-width="1"/>`,
   smirk:`<path d="M108 ${MY+2} Q122 ${MY+6} 134 ${MY-4}" stroke="${lip}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
   neutral:`<path d="M109 ${MY+2} H131" stroke="${lip}" stroke-width="3" stroke-linecap="round"/>`,
   laugh:`<path d="M104 ${MY-3} Q120 ${MY+22} 136 ${MY-3} Z" fill="#5A1A24" stroke="${lip}" stroke-width="2.2" stroke-linejoin="round"/><path d="M110 ${MY+8} Q120 ${MY+14} 130 ${MY+8}" fill="#FF7A95"/><path d="M106 ${MY-2} H134 L132 ${MY+2} H108Z" fill="#fff"/>`}[c.mouth];
  mouth=`<g transform="translate(120 ${MY+4*(c.mouthY||0)}) scale(${1+.25*(c.mouthW||0)} ${1+.4*(c.lipFull||0)}) translate(-120 ${-MY})">${mouth}${M?"":av3Pierce(c,"lip",0,0,MY)}</g>`;
  /* ---------- beard ---------- */
  const beard={none:"",stubble:`<path d="M${L+4} 124 C${L+8} 156 ${120-14} ${ch} 120 ${ch} C${120+14} ${ch} ${R-8} 156 ${R-4} 124 C${R-10} 148 ${120+20} 162 120 162 C${120-20} 162 ${L+10} 148 ${L+4} 124Z" fill="${bc}" opacity=".28"/><path d="M106 146 Q120 141 134 146" stroke="${bc}" stroke-width="5" opacity=".2" stroke-linecap="round"/>`,
   mustache:`<path d="M104 146 C110 139 118 140 120 143 C122 140 130 139 136 146 C130 148 124 147 120 146 C116 147 110 148 104 146Z" fill="${bc}"/>`,
   handlebar:`<path d="M100 140 C98 146 102 149 106 147 C110 140 118 140 120 143 C122 140 130 140 134 147 C138 149 142 146 140 140 C140 146 136 146 134 144 C130 138 124 140 120 142 C116 140 110 138 106 144 C104 146 100 146 100 140Z" fill="${bc}"/>`,
   goatee:`<path d="M106 146 C112 141 118 142 120 144 C122 142 128 141 134 146 C128 148 112 148 106 146Z" fill="${bc}"/><path d="M110 162 C112 ${ch+2} 128 ${ch+2} 130 162 C126 166 114 166 110 162Z" fill="${bc}"/>`,
   soulpatch:`<path d="M115 160 Q120 168 125 160 Q120 163 115 160Z" fill="${bc}"/>`,
   chinstrap:`<path d="M${L+2} 116 C${L+4} 152 ${120-16} ${ch+2} 120 ${ch+2} C${120+16} ${ch+2} ${R-4} 152 ${R-2} 116 L${R-8} 118 C${R-10} 150 ${120+14} ${ch-6} 120 ${ch-6} C${120-14} ${ch-6} ${L+10} 150 ${L+8} 118Z" fill="${bc}"/>`,
   circle:`<path d="M104 146 C110 140 130 140 136 146 C138 160 130 ${ch} 120 ${ch} C110 ${ch} 102 160 104 146Z M110 150 C112 158 128 158 130 150 C126 156 114 156 110 150Z" fill="${bc}" fill-rule="evenodd"/>`,
   short:`<path d="M${L+4} 122 C${L+6} 158 ${120-18} ${ch+4} 120 ${ch+4} C${120+18} ${ch+4} ${R-6} 158 ${R-4} 122 C${R-10} 140 ${120+22} 156 ${120+12} 150 C${120+6} 146 ${120-6} 146 ${120-12} 150 C${120-22} 156 ${L+10} 140 ${L+4} 122Z" fill="${bc}"/><path d="M106 146 C112 141 118 142 120 144 C122 142 128 141 134 146 C128 148 112 148 106 146Z" fill="${bc}"/>`,
   full:`<path d="M${L} 116 C${L-2} 166 ${120-22} ${ch+14} 120 ${ch+14} C${120+22} ${ch+14} ${R+2} 166 ${R} 116 C${R-8} 140 ${120+24} 158 ${120+12} 150 C${120+6} 146 ${120-6} 146 ${120-12} 150 C${120-24} 158 ${L+8} 140 ${L} 116Z" fill="${bc}"/><path d="M104 146 C110 139 118 140 120 143 C122 140 130 139 136 146 C130 149 110 149 104 146Z" fill="${bcD}"/>`}[c.beard]||"";
  if(beard)beard=`<g opacity="${(.3+.7*(c.beardDensity??1)).toFixed(2)}">${beard}</g>`;
  /* ---------- glasses ---------- */
  let gl={none:"",aviators:`<g><path d="M${120-EX-13} 106 h22 c2 0 3 2 2 6 c-2 9 -7 13 -13 13 c-7 0 -12 -6 -12 -14 c0 -3 0 -5 1 -5z" fill="url(#${u}gl)" opacity=".92" stroke="#D9A441" stroke-width="1.6"/><path d="M${120+EX-9} 106 h22 c1 0 1 2 1 5 c0 8 -5 14 -12 14 c-6 0 -11 -4 -13 -13 c-1 -4 0 -6 2 -6z" fill="url(#${u}gl)" opacity=".92" stroke="#D9A441" stroke-width="1.6"/><path d="M114 108 q6 -4 12 0" stroke="#D9A441" stroke-width="1.8" fill="none"/><path d="M${120-EX-8} 110 l7 -2" stroke="#fff" stroke-width="1.6" opacity=".75"/></g>`,
   wayfarers:`<g fill="url(#${u}dk)"><path d="M${120-EX-14} 104 h30 v9 c0 7 -5 11 -14 11 c-9 0 -16 -4 -16 -11z"/><path d="M${120+EX-16} 104 h30 v9 c0 7 -7 11 -16 11 c-9 0 -14 -4 -14 -11z"/><rect x="114" y="105" width="12" height="4"/></g><path d="M${120-EX-9} 108 h8" stroke="#FFD1EC" stroke-width="1.8" opacity=".8"/>`,
   round:`<g fill="url(#${u}gl)" fill-opacity=".85" stroke="#E9D9B0" stroke-width="2"><circle cx="${120-EX}" cy="${EY}" r="11.5"/><circle cx="${120+EX}" cy="${EY}" r="11.5"/></g><path d="M112 112 q8 -4 16 0" stroke="#E9D9B0" stroke-width="2" fill="none"/>`,
   cateye:`<g fill="url(#${u}dk)" fill-opacity=".9"><path d="M${120-EX-14} 104 Q${120-EX} 100 ${120-EX+12} 106 Q${120-EX+10} 124 ${120-EX-2} 123 Q${120-EX-12} 120 ${120-EX-14} 104Z"/><path d="M${120+EX+14} 104 Q${120+EX} 100 ${120+EX-12} 106 Q${120+EX-10} 124 ${120+EX+2} 123 Q${120+EX+12} 120 ${120+EX+14} 104Z"/></g><path d="M116 108 q4 -3 8 0" stroke="#111" stroke-width="2.4" fill="none"/>`,
   clear:`<g fill="#fff" fill-opacity=".12" stroke="#1B1B26" stroke-width="2.4"><rect x="${120-EX-13}" y="104" width="26" height="20" rx="6"/><rect x="${120+EX-13}" y="104" width="26" height="20" rx="6"/></g><path d="M114 110 q6 -4 12 0" stroke="#1B1B26" stroke-width="2.4" fill="none"/>`,
   visor:`<path d="M${L+2} 104 C${120-20} 98 ${120+20} 98 ${R-2} 104 L${R-4} 122 C${120+20} 128 ${120-20} 128 ${L+4} 122Z" fill="url(#${u}gl)" opacity=".9" stroke="#fff" stroke-width="1"/><path d="M${L+10} 110 H${R-10}" stroke="#fff" stroke-width="1.4" opacity=".6"/>`}[c.glasses]||"";
  if(gl)gl=`<g transform="translate(0 ${EY-114})">${gl}</g>`;
  /* ---------- hats ---------- */
  const hat={none:"",cap:`<path d="M${L-4} 92 C${L-4} 56 ${120-20} 40 120 40 C${120+20} 40 ${R+4} 56 ${R+4} 92Z" fill="${htc}"/><path d="M${L-6} 92 H${R+40} C${R+40} 100 ${R+24} 102 ${R+10} 102 H${L-4}Z" fill="${htD}"/><circle cx="120" cy="42" r="4" fill="${sh2(htc,.3)}"/><path d="M${120-10} 44 V90 M${120+10} 44 V90" stroke="${htD}" stroke-width="1.5" opacity=".5"/>`,
   backcap:`<path d="M${L-4} 92 C${L-4} 56 ${120-20} 40 120 40 C${120+20} 40 ${R+4} 56 ${R+4} 92Z" fill="${htc}"/><path d="M${L-38} 94 H${L+8} L${L+4} 86 C${L-16} 86 ${L-30} 88 ${L-38} 94Z" fill="${htD}"/><rect x="${120-14}" y="84" width="28" height="7" rx="3.5" fill="${sh2(htc,.3)}"/>`,
   beanie:`<path d="M${L-4} 96 C${L-6} 52 ${120-22} 34 120 34 C${120+22} 34 ${R+6} 52 ${R+4} 96Z" fill="${htc}"/><rect x="${L-6}" y="84" width="${hw*2+12}" height="16" rx="8" fill="${htD}"/><g stroke="${sh2(htc,.2)}" stroke-width="2" opacity=".5">${[-28,-14,0,14,28].map(dx=>`<path d="M${120+dx} 40 V82"/>`).join("")}</g>`,
   bucket:`<path d="M${L-2} 88 C${L} 54 ${120-18} 44 120 44 C${120+18} 44 ${R} 54 ${R+2} 88Z" fill="${htc}"/><path d="M${L-20} 98 C${L-10} 84 ${R+10} 84 ${R+20} 98 C${R} 92 ${L} 92 ${L-20} 98Z" fill="${htD}"/>`,
   panama:`<ellipse cx="120" cy="80" rx="${hw+34}" ry="12" fill="#F5E6C8"/><path d="M${L+6} 80 C${L+6} 46 ${120-16} 38 120 38 C${120+16} 38 ${R-6} 46 ${R-6} 80Z" fill="#F5E6C8"/><rect x="${L+6}" y="68" width="${(hw-6)*2}" height="9" fill="${htc}"/><path d="M${L+12} 50 C${120} 40 ${R-12} 50 ${R-12} 50" stroke="#fff" stroke-width="2" opacity=".5" fill="none"/>`,
   headband:`<rect x="${L-2}" y="84" width="${hw*2+4}" height="11" rx="5.5" fill="${htc}"/><rect x="${L-2}" y="86" width="${hw*2+4}" height="2.5" fill="#fff" opacity=".5"/>`}[c.hat]||"";
  /* ---------- body ---------- */
  const bodyBase=`M24 264 C28 214 66 196 120 196 C174 196 212 214 216 264Z`;
  const topArt={tee:`<path d="${bodyBase}" fill="url(#${u}tp)"/><path d="M98 198 Q120 214 142 198" stroke="${tcD}" stroke-width="5" fill="none"/>`,
   vneck:`<path d="${bodyBase}" fill="url(#${u}tp)"/><path d="M100 198 L120 230 L140 198" fill="url(#${u}nk)"/><path d="M100 198 L120 230 L140 198" stroke="${tcD}" stroke-width="4" fill="none"/>`,
   tropical:`<path d="${bodyBase}" fill="url(#${u}tp)"/><g fill="${tcD}" opacity=".7"><ellipse cx="60" cy="236" rx="16" ry="6" transform="rotate(-30 60 236)"/><ellipse cx="180" cy="230" rx="16" ry="6" transform="rotate(30 180 230)"/><ellipse cx="86" cy="254" rx="13" ry="5" transform="rotate(20 86 254)"/><ellipse cx="156" cy="256" rx="13" ry="5" transform="rotate(-25 156 256)"/></g><g fill="${tcL}"><circle cx="70" cy="216" r="5"/><circle cx="172" cy="212" r="5"/><circle cx="134" cy="246" r="4"/></g><path d="M120 196 L100 230 L108 198Z M120 196 L140 230 L132 198Z" fill="${tcL}"/><path d="M120 200 V264" stroke="${tcD}" stroke-width="2"/>`,
   polo:`<path d="${bodyBase}" fill="url(#${u}tp)"/><path d="M102 196 L120 212 L138 196 L146 208 L120 216 L94 208Z" fill="${tcL}"/><path d="M120 214 V240" stroke="${tcD}" stroke-width="2.4"/><circle cx="120" cy="224" r="2" fill="${tcD}"/><circle cx="120" cy="234" r="2" fill="${tcD}"/>`,
   hoodie:`<path d="${bodyBase}" fill="url(#${u}tp)"/><path d="M84 200 C90 184 150 184 156 200 C146 218 94 218 84 200Z" fill="${tcD}"/><path d="M110 212 V244 M130 212 V244" stroke="${tcL}" stroke-width="3" stroke-linecap="round"/><rect x="88" y="246" width="64" height="18" rx="7" fill="${tcD}" opacity=".5"/>`,
   blouse:`<path d="${bodyBase}" fill="url(#${u}tp)"/><path d="M100 198 L120 228 L140 198" fill="url(#${u}nk)"/><path d="M98 198 C104 214 112 222 120 228 C128 222 136 214 142 198" stroke="${tcL}" stroke-width="5" fill="none"/>`,
   turtleneck:`<path d="${bodyBase}" fill="url(#${u}tp)"/><rect x="100" y="180" width="40" height="26" rx="10" fill="${tc}"/><g stroke="${tcD}" stroke-width="2" opacity=".5"><path d="M102 186 H138 M102 192 H138 M102 198 H138"/></g>`,
   buttondown:`<path d="${bodyBase}" fill="url(#${u}tp)"/><path d="M104 196 L120 212 L112 216Z M136 196 L120 212 L128 216Z" fill="${tcL}" stroke="${tcD}" stroke-width="1"/><path d="M120 212 V264" stroke="${tcD}" stroke-width="2"/>${[224,238,252].map(y=>`<circle cx="124" cy="${y}" r="1.8" fill="${tcD}"/>`).join("")}`}[c.top]||"";
  const outer={none:"",suit:`<path d="M24 264 C28 214 66 196 104 196 L120 264Z M216 264 C212 214 174 196 136 196 L120 264Z" fill="url(#${u}ot)"/><path d="M104 196 L92 214 L118 254Z M136 196 L148 214 L122 254Z" fill="${ocD}"/>`,
   blazer:`<path d="M24 264 C28 214 66 196 104 196 L120 264Z M216 264 C212 214 174 196 136 196 L120 264Z" fill="url(#${u}ot)"/><path d="M104 196 L92 214 L118 254Z M136 196 L148 214 L122 254Z" fill="${ocD}"/><path d="M115 206 L125 206 L128 246 L120 258 L112 246Z" fill="${oc===AV2.clothColor[3]?"#3DF5FF":"#FF2E88"}"/>`,
   leather:`<path d="M24 264 C28 214 66 196 106 196 L116 264Z M216 264 C212 214 174 196 134 196 L124 264Z" fill="#1E1A26"/><path d="M106 196 L90 210 L104 232 L116 216Z M134 196 L150 210 L136 232 L124 216Z" fill="#2E2838"/><path d="M118 222 V264" stroke="#B9B9C2" stroke-width="2"/>`,
   bomber:`<path d="M24 264 C28 214 66 196 108 196 L118 264Z M216 264 C212 214 174 196 132 196 L122 264Z" fill="url(#${u}ot)"/><path d="M94 198 C102 190 138 190 146 198 L142 208 C132 202 108 202 98 208Z" fill="#1E1A26"/><g fill="${ocD}"><rect x="54" y="246" width="22" height="5" rx="2.5"/><rect x="164" y="246" width="22" height="5" rx="2.5"/></g>`,
   denim:`<path d="M24 264 C28 214 66 196 106 196 L116 264Z M216 264 C212 214 174 196 134 196 L124 264Z" fill="#4E73B8"/><path d="M106 196 L94 212 L112 222Z M134 196 L146 212 L128 222Z" fill="#3D5E9C"/><g stroke="#E9C25A" stroke-width="1.2" stroke-dasharray="2 2" fill="none"><path d="M60 232 H96 M144 232 H180"/></g><rect x="66" y="236" width="24" height="16" rx="3" fill="#3D5E9C"/><rect x="150" y="236" width="24" height="16" rx="3" fill="#3D5E9C"/>`}[c.outer]||"";
  const chain=(c.acc==="chain"||c.acc==="both")?`<path d="M100 200 C106 226 134 226 140 200" stroke="#E9C25A" stroke-width="3" fill="none" stroke-dasharray="3.5 1.6"/><circle cx="120" cy="222" r="4.5" fill="#E9C25A"/>`:"";
  const earr=(c.acc==="earrings"||c.acc==="both")?`<circle cx="${L-2}" cy="132" r="3.4" fill="#E9C25A"/><circle cx="${R+2}" cy="132" r="3.4" fill="#E9C25A"/>`:"";
  /* ---------- assemble ---------- */
  const eS=1+.3*(c.earSize||0),blC=c.blushHex||"#FF6F9C",blA=(.18+.5*(c.blushA||0)).toFixed(2);
  const head=`<ellipse cx="${L-1}" cy="116" rx="${8.5*eS}" ry="${13*eS}" fill="${skD}"/><ellipse cx="${R+1}" cy="116" rx="${8.5*eS}" ry="${13*eS}" fill="${skD}"/><ellipse cx="${L}" cy="116" rx="${4*eS}" ry="${7*eS}" fill="${skDD}" opacity=".4"/><ellipse cx="${R}" cy="116" rx="${4*eS}" ry="${7*eS}" fill="${skDD}" opacity=".4"/>
    <path d="${F.d}" fill="url(#${u}sk)"/>
    <g clip-path="url(#${u}fc)"><ellipse cx="120" cy="${ch+10}" rx="${hw}" ry="18" fill="${skD}" opacity=".35"/></g>
    ${M?"":`<ellipse cx="${120-30}" cy="136" rx="9" ry="5" fill="${blC}" opacity="${blA}"/><ellipse cx="${120+30}" cy="136" rx="9" ry="5" fill="${blC}" opacity="${blA}"/>`}`;
  const L3=av3Layers(c,u,{F,EY,EX,MY,sk,skL,skD,skDD,L,R,hw,ch,tc,M,bodyBase});
  const featuresAll=`${show("beard")?beard:""}${show("eyes")||!M?eyes:""}${show("brows")||!M?brows:""}${show("nose")||!M?nose:""}${show("mouth")||!M?mouth:""}`;
  if(M){const f=opts.focus;
    const body=f==="top"||f==="outer"||f==="acc"?`${topArt}${outer}${chain}`:`<path d="${bodyBase}" fill="#DADFE8"/>`;
    return`<svg viewBox="0 0 240 264" width="${size}" height="${size*1.1}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${defs}
     ${(f==="hair"||f==="haircolor")?back:""}<rect x="104" y="150" width="32" height="56" rx="12" fill="#D3D8E2"/>${body}${head}
     ${(f==="eyes"||f==="eyecolor")?eyes:""}${f==="brows"?brows:""}${f==="nose"?nose:""}${f==="mouth"?mouth:""}${(f==="beard"||f==="beardcolor")?beard:""}
     ${["paint","mole","scar","pierce","liner"].includes(f)?L3.face+eyes+brows+nose+mouth:""}${f==="neck"?L3.neck:""}${f==="pattern"?topArt+L3.pattern:""}${(f==="hair"||f==="haircolor")?front:""}${f==="glasses"?gl:""}${f==="hat"?hat:""}${f==="acc"?earr:""}</svg>`}
  return`<svg viewBox="0 0 240 264" width="${size}" height="${size*1.1}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Crew character">${defs}
   <g clip-path="url(#${u}cl)"><rect width="240" height="264" fill="url(#${u}bg)"/>${deco}${back}
   <g transform="translate(120 264) scale(${(1+.14*(c.build||0)).toFixed(3)} 1) translate(-120 -264)"><rect x="${120-16*(1+.28*(c.neckW||0))}" y="150" width="${32*(1+.28*(c.neckW||0))}" height="58" rx="12" fill="url(#${u}nk)"/>${L3.neck}${topArt}${L3.pattern}${outer}${chain}</g>
   ${head}${L3.face}${beard}${eyes}${brows}${nose}${mouth}${front}${gl}${hat}${earr}</g></svg>`;
}

/* ---------- crop support for tiles ---------- */
const _av2=avatar2SVG;
avatar2SVG=function(c,size,opts={}){let s=_av2(c,size,opts);if(opts.crop){const vb={face:"62 40 116 134",head:"40 8 160 176",body:"10 120 220 144",full:"0 0 240 264"}[opts.crop];s=s.replace('viewBox="0 0 240 264"',`viewBox="${vb}"`).replace(/width="[\d.]+" height="[\d.]+"/,`width="${size}" height="${size}"`)}return s};
avatarSVG=function(c,size){return window.hpAvatar?window.hpAvatar.render(c,size):avatar2SVG(c,size)};
/* ---------- creator sheet ---------- */
const CI=p=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
const CR_CATS=[
 {id:"skin",label:"Skin & face",icon:CI('<path d="M12 3a7 8 0 1 0 0 16a7 8 0 0 0 0-16z"/><path d="M12 3c-3 4-3 12 0 16" opacity=".5"/>'),subs:[["Skin tone","skin","skin"],["Face shape","face","opts","head"]]},
 {id:"hair",label:"Hair",icon:CI('<path d="M5 13c0-5 3-9 7-9s7 4 7 9"/><path d="M5 13c2-3 5-4 7-4s5 1 7 4"/><path d="M7 13v5M17 13v5"/>'),subs:[["Hairstyle","hair","opts","head","hair"],["Hair color","hairColor","hair"]]},
 {id:"beard",label:"Facial hair",icon:CI('<path d="M6 11c0 6 3 9 6 9s6-3 6-9"/><path d="M8 13c2-1.5 6-1.5 8 0"/>'),subs:[["Facial hair","beard","opts","face","beard"],["Facial hair color","beardColor","hair"]]},
 {id:"eyes",label:"Eyes",icon:CI('<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),subs:[["Eye shape","eyes","opts","face","eyes"],["Eye color","eyeColor","eye"]]},
 {id:"brows",label:"Brows",icon:CI('<path d="M3 12c4-4 10-5 18-2"/>'),subs:[["Brows","brows","opts","face","brows"]]},
 {id:"nose",label:"Nose",icon:CI('<path d="M12 4v10l-3 3c2 2 5 2 6 0"/>'),subs:[["Nose","nose","opts","face","nose"]]},
 {id:"mouth",label:"Expression",icon:CI('<path d="M5 13c3 4 11 4 14 0"/>'),subs:[["Expression","mouth","opts","face","mouth"]]},
 {id:"glasses",label:"Glasses",icon:CI('<circle cx="6.5" cy="13" r="3.5"/><circle cx="17.5" cy="13" r="3.5"/><path d="M10 13h4"/>'),subs:[["Glasses","glasses","opts","head","glasses"]]},
 {id:"hat",label:"Headwear",icon:CI('<path d="M4 15c0-6 3-9 8-9s8 3 8 9z"/><path d="M2 15h20"/>'),subs:[["Headwear","hat","opts","head","hat"],["Headwear color","hatColor","cloth"]]},
 {id:"top",label:"Tops",icon:CI('<path d="M8 4l-5 4 3 3 2-2v11h8V9l2 2 3-3-5-4c-1 2-2 3-4 3S9 6 8 4z"/>'),subs:[["Top","top","opts","body","top"],["Top color","topColor","cloth"]]},
 {id:"outer",label:"Jackets",icon:CI('<path d="M8 4l-5 4v12h6V9M16 4l5 4v12h-6V9"/><path d="M8 4l4 6 4-6"/>'),subs:[["Jacket","outer","opts","body","outer"],["Jacket color","outerColor","cloth"]]},
 {id:"acc",label:"Accessories",icon:CI('<path d="M7 8c0 6 10 6 10 0"/><circle cx="12" cy="15" r="2"/>'),subs:[["Accessories","acc","opts","body","acc"]]},
 {id:"bg",label:"Background",icon:CI('<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 16l5-5 4 4 3-3 6 6"/>'),subs:[["Background","bg","bgopts"]]},
 {id:"profile",label:"Finish",icon:CI('<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>'),subs:[]}];
function openCreator(){if(!myId){toast("Sign in to create your character");return}
  if(window.hpAvatar){window.hpAvatar.openCreator({char:myDoc?.char||null,handle:myDoc?.handle||"",motto:myDoc?.motto||"",
    isTaken:h=>[...crew.entries()].some(([id,d])=>id!==myId&&(d.handle||"").toLowerCase()===h.toLowerCase()),
    onSave:async({char,handle,motto})=>{myDoc=Object.assign(myDoc||{stats:emptyStats(),ach:{},createdAt:Date.now()},{char,handle,motto});crewCheckAch();clearTimeout(crewTimer);
      const job=crewQ.then(()=>crewCol.doc(myId).set({...myDoc,stats:myStats(),updatedAt:Date.now()}));crewQ=job.catch(()=>{});await job;toast("Character saved");renderCrew();renderRank()}});return}
  const st={c:av2Migrate(myDoc?.char||av2Random()),handle:myDoc?.handle||"",motto:myDoc?.motto||"",cat:"skin",sub:0,undo:[],redo:[]};
  let el=$("#creator");if(el)el.remove();el=document.createElement("div");el.id="creator";el.setAttribute("role","dialog");el.setAttribute("aria-label","Character creator");document.body.append(el);
  const close=()=>{el.classList.add("out");setTimeout(()=>el.remove(),300);document.removeEventListener("keydown",onKey)};
  const commit=(k,v)=>{if(st.c[k]===v)return;st.undo.push(JSON.stringify(st.c));if(st.undo.length>60)st.undo.shift();st.redo=[];st.c={...st.c,[k]:v};paint(true)};
  const onKey=e=>{if(e.key==="Escape")close();if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"){e.preventDefault();e.shiftKey?redo():undo()}};
  const undo=()=>{if(!st.undo.length)return;st.redo.push(JSON.stringify(st.c));st.c=JSON.parse(st.undo.pop());paint(true)};
  const redo=()=>{if(!st.redo.length)return;st.undo.push(JSON.stringify(st.c));st.c=JSON.parse(st.redo.pop());paint(true)};
  document.addEventListener("keydown",onKey);
  el.innerHTML=`<div class="crsheet">
   <header class="crhead"><button class="wbtn big" id="crX" aria-label="Close">${ICO.x}</button><h2>Character creator</h2><button class="btn primary" id="crSave">Save</button></header>
   <nav class="cricons" id="crIcons" aria-label="Categories">${CR_CATS.map(c=>`<button type="button" data-cat="${c.id}" title="${c.label}" aria-label="${c.label}">${c.icon}</button>`).join("")}</nav>
   <div class="crmain"><div class="crstage"><div class="crav" id="crAv"></div>
     <div class="crtools"><button class="wbtn big" id="crUndo" aria-label="Undo">${CI('<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>')}</button><button class="wbtn big" id="crRedo" aria-label="Redo">${CI('<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>')}</button><span style="flex:1"></span><button class="btn" id="crRand">🎲 Randomize</button></div></div>
     <div class="crpanel"><div class="crpt"><button class="wbtn" id="crPrev" aria-label="Previous category">‹</button><b id="crTitle"></b><button class="wbtn" id="crNext" aria-label="Next category">›</button></div>
      <div class="bigseg mini" id="crSubs"></div><div class="crgrid" id="crGrid"></div></div></div></div>`;
  $("#crX").onclick=close;$("#crUndo").onclick=undo;$("#crRedo").onclick=redo;
  $("#crRand").onclick=()=>{st.undo.push(JSON.stringify(st.c));st.redo=[];st.c=av2Random();paint(true)};
  const catIdx=()=>CR_CATS.findIndex(c=>c.id===st.cat);
  $("#crPrev").onclick=()=>{st.cat=CR_CATS[(catIdx()-1+CR_CATS.length)%CR_CATS.length].id;st.sub=0;paint()};
  $("#crNext").onclick=()=>{st.cat=CR_CATS[(catIdx()+1)%CR_CATS.length].id;st.sub=0;paint()};
  el.querySelectorAll("[data-cat]").forEach(b=>b.onclick=()=>{st.cat=b.dataset.cat;st.sub=0;paint()});
  function paint(avOnly){const av=$("#crAv");av.innerHTML=avatar2SVG(st.c,360);av.classList.remove("pop");void av.offsetWidth;av.classList.add("pop");
    $("#crUndo").disabled=!st.undo.length;$("#crRedo").disabled=!st.redo.length;
    el.querySelectorAll("[data-cat]").forEach(b=>b.setAttribute("aria-pressed",b.dataset.cat===st.cat));
    const cat=CR_CATS[catIdx()];
    $("#crSubs").hidden=cat.subs.length<2;$("#crSubs").innerHTML=cat.subs.map((s,i)=>`<button type="button" data-sub="${i}" aria-pressed="${i===st.sub}">${s[0]}</button>`).join("");
    $$("#crSubs [data-sub]").forEach(b=>b.onclick=()=>{st.sub=+b.dataset.sub;paint()});
    const g=$("#crGrid");
    if(cat.id==="profile"){$("#crTitle").textContent="Finish";g.className="crgrid form";
      g.innerHTML=`<label class="field"><span>Callsign (what the crew sees)</span><input id="crHandle" maxlength="20" placeholder="e.g. Maverick" value="${esc(st.handle)}"></label>
       <label class="field"><span>Motto (optional)</span><input id="crMotto" maxlength="60" placeholder="e.g. Every no gets me closer to a yes" value="${esc(st.motto)}"></label>
       <p class="muted" style="font-size:12.5px;margin:0">Your character, callsign, motto, stats and achievements are visible to everyone who can open this desk.</p>`;
      $("#crHandle").oninput=e=>st.handle=e.target.value;$("#crMotto").oninput=e=>st.motto=e.target.value;$("#crHandle").focus();return}
    const [title,key,type,crop,focus]=cat.subs[Math.min(st.sub,cat.subs.length-1)];$("#crTitle").textContent=title;g.className="crgrid"+(type==="opts"||type==="bgopts"?"":" sw");
    let html="";
    if(type==="skin")html=AV2.skin.map((c,i)=>`<button type="button" class="sq" data-v="${i}" aria-pressed="${st.c.skin===i}" style="background:linear-gradient(160deg,${shade(c,.12)},${shade(c,-.12)})" aria-label="Skin tone ${i+1}"></button>`).join("");
    else if(type==="hair")html=AV2.hairColor.map((c,i)=>`<button type="button" class="sq" data-v="${i}" aria-pressed="${st.c[key]===i}" style="background:linear-gradient(160deg,${shade(c,.2)},${shade(c,-.2)})" aria-label="Color ${i+1}"></button>`).join("");
    else if(type==="eye")html=AV2.eyeColor.map((c,i)=>`<button type="button" class="sq round" data-v="${i}" aria-pressed="${st.c.eyeColor===i}" style="background:radial-gradient(circle at 50% 50%,#0B0B10 0 22%,${c} 24% 62%,${shade(c,-.3)} 64%)" aria-label="Eye color ${i+1}"></button>`).join("");
    else if(type==="cloth")html=AV2.clothColor.map((c,i)=>`<button type="button" class="sq" data-v="${i}" aria-pressed="${st.c[key]===i}" style="background:linear-gradient(160deg,${shade(c,.15)},${shade(c,-.15)})" aria-label="Color ${i+1}"></button>`).join("");
    else if(type==="bgopts")html=AV2.bg.map(v=>`<button type="button" class="tile" data-v="${v}" aria-pressed="${st.c.bg===v}">${avatar2SVG({...st.c,bg:v},110,{crop:"full"})}<span>${AV2_LABEL[v]}</span></button>`).join("");
    else html=AV2[key].map(v=>`<button type="button" class="tile" data-v="${v}" aria-pressed="${st.c[key]===v}">${avatar2SVG({...st.c,[key]:v},110,{mannequin:true,focus:focus||key,crop})}<span>${AV2_LABEL[v]||v}</span></button>`).join("");
    g.innerHTML=html;
    g.querySelectorAll("[data-v]").forEach(b=>b.onclick=()=>{const raw=b.dataset.v;commit(key,/^\d+$/.test(raw)?+raw:raw);
      g.querySelectorAll("[data-v]").forEach(x=>x.setAttribute("aria-pressed",x===b))});
  }
  $("#crSave").onclick=async()=>{const h=(st.handle||"").trim().replace(/\s+/g," "),m=(st.motto||"").trim();
    if(h.length<2){st.cat="profile";paint();toast("Add a callsign to finish (at least 2 characters)");return}
    if(!/^[\p{L}\p{N} ._'-]+$/u.test(h)){st.cat="profile";paint();toast("Callsigns can use letters, numbers, spaces and . _ ' -");return}
    if([...crew.entries()].some(([id,d])=>id!==myId&&(d.handle||"").toLowerCase()===h.toLowerCase())){st.cat="profile";paint();toast("Someone on the crew already has that callsign");return}
    myDoc=Object.assign(myDoc||{stats:emptyStats(),ach:{},createdAt:Date.now()},{char:st.c,handle:h,motto:m});crewCheckAch();clearTimeout(crewTimer);
    $("#crSave").disabled=true;
    try{await (crewQ=crewQ.then(()=>crewCol.doc(myId).set({...myDoc,stats:myStats(),updatedAt:Date.now()})));toast("Character saved");close();renderCrew();renderRank()}
    catch(e){$("#crSave").disabled=false;toast("Couldn't save: "+(e.message||e.code))}};
  paint();requestAnimationFrame(()=>el.classList.add("in"));
}

/* ---------- render ---------- */
function renderAll(){
  if(view==="crew")renderCrew(); else if(view==="calendar")renderCalendar(); else if(view==="screen")renderScreen(); else if(view==="scripts")renderScripts(); else if(view==="pipeline")renderPipeline(); else if(view==="contacts")renderContacts(); else if(view==="dialer")renderDialer(); else if(view==="quoter")renderQuoter(); else if(view==="iul")renderIul(); else if(view==="import")renderImport();
  if(drawerId&&!leads.get(drawerId))closeDrawer();
}
go(view);
initDb();
})();
