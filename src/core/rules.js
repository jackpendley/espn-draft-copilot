// Guardrails drawn from p11 "My Draft Strategy". Each returns a warning/nudge when the
// player you are about to take conflicts with (or confirms) one of Joel's stated rules.
//
// Severity: 'block' = he explicitly says don't; 'warn' = he'd push back; 'note' = FYI;
//           'good' = this actively matches something he's hunting for.

const RISK_TRIO = ['Malik Nabers', 'Jordan Love', 'George Kittle'];

/**
 * @param row       a board row (from buildBoard) for the player under consideration
 * @param ctx {
 *   round, currentOverall, totalRounds,
 *   myRoster: [{ pos, name, joel }],
 *   planTarget: string  -- Joel's round-by-round slot for this round
 *   dataset
 * }
 * @returns [{ id, severity, title, detail }]
 */
export function evaluate(row, ctx) {
  const out = [];
  const { round, totalRounds = 15, myRoster = [], planTarget } = ctx;

  // Rule 3: No K or D/ST until the last two rounds.
  if ((row.pos === 'K' || row.pos === 'DST') && round < totalRounds - 1) {
    out.push({
      id: 'no-early-k-dst', severity: 'block',
      title: `${row.pos} in round ${round}`,
      detail: `Joel: "No K or D/ST until the last two rounds unless you wanna intimidate everyone." That's rounds ${totalRounds - 1}-${totalRounds} here.`,
    });
  }

  // RB dead zone: RB30-40 is mostly a waste compared to that range's QB/WR/TE.
  if (row.pos === 'RB' && row.posRank >= 30 && row.posRank <= 40) {
    out.push({
      id: 'rb-dead-zone', severity: 'warn',
      title: `RB${row.posRank} is in Joel's dead zone`,
      detail: 'Joel: "RB30-40 to me is mostly a waste of time compared to that range\'s QB/WR/TE." He\'d rather hunt backup RBs later than spend here.',
    });
  }

  // Rule 1 + 2: don't reach far ahead of ADP.
  if (row.reach != null && row.reach >= 20) {
    out.push({
      id: 'reaching', severity: 'warn',
      title: `Reaching ~${Math.round(row.reach)} picks early`,
      detail: `Keeper-adjusted ADP is ${row.adjAdp.toFixed(0)}; you're on the clock at ${ctx.currentOverall}. Joel: "Don't draft off rankings without understanding ADP." If he's likely to last, take the value now and circle back.`,
    });
  }

  // The flip side: he has fallen well past the market.
  if (row.reach != null && row.reach <= -12 && row.tag !== 'avoid') {
    out.push({
      id: 'falling', severity: 'good',
      title: `Fallen ~${Math.abs(Math.round(row.reach))} picks past ADP`,
      detail: `Adjusted ADP ${row.adjAdp.toFixed(0)}, still here at ${ctx.currentOverall}.`,
    });
  }

  // Tag echoes.
  if (row.tag === 'avoid') {
    out.push({ id: 'tag-avoid', severity: 'warn', title: 'On Joel\'s "Avoiding" list', detail: 'He is actively fading this player in PPR.' });
  } else if (row.tag === 'pass') {
    out.push({ id: 'tag-pass', severity: 'note', title: 'On Joel\'s "I\'ll Pass" list', detail: 'Not a fade, but he is not going out of his way to roster him.' });
  } else if (row.tag === 'target') {
    out.push({ id: 'tag-target', severity: 'good', title: 'On Joel\'s "Target" list', detail: 'One of his guys in PPR.' });
  }

  // Rule 5: balance risk. Joel's example is Nabers + Love + Kittle on one team.
  const riskyOnRoster = myRoster.filter((p) => isHighRisk(p)).length;
  if (isHighRisk(row) && riskyOnRoster >= 2) {
    out.push({
      id: 'risk-stacking', severity: 'warn',
      title: `That's ${riskyOnRoster + 1} high-risk players`,
      detail: 'Joel: "Balance risk - don\'t draft Nabers, Love, & Kittle on the same team."',
    });
  }

  // QB timing: his main target band is ADP QB7-11, and he notes QB3-6 falling is worth it.
  if (row.pos === 'QB' && row.posRank != null) {
    if (row.posRank >= 7 && row.posRank <= 11) {
      out.push({ id: 'qb-band', severity: 'good', title: `QB${row.posRank} is Joel's main target band`, detail: 'Joel: "Main Target - ADP QB7-11. Sniping one of your favorites that falls, mostly 2-3 still available in Round 8."' });
    } else if (row.posRank <= 6 && row.reach != null && row.reach <= -10) {
      out.push({ id: 'qb-faller', severity: 'good', title: `QB${row.posRank} has fallen far`, detail: 'Joel: "QB 3-6 are going WAY later this year. I still would rather wait, but if one falls far, it\'s likely worth it."' });
    } else if (row.posRank <= 6) {
      out.push({ id: 'qb-early', severity: 'note', title: `QB${row.posRank} at his market price`, detail: 'Joel would rather wait for the QB7-11 band unless this one has genuinely fallen.' });
    }
  }

  // Round plan divergence -- a nudge, never a block. BPA still rules.
  if (planTarget && planTarget !== 'BPA' && !planTarget.includes(row.pos)) {
    out.push({
      id: 'off-plan', severity: 'note',
      title: `Round ${round} plan is ${planTarget}`,
      detail: 'His round-by-round is a median, not a rule -- "Best Player Available still most important."',
    });
  }

  // Rule 4: good process players late.
  if (round >= 11 && row.tag === 'target') {
    out.push({ id: 'process-player', severity: 'good', title: 'Late-round target', detail: 'Joel: "Good process players late - rookie WRs, rushing QBs, talent on top offenses, cemented RB2s/handcuffs at the end of drafts."' });
  }

  return out;
}

function isHighRisk(p) {
  if (RISK_TRIO.includes(p.name)) return true;
  const risk = p.joel?.profile?.risk;
  return typeof risk === 'number' && risk >= 8;
}

/** Worst severity present, for badge color. */
export function worstSeverity(warnings) {
  for (const s of ['block', 'warn', 'note', 'good']) {
    if (warnings.some((w) => w.severity === s)) return s;
  }
  return null;
}

/**
 * Roster needs against the league's real starting slots.
 * @param myRoster [{ pos }]
 * @param slots    { QB:1, RB:2, WR:2, TE:1, FLEX:1, K:1, DST:1, BE:7 }
 */
export function rosterNeeds(myRoster, slots) {
  const have = {};
  for (const p of myRoster) have[p.pos] = (have[p.pos] || 0) + 1;
  const needs = [];
  for (const [pos, n] of Object.entries(slots)) {
    if (pos === 'BE' || pos === 'IR' || pos === 'FLEX') continue;
    const short = n - (have[pos] || 0);
    if (short > 0) needs.push({ pos, need: short, have: have[pos] || 0, starters: n });
  }
  const flexCount = slots.FLEX || 0;
  if (flexCount) {
    const flexEligible = (have.RB || 0) + (have.WR || 0) + (have.TE || 0);
    const flexNeeded = (slots.RB || 0) + (slots.WR || 0) + (slots.TE || 0) + flexCount;
    if (flexEligible < flexNeeded) needs.push({ pos: 'FLEX', need: flexNeeded - flexEligible, have: flexEligible, starters: flexNeeded });
  }
  return needs;
}
