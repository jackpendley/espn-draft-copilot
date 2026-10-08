import { h } from 'preact';
import { worstSeverity } from '../core/rules.js';
import { TAG_COLOR, SEV_COLOR, one, signed, INJURY_SHORT } from './format.js';

/**
 * One line of the board. Rendered for live rows and for rows fading out after being drafted.
 *
 * @param warnings  rules.js evaluate() output for this player at the current moment
 */
export function BoardRow({ row: r, isExiting = false, isSelected = false, warnings, onSelect, onMark }) {
  const sev = worstSeverity(warnings);
  const inj = INJURY_SHORT[r.injuryStatus];
  const young = r.yearsExp != null && r.yearsExp <= 2
    ? ['Rookie', '2nd year', '3rd year'][r.yearsExp] : null;
  return h('div', {
    class: `dc-row ${isExiting ? 'dc-row-exiting' : ''} ${young ? 'dc-young-row' : ''} ${isSelected ? 'dc-selected' : ''}`,
    title: young ? `${young} -- keeper-league swing` : undefined,
    onClick: isExiting ? undefined : onSelect,
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
      onClick: (e) => { e.stopPropagation(); onMark(r.espnId); },
    }, '✓'),
  );
}

export function WarningList({ warnings }) {
  if (!warnings.length) return null;
  return h('div', { class: 'dc-warnings' },
    warnings.map((w) => h('div', { key: w.id, class: 'dc-warning', style: { borderLeftColor: SEV_COLOR[w.severity] } },
      h('strong', null, w.title), h('div', { class: 'dc-warndetail' }, w.detail))),
  );
}
