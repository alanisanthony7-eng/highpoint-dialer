// Netlify-Blobs-compatible key/value store on Cloudflare D1 (strongly consistent, with
// conditional writes), so the dialer code runs unchanged.
let ready = null;
const db = () => {
  const d = globalThis.__ENV?.DB;
  if (!d) throw Object.assign(new Error("Database isn't connected. In Cloudflare Pages → Settings → Bindings, add a D1 database named DB."), { status: 503 });
  return d;
};
export function ensureSchema() {
  if (!ready) ready = db().batch([
    db().prepare("CREATE TABLE IF NOT EXISTS blobs (store TEXT NOT NULL, key TEXT NOT NULL, txt TEXT, bin BLOB, etag TEXT NOT NULL, PRIMARY KEY (store, key))"),
    db().prepare("CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, salt TEXT NOT NULL, hash TEXT NOT NULL, created INTEGER NOT NULL)"),
    db().prepare("CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL)"),
    db().prepare("CREATE TABLE IF NOT EXISTS docs (scope TEXT NOT NULL, col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (scope, col, id))"),
    db().prepare("CREATE TABLE IF NOT EXISTS colver (scope TEXT NOT NULL, col TEXT NOT NULL, v INTEGER NOT NULL, PRIMARY KEY (scope, col))"),
    db().prepare("CREATE TABLE IF NOT EXISTS room (user_id TEXT PRIMARY KEY, name TEXT, presence TEXT, at INTEGER NOT NULL)"),
    db().prepare("CREATE TABLE IF NOT EXISTS roomev (id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT, by TEXT, data TEXT, at INTEGER NOT NULL)"),
  ]).catch((e) => { ready = null; throw e; });
  return ready;
}
const tag = () => crypto.randomUUID().slice(0, 12);
export function getStore(o) {
  const store = typeof o === "string" ? o : o.name;
  const read = (row, type) => {
    if (!row) return null;
    if (type === "arrayBuffer") return row.bin ? new Uint8Array(row.bin).buffer : new TextEncoder().encode(row.txt ?? "").buffer;
    const t = row.txt ?? (row.bin ? new TextDecoder().decode(new Uint8Array(row.bin)) : null);
    return type === "json" ? JSON.parse(t) : t;
  };
  const one = async (key) => { await ensureSchema(); return db().prepare("SELECT txt, bin, etag FROM blobs WHERE store=?1 AND key=?2").bind(store, key).first(); };
  return {
    async get(key, { type } = {}) { return read(await one(key), type); },
    async getWithMetadata(key, { type } = {}) { const r = await one(key); return r ? { data: read(r, type), etag: r.etag, metadata: {} } : null; },
    async setJSON(key, val, opts) { return this.set(key, JSON.stringify(val), opts); },
    async set(key, data, { onlyIfNew, onlyIfMatch } = {}) {
      await ensureSchema();
      const isText = typeof data === "string";
      const txt = isText ? data : null, bin = isText ? null : (data instanceof ArrayBuffer ? data : data.buffer ?? data);
      const etag = tag(); let res;
      if (onlyIfNew) res = await db().prepare("INSERT OR IGNORE INTO blobs (store, key, txt, bin, etag) VALUES (?1, ?2, ?3, ?4, ?5)").bind(store, key, txt, bin, etag).run();
      else if (onlyIfMatch) res = await db().prepare("UPDATE blobs SET txt=?3, bin=?4, etag=?5 WHERE store=?1 AND key=?2 AND etag=?6").bind(store, key, txt, bin, etag, onlyIfMatch).run();
      else res = await db().prepare("INSERT OR REPLACE INTO blobs (store, key, txt, bin, etag) VALUES (?1, ?2, ?3, ?4, ?5)").bind(store, key, txt, bin, etag).run();
      const ok = (res.meta?.changes ?? 1) > 0;
      return { modified: ok, etag: ok ? etag : undefined };
    },
    async delete(key) { await ensureSchema(); await db().prepare("DELETE FROM blobs WHERE store=?1 AND key=?2").bind(store, key).run(); },
    list({ prefix = "" } = {}) {
      const run = async () => {
        await ensureSchema();
        const esc = prefix.replace(/[\\%_]/g, (c) => "\\" + c);
        const r = await db().prepare("SELECT key FROM blobs WHERE store=?1 AND key LIKE ?2 ESCAPE '\\' ORDER BY key").bind(store, esc + "%").all();
        return { blobs: (r.results || []).map((x) => ({ key: x.key })) };
      };
      return { async *[Symbol.asyncIterator]() { yield await run(); }, then(res, rej) { return run().then(res, rej); } };
    },
  };
}
export const D1 = db;
