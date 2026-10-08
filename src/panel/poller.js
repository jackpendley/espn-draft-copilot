// The live-pick poll loop, kept free of Preact so it can be tested with fake timers.
//
// Self-rescheduling rather than a fixed setInterval: a tick only schedules the next one once
// it has finished, so a slow patch of network can never stack requests on top of each other.
// The next tick is scheduled in `finally`, so an error on one attempt can never kill the loop.
//
// Backoff is deliberately flat, not exponential. The background already serves its last
// known-good picks on a transient failure (see background/index.js), so an error that reaches
// this loop is genuinely wrong (bad auth, no ESPN tab, real outage) and retrying at the normal
// cadence beats a compounding multi-second stall mid-draft. The one exception is a confirmed
// 429, which gets a short flat pause.

import { isRateLimited } from '../core/errors.js';

export const NORMAL_MS = 1000;      // clean-run cadence
export const FAST_MS = 400;         // a pick just landed, or the user is on/near the clock
export const RATE_LIMIT_MS = 4000;  // flat pause after a confirmed 429
export const DOWN_AFTER = 2;        // consecutive failures before the panel says sync is down

/**
 * @param fetchPicks      () => Promise<response> -- the 'picks' message round trip
 * @param extensionAlive  () => boolean -- false once an extension reload orphaned this script
 * @param isClose         () => boolean -- the user is on or near the clock, so poll fast
 * @param onLive          (response, pickCount) -- a successful poll
 * @param onFailure       ({ state: 'reconnecting'|'down', error, delay }) -- a failed poll
 * @param onStale         () -- the extension was reloaded; polling has stopped for good
 */
export function createPoller({
  fetchPicks, extensionAlive, isClose, onLive, onFailure, onStale,
  setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  let alive = true;
  let inFlight = false;
  let timer = null;
  let lastPickCount = null;
  let failStreak = 0;

  const base = () => (isClose() ? FAST_MS : NORMAL_MS);
  const stop = () => { alive = false; if (timer) clearTimer(timer); timer = null; };
  const schedule = (ms) => { if (alive) timer = setTimer(tick, ms); };
  const fail = (error, delay) => {
    failStreak += 1;
    onFailure({ state: failStreak >= DOWN_AFTER ? 'down' : 'reconnecting', error, delay });
  };

  async function tick() {
    if (inFlight) return;   // a visibility nudge can race a pending timer
    inFlight = true;
    let nextDelay = base();
    try {
      if (!extensionAlive()) { onStale(); stop(); return; }
      const r = await fetchPicks();
      if (!alive) return;
      if (r?.invalidated) { onStale(); stop(); return; }
      if (r?.ok) {
        const count = r.rawPickCount ?? (r.picks ? r.picks.length : 0);
        const changed = lastPickCount != null && count !== lastPickCount;
        lastPickCount = count;
        nextDelay = changed ? FAST_MS : base();
        failStreak = 0;
        onLive(r, count);
      } else {
        nextDelay = isRateLimited(r?.error) ? RATE_LIMIT_MS : base();
        fail(r?.error || null, nextDelay);
      }
    } catch (err) {
      nextDelay = base();
      fail(String(err?.message || err), nextDelay);
    } finally {
      inFlight = false;
      schedule(nextDelay);
    }
  }

  /** Poll now instead of waiting out a pending timer (a backgrounded tab's timers are throttled). */
  const nudge = () => { if (timer) clearTimer(timer); timer = null; return tick(); };

  return { start: tick, nudge, stop };
}
