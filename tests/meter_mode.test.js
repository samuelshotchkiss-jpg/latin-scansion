// meter_mode.test.js -- the rules of "Longa an brevis?" (live/modes/meter.js) with no browser: which questions
// are chosen, how a tap is scored and graded, what is made public before and after a round locks, the
// end-of-game breakdown, and (the owner's ruling) that a phone never loads the 2.4 MB question bank.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

global.Live = require("../live/common.js");
const M = require("../live/modes/meter.js");
const BANK = require("../data/meter_questions.json");
const root = path.join(__dirname, "..");

const allKinds = Object.keys(M.KIND_OF).map((k) => M.KIND_OF[k]);
const allPassages = Object.values(M.PASSAGE_OF);
const pick = (n, seed, kinds, passages) => M.selectQuestions(BANK, { n, kinds: kinds || ["plain", "elision", "mcl"], passages: passages || allPassages, rng: Live.rng(seed) });

test("settings are legal for the shell and every option names a real kind and passage", () => {
  const def = Live.modes.meter;
  assert.notEqual(def.built, false);
  for (const o of M.KIND_OPTIONS) assert.ok(BANK.kinds[o[2]], o[2]);
  assert.deepEqual(Object.keys(BANK.kinds).sort(), M.KIND_OPTIONS.map((o) => o[2]).sort());
  const passages = new Set(Object.values(BANK.lines).map((l) => l.passage));
  assert.deepEqual([...passages].sort(), M.PASSAGE_OPTIONS.map((o) => o[2]).sort());
  const set = Live.encodeSettings(def, Live.defaultSettings(def));
  const back = Live.decodeSettings(def, set);
  assert.deepEqual(back.kinds, ["plain", "elision", "mcl"]);
  assert.equal(back.passages.length, 6);
  assert.equal(back.rounds, 20);
  assert.equal(back.seconds, 12);
});

test("selection: no line twice, the right count, the 40/40/20 mix, the same seed the same game", () => {
  for (const n of [10, 20, 30, 40]) for (let seed = 1; seed <= 12; seed++) {
    const { list, short } = pick(n, seed);
    assert.equal(list.length, n); assert.equal(short, false);
    assert.equal(new Set(list.map((q) => q.line)).size, n, "a line was asked twice");
    assert.ok(list.every((q) => ["plain", "elision", "mcl"].includes(q.kind)));
    const c = { L: 0, S: 0, X: 0 };
    list.forEach((q) => c[q.answer]++);
    assert.equal(c.X, Math.round(n * 0.2)); assert.ok(Math.abs(c.L - c.S) <= 1, JSON.stringify(c));
  }
  assert.deepEqual(pick(20, 5).list.map((q) => q.id), pick(20, 5).list.map((q) => q.id));
  assert.notDeepEqual(pick(20, 5).list.map((q) => q.id), pick(20, 6).list.map((q) => q.id));
});

test("no elided answer unless elision is ticked; half long, half short then", () => {
  for (let seed = 1; seed <= 10; seed++) {
    const { list } = pick(20, seed, ["plain", "qu", "mcl"]);
    assert.ok(list.every((q) => q.answer !== "X"));
    assert.equal(list.filter((q) => q.answer === "L").length, 10);
  }
});

test("passages restrict the lines; too few lines gives a short game, said so", () => {
  const { list } = pick(30, 3, allKinds, ["The Gates of Cumae"]);
  assert.ok(list.every((q) => BANK.lines[q.line].passage === "The Gates of Cumae"));
  const r = M.selectQuestions(BANK, { n: 40, kinds: ["greek"], passages: ["Pyramus and Thisbe"], rng: Live.rng(1) });
  assert.ok(r.list.length < 40); assert.equal(r.short, true);
});

test("a question is never of the same kind as the one before when another kind can supply the answer", () => {
  const bank = { lines: {}, questions: [] };
  for (const k of ["A", "B", "C"]) for (let i = 0; i < 30; i++) {
    const q = { id: k + i, line: k + i, kind: k, answer: "L", span: [0, 1], word: [0, 1] };
    bank.lines[q.line] = { passage: "P" }; bank.questions.push(q);
  }
  for (let seed = 1; seed <= 20; seed++) {
    const { list } = M.selectQuestions(bank, { n: 30, kinds: ["A", "B", "C"], passages: ["P"], rng: Live.rng(seed) });
    for (let i = 1; i < list.length; i++) assert.notEqual(list[i].kind, list[i - 1].kind);
  }
  // "plain" may repeat (strict alternation made a third of a default game mūta cum liquida); every other kind may not
  for (let seed = 1; seed <= 30; seed++) {
    const { list } = pick(20, seed);
    // (elision may follow elision: it is the only kind that can supply an elided answer)
    for (let i = 1; i < list.length; i++) if (list[i].kind === list[i - 1].kind) assert.ok(list[i].kind === "plain" || list[i].answer === "X", list[i].kind);
    assert.ok(list.filter((q) => q.kind === "mcl").length <= 6, "too many mūta cum liquida");
  }
  assert.equal(pick(20, 1, ["plain"]).list.length, 20);   // one kind ticked: it simply repeats
});

test("points: 1000 at once, 500 at the buzzer, linear between, from the server's times, no streak bonus", () => {
  assert.equal(M.points(0, 8000), 1000);
  assert.equal(M.points(4000, 8000), 750);
  assert.equal(M.points(8000, 8000), 500);
  assert.equal(M.points(9500, 8000), 500);       // (inside the shell's one second of grace)
  assert.equal(M.points(-300, 8000), 1000);
  const qs = pick(3, 2).list;
  const g = M.createGame(BANK, qs, 8);
  const got = [];
  for (let k = 0; k < 3; k++) {
    g.open(["a"]); g.tap("a", M.ANS.indexOf(qs[k].answer), 2000, false);
    got.push(g.close().pts.a);
  }
  assert.deepEqual(got, [875, 875, 875]);
});

test("grading: first on-time tap only; late, unseated and impossible taps are ignored", () => {
  const q = pick(1, 4).list[0], right = M.ANS.indexOf(q.answer), wrong = (right + 1) % 3;
  const g = M.createGame(BANK, [q], 10);
  g.open(["a", "b", "c", "d"]);
  assert.equal(g.tap("a", wrong, 1000, false), true);
  assert.equal(g.tap("a", right, 1500, false), false, "a second tap changed the answer");
  assert.equal(g.tap("b", right, 2000, false), true);
  assert.equal(g.tap("c", right, 3000, true), false, "a late tap counted");
  assert.equal(g.tap("zz", right, 100, false), false, "someone who was not dealt in counted");
  assert.equal(g.tap("d", 7, 100, false), false);
  assert.equal(g.everyoneAnswered(), false);
  const res = g.close();
  assert.deepEqual(res.pts, { a: 0, b: 900, c: 0, d: 0 });
  assert.equal(res.counts.reduce((x, y) => x + y), 2);
});

test("a team's score is the average of its members', so unequal teams stay fair", () => {
  const qs = pick(2, 9).list, g = M.createGame(BANK, qs, 10);
  const all = ["a", "b", "c", "d", "e"], teams = { 0: ["a", "b"], 1: ["c", "d", "e"] };
  g.open(all);
  for (const u of all) g.tap(u, M.ANS.indexOf(qs[0].answer), 0, false);
  g.close();
  const s = g.scores(all, teams);
  assert.equal(s[0], 1000); assert.equal(s[1], 1000);               // 2 players and 3 players, same average
  g.open(all); g.tap("a", M.ANS.indexOf(qs[1].answer), 0, false); g.close();
  const t = g.scores(all, teams);
  assert.equal(t.a, 2000); assert.equal(t[0], 1500); assert.equal(t[1], 1000);
});

test("before the lock only the line and the boxed letters go out; after it, the answer and the marks", () => {
  for (const q of BANK.questions) {
    const pub = M.publicRound(BANK, q, 20);
    assert.deepEqual(Object.keys(pub).sort(), ["a", "b", "t", "tot"]);
    assert.equal(pub.t.slice(pub.a, pub.b), BANK.lines[q.line].text.slice(q.span[0], q.span[1]));
  }
  const q = BANK.questions[100], pub = JSON.stringify(M.publicRound(BANK, q, 20));
  for (const secret of [q.why, q.tag, q.line, BANK.lines[q.line].marks.join("")]) assert.ok(!pub.includes(secret), secret);
  const rv = M.revealFor(BANK, q, { counts: [1, 2, 0], pts: { u: 0 } });
  assert.equal(rv.a, M.ANS.indexOf(q.answer));
  assert.equal(rv.mk.length, BANK.lines[q.line].nuclei.length);
  assert.ok(!("n" in rv) && !("kind" in rv));
});

test("the reason's markup is read as two tags only, never as HTML", () => {
  assert.deepEqual(M.whyParts('A <b class="la">s</b> and <i>x</i>.'), [{ t: "A " }, { t: "s", tag: "b" }, { t: " and " }, { t: "x", tag: "i" }, { t: "." }]);
  for (const q of BANK.questions) assert.ok(!/[<>]/.test(M.whyText(q.why)), q.id);
});

test("the breakdown: accuracy by kind and the most-missed questions, with no player in it", () => {
  const qs = [BANK.questions.find((q) => q.kind === "plain" && q.answer === "L"), BANK.questions.find((q) => q.kind === "elision"), BANK.questions.find((q) => q.kind === "plain" && q.answer === "S")];
  const g = M.createGame(BANK, qs, 10);
  const ix = (q) => M.ANS.indexOf(q.answer);
  g.open(["alice", "bob", "cy"]); g.tap("alice", ix(qs[0]), 0, false); g.tap("bob", (ix(qs[0]) + 1) % 3, 0, false); g.close();
  g.open(["alice", "bob", "cy"]); g.tap("alice", (ix(qs[1]) + 1) % 3, 0, false); g.tap("bob", (ix(qs[1]) + 2) % 3, 0, false); g.tap("cy", (ix(qs[1]) + 1) % 3, 0, false); g.close();
  g.open(["alice", "bob", "cy"]); g.tap("cy", ix(qs[2]), 0, false); g.close();
  const [byKind, missed] = g.summary();
  const plain = byKind.rows.find((r) => r[0] === BANK.kinds.plain.label), elision = byKind.rows.find((r) => r[0] === BANK.kinds.elision.label);
  assert.deepEqual(plain.slice(1), [2, 3, 2, "67%", 3]);           // questions, answers, right, %, no answer
  assert.deepEqual(elision.slice(1), [1, 3, 0, "0%", 0]);
  assert.equal(missed.rows[0][0], qs[1].line);                      // 0 of 3 is the worst
  assert.equal(missed.rows[0][3], "0 of 3");
  assert.equal(missed.rows.length, 2);                              // the third question was all right: not listed
  assert.match(missed.rows[0][1], /\[.+\]/);
  const all = JSON.stringify(g.summary());
  for (const name of ["alice", "bob", "cy"]) assert.ok(!all.includes(name));
});

// ---- the owner's ruling: a phone never loads the question bank --------------------------------------------
const src = fs.readFileSync(path.join(root, "live", "modes", "meter.js"), "utf8");
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");

test("live.html and the phone's code never name the bank", () => {
  assert.ok(!/meter_questions/.test(fs.readFileSync(path.join(root, "live.html"), "utf8")));
  for (const f of ["live/player.js", "live/net.js", "live/common.js"]) assert.ok(!/meter_questions/.test(fs.readFileSync(path.join(root, f), "utf8")), f);
  const code = noComments(src);
  assert.equal((code.match(/\bfetch\s*\(/g) || []).length, 1, "exactly one fetch in meter.js");
  assert.equal((code.match(/loadBank\s*\(/g) || []).length, 2, "defined once, called once");
  const phone = code.slice(code.indexOf("player: {"));
  assert.ok(!/fetch|loadBank|BANK\b|selectQuestions|createGame/.test(phone), "the phone's half reaches the bank");
  const host = code.slice(code.indexOf("host: {"), code.indexOf("player: {"));
  assert.ok(/async start\(ctx\)\s*\{\s*const bank = await loadBank\(\)/.test(host), "the bank is loaded in host.start only");
});

test("running the phone's half: no fetch, and nothing about the answer is drawn before the reveal", () => {
  // a very small stand-in for the page, enough for Live.h and the mode's render
  class El {
    constructor(t) { this.tag = t; this.kids = []; this.attrs = {}; this.classList = { add() {}, remove() {}, toggle() {} }; }
    appendChild(c) { this.kids.push(c); return c; }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener() {}
    querySelector() { return new El("span"); }
    set className(v) { this.attrs.class = v; }
    get firstChild() { return this.kids[0] || null; }
    removeChild(c) { this.kids.splice(this.kids.indexOf(c), 1); }
    get isConnected() { return false; }
    get nodeType() { return 1; }
    set textContent(v) { this.kids = [{ nodeType: 3, text: String(v) }]; }
  }
  const text = (n) => (n.nodeType === 3 ? n.text : n.kids.map(text).join(" ") + " " + JSON.stringify(n.attrs));
  let fetched = 0;
  const live = require("../live/common.js");
  const saved = live.modes.meter; delete live.modes.meter;             // (the real one is registered already)
  const sandbox = { Live: live, document: { createElement: (t) => new El(t), createTextNode: (s) => ({ nodeType: 3, text: s }) },
    fetch: () => { fetched++; throw new Error("fetch"); }, console, setTimeout, setInterval, clearInterval, Math };
  const globalWas = global.Live;
  global.document = sandbox.document;                                 // (Live.h builds with the page's document)
  vm.runInNewContext(src, sandbox, { filename: "meter.js" });
  const mode = live.modes.meter; live.modes.meter = saved; global.Live = globalWas;
  const q = BANK.questions[300], round = Object.assign(M.publicRound(BANK, q, 20), { n: 3, open: true, t0: 0, ms: 12000 });
  const secret = [M.whyText(q.why).slice(0, 25), q.tag];
  const draw = (view) => { const el = new El("div"); mode.player.render({ uid: "u", tap() {}, now: () => 0, team: null, teamsOn: false }, el, view); return text(el); };
  const open = draw({ round, hand: { n: 3 }, myTaps: [], reveal: null, score: null });
  for (const s of secret) assert.ok(!open.includes(s), "the reason showed before the reveal: " + s);
  assert.ok(open.includes("Long") && open.includes("Short") && open.includes("Elided"));
  assert.ok(/Welcome/.test(draw({ round, hand: null, myTaps: [], reveal: null, score: null })));
  const rv = Object.assign(M.revealFor(BANK, q, { counts: [0, 0, 0], pts: { u: 700 } }), { n: 3 });
  const after = draw({ round: Object.assign({}, round, { open: false }), hand: { n: 3 }, myTaps: [{ v: 0 }], reveal: rv, score: { u: 700 } });
  assert.ok(after.includes(secret[0].slice(0, 10)));
  assert.equal(fetched, 0);
  delete global.document;
});
