// How a simulated phone plays "devices" (team match). A strategy with a `run` function plays a whole
// round itself: run({ round, hand(), rng, bot, tap(v) }) -> promise. It reads the same public data files
// a student could (data/devices.json) to know which of its cards match the prompt, then taps them after
// a pause. BLUNDER (environment, 0-1, default 0.08) is the chance a bot taps a random card instead.
"use strict";
const path = require("node:path");
const POOL = require(path.join(__dirname, "..", "..", "data", "devices.json")).devices;

// what each card text/cite stands for: the devices it is a right answer for
const NAME = new Map(), DEF = new Map(), EX = new Map();
for (const d of POOL) {
  NAME.set(d.name, [d.key]); DEF.set(d.definition, [d.key]);
  for (const e of d.examples) EX.set(e.cite, [d.key, ...(e.also || [])]);
}
const devsOf = (f) => (f.k === "example" ? EX.get(f.c) : f.k === "name" ? NAME.get(f.t) : DEF.get(f.t)) || [];
const asList = (x) => (Array.isArray(x) ? x : x ? Object.values(x) : []);
const BLUNDER = Number(process.env.BLUNDER === undefined ? 0.08 : process.env.BLUNDER);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.isRight = (prompt, f) => f.k !== prompt.k && devsOf(f).some((k) => devsOf(prompt).includes(k));

exports.run = async ({ round, hand, rng, bot, tap }) => {
  for (let guard = 0; guard < 6; guard++) {
    await sleep(600 + rng() * 1800);
    const h = hand();
    if (!h || h.n !== round.n) return;
    const cards = asList(h.cards), res = h.res || {};
    const open = cards.map((f, i) => i).filter((i) => res[i] === undefined);
    if (!open.length) return;
    const right = open.filter((i) => exports.isRight(round.p, cards[i]));
    if (rng() < BLUNDER) { await tap(open[Math.floor(rng() * open.length)]); continue; }
    if (!right.length) return;
    await tap(right[0]);
    return;
  }
};
