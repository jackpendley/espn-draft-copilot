import { h } from 'preact';
import {
  TAG_COLOR, TAG_LABEL, one, signed, GAMESCRIPT_LABEL, GOLD_MINE_LABEL, OL_TREND_LABEL,
} from './format.js';

const Row = ({ label, children }) =>
  h('div', { class: 'dc-cardrow' }, h('span', { class: 'dc-cardlabel' }, label), h('span', null, children));

const Meter = ({ label, value, color }) => h('div', { class: 'dc-meter' },
  h('span', { class: 'dc-meterlabel' }, label),
  h('div', { class: 'dc-metertrack' }, h('div', { class: 'dc-meterfill', style: { width: `${value * 10}%`, background: color } })),
  h('span', { class: 'dc-metervalue' }, `${value}/10`),
);

export function PlayerCard({ row, dataset, onClose }) {
  if (!row) return null;
  const j = row.joel || {};
  const ctx = dataset.teamCtx?.[row.team];
  const pc = ctx?.playcaller;
  const stats = (j.stats || []).map((n) => dataset.top50.find((s) => s.n === n)).filter(Boolean);

  return h('div', { class: 'dc-card' },
    h('div', { class: 'dc-cardhead' },
      h('div', null,
        h('div', { class: 'dc-cardname' }, row.name),
        h('div', { class: 'dc-cardsub' },
          `${row.pos} · ${row.team}`,
          j.pprRank ? ` · Joel PPR #${j.pprRank}` : '',
          j.posRank ? ` · ${row.pos}${j.posRank}` : '',
          j.tier ? ` · Tier ${j.tier}` : '',
        ),
      ),
      row.tag !== 'neutral' && h('span', { class: 'dc-tag', style: { background: TAG_COLOR[row.tag] } }, TAG_LABEL[row.tag]),
      h('button', { class: 'dc-card-close', onClick: onClose, title: 'Close' }, '×'),
    ),

    h('div', { class: 'dc-cardbody' },
      h(Row, { label: 'Market' },
        `ESPN ADP ${one(row.adp)}`,
        row.adjAdp != null && row.adjAdp !== row.adp ? ` → keeper-adj ${one(row.adjAdp)}` : '',
        row.availNext != null ? ` · ${Math.round(row.availNext * 100)}% to reach your next pick` : '',
      ),

      j.adjPpg25 != null && h(Row, { label: "'25 Adj PPG" },
        `${one(j.adjPpg25)} (${row.pos}${j.adjPpgRank})`,
        j.adjPpgNote ? h('em', { class: 'dc-note' }, ` — ${j.adjPpgNote}`) : null,
      ),

      j.luck && h(Row, { label: 'Luck 2025' },
        j.luck.totalLost > 0
          ? h('span', { style: { color: '#1f9d4d' } }, `unlucky: lost ${one(j.luck.totalLost)} pts (${one(j.luck.pctLost)}%) — positive regression candidate`)
          : h('span', { style: { color: '#c99700' } }, `lucky: gained ${one(-j.luck.totalLost)} pts (${one(-j.luck.pctLost)}%) — regression risk`),
      ),

      j.pprLean && h(Row, { label: 'PPR lean' },
        `${one(j.pprLean.pctViaRec)}% of points via reception — `,
        j.pprLean.lean === 'ppr'
          ? h('strong', { style: { color: '#1f9d4d' } }, 'better in PPR (our format)')
          : h('span', null, 'better in half/standard'),
      ),

      j.rbVolume && h(Row, { label: 'RB volume' },
        `proj #${j.rbVolume.projVolumeRank} · '25 adj ${j.rbVolume.adjVolume25} · ${j.rbVolume.confidence} confidence`,
        j.rbVolume.smallSample ? ' (small sample)' : '',
      ),

      j.goldMine && h(Row, { label: 'Gold Mine' },
        GOLD_MINE_LABEL[j.goldMine.bucket] || j.goldMine.bucket,
        j.goldMine.borderline ? h('em', { class: 'dc-note' }, ' — borderline on the chart') : null,
      ),

      ctx && h(Row, { label: `${row.team} context` },
        `OL '26 ${ctx.olRank26}/5 ${OL_TREND_LABEL[ctx.olTrend] || ''} · ${ctx.cohesion} OL returning`,
        ctx.qbRuns ? ' · designed QB runs' : '',
        ctx.gamescript ? ` · ${GAMESCRIPT_LABEL[ctx.gamescript] || ctx.gamescript}` : '',
      ),

      pc && h(Row, { label: 'Playcaller' },
        pc.playcaller,
        pc.newTeam ? h('span', { class: 'dc-flag dc-flag-new' }, 'NEW TEAM') : null,
        pc.firstTimePlaycaller ? h('span', { class: 'dc-flag dc-flag-first' }, '1ST TIME PC') : null,
        pc.pctRb1 != null ? ` · ${one(pc.pctRb1)}% of RB pts to the starter (#${pc.rb1Rank})` : '',
        pc.scheme ? ` · ${pc.scheme}` : '',
        pc.rbScreenRank ? ` · RB screens #${pc.rbScreenRank}` : '',
      ),

      j.profile && h('div', { class: 'dc-profile' },
        h('div', { class: 'dc-meters' },
          h(Meter, { label: 'Ceiling', value: j.profile.ceiling, color: '#1f9d4d' }),
          h(Meter, { label: 'Risk', value: j.profile.risk, color: '#c62828' }),
        ),
        h('p', null, j.profile.prose),
        h('div', { class: 'dc-cardsub' },
          `Yahoo ${j.profile.yahooRank} · ADP ${j.profile.yahooAdp}`,
          j.profile.ffpg25 != null ? ` · '25 ${j.profile.ffpg25} FFPG` : '',
          ` · '26 proj ${j.profile.proj26Fppg} FPPG (half PPR)`,
        ),
      ),

      stats.length > 0 && h('div', { class: 'dc-stats' },
        h('div', { class: 'dc-cardlabel' }, 'From the 50 stats'),
        stats.map((s) => h('p', { key: s.n }, h('strong', null, `#${s.n}. `), s.text)),
      ),

      j.kicker && h(Row, { label: 'Kicker' },
        `'25 ${one(j.kicker.ppg25)} PPG · ${j.kicker.accuracy}% FG · offense #${j.kicker.offRank}`,
        j.kicker.fiftyPlus ? ' · hits 50+' : '',
        j.kicker.dome === false ? ' · winter weather' : (j.kicker.dome ? ' · dome' : ''),
        j.kicker.value === 'good' ? h('strong', { style: { color: '#1f9d4d' } }, ' · VALUE') : '',
      ),

      j.dst && h(Row, { label: 'D/ST' },
        `PrROE #${j.dst.prroe} · '25 adj PPG rank #${j.dst.adjPpg25}`,
        j.dst.bottom10Offense ? h('strong', { style: { color: '#c62828' } }, ' · bottom-10 offense (red flag)') : '',
        j.dst.value === 'good' ? h('strong', { style: { color: '#1f9d4d' } }, ' · VALUE') : '',
        j.dst.value === 'bad' ? h('span', { style: { color: '#c62828' } }, ' · overpriced') : '',
      ),

      row.injuryStatus && row.injuryStatus !== 'ACTIVE'
        && h(Row, { label: 'Injury' }, h('strong', { style: { color: '#c62828' } }, row.injuryStatus.replace(/_/g, ' '))),
    ),
  );
}
