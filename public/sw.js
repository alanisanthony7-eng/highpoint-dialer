// Highpoint Desk service worker: shows alerts (push) and lets the desk be installed.
// It never caches the desk's pages or data, so a new deploy is always what people get.
const OFFLINE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Highpoint Desk</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0B0716;color:#eef2f8;font:16px system-ui,sans-serif;text-align:center;padding:24px"><div><h1 style="font:700 22px system-ui;margin:0 0 8px">You're offline</h1><p style="color:#8c97ab;margin:0 0 18px">The desk needs a connection. It will open as soon as you're back online.</p><button onclick="location.reload()" style="font:600 15px system-ui;padding:11px 20px;border-radius:10px;border:0;background:#fff;color:#0B0716">Try again</button></div>`;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  if (e.request.mode === "navigate") e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { status: 503, headers: { "content-type": "text/html; charset=utf-8" } })));
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  const title = d.title || "Highpoint Desk";
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) w.postMessage({ type: "push", data: d }); // an open desk also shows it inside the page
    await self.registration.showNotification(title, {
      body: d.body || "", tag: d.tag || undefined, renotify: !!d.tag, icon: "/icons/icon-192.png", badge: "/icons/badge-96.png",
      data: { url: d.url || "/" }, requireInteraction: d.event === "newLead" || d.event === "whisper",
    });
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const w = wins.find((x) => new URL(x.url).origin === self.location.origin);
    if (w) { await w.focus(); w.postMessage({ type: "open", url }); return; }
    await self.clients.openWindow(url);
  })());
});
