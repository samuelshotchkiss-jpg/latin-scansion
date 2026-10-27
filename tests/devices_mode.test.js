// devices_mode.test.js -- the game rules of the devices mode (live/modes/devices.js), with no browser:
// hands carry no card ids or keys, teams advance independently, a tap is mapped against the tapper's
// CURRENT hand (so a tap meant for an old deal is ignored), a refused tap is sent again once the round
// reopens, a team of one is playable, big teams get cards, and the summary hook reports missed devices.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

global.Live = require("../live/common.js");
const Deal = require("../live/deal.js");
const mode = require("../live/modes/devices.js");
const bot = require("../tools/bot_strategies/devices.js");       // its own reading of the data: the oracle
const POOL = require("../data/devices.json").devices;
const def = Live.modes.devices;

const uids = (n, p = "u") => Array.from({ length: n }, (_, i) => p + i);
const asList = (x) => (Array.isArray(x) ? x : x ? Object.values(x) : []);
// what the database would keep: empty arrays vanish
const stored = (v) => JSON.parse(JSON.stringify(v, (k, x) => (Array.isArray(x) && !x.length ? undefined : x)));
const keysIn = (v, out = new Set()) => {
  if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { if (!Array.isArray(v)) out.add(k); keysIn(x, out); }
  return out;
};

function game(sizes, extra) {
  const teams = {};
  sizes.forEach((sz, t) => { teams[t] = uids(sz, "t" + t + "p"); });
  const g = mode.createGame(POOL, Object.assign({ goal: 3, teams, rng: Deal.seeded(7) }, extra));
  g.hands = g.nextRound();                       // the first deal: every player's hand, as written to the database
  return g;
}
// what a phone sends for card i of its current hand
const vOf = (g, team, i) => mode.encodeTap(i, g.T[team].deal);
// all of a team's right cards, as [uid, index] pairs, judged by the oracle (not by Deal)
const rightOf = (g, team) => g.T[team].uids.flatMap((u) => asList(g.hands[u].cards).map((f, i) => [u, i, f])
  .filter(([, , f]) => bot.isRight(g.hands[u].p, f)).map(([uu, i]) => [uu, i]));
const wrongOf = (g, team) => g.T[team].uids.flatMap((u) => asList(g.hands[u].cards).map((f, i) => [u, i, f])
  .filter(([, , f]) => !bot.isRight(g.hands[u].p, f)).map(([uu, i]) => [uu, i]));
const complete = (g, team) => { let r; for (const [u, i] of rightOf(g, team)) r = g.tap(u, vOf(g, team, i), team); return r; };
// advance the way the host does: re-deal the teams that finished, and refresh everyone's hand
const advance = (g) => { g.hands = g.nextRound(); };

test("hands written to the database hold faces only: no key, no id, no answers", () => {
  for (const size of [1, 2, 3, 6, 9]) for (let seed = 1; seed <= 60; seed++) {
    const g = mode.createGame(POOL, { goal: 3, teams: { 0: uids(size) }, rng: Deal.seeded(seed) });
    const hands = g.nextRound();
    const written = stored({ hands, state: g.publicState() });
    const names = keysIn(written);
    for (const bad of ["key", "id", "answers", "decoys", "kind", "cite", "text", "lines", "en"]) assert.ok(!names.has(bad), `a written field is called ${bad}`);
    assert.ok(!JSON.stringify(written).includes("answers"));
    for (const u of uids(size)) assert.equal(asList(hands[u].cards).length, g.dealt[u].length);   // index -> card map is complete
  }
});

test("a line with nothing in bold still draws after the database drops its empty list", () => {
  const g = game([2]);
  let seen = 0;
  for (let i = 0; i < 40; i++) {
    for (const f of [g.hands.t0p0.p, ...Object.values(g.hands).flatMap((h) => asList(h.cards))]) {
      if (f.k !== "example") continue;
      for (const line of asList(stored(f).l)) { assert.equal(typeof line.t, "string"); asList(line.b); seen++; }
    }
    complete(g, "0"); advance(g);
  }
  assert.ok(seen > 0);
});

test("a team of one holds both right cards; every player of a big team (up to 9) holds a card", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const g = mode.createGame(POOL, { goal: 3, teams: { 0: ["solo"] }, rng: Deal.seeded(seed) });
    const hands = g.nextRound();
    assert.equal(asList(hands.solo.cards).filter((f) => bot.isRight(hands.solo.p, f)).length, 2);
    for (const size of [6, 9]) {
      const g2 = mode.createGame(POOL, { goal: 3, teams: { 0: uids(size) }, rng: Deal.seeded(seed) });
      const h2 = g2.nextRound();
      for (const u of uids(size)) assert.ok(asList(h2[u].cards).length >= 1, `size ${size} seed ${seed}: ${u} has no card`);
      assert.equal(uids(size).flatMap((u) => asList(h2[u].cards)).filter((f) => bot.isRight(h2[uids(size)[0]].p, f)).length, 2);
    }
  }
});

test("the two right cards of a team are on different phones (team of two or more)", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const g = mode.createGame(POOL, { goal: 3, teams: { 0: uids(3) }, rng: Deal.seeded(seed) });
    g.hands = g.nextRound();
    assert.equal(new Set(rightOf(g, "0").map(([u]) => u)).size, 2);
  }
});

test("a team that completes its prompt is dealt a new one at once; the others keep theirs", () => {
  const g = game([2, 2, 2]);
  const before = [0, 1, 2].map((t) => JSON.stringify(g.hands["t" + t + "p0"]));
  const r = complete(g, "1");
  assert.ok(r.completed);
  assert.deepEqual(g.pending, ["1"]);
  advance(g);
  assert.equal(g.T[1].deal, 2); assert.equal(g.T[0].deal, 1); assert.equal(g.T[2].deal, 1);
  assert.notEqual(JSON.stringify(g.hands.t1p0), before[1]);
  assert.equal(JSON.stringify(g.hands.t0p0), before[0]);       // unchanged hands are re-written as they were
  assert.equal(JSON.stringify(g.hands.t2p0), before[2]);
  assert.equal(g.T[1].streak, 1);
  assert.deepEqual(g.pending, []);
});

test("a team never gets the same device twice in a row (over a whole shuffled deck and the reshuffle)", () => {
  const g = game([2], { goal: 99 });
  let last = g.T[0].key;
  for (let i = 0; i < POOL.length * 3; i++) {
    complete(g, "0"); advance(g);
    assert.notEqual(g.T[0].key, last);
    last = g.T[0].key;
  }
});

test("the first team to the goal wins; later taps are ignored", () => {
  const g = game([2, 3]);
  for (let r = 1; r <= 3; r++) { complete(g, "0"); if (r < 3) advance(g); }
  assert.equal(g.winner, "0");
  assert.equal(g.T[0].streak, 3);
  assert.equal(complete(g, "1").ok, null);
  const s = g.scores();
  assert.equal(s[0], 3);
  assert.equal(g.publicState().win, 0);
});

test("a wrong tap sends the streak to zero and cannot be repeated; the right cards still count", () => {
  const g = game([3], { goal: 6 });
  complete(g, "0"); advance(g);
  complete(g, "0"); advance(g);
  assert.equal(g.T[0].streak, 2);
  const [u, i] = wrongOf(g, "0")[0];
  const wrong = g.tap(u, vOf(g, "0", i), "0");
  assert.equal(wrong.ok, false);
  assert.equal(g.tap(u, vOf(g, "0", i), "0").ok, null);
  assert.equal(g.T[0].streak, 0);
  assert.equal(g.T[0].resets, 1);
  assert.equal(g.res[u][i], 0);
  complete(g, "0");
  assert.equal(g.T[0].streak, 1);
  assert.equal(g.T[0].best, 2);
});

// ---- mapping a tap against the tapper's CURRENT hand ---------------------------------------------------
test("a tap carries the deal's parity: one meant for the previous deal is ignored, not mapped onto the new hand", () => {
  const g = game([2, 2]);
  const old = rightOf(g, "0");
  const oldV = old.map(([u, i]) => vOf(g, "0", i));
  const first = g.tap(old[0][0], oldV[0], "0");
  assert.equal(first.ok, true);
  g.tap(old[1][0], oldV[1], "0");
  assert.equal(g.T[0].streak, 1);
  advance(g);                                                   // team 0 has a new deal now
  // the same numbers again (a retry that arrived after the re-deal): the parity is stale
  for (let k = 0; k < old.length; k++) {
    const r = g.tap(old[k][0], oldV[k], "0");
    assert.equal(r.ok, null); assert.equal(r.stale, true);
  }
  assert.equal(g.T[0].streak, 1);
  assert.equal(g.T[0].bad, 0);                                  // and it did not count as a wrong tap on the new cards
  assert.equal(complete(g, "0").completed, true);               // the new deal's own taps work
});

test("a team's hands change only when that team advances; the other team's taps are unaffected", () => {
  const g = game([2, 2]);
  const t1 = rightOf(g, "1");
  complete(g, "0"); advance(g);                                 // team 0 moves on
  for (const [u, i] of t1) assert.equal(g.tap(u, vOf(g, "1", i), "1").ok, true);   // team 1's cards still mean what they did
  assert.equal(g.T[1].streak, 1);
});

test("two teams finishing at almost the same moment both advance in the one re-deal, and neither tap is lost", () => {
  const g = game([2, 2, 2]);
  assert.ok(complete(g, "0").completed);                        // the host locks...
  assert.ok(complete(g, "2").completed);                        // ...and team 2's tap is delivered by the final read of the taps
  assert.deepEqual(g.pending, ["0", "2"]);
  advance(g);
  assert.equal(g.T[0].deal, 2); assert.equal(g.T[2].deal, 2); assert.equal(g.T[1].deal, 1);
  assert.equal(g.T[0].streak, 1); assert.equal(g.T[2].streak, 1);
});

test("a tap for a team that has finished (waiting for its re-deal) does nothing", () => {
  const g = game([2]);
  const cards = rightOf(g, "0");
  complete(g, "0");
  const extra = wrongOf(g, "0")[0];
  if (extra) assert.equal(g.tap(extra[0], vOf(g, "0", extra[1]), "0").ok, null);
  assert.equal(g.T[0].resets, 0);
  assert.ok(cards.length === 2);
});

test("a tap from nobody, a bad index or a bad number does nothing", () => {
  const g = game([2]);
  assert.equal(g.tap("nobody", 0, "0").ok, null);
  assert.equal(g.tap("t0p0", 3, "9").ok, null);
  assert.equal(g.tap("t0p0", 9, "0").ok, null);
  assert.equal(g.tap("t0p0", -1, "0").ok, null);
});

// ---- the phone: send, and send again once the round has been reopened ---------------------------------------
test("a tap refused because the round just closed is sent again when the round reopens with a new number", async () => {
  const sent = [];
  const answers = [{ ok: false, reason: "closed" }, { ok: true }];
  const s = mode.makeSender(async (v) => { sent.push(v); return answers.shift(); });
  const r1 = await s.send(2, 5, 7);                             // card 2 of deal 5, in round 7: refused (closed)
  assert.equal(r1.ok, false);
  assert.equal(sent[0], mode.encodeTap(2, 5));
  assert.ok(s.waiting);
  assert.equal(s.view({ n: 7, open: false, d: 5 }), null);      // still closed
  assert.equal(s.view({ n: 7, open: true, d: 5 }), null);       // same round number: nothing has changed yet
  const again = await s.view({ n: 8, open: true, d: 5 });       // reopened as round 8, same deal: sent again
  assert.equal(again.ok, true);
  assert.deepEqual(sent, [mode.encodeTap(2, 5), mode.encodeTap(2, 5)]);
  assert.ok(!s.waiting);
});

test("a refused tap is dropped, not resent, when the player's own team has moved on to a new deal", async () => {
  const sent = [];
  const s = mode.makeSender(async (v) => { sent.push(v); return { ok: false, reason: "closed" }; });
  await s.send(1, 4, 3);
  assert.equal(s.view({ n: 4, open: true, d: 5 }), null);       // deal 5: the cards the tap was about are gone
  assert.ok(!s.waiting);
  assert.equal(sent.length, 1);
});

test("a tap is retried a few times at most, and an error that is not 'closed' is not retried at all", async () => {
  let calls = 0;
  const s = mode.makeSender(async () => { calls++; return { ok: false, reason: "closed" }; });
  await s.send(0, 2, 1);
  for (let n = 2; n < 12; n++) { const p = s.view({ n, open: true, d: 2 }); if (p) await p; }
  assert.equal(calls, 4);                                       // the first try and three more
  assert.ok(!s.waiting);
  let c2 = 0;
  const s2 = mode.makeSender(async () => { c2++; return { ok: false, reason: "error" }; });
  await s2.send(0, 2, 1);
  assert.ok(!s2.waiting); assert.equal(c2, 1);
});

test("the tap numbers stay inside 0-9, with the hand index in the low two bits", () => {
  for (const d of [1, 2, 3, 100]) for (const i of [0, 1, 2, 3]) {
    const v = mode.encodeTap(i, d);
    assert.ok(v >= 0 && v <= 7);
    assert.equal(v % 4, i);
    assert.equal(Math.floor(v / 4), d % 2);
  }
});

test("what is published about progress never contains a card id or key", () => {
  const g = game([2, 2]);
  const [u, i] = wrongOf(g, "0")[0];
  g.tap(u, vOf(g, "0", i), "0");
  complete(g, "0");
  const names = keysIn(stored({ state: g.publicState() }));
  for (const bad of ["key", "id", "answers"]) assert.ok(!names.has(bad));
  assert.equal(Object.keys(g.publicState().t[0].l).sort().join(), "definition,example,name");
});

test("prompt column setting: rotate cycles all three; a fixed column stays fixed", () => {
  const g = game([2], { goal: 99 });
  const kinds = new Set([g.T[0].pk]);
  for (let i = 0; i < 6; i++) { complete(g, "0"); advance(g); kinds.add(g.T[0].pk); }
  assert.equal(kinds.size, 3);
  const h = game([2], { prompt: "example", goal: 99 });
  for (let i = 0; i < 5; i++) { assert.equal(h.T[0].pk, "example"); complete(h, "0"); advance(h); }
});

// ---- the end-of-game summary hook ---------------------------------------------------------------------
test("summary: wrong taps are counted against the device asked, with what it was mixed up with", () => {
  const g = game([2], { goal: 6 });
  const key = g.T[0].key;
  const [u, i] = wrongOf(g, "0")[0];
  const mixed = g.dealt[u][i].key;
  g.tap(u, vOf(g, "0", i), "0");
  const sec = g.summary((x) => x, (t) => "ABC"[t]);
  const missed = sec.find((s) => /missed/.test(s.title));
  assert.equal(missed.rows.length, 1);
  assert.equal(missed.rows[0][0], POOL.find((d) => d.key === key).name);
  assert.equal(missed.rows[0][1], 1);
  assert.ok(missed.rows[0][3].includes(POOL.find((d) => d.key === mixed).name));
  assert.equal(sec[0].rows[0][4], 1);
});

test("summary: a clean game says so instead of showing an empty table", () => {
  const g = game([2]);
  complete(g, "0");
  const missed = g.summary((u) => u, () => "A").find((s) => /missed/.test(s.title));
  assert.ok(!missed.rows && /Nobody/.test(missed.note));
});

test("the mode exposes the hook, and host.js and MODES.md both know it", () => {
  assert.equal(typeof def.host.summary, "function");
  const host = fs.readFileSync(path.join(__dirname, "..", "live", "host.js"), "utf8");
  assert.match(host, /host\.summary\(/);
  assert.match(host, /Final standings/);
  const doc = fs.readFileSync(path.join(__dirname, "..", "live", "MODES.md"), "utf8");
  assert.match(doc, /summary\(ctx, view\)/);
  assert.match(doc, /lobbyNote/);
});

test("the settings encode into numbers and short words only (the rules accept nothing else)", () => {
  const set = Live.encodeSettings(def, Live.defaultSettings(def));
  for (const [k, v] of Object.entries(set)) assert.ok(typeof v === "number" || (typeof v === "string" && v.length <= 16), k);
  assert.equal(Live.decodeSettings(def, set).goal, 8);
});

test("the rules file is untouched by this mode: a tap is accepted only for the current round number", () => {
  const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "database.rules.json"), "utf8")).rules.games.$code.taps.$uid.$id;
  assert.match(rules.n[".validate"], /round'\)\.child\('n'\)/);
  assert.match(rules[".validate"], /\[0-9\]\{1,6\}_\[0-9\]/);       // at most ten taps (0-9) per round number
});

test("auto teams for the real class sizes (5, 6, 7 players) are sensible and never a team of one", () => {
  const expected = { 5: ["3+2"], 6: ["2+2+2", "3+3"], 7: ["3+2+2"] };
  for (const teamSize of [2, 3]) for (const n of [5, 6, 7]) {
    const seen = new Set();
    for (let k = 0; k < 300; k++) {
      const t = Live.makeTeams(uids(n), teamSize);
      const sizes = {};
      Object.values(t).forEach((x) => { sizes[x] = (sizes[x] || 0) + 1; });
      const split = Object.values(sizes).sort((a, b) => b - a);
      assert.ok(split.every((s) => s >= 2), `${n} players, size ${teamSize}: a team of one (${split})`);
      assert.ok(Math.max(...split) - Math.min(...split) <= 1, `${n} players: uneven split ${split}`);
      seen.add(split.join("+"));
    }
    for (const s of seen) assert.ok(expected[n].includes(s), `${n} players, size ${teamSize}: unexpected split ${s}`);
  }
});

test("a 3-player day still works: one team of 3, or a team of one forced in the lobby, both are dealt", () => {
  for (const sizes of [[3], [2, 1]]) {
    const g = game(sizes);
    for (const t of Object.keys(g.T)) assert.ok(rightOf(g, t).length === 2, `team of ${g.T[t].uids.length}`);
  }
});
