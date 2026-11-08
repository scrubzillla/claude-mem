# Shop Twin

A live 3D floor plan of an auto repair shop, the way a restaurant host works a floor plan. Bays, lot and every open repair order (RO) appear as a car you can see, move and plan. Tekmetric stays the source of record.

| Folder / file | Status | What it is |
|---|---|---|
| [`app/`](app/README.md) | **Current (v0.2)** | Server + web page built on the Tekmetric API. One shared floor per shop, on every screen. Runs today against a mock Tekmetric API; switch to sandbox or production with credentials. |
| [`extension/`](extension/README.md) | Parked (v0.1) | Chrome extension that reads the ROs a signed-in Tekmetric tab loads. No API keys, but car positions and plans are stored per browser, so a team can't share one floor. |
| `index.html` | Demo | Standalone page with example data. |

## Why the API version needs a server

A browser can't safely hold Tekmetric API credentials: they unlock every shop that authorized them. So a server holds the keys, pulls the shop's open ROs, and stores what Tekmetric has no field for (which spot each car is in, planned moves). Every screen at the shop connects to that server and sees the same floor.

## Open risks

| Risk | Plan |
|---|---|
| Tekmetric's API page says new applications are paused, with no date | Apply now anyway. Keep building on the mock API, which uses the documented shapes, so switching over is a config change. |
| "Open in Tekmetric" link format is a guess | Check it on a real login and set `TEKMETRIC_RO_URL_TEMPLATE`. |
| Test layout, not the real shop | Build a layout editor next, then model the first real shop. |
| No webhooks in the API | Poll every 30 seconds (about 3 calls a minute against a 600/min limit). |
