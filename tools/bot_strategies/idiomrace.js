// How a simulated device plays "idiomrace" (Idioms: team race): derivrace.js's strategy with idioms.js's
// reading of the cards. (What follows is derivrace.js's note.) Like derivatives.js (the class relay):
// a `run` strategy that finds its right cards from the public data file and taps them one by one. Differences:
// the tap carries the team's deal parity (index + 5 x (d mod 2)), and a wrong card freezes the whole team, so
// after a blunder (or any pause with no verdict) the bot waits out the freeze before it taps again.
// Environment: BLUNDER (0-1, default 0.1), DELAY_SCALE (default 1), FREEZE_SECONDS (default 5).
"use strict";
const relay = require("./idioms.js");
const asList = (x) => (Array.isArray(x) ? x : x ? Object.values(x) : []);
const BLUNDER = Number(process.env.BLUNDER === undefined ? 0.1 : process.env.BLUNDER);
const SCALE = Number(process.env.DELAY_SCALE || 1);
const FREEZE = Number(process.env.FREEZE_SECONDS === undefined ? 5 : process.env.FREEZE_SECONDS);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

exports.isRight = relay.isRight;

exports.run = async ({ round, hand, rng, tap }) => {
  const n = round && round.n;
  for (let tries = 0; tries < 14; tries++) {
    await sleep((800 + rng() * 2400) * SCALE);
    const h = hand();
    if (!h || h.n !== n || !h.p) return;                  // the word has moved on (or this is a new round: the strategy runs again)
    const cards = asList(h.cards), res = h.res || {};
    const open = cards.map((f, i) => i).filter((i) => res[i] === undefined);
    const right = open.filter((i) => relay.isRight(h.pk, h.p, cards[i]));
    if (!right.length) return;                            // nothing of mine left to find
    const i = rng() < BLUNDER ? open[Math.floor(rng() * open.length)] : right[0];
    if (!(await tap(i + 5 * ((h.d || 0) % 2)))) return;
    await sleep(900);                                     // let the host's verdict arrive before looking again
    const after = hand();
    if (after && after.n === n && after.res && after.res[i] === 0) await sleep((FREEZE * 1000 + 400) * SCALE);   // frozen
  }
};
