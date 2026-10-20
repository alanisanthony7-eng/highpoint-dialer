// Crew lounge: shared chat, Discord-style roles, account profile photos.
import { DatabaseSync } from "node:sqlite";
import { onRequest } from "../functions/api/[[path]].js";

const sql = new DatabaseSync(":memory:");
const norm = (v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v === undefined ? null : v);
const out = (row) => row && Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Uint8Array ? Array.from(v) : v]));
const stmt = (q, args = []) => ({
  bind: (...a) => stmt(q, a.map(norm)),
  first: async () => out(sql.prepare(q).get(...args)) ?? null,
  all: async () => ({ results: sql.prepare(q).all(...args).map(out) }),
  run: async () => { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes, last_row_id: r.lastInsertRowid } }; },
});
const DB = { prepare: (q) => stmt(q), batch: async (list) => Promise.all(list.map((s) => s.run())) };
const env = { DB, HP_ADMIN_EMAILS: "boss@hp.com", HP_INVITE_CODE: "HP2026" };
const jars = {};

async function call(who, path, opts = {}) {
  const method = opts.method || (opts.body !== undefined ? "POST" : "GET");
  const h = { "content-type": "application/json" }; if (jars[who]) h.cookie = jars[who];
  const r = await onRequest({ request: new Request("https://desk.example.com" + path, { method, headers: h, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }), env, waitUntil: () => {} });
  const sc = r.headers.get("set-cookie"); if (sc) jars[who] = sc.split(";")[0];
  const ct = r.headers.get("content-type") || "";
  return { s: r.status, j: ct.includes("json") ? await r.json().catch(() => ({})) : {}, ct, buf: ct.includes("json") ? null : Buffer.from(await r.arrayBuffer()) };
}
const ok = (c, m) => { console.log((c ? "PASS " : "FAIL ") + m); if (!c) process.exitCode = 1; };
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

ok((await call("x", "/api/lounge")).s === 401, "signed-out visitors can't open the lounge");

await call("boss", "/api/auth/signup", { body: { email: "boss@hp.com", password: "password2", name: "Boss" } });
await call("rep", "/api/auth/signup", { body: { email: "rep@hp.com", password: "password1", name: "Rita", invite: "HP2026", agree: true } });

const boss = (await call("boss", "/api/lounge")).j;
const rep = (await call("rep", "/api/lounge")).j;
ok(boss.me?.perms?.manage_roles && boss.me.roleIds.includes("owner"), "the desk owner gets the Owner role and can manage roles");
ok(rep.me?.perms?.send && !rep.me.perms.manage_roles && rep.me.roleIds.includes("agent") && !rep.me.roleIds.includes("owner"), "an agent can chat and sits under Agent");
ok(boss.roles.some((r) => r.id === "owner") && boss.roles.some((r) => r.id === "admin") && boss.roles.some((r) => r.id === "agent"), "Owner, Admin and Agent are seeded");
ok(boss.members.some((m) => m.name === "Rita") && boss.members.some((m) => m.name === "Boss"), "everyone on the desk shows in the member list");

ok((await call("rep", "/api/lounge/say", { body: {} })).s === 400, "empty messages are refused");
let r = await call("rep", "/api/lounge/say", { body: { text: "hello crew" } });
ok(r.s === 200 && r.j.ok, "an agent can send a message");
const seen = (await call("boss", "/api/lounge")).j.messages;
ok(seen.some((m) => m.text === "hello crew" && !m.deleted), "the rest of the crew sees it");

ok((await call("rep", "/api/lounge/say", { body: { text: "hey @everyone" } })).s === 403, "agents can't mention @everyone");
ok((await call("boss", "/api/lounge/say", { body: { text: "stand up @everyone" } })).s === 200, "owners can mention @everyone");

ok((await call("rep", "/api/lounge/role", { body: { name: "Closer", color: "#e91e63" } })).s === 403, "agents can't create roles");
r = await call("boss", "/api/lounge/role", { body: { name: "Closer", color: "#e91e63", position: 50, perms: { send: true, mention_everyone: true } } });
ok(r.s === 200 && r.j.id, "the owner can create a custom role");
const closer = r.j.id;
const rita = (await call("boss", "/api/lounge")).j.members.find((m) => m.name === "Rita");
ok((await call("boss", "/api/lounge/assign", { body: { userId: rita.id, roleId: "admin", on: true } })).s === 403, "built-in roles stay automatic");
r = await call("boss", "/api/lounge/assign", { body: { userId: rita.id, roleId: closer, on: true } });
ok(r.s === 200, "a custom role can be assigned");
const rita2 = (await call("rep", "/api/lounge")).j.members.find((m) => m.name === "Rita");
ok(rita2.roleIds.includes(closer) && rita2.color === "#e91e63" && rita2.role === "Closer", "the highest role colors the name");

ok((await call("rep", "/api/lounge/role", { method: "POST", body: { id: closer, name: "Top Closer" } })).s === 403, "an agent can't edit a role they don't manage");
ok((await call("boss", "/api/lounge/role", { method: "POST", body: { id: closer, name: "Top Closer", color: "#2ecc71" } })).s === 200, "the owner can rename and recolor a role");

const bossMsg = (await call("boss", "/api/lounge")).j.messages.find((m) => /stand up/.test(m.text));
ok((await call("rep", "/api/lounge/msg/" + bossMsg.id, { method: "DELETE" })).s === 403, "an agent can't delete someone else's message");
ok((await call("boss", "/api/lounge/msg/" + bossMsg.id, { method: "DELETE" })).s === 200, "owners can delete any message");
ok((await call("boss", "/api/lounge")).j.messages.find((m) => m.id === bossMsg.id).deleted, "deleted messages stay as a tombstone");

ok((await call("rep", "/api/lounge/photo", { method: "PUT", body: { data: "not-an-image" } })).s === 400, "junk photo data is refused");
r = await call("rep", "/api/lounge/photo", { method: "PUT", body: { data: PNG } });
ok(r.s === 200, "an agent can set a profile picture");
const pic = await call("boss", "/api/lounge/photo?id=" + encodeURIComponent(rita.id));
ok(pic.s === 200 && pic.ct.includes("image/png") && pic.buf?.length > 20, "teammates can load that picture");
ok((await call("boss", "/api/lounge")).j.members.find((m) => m.id === rita.id).photo === true, "the member list flags who has a photo");
ok((await call("rep", "/api/lounge/photo", { method: "DELETE" })).s === 200, "they can remove it");
ok((await call("boss", "/api/lounge/photo?id=" + encodeURIComponent(rita.id))).s === 404, "a removed picture is gone");

ok((await call("boss", "/api/lounge/role", { method: "DELETE", body: { id: "owner" } })).s === 403, "built-in roles can't be deleted");
ok((await call("boss", "/api/lounge/role", { method: "DELETE", body: { id: closer } })).s === 200, "a custom role can be deleted");
ok(!(await call("rep", "/api/lounge")).j.roles.some((x) => x.id === closer), "deleted roles leave the list");
