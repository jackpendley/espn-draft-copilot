import { h } from 'preact';
import { useState, useEffect, useMemo, useCallback, useRef } from 'preact/hooks';
import { buildBoard, sortBoard, filterBoard, tierStatus, positionRuns, roundPlanFor } from '../core/board.js';
import { simulatePickOrder, nextPickForSlot } from '../core/keepers.js';
import { evaluate, worstSeverity, rosterNeeds } from '../core/rules.js';
import { DEFAULTS } from '../core/storage.js';
import { ESPN, SLEEPER, platformLabel } from '../core/platform.js';
import { send } from '../core/messaging.js';
import { extensionAlive, safeGet, safeSet, onStorageLocal } from '../core/runtime.js';
import { PlayerCard } from './PlayerCard.js';
import { TAG_COLOR, SEV_COLOR, one, signed, INJURY_SHORT } from './format.js';

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];

/**
 * @param platform  'espn' (the real draft) | 'sleeper' (rehearsal). The content script
 *                  decides from the hostname; the standalone page falls back to config.
 * @param draftId   Sleeper only: read straight out of the draft room URL, so a throwaway
 *                  mock needs no configuration.
 */
export function Panel({ platform: platformProp = null, draftId: draftIdProp = null, leagueId: leagueIdProp = null } = {}) {
  const [dataset, setDataset] = useState(null);
  const [config, setConfig] = useState(null);
  const [league, setLeague] = useState(null);
  const [draft, setDraft] = useState({ picks: [], inProgress: false });
  const [error, setError] = useState(null);

  const [sortMode, setSortMode] = useState('value');
  const [positions, setPositions] = useState([]);
  const [hideAvoid, setHideAvoid] = useState(false);
  const [targetsOnly, setTargetsOnly] = useState(false);
  const [youngOnly, setYoungOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const [stale, setStale] = useState(false);   // orphaned by an extension reload
  const [syncState, setSyncState] = useState('live');   // 'live' | 'reconnecting' | 'down'
  const [syncError, setSyncError] = useState(null);     // last error text, once sync is 'down'
  const [exiting, setExiting] = useState([]);   // rows fading out after being drafted
  const prevVisibleRef = useRef([]);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  // Read by the poll loop's closure at schedule-time -- refs stay live regardless of when
  // that effect was created, so this doesn't require re-keying the poll loop on every
  // draft update just to know how close the user's own pick is.
  const closeRef = useRef(false);

  // The content script knows which site it mounted on. The standalone page does not, so
  // it falls back to whatever the options page last selected.
  const platform = platformProp || config?.platform || ESPN;
  const isSleeper = platform === SLEEPER;
  const draftId = draftIdProp || config?.sleeperDraftId || null;
  const leagueId = leagueIdProp || config?.leagueId || null;
  const feed = { platform, ...(isSleeper ? { draftId } : { leagueId }) };

  // ---- load static things once ----
  useEffect(() => {
    (async () => {
      const d = await send({ type: 'dataset' });
      if (d?.ok) setDataset(d.dataset); else setError(d?.error || 'Could not load the guide dataset.');
      const cfg = { ...DEFAULTS, ...(await safeGet(null)) };
      setConfig(cfg);
      setSortMode(cfg.sortMode || 'value');
      setHideAvoid(!!cfg.hideAvoid);
    })();
    return onStorageLocal(() => {
      safeGet(null).then((c) => setConfig({ ...DEFAULTS, ...c }));
    });
  }, []);

  // Remember the draft we mounted on, so the options page and the standalone board can
  // follow along without being told the id by hand. Sleeper mocks get a new one each time.
  useEffect(() => {
    if (!isSleeper || !draftIdProp || !config) return;
    if (config.sleeperDraftId === draftIdProp && config.platform === SLEEPER) return;
    safeSet({ platform: SLEEPER, sleeperDraftId: draftIdProp });
  }, [isSleeper, draftIdProp, config?.sleeperDraftId, config?.platform]);

  // Same idea for ESPN: the real draft room's URL always carries its own leagueId, so trust
  // that over whatever was last typed into options -- a stale leagueId from a prior season
  // or a different league is exactly the kind of thing that silently breaks pick sync.
  useEffect(() => {
    if (isSleeper || !leagueIdProp || !config) return;
    if (config.leagueId === leagueIdProp && config.platform === ESPN) return;
    safeSet({ platform: ESPN, leagueId: leagueIdProp });
  }, [isSleeper, leagueIdProp, config?.leagueId, config?.platform]);

  // ---- league settings ----
  useEffect(() => {
    if (!config) return;
    if (isSleeper ? !draftId : !leagueId) return;
    let alive = true;
    (async () => {
      const l = await send({ type: 'league', ...feed });
      if (!alive) return;
      if (l?.ok) { setLeague(l.league); setError(null); }
      else setError(l?.error || null);
    })();
    return () => { alive = false; };
  }, [platform, draftId, leagueId]);

  // ---- poll live picks ----
  // Self-rescheduling loop rather than a fixed setInterval: a tick only ever schedules the
  // next one once it has finished, so a slow patch of network can never cause requests to
  // pile up on top of each other.
  //
  // Deliberately flat, not exponential: an earlier version doubled the delay on every
  // failure (as a defense against ESPN rate-limiting), but that turns ordinary, expected
  // hiccups into a compounding multi-second stall -- exactly the wrong trade during a fast
  // draft. The background now fails open to its last known-good picks (background/index.js)
  // instead of erroring, so a real failure reaching here should be rare; when one does, it
  // just retries at the normal cadence instead of backing off. Sleeper's documented limit is
  // ~1000 req/min (~17/sec); this loop never gets close, so there is no real rate-limit risk
  // to defend against on that side, and ESPN gets the same flat, bounded behavior.
  useEffect(() => {
    if (!config) return;
    if (isSleeper ? !draftId : !leagueId) return;
    let alive = true;
    let inFlight = false;
    let timer = null;
    let lastPickCount = null;
    let failStreak = 0;
    const NORMAL_MS = 1000;      // clean-run cadence
    const FAST_MS = 400;         // a pick just landed, or the user is on/near the clock
    const RATE_LIMIT_MS = 4000;  // short, flat pause on a *confirmed* 429 -- not exponential
    // The background already fails open to cached picks on a transient hiccup (see
    // background/index.js), so an error actually reaching the panel means something is
    // genuinely wrong (bad auth, no ESPN tab, real outage) -- surface it loudly after a
    // couple of misses rather than leaving it as a footer label nobody's watching mid-draft.
    const DOWN_AFTER = 2;

    const stop = () => { alive = false; if (timer) clearTimeout(timer); timer = null; };
    const schedule = (ms) => { if (alive) timer = setTimeout(tick, ms); };
    const base = () => (closeRef.current ? FAST_MS : NORMAL_MS);

    const tick = async () => {
      if (inFlight) return;   // a visibilitychange nudge can race a pending timer
      inFlight = true;
      // Computed up front and scheduled unconditionally in `finally`, below, so that a
      // thrown error on any one attempt can never silently kill the loop -- nothing here
      // skips past the schedule() call the way an early branch return used to.
      let nextDelay = base();
      try {
        if (!extensionAlive()) { setStale(true); stop(); return; }
        const r = await send({ type: 'picks', ...feed });
        if (!alive) return;
        if (r?.invalidated) { setStale(true); stop(); return; }
        if (r?.ok) {
          const count = r.rawPickCount ?? (r.picks ? r.picks.length : 0);
          const changed = lastPickCount != null && count !== lastPickCount;
          lastPickCount = count;
          nextDelay = changed ? FAST_MS : base();
          failStreak = 0;
          setSyncState('live');
          setSyncError(null);
          setDraft({
            picks: r.picks || [], inProgress: r.inProgress, drafted: r.drafted,
            keeperPicks: r.keeperPicks || [],
            rawPickCount: count,
          });
        } else {
          failStreak += 1;
          const rateLimited = /429/.test(String(r?.error || ''));
          nextDelay = rateLimited ? RATE_LIMIT_MS : base();
          setSyncState(failStreak >= DOWN_AFTER ? 'down' : 'reconnecting');
          setSyncError(r?.error || null);
          console.warn('[Draft Copilot] picks poll failed, retrying in', nextDelay, 'ms:', r?.error);
        }
      } catch (err) {
        failStreak += 1;
        nextDelay = base();
        setSyncState(failStreak >= DOWN_AFTER ? 'down' : 'reconnecting');
        setSyncError(String(err?.message || err));
        console.error('[Draft Copilot] picks poll threw, retrying in', nextDelay, 'ms:', err);
      } finally {
        inFlight = false;
        schedule(nextDelay);
      }
    };

    // A backgrounded tab's timers get throttled by the browser -- catch back up the moment
    // the draft tab is looked at again instead of waiting out whatever delay was pending.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (timer) clearTimeout(timer);
      tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    tick();
    return () => { document.removeEventListener('visibilitychange', onVisible); stop(); };
    // Deliberately NOT keyed on the keeper list: the worker reads that from storage
    // itself, and every ✓ mark writes storage -- re-keying would tear the poll down and
    // rebuild it on each one, mid-draft.
  }, [platform, draftId, leagueId]);

  const teams = league?.teams || config?.teams || 12;
  const rounds = league?.rounds || config?.rounds || 15;
  // On Sleeper the mirror league can deal you a different seat than ESPN did.
  const mySlot = (isSleeper ? config?.sleeperSlot : config?.myTeamSlot) || null;
  const snake = league?.raw?.type ? league.raw.type === 'snake' : true;

  // ---- resolve keepers to espnIds ----
  const keepers = useMemo(() => {
    if (!dataset || !config?.keepers) return [];
    return config.keepers.filter((k) => k.espnId);
  }, [dataset, config?.keepers]);

  const keptIds = useMemo(() => new Set(keepers.map((k) => k.espnId)), [keepers]);

  // Everyone off the board: the sheet's keepers plus any the Sleeper board is holding.
  const allKeptIds = useMemo(() => {
    const s = new Set(keptIds);
    for (const k of draft.keeperPicks || []) s.add(k.playerId);
    return s;
  }, [keptIds, draft.keeperPicks]);

  // Where a keeper was ACTUALLY taken beats where the sheet says. On Sleeper the keepers
  // are drafted by hand, so the feed tells us the true slot even if the mirror league's
  // draft order doesn't line up with ESPN's.
  const observedKeeperSlots = useMemo(() => {
    const m = new Map();
    for (const k of draft.keeperPicks || []) {
      if (k.teamSlot && k.round) m.set(k.playerId, { teamSlot: k.teamSlot, round: k.round });
    }
    return m;
  }, [draft.keeperPicks]);

  // Keepers sitting on a Sleeper board that aren't in the sheet yet -- other managers'
  // keepers as they get confirmed. They burn their round exactly the same way, and their
  // early-round ones are what move YOUR first picks.
  const boardOnlyKeepers = useMemo(() => (
    (draft.keeperPicks || []).filter((k) => !keptIds.has(k.playerId))
  ), [draft.keeperPicks, keptIds]);

  const draftedIds = useMemo(() => {
    // D/ST ids are negative in ESPN's data; 0 means no selection. Only 0 is a skip.
    const s = new Set(draft.picks.filter((p) => p.playerId).map((p) => p.playerId));
    for (const id of config?.manualDrafted || []) s.add(id);
    for (const id of config?.manualUndrafted || []) s.delete(id);
    return s;
  }, [draft.picks, config?.manualDrafted, config?.manualUndrafted]);

  // ---- pick order with keeper slots removed ----
  const order = useMemo(
    () => simulatePickOrder({
      teams, rounds, snake,
      keeperSlots: [
        ...keepers.map((k) => ({
          teamSlot: k.teamSlot, round: k.round,
          ...observedKeeperSlots.get(k.espnId),   // where it was really taken wins
          player: k.player,
        })),
        // Sleeper only: keepers read off the board that the sheet doesn't know about yet.
        ...boardOnlyKeepers.map((k) => ({ teamSlot: k.teamSlot, round: k.round, player: k.playerId })),
      ].filter((k) => k.teamSlot && k.round),
    }),
    [teams, rounds, snake, keepers, observedKeeperSlots, boardOnlyKeepers],
  );

  const currentOverall = draftedIds.size + 1;
  const nextInfo = mySlot ? nextPickForSlot(order.picks, mySlot, currentOverall) : null;
  const myNextOverall = nextInfo?.pick.overall ?? null;
  const onTheClock = myNextOverall === currentOverall;
  const currentRound = order.picks.find((p) => p.overall === currentOverall)?.round ?? 1;

  // Feeds the poll loop's fast lane: refresh aggressively right when it matters, not just
  // on a flat cadence the whole draft.
  useEffect(() => {
    closeRef.current = onTheClock || (nextInfo != null && nextInfo.picksUntilNext <= 3);
  }, [onTheClock, nextInfo]);

  const rows = useMemo(() => {
    if (!dataset) return [];
    return buildBoard(dataset, {
      draftedIds, keptIds: allKeptIds, currentOverall,
      myNextOverall: onTheClock ? (nextInfo?.pickAfter?.overall ?? null) : myNextOverall,
    });
  }, [dataset, draftedIds, allKeptIds, currentOverall, myNextOverall, onTheClock]);

  const visible = useMemo(
    () => sortBoard(filterBoard(rows, { positions, hideAvoid, targetsOnly, youngOnly, search }), sortMode).slice(0, 120),
    [rows, positions, hideAvoid, targetsOnly, youngOnly, search, sortMode],
  );

  // A row that was on screen last render and is now gone because it just got drafted gets
  // kept around a little longer, fading out, instead of just vanishing on the next poll.
  useEffect(() => {
    const currIds = new Set(visible.map((r) => r.espnId));
    const justLeft = prevVisibleRef.current.filter((r) => !currIds.has(r.espnId) && draftedIds.has(r.espnId));
    prevVisibleRef.current = visible;
    // Drop anything that came back into `visible` (a filter/sort change, or a keeper
    // reclassified) and de-dupe against anything already animating out -- two elements with
    // the same key is invalid and can throw during reconciliation, which would otherwise
    // silently kill this effect's ability to ever run again.
    setExiting((cur) => {
      const kept = cur.filter((r) => !currIds.has(r.espnId));
      const already = new Set(kept.map((r) => r.espnId));
      return [...kept, ...justLeft.filter((r) => !already.has(r.espnId))];
    });
    if (!justLeft.length) return;
    const ids = new Set(justLeft.map((r) => r.espnId));
    setTimeout(() => {
      if (!mountedRef.current) return;
      setExiting((cur) => cur.filter((r) => !ids.has(r.espnId)));
    }, 350);
  }, [visible, draftedIds]);

  const tiers = useMemo(() => tierStatus(rows).filter((t) => t.breaking && ['RB', 'WR', 'TE', 'QB'].includes(t.pos)), [rows]);

  const recent = useMemo(() => {
    if (!dataset) return [];
    const byId = new Map(dataset.players.map((p) => [p.espnId, p]));
    return draft.picks.slice(-10).map((p) => ({ ...p, player: byId.get(p.playerId) })).filter((p) => p.player);
  }, [draft.picks, dataset]);

  const runs = useMemo(() => positionRuns(recent.map((r) => ({ pos: r.player.pos })), 8), [recent]);

  const myRoster = useMemo(() => {
    if (!dataset || !mySlot) return [];
    const byId = new Map(dataset.players.map((p) => [p.espnId, p]));
    // Sleeper hands us the draft slot on every pick; ESPN doesn't, so there we read it
    // back off the simulated grid by overall number.
    const mine = draft.picks.filter((p) => (
      p.teamSlot != null ? p.teamSlot === mySlot
        : order.picks.find((o) => o.overall === p.overall)?.teamSlot === mySlot
    ));
    const fromPicks = mine.map((p) => byId.get(p.playerId)).filter(Boolean);
    const fromKeepers = keepers.filter((k) => k.teamSlot === mySlot).map((k) => byId.get(k.espnId)).filter(Boolean);
    const fromBoard = boardOnlyKeepers.filter((k) => k.teamSlot === mySlot).map((k) => byId.get(k.playerId)).filter(Boolean);
    return [...fromKeepers, ...fromBoard, ...fromPicks];
  }, [dataset, draft.picks, order.picks, mySlot, keepers, boardOnlyKeepers]);

  // His plan is written for 15 rounds; this league has its own count.
  const roundPlan = useMemo(
    () => (dataset ? roundPlanFor(dataset.strategy.roundByRound.plan, rounds) : []),
    [dataset, rounds],
  );
  const planTarget = roundPlan.find((p) => p.round === currentRound)?.target;

  // A rehearsal is only worth anything if the mirror league matches the real one. Warn,
  // never block -- a 15-round mock is still a useful test of everything except round 16.
  const drift = useMemo(() => {
    if (!isSleeper || !league) return [];
    const out = [];
    if (config?.teams && league.teams !== config.teams) out.push(`${league.teams} teams, not ${config.teams}`);
    if (config?.rounds && league.rounds !== config.rounds) out.push(`${league.rounds} rounds, not ${config.rounds}`);
    if (league.raw?.type && league.raw.type !== 'snake') out.push(`${league.raw.type} draft, not snake`);
    if (league.raw?.reversalRound) out.push(`3rd-round reversal is on`);
    return out;
  }, [isSleeper, league, config?.teams, config?.rounds]);

  // Sleeper's own clock counts the keepers this panel has taken back out, so the two
  // numbers diverge by exactly the number of keepers already drafted. Count the raw feed,
  // not the surviving picks, or the note is itself short by that same number.
  const sleeperNow = isSleeper && draft.rawPickCount ? draft.rawPickCount + 1 : null;
  const needs = league?.slotCounts ? rosterNeeds(myRoster, league.slotCounts) : [];

  const markDrafted = useCallback(async (espnId) => {
    const cur = (await safeGet('manualDrafted')).manualDrafted || [];
    await safeSet({ manualDrafted: [...new Set([...cur, espnId])] });
  }, []);

  // Shared between the live board rows and the ones fading out after being drafted, so the
  // exit animation renders the exact same row instead of a second, drifting definition.
  const renderRow = (r, isExiting = false) => {
    const warnings = evaluate(r, { round: currentRound, currentOverall, totalRounds: rounds, myRoster, planTarget });
    const sev = worstSeverity(warnings);
    const inj = INJURY_SHORT[r.injuryStatus];
    const young = r.yearsExp != null && r.yearsExp <= 2
      ? ['Rookie', '2nd year', '3rd year'][r.yearsExp] : null;
    return h('div', {
      key: r.espnId,
      class: `dc-row ${isExiting ? 'dc-row-exiting' : ''} ${young ? 'dc-young-row' : ''} ${selected?.espnId === r.espnId ? 'dc-selected' : ''}`,
      title: young ? `${young} -- keeper-league swing` : undefined,
      onClick: isExiting ? undefined : () => setSelected(selected?.espnId === r.espnId ? null : r),
    },
      h('span', { class: 'dc-rank' }, r.joelRank ?? '–'),
      h('span', { class: 'dc-dot', style: { background: TAG_COLOR[r.tag] } }),
      h('span', { class: 'dc-name' }, r.name,
        inj && h('span', { class: 'dc-inj' }, inj),
        r.joel?.profile && h('span', { class: 'dc-profileflag', title: 'Has a full profile card' }, '❞'),
      ),
      h('span', { class: 'dc-pos' }, `${r.pos}${r.posRank ?? ''}`),
      h('span', { class: 'dc-team' }, r.team),
      h('span', { class: 'dc-tier', title: `${r.pos} tier ${r.tier}` }, r.tier ? `T${r.tier}` : ''),
      h('span', { class: 'dc-adp', title: `ESPN ADP ${one(r.adp)} → keeper-adjusted ${one(r.adjAdp)}` }, one(r.adjAdp)),
      h('span', {
        class: `dc-reach ${r.reach < -8 ? 'dc-good' : (r.reach > 15 ? 'dc-bad' : '')}`,
        title: 'Picks between now and their adjusted ADP. Negative = they have fallen past it.',
      }, signed(r.reach)),
      h('span', {
        class: 'dc-avail',
        title: 'Chance they last until your next pick',
      }, r.availNext == null ? '' : `${Math.round(r.availNext * 100)}%`),
      sev && h('span', { class: 'dc-sev', style: { background: SEV_COLOR[sev] }, title: warnings.map((w) => w.title).join(' · ') }),
      h('button', {
        class: 'dc-mark', title: 'Mark drafted (safety net if ESPN sync lags)',
        onClick: (e) => { e.stopPropagation(); markDrafted(r.espnId); },
      }, '✓'),
    );
  };

  // Always the same header, whether expanded or not, so it stays inside .dc-shell (the
  // draggable node) either way -- dragging and the shell's own border/shadow keep working
  // on the minimized bar for free, instead of it becoming a separate, undraggable pill.
  const header = h('div', { class: 'dc-header' },
    h('span', { class: 'dc-title' }, 'Draft Copilot'),
    h('span', { class: 'dc-sub' }, "Joel Smyth's 2026 Guide · PPR"),
    h('span', {
      class: `dc-chip ${isSleeper ? 'dc-chip-practice' : ''}`,
      title: isSleeper
        ? 'Rehearsal on Sleeper. Same board, same ESPN ADP, same keeper maths — only the pick feed differs.'
        : 'Live ESPN league feed.',
    }, isSleeper ? 'SLEEPER · practice' : 'ESPN'),
    h('button', {
      class: 'dc-close',
      onClick: () => setCollapsed((c) => !c),
      title: collapsed ? 'Expand' : 'Collapse',
    }, collapsed ? '▸' : '–'),
  );

  if (collapsed) return header;

  return h('div', { class: 'dc-panel' },
    header,

    drift.length > 0 && h('div', { class: 'dc-drift' },
      h('strong', null, 'This Sleeper draft does not match your league: '),
      drift.join(' · '),
      '. The pick numbers below follow this draft, so they will not match Sept 3.'),

    stale && h('div', { class: 'dc-stale' },
      h('strong', null, 'This panel is out of date. '),
      'The extension was reloaded or updated, so it stopped syncing. Refresh this page to reconnect.',
      h('button', { onClick: () => location.reload() }, 'Refresh page')),

    !stale && error && h('div', { class: 'dc-error' }, error,
      h('button', { onClick: () => chrome.runtime.openOptionsPage() }, 'Open options')),

    // The background already absorbs one-off blips by serving cached picks, so this only
    // fires once the picks poll has actually failed a couple of times in a row -- something
    // real is wrong (auth, no ESPN tab, an outage) and the board has stopped updating. Loud
    // on purpose: a quiet footer label is exactly what got missed mid-draft before this existed.
    !stale && syncState === 'down' && h('div', { class: 'dc-syncdown' },
      h('strong', null, 'Not syncing picks. '),
      syncError || 'The last attempt to reach the draft feed failed.',
      ' The board below may be out of date -- use the ✓ button on a drafted player to keep it accurate by hand.'),

    config && (isSleeper ? !draftId : !leagueId) && h('div', { class: 'dc-error' },
      isSleeper
        ? "Couldn't read a draft ID from this page. Open the draft room itself (sleeper.com/draft/nfl/…), or paste the ID in options. "
        : 'No league configured yet. ',
      h('button', { onClick: () => chrome.runtime.openOptionsPage() }, 'Open options')),

    // An empty keeper sheet is the quiet failure: every number below is still computed,
    // just for a league where nobody kept anyone. It looks completely normal.
    config && allKeptIds.size === 0 && h('div', { class: 'dc-drift' },
      h('strong', null, 'No keepers. '),
      'Pick numbers, adjusted ADP and survival percentages are all being computed as if '
      + 'nobody kept anyone — which is not this league. ',
      h('button', { onClick: () => chrome.runtime.openOptionsPage() }, 'Paste the keeper sheet')),

    // Board keepers work for the rehearsal, but ESPN has no board to read on Sept 3.
    boardOnlyKeepers.length > 0 && h('div', { class: 'dc-drift' },
      h('strong', null, `${boardOnlyKeepers.length} keeper${boardOnlyKeepers.length > 1 ? 's' : ''} read off the Sleeper board. `),
      'Their rounds are being burned correctly here. They are not in your keeper sheet '
      + 'though, and ESPN has no board to read them from — add them before Sept 3.'),

    isSleeper && mySlot == null && h('div', { class: 'dc-drift' },
      h('strong', null, 'No draft slot set for Sleeper. '),
      'The board still works, but "your next pick", the survival percentages and the round '
      + 'plan all need to know which seat you are in. Set your Sleeper username in options '
      + 'and it will be read off the draft order.'),

    // ---- status strip ----
    h('div', { class: 'dc-status' },
      h('div', { class: 'dc-statbox' },
        h('div', { class: 'dc-statlabel' }, 'On the clock'),
        h('div', { class: 'dc-statvalue' }, `#${currentOverall}`, h('span', { class: 'dc-statsub' }, ` R${currentRound}`)),
        sleeperNow && sleeperNow !== currentOverall && h('div', {
          class: 'dc-statnote',
          title: 'Sleeper counts the keeper picks; this panel takes them back out, the way the real draft will.',
        }, `Sleeper #${sleeperNow}`),
      ),
      mySlot && nextInfo && h('div', { class: `dc-statbox ${onTheClock ? 'dc-you' : ''}` },
        h('div', { class: 'dc-statlabel' }, onTheClock ? 'YOUR PICK' : 'Your next'),
        h('div', { class: 'dc-statvalue' }, `#${nextInfo.pick.overall}`,
          !onTheClock && h('span', { class: 'dc-statsub' }, ` in ${nextInfo.picksUntilNext}`)),
      ),
      planTarget && h('div', { class: 'dc-statbox' },
        h('div', { class: 'dc-statlabel' }, `R${currentRound} plan`),
        h('div', { class: 'dc-statvalue dc-plan' }, planTarget),
      ),
      allKeptIds.size > 0 && h('div', { class: 'dc-statbox' },
        h('div', { class: 'dc-statlabel' }, 'Keepers'),
        h('div', { class: 'dc-statvalue' }, allKeptIds.size,
          boardOnlyKeepers.length > 0 && h('span', {
            class: 'dc-statsub',
            title: `${boardOnlyKeepers.length} read off the Sleeper board, not in your sheet yet`,
          }, ` +${boardOnlyKeepers.length} board`)),
      ),
    ),

    // ---- alerts ----
    (runs.length > 0 || tiers.length > 0) && h('div', { class: 'dc-alerts' },
      runs.map((r) => h('div', { class: 'dc-alert dc-alert-warn', key: `run-${r.pos}` },
        h('strong', null, `${r.pos} run`), ` — ${r.count} of the last ${r.of} picks`)),
      tiers.slice(0, 4).map((t) => h('div', { class: 'dc-alert dc-alert-note', key: `t-${t.pos}${t.tier}` },
        h('strong', null, `${t.pos} tier ${t.tier}`), ` — ${t.remaining} left: `,
        t.players.map((p) => p.name).join(', '))),
    ),

    needs.length > 0 && h('div', { class: 'dc-needs' },
      h('span', { class: 'dc-cardlabel' }, 'Still need: '),
      needs.map((n) => h('span', { class: 'dc-need', key: n.pos }, `${n.pos}×${n.need}`)),
    ),

    // ---- controls ----
    h('div', { class: 'dc-controls' },
      h('div', { class: 'dc-sorts' },
        ['value', 'joel', 'adp', 'edge'].map((m) => h('button', {
          key: m, class: sortMode === m ? 'dc-on' : '',
          title: {
            value: 'Best value now: Joel\'s rank weighted by how likely they vanish before your next pick',
            joel: "Joel's PPR board order",
            adp: 'Keeper-adjusted ADP',
            edge: 'Where Joel is furthest ahead of the market',
          }[m],
          onClick: () => { setSortMode(m); safeSet({ sortMode: m }); },
        }, { value: 'Best value', joel: 'Joel rank', adp: 'ADP', edge: 'Joel edge' }[m])),
      ),
      h('div', { class: 'dc-filters' },
        POSITIONS.map((p) => h('button', {
          key: p, class: positions.includes(p) ? 'dc-on' : '',
          onClick: () => setPositions((cur) => cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]),
        }, p)),
        h('button', { class: targetsOnly ? 'dc-on' : '', onClick: () => setTargetsOnly((v) => !v) }, '★ Targets'),
        h('button', {
          class: youngOnly ? 'dc-on' : '', onClick: () => setYoungOnly((v) => !v),
          title: 'Rookies through 3rd-year players -- keeper-league swings in the late rounds',
        }, '🌱 Young'),
        h('button', { class: hideAvoid ? 'dc-on' : '', onClick: () => { const v = !hideAvoid; setHideAvoid(v); safeSet({ hideAvoid: v }); } }, 'Hide avoid'),
      ),
      h('input', {
        class: 'dc-search', placeholder: 'Search player or team…',
        value: search, onInput: (e) => setSearch(e.target.value),
      }),
    ),

    // ---- board ----
    h('div', { class: 'dc-list' },
      visible.length === 0 && exiting.length === 0 && h('div', { class: 'dc-empty' }, 'Nobody left matching those filters.'),
      visible.map((r) => renderRow(r)),
      // Drafted since the last poll: kept mounted a moment longer, fading out, instead of
      // just disappearing.
      exiting.map((r) => renderRow(r, true)),
    ),

    // ---- selected player detail ----
    selected && h('div', { class: 'dc-detail' },
      h(WarningList, {
        warnings: evaluate(selected, { round: currentRound, currentOverall, totalRounds: rounds, myRoster, planTarget }),
      }),
      h(PlayerCard, { row: selected, dataset, onClose: () => setSelected(null) }),
    ),

    h('div', { class: 'dc-footer' },
      draft.inProgress
        ? (syncState === 'down'
          ? h('span', { class: 'dc-footer-warn' }, 'Not syncing — see above')
          : syncState === 'reconnecting'
            ? h('span', { class: 'dc-footer-warn' }, 'Reconnecting…')
            : 'Live · syncing in real time')
        : (draft.drafted ? 'Draft complete' : 'Draft not started'),
      ` · ${platformLabel(platform)}`,
      ' · ',
      h('a', { href: '#', onClick: (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); } }, 'keepers & settings'),
    ),
  );
}

function WarningList({ warnings }) {
  if (!warnings.length) return null;
  return h('div', { class: 'dc-warnings' },
    warnings.map((w) => h('div', { key: w.id, class: 'dc-warning', style: { borderLeftColor: SEV_COLOR[w.severity] } },
      h('strong', null, w.title), h('div', { class: 'dc-warndetail' }, w.detail))),
  );
}
