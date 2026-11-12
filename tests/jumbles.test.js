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

// An order of a line's words, from their text (each word used once).
function orderOf(L, text) {
  const w = J.wordsOf(L), used = new Set();
  return text.split(" ").map((t) => {
    const x = w.find((y) => y.w === t && !used.has(y.id));
    assert.ok(x, `${L.c}: no ${t}`);
    used.add(x.id);
    return x;
  });
}
const find = (c) => D.lines.concat(D.sentences).find((l) => l.c === c);

test("the rules catch what they should", () => {
  const L = find("Aen. 1.47");     // et soror et coniūnx, ūnā cum gente tot annōs
  const w = J.wordsOf(L);
  // cum with nothing of its own after it
  assert.ok(J.looseFaults(w, orderOf(L, "et soror et coniūnx ūnā gente cum tot annōs")).some((f) => f.rule === "prep"));
  // et ... et joins nouns: the conjuncts keep their order
  assert.ok(J.looseFaults(w, orderOf(L, "et coniūnx et soror ūnā cum gente tot annōs")).length);
  // multum ille et terrīs iactātus et altō: an adverb may cross the et's
  const M = find("Aen. 1.3"), mw = J.wordsOf(M);
  const pre = mw.slice(0, mw.findIndex((x) => x.w === "multum")).map((x) => x.w).join(" ");
  assert.deepStrictEqual(J.looseFaults(mw, orderOf(M, `${pre} ille et terrīs iactātus et altō multum`)), []);
  // nec tē noster amor nec tē data dextera quondam: noster stays with amor, data with dextera
  const N = find("Aen. 4.307"), nw = J.wordsOf(N);
  assert.deepStrictEqual(J.looseFaults(nw, nw), []);
  assert.ok(J.looseFaults(nw, orderOf(N, "nec tē noster dextera nec tē data amor quondam")).some((f) => f.rule === "phrase"));
  assert.ok(J.looseFaults(nw, orderOf(N, "nec nec tē noster amor tē data dextera quondam")).length);
  assert.deepStrictEqual(J.looseFaults(nw, orderOf(N, "nec tē noster amor nec tē dextera data quondam")), []);
});

test("a clause's verb set in front of its opener (Aen. 1.322 vīdistis sī quam): never in the jumble, fine in an answer", () => {
  const L = find("Aen. 1.322");    // vīdistis sī quam hīc errantem forte sorōrum
  const w = J.wordsOf(L);
  assert.deepStrictEqual(J.looseFaults(w, orderOf(L, "sī quam vīdistis hīc errantem forte sorōrum")), []);
  assert.deepStrictEqual(J.looseFaults(w, orderOf(L, "sī quam hīc errantem forte sorōrum vīdistis")), []);
  assert.deepStrictEqual(J.looseFaults(w, w), []);                       // Vergil's own order
  assert.ok(J.looseFaults(w, orderOf(L, "quam vīdistis sī hīc errantem forte sorōrum")).some((f) => f.rule === "indef"));
  for (let s = 0; s < 40; s++) {
    const o = J.jumble(L, J.seeded(s));
    assert.strictEqual(o[0].w, "sī", `jumble ${s}: ${o.map((x) => x.w).join(" ")}`);
  }
  const S = find("Aen. 1.321–324");
  for (let s = 0; s < 40; s++) {
    const o = J.jumble(S, J.seeded(s)).map((x) => x.w);
    assert.ok(o.indexOf("sī") < o.indexOf("vīdistis") && o.indexOf("sī") < o.indexOf("meārum"), o.join(" "));
  }
});

test("prose order is never wrong for the grammar: nōn before the verb, a genitive inside a prepositional phrase", () => {
  // nōn moved from the word after it to right before its clause's verb (quem nōn fors ignāra dedit ->
  // quem fors ignāra nōn dedit): never a fault of nōn's
  let tried = 0;
  for (const L of D.lines.concat(D.sentences)) {
    const w = J.wordsOf(L);
    const n = w.find((x) => x.r === "n" && x.to !== undefined && !w[x.to].vb);
    if (!n) continue;
    const K = (x) => (x.k !== undefined ? x.k : x.g);
    const v = w.find((x) => x.vb && K(x) === K(n) && x.id > n.to);
    if (!v) continue;
    const o = w.filter((x) => x !== n);
    o.splice(o.indexOf(v), 0, n);
    assert.ok(!J.looseFaults(w, o).some((f) => f.rule === "neg"), `${L.c}: ${o.map((x) => x.w).join(" ")}`);
    tried++;
  }
  assert.ok(tried >= 5, `${tried} places tried`);
  // in Caesaris castra: a genitive between a preposition and its noun
  const G = D.lines.concat(D.sentences).find((l) => {
    const w = J.wordsOf(l);
    return w.some((x, i) => x.pr && w[i + 1] && w[i + 2] && x.ob === i + 1 && w[i + 2].ag && w[i + 2].ag[2] === "g"
      && w[i + 1].ag && w[i + 1].ag[2] !== "g" && w[i + 1].g === x.g && w[i + 2].g === x.g);
  });
  assert.ok(G, "a preposition + noun + genitive in the reader");
  const gw = J.wordsOf(G), i = gw.findIndex((x, k) => x.pr && x.ob === k + 1 && gw[k + 2] && gw[k + 2].ag && gw[k + 2].ag[2] === "g");
  const swapped = gw.slice();
  [swapped[i + 1], swapped[i + 2]] = [swapped[i + 2], swapped[i + 1]];
  assert.ok(!J.looseFaults(gw, swapped).some((f) => f.rule === "prep"), `${G.c}: ${swapped.map((x) => x.w).join(" ")}`);
});

test("every opener comes first in every jumble, and every jumble passes the answer rules", () => {
  for (const [i, L] of D.lines.concat(D.sentences).entries()) {
    const o = J.jumble(L, J.seeded(77 + i));
    if (!o) continue;
    const w = J.wordsOf(L);
    assert.deepStrictEqual(J.looseFaults(w, o), [], L.c);
    const byG = new Map();
    o.forEach((x) => { if (!byG.has(x.g)) byG.set(x.g, []); byG.get(x.g).push(x); });
    for (const g of byG.values()) {
      const op = g.find((x) => x.r === "c");
      if (!op) continue;
      // first in its group, or right after a preposition governing it (ē quibus)
      const k = g.indexOf(op);
      assert.ok(k === 0 || (k === 1 && g[0].pr), `${L.c}: ${g.map((x) => x.w).join(" ")}`);
    }
  }
});

// ---- sentences of two to four lines (the fourth level) --------------------------------------------
test("every sentence, in the poet's order, rescans line by line as the scanner keyed it, and is RIGHT", () => {
  assert.ok((D.sentences || []).length >= 150, `${(D.sentences || []).length} sentences`);
  for (const S of D.sentences) {
    assert.ok(S.rows.length >= 2 && S.rows.length <= 4, S.c);
    S.cs.forEach((c, i) => {
      const key = LINES.get(c);
      const want = key.nuclei.map((n) => ({ L: "L", S: "S", elided: "X", prodelided: "X" }[n.mark])).join("");
      assert.strictEqual(S.pat[i], want, `${S.c}: line ${c}`);
    });
    const w = J.wordsOf(S);
    const sc = J.scanItem(S, w);
    assert.deepStrictEqual(sc.rows.map((r) => r.marks.flat().join("")), S.pat, S.c);
    const v = J.judge(S, w);
    assert.ok(v.right && v.exact, `${S.c}: ${JSON.stringify(v.faults.map((f) => f.rule))}`);
  }
});

test("a sentence's jumble keeps each line's word count, keeps the walls, and leaves a line unscannable", () => {
  let moved = 0;
  for (const [i, S] of D.sentences.entries()) {
    const o = J.jumble(S, J.seeded(500 + i));
    assert.ok(o, `${S.c} cannot be jumbled`);
    const w = J.wordsOf(S);
    assert.ok(!J.sameOrder(o, w), S.c);
    const rows = J.splitRows(S, o);
    assert.deepStrictEqual(rows.map((r) => r.length), J.rowCounts(S), S.c);
    assert.ok(rows.some((r) => !J.feet(J.scan(r).pattern, true)), `${S.c}: every line scans`);
    assert.deepStrictEqual(J.looseFaults(w, o), [], S.c);
    o.forEach((x, j) => { if (j) assert.ok(o[j - 1].s <= x.s, `${S.c}: crossed a wall`); });
    if (rows.some((r, k) => r.some((x) => x.ln !== k))) moved++;
  }
  assert.ok(moved > 60, `only ${moved} jumbles move a word into another line`);
});

test("a sentence's lines may change length: the poet's words in other lines are not the poet's lines", () => {
  for (const S of D.sentences) {
    const w = J.wordsOf(S), n = J.rowCounts(S);
    // the first word of line 2 moved up to the end of line 1: same order, other lines
    const moved = n.slice();
    moved[0] += 1; moved[1] -= 1;
    const v = J.judge(S, w, moved);
    assert.ok(!v.exact, S.c);
    assert.strictEqual(J.splitRows(S, w, moved)[0].length, n[0] + 1, S.c);
    // a line emptied of words is no hexameter
    const empty = n.slice();
    empty[0] += empty[1]; empty[1] = 0;
    assert.ok(!J.judge(S, w, empty).meter.ok, S.c);
    assert.ok(J.judge(S, w, n).exact, S.c);
  }
});
