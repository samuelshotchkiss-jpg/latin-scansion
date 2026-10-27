// rules.test.js -- tries to break database.rules.json, against the Firebase EMULATOR only.
//
// Every test is named after its item in live/SPEC.md section 7 ("7.3 ..."), so the list can be
// checked against the contract by eye. Tests named "extra" are attacks that list does not have.
// Run with `npm test` (which starts the emulators for you). The project id starts with "demo-",
// which Firebase itself refuses to connect to a real project.
//
// A "deny" test uses assertFails, which passes ONLY for a permission-denied error -- a typo that
// throws something else cannot make an attack look blocked.
"use strict";

const { test, describe, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");

const PROJECT = "demo-latin-live";
const TEACHER = "TEACHER-UID";          // stands in for the UID the owner pastes into the console
const G = "games/BCDF";
const TS = { ".sv": "timestamp" };      // the server-time placeholder a client sends
const LONG = "x".repeat(5000);          // a long VALUE
const LONGKEY = "x".repeat(700);        // a long KEY (the client library itself refuses over 768 bytes)

let env;

before(async () => {
  const hostPort = (process.env.FIREBASE_DATABASE_EMULATOR_HOST || "localhost:9000").split(":");
  env = await initializeTestEnvironment({
    projectId: PROJECT,
    database: {
      host: hostPort[0], port: Number(hostPort[1]),
      rules: fs.readFileSync(process.env.RULES_FILE || path.join(__dirname, "..", "database.rules.json"), "utf8"),   // RULES_FILE: set by mutate_rules.js
    },
  });
});
after(async () => { if (env) await env.cleanup(); });

// ---- who is asking -------------------------------------------------------------------------------
const nobody = () => env.unauthenticatedContext().database();
const anon = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: "anonymous" } }).database();
const google = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: "google.com" } }).database();
const teacher = () => google(TEACHER);
const forgedTeacher = () => anon(TEACHER);   // the teacher's UID, but an anonymous sign-in

// ---- a game in progress: ALICE (name 5) and BOB (name 7) are in, round 1 is open --------------------
const baseline = () => ({
  config: { teacherUid: TEACHER },
  games: {
    BCDF: {
      meta: { host: TEACHER, mode: "poll", phase: "play", created: 1000, live: true, beat: 1000, teamSize: 2 },
      claims: { 5: "ALICE", 7: "BOB" },
      players: { ALICE: { n: 5, at: 1000 }, BOB: { n: 7, at: 1000 } },
      teams: { ALICE: 0, BOB: 0 },
      round: { n: 1, open: true, t0: 1000, ms: 10000 },
      hands: { ALICE: { n: 1, cards: ["a", "b"] }, BOB: { n: 1, cards: ["c"] } },
      taps: { BOB: { "1_0": { n: 1, v: 2, at: 1000 } } },
      reveal: { n: 0 },
      score: { 0: 10 },
      state: { note: "hi" },
    },
  },
});
const seed = async (mutate) => {
  await env.clearDatabase();
  const data = baseline();
  if (mutate) mutate(data);
  await env.withSecurityRulesDisabled((c) => c.database().ref().set(data));
};
const dump = async () => {
  let out;
  await env.withSecurityRulesDisabled(async (c) => { out = (await c.database().ref().get()).val(); });
  return out;
};

const ref = (db, p) => (p ? db.ref(p) : db.ref());
// Joining = claim a codename AND write the player record, in ONE write (see live/RULES.md).
const join = (db, uid, idx) => db.ref(G).update({ ["claims/" + idx]: uid, ["players/" + uid]: { n: idx, at: TS } });

beforeEach(() => seed());

// =================================================================================================
describe("7.1 unauthenticated: nothing at all", () => {
  test("7.1 reads of games, one game, one node, config are denied", async () => {
    for (const p of ["games", G, G + "/meta", G + "/claims", G + "/players", "config", "config/teacherUid", ""]) {
      await assertFails(ref(nobody(), p).get());
    }
  });
  test("7.1 writes anywhere in the game are denied", async () => {
    const db = nobody();
    for (const [p, v] of [[G + "/meta/phase", "done"], [G + "/claims/9", "x"], [G + "/players/NOBODY", { n: 9, at: TS }],
      [G + "/taps/BOB/1_1", { n: 1, v: 1, at: TS }], ["games/WXZB/meta", {}], ["config/teacherUid", "evil"]]) {
      await assertFails(ref(db, p).set(v));
    }
  });
});

describe("7.2 anonymous student: no listing, no config", () => {
  test("7.2 listing games, and querying it, is denied", async () => {
    await assertFails(ref(anon("ALICE"), "games").get());
    await assertFails(ref(anon("ALICE"), "games").orderByChild("meta/created").limitToLast(1).get());
  });
  test("7.2 reading config and config/teacherUid is denied", async () => {
    await assertFails(ref(anon("ALICE"), "config").get());
    await assertFails(ref(anon("ALICE"), "config/teacherUid").get());
  });
  test("7.2 reading a whole game (which holds other players' hands and taps) is denied", async () => {
    await assertFails(ref(anon("ALICE"), G).get());
  });
});

describe("7.3 anonymous student: cannot write the teacher's nodes", () => {
  const writes = [
    ["a whole new game", "games/WXZB", { meta: { host: "ALICE", mode: "poll", phase: "lobby", created: TS, live: true, beat: TS, teamSize: 0 } }],
    ["a new game's meta", "games/WXZB/meta", { host: "ALICE", mode: "poll", phase: "lobby", created: TS, live: true, beat: TS, teamSize: 0 }],
    ["meta/phase", G + "/meta/phase", "done"],
    ["meta/live", G + "/meta/live", false],
    ["round", G + "/round", { n: 2, open: true, t0: TS, ms: 1000 }],
    ["round/open", G + "/round/open", true],
    ["reveal", G + "/reveal", { n: 1, answer: 2 }],
    ["score", G + "/score/0", 9999],
    ["teams (own)", G + "/teams/ALICE", 3],
    ["state", G + "/state", { x: 1 }],
    ["hands (own)", G + "/hands/ALICE", { n: 1, cards: ["win"] }],
  ];
  for (const [label, p, v] of writes) {
    test(`7.3 writing ${label} is denied`, async () => { await assertFails(ref(anon("ALICE"), p).set(v)); });
  }
  test("7.3 deleting a game is denied", async () => { await assertFails(ref(anon("ALICE"), G).remove()); });
});

describe("7.4 anonymous student: other players' hands and taps are private", () => {
  test("7.4 reading another player's hand is denied; reading one's own is allowed", async () => {
    await assertFails(ref(anon("ALICE"), G + "/hands/BOB").get());
    await assertSucceeds(ref(anon("ALICE"), G + "/hands/ALICE").get());
  });
  test("7.4 reading another player's taps is denied; reading one's own is allowed", async () => {
    await assertFails(ref(anon("ALICE"), G + "/taps/BOB").get());
    await assertSucceeds(ref(anon("BOB"), G + "/taps/BOB").get());
  });
  test("7.4 listing all hands or all taps is denied", async () => {
    await assertFails(ref(anon("ALICE"), G + "/hands").get());
    await assertFails(ref(anon("ALICE"), G + "/taps").get());
  });
});

describe("7.5 a Google user who is not the teacher", () => {
  test("7.5 cannot create a game", async () => {
    await assertFails(ref(google("SOMEONE"), "games/WXZB/meta").set(
      { host: "SOMEONE", mode: "poll", phase: "lobby", created: TS, live: true, beat: TS, teamSize: 0 }));
  });
  test("7.5 cannot delete a game, edit one, or list games", async () => {
    await assertFails(ref(google("SOMEONE"), G).remove());
    await assertFails(ref(google("SOMEONE"), G + "/meta/phase").set("done"));
    await assertFails(ref(google("SOMEONE"), "games").get());
  });
});

describe("7.6 a forged teacher: right UID, but an anonymous sign-in", () => {
  test("7.6 cannot create, edit or delete a game, or list games", async () => {
    const db = forgedTeacher();
    await assertFails(ref(db, "games/WXZB/meta").set(
      { host: TEACHER, mode: "poll", phase: "lobby", created: TS, live: true, beat: TS, teamSize: 0 }));
    await assertFails(ref(db, G + "/meta/phase").set("done"));
    await assertFails(ref(db, G + "/round").set({ n: 5, open: true, t0: TS, ms: 1000 }));
    await assertFails(ref(db, G).remove());
    await assertFails(ref(db, "games").get());
    await assertFails(ref(db, G + "/hands/ALICE").get());
  });
  test("7.6 other sign-in providers with the teacher's UID are denied too", async () => {
    for (const provider of ["password", "custom", "phone", "facebook.com"]) {
      const db = env.authenticatedContext(TEACHER, { firebase: { sign_in_provider: provider } }).database();
      await assertFails(ref(db, G + "/meta/phase").set("done"));
    }
  });
  test("7.6 control: the real teacher (Google + the right UID) can do all of it", async () => {
    await assertSucceeds(ref(teacher(), G + "/meta/phase").set("done"));
    await assertSucceeds(ref(teacher(), "games").get());
  });
  test("7.6 a Google user with a different UID, even one that differs by a character, is denied", async () => {
    await assertFails(ref(google(TEACHER + "x"), G + "/meta/phase").set("done"));
    await assertFails(ref(google(TEACHER.toLowerCase()), G + "/meta/phase").set("done"));
  });
  test("7.6 with no teacherUid set in the console, nobody is the teacher (including a user whose UID is 'null')", async () => {
    await seed((d) => { delete d.config; });
    await assertFails(ref(google(TEACHER), G + "/meta/phase").set("done"));
    await assertFails(ref(google("null"), G + "/meta/phase").set("done"));
  });
});

describe("7.7 codename claims", () => {
  test("7.7 claiming a name someone else holds is denied (even with a matching player record)", async () => {
    await assertFails(join(anon("CAROL"), "CAROL", 5));
  });
  test("7.7 overwriting or deleting someone else's claim is denied", async () => {
    await assertFails(ref(anon("CAROL"), G + "/claims/5").set("CAROL"));
    await assertFails(ref(anon("CAROL"), G + "/claims/5").remove());
    await assertFails(ref(anon("ALICE"), G + "/claims/7").set("ALICE"));
    await assertFails(ref(anon("ALICE"), G + "/claims/7").remove());
  });
  test("7.7 claiming a name for someone else is denied", async () => {
    await assertFails(ref(anon("CAROL"), G + "/claims/9").set("DAVE"));
  });
  test("7.7 control: a free name can be claimed (joined) and released again", async () => {
    await assertSucceeds(join(anon("CAROL"), "CAROL", 9));
    // releasing means moving to another name in the same write; see the re-roll tests below
    await assertSucceeds(anon("CAROL").ref(G).update({ "claims/9": null, "claims/10": "CAROL", "players/CAROL/n": 10 }));
    assert((await dump()).games.BCDF.claims[9] === undefined);
  });
  test("7.7 a name outside the list (960 or more, negative, not a number) cannot be claimed", async () => {
    for (const idx of ["960", "999", "1000", "-1", "05", "abc", "0x5", "00", "9999"]) {
      const n = /^-?[0-9]+$/.test(idx) ? Number(idx) : 0;   // the player record can only say a number
      await assertFails(anon("CAROL").ref(G).update({ ["claims/" + idx]: "CAROL", "players/CAROL": { n, at: TS } }));
    }
  });
  test("7.7 the first and last names (0 and 959) can be claimed", async () => {
    await assertSucceeds(join(anon("CAROL"), "CAROL", 0));
    await assertSucceeds(join(anon("DAVE"), "DAVE", 959));
  });
});

describe("7.8 player records", () => {
  test("7.8 writing another player's record is denied", async () => {
    await assertFails(ref(anon("CAROL"), G + "/players/ALICE").set({ n: 5, at: 1000 }));
    await assertFails(ref(anon("CAROL"), G + "/players/ALICE/n").set(9));
    await assertFails(ref(anon("CAROL"), G + "/players/BOB").remove());
  });
  test("7.8 writing one's own record with a name one has not claimed is denied", async () => {
    await assertFails(ref(anon("CAROL"), G + "/players/CAROL").set({ n: 9, at: TS }));   // nothing claimed
    await assertFails(ref(anon("CAROL"), G + "/players/CAROL").set({ n: 5, at: TS }));   // ALICE's name
  });
  test("7.8 n out of range is denied by the player rule alone (even if a claim for it somehow existed)", async () => {
    await seed((d) => { d.games.BCDF.claims[960] = "CAROL"; d.games.BCDF.claims[1000] = "CAROL"; d.games.BCDF.claims[-1] = "CAROL"; });
    for (const n of [960, 1000, -1]) await assertFails(ref(anon("CAROL"), G + "/players/CAROL").set({ n, at: TS }));
  });
  test("7.8 n out of range, fractional or a string is denied", async () => {
    for (const n of [-1, 960, 1000, 5.5, "5", "Carol Smith", null]) {
      await assertFails(anon("CAROL").ref(G).update({ "claims/9": "CAROL", "players/CAROL": { n, at: TS } }));
    }
  });
  test("7.8 an extra child (name, email, anything) is denied at every level", async () => {
    const db = anon("CAROL");
    await assertFails(db.ref(G).update({ "claims/9": "CAROL", "players/CAROL": { n: 9, at: TS, name: "Carol Smith" } }));
    await assertFails(db.ref(G).update({ "claims/9": "CAROL", "players/CAROL": { n: 9, at: TS, email: "c@example.com" } }));
    await assertFails(db.ref(G).update({ "claims/9": "CAROL", "players/CAROL": { n: 9, at: TS, x: 1 } }));
    await assertSucceeds(join(db, "CAROL", 9));                                         // the clean version is fine...
    await assertFails(db.ref(G + "/players/CAROL/name").set("Carol"));                    // ...and then no extras
    await assertFails(db.ref(G + "/players/CAROL/email").set("c@example.com"));
    await assertFails(db.ref(G + "/players/CAROL").update({ nick: 3 }));
    await assertFails(db.ref(G + "/players/CAROL/n/sub").set(1));
  });
  test("7.8 a record for a game that does not exist is denied", async () => {
    await assertFails(anon("CAROL").ref("games/WXZB").update({ "claims/9": "CAROL", "players/CAROL": { n: 9, at: TS } }));
  });
  test("7.8 a record with the n of someone else's claim, claimed in the same write, is denied", async () => {
    await assertFails(anon("CAROL").ref(G).update({ "claims/5": "CAROL", "players/CAROL": { n: 5, at: TS } }));
  });
});

describe("7.9 strings where a number is required", () => {
  test("7.9 n as a string is denied", async () => {
    await assertFails(anon("CAROL").ref(G).update({ "claims/9": "CAROL", "players/CAROL": { n: "9", at: TS } }));
    await assertFails(anon("ALICE").ref(G + "/players/ALICE/n").set("5"));
  });
  test("7.9 at as a string is denied (player and tap)", async () => {
    await assertFails(anon("CAROL").ref(G).update({ "claims/9": "CAROL", "players/CAROL": { n: 9, at: "now" } }));
    await assertFails(anon("ALICE").ref(G + "/taps/ALICE/1_0").set({ n: 1, v: 1, at: "now" }));
    await assertFails(anon("ALICE").ref(G + "/taps/ALICE/1_0").set({ n: 1, v: 1, at: String(Date.now()) }));
  });
  test("7.9 v as a string is denied", async () => {
    await assertFails(anon("ALICE").ref(G + "/taps/ALICE/1_0").set({ n: 1, v: "2", at: TS }));
    await assertFails(anon("ALICE").ref(G + "/taps/ALICE/1_0").set({ n: 1, v: "Carol Smith", at: TS }));
  });
  test("7.9 tap n as a string is denied", async () => {
    await assertFails(anon("ALICE").ref(G + "/taps/ALICE/1_0").set({ n: "1", v: 1, at: TS }));
  });
  test("7.9 a boolean or an object where a number is required is denied", async () => {
    await assertFails(anon("ALICE").ref(G + "/taps/ALICE/1_0").set({ n: 1, v: true, at: TS }));
    await assertFails(anon("ALICE").ref(G + "/taps/ALICE/1_0").set({ n: 1, v: { a: 1 }, at: TS }));
  });
});

describe("7.10 taps", () => {
  const tap = (uid, id, v) => anon(uid).ref(G + "/taps/" + uid + "/" + id).set(v);
  test("7.10 control: a good tap in an open round is allowed", async () => {
    await assertSucceeds(tap("ALICE", "1_0", { n: 1, v: 2, at: TS }));
  });
  test("7.10 a tap when the round is closed is denied", async () => {
    await seed((d) => { d.games.BCDF.round.open = false; });
    await assertFails(tap("ALICE", "1_0", { n: 1, v: 2, at: TS }));
  });
  test("7.10 a tap when there is no round at all is denied", async () => {
    await seed((d) => { delete d.games.BCDF.round; });
    await assertFails(tap("ALICE", "1_0", { n: 1, v: 2, at: TS }));
  });
  test("7.10 a stale or future round number is denied", async () => {
    await seed((d) => { d.games.BCDF.round.n = 3; });
    await assertFails(tap("ALICE", "2_0", { n: 2, v: 2, at: TS }));   // stale
    await assertFails(tap("ALICE", "4_0", { n: 4, v: 2, at: TS }));   // future
    await assertFails(tap("ALICE", "3_0", { n: 2, v: 2, at: TS }));   // id says 3, n says 2
    await assertFails(tap("ALICE", "2_0", { n: 3, v: 2, at: TS }));   // id says 2, n says 3
    await assertSucceeds(tap("ALICE", "3_0", { n: 3, v: 2, at: TS }));
  });
  test("7.10 v outside 0-9, negative or fractional is denied; 0 and 9 are allowed", async () => {
    for (const v of [-1, 10, 100, 1.5, null]) await assertFails(tap("ALICE", "1_0", { n: 1, v, at: TS }));
    await assertSucceeds(tap("ALICE", "1_0", { n: 1, v: 0, at: TS }));
    await assertSucceeds(tap("ALICE", "1_1", { n: 1, v: 9, at: TS }));
  });
  test("7.10 editing or deleting an existing tap is denied", async () => {
    await assertFails(tap("BOB", "1_0", { n: 1, v: 5, at: TS }));
    await assertFails(anon("BOB").ref(G + "/taps/BOB/1_0/v").set(5));
    await assertFails(anon("BOB").ref(G + "/taps/BOB/1_0").remove());
    await assertFails(anon("BOB").ref(G + "/taps/BOB").remove());
  });
  test("7.10 a client-chosen time instead of the server time is denied", async () => {
    await assertFails(tap("ALICE", "1_0", { n: 1, v: 2, at: Date.now() }));
    await assertFails(tap("ALICE", "1_0", { n: 1, v: 2, at: 1 }));
    await assertFails(tap("ALICE", "1_0", { n: 1, v: 2, at: Date.now() + 3600 * 1000 }));
  });
  test("7.10 an extra child is denied", async () => {
    await assertFails(tap("ALICE", "1_0", { n: 1, v: 2, at: TS, name: "Alice" }));
    await assertFails(tap("ALICE", "1_0", { n: 1, v: 2, at: TS, why: "because" }));
  });
  test("7.10 a missing field is denied", async () => {
    await assertFails(tap("ALICE", "1_0", { n: 1, v: 2 }));
    await assertFails(tap("ALICE", "1_0", { n: 1, at: TS }));
    await assertFails(tap("ALICE", "1_0", { v: 1, at: TS }));
  });
});

describe("7.11 a tap into another player's taps", () => {
  test("7.11 is denied", async () => {
    await assertFails(anon("ALICE").ref(G + "/taps/BOB/1_5").set({ n: 1, v: 1, at: TS }));
    await assertFails(anon("ALICE").ref(G + "/taps/ZED/1_0").set({ n: 1, v: 1, at: TS }));
  });
});

describe("7.12 config/teacherUid is console-only", () => {
  test("7.12 nobody can write it: teacher, forged teacher, student, stranger", async () => {
    for (const db of [teacher(), forgedTeacher(), anon("ALICE"), google("SOMEONE"), nobody()]) {
      await assertFails(ref(db, "config/teacherUid").set("MY-UID"));
      await assertFails(ref(db, "config").set({ teacherUid: "MY-UID" }));
      await assertFails(ref(db, "config/teacherUid").remove());
      await assertFails(ref(db, "config/other").set(1));
    }
    assert.equal((await dump()).config.teacherUid, TEACHER);
  });
  test("7.12 not even the teacher can read it", async () => {
    await assertFails(ref(teacher(), "config/teacherUid").get());
  });
  test("7.12 a write to the database root is denied", async () => {
    await assertFails(ref(teacher(), "").set({ config: { teacherUid: "MY-UID" } }));
    await assertFails(ref(anon("ALICE"), "").update({ "config/teacherUid": "ALICE" }));
  });
});

describe("7.13 size and shape abuse", () => {
  test("7.13 a very long string in any student-writable place is denied", async () => {
    const a = anon("CAROL");
    await assertFails(a.ref(G + "/claims/9").set(LONG));
    await assertFails(a.ref(G).update({ "claims/9": LONG, "players/CAROL": { n: 9, at: TS } }));
    await assertFails(a.ref(G).update({ "claims/9": "CAROL", "players/CAROL": { n: 9, at: TS, name: LONG } }));
    await assertFails(a.ref(G).update({ "claims/9": "CAROL", "players/CAROL": { n: LONG, at: TS } }));
    await assertFails(a.ref(G + "/players/CAROL").set(LONG));
    await assertFails(anon("ALICE").ref(G + "/taps/ALICE/1_0").set({ n: 1, v: LONG, at: TS }));
    await assertFails(anon("ALICE").ref(G + "/taps/ALICE/1_0").set(LONG));
    await assertFails(anon("ALICE").ref(G + "/taps/ALICE/" + LONGKEY).set({ n: 1, v: 1, at: TS }));
    await assertFails(anon("ALICE").ref(G + "/" + LONGKEY).set("x"));
    await assertFails(anon("ALICE").ref(G + "/claims/" + LONGKEY).set("ALICE"));
  });
  test("7.13 a very long key is denied (keys are text too)", async () => {
    await assertFails(anon("ALICE").ref(G + "/taps/ALICE/" + "1".repeat(700) + "_0").set({ n: 1, v: 1, at: TS }));
    await assertFails(anon("CAROL").ref(G + "/players/" + LONGKEY).set({ n: 1, at: TS }));
  });
  test("7.13 a very long string even from the teacher is refused where the shape says 'short'", async () => {
    await assertFails(teacher().ref(G + "/meta/set/mode").set(LONG));
    await assertFails(teacher().ref(G + "/meta/phase").set(LONG));
    await assertFails(teacher().ref(G + "/meta/mode").set(LONG));
  });
  test("7.13 nothing the database is left holding contains a string a student chose", async () => {
    // after all of the attacks above, run the worst of them again and look at the data
    await assertFails(anon("CAROL").ref(G + "/players/CAROL").set({ n: 9, at: TS, name: "Carol Smith" }));
    const now = JSON.stringify(await dump());
    assert(!now.includes("Carol"));
  });
});

describe("7.14 the happy path: the rules are not simply locked shut", () => {
  test("7.14 the teacher creates, edits and deletes a game", async () => {
    const t = teacher();
    await assertSucceeds(ref(t, "games/WXZB/meta").set(
      { host: TEACHER, mode: "poll", phase: "lobby", created: TS, live: true, beat: TS, teamSize: 0, set: { goal: 8, show: "yes" } }));
    await assertSucceeds(ref(t, "games/WXZB/meta").update({ phase: "play", beat: TS }));
    await assertSucceeds(ref(t, "games/WXZB/meta/live").set(false));
    await assertSucceeds(ref(t, "games/WXZB/round").set({ n: 1, open: true, t0: TS, ms: 8000, q: "A, B or C?", choices: ["A", "B", "C"] }));
    await assertSucceeds(ref(t, "games/WXZB/round/open").set(false));
    await assertSucceeds(ref(t, "games/WXZB/reveal").set({ n: 1, answer: 1 }));
    await assertSucceeds(ref(t, "games/WXZB/score/0").set(5));
    await assertSucceeds(ref(t, "games/WXZB/teams/SOMEUID").set(3));
    await assertSucceeds(ref(t, "games/WXZB/hands/SOMEUID").set({ n: 1, cards: [{ id: "x" }] }));
    await assertSucceeds(ref(t, "games/WXZB/state").set({ anything: { goes: [1, 2, 3] } }));
    await assertSucceeds(ref(t, "games").orderByChild("meta/created").endAt(Date.now()).get());
    await assertSucceeds(ref(t, "games/WXZB").remove());
    assert.equal((await dump()).games.WXZB, undefined);
  });
  test("7.14 the teacher can list games, read everyone's hands and taps, and remove a player", async () => {
    const t = teacher();
    await assertSucceeds(ref(t, "games").get());
    await assertSucceeds(ref(t, G + "/hands").get());
    await assertSucceeds(ref(t, G + "/taps").get());
    await assertSucceeds(t.ref(G).update({ "players/BOB": null, "claims/7": null }));
  });
  test("7.14 a student claims a name, joins, reads the public nodes and taps in an open round", async () => {
    const c = anon("CAROL");
    await assertSucceeds(ref(c, G + "/meta").get());
    await assertSucceeds(join(c, "CAROL", 9));
    for (const n of ["meta", "claims", "players", "teams", "round", "reveal", "score", "state"]) {
      await assertSucceeds(ref(c, G + "/" + n).get());
    }
    await assertSucceeds(ref(c, G + "/taps/CAROL/1_0").set({ n: 1, v: 3, at: TS }));
    await assertSucceeds(ref(c, G + "/taps/CAROL/1_1").set({ n: 1, v: 4, at: TS }));   // a second tap, same round
    await assertSucceeds(ref(c, G + "/hands/CAROL").get());
    await assertSucceeds(ref(c, G + "/taps/CAROL").get());
  });
  test("7.14 a student can re-roll to a different free name (releasing the old one in the same write)", async () => {
    await assertSucceeds(anon("ALICE").ref(G).update({ "claims/5": null, "claims/6": "ALICE", "players/ALICE/n": 6 }));
    const d = await dump();
    assert.equal(d.games.BCDF.players.ALICE.n, 6);
    assert.equal(d.games.BCDF.players.ALICE.at, 1000);   // joined-at is not reset
    assert.equal(d.games.BCDF.claims[5], undefined);
  });
  test("7.14 a Google-signed-in non-teacher can play as a student", async () => {
    await assertSucceeds(join(google("SOMEONE"), "SOMEONE", 11));
  });
});

// =================================================================================================
// Attacks the SPEC list does not have.
describe("extra attacks", () => {
  test("extra 1: hoarding names -- a second claim without releasing the first is denied", async () => {
    const c = anon("CAROL");
    await assertSucceeds(join(c, "CAROL", 9));
    await assertFails(ref(c, G + "/claims/10").set("CAROL"));                                      // claim alone
    await assertFails(c.ref(G).update({ "claims/10": "CAROL", "players/CAROL/n": 10 }));           // move, old claim kept
    await assertFails(c.ref(G).update({ "claims/10": "CAROL", "claims/11": "CAROL", "players/CAROL/n": 10 }));
    const d = await dump();
    assert.deepEqual(Object.keys(d.games.BCDF.claims).sort(), ["5", "7", "9"]);
  });
  test("extra 2: a claim with no player record behind it (name squatting) is denied", async () => {
    for (const idx of [9, 10, 100, 959]) await assertFails(ref(anon("CAROL"), G + "/claims/" + idx).set("CAROL"));
  });
  test("extra 3: releasing the name one is still using (so someone else could be given the same name) is denied", async () => {
    await assertFails(ref(anon("ALICE"), G + "/claims/5").remove());
    await assertFails(ref(anon("ALICE"), G + "/claims/5").set(null));
  });
  test("extra 4: smuggling a forbidden write inside an otherwise legal join is denied, and nothing is written", async () => {
    const c = anon("CAROL");
    const before = JSON.stringify(await dump());
    for (const smuggled of [{ "meta/phase": "done" }, { "players/ALICE/n": 9 }, { "round/open": false }, { "teams/CAROL": 0 },
      { "score/0": 99999 }, { "claims/7": null }, { "taps/BOB/1_3": { n: 1, v: 1, at: TS } }]) {
      await assertFails(c.ref(G).update({ "claims/9": "CAROL", "players/CAROL": { n: 9, at: TS }, ...smuggled }));
    }
    assert.equal(JSON.stringify(await dump()), before);
  });
  test("extra 5: a tap needs a player record -- a stranger who only knows the code cannot tap", async () => {
    await assertFails(ref(anon("STRANGER"), G + "/taps/STRANGER/1_0").set({ n: 1, v: 1, at: TS }));
  });
  test("extra 6: tap flooding -- at most ten taps a round (ids 0-9); id 10 and a non-numeric id are denied", async () => {
    const a = anon("ALICE");
    for (let k = 0; k < 10; k++) await assertSucceeds(ref(a, G + "/taps/ALICE/1_" + k).set({ n: 1, v: k, at: TS }));
    await assertFails(ref(a, G + "/taps/ALICE/1_10").set({ n: 1, v: 1, at: TS }));
    await assertFails(ref(a, G + "/taps/ALICE/1_a").set({ n: 1, v: 1, at: TS }));
    await assertFails(a.ref(G + "/taps/ALICE").push({ n: 1, v: 1, at: TS }));        // push ids are text
  });
  test("extra 7: replaying a tap id from an earlier round with the new round number is denied", async () => {
    await seed((d) => { d.games.BCDF.round.n = 2; });
    await assertFails(ref(anon("BOB"), G + "/taps/BOB/1_0").set({ n: 2, v: 1, at: TS }));
    await assertSucceeds(ref(anon("BOB"), G + "/taps/BOB/2_0").set({ n: 2, v: 1, at: TS }));
  });
  test("extra 8: the joined-at time cannot be rewritten later (not by a re-roll, not alone)", async () => {
    await assertFails(ref(anon("ALICE"), G + "/players/ALICE/at").set(5));
    await assertFails(ref(anon("ALICE"), G + "/players/ALICE/at").set(TS));
    await assertFails(anon("ALICE").ref(G).update({ "claims/5": null, "claims/6": "ALICE", "players/ALICE": { n: 6, at: TS } }));
  });
  test("extra 9: a student cannot delete their own player record (only the teacher removes players)", async () => {
    await assertFails(ref(anon("ALICE"), G + "/players/ALICE").remove());
    await assertFails(ref(anon("ALICE"), G + "/players/ALICE").set(null));
  });
  test("extra 10: a game code that is not four consonants of the list cannot be created, even by the teacher", async () => {
    const meta = { host: TEACHER, mode: "poll", phase: "lobby", created: TS, live: true, beat: TS, teamSize: 0 };
    for (const code of ["bcdf", "BCDFG", "BCD", "AEIO", "BCD1", "B-DF", LONGKEY, "BCD "]) {
      await assertFails(ref(teacher(), "games/" + code + "/meta").set(meta));
    }
    await assertSucceeds(ref(teacher(), "games/KLMN/meta").set(meta));
  });
  test("extra 11: the teacher cannot write stray children or badly shaped meta (a bug cannot freeze every phone)", async () => {
    const t = teacher();
    await assertFails(ref(t, G + "/junk").set(1));
    await assertFails(ref(t, G + "/meta/phase").set("finished"));
    await assertFails(ref(t, G + "/meta/mode").set("chess"));
    await assertFails(ref(t, G + "/meta/teamSize").set(7));
    await assertFails(ref(t, G + "/meta/host").set("SOMEONE-ELSE"));
    await assertFails(ref(t, G + "/meta/extra").set(1));
    await assertFails(ref(t, G + "/round").set({ n: 2, open: "yes", t0: TS, ms: 5 }));
    await assertFails(ref(t, G + "/teams/BOB").set(10));
    await assertFails(ref(t, G + "/meta/set/bad key!").set(1));
    await assertFails(ref(t, G + "/meta/created").set(5));
  });
  test("extra 12: reading with a query ordered by anything, or a shallow read, of a private node is denied", async () => {
    await assertFails(ref(anon("ALICE"), G + "/taps").orderByKey().get());
    await assertFails(ref(anon("ALICE"), G + "/hands").orderByKey().limitToFirst(5).get());
    await assertFails(ref(anon("ALICE"), "games").orderByKey().limitToFirst(1).get());
  });
  test("extra 13: a student cannot make a second record by writing a record under a different uid key", async () => {
    await assertFails(anon("CAROL").ref(G).update({ "claims/9": "CAROL", "players/CAROL2": { n: 9, at: TS } }));
    await assertFails(anon("CAROL").ref(G).update({ "claims/9": "CAROL", "players/CAROL": { n: 9, at: TS }, "players/CAROL2": { n: 9, at: TS } }));
  });
  test("extra 14: a claim stored for someone else's uid, or a claim value that is not a uid, is denied", async () => {
    await assertFails(anon("CAROL").ref(G).update({ "claims/9": "ALICE", "players/CAROL": { n: 9, at: TS } }));
    await assertFails(anon("CAROL").ref(G).update({ "claims/9": 1, "players/CAROL": { n: 9, at: TS } }));
    await assertFails(anon("CAROL").ref(G).update({ "claims/9": true, "players/CAROL": { n: 9, at: TS } }));
    await assertFails(anon("CAROL").ref(G).update({ "claims/9": { uid: "CAROL" }, "players/CAROL": { n: 9, at: TS } }));
  });
});
