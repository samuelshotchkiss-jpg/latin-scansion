// quiz-score.js -- how the real Meter & Literary Devices Quiz would grade a practice quiz.
//
// A PORT of the toolkit's editions/devices/meter_grade.py (score, breaks, level), the scorer the
// teacher uses on the paper quiz (owner, 2026-11-12: students who practise see how they scored).
// It works out nothing about the Latin itself: each vowel's key mark, rung, rule and consonantal-i
// flag come in data/devices.json (quiz.py --app-json), from the same code the teacher's scorer
// uses. Change the model THERE and port it here; tests/quiz_score.test.js holds cases the Python
// scorer computed. Model 2026-11-12b.
//
// A line's marks are a string, one letter per vowel: L long, S short, x not counted (elided),
// . unmarked. (The paper scorer also takes `+`, a syllable added after a vowel; this page has no
// way to add one, so it never appears here.)
//
// It works as `window.QuizScore` in a page and as `require("./quiz-score.js")` in Node (the tests).
"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.QuizScore = api;
})(typeof self !== "undefined" ? self : this, function () {
  const SLIP = 35, SEVERE = 40, MILD = 15;                       // x 1/N
  const PRICE = { 1: 25, 2: 15, 3: 15, 4: 15, 5: 13, 6: 13 };
  const GAMMA = 1.5;
  const CUTS = [[95, 4], [87.5, 3.5], [80, 3], [70, 2]];
  const PERCENT = { 4: 100, 3.5: 90, 3: 85, 2: 75, 1: 65 };      // the department's table
  const OUT_OF = 5;                                              // the quiz's points (owner, 2026-11-12)
  const INVENTED = "elision where there is none";
  const CI = "consonantal i";
  const HARD = new Set([CI, "mute (stop) + liquid", "elision"]);
  const REPAIR = 0.2, REACH = 4, CAP = 3;
  const HEX = /^(L(SS|L)){5}L[LS]$/;

  const level = (pct) => { for (const [cut, lv] of CUTS) if (pct >= cut) return lv; return 1; };

  // [severe, mild] for one line: severe breaks the rhythm (a short alone after a long, or three
  // shorts and more); a line with none of those that is still not a hexameter is mild, once.
  function breaks(seq) {
    const body = seq.slice(0, -1);
    let severe = 0;
    for (const m of body.matchAll(/S+/g)) if (m[0].length >= 3 || (m[0].length === 1 && m.index > 0)) severe++;
    return [severe, severe || HEX.test(seq) ? 0 : 1];
  }

  // lines: [[{key, rung, rule, ci?}]] per line; marks: a string per line. As meter_grade.score.
  function score(lines, marks) {
    let N = 0;
    const n = new Map(), rg = new Map([[INVENTED, 4], ["a syllable where there is no vowel (the u of qu, a consonant i)", 2], [CI, 5]]);
    for (const sl of lines) for (const x of sl) if (x.rung) {
      N++;
      n.set(x.rule, (n.get(x.rule) || 0) + 1);
      rg.set(x.rule, x.rung);
    }
    const flagged = lines.reduce((s, sl) => s + sl.filter((x) => x.ci).length, 0);
    if (flagged) n.set(CI, flagged);                    // its chances: the vowels a consonantal i decides
    const k = new Map(), order = [], repairs = [];
    let severe = 0, mild = 0;
    const count = (rule) => { if (!k.has(rule)) order.push(rule); k.set(rule, (k.get(rule) || 0) + 1); };
    lines.forEach((sl, li) => {
      const mk = [...marks[li]].filter((c) => c !== "+");
      const errs = [];
      sl.forEach((x, si) => {
        const c = mk[si];
        if (!x.rung || c === x.key) return;
        const rule = x.ci === c ? CI : c === "x" && x.key !== "x" ? INVENTED : x.rule;
        errs.push({ si, rule });
      });
      // repairs: a mistake within REACH vowels of a hard one, at most CAP to each hard one
      const hard = errs.filter((e) => HARD.has(e.rule));
      const used = new Map(hard.map((h) => [h, 0]));
      for (const e of errs) {
        if (HARD.has(e.rule)) continue;
        const near = hard.filter((h) => Math.abs(h.si - e.si) <= REACH && used.get(h) < CAP)
          .sort((a, b) => Math.abs(a.si - e.si) - Math.abs(b.si - e.si));
        if (near.length) { used.set(near[0], used.get(near[0]) + 1); repairs.push(e); }
        else count(e.rule);
      }
      for (const h of hard) count(h.rule);
      const [sv, md] = breaks(mk.filter((c) => c === "L" || c === "S").join(""));
      severe += sv; mild += md;
    });
    const rows = order.map((rule) => {
      const kk = k.get(rule), nn = n.get(rule) || 1, rung = rg.get(rule) ?? 4;
      let c = SLIP / N * kk;
      if (nn > 1) c += Math.max(0, (PRICE[rung] ?? 15) - SLIP / N * nn) * ((Math.min(kk, nn) - 1) / (nn - 1)) ** GAMMA;
      return { rule, rung, missed: kk, of: n.has(rule) ? nn : null, cost: c };
    });
    rows.sort((a, b) => b.rung - a.rung);                          // as Python's stable sort by -rung
    const repairCost = REPAIR * SLIP / N * repairs.length;
    const breakCost = (SEVERE * severe + MILD * mild) / N;
    const total = rows.reduce((s, r) => s + r.cost, 0) + repairCost + breakCost;
    const pct = Math.max(0, 100 - total);
    return { score: pct, level: level(pct), rows, repairs: repairs.length, repairCost,
             severe, mild, breaks: severe + mild, breakCost, syllables: N };
  }

  // The quiz's percentage: the two parts' ACTUAL percentages averaged, not their levels (owner,
  // 2026-11-12), each at least the department's floor (any work 65%, a blank part 50%). As
  // meter_grade.final. Times 5, the points.
  const FLOOR = 65, NO_WORK = 50;
  const final = (part1Pct, meter, part2Blank) =>
    (Math.max(FLOOR, part1Pct) + (part2Blank ? NO_WORK : Math.max(FLOOR, meter))) / 2;
  const points = (pct) => OUT_OF * pct / 100;

  return { score, breaks, level, final, points, PERCENT, OUT_OF };
});
