# Live game — the contract

Status: SPEC, written 2026-10-27; corrected the same day after P1 built the core and again by P5 (see "Corrections" at the foot). Work packages and who builds what are
in [`PLAN.md`](PLAN.md); this file is the one set of facts they all share. If a package needs this
file to change, change it HERE first, in the same commit, and say so in the commit message.

## 1. What it is

A Quizlet-Live / Kahoot-style game for a Latin class, played on students' phones with the teacher's
laptop on the projector. Two modes at first:

- **devices** — teams match literary devices across three columns (name · definition · Latin
  example). Each teammate's phone holds some of the cards, so the team has to talk.
- **meter** — "Longa an brevis?": one syllable of a real line is highlighted; every student taps
  long, short or elided within a few seconds; the projector reveals the reason and plays the rhythm.

Classes are small (3–9 students). Both modes must be fun at 3 players and still work at 25.

**Non-goals.** No accounts for students. No stored history or per-student results — ever. No
leaderboard that survives the game. No anti-cheating (the answers are in the public data files; this
is a review game, not a test). The one cheap precaution taken: a hand holds only the faces a phone
draws, never a card's key or id (card ids name their device), so the answer is not in the student's own
data; going further is out of scope. No payments, no ads, no analytics, no third-party scripts except the
Firebase SDK. Not a replacement for the practice pages, which stay exactly as they are.

## 2. Privacy rules (hard — a test or a review checks each)

1. **No student-typed text reaches the database, and no field can hold any.** Every student-written
   value is a *number* or a *timestamp*. A student's display name is a **codename index** (a number)
   that `names.js` turns into a Latin phrase on screen. The rules reject any string in a player-written
   field. (A text box that "only accepts a pattern" is NOT enough: a student with developer tools could
   type a real name that fits the pattern.)
2. **No emails, no Google identity for students.** Students use Firebase *anonymous* sign-in only.
   Only the teacher signs in with Google, and the teacher's address is never written into this repo
   (the repo is public): the rules compare against a UID stored in the console.
3. **Nothing is kept on the student's device after the tab closes.** Auth persistence is `SESSION`
   (a reload in the same tab rejoins as the same player; closing the tab forgets). No cookies, no
   `localStorage`. Each page carries a short plain-English notice that lists exactly what is stored and
   where; the notice and the browser audit (`LiveNet.auditStorage()`) are both built from one list,
   `Live.STORED`, and a test checks the notice against it. (Measured: besides the tab-only sign-in, Firebase
   itself creates two IndexedDB databases that outlive the tab and hold nothing about the student:
   `firebase-heartbeat-database` and an empty `firebaseLocalStorageDb`. The notice says so.)
4. **The game is deleted when the teacher ends it**, and any game older than 12 hours is deleted the
   next time the teacher opens `host.html`.
5. **What Google still sees:** like any page served from Google's infrastructure, Firebase receives a
   connection's IP address. The notice says so in one sentence. No name, email or school account is
   involved.
6. **Public repo.** Everything committed here is public. `live/firebase-config.js` holds the *web* config
   (its API key is not a secret; the rules are the lock). Never commit a service-account key, an admin
   token, a UID of a student, or the teacher's email.

## 3. Architecture

- Static pages on GitHub Pages, as the rest of the app. **No Cloud Functions, no server, no build step.**
- Firebase **Spark (free) plan**: Authentication (Anonymous + Google) and **Realtime Database**. Never
  upgrade the plan; the free plan's hard ceiling is a feature.
- **The teacher's browser is the host.** It holds the answer key, grades every tap, and writes the
  results. Phones only send taps and draw what the host writes.
- Classic `<script>` tags, the pinned Firebase **compat** SDK from the official `gstatic` CDN, and
  `?v=` cache-busters on every script and stylesheet (GitHub Pages caches for ten minutes; a new page
  running an old script breaks — the app already learned this). No ES-module import graph unless the
  version problem is solved and documented.
- Emulator: all development and every test runs against the Firebase emulators with a project id that
  starts with `demo-` (e.g. `demo-latin-live`), which cannot touch a real project. The live database
  is reachable from the code only when `location.hostname` is the Pages host; on `localhost` the code
  uses the emulators (project `demo-latin-live`, its default database instance); on **`127.0.0.1` or anything else it refuses to run** and says why (the survey
  app was bitten by `127.0.0.1` silently using the live database).

## 4. Files

```
live.html  host.html                 player page / teacher-projector page
live/SPEC.md PLAN.md MODES.md        this contract · the work plan · how to write a mode
live/firebase-config.js              web config; committed as placeholders, the owner pastes the real one
live/names.js                        codename lists, nameFor(idx), NAME_COUNT
live/common.js                       mode registry, team making, settings encoding, notice text, DOM helpers (no Firebase)
live/net.js                          the ONLY file that touches firebase.*; everything else calls it
live/host.js  live/player.js         the two shells (lobby, teams, rounds, scoreboard, reconnect)
live/live.css                        shared styles; reuse styles.css variables
live/deal.js                         team dealing for devices mode (pure logic)
live/modes/devices.js meter.js       the two modes (poll.js: a plumbing test mode, hidden); each with its own <id>.css
live/RULES.md  live/HOWTO.md         the rules in plain English; how to try it and run it, for the teacher
live/vendor/                         a small MIT QR-code library + its licence
database.rules.json firebase.json .firebaserc   rules; emulator config; placeholder project id
tools/make_meter_questions.py        builds data/meter_questions.json from data/lines.json
tools/bots.js                        simulated phones for testing against the emulator (+ tools/bot_strategies/<mode>.js, tools/seed-emulator.js)
tests/                               rules tests (+ mutate_rules.js), live_pure and live_static tests, deal tests, question-bank tests
data/meter_questions.json            generated; never hand-edited
package.json                         dev-only (emulator + rules tests); node_modules is gitignored
```

New files go in `COPYRIGHT.md`'s tables: code AGPL-3.0; the question bank, devices data and page text
CC BY-NC-SA 4.0; the vendored QR library keeps its own licence (MIT) and says so.

## 5. Data model

`$code` is four letters from `BCDFGHJKLMNPRSTVWXZ` (no vowels, so no words). Types: **int** = a number,
**ts** = server timestamp. `NAME_COUNT` ≤ 1000.

```
config/teacherUid : string                      console-written ONLY (no rule lets the app write it)

games/$code/
  meta     { host:uid, mode:"devices"|"meter"|"poll", phase:"lobby"|"play"|"done",
             created:ts, live:bool, beat:ts, teamSize:int 0..6,
             set:{ <name>: int | short enum string } }          host writes; everyone signed in reads
  claims/$idx   uid                              a codename claim; $idx is 0..NAME_COUNT-1 (exactly 0..959)
  players/$uid  { n:int, at:ts }                 the player writes its own; n must be claimed by it. A claim and
                                                 its player record are ONE atomic write (see below)
  teams/$uid    int 0..9                         host writes (team number)
  round    { n:int, open:bool, t0:ts, ms:int, …public data for the mode… }   host writes
  hands/$uid    { n:int, …mode data… }           host writes; readable by that uid and the teacher only. (SPEC once said
                                                 `cards:[…]`: the rules only require `n`; each mode chooses the rest. Devices
                                                 mode writes `cards` as bare faces with NO key or id, and later adds `res`.)
  taps/$uid/$id { n:int, v:int 0..9, at:ts }     the player appends; never edited. $id is "<n>_<k>" (digits), k 0-9:
                                                 at most ten taps per player per round
  reveal   { n:int, … }                          host writes AFTER the round locks (this holds the key)
  score/$k int                                   host writes ($k = a team number or a uid)
  state    { … }                                 mode-owned, host writes, everyone reads
```

Rules, in words (the exact JSON is the P1 deliverable; its tests are section 7):

- Game codes are four letters of `BCDFGHJKLMNPRSTVWXZ`, checked by the rules too.
- `meta.teamSize` is 0 (everyone in one team) or 1..6 for modes that use teams; a mode with *optional* teams
  stores `meta.set.teams = "on"|"off"`. `meta` has a fixed shape (no stray children) and `round` has required fields, even for the
  teacher, so a bug in the teacher's page cannot freeze every phone.
- `isTeacher` = signed in **with Google** *and* `auth.uid === config/teacherUid`. Everything under
  `games/$code` is writable by the teacher, and readable by the teacher. `games` itself is listable
  only by the teacher (and has `.indexOn: ["meta/created"]` for the 12-hour sweep).
- A **signed-in student** (anonymous) may *read* `meta`, `players`, `teams`, `round`, `reveal`, `score`,
  `state`, `claims` of a game whose code they know; their own `hands/$uid` and `taps/$uid`; nothing else.
  Not signed in: nothing. No one may list `games`.
- `claims/$idx`: writable when empty (value = own uid) or when it is already own. **A claim exists only
  together with its player record**: joining is one multi-path write `{claims/<n>: uid, players/<uid>:
  {n, at}}`, and the rules look at the state *after* the whole write. So a claim with no matching player
  record, a second claim, releasing the name one still uses, and leaving an old claim behind on a re-roll
  are all refused (a student cannot hoard names). A re-roll is `{claims/<old>: null, claims/<new>: uid,
  players/<uid>/n: new}`. Only the teacher deletes a player (and then also their claim).
- `players/$uid`: only by `$uid`, never deleted by the student; the game must exist; `n` is an int in
  0..959 **and** `claims/<n>` (after the write) equals the writer's uid; `at` equals the server time when
  first written and never changes; **no other children**.
- `taps/$uid/$id`: only by `$uid`, who must already have a `players/$uid`; create-only; `$id` is
  `<n>_<k>` with `n` the same as the tap's `n` and `k` one digit; `n` equals the current `round/n`;
  `round/open` is `true`; `v` is an int 0–9; `at` equals the server time; **no other children**.
- Anything that is *not* a number/timestamp/bool in a student-writable place is rejected by `.validate`.

## 6. Lifecycle

1. **Create.** Teacher opens `host.html`, signs in with Google, picks a mode and its settings, presses
   *Create game*. The host picks a free `$code` (read-then-create; retry on collision), writes `meta`
   (`phase:"lobby"`), shows the code in huge type, a QR code, and the link `…/live.html?c=CODE`. Opening
   `live.html` with no code shows a code box.
2. **Join.** `live.html`: anonymous sign-in → read `meta` (if absent: "no such game") → pick a random
   unclaimed codename, claim it, write `players/$uid`. A *Different name* button releases and re-rolls
   (lobby only). The lobby shows everyone's codename on the projector.
3. **Teams** (modes that use them): the host's *Make teams* button assigns `teams/$uid` (balanced, as
   even as possible, never a team of one when a team of two is possible); the teacher may move anyone.
4. **Play.** Host sets `phase:"play"`, then loops: write `round` (`open:true`, `t0`, `ms`) and any
   `hands`; read incoming `taps` and grade them against the key held only in host memory; at the time
   limit, when all have answered, or when the teacher presses *Skip/Next*, set `round.open:false`, write
   `reveal` and `score`, and wait for the teacher's *Next*. The teacher is always in control of the pace.
5. **Done.** `phase:"done"`, final scoreboard on every screen. *End game* deletes `games/$code`.
6. **Reconnect.** A player who reloads the same tab keeps the same anonymous UID (session persistence),
   finds its own `players/$uid`, and resumes mid-game. A new tab is a new player. The host can remove a
   stale player. The **teacher's** page can resume a game still in the lobby, but not one in play: the answer
   key lives only in that page's memory, so reloading it mid-game ends that game (said in HOWTO.md). If the host's heartbeat (`meta.beat`, every 5 s, plus `onDisconnect` setting
   `meta.live:false`) is stale, phones show "Waiting for the teacher…" rather than a frozen question.
7. **Late joiners.** `meter`: welcome at the next question. `devices`: "A game is in progress — you'll
   join the next one" (teams are fixed once play starts).

8. **End-of-game breakdown.** When a game ends, the teacher's page shows final standings and an optional
   mode-supplied summary (`host.summary`, MODES.md), built only from that page's memory. Nothing is exported
   or saved; End game still deletes everything. Devices mode's summary lists the devices the class missed most.

## 7. Rules tests — the adversarial list (P1 must write every one, and all must pass)

Run with `@firebase/rules-unit-testing` against the emulator. Each is a *must be denied* unless noted:

1. Unauthenticated read or write of anything.
2. Anonymous user lists `games` or reads `config`.
3. Anonymous user creates a game, writes `meta`, `round`, `reveal`, `score`, `teams`, `state`, or `hands`.
4. Anonymous user reads another player's `hands/$uid` or `taps/$uid`. *(Own: allowed.)*
5. A Google user who is **not** `config/teacherUid` creates or deletes a game.
6. A token whose UID equals `config/teacherUid` but whose sign-in provider is `anonymous` (the test
   forges it) is denied everything the teacher can do — the provider clause must be tested on its own.
7. Claim a codename already claimed by someone else; overwrite or delete someone else's claim.
   *(Own claim and own release: allowed.)*
8. Write `players/<other uid>`; write own `players/$uid` with `n` not claimed by self; `n` out of range;
   `n` a string; an extra child (`name`, `email`, anything) — denied at every level.
9. Write a string where a number is required, in every student-writable field (`n`, `v`, `at`).
10. A tap when `round/open` is false; a tap with a stale or future `n`; `v` outside 0–9; an edit or delete
    of an existing tap; a tap with a client-chosen `at` instead of the server time; an extra child.
11. A tap into another player's `taps/<uid>`.
12. Writing `config/teacherUid` as anyone, including the teacher.
13. A student writing a very long string anywhere under a game (size/shape abuse).
14. *(Allowed — the happy path, so the rules are not simply locked shut):* teacher creates, edits and
    deletes a game; student claims, joins, reads the public nodes, writes a tap in an open round.

## 8. How a mode plugs in

P1 writes `live/MODES.md` with the exact hooks. The shape (P1 may refine, but P4 and P5 depend on
`MODES.md`, so it must be exact and exemplified by `modes/poll.js`):

- A mode registers itself with `Live.registerMode({ id, title, settings, teams, lateJoin, host, player })`.
  **The exact hooks, with return values, are in `MODES.md`, which is authoritative.** In brief (this
  refines the first draft of this section): the host half is `start(ctx)`, `nextRound(ctx)` which
  *returns* `{ms, round, hands}` (or null to end), `onTap(ctx, uid, tap)`, `lock(ctx)` which *returns*
  `{reveal, score}`, and `renderHost(ctx, el, view)`. The shell, not the mode, writes `round`, `hands`,
  `reveal` and `score`, so the invariants (round numbers, `open`, the server clock, one atomic write)
  cannot be got wrong by a mode. The player half is `render(ctx, el, view)`, with `ctx.tap(v)` to send a tap.
- Settings are `int`, `enum` or `flags` (tick-boxes stored as one number). Teams are declared, not coded.
- A mode never touches `firebase.*` and never writes outside its own game node.

## 9. Style and house rules (the same as the rest of the repo)

- Plain JavaScript, no framework, no bundler; match the surrounding code's commenting (explain the *why*
  at the top of each file, the way `devices.js` and `rhythm.js` do).
- Phones first: tap targets ≥ 48 px; every state also distinguishable without colour; the Latin text keeps
  its macrons and renders in the app's existing font stack (the one `styles.css` uses).
- Sound is projector-only: `Rhythm.play` from `rhythm.js` on the host page. Phones stay silent.
- **Never push.** Commit locally, by explicit path (never `git add -A`: other sessions share this folder).
  The owner previews and pushes. Never deploy rules or hosting; the owner does, after reading them.
- Never run anything against a real Firebase project. Emulators only, with a `demo-` project id.
- If `git` reports `index.lock`, wait a few seconds and retry; another session is committing.

## Corrections made by P1 (what the first draft got wrong or left open)

1. **Claim + player record are one atomic write** (section 5). The draft let a claim stand alone, which let
   one student claim all 960 names. The rules now look at the final state of the multi-path write
   (verified in the emulator) and refuse any claim without its player record.
2. **Tap ids are `<round>_<k>`**, one digit k, and a tap needs a joined player. The draft's free `$id` was a
   student-chosen *string key* (text!) and allowed unlimited taps.
3. **Codename range is exactly 0..959**, in the rules and in `names.js`; a test fails if they differ.
4. **Hooks return values** instead of writing (section 8); the host also **cannot resume a game in
   play** (the key is in memory); a phone shows "Waiting for the teacher" at once (the server marks
   `meta.live` false when the teacher's page disconnects) as well as after a 15 s silent heartbeat.
5. **Both pages use SESSION persistence**, including the teacher's, so a teacher signs in once per tab.
6. **The privacy notice must mention two Firebase IndexedDB databases** that outlive the tab (section 2.3).
7. **Per-mode stylesheets** `live/modes/<id>.css` replace "a section in `live/live.css`" so that two modes
   can be written at once without editing the same file.

## Corrections made by P5 (meter mode)

1. **Meter publishes only the line and the boxed letters before a round locks** (`round.t` the text, `round.a`/`round.b`
   the boxed letters, `round.tot` the number of questions). The answer, the reason, the marks and the syllable
   positions go out in `reveal` (`a` answer 0/1/2, `c` citation, `tg` tag, `why`, `mk` marks, `ac` accents, `nu`
   syllable spans, `cnt` how many tapped each, `pts` points won by uid). The question's *kind* is never published
   (an "elision" question would give itself away). The 2.4 MB bank is fetched by the teacher's page only
   (`host.start`); `tests/meter_mode.test.js` fails if the phone's code could reach it.
2. **`hands/<uid>` is used as a marker in meter**: an empty hand (just `n`) is written to each player present when a
   question opens, so a student who joins mid-question (no hand) is told "you'll play from the next question" and
   a tap of theirs is not graded.
3. **Settings values cannot contain a hyphen** (`Live.registerMode` checks `^[A-Za-z0-9]{1,16}$`, flags included),
   so the bank's kind `mcl-start` is the option `mclstart`.
4. **PLAN's "no two in a row of the same kind" holds for every kind but `plain`.** With plain, elision and mūta cum
   liquida ticked, strict alternation made a third of a 20-question game mūta cum liquida (plain is 88 % of the
   bank). Plain may now repeat; the rest may not (when another ticked kind can supply the answer).
5. **Tools:** `tools/bot_strategies/meter.js` plays meter (skill per bot 45-95 %, or `SKILL=1` for a bot that is always right: a
   check that what the phones were shown is what the host graded).
