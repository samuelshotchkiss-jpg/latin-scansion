// idioms.js -- "Idioms: class relay" and "Idioms: team race", for Latin III. AGPL-3.0.
//
// Three cards belong together: a LATIN phrase that is not English word for word (pedem referre), its
// WORD-FOR-WORD meaning (carry back the foot) and what it means in NATURAL ENGLISH (retreat). One card is
// the prompt; the other two columns are dealt out across the devices with wrong cards from other idioms,
// so the class (or the team) has to talk. The point (owner, 2026-11-08): students get used to Latin that
// "sounds more Latin-y", and see how the words get from the one meaning to the other.
//
// It is the derivatives game with other cards. The relay (whole class against its own best time; a wrong
// card adds seconds) is derivatives.js's relayMode; the race (teams get the same idioms in the same order;
// a wrong card freezes the team; first to finish wins) is derivrace.js's raceMode. This file only says
// what an idiom card is (the KIT) and which data file holds them.
//
// Made for a class of five, with one or two away (owner, 2026-11-08): the relay plays at any number; the
// race makes teams of about three (5 -> 3 + 2, 4 -> 2 + 2; 3 -> one team, and the lobby suggests the relay).
//
// The data is data/idioms.json, made by tools/export_idioms.py from the owner's handouts: one set per
// reading (Via Latina IX-XII first), picked at the host, or "Newest Latin III" (the last set of that class).
//
// A WRONG CARD MUST NEVER ALSO FIT. Two idioms can mean nearly the same ("make an attack" / "start
// fighting"; "make a withdrawal" / "retreat"). The exporter lists such pairs in each idiom's `near`, and a
// card of a near idiom is never dealt as a wrong card against it. Cards with the same text are never
// decoys of each other either.
//
// WHAT IS WRITTEN WHERE: as the derivatives modes. The host page keeps the idioms and the answers in
// memory; each device gets only its own cards as plain text (hands/<uid>), the public progress is in
// `state`, and the best times live in the teacher's page's memory only.
(function () {
  "use strict";
  const KINDS = ["latin", "literal", "english"];
  const KIND_LABEL = { latin: "Latin", literal: "Word for word", english: "Natural English" };

  // May idiom x give wrong cards for idiom w? Not itself, not a near idiom (either way), and no card text in common.
  function mayDecoy(w, x) {
    if (x.key === w.key) return false;
    if ((w.near || []).includes(x.key) || (x.near || []).includes(w.key)) return false;
    return !KINDS.some((k) => x[k] === w[k]);
  }

  const IDIOM_KIT = {
    KINDS, KIND_LABEL, mayDecoy,
    perShare: 2,                                     // a shared column gets two cards per device (5 devices: 2 + 2 + 2 and 2 + 2)
    noun: "idiom", nouns: "idioms", Noun: "Idiom",
    usable: (w) => !!(w.latin && w.literal && w.english),
    variant: () => null,                             // an idiom has one card of each kind
    text: (w, kind) => w[kind],
    heads: ["Latin", "Natural English"],
    cells: (r) => [r.row.latin, r.row.english],
    last: (c) => c.row.latin + " · " + c.row.literal + " · " + c.row.english,
  };
  const PROMPTS = [["rotate", "Rotate through all three"], ["latin", "Always the Latin"], ["literal", "Always the word-for-word"], ["english", "Always the natural English"]];
  const COUNTS = [0, 8, 12, 16];

  if (typeof module === "object" && module.exports) module.exports = { IDIOM_KIT, mayDecoy, KINDS, KIND_LABEL };
  if (typeof Live === "undefined" || !Live.Deriv || !Live.DerivRace) return;   // (a test with no page: only the kit is wanted)

  const DATA = Live.Deriv.dataSource("data/idioms.json", "Idiom set");

  Live.Deriv.relayMode({
    id: "idioms",
    title: "Idioms: class relay",
    blurb: "The whole class matches each Latin idiom with its word-for-word meaning and its natural English, racing its own best time.",
    kit: IDIOM_KIT, data: DATA, rows: "idioms",
    setDefault: ["newlatiniii", "Newest Latin III"],
    countOptions: COUNTS, countDefault: 12,
    promptOptions: PROMPTS,
    lobbyNote: (n) => (n === 1 ? "One device holds both answer columns." :
      n === 2 ? "Each device holds one of the two answer columns." :
      "The devices share the two answer columns, each with part of the cards. The column a device holds moves on every idiom."),
  });

  Live.DerivRace.raceMode({
    id: "idiomrace",
    title: "Idioms: team race",
    blurb: "Two teams get the same Latin idioms. Each team matches the Latin, the word-for-word meaning and the natural English. A wrong card freezes the team. The first team to finish wins.",
    kit: IDIOM_KIT, data: DATA, rows: "idioms",
    setDefault: ["newlatiniii", "Newest Latin III"],
    teamSize: 3,
    countOptions: COUNTS, countDefault: 12,
    promptOptions: PROMPTS,
    lobbyNote(n, sizes) {
      const bits = [];
      if (n && n <= 3) bits.push("With 3 or fewer players there is one team, and it plays alone. The class relay may be better for a small class.");
      bits.push("Both teams get the same idioms. A wrong card freezes the whole team.");
      return bits.join(" ");
    },
  });
})();
