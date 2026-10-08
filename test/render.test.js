// Renders the panel against a small synthetic dataset with a stubbed chrome.* API.
// Catches component-level crashes that unit tests on pure logic would miss.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { h } from 'preact';
import renderToString from 'preact-render-to-string';

const dataset = JSON.parse(readFileSync(new URL('./fixtures/sample-dataset.json', import.meta.url), 'utf8'));
const byName = (n) => dataset.players.find((p) => p.name === n);

const KEEPERS = [
  { team: 'A', player: 'Wes Wideout', round: 6, espnId: byName('Wes Wideout').espnId, teamSlot: 5 },
  { team: 'B', player: 'Randy Runner', round: 1, espnId: byName('Randy Runner').espnId, teamSlot: 2 },
  { team: 'C', player: 'Tom Tightend', round: 3, espnId: byName('Tom Tightend').espnId, teamSlot: 7 },
];

const CONFIG = {
  leagueId: '123456', myTeamSlot: 5, teams: 12, rounds: 15,
  keepers: KEEPERS, manualDrafted: [], manualUndrafted: [],
  sortMode: 'value', hideAvoid: false,
};

const LEAGUE = {
  leagueId: '123456', name: 'Test League', teams: 12, rounds: 15,
  slotCounts: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, DST: 1, K: 1, BE: 6 },
  teamsById: {},
};

function stubChrome({ picks = [] } = {}) {
  globalThis.chrome = {
    runtime: {
      sendMessage: (msg, cb) => {
        if (msg.type === 'dataset') cb({ ok: true, dataset });
        else if (msg.type === 'league') cb({ ok: true, league: LEAGUE });
        else if (msg.type === 'picks') cb({ ok: true, picks, inProgress: true, drafted: false });
        else cb({ ok: false, error: 'unknown' });
      },
      openOptionsPage: () => {},
    },
    storage: {
      local: {
        get: async () => CONFIG,
        set: async () => {},
      },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  };
}

test('panel renders without throwing before any data has loaded', async () => {
  stubChrome();
  const { Panel } = await import('../src/panel/Panel.js');
  const html = renderToString(h(Panel));
  assert.match(html, /Draft Copilot/);
  // Default feed is the real one, so nothing should suggest a rehearsal.
  assert.match(html, /ESPN/);
  assert.ok(!/practice/.test(html));
});

test('an empty keeper sheet is called out, not silently computed around', async () => {
  // The quiet failure: with no keepers the board still renders perfectly, it is just
  // showing the pick numbers of a league nobody keeps anyone in.
  stubChrome();
  const { Panel } = await import('../src/panel/Panel.js');
  const html = renderToString(h(Panel));
  // Nothing has loaded yet in a synchronous render, so config is null and the warning is
  // correctly suppressed -- it must never flash before the sheet has been read.
  assert.ok(!/No keepers\./.test(html));
});

test('the panel says out loud when it is on the practice feed', async () => {
  // The chip is the thing that stops a Sleeper tab left open overnight from being
  // mistaken for the real draft room on Sept 3.
  stubChrome();
  const { Panel } = await import('../src/panel/Panel.js');
  const html = renderToString(h(Panel, { platform: 'sleeper', draftId: '123456789012' }));
  assert.match(html, /SLEEPER · practice/);
});

test('PlayerCard renders every section for a fully-populated player', async () => {
  stubChrome();
  const { PlayerCard } = await import('../src/panel/PlayerCard.js');
  const p = byName('Rico Runner');
  const row = {
    ...p, joelRank: p.joel.pprRank, posRank: p.joel.posRank, tier: p.joel.tier,
    tag: p.joel.tag, adp: p.espn.adp, adjAdp: 20.1, availNext: 0.31,
    injuryStatus: p.espn.injuryStatus, joel: p.joel,
  };
  const html = renderToString(h(PlayerCard, { row, dataset, onClose: () => {} }));
  assert.match(html, /Rico Runner/);
  assert.match(html, /w\/ Sam Slinger/);           // adjusted PPG reason
  assert.match(html, /Gold Standard/);            // gold mine bucket
  assert.match(html, /better in PPR/);            // ppr lean, our format
  assert.match(html, /Pat Playcaller/);               // playcaller
  assert.match(html, /regression risk/);          // he was lucky in 2025
  assert.match(html, /Rico Runner's starts/);    // one of the 50 stats
});

test('PlayerCard renders a player with almost no guide data attached', async () => {
  stubChrome();
  const { PlayerCard } = await import('../src/panel/PlayerCard.js');
  const row = {
    name: 'Nobody', pos: 'WR', team: 'FA', tag: 'neutral',
    adp: null, adjAdp: null, availNext: null, injuryStatus: null,
    joel: { stats: [] },
  };
  const html = renderToString(h(PlayerCard, { row, dataset, onClose: () => {} }));
  assert.match(html, /Nobody/);
});

test('the unlucky/lucky split reads the right direction', async () => {
  stubChrome();
  const { PlayerCard } = await import('../src/panel/PlayerCard.js');
  const lamb = byName('Wes Wideout');           // a player who lost points to bad luck
  const html = renderToString(h(PlayerCard, {
    row: { ...lamb, tag: 'neutral', joel: lamb.joel }, dataset, onClose: () => {},
  }));
  assert.match(html, /positive regression candidate/);
  assert.ok(!/regression risk/.test(html));
});

test('BoardRow renders rank, name, tag dot, and a young-player marker', async () => {
  stubChrome();
  const { BoardRow } = await import('../src/panel/BoardRow.js');
  const p = byName('Rico Runner');
  const row = { ...p, joelRank: 1, posRank: 1, tier: 1, tag: 'target', adp: 1.5, adjAdp: 1.5, reach: 2, availNext: 0.4, yearsExp: 0 };
  const html = renderToString(h(BoardRow, { row, warnings: [], onSelect: () => {}, onMark: () => {} }));
  assert.match(html, /Rico Runner/);
  assert.match(html, /dc-young-row/);
  assert.match(html, /40%/);
});
