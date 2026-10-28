// bots.js -- simulated student phones for testing, against the EMULATOR only. AGPL-3.0.
//
//   node tools/bots.js CODE --n 12 --speed fast
//
// Each bot is a separate anonymous player: it signs in, claims a random free codename, joins the game,
// and then taps in every round after a realistic delay. It speaks the same protocol as live/player.js
// (through the same rules), so a game with bots exercises the teacher page exactly as a classroom would.
//
//   --n N          how many bots (default 8)
//   --speed S      fast (0.3-2.5 s), normal (1-6 s), slow (3-12 s) before each tap (default normal)
//   --dropout P    chance (0-1) that a bot skips a round (default 0)
//   --seed N       makes the choices repeatable
//   --for SECONDS  stop after this long (default: until the game is deleted)
//   --quiet        less chatter
// How a bot chooses what to tap is in tools/bot_strategies/<mode id>.js (see poll.js); a mode with no
// file of its own gets a random tap among the choices in round.choices (or 0-3).
"use strict";
const path = require("node:path");
const fs = require("node:fs");

const arg = (name, dflt) => {
  const i = process.argv.indexOf("--" + name);
  return i < 0 ? dflt : (process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : true);
};
const CODE = (process.argv[2] || "").toUpperCase();
const N = Number(arg("n", 8)), SPEED = String(arg("speed", "normal")), DROPOUT = Number(arg("dropout", 0));
const QUIET = !!arg("quiet", false), SEED = Number(arg("seed", Date.now() % 100000)), FOR = Number(arg("for", 0));
const DELAYS = { fast: [300, 2500], normal: [1000, 6000], slow: [3000, 12000] };
const AUTH_PORT = Number(process.env.AUTH_PORT || 9099), DB_PORT = Number(process.env.DB_PORT || 9000);

if (!/^[BCDFGHJKLMNPRSTVWXZ]{4}$/.test(CODE)) {
  console.error("Usage: node tools/bots.js CODE --n 12 --speed fast   (CODE is the four letters on the teacher screen)");
  process.exit(1);
}
if (!DELAYS[SPEED]) { console.error("--speed must be fast, normal or slow"); process.exit(1); }

const firebase = require("firebase/compat/app");
require("firebase/compat/auth");
require("firebase/compat/database");
global.Live = require("../live/common.js");              // so a mode file can be loaded here, only to read its flags
const Names = require("../live/names.js");
for (const m of ["poll", "devices", "meter"]) {
  try { require("../live/modes/" + m + ".js"); } catch (e) { /* a mode that needs the browser is simply not known to the bots */ }
}

const rng = Live.rng(SEED);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => { if (!QUIET) console.log(...a); };
const TS = firebase.database.ServerValue.TIMESTAMP;
const CONFIG = { apiKey: "demo-key", authDomain: "localhost", projectId: "demo-latin-live", databaseURL: "https://demo-latin-live-default-rtdb.firebaseio.com", appId: "demo-app" };

async function makeBot(i, strategy) {
  const app = firebase.initializeApp(CONFIG, "bot" + i);
  const auth = app.auth(); auth.useEmulator("http://localhost:" + AUTH_PORT);
  const db = app.database(); db.useEmulator("localhost", DB_PORT);
  const uid = (await auth.signInAnonymously()).user.uid;
  const g = (p) => db.ref("games/" + CODE + (p ? "/" + p : ""));
  const bot = { i, uid, idx: null, taps: 0, done: false, app };

  // join: claim a random free name and write the player record in one write (see database.rules.json)
  for (let tries = 0; tries < 15 && bot.idx === null; tries++) {
    const claims = (await g("claims").get()).val() || {};
    const free = [];
    for (let k = 0; k < Names.NAME_COUNT; k++) if (!claims[k]) free.push(k);
    const idx = free[Math.floor(rng() * free.length)];
    try { await g().update({ ["claims/" + idx]: uid, ["players/" + uid]: { n: idx, at: TS } }); bot.idx = idx; }
    catch (e) { await sleep(100 + rng() * 200); }
  }
  if (bot.idx === null) throw new Error("bot " + i + " could not join");
  bot.name = Names.nameFor(bot.idx);
  log("  bot " + String(i).padStart(2) + " joined as " + bot.name);

  let lastRound = 0, hand = null;
  g("hands/" + uid).on("value", (s) => { hand = s.val(); });
  let latest = null, busy = false, again = false;
  const used = {};                                            // round -> taps sent in it
  const send = async (v) => {                                 // always for the CURRENT round (a refused tap is the strategy's to retry)
    for (let w = 0; w < 10 && !(latest && latest.open); w++) await sleep(100);
    const r = latest;
    if (!r || !r.open) return false;
    const k = used[r.n] = (used[r.n] === undefined ? 0 : used[r.n] + 1);
    if (k > 9) return false;
    try { await g("taps/" + uid + "/" + r.n + "_" + k).set({ n: r.n, v, at: TS }); bot.taps++; log("  bot " + String(i).padStart(2) + " tapped " + v + " in round " + r.n); return true; }
    catch (e) { log("  bot " + i + " refused in round " + r.n + " (" + (e.code || e.message) + ")"); return false; }
  };
  const pass = async () => {                                  // one strategy run at a time per bot; run again if the round moved on meanwhile
    if (busy) { again = true; return; }
    busy = true;
    try { await strategy.run({ round: latest, hand: () => hand, rng, bot, tap: send }); } catch (e) { /* a bad hand just skips a turn */ }
    busy = false;
    if (again) { again = false; pass(); }
  };
  g("round").on("value", (s) => {
    const r = s.val();
    latest = r;
    if (strategy.run && r && r.open && !bot.done) { pass(); return; }
    if (!r || !r.open || r.n <= lastRound) return;
    lastRound = r.n;
    if (rng() < DROPOUT) { log("  bot " + i + " skips round " + r.n); return; }
    const [lo, hi] = DELAYS[SPEED];
    const wait = Math.min(lo + rng() * (hi - lo), Math.max(300, (r.ms || 8000) - 500));
    if (strategy.run) {                     // a strategy that plays on its own, looking at the current hand each time
      pass();
      return;
    }
    setTimeout(async () => {
      const v = strategy.choose({ round: r, hand: hand && hand.n === r.n ? hand : null, rng, bot });
      if (v === null || v === undefined) return;
      try {
        await g("taps/" + uid + "/" + r.n + "_0").set({ n: r.n, v, at: TS });
        bot.taps++;
        log("  bot " + String(i).padStart(2) + " tapped " + v + " in round " + r.n);
      } catch (e) { log("  bot " + i + " too late for round " + r.n + " (" + (e.code || e.message) + ")"); }
    }, wait);
  });
  g("meta").on("value", (s) => { if (!s.exists()) bot.done = true; });
  return bot;
}

async function main() {
  // one throwaway connection to read the game's mode
  const probe = firebase.initializeApp(CONFIG, "probe");
  probe.auth().useEmulator("http://localhost:" + AUTH_PORT);
  probe.database().useEmulator("localhost", DB_PORT);
  await probe.auth().signInAnonymously();
  const meta = (await probe.database().ref("games/" + CODE + "/meta").get()).val();
  if (!meta) { console.error("No game " + CODE + " in the emulator. Create it on http://localhost:8770/host.html first."); process.exit(1); }
  const def = Live.modes[meta.mode] || {};
  if (Live.isGone(meta, Date.now())) {
    console.error("Game " + CODE + " has ended: its teacher's page has been closed for over a minute.");
    process.exit(1);
  }
  if (meta.phase === "play" && def.lateJoin === false) {
    console.error("Game " + CODE + " is already being played and its mode does not take late joiners.");
    process.exit(1);
  }
  const sf = path.join(__dirname, "bot_strategies", meta.mode + ".js");
  const strategy = fs.existsSync(sf) ? require(sf) : { choose: ({ round, rng }) => Math.floor(rng() * ((round.choices && round.choices.length) || 4)) };
  console.log("Game " + CODE + " (" + meta.mode + ", " + meta.phase + "): adding " + N + " bots, speed " + SPEED + ", seed " + SEED);

  const bots = [];
  for (let i = 1; i <= N; i++) bots.push(await makeBot(i, strategy));
  const names = bots.map((b) => b.name);
  console.log(N + " bots joined; codenames unique: " + (new Set(names).size === names.length ? "yes" : "NO"));
  const t0 = Date.now();
  while (!bots.every((b) => b.done) && (!FOR || Date.now() - t0 < FOR * 1000)) await sleep(500);
  console.log(bots.every((b) => b.done) ? "The game was deleted; bots stop." : "Time is up; bots stop.");
  console.log("Taps sent: " + bots.map((b) => b.taps).join(", "));
  await Promise.all(bots.map((b) => b.app.delete()));
  await probe.delete();
  process.exit(0);
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
