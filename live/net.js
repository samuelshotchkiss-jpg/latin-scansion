// net.js -- the ONLY file in the live game that touches `firebase.*`. AGPL-3.0.
//
// Everything else (host.js, player.js, the modes) calls the plain functions below, so
//   * the exact shape of every write -- the one database.rules.json was written for -- lives here;
//   * a mode cannot write outside its own game, however it is written;
//   * "where does this page talk to?" has one answer, decided in env():
//       - on `localhost`                  -> the Firebase EMULATORS on this computer (practice, tests);
//       - on the real site (pagesHost)    -> the real Firebase project, once its config is pasted in;
//       - on 127.0.0.1 or anywhere else   -> REFUSES TO RUN. (The survey app was once bitten by
//         127.0.0.1 quietly using the live database; here that cannot happen.)
//
// Privacy: signing in uses SESSION persistence -- the sign-in lives in sessionStorage, so a reload of
// the same tab rejoins as the same player and closing the tab forgets it. Nothing is ever written to
// localStorage or a cookie. auditStorage() checks that against the browser's real storage.
window.LiveNet = (function () {
  "use strict";

  const CFG = window.LIVE_CONFIG;
  const TEST_TEACHER = { sub: "test-teacher", email: "teacher@example.test", email_verified: true };
  let auth = null, db = null, kind = null, offset = 0, ready = null;

  // ---- where are we running? -------------------------------------------------------------------------
  function env() {
    const host = location.hostname;
    if (location.protocol === "file:" || !host) {
      return { kind: "refused", message: "This page cannot run from a file. Open it from localhost (see live/HOWTO.md)." };
    }
    if (host === "localhost") return { kind: "emulator" };
    if (host === CFG.pagesHost) {
      return /PASTE/.test(JSON.stringify(CFG.web)) ? { kind: "unconfigured" } : { kind: "live" };
    }
    return {
      kind: "refused",
      message: "This page only runs on localhost (practice, with the test database on your own computer) or on the real site. " +
        "You opened it as “" + host + "”. If that is 127.0.0.1, type localhost instead: it is the same computer, " +
        "but it stops this page from ever reaching the real database by accident.",
    };
  }

  // ---- start up --------------------------------------------------------------------------------------
  function init() {
    if (ready) return ready;
    ready = (async () => {
      const e = env();
      kind = e.kind;
      if (kind !== "emulator" && kind !== "live") throw Object.assign(new Error(e.message || "not set up"), { kind });
      if (typeof firebase === "undefined") throw Object.assign(new Error("The Firebase library did not load. Is the network blocking it?"), { kind: "nolib" });
      const conf = kind === "emulator" ? CFG.emulator : CFG.web;
      firebase.initializeApp(conf);
      auth = firebase.auth();
      db = firebase.database();
      if (kind === "emulator") {
        auth.useEmulator("http://localhost:" + CFG.emulator.authPort, { disableWarnings: true });
        db.useEmulator("localhost", CFG.emulator.dbPort);
      }
      await auth.setPersistence(firebase.auth.Auth.Persistence.SESSION);
      db.ref(".info/serverTimeOffset").on("value", (s) => { offset = s.val() || 0; });
      await new Promise((res) => { const off = auth.onAuthStateChanged(() => { off(); res(); }); });
      return kind;
    })();
    return ready;
  }
  const must = () => { if (!db) throw new Error("LiveNet.init() has not finished"); };

  const now = () => Date.now() + offset;                        // the SERVER's clock, in ms
  const TS = () => firebase.database.ServerValue.TIMESTAMP;     // placeholder for "server time, on write"
  const user = () => (auth && auth.currentUser) || null;
  const uid = () => (user() ? user().uid : null);
  const provider = () => {
    const u = user();
    if (!u) return null;
    if (u.isAnonymous) return "anonymous";
    return (u.providerData[0] && u.providerData[0].providerId) || "other";
  };
  const onConnection = (cb) => { must(); const r = db.ref(".info/connected"); const f = (s) => cb(!!s.val()); r.on("value", f); return () => r.off("value", f); };

  // ---- signing in ------------------------------------------------------------------------------------
  async function signInAnon() {
    must();
    if (user() && user().isAnonymous) return user().uid;
    return (await auth.signInAnonymously()).user.uid;
  }
  async function signInGoogle() {
    must();
    return (await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider())).user.uid;
  }
  // Emulator only: a made-up Google teacher, the same one tools/seed-emulator.js registers, so the
  // pages can be tried without a Google account and without a popup.
  async function signInTestTeacher() {
    must();
    if (kind !== "emulator") throw new Error("The test teacher exists only in the emulator.");
    const cred = firebase.auth.GoogleAuthProvider.credential(JSON.stringify(TEST_TEACHER));
    return (await auth.signInWithCredential(cred)).user.uid;
  }
  async function signOut() { must(); await auth.signOut(); }
  const onAuth = (cb) => { must(); return auth.onAuthStateChanged(cb); };

  // ---- paths -----------------------------------------------------------------------------------------
  const G = (code, p) => "games/" + code + (p ? "/" + p : "");
  const R = (code, p) => db.ref(G(code, p));
  const errCode = (e) => (e && (e.code || (/PERMISSION_DENIED/.test(e.message) ? "PERMISSION_DENIED" : ""))) || "";

  // Watch one node (a "value" listener). Returns an unsubscribe function.
  function watch(path, cb, onError) {
    must();
    const r = db.ref(path);
    const f = (s) => cb(s.val());
    r.on("value", f, (e) => { if (onError) onError(e); });
    return () => r.off("value", f);
  }

  // ---- the student's side ---------------------------------------------------------------------------
  async function readMeta(code) { must(); return (await R(code, "meta").get()).val(); }

  // Watch everything a student may read, plus their own hand and taps. `h` maps names to callbacks:
  // meta, claims, players, teams, round, reveal, score, state, hand, taps. Returns one unsubscribe.
  function watchGame(code, h, onError) {
    const offs = [];
    for (const k of ["meta", "claims", "players", "teams", "round", "reveal", "score", "state"]) {
      if (h[k]) offs.push(watch(G(code, k), h[k], onError));
    }
    if (h.hand) offs.push(watch(G(code, "hands/" + uid()), h.hand, onError));
    if (h.taps) offs.push(watch(G(code, "taps/" + uid()), h.taps, onError));
    return () => offs.forEach((f) => f());
  }

  // Joining = claim a codename and write the player record in ONE write. The rules refuse a claim
  // with no matching player record (that is what stops one student hoarding names) and a player
  // record whose name is not claimed by the writer. A PERMISSION_DENIED here usually means someone
  // else got that name first: the caller picks another and tries again.
  function join(code, idx) {
    must();
    const me = uid();
    return R(code).update({ ["claims/" + idx]: me, ["players/" + me]: { n: idx, at: TS() } });
  }
  // "Different name": release the old claim and take a new one, again in one write. (`at`, the time
  // of first joining, stays as it was.)
  function reroll(code, oldIdx, newIdx) {
    must();
    const me = uid();
    return R(code).update({ ["claims/" + oldIdx]: null, ["claims/" + newIdx]: me, ["players/" + me + "/n"]: newIdx });
  }
  // A tap: v is a whole number 0-9, n the round, k which tap of this round this is (0-9). The key is
  // "n_k", made only of digits; the time is the SERVER's, which is what makes the fastest tap fair.
  function tap(code, n, k, v) {
    must();
    return R(code, "taps/" + uid() + "/" + n + "_" + k).set({ n, v, at: TS() });
  }

  // ---- the teacher's side ---------------------------------------------------------------------------
  // Pick a free code and create the game. `settings` is Live.encodeSettings output.
  async function createGame({ mode, set, teamSize, randomCode }) {
    must();
    for (let tries = 0; tries < 12; tries++) {
      const code = randomCode();
      if ((await R(code, "meta").get()).exists()) continue;
      const meta = { host: uid(), mode, phase: "lobby", created: TS(), live: true, beat: TS(), teamSize: teamSize || 0 };
      if (set && Object.keys(set).length) meta.set = set;
      await R(code, "meta").set(meta);
      return code;
    }
    throw new Error("Could not find a free game code. Try again.");
  }
  // The teacher's games, newest first: [{ code, meta }].
  async function listGames() {
    must();
    const s = await db.ref("games").orderByChild("meta/created").get();
    const out = [];
    s.forEach((c) => { const m = c.child("meta").val(); if (m) out.push({ code: c.key, meta: m }); });
    return out.reverse();
  }
  // Delete every game older than maxAgeMs (SPEC section 2, rule 4). Returns how many.
  async function sweepOld(maxAgeMs) {
    must();
    const s = await db.ref("games").orderByChild("meta/created").endAt(now() - maxAgeMs).get();
    const codes = [];
    s.forEach((c) => { codes.push(c.key); });
    await Promise.all(codes.map((c) => R(c).remove()));
    return codes.length;
  }
  async function deleteGame(code) { must(); await R(code).remove(); }

  // The host's view: the same nodes as a student, plus every player's taps as they arrive.
  // h.taps(uid, { "3_0": {n, v, at}, ... }) is called with that player's whole set whenever it changes.
  function watchGameHost(code, h, onError) {
    const offs = [];
    for (const k of ["meta", "claims", "players", "teams", "round", "reveal", "score", "state"]) {
      if (h[k]) offs.push(watch(G(code, k), h[k], onError));
    }
    if (h.taps) {
      const r = R(code, "taps");
      const f = (s) => h.taps(s.key, s.val() || {});
      r.on("child_added", f, onError); r.on("child_changed", f, onError);
      offs.push(() => { r.off("child_added", f); r.off("child_changed", f); });
    }
    return () => offs.forEach((f) => f());
  }
  async function fetchTaps(code) { must(); return (await R(code, "taps").get()).val() || {}; }
  // Several writes to one game in one go. Paths are relative to the game ("round/open").
  function update(code, updates) { must(); return R(code).update(updates); }
  function heartbeat(code) { must(); return R(code).update({ "meta/beat": TS(), "meta/live": true }); }
  // If the teacher's page disappears (tab killed, laptop shut), the server marks the game not-live.
  function armDisconnect(code) { must(); return R(code, "meta/live").onDisconnect().set(false); }
  // Remove a player and everything that is theirs (the name, the team, their hand and taps).
  function removePlayer(code, uidToRemove, idx) {
    must();
    const u = {};
    u["players/" + uidToRemove] = null; u["teams/" + uidToRemove] = null;
    u["hands/" + uidToRemove] = null; u["taps/" + uidToRemove] = null;
    if (Number.isInteger(idx)) u["claims/" + idx] = null;
    return R(code).update(u);
  }

  // ---- what is stored on this device? ---------------------------------------------------------------
  // Reads the browser's real storage and compares it with Live.STORED (the list the privacy notice is
  // built from). Returns { found, unexpected, ok }. Used by the "storage check" on the debug pages and
  // by the tests; `unexpected` must be empty.
  async function auditStorage() {
    const keys = (s) => { const k = []; try { for (let i = 0; i < s.length; i++) k.push(s.key(i)); } catch (e) { /* blocked */ } return k; };
    const found = {
      local: keys(window.localStorage),
      session: keys(window.sessionStorage),
      cookies: document.cookie.split(";").map((c) => c.trim().split("=")[0]).filter(Boolean),
      indexedDB: [],
    };
    try { if (indexedDB.databases) found.indexedDB = (await indexedDB.databases()).map((d) => d.name); } catch (e) { /* blocked */ }
    const S = Live.STORED;
    const unexpected = [];
    const other = [];
    for (const k of found.local) {
      if (S.otherPages.local.some((re) => re.test(k))) other.push("localStorage: " + k + " (another page of this site)");
      else if (!S.local.some((x) => x.key.test(k))) unexpected.push("localStorage: " + k);
    }
    for (const k of found.session) if (!S.session.some((x) => x.key.test(k))) unexpected.push("sessionStorage: " + k);
    // Cookies belong to the whole host name (on localhost, to every app on every port), so a cookie cannot be
    // blamed on this page by its presence alone. The live pages never set one: tests/static.test.js checks
    // that no live script touches document.cookie. Cookies are listed under `found`, and flagged here only
    // if they look like Firebase's or this game's.
    for (const k of found.cookies) if (/firebase|live|session|^_g/i.test(k)) unexpected.push("cookie: " + k);
    for (const k of found.indexedDB) if (!S.indexedDB.some((x) => x.db === k)) unexpected.push("IndexedDB: " + k);
    return { found, otherPages: other, unexpected, ok: unexpected.length === 0 };
  }

  return {
    env, init, now, TS, uid, provider, onConnection,
    signInAnon, signInGoogle, signInTestTeacher, signOut, onAuth,
    watch, readMeta, watchGame, join, reroll, tap,
    createGame, listGames, sweepOld, deleteGame, watchGameHost, fetchTaps, update, heartbeat, armDisconnect, removePlayer,
    auditStorage, errCode,
    isEmulator: () => kind === "emulator",
  };
})();
