// names.js -- the codenames of the live game. AGPL-3.0 (see COPYRIGHT.md).
//
// WHY THIS FILE EXISTS. A student must never type a name into the game (the database may not hold
// any text a student wrote -- see live/SPEC.md section 2). So a player's "name" is one NUMBER, and
// this file turns that number into a Latin phrase on the screen: 40 animals and natural things
// times 24 adjectives = 960 phrases, each one grammatical ("Vulpēs Callida", "Lupus Audāx",
// "Fulmen Celere"). The adjective is chosen to agree with the noun in gender, so every one of the
// 960 is correct Latin.
//
// Rules for the lists (a teacher can check them by eye):
//   - positive or neutral meanings only; nothing to tease a classmate with;
//   - no Latin word that is also an English first name (so no Clāra, Lūna, Stella, Rosa, Fēlīx,
//     Aurōra, Gemma, Mīra), and no word that sounds rude to a twelve-year-old;
//   - nouns are given with their gender; adjectives in all three nominative forms [m, f, n];
//   - macrons are correct; a vowel left unmarked is short (or long only by position).
//
// If a list changes, NAME_COUNT changes, and database.rules.json (which refuses a codename number
// at or above the count) must change with it: tests/names.test.js fails until they agree.
//
// Works as window.Names in a page and as require("./names.js") in Node (for the tests and bots).
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Names = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  // [nominative, gender, English]
  const NOUNS = [
    // masculine
    ["Lupus", "m", "wolf"], ["Leō", "m", "lion"], ["Ursus", "m", "bear"], ["Cervus", "m", "stag"],
    ["Equus", "m", "horse"], ["Corvus", "m", "raven"], ["Accipiter", "m", "hawk"],
    ["Delphīnus", "m", "dolphin"], ["Taurus", "m", "bull"], ["Cygnus", "m", "swan"],
    ["Passer", "m", "sparrow"], ["Lepus", "m", "hare"], ["Pāpiliō", "m", "butterfly"],
    ["Phoenīx", "m", "phoenix"], ["Pāvō", "m", "peacock"], ["Dracō", "m", "dragon"],
    // feminine
    ["Vulpēs", "f", "fox"], ["Aquila", "f", "eagle"], ["Fēlēs", "f", "cat"], ["Apis", "f", "bee"],
    ["Hirundō", "f", "swallow"], ["Columba", "f", "dove"], ["Luscinia", "f", "nightingale"],
    ["Formīca", "f", "ant"], ["Testūdō", "f", "tortoise"], ["Noctua", "f", "owl"],
    ["Cicōnia", "f", "stork"], ["Nūbēs", "f", "cloud"], ["Tempestās", "f", "storm"],
    ["Flamma", "f", "flame"], ["Unda", "f", "wave"], ["Quercus", "f", "oak"],
    // neuter
    ["Fulmen", "n", "lightning"], ["Saxum", "n", "rock"], ["Astrum", "n", "star"], ["Mare", "n", "sea"],
    ["Caelum", "n", "sky"], ["Nemus", "n", "grove"], ["Flūmen", "n", "river"], ["Lītus", "n", "shore"],
  ];

  // [masculine, feminine, neuter, English]. A 3rd-declension adjective repeats a form where
  // Latin does (fortis is both masculine and feminine; audāx is all three).
  const ADJECTIVES = [
    ["Callidus", "Callida", "Callidum", "clever"],
    ["Audāx", "Audāx", "Audāx", "bold"],
    ["Fortis", "Fortis", "Forte", "brave"],
    ["Celer", "Celeris", "Celere", "swift"],
    ["Sagāx", "Sagāx", "Sagāx", "sharp-witted"],
    ["Fīdus", "Fīda", "Fīdum", "faithful"],
    ["Probus", "Proba", "Probum", "honest"],
    ["Pulcher", "Pulchra", "Pulchrum", "beautiful"],
    ["Placidus", "Placida", "Placidum", "calm"],
    ["Mītis", "Mītis", "Mīte", "gentle"],
    ["Dulcis", "Dulcis", "Dulce", "sweet"],
    ["Agilis", "Agilis", "Agile", "nimble"],
    ["Ācer", "Ācris", "Ācre", "keen"],
    ["Splendidus", "Splendida", "Splendidum", "gleaming"],
    ["Validus", "Valida", "Validum", "strong"],
    ["Laetus", "Laeta", "Laetum", "joyful"],
    ["Nōbilis", "Nōbilis", "Nōbile", "noble"],
    ["Prūdēns", "Prūdēns", "Prūdēns", "prudent"],
    ["Vīvidus", "Vīvida", "Vīvidum", "lively"],
    ["Fortūnātus", "Fortūnāta", "Fortūnātum", "fortunate"],
    ["Strēnuus", "Strēnua", "Strēnuum", "energetic"],
    ["Alacer", "Alacris", "Alacre", "eager"],
    ["Nitidus", "Nitida", "Nitidum", "sleek"],
    ["Firmus", "Firma", "Firmum", "steadfast"],
  ];

  const GENDER_COLUMN = { m: 0, f: 1, n: 2 };
  const NAME_COUNT = NOUNS.length * ADJECTIVES.length;

  // idx runs 0 .. NAME_COUNT-1. Consecutive numbers share an adjective and change the noun, so two
  // players with neighbouring numbers still look different.
  function parts(idx) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= NAME_COUNT) return null;
    const noun = NOUNS[idx % NOUNS.length];
    const adj = ADJECTIVES[Math.floor(idx / NOUNS.length)];
    return { noun, adj, latin: noun[0] + " " + adj[GENDER_COLUMN[noun[1]]], english: adj[3] + " " + noun[2] };
  }
  // The Latin phrase for a codename number; a number outside the list gets a plain placeholder
  // (a tampered record must not break the screen).
  function nameFor(idx) { const p = parts(idx); return p ? p.latin : "—"; }
  // "swift fox": a small English gloss for under the Latin, so the game teaches a little too.
  function glossFor(idx) { const p = parts(idx); return p ? p.english : ""; }

  return { NOUNS, ADJECTIVES, NAME_COUNT, nameFor, glossFor, parts };
});
