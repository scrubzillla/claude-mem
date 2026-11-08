# Shop Twin

A 3D, live view of an auto repair shop. Bays, lot and every open repair order (RO) appear as a car you can see, move and plan, the way a restaurant host works a floor plan. The shop management system (Tekmetric) stays the source of record.

| Folder / file | What it is |
|---|---|
| [`extension/`](extension/README.md) | **The product (v0.1).** A Chrome extension that reads the ROs your signed-in Tekmetric tab loads and mirrors them onto the 3D shop. No API keys. |
| `index.html` | Standalone demo with example data (no extension needed). Open it in any browser. |

## What works

- **3D shop**: a parametric 5-bay building with office, roll-up doors, lifts, lot, drop-off, street. Walls down, roof off, floor-plan view.
- **Live from Tekmetric** (extension): open ROs appear automatically.
  - Work in progress goes to bays, completed ROs go to the lot, and today's estimates go to drop-off.
  - New ROs drive in. Posted ROs drive off.
  - Click a car to see its RO, then **Open in Tekmetric** jumps to it.
- **Dispatch**: move now, plan a move (including behind a busy bay), an *Up next* queue, auto-plan into bays, and check in cars that aren't on the lot yet.
- **Data page**: shows what was captured and copies a structure report (field names only, no customer data) for tuning against Tekmetric's real payloads.
- Tested end to end in Chromium against a fake Tekmetric page that serves Tekmetric-shaped data: going live, arrivals, departures, deep links, layout persistence, demo toggle. **Not yet run against real Tekmetric.**

## Open risks

| Risk | Why it matters | Plan |
|---|---|---|
| Field names in Tekmetric's web app are unverified | Recognition follows Tekmetric's published API model. The web app's private JSON may differ. | Run the extension on a real Tekmetric login and send the Data page's structure report. Adjust `extension/data/normalize.js`. |
| Private web traffic, not a supported API | Any Tekmetric release can break capture. There's also a terms-of-service question. | Keep recognition shape-based (it already is). Treat the partner API as the supported route for a hosted version. |
| Floor plan is per browser | The service writer and the owner see different spots and plans. | Add a small shared backend for twin-only data (spots, plans) once the read side is proven. |
| Test layout, not the real shop | Bay count, doors and lot differ per shop. | Build a layout editor that saves JSON. Model the first real shop from its measurements. |
| Generic vehicle shapes | Body type is inferred from make and model text. | Decode the VIN with NHTSA vPIC to get the body class. |

## Next steps

1. Load the extension on a real Tekmetric login. Fix recognition from the structure report.
2. Build a layout editor, then the first real shop layout.
3. Add shared state (spots and plans) so a team sees one floor.
4. Add a shop TV mode: full-screen twin, no panels, auto-rotating camera.
