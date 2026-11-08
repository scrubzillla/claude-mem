import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sunPosition } from '../web/sun.js';

const deg = (r) => r * 180 / Math.PI;
const HOU = [29.76, -95.37];

test('sun is due south and about 44 degrees up at Houston solar noon on Nov 8', () => {
  const { el, az } = sunPosition(Date.UTC(2026, 10, 8, 18, 5), ...HOU);
  assert.ok(Math.abs(deg(el) - 43.6) < 1.5, `elevation ${deg(el)}`);
  assert.ok(Math.abs(deg(az) - 180) < 3, `azimuth ${deg(az)}`);
});

test('sun is in the east in the morning, in the west in the afternoon, and below the horizon at night', () => {
  assert.ok(deg(sunPosition(Date.UTC(2026, 10, 8, 15, 0), ...HOU).az) < 160);
  assert.ok(deg(sunPosition(Date.UTC(2026, 10, 8, 21, 0), ...HOU).az) > 200);
  assert.ok(sunPosition(Date.UTC(2026, 10, 9, 6, 0), ...HOU).el < 0);
});
