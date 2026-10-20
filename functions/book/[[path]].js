// /book/<agent>: the public booking page (one static page; it reads the agent's link name from the address).
export async function onRequest(ctx) {
  const origin = new URL(ctx.request.url).origin;
  let r = await ctx.env.ASSETS.fetch(new Request(origin + "/booking.html"));
  for (let i = 0; i < 3 && r.status >= 300 && r.status < 400 && r.headers.get("location"); i++) r = await ctx.env.ASSETS.fetch(new Request(new URL(r.headers.get("location"), origin)));
  return new Response(r.body, { status: r.ok ? 200 : r.status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
}
