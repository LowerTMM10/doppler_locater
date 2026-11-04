// Cloudflare Worker: proxies /api/adsb/* to api.adsb.lol, everything else is the built site.
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/adsb/")) {
      const target = "https://api.adsb.lol/" + url.pathname.slice("/api/adsb/".length) + url.search;
      const res = await fetch(target, { method: request.method, headers: { accept: "application/json" } });
      const out = new Response(res.body, res);
      out.headers.set("access-control-allow-origin", "*");
      return out;
    }
    return env.ASSETS.fetch(request);
  },
};
