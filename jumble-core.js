// Latin Scansion -- HEXAMETER JUMBLES, the part with no page in it. AGPL-3.0 (see COPYRIGHT.md).
//
// data/jumbles.json (the toolkit's engine/export_jumbles.py) cuts each line into word tiles -- and each
// SENTENCE of two to four lines (`sentences`, owner 2026-11-12: the fourth level) into rows of tiles,
// whose clauses run on over the line breaks, so a word may end up in another line. A line's number
// of words is the student's to change (owner: words must not jump between lines by themselves), so
// the functions below take `counts`, words per line; left out, it is the poet's. This file
//   * rescans the tiles in ANY order, joining words exactly as scansion/scansion.py's build_line does:
//     elision (and prodelision of est / es), a closed last syllable before a consonant, a short vowel
//     left short before a mute (stop) + liquid or f + l / f + r that begins the next word, hic / hoc
//     doubling its c before a vowel, the last syllable of the line long;
//   * checks each line is a hexameter (no caesura test: owner, 2026-11-12 -- his students are
//     not taught caesurae, and a rule they cannot see would only puzzle them);
//   * deals a JUMBLE: the poet's words in an order that does not scan but still reads, by the STRICT
//     rules below, leaning toward a plainer order (an adjective beside its noun, a verb last);
//   * judges a student's order by the LOOSER rules -- the licences Ovid and Vergil allow themselves.
//
// THE RULES. A group = a run of words opened by a conjunction, relative or -que, inside punctuation
// (data: g). The words a poet put IN FRONT of the word opening their own clause (Aen. 1.322 vīdistis sī
// quam...) are in that clause's group: ruled place by place in the toolkit's export_jumbles.py.
// A clause (data: k, else g) = a group, or several where et, -que, aut... join phrases, not clauses.
//                          STRICT (the jumble)                    LOOSE (an answer)
//   punctuation            no word crosses it                     the same (the page enforces it)
//   groups / clauses       groups keep their order, never mix     clauses keep their order, never mix;
//                                                                 across an et joining phrases only a
//                                                                 verb, an adverb or a free participle
//                                                                 may move;
//                                                                 words in front of an unruled opener
//                                                                 may move into its clause (data: g2)
//   the opening word       FIRST in its group -- even where       within its clause's first three (or
//                          the poet put words in front of it      as many as the poet put in front: esc);
//                                                                 a joining word (et, aut, -que) never
//                                                                 later than the poet put it
//   preposition            then its object, or an adjective       then its object, within three words,
//                          agreeing with it, then the object      past words agreeing with it or
//                                                                 genitives (in Caesaris castra); or
//                                                                 noun-preposition-adjective
//   nōn, haud              right before their word                before it, or before the clause's verb
//   ō                      right before its word                  somewhere before it
//   sī quis (indefinite)   right after its sī                     after its sī
//   enim, autem...         second                                 second or third, or right after
//                                                                 its opener
//   quoque                 right after its word                   the same (tū quoque ≠ semper quoque)
//
// Pure functions; the page (jumbles.js) and the tests (tests/jumbles.test.js) share them.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.JumbleCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // An ITEM is a line ({ t, f5 }) or a sentence ({ rows: [t, t...], f5: [...] }). Its rows of tiles:
  const rowsOf = (item) => item.rows || [item.t];
  const f5Of = (item) => (Array.isArray(item.f5) ? item.f5 : [item.f5]);
  // How many words each line holds in the poet's text.
  const rowCounts = (item) => rowsOf(item).map((r) => r.filter((t) => typeof t === 'object').length);

  // The words in the poet's order (walls dropped). Each keeps its index as `id`, its line as `ln`.
  function wordsOf(item) {
    const out = [];
    rowsOf(item).forEach((row, ln) => row.forEach((t) => {
      if (typeof t === 'object') out.push(Object.assign({ id: out.length, ln }, t));
    }));
    return out;
  }

  // An order of all the words, cut into lines of `counts` words (the poet's, if not given).
  function splitRows(item, order, counts) {
    let k = 0;
    return (counts || rowCounts(item)).map((n) => order.slice(k, (k += n)));
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

  // Scan each line of an item on its own (a line ends: its last syllable is long, and nothing elides
  // over the break), then join them: marks[i] for order[i], sylls with w = index in the whole order.
  function scanItem(item, order, counts) {
    const parts = splitRows(item, order, counts).map((r) => scan(r));
    const out = { marks: [], why: [], sylls: [], rows: parts };
    let off = 0;
    parts.forEach((p, r) => {
      out.marks.push(...p.marks);
      out.why.push(...p.why);
      p.sylls.forEach((x) => out.sylls.push(Object.assign({}, x, { w: x.w + off, row: r })));
      off += p.marks.length;
    });
    out.pattern = parts.map((p) => p.pattern).join('/');
    return out;
  }

  // Everything the page needs about an order: the scan, each line's feet (null: not a hexameter),
  // and the verdict on the meter -- every line a hexameter.
  function meter(item, order, counts) {
    const sc = scanItem(item, order, counts), f5 = f5Of(item);
    // a line left with no words is no hexameter
    const rows = sc.rows.map((p, r) => ({ feet: p.pattern ? feet(p.pattern, f5[r] === 'LL') : null, pattern: p.pattern }));
    return { scan: sc, rows, ok: rows.every((r) => r.feet) };
  }

  // ---- grammar ---------------------------------------------------------------------------------
  const agrees = (a, b) => !!(a && b && a.ag && b.ag && a.ag === b.ag);
  const isAdj = (w) => w.pos === 'a' || w.pos === 'v' || w.pos === 'm' || w.pos === 'p';
  const isNoun = (w) => w.pos === 'n' || w.pos === 'p';

  const K = (w) => (w.k !== undefined ? w.k : w.g);

  // The looser rules (an answer): [] when the order is fine, else the broken rules as { rule, words }.
  function looseFaults(words, order) {
    const pos = new Map(order.map((w, i) => [w.id, i]));
    const faults = [];
    // 1. clauses in order. Each word takes its own clause -- or, in front of an unruled opener, the
    //    opener's (g2) -- the earliest it can without going back.
    const chosen = new Map();
    let level = -Infinity, seg = null, top = null;
    order.forEach((w) => {
      if (w.s !== seg) { seg = w.s; level = -Infinity; top = null; }
      const opts = [K(w)].concat(w.g2 !== undefined ? [w.g2] : []).filter((c) => c >= level);
      if (!opts.length) {
        faults.push({ rule: 'group', words: [w, top] });
        chosen.set(w.id, K(w));
        return;
      }
      const c = Math.min(...opts);
      chosen.set(w.id, c);
      if (c > level) { level = c; top = w; }
    });
    // 1b. inside a clause where et, nec, -que join PHRASES (ph), the conjuncts keep their order: only
    //    a verb, an adverb, or a participle agreeing with nothing in its own conjunct may cross them
    //    (ille et terrīs iactātus et altō multum; never nec tē noster dextera nec data amor). A word
    //    that moved into the clause after it (g2) is free inside it.
    const floats = (w) => w.r !== 'c' && w.r !== 'n'
      && (!w.ag || (w.pos === 'v' && !words.some((x) => x.g === w.g && x !== w && x.ag === w.ag)));
    const topG = new Map();
    order.forEach((w) => {
      const c = chosen.get(w.id);
      if (c !== K(w) || floats(w)) return;
      const t = topG.get(c);
      if (t && w.g < t.g) faults.push({ rule: 'phrase', words: [w, t] });
      else if (!t || w.g > t.g) topG.set(c, w);
    });
    const clause = new Map();
    order.forEach((w) => {
      const c = chosen.get(w.id);
      if (!clause.has(c)) clause.set(c, []);
      clause.get(c).push(w);
    });
    const group = new Map();
    order.forEach((w) => { if (!group.has(w.g)) group.set(w.g, []); group.get(w.g).push(w); });
    order.forEach((w) => {
      // 2. an opener: among its clause's first three words (or as many as the poet put in front of
      //    it). An et joining phrases: first of its own words, but where the poet put some in front of
      //    it (vastīs et flūctibus); verbs, adverbs and free participles do not count
      //    A joining word (j: et, -que, aut...) never later than the poet put it -- that is never the
      //    plainer order (iam capere aut aut captās...).
      if (w.r === 'c') {
        const mine = w.ph ? group.get(w.g).filter((x) => x === w || !floats(x)) : clause.get(chosen.get(w.id));
        const k = mine.indexOf(w);
        if (k > (w.j ? w.esc || 0 : Math.max(2, w.esc || 0))) faults.push({ rule: 'opener', words: [w] });
      }
      // 4. enim, autem...: second or third in its group
      //    -- or right after its opener, wherever that stands (magnum rēgīnae sed enim)
      if (w.r === 'p2') {
        const gw = group.get(w.g), k = gw.indexOf(w), op = gw.find((x) => x.r === 'c');
        if (k === 0 || (k > 2 && !(op && gw.indexOf(op) === k - 1))) faults.push({ rule: 'second', words: [w] });
      }
    });
    words.forEach((w) => {
      if (w.r === 'a') {
        const mate = words[w.id - 1];
        if (mate && pos.get(mate.id) !== pos.get(w.id) - 1) faults.push({ rule: 'after', words: [w, mate] });
      }
      if (w.pr && w.ob !== undefined) {
        // after it, within three words: its object -- past words agreeing with it, or genitives (in
        // nova corpora, in Caesaris castra); or the poets' noun-preposition-adjective (corpore in novō)
        const ob = words[w.ob], p = pos.get(w.id);
        let ok = pos.get(ob.id) === p - 1 && order[p + 1] && agrees(order[p + 1], ob);
        for (let j = p + 1; !ok && j <= p + 3 && j < order.length; j++) {
          const x = order[j];
          if (x.id === ob.id) ok = true;
          else if (!(agrees(x, ob) || (x.ag && x.ag[2] === 'g' && !(ob.ag && ob.ag[2] === 'g')))) break;
        }
        if (!ok) faults.push({ rule: 'prep', words: [w, ob] });
      }
      if (w.r === 'n' && w.to !== undefined) {
        // nōn before its word, or before a finite verb of its clause
        const to = words[w.to], p = pos.get(w.id);
        const verbs = words.filter((v) => v.vb && K(v) === K(w));
        if (p > pos.get(to.id) && !verbs.some((v) => pos.get(v.id) > p)) faults.push({ rule: 'neg', words: [w, to] });
      }
      if (w.r === 'o' && w.to !== undefined) {
        const to = words[w.to];
        if (pos.get(w.id) > pos.get(to.id)) faults.push({ rule: 'voc', words: [w, to] });
      }
      // sī quis, nē quis: the indefinite after its sī
      if (w.r === 'x' && w.to !== undefined) {
        const to = words[w.to];
        if (pos.get(w.id) < pos.get(to.id)) faults.push({ rule: 'indef', words: [w, to] });
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
      if (w.r === 'x' && w.to !== undefined) join(words[w.to], w);       // sī quam stays together
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

  // One shuffled order of one group, by the strict rules. Its opener goes first -- even where the
  // poet put some of its clause's words in front of it (never vīdistis sī quam...: owner, 2026-11-12).
  function shuffleGroup(words, group, rnd) {
    const ch = chunks(words, group);
    const fixed = [];
    const op = group.find((w) => w.r === 'c');
    const oc = op ? ch.findIndex((c) => c.includes(op)) : -1;
    if (oc >= 0) fixed.push(ch.splice(oc, 1)[0]);
    const p2 = ch.findIndex((c) => c[0].r === 'p2');
    const second = p2 >= 0 ? ch.splice(p2, 1)[0] : null;
    shuffle(ch, rnd);
    let out = fixed.concat(ch);
    if (second) out.splice(Math.min(1, out.length), 0, second);
    return [].concat(...out);
  }

  const sameOrder = (a, b) => a.length === b.length && a.every((w, i) => w.id === b[i].id);

  // A jumble: an order in which NO line scans (or, failing that, not every line), that keeps to the
  // strict rules and differs from the poet's. Draws `tries` candidates and picks one, leaning toward
  // the plainer. null if none. In a sentence a group may run over a line break, so its words are
  // dealt across the lines: the counts per line stay the poet's.
  function jumble(item, rnd, tries) {
    rnd = rnd || Math.random;
    const words = wordsOf(item);
    const groups = [];
    words.forEach((w) => {
      if (!groups.length || groups[groups.length - 1][0].g !== w.g) groups.push([]);
      groups[groups.length - 1].push(w);
    });
    let cands = [];
    for (let t = 0; t < (tries || 60); t++) {
      const gs = groups.map((g) => (g.length > 1 ? shuffleGroup(words, g, rnd) : g));
      const order = [].concat(...gs);
      if (sameOrder(order, words)) continue;
      // how many lines still scan (even with a 5th-foot spondee)
      const scanning = splitRows(item, order).filter((r) => feet(scan(r).pattern, true)).length;
      if (scanning === rowCounts(item).length) continue;
      if (looseFaults(words, order).length) continue;
      cands.push({ order, scanning, score: gs.reduce((s, g) => s + plainness(g), 0) });
    }
    if (!cands.length) return null;
    if (cands.some((c) => !c.scanning)) cands = cands.filter((c) => !c.scanning);
    const ws = cands.map((c) => Math.exp(c.score + rnd() * 0.5));
    let r = rnd() * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < cands.length; i++) if ((r -= ws[i]) < 0) return cands[i].order;
    return cands[cands.length - 1].order;
  }

  // The verdict on an answer: { right, exact, meter, faults }. `counts`: words per line, as the
  // student left them (the poet's, if not given). Exact = the poet's words in the poet's lines.
  function judge(item, order, counts) {
    const words = wordsOf(item);
    const m = meter(item, order, counts);
    const faults = looseFaults(words, order);
    const poetCounts = rowCounts(item);
    const sameLines = !counts || (counts.length === poetCounts.length && counts.every((n, i) => n === poetCounts[i]));
    // exact: the poet's WORDS in his order (two tiles of one word, sīc ... sīc, may change places)
    const sameWords = order.length === words.length && order.every((w, i) => w.w === words[i].w);
    return { right: m.ok && !faults.length, exact: sameWords && sameLines, meter: m, faults };
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

  return { rowsOf, rowCounts, wordsOf, splitRows, scan, scanItem, feet, meter, looseFaults, chunks, jumble,
    judge, seeded, sameOrder };
});
