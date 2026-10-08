# Guide data

The board is driven by a third-party draft guide (ranks, tiers, tags, adjusted PPG, luck,
playcaller tables, ...) that was **hand-transcribed** into `data/guide/`. That guide is a
paid product by its author, so **it is not in this repository** and `data/guide/` is
gitignored. You need your own copy and your own transcription to run a full build.

Without it everything else still works: `npm test` runs entirely on a small synthetic
fixture (`test/fixtures/sample-dataset.json`), and CI does the same.

## What `npm run build:data` expects

`scripts/build-dataset.mjs` reads these files from `data/guide/`:

| File | Content | Parser |
|---|---|---|
| `big-board-ppr.txt`, `big-board-half.txt` | 150 ranked players each, with tag colour | `parseBigBoard` |
| `positional-ppr.txt` | QB 32 / RB 60 / WR 60 / TE 32 with tiers | `parsePositional` |
| `adjusted-ppg.txt`, `luck-metric.txt`, `rb-volume.txt`, `ppr-lean.txt`, `rb-gold-mine.txt` | per-player metrics | `parse*` |
| `teams.txt`, `playcallers.txt` | team OL / gamescript / playcaller context | `parseTeams`, `parsePlaycallers` |
| `dst.txt`, `kickers.txt` | D/ST and K tables | `parseDst`, `parseKickers` |
| `strategy.json`, `top50-stats.json`, `profiles.json` | rules, round-by-round plan, stats, profile cards | read as JSON |

The `.txt` files are pipe-delimited (`rank|POS|Name|tag`, for example), with `#` comment lines
at the top describing the columns. The parsers live in `scripts/parse-guide.mjs`; read the
matching `parse*` function to see the exact format of any file.

## Validation (why a typo can't reach draft day)

`build-dataset` exits non-zero if:

- a rank sequence has a gap, or a board is not exactly 150 rows (positional: 32/60/60/32),
- the PPR and Half-PPR boards disagree on which 150 players exist,
- any name fails to resolve to an ESPN player id (add a name alias in
  `data/overrides/aliases.json`, or fix the typo).

It also prints a warning (without failing) if a guide player has no Sleeper id, since a
rehearsal could then never cross them off, and writes `data/overrides/unmatched-report.txt`
(gitignored) listing fuzzy matches to eyeball. `npm test` additionally asserts that every
board player is reachable from a Sleeper pick whenever a built dataset is present.

## Re-syncing when the guide updates

The author re-issues the PDF during the season with a "Last Update" date on the rankings
pages. Compare that date against the header comment in `big-board-ppr.txt`. In practice only
`big-board-ppr.txt`, `big-board-half.txt` and the RB section of `positional-ppr.txt` change;
diff those first before re-transcribing anything.

**Transcription method that works** (reading a whole page image at once does not):

1. `brew install poppler`, then render each page at 300-400 dpi with `pdftoppm`.
2. Crop **each column separately** (`pdftoppm -x -y -W -H`) and transcribe one crop at a time.
   Whole-page renders are too dense: names and tag colours get misread, and rows from one
   column leak into another.
3. Check the head and tail of each crop against its neighbour for continuity.
4. Run `npm run build:data`. A clean build is necessary but not sufficient: it cannot catch
   two adjacent players swapped, so spot-check a sample of rank movements against the source.

## Local (league-specific) inputs

Separate from the guide, `data/local/` (also gitignored) holds your league specifics. Copy
the `*.example*` files there:

- `config.json` -- `leagueId`, `myTeamSlot`, `teams`, `rounds`. Inlined into the extension as
  its default settings at build time.
- `keepers.tsv` -- tab-separated `Team / Player / Round`. Pre-fills the keeper box on the
  options page.

Both are optional; everything can also be entered on the options page.
