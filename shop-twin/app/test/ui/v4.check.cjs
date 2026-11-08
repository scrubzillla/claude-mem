// Playwright check of the v4 screen against a running dummy shop (npm run mock). Run: npm run check:ui
// Drive the real v4 UI: screenshot idle, column popover + label filter, and a selected car's card. Fails on console errors.
const { chromium } = require('playwright');
const out = process.argv[2] || require('path').join(__dirname, '../../../ops/shots/v4');
const base = process.env.TWIN_URL || 'http://localhost:8787/';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.clock.setFixedTime(new Date('2026-11-08T16:30:00Z'));
  await p.goto(base, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#loading', { state: 'detached', timeout: 90000 });
  await p.waitForTimeout(2500);
  const check = (c, msg) => { if (!c) { errs.push('CHECK: ' + msg); } };
  check(await p.locator('#cols button').count() === 3, 'three column buttons');
  check(await p.locator('#bar button:visible').count() === 4, 'bar shows only 3 columns + View');
  check(!(await p.locator('#arrive').isVisible()), 'demo button hidden without ?demo');
  await p.screenshot({ path: `${out}/v4-idle.png`, timeout: 90000 });

  await p.click('#cols [data-col="wip"]');
  await p.waitForSelector('#colPop:not([hidden])');
  const labels = await p.locator('#colPop [data-label]').allInnerTexts();
  check(labels.length >= 2 && labels.some((t) => /No label/.test(t)), 'popover lists WIP labels: ' + labels.join(' | '));
  await p.click('#colPop [data-label]:first-child');
  await p.waitForTimeout(300);
  check(await p.locator('#labels.filtering').count() === 1, 'label filter dims other cars');
  await p.screenshot({ path: `${out}/v4-column.png`, timeout: 90000 });
  await p.keyboard.press('Escape');

  const tag = p.locator('#labels .tag', { hasText: '10422' });
  await tag.click();
  await p.waitForSelector('#card:not([hidden])');
  await p.waitForTimeout(1800); // camera flies to the car
  const card = await p.locator('#card').innerText();
  check(/#10422/.test(card), 'card header'); // the simulated shop day may clear its label
  check(/\bL\b[\s\S]*\bP\b/.test(card) && /Ignition coil/.test(card), 'labor and part lines');
  const cb = await p.locator('#card').boundingBox();
  const tb = await tag.boundingBox();
  check(tb && Math.abs((cb.x < tb.x ? cb.x + cb.width : cb.x) - tb.x) < 260, `card sits next to its car (card ${Math.round(cb.x)}, tag ${tb && Math.round(tb.x)})`);
  await p.screenshot({ path: `${out}/v4-card.png`, timeout: 90000 });

  await p.click('#viewBtn');
  check(await p.locator('#viewMenu [data-view]').count() === 4, 'view menu has 4 views');
  await p.screenshot({ path: `${out}/v4-view.png`, clip: { x: 1100, y: 0, width: 340, height: 300 }, timeout: 90000 });
  console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'PASS');
  await b.close();
  process.exit(errs.length ? 1 : 0);
})();
