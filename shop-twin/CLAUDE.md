# Shop Twin: instructions for every agent

Shop Twin is a live 3D floor plan of an auto repair shop, fed by Tekmetric. Bays, lot and every open repair order show as cars you can see, move and plan, like a restaurant host's floor plan. Tekmetric stays the source of record; Shop Twin adds where each car is and what goes in next.

**Where this lives:** `scrubzillla/shop-twin` once Ian creates it. Until then it's the `shop-twin/` folder on branch `claude/3d-shop-visualizer-kijam9` of `scrubzillla/claude-mem`. claude-mem is an unrelated project: ignore its root CLAUDE.md (the dependency-upgrade "daily maintenance" and plugin notes are not for you). Never change anything outside `shop-twin/` there.

**The team** (see `ops/README.md`):
- **Builder** builds the product.
- **Ops** keeps Builder running, restarts it from its handoff, and does repo and admin work.
- Each agent's role is in `ops/agents/<handle>.md`. Each keeps `ops/handoffs/<handle>.md` current.

## Run it

```bash
cd app && npm run mock     # Node >= 22.9, no npm install; mock Tekmetric + simulated shop day
npm test                   # 14 tests, about 3 s; npm run check:ui = Playwright check of the screen (needs the mock running)
```

The page is at http://localhost:8787, and the mock API runs on port 8788. In a cloud session, start it in the background and tell Ian the port with `report_preview_port` (name "shop twin"). In mock mode, `MOCK_TICK_SECONDS` sets how often a shop event happens, and View → **Advance shop day** (shown only with `?demo` in the URL) forces one.

## Layout of the code

- `app/server/`: zero-dependency Node.
  - `tekmetric.js`: API client
  - `twin.js`: shop state, placement rules, actions
  - `http.js`: pages, passcode, JSON actions, SSE live push
  - `mock-tekmetric.js`: mock API with the documented shapes
  - `mapping.js`: Tekmetric record → twin RO
  - `store.js`: JSON per shop
- `app/web/`: the 3D client (Three.js r160 and fonts bundled, no CDN).
  - `twin.js`: scene, cars, UI
  - `layout.js`: spots, shared with the server
- `extension/`: parked v0.1 Chrome extension that reads the Tekmetric tab. `index.html` is the old static demo.

## Rules

- **Ian is visual.** Mock or screenshot any screen change and show Ian before or as you build it. Check it at phone width (390 px) too.
- **Fewer buttons.** Ian's feedback (Nov 8): "too many buttons, all kinds of funky stuff." Default to removing and merging controls, not adding them.
- **Every behavior change gets a test** in `app/test/server.test.js` (server) or a Playwright check (client). Run `npm test` before every commit.
- **Secrets:**
  - Never commit `.env`, credentials or real customer data.
  - Tekmetric keys live only in the server's `.env`.
  - Never ask Ian to paste keys into chat.
- **Commits:**
  - Commit and push after every finished step.
  - Run `git pull --rebase` first: Ops and Builder share the branch.
  - End every message with the attribution lines your session gives you.
- **Tekmetric facts** (api.tekmetric.com, read Nov 8, 2026):
  - OAuth client credentials. The token is valid until revoked, and its scope lists shop ids.
  - Money is in cents. RO statuses: 1 Estimate, 2 WIP, 3 Complete, 4 Saved, 5 Posted, 6 A/R, 7 Deleted.
  - Pages hold at most 100 items. Limits: 600 requests/min in production, 300 in sandbox.
  - No webhooks.
  - Writable fields: RO keyTag, miles, technician, service writer, promise time (`customerTimeOut`); job tech, completed, notes; job clock; appointments.
  - **New API applications are paused**, with no date given.
- **Session network:** api.tekmetric.com doesn't resolve from WebFetch here. Read the docs with the Exa or Tavily fetch tools.
