# The database rules, in plain English

`database.rules.json` is the lock on the live game's database. JSON cannot hold comments, so this
file explains it. **Read this and the rules before deploying them** (live/HOWTO.md, Part 2, step 6).
`npm test` runs `tests/rules.test.js` (80 attempts, named after SPEC §7, to break it) and
`npm run test:mutate` weakens each rule one at a time to prove a test notices.

## Who is who

- **The teacher**: signed in *with Google* **and** whose ID equals `config/teacherUid`. Both parts are
  checked; an anonymous account that happens to have the teacher's ID is *not* the teacher. Only you can
  write `config/teacherUid`: no rule allows anyone (not even you) to, so it can only be set in the console.
- **A student**: any other signed-in account (in practice an anonymous one).
- **Nobody signed in** can do nothing.

## What a student can read

`meta`, `players`, `teams`, `round`, `reveal`, `score`, `state`, `claims` of a game **whose code they
know**; their **own** `hands/<their id>` and `taps/<their id>`. Not the list of games, not `config`, not
other players' hands or taps. The teacher can read everything under `games` and list it.

## What a student can write

Only three things, and each is a number, a server time, or their own ID:

1. **Join** = `claims/<n>` (value: their own ID) and `players/<their id>` = `{ n, at }`, **in one
   write**. `n` is a whole number 0-959 (the codename), `at` is the server's time. The rules refuse a
   claim with no matching player record, a player record whose name is not claimed by the writer, a name
   already held by someone else, and a second name without releasing the first. So nobody can hoard names,
   steal one, or end up with the same name as another player. **No other child** is allowed in a player
   record, so there is nowhere to put a name or an email.
2. **A different name** = release the old claim and take a new one in one write (`at` does not change).
3. **A tap** = `taps/<their id>/<round>_<k>` = `{ n, v, at }`: only while the round is open, only for the
   *current* round `n`, `v` a whole number 0-9, `at` the server's time, `k` a single digit (so at most
   10 taps per round), only once (a tap can never be edited or deleted), and only by someone who has
   joined. No other child.

So a student can write only numbers and server times, plus one string: the claim's value, which must equal
their own ID (made up by Firebase, not typed). The *keys* of the paths they write are limited too (digits and
the fixed names above), so a key cannot carry text either. No text typed by a student can reach the database.
A text box that "only accepts a pattern" would not be enough; here the database itself refuses text.

## What only the teacher writes

Everything else under `games/<code>`: `meta`, `teams`, `round`, `hands`, `reveal`, `score`, `state`, and
removing players. Even the teacher is held to the shapes (a phase must be `lobby|play|done`, a team
number 0-9, a round needs `n`, `open`, `t0`, `ms` (plus whatever public data the mode adds), no stray children in `meta` or the game, a four-consonant game code) so a bug
in the teacher's page cannot freeze every phone.

## Known limits (what these rules cannot do)

- **A student who knows a game code can read its public nodes** (codenames as numbers, the question on
  screen). Codes are four consonants (130,321 possibilities) and short-lived. Nothing private is there.
- **Anyone can make anonymous accounts**, up to Firebase's own limit per address per hour. A determined
  student with many accounts could fill a game with fake players; the teacher removes them. They still
  cannot write any text.
- **Time limits are the teacher page's job**, not the rules': the rules only know "open" or "closed".
  A tap's server time lets the teacher's page ignore a late one.
- **The emulator is not production.** The tests run in Firebase's emulator, which uses the same rules
  engine. After deploying, the first real game is the last test.
