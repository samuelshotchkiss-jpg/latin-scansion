// live_pure.test.js -- the parts of the live game that need no browser and no database:
// the codename lists, team making, settings encoding, game codes, the mode registry, and the
// agreement between the code and database.rules.json (the rules hard-code the same limits).
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Names = require("../live/names.js");
const Live = require("../live/common.js");
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "database.rules.json"), "utf8")).rules;
const game = rules.games.$code;

describe("codenames", () => {
  test("there are 24 adjectives x 40 nouns = 960 names, all different", () => {
    assert.equal(Names.ADJECTIVES.length, 24);
    assert.equal(Names.NOUNS.length, 40);
    assert.equal(Names.NAME_COUNT, 960);
    const all = new Set();
    for (let i = 0; i < Names.NAME_COUNT; i++) all.add(Names.nameFor(i));
    assert.equal(all.size, 960);
  });
  test("every noun has a gender and every adjective has three non-empty forms", () => {
    for (const [word, g, en] of Names.NOUNS) { assert.match(g, /^[mfn]$/, word); assert.ok(word && en); }
    for (const a of Names.ADJECTIVES) { assert.equal(a.length, 4); assert.ok(a.every(Boolean)); }
  });
  test("each phrase agrees: the adjective's form is the one for the noun's gender", () => {
    for (let i = 0; i < Names.NAME_COUNT; i++) {
      const p = Names.parts(i);
      const col = { m: 0, f: 1, n: 2 }[p.noun[1]];
      assert.equal(p.latin, p.noun[0] + " " + p.adj[col]);
    }
    assert.equal(Names.nameFor(Names.NOUNS.findIndex((n) => n[0] === "Vulpēs")), "Vulpēs Callida");
    assert.equal(Names.nameFor(Names.NOUNS.findIndex((n) => n[0] === "Lupus") + 24 * 0 + Names.NOUNS.length * 1), "Lupus Audāx");
  });
  test("only the letters of Latin and the five macron vowels appear; every capital starts a word", () => {
    for (const w of [...Names.NOUNS.map((n) => n[0]), ...Names.ADJECTIVES.flatMap((a) => a.slice(0, 3))]) {
      assert.match(w, /^[A-ZĀĒĪŌŪ][a-zāēīōū]+$/, w);
    }
  });
  test("no codename word is an English first name or on the teasing list", () => {
    const banned = ["clara", "clarus", "luna", "stella", "rosa", "felix", "aurora", "gemma", "mira", "lucia", "candida", "hilary", "lupa", "anus", "porcus", "sus", "asinus", "mentula", "cunīculus", "simia"];
    const words = [...Names.NOUNS.map((n) => n[0]), ...Names.ADJECTIVES.flatMap((a) => a.slice(0, 3))].map((w) => w.toLowerCase());
    for (const b of banned) assert.ok(!words.includes(b), b);
  });
  test("a number outside the list gets a placeholder, never a crash", () => {
    for (const bad of [-1, 960, 1.5, "5", null, undefined, NaN]) assert.equal(Names.nameFor(bad), "—");
  });
  test("the rules refuse exactly the numbers the list cannot show (0 .. NAME_COUNT-1)", () => {
    const re = new RegExp(/\.matches\(\/(.*?)\/\)/.exec(game.claims.$idx[".write"])[1]);
    for (let i = 0; i < Names.NAME_COUNT; i++) assert.ok(re.test(String(i)), "claim " + i + " must be allowed");
    for (const bad of ["960", "999", "1000", "-1", "05", "a", ""]) assert.ok(!re.test(bad), "claim " + bad + " must be refused");
    assert.match(game.players.$uid.n[".validate"], new RegExp("<= " + (Names.NAME_COUNT - 1) + " "));
  });
});

describe("a game whose teacher has gone", () => {
  test("is gone after a minute of silence from the teacher's page, and not before", () => {
    const t = 1e12;
    assert.equal(Live.isGone({ phase: "lobby", beat: t - 61000, live: false }, t), true);
    assert.equal(Live.isGone({ phase: "play", beat: t - 61000, live: true }, t), true);   // a beat that stopped, whatever live says
    assert.equal(Live.isGone({ phase: "play", beat: t - 30000, live: false }, t), false); // a dropped connection: it may come back
    assert.equal(Live.isGone({ phase: "lobby", beat: t - 5000, live: true }, t), false);
    assert.equal(Live.isGone({ phase: "done", beat: t - 600000 }, t), false);             // finished: shown as ended anyway
    assert.equal(Live.isGone(null, t), false);
  });
  test("the teacher's page sweeps gone games on opening, and the join page and the bots refuse them", () => {
    const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
    assert.match(src("live/host.js"), /Net\.sweepGone\(\)/);
    assert.match(src("live/player.js"), /Live\.isGone\(meta, Net\.now\(\)\)/);
    assert.match(src("tools/bots.js"), /Live\.isGone\(meta,/);
    assert.doesNotMatch(src("live/host.js"), /"Delete"\)/);
  });
});

describe("play again", () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
  test("wipes the last game but keeps the players, and a team game goes back to the lobby", () => {
    const host = src("live/host.js");
    const body = /async function playAgain\(\) \{([\s\S]*?)\r?\n  \}\r?\n/.exec(host)[1];
    for (const k of ["round", "reveal", "score", "state", "hands", "taps"]) assert.match(body, new RegExp("\\b" + k + ": null"), k);
    assert.doesNotMatch(body, /players: null|claims: null/);
    assert.match(body, /teamsOn \? "lobby" : "play"/);
    assert.match(body, /buildCtx\(\)/);                                       // a fresh mem for the mode
  });
  test("the round number counts on, and every screen shows the game's own question number", () => {
    assert.match(src("live/host.js"), /q: n - S\.base/);
    for (const f of ["live/modes/meter.js", "live/modes/poll.js"]) assert.doesNotMatch(src(f), /"Question " \+ r\.n/, f);
  });
  test("a player who joined after the teams were made is put in a team at Start", () => {
    assert.match(src("live/host.js"), /if \(!Number\.isInteger\(t\[u\]\)\) \{ t\[u\] = Live\.smallestTeam\(t\)/);
  });
});

describe("game codes", () => {
  test("the code alphabet and shape are the rules' (consonants only, four of them)", () => {
    assert.match(game[".write"], new RegExp("\\[" + Live.CODE_LETTERS + "\\]\\{4\\}"));
    assert.ok(!/[AEIOUY]/.test(Live.CODE_LETTERS));
  });
  test("cleanCode keeps a valid code and turns everything else into null", () => {
    assert.equal(Live.cleanCode(" klmn "), "KLMN");
    for (const bad of ["abc", "AEIO", "KLMNP", "", null, undefined, "K1MN", "<script>"]) assert.equal(Live.cleanCode(bad), null, String(bad));
  });
  test("randomCode always yields a valid code", () => {
    const rnd = Live.rng(5);
    for (let i = 0; i < 500; i++) assert.match(Live.randomCode(rnd), Live.CODE_RE);
  });
});

describe("teams", () => {
  const uids = (n) => Array.from({ length: n }, (_, i) => "u" + i);
  const sizes = (t) => Object.values(t).reduce((a, x) => { a[x] = (a[x] || 0) + 1; return a; }, {});
  test("balanced, never a team of one when two is possible, never more than 10 teams", () => {
    for (let n = 1; n <= 40; n++) for (const size of [0, 2, 3, 4, 5, 6]) {
      const t = Live.makeTeams(uids(n), size, Live.rng(n * 7 + size));
      assert.equal(Object.keys(t).length, n);
      const s = Object.values(sizes(t));
      assert.ok(Math.max(...s) - Math.min(...s) <= 1, `n=${n} size=${size} ${s}`);
      assert.ok(s.length <= Live.MAX_TEAMS);
      if (n >= 2) assert.ok(Math.min(...s) >= 2, `n=${n} size=${size} has a team of one`);
      assert.ok(Object.values(t).every((x) => Number.isInteger(x) && x >= 0 && x <= 9));
      if (size === 0) assert.equal(s.length, 1);
    }
  });
  test("examples: 12 players in 2s is six teams; 7 in 3s is 3+2+2; 3 players in 2s is one team of 3", () => {
    assert.deepEqual(Object.values(sizes(Live.makeTeams(uids(12), 2))).sort(), [2, 2, 2, 2, 2, 2]);
    assert.deepEqual(Object.values(sizes(Live.makeTeams(uids(7), 3))).sort(), [2, 2, 3]);
    assert.deepEqual(Object.values(sizes(Live.makeTeams(uids(3), 2))), [3]);
  });
  test("a late joiner goes to the smallest team (lowest number on a tie)", () => {
    assert.equal(Live.smallestTeam({ a: 0, b: 0, c: 1 }), 1);
    assert.equal(Live.smallestTeam({ a: 0, b: 1 }), 0);
    assert.equal(Live.smallestTeam({}), 0);
  });
});

describe("settings", () => {
  const mode = { settings: [
    { key: "rounds", type: "int", options: [3, 5], default: 3 },
    { key: "counts", type: "enum", options: [["yes", "Yes"], ["no", "No"]], default: "yes" },
    { key: "kinds", type: "flags", options: [["plain", "P"], ["qu", "Q"], ["elision", "E"]], default: ["plain"] },
  ] };
  test("round trip: what is encoded decodes to the same choices", () => {
    const stored = Live.encodeSettings(mode, { rounds: 5, counts: "no", kinds: ["qu", "elision"] });
    assert.deepEqual(stored, { rounds: 5, counts: "no", kinds: 6 });
    assert.ok(Object.values(stored).every((v) => typeof v === "number" || (typeof v === "string" && v.length <= 16)));
    assert.deepEqual(Live.decodeSettings(mode, stored), { rounds: 5, counts: "no", kinds: ["qu", "elision"] });
  });
  test("missing or out-of-range stored values fall back to the defaults", () => {
    assert.deepEqual(Live.decodeSettings(mode, {}), { rounds: 3, counts: "yes", kinds: ["plain"] });
    assert.deepEqual(Live.decodeSettings(mode, { counts: "maybe", rounds: "x" }), { rounds: 3, counts: "yes", kinds: ["plain"] });
  });
});

describe("the mode registry", () => {
  test("a bad definition is refused with a clear message", () => {
    assert.throws(() => Live.registerMode({ id: "Bad", title: "x" }), /id must be/);
    assert.throws(() => Live.registerMode({ id: "okay", title: "x", settings: [{ key: "a b", type: "int", options: [1] }] }), /setting key/);
    assert.throws(() => Live.registerMode({ id: "okay", title: "x" }), /host needs/);
  });
  test("the three shipped modes register (poll fully, the other two as 'not built yet' stubs)", () => {
    global.Live = Live;
    for (const m of ["poll", "devices", "meter"]) require("../live/modes/" + m + ".js");
    assert.ok(Live.modes.poll.host.nextRound && Live.modes.poll.player.render);
    assert.equal(Live.modes.poll.hidden, true);
    assert.ok(["devices", "meter"].every((id) => Live.modes[id]));
    for (const id of Object.keys(Live.modes)) assert.match(rules.games.$code.meta.mode[".validate"], new RegExp(id));
  });
});
