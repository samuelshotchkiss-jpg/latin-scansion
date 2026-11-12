// The practice quiz scores Part II as the teacher's scorer does (toolkit editions/devices/meter_grade.py).
// Pure: no emulator needed --  node --test tests/quiz_score.test.js
//
// quiz_score_cases.json holds students the PYTHON scorer graded (2026-11-12); if this fails after
// data/devices.json is regenerated, regenerate the cases from meter_grade.py, do not edit the numbers.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const QS = require("../quiz-score.js");

const DATA = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "devices.json"), "utf8")).scansion;
const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, "quiz_score_cases.json"), "utf8"));
const linesOf = (p) => p.map((c) => DATA.lines[c].slots.map(([, , key, rung, r]) => ({ key, rung, rule: DATA.rules[r] })));

test("the same score as the teacher's scorer", () => {
  assert.ok(CASES.length >= 5);
  for (const c of CASES) {
    const r = QS.score(linesOf(c.passage), c.marks);
    assert.ok(Math.abs(r.score - c.score) < 1e-5, `${c.student}: ${r.score} vs ${c.score}`);
    assert.strictEqual(r.level, c.level, c.student);
  }
});

test("a perfect passage is 100 and a 4; levels at the department's midpoints", () => {
  const p = DATA.passages.find((x) => x.length === 4);
  const lines = linesOf(p);
  const r = QS.score(lines, lines.map((sl) => sl.map((x) => x.key).join("")));
  assert.strictEqual(r.score, 100);
  assert.strictEqual(r.level, 4);
  assert.deepStrictEqual([95, 94.9, 87.5, 80, 79.9, 70, 69.9].map(QS.level), [4, 3.5, 3.5, 3, 2, 2, 1]);
  assert.strictEqual(QS.gradebook(3.5, 4), 95);
});

test("every app vowel has a rung, a rule and a place in its line", () => {
  for (const [cite, ln] of Object.entries(DATA.lines)) {
    for (const [s, e, key, rung, r] of ln.slots) {
      assert.ok(e > s && /[aeiouyāēīōūȳ]/i.test(ln.text.slice(s, e).normalize("NFC")), `${cite} ${s}`);
      assert.ok("LSx".includes(key) && rung >= 0 && DATA.rules[r], `${cite} ${s}`);
    }
  }
});
