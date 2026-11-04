import { createFileRoute } from "@tanstack/react-router";

// Proxies /api/adsb/* to the public adsb.lol API (avoids browser CORS limits).
export const Route = createFileRoute("/api/adsb/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const target = `https://api.adsb.lol/${params._splat ?? ""}${url.search}`;
        const res = await fetch(target, { headers: { accept: "application/json" } });
        return new Response(res.body, {
          status: res.status,
          headers: {
            "content-type": res.headers.get("content-type") ?? "application/json",
            "access-control-allow-origin": "*",
          },
        });
      },
    },
  },
});
