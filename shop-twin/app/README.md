# Shop Twin (Tekmetric API version)

A live 3D floor plan of an auto repair shop. Every open repair order in Tekmetric shows up as a car in a bay, on the lot or at drop-off. Everyone at the shop sees the same floor on every screen: the office PC, the shop TV, the advisor's laptop.

## How it fits together

```
Tekmetric API ──(server holds the keys, pulls every 30s)──▶ Shop Twin server ──(live push)──▶ every screen at the shop
                                                                 │
                                    stores what Tekmetric has no field for: which spot each car is in,
                                    planned moves ("Up next"), and the activity log
```

- **Tekmetric data** (ROs, statuses, customers, vehicles, jobs, appointments) comes from the API, so it's the same for everyone.
- **Twin data** (car positions and planned moves) is saved once per shop on the server. When someone moves a car, every connected screen sees it within a second.
- **The keys never reach a browser.** Tekmetric credentials give access to every shop that authorized them, so only the server holds them. Browsers sign in with a shop passcode.
- **No Chrome extension needed.** It's a web page. It works on any browser, tablet, phone or TV.

## Try it now (no Tekmetric account needed)

```bash
cd shop-twin/app
npm run mock          # Node 22.9 or newer, no npm install needed
```

Open http://localhost:8787 in two browser windows. Move a car in one and watch it move in the other.

The mock Tekmetric API uses the request and response shapes documented at api.tekmetric.com, and plays out a shop day: estimates get approved, jobs finish, cars get picked up, appointments arrive. Click **Advance shop day** to step through it.

## Connect to Tekmetric

1. Get API credentials (see below).
2. `cp .env.example .env` and fill in `TEKMETRIC_ENV`, `TEKMETRIC_CLIENT_ID` and `TEKMETRIC_CLIENT_SECRET`.
3. Run `npm start`.

Start on `TEKMETRIC_ENV=sandbox`. Switch to `production` once it looks right.

To serve the whole shop, run it on a machine at the shop (or a small cloud server):
- Set `HOST=0.0.0.0` and a `SHOP_TWIN_PASSCODE`.
- If it's reachable from the internet, put it behind HTTPS (for example, Caddy as a reverse proxy).

## Getting API access (from api.tekmetric.com, read November 2026)

- Apply with the API application form linked on api.tekmetric.com. Review takes 2–3 weeks, and third-party applications can be declined.
- **As of this writing, the page says Tekmetric is not processing new API applications** while it updates its security policies, and gives no date.
- A shop owner grants access to their shop. The token's scope lists the shop ids it can read.
- Sandbox is `https://sandbox.tekmetric.com` (300 requests/min). Production is `https://shop.tekmetric.com` (600 requests/min).
- Tokens stay valid until revoked.

## What it reads and writes

| | Endpoint | Used for |
|---|---|---|
| Read | `GET /api/v1/repair-orders?shop=&repairOrderStatusId=1,2,3` | Open ROs: Estimate, Work-in-Progress, Complete |
| Read | `GET /api/v1/customers/{id}`, `GET /api/v1/vehicles/{id}` | Names, phones, year/make/model, VIN (cached) |
| Read | `GET /api/v1/employees?shop=` | Technician names |
| Read | `GET /api/v1/appointments?shop=&start=&end=` | "Expected today" list |
| Write | `PATCH /api/v1/repair-orders/{id}` `{ technicianId }` | Assign a tech from the twin (`TEKMETRIC_WRITES=on`) |

The API has no field for "where the car is parked" and no webhooks, so positions live in Shop Twin and changes arrive by polling.

The API can also write keytag, miles in/out, service writer, promise time, job tech, job completed, the job clock and appointments. Those are candidates for the next write-back features.

## How cars get placed

- Work-in-progress ROs go into bays (ones with a tech first), then the side lot.
- Completed ROs go to the front lot.
- Estimates opened today go to drop-off.
- Older estimates wait under **Not checked in** until someone clicks **Check in**.
- A posted RO drives off the lot. A new RO drives in from the street.
- Anyone can **Move now**, **Plan move** (including behind a busy bay), or **Auto-plan** waiting cars into bays. Everyone sees the result.

## Tests

```bash
npm test
```

10 tests run against the mock API:
- authentication
- paging and 429 backoff
- first-morning layout
- move and plan rules
- auto-plan
- a full shop-day flow
- technician write-back
- positions surviving a restart
- two screens seeing the same move
- passcode and cross-site protection

## Known limits

- The building is a 5-bay test layout (`web/layout.js`). Real shops need a layout editor.
- "Open in Tekmetric" uses a guessed web address pattern (`TEKMETRIC_RO_URL_TEMPLATE`). Check it against a real login.
- One shop per server process for now.
- Appointments aren't linked to the RO they become; an arrived appointment simply drops off the list.

## Files

| Path | What it does |
|---|---|
| `server/tekmetric.js` | API client: token, paging, throttling, 429 backoff |
| `server/twin.js` | The shop state: sync from Tekmetric, placement rules, moves, plans, write-back |
| `server/http.js` | Pages, passcode sign-in, JSON actions, live push (Server-Sent Events) |
| `server/mock-tekmetric.js` | Mock Tekmetric API with a simulated shop day |
| `server/mapping.js` | Tekmetric records to twin repair orders (cents to dollars, body type, colors, job parts) |
| `server/store.js` | Saves positions, plans and activity per shop (`data/shop-<id>.json`) |
| `web/` | The 3D twin (Three.js r160 and fonts bundled; no CDN needed) |
