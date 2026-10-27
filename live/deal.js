// deal.js -- the rules of the team game in "devices" mode, with no screen. AGPL-3.0 (see COPYRIGHT.md).
//
// A team is shown ONE card from one column (a name, a definition, or a Latin example) and must find the
// matching cards in the other two columns, which are split across the teammates' phones so that no
// one phone can answer alone. This file decides everything except the drawing:
//
//   makeRound(pool, opts)  pick the prompt, the two right cards, and believable wrong ones (decoys)
//   hands(round, uids)     deal the cards to the teammates; the two right cards land on different phones
//   judge(round, card)     grade a card the way the host will
//
// It is pure logic: no DOM, no storage, no network, no clock. Every choice goes through one random
// source, so a seed reproduces a round exactly (that is how the tests can run thousands of rounds).
// It works as `window.Deal` in a page and as `require("./deal.js")` in Node.
//
// THE WRONG-ANSWER RULES are the heart of it. data/devices.json marks, for each example, the other
// devices that SAME example also illustrates (`also`): a line of Ovid can be a simile and a chiasmus
// at once. So an example is a right answer for every device it is -- not only the one it is filed under
// -- and a decoy must never be one of those. The teacher's quiz (the toolkit's quiz.py `draw()`)
// holds to "no example beside a device it also is"; this file holds to the same rule, and goes one
// step further: a decoy shares no device with ANY other card of the round (the right cards share the
// prompt's, of course), so there is no tidy-looking wrong pair -- a decoy definition and a decoy
// example for the same device -- for a team to be lured into.
//   - a decoy example is not the prompt's device's, and does not list it in `also`;
//   - when the prompt is an example, the decoy names and definitions leave out that example's device
//     and every device in its `also`;
//   - when a right example lists other devices in `also`, no decoy name or definition is one of them;
//   - no two decoys share a device (hence none twice in a column), and no Latin line is used twice.
//
// WHAT TO KEEP IN MIND WHEN WRITING A ROUND TO THE DATABASE
//   - The round object holds the answers (`answers`). Never write it; write only cards, from `hands`,
//     and the prompt. The cards themselves carry no flag saying which is right (but a card's `key` and
//     `id` name its device, so a student reading their own hand could compare them with the prompt's;
//     SPEC.md calls cheating a non-goal, because the answers are in the public data files anyway).
//   - Realtime Database turns arrays into objects and drops EMPTY arrays: a line with nothing in bold
//     arrives with no `b` at all. Read a line's bold ranges as `line.b || []`. The test file runs a
//     card through a model of that to prove the card still draws.
//   - Card ids hold ".", "/" and spaces ("ex:intertext:Met. 8.211 / Aen. 6.33"), which are not allowed
//     in a database KEY. Use an id as a value, never as a key.
//   - A team needs at least as many cards as members (a card is never dealt twice in a team): that is
//     2 + 2 x decoys, so six players fit with the default two decoys. For a bigger team ask for more
//     decoys; with too few cards the last teammates get an empty hand rather than an error.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Deal = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const KINDS = ["name", "definition", "example"];       // the three columns, in the order they are shown
  const KIND_OF_PREFIX = { name: "name", def: "definition", ex: "example" };
  const DECOYS = 2;                                       // wrong cards per column, by default
  const HAND = 4;                                         // most cards on one phone, by default
  const TRIES = 40;                                       // fresh attempts at a full set of decoys

  // ---- a small seeded random source -------------------------------------------------------------
  // mulberry32: four lines, good enough for shuffling cards, the same on every JavaScript engine.
  function seeded(seed) {
    let h;
    if (Number.isInteger(seed)) h = seed >>> 0;
    else {                                                // any other seed (a string, say) is hashed
      h = 2166136261;
      for (const ch of String(seed)) h = Math.imul(h ^ ch.codePointAt(0), 16777619);
      h >>>= 0;
    }
    return function () {
      h = (h + 0x6D2B79F5) | 0;
      let t = Math.imul(h ^ (h >>> 15), 1 | h);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // `rng` may be a function returning [0,1), a seed (number or string), or absent (Math.random).
  function source(rng) {
    if (typeof rng === "function") return rng;
    if (rng === undefined || rng === null) return Math.random;
    return seeded(rng);
  }

  const below = (rng, n) => Math.min(n - 1, Math.floor(rng() * n));

  function shuffled(rng, items) {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = below(rng, i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---- a card in its transport form -------------------------------------------------------------
  // Flat and plain, because it is written to the database and drawn on a phone. One Latin line is
  // `{ t, b }`: the text, and the bold stretches as [start, end) offsets into `t` (UTF-16 units, which
  // is how JavaScript indexes a string; the Latin is precomposed, so macrons are one unit each).
  function latinLine(segments) {
    let t = "";
    const b = [];
    for (const [text, bold] of segments) {
      if (bold && text) {
        const last = b[b.length - 1];
        if (last && last[1] === t.length) last[1] = t.length + text.length;   // bold runs that touch are one
        else b.push([t.length, t.length + text.length]);
      }
      t += text;
    }
    return { t, b };
  }

  function card(dev, kind, ex) {
    if (kind === "name") return { id: `name:${dev.key}`, kind, key: dev.key, text: dev.name };
    if (kind === "definition") return { id: `def:${dev.key}`, kind, key: dev.key, text: dev.definition };
    return {
      id: `ex:${dev.key}:${ex.cite}`, kind: "example", key: dev.key, cite: ex.cite,
      lines: ex.latin.map(latinLine), en: ex.english,
    };
  }

  // ---- what each card means ---------------------------------------------------------------------
  // `devs` of a card = the devices it is a right answer for: a name or definition, its own; an example,
  // its own AND everything in its `also`.
  const alsoOf = (ex) => (Array.isArray(ex.also) ? ex.also : []);
  const devsOf = (dev, ex) => (ex ? [dev.key, ...alsoOf(ex).filter((k) => k !== dev.key)] : [dev.key]);
  // The Latin an example shows, for "no line used twice": the lines it cites, and the words themselves
  // (the two can differ in how they are cut, so both are checked).
  const lineKeys = (ex) => [
    ...(ex.lines && ex.lines.length ? ex.lines : [ex.cite]).map((l) => `c:${l}`),
    ...ex.latin.map((l) => `t:${l.map((s) => s[0]).join("")}`),
  ];

  // One index per pool: devices by key, and every card id the pool can make -> { kind, devs }.
  const INDEX = new WeakMap();
  function indexOf(pool) {
    let ix = INDEX.get(pool);
    if (ix) return ix;
    if (!Array.isArray(pool) || !pool.length) throw new TypeError("Deal: the pool must be the non-empty devices array");
    ix = { byKey: new Map(), byId: new Map() };
    for (const dev of pool) {
      if (!dev || !dev.key || !Array.isArray(dev.examples) || !dev.examples.length) {
        throw new TypeError("Deal: every device needs a key and at least one example");
      }
      ix.byKey.set(dev.key, dev);
      ix.byId.set(`name:${dev.key}`, { kind: "name", devs: devsOf(dev) });
      ix.byId.set(`def:${dev.key}`, { kind: "definition", devs: devsOf(dev) });
      for (const ex of dev.examples) {
        ix.byId.set(`ex:${dev.key}:${ex.cite}`, { kind: "example", devs: devsOf(dev, ex) });
      }
    }
    INDEX.set(pool, ix);
    return ix;
  }

  // What each round means, kept out of the round object itself (which is a plain record the host may
  // copy): the pool's index, and the devices the prompt stands for. A copy that lost it is still judged
  // by its recorded answers.
  const MEANING = new WeakMap();

  // ---- a round ----------------------------------------------------------------------------------
  function makeRound(pool, opts) {
    opts = opts || {};
    const ix = indexOf(pool);
    const rng = source(opts.rng);
    const want = opts.decoys === undefined ? DECOYS : opts.decoys;
    if (!Number.isInteger(want) || want < 0) throw new RangeError("Deal.makeRound: decoys must be a whole number, 0 or more");
    if (opts.promptKind !== undefined && !KINDS.includes(opts.promptKind)) {
      throw new RangeError(`Deal.makeRound: promptKind must be one of ${KINDS.join(", ")}`);
    }
    const kind = opts.promptKind === undefined ? KINDS[below(rng, KINDS.length)] : opts.promptKind;
    const dev = opts.key === undefined ? pool[below(rng, pool.length)] : ix.byKey.get(opts.key);
    if (!dev) throw new RangeError(`Deal.makeRound: no device with the key ${JSON.stringify(opts.key)}`);
    let ex;
    if (opts.cite === undefined) ex = dev.examples[below(rng, dev.examples.length)];
    else {
      ex = dev.examples.find((e) => e.cite === opts.cite);
      if (!ex) throw new RangeError(`Deal.makeRound: ${dev.key} has no example cited ${JSON.stringify(opts.cite)}`);
    }

    // The right example is in the round either as the prompt or as an answer. Whatever devices it is
    // keep out of every decoy (a decoy that was one of them would be a second right answer, or a pair
    // the right example sits too close to).
    const columns = KINDS.filter((k) => k !== kind);
    const rightDevs = devsOf(dev, ex);
    const meant = kind === "example" ? rightDevs : [dev.key];     // what the prompt can be read as

    // One try at a full set of decoys. The columns take turns, so none of them uses up the devices
    // before the others have had theirs (the example column, which takes the most, goes first).
    const attempt = () => {
      const barred = new Set(rightDevs);
      const lines = new Set(lineKeys(ex));
      const order = shuffled(rng, pool);                    // the order the devices are tried in
      const picked = {};
      for (const col of columns) picked[col] = [];
      const take = (col) => {
        for (const d of order) {
          if (col === "example") {
            const fit = shuffled(rng, d.examples).find((e) => !devsOf(d, e).some((k) => barred.has(k))
              && !lineKeys(e).some((l) => lines.has(l)));
            if (!fit) continue;
            devsOf(d, fit).forEach((k) => barred.add(k));
            lineKeys(fit).forEach((l) => lines.add(l));
            return card(d, "example", fit);
          }
          if (barred.has(d.key)) continue;
          barred.add(d.key);
          return card(d, col);
        }
        return null;                                        // nothing in the pool fits any more
      };
      const open = columns.slice().sort((a, b) => (b === "example") - (a === "example"));
      for (let i = 0; i < want && open.length; i++) {
        for (const col of open.slice()) {
          const c = take(col);
          if (c) picked[col].push(c);
          else open.splice(open.indexOf(col), 1);
        }
      }
      return { picked, least: Math.min(...columns.map((c) => picked[c].length)) };
    };

    // A fresh try when the first draw dead-ends. If none gets there (a request for far more decoys
    // than the pool can supply without breaking the rules), the fullest try is kept, with the same
    // number in each column: fewer decoys, never a broken rule.
    let best = attempt();
    for (let i = 1; i < TRIES && best.least < want; i++) {
      const next = attempt();
      if (next.least > best.least) best = next;
    }

    const prompt = card(dev, kind, ex);
    const answers = {};
    const decoys = {};
    for (const col of columns) {
      answers[col] = col === "example" ? card(dev, "example", ex) : card(dev, col);
      decoys[col] = best.picked[col].slice(0, best.least);
    }
    const round = { id: prompt.id, key: dev.key, promptKind: kind, prompt, answers, decoys };
    MEANING.set(round, { ix, meant: new Set(meant) });
    return round;
  }

  // ---- grading ----------------------------------------------------------------------------------
  // A card is right when it is in the other columns and is one of the devices the prompt stands for --
  // judged by what the card IS, not by where this round happened to put it. So an example filed under
  // one device is right beside the name of any device it lists in `also`, whichever round it turns up in.
  // Accepts a card, or just its id (what a tap boils down to).
  function judge(round, which) {
    const id = typeof which === "string" ? which : which && which.id;
    const m = MEANING.get(round);
    const entry = m && m.ix.byId.get(id);
    if (entry) {
      return { ok: entry.kind !== round.promptKind && entry.devs.some((k) => m.meant.has(k)), column: entry.kind };
    }
    // no meaning on record (a round that was copied) or not a card of this pool: only the recorded
    // answers count
    const prefix = typeof id === "string" ? id.split(":", 1)[0] : "";
    return {
      ok: Object.keys(round.answers).some((c) => round.answers[c].id === id),
      column: KIND_OF_PREFIX[prefix] || null,
    };
  }

  // ---- hands ------------------------------------------------------------------------------------
  // The cards of one round, dealt to one team. Not every card always fits: a team of one holds `handSize`
  // cards, so it gets both right cards and as many decoys as fit, taken from the two columns by turns.
  function hands(round, teamUids, opts) {
    opts = opts || {};
    const rng = source(opts.rng);
    const size = opts.handSize === undefined ? HAND : opts.handSize;
    if (!Number.isInteger(size) || size < 1) throw new RangeError("Deal.hands: handSize must be a whole number, 1 or more");
    const uids = [...new Set(teamUids)];                // a player is on a team once
    const out = {};
    for (const u of uids) out[u] = [];
    const n = uids.length;
    if (!n) return out;
    if (n === 1 && size < 2) throw new RangeError("Deal.hands: a team of one needs a handSize of at least 2 to hold both right cards");

    const cols = Object.keys(round.answers);
    const right = cols.map((c) => round.answers[c]);
    const spare = cols.map((c) => shuffled(rng, round.decoys[c]));
    const room = n * size - right.length;               // seats left once the right cards have theirs
    const dealt = [];
    for (let i = 0, c = below(rng, cols.length); dealt.length < room; i++) {
      const pile = spare[(c + i) % cols.length];
      if (pile.length) dealt.push(pile.shift());
      else if (spare.every((p) => !p.length)) break;    // every decoy is out
    }
    const total = right.length + dealt.length;

    // as even as possible; the longer hands go to random players
    const order = shuffled(rng, uids);
    const counts = order.map((_, i) => Math.floor(total / n) + (i < total % n ? 1 : 0));
    const seated = order.map((_, i) => i).filter((i) => counts[i] > 0);
    let at;
    if (n === 1) at = [0, 0];                           // a team of one holds both right cards
    else at = shuffled(rng, seated).slice(0, right.length);   // otherwise on different phones
    const held = order.map(() => []);
    right.forEach((c, i) => held[at[i]].push(c));
    const rest = shuffled(rng, dealt);
    held.forEach((h, i) => { while (h.length < counts[i]) h.push(rest.pop()); });
    order.forEach((u, i) => { out[u] = shuffled(rng, held[i]); });
    return out;
  }

  return { makeRound, hands, judge, card, seeded, KINDS };
});
