// quiz-build.js -- one practice version of the Meter & Literary Devices Quiz, dealt by the quiz's rules.
//
// quiz.html draws it; this file only chooses. It ports the drawing in the toolkit's
// editions/devices/quiz.py (draw, passage, build) and reads the same pool, data/devices.json, which
// `quiz.py --app-json` writes together with every scansion passage the quiz could set from the lines
// read so far. So a practice version keeps the real quiz's rules:
//   * no two examples share a line of Latin (8.187 is both the chiasmus and the alliteration's end);
//   * no example sits beside a device it ALSO is (its `also`: 4.67-69 is the apostrophe, and its
//     quid non sentit amor? would make a rhetorical question right too);
//   * the scansion is whole sentences, 3-5 lines, four when there is a four (quiz.py chose them).
//
// A PRACTICE NUMBER IS NOT A QUIZ VERSION. quiz.py's versions are four-digit seeds for Python's random;
// these are five-digit seeds for a small generator of our own (mulberry32). On purpose: no number
// printed on a real quiz rebuilds that quiz here.
//
// It works as `window.QuizBuild` in a page and as `require("./quiz-build.js")` in Node (the tests).
"use strict";

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.QuizBuild = api;
})(typeof self !== "undefined" ? self : this, function () {
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const FIRST = 10000, LAST = 99999;                       // five digits: never a quiz.py version

  // mulberry32: a tiny seeded generator, the same numbers in every browser
  function generator(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(a, random) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const isNumber = (no) => Number.isInteger(no) && no >= FIRST && no <= LAST;
  const freshNumber = () => FIRST + Math.floor(Math.random() * (LAST - FIRST + 1));

  // N devices, one example each: no line of Latin used twice, and no example beside a device it also
  // is. As quiz.py's draw(); null when fewer than N fit this way (the caller deals again).
  function draw(devices, random, n) {
    const devs = shuffle(devices.slice(), random);
    const used = new Set(), keys = new Set(), barred = new Set(), picked = [];
    for (const d of devs) {
      if (barred.has(d.key)) continue;                     // an example already drawn is also this device
      const exs = shuffle(d.examples.slice(), random);
      const ex = exs.find((e) => !e.lines.some((l) => used.has(l)) && !(e.also || []).some((k) => keys.has(k)));
      if (!ex) continue;                                   // every example of it collides: the next device
      ex.lines.forEach((l) => used.add(l));
      keys.add(d.key);
      (ex.also || []).forEach((k) => barred.add(k));
      picked.push({ key: d.key, name: d.name, definition: d.definition,
                    cite: ex.cite, latin: ex.latin, english: ex.english, lines: ex.lines, also: ex.also || [] });
      if (picked.length === n) return picked;
    }
    return null;
  }

  // Part II: a four-line passage when there is one, as quiz.py's passage().
  function passage(sc, random) {
    if (!sc || !sc.passages || !sc.passages.length) return null;
    const fours = sc.passages.filter((p) => p.length === 4);
    const from = fours.length ? fours : sc.passages;
    const cites = from[Math.floor(random() * from.length)];
    const lineNo = (c) => Number(c.slice(c.lastIndexOf(".") + 1));
    return {
      cite: `${cites[0]}-${lineNo(cites[cites.length - 1])}`,
      lines: cites.map((c) => ({ cite: c, n: lineNo(c), ...sc.lines[c] })),
    };
  }

  // The macrons off, for the harder version (quiz.py --plain).
  const plain = (s) => s.normalize("NFD").replace(/\p{Mn}/gu, "").normalize("NFC");

  // One whole practice version. The number decides everything, so the same number is the same quiz.
  function build(data, no, n) {
    const random = generator(no);
    let items = null;
    for (let tries = 0; !items && tries < 100; tries++) items = draw(data.devices, random, n);
    if (!items) throw new Error(`fewer than ${n} devices fit together; choose fewer`);
    const order = shuffle(items.map((_, i) => i), random);           // the definitions' column
    const definitions = order.map((i, pos) => {
      items[i].letter = LETTERS[pos];
      return { letter: LETTERS[pos], definition: items[i].definition, name: items[i].name };
    });
    return {
      no, examples: items, definitions,
      bank: data.devices.map((d) => d.name).sort((a, b) => a.localeCompare(b)),
      scansion: passage(data.scansion, random),
    };
  }

  return { build, draw, passage, plain, generator, isNumber, freshNumber, FIRST, LAST };
});
