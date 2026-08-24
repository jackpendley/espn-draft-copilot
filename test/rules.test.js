import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, worstSeverity, rosterNeeds } from '../src/core/rules.js';

const row = (o = {}) => ({
  name: 'Player', pos: 'RB', posRank: 15, joelRank: 30, tag: 'neutral',
  reach: 0, adjAdp: 30, joel: {}, ...o,
});
const ctx = (o = {}) => ({ round: 3, currentOverall: 30, totalRounds: 15, myRoster: [], ...o });

const ids = (ws) => ws.map((w) => w.id);

test('K and D/ST before the last two rounds is blocked', () => {
  assert.ok(ids(evaluate(row({ pos: 'K' }), ctx({ round: 10 }))).includes('no-early-k-dst'));
  assert.ok(ids(evaluate(row({ pos: 'DST' }), ctx({ round: 13 }))).includes('no-early-k-dst'));
});

test('K and D/ST in the last two rounds is fine', () => {
  assert.ok(!ids(evaluate(row({ pos: 'K' }), ctx({ round: 15 }))).includes('no-early-k-dst'));
  assert.ok(!ids(evaluate(row({ pos: 'DST' }), ctx({ round: 14 }))).includes('no-early-k-dst'));
});

test('the RB30-40 dead zone warns, RB29 and RB41 do not', () => {
  assert.ok(ids(evaluate(row({ pos: 'RB', posRank: 35 }), ctx())).includes('rb-dead-zone'));
  assert.ok(!ids(evaluate(row({ pos: 'RB', posRank: 29 }), ctx())).includes('rb-dead-zone'));
  assert.ok(!ids(evaluate(row({ pos: 'RB', posRank: 41 }), ctx())).includes('rb-dead-zone'));
});

test('reaching 20+ picks ahead of adjusted ADP warns', () => {
  assert.ok(ids(evaluate(row({ reach: 25, adjAdp: 55 }), ctx())).includes('reaching'));
  assert.ok(!ids(evaluate(row({ reach: 8, adjAdp: 38 }), ctx())).includes('reaching'));
});

test('a player who has fallen well past ADP is called out as value', () => {
  const w = evaluate(row({ reach: -20, adjAdp: 10 }), ctx());
  const falling = w.find((x) => x.id === 'falling');
  assert.ok(falling);
  assert.equal(falling.severity, 'good');
});

test('an "avoid" tag never reads as good even when he has fallen', () => {
  const w = evaluate(row({ reach: -20, adjAdp: 10, tag: 'avoid' }), ctx());
  assert.ok(ids(w).includes('tag-avoid'));
  assert.ok(!ids(w).includes('falling'));
  assert.equal(worstSeverity(w), 'warn');
});

test('risk stacking fires only on the third high-risk player', () => {
  const kittle = { name: 'George Kittle', joel: {} };
  const nabers = { name: 'Malik Nabers', joel: {} };
  const love = row({ name: 'Jordan Love', pos: 'QB', posRank: 21 });

  assert.ok(!ids(evaluate(love, ctx({ myRoster: [kittle] }))).includes('risk-stacking'));
  const w = evaluate(love, ctx({ myRoster: [kittle, nabers] }));
  assert.ok(ids(w).includes('risk-stacking'));
  assert.match(w.find((x) => x.id === 'risk-stacking').title, /3 high-risk/);
});

test('a profile risk rating of 8+ counts toward risk stacking', () => {
  const risky = (name) => ({ name, joel: { profile: { risk: 9 } } });
  const w = evaluate(row({ name: 'X', joel: { profile: { risk: 8 } } }), ctx({ myRoster: [risky('A'), risky('B')] }));
  assert.ok(ids(w).includes('risk-stacking'));
});

test('QB7-11 is flagged as his target band', () => {
  const w = evaluate(row({ pos: 'QB', posRank: 9 }), ctx({ round: 8 }));
  const band = w.find((x) => x.id === 'qb-band');
  assert.equal(band.severity, 'good');
});

test('an elite QB reads as a note at market price and as value once he falls', () => {
  assert.ok(ids(evaluate(row({ pos: 'QB', posRank: 4, reach: 0 }), ctx())).includes('qb-early'));
  assert.ok(ids(evaluate(row({ pos: 'QB', posRank: 4, reach: -15 }), ctx())).includes('qb-faller'));
});

test('off-plan is only a note, since BPA still rules', () => {
  const w = evaluate(row({ pos: 'RB' }), ctx({ planTarget: 'WR' }));
  const off = w.find((x) => x.id === 'off-plan');
  assert.equal(off.severity, 'note');
  // BPA rounds never nag.
  assert.ok(!ids(evaluate(row(), ctx({ planTarget: 'BPA' }))).includes('off-plan'));
});

test('worstSeverity ranks block above warn above note above good', () => {
  assert.equal(worstSeverity([{ severity: 'good' }, { severity: 'warn' }]), 'warn');
  assert.equal(worstSeverity([{ severity: 'note' }, { severity: 'block' }]), 'block');
  assert.equal(worstSeverity([]), null);
});

test('rosterNeeds reports starters still missing, including FLEX', () => {
  const slots = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1, BE: 7 };
  const needs = rosterNeeds([{ pos: 'RB' }, { pos: 'RB' }, { pos: 'WR' }], slots);
  const by = Object.fromEntries(needs.map((n) => [n.pos, n.need]));
  assert.equal(by.QB, 1);
  assert.equal(by.WR, 1);
  assert.equal(by.TE, 1);
  assert.equal(by.RB, undefined);      // both RB starters filled
  assert.equal(by.FLEX, 3);            // 3 of the 6 RB/WR/TE bodies are in
});
