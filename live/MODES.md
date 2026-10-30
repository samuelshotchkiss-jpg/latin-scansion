# How to write a mode for the live game

For whoever builds a mode (devices, meter, or a later one). Read [`SPEC.md`](SPEC.md) first (the
contract and the privacy rules), then this file next to [`modes/poll.js`](modes/poll.js), which is a
complete, working mode. Everything below is exactly what `host.js`, `player.js` and `common.js` do
today; if you find this file wrong, fix it in the same commit as the code.

## 0. The idea in one paragraph

A **mode** is one file that calls `Live.registerMode({...})`. The shell (`host.js` on the teacher's
page, `player.js` on each phone) does everything that is the same for every game: sign-in, codenames,
the lobby, teams, the round loop, the clock, the reconnect handling, the final scoreboard. A mode adds
only what is particular to its game: **which question to ask, how to grade a tap, what to draw.**

The teacher's browser is the host. It holds the answer key **in its own memory** (`ctx.mem`), grades
every tap, and publishes results. A phone only sends taps and draws what was published. So:

> **Anything written to the database is readable by students, except `hands/<uid>` (readable only by
> that one player). The answer key must never be written until `lock()` returns it in `reveal`.**

## 1. Where things live (so you touch only your own files)

| You write | Where |
|---|---|
| the mode | `live/modes/<id>.js` (replace the stub) |
| its styles | `live/modes/<id>.css`, every class prefixed (`dv-live-`, `mt-live-`); **do not edit `live/live.css`** |
| a bot that plays it (for testing) | `tools/bot_strategies/<id>.js` (see poll's) |
| its page text and a `?v=` bump | the `?v=` of your own two lines in `host.html` and `live.html` (`live/modes/<id>.js` and `.css`) |

Both pages already load `live/modes/devices.{js,css}`, `meter.{js,css}` and `poll.{js,css}`; you add
nothing to load them. If your mode needs another script **on the teacher's page only** (for example
`live/deal.js`, or `rhythm.js`, which `host.html` already loads), add one `<script>` line to
`host.html` *above* your mode's. Phones never need `rhythm.js`: sound is projector-only.

Never call `firebase.*`, never touch `localStorage`, `sessionStorage`, cookies or IndexedDB (a test
fails if you do), never use `innerHTML` (build with `Live.h(...)`, which sets text as text).

## 2. The definition

```js
Live.registerMode({
  id: "meter",                     // 3-12 lowercase letters; must be one of devices|meter|poll
                                   // (database.rules.json lists the legal ids; a new mode adds its id there)
  title: "Longa an brevis?",       // shown on the teacher's picker
  blurb: "One line for the picker.",
  hidden: false,                   // true = only listed with host.html?debug
  built: true,                     // false = a stub: appears as "Not built yet" and cannot be started
  lateJoin: true,                  // may a student who arrives after Start join? (SPEC 6.7: meter yes, devices no)
  autoLock: true,                  // default true: when every player has tapped once, lock the round. false = never
  teams: false,                    // or { optional: true|false, sizes: [2,3,4], all: true|false }  (section 5)
  settings: [ ... ],               // section 3
  keys: { r: { label: "Replay rhythm", run(ctx) { ... } } },   // optional host-page keyboard shortcuts
  host:   { start, nextRound, onTap, lock, renderHost, ownsDone },   // section 4
  player: { render, ownsDone },                                      // section 6
});
```

`registerMode` validates this and throws a plain-English error on a bad definition. **Required:**
`id`, `title`, `host.nextRound`, `host.lock`, `host.renderHost`, `player.render`.

## 3. Settings (what the teacher sets before the game)

```js
settings: [
  { key: "rounds",  label: "Questions",          type: "int",   options: [10, 20, 30, 40], default: 20 },
  { key: "counts",  label: "Show live counts",   type: "enum",  options: [["yes","Yes"],["no","No"]], default: "yes" },
  { key: "kinds",   label: "Kinds of syllable",  type: "flags", options: [["plain","Plain"],["qu","qu"],["elision","Elision"]], default: ["plain","elision"] },
]
```

- `key`: 1-16 letters or digits. `int` options are whole numbers. `enum` options are `[value, label]`
  with a value of 1-16 letters/digits. `flags` is a set of tick-boxes (up to 30), stored as one whole
  number (bit *i* is `options[i]`).
- The shell draws a control for each, stores them in `meta/set` (numbers and short words only, because
  the rules accept nothing else), and hands you the **decoded** values as `ctx.settings`:
  `settings.rounds === 20`, `settings.counts === "yes"`, `settings.kinds` = an array of the ticked
  values (`["plain","elision"]`). An old or missing value decodes to the default.
- **Teams are not a setting.** Declare `teams:` (section 5) and the shell adds the controls.

## 4. The host half (the teacher's page)

All hooks may be `async` (return a promise). `ctx` is described in section 7.

### Order of events

```
teacher presses Start
  -> shell makes teams if the mode uses them and none exist
  -> meta.phase = "play"
  -> host.start(ctx)                      once
  -> loop:
       host.nextRound(ctx)                -> a round, or null = no more rounds -> game over
       shell writes round (+ hands) in ONE atomic write; round.open = true; the clock starts
       host.onTap(ctx, uid, tap)          once per tap, as taps arrive
       ... until the round LOCKS: the time runs out, or every player has tapped (autoLock),
           or the teacher presses Lock now / Space, or the mode calls ctx.requestLock()
       shell sets round.open = false (the rules now refuse new taps), reads every tap one last time
         (so none is missed), delivering any not yet seen through onTap
       host.lock(ctx)                     -> { reveal, score }
       shell writes reveal + score; the screens show the reveal
       the teacher presses Next / Space   (or the mode called ctx.requestNext(ms))
game over: meta.phase = "done"; every screen shows the final scoreboard
the teacher presses Play again: the same players, a fresh ctx (new settings, an empty mem); round,
  reveal, score, state, hands and taps are wiped. A team game goes back to the lobby (teams kept
  unless their size changed); any other goes straight to meta.phase = "play" -> host.start(ctx) ...
or the teacher presses End game: the whole game is deleted
```

After Play again, `round.n` counts on from the last game's (a phone may remember things by `n`), so
round 1 of the second game may be `n` = 11. **Show `round.q`** (this game's question number, 1, 2,
3 ...) wherever a person sees the number; `n` is for matching hands, reveals and taps.

The teacher is always in control of the pace. Nothing advances on its own unless the mode asks
(`ctx.requestNext`).

### `start(ctx)` (optional)
Called once, before round 1. Set up your key and state in **`ctx.mem`**, a plain object that exists only
in the teacher's page memory for this game (poll puts its shuffled question order there). The shell
has already made the teams and `ctx.players()` is the final list for non-late joiners.

### `nextRound(ctx)` -> `null` or `{ ms, round, hands }`
Pick the next question. `ctx.n` is the number of the round you are making (1, 2, 3 ...). Return:

- `ms`: the time limit in milliseconds (0 = no clock; at most 600000).
- `round`: an object of **public** data every screen needs to draw the question. **Never put the answer
  in it.** Do not use the keys `n`, `q`, `open`, `t0`, `ms` (the shell sets them). Values may be numbers,
  strings, booleans, arrays and nested objects. Realtime Database turns arrays into objects with
  numeric keys: read them back as arrays (they come back as arrays when the indexes are 0, 1, 2 ...
  and none is missing; do not leave holes) and do not store an empty array or object (it vanishes).
- `hands`: optional `{ uid: { ...private data... } }`. Each is written to `hands/<uid>`, which **only
  that player (and the teacher) can read**; the shell adds `n` (the round). Use it for cards dealt to
  one phone. Players you leave out get no hand this round.
- Keep the **answer** in `ctx.mem`.

Return `null` (or nothing) to end the game.

The shell writes `round` and all `hands` together and clears the previous `reveal`, so a phone never
sees a round without its hand, nor yesterday's answer.

### `onTap(ctx, uid, tap)` (optional, but you need it to grade)
Called once for each tap of the **current** round (taps of earlier rounds are dropped). Synchronous.
`tap` is:

```js
{ id: "3_0",     // "<round>_<k>", k = this player's k-th tap this round (0-9); at most 10 taps a round
  n: 3,          // the round
  v: 2,          // the value the phone sent: a whole number 0-9. The meaning is yours (an answer choice, a card index ...)
  at: 1793108605105,   // SERVER time of the tap, ms
  dt: 1840,      // ms from the round opening to this tap (both on the server clock). Use this for speed bonuses.
  late: false }  // true if dt > round.ms + 1000: it arrived after the time limit
```

A tap is **only a number 0-9**. That is how the rules keep students from writing text: if your game
needs a choice, send its index. Taps arrive in the order the server received them. A player may send
several taps (devices mode does); count the ones you want. Ignore `late` taps (poll does) or not.
Store results in `ctx.mem`, never in the database.

### `lock(ctx)` -> `{ reveal, score }`
Called once per round, after the round is closed and **every** tap has been delivered. Grade and return:

- `reveal`: public data for the answer screen (the right answer, the reason, counts, who earned what).
  The shell adds `n`. This is where the key finally becomes public. Do not use the key name `n`.
- `score`: the **whole** score table, replacing the old one: `{ <uid or team number>: number }`.
  Keys are a player's uid (`ctx.players()[i].uid`) or a team number, as strings of up to 40
  letters/digits/`_`/`-`. Values are numbers (fractions are fine). Omit `score` to leave scores as
  they were. The shell uses `score` for the default scoreboards.

### `renderHost(ctx, el, view)` (the projector)
Draw into `el`. **Replace its contents completely every call** (`Live.clear(el)` first); it is called
whenever anything changes (a tap, a score, the round), several times a second at most. `view`:

```js
{ phase: "play" | "done",
  stage: "idle" | "starting" | "open" | "locking" | "revealed" | "done",
  round, reveal, score, state,   // the published nodes (null until they exist); reveal.n === round.n once it is for this round
  tapped: { uid: number of taps this round },   // not WHAT they tapped: use ctx.mem for that
  players: [ {uid, idx, name, gloss, team, at} ], teams: { uid: teamNumber } }
```

Draw for **three moments**: a round open (the question, a clock, how many have answered), the
reveal (`view.reveal && view.reveal.n === view.round.n`), and nothing yet (`view.round === null`:
"Get ready"). Projector type is large; use the classes in `live.css` (`live-big`, `live-choices`,
`live-board`, ...). A clock: `Live.countdown(el, round.t0 + round.ms, ctx.now)`; it stops by itself
when `el` leaves the page. The shell draws the status strip and the **Lock now / Next** bar; do not
draw your own.

Sound is projector-only: play it from here (`Rhythm.play(...)`), never on a phone.

### `ownsDone` (optional)
If `true`, your `renderHost` is also called with `view.phase === "done"` and draws the game-over screen.
Otherwise the shell draws "Final scores" from `score`.

### `summary(ctx, view)` (optional) -- the end-of-game breakdown
When the game ends, the teacher's page shows a breakdown, built **only from that page's own memory**
(`ctx.mem`, the published scores). Nothing is exported or saved, and *End game* still deletes the
game. The shell always draws, first, a generic fallback: **Final standings** (every codename with its
score from `score[uid]`) and, in a team game, **Teams** (members' codenames with `score[team]`). Define
`host.summary` to add sections after those. It is called once, synchronously, when the done screen is
drawn (and again on each redraw of it), with the same `view` shape as `renderHost` (`phase: "done"`).
Return an array (or nothing) of sections; each is plain data, drawn by the shell:

```js
host: { summary(ctx, view) { return [
  { title: "Devices the class missed most",          // optional heading
    note: "Wrong taps per device.",                    // optional small print
    columns: ["Device", "Wrong taps"],                 // optional; with rows, makes a table
    rows: [["simile", 4], ["chiasmus", 2]],            // cells are shown as text
    lines: ["any extra", "bullet lines"] },            // optional bullet list
]; } }
```

Keep it to what the page already knows; do not write anything to the database from here. A mode with
`ownsDone: true` has its `renderHost` called first for a headline (a winner banner, say), and the
standings and sections follow it. A mode without `summary` simply gets the standings.

### `lobbyNote(ctx, players)` (optional)
Returns one line of plain text shown under the lobby (for example "a team of one is playable").

### A mode whose players move at different speeds (devices mode does this)
The shell has one round at a time, and the rules accept a tap only for the current round number `n`
(at most ten per player per `n`). A mode where groups advance independently can use the round as a
*generation counter*: when someone advances, call `ctx.requestLock()`; `lock()` returns an almost-empty
reveal; from `renderHost`, once `view.stage === "revealed"`, call `ctx.requestNext(0)`; `nextRound()` then
returns hands for **every** player (unchanged for groups that did not advance, so all hands carry the new
`n`) and `ms: 0`. A tap refused while the round is closed must be sent again by the phone when the round
reopens with a new `n`, and must be dropped if that player's own cards have changed meanwhile. Put a
counter for the player's deal in the tap value (devices uses `index + 4 x (deal mod 2)`) so the host never
maps an old tap onto new cards. See `makeSender` and `createGame.tap` in `modes/devices.js`.

### `keys` (optional)
`keys: { r: { label: "Replay rhythm", run(ctx) {...} } }` adds a button and a keyboard shortcut to the
teacher's bar during play. Space is always Lock now / Next.

## 5. Teams

`teams: false` (no teams), or `{ optional, sizes, all }`:

- `optional: true` adds a "Play in teams" tick-box (meter: off or on). `false` means always teams (devices).
- `sizes: [2,3,4]` are the team sizes the teacher can pick ("teams of about 3").
- `all: true` adds "everyone in one team" (the whole class racing together).

The shell makes the teams (as even as possible; never a team of one when two is possible; at most 10
teams) when the teacher presses *Make teams* or Start, and lets the teacher move or remove anyone in
the lobby. A late joiner is put in the smallest team. You read them: `ctx.teamsOn`, `ctx.teams()`
(`{ teamNumber: [uid, ...] }`), `ctx.teamOf(uid)`. Team numbers are 0-9, shown to students as
A-J (`Live.teamLabel(n)`). **You** decide what a team score means (poll: the sum; meter: the average)
and return it in `score` under the team number.

## 6. The player half (the phone)

### `render(ctx, el, view)`
Called only while `phase` is `"play"` (and `"done"` if `ownsDone`). Draw into `el`, replacing its
contents. The shell calls it **only when something you can see has changed**, so a button is never
replaced under a finger. `view`:

```js
{ phase, round, hand, myTaps, reveal, score, state, players, teams, live }
```

- `round`: the public round data (including `n`, `q`, `open`, `t0`, `ms`), or `null` before round 1.
- `hand`: this player's `hands/<uid>` or `null`. **Check `hand.n === round.n`**: a player who joined
  mid-round has no hand for it (poll shows "You'll play from the next question").
- `myTaps`: this player's taps in this round, `[{ id, n, v, at }]`, including one just sent that the
  server has not confirmed yet (`at: null`). Use it to show "Locked in" at once.
- `reveal` / `score`: as published; `reveal.n === round.n` when this round has been revealed.
- `players`: `[{uid, idx, name, gloss, team}]` (names are codenames).
- `live`: `false` while the teacher's page is silent (the shell then shows "Waiting for the teacher..."
  instead of calling you).

To send a tap: **`ctx.tap(v)`** (`v` a whole number 0-9). It returns a promise of `{ ok: true }` or
`{ ok: false, reason: "closed" | "too many" | "error" }`. The shell numbers the tap, adds the server
time, and refuses (rules) a tap when the round is closed. Enforce "one answer only" in your UI by
disabling the buttons once `myTaps.length > 0`.

**A phone never shows the answer before `reveal`.** It cannot: it has not been given it.

Phones first: tap targets at least 48 px (`min-height: 3rem`), every state shown by a word or a shape
as well as a colour (poll: "A ✓", strike-through, a double border for the chosen one), the Latin in
the app's font stack with its macrons.

## 7. What `ctx` offers

On the **teacher's page** (`ctx` in `start`, `nextRound`, `onTap`, `lock`, `renderHost`):

| | |
|---|---|
| `ctx.settings` | decoded settings (section 3) |
| `ctx.teamsOn`, `ctx.teamSize` | teams in this game; the size aimed for (0 = one big team) |
| `ctx.mem` | your scratch object, this game, this page's memory only. **Put the key here.** |
| `ctx.random()`, `ctx.seed` | a seeded random generator (`Live.rng(seed)`). Same seed, same game. The seed is not published. |
| `ctx.n` | the round this call is about |
| `ctx.round` | the round node as published (`null` before round 1) |
| `ctx.players()` | `[{ uid, idx, name, gloss, team, at }]`, in joining order. `name` is the Latin codename, `gloss` its English |
| `ctx.playerOf(uid)`, `ctx.nameOf(uid)`, `ctx.teamOf(uid)`, `ctx.teams()` | lookups |
| `ctx.now()` | server time, ms |
| `ctx.write(path, value)` | extra writes, **only** under `state/`, `hands/`, `score/` of this game (anything else rejects). `state` is mode-owned and readable by all students. Rarely needed: prefer the return values. |
| `ctx.requestLock()` | end the open round now (e.g. a team finished) |
| `ctx.requestNext(ms)` | go to the next round after `ms` once the reveal is up (auto-advance). Not used by default. |
| `ctx.code`, `ctx.mode`, `ctx.uid` | the game code, the mode id, the teacher's uid |

On a **phone** (`ctx` in `render`): `ctx.uid`, `ctx.idx` (the codename number), `ctx.name`, `ctx.gloss`,
`ctx.settings`, `ctx.teamsOn`, `ctx.team` (number or null), `ctx.teammates()`, `ctx.players()`,
`ctx.now()`, `ctx.tap(v)`, `ctx.code`, `ctx.mode`. The phone has no `mem`, no `write`, no way to reach
the database.

Helpers in `Live` (from `common.js`): `h(tag, props, ...kids)` (build elements; text is always text),
`clear(el)`, `countdown(el, endMs, nowFn)`, `scoreboard(rows, {top})`, `shuffle(arr, rnd)`, `rng(seed)`,
`teamLabel(n)`. `Names.nameFor(idx)` is the codename.

## 8. The database, as your mode sees it (what is public)

```
meta       settings, phase, teamSize                    everyone signed in reads
players    { uid: { n: codename number, at } }          everyone reads
teams      { uid: team number }                         everyone reads
round      { n, open, t0, ms, ...your public data }     everyone reads
hands/uid  { n, ...your private data }                  that player and the teacher only
taps/uid   { "<n>_<k>": { n, v, at } }                  that player and the teacher only
reveal     { n, ...your answer data }                   everyone reads; written ONLY when a round locks
score      { uid or team number: number }               everyone reads
state      anything                                     everyone reads; mode-owned
```

Limits worth knowing: a tap is a whole number 0-9, at most 10 per player per round; `round.ms` ≤ 10
minutes; there is no per-mode place a *student* can write anything but a tap. If a mode needs more
than that from students, **stop and change `SPEC.md` and the rules first** (and their tests).

## 9. Testing your mode

1. `npm run emulate` (leave it running), then `node tools/seed-emulator.js` once.
2. Serve the site: `python -m http.server 8770` and open `http://localhost:8770/host.html` (add
   `?debug` to see poll). Sign in with *Sign in as the test teacher*, create your game.
3. `node tools/bots.js CODE --n 12 --speed fast` joins 12 simulated phones. Give them a brain in
   `tools/bot_strategies/<id>.js`: `exports.choose = ({ round, hand, rng, bot }) => v | null`.
   (A bot taps once per round; if your mode needs more than one tap per round per player, write
   your own loop in your strategy file or extend `bots.js` for it.)
4. Open `http://localhost:8770/live.html?c=CODE` in a phone-sized window for a human player.
5. `npm test` must stay green (it also checks that no live file writes to browser storage, calls
   `firebase.*` outside `net.js`, or uses `innerHTML`).

## 10. The worked example, in two minutes

[`modes/poll.js`](modes/poll.js) is under 200 lines. Read it top to bottom:
`QUESTIONS` is the key (host memory only) -> `settings` -> `start` shuffles the order into `ctx.mem` ->
`nextRound` makes a question, a private shuffled hand per player, and a time -> `onTap` keeps each
player's first on-time tap -> `lock` counts, scores (speed bonus from `tap.dt`), sums teams, and returns
`reveal` (now the answer is public) and `score` -> `renderHost` draws the question, the clock and the
counts, and after the reveal the top five -> `player.render` draws three big buttons in that player's own
order, then "Locked in", then ✓/✗ and the points.
