import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import "leaflet/dist/leaflet.css";

const App = lazy(() => import("@/aero/App"));

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AeroDoppler OSINT DSP" },
      {
        name: "description",
        content: "Aircraft audio Doppler spectrum extractor, flight path analyzer and acoustic geolocation toolkit.",
      },
      { property: "og:title", content: "AeroDoppler OSINT DSP" },
      {
        property: "og:description",
        content: "Aircraft audio Doppler spectrum extractor, flight path analyzer and acoustic geolocation toolkit.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Loading() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-darkbg font-mono text-xs text-slate-400">
      Loading AeroDoppler…
    </div>
  );
}

function Index() {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-darkbg text-slate-200 select-none">
      <ClientOnly fallback={<Loading />}>
        <Suspense fallback={<Loading />}>
          <App />
        </Suspense>
      </ClientOnly>
    </div>
  );
}
