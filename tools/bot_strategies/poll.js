// How a simulated phone answers the "poll" test mode: any of the three choices, at random.
// A strategy is { choose({ round, hand, rng, bot }) -> v (0-9) | null (do not answer) }.
// One file per mode, named after the mode's id; tools/bots.js uses ./bot_strategies/<id>.js if it exists.
exports.choose = ({ rng }) => Math.floor(rng() * 3);
