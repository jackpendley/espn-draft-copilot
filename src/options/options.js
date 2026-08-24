import { h, render } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import { parseKeeperPaste, simulatePickOrder } from '../core/keepers.js';
import { buildIndex, resolve } from '../core/names.js';
import { DEFAULTS } from '../core/storage.js';

const send = (msg) => new Promise((r) => chrome.runtime.sendMessage(msg, r));

function App() {
  const [cfg, setCfg] = useState(null);
  const [dataset, setDataset] = useState(null);
  const [league, setLeague] = useState(null);
  const [status, setStatus] = useState(null);
  const [paste, setPaste] = useState('');
  const [parsed, setParsed] = useState(null);

  useEffect(() => {
    (async () => {
      setCfg({ ...DEFAULTS, ...(await chrome.storage.local.get(null)) });
      const d = await send({ type: 'dataset' });
      if (d?.ok) setDataset(d.dataset);
    })();
  }, []);

  const index = useMemo(
    () => (dataset ? buildIndex(dataset.players.map((p) => ({ ...p, name: p.name }))) : null),
    [dataset],
  );

  const save = async (patch) => {
    await chrome.storage.local.set(patch);
    setCfg({ ...DEFAULTS, ...(await chrome.storage.local.get(null)) });
  };

  const testLeague = async () => {
    setStatus({ kind: 'ok', text: 'Contacting ESPN…' });
    const r = await send({ type: 'league', leagueId: cfg.leagueId, force: true });
    if (!r?.ok) { setStatus({ kind: 'err', text: r?.error || 'Failed.' }); return; }
    setLeague(r.league);
    await save({ teams: r.league.teams, rounds: r.league.rounds });
    setStatus({
      kind: 'ok',
      text: `Connected: ${r.league.name} — ${r.league.teams} teams, ${r.league.rounds} rounds`
          + `, slots ${Object.entries(r.league.slotCounts).map(([k, v]) => `${k}×${v}`).join(' ')}`,
    });
  };

  // ---- keeper paste ----
  const doParse = () => {
    if (!index) return;
    const { rows, errors } = parseKeeperPaste(paste);
    const resolved = rows.map((r) => {
      const m = resolve(index, r.player, null, {});
      return {
        ...r,
        espnId: m.player?.espnId ?? null,
        matchedName: m.player?.name ?? null,
        pos: m.player?.pos ?? null,
        nflTeam: m.player?.team ?? null,   // keep separate: r.team is the OWNER from the sheet
        how: m.how ?? m.reason,
      };
    });
    setParsed({ rows: resolved, errors });
  };

  const commit = async () => {
    if (!parsed) return;
    const good = parsed.rows.filter((r) => r.espnId);
    await save({ keepers: good.map((r) => ({
      team: r.team, player: r.matchedName, round: r.round,
      espnId: r.espnId, teamSlot: r.teamSlot ?? null,
    })) });
    setStatus({ kind: 'ok', text: `Saved ${good.length} keepers.` });
  };

  if (!cfg) return h('p', null, 'Loading…');

  const keepers = cfg.keepers || [];
  const order = simulatePickOrder({
    teams: cfg.teams || 12, rounds: cfg.rounds || 15,
    keeperSlots: keepers.filter((k) => k.teamSlot && k.round),
  });
  const myPicks = cfg.myTeamSlot ? order.picks.filter((p) => p.teamSlot === cfg.myTeamSlot) : [];
  const myKeptRounds = new Set(keepers.filter((k) => k.teamSlot === cfg.myTeamSlot).map((k) => k.round));

  return h('div', null,
    h('h1', null, 'Draft Copilot'),
    h('p', { class: 'sub' }, "Joel Smyth's 2026 Draft Guide, keeper-aware, inside the ESPN draft room."),
    status && h('div', { class: `status ${status.kind}` }, status.text),

    // ---- league ----
    h('div', { class: 'card' },
      h('h2', { style: 'margin-top:0' }, 'League'),
      h('div', { class: 'grid' },
        h('div', null, h('label', null, 'ESPN League ID'),
          h('input', {
            value: cfg.leagueId || '', placeholder: '1234567',
            onInput: (e) => save({ leagueId: e.target.value.trim() }),
          })),
        h('div', null, h('label', null, 'Your draft slot'),
          h('input', {
            type: 'number', min: 1, max: 20, value: cfg.myTeamSlot || '',
            onInput: (e) => save({ myTeamSlot: Number(e.target.value) || null }),
          })),
        h('div', null, h('label', null, 'Teams'),
          h('input', { type: 'number', value: cfg.teams || 12, onInput: (e) => save({ teams: Number(e.target.value) }) })),
        h('div', null, h('label', null, 'Rounds'),
          h('input', { type: 'number', value: cfg.rounds || 15, onInput: (e) => save({ rounds: Number(e.target.value) }) })),
      ),
      h('p', { class: 'hint' },
        'The league ID is in your draft room URL: ',
        h('code', null, 'fantasy.espn.com/football/draft?leagueId=1234567'),
        '. Teams and rounds fill in automatically once you connect.'),
      h('div', { class: 'row' },
        h('button', { onClick: testLeague }, 'Connect to ESPN'),
      ),
    ),

    // ---- your picks ----
    cfg.myTeamSlot && h('div', { class: 'card' },
      h('h2', { style: 'margin-top:0' }, `Your real picks from slot ${cfg.myTeamSlot}`),
      h('div', { class: 'picks' },
        Array.from({ length: cfg.rounds || 15 }, (_, i) => i + 1).map((rd) => {
          if (myKeptRounds.has(rd)) {
            const k = keepers.find((x) => x.teamSlot === cfg.myTeamSlot && x.round === rd);
            return h('span', { class: 'pick kept', key: rd }, `R${rd} · ${k.player} (kept)`);
          }
          const p = myPicks.find((x) => x.round === rd);
          return p ? h('span', { class: 'pick', key: rd }, `R${rd} · #${p.overall}`) : null;
        }),
      ),
      h('p', { class: 'hint' },
        'Every keeper anyone declares removes a slot from the snake, so these overall numbers shift as you add keepers below.'),
    ),

    // ---- keepers ----
    h('div', { class: 'card' },
      h('h2', { style: 'margin-top:0' }, 'Keepers'),
      h('p', { class: 'hint' },
        'Select the range in your Google Sheet, copy, and paste here. Columns: ',
        h('code', null, 'Team'), ' ', h('code', null, 'Player'), ' ', h('code', null, 'Round'),
        '. A header row is detected automatically. You can re-paste any time, including mid-draft.'),
      h('textarea', {
        value: paste, placeholder: 'Team\tPlayer\tRound\nJack\tJaxon Smith-Njigba\t6\n…',
        onInput: (e) => setPaste(e.target.value),
      }),
      h('div', { class: 'row' },
        h('button', { onClick: doParse, disabled: !index }, 'Parse & match'),
        parsed && h('button', { class: 'secondary', onClick: commit }, `Save ${parsed.rows.filter((r) => r.espnId).length} keepers`),
        keepers.length > 0 && h('button', { class: 'danger', onClick: () => save({ keepers: [] }) }, 'Clear all'),
      ),

      parsed && h('div', null,
        parsed.errors.length > 0 && h('p', { class: 'hint', style: 'color:#8c1d18' },
          `${parsed.errors.length} row(s) could not be read: `,
          parsed.errors.map((e) => `line ${e.line} (${e.reason})`).join('; ')),
        h('table', null,
          h('thead', null, h('tr', null,
            ['Team', 'Pasted name', 'Matched', 'Pos', 'Round', 'Draft slot', ''].map((t) => h('th', { key: t }, t)))),
          h('tbody', null, parsed.rows.map((r, i) => h('tr', { key: i, class: r.espnId ? '' : 'bad' },
            h('td', null, r.team),
            h('td', null, r.player),
            h('td', null, r.matchedName || '—'),
            h('td', null, r.pos ? `${r.pos} ${r.nflTeam || ''}` : '—'),
            h('td', null, r.round),
            h('td', null, h('input', {
              type: 'number', min: 1, max: cfg.teams || 12, style: 'width:64px', value: r.teamSlot || '',
              onInput: (e) => {
                const v = Number(e.target.value) || null;
                setParsed((p) => ({ ...p, rows: p.rows.map((x, j) => (j === i ? { ...x, teamSlot: v } : x)) }));
              },
            })),
            h('td', null, r.espnId
              ? h('span', { class: 'pill ok' }, r.how === 'exact-name' || r.how === 'exact-name-pos' ? 'MATCHED' : String(r.how).toUpperCase())
              : h('span', { class: 'pill err' }, 'NO MATCH')),
          ))),
        ),
        h('p', { class: 'hint' },
          'Set each keeper\'s draft slot (1–', String(cfg.teams || 12),
          ') so the pick-order simulation knows whose round to burn. Rows with no match are skipped on save — fix the spelling and re-parse.'),
      ),

      keepers.length > 0 && h('div', null,
        h('h2', null, `Saved keepers (${keepers.length})`),
        h('table', null,
          h('thead', null, h('tr', null, ['Team', 'Player', 'Round', 'Slot', ''].map((t) => h('th', { key: t }, t)))),
          h('tbody', null, keepers.map((k, i) => h('tr', { key: i, class: k.teamSlot === cfg.myTeamSlot ? 'mine' : '' },
            h('td', null, k.team),
            h('td', null, k.player),
            h('td', null, `R${k.round}`),
            h('td', null, k.teamSlot ?? '—'),
            h('td', null, k.teamSlot === cfg.myTeamSlot ? h('span', { class: 'pill mine' }, 'YOURS') : null),
          ))),
        ),
      ),
    ),

    // ---- safety net ----
    h('div', { class: 'card' },
      h('h2', { style: 'margin-top:0' }, 'Draft-day safety net'),
      h('p', { class: 'hint' },
        'If ESPN\'s pick sync lags or you veto a pick as commissioner, these override it. '
        + 'Manually-marked players are treated as drafted; the un-drafted list wins over everything.'),
      h('div', { class: 'row' },
        h('button', {
          class: 'secondary',
          onClick: () => save({ manualDrafted: [], manualUndrafted: [] }),
        }, `Clear manual overrides (${(cfg.manualDrafted || []).length} drafted, ${(cfg.manualUndrafted || []).length} un-drafted)`),
        h('button', {
          class: 'secondary',
          onClick: () => window.open(chrome.runtime.getURL('build/standalone.html'), '_blank'),
        }, 'Open standalone board'),
      ),
      h('p', { class: 'hint' },
        'The standalone board is the escape hatch: if the in-page panel ever fails mid-draft, '
        + 'open it in a second window. It still syncs picks from ESPN.'),
    ),

    dataset && h('p', { class: 'hint' },
      `Guide dataset: ${dataset.players.length} players, built ${new Date(dataset.builtAt).toLocaleString()}`,
      `. ESPN ADP fetched ${new Date(dataset.espnFetchedAt).toLocaleString()}.`),
  );
}

render(h(App), document.getElementById('root'));
