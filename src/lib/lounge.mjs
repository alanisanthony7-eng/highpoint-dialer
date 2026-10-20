// Crew lounge: a shared chat, Discord-style roles (name, color, hierarchy, chat perms),
// and account profile photos. Not a Discord clone — chat + roles only.
import { D1, ensureSchema } from "./store.mjs";
import { requireUser, requireFeature, admins } from "./auth.mjs";
import { member } from "./team.mjs";

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const SYS = [
  { id: "owner", name: "Owner", color: "#f0c14b", position: 1000, perms: "send,manage_messages,manage_roles,mention_everyone", locked: 1 },
  { id: "admin", name: "Admin", color: "#ed4245", position: 900, perms: "send,manage_messages,manage_roles,mention_everyone", locked: 1 },
  { id: "agent", name: "Agent", color: "#b5bac1", position: 0, perms: "send", locked: 1 },
];
const PERMS = ["send", "manage_messages", "manage_roles", "mention_everyone"];
const COLORS = /^#[0-9a-fA-F]{6}$/;
let ready = null;

export function ensureLounge() {
  if (!ready) ready = ensureSchema().then(() => D1().batch([
    D1().prepare("CREATE TABLE IF NOT EXISTS lounge_roles (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, position INTEGER NOT NULL, perms TEXT NOT NULL, locked INTEGER NOT NULL DEFAULT 0)"),
    D1().prepare("CREATE TABLE IF NOT EXISTS lounge_who (user_id TEXT NOT NULL, role_id TEXT NOT NULL, PRIMARY KEY (user_id, role_id))"),
    D1().prepare("CREATE TABLE IF NOT EXISTS lounge_chat (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, text TEXT NOT NULL, created INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0)"),
    D1().prepare("CREATE TABLE IF NOT EXISTS lounge_photo (user_id TEXT PRIMARY KEY, mime TEXT NOT NULL, bin BLOB NOT NULL, updated INTEGER NOT NULL)"),
  ])).then(async () => {
    for (const r of SYS) {
      await D1().prepare("INSERT OR IGNORE INTO lounge_roles (id, name, color, position, perms, locked) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
        .bind(r.id, r.name, r.color, r.position, r.perms, r.locked).run();
    }
  }).catch((e) => { ready = null; throw e; });
  return ready;
}

const parsePerms = (s) => Object.fromEntries(PERMS.map((k) => [k, String(s || "").split(",").includes(k)]));
const packPerms = (o) => PERMS.filter((k) => o?.[k]).join(",") || "send";
const uid = () => "r_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);

async function syncSystem(user) {
  const owner = !!user.owner || admins().includes(String(user.email || "").toLowerCase());
  const m = await member(user.id);
  const admin = owner || m?.role === "admin" || user.admin;
  await D1().prepare("INSERT OR IGNORE INTO lounge_who (user_id, role_id) VALUES (?1, 'agent')").bind(user.id).run();
  if (admin) await D1().prepare("INSERT OR IGNORE INTO lounge_who (user_id, role_id) VALUES (?1, 'admin')").bind(user.id).run();
  else await D1().prepare("DELETE FROM lounge_who WHERE user_id=?1 AND role_id='admin'").bind(user.id).run();
  if (owner) await D1().prepare("INSERT OR IGNORE INTO lounge_who (user_id, role_id) VALUES (?1, 'owner')").bind(user.id).run();
  else await D1().prepare("DELETE FROM lounge_who WHERE user_id=?1 AND role_id='owner'").bind(user.id).run();
}

async function rolesOf(userId) {
  const r = await D1().prepare("SELECT r.* FROM lounge_roles r JOIN lounge_who w ON w.role_id=r.id WHERE w.user_id=?1 ORDER BY r.position DESC").bind(userId).all();
  return r.results || [];
}
function permsFrom(roles) {
  const p = Object.fromEntries(PERMS.map((k) => [k, false]));
  for (const r of roles) Object.assign(p, Object.fromEntries(Object.entries(parsePerms(r.perms)).filter(([, v]) => v)));
  return p;
}
const topPos = (roles) => roles.reduce((n, r) => Math.max(n, +r.position || 0), 0);
const display = (roles) => roles[0] || SYS[2];

async function allRoles() {
  const r = await D1().prepare("SELECT * FROM lounge_roles ORDER BY position DESC, name").all();
  return (r.results || []).map((x) => ({ id: x.id, name: x.name, color: x.color, position: x.position, perms: parsePerms(x.perms), locked: !!x.locked }));
}

async function members() {
  const people = (await D1().prepare("SELECT id, name FROM users ORDER BY name").all()).results || [];
  const who = (await D1().prepare("SELECT user_id, role_id FROM lounge_who").all()).results || [];
  const photos = new Set(((await D1().prepare("SELECT user_id FROM lounge_photo").all()).results || []).map((x) => x.user_id));
  const by = {};
  for (const w of who) (by[w.user_id] ||= []).push(w.role_id);
  const roles = Object.fromEntries((await allRoles()).map((r) => [r.id, r]));
  return people.map((u) => {
    const ids = by[u.id] || ["agent"];
    const list = ids.map((id) => roles[id]).filter(Boolean).sort((a, b) => b.position - a.position);
    const top = list[0] || roles.agent;
    return { id: u.id, name: u.name || "Agent", roleIds: list.map((r) => r.id), color: top?.color || "#b5bac1", role: top?.name || "Agent", photo: photos.has(u.id) };
  });
}

async function messages(after = 0) {
  const r = after
    ? await D1().prepare("SELECT id, user_id, text, created, deleted FROM lounge_chat WHERE id > ?1 ORDER BY id LIMIT 80").bind(after).all()
    : await D1().prepare("SELECT id, user_id, text, created, deleted FROM lounge_chat ORDER BY id DESC LIMIT 80").all();
  const rows = (r.results || []).slice().sort((a, b) => a.id - b.id);
  return rows.map((x) => ({ id: x.id, userId: x.user_id, text: x.deleted ? "" : x.text, created: x.created, deleted: !!x.deleted }));
}

async function state(user, after) {
  await syncSystem(user);
  const mine = await rolesOf(user.id);
  return {
    me: { id: user.id, perms: permsFrom(mine), roleIds: mine.map((r) => r.id), color: display(mine).color, position: topPos(mine) },
    roles: await allRoles(),
    members: await members(),
    messages: await messages(after || 0),
  };
}

export async function loungeRoute(req, parts) {
  const action = parts[0] || "";
  if (action === "photo" && req.method === "GET") {
    const user = await requireUser(req);
    await ensureLounge();
    const id = new URL(req.url).searchParams.get("id") || user.id;
    const row = await D1().prepare("SELECT mime, bin FROM lounge_photo WHERE user_id=?1").bind(id).first();
    if (!row?.bin) return new Response("Not found", { status: 404 });
    const body = row.bin instanceof ArrayBuffer ? row.bin : ArrayBuffer.isView(row.bin) ? row.bin : new Uint8Array(row.bin);
    return new Response(body, { status: 200, headers: { "content-type": row.mime || "image/jpeg", "cache-control": "private, max-age=120" } });
  }

  if (action === "photo") {
    const user = await requireUser(req);
    await ensureLounge();
    if (req.method === "DELETE") {
      await D1().prepare("DELETE FROM lounge_photo WHERE user_id=?1").bind(user.id).run();
      return json({ ok: true });
    }
    if (req.method === "PUT" || req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      const raw = String(b.data || "");
      const m = raw.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/);
      if (!m) return json({ error: "Use a JPEG, PNG or WebP photo." }, 400);
      if (raw.length > 240_000) return json({ error: "That photo is too big. Use a smaller square picture." }, 413);
      const bin = Uint8Array.from(atob(m[2].replace(/\s/g, "")), (c) => c.charCodeAt(0));
      await D1().prepare("INSERT OR REPLACE INTO lounge_photo (user_id, mime, bin, updated) VALUES (?1, ?2, ?3, ?4)").bind(user.id, m[1], bin, Date.now()).run();
      return json({ ok: true });
    }
  }

  const user = await requireFeature(req, "crew");
  await ensureLounge();
  await syncSystem(user);

  if (!action && req.method === "GET") {
    const after = +new URL(req.url).searchParams.get("after") || 0;
    return json(await state(user, after));
  }

  if (action === "say" && req.method === "POST") {
    const mine = await rolesOf(user.id);
    if (!permsFrom(mine).send) return json({ error: "Your role can't send messages in the lounge." }, 403);
    const text = String((await req.json().catch(() => ({}))).text || "").replace(/\s+/g, " ").trim().slice(0, 2000);
    if (!text) return json({ error: "Type a message." }, 400);
    if (/@everyone/i.test(text) && !permsFrom(mine).mention_everyone) return json({ error: "Your role can't mention @everyone." }, 403);
    await D1().prepare("INSERT INTO lounge_chat (user_id, text, created) VALUES (?1, ?2, ?3)").bind(user.id, text, Date.now()).run();
    const last = await D1().prepare("SELECT MAX(id) AS m FROM lounge_chat").first();
    try { await D1().prepare("INSERT INTO roomev (topic, by, data, at) VALUES ('lounge', ?1, ?2, ?3)").bind(user.id, JSON.stringify({ id: last?.m }), Date.now()).run(); } catch {}
    return json({ ok: true, id: last?.m });
  }

  if (action === "msg" && req.method === "DELETE") {
    const id = +parts[1] || 0;
    const row = await D1().prepare("SELECT id, user_id, deleted FROM lounge_chat WHERE id=?1").bind(id).first();
    if (!row || row.deleted) return json({ error: "Message not found." }, 404);
    const mine = await rolesOf(user.id);
    if (row.user_id !== user.id && !permsFrom(mine).manage_messages) return json({ error: "You can only delete your own messages." }, 403);
    await D1().prepare("UPDATE lounge_chat SET deleted=1, text='' WHERE id=?1").bind(id).run();
    return json({ ok: true });
  }

  if (action === "role") {
    const mine = await rolesOf(user.id);
    if (!permsFrom(mine).manage_roles) return json({ error: "Your role can't manage roles." }, 403);
    const myPos = topPos(mine);
    const b = await req.json().catch(() => ({}));
    if (req.method === "DELETE") {
      const role = await D1().prepare("SELECT * FROM lounge_roles WHERE id=?1").bind(String(b.id || "")).first();
      if (!role) return json({ error: "No such role." }, 404);
      if (role.locked) return json({ error: "That built-in role stays as it is." }, 403);
      if (role.position >= myPos) return json({ error: "You can only change roles below yours." }, 403);
      await D1().prepare("DELETE FROM lounge_who WHERE role_id=?1").bind(role.id).run();
      await D1().prepare("DELETE FROM lounge_roles WHERE id=?1").bind(role.id).run();
      return json({ ok: true });
    }
    if (req.method === "POST" || req.method === "PATCH") {
      if (b.id) {
        const role = await D1().prepare("SELECT * FROM lounge_roles WHERE id=?1").bind(String(b.id)).first();
        if (!role) return json({ error: "No such role." }, 404);
        if (role.locked) return json({ error: "That built-in role stays as it is." }, 403);
        if (role.position >= myPos) return json({ error: "You can only change roles below yours." }, 403);
        const name = b.name != null ? String(b.name).trim().slice(0, 32) : role.name;
        const color = COLORS.test(b.color) ? b.color : role.color;
        const pos = b.position != null ? Math.max(1, Math.min(myPos - 1, Math.round(+b.position))) : role.position;
        const perms = b.perms ? packPerms(b.perms) : role.perms;
        if (name.length < 2) return json({ error: "Give the role a name." }, 400);
        await D1().prepare("UPDATE lounge_roles SET name=?2, color=?3, position=?4, perms=?5 WHERE id=?1").bind(role.id, name, color, pos, perms).run();
        return json({ ok: true });
      }
      const name = String(b.name || "").trim().slice(0, 32);
      const color = COLORS.test(b.color) ? b.color : "#5865f2";
      if (name.length < 2) return json({ error: "Give the role a name." }, 400);
      const pos = Math.max(1, Math.min(myPos - 1, Math.round(+b.position || 10)));
      const id = uid();
      await D1().prepare("INSERT INTO lounge_roles (id, name, color, position, perms, locked) VALUES (?1, ?2, ?3, ?4, ?5, 0)")
        .bind(id, name, color, pos, packPerms(b.perms || { send: true })).run();
      return json({ ok: true, id });
    }
  }

  if (action === "assign" && req.method === "POST") {
    const mine = await rolesOf(user.id);
    if (!permsFrom(mine).manage_roles) return json({ error: "Your role can't assign roles." }, 403);
    const b = await req.json().catch(() => ({}));
    const role = await D1().prepare("SELECT * FROM lounge_roles WHERE id=?1").bind(String(b.roleId || "")).first();
    if (!role) return json({ error: "No such role." }, 404);
    if (role.locked) return json({ error: "Built-in roles are assigned automatically." }, 403);
    if (role.position >= topPos(mine)) return json({ error: "You can only assign roles below yours." }, 403);
    const uid2 = String(b.userId || "");
    if (!(await D1().prepare("SELECT id FROM users WHERE id=?1").bind(uid2).first())) return json({ error: "No such teammate." }, 404);
    if (b.on === false) await D1().prepare("DELETE FROM lounge_who WHERE user_id=?1 AND role_id=?2").bind(uid2, role.id).run();
    else await D1().prepare("INSERT OR IGNORE INTO lounge_who (user_id, role_id) VALUES (?1, ?2)").bind(uid2, role.id).run();
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 404);
}
