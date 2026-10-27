// deal.test.js -- tests for live/deal.js, the team-dealing rules of the live "devices" mode.
// Run:  node --test tests/deal.test.js        (Node's own test runner; nothing to install, no emulator)
//
// Most of these are PROPERTY tests: they build thousands of rounds from the real data/devices.json --
// every device, every kind of prompt, many seeds -- and check each against the rules, rather than
// checking a few hand-picked rounds. The checks use their own reading of the data (the ORACLE below),
// written separately from deal.js, so a rule that deal.js got wrong cannot also be wrong here.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Deal = require("../live/deal.js");
const POOL = require("../data/devices.json").devices;

const KINDS = ["name", "definition", "example"];
const SEEDS = 200;
const BY_KEY = new Map(POOL.map((d) => [d.key, d]));
const EXAMPLES = POOL.flatMap((d) => d.examples.map((ex) => ({ dev: d, ex })));
const WITH_ALSO = EXAMPLES.filter(({ ex }) => ex.also.length);

// ---- the oracle: what the data says, read straight from the file --------------------------------------
const exampleData = (card) => BY_KEY.get(card.key).examples.find((e) => e.cite === card.cite);
// the devices a card is a right answer for: its own, and for an example every one in its `also`
const devsOf = (card) => (card.kind === "example" ? [card.key, ...exampleData(card).also] : [card.key]);
const meant = (round) => (round.promptKind === "example" ? devsOf(round.prompt) : [round.key]);
const oracleRight = (round, card) => card.kind !== round.promptKind && devsOf(card).some((k) => meant(round).includes(k));
const columnsOf = (kind) => KINDS.filter((k) => k !== kind);
const cardsOf = (round) => [
  ...Object.values(round.answers).map((card) => ({ card, role: "answer" })),
  ...Object.values(round.decoys).flat().map((card) => ({ card, role: "decoy" })),
];

// reports only when the check fails, so a million passing checks cost no string building
function must(ok, message) {
  if (!ok) assert.fail(typeof message === "function" ? message() : message);
}

// ---- every rule a round must keep ------------------------------------------------------------------------
// `want` is the number of decoys asked for in each column (null: do not check the count).
function checkRound(round, { key, kind, want, cite }, ctx) {
  const say = (m) => () => `${ctx}: ${m}`;
  must(JSON.stringify(Object.keys(round).sort()) === '["answers","decoys","id","key","prompt","promptKind"]',
    say(`round has the keys ${Object.keys(round)}`));
  must(round.key === key && round.promptKind === kind, say("round key / promptKind"));
  must(typeof round.id === "string" && round.id, say("round id"));
  const cols = columnsOf(kind);
  must(JSON.stringify(Object.keys(round.answers).sort()) === JSON.stringify(cols.slice().sort()), say("answers columns"));
  must(JSON.stringify(Object.keys(round.decoys).sort()) === JSON.stringify(cols.slice().sort()), say("decoys columns"));
  must(round.prompt.kind === kind && round.prompt.key === key, say("prompt card"));

  for (const col of cols) {
    const a = round.answers[col];
    must(a.kind === col && a.key === key, say(`the ${col} answer is not the device's own`));
    if (want !== null) must(round.decoys[col].length === want, say(`${col} has ${round.decoys[col].length} decoys, wanted ${want}`));
    must(round.decoys[col].length > 0 || want === 0, say(`${col} has no decoys`));
    const seen = new Set();
    for (const d of round.decoys[col]) {
      must(d.kind === col, say(`a ${d.kind} card among the ${col} decoys`));
      must(d.key !== key, say(`a decoy ${col} (${d.id}) is the prompt's own device`));
      must(!seen.has(d.key), say(`two ${col} decoys from ${d.key}`));
      seen.add(d.key);
      if (col === "example") {
        must(!exampleData(d).also.includes(key), say(`the decoy ${d.id} also illustrates the prompt's device ${key}`));
      } else if (kind === "example") {
        must(!meant(round).includes(d.key), say(`the decoy ${col} ${d.key} is one of the devices the prompt example is (${meant(round)})`));
      }
    }
  }
  if (cite) {
    const ex = kind === "example" ? round.prompt : round.answers.example;
    must(ex.cite === cite, say(`wanted the example ${cite}, got ${ex.cite}`));
  }

  // no Latin line twice: the cited lines, and the words themselves
  const examples = [round.prompt, ...Object.values(round.answers), ...Object.values(round.decoys).flat()]
    .filter((c) => c.kind === "example");
  const cited = examples.flatMap((c) => exampleData(c).lines);
  must(new Set(cited).size === cited.length, say(`a cited line is used twice: ${cited}`));
  const words = examples.flatMap((c) => c.lines.map((l) => l.t));
  must(new Set(words).size === words.length, say("the same Latin text is used twice"));

  // every card of the round is a different card
  const all = [round.prompt, ...cardsOf(round).map((x) => x.card)];
  must(new Set(all.map((c) => c.id)).size === all.length, say("a card id repeats within the round"));

  // no example beside a device it also is: a decoy shares no device with any other card of the round
  // (the right cards share the prompt's, as they should)
  const placed = [{ card: round.prompt, role: "prompt" }, ...cardsOf(round)];
  for (const x of placed) for (const y of placed) {
    if (x === y || (x.role !== "decoy" && y.role !== "decoy")) continue;
    const shared = devsOf(x.card).filter((k) => devsOf(y.card).includes(k));
    must(!shared.length, say(`${x.card.id} and ${y.card.id} are both ${shared}`));
  }

  // grading: judge agrees with the oracle on every card, and a round never holds two right answers
  for (const col of cols) {
    const colCards = [round.answers[col], ...round.decoys[col]];
    const right = colCards.filter((c) => Deal.judge(round, c).ok);
    must(right.length === 1 && right[0] === round.answers[col],
      say(`${col}: ${right.length} cards judged right (${right.map((c) => c.id)})`));
    for (const c of colCards) {
      must(oracleRight(round, c) === (c === round.answers[col]), say(`${c.id}: the oracle disagrees with the answer key`));
      must(Deal.judge(round, c).column === col, say(`${c.id}: judged in the wrong column`));
    }
  }
  must(!Deal.judge(round, round.prompt).ok, say("the prompt judged right"));
}

// judge against every card the pool can make, not just the ones in the round
function checkJudgeEverywhere(round, ctx) {
  const right = { name: 0, definition: 0, example: 0 };
  for (const dev of POOL) {
    for (const card of [Deal.card(dev, "name"), Deal.card(dev, "definition"), ...dev.examples.map((e) => Deal.card(dev, "example", e))]) {
      const got = Deal.judge(round, card);
      must(got.ok === oracleRight(round, card), () => `${ctx}: judge says ${got.ok} for ${card.id}, the data says ${!got.ok}`);
      if (got.ok) right[card.kind]++;
    }
  }
  must(right[round.promptKind] === 0, () => `${ctx}: cards judged right in the prompt's own column`);
  for (const col of columnsOf(round.promptKind)) must(right[col] >= 1, () => `${ctx}: no right ${col} card`);
}

// ---- the rules of a hand --------------------------------------------------------------------------------
function checkHands(round, team, dealt, handSize, ctx) {
  const say = (m) => () => `${ctx}: ${m}`;
  const n = new Set(team).size;
  must(JSON.stringify(Object.keys(dealt).sort()) === JSON.stringify([...new Set(team)].sort()), say("hands are not exactly the team"));
  const roundCards = new Map(cardsOf(round).map((x) => [x.card.id, x.card]));
  const rights = Object.values(round.answers);
  const holder = new Map();                       // card id -> uid
  let count = 0;
  for (const [uid, hand] of Object.entries(dealt)) {
    must(hand.length <= handSize, say(`${uid} holds ${hand.length} cards, more than ${handSize}`));
    for (const c of hand) {
      must(roundCards.get(c.id) === c, say(`${c.id} is not a card of this round`));
      must(!holder.has(c.id), say(`${c.id} is dealt twice in one team`));
      holder.set(c.id, uid);
      count++;
    }
  }
  const available = roundCards.size;
  must(count === Math.min(available, n * handSize), say(`${count} cards dealt of ${available} (${n} players x ${handSize})`));
  if (available >= n) for (const [uid, hand] of Object.entries(dealt)) must(hand.length > 0, say(`${uid} has an empty hand`));
  const sizes = Object.values(dealt).map((h) => h.length);
  if (available >= n) must(Math.max(...sizes) - Math.min(...sizes) <= 1, say(`hands are uneven: ${sizes}`));
  must(rights.every((c) => holder.has(c.id)), say("a right card was not dealt"));
  const [h1, h2] = rights.map((c) => holder.get(c.id));
  if (n >= 2) must(h1 !== h2, say(`both right cards are on ${h1}'s phone`));
  else must(h1 === h2, say("a team of one must hold both right cards"));
}

// =====================================================================================================
test("the pool is what the logic assumes", () => {
  assert.ok(POOL.length >= 12, "too few devices for a round");
  for (const dev of POOL) {
    assert.ok(dev.name && dev.definition && dev.examples.length, `${dev.key} is incomplete`);
    for (const ex of dev.examples) {
      assert.ok(Array.isArray(ex.also) && Array.isArray(ex.lines) && ex.lines.length, `${dev.key} ${ex.cite}`);
      for (const k of ex.also) {
        assert.ok(BY_KEY.has(k), `${dev.key} ${ex.cite}: also names an unknown device ${k}`);
        assert.notEqual(k, dev.key, `${dev.key} ${ex.cite}: also names its own device`);
      }
    }
  }
});

test("the seeded random source repeats, spreads, and keeps seeds apart", () => {
  const a = Deal.seeded(7), b = Deal.seeded(7), c = Deal.seeded(8);
  const xs = Array.from({ length: 2000 }, a);
  assert.deepEqual(xs, Array.from({ length: 2000 }, b));
  assert.notDeepEqual(xs.slice(0, 5), Array.from({ length: 5 }, c));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(mean > 0.45 && mean < 0.55, `mean ${mean}`);
  assert.deepEqual(Array.from({ length: 3 }, Deal.seeded("class 7")), Array.from({ length: 3 }, Deal.seeded("class 7")));
  assert.notDeepEqual(Array.from({ length: 3 }, Deal.seeded("class 7")), Array.from({ length: 3 }, Deal.seeded("class 8")));
});

// ---- cards -----------------------------------------------------------------------------------------------
test("a card has exactly the transport form: flat, with stable ids and no answer flag", () => {
  const byKind = { name: ["id", "key", "kind", "text"], definition: ["id", "key", "kind", "text"],
    example: ["cite", "en", "id", "key", "kind", "lines"] };
  for (const dev of POOL) {
    const cards = [Deal.card(dev, "name"), Deal.card(dev, "definition"), ...dev.examples.map((e) => Deal.card(dev, "example", e))];
    for (const c of cards) {
      assert.deepEqual(Object.keys(c).sort(), byKind[c.kind].slice().sort(), c.id);
      assert.equal(c.key, dev.key);
      assert.deepEqual(JSON.parse(JSON.stringify(c)), c, `${c.id} does not survive JSON (an undefined, perhaps)`);
    }
    assert.equal(cards[0].id, `name:${dev.key}`);
    assert.equal(cards[0].text, dev.name);
    assert.equal(cards[1].id, `def:${dev.key}`);
    assert.equal(cards[1].text, dev.definition);
    dev.examples.forEach((e, i) => {
      const c = cards[2 + i];
      assert.equal(c.id, `ex:${dev.key}:${e.cite}`);
      assert.equal(c.cite, e.cite);
      assert.equal(c.en, e.english);
      assert.equal(c.lines.length, e.latin.length);
    });
  }
  // the ids the plan names, spelled out
  const simile = BY_KEY.get("simile");
  assert.equal(Deal.card(simile, "name").id, "name:simile");
  assert.equal(Deal.card(simile, "definition").id, "def:simile");
  assert.equal(Deal.card(simile, "example", simile.examples[0]).id, "ex:simile:Met. 8.213-214");
});

test("an example card's bold ranges rebuild the original Latin exactly", () => {
  for (const { dev, ex } of EXAMPLES) {
    const c = Deal.card(dev, "example", ex);
    ex.latin.forEach((segments, i) => {
      const text = segments.map((s) => s[0]).join("");
      assert.equal(c.lines[i].t, text, `${c.id} line ${i}`);
      const mask = Array.from(text, () => false);
      let at = 0;
      for (const [t, bold] of segments) { if (bold) for (let j = 0; j < t.length; j++) mask[at + j] = true; at += t.length; }
      const got = Array.from(text, () => false);
      for (const pair of c.lines[i].b) {
        assert.ok(Array.isArray(pair) && pair.length === 2 && pair[0] < pair[1], `${c.id}: bad range ${pair}`);
        for (let j = pair[0]; j < pair[1]; j++) got[j] = true;
      }
      assert.deepEqual(got, mask, `${c.id} line ${i}`);
      // ranges are in order and never touch (touching bold runs are one range)
      c.lines[i].b.forEach((p, j) => { if (j) assert.ok(c.lines[i].b[j - 1][1] < p[0], `${c.id}: ranges overlap or touch`); });
    });
  }
  // a hand-made case, so the merge of touching runs is tested on its own
  const dev = { key: "x", name: "x", definition: "x", examples: [] };
  const made = Deal.card(dev, "example", { cite: "T 1", english: "e", latin: [[["ab", true], ["cd", true], ["ef", false], ["gh", true]]] });
  assert.deepEqual(made.lines, [{ t: "abcdefgh", b: [[0, 4], [6, 8]] }]);
});

test("a card still draws after a round trip through Realtime Database", () => {
  // The database turns arrays into objects with numeric keys and drops empty ones. This models both,
  // so the day a card is written, the phone has to read `line.b || []`.
  const toDb = (v) => {
    if (Array.isArray(v)) v = Object.fromEntries(v.map((x, i) => [i, x]));
    if (v && typeof v === "object") {
      const out = {};
      for (const [k, x] of Object.entries(v)) { const y = toDb(x); if (y !== undefined) out[k] = y; }
      return Object.keys(out).length ? out : undefined;
    }
    return v;
  };
  const fromDb = (v) => {
    if (!v || typeof v !== "object") return v;
    const keys = Object.keys(v);
    const out = Object.fromEntries(keys.map((k) => [k, fromDb(v[k])]));
    return keys.every((k, i) => String(i) === k) ? keys.map((k) => out[k]) : out;
  };
  let sawEmpty = false;
  for (const { dev, ex } of EXAMPLES) {
    const sent = Deal.card(dev, "example", ex);
    const got = fromDb(toDb(sent));
    assert.equal(got.lines.length, sent.lines.length);
    sent.lines.forEach((line, i) => {
      assert.equal(got.lines[i].t, line.t);
      if (!line.b.length) { sawEmpty = true; assert.equal(got.lines[i].b, undefined); }
      assert.deepEqual(got.lines[i].b || [], line.b, `${sent.id} line ${i}`);
    });
    assert.deepEqual([got.id, got.cite, got.en], [sent.id, sent.cite, sent.en]);
  }
  assert.ok(sawEmpty, "no example has an unbolded line, so the empty-array case went untested");
});

// ---- the property tests ----------------------------------------------------------------------------------
test(`every device x every kind of prompt x ${SEEDS} seeds: all round rules, and every team size 1-5 deals right`, () => {
  for (const dev of POOL) for (const kind of KINDS) {
    for (let seed = 0; seed < SEEDS; seed++) {
      const ctx = `${dev.key}/${kind}/seed ${seed}`;
      const round = Deal.makeRound(POOL, { promptKind: kind, key: dev.key, rng: seed });
      checkRound(round, { key: dev.key, kind, want: 2 }, ctx);
      if (seed % 10 === 0) checkJudgeEverywhere(round, ctx);
      for (let size = 1; size <= 5; size++) {
        const team = Array.from({ length: size }, (_, i) => `u${i}`);
        const dealt = Deal.hands(round, team, { rng: seed * 7 + size });
        checkHands(round, team, dealt, 4, `${ctx}/team ${size}`);
      }
    }
  }
});

test("every example forced as the right card, every kind of prompt, 40 seeds", () => {
  for (const { dev, ex } of EXAMPLES) for (const kind of KINDS) {
    for (let seed = 0; seed < 40; seed++) {
      const ctx = `${dev.key}/${ex.cite}/${kind}/seed ${seed}`;
      const round = Deal.makeRound(POOL, { promptKind: kind, key: dev.key, cite: ex.cite, rng: seed });
      checkRound(round, { key: dev.key, kind, want: 2, cite: ex.cite }, ctx);
      if (seed % 10 === 0) checkJudgeEverywhere(round, ctx);
    }
  }
});

test("with no device or kind asked for, they are chosen at random and the rules still hold", () => {
  const keys = new Set(), kinds = new Set();
  for (let seed = 0; seed < 600; seed++) {
    const round = Deal.makeRound(POOL, { rng: seed });
    keys.add(round.key);
    kinds.add(round.promptKind);
    checkRound(round, { key: round.key, kind: round.promptKind, want: 2 }, `random/seed ${seed}`);
  }
  assert.equal(kinds.size, 3);
  assert.equal(keys.size, POOL.length, "some devices are never chosen as the prompt");
});

// ---- the `also` field ------------------------------------------------------------------------------------
test(`${WITH_ALSO.length} examples have a non-empty \`also\`; each follows the rules in every role it can play`, () => {
  assert.ok(WITH_ALSO.length >= 20, "the data lost its `also` marks?");
  for (const { dev, ex } of WITH_ALSO) {
    const exCard = Deal.card(dev, "example", ex);
    const barred = [dev.key, ...ex.also];
    for (let seed = 0; seed < SEEDS; seed++) {
      const ctx = `${dev.key}/${ex.cite}/seed ${seed}`;

      // 1. as the PROMPT: no decoy name or definition is the example's device or anything in its `also`
      const asPrompt = Deal.makeRound(POOL, { promptKind: "example", key: dev.key, cite: ex.cite, rng: seed });
      assert.equal(asPrompt.prompt.id, exCard.id);
      for (const col of ["name", "definition"]) {
        for (const d of asPrompt.decoys[col]) assert.ok(!barred.includes(d.key), `${ctx}: ${col} decoy ${d.key} is ${barred}`);
      }

      // 2. as the RIGHT example: no decoy name or definition (the other column) is one of its `also`
      for (const kind of ["name", "definition"]) {
        const asRight = Deal.makeRound(POOL, { promptKind: kind, key: dev.key, cite: ex.cite, rng: seed });
        assert.equal(asRight.answers.example.id, exCard.id);
        const other = columnsOf(kind).find((c) => c !== "example");
        for (const d of asRight.decoys[other]) assert.ok(!barred.includes(d.key), `${ctx}: ${other} decoy ${d.key} sits beside an example that is also it`);
        // and no decoy example shares a device with it
        for (const d of asRight.decoys.example) {
          assert.ok(!devsOf(d).some((k) => barred.includes(k)), `${ctx}: decoy ${d.id} overlaps ${barred}`);
        }
      }

      // 3. as a DECOY candidate: when the prompt is a device the example also is, it is never a decoy
      for (const target of ex.also) for (const kind of ["name", "definition"]) {
        const round = Deal.makeRound(POOL, { promptKind: kind, key: target, rng: seed });
        const ids = cardsOf(round).map((x) => x.card.id);
        assert.ok(!ids.includes(exCard.id), `${ctx}: ${exCard.id} turned up in a round about ${target}`);
      }
    }

    // judge: the example is right beside each device it is, even though it is filed under one of them
    for (const target of barred) for (const kind of ["name", "definition"]) {
      const round = Deal.makeRound(POOL, { promptKind: kind, key: target, rng: 1 });
      assert.deepEqual(Deal.judge(round, exCard), { ok: true, column: "example" }, `${exCard.id} beside ${kind} of ${target}`);
    }
    // and with the example as the prompt, the name and definition of each device it is are right
    const asPrompt = Deal.makeRound(POOL, { promptKind: "example", key: dev.key, cite: ex.cite, rng: 1 });
    for (const target of barred) {
      assert.deepEqual(Deal.judge(asPrompt, Deal.card(BY_KEY.get(target), "name")), { ok: true, column: "name" }, `name of ${target}`);
      assert.deepEqual(Deal.judge(asPrompt, Deal.card(BY_KEY.get(target), "definition")), { ok: true, column: "definition" }, `def of ${target}`);
    }
  }
});

test("an `also` example is a perfectly good decoy for a device it is NOT", () => {
  // the rule keeps it out only beside its own devices: for any other prompt it should turn up
  const { dev, ex } = WITH_ALSO[0];
  const id = `ex:${dev.key}:${ex.cite}`;
  const barred = [dev.key, ...ex.also];
  let seen = 0;
  for (let seed = 0; seed < SEEDS; seed++) {
    const stranger = POOL.find((d, i) => !barred.includes(d.key) && i === seed % POOL.length) || POOL.find((d) => !barred.includes(d.key));
    const round = Deal.makeRound(POOL, { promptKind: "name", key: stranger.key, rng: seed });
    if (round.decoys.example.some((c) => c.id === id)) {
      seen++;
      assert.deepEqual(Deal.judge(round, id), { ok: false, column: "example" });
    }
  }
  assert.ok(seen > 0, `${id} is never used as a decoy`);
});

// ---- wrong answers: supply and variety --------------------------------------------------------------------
test("every device can yield up to 8 decoys per column, for every kind of prompt", () => {
  // the seven devices with one example (the suspects) included; if this ever fails, the message says which
  // (the pool can in fact give 9 for every device, but 8 leaves room for the data to change)
  for (let want = 0; want <= 8; want++) {
    for (const dev of POOL) for (const kind of KINDS) {
      for (let seed = 0; seed < 25; seed++) {
        const round = Deal.makeRound(POOL, { promptKind: kind, key: dev.key, decoys: want, rng: seed });
        checkRound(round, { key: dev.key, kind, want }, `decoys ${want}/${dev.key}/${kind}/seed ${seed}`);
      }
    }
  }
});

test("asked for more decoys than the pool can supply fairly, a round gives fewer, never a wrong one", () => {
  for (const dev of POOL) for (const kind of KINDS) {
    const round = Deal.makeRound(POOL, { promptKind: kind, key: dev.key, decoys: 50, rng: 3 });
    checkRound(round, { key: dev.key, kind, want: null }, `${dev.key}/${kind}`);
    for (const col of columnsOf(kind)) assert.ok(round.decoys[col].length >= 8 && round.decoys[col].length === round.decoys[columnsOf(kind)[0]].length, `${dev.key}/${kind}/${col}: only ${round.decoys[col].length}`);
  }
});

test("the decoys vary: the same prompt meets many different wrong cards", () => {
  for (const dev of [BY_KEY.get("simile"), BY_KEY.get("hyperbole"), BY_KEY.get("anaphora")]) {
    const seen = { name: new Set(), definition: new Set(), example: new Set() };
    for (let seed = 0; seed < 300; seed++) {
      const round = Deal.makeRound(POOL, { promptKind: "name", key: dev.key, rng: seed });
      for (const c of round.decoys.definition) seen.definition.add(c.id);
      for (const c of round.decoys.example) seen.example.add(c.id);
      const pr = Deal.makeRound(POOL, { promptKind: "example", key: dev.key, rng: seed });
      for (const c of pr.decoys.name) seen.name.add(c.id);
    }
    assert.ok(seen.definition.size >= 15, `${dev.key}: ${seen.definition.size} different decoy definitions`);
    assert.ok(seen.name.size >= 15, `${dev.key}: ${seen.name.size} different decoy names`);
    assert.ok(seen.example.size >= 25, `${dev.key}: ${seen.example.size} different decoy examples`);
  }
  // a device with several examples shows different ones as the right card
  const metaphor = BY_KEY.get("metaphor");
  const used = new Set();
  for (let seed = 0; seed < 100; seed++) used.add(Deal.makeRound(POOL, { promptKind: "name", key: "metaphor", rng: seed }).answers.example.cite);
  assert.equal(used.size, metaphor.examples.length);
});

test("a decoy is never a second right answer, checked by brute force over the whole pool", () => {
  for (const dev of POOL) for (const kind of KINDS) {
    for (let seed = 0; seed < 25; seed++) {
      const round = Deal.makeRound(POOL, { promptKind: kind, key: dev.key, rng: 1000 + seed });
      const cards = cardsOf(round);
      for (const col of columnsOf(kind)) {
        const ok = cards.filter((x) => x.card.kind === col && Deal.judge(round, x.card).ok);
        assert.equal(ok.length, 1, `${dev.key}/${kind}/${seed}/${col}: ${ok.map((x) => x.card.id)}`);
        assert.equal(ok[0].role, "answer");
      }
      assert.deepEqual(cards.filter((x) => x.card.kind === kind), [], "a card in the prompt's own column");
    }
  }
});

// ---- judge -----------------------------------------------------------------------------------------------
test("judge: takes a card or its id, names the column, and copes with strangers", () => {
  const round = Deal.makeRound(POOL, { promptKind: "name", key: "simile", cite: "Met. 8.191-192", rng: 5 });
  assert.deepEqual(Deal.judge(round, round.answers.definition), { ok: true, column: "definition" });
  assert.deepEqual(Deal.judge(round, "def:simile"), { ok: true, column: "definition" });
  assert.deepEqual(Deal.judge(round, round.decoys.example[0]), { ok: false, column: "example" });
  assert.deepEqual(Deal.judge(round, "name:simile"), { ok: false, column: "name" });          // the prompt's own column
  assert.deepEqual(Deal.judge(round, "name:metaphor"), { ok: false, column: "name" });
  assert.deepEqual(Deal.judge(round, "nonsense"), { ok: false, column: null });
  assert.deepEqual(Deal.judge(round, null), { ok: false, column: null });
  assert.deepEqual(Deal.judge(round, { id: "def:no_such_device", kind: "definition" }), { ok: false, column: "definition" });
  // a round copied through JSON has lost its meaning index: its recorded answers still grade
  const copy = JSON.parse(JSON.stringify(round));
  assert.deepEqual(Deal.judge(copy, round.answers.example), { ok: true, column: "example" });
  assert.deepEqual(Deal.judge(copy, round.decoys.example[0]), { ok: false, column: "example" });
});

// ---- hands -----------------------------------------------------------------------------------------------
test("hands: the right cards split for a team of two or more, and stay together for one", () => {
  const round = Deal.makeRound(POOL, { promptKind: "definition", key: "chiasmus", rng: 11 });
  const one = Deal.hands(round, ["solo"], { rng: 1 });
  assert.equal(one.solo.length, 4);                                  // both right + two decoys, one from each column
  assert.deepEqual(one.solo.map((c) => c.kind).sort(), ["example", "example", "name", "name"]);
  const two = Deal.hands(round, ["a", "b"], { rng: 1 });
  assert.deepEqual([two.a.length, two.b.length], [3, 3]);           // all six cards
  const six = Deal.hands(round, ["a", "b", "c", "d", "e", "f"], { rng: 1 });
  assert.ok(Object.values(six).every((h) => h.length === 1));
});

test("hands: sizes 1-8 teams x hand sizes 2-5 x seeds, with the rules intact", () => {
  for (let seed = 0; seed < 60; seed++) {
    const round = Deal.makeRound(POOL, { rng: seed, decoys: 1 + (seed % 5) });      // 4 to 12 cards
    for (let size = 1; size <= 8; size++) for (let handSize = 2; handSize <= 5; handSize++) {
      const team = Array.from({ length: size }, (_, i) => `p${i}`);
      checkHands(round, team, Deal.hands(round, team, { rng: seed + 99, handSize }), handSize, `seed ${seed}/team ${size}/hand ${handSize}`);
    }
  }
});

test("hands: the two right cards, and who holds what, are shuffled", () => {
  const round = Deal.makeRound(POOL, { promptKind: "name", key: "litotes", rng: 4 });
  const team = ["a", "b", "c"];
  const holds = { a: 0, b: 0, c: 0 };
  const place = new Set();
  const rightIds = new Set(Object.values(round.answers).map((c) => c.id));
  for (let seed = 0; seed < 300; seed++) {
    const dealt = Deal.hands(round, team, { rng: seed });
    for (const uid of team) {
      dealt[uid].forEach((c, i) => { if (rightIds.has(c.id)) { holds[uid]++; place.add(i); } });
    }
  }
  for (const uid of team) assert.ok(holds[uid] > 150 && holds[uid] < 250, `${uid} held a right card ${holds[uid]} times in 300 (expected 200)`);
  assert.deepEqual([...place].sort(), [0, 1]);                       // a right card is first and second in a hand
  // the order inside a hand varies too
  const orders = new Set();
  for (let seed = 0; seed < 50; seed++) orders.add(Deal.hands(round, ["solo"], { rng: seed, handSize: 6 }).solo.map((c) => c.id).join());
  assert.ok(orders.size > 20, `only ${orders.size} different orders in 50 deals`);
});

test("hands: odd cases", () => {
  const round = Deal.makeRound(POOL, { promptKind: "name", key: "hyperbole", rng: 2 });
  assert.deepEqual(Deal.hands(round, [], { rng: 1 }), {});
  // a name listed twice is one player
  const dup = Deal.hands(round, ["a", "b", "a"], { rng: 1 });
  assert.deepEqual(Object.keys(dup).sort(), ["a", "b"]);
  checkHands(round, ["a", "b", "a"], dup, 4, "duplicate names");
  // more players than cards (6 cards): no card is dealt twice, the last players hold nothing
  const crowd = Array.from({ length: 9 }, (_, i) => `p${i}`);
  const dealt = Deal.hands(round, crowd, { rng: 1 });
  checkHands(round, crowd, dealt, 4, "nine players");
  assert.equal(Object.values(dealt).filter((h) => h.length === 0).length, 3);
  // ...and asking for more decoys is the answer
  const big = Deal.makeRound(POOL, { promptKind: "name", key: "hyperbole", rng: 2, decoys: 4 });
  assert.ok(Object.values(Deal.hands(big, crowd, { rng: 1 })).every((h) => h.length >= 1));
  // no decoys at all: the two right cards alone
  const bare = Deal.makeRound(POOL, { promptKind: "name", key: "hyperbole", rng: 2, decoys: 0 });
  checkHands(bare, ["a"], Deal.hands(bare, ["a"], { rng: 1 }), 4, "no decoys, one player");
  checkHands(bare, ["a", "b"], Deal.hands(bare, ["a", "b"], { rng: 1 }), 4, "no decoys, two players");
  // a hand size of 1 is fine for a team, impossible for one player holding two right cards
  checkHands(round, ["a", "b", "c", "d", "e", "f"], Deal.hands(round, ["a", "b", "c", "d", "e", "f"], { rng: 1, handSize: 1 }), 1, "hand size 1");
  assert.throws(() => Deal.hands(round, ["a"], { handSize: 1 }), RangeError);
  assert.throws(() => Deal.hands(round, ["a", "b"], { handSize: 0 }), RangeError);
  assert.throws(() => Deal.hands(round, ["a", "b"], { handSize: 2.5 }), RangeError);
});

test("hands: the round's cards are not changed by dealing them", () => {
  const round = Deal.makeRound(POOL, { promptKind: "example", key: "simile", rng: 6 });
  const before = JSON.stringify(round);
  Deal.hands(round, ["a", "b", "c"], { rng: 1 });
  Deal.hands(round, ["x"], { rng: 2 });
  assert.equal(JSON.stringify(round), before);
});

// ---- determinism and bad input ---------------------------------------------------------------------------
test("the same seed gives the same round and the same hands; another seed gives another", () => {
  const spec = { promptKind: "definition", key: "synchysis", rng: 77 };
  const a = Deal.makeRound(POOL, { ...spec, rng: 77 });
  const b = Deal.makeRound(POOL, { ...spec, rng: 77 });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const team = ["a", "b", "c"];
  assert.equal(JSON.stringify(Deal.hands(a, team, { rng: 5 })), JSON.stringify(Deal.hands(b, team, { rng: 5 })));
  assert.equal(JSON.stringify(Deal.hands(a, team, { rng: "x" })), JSON.stringify(Deal.hands(b, team, { rng: "x" })));
  // a function rng works as well, and a function is not a seed
  const viaFn = Deal.makeRound(POOL, { ...spec, rng: Deal.seeded(77) });
  assert.equal(JSON.stringify(viaFn), JSON.stringify(a));
  const others = new Set();
  for (let seed = 0; seed < 20; seed++) others.add(JSON.stringify(Deal.makeRound(POOL, { ...spec, rng: seed })));
  assert.ok(others.size > 10);
  // with no rng it uses Math.random, and still obeys the rules
  checkRound(Deal.makeRound(POOL, { promptKind: "name", key: "simile" }), { key: "simile", kind: "name", want: 2 }, "Math.random");
});

test("bad input is refused with a clear error", () => {
  assert.throws(() => Deal.makeRound(POOL, { promptKind: "picture" }), /promptKind/);
  assert.throws(() => Deal.makeRound(POOL, { key: "no_such_device" }), /no device/);
  assert.throws(() => Deal.makeRound(POOL, { key: "simile", cite: "Nowhere 1" }), /no example/);
  assert.throws(() => Deal.makeRound(POOL, { decoys: -1 }), /decoys/);
  assert.throws(() => Deal.makeRound(POOL, { decoys: 1.5 }), /decoys/);
  assert.throws(() => Deal.makeRound([], {}), /pool/);
  assert.throws(() => Deal.makeRound({ devices: POOL }, {}), /pool/);
  assert.throws(() => Deal.makeRound([{ key: "x", examples: [] }], {}), /example/);
});

test("loaded as a plain <script>, it becomes window.Deal and needs nothing else", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "live", "deal.js"), "utf8");
  // a page: `window` is the global, there is no `module`, no `require`
  const page = { };
  page.window = page.self = page;
  vm.runInContext(source, vm.createContext(page));
  assert.deepEqual(Object.keys(page.Deal).sort(), Object.keys(Deal).sort());
  const round = page.Deal.makeRound(POOL, { promptKind: "name", key: "simile", rng: 3 });
  assert.equal(round.key, "simile");
  assert.equal(page.Deal.judge(round, round.answers.definition).ok, true);
  // a worker or an old embedding with no `self`: it falls back to the global object
  const bare = vm.createContext({ });
  vm.runInContext(source, bare);
  assert.equal(typeof bare.Deal, "object");
});
