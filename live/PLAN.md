# Live game — work plan

Written 2026-10-27. The contract every package shares is [`SPEC.md`](SPEC.md) — read it first, in full.
Each package below is meant to be handed to its own Claude conversation (Sonnet is enough; see "Notes
on running these"). A package changes only the files it lists.

## The order

```
 P0  owner: Firebase console, ~20 min ───────────────────────────────┐ (only needed for the first
                                                                      │  real-phone test, not to build)
 STAGE 1 — start together, they touch different files
   P1  live core: rules + shells + lobby + bots        (the big one)
   P2  meter question bank                              (a Python script and its data)
   P3  device dealing logic                             (one pure JS file and its tests)
 STAGE 2 — start when P1 has reported (P4 also needs P3; P5 also needs P2)
   P4  devices mode  (team matching)
   P5  meter mode    ("Longa an brevis?")
 STAGE 3
   P6  integration, owner preview, a first class
 LATER
   P7  meter "Relay" — a team scans one line together
```

Why this split: P1 fixes the data model and the plug-in shape; P2 and P3 need nothing from P1 (they
are logic with tests), so they run beside it; P4 and P5 need P1's `MODES.md` and are otherwise
independent of each other, so they run beside each other. No two packages in the same stage touch the
same file. The only shared file, `live/SPEC.md`, changes only by a note in the commit that did it.

---

## P0 — The owner's Firebase setup (no code, ~20 minutes, do it any time before P6)

Plain English first: Firebase is Google's free back-end service (the survey app uses it). The live game
gets its **own new project**, so a mistake here can never touch the survey and so the free plan's
ceiling protects you from any bill.

1. Go to console.firebase.google.com → **Add project**. Name it `latin-live-game`. **Turn Google
   Analytics off.** Stay on the free **Spark** plan; never press an Upgrade button.
2. **Build → Realtime Database → Create database.** Location: United States. Start in **locked mode**.
3. **Build → Authentication → Get started → Sign-in method:** enable **Anonymous**, and enable **Google**
   (choose your own address as the support email).
4. **Authentication → Settings → Authorized domains:** add `samuelshotchkiss-jpg.github.io`
   (`localhost` is already there).
5. **Project settings → Your apps → Web (`</>`)** → register an app (skip hosting) → copy the
   `firebaseConfig` block into `live/firebase-config.js`. (Its API key looks like a password but is not
   one; the rules are the lock.)
6. After a session reports the rules done and you have read `database.rules.json`: run
   `firebase use --add` (pick the new project), then `firebase deploy --only database`.
7. Open `host.html` on the real site once and sign in with Google. In the console, **Authentication →
   Users**, copy your UID; then **Realtime Database → Data**, add `config` → `teacherUid` = that UID.
   Until you do, nobody can host, including you. (This is how the app knows you are the teacher without
   your email ever being in a public repo.)
8. Ask the school's IT, or just test: the survey app already works from student devices, so the school's
   filter evidently lets `firebaseio.com` through; the live game also uses Firebase Auth's own domains.
   Try one student phone on school Wi-Fi before the first class.

---

## P1 — Live core (the big one)

**Plain summary.** The skeleton every game runs on: the rules that keep students out of each other's
data and names out of the database, the teacher's projector page, the student's phone page, the lobby,
codenames, teams, the round loop, the scoreboard, reconnection — plus simulated students ("bots") so we
can test without a room of phones. No actual game content yet except a tiny test mode.

**Read first:** `live/SPEC.md` (all of it); `devices.html`, `devices.js`, `devices.css` (how a
sibling page is built and styled), `styles.css`, `rhythm.js` (leave it alone), `COPYRIGHT.md`, `README.md`.

**Build** (every file named in SPEC §4 except `live/deal.js`, `tools/make_meter_questions.py`,
`data/meter_questions.json`, `tests/deal.test.js` and `tests/test_meter_questions.py`, which belong to
P2/P3; `live/modes/devices.js` and `live/modes/meter.js` get one-line stubs that register as "not built
yet", for P4 and P5 to fill):
1. `database.rules.json`, `firebase.json` (auth + database emulators), `.firebaserc` (project
   `demo-latin-live`), `package.json` (dev-only: `@firebase/rules-unit-testing`, `firebase` for the bots;
   scripts `emulate` and `test`), `.gitignore` additions (`node_modules/`).
2. `tests/rules.test.js` — every item of SPEC §7, named after the item.
3. `live/net.js` (the only Firebase-touching file), `live/names.js`, `live/host.js`, `live/player.js`,
   `live/live.css`, `live.html`, `host.html`, `live/firebase-config.js` (placeholders; the page must say
   "this game is not set up yet" instead of failing if it still holds placeholders), a vendored MIT
   QR-code library in `live/vendor/` with its licence.
4. `live/modes/poll.js` — a throwaway mode that asks "A, B or C?" and shows counts. It exists to prove
   the plumbing and to be the worked example in `MODES.md`. Reachable only with `host.html?debug`.
5. `live/MODES.md` — the exact hooks of SPEC §8, with the poll mode as the worked example. **P4 and P5
   will be written from this file alone**, so it must be complete: lifecycle order, what `ctx` offers,
   what a mode may write, how a mode declares settings, how it draws on the projector vs the phone, how
   it ends a round, how it reports scores.
6. `tools/bots.js` — `node tools/bots.js CODE --n 12 --speed fast` joins N anonymous bots to a game in
   the emulator and has them claim names and tap at random with realistic delays; `tools/seed-emulator.js`
   — creates a fake Google teacher in the Auth emulator and writes `config/teacherUid`.
7. `live/HOWTO.md` — plain English, for a Latin teacher: how to try it on your own computer (the
   emulator commands, in order), how to start a real game, what to do when a phone locks, what is stored
   and for how long. No jargon without a one-line gloss.
8. `names.js`: 24 Latin adjectives × 40 animal/nature nouns (= 960 names), nouns carrying their gender,
   adjectives given in all three nominative forms so every pairing **agrees** (e.g. *Vulpēs Callida*,
   *Lupus Audāx*). Macrons correct. Positive or neutral meanings only — nothing a 12-year-old could use to
   tease a classmate; no real first names, no Latin word that reads as an English name. Print the whole list
   in your final report so the owner (a Latin teacher) can check it.

**Done when** (show each, don't just claim it):
- `npm test` passes, all SPEC §7 cases present, and you have **tried to break the rules yourself** with at
  least five attacks not on the list, reporting each result.
- In the browser pane, against the emulator: host page at 1280×720 and a player page at 375×812; 12 bots
  join; codenames are unique; teams form; the poll mode runs three rounds; a reload of one player's tab
  rejoins as the same player; killing the host tab shows "Waiting for the teacher…" on players within
  about 15 s; *End game* removes the game from the emulator. Screenshots of host (lobby, mid-round, reveal)
  and player (lobby, mid-round, reveal).
- The notice on each page lists exactly what is stored; a test reads the browser's real storage after a
  game and compares.
- No console errors; the page on `127.0.0.1` refuses to run.
- Committed locally by explicit path in logical commits. **Not pushed, rules not deployed.**

**Don't:** touch `index.html`, `app.js`, `devices.*`, `progress.js`, `rhythm.js`, `styles.css`, `data/`;
add a nav link to the existing pages (P6); call any real Firebase project; add dependencies beyond the above.

---

## P2 — The meter question bank

**Plain summary.** Turn the 720 scanned lines into a bank of single-syllable questions — "this
syllable: long, short, or elided?" — each with the reason, so the game can ask them in seconds and the
projector can teach from the answer. Python only; no web code.

**Read first:** `data/lines.json` (each line has `nuclei`: one record per syllable with `mark`
(`L`/`S`/`elided`/`prodelided`/`merged`), `why`, `followed_by` (the consonants after the vowel, even
across a word break), `accent`, `start`/`end` character offsets), `README.md` (the eight levels and the
"kinds" of line), `data/tutorial.json` (how the lessons name the reasons), `scansion/scansion.py` (how a
line's level and flags are decided — reuse its logic for a *syllable's* kind rather than inventing a
second one), and in `app.js`: `expected()` (line ~885, how marks become `L`/`S`/`X` for the drum player)
and the code from line ~1330 that builds the one-sentence reason shown in the zoom-in. **Match the app's
wording for the reasons**; only write new sentences where the app has none.

**Build:**
- `tools/make_meter_questions.py` (stdlib only) → `data/meter_questions.json`:
  ```
  { "note": "Generated by tools/make_meter_questions.py from data/lines.json; edit there. Content: CC BY-NC-SA 4.0; the Latin is public domain.",
    "lines": { "<citation>": { "text", "marks": ["L","S","X",…], "accents": [bool,…],
                               "passage", "level", "flags" } },
    "questions": [ { "id":"<citation>#<nucleus index>", "line":"<citation>", "i":<nucleus index>,
                     "span":[start,end], "word":[start,end], "answer":"L"|"S"|"X",
                     "kind":"<one of the kinds>", "level":1..8, "why":"<sentence>" } ] }
  ```
  Lines are stored once and referenced by citation (the bank must stay small; aim for under 1 MB).
- **Which syllables are asked about.** NEVER: a syllable whose vowel carries a macron in the text (the
  answer is visible), a diphthong, or the last syllable of a line (anceps). Ask about: a vowel long **by
  position** (unmarked, two consonants — within a word and across a word boundary), an unmarked short
  vowel (including before a vowel — hiatus), a vowel before a mute-and-liquid (poet's scansion as in the
  data), a vowel after a word-initial cluster that is ignored, vowels before `qu`, `h`/`x`/`z`, a Greek
  word, and the final vowel of a word that is **elided**. Report how many of each exist. Exclude lines
  flagged `advanced` unless their kind is `advanced`.
- `kind` is one of the app's eight levels' ideas, per *syllable* (not per line): `plain`, `qu`, `hxz`,
  `elision`, `mcl`, `mcl-start`, `greek`, `advanced`. State the mapping in the file's header comment.
- `tests/test_meter_questions.py` (`unittest`): no question has a macron on its highlighted vowel;
  no diphthong; no final syllable; every `span` lies inside `text` and sits on a vowel (or vowel+`m` for
  an elision); `answer` agrees with the line's `marks`; every line's `marks` reproduces the app's
  `expected()`; the file is byte-for-byte reproducible from `lines.json`.
- A **distribution report** printed by `--report`: counts per kind × answer × passage; kinds thinner
  than 50 questions; and whether the default mix can hold roughly 40 % long / 40 % short / 20 % elided.
- A **review sheet** `tools/meter_questions_sample.md` (not committed): 40 random questions, each as the
  line with the syllable marked, the answer, the kind and the reason, in a form the owner can skim in ten
  minutes and mark wrong ones. Seeded so it is reproducible; 5 from each of the larger kinds.

**Done when:** tests pass; the report and the sample sheet are in your final message (paste the report);
anything that looked doubtful in the data is listed, with citations, not silently fixed or dropped.
Commit `tools/make_meter_questions.py`, `tests/test_meter_questions.py` and `data/meter_questions.json`
by explicit path. **Not pushed.**

**Don't:** edit `data/lines.json` or the scanner; invent Latin quantity; ask about a syllable the data
marks ambiguous or low-confidence.

---

## P3 — Device dealing logic

**Plain summary.** The rules of the team game, as one small file with no screen: given the 23 devices,
pick a prompt, pick the two right cards from the other columns, choose believable wrong ones, and
deal the cards to the teammates so the right two end up on different phones. Fully tested in Node.

**Read first:** `data/devices.json` (23 devices; each has `key`, `name`, `definition`, `examples[]`;
an example has `cite`, `latin` (lines of `[text, isBold]` pairs), `english`, `lines`, and `also`: the
other devices **that same example also illustrates**), `devices.js` (`face()` shows how a card is drawn;
the practice page ignores `also`, the teacher's quiz honours it — see the toolkit's `quiz.py` `draw()`:
"no example beside a device it also is"), `live/SPEC.md` §6.

**Build** `live/deal.js` as a UMD-style file that works as `window.Deal` in a page and `require()` in
Node, and `tests/deal.test.js` using Node's built-in `node:test` (no dependencies, no `package.json`
needed — P1 owns `package.json`):
- `Deal.makeRound(pool, { promptKind, rng, decoys })` (`pool` = the `devices` array of `data/devices.json`) → `{ id, key, promptKind, prompt, answers:{…},
  decoys:{…} }`: `promptKind` is `name`, `definition` or `example`; the two *other* columns each get one
  right card and `decoys` wrong ones (default 2).
- `Deal.hands(round, teamUids, { rng, handSize })` → `{ uid: [card…] }`. Invariants: with a team of two
  or more, the two right cards are in **different** hands; with a team of one, in the same hand; no hand
  is empty or longer than `handSize` (default 4); hands are shuffled; **no card appears twice** in a team.
- **Wrong-answer rules** (the heart of it): a decoy is never a second right answer. A decoy *example*
  must not belong to the prompt's device **or list it in `also`** (and if the prompt is an example, decoy
  names and definitions must exclude that example's device and every device in its `also`). A decoy
  *name/definition* must come from a device that is not the prompt's. No two decoys in a column come from
  the same device. No Latin line is used twice in one round.
- `Deal.judge(round, card)` → `{ ok, column }` — the grading the host will use. A card that is right is
  right even if it was a decoy for some other reading (an example in `also`).
- **Transport form of a card** (what is written to the database and drawn on a phone — flat, no nested
  arrays, because Realtime Database turns arrays into objects): `{ id, kind, key, text }` for name and
  definition; `{ id, kind:"example", key, cite, lines:[{t:"…", b:[[start,end],…]}], en:"…" }` for an
  example (`b` = the bold ranges that `latin` marks with `true`). Ids are stable strings
  (`name:simile`, `def:simile`, `ex:simile:Met. 8.213-214`). Cards contain **no answer key**: which card is
  right is known only through `judge`.
- Deterministic for a given `rng` seed (include a tiny seeded rng in the file).

**Done when:** `node --test tests/deal.test.js` passes with property-style tests: all 23 devices × the 3
prompt kinds × team sizes 1–5 × 200 seeds satisfy every invariant above; a test for every example that has
a non-empty `also`; a test that no round can contain two right answers (brute-force every card in the
round against `judge`). Report any device that cannot yield enough decoys (the seven devices with one
example are the suspects) and what you did. Commit `live/deal.js` and `tests/deal.test.js`. **Not pushed.**

**Don't:** touch `devices.js`/`data/devices.json`; add dependencies; draw anything.

---

## P4 — Devices mode (after P1 and P3 report)

**Plain summary.** The Quizlet-Live-style team game: the projector shows each team's progress; each
phone shows the team's prompt and a few cards; the team must find which teammate holds the right
definition and which holds the right example, and tap them — a wrong tap sends the team back to zero.

**Read first:** `live/SPEC.md`, `live/MODES.md`, `live/deal.js` (+ its tests), `devices.js` (card faces),
`devices.css`, one worked mode (`live/modes/poll.js`).

**Build** `live/modes/devices.js` (+ its styles in `live/modes/devices.css`, every class prefixed `dv-live-`; already linked from both pages. Do not edit `live/live.css`: P5 is working at the same time):
- **Settings the teacher sets:** goal (first team to N completed rounds: 6 / 8 / 10 / 12), teams
  (`auto` = teams of 2–3, or `one` = the whole class as a single team racing the clock), minutes cap
  (0 = none / 5 / 8 / 10), show the English under examples (yes/no), prompt column (`rotate` / name /
  definition / example). Default: rotate through all three columns.
- **A round** = one prompt for every team (the same device for all, different decoys and deals per team)
  so the projector can show one big prompt. A team *completes* the round when both its right cards have
  been tapped; each completed round adds one to the team's count.
- **A tap** is a card `v` (an index into the tapper's own hand). The phone asks to confirm ("Lock it in")
  before sending, because a wrong tap costs the team its streak. The host grades with `Deal.judge`:
  right → that column is locked for the team; wrong → the team's streak goes to zero (a visible,
  funny-not-cruel reset) and that card is greyed out for the team.
- **Phones never reveal where the answer is.** A phone shows the prompt, its own hand, the teammates'
  codenames, and the team's progress (how many right so far, which column is still open) — not who holds
  what.
- **Projector:** the big prompt; each team's codename list, progress bar and streak; a celebratory
  winner screen; the full set of three rows for the round after it locks (name · definition · example).
- Respect `also`. With 3–4 players there is one team of 2 and one of 1–2: make sure a team of one is
  playable (its single hand holds both right cards) and say so in the lobby.
- Late joiners wait for the next game (SPEC §6.7).

**Done when:** with bots (`tools/bots.js` extended or a mode-specific bot file you add under `tools/`):
a full game to the goal with 3, 6 and 9 players; a team of one; a wrong tap resets; the whole-class
race; reload mid-round keeps the player's hand; the winner screen. Screenshots of the projector (prompt
screen, mid-game, winner) and a phone (hand, locked-in, wrong-tap reset). `npm test` still green.
Commit by explicit path; **not pushed**.

---

## P5 — Meter mode "Longa an brevis?" (after P1 and P2 report)

**Plain summary.** Everyone sees the same line with one syllable highlighted; each student taps *Long*,
*Short* or *Elided* within a few seconds; the projector then reveals the answer, the reason, and the whole
scanned line — and plays it as a drum rhythm. Meant for 5–10 minutes of fast, loud, low-stakes practice.

**Read first:** `live/SPEC.md`, `live/MODES.md`, `data/meter_questions.json` + `tools/make_meter_questions.py`
(its header describes the kinds), `rhythm.js` (`Rhythm.play(marks, onBeat, onEnd, accents)`; marks are
`L`/`S`/`X`; `app.js` ~line 985 shows it driving highlighting), `index.html`/`styles.css`
(how a scanned line and its marks look).

**Build** `live/modes/meter.js` (+ its styles in `live/modes/meter.css`, every class prefixed `mt-live-`; do not edit `live/live.css`):
- **Settings:** number of questions (10 / 20 / 30 / 40), seconds per question (6 / 8 / 12 / 20),
  kinds (a checkbox for each of the bank's kinds, with the same plain labels the practice page uses;
  default: plain, elision, mcl), passages (checkboxes; default: all), teams (off / on — on = team score
  is the average of its members' scores, so unequal teams stay fair).
- **Question selection:** sample from the bank for the ticked kinds, no line twice in a game, no two
  questions in a row of the same kind, and keep the answer mix near 40 % long / 40 % short / 20 % elided
  (the third only if `elision` is ticked). Seeded so a game can be replayed.
- **Phone:** the line in large type, the highlighted syllable obvious without colour (underline + box),
  three large buttons — ‒ Long · ◡ Short · ⌒ Elided — a visible countdown; after a tap, "Locked in ✓"
  and the choice is not changeable; at the reveal, ✓/✗, the points, and the one-line reason. The phone
  never shows the answer before the reveal.
- **Projector:** the line huge with the syllable framed; the countdown; a live count of who has answered
  (not who is right); then the reveal: the answer, the reason, the line with all its marks, and the
  rhythm played through `Rhythm.play` with the syllables lighting up. The teacher presses Next (also the
  space bar); a *Replay rhythm* key; no auto-advance by default.
- **Scoring:** correct = 500 + 500 × (time left ÷ time allowed); wrong or no answer = 0; no streak
  bonus in v1. Scoreboard after every question (top five) and at the end.
- The correct answer lives only in the host's memory until the reveal is written.
- Late joiners are welcome at the next question.

**Done when:** with bots: a 20-question game with 3, 8 and 20 bots; the distribution of kinds and answers
in that game printed; a reload mid-question rejoins; a player who answers after the lock is ignored;
teams on and off. Screenshots: phone (question, locked, reveal ✓ and ✗), projector (question, reveal).
A short list of the 10 questions that looked hardest for a 7th-grader, with the reason shown, for the
owner to judge. `npm test` still green. Commit by explicit path; **not pushed**.

---

## P6 — Integration and the first class (me, with the owner)

Add the "Play live" link to the existing nav only after the owner has previewed locally; the pages'
`?v=` markers; `COPYRIGHT.md` and `README.md`; a run-through with bots on both modes; phone-width and
projector-width screenshots; the real-project steps of P0; one trial game with one or two students on
real phones before a full class. The owner previews at `localhost:8770` and then decides about pushing.

## P7 — "Relay" (later; not specified)

A team scans one whole line together, each member owning a stretch of words, and the game tells them only
"one of you has a mistake". It shows the syllable divisions, which the practice app deliberately hides
until the `fast` badge — so it needs the owner's ruling first (see `latin-scansion-app` notes on fast
scanning). Do not start it unprompted.

---

## Notes on running these

- A package = one conversation = one model session. Sonnet 5.5 is enough for all of them; the rules in P1
  are the part most worth a second look by a stronger model or by the owner reading `database.rules.json`
  and the test names before deploying.
- Packages in the same stage share one checkout (this folder). Commit **by explicit path**; never
  `git add -A`; never switch branches; if `git` says `index.lock`, wait and retry.
- Nothing is pushed or deployed by a package. The owner previews locally and then pushes.
- Each package ends with a report: what was built, what was tested and how, what looked wrong, and
  anything in `SPEC.md` that turned out to be mistaken (fix `SPEC.md` in the same commit).
