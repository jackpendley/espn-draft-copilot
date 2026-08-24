import { h } from 'preact';
import { useState, useEffect, useMemo, useCallback } from 'preact/hooks';
import { buildBoard, sortBoard, filterBoard, tierStatus, positionRuns, roundPlanFor } from '../core/board.js';
import { simulatePickOrder, nextPickForSlot } from '../core/keepers.js';
import { evaluate, worstSeverity, rosterNeeds } from '../core/rules.js';
import { DEFAULTS } from '../core/storage.js';
import { PlayerCard } from './PlayerCard.js';
import { TAG_COLOR, SEV_COLOR, one, signed, INJURY_SHORT } from './format.js';

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];
const send = (msg) => new Promise((res) => chrome.runtime.sendMessage(msg, res));

export function Panel() {
  const [dataset, setDataset] = useState(null);
  const [config, setConfig] = useState(null);
  const [league, setLeague] = useState(null);
  const [draft, setDraft] = useState({ picks: [], inProgress: false });
  const [error, setError] = useState(null);

  const [sortMode, setSortMode] = useState('value');
  const [positions, setPositions] = useState([]);
  const [hideAvoid, setHideAvoid] = useState(false);
  const [targetsOnly, setTargetsOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [collapsed, setCollapsed] = useState(false);

  // ---- load static things once ----
  useEffect(() => {
    (async () => {
      const d = await send({ type: 'dataset' });
      if (d?.ok) setDataset(d.dataset); else setError(d?.error || 'Could not load the guide dataset.');
      const cfg = { ...DEFAULTS, ...(await chrome.storage.local.get(null)) };
      setConfig(cfg);
      setSortMode(cfg.sortMode || 'value');
      setHideAvoid(!!cfg.hideAvoid);
      const l = await send({ type: 'league' });
      if (l?.ok) setLeague(l.league);
      else setError((e) => e || l?.error || null);
    })();
    const onChange = (changes, area) => {
      if (area !== 'local') return;
      chrome.storage.local.get(null).then((c) => setConfig({ ...DEFAULTS, ...c }));
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  // ---- poll live picks ----
  useEffect(() => {
    if (!config?.leagueId) return;
    let alive = true;
    const tick = async () => {
      const r = await send({ type: 'picks' });
      if (alive && r?.ok) setDraft({ picks: r.picks, inProgress: r.inProgress, drafted: r.drafted });
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(id); };
  }, [config?.leagueId]);

  const teams = league?.teams || config?.teams || 12;
  const rounds = league?.rounds || config?.rounds || 15;
  const mySlot = config?.myTeamSlot || null;

  // ---- resolve keepers to espnIds ----
  const keepers = useMemo(() => {
    if (!dataset || !config?.keepers) return [];
    return config.keepers.filter((k) => k.espnId);
  }, [dataset, config?.keepers]);

  const keptIds = useMemo(() => new Set(keepers.map((k) => k.espnId)), [keepers]);

  const draftedIds = useMemo(() => {
    const s = new Set(draft.picks.filter((p) => p.playerId > 0).map((p) => p.playerId));
    for (const id of config?.manualDrafted || []) s.add(id);
    for (const id of config?.manualUndrafted || []) s.delete(id);
    return s;
  }, [draft.picks, config?.manualDrafted, config?.manualUndrafted]);

  // ---- pick order with keeper slots removed ----
  const order = useMemo(
    () => simulatePickOrder({
      teams, rounds,
      keeperSlots: keepers.filter((k) => k.teamSlot && k.round).map((k) => ({ teamSlot: k.teamSlot, round: k.round, player: k.player })),
    }),
    [teams, rounds, keepers],
  );

  const currentOverall = draftedIds.size + 1;
  const nextInfo = mySlot ? nextPickForSlot(order.picks, mySlot, currentOverall) : null;
  const myNextOverall = nextInfo?.pick.overall ?? null;
  const onTheClock = myNextOverall === currentOverall;
  const currentRound = order.picks.find((p) => p.overall === currentOverall)?.round ?? 1;

  const rows = useMemo(() => {
    if (!dataset) return [];
    return buildBoard(dataset, {
      draftedIds, keptIds, currentOverall,
      myNextOverall: onTheClock ? (nextInfo?.pickAfter?.overall ?? null) : myNextOverall,
    });
  }, [dataset, draftedIds, keptIds, currentOverall, myNextOverall, onTheClock]);

  const visible = useMemo(
    () => sortBoard(filterBoard(rows, { positions, hideAvoid, targetsOnly, search }), sortMode).slice(0, 120),
    [rows, positions, hideAvoid, targetsOnly, search, sortMode],
  );

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
    const mine = draft.picks.filter((p) => order.picks.find((o) => o.overall === p.overall)?.teamSlot === mySlot);
    const fromPicks = mine.map((p) => byId.get(p.playerId)).filter(Boolean);
    const fromKeepers = keepers.filter((k) => k.teamSlot === mySlot).map((k) => byId.get(k.espnId)).filter(Boolean);
    return [...fromKeepers, ...fromPicks];
  }, [dataset, draft.picks, order.picks, mySlot, keepers]);

  // His plan is written for 15 rounds; this league has its own count.
  const roundPlan = useMemo(
    () => (dataset ? roundPlanFor(dataset.strategy.roundByRound.plan, rounds) : []),
    [dataset, rounds],
  );
  const planTarget = roundPlan.find((p) => p.round === currentRound)?.target;
  const needs = league?.slotCounts ? rosterNeeds(myRoster, league.slotCounts) : [];

  const markDrafted = useCallback(async (espnId) => {
    const cur = (await chrome.storage.local.get('manualDrafted')).manualDrafted || [];
    await chrome.storage.local.set({ manualDrafted: [...new Set([...cur, espnId])] });
  }, []);

  if (collapsed) {
    return h('div', { class: 'dc-collapsed', onClick: () => setCollapsed(false) }, 'Draft Copilot ▸');
  }

  return h('div', { class: 'dc-panel' },
    h('div', { class: 'dc-header' },
      h('span', { class: 'dc-title' }, 'Draft Copilot'),
      h('span', { class: 'dc-sub' }, "Joel Smyth's 2026 Guide · PPR"),
      h('button', { class: 'dc-close', onClick: () => setCollapsed(true), title: 'Collapse' }, '–'),
    ),

    error && h('div', { class: 'dc-error' }, error,
      h('button', { onClick: () => chrome.runtime.openOptionsPage() }, 'Open options')),

    !config?.leagueId && h('div', { class: 'dc-error' },
      'No league configured yet. ',
      h('button', { onClick: () => chrome.runtime.openOptionsPage() }, 'Set league + keepers')),

    // ---- status strip ----
    h('div', { class: 'dc-status' },
      h('div', { class: 'dc-statbox' },
        h('div', { class: 'dc-statlabel' }, 'On the clock'),
        h('div', { class: 'dc-statvalue' }, `#${currentOverall}`, h('span', { class: 'dc-statsub' }, ` R${currentRound}`)),
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
      keepers.length > 0 && h('div', { class: 'dc-statbox' },
        h('div', { class: 'dc-statlabel' }, 'Keepers'),
        h('div', { class: 'dc-statvalue' }, keepers.length),
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
          onClick: () => { setSortMode(m); chrome.storage.local.set({ sortMode: m }); },
        }, { value: 'Best value', joel: 'Joel rank', adp: 'ADP', edge: 'Joel edge' }[m])),
      ),
      h('div', { class: 'dc-filters' },
        POSITIONS.map((p) => h('button', {
          key: p, class: positions.includes(p) ? 'dc-on' : '',
          onClick: () => setPositions((cur) => cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]),
        }, p)),
        h('button', { class: targetsOnly ? 'dc-on' : '', onClick: () => setTargetsOnly((v) => !v) }, '★ Targets'),
        h('button', { class: hideAvoid ? 'dc-on' : '', onClick: () => { const v = !hideAvoid; setHideAvoid(v); chrome.storage.local.set({ hideAvoid: v }); } }, 'Hide avoid'),
      ),
      h('input', {
        class: 'dc-search', placeholder: 'Search player or team…',
        value: search, onInput: (e) => setSearch(e.target.value),
      }),
    ),

    // ---- board ----
    h('div', { class: 'dc-list' },
      visible.length === 0 && h('div', { class: 'dc-empty' }, 'Nobody left matching those filters.'),
      visible.map((r) => {
        const warnings = evaluate(r, { round: currentRound, currentOverall, totalRounds: rounds, myRoster, planTarget });
        const sev = worstSeverity(warnings);
        const inj = INJURY_SHORT[r.injuryStatus];
        return h('div', {
          key: r.espnId,
          class: `dc-row ${selected?.espnId === r.espnId ? 'dc-selected' : ''}`,
          onClick: () => setSelected(selected?.espnId === r.espnId ? null : r),
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
      }),
    ),

    // ---- selected player detail ----
    selected && h('div', { class: 'dc-detail' },
      h(WarningList, {
        warnings: evaluate(selected, { round: currentRound, currentOverall, totalRounds: rounds, myRoster, planTarget }),
      }),
      h(PlayerCard, { row: selected, dataset, onClose: () => setSelected(null) }),
    ),

    h('div', { class: 'dc-footer' },
      draft.inProgress ? 'Live · syncing every 3s' : (draft.drafted ? 'Draft complete' : 'Draft not started'),
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
