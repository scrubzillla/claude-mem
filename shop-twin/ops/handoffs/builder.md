# Builder handoff (Sun Nov 8, 2026, ~09:10 UTC)

Updated by Builder session_01GyhqTJyFqeUqn7tqVHxykH.

## Goal
Shop Twin: a live 3D floor plan of an auto repair shop, fed by Tekmetric, that a whole shop team shares. It's a restaurant host stand for cars: what's in each bay, what's waiting, what goes in next, and who's working on it. Ian sells Tekmetric and pictures this as the visual layer over the shop management system ("Tekmetric = the record and the reports; Shop Twin = how you see and run the shop").

## State
**Where the code is:** the `shop-twin/` folder on branch `claude/3d-shop-visualizer-kijam9` of `scrubzillla/claude-mem`, with draft PR #1 (don't merge into claude-mem).

**The move:**
- Ian was asked (Nov 8) to create an empty private repo `scrubzillla/shop-twin` and give the Claude GitHub app access. Ops owns moving the code there.
- After the move, paths in this file drop the `shop-twin/` prefix.

**v0.2: `app/` is the current product** (Tekmetric API version):
- Zero-dependency Node server (Node >= 22.9) plus the 3D web client. Tests: `cd app && npm test`, 10/10 passing.
- **Server** (`app/server/`):
  - `tekmetric.js`: OAuth client credentials, paging (size 100), request spacing (sandbox 3/s, production 6/s), backoff on 429/5xx.
  - `twin.js` (`ShopTwin`): polls open ROs (statuses 1–3), customers and vehicles (cached 6 h), employees (30 min) and today's appointments (2 min, or right away when a new RO appears).
    - Placement: WIP goes to bays (ROs with a tech first), then side lot, then front lot. Complete goes to the front lot. An estimate created today goes to drop-off. Older estimates are "Not checked in".
    - Status: label containing "part" = waiting on parts; WIP in a bay = in progress; WIP outside a bay = approved/needs bay.
    - Actions: `move`, `plan` (a busy bay can be queued), `unplan`, `autoplan`, and `assignTech`, which writes `PATCH /api/v1/repair-orders/{id} {technicianId}` to Tekmetric when `TEKMETRIC_WRITES=on`.
  - `http.js`: static files, passcode sign-in (HMAC cookie, 30 days), same-origin check, JSON actions, SSE `/api/events` pushing the full state to every screen. `/api/mock/advance` exists only in mock mode.
  - `mock-tekmetric.js`: the documented shapes. "Test Shop Auto Repair" (Houston), 10 open ROs (#10421–#10430), 5 employees (4 techs), 3 appointments today. A script of 11 events (approve, complete, post, arrive...), then random transitions. `rateLimitEvery` can inject 429s.
  - Also `mapping.js`, `store.js` (`data/shop-<id>.json`), `config.js` (env), `index.js`.
- **Web** (`app/web/`):
  - `twin.js` (about 1,200 lines): the scene (parametric 5-bay building, lifts, roll-up doors, lot, street), procedural cars (sedan, SUV, truck, van) with a teardown view, and driving animation (back out, aisle, pull in).
  - UI: KPI strip; board panel (Up next, Bays, Lot, Not checked in, Expected today); RO detail panel; activity log; spot picker in the hint bar.
  - It renders server state and animates differences (`applyState`). Panels redraw only when their HTML changes.
  - Also `layout.js` (spots, shared with the server), `index.html`, `login.html`, and `twin.css` (self-hosted fonts in `web/fonts`).
- **Verified Nov 8 with two separate Chromium browsers against the mock server:**
  - a move on screen A appeared on B
  - a plan from B appeared on A
  - simulated Tekmetric events reached both
  - an assigned tech was written to the mock Tekmetric and appeared on B
  - no console errors
  - Note: in the swiftshader container, two 3D pages starve each other. Use `waitUntil: 'domcontentloaded'` and wait for `#loading` to be removed.

**v0.1: `extension/` is parked.** It's a MV3 Chrome extension that copies JSON from the Tekmetric tab (fetch/XHR/WebSocket hook) and recognizes ROs by their shape. Tested only against a fake Tekmetric page; never run on a real login. Positions are per browser.

**`index.html`** is the old static demo (artifact https://claude.ai/artifact/CPBsJJq64w3RFXQtu7MTCw).

## Ian said (Nov 8)
- The name is **Shop Twin**. It's a work-related project; Ian has said they'll handle the job side, so don't raise it again.
- Main value: managing the workflow and seeing cars move in and out of the shop, triage, what's in each bay, and what's coming next. Big teams need to know where cars are and where they're going next. Teardown/"fix the car in 3D" is a side feature.
- Build to the Tekmetric API. A shop-owner friend will apply for API access. (I advised: the buddy's application is fine for a pilot, but the product's own application should come from Ian or Ian's company, because the credentials belong to whoever applies.)
- Asked whether the extension could save to a website so every browser matches. **Answer given: yes.** The extension becomes a feeder: one PC with Tekmetric open pushes what it sees to the Shop Twin server, and every other screen just opens the twin.
  - Not built yet. Ian hasn't said go. Offer it once the UI is cleaned up.
- **"Too many buttons, all kinds of funky stuff happening. I want to make some adjustments and start building."** That's the current focus.
- Wants a team setup like Course Record (ops agent plus builder, ops restarts the builder). That's this folder `ops/`.
- Old Motor Works (Houston) is the shop to model for real. Ian offered details: bay count, doors, lot. Not received yet; ask for them when the layout editor starts.

## Settings
- Cloud session. Commit attribution lines come from your session's system reminder. Push to the branch your session is configured with.
- Run the dummy shop:
  ```
  cd app && (TEKMETRIC_ENV=mock PORT=8787 MOCK_PORT=8788 MOCK_TICK_SECONDS=60 POLL_SECONDS=4 DATA_DIR=$PWD/data nohup node server/index.js > /tmp/shop-twin.log 2>&1 &)
  ```
  Then `report_preview_port` 8787 "shop twin".
- Playwright: `require('playwright')` works with Chromium preinstalled. Pass `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` for WebGL.
- Tests that start the mock must close it in `t.after()`, or `node --test` hangs.
- Network: package registries are reachable, and api.tekmetric.com is only readable through the Exa/Tavily fetch tools. GitHub works via git and the GitHub MCP.

## Next
1. Start the dummy shop and report the preview port. Tell Ian it's up.
2. **UI cleanup proposal: SENT to Ian Nov 8 ~09:10, waiting for a yes or no on each item.** Picture: `ops/shots/proposal-cleanup.png` (before shots: `ops/shots/before-*.png`). Numbered items: 1 KPIs 8→4 · 2 one View menu, floor plan default · 3 hide "Advance shop day" behind `?demo` · 4 no buttons on board rows (tap row = open RO) · 5 RO panel: Move + "Plan for later" link, Tear down removed · 6 activity collapsed to one line · 7 tags clip / names truncate · phone: compact bar, board as bottom sheet. Also seen: you can plan a car into a bay that's already busy ("Go to Bay 1" while Bay 1 is WIP), which is confusing.
   - Merge the 7 view buttons (Aerial, Street, Inside, Floor plan, Walls, Roof, Tags) into one **View** menu, and make the top-down floor plan the default.
   - Cut the KPIs to 4: bays in use, waiting for a bay, waiting on parts, ready for pickup.
   - RO panel: one main **Move**, "Plan for later" secondary, and **Tear down** under "More" (or remove it).
   - Activity log collapsed by default.
   - Ask Ian what else feels funky, then build what Ian picks, with tests and before/after screenshots.
3. Then offer the next big pieces, one at a time:
   - (a) a layout editor plus the real Motor Works layout (needs Ian's details)
   - (b) the extension-feeder mode (`TEKMETRIC_ENV=extension` plus a `POST /api/feed` endpoint, reusing `extension/data/normalize.js`)
   - (c) TV mode (full screen, no panels)
   - (d) more Tekmetric write-backs (promise time, job completed)
4. Restart protocol: when your context passes about 60%, save this file, push, and message Ops (see `ops/agents/builder.md`).

## Files
- `CLAUDE.md`, `ops/README.md`, `ops/agents/*.md`
- `app/README.md`
- `app/server/*.js`, `app/web/twin.js`, `app/web/layout.js`, `app/test/server.test.js`
- `extension/README.md`
