// devices_mode.test.js -- the game rules of the devices mode (live/modes/devices.js), with no browser:
// hands carry no card ids or keys, the round object never leaves the host, a wrong tap resets, a team of
// one is playable, big teams get cards, and the end-of-game summary hook reports the missed devices.
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
  return mode.createGame(POOL, Object.assign({ goal: 3, teams, rng: Deal.seeded(7) }, extra));
}
// plays the round as a perfect team would, each team tapping all its right cards
function playRound(g, out) {
  for (const [t, us] of Object.entries(g.teams)) {
    for (const u of us) asList(out.hands[u].cards).forEach((f, i) => { if (bot.isRight(out.prompt, f)) g.tap(u, i, 0, t); });
  }
}
// one wrong tap by team t; returns the result
function blunder(g, out, t) {
  for (const u of g.teams[t]) {
    const i = asList(out.hands[u].cards).findIndex((f) => !bot.isRight(out.prompt, f));
    if (i >= 0) return Object.assign(g.tap(u, i, 0, t), { u, i });
  }
  throw new Error("no wrong card to tap");
}

test("hands written to the database hold faces only: no key, no id, no answers", () => {
  for (const size of [1, 2, 3, 6, 9]) for (let seed = 1; seed <= 60; seed++) {
    const g = mode.createGame(POOL, { goal: 3, teams: { 0: uids(size) }, rng: Deal.seeded(seed) });
    const out = g.nextRound();
    const written = stored({ round: { pk: out.kind, p: out.prompt }, hands: out.hands });
    const names = keysIn(written);
    for (const bad of ["key", "id", "answers", "decoys", "kind", "cite", "text", "lines", "en"]) assert.ok(!names.has(bad), `a written field is called ${bad}`);
    assert.ok(!JSON.stringify(written).includes("answers"));
    for (const u of uids(size)) assert.equal(asList(out.hands[u].cards).length, g.dealt[u].length);   // index -> card map is complete
  }
});

test("a line with nothing in bold still draws after the database drops its empty list", () => {
  const g = game([2]);
  let seen = 0;
  for (let i = 0; i < 40; i++) {
    const out = g.nextRound();
    for (const f of [out.prompt, ...Object.values(out.hands).flatMap((h) => asList(h.cards))]) {
      if (f.k !== "example") continue;
      for (const line of asList(stored(f).l)) { assert.equal(typeof line.t, "string"); asList(line.b); seen++; }
    }
  }
  assert.ok(seen > 0);
});

test("a team of one holds both right cards; every player of a big team (up to 9) holds a card", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const g = mode.createGame(POOL, { goal: 3, teams: { 0: ["solo"] }, rng: Deal.seeded(seed) });
    const out = g.nextRound();
    assert.equal(asList(out.hands.solo.cards).filter((f) => bot.isRight(out.prompt, f)).length, 2);
    for (const size of [6, 9]) {
      const g2 = mode.createGame(POOL, { goal: 3, teams: { 0: uids(size) }, rng: Deal.seeded(seed) });
      const o2 = g2.nextRound();
      for (const u of uids(size)) assert.ok(asList(o2.hands[u].cards).length >= 1, `size ${size} seed ${seed}: ${u} has no card`);
      const all = uids(size).flatMap((u) => asList(o2.hands[u].cards));
      assert.equal(all.filter((f) => bot.isRight(o2.prompt, f)).length, 2);
    }
  }
});

test("the two right cards of a team are on different phones (team of two or more)", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const g = mode.createGame(POOL, { goal: 3, teams: { 0: uids(3) }, rng: Deal.seeded(seed) });
    const out = g.nextRound();
    const holders = uids(3).filter((u) => asList(out.hands[u].cards).some((f) => bot.isRight(out.prompt, f)));
    assert.equal(holders.length, 2);
  }
});

test("right taps complete rounds; the first team to the goal wins", () => {
  const g = game([2, 3]);
  for (let r = 1; r <= 3; r++) { const out = g.nextRound(); playRound(g, out); if (r < 3) assert.ok(g.allDone()); }
  assert.equal(g.winner, "0");
  assert.equal(g.prog[0].streak, 3);
  const s = g.scores();
  assert.equal(s[0], 3);
  assert.equal(s.t0p0 + s.t0p1, 6);
});

test("a wrong tap sends the streak to zero and cannot be repeated; the right cards still count", () => {
  const g = game([3], { goal: 6 });
  playRound(g, g.nextRound());
  playRound(g, g.nextRound());
  assert.equal(g.prog[0].streak, 2);
  const out = g.nextRound();
  const wrong = blunder(g, out, "0");
  assert.equal(wrong.ok, false);
  assert.equal(g.tap(wrong.u, wrong.i, 0, "0").ok, null);
  assert.equal(g.prog[0].streak, 0);
  assert.equal(g.prog[0].resets, 1);
  playRound(g, out);
  assert.equal(g.prog[0].streak, 1);
  assert.equal(g.prog[0].best, 2);
  assert.equal(g.publicState().t[0].x, 1);
});

test("a tap from nobody, a bad index, or a finished team does nothing", () => {
  const g = game([2]);
  const out = g.nextRound();
  assert.equal(g.tap("nobody", 0, 0, "0").ok, null);
  assert.equal(g.tap("t0p0", 9, 0, "0").ok, null);
  assert.equal(g.tap("t0p0", 0, 0, "7").ok, null);
  playRound(g, out);
  for (const u of g.teams[0]) assert.equal(g.tap(u, 0, 0, "0").ok, null);
});

test("what is published about progress and the reveal never contains a card id or key", () => {
  const g = game([2, 2]);
  const out = g.nextRound();
  blunder(g, out, "0");
  playRound(g, out);
  const names = keysIn(stored({ state: g.publicState(), reveal: g.revealData() }));
  for (const bad of ["key", "id", "answers"]) assert.ok(!names.has(bad));
  assert.equal(Object.keys(g.revealData().cards).sort().join(), "definition,example,name");
});

test("the same device is asked of every team, with different cards", () => {
  const g = game([2, 2, 2]);
  const out = g.nextRound();
  assert.equal(new Set(Object.values(g.rounds).map((r) => r.id)).size, 1);
  assert.equal(Object.keys(g.rounds).length, 3);
  assert.equal(out.prompt.k, out.kind);
});

test("prompt column setting: rotate cycles all three; a fixed column stays fixed", () => {
  const g = game([2]);
  assert.equal(new Set(Array.from({ length: 6 }, () => g.nextRound().kind)).size, 3);
  const h = game([2], { prompt: "example" });
  for (let i = 0; i < 5; i++) assert.equal(h.nextRound().kind, "example");
});

// ---- the end-of-game summary hook ---------------------------------------------------------------------
test("summary: wrong taps are counted against the device asked, with what it was mixed up with", () => {
  const g = game([2], { goal: 6 });
  const out = g.nextRound();
  const key = g.current.key;
  const w = blunder(g, out, "0");
  const mixed = g.dealt[w.u][w.i].key;
  const sec = g.summary((u) => u, (t) => "ABC"[t]);
  const missed = sec.find((s) => /missed/.test(s.title));
  assert.equal(missed.rows.length, 1);
  assert.equal(missed.rows[0][0], POOL.find((d) => d.key === key).name);
  assert.equal(missed.rows[0][1], 1);
  assert.ok(missed.rows[0][3].includes(POOL.find((d) => d.key === mixed).name));
  assert.equal(sec[0].rows[0][4], 1);
});

test("summary: a clean game says so instead of showing an empty table", () => {
  const g = game([2]);
  playRound(g, g.nextRound());
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
