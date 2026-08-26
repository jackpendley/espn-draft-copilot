# ESPN Draft Copilot — Joel Smyth's 2026 Draft Guide

Joel Smyth's Draft Guide 2026, keeper-aware, live inside the ESPN draft room —
and rehearsable on Sleeper before the day.

Built for one specific draft: **Example Keeper League** — 12-team full PPR keeper, snake, **16 rounds**,
pick 5, September 3 2026, keeping Jaxon Smith-Njigba for a 6th-round pick.

Roster: QB×1 RB×2 WR×2 TE×1 FLEX×1 DST×1 K×1, BE×7, IR×1.

---

## Setup (once)

```bash
npm install
npm run fetch:players    # pull ESPN's player universe + live ADP
npm run fetch:sleeper    # pull Sleeper's player list, to map its ids onto ESPN's
npm run build            # transcribe guide -> dist/dataset.json, then bundle the extension
```

Then in Chrome:

1. Go to `chrome://extensions`, turn on **Developer mode**
2. **Load unpacked** → select the `extension/` folder
3. Click the extension icon (or Extensions → Details → Extension options)
4. League ID (`1234567890`) and draft slot (`5`) are pre-filled. Hit **Connect to ESPN** —
   team count, rounds and roster slots fill in automatically
5. Paste your keeper sheet (below)

**Be signed in to ESPN with a `fantasy.espn.com` tab open.** The league is private, so every
read needs your session cookie. See "How the private-league reads work" below.

Open `fantasy.espn.com/football/draft?leagueId=1234567890` and the panel appears. Drag it by
its header. To dry-run the panel on any other ESPN page, append `?copilot=1` to the URL.

**Re-run `npm run fetch:players && npm run build` the morning of the draft** so ADP is current.
ADP moves a lot in the final week.

---

## How the private-league reads work

League 1234567890 is private — `curl` gets a flat 401. Only a request carrying your ESPN
session cookie can read it, and *where the request comes from* decides whether the cookie is
attached:

- A fetch from the **extension's own origin** is cross-site to espn.com. If ESPN's `espn_s2`
  cookie is `SameSite=Lax`, the cookie is dropped and the call 401s.
- A fetch from a **content script on fantasy.espn.com** is same-site (both are `*.espn.com`),
  so the cookie goes along.

So the service worker asks an open ESPN tab to make the request on its behalf, and only falls
back to a direct fetch if no tab is available. Whichever path ESPN's cookie policy allows, one
of them works — and you don't discover which during a draft. If both fail you get "ESPN says
not authorized… make sure you are signed in" rather than a silent empty board.

Practical upshot: **keep a `fantasy.espn.com` tab open.** The draft room itself counts.

---

## The keeper sheet

Select the range in Google Sheets, copy, paste into the options page. Sheets copies as TSV so
there's no export step. Columns in any order, header row detected automatically:

| Team | Player | Round |
|------|--------|-------|
| Jack | Jaxon Smith-Njigba | 6 |
| Dave | Bijan Robinson | 1 |

Then set each keeper's **draft slot** (1–12) in the parse table so the simulation knows whose
round to burn. Names are fuzzy-matched against ESPN; anything that doesn't match is flagged in
red and skipped on save rather than silently dropped.

You can re-paste at any point, including mid-draft, and everything downstream recomputes.

### Why the draft slot matters

Keeping a player costs that team its pick in that round. Removing those slots from the snake
changes **every overall pick number after them**, including yours. With your R6 gone to JSN,
your R7 pick moves up. With other people's keepers in early rounds, your R1 moves up too. The
panel's "your next pick" and every availability percentage depend on this being right.

---

## What the panel shows

**Status strip** — the live overall pick, your next pick and how many picks away it is, and
Joel's round-by-round target for the current round.

**Alerts** — positional runs ("RB in 5 of the last 8") and tiers about to break, from the gold
underlines in his positional rankings.

**Board columns**

| Column | Meaning |
|---|---|
| # | Joel's PPR board rank |
| dot | Target (green) / I'll Pass (gold) / Avoiding (red) |
| T# | His tier at that position |
| ADP | ESPN ADP **adjusted for keepers** — hover for the raw number |
| ± | Picks between now and their adjusted ADP. Negative (green) = they've fallen past it. |
| % | Chance they last until your next pick |
| ▪ | Worst guardrail severity — hover for the list |
| ✓ | Mark drafted by hand (safety net) |

**Sort modes**

- **Best value** (default) — Joel's rank weighted by how likely the player vanishes before your
  next turn. A stud certain to still be there is demoted; this is rule #1 ("don't beat ADP")
  made mechanical. Hampton at Joel #10 with 77% survival scores *below* Jeanty at #11 with 16%.
- **Joel rank** — his board, straight
- **ADP** — keeper-adjusted market order
- **Joel edge** — where he's furthest ahead of the market

**Click any player** for the full card: adjusted '25 PPG with his reason string, luck metric with
the regression direction, PPR-vs-half lean, RB volume and gold-mine bucket, the team's OL rating
and playcaller tendencies and gamescript, every one of the 50 stats that mentions them, and the
profile card with ceiling/risk for the 16 preview players.

**Round plan.** Joel's round-by-round is written for 15 rounds; this league has 16. The plan is
mapped by shape rather than by literal round number — his last two rounds are always D/ST then
Kicker, so those anchor to R15/R16 and the surplus round becomes "BPA / Upside" at R14. The
no-K/DST guardrail follows the league's real round count too, so it opens at R15.

**Guardrails** fire on the selected player, drawn from p11:
no K/DST before the last two rounds · the RB30–40 dead zone · reaching 20+ picks ahead of ADP ·
risk stacking (his Nabers + Love + Kittle example) · the QB7–11 target band · round-plan drift.
Severity is `block` / `warn` / `note` / `good` — and off-plan is only ever a note, because
"Best Player Available still most important."

---

## Draft day sequence (Sept 3)

0. **Before the day:** run at least one full mock on Sleeper (see below). It is the only way
   to exercise the live feed and the keeper maths together before they matter.
1. **Morning of:** `npm run fetch:players && npm run build` — ADP moves hard in the final week
2. `chrome://extensions` → reload the extension
3. Options → paste the final keeper sheet → set each keeper's draft slot → Save
4. Check the **Your real picks** card: with everyone's keepers in, those overall numbers
   are what the panel will hold you to
5. Open the draft room. Refresh the tab if you rebuilt after opening it
6. Confirm the panel shows your correct pick number before the first pick, and that the chip
   in its header reads **ESPN** and not `SLEEPER · practice`

During the draft: if the panel ever looks stuck, check the footer — "Live · syncing every 3s"
means the feed is healthy, and it names the feed it's syncing. An amber bar means refresh
the page.

---

## Practising on Sleeper

An ESPN mock can't rehearse this tool. We track keepers in a spreadsheet, so ESPN has no idea
any round is spoken for — and keeper rounds burning out of the snake is the thing every number
in the panel depends on. A mock with no keepers is a mock with the wrong pick numbers.

Sleeper can reproduce it, so the panel runs there too. **It is the same panel**: same board,
same ESPN ADP, same keeper-adjusted ADP, same survival percentages, same guardrails, same round
plan. Only the answer to "who has been picked, and where am I in the order" comes from somewhere
else.

### Setting up the mirror league

Make a Sleeper league that matches Example:

| | |
|---|---|
| Teams | 12 |
| Rounds | 16 |
| Scoring | Full PPR |
| Roster | QB1 RB2 WR2 TE1 FLEX1 DST1 K1 BE7 IR1 |
| Draft type | Snake, **no 3rd-round reversal** |

Then **draft each keeper by hand in its proper round** — you at R6 for Jaxon Smith-Njigba,
everyone else at theirs. That's the whole trick: the panel recognises those picks from your
keeper sheet, takes them back out of the feed, and renumbers everything after them, exactly the
way Sept 3 is modelled.

Anything the mirror gets wrong — wrong team count, linear instead of snake, reversal left on —
shows up as an amber bar across the top of the panel rather than as quietly wrong numbers.

### Running one

1. Open the draft room. The panel mounts and reads the draft ID straight out of the URL, so a
   throwaway mock needs no setup at all
2. Options → **Sleeper practice draft** → put your Sleeper username in and hit
   **Connect to Sleeper**. Your draft slot is read off the draft order
3. Draft. The header says `SLEEPER · practice` so a tab left open overnight can never be
   mistaken for the real thing

**Two pick numbers.** Sleeper's clock counts the keeper picks; the panel takes them out. So once
N keepers are gone the two run exactly N apart, and the status strip shows Sleeper's number
underneath its own. The panel's number is the one that will be true on draft day.

Reset the draft and run it again as many times as you like — the draft ID survives a reset.

## Testing before the draft room opens

ESPN doesn't open the real draft room until close to your scheduled time, so
`fantasy.espn.com/football/draft?leagueId=…` is a dead link until then. Three ways to test anyway:

**A full dress rehearsal — Sleeper.** See above. This is the only way to exercise the live pick
feed, the keeper maths, the alerts and the guardrails together, against picks arriving in real
time. Do this one.

**Pick-sync — replay a completed draft.** Options page → **Replay 2025 ESPN draft** runs your
league's completed 2025 draft through the exact path the live feed will use: same auth, same
parsing, same player-id mapping. **Replay the Sleeper draft** does the same for Sleeper and is
what proves the `sleeperId → espnId` map works. Either coming back with real player names means
the only untested link left is the site populating the feed live.

**Panel mount and badges — an ESPN mock draft.** `fantasy.espn.com/football/mockdraftlobby`. The
panel mounts there and badges attach to ESPN's player rows. A mock is a *different* league, so
the pick counter will not advance — it's still polling your real league. Use it for the visual
check only.

To see the panel on any other ESPN or Sleeper page, append `?copilot=1` to the URL.

### How Sleeper players are matched to ESPN's

Sleeper keys players by its own string ids (`"9488"`, and the team abbreviation `"HOU"` for
defenses), so a build-time map translates them to the ESPN ids the whole dataset is keyed on.
Sleeper does publish an `espn_id` field, but it's null for about half of all active players —
including Jaxon Smith-Njigba — so it's a tiebreak, not the index. Defenses map by team, exactly.
Everything else falls back to the same name matcher the guide build uses, with **no fuzzy
matching**: over 4,000 players it confidently puts Roddy White on Cody White's id, and striking
the wrong name off the board mid-draft is worse than not striking one at all.

An unmatched pick still counts toward the pick number; it just doesn't cross anyone off. The
build fails loudly if any player on Joel's board becomes unreachable.

---

## "Extension context invalidated"

Expected, not a bug. Reloading the extension orphans any content script already running
in an open tab — its `chrome.*` handles go dead. **Refresh the ESPN tab and it clears.**

The panel now detects this and shows an amber "This panel is out of date" bar with a
Refresh button instead of silently freezing, which is the behaviour that matters if Chrome
ever auto-updates the extension mid-draft. Rule of thumb: after any `npm run build`,
reload the extension *and* refresh the ESPN tab.

---

## If something breaks on draft night

1. **Panel gone but ESPN fine** — options page → **Open standalone board**. Same board in its own
   window, still syncing picks from ESPN's API. Draft in the ESPN window as normal. (The
   standalone board has no page to read the feed from, so it uses whichever one the
   **Draft feed** toggle is set to — make sure that says ESPN.)
2. **Pick sync stalls** — hit ✓ on players as they go. Manual marks override the API.
3. **You veto a pick as commissioner** — clear manual overrides in options; the API is the source
   of truth and will re-sync within 3 seconds.
4. **Badges vanish from ESPN's rows** — expected if ESPN changes their markup. The panel is
   unaffected; the badge layer fails closed by design.

---

## Layout

```
data/guide/       hand-transcribed guide, one file per section (source of truth, diffable vs the PDF)
data/overrides/   name aliases + the build's unmatched report
scripts/          fetch ESPN + Sleeper players, build the dataset, bundle the extension
src/core/         pure logic: keepers, board, rules, names (no DOM, no chrome.*)
                  + the two platform adapters, both returning one shape
src/panel/        Preact UI + the standalone fallback page
src/content/      panel mount + player-row badges
src/background/   service worker: all network access, dispatching on platform
src/options/      league config + keeper editor + both replay diagnostics
test/             84 tests over core logic, both adapters, and panel rendering
```

**The platform seam is one file deep.** `src/core/espn-api.js` and `src/core/sleeper-api.js`
return the same two shapes, `src/background/index.js` picks between them, and
`src/core/platform.js` holds the per-site URL and DOM selectors. `board.js`, `rules.js`,
`keepers.js` and `names.js` have no idea there is more than one draft site.

## Commands

```bash
npm test                 # 84 tests
npm run fetch:players    # refresh ESPN ADP
npm run fetch:sleeper    # refresh Sleeper's player list (only needed when rosters churn)
npm run build:data       # rebuild dataset; FAILS LOUDLY on any unresolved guide name
npm run build:ext        # bundle
npm run build            # both
node scripts/scenario.mjs   # print a simulated draft situation against the real data
```

`npm run build:data` exits non-zero if any name in the guide fails to resolve to an ESPN id, or if
a rank sequence has a gap, or if the PPR and Half-PPR boards disagree on which 150 players exist.
That check is the reason a transcription typo can't reach draft day.

---

## What was intentionally left out of the transcription

Not relevant to a 12-team PPR redraft-with-keepers league:

- **Dynasty rookie rankings** (p8) — dynasty only
- **6-pt passing TD table** (p8) — our league is standard 4-pt passing TDs
- **Half-PPR positional rankings** (p7) — the half-PPR *big board* is included for reference,
  but our league is full PPR so the PPR positional ranks and tiers are what drive the panel

Everything else in the guide is in `data/guide/`.

## A note on the Gold Mine buckets

The guide presents the RB Gold Mine as a scatter plot with four labeled regions, not a table.
Buckets in `data/guide/rb-gold-mine.txt` are derived by reading each player's plotted position
against those labels, and players near a divider are marked `borderline` and shown as such on the
card. Treat it as the soft signal it is.
