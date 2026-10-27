// How a simulated phone plays "meter" (Longa an brevis?). A strategy is { choose({ round, hand, rng, bot }) -> v | null }.
// The bot reads the question bank the way a keen student reads the practice page: it finds the boxed
// syllable from the line's text and the boxed letters (round.t, round.a), then answers right with a
// probability that is its own "skill" (each bot gets a fixed one between 0.45 and 0.95, so a class of bots
// has strong and weak members) and otherwise taps one of the other two buttons. v: 0 Long, 1 Short, 2 Elided.
// Environment: SKILL (0-1) fixes every bot's skill. A bot with no hand (it joined mid-question) sits out.
"use strict";
const path = require("node:path");
const BANK = require(path.join(__dirname, "..", "..", "data", "meter_questions.json"));
const KEY = new Map(BANK.questions.map((q) => [BANK.lines[q.line].text + "#" + q.span[0], q]));
const ANS = ["L", "S", "X"];
const skillOf = (bot) => (process.env.SKILL !== undefined ? Number(process.env.SKILL) : 0.45 + ((bot.i * 37) % 11) / 11 * 0.5);

exports.choose = ({ round, hand, rng, bot }) => {
  if (!hand) return null;
  const q = KEY.get(round.t + "#" + round.a);
  if (!q) return Math.floor(rng() * 3);
  const right = ANS.indexOf(q.answer);
  if (rng() < skillOf(bot)) return right;
  const others = [0, 1, 2].filter((v) => v !== right);
  return others[Math.floor(rng() * 2)];
};
