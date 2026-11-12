// Latin Scansion -- HEXAMETER JUMBLES, the part with no page in it. AGPL-3.0 (see COPYRIGHT.md).
//
// data/jumbles.json (the toolkit's engine/export_jumbles.py) cuts each line into word tiles. This file
//   * rescans the tiles in ANY order, joining words exactly as scansion/scansion.py's build_line does:
//     elision (and prodelision of est / es), a closed last syllable before a consonant, a short vowel
//     left short before a mute (stop) + liquid or f + l / f + r that begins the next word, hic / hoc
//     doubling its c before a vowel, the last syllable of the line long;
//   * checks the result is a hexameter (no caesura test: owner, 2026-11-12 -- his students are
//     not taught caesurae, and a rule they cannot see would only puzzle them);
//   * deals a JUMBLE: the poet's words in an order that does not scan but still reads, by the STRICT
//     rules below, leaning toward a plainer order (an adjective beside its noun, a verb last);
//   * judges a student's order by the LOOSER rules -- the licences Ovid and Vergil allow themselves.
//
// THE RULES (a group = a run of words opened by a conjunction, relative or -que, inside punctuation):
//                          STRICT (the jumble)                    LOOSE (an answer)
//   punctuation            no word crosses it                     the same (the page enforces it)
//   groups                 keep their order, never mix            the same
//   the opening word       first in its group                     within the group's first three
//   preposition            then its object, or an adjective       then its object; or an agreeing word
//                          agreeing with it, then the object      with the object right after it, or
//                                                                 right before the preposition
//   nōn, haud, ō           right before their word                somewhere before it, in the group
//   enim, autem...         second                                 second or third
//   quoque                 right after its word                   the same (tū quoque ≠ semper quoque)
//
// Pure functions; the page (jumbles.js) and the tests (tests/jumbles.test.js) share them.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JumbleCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The words of a line, in the poet's order (walls dropped). Each keeps its index as `id`.
  function wordsOf(line) {
    const out = [];
    line.t.forEach((t) => { if (typeof t === 'object') out.push(Object.assign({ id: out.length }, t)); });
    return out;
  }

  const onsetCount = (w) => (!w ? 0 : w.on === 'v' ? 0 : w.on === '1' ? 1 : 2);

  // Scan words in this order. Returns { marks: [[...per nucleus]...per word], pattern, sylls } where
  // marks are 'L' / 'S' / 'X' (gone: elided or prodelided) and sylls lists the active syllables as
  // { w: position in order, n: nucleus index, why }.
  function scan(order) {
    const n = order.length;
    const marks = order.map((w) => w.m.split('').concat(['?']));
    const why = order.map((w) => w.m.split('').map(() => '').concat(['']));
    for (let i = 0; i < n; i++) {
      const w = order[i], nx = order[i + 1], last = w.n.length - 1;
      if (marks[i][last] === 'X') continue;                    // a prodelided est, done already
      if (!nx) { marks[i][last] = 'L'; why[i][last] = 'end'; continue; }
      if ((w.ev || w.em) && nx.on === 'v') {
        if (nx.est) {
          marks[i + 1][0] = 'X'; why[i + 1][0] = 'prodelided';
          if (w.fl) { marks[i][last] = 'L'; why[i][last] = 'nature'; continue; }
          const total = (w.em ? 1 : 0) + nx.co + onsetCount(order[i + 2]);
          marks[i][last] = total >= 2 ? 'L' : 'S';
          why[i][last] = total >= 2 ? 'position' : 'short';
        } else {
          marks[i][last] = 'X'; why[i][last] = 'elided';
        }
        continue;
      }
      if (w.fl) { marks[i][last] = 'L'; why[i][last] = 'nature'; continue; }
      if (w.hc && nx.on === 'v') { marks[i][last] = 'L'; why[i][last] = 'hicc'; continue; }
      const total = w.co + onsetCount(nx);
      if (total >= 2 && !(w.co === 0 && nx.on === 'm')) { marks[i][last] = 'L'; why[i][last] = 'position'; }
      else { marks[i][last] = 'S'; why[i][last] = total >= 2 ? 'mcl' : 'short'; }
    }
    const sylls = [];
    order.forEach((w, i) => marks[i].forEach((m, k) => { if (m !== 'X') sylls.push({ w: i, n: k }); }));
    // the line's last syllable is long by definition (a prodelided est leaves the word before it last)
    if (sylls.length) {
      const s = sylls[sylls.length - 1];
      marks[s.w][s.n] = 'L';
      why[s.w][s.n] = 'end';
    }
    sylls.forEach((s) => { s.m = marks[s.w][s.n]; s.why = why[s.w][s.n]; });
    return { marks, why, sylls, pattern: sylls.map((s) => s.m).join('') };
  }

  // The six feet, or null. A spondee in the fifth foot only when the poet's own line has one.
  function feet(pattern, spondaicFifth) {
    const out = [];
    let i = 0;
    for (let f = 0; f < 6; f++) {
      if (pattern[i] !== 'L') return null;
      if (f === 5) {
        if (i + 2 !== pattern.length) return null;
        out.push('L' + pattern[i + 1]);
        return out;
      }
      if (pattern[i + 1] === 'S' && pattern[i + 2] === 'S') { out.push('LSS'); i += 3; }
      else if (pattern[i + 1] === 'L' && (f < 4 || spondaicFifth)) { out.push('LL'); i += 2; }
      else return null;
    }
    return null;
  }

  // Everything the page needs about an order: scan, feet, verdict on the meter.
  function meter(line, order) {
    const sc = scan(order);
    const ft = feet(sc.pattern, line.f5 === 'LL');
    return { scan: sc, feet: ft, ok: !!ft };
  }

  // ---- grammar ---------------------------------------------------------------------------------
  const agrees = (a, b) => !!(a && b && a.ag && b.ag && a.ag === b.ag);
  const isAdj = (w) => w.pos === 'a' || w.pos === 'v' || w.pos === 'm' || w.pos === 'p';
  const isNoun = (w) => w.pos === 'n' || w.pos === 'p';

  // The looser rules: [] when the order is fine, else the first broken rule as { rule, words }.
  function looseFaults(words, order) {
    const pos = new Map(order.map((w, i) => [w.id, i]));
    const faults = [];
    for (let i = 0; i + 1 < order.length; i++) {
      const a = order[i], b = order[i + 1];
      if (a.s === b.s && b.g < a.g) faults.push({ rule: 'group', words: [b, a] });
    }
    const groups = new Map();
    order.forEach((w) => { if (!groups.has(w.g)) groups.set(w.g, []); groups.get(w.g).push(w); });
    for (const g of groups.values()) {
      g.forEach((w, k) => {
        if (w.r === 'c' && k > 2) faults.push({ rule: 'opener', words: [w] });
        if (w.r === 'p2' && (k === 0 || k > 2)) faults.push({ rule: 'second', words: [w] });
      });
    }
    words.forEach((w) => {
      if (w.r === 'a') {
        const mate = words[w.id - 1];
        if (mate && pos.get(mate.id) !== pos.get(w.id) - 1) faults.push({ rule: 'after', words: [w, mate] });
      }
      if (w.pr && w.ob !== undefined) {
        // right after: the object -- or a word agreeing with it, with the object right after that
        // (in nova corpora) or right before the preposition (corpore in novo, the poets' order)
        const ob = words[w.ob], p = pos.get(w.id), nxt = order[p + 1];
        const ok = nxt && (nxt.id === ob.id || (nxt.g === w.g && agrees(nxt, ob)
          && (pos.get(ob.id) === p + 2 || pos.get(ob.id) === p - 1)));
        if (!ok) faults.push({ rule: 'prep', words: [w, ob] });
      }
      if ((w.r === 'n' || w.r === 'o') && w.to !== undefined) {
        const to = words[w.to];
        if (pos.get(w.id) > pos.get(to.id)) faults.push({ rule: w.r === 'n' ? 'neg' : 'voc', words: [w, to] });
      }
    });
    return faults;
  }

  // ---- the jumble ------------------------------------------------------------------------------
  // Chunks: runs of words that travel together in the jumble (a preposition and its object, nōn and
  // its word...). Built from the poet's order, then shuffled inside their group.
  function chunks(words, group) {
    let ch = group.map((w) => [w]);
    const find = (w) => ch.findIndex((c) => c.includes(w));
    const join = (x, y) => {               // x must end its chunk, y begin its own
      const i = find(x), j = find(y);
      if (i < 0 || j < 0 || i === j) return false;
      if (ch[i][ch[i].length - 1] !== x || ch[j][0] !== y) return false;
      ch[i] = ch[i].concat(ch[j]);
      ch.splice(j, 1);
      return true;
    };
    group.forEach((w) => {
      if (w.pr && w.ob !== undefined) {
        const ob = words[w.ob];
        join(w, ob);
        // in nova ... corpora: draw the noun the adjective agrees with in behind it
        if (isAdj(ob) && !isNoun(ob)) {
          const noun = group.find((x) => x !== ob && x !== w && isNoun(x) && agrees(x, ob));
          if (noun) join(ob, noun);
        }
        // summā in arce: an agreeing adjective right before the preposition stays there
        const before = words[w.id - 1];
        if (before && before.g === w.g && agrees(before, ob) && isAdj(before)) join(before, w);
      }
      if ((w.r === 'n' || w.r === 'o') && w.to !== undefined) join(w, words[w.to]);
      if (w.r === 'a') { const p = words[w.id - 1]; if (p && p.g === w.g) join(p, w); }
    });
    return ch;
  }

  function shuffle(a, rnd) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // How plain an order reads: adjectives beside their nouns, a finite verb at the end of its group.
  function plainness(group) {
    let s = 0;
    group.forEach((w, k) => {
      if (isAdj(w) && !isNoun(w) && w.ag) {
        const nb = [group[k - 1], group[k + 1]];
        if (nb.some((x) => x && isNoun(x) && agrees(x, w))) s += 1.5;
      }
    });
    const last = group[group.length - 1];
    if (group.some((w) => w.vb) && last && last.vb) s += 1;
    return s;
  }

  // One shuffled order of one group, by the strict rules.
  function shuffleGroup(words, group, rnd) {
    const ch = chunks(words, group);
    const fixed = [];
    if (ch.length && ch[0][0].r === 'c') fixed.push(ch.shift());
    const p2 = ch.findIndex((c) => c[0].r === 'p2');
    const second = p2 >= 0 ? ch.splice(p2, 1)[0] : null;
    shuffle(ch, rnd);
    let out = fixed.concat(ch);
    if (second) out.splice(Math.min(1, out.length), 0, second);
    return [].concat(...out);
  }

  const sameOrder = (a, b) => a.length === b.length && a.every((w, i) => w.id === b[i].id);

  // A jumble of the line: an order that does NOT scan, keeps to the strict rules, and differs from
  // the poet's. Draws `tries` candidates and picks one, leaning toward the plainer. null if none.
  function jumble(line, rnd, tries) {
    rnd = rnd || Math.random;
    const words = wordsOf(line);
    const groups = [];
    words.forEach((w) => {
      if (!groups.length || groups[groups.length - 1][0].g !== w.g) groups.push([]);
      groups[groups.length - 1].push(w);
    });
    const cands = [];
    for (let t = 0; t < (tries || 60); t++) {
      const gs = groups.map((g) => (g.length > 1 ? shuffleGroup(words, g, rnd) : g));
      const order = [].concat(...gs);
      if (sameOrder(order, words)) continue;
      if (feet(scan(order).pattern, true)) continue;           // still scans (even with a 5th spondee)
      if (looseFaults(words, order).length) continue;
      cands.push({ order, score: gs.reduce((s, g) => s + plainness(g), 0) });
    }
    if (!cands.length) return null;
    const ws = cands.map((c) => Math.exp(c.score + rnd() * 0.5));
    let r = rnd() * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < cands.length; i++) if ((r -= ws[i]) < 0) return cands[i].order;
    return cands[cands.length - 1].order;
  }

  // The verdict on an answer: { right, exact, meter, faults }.
  function judge(line, order) {
    const words = wordsOf(line);
    const m = meter(line, order);
    const faults = looseFaults(words, order);
    return { right: m.ok && !faults.length, exact: sameOrder(order, words), meter: m, faults };
  }

  // A seeded generator (mulberry32), for tests and for a repeatable jumble.
  function seeded(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  return { wordsOf, scan, feet, meter, looseFaults, chunks, jumble, judge, seeded, sameOrder };
});
