// Shop Twin client: renders the shop state from the Shop Twin server (same for every screen) and sends actions back.
import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from './vendor/CSS2DRenderer.js';
import { RoomEnvironment } from './vendor/RoomEnvironment.js';
import { Sky } from './vendor/Sky.js';
import { sunPosition } from './sun.js';
import { SPOT_DEFS, STREET_IN_DEF, STREET_OUT_DEF, BAY_W, BAY_X0, WALL_H, DOOR_W, DOOR_H, bayX } from './layout.js';

const PI = Math.PI;
const $ = (s) => document.querySelector(s);
const money = (n) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vehName = (v) => [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle';
const angDiff = (a, b) => { let d = b - a; while (d > PI) d -= 2 * PI; while (d < -PI) d += 2 * PI; return d; };

/* =========================================================================
   1. SHOP-SYSTEM DATA (mock). Shape mirrors what an SMS adapter would return.
   ========================================================================= */
const STATUS = {
  estimate: { label: 'Estimate', short: 'EST' },
  approved: { label: 'Approved · needs bay', short: 'APPR' },
  wip: { label: 'In progress', short: 'WIP' },
  parts: { label: 'Waiting on parts', short: 'PARTS' },
  ready: { label: 'Ready for pickup', short: 'READY' },
};
const PART_NAMES = {
  brakes: 'Brake rotors & calipers', engine: 'Engine', battery: 'Battery', cooling: 'A/C condenser & radiator',
  suspension: 'Struts & springs', exhaust: 'Exhaust', wheels: 'Wheels & tires', other: 'General',
};
const TECHS = ['Luis R.', 'Andre M.', 'Kim T.', 'Jorge S.'];

const ros = [];
const MODE = { meta: null, connected: false, first: true };

/* =========================================================================
   2. SHOP LAYOUT (shared with the server in layout.js)
   ========================================================================= */
const V = (x, z) => new THREE.Vector3(x, 0, z);
const toSpot = (d) => ({ ...d, pos: V(d.x, d.z), route: d.route.map(([x, z]) => V(x, z)) });
const SPOTS = SPOT_DEFS.map(toSpot);
const STREET_IN = toSpot(STREET_IN_DEF);
const STREET_OUT = toSpot(STREET_OUT_DEF);
const spotById = Object.fromEntries(SPOTS.map((s) => [s.id, s]));
const occupant = (spotId) => ros.find((r) => r.location === spotId && !r.closed);

/* =========================================================================
   3. RENDERER, SCENE, LIGHTS
   ========================================================================= */
const stage = $('#stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
stage.prepend(renderer.domElement);

const labelRenderer = new CSS2DRenderer({ element: $('#labels') });
labelRenderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
scene.fog = new THREE.Fog(0xcdd6db, 70, 190);

const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.3, 500);
camera.position.set(34, 30, 46);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(2, 0, 0);
controls.enableDamping = true;
controls.maxPolarAngle = PI / 2 - 0.04;
controls.minDistance = 4;
controls.maxDistance = 140;

const hemi = new THREE.HemisphereLight(0xdfe9f2, 0x5b5a52, 0.7);
scene.add(hemi);
// canvas textures need the webfonts loaded first (bounded wait)
await Promise.race([Promise.all(['700 92px "Barlow Condensed"', '600 26px "IBM Plex Sans"'].map((f) => document.fonts.load(f))).catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
const sun = new THREE.DirectionalLight(0xfff0d8, 2.6);
sun.position.set(-28, 46, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 140 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
sun.target.position.set(3, 0, 2);
scene.add(sun, sun.target);
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.radius = 3;

/* ---------- live sky: the sun sits where it really is over the shop right now ---------- */
const SHOP_GEO = { lat: 29.76, lon: -95.37 }; // Houston; later from the shop's address
const skyDome = new Sky(); skyDome.scale.setScalar(450); scene.add(skyDome);
Object.assign(skyDome.material.uniforms, {});
skyDome.material.uniforms.turbidity.value = 6;
skyDome.material.uniforms.rayleigh.value = 1.4;
skyDome.material.uniforms.mieCoefficient.value = 0.004;
skyDome.material.uniforms.mieDirectionalG.value = 0.8;
const sunDir = new THREE.Vector3();
function liveSun() {
  const { el, az } = sunPosition(Date.now(), SHOP_GEO.lat, SHOP_GEO.lon);
  const shown = Math.max(el, 6 * PI / 180); // at night keep a low sun so the yard still reads; the dark theme handles night
  // scene: -z is north (building back wall), +x east
  sunDir.set(Math.sin(az) * Math.cos(shown), Math.sin(shown), -Math.cos(az) * Math.cos(shown));
  skyDome.material.uniforms.sunPosition.value.copy(sunDir);
  sun.position.copy(sunDir).multiplyScalar(60).add(sun.target.position);
  const low = 1 - Math.min(1, shown / (35 * PI / 180));
  sun.color.setHSL(0.09, 0.55 * low + 0.15, 0.62 + 0.25 * (1 - low));
  sun.intensity = 2.0 + 1.0 * (1 - low);
}
liveSun(); setInterval(liveSun, 60000);

const bayLights = [], poleLights = [];

/* ---------- textures ---------- */
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
const noise = (ctx, w, h, base, spread, n) => {
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const v = Math.random() * spread - spread / 2;
    ctx.fillStyle = `rgba(${v > 0 ? '255,255,255' : '0,0,0'},${Math.abs(v)})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
};
const asphaltTex = canvasTex(512, 512, (c, w, h) => noise(c, w, h, '#45494b', 0.22, 26000), [10, 8]);
const concreteTex = canvasTex(512, 512, (c, w, h) => {
  noise(c, w, h, '#b9b9b2', 0.1, 9000);
  c.strokeStyle = 'rgba(0,0,0,0.12)'; c.lineWidth = 2; c.strokeRect(0, 0, w, h);
}, [6, 3]);
const epoxyTex = canvasTex(512, 512, (c, w, h) => noise(c, w, h, '#8d969a', 0.12, 12000), [6, 3]);
const doorTex = canvasTex(256, 256, (c, w, h) => {
  c.fillStyle = '#e4e4de'; c.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 16) {
    const g = c.createLinearGradient(0, y, 0, y + 16);
    g.addColorStop(0, '#f3f3ee'); g.addColorStop(0.75, '#d6d6cf'); g.addColorStop(1, '#a9a9a2');
    c.fillStyle = g; c.fillRect(0, y, w, 16);
  }
  c.fillStyle = '#2b3740';
  for (let x = 14; x < w - 20; x += 46) c.fillRect(x, 66, 34, 18);
});
function textTex(text, opt = {}) {
  const { w = 512, h = 128, bg = null, fg = '#111', font = '700 76px "Barlow Condensed", Arial Narrow, sans-serif', sub = null } = opt;
  return canvasTex(w, h, (c) => {
    if (bg) { c.fillStyle = bg; c.fillRect(0, 0, w, h); }
    c.fillStyle = fg; c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = font;
    c.fillText(text, w / 2, sub ? h * 0.4 : h / 2);
    if (sub) { c.font = '600 26px "IBM Plex Sans", sans-serif'; c.fillText(sub, w / 2, h * 0.8); }
  });
}

/* ---------- materials ---------- */
const M = {
  asphalt: new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.96 }),
  grass: new THREE.MeshStandardMaterial({ map: canvasTex(512, 512, (c, w, h) => noise(c, w, h, '#7b8a5c', 0.18, 30000), [60, 60]), roughness: 1 }),
  concrete: new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.9 }),
  epoxy: new THREE.MeshStandardMaterial({ map: epoxyTex, roughness: 0.42, metalness: 0.05 }),
  street: new THREE.MeshStandardMaterial({ color: 0x2c3032, roughness: 0.95 }),
  paintWhite: new THREE.MeshStandardMaterial({ color: 0xf2f2ec, roughness: 0.7 }),
  paintYellow: new THREE.MeshStandardMaterial({ color: 0xf2c21b, roughness: 0.6 }),
  wall: new THREE.MeshStandardMaterial({ color: 0xd8d1c1, roughness: 0.92 }),
  wallInner: new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.92 }),
  fascia: new THREE.MeshStandardMaterial({ color: 0x27323a, roughness: 0.6, metalness: 0.2 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x9da2a3, roughness: 0.85, transparent: true }),
  alum: new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.35, metalness: 0.8 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x9cc3d6, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.32, emissive: 0x000000 }),
  door: new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.5, metalness: 0.25 }),
  lift: new THREE.MeshStandardMaterial({ color: 0xe5ad0c, roughness: 0.45, metalness: 0.3 }),
  liftDark: new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5, metalness: 0.6 }),
  toolbox: new THREE.MeshStandardMaterial({ color: 0xb3221c, roughness: 0.35, metalness: 0.4 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x8a6b4a, roughness: 0.7 }),
  rubber: new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 0.92 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x5b4632, roughness: 1 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x3f5a2e, roughness: 0.9 }),
  pad: new THREE.MeshBasicMaterial({ color: 0xf2b705, transparent: true, opacity: 0.32, depthWrite: false }),
  padHover: new THREE.MeshBasicMaterial({ color: 0xf2b705, transparent: true, opacity: 0.7, depthWrite: false }),
};

function box(w, h, d, mat, x = 0, y = 0, z = 0, parent = scene, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = shadow; m.receiveShadow = true;
  parent.add(m);
  return m;
}
function flat(w, d, mat, x, y, z, parent = scene, rotY = 0) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
  m.rotation.set(-PI / 2, 0, rotY);
  m.position.set(x, y, z);
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

/* =========================================================================
   4. SITE: ground, lot striping, street, trees, poles
   ========================================================================= */
flat(600, 600, M.grass, 0, -0.02, 0);
flat(46, 36, M.asphalt, 3.5, 0, 1);              // lot: x -19.5..26.5, z -17..19
flat(600, 10, M.street, 0, 0.002, 27);           // street z 22..32
for (let x = -300; x < 300; x += 6) flat(3, 0.15, M.paintYellow, x, 0.012, 27);
box(21, 0.12, 2.6, M.concrete, -10.5 - 0.5, 0.06, 20.3);   // sidewalk left of driveway
box(240, 0.12, 2.6, M.concrete, -10.5 - 0.5 - 130.5, 0.06, 20.3);
box(23, 0.12, 2.6, M.concrete, 15, 0.06, 20.3);  // sidewalk right of driveway
box(240, 0.12, 2.6, M.concrete, 146.5, 0.06, 20.3);
flat(4, 2.6, M.concrete, 1.5, 0.01, 20.3);        // driveway apron

// stall striping
const STRIPE = 0.12;
function stallLines(spot, w, l) {
  const g = new THREE.Group();
  [-w / 2, w / 2].forEach((dz) => flat(l, STRIPE, M.paintWhite, 0, 0.012, dz, g));
  g.position.copy(spot.pos);
  g.rotation.y = spot.heading;
  scene.add(g);
}
SPOTS.filter((s) => s.type !== 'bay').forEach((s) => stallLines(s, s.type === 'drop' ? 2.4 : 3.0, 5.4));
// drop-off text
const dropTex = textTex('CUSTOMER DROP-OFF', { w: 512, h: 64, fg: '#f2f2ec', font: '700 44px "Barlow Condensed", sans-serif' });
const dropMat = new THREE.MeshBasicMaterial({ map: dropTex, transparent: true, depthWrite: false });
flat(4.8, 0.6, dropMat, -11, 0.013, 6.6);
// bay apron guide lines
for (let i = 0; i <= 5; i++) flat(STRIPE * 1.2, 4.4, M.paintYellow, BAY_X0 + BAY_W * i, 0.012, 2.2);

// trees and light poles
function tree(x, z, s = 1) {
  const g = new THREE.Group();
  box(0.3 * s, 2.4 * s, 0.3 * s, M.trunk, 0, 1.2 * s, 0, g);
  // a loose canopy of overlapping blobs reads as foliage; a single faceted ball reads as a toy
  for (let i = 0; i < 7; i++) {
    const r = (1.0 + Math.random() * 0.7) * s, a = Math.random() * 2 * PI;
    const f = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 3), M.leaf);
    f.position.set(Math.cos(a) * 0.9 * s, (3.3 + Math.random() * 1.6) * s, Math.sin(a) * 0.9 * s);
    f.scale.y = 0.85; f.castShadow = true; f.receiveShadow = true; g.add(f);
  } g.position.set(x, 0, z); g.rotation.y = Math.random() * 6; scene.add(g);
}
[[-23, -14], [-23, -4], [-23, 8], [-22, 17], [29, -14], [29, -3], [29, 10], [-6, -20], [12, -20], [24, 18]].forEach(([x, z], i) => tree(x, z, 0.85 + (i % 3) * 0.15));
function pole(x, z) {
  box(0.22, 8, 0.22, M.alum, x, 4, z);
  box(1.2, 0.18, 0.5, M.alum, x, 8, z);
  const pl = new THREE.PointLight(0xffe2b0, 0, 30, 1.6); pl.position.set(x, 7.7, z); scene.add(pl); poleLights.push(pl);
}
pole(-18.2, 10); pole(24.8, 10); pole(24.8, -10);

/* =========================================================================
   5. BUILDING: slab, walls (pull-down), roll-up doors, roof, lifts, props
   ========================================================================= */
const T = 0.25;
box(30, 0.04, 12, M.epoxy, 0, 0, -6, scene, false);
const walls = new THREE.Group(); scene.add(walls);
const roof = new THREE.Group(); scene.add(roof);

// perimeter + office partition
box(30, WALL_H, T, M.wall, 0, WALL_H / 2, -12 + T / 2, walls);
box(T, WALL_H, 12, M.wall, -15 + T / 2, WALL_H / 2, -6, walls);
box(T, WALL_H, 12, M.wall, 15 - T / 2, WALL_H / 2, -6, walls);
box(T, WALL_H, 12, M.wallInner, BAY_X0, WALL_H / 2, -6, walls);
// office storefront
const offW = 7.5, offX = -11.25;
box(offW, 0.6, T, M.fascia, offX, 0.3, -T / 2, walls);
const glassFront = box(offW - 0.2, 2.6, 0.06, M.glass, offX, 1.9, -T / 2, walls, false);
glassFront.receiveShadow = false;
box(offW, WALL_H - 3.2, T, M.wall, offX, 3.2 + (WALL_H - 3.2) / 2, -T / 2, walls);
for (let k = 0; k <= 4; k++) box(0.08, 2.6, 0.12, M.alum, offX - offW / 2 + 0.1 + k * ((offW - 0.2) / 4), 1.9, -T / 2, walls, false);
// bay front: header + piers
const bayRun = BAY_W * 5;
box(bayRun, WALL_H - DOOR_H, T, M.wall, BAY_X0 + bayRun / 2, DOOR_H + (WALL_H - DOOR_H) / 2, -T / 2, walls);
for (let k = 0; k <= 5; k++) {
  const pw = BAY_W - DOOR_W, x = BAY_X0 + BAY_W * k;
  const w = k === 0 || k === 5 ? pw / 2 : pw;
  const cx = k === 0 ? x + w / 2 : k === 5 ? x - w / 2 : x;
  box(w, DOOR_H, T, M.wall, cx, DOOR_H / 2, -T / 2, walls);
}
// roll-up doors (pivot at top so scaling Y "rolls" them up)
const doors = [];
for (let i = 0; i < 5; i++) {
  const geo = new THREE.BoxGeometry(DOOR_W, DOOR_H, 0.08); geo.translate(0, -DOOR_H / 2, 0);
  const d = new THREE.Mesh(geo, M.door); d.castShadow = d.receiveShadow = true;
  d.position.set(bayX(i), DOOR_H, -0.14);
  walls.add(d);
  const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, DOOR_W + 0.1, 16), M.alum);
  coil.rotation.z = PI / 2; coil.position.set(bayX(i), DOOR_H + 0.3, -0.5); walls.add(coil);
  doors.push({ mesh: d, open: 0, target: 0 });
}
// fascia + sign on parapet
const parapet = box(30.6, 1.0, 0.3, M.fascia, 0, WALL_H + 0.5, 0.1, roof);
const signTex = textTex('TEST SHOP AUTO REPAIR', { w: 1024, h: 128, fg: '#f2c21b', font: '700 92px "Barlow Condensed", Arial Narrow, sans-serif' });
const sign = new THREE.Mesh(new THREE.PlaneGeometry(11, 1.4), new THREE.MeshStandardMaterial({ map: signTex, transparent: true, roughness: 0.5, emissive: 0x000000 }));
sign.position.set(-1, WALL_H + 0.5, 0.27); roof.add(sign);
box(30.6, 0.3, 12.6, M.roof, 0, WALL_H + 0.15, -6, roof);
box(1.6, 0.9, 1.2, M.liftDark, 6, WALL_H + 0.75, -7, roof);      // RTU
box(1.6, 0.9, 1.2, M.liftDark, -10, WALL_H + 0.75, -5, roof);
roof.traverse((o) => { if (o.material && o !== sign) o.material = M.roof; });
parapet.material = M.fascia.clone(); parapet.material.transparent = true;
const roofMats = [M.roof, parapet.material, sign.material];

// bay interiors: lifts, floor numbers, toolboxes, lights
const lifts = [];
for (let i = 0; i < 5; i++) {
  const cx = bayX(i), cz = -6.3;
  [-1, 1].forEach((s) => {
    box(0.34, 3.9, 0.34, M.lift, cx + s * 1.95, 1.95, cz);
    box(0.7, 0.06, 0.7, M.liftDark, cx + s * 1.95, 0.03, cz);
  });
  box(4.24, 0.22, 0.28, M.lift, cx, 3.98, cz);
  const carriage = new THREE.Group(); carriage.position.set(cx, 0, cz); scene.add(carriage);
  [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(([sx, sz]) => {
    const a = box(1.15, 0.08, 0.14, M.liftDark, sx * 1.35, 0.14, sz * 0.75, carriage);
    a.rotation.y = sx * sz * 0.55;
  });
  [-1, 1].forEach((s) => box(0.42, 0.5, 0.42, M.lift, s * 1.95, 0.4, 0, carriage));
  lifts.push(carriage);
  flat(STRIPE, 11.4, M.paintYellow, BAY_X0 + BAY_W * i + (i === 0 ? 0.2 : 0), 0.025, -6);
  const num = new THREE.MeshBasicMaterial({ map: textTex(String(i + 1), { w: 128, h: 128, fg: '#f2c21b', font: '700 120px "Barlow Condensed", sans-serif' }), transparent: true, depthWrite: false });
  flat(1.3, 1.3, num, cx, 0.026, -1.4);
  const tb = box(1.3, 1.1, 0.55, M.toolbox, cx + 1.35, 0.55, -11.5);
  for (let k = 0; k < 4; k++) box(1.2, 0.02, 0.02, M.alum, cx + 1.35, 0.25 + k * 0.22, -11.22, scene, false);
  tb.castShadow = true;
  const bl = new THREE.PointLight(0xf4f1e6, 18, 16, 1.8); bl.position.set(cx, WALL_H - 0.5, -6); scene.add(bl); bayLights.push(bl);
  box(0.25, 0.06, 2.4, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfffbf0, emissiveIntensity: 1.2 }), cx, WALL_H - 0.08, -6, scene, false);
}
// tire rack + compressor along the right wall
for (let s = 0; s < 4; s++) for (let k = 0; k < 4; k++) {
  const t = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.13, 10, 24), M.rubber);
  t.rotation.x = PI / 2; t.position.set(14.35, 0.14 + k * 0.27, -10.6 + s * 0.85); t.castShadow = true; scene.add(t);
}
box(0.7, 1.4, 0.7, new THREE.MeshStandardMaterial({ color: 0x2f6aa8, roughness: 0.4, metalness: 0.4 }), 14.4, 0.7, -2);
// office: counter, chairs, desk, screen
box(3.2, 1.05, 0.75, M.wood, -11.5, 0.52, -4.2);
box(3.3, 0.06, 0.85, M.fascia, -11.5, 1.07, -4.2);
box(0.55, 0.38, 0.05, new THREE.MeshStandardMaterial({ color: 0x0b1116, emissive: 0x3a6e9e, emissiveIntensity: 0.6 }), -11.0, 1.32, -4.35, scene, false);
for (let k = 0; k < 4; k++) box(0.55, 0.85, 0.55, M.fascia, -14.1 + k * 0.7, 0.42, -1.2);
box(1.6, 1.8, 0.6, M.wood, -9, 0.9, -11.4);
const plant = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45, 1), M.leaf); plant.position.set(-14.4, 1.1, -0.6); scene.add(plant);
box(0.4, 0.6, 0.4, M.fascia, -14.4, 0.3, -0.6);
const officeLight = new THREE.PointLight(0xffe4bd, 10, 12, 1.8); officeLight.position.set(-11.2, 4.4, -5); scene.add(officeLight);

/* =========================================================================
   6. PROCEDURAL VEHICLES — exploded "teardown" parts keyed to job types
   ========================================================================= */
const BODY = {
  sedan: { L: 4.8, W: 1.84, belt: 0.98, roof: 1.45, wb: 2.8, r: 0.34, ca: -1.6, cb: 1.0, fr: 0.75, rr: 0.55 },
  suv:   { L: 4.85, W: 1.92, belt: 1.12, roof: 1.76, wb: 2.82, r: 0.38, ca: -2.2, cb: 0.72, fr: 0.6, rr: 0.14 },
  truck: { L: 5.8, W: 2.0, belt: 1.18, roof: 1.95, wb: 3.6, r: 0.42, ca: -0.75, cb: 1.05, fr: 0.5, rr: 0.04, bed: true },
  van:   { L: 5.9, W: 2.05, belt: 1.2, roof: 2.55, wb: 3.5, r: 0.38, ca: -2.85, cb: 1.65, fr: 0.85, rr: 0.03, cargo: true },
};
const geoCache = {};
function bodyGeos(type) {
  if (geoCache[type]) return geoCache[type];
  const { L, W, belt, roof: top, wb, r, ca, cb, fr, rr, cargo } = BODY[type];
  const c = 0.24, R = r + 0.07, xf = wb / 2 + 0.05, xr = -wb / 2 + 0.05;
  const s = new THREE.Shape();
  s.moveTo(-L / 2, c + 0.15);
  s.lineTo(-L / 2, belt - 0.1);
  s.quadraticCurveTo(-L / 2, belt, -L / 2 + 0.18, belt);
  s.lineTo(L / 2 - 0.6, belt - 0.07);
  s.quadraticCurveTo(L / 2, belt - 0.1, L / 2, belt - 0.38);
  s.lineTo(L / 2, c + 0.15);
  s.quadraticCurveTo(L / 2, c, L / 2 - 0.18, c);
  s.lineTo(xf + R, c);
  s.absarc(xf, r, R, 0, PI, false);
  s.lineTo(xf - R, c);
  s.lineTo(xr + R, c);
  s.absarc(xr, r, R, 0, PI, false);
  s.lineTo(xr - R, c);
  s.lineTo(-L / 2 + 0.18, c);
  s.quadraticCurveTo(-L / 2, c, -L / 2, c + 0.15);
  const body = new THREE.ExtrudeGeometry(s, { depth: W - 0.1, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3, curveSegments: 20 });
  body.translate(0, 0, -(W - 0.1) / 2);

  const xg = cargo ? cb - 1.3 : ca;
  const g = new THREE.Shape();
  g.moveTo(xg, belt - 0.04);
  if (cargo) g.lineTo(xg, top - 0.04); else g.lineTo(ca + rr, top - 0.04);
  g.quadraticCurveTo((cargo ? xg : ca + rr) + 0.02, top, (cargo ? xg : ca + rr) + 0.12, top);
  g.lineTo(cb - fr - 0.12, top);
  g.quadraticCurveTo(cb - fr + 0.02, top, cb - fr + 0.05, top - 0.05);
  g.lineTo(cb, belt - 0.04);
  g.lineTo(xg, belt - 0.04);
  const glass = new THREE.ExtrudeGeometry(g, { depth: W - 0.36, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.06, bevelSegments: 3, curveSegments: 12 });
  glass.translate(0, 0, -(W - 0.36) / 2);

  let cargoGeo = null;
  if (cargo) {
    const k = new THREE.Shape();
    k.moveTo(ca, belt - 0.04); k.lineTo(ca, top - 0.12);
    k.quadraticCurveTo(ca, top, ca + 0.12, top);
    k.lineTo(xg, top); k.lineTo(xg, belt - 0.04); k.lineTo(ca, belt - 0.04);
    cargoGeo = new THREE.ExtrudeGeometry(k, { depth: W - 0.3, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3 });
    cargoGeo.translate(0, 0, -(W - 0.3) / 2);
  }
  const tire = new THREE.CylinderGeometry(r, r, 0.27, 36); tire.rotateX(PI / 2);
  const rim = new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.28, 28); rim.rotateX(PI / 2);
  const rotor = new THREE.CylinderGeometry(r * 0.55, r * 0.55, 0.04, 28); rotor.rotateX(PI / 2);
  return (geoCache[type] = { body, glass, cargo: cargoGeo, tire, rim, rotor, xf, xr, xg });
}

const SHARED = {
  rim: new THREE.MeshStandardMaterial({ color: 0xc9ced3, metalness: 0.9, roughness: 0.25 }),
  spoke: new THREE.MeshStandardMaterial({ color: 0x8d949a, metalness: 0.9, roughness: 0.3 }),
  grille: new THREE.MeshStandardMaterial({ color: 0x15181b, roughness: 0.6, metalness: 0.4 }),
  head: new THREE.MeshStandardMaterial({ color: 0xf6f4ea, emissive: 0xfff6d8, emissiveIntensity: 0.5, roughness: 0.2 }),
  tail: new THREE.MeshStandardMaterial({ color: 0x9e1010, emissive: 0xc01010, emissiveIntensity: 0.5, roughness: 0.3 }),
  bed: new THREE.MeshStandardMaterial({ color: 0x1b1d1f, roughness: 0.95 }),
};
const partMat = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.55, ...opts });

const carsGroup = new THREE.Group(); scene.add(carsGroup);
const cars = new Map();

function makeCar(ro) {
  const v = ro.vehicle, P = BODY[v.body], G = bodyGeos(v.body);
  const { L, W, belt, roof: top, r, ca, cb, fr, rr } = P;
  const car = new THREE.Group();
  const paint = new THREE.MeshPhysicalMaterial({ color: v.color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, transparent: true });
  const glassM = new THREE.MeshPhysicalMaterial({ color: 0x18232c, metalness: 0.2, roughness: 0.06, clearcoat: 1, transparent: true });
  const parts = {};
  const add = (key, obj, off) => {
    obj.userData.part = key; obj.userData.base = obj.position.clone(); obj.userData.off = off;
    (parts[key] ||= []).push(obj); car.add(obj); return obj;
  };
  const mesh = (geo, mat, x = 0, y = 0, z = 0, parent) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    if (parent) parent.add(m); return m;
  };
  const bx = (w, h, d, mat, x, y, z, parent) => mesh(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent);

  // body shell + trim
  const body = new THREE.Group();
  mesh(G.body, paint, 0, 0, 0, body);
  [-1, 1].forEach((s) => {
    bx(0.06, 0.13, 0.38, SHARED.head, L / 2 + 0.02, belt - 0.3, s * (W / 2 - 0.34), body);
    bx(0.06, 0.16, 0.3, SHARED.tail, -L / 2 - 0.02, belt - 0.2, s * (W / 2 - 0.26), body);
    bx(0.2, 0.12, 0.08, paint, cb - 0.12, belt + 0.12, s * (W / 2 + 0.06), body);
  });
  bx(0.05, 0.24, W - 0.9, SHARED.grille, L / 2 + 0.03, belt - 0.36, 0, body);
  bx(0.1, 0.16, W - 0.1, SHARED.grille, L / 2 + 0.02, 0.36, 0, body);
  bx(0.1, 0.16, W - 0.1, SHARED.grille, -L / 2 - 0.02, 0.36, 0, body);
  if (P.bed) { const b0 = -L / 2 + 0.25, b1 = ca - 0.1; bx(b1 - b0, 0.02, W - 0.32, SHARED.bed, (b0 + b1) / 2, belt + 0.056, 0, body); }
  add('body', body, new THREE.Vector3(0, 2.0, 0));

  // cabin: glass + roof skin + pillars (+ cargo box for vans)
  const cabin = new THREE.Group();
  mesh(G.glass, glassM, 0, 0, 0, cabin);
  if (G.cargo) mesh(G.cargo, paint, 0, 0, 0, cabin);
  const rx0 = (P.cargo ? G.xg : ca + rr) + 0.1, rx1 = cb - fr - 0.1;
  bx(rx1 - rx0, 0.06, W - 0.3, paint, (rx0 + rx1) / 2, top + 0.05, 0, cabin);
  if (!P.cargo) bx(0.12, top - belt, W - 0.2, paint, (ca + cb) / 2 + (P.bed ? 0 : 0.15), (top + belt) / 2, 0, cabin);
  add('cabin', cabin, new THREE.Vector3(0, 2.15, 0));

  // hood
  const hx0 = cb + 0.08, hx1 = L / 2 - 0.5, slope = 0.07 / (L - 0.78);
  const hm = (hx0 + hx1) / 2, hy = belt - slope * (hm + L / 2 - 0.18) + 0.05 + 0.012;
  const hood = bx(hx1 - hx0, 0.04, W - 0.3, paint, hm, hy, 0);
  hood.rotation.z = -Math.atan(slope);
  add('hood', hood, new THREE.Vector3(0.5, 2.9, 0));

  // wheels (spin group inside)
  const wheels = [];
  [[G.xf, 1], [G.xf, -1], [G.xr, 1], [G.xr, -1]].forEach(([x, s]) => {
    const wg = new THREE.Group(); wg.position.set(x, r, s * (W / 2 - 0.2));
    const spin = new THREE.Group(); wg.add(spin);
    mesh(G.tire, M.rubber, 0, 0, 0, spin);
    mesh(G.rim, SHARED.rim, 0, 0, 0, spin);
    for (let k = 0; k < 5; k++) { const sp = bx(0.06, r * 1.1, 0.02, SHARED.spoke, 0, 0, s * 0.142, spin); sp.rotation.z = (k / 5) * PI; }
    wheels.push(spin);
    add('wheels', wg, new THREE.Vector3(0, 0, s * 0.95));
  });

  // internals (hidden until teardown) — each keyed to a job "part"
  const internals = [];
  const inner = (key, obj, off) => { obj.visible = false; internals.push(obj); return add(key, obj, off); };
  [[G.xf, 1], [G.xf, -1], [G.xr, 1], [G.xr, -1]].forEach(([x, s]) => {
    const bg = new THREE.Group(); bg.position.set(x, r, s * (W / 2 - 0.4));
    mesh(G.rotor, partMat(0x9aa1a7, { metalness: 0.9, roughness: 0.35 }), 0, 0, 0, bg);
    bx(0.14, 0.22, 0.1, partMat(0xc0271f), -r * 0.35, r * 0.32, 0, bg);
    inner('brakes', bg, new THREE.Vector3(0, 0.25, s * 0.55));
    const sg = new THREE.Group(); sg.position.set(x, r + 0.45, s * (W / 2 - 0.45));
    mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.62, 12), partMat(0x30353a), 0, 0, 0, sg);
    mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.3, 14), partMat(0xe2be1b, { metalness: 0.4 }), 0, 0.08, 0, sg);
    inner('suspension', sg, new THREE.Vector3(0, 0.55, s * 0.35));
  });
  const ex = Math.min(G.xf + 0.05, L / 2 - 0.8);
  const eng = new THREE.Group(); eng.position.set(ex, 0.62, 0);
  bx(0.72, 0.42, 0.62, partMat(0x4b5155), 0, 0, 0, eng);
  bx(0.6, 0.1, 0.48, partMat(0x8c1d1d, { metalness: 0.3 }), 0, 0.26, 0, eng);
  bx(0.5, 0.12, 0.16, partMat(0x6d7378), 0, 0.12, 0.38, eng);
  mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.14, 12), partMat(0xe2741b, { metalness: 0.2 }), -0.25, -0.12, -0.36, eng);
  inner('engine', eng, new THREE.Vector3(0.25, 1.15, 0));
  const bat = new THREE.Group(); bat.position.set(ex + 0.05, 0.74, W / 2 - 0.42);
  bx(0.3, 0.22, 0.18, partMat(0x111213, { metalness: 0.1, roughness: 0.7 }), 0, 0, 0, bat);
  mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.05, 8), partMat(0xc0271f), 0.08, 0.13, 0, bat);
  inner('battery', bat, new THREE.Vector3(0.15, 1.55, 0.75));
  const cool = new THREE.Group(); cool.position.set(L / 2 - 0.22, 0.62, 0);
  bx(0.07, 0.46, W - 0.55, partMat(0xa7b0b6, { metalness: 0.8, roughness: 0.3 }), 0, 0, 0, cool);
  inner('cooling', cool, new THREE.Vector3(0.95, 0.6, 0));
  const exh = new THREE.Group(); exh.position.set(-0.2, 0.26, -(W / 2 - 0.55));
  const pipe = mesh(new THREE.CylinderGeometry(0.045, 0.045, L * 0.72, 10), partMat(0x7c746b, { metalness: 0.7 }), 0, 0, 0, exh); pipe.rotation.z = PI / 2;
  bx(0.75, 0.22, 0.34, partMat(0x6a635b, { metalness: 0.7 }), -L / 2 + 1.0, 0, 0, exh);
  inner('exhaust', exh, new THREE.Vector3(0, -0.02, -1.15));

  // tag
  const el = document.createElement('div'); el.className = 'tag';
  el.addEventListener('click', (e) => { e.stopPropagation(); select(ro.id, true); });
  const tag = new CSS2DObject(el); tag.position.set(0, top + 0.75, 0); car.add(tag);

  car.userData = { roId: ro.id, parts, wheels, internals, paint, glassM, tag, el, r,
    heading: 0, path: [], segStart: true, reverse: false, liftY: 0, explode: 0, onArrive: null };
  car.traverse((o) => { if (o.isMesh) o.userData.carId = ro.id; });
  carsGroup.add(car);
  cars.set(ro.id, car);
  return car;
}
function placeCar(car, spot) {
  car.position.copy(spot.pos); car.userData.heading = spot.heading; car.rotation.y = spot.heading;
}

/* =========================================================================
   7. MOVEMENT: back out of the spot, drive the aisle, pull in
   ========================================================================= */
function routeBetween(fromSpot, toSpot) {
  const pts = [...fromSpot.route, ...[...toSpot.route].reverse(), toSpot.pos];
  return pts.filter((p, i) => i === 0 || p.distanceTo(pts[i - 1]) > 0.05).map((p) => p.clone());
}
function driveCar(ro, toSpot, fromSpot, onArrive) {
  const car = cars.get(ro.id);
  (car.userData.heldBays || []).forEach((b) => (doors[b].hold = Math.max(0, (doors[b].hold || 0) - 1)));
  car.userData.path = routeBetween(fromSpot, toSpot);
  car.userData.segStart = true;
  car.userData.leaving = fromSpot.type !== undefined;
  car.userData.final = toSpot;
  car.userData.onArrive = onArrive || null;
  ro.moving = true;
  [fromSpot, toSpot].forEach((s) => { if (s.type === 'bay') doors[s.bay].hold = (doors[s.bay].hold || 0) + 1; });
  car.userData.heldBays = [fromSpot, toSpot].filter((s) => s.type === 'bay').map((s) => s.bay);
}
function updateCar(car, dt) {
  const u = car.userData;
  const ro = ros.find((r) => r.id === u.roId);
  if (!ro) return;
  // lift
  const spot = spotById[ro.location];
  const liftT = !ro.moving && spot?.type === 'bay' && (ro.status === 'wip' || state.teardown === ro.id) ? 1.25 : 0;
  u.liftY += Math.sign(liftT - u.liftY) * Math.min(Math.abs(liftT - u.liftY), dt * 0.9);
  car.position.y = u.liftY;
  if (!u.path.length || u.liftY > 0.02) return;
  if (u.heldBays?.some((b) => doors[b].open < 0.92)) return; // wait for the door
  const target = u.path[0];
  const dx = target.x - car.position.x, dz = target.z - car.position.z;
  const dist = Math.hypot(dx, dz);
  const h = Math.atan2(-dz, dx);
  if (u.segStart) {
    u.reverse = u.leaving && Math.abs(angDiff(u.heading, h)) > PI * 0.55;
    u.leaving = false; u.segStart = false;
  }
  const want = u.reverse ? h + PI : h;
  const diff = angDiff(u.heading, want);
  u.heading += Math.sign(diff) * Math.min(Math.abs(diff), dt * 2.6);
  car.rotation.y = u.heading;
  const fast = Math.abs(car.position.z) > 20 || Math.abs(car.position.x) > 30;
  const speed = (fast ? 11 : 5) * Math.max(0.2, Math.cos(Math.min(Math.abs(diff), PI / 2)));
  const step = Math.min(dist, speed * dt);
  if (dist > 1e-4) { car.position.x += (dx / dist) * step; car.position.z += (dz / dist) * step; }
  u.wheels.forEach((w) => (w.rotation.z -= (u.reverse ? -1 : 1) * step / u.r));
  if (dist - step < 0.03) {
    u.path.shift(); u.segStart = true;
    if (!u.path.length) {
      ro.moving = false;
      u.heldBays.forEach((b) => (doors[b].hold = Math.max(0, (doors[b].hold || 0) - 1)));
      u.heldBays = [];
      const fn = u.onArrive; u.onArrive = null;
      if (fn) fn();
      refresh();
    }
  }
}

/* =========================================================================
   8. APP STATE + ACTIONS (sent to the Shop Twin server; every screen gets the result)
   ========================================================================= */
const state = { plans: new Map(), placeMode: 'now', selected: null, placing: null, teardown: null, focusPart: null, walls: 0, roof: 0, wallsT: 0, roofT: 0, feed: [], appointments: [] };
const fmtClock = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' ', '');
};
function fmtWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? `Today ${time}` : `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${time}`;
}
function log(msg) { state.feed.unshift({ t: fmtClock(new Date().toISOString()), msg }); }
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 4200);
}
const roById = (id) => ros.find((r) => r.id === id && !r.closed);

async function api(path, body) {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    if (res.status === 401) { location.href = '/login.html'; return null; }
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { toast(out.error || `The Shop Twin server answered ${res.status}.`); return null; }
    return out;
  } catch {
    toast('Lost the connection to the Shop Twin server. Check that it is running.');
    return null;
  }
}

function select(id, fly) {
  if (state.placing) cancelPlacing();
  if (state.teardown && state.teardown !== id) exitTeardown();
  state.selected = id; state.focusPart = null;
  if (id && fly) flyToCar(id, 15);
  refresh();
}
function startPlacing(id, mode = 'now') {
  exitTeardown();
  state.placing = id; state.placeMode = mode;
  buildPads();
  refresh();
}
function cancelPlacing() { state.placing = null; clearPads(); refresh(); }
function moveTo(ro, spot) {
  clearPads(); state.placing = null; refresh();
  api('/api/move', { roId: ro.id, spotId: spot.id });
}
function setPlan(ro, spot) {
  clearPads(); state.placing = null; refresh();
  api('/api/plan', { roId: ro.id, spotId: spot.id });
}
function cancelPlan(id) { api('/api/unplan', { roId: id }); }
const plannedFor = (spotId, exceptId) => [...state.plans].find(([rid, sid]) => sid === spotId && rid !== exceptId)?.[0];
function runPlan(id) {
  const ro = roById(id), spot = spotById[state.plans.get(id)];
  if (!ro || !spot || ro.moving) return;
  const occ = occupant(spot.id);
  if (occ && occ.id !== id) { toast(`${spot.label} still has RO #${occ.number}. Move it out first.`); return; }
  moveTo(ro, spot);
}
function autoPlan() { api('/api/autoplan'); }
async function assignTech(ro, techId) {
  const tech = (MODE.meta?.techs || []).find((t) => String(t.id) === String(techId));
  const ok = await api('/api/assign-tech', { roId: ro.id, technicianId: Number(techId) });
  if (ok) toast(`Saved to Tekmetric: ${tech ? tech.name : 'technician'} on RO #${ro.number}.`);
}
function simulateArrival() { api('/api/mock/advance'); }

/* ---------- teardown (exploded view) ---------- */
function enterTeardown(id, part) {
  if (!cars.get(id)) return;
  if (state.placing) cancelPlacing();
  state.teardown = id; state.selected = id; state.focusPart = part || null;
  const car = cars.get(id);
  flyTo(car.position.clone().add(new THREE.Vector3(5.2, 4.2, 6.4)), car.position.clone().add(new THREE.Vector3(0, 1.6, 0)));
  buildPartLabels();
  refresh();
}
function exitTeardown() {
  if (!state.teardown) return;
  clearPartLabels();
  state.teardown = null; state.focusPart = null;
  refresh();
}
let partLabels = [];
function buildPartLabels() {
  clearPartLabels();
  const ro = roById(state.teardown), car = cars.get(state.teardown);
  if (!ro || !car) return;
  const keys = [...new Set(ro.jobs.map((j) => j.part))].filter((k) => !state.focusPart || k === state.focusPart);
  keys.forEach((k) => {
    const host = car.userData.parts[k]?.[0]; if (!host) return;
    const el = document.createElement('div'); el.className = 'plabel';
    const jobs = ro.jobs.filter((j) => j.part === k).map((j) => j.name);
    el.innerHTML = `${PART_NAMES[k] || 'General'}<small>${esc(jobs.join(' · '))}</small>`;
    const lab = new CSS2DObject(el); lab.position.set(0, 0.55, 0);
    host.add(lab); partLabels.push(lab);
  });
}
function clearPartLabels() { partLabels.forEach((l) => l.parent?.remove(l)); partLabels = []; }

/* ---------- placement pads ---------- */
const padsGroup = new THREE.Group(); scene.add(padsGroup);
// Spots this RO can go to right now. A planned move may queue behind a busy bay.
function placeableSpots(ro) {
  return SPOTS.filter((s) => {
    if (s.id === ro.location || plannedFor(s.id, ro.id)) return false;
    const occ = occupant(s.id);
    return !occ || (state.placeMode === 'plan' && s.type === 'bay');
  });
}
function buildPads() {
  clearPads();
  const ro = roById(state.placing);
  if (!ro) { state.placing = null; return; }
  placeableSpots(ro).forEach((s) => {
    const occ = occupant(s.id);
    const w = s.type === 'bay' ? 3.4 : s.type === 'drop' ? 2.2 : 2.7, l = s.type === 'bay' ? 6.2 : 5.2;
    const m = flat(l, w, M.pad, s.pos.x, occ ? 0.03 : 0.05, s.pos.z, padsGroup, s.heading);
    m.userData.spot = s.id;
    const el = document.createElement('div'); el.className = 'padlabel'; el.textContent = occ ? `${s.label} · after #${occ.number}` : s.label;
    const lab = new CSS2DObject(el); lab.position.set(0, 0, 0.01); m.add(lab);
  });
}
function clearPads() { hoverPad = null; [...padsGroup.children].forEach((m) => { [...m.children].forEach((c) => m.remove(c)); padsGroup.remove(m); }); }

/* ---------- planned-move arrows ---------- */
const planGroup = new THREE.Group(); scene.add(planGroup);
const dashImg = canvasTex(64, 16, (c) => { c.fillStyle = '#f2b705'; c.fillRect(0, 3, 38, 10); }, [1, 1]);
const planPadMat = new THREE.MeshBasicMaterial({ color: 0xf2b705, transparent: true, opacity: 0.22, depthWrite: false });
const headMat = new THREE.MeshBasicMaterial({ color: 0xf2b705, transparent: true, opacity: 0.95, depthWrite: false });
const headShape = new THREE.Shape([new THREE.Vector2(0.7, 0), new THREE.Vector2(-0.35, 0.55), new THREE.Vector2(-0.35, -0.55)]);
let planVis = [];
function syncPlanVisuals() {
  planVis.forEach((p) => { [p.pad, p.ribbon, p.head].forEach((m) => { [...m.children].forEach((c) => m.remove(c)); planGroup.remove(m); }); });
  planVis = [];
  state.plans.forEach((sid, rid) => {
    const s = spotById[sid], r = roById(rid); if (!r || r.closed) return;
    const w = s.type === 'bay' ? 3.4 : 2.6, l = s.type === 'bay' ? 6.2 : 5.2;
    const pad = flat(l, w, planPadMat, s.pos.x, 0.045, s.pos.z, planGroup, s.heading);
    const el = document.createElement('div'); el.className = 'padlabel'; el.textContent = `Next · #${r.number}`;
    const lab = new CSS2DObject(el); pad.add(lab);
    const tex = dashImg.clone(); tex.needsUpdate = true;
    const ribbon = flat(1, 0.34, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }), 0, 0.07, 0, planGroup);
    const head = new THREE.Mesh(new THREE.ShapeGeometry(headShape), headMat); head.rotation.x = -PI / 2; head.position.y = 0.075; planGroup.add(head);
    planVis.push({ rid, s, pad, ribbon, head });
  });
}
function updatePlanVisuals() {
  planVis.forEach((p) => {
    const car = cars.get(p.rid); if (!car) return;
    const a = car.position, b = p.s.pos;
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz);
    if (d < 1.4) { p.ribbon.visible = p.head.visible = false; return; }
    const ux = dx / d, uz = dz / d, len = d - 1.2, ang = Math.atan2(-dz, dx);
    p.ribbon.position.set(a.x + ux * len / 2, 0.07, a.z + uz * len / 2);
    p.ribbon.rotation.z = ang; p.ribbon.scale.x = len; p.ribbon.material.map.repeat.x = len / 1.1;
    p.head.position.set(a.x + ux * len, 0.075, a.z + uz * len);
    p.head.rotation.z = ang;
    const moving = !!roById(p.rid)?.moving; p.ribbon.visible = p.head.visible = !moving;
  });
}

/* =========================================================================
   9. CAMERA
   ========================================================================= */
let tween = null;
function flyTo(pos, target, dur = 1.0) {
  tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, k: 0, dur };
}
controls.addEventListener('start', () => (tween = null));
function flyToCar(id, dist) {
  const car = cars.get(id); if (!car) return;
  const dir = camera.position.clone().sub(controls.target).normalize();
  if (dir.y < 0.35) { dir.y = 0.35; dir.normalize(); }
  const tgt = car.position.clone().setY(1);
  flyTo(tgt.clone().add(dir.multiplyScalar(dist)), tgt);
}
const VIEWS = {
  vAerial: () => { setWalls(0); setRoof(0); flyTo(new THREE.Vector3(34, 30, 46), new THREE.Vector3(2, 0, 0)); },
  vStreet: () => { flyTo(new THREE.Vector3(-8, 2.4, 33), new THREE.Vector3(2, 3, -2)); },
  vInside: () => { setRoof(1); flyTo(new THREE.Vector3(13.4, 3.4, -1.0), new THREE.Vector3(-4, 1.2, -8)); },
  vPlan: () => { setWalls(1); setRoof(1); flyTo(new THREE.Vector3(3, 78, 2.5), new THREE.Vector3(3, 0, 2.4)); },
};
function setWalls(v) { state.walls = v; $('#tWalls').setAttribute('aria-checked', String(!!v)); }
function setRoof(v) { state.roof = v; $('#tRoof').setAttribute('aria-checked', String(!!v)); }

/* =========================================================================
   10. UI RENDERING (v4: one thin bar, the 3D shop, and a card next to the selected car)
   ========================================================================= */
const COL_ORDER = { 1: 'estimate', 2: 'wip', 3: 'complete' };
const colKey = (r) => COL_ORDER[r.tmStatusId] || 'wip';
const labelColor = (r) => r.labelColor || `var(--c-${colKey(r)})`;
const money0 = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
const ui = { col: null, label: null }; // open column popover; label filter that dims other cars

function refresh() { renderCols(); renderColPop(); renderCard(); renderTags(); renderHint(); syncPlanVisuals(); }
function renderCols() {
  const cols = MODE.columns || [];
  const html = cols.map((c) => `<button type="button" data-col="${c.key}" class="${ui.col === c.key ? 'on' : ''}" style="--k:var(--c-${c.key})" aria-expanded="${ui.col === c.key}">
    <i></i><span>${esc(c.name)}</span><b>${money0(c.total)}</b><em>${c.count}</em></button>`).join('');
  const el = $('#cols');
  if (el.__html !== html) { el.innerHTML = html; el.__html = html; }
}
function renderColPop() {
  const pop = $('#colPop');
  const c = ui.col && (MODE.columns || []).find((x) => x.key === ui.col);
  if (!c) { pop.hidden = true; return; }
  const html = c.labels.length
    ? c.labels.map((l) => `<button type="button" data-label="${esc(l.name)}" class="${ui.label === l.name ? 'on' : ''}">
        <span class="dot" style="--k:${l.color ? esc(l.color) : `var(--c-${c.key})`}"></span>${esc(l.name)}<b>${l.count} · ${money0(l.total)}</b></button>`).join('')
    : '<button type="button" disabled>No repair orders</button>';
  if (pop.__html !== html) { pop.innerHTML = html; pop.__html = html; }
  const btn = $(`#cols [data-col="${c.key}"]`);
  if (btn) pop.style.left = btn.getBoundingClientRect().left + 'px';
  pop.hidden = false;
}
const matchesFilter = (r) => !ui.label || (colKey(r) === ui.col && (r.label || 'No label') === ui.label);
function lineRows(r, j) {
  const rows = [];
  for (const l of j.labor || []) rows.push(`<tr><td class="k">L</td><td>${l.hours.toFixed(1)} h${l.name && l.name !== j.name ? ` · ${esc(l.name)}` : ''} · ${esc(r.tech || 'No tech')}${l.done ? ' <span class="ok">· done</span>' : ''}</td><td>${money(l.total)}</td></tr>`);
  for (const p of j.parts || []) {
    const st = p.status ? ` <span class="${/order|back/.test(p.status) ? 'warn' : 'ok'}">· ${esc(p.status)}</span>` : '';
    rows.push(`<tr><td class="k">P</td><td>${p.qty > 1 ? `${p.qty}× ` : ''}${esc(p.name)}${st}</td><td>${money(p.total)}</td></tr>`);
  }
  if (!rows.length && j.hrs) rows.push(`<tr><td class="k">L</td><td>${j.hrs.toFixed(1)} h</td><td></td></tr>`);
  return rows.join('');
}
function renderCard() {
  const d = $('#card');
  const r = state.selected && roById(state.selected);
  if (!r) { d.hidden = true; d.__html = ''; return; }
  const v = r.vehicle;
  const placed = !!spotById[r.location];
  const plan = state.plans.get(r.id);
  const where = r.moving ? 'Moving' : spotById[r.location]?.label ?? 'Not checked in';
  const total = r.total ?? r.jobs.reduce((s, j) => s + j.total, 0);
  const move = plan
    ? `<button type="button" class="pr" id="aGo" ${r.moving ? 'disabled' : ''}>Move to ${esc(spotById[plan].label)}</button><button type="button" id="aUnplan">Clear plan</button>`
    : `<button type="button" class="pr" id="aMove" ${r.moving ? 'disabled' : ''}>${placed ? 'Move' : 'Check in'}</button><button type="button" id="aPlan" ${r.moving ? 'disabled' : ''}>Plan</button>`;
  const html = `
    <div class="h"><span class="ro">#${esc(r.number)}</span><span class="dot" style="--k:${esc(labelColor(r))}"></span><span class="lbl">${esc(r.label || r.tmStatusName || '')}</span>
      <span class="tot">${money(total)}</span><button type="button" class="x" id="dClose" aria-label="Close">✕</button></div>
    <div class="b">
      <div class="v">${esc(vehName(v))}</div>
      <div class="m">${esc(r.customer.name)} · ${esc(r.tech || 'No tech')} · ${esc(where)}${plan ? ` → ${esc(spotById[plan].label)}` : ''}</div>
      <div class="c">${esc(r.concern)}</div>
      ${r.jobs.length ? `<table>${r.jobs.map((j) => `<tr class="j ${j.auth ? '' : 'pend'}"><td colspan="2">${esc(j.name)}</td><td>${money(j.total)}</td></tr>${lineRows(r, j)}`).join('')}</table>` : '<div class="muted">No jobs yet.</div>'}
    </div>
    <div class="f">${move}<span class="sp"></span>${r.tekmetricUrl ? `<a id="aOpen" href="${esc(r.tekmetricUrl)}" target="_blank" rel="noopener">Tekmetric ↗</a>` : ''}</div>`;
  d.hidden = false;
  // Live updates arrive every few seconds: only redraw when something changed, so clicks survive.
  if (d.__html === html) return;
  d.innerHTML = html;
  d.__html = html;
  $('#dClose').onclick = () => { state.selected = null; refresh(); };
  if ($('#aMove')) $('#aMove').onclick = () => startPlacing(r.id, placed ? 'now' : 'checkin');
  if ($('#aPlan')) $('#aPlan').onclick = () => startPlacing(r.id, 'plan');
  if ($('#aGo')) $('#aGo').onclick = () => runPlan(r.id);
  if ($('#aUnplan')) $('#aUnplan').onclick = () => cancelPlan(r.id);
}
// Keep the card beside its car as the camera or the car moves (called every frame).
const cardV = new THREE.Vector3();
function placeCard() {
  const d = $('#card');
  if (d.hidden) return;
  const car = cars.get(state.selected);
  if (!car) return;
  cardV.copy(car.position).setY(1.4).project(camera);
  const x = (cardV.x + 1) / 2 * innerWidth, y = (1 - cardV.y) / 2 * innerHeight;
  const w = d.offsetWidth, h = d.offsetHeight, gap = 46;
  let left = x + gap; if (left + w > innerWidth - 10) left = x - gap - w;
  left = Math.max(10, Math.min(innerWidth - w - 10, left));
  const top = Math.max(54, Math.min(innerHeight - h - 10, y - 40));
  d.style.left = Math.round(left) + 'px'; d.style.top = Math.round(top) + 'px';
}
function renderTags() {
  $('#labels').classList.toggle('filtering', !!ui.label);
  cars.forEach((car, id) => {
    const r = ros.find((x) => x.id === id), u = car.userData; // includes cars still driving away
    if (!r) return;
    u.el.className = `tag ${state.selected === id ? 'sel' : ''} ${matchesFilter(r) ? 'match' : ''}`;
    const html = `<span class="dot" style="--k:${esc(labelColor(r))}"></span>${esc(r.number)}`;
    if (u.el.__html !== html) { u.el.innerHTML = html; u.el.__html = html; u.el.title = r.label || r.tmStatusName || ''; }
    u.tag.visible = state.teardown !== id;
  });
}
function renderHint() {
  const h = $('#hint');
  if (state.placing) {
    const r = roById(state.placing);
    if (!r) { h.hidden = true; return; }
    const plan = state.placeMode === 'plan';
    const keep = $('#hSpot')?.value;
    const opts = placeableSpots(r).map((s) => {
      const occ = occupant(s.id);
      return `<option value="${s.id}" ${s.id === keep ? 'selected' : ''}>${s.label}${occ ? ` (after #${esc(occ.number)})` : ''}</option>`;
    }).join('');
    h.hidden = false;
    const html = `<span>${plan ? 'Plan' : 'Move'} #${esc(r.number)} to</span>
      <select id="hSpot" aria-label="Spot">${opts}</select>
      <button type="button" class="pr" id="hPlace">${plan ? 'Plan' : 'Move'}</button>
      <button type="button" id="hCancel">Cancel</button>`;
    if (h.__html === html) return;
    h.innerHTML = html;
    h.__html = html;
    $('#hCancel').onclick = cancelPlacing;
    $('#hPlace').onclick = () => { const sp = spotById[$('#hSpot').value]; if (sp) (plan ? setPlan : moveTo)(r, sp); };
  } else { h.hidden = true; h.__html = ''; }
}
$('#cols').addEventListener('click', (e) => {
  const b = e.target.closest('[data-col]'); if (!b) return;
  const k = b.dataset.col;
  if (ui.col === k) { ui.col = null; ui.label = null; } else { ui.col = k; ui.label = null; }
  closeViewMenu(); refresh();
});
$('#colPop').addEventListener('click', (e) => {
  const b = e.target.closest('[data-label]'); if (!b) return;
  ui.label = ui.label === b.dataset.label ? null : b.dataset.label;
  refresh();
});
function closeViewMenu() { $('#viewMenu').hidden = true; $('#viewBtn').setAttribute('aria-expanded', 'false'); }
$('#viewBtn').onclick = () => {
  const open = $('#viewMenu').hidden;
  $('#viewMenu').hidden = !open; $('#viewBtn').setAttribute('aria-expanded', String(open));
  if (open) { ui.col = null; ui.label = null; refresh(); }
};
$('#viewMenu').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.view) { VIEWS[b.dataset.view](); closeViewMenu(); }
});
addEventListener('pointerdown', (e) => {
  if (!e.target.closest('.menuwrap')) closeViewMenu();
  if (!e.target.closest('#cols, #colPop') && ui.col && !ui.label) { ui.col = null; refresh(); }
});
$('#tWalls').onclick = () => setWalls(state.walls ? 0 : 1);
$('#tRoof').onclick = () => setRoof(state.roof ? 0 : 1);
$('#arrive').onclick = () => { closeViewMenu(); simulateArrival(); };
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (state.placing) cancelPlacing();
  else if (!$('#viewMenu').hidden) closeViewMenu();
  else if (ui.col) { ui.col = null; ui.label = null; refresh(); }
  else { state.selected = null; refresh(); }
});

/* =========================================================================
   11. PICKING
   ========================================================================= */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let down = null, hoverPad = null;
function pick(e, objs) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const shown = (o) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
  return ray.intersectObjects(objs, true).find((h) => shown(h.object));
}
renderer.domElement.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
renderer.domElement.addEventListener('pointermove', (e) => {
  if (state.placing) {
    const h = pick(e, padsGroup.children);
    const pad = h?.object.userData.spot ? h.object : null;
    if (hoverPad && hoverPad !== pad) hoverPad.material = M.pad;
    if (pad) pad.material = M.padHover;
    hoverPad = pad;
    renderer.domElement.style.cursor = pad ? 'pointer' : '';
  } else {
    renderer.domElement.style.cursor = pick(e, carsGroup.children) ? 'pointer' : '';
  }
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
  down = null;
  if (state.placing) {
    const h = pick(e, padsGroup.children);
    const r = roById(state.placing);
    if (r && h?.object.userData.spot) (state.placeMode === 'plan' ? setPlan : moveTo)(r, spotById[h.object.userData.spot]);
    return;
  }
  const h = pick(e, carsGroup.children);
  if (!h) return;
  const id = h.object.userData.carId;
  if (state.teardown === id) {
    let o = h.object; while (o && !o.userData.part) o = o.parent;
    const key = o?.userData.part;
    if (key && PART_NAMES[key]) {
      const jobs = (roById(id)?.jobs || []).filter((j) => j.part === key);
      toast(`${PART_NAMES[key]}${jobs.length ? ' · ' + jobs.map((j) => j.name).join(', ') : ' · no jobs on this RO'}`);
    }
    return;
  }
  select(id, true);
});

/* =========================================================================
   12. THEME (day / dusk follows the viewer's light / dark setting)
   ========================================================================= */
function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true; if (t === 'light') return false;
  return matchMedia('(prefers-color-scheme: dark)').matches;
}
function applyTheme() {
  const dark = isDark();
  const sky = new THREE.Color(dark ? 0x0f1620 : 0xcdd7dd);
  skyDome.visible = !dark;
  scene.background = dark ? sky : null; scene.fog.color.set(dark ? 0x0f1620 : 0xc4cfd6);
  hemi.intensity = dark ? 0.16 : 0.7;
  hemi.color.set(dark ? 0x4a5a78 : 0xdfe9f2);
  if (dark) { sun.intensity = 0.35; sun.color.set(0x9db3e0); } else liveSun();
  poleLights.forEach((l) => (l.intensity = dark ? 140 : 0));
  bayLights.forEach((l) => (l.intensity = dark ? 34 : 18));
  officeLight.intensity = dark ? 26 : 10;
  M.glass.emissive.set(dark ? 0x6b5a3a : 0x000000);
  sign.material.emissive.set(dark ? 0x6e5600 : 0x000000);
  sign.material.emissiveMap = dark ? signTex : null; sign.material.needsUpdate = true;
  M.grass.color.set(dark ? 0x4a5246 : 0xffffff);
  SHARED.head.emissiveIntensity = dark ? 1.6 : 0.5;
  SHARED.tail.emissiveIntensity = dark ? 1.2 : 0.5;
  renderer.toneMappingExposure = dark ? 1.15 : 1.0;
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
applyTheme();

/* =========================================================================
   12b. LIVE STATE FROM THE SHOP TWIN SERVER (the same for every screen)
   ========================================================================= */
function removeCar(id) {
  const car = cars.get(id);
  if (!car) return;
  car.remove(car.userData.tag);
  carsGroup.remove(car);
  cars.delete(id);
}
function relocate(ro, from, to, instant) {
  ro.location = to;
  const fromSpot = spotById[from], toSpot = spotById[to];
  const car = cars.get(ro.id);
  if (!toSpot) {
    if (car && fromSpot) driveCar(ro, STREET_OUT, fromSpot, () => removeCar(ro.id));
    else removeCar(ro.id);
    return;
  }
  if (instant) { placeCar(car || makeCar(ro), toSpot); return; }
  if (!car || !fromSpot) {
    placeCar(car || makeCar(ro), STREET_IN);
    driveCar(ro, toSpot, STREET_IN);
    return;
  }
  driveCar(ro, toSpot, fromSpot);
}
function depart(ro) {
  const from = spotById[ro.location];
  ro.closed = true;
  ro.location = 'OUT';
  if (state.teardown === ro.id) exitTeardown();
  if (state.placing === ro.id) cancelPlacing();
  if (state.selected === ro.id) state.selected = null;
  const car = cars.get(ro.id);
  if (car && from) driveCar(ro, STREET_OUT, from, () => removeCar(ro.id));
  else removeCar(ro.id);
}
function applyState(st) {
  const first = MODE.first;
  if (st.meta?.updatedAt) MODE.first = false; // cars already on site appear in place; later ones drive in
  MODE.meta = st.meta;
  const incoming = new Map(st.ros.map((r) => [r.id, r]));
  // Forget closed ROs that have finished driving away (or came back).
  for (let i = ros.length - 1; i >= 0; i--) {
    const r = ros[i];
    if (r.closed && (incoming.has(r.id) || !cars.get(r.id))) {
      if (incoming.has(r.id)) removeCar(r.id);
      ros.splice(i, 1);
    }
  }
  for (const ro of [...ros]) {
    if (ro.closed) continue;
    const inc = incoming.get(ro.id);
    incoming.delete(ro.id);
    if (!inc) { depart(ro); continue; }
    const from = ro.location;
    Object.assign(ro, inc, { location: from, moving: ro.moving });
    if (inc.location !== from) relocate(ro, from, inc.location, false);
  }
  for (const inc of incoming.values()) {
    const ro = { ...inc, location: null };
    ros.push(ro);
    relocate(ro, null, inc.location, first);
  }
  state.plans = new Map(st.plans);
  state.appointments = st.appointments || [];
  state.feed = (st.activity || []).map((a) => ({ t: fmtClock(a.at), msg: a.msg }));
  if (state.selected && !roById(state.selected)) state.selected = null;
  if (state.placing) buildPads();
  MODE.columns = st.columns || [];
  renderMode();
  refresh();
}
function renderMode() {
  const m = MODE.meta || {};
  const shop = esc(m.shop?.name || 'Shop');
  const s = m.updatedAt ? Math.max(0, Math.round((Date.now() - m.updatedAt) / 1000)) : null;
  const ago = s === null ? '' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
  let dot = 'live-dot', title = `Tekmetric${m.mode === 'mock' ? ' (simulated)' : ''} · updated ${ago}`;
  if (!MODE.connected) { dot = 'err-dot'; title = 'Reconnecting to the Shop Twin server…'; }
  else if (m.error) { dot = 'err-dot'; title = `Tekmetric problem: ${m.error}`; }
  else if (!m.updatedAt) { dot = 'wait-dot'; title = 'Loading repair orders from Tekmetric…'; }
  const html = `<span class="${dot}"></span>${shop}${m.mode === 'mock' ? ' <small>demo</small>' : ''}`;
  const el = $('#shop');
  if (el.__html !== html) { el.innerHTML = html; el.__html = html; }
  el.title = title;
  // demo controls only in mock mode, and only when asked for with ?demo
  const demo = m.mode === 'mock' && new URLSearchParams(location.search).has('demo');
  document.querySelectorAll('[data-demo]').forEach((x) => (x.hidden = !demo));
}
setInterval(renderMode, 5000);
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('state', (ev) => {
    MODE.connected = true;
    applyState(JSON.parse(ev.data));
  });
  es.onerror = () => {
    MODE.connected = false;
    renderMode();
    fetch('/api/state').then((r) => { if (r.status === 401) location.href = '/login.html'; }).catch(() => {});
  };
}
async function boot() {
  const res = await fetch('/api/state');
  if (res.status === 401) { location.href = '/login.html'; return; }
  MODE.connected = true;
  applyState(await res.json());
  connect();
}

/* =========================================================================
   13. BOOT + LOOP
   ========================================================================= */
const ring = new THREE.Mesh(new THREE.RingGeometry(3.0, 3.25, 64), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
ring.rotation.x = -PI / 2; ring.position.y = 0.04; ring.visible = false; scene.add(ring);
await boot();
$('#loading').remove();

const clock = new THREE.Clock();
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), time = clock.elapsedTime;
  if (tween) {
    tween.k = Math.min(1, tween.k + dt / (reduceMotion ? 0.01 : tween.dur));
    const e = ease(tween.k);
    camera.position.lerpVectors(tween.p0, tween.p1, e);
    controls.target.lerpVectors(tween.t0, tween.t1, e);
    if (tween.k >= 1) tween = null;
  }
  // walls / roof
  state.wallsT += Math.sign(state.walls - state.wallsT) * Math.min(Math.abs(state.walls - state.wallsT), dt * 1.6);
  state.roofT += Math.sign(Math.max(state.roof, state.walls) - state.roofT) * Math.min(Math.abs(Math.max(state.roof, state.walls) - state.roofT), dt * 1.6);
  walls.scale.y = lerp(1, 0.035, ease(state.wallsT));
  roof.position.y = lerp(0, 9, ease(state.roofT));
  roofMats.forEach((m) => { m.opacity = 1 - ease(state.roofT); m.depthWrite = state.roofT < 0.5; });
  roof.visible = state.roofT < 0.999;
  // doors: open when occupied or a car is passing through
  doors.forEach((d, i) => {
    const target = occupant('B' + (i + 1)) || d.hold ? 1 : 0;
    d.open += Math.sign(target - d.open) * Math.min(Math.abs(target - d.open), dt * 0.9);
    d.mesh.scale.y = lerp(1, 0.04, d.open);
  });
  // cars
  cars.forEach((car) => {
    updateCar(car, dt);
    const u = car.userData, td = state.teardown === u.roId;
    u.explode += Math.sign((td ? 1 : 0) - u.explode) * Math.min(Math.abs((td ? 1 : 0) - u.explode), dt * 1.4);
    const ex = ease(u.explode);
    Object.values(u.parts).flat().forEach((o) => o.position.copy(o.userData.base).addScaledVector(o.userData.off, ex));
    u.internals.forEach((o) => (o.visible = u.explode > 0.01));
    u.paint.opacity = 1 - 0.8 * ex; u.paint.depthWrite = ex < 0.3;
    u.glassM.opacity = 1 - 0.85 * ex; u.glassM.depthWrite = ex < 0.3;
    if (td) {
      const ro = roById(u.roId);
      const keys = new Set((ro?.jobs || []).map((j) => j.part).filter((k) => !state.focusPart || k === state.focusPart));
      const glow = 0.45 + 0.3 * Math.sin(time * 4);
      u.internals.concat(u.parts.wheels).forEach((o) => o.traverse((m) => {
        if (!m.isMesh || m.material === SHARED.rim || m.material === SHARED.spoke) return;
        if (!m.userData.ownMat) { m.material = m.material.clone(); m.userData.ownMat = true; }
        const on = keys.has(o.userData.part);
        m.material.emissive.set(on ? 0xf2b705 : 0x000000);
        m.material.emissiveIntensity = on ? glow : 0;
      }));
    }
  });
  // lift carriages follow the car in their bay
  lifts.forEach((c, i) => { const r = occupant('B' + (i + 1)); const car = r && cars.get(r.id); c.position.y = car && !r.moving ? car.userData.liftY : 0; });
  updatePlanVisuals();
  // selection ring
  const sc = state.selected && cars.get(state.selected);
  ring.visible = !!sc && !state.teardown;
  if (sc) { ring.position.x = sc.position.x; ring.position.z = sc.position.z; ring.scale.setScalar(1 + 0.03 * Math.sin(time * 3)); }
  controls.update();
  placeCard();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); labelRenderer.setSize(innerWidth, innerHeight);
});
