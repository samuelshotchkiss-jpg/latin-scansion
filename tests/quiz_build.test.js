// The practice quiz (quiz.html) is dealt by the real quiz's rules (toolkit editions/devices/quiz.py).
// Pure: no emulator needed --  node --test tests/quiz_build.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const QB = require("../quiz-build.js");

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "devices.json"), "utf8"));
const SIZES = [5, 8, 10, 12];
const NUMBERS = Array.from({ length: 1500 }, (_, i) => QB.FIRST + i * 59);   // spread over the range

test("the same number deals the same quiz", () => {
  for (const no of [10000, 12345, 99999]) {
    assert.deepStrictEqual(QB.build(DATA, no, 10), QB.build(DATA, no, 10));
  }
  assert.notDeepStrictEqual(QB.build(DATA, 12345, 10).examples, QB.build(DATA, 12346, 10).examples);
});

test("a practice number is never a quiz.py version (four digits)", () => {
  assert.ok(!QB.isNumber(4127) && !QB.isNumber(9999) && !QB.isNumber(100000) && !QB.isNumber(12345.5));
  assert.ok(QB.isNumber(QB.FIRST) && QB.isNumber(QB.LAST));
  for (let i = 0; i < 200; i++) assert.ok(QB.isNumber(QB.freshNumber()));
});

test("every version keeps the quiz's rules, at every size", () => {
  const byKey = Object.fromEntries(DATA.devices.map((d) => [d.key, d]));
  for (const n of SIZES) for (const no of NUMBERS) {
    const q = QB.build(DATA, no, n);
    const say = (m) => `no. ${no}, ${n} devices: ${m}`;
    assert.strictEqual(q.examples.length, n, say("wrong count"));
    const keys = q.examples.map((e) => e.key);
    assert.strictEqual(new Set(keys).size, n, say("a device twice"));
    const lines = q.examples.flatMap((e) => e.lines);
    assert.strictEqual(new Set(lines).size, lines.length, say("two examples share a line of Latin"));
    for (const e of q.examples) {
      for (const k of e.also) assert.ok(!keys.includes(k), say(`${e.cite} is also ${k}, which is on the quiz`));
      assert.ok(byKey[e.key].examples.some((x) => x.cite === e.cite), say(`${e.cite} is not an example of ${e.key}`));
      const d = q.definitions.find((x) => x.letter === e.letter);
      assert.strictEqual(d.definition, byKey[e.key].definition, say(`letter ${e.letter} is not ${e.key}'s definition`));
      assert.strictEqual(d.name, e.name, say("the definition's name"));
    }
    assert.deepStrictEqual(q.definitions.map((d) => d.letter), "ABCDEFGHIJKL".slice(0, n).split(""), say("letters"));
    assert.strictEqual(q.bank.length, DATA.devices.length, say("the bank holds every name"));
  }
});

test("Part II is one of quiz.py's passages, four lines when there is a four", () => {
  const sc = DATA.scansion;
  assert.ok(sc && sc.passages.length, "devices.json has no scansion: run quiz.py --app-json");
  const fours = sc.passages.filter((p) => p.length === 4).map((p) => p.join("|"));
  const seen = new Set();
  for (const no of NUMBERS) {
    const s = QB.build(DATA, no, 10).scansion;
    const cites = s.lines.map((l) => l.cite);
    if (fours.length) assert.ok(fours.includes(cites.join("|")), `no. ${no}: ${s.cite} is not a four-line passage`);
    for (const l of s.lines) {
      assert.ok(l.text && l.feet && Array.isArray(l.elisions), `${l.cite}: no key`);
      assert.strictEqual(l.feet.split("|").length, 6, `${l.cite}: not six feet`);
    }
    seen.add(cites.join("|"));
  }
  assert.strictEqual(seen.size, fours.length || sc.passages.length, "some passage is never dealt");
});

test("without macrons", () => {
  assert.strictEqual(QB.plain("Daedalus intereā Crētēn longumque perōsus"), "Daedalus interea Creten longumque perosus");
});
