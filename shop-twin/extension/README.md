# Shop Twin (Chrome extension)

Shop Twin shows your shop in 3D: bays, lot and every open repair order as a car you can see, move and plan. It reads the repair orders your signed-in Tekmetric tab already loads. It needs no API keys and makes no changes to Tekmetric.

## Install (developer mode)

1. Unzip `shop-twin-extension-0.1.0.zip`. You get a folder named `extension`.
2. In Chrome, go to `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder.
4. Pin Shop Twin from the puzzle-piece menu so its icon stays in the toolbar.

## Use it

1. Open Tekmetric and sign in. If Tekmetric was already open before you installed Shop Twin, reload that tab once.
2. Go to the job board. A **Shop Twin** button appears at the bottom left of Tekmetric with a count of the repair orders it sees.
3. Click that button (or the toolbar icon) to open the twin.
4. Open any single repair order in Tekmetric once. Shop Twin learns the link format, and **Open in Tekmetric** then jumps straight to the RO.

Until it sees Tekmetric data, the twin shows example repair orders. **Show demo** switches back to them at any time, which is useful for demos.

## In the twin

- Work-in-progress ROs go into open bays, completed ROs go into the front lot, and estimates opened today go to drop-off. Older estimates wait under **Not checked in** until someone clicks **Check in**.
- **Move now** drives a car to a spot. **Plan move** reserves a spot (including a busy bay) and adds the car to **Up next**. **Auto-plan** fills bays with waiting cars.
- A car whose RO is posted in Tekmetric drives off the lot. A new RO in Tekmetric drives in from the street.
- RO details, statuses, labels, jobs and amounts come from Tekmetric and are read-only here. Tekmetric is the source of record.

## The Data page (send this to the developer)

Click **Data** in the twin's top bar. It shows what Shop Twin has picked up and whether it recognized repair orders.

**Copy structure report** copies the addresses Tekmetric's app called and the field names it got back. Every value is replaced by its type, so the report contains no customer names, phone numbers, VINs or amounts. That report is what's needed to tune Shop Twin to Tekmetric's real data.

## Privacy

- Shop Twin only runs on `*.tekmetric.com`. It copies JSON responses the Tekmetric page already received. It never reads cookies or request headers, and it skips login, token, session and payment addresses.
- Customer data is kept in `chrome.storage.session`, which lives in memory and is cleared when Chrome closes. Nothing is sent anywhere.
- Car positions and planned moves (RO ids and spot names only) are saved in `chrome.storage.local` so they survive a restart.

## Known limits (v0.1)

- Recognition is built on Tekmetric's published data model (`repairOrderNumber`, `repairOrderStatus`, `jobs[].authorized`, amounts in cents). Tekmetric's web app may use different field names. If the Data page shows responses but zero repair orders, send the structure report.
- Shop Twin only knows the ROs your Tekmetric tab has loaded. Keep the job board open.
- Positions and plans are per browser. Two people on two computers each have their own floor plan until a shared backend exists.
- The building is a 5-bay test layout. A layout editor for real shops comes next.
- It reads Tekmetric's private web traffic, not a supported API. A Tekmetric release can change that traffic without notice.

## Files

| Path | What it does |
|---|---|
| `manifest.json` | Manifest V3; runs only on `*.tekmetric.com` |
| `capture/page-hook.js` | Runs inside the Tekmetric page and copies JSON responses (fetch, XHR, WebSocket) |
| `capture/bridge.js` | Relays them to the extension, learns RO links, shows the launcher button |
| `background.js` | Service worker: recognition, storage, "Open in Tekmetric" |
| `data/normalize.js` | Shape-based recognition of ROs, customers, vehicles and staff; structure report helpers |
| `data/live.js` | Maps captured records to twin repair orders; saves layout |
| `data/demo.js` | Example repair orders for demo mode |
| `twin.html`, `twin.css`, `twin.js` | The 3D shop (Three.js r160, bundled in `vendor/`) |
| `capture.html`, `capture.js` | The Data page and structure report |
