// idioms_mode.test.js -- "Idioms: class relay" and "Idioms: team race" (live/modes/idioms.js), with no
// browser: the data file (short cards, no notes, near pairs), dealing for 1-5 devices and for teams of 3 + 2,
// 2 + 2 and a lone team, and above all that no hand ever holds a wrong card that would also fit.
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

global.Live = require("../live/common.js");
const D = require("../live/modes/derivatives.js");
require("../live/modes/devices.js");
const R = require("../live/modes/derivrace.js");
const I = require("../live/modes/idioms.js");
const bot = require("../tools/bot_strategies/idioms.js");
const raceBot = require("../tools/bot_strategies/idiomrace.js");
const RAW = fs.readFileSync(path.join(__dirname, "..", "data", "idioms.json"), "utf8");
const DATA = JSON.parse(RAW);
const SET = DATA.sets[DATA.sets.length - 1];
const IDIOMS = SET.idioms;
const KIT = I.IDIOM_KIT;
const uids = (n, p = "u") => Array.from({ length: n }, (_, i) => p + i);
const asList = (x) => (Array.isArray(x) ? x : x ? Object.values(x) : []);
const stored = (v) => JSON.parse(JSON.stringify(v, (k, x) => (Array.isArray(x) && !x.length ? undefined : x)));
const byKey = new Map(IDIOMS.map((w) => [w.key, w]));
// every idiom a card's text could belong to, in its column
const owners = (k, t) => IDIOMS.filter((w) => w[k] === t).map((w) => w.key);
// does this card fit the prompt idiom w? its own card, or a card of an idiom near w (which would also be read as right)
const fits = (w, f) => owners(f.k, f.t).some((key) => key === w.key || (w.near || []).includes(key) || (byKey.get(key).near || []).includes(w.key));

describe("the data file", () => {
  test("every set: an id the settings can store, a class, a title, and idioms with all three cards", () => {
    assert.ok(DATA.sets.length >= 1);
    for (const s of DATA.sets) {
      assert.match(s.id, /^[A-Za-z0-9]{1,16}$/);
      assert.match(s.corpus, /^latin-[a-z]+$/);
      assert.ok(s.title);
      assert.ok(s.idioms.length >= 6);
      for (const w of s.idioms) for (const k of ["key", "latin", "literal", "english", "group"]) assert.ok(w[k], `${w.key}: ${k}`);
    }
  });
  test("the Via Latina IX–XII set: 32 idioms, each Latin card a short phrase (the book is in copyright)", () => {
    const s = DATA.sets.find((x) => x.id === "vl0912");
    assert.equal(s.corpus, "latin-iii");
    assert.equal(s.idioms.length, 32);
    for (const w of s.idioms) assert.ok(w.latin.split(/\s+/).filter((x) => x !== "…").length <= 5, w.latin);
    assert.doesNotMatch(RAW, /_note|CLOSED|translations/, "the handout's notes stay out of the public repo");
  });
  test("near pairs name real idioms and go both ways", () => {
    for (const s of DATA.sets) {
      const keys = new Set(s.idioms.map((w) => w.key));
      for (const w of s.idioms) for (const k of w.near || []) {
        assert.ok(keys.has(k), `${w.key} -> ${k}`);
        assert.ok(s.idioms.find((x) => x.key === k).near.includes(w.key), `${k} -> ${w.key}`);
      }
    }
    // the pairs the owner's brief named
    const near = (a, b) => byKey.get(a).near.includes(b);
    assert.ok(near("impetum-facere", "proelium-committere"));
    assert.ok(near("secessionem-facere", "pedem-referre"));
  });
  test("no card text appears twice in a column", () => {
    for (const k of KIT.KINDS) assert.equal(new Set(IDIOMS.map((w) => w[k])).size, IDIOMS.length, k);
  });
  test("no grammar words in anything a student sees (owner's ruling)", () => {
    const JARGON = /\b(ablative|genitive|dative|accusative|nominative|vocative|locative|participle|gerund(ive)?|subjunctive|indicative|pluperfect|imperfect|clause|case|declension|conjugation|relative pronoun)\b/i;
    for (const w of IDIOMS) for (const k of ["latin", "literal", "english", "group"]) assert.doesNotMatch(w[k], JARGON, w[k]);
    const src = fs.readFileSync(path.join(__dirname, "..", "live", "modes", "idioms.js"), "utf8");
    for (const s of src.match(/"[^"\n]*"/g)) { assert.doesNotMatch(s, JARGON, s); assert.doesNotMatch(s, /\bphones?\b/i, s); }
  });
});

describe("a wrong card never also fits", () => {
  test("mayDecoy refuses itself, near idioms (both ways) and shared text", () => {
    const w = byKey.get("impetum-facere");
    assert.equal(I.mayDecoy(w, w), false);
    assert.equal(I.mayDecoy(w, byKey.get("proelium-committere")), false);
    assert.equal(I.mayDecoy(byKey.get("proelium-committere"), w), false);
    assert.equal(I.mayDecoy(w, byKey.get("minime")), true);
    assert.equal(I.mayDecoy(w, Object.assign({}, byKey.get("minime"), { english: "attack" })), false);
  });
  for (const n of [1, 2, 3, 4, 5]) {
    test(n + " device" + (n > 1 ? "s" : "") + ", every prompt kind, many seeds: each column has exactly one card that fits", () => {
      for (let seed = 1; seed <= 40; seed++) {
        const g = D.createGame(IDIOMS, { kit: KIT, count: 0, penalty: 5, prompt: "rotate", uids: uids(n), rng: Live.rng(seed * 101 + n) });
        while (g.deal()) {
          const c = g.cur, hands = stored(g.allHands());
          const all = uids(n).flatMap((u) => asList(hands[u].cards));
          for (const k of c.cols) {
            const col = all.filter((f) => f.k === k);
            assert.ok(col.length >= 2, "a column has a wrong card to choose from");
            assert.equal(col.filter((f) => fits(c.w, f)).length, 1, `${c.w.latin} / ${k}: ${col.map((f) => f.t).join(" | ")}`);
          }
          assert.ok(!all.some((f) => f.k === c.pk), "no card of the prompt's own column");
          for (const u of uids(n)) assert.ok(asList(hands[u].cards).length <= 9, "a tap can name every card");
        }
      }
    });
  }
});

describe("the class relay", () => {
  test("five devices: the two columns are shared 3 + 2, two cards each; the sharing moves on every idiom", () => {
    const g = D.createGame(IDIOMS, { kit: KIT, count: 0, penalty: 5, prompt: "rotate", uids: uids(5), rng: Live.rng(9) });
    let prev = null;
    while (g.deal()) {
      const c = g.cur;
      assert.deepEqual(c.cols.map((k) => uids(5).filter((u) => c.holds[u].includes(k)).length).sort(), [2, 3]);
      for (const u of uids(5)) assert.equal(c.meaning[u].length, 2, u);
      const now = JSON.stringify(c.holds);
      if (prev) assert.notEqual(now, prev);
      prev = now;
    }
  });
  test("three devices: every column held; four devices: 2 + 2", () => {
    for (const n of [3, 4]) {
      const g = D.createGame(IDIOMS, { kit: KIT, count: 0, uids: uids(n), rng: Live.rng(n) });
      g.deal();
      for (const k of g.cur.cols) assert.ok(uids(n).some((u) => g.cur.holds[u].includes(k)));
      if (n === 4) assert.deepEqual(g.cur.cols.map((k) => uids(4).filter((u) => g.cur.holds[u].includes(k)).length), [2, 2]);
    }
  });
  test("a whole run: the right taps finish every idiom; the prompt rotates through all three kinds; the end screen names idioms", () => {
    const g = D.createGame(IDIOMS, { kit: KIT, count: 12, penalty: 5, prompt: "rotate", uids: uids(3), rng: Live.rng(4) });
    const kinds = new Set();
    let n = 0, t = 0;
    while (g.deal()) {
      n++; kinds.add(g.cur.pk);
      const hands = stored(g.allHands());
      let last = null;
      for (const u of uids(3)) asList(hands[u].cards).forEach((f, i) => {
        if (bot.isRight(hands[u].pk, hands[u].p, f)) last = g.tap(u, i, (t += 1000));
      });
      assert.ok(last && last.completed, g.cur.w.latin);
    }
    assert.equal(n, 12);
    assert.deepEqual([...kinds].sort(), ["english", "latin", "literal"]);
    const [sec] = g.summary();
    assert.equal(sec.title, "Each idiom, slowest first");
    assert.match(sec.note, /both cards/);
    assert.deepEqual(sec.columns.slice(0, 2), ["Latin", "Natural English"]);
    assert.equal(sec.rows.length, 12);
  });
  test("what is written for a device carries no answer", () => {
    const g = D.createGame(IDIOMS, { kit: KIT, count: 0, uids: uids(3), rng: Live.rng(2) });
    g.deal();
    for (const hand of Object.values(stored(g.allHands()))) {
      for (const f of asList(hand.cards)) assert.deepEqual(Object.keys(f).sort(), ["k", "t"]);
      assert.doesNotMatch(JSON.stringify(hand), /"ok"|"key"|near/);
    }
  });
});

describe("the team race", () => {
  function race(sizes, seed) {
    const teams = {};
    sizes.forEach((sz, t) => { teams[t] = uids(sz, "t" + t + "p"); });
    const r = R.createRace(IDIOMS, { kit: KIT, count: 12, prompt: "rotate", freeze: 5, teams, rng: Live.rng(seed) });
    r.hands = stored(r.nextRound(1000));
    return r;
  }
  const rightOf = (r, t) => r.T[t].uids.flatMap((u) => asList(r.hands[u].cards).map((f, i) => [u, i, f]).filter(([, , f]) => raceBot.isRight(r.hands[u].pk, r.hands[u].p, f)));
  for (const sizes of [[3, 2], [2, 2], [3]]) {
    test("teams of " + sizes.join(" and ") + ": the same idioms in the same order, hands of 5 or fewer, one fitting card per column", () => {
      for (let seed = 1; seed <= 15; seed++) {
        const r = race(sizes, seed);
        const seen = {};
        for (const t of r.teamIds()) seen[t] = [];
        let at = 1000, guard = 0;
        while (!r.over() && guard++ < 200) {
          const t = r.teamIds().filter((k) => r.T[k].fin === null)[seed % 2 ? 0 : r.teamIds().length - 1] || r.teamIds()[0];
          const T = r.T[t], c = T.g.cur;
          seen[t].push(c.w.key + "/" + c.pk);
          const all = T.uids.flatMap((u) => asList(r.hands[u].cards));
          for (const u of T.uids) assert.ok(asList(r.hands[u].cards).length <= 5);
          for (const k of c.cols) assert.equal(all.filter((f) => f.k === k && fits(c.w, f)).length, 1);
          let done = null;
          for (const [u, i] of rightOf(r, t)) done = r.tap(u, R.encodeTap(i, T.deal), t, (at += 500));
          assert.ok(done && done.completed);
          if (!r.over()) r.hands = stored(r.nextRound(at));
        }
        const keys = r.teamIds();
        const winner = r.winner;
        assert.equal(r.T[winner].g.log.length, 12);
        for (const t of keys) assert.deepEqual(seen[t], seen[winner].slice(0, seen[t].length), "every team the same sequence");
        const sum = r.summary(Live.teamLabel);
        assert.equal(sum[0].columns[1], "Idioms done");
        assert.match(sum[1].note, /second right card/);
      }
    });
  }
  test("the race is made of teams of about three: 5 -> 3 + 2, 4 -> 2 + 2, 3 -> one team", () => {
    const sizes = (n) => { const m = Live.makeTeams(uids(n, "p"), 3), c = {}; for (const t of Object.values(m)) c[t] = (c[t] || 0) + 1; return Object.values(c).sort((a, b) => b - a); };
    assert.deepEqual(sizes(5), [3, 2]);
    assert.deepEqual(sizes(4), [2, 2]);
    assert.deepEqual(sizes(3), [3]);
  });
});

describe("the modes", () => {
  test("both register; database.rules.json lets a game be of either", () => {
    const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "database.rules.json"), "utf8")).rules;
    for (const id of ["idioms", "idiomrace"]) {
      const def = Live.modes[id];
      assert.ok(def && def.host.nextRound && def.player.render, id);
      assert.equal(def.lateJoin, false);
      assert.equal(def.autoLock, false);
      assert.match(rules.games.$code.meta.mode[".validate"], new RegExp("\\|" + id + "[|)]"));
      const set = def.settings.find((s) => s.key === "set");
      assert.equal(set.default, "newlatiniii");
      assert.equal(set.label, "Idiom set");
      assert.deepEqual(def.settings.find((s) => s.key === "count").options, [0, 8, 12, 16]);
    }
    assert.equal(Live.modes.idioms.title, "Idioms: class relay");
    assert.equal(Live.modes.idiomrace.title, "Idioms: team race");
    assert.deepEqual(Live.modes.idiomrace.teams, { optional: false, sizes: [3], all: false });
    assert.ok(!Live.modes.idioms.teams, "the relay has no teams");
  });
  test("'Newest Latin III' picks the last Latin III set", () => {
    const opts = D.classOptions(DATA.sets);
    assert.deepEqual(opts[0], ["newlatiniii", "Newest Latin III"]);
    assert.equal(D.chooseSet(DATA.sets, "newlatiniii", "newlatiniii").id, DATA.sets.filter((s) => s.corpus === "latin-iii").pop().id);
  });
  test("the lobby notes: the race tells a class of three about the relay", () => {
    const players = (n) => uids(n, "p").map((uid) => ({ uid }));
    const race = (n) => Live.modes.idiomrace.host.lobbyNote({ teams: () => ({}) }, players(n));
    assert.match(race(3), /relay/);
    assert.doesNotMatch(race(5), /relay/);
    const relay = (n) => Live.modes.idioms.host.lobbyNote({ teams: () => ({}) }, players(n));
    assert.match(relay(5), /share/);
    assert.match(relay(2), /one of the two/);
  });
  test("the derivatives modes still read as before (the shared engine kept their words)", () => {
    assert.equal(Live.modes.derivatives.settings.find((s) => s.key === "set").label, "Word set");
    assert.equal(Live.modes.derivrace.settings.find((s) => s.key === "count").label, "Words in a run (0 = the whole set)");
  });
});
