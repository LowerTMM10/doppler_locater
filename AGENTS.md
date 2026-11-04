<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- The imported AeroDoppler app lives in src/aero and is rendered client-only from src/routes/index.tsx (Web Audio, canvas, Leaflet). The Flight Locator scores saved Doppler waves against timestamped tracks (src/aero/dsp/multiWave.ts); historical tracks come from adsb.lol heatmap archives parsed server-side in src/lib/flights.functions.ts, falling back to live traces when the archive is not yet published.
- Strict index-access TypeScript flags are off in tsconfig.json because the imported DSP code relies on plain array indexing.
