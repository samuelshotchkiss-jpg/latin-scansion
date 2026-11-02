// derivatives_mode.test.js -- the game rules of the derivatives mode (live/modes/derivatives.js), with no
// browser: who holds which column, what a hand holds, grading, the clock, and the shipped data file.
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const M = require("../live/modes/derivatives.js");
const Live = require("../live/common.js");
const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "derivatives.json"), "utf8"));
const WORDS = DATA.sets[DATA.sets.length - 1].words;
const uids = (n) => Array.from({ length: n }, (_, i) => "u" + i);
const game = (n, extra) => M.createGame(WORDS, Object.assign({ count: 0, penalty: 5, prompt: "rotate", uids: uids(n), rng: Live.rng(n * 31 + 7) }, extra));

// the right card's index in a player's hand, read from the host-only meaning
const rightOf = (g, uid) => (g.cur.meaning[uid] || []).map((c, i) => (c.ok ? i : -1)).filter((i) => i >= 0);

describe("the data file", () => {
  test("every set has an id the settings can store, a title, and words with all four cards", () => {
    assert.ok(DATA.sets.length >= 1);
    for (const s of DATA.sets) {
      assert.match(s.id, /^[A-Za-z0-9]{1,16}$/);
      assert.ok(s.title && s.words.length >= 4);
      for (const w of s.words) {
        assert.ok(w.key && w.latin && w.def && w.derivs.length, w.key);
        for (const d of w.derivs) assert.ok(d.w && d.d, w.key);
      }
    }
  });
  test("no English definition contains its own derivative", () => {
    for (const s of DATA.sets) for (const w of s.words) for (const d of w.derivs) {
      assert.ok(!d.d.toLowerCase().includes(d.w.toLowerCase().replace(/\.$/, "")), d.w);
    }
  });
});

describe("dealing", () => {
  test("three players: each holds exactly one of the three answer columns, and the columns move on every word", () => {
    const g = game(3);
    let prev = null;
    while (g.deal()) {
      const c = g.cur;
      assert.equal(c.cols.length, 3);
      assert.ok(!c.cols.includes(c.pk));
      const held = uids(3).map((u) => c.holds[u]);
      assert.ok(held.every((h) => h.length === 1));
      assert.deepEqual(held.flat().sort(), c.cols.slice().sort());
      for (const u of uids(3)) {
        const hand = c.meaning[u];
        assert.ok(hand.every((x) => x.k === c.holds[u][0]), "a hand holds only its own column");
        assert.equal(hand.filter((x) => x.ok).length, 1, "exactly one right card per column");
        assert.equal(new Set(hand.map((x) => x.t)).size, hand.length, "no card twice");
      }
      if (prev && prev.pk === c.pk) assert.notDeepEqual(held, prev);
      prev = held;
    }
    assert.equal(g.over, true);
  });
  test("one, two, four and seven players: every column is held, and no hand is bigger than a tap can name", () => {
    for (const n of [1, 2, 4, 7]) {
      const g = game(n);
      while (g.deal()) {
        const c = g.cur;
        for (const k of c.cols) assert.ok(uids(n).some((u) => c.holds[u].includes(k)), `n=${n} column ${k}`);
        for (const u of uids(n)) assert.ok(c.meaning[u].length <= 10, `n=${n}: ${c.meaning[u].length} cards`);
        const right = uids(n).flatMap((u) => c.meaning[u].filter((x) => x.ok).map((x) => x.k));
        assert.deepEqual(right.sort(), c.cols.slice().sort());
      }
    }
  });
  test("a right card is the prompt's own word; a decoy never is", () => {
    const g = game(3);
    while (g.deal()) {
      const c = g.cur;
      for (const u of uids(3)) for (const x of c.meaning[u]) {
        assert.equal(x.ok === true, x.t === c.row[x.k], x.t);
      }
    }
  });
  test("a run of 6 asks 6 different words; the prompt rotates through all four kinds", () => {
    const g = game(3, { count: 6 });
    const seen = [], kinds = new Set();
    while (g.deal()) { seen.push(g.cur.w.key); kinds.add(g.cur.pk); }
    assert.equal(seen.length, 6);
    assert.equal(new Set(seen).size, 6);
    assert.equal(kinds.size, 4);
  });
  test("what is written for a device carries no answer", () => {
    const g = game(3);
    g.deal();
    for (const u of uids(3)) {
      const hand = g.handFor(u);
      assert.ok(hand.cards.every((x) => Object.keys(x).sort().join() === "k,t"));
      assert.equal(hand.p, g.cur.row[g.cur.pk]);
    }
  });
});

describe("playing", () => {
  test("the three right taps finish a word; a wrong one adds the penalty to the clock", () => {
    const g = game(3);
    g.deal();
    const [a, b, c] = uids(3);
    const wrong = g.cur.meaning[a].findIndex((x) => !x.ok);
    assert.equal(g.tap(a, wrong, 1000).ok, false);
    assert.equal(g.tap(a, wrong, 1100).ok, null, "the same card twice is ignored");
    assert.equal(g.tap(a, rightOf(g, a)[0], 2000).completed, false);
    assert.equal(g.tap(b, rightOf(g, b)[0], 3000).completed, false);
    const r = g.tap(c, rightOf(g, c)[0], 4000);
    assert.equal(r.completed, true);
    assert.equal(g.total(0), 4000 + 5000);
    assert.equal(g.tap(a, 0, 5000).ok, null, "a finished word takes no more taps");
    assert.equal(g.publicState().row.latin, g.cur.w.latin);
  });
  test("a whole game: every word solved, the clock is the sum of the solve times plus the penalties", () => {
    const g = game(3, { penalty: 10 });
    let sum = 0, words = 0;
    while (g.deal()) {
      words++;
      let t = 0;
      const first = g.cur.meaning.u0.findIndex((x) => !x.ok);
      if (first >= 0 && words % 3 === 0) g.tap("u0", first, (t += 500));
      for (const u of uids(3)) for (const i of rightOf(g, u)) g.tap(u, i, (t += 700));
      sum += t;
    }
    assert.equal(g.log.length, words);
    assert.equal(g.total(0), sum + g.wrongs * 10000);
    assert.equal(g.summary()[0].rows.length, words);
  });
  test("the clock reads minutes, seconds and tenths", () => {
    assert.equal(M.clockText(0), "0:00.0");
    assert.equal(M.clockText(9940), "0:09.9");
    assert.equal(M.clockText(83450), "1:23.5");
  });
});

describe("the mode registers", () => {
  test("with the shell, and database.rules.json lets a game be of this mode", () => {
    global.Live = Live;
    delete require.cache[require.resolve("../live/modes/derivatives.js")];
    require("../live/modes/derivatives.js");
    const def = Live.modes.derivatives;
    assert.ok(def && def.host.nextRound && def.player.render);
    assert.equal(def.autoLock, false);
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "database.rules.json"), "utf8")).rules;
    assert.match(rules.games.$code.meta.mode[".validate"], /derivatives/);
  });
});
