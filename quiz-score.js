// quiz-score.js -- how the real Meter & Literary Devices Quiz would grade a practice quiz.
//
// A PORT of the toolkit's editions/devices/meter_grade.py (score, breaks, level), the scorer the
// teacher uses on the paper quiz (owner, 2026-11-12: students who practise see how they scored).
// It works out nothing about the Latin itself: each vowel's key mark, rung and rule come in
// data/devices.json (quiz.py --app-json), from the same code the teacher's scorer uses. Change the
// model THERE and port it here; tests/quiz_score.test.js holds cases the Python scorer computed.
//
// A line's marks are a string, one letter per vowel: L long, S short, x not counted (elided),
// . unmarked.
//
// It works as `window.QuizScore` in a page and as `require("./quiz-score.js")` in Node (the tests).
"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.QuizScore = api;
})(typeof self !== "undefined" ? self : this, function () {
  const SLIP = 50, BREAK = 25;                                   // x 1/N
  const PRICE = { 1: 25, 2: 15, 3: 15, 4: 15, 5: 13, 6: 13 };
  const GAMMA = 1.5;
  const CUTS = [[95, 4], [87.5, 3.5], [80, 3], [70, 2]];
  const PERCENT = { 4: 100, 3.5: 90, 3: 85, 2: 75, 1: 65 };      // the department's table
  const INVENTED = "elision where there is none";

  const level = (pct) => { for (const [cut, lv] of CUTS) if (pct >= cut) return lv; return 1; };

  // Runs of shorts that are not a pair, and a line that opens with two shorts (the last syllable is free).
  function breaks(seq) {
    const body = seq.slice(0, -1);
    let b = 0;
    for (const m of body.matchAll(/S+/g)) if (m[0].length !== 2) b++;
    return b + (body.startsWith("SS") ? 1 : 0);
  }

  // lines: [[{key, rung, rule}]] per line; marks: a string per line. As meter_grade.score.
  function score(lines, marks) {
    let N = 0;
    const n = new Map(), k = new Map(), rg = new Map();
    for (const sl of lines) for (const x of sl) if (x.rung) {
      N++;
      n.set(x.rule, (n.get(x.rule) || 0) + 1);
      rg.set(x.rule, x.rung);
    }
    let nb = 0;
    lines.forEach((sl, li) => {
      const m = marks[li];
      sl.forEach((x, i) => {
        const c = m[i];
        if (!x.rung || c === x.key) return;
        const rule = c === "x" && x.key !== "x" ? INVENTED : x.rule;
        k.set(rule, (k.get(rule) || 0) + 1);
        if (!rg.has(rule)) rg.set(rule, 4);
      });
      nb += breaks([...m].filter((c) => c === "L" || c === "S").join(""));
    });
    const rows = [];
    for (const [rule, kk] of k) {
      const nn = n.get(rule) || 1;
      let c = SLIP / N * kk;
      if (nn > 1) c += Math.max(0, (PRICE[rg.get(rule)] ?? 15) - SLIP / N * nn) * ((kk - 1) / (nn - 1)) ** GAMMA;
      rows.push({ rule, rung: rg.get(rule), missed: kk, of: n.has(rule) ? nn : null, cost: c });
    }
    rows.sort((a, b) => b.rung - a.rung);               // as Python's stable sort by -rung
    const total = rows.reduce((s, r) => s + r.cost, 0) + BREAK / N * nb;
    const pct = Math.max(0, 100 - total);
    return { score: pct, level: level(pct), rows, breaks: nb, breakCost: BREAK / N * nb, syllables: N };
  }

  // The gradebook percentage: each part's level by the department's table, averaged.
  const gradebook = (lv1, lv2) => (PERCENT[lv1] + PERCENT[lv2]) / 2;

  return { score, breaks, level, gradebook, PERCENT };
});
