# Five-Bay Shop Twin (prototype)

A 3D view of an auto repair shop that is driven by its shop management system (SMS) data: which car is in which bay, what is waiting on the lot, what goes in next, and what each repair order (RO) is worth.

This folder is a single-file Three.js prototype that runs on mock data. Open `index.html` in a browser; it loads Three.js r160 from jsDelivr.

## What it does today

- **Site and building**: a parametric 5-bay shop with an office, roll-up doors, 2-post lifts, a parking lot (drop-off, front row, side lot), the street and a driveway.
- **See inside**: "Walls down" lowers the walls to a floor-plan outline. "Roof off" lifts the roof. The "Floor plan" view does both and looks straight down.
- **Every vehicle is an RO**: click a car (or a row on the board) to see the customer, vehicle, VIN, concern, jobs, approved and pending dollars, tech, and promised time.
- **Dispatch**:
  - *Move now* drives the car there. It backs out of its spot, drives the aisle, and pulls in. Bay doors open on the way.
  - *Plan move* reserves a spot and draws an arrow. You can queue a car behind a bay that is still busy.
  - The *Up next* queue shows each planned move. *Go* runs it once the spot is clear.
  - *Auto-plan* assigns approved, waiting cars to bays. Open bays go first, then bays whose car is closest to done.
  - Cars marked *In progress* in a bay go up on the lift.
- **Status and approval**: change the status, approve pending jobs, or mark *Customer picked up*. The car then drives off and the RO closes.
- **Simulate drop-off**: a new car arrives from the street, parks, and opens a new RO in Estimate.
- **Teardown (secondary)**: an exploded view of a generic body that lights up the parts the RO's jobs touch, such as brakes, engine, battery, A/C, suspension or exhaust.
- **Sync log**: every change shows as the write it would send back to the SMS. Nothing leaves the page.
- Day scene in light mode, dusk in dark mode. Works at phone width.

## Scope: what's real and what's hard

| Piece | Difficulty | Notes |
|---|---|---|
| 3D shop shell from measurements | Low | Parametric (bays, doors, lot stalls) beats photogrammetry for v1. A layout editor plus a satellite footprint gets you 90% of the value. |
| Photo/drone scan of the real building | Medium | Gaussian-splat or photogrammetry capture is doable now, but it's a capture-and-processing pipeline per shop, not a feature. Do it later, for the hero shops. |
| Live SMS data (read) | **Gated** | Needs partner API access from the SMS vendor (OAuth credentials, a sandbox, an approval process). This is the critical path. Nothing else matters if you can't get it. |
| Write-back (move, status, approve) | **Gated + risky** | Depends on which write endpoints the vendor exposes. "Location in the lot" may not exist as a field at all, so the twin may need its own store for spot assignments. |
| Chrome extension | Medium | Possible (Manifest V3 side panel, Three.js bundled locally because MV3 blocks remote code). It could read the SMS page the user already has open. But scraping your own employer's or partner's UI is a policy question, not a technical one. Settle that first. |
| Vehicle models | Low (generic) / Very high (accurate) | Generic body types keyed by VIN decode (the free NHTSA vPIC API gives body class) are fine. Make/model-accurate, disassemblable models across all year/make/model combinations are a content business of their own. |
| Collision-free routing, multi-user live state | Medium | Needs a real lot graph and a shared backend (websocket) so a 6-tech team sees the same board. |

## Suggested next steps

1. Get sandbox API access and replace the `ros` array with a data adapter (`listOpenROs`, `updateStatus`, `approveJobs`). Keep spot assignments in the twin's own store until you know what the SMS can hold.
2. Build a layout editor: drag bays, stalls and doors on a top-down grid and save them as JSON. That's how a second shop gets onboarded in minutes instead of hand-coded.
3. Capture the real shop you have in mind (dimensions, bay count, door positions, lot) as the first real layout.
4. Pilot with one shop owner: does the board plus 3D change how they dispatch, or is it a nice demo? Measure that before building the extension.

## Code map (`index.html`)

1. Mock SMS data (`ros`, `STATUS`, `ARRIVAL_POOL`)
2. Shop layout (`SPOTS`, each with a route to the aisle)
3. Renderer, scene, lights
4. Site (lot, striping, street, trees)
5. Building (walls group, roof group, doors, lifts, props)
6. Procedural vehicles plus teardown parts
7. Movement (route, back out, turn, pull in, wait for door and lift)
8. App state and actions (move, plan, auto-plan, approve, pickup, arrival, teardown)
9. Camera views
10. UI rendering (KPIs, board, RO detail, sync log)
11. Picking
12. Theme
13. Boot and render loop

All customers, VINs and phone numbers are fictional (555 numbers).
