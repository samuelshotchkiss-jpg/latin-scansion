// derivrace_mode.test.js -- the rules of "Derivatives: team race" (live/modes/derivrace.js), with no browser:
// whole games for every team split, the same words for every team, hands of at most 5 cards, stale taps,
// the freeze, the winner; plus the two fixes shared with the class relay (decoys, "Newest" per class).
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

global.Live = require("../live/common.js");
const D = require("../live/modes/derivatives.js");
const R = require("../live/modes/derivrace.js");
const bot = require("../tools/bot_strategies/derivrace.js");          // its own reading of the data: the oracle
const DATA = require("../data/derivatives.json");
const SET = (id) => DATA.sets.find((s) => s.id === id);
const asList = (x) => (Array.isArray(x) ? x : x ? Object.values(x) : []);
const stored = (v) => JSON.parse(JSON.stringify(v, (k, x) => (Array.isArray(x) && !x.length ? undefined : x)));   // what the database keeps
const uids = (n, p) => Array.from({ length: n }, (_, i) => p + i);

function race(sizes, extra) {
  const teams = {};
  sizes.forEach((sz, t) => { teams[t] = uids(sz, "t" + t + "p"); });
  const r = R.createRace(SET("i04").words, Object.assign({ count: 0, prompt: "rotate", freeze: 5, teams, rng: Live.rng(Number(sizes.join("")) + 3) }, extra));
  r.hands = stored(r.nextRound(1000));
  return r;
}
const vOf = (r, team, i) => R.encodeTap(i, r.T[team].deal);
const pairs = (r, team, wantRight) => r.T[team].uids.flatMap((u) => asList(r.hands[u].cards)
  .map((f, i) => [u, i, f]).filter(([, , f]) => bot.isRight(r.hands[u].p, f) === wantRight).map(([uu, i]) => [uu, i]));
const redeal = (r, now) => { r.hands = stored(r.nextRound(now)); };
// the right cards need the prompt's KIND too (isRight takes it first)
const isRight = (r, u, f) => bot.isRight(r.hands[u].pk, r.hands[u].p, f);
const pairsOf = (r, team, wantRight) => r.T[team].uids.flatMap((u) => asList(r.hands[u].cards)
  .map((f, i) => [u, i, f]).filter(([, , f]) => isRight(r, u, f) === wantRight).map(([uu, i]) => [uu, i]));

// Plays a whole race. `speed[t]` = ms a word takes team t; `slips[t]` = a wrong card on every nth word.
// Returns the (kind, prompt) each team was shown, word by word.
function play(r, speed, slips = {}) {
  const clock = {}, seen = {};
  const shown = (t) => { const u = r.T[t].uids[0]; return [r.hands[u].pk, r.hands[u].p]; };
  for (const t of r.teamIds()) { clock[t] = 1000; seen[t] = [shown(t)]; }
  let guard = 0;
  while (!r.over() && guard++ < 500) {
    const t = r.teamIds().filter((k) => r.T[k].fin === null).sort((a, b) => clock[a] - clock[b])[0];
    const T = r.T[t];
    assert.ok(T.uids.every((u) => asList(r.hands[u].cards).length <= 5), "a hand holds at most 5 cards");
    if (slips[t] && (T.g.i + 1) % slips[t] === 0) {
      const [u, i] = pairsOf(r, t, false)[0];
      assert.equal(r.tap(u, vOf(r, t, i), t, clock[t] + 10).ok, false);
      clock[t] += r.freeze * 1000;
    }
    let at = clock[t] + speed[t], done = null;
    for (const [u, i] of pairsOf(r, t, true)) done = r.tap(u, vOf(r, t, i), t, at += 5);
    assert.ok(done.completed);
    clock[t] = at;
    if (!r.over()) { redeal(r, at); seen[t].push(shown(t)); }
  }
  return { seen, clock };
}

describe("a whole game, for every split of the class", () => {
  for (const sizes of [[4, 4], [4, 3], [3, 3], [3, 2], [4]]) {
    test("teams of " + sizes.join(" and ") + ": both see the same words, the faster team wins, hands stay small", () => {
      const r = race(sizes);
      const { seen } = play(r, { 0: 4000, 1: 6000 });
      assert.equal(r.winner, "0");
      assert.equal(r.T[0].g.log.length, 13);
      assert.notEqual(r.T[0].fin, null);
      assert.equal(seen[0].length, 13);
      assert.equal(new Set(r.T[0].g.order.map((w) => w.key)).size, 13, "every word once");
      assert.deepEqual(r.T[0].g.order, r.plan.steps.map((s) => s.w), "the plan is the order");
      if (sizes.length > 1) {
        assert.equal(r.T[1].fin, null, "the other team has not finished");
        assert.ok(seen[1].length > 1 && seen[1].length < 13);
        assert.deepEqual(seen[1], seen[0].slice(0, seen[1].length), "the same words and prompt cards, in the same order");
      }
    });
  }
  test("a team that slips is frozen but still sees the same sequence", () => {
    const r = race([4, 4]);
    const { seen } = play(r, { 0: 5000, 1: 3000 }, { 1: 3 });
    const n = Math.min(seen[0].length, seen[1].length);
    assert.deepEqual(seen[0].slice(0, n), seen[1].slice(0, n));
    assert.ok(r.T[1].wrongs > 0);
  });
});

describe("hands", () => {
  test("hand sizes by team size: 4 players split a column 2+2, 3 hold 4 each, 2 hold 5 (3+2) and 4, never over 5", () => {
    for (const [n, want] of [[4, [2, 2, 4, 4]], [3, [4, 4, 4]], [2, [4, 5]]]) {
      const r = race([n]);
      for (let w = 0; w < 13; w++) {
        const sizes = r.T[0].uids.map((u) => asList(r.hands[u].cards).length).sort();
        assert.deepEqual(sizes, want.slice().sort(), n + " players, word " + w);
        for (const u of r.T[0].uids) {
          const cards = asList(r.hands[u].cards);
          assert.ok(cards.length <= 5);
          assert.equal(new Set(cards.map((c) => c.t)).size, cards.length);
        }
        for (const [u, i] of pairsOf(r, "0", true)) r.tap(u, vOf(r, "0", i), "0", 2000 + w * 100);
        if (r.over()) break;
        redeal(r, 2000 + w * 100);
      }
    }
  });
  test("every column has exactly one right card, and a hand shows no answer or key", () => {
    const r = race([4, 3]);
    for (const t of ["0", "1"]) {
      assert.equal(pairsOf(r, t, true).length, 3);
      for (const u of r.T[t].uids) {
        const hand = r.hands[u];
        assert.deepEqual(Object.keys(hand).filter((k) => !["i", "of", "pk", "p", "mine", "cards", "d", "res"].includes(k)), []);
        for (const c of asList(hand.cards)) assert.deepEqual(Object.keys(c).sort(), ["k", "t"]);
      }
    }
    assert.ok(!/"ok"/.test(JSON.stringify(r.publicState())));
  });
});

describe("taps", () => {
  test("a tap meant for the previous deal (the other parity) is ignored; the new deal's parity works", () => {
    const r = race([3, 3]);
    const old = pairsOf(r, "0", true).map(([u, i]) => [u, i, vOf(r, "0", i)]);
    for (const [u, , v] of old) r.tap(u, v, "0", 3000);
    assert.deepEqual(r.pending, ["0"]);
    redeal(r, 3000);
    const [u, , v] = old[0];
    const stale = r.tap(u, v, "0", 3100);
    assert.equal(stale.ok, null);
    assert.equal(stale.stale, true);
    assert.equal(r.T[0].wrongs, 0);
    const mine = pairsOf(r, "0", true).find((p) => p[0] === u);
    assert.ok(!mine || r.tap(u, vOf(r, "0", mine[1]), "0", 3200).ok === true);
    // the other team never changed deal: its own parity still works
    const [u1, i1] = pairsOf(r, "1", true)[0];
    assert.equal(r.tap(u1, vOf(r, "1", i1), "1", 3300).ok, true);
  });
  test("taps outside 0-9, from strangers, or repeated do nothing", () => {
    const r = race([3, 3]);
    const [u, i] = pairsOf(r, "0", true)[0];
    assert.equal(r.tap(u, -1, "0", 2000).ok, null);
    assert.equal(r.tap(u, 10, "0", 2000).ok, null);
    assert.equal(r.tap(u, 1.5, "0", 2000).ok, null);
    assert.equal(r.tap("t1p0", vOf(r, "0", 0), "0", 2000).ok, null);
    assert.equal(r.tap(u, vOf(r, "0", i), "0", 2000).ok, true);
    assert.equal(r.tap(u, vOf(r, "0", i), "0", 2100).ok, null, "the same card twice");
  });
});

describe("the freeze", () => {
  test("a wrong card freezes the whole team: taps are ignored (not tried, not wrong) until it ends; the other team is free", () => {
    const r = race([3, 3], { freeze: 5 });
    const [wu, wi] = pairsOf(r, "0", false)[0];
    assert.equal(r.tap(wu, vOf(r, "0", wi), "0", 10000).ok, false);
    assert.equal(r.T[0].frozenUntil, 15000);
    assert.equal(r.frozen("0", 12000), true);
    assert.equal(r.frozen("1", 12000), false);
    const [ru, ri] = pairsOf(r, "0", true)[0];
    const during = r.tap(ru, vOf(r, "0", ri), "0", 14999);
    assert.equal(during.ok, null);
    assert.equal(during.frozen, true);
    assert.equal(r.T[0].wrongs, 1, "no second wrong card");
    assert.equal(r.T[0].res[ru][ri], undefined, "the card was not tried");
    assert.equal(r.tap(ru, vOf(r, "0", ri), "0", 15000).ok, true, "the same card works once the freeze is over");
    const [u1, i1] = pairsOf(r, "1", true)[0];
    assert.equal(r.tap(u1, vOf(r, "1", i1), "1", 11000).ok, true, "the other team plays on");
    assert.equal(r.publicState().t[0].fz, 15000);
  });
  test("a freeze of 0 seconds freezes nobody", () => {
    const r = race([3], { freeze: 0 });
    const [wu, wi] = pairsOf(r, "0", false)[0];
    r.tap(wu, vOf(r, "0", wi), "0", 5000);
    const [ru, ri] = pairsOf(r, "0", true)[0];
    assert.equal(r.tap(ru, vOf(r, "0", ri), "0", 5001).ok, true);
    assert.equal(r.publicState().t[0].fz, undefined);
  });
  test("a wrong card stays marked in the hand when the other team's re-deal rewrites every hand", () => {
    const r = race([3, 3]);
    const [wu, wi] = pairsOf(r, "0", false)[0];
    r.tap(wu, vOf(r, "0", wi), "0", 5000);
    for (const [u, i] of pairsOf(r, "1", true)) r.tap(u, vOf(r, "1", i), "1", 6000);
    redeal(r, 6000);
    assert.equal(r.hands[wu].res[wi], 0);
    assert.equal(r.hands[wu].d, 1);
    assert.equal(r.T[1].deal, 2);
  });
});

describe("the winner", () => {
  test("the first team to finish its last word wins; later taps are ignored; the game is over", () => {
    const r = race([3, 3], { count: 6 });
    const { clock } = play(r, { 0: 3000, 1: 2000 });
    assert.equal(r.winner, "1");
    assert.equal(r.over(), true);
    assert.equal(r.publicState().win, 1);
    assert.equal(r.T[1].g.log.length, 6);
    const [u, i] = pairsOf(r, "0", true)[0] || [r.T[0].uids[0], 0];
    assert.equal(r.tap(u, vOf(r, "0", i), "0", clock[0] + 1).ok, null);
  });
  test("a lone team wins by finishing", () => {
    const r = race([4], { count: 6 });
    play(r, { 0: 2500 });
    assert.equal(r.winner, "0");
    assert.equal(r.summary(Live.teamLabel)[0].title, "How the team did");
  });
});

describe("the end screen", () => {
  test("per team: time and wrong cards; then each team's words slowest first; then the words with most wrong cards", () => {
    const r = race([4, 3], { count: 6 });
    play(r, { 0: 3000, 1: 5000 }, { 0: 2, 1: 2 });
    const sec = r.summary(Live.teamLabel);
    assert.equal(sec.length, 4);
    assert.deepEqual(sec[0].columns, ["Team", "Words done", "Time to finish", "Wrong cards"]);
    assert.equal(sec[0].rows.length, 2);
    assert.match(sec[0].rows[0][2], /^\d+:\d\d\.\d$/);
    assert.match(sec[1].title, /^Team A: each word, slowest first/);
    const secs = sec[1].rows.map((x) => Number(x[3]));
    assert.deepEqual(secs, secs.slice().sort((a, b) => b - a));
    assert.equal(sec[3].title, "Words with the most wrong cards");
    assert.ok(sec[3].rows.length >= 1);
    assert.ok(sec[3].rows.reduce((n, x) => n + x[2], 0) <= r.T[0].wrongs + r.T[1].wrongs);
  });
});

describe("a decoy is never a second right answer (shared with the class relay)", () => {
  const dom = SET("i04").words.find((w) => w.key === "domi");
  const domus = SET("i04").words.find((w) => w.key === "domus");
  test("domī and domus share 'domestic': mayDecoy refuses them both ways", () => {
    assert.equal(D.mayDecoy(dom, domus), false);
    assert.equal(D.mayDecoy(domus, dom), false);
    assert.equal(D.mayDecoy(dom, dom), false);
  });
  test("with 'domestic' as the prompt, no seed puts a card of domus in any hand", () => {
    const domestic = dom.derivs.find((d) => d.w === "domestic");
    const bad = new Set([domus.latin, domus.def, ...domus.derivs.flatMap((d) => [d.w, d.d])]);
    const words = SET("i04").words;
    for (let seed = 1; seed <= 150; seed++) {
      for (const n of [1, 2, 3, 4]) {
        const plan = { steps: [{ w: dom, d: domestic, pk: "deriv" }], usable: words };
        const g = D.createGame(words, { uids: uids(n, "p"), rng: Live.rng(seed), plan, penalty: 0, maxHand: 5 });
        g.deal();
        for (const u of g.uids) for (const c of g.cur.meaning[u]) {
          if (c.ok) continue;
          assert.ok(!bad.has(c.t), "seed " + seed + ": " + c.t);
          assert.ok(!bot.isRight("deriv", "domestic", c), "seed " + seed + ": " + c.t + " also fits domestic");
        }
      }
    }
  });
  test("the class relay (no maxHand) obeys the same rule", () => {
    const domestic = dom.derivs.find((d) => d.w === "domestic");
    const words = SET("i04").words;
    for (let seed = 1; seed <= 100; seed++) {
      const g = D.createGame(words, { uids: uids(3, "p"), rng: Live.rng(seed), plan: { steps: [{ w: dom, d: domestic, pk: "deriv" }], usable: words }, penalty: 5 });
      g.deal();
      for (const u of g.uids) for (const c of g.cur.meaning[u]) if (!c.ok) assert.ok(!bot.isRight("deriv", "domestic", c), c.t);
    }
  });
  test("in whole races, every word has exactly three right cards for every seed", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const r = race([4, 4], { rng: Live.rng(seed), prompt: seed % 2 ? "rotate" : "deriv" });
      for (let w = 0; w < 13 && !r.over(); w++) {
        for (const t of ["0", "1"]) assert.equal(pairsOf(r, t, true).length, 3, "seed " + seed + " word " + w);
        for (const t of ["0", "1"]) for (const [u, i] of pairsOf(r, t, true)) r.tap(u, vOf(r, t, i), t, 2000 + w);
        if (!r.over()) redeal(r, 2000 + w);
      }
    }
  });
});

describe("\"Newest\" is per class (shared with the class relay)", () => {
  test("one 'Newest <class>' per class in the file, then every set by title", () => {
    const opts = D.classOptions(DATA.sets);
    assert.deepEqual(opts.slice(0, 2), [["newlatinii", "Newest Latin II"], ["newlatini", "Newest Latin I"]]);
    assert.deepEqual(opts.slice(2).map((o) => o[0]).sort(), DATA.sets.map((s) => s.id).sort());
    for (const [v] of opts) assert.match(v, /^[A-Za-z0-9]{1,16}$/);
  });
  test("'newest' is the LAST set of that class in the file; a set id picks that set", () => {
    const sets = [{ id: "a", corpus: "latin-i", title: "A" }, { id: "b", corpus: "latin-ii", title: "B" }, { id: "c", corpus: "latin-i", title: "C" }, { id: "d", corpus: "latin-ii", title: "D" }, { id: "e", corpus: "latin-iii", title: "E" }];
    assert.equal(D.chooseSet(sets, "newlatini").id, "c");
    assert.equal(D.chooseSet(sets, "newlatinii").id, "d");
    assert.equal(D.chooseSet(sets, "newlatiniii").id, "e");
    assert.equal(D.chooseSet(sets, "b").id, "b");
    assert.equal(D.chooseSet(sets, "gone", "newlatinii").id, "d");
    assert.deepEqual(D.classOptions(sets).slice(0, 3).map((o) => o[1]), ["Newest Latin I", "Newest Latin II", "Newest Latin III"]);
    assert.equal(D.chooseSet(DATA.sets, "newlatinii").id, "ii04");
    assert.equal(D.chooseSet(DATA.sets, "newlatini").id, "i0304");
  });
  test("the relay defaults to the newest Latin II, the race to the newest Latin I; loading the file fills both", async () => {
    const relay = Live.modes.derivatives, rc = Live.modes.derivrace;
    assert.equal(relay.settings.find((s) => s.key === "set").default, "newlatinii");
    assert.equal(rc.settings.find((s) => s.key === "set").default, "newlatini");
    global.fetch = async () => ({ ok: true, json: async () => DATA });
    await Live.Deriv.loadData();
    for (const m of [relay, rc]) {
      const set = m.settings.find((s) => s.key === "set");
      assert.deepEqual(set.options.map((o) => o[0]).slice(0, 2), ["newlatinii", "newlatini"]);
      assert.ok(set.options.some((o) => o[0] === set.default));
      assert.equal(Live.decodeSettings(m, Live.encodeSettings(m, { set: "newlatini" })).set, "newlatini");
    }
  });
});

describe("the mode", () => {
  const def = () => Live.modes.derivrace;
  test("registers with teams of 4 required, no late joiners, no standings", () => {
    assert.ok(def());
    assert.deepEqual(def().teams, { optional: false, sizes: [4], all: false });
    assert.equal(def().lateJoin, false);
    assert.equal(def().autoLock, false);
    assert.equal(def().noStandings, true);
    assert.equal(def().title, "Derivatives: team race");
    const s = (k) => def().settings.find((x) => x.key === k);
    assert.deepEqual(s("freeze").options, [0, 3, 5, 8]);
    assert.equal(s("freeze").default, 5);
    assert.deepEqual(s("count").options, [0, 6, 10, 15]);
  });
  test("Live.makeTeams with size 4 gives 4+4, 4+3, 3+3, 3+2 and one team for 4 or fewer", () => {
    const sizes = (n) => { const m = Live.makeTeams(uids(n, "p"), 4), c = {}; for (const t of Object.values(m)) c[t] = (c[t] || 0) + 1; return Object.values(c).sort((a, b) => b - a); };
    assert.deepEqual(sizes(8), [4, 4]);
    assert.deepEqual(sizes(7), [4, 3]);
    assert.deepEqual(sizes(6), [3, 3]);
    assert.deepEqual(sizes(5), [3, 2]);
    assert.deepEqual(sizes(4), [4]);
    assert.deepEqual(sizes(3), [3]);
  });
  test("the lobby note: a small class is told about the relay; a team of two is told about two columns", () => {
    const players = (n) => uids(n, "p").map((uid) => ({ uid }));
    const note = (n) => def().host.lobbyNote({ teams: () => ({}) }, players(n));
    assert.match(note(3), /one team/);
    assert.match(note(3), /relay/);
    assert.match(note(5), /two columns/);
    assert.doesNotMatch(note(8), /two columns|relay/);
    assert.doesNotMatch(note(8), /phone/i);
  });
  test("the file never says 'phone' in a string a student could read", () => {
    const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "live", "modes", "derivrace.js"), "utf8");
    for (const s of src.match(/"[^"\n]*"/g)) assert.doesNotMatch(s, /\bphones?\b/i, s);
  });
  test("the bot strategy taps with the deal parity", async () => {
    const r = race([3]);
    const [u, i] = pairsOf(r, "0", true)[0];
    const h = r.hands[u];
    const sent = [];
    process.env.DELAY_SCALE = "0";
    await bot.run({ round: { n: 1 }, hand: () => Object.assign({ n: 1 }, h), rng: () => 0.99, tap: async (v) => { sent.push(v); return false; } });
    assert.deepEqual(sent, [i + 5 * (h.d % 2)]);
  });
});
