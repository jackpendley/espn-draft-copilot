import test from 'node:test';
import assert from 'node:assert/strict';
import { createPoller, NORMAL_MS, FAST_MS, RATE_LIMIT_MS } from '../src/panel/poller.js';

// A hand-driven clock: the poller schedules one timer at a time, and we fire it on demand.
function harness({ responses, close = false, alive = true }) {
  const log = { live: [], fail: [], stale: 0, delays: [] };
  let pending = null;
  const queue = [...responses];
  const poller = createPoller({
    fetchPicks: async () => { const r = queue.shift(); if (r instanceof Error) throw r; return r; },
    extensionAlive: () => alive,
    isClose: () => close,
    onLive: (r, count) => log.live.push(count),
    onFailure: (f) => log.fail.push(f),
    onStale: () => { log.stale += 1; },
    setTimer: (fn, ms) => { log.delays.push(ms); pending = fn; return 1; },
    clearTimer: () => { pending = null; },
  });
  const fire = async () => { const fn = pending; pending = null; await fn(); };
  return { poller, log, fire, hasTimer: () => pending !== null };
}

test('a clean poll reports live and reschedules at the normal cadence', async () => {
  const t = harness({ responses: [{ ok: true, picks: [1, 2] }] });
  await t.poller.start();
  assert.deepEqual(t.log.live, [2]);
  assert.deepEqual(t.log.delays, [NORMAL_MS]);
});

test('polls fast when the user is close to the clock, and right after a new pick', async () => {
  const t = harness({ responses: [{ ok: true, picks: [1] }, { ok: true, picks: [1, 2] }, { ok: true, picks: [1, 2] }] });
  await t.poller.start();
  await t.fire();
  await t.fire();
  assert.deepEqual(t.log.delays, [NORMAL_MS, FAST_MS, NORMAL_MS]);
});

test('a confirmed 429 pauses for the rate-limit delay; other errors keep the normal cadence', async () => {
  const t = harness({ responses: [{ ok: false, error: 'ESPN 429: rate limited' }, { ok: false, error: 'boom' }] });
  await t.poller.start();
  await t.fire();
  assert.deepEqual(t.log.delays, [RATE_LIMIT_MS, NORMAL_MS]);
});

test('sync is "reconnecting" on the first failure and "down" from the second; a success resets it', async () => {
  const t = harness({ responses: [{ ok: false, error: 'x' }, { ok: false, error: 'x' }, { ok: true, picks: [] }, { ok: false, error: 'x' }] });
  await t.poller.start();
  await t.fire();
  await t.fire();
  await t.fire();
  assert.deepEqual(t.log.fail.map((f) => f.state), ['reconnecting', 'down', 'reconnecting']);
});

test('a thrown error is reported and the loop keeps going', async () => {
  const t = harness({ responses: [new Error('kaboom'), { ok: true, picks: [] }] });
  await t.poller.start();
  assert.equal(t.log.fail[0].error, 'kaboom');
  assert.ok(t.hasTimer());
  await t.fire();
  assert.equal(t.log.live.length, 1);
});

test('an orphaned extension stops the loop for good', async () => {
  const t = harness({ responses: [], alive: false });
  await t.poller.start();
  assert.equal(t.log.stale, 1);
  assert.ok(!t.hasTimer());
});

test('a context-invalidated response also stops the loop', async () => {
  const t = harness({ responses: [{ ok: false, invalidated: true }] });
  await t.poller.start();
  assert.equal(t.log.stale, 1);
  assert.ok(!t.hasTimer());
});

test('stop() cancels the pending timer', async () => {
  const t = harness({ responses: [{ ok: true, picks: [] }] });
  await t.poller.start();
  t.poller.stop();
  assert.ok(!t.hasTimer());
});
