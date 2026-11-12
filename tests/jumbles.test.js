// Hexameter jumbles (jumbles.html): the tiles in data/jumbles.json (the toolkit's
// engine/export_jumbles.py) and the pure rules in jumble-core.js.
// Pure: no emulator needed --  node --test tests/jumbles.test.js
//
// The rescanning was also checked against scansion/scansion.py itself on 2026-11-12: 1,679 random
// reorderings that the JS called hexameters, scanned by the Python scanner, agreed syllable for syllable.
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const J = require("../jumble-core.js");

const D = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "jumbles.json"), "utf8"));
const LINES = new Map(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "lines.json"), "utf8"))
  .map((r) => [r.citation, r]));
const words = (L, s) => J.wordsOf(L).map((w) => w.w).join(" ");

test("the jumbles cover most of the reader", () => {
  assert.ok(D.lines.length >= 800, `${D.lines.length} lines`);
  assert.ok(D.lines.some((l) => l.e === 0) && D.lines.some((l) => l.e > 0));
});

test("every line, in the poet's order, rescans exactly as the scanner keyed it", () => {
  for (const L of D.lines) {
    const key = LINES.get(L.c);
    assert.ok(key, L.c);
    const want = key.nuclei.map((n) => ({ L: "L", S: "S", elided: "X", prodelided: "X" }[n.mark])).join("");
    assert.strictEqual(L.pat, want, `${L.c}: the exported pattern`);
    assert.strictEqual(J.scan(J.wordsOf(L)).marks.flat().join(""), want, `${L.c}: ${words(L)}`);
  }
});

test("every poet's line is RIGHT by the answer rules: a hexameter and the loose grammar", () => {
  for (const L of D.lines) {
    const w = J.wordsOf(L);
    const v = J.judge(L, w);
    assert.ok(v.right && v.exact, `${L.c}: ${words(L)} ${JSON.stringify(v.faults.map((f) => f.rule))}`);
  }
});

test("a jumble does not scan, is not the poet's order, and keeps to the rules", () => {
  let made = 0;
  for (const [i, L] of D.lines.entries()) {
    const rnd = J.seeded(1000 + i);
    for (let k = 0; k < 3; k++) {
      const o = J.jumble(L, rnd);
      if (!o) break;
      made++;
      const w = J.wordsOf(L);
      assert.ok(!J.sameOrder(o, w), L.c);
      assert.strictEqual(J.feet(J.scan(o).pattern, true), null, `${L.c} scans: ${o.map((x) => x.w).join(" ")}`);
      assert.deepStrictEqual(J.looseFaults(w, o), [], L.c);
      // no word crosses punctuation
      o.forEach((x, j) => { if (j) assert.ok(o[j - 1].s <= x.s, `${L.c}: crossed a wall`); });
    }
  }
  assert.ok(made > 2400, `${made} jumbles`);
});

test("most lines can be jumbled, and a line is not always jumbled the same way", () => {
  const dead = D.lines.filter((L) => !J.jumble(L, J.seeded(5), 80));
  assert.ok(dead.length < 30, `${dead.length} lines cannot be jumbled`);
  const L = D.lines.find((l) => l.c === "Met. 1.452");
  const seen = new Set();
  for (let s = 0; s < 20; s++) seen.add(J.jumble(L, J.seeded(s)).map((w) => w.id).join(","));
  assert.ok(seen.size >= 3, `${seen.size} different jumbles`);
});

test("the rules catch what they should", () => {
  const L = D.lines.find((l) => l.c === "Aen. 1.47");     // et soror et coniūnx, ūnā cum gente tot annōs
  const w = J.wordsOf(L);
  const by = (s) => s.split(" ").map((t) => w.find((x) => x.w === t && !x.used && (x.used = true)));
  const reset = () => w.forEach((x) => delete x.used);
  // cum with nothing of its own after it
  reset();
  const bad = by("et soror et coniūnx ūnā gente cum tot annōs");
  assert.ok(J.looseFaults(w, bad).some((f) => f.rule === "prep"));
  // an et-clause's word wandered into the clause before
  reset();
  const mixed = by("et coniūnx et soror ūnā cum gente tot annōs");
  assert.ok(J.looseFaults(w, mixed).some((f) => f.rule === "opener" || f.rule === "group"));
});
