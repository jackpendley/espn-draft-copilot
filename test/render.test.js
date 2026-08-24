// Renders the panel against the real dataset with a stubbed chrome.* API.
// Catches component-level crashes that unit tests on pure logic would miss.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { h } from 'preact';
import renderToString from 'preact-render-to-string';

const dataset = JSON.parse(readFileSync(new URL('../dist/dataset.json', import.meta.url), 'utf8'));
const byName = (n) => dataset.players.find((p) => p.name === n);

const KEEPERS = [
  { team: 'Jack', player: 'Jaxon Smith-Njigba', round: 6, espnId: byName('Jaxon Smith-Njigba').espnId, teamSlot: 5 },
  { team: 'Dave', player: 'Bijan Robinson', round: 1, espnId: byName('Bijan Robinson').espnId, teamSlot: 2 },
  { team: 'Sam',  player: 'Brock Bowers', round: 3, espnId: byName('Brock Bowers').espnId, teamSlot: 7 },
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
});

test('PlayerCard renders every section for a fully-populated player', async () => {
  stubChrome();
  const { PlayerCard } = await import('../src/panel/PlayerCard.js');
  const p = byName('Chase Brown');
  const row = {
    ...p, joelRank: p.joel.pprRank, posRank: p.joel.posRank, tier: p.joel.tier,
    tag: p.joel.tag, adp: p.espn.adp, adjAdp: 20.1, availNext: 0.31,
    injuryStatus: p.espn.injuryStatus, joel: p.joel,
  };
  const html = renderToString(h(PlayerCard, { row, dataset, onClose: () => {} }));
  assert.match(html, /Chase Brown/);
  assert.match(html, /w\/ Joe Burrow/);           // adjusted PPG reason
  assert.match(html, /Gold Standard/);            // gold mine bucket
  assert.match(html, /better in PPR/);            // ppr lean, our format
  assert.match(html, /Zac Taylor/);               // playcaller
  assert.match(html, /regression risk/);          // he was lucky in 2025
  assert.match(html, /Chase Brown's starts/);    // one of the 50 stats
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
  const lamb = byName('CeeDee Lamb');           // unluckiest player of 2025
  const html = renderToString(h(PlayerCard, {
    row: { ...lamb, tag: 'neutral', joel: lamb.joel }, dataset, onClose: () => {},
  }));
  assert.match(html, /positive regression candidate/);
  assert.ok(!/regression risk/.test(html));
});
