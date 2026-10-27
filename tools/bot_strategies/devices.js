// How a simulated phone plays "devices" (team match). A strategy with a `run` function plays a stretch of
// the game itself: run({ round, hand(), rng, bot, tap(v) }) -> promise. tools/bots.js calls it every time
// the round number changes (in devices mode that is whenever ANY team gets a new prompt), so a bot simply
// looks at its current hand each time, taps a card it has not tapped yet, and tries again next time if the
// tap was refused while the round was being re-opened.
// It reads the same public data a student could (data/devices.json) to know which of its cards match the
// team's prompt (hand.p), then taps after a pause. Environment: BLUNDER (0-1, default 0.08) is the chance
// of tapping a random card instead; DELAY_SCALE (default 1) stretches the pauses, so a slow bot makes a
// slow team.
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
const SCALE = Number(process.env.DELAY_SCALE || 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.isRight = (prompt, f) => f.k !== prompt.k && devsOf(f).some((k) => devsOf(prompt).includes(k));

exports.run = async ({ round, hand, rng, bot, tap }) => {
  await sleep((600 + rng() * 1800) * SCALE);
  const h = hand();
  if (!h || !h.p) return;
  const cards = asList(h.cards), res = h.res || {};
  const open = cards.map((f, i) => i).filter((i) => res[i] === undefined);
  if (!open.length) return;
  const right = open.filter((i) => exports.isRight(h.p, cards[i]));
  const i = rng() < BLUNDER ? open[Math.floor(rng() * open.length)] : right[0];
  if (i === undefined) return;
  await tap(i + 4 * (h.d % 2));                  // the tap carries the card's place in the hand and the deal's parity
};
