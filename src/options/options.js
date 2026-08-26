import { h, render } from 'preact';
import { useState, useEffect, useMemo } from 'preact/hooks';
import { parseKeeperPaste, simulatePickOrder } from '../core/keepers.js';
import { buildIndex, resolve } from '../core/names.js';
import { DEFAULTS } from '../core/storage.js';
import { ESPN, SLEEPER } from '../core/platform.js';
import { draftIdFromUrl } from '../core/sleeper-constants.js';
import { slotForUser } from '../core/sleeper-api.js';
import { send } from '../core/messaging.js';


/**
 * @param initialConfig  seeds the config synchronously instead of waiting on
 *                       chrome.storage. Only the tests pass it -- the real page loads
 *                       from storage in the effect below.
 */
export function App({ initialConfig = null } = {}) {
  const [cfg, setCfg] = useState(initialConfig);
  const [dataset, setDataset] = useState(null);
  const [league, setLeague] = useState(null);
  const [status, setStatus] = useState(null);
  const [paste, setPaste] = useState('');
  const [parsed, setParsed] = useState(null);
  const [diag, setDiag] = useState(null);
  const [sleeperLeague, setSleeperLeague] = useState(null);

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
    const r = await send({ type: 'league', platform: ESPN, leagueId: cfg.leagueId, force: true });
    if (!r?.ok) { setStatus({ kind: 'err', text: r?.error || 'Failed.' }); return; }
    setLeague(r.league);
    // Only the ESPN league defines the real draft, so only it writes teams/rounds.
    await save({ teams: r.league.teams, rounds: r.league.rounds });
    setStatus({
      kind: 'ok',
      text: `Connected: ${r.league.name} — ${r.league.teams} teams, ${r.league.rounds} rounds`
          + `, slots ${Object.entries(r.league.slotCounts).map(([k, v]) => `${k}×${v}`).join(' ')}`,
    });
  };

  // Sleeper is the rehearsal platform: it reproduces the one thing an ESPN mock cannot,
  // which is keepers sitting in their proper rounds. Connecting checks the mirror league
  // actually mirrors, and derives your seat from the draft order.
  const testSleeper = async () => {
    setStatus({ kind: 'ok', text: 'Contacting Sleeper…' });
    const r = await send({ type: 'league', platform: SLEEPER, draftId: cfg.sleeperDraftId, force: true });
    if (!r?.ok) { setStatus({ kind: 'err', text: r?.error || 'Failed.' }); return; }
    const L = r.league;
    setSleeperLeague(L);

    let slot = slotForUser(L, cfg.sleeperUserId);
    if (slot) await save({ sleeperSlot: slot });

    const mismatch = [
      L.teams !== (cfg.teams || 12) ? `${L.teams} teams (your league has ${cfg.teams || 12})` : null,
      L.rounds !== (cfg.rounds || 15) ? `${L.rounds} rounds (your league has ${cfg.rounds || 15})` : null,
      L.raw?.type !== 'snake' ? `a ${L.raw?.type} draft, not snake` : null,
      L.raw?.reversalRound ? '3rd-round reversal switched on' : null,
    ].filter(Boolean);

    setStatus({
      kind: mismatch.length ? 'err' : 'ok',
      text: `Sleeper: ${L.name} — ${L.teams} teams, ${L.rounds} rounds, ${L.raw?.type}, ${L.raw?.status}`
          + (slot ? `, you are slot ${slot}` : ', could not find your slot — set a username below')
          + (mismatch.length ? `. Mirror mismatch: ${mismatch.join('; ')}.` : '.'),
    });
  };

  const resolveSleeperUser = async () => {
    if (!cfg.sleeperUsername) return;
    setStatus({ kind: 'ok', text: 'Looking up that Sleeper user…' });
    const r = await send({ type: 'sleeper-user', username: cfg.sleeperUsername });
    if (!r?.ok) { setStatus({ kind: 'err', text: r?.error || 'Failed.' }); return; }
    await save({ sleeperUserId: r.user.userId });
    setStatus({ kind: 'ok', text: `Found ${r.user.displayName}. Hit "Connect to Sleeper" to read your draft slot.` });
  };

  // Replays a completed draft through the live sync path. This is the only way to prove
  // pick-sync works before the 2026 draft room opens. Both platforms get one: ESPN replays
  // your league's 2025 draft, Sleeper replays any finished draft you point it at.
  const runSleeperDiagnostics = async () => {
    setDiag({ running: true });
    const draftId = cfg.sleeperDraftId;
    const r = await send({ type: 'picks', platform: SLEEPER, draftId });
    if (!r?.ok) { setDiag({ error: r?.error || 'Failed.' }); return; }

    const byId = new Map((dataset?.players || []).map((p) => [p.espnId, p]));
    const picks = r.picks || [];
    const unmapped = picks.filter((p) => typeof p.playerId === 'string');
    const resolved = picks.filter((p) => byId.has(p.playerId));
    setDiag({
      platform: SLEEPER,
      season: draftId,
      total: r.rawPickCount ?? picks.length,
      keepers: (r.keeperPicks || []).length,
      keepersConfigured: (cfg.keepers || []).length,
      keeperRows: (r.keeperPicks || []).map((k) => ({
        name: byId.get(k.playerId)?.name || String(k.playerId),
        round: k.round, slot: k.teamSlot,
      })).sort((a, b) => a.round - b.round || a.slot - b.slot),
      resolved: resolved.length,
      // Two different failures: an id Sleeper has that ESPN doesn't, versus a real ESPN
      // player who simply isn't on Joel's 262-player board. Only the first is a worry.
      unresolved: picks.length - resolved.length,
      unmapped: unmapped.length,
      dst: picks.filter((p) => typeof p.playerId === 'number' && p.playerId < 0).length,
      skipped: 0,
      rounds: picks.length ? Math.max(...picks.map((p) => p.round)) : 0,
      teams: new Set(picks.map((p) => p.teamSlot)).size,
      sample: picks.slice(0, 6).map((p) => ({
        overall: p.overall, round: p.round, teamId: p.teamSlot, keeper: false,
        name: byId.get(p.playerId)?.name || `(sleeper id ${p.sleeperId})`,
      })),
    });
  };

  const runDiagnostics = async () => {
    setDiag({ running: true });
    const season = 2025;
    const r = await send({ type: 'picks', platform: ESPN, leagueId: cfg.leagueId, season });
    if (!r?.ok) { setDiag({ error: r?.error || 'Failed.' }); return; }

    const byId = new Map((dataset?.players || []).map((p) => [p.espnId, p]));
    const picks = r.picks || [];
    const withPlayers = picks.filter((p) => p.playerId);   // D/ST ids are negative
    const dstPicks = withPlayers.filter((p) => p.playerId < 0);
    const resolved = withPlayers.filter((p) => byId.has(p.playerId));
    setDiag({
      platform: ESPN,
      season,
      total: picks.length,
      keepers: picks.filter((p) => p.keeper).length,
      resolved: resolved.length,
      unresolved: withPlayers.length - resolved.length,
      dst: dstPicks.length,
      skipped: picks.length - withPlayers.length,
      rounds: picks.length ? Math.max(...picks.map((p) => p.round)) : 0,
      teams: new Set(picks.map((p) => p.teamId)).size,
      sample: picks.slice(0, 6).map((p) => ({
        overall: p.overall, round: p.round, teamId: p.teamId, keeper: p.keeper,
        name: byId.get(p.playerId)?.name || `(id ${p.playerId})`,
      })),
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

  const onSleeper = cfg.platform === SLEEPER;

  return h('div', null,
    h('h1', null, 'Draft Copilot'),
    h('p', { class: 'sub' }, "Joel Smyth's 2026 Draft Guide, keeper-aware, inside the ESPN draft room."),
    status && h('div', { class: `status ${status.kind}` }, status.text),

    // ---- which feed ----
    h('div', { class: 'card' },
      h('h2', { style: 'margin-top:0' }, 'Draft feed'),
      h('div', { class: 'row' },
        [[ESPN, 'ESPN — the real draft'], [SLEEPER, 'Sleeper — practice']].map(([id, label]) => h('button', {
          key: id,
          class: cfg.platform === id ? '' : 'secondary',
          onClick: () => save({ platform: id }),
        }, label)),
      ),
      h('p', { class: 'hint' },
        'This only matters for the standalone board and the diagnostics below — the in-page '
        + 'panel always follows whichever site it is actually running on. ',
        h('strong', null, 'Sleeper exists because an ESPN mock cannot rehearse keepers: '),
        'this league tracks them in a spreadsheet, so ESPN has no idea any round is spoken for. '
        + 'A Sleeper mirror league where you take each keeper by hand reproduces the real pick maths.'),
    ),

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

    // ---- sleeper (practice) ----
    h('div', { class: 'card' },
      h('h2', { style: 'margin-top:0' }, 'Sleeper practice draft'),
      h('p', { class: 'hint' },
        'Set up a Sleeper league that mirrors yours — 12 teams, 16 rounds, full PPR, '
        + 'QB1 RB2 WR2 TE1 FLEX1 DST1 K1 BE7 IR1, snake, no 3rd-round reversal — then draft '
        + 'each keeper by hand in its proper round. The panel takes those picks back out and '
        + 'renumbers the rest, exactly as it will on Sept 3, so every overall number you see '
        + 'is the number you would have seen in the real draft.'),
      h('div', { class: 'grid' },
        h('div', null, h('label', null, 'Sleeper draft ID'),
          h('input', {
            value: cfg.sleeperDraftId || '', placeholder: '1000000000000000002',
            onInput: (e) => save({ sleeperDraftId: draftIdFromUrl(e.target.value) || e.target.value.trim() }),
          })),
        h('div', null, h('label', null, 'Sleeper username'),
          h('input', {
            value: cfg.sleeperUsername || '', placeholder: 'your display name',
            onInput: (e) => save({ sleeperUsername: e.target.value.trim() }),
            onBlur: resolveSleeperUser,
          })),
        h('div', null, h('label', null, 'Your Sleeper slot'),
          h('input', {
            type: 'number', min: 1, max: 20, value: cfg.sleeperSlot || '',
            onInput: (e) => save({ sleeperSlot: Number(e.target.value) || null }),
          })),
      ),
      h('p', { class: 'hint' },
        'Paste the whole draft room URL if you like — ',
        h('code', null, 'sleeper.com/draft/nfl/1000000000000000002'),
        ' — the ID is pulled out of it. You usually will not need to: opening a Sleeper draft '
        + 'room fills this in on its own, which is what makes a throwaway mock zero-setup. '
        + 'The slot is read from the draft order once the username resolves.'),
      h('div', { class: 'row' },
        h('button', { onClick: testSleeper, disabled: !cfg.sleeperDraftId }, 'Connect to Sleeper'),
        h('button', { class: 'secondary', onClick: resolveSleeperUser, disabled: !cfg.sleeperUsername }, 'Look up username'),
        Object.keys(cfg.sleeperKeepers || {}).length > 0 && h('button', {
          class: 'danger',
          onClick: () => save({ sleeperKeepers: {} }),
        }, `Forget remembered keepers (${Object.values(cfg.sleeperKeepers || {}).reduce((n, a) => n + a.length, 0)})`),
      ),
      h('p', { class: 'hint' },
        'Keepers are recognised by sitting on the board before the draft runs, and then '
        + 'remembered — once the draft fills past a keeper\'s slot there is nothing left to '
        + 'recognise it by. Rebuilt a board with different keepers? Forget them and reconnect.'),
      sleeperLeague && h('p', { class: 'hint' },
        `Draft order: ${Object.keys(sleeperLeague.draftOrder || {}).length} managers seated. `
        + `Status ${sleeperLeague.raw?.status}.`),
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

    // ---- diagnostics ----
    h('div', { class: 'card' },
      h('h2', { style: 'margin-top:0' }, 'Pick-sync diagnostic'),
      h('p', { class: 'hint' },
        "The 2026 draft room isn't open yet, so the live pick feed can't be tested directly. "
        + "This replays a completed draft through the exact same code path — "
        + 'same auth, same parsing, same player-id mapping.'),
      h('div', { class: 'row' },
        h('button', { onClick: runDiagnostics, disabled: !cfg.leagueId || !dataset }, 'Replay 2025 ESPN draft'),
        h('button', {
          class: 'secondary', onClick: runSleeperDiagnostics, disabled: !cfg.sleeperDraftId || !dataset,
        }, 'Replay the Sleeper draft'),
      ),
      h('p', { class: 'hint' },
        'The Sleeper replay is the one that proves the ',
        h('code', null, 'sleeperId → espnId'),
        ' map works. Point it at any finished Sleeper draft — a previous mock will do.'),
      diag?.running && h('p', { class: 'hint' }, 'Fetching…'),
      diag?.error && h('div', { class: 'status err', style: 'margin-top:12px' }, diag.error),
      diag?.total != null && h('div', null,
        h('div', { class: `status ${diag.resolved > 0 ? 'ok' : 'err'}`, style: 'margin-top:12px' },
          `Read ${diag.total} picks from the ${diag.platform === SLEEPER ? 'Sleeper' : diag.season} draft`
          + ` — ${diag.rounds} rounds, ${diag.teams} teams. `
          + `${diag.resolved} mapped to players in the guide dataset`
          + (diag.unresolved ? `, ${diag.unresolved} not in it (expected: players who aren't on Joel's 262-name board).` : '.')
          + (diag.dst ? ` ${diag.dst} of them D/ST (negative ids).` : '')
          + (diag.skipped ? ` ${diag.skipped} picks had no player attached.` : '')
          + (diag.unmapped ? ` ${diag.unmapped} Sleeper ids had no ESPN counterpart at all — they still count toward the pick number, they just aren't struck off.` : '')
          + (diag.keepers ? ` ${diag.keepers} removed as keepers and the rest renumbered.` : '')),

        // A silent zero here is the one result that looks fine and isn't: the feed parsed,
        // the names resolved, and the pick numbers are still those of a league where
        // nobody kept anyone.
        diag.platform === SLEEPER && !diag.keepers && h('div', {
          class: 'status err', style: 'margin-top:8px',
        }, diag.keepersConfigured
          ? `No keeper picks were removed, but ${diag.keepersConfigured} keepers are saved — `
            + 'none of them were drafted in this draft. Take each keeper by hand in its proper '
            + 'round, or the pick numbers are those of a non-keeper league.'
          : 'No keeper sheet saved, so nothing was removed. These 192 picks are a plain '
            + '16-round draft — paste the keeper sheet above and replay to see the real numbers.'),
        diag.keeperRows?.length > 0 && h('div', null,
          h('h2', null, `Keepers found on the board (${diag.keeperRows.length})`),
          h('p', { class: 'hint' },
            'Sleeper flags none of these — they are recognised by sitting on the board before '
            + 'the draft ran, which nothing but a keeper can do. Their rounds are burned out of '
            + 'the snake, so every pick after them moves up. ',
            h('strong', null, 'These live only in this Sleeper draft'),
            ' — put them in the keeper sheet above as they get confirmed, because ESPN has no '
            + 'board to read them from on Sept 3.'),
          h('table', null,
            h('thead', null, h('tr', null, ['Round', 'Slot', 'Player', ''].map((t) => h('th', { key: t }, t)))),
            h('tbody', null, diag.keeperRows.map((k, i) => h('tr', { key: i, class: k.slot === cfg.sleeperSlot ? 'mine' : '' },
              h('td', null, `R${k.round}`),
              h('td', null, k.slot),
              h('td', null, k.name),
              h('td', null, k.slot === cfg.sleeperSlot ? h('span', { class: 'pill mine' }, 'YOURS') : null),
            ))),
          ),
        ),

        h('table', null,
          h('thead', null, h('tr', null,
            ['Overall', 'Round', diag.platform === SLEEPER ? 'Slot' : 'Team', 'Player', ''].map((t) => h('th', { key: t }, t)))),
          h('tbody', null, diag.sample.map((p) => h('tr', { key: p.overall },
            h('td', null, `#${p.overall}`),
            h('td', null, `R${p.round}`),
            h('td', null, p.teamId),
            h('td', null, p.name),
            h('td', null, p.keeper ? h('span', { class: 'pill ok' }, 'KEEPER') : null),
          ))),
        ),
        h('p', { class: 'hint' },
          'If this returns picks with real player names, the whole sync path works and the only '
          + 'thing left untested is that ESPN populates it live during the draft.'),
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

// Guarded so the component can be imported and rendered by the tests, where there is no
// document to mount into.
const root = typeof document !== 'undefined' && document.getElementById('root');
if (root) render(h(App), root);
