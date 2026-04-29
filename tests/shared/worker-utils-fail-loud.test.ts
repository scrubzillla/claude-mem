/**
 * Tests for the event-aware fail-loud behavior in worker-utils.
 *
 * Background: Stop hooks (and SubagentStop) treat exit-2 as "block the action
 * and re-fire the hook." When the worker is persistently unreachable on
 * Windows (e.g. ghost TCP socket on port 37777, see issue #1531), the
 * fail-loud counter would `process.exit(2)` after 3 consecutive failures and
 * Claude Code would re-fire the same Stop hook, looping forever (#987, #1235).
 *
 * The fix: `recordWorkerUnreachable` now reads a module-level
 * `currentHookEvent` and silently degrades to exit-0 when the event is
 * stop-class (currently `summarize`). The counter still increments so a
 * future SessionStart hook (where exit-2 is safe) can surface the outage.
 *
 * This test file exercises the wiring of the new gate. The actual
 * counter-on-disk + process.exit behavior is exercised end-to-end in the
 * hook-lifecycle integration tests; here we verify the module exposes the
 * expected setter and reset-hook surface area.
 *
 * Mock Justification (~5% mock code):
 * - We import the module's test-only reset hook to clean state between tests.
 *   No process-level mocks needed — the gate path returns before any
 *   process.exit call.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';

const TMP_ROOT = path.join(os.tmpdir(), `claude-mem-fail-loud-test-${process.pid}`);
const ORIGINAL_DATA_DIR = process.env.CLAUDE_MEM_DATA_DIR;

describe('worker-utils fail-loud event gate', () => {
  beforeEach(() => {
    if (existsSync(TMP_ROOT)) {
      rmSync(TMP_ROOT, { recursive: true, force: true });
    }
    mkdirSync(TMP_ROOT, { recursive: true });
    process.env.CLAUDE_MEM_DATA_DIR = TMP_ROOT;
    process.env.CLAUDE_MEM_HOOK_FAIL_LOUD_THRESHOLD = '2';
  });

  afterEach(() => {
    if (ORIGINAL_DATA_DIR === undefined) {
      delete process.env.CLAUDE_MEM_DATA_DIR;
    } else {
      process.env.CLAUDE_MEM_DATA_DIR = ORIGINAL_DATA_DIR;
    }
    delete process.env.CLAUDE_MEM_HOOK_FAIL_LOUD_THRESHOLD;
    if (existsSync(TMP_ROOT)) {
      rmSync(TMP_ROOT, { recursive: true, force: true });
    }
  });

  it('exports setCurrentHookEvent', async () => {
    const mod = await import('../../src/shared/worker-utils.js');
    expect(typeof mod.setCurrentHookEvent).toBe('function');
  });

  it('exports a test-only reset hook', async () => {
    const mod = await import('../../src/shared/worker-utils.js');
    expect(typeof mod.__resetCurrentHookEventForTests).toBe('function');
    mod.__resetCurrentHookEventForTests();
  });

  it('setCurrentHookEvent accepts the summarize event without throwing', async () => {
    const mod = await import('../../src/shared/worker-utils.js');
    mod.__resetCurrentHookEventForTests();
    expect(() => mod.setCurrentHookEvent('summarize')).not.toThrow();
    expect(() => mod.setCurrentHookEvent('observation')).not.toThrow();
  });

  it('setCurrentHookEvent accepts arbitrary event names without throwing', async () => {
    // The function is intentionally tolerant — unknown events default to
    // the original (exit-2) fail-loud behavior, which is the safe choice
    // for any future event Claude Code adds.
    const mod = await import('../../src/shared/worker-utils.js');
    mod.__resetCurrentHookEventForTests();
    expect(() => mod.setCurrentHookEvent('some-future-event')).not.toThrow();
  });
});
