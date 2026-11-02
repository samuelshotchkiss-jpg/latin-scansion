// How a simulated device plays "derivatives" (class relay). Like devices.js, a `run` strategy: tools/bots.js
// calls it whenever the round changes, and it looks at its current hand each time. It reads the same public
// data a student could (data/derivatives.json) to know which of its cards belong to the prompt's word, then
// taps them one by one after a pause, until its hand has no right card left. Environment: BLUNDER (0-1,
// default 0.1) is the chance of tapping a random card instead; DELAY_SCALE (default 1) stretches the pauses.
"use strict";
const path = require("node:path");
const SETS = require(path.join(__dirname, "..", "..", "data", "derivatives.json")).sets;

// card text -> the word keys it can stand for, per kind of card (every set at once: a bot does not know which set is played)
const OWN = { latin: new Map(), ldef: new Map(), deriv: new Map(), ddef: new Map() };
const add = (k, t, key) => { const m = OWN[k]; if (!m.has(t)) m.set(t, new Set()); m.get(t).add(key); };
for (const s of SETS) for (const w of s.words) {
  add("latin", w.latin, w.key); add("ldef", w.def, w.key);
  for (const d of w.derivs) { add("deriv", d.w, w.key); add("ddef", d.d, w.key); }
}
const keysOf = (k, t) => (OWN[k] && OWN[k].get(t)) || new Set();
const asList = (x) => (Array.isArray(x) ? x : x ? Object.values(x) : []);
const BLUNDER = Number(process.env.BLUNDER === undefined ? 0.1 : process.env.BLUNDER);
const SCALE = Number(process.env.DELAY_SCALE || 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.isRight = (pk, p, f) => f.k !== pk && [...keysOf(f.k, f.t)].some((key) => keysOf(pk, p).has(key));

exports.run = async ({ round, hand, rng, tap }) => {
  const n = round && round.n;
  for (let tries = 0; tries < 6; tries++) {
    await sleep((800 + rng() * 2400) * SCALE);
    const h = hand();
    if (!h || h.n !== n || !h.p) return;                  // the word has moved on
    const cards = asList(h.cards), res = h.res || {};
    const open = cards.map((f, i) => i).filter((i) => res[i] === undefined);
    const right = open.filter((i) => exports.isRight(h.pk, h.p, cards[i]));
    if (!right.length) return;                            // nothing of mine left to find
    const i = rng() < BLUNDER ? open[Math.floor(rng() * open.length)] : right[0];
    if (!(await tap(i))) return;
    await sleep(700);                                     // let the host's verdict arrive before looking again
  }
};
