// host.js -- the teacher's page (host.html), the one on the projector. AGPL-3.0.
//
// THE TEACHER'S BROWSER IS THE HOST. It keeps the answer key in its own memory, grades every tap, and
// writes the results; the phones only send taps and draw what this page writes. That is why there is
// no server: the one page that is trusted is the teacher's. (Consequence, said plainly in HOWTO.md:
// reloading or closing this page in the middle of a game ends that game, because the key was only in
// its memory.)
//
// What this file does, in the order a class meets it:
//   sign in (Google) -> setup (pick a mode, set its options) -> lobby (code, QR, who has joined,
//   teams) -> play (round loop: open -> lock -> reveal -> Next ...) -> done (final scores) -> end game
//   (everything deleted).
// A mode (live/modes/*.js, see live/MODES.md) supplies only what is specific to its game; this
// file runs the loop around it. It never calls firebase.* itself: everything goes through LiveNet.
(function () {
  "use strict";
  const { h, clear } = Live;
  const Net = LiveNet;
  const $ = (id) => document.getElementById(id);

  const SWEEP_MS = 12 * 3600 * 1000;       // a game older than this is deleted when the teacher next opens this page
  const BEAT_MS = 5000;                    // heartbeat: phones show "Waiting for the teacher" if it stops
  const DEBUG = /(^|[?&])debug\b/.test(location.search);
  const WRITABLE_BY_MODES = /^(state|hands|score)(\/|$)/;   // ctx.write may touch only these parts of the game

  // ---- state -----------------------------------------------------------------------------------------
  const S = {
    screen: "boot",              // boot | refused | unconfigured | error | signin | setup | game
    error: null,
    code: null, def: null, ctx: null,
    meta: null, players: {}, claims: {}, teams: {}, round: null, reveal: null, score: null, state: null,
    stage: "idle",               // idle | starting | open | locking | revealed | done   (the round loop)
    tapped: {},                  // uid -> number of taps this round
    seen: new Set(),             // "uid/tapId" already delivered to the mode
    timer: null, autoTimer: null, beatTimer: null, unwatch: null, assigned: new Set(),
    setup: null,                 // the form being filled in on the setup screen
    myGames: null, notTeacher: false, confirmEnd: false, storageReport: null, busy: false,
    dom: null,                   // persistent pieces of the play screen
  };

  // ---- drawing -----------------------------------------------------------------------------------------
  // (a timer, not requestAnimationFrame: a tab in the background, such as a projector window behind another,
  // gets no animation frames, and the screen must still keep up)
  let queued = false;
  function draw() {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; try { render(); } catch (e) { console.error(e); fail(e); } }, 16);
  }
  function fail(e) {
    S.screen = "error"; S.error = (e && e.message) || String(e);
    render();
  }
  function setBanner() {
    const b = $("live-banner");
    if (Net.env().kind === "emulator") { b.hidden = false; b.textContent = "TEST MODE — the practice database on this computer. Nothing here is real, and nothing leaves this computer."; }
  }
  function say(app, title, lines) {
    clear(app);
    app.appendChild(h("div", { class: "live-card" }, h("h2", {}, title), lines.map((l) => (typeof l === "string" ? h("p", {}, l) : l))));
  }

  function render() {
    const app = $("app");
    $("live-controls").hidden = true;
    if (S.screen !== "game" || !S.meta || S.meta.phase !== "play") S.dom = null;
    $("signout").hidden = !(Net.provider() && S.screen !== "boot");
    switch (S.screen) {
      case "boot": say(app, "Starting…", []); break;
      case "refused": say(app, "This page will not run here", [Net.env().message]); break;
      case "unconfigured":
        say(app, "This game is not set up yet", [
          "The live game needs its own Firebase project, and this copy of the site has not been connected to one yet.",
          "The owner does this once (live/HOWTO.md, Part 2: about 20 minutes). Until then the practice pages work as they always have.",
          "To try the live game on your own computer in the meantime, open this page from http://localhost:8770/host.html (see live/HOWTO.md, Part 1)."]);
        break;
      case "error": say(app, "Something went wrong", [S.error || "Unknown error.", h("button", { type: "button", onclick: () => location.reload() }, "Reload this page")]); break;
      case "signin": return drawSignin(app);
      case "setup": return drawSetup(app);
      case "game": return drawGame(app);
    }
  }

  // ---- sign in -----------------------------------------------------------------------------------------
  function drawSignin(app) {
    clear(app);
    const card = h("div", { class: "live-card" },
      h("h2", {}, "Teacher sign-in"),
      h("p", {}, "Sign in with your Google account to run a game. Students never sign in: they just open the link."),
      h("button", { type: "button", class: "primary live-bigbtn", onclick: () => doSignin(() => Net.signInGoogle()) }, "Sign in with Google"));
    if (Net.isEmulator()) {
      card.appendChild(h("p", { class: "live-note" }, "Practice mode: no Google account needed."));
      card.appendChild(h("button", { type: "button", id: "test-teacher", onclick: () => doSignin(() => Net.signInTestTeacher()) }, "Sign in as the test teacher"));
    }
    if (S.error) card.appendChild(h("p", { class: "live-error" }, S.error));
    app.appendChild(card);
  }
  async function doSignin(fn) {
    S.error = null;
    try { await fn(); await afterSignin(); } catch (e) {
      S.error = e.code === "auth/popup-closed-by-user" ? "The sign-in window was closed before it finished." : "Sign-in did not work: " + (e.message || e.code);
      S.screen = "signin"; draw();
    }
  }
  async function afterSignin() {
    if (Net.provider() !== "google.com") { await Net.signOut(); S.screen = "signin"; return draw(); }
    S.screen = "setup"; S.setup = null; S.myGames = null; S.notTeacher = false;
    draw();
    try {
      const swept = await Net.sweepOld(SWEEP_MS);
      S.myGames = await Net.listGames();
      S.swept = swept;
    } catch (e) {
      if (Net.errCode(e) === "PERMISSION_DENIED") S.notTeacher = true; else return fail(e);
    }
    draw();
  }

  // ---- setup -------------------------------------------------------------------------------------------
  function modeList() { return Object.values(Live.modes).filter((m) => !m.hidden || DEBUG); }
  function initSetup() {
    const first = modeList().find((m) => m.built !== false) || modeList()[0];
    S.setup = { modeId: first ? first.id : null, values: {}, teamsOn: false, teamSize: 3 };
    if (first) pickMode(first.id);
  }
  function pickMode(id) {
    const def = Live.modes[id];
    S.setup.modeId = id;
    S.setup.values = Live.defaultSettings(def);
    const t = def.teams;
    S.setup.teamsOn = !!(t && !t.optional);
    S.setup.teamSize = t && t.sizes ? t.sizes[0] : 3;
  }
  function drawSetup(app) {
    clear(app);
    if (S.notTeacher) return drawNotTeacher(app);
    if (!S.setup) initSetup();
    const su = S.setup, def = Live.modes[su.modeId];

    const wrap = h("div", { class: "live-setup" });
    // earlier games of this teacher (the page was closed, or a game was left behind)
    if (S.myGames && S.myGames.length) {
      const box = h("div", { class: "live-card" }, h("h2", {}, "Your games"));
      for (const g of S.myGames) {
        const d = Live.modes[g.meta.mode];
        const resumable = g.meta.phase === "lobby" && d && d.built !== false;
        box.appendChild(h("div", { class: "live-gamerow" },
          h("b", { class: "live-code-sm" }, g.code),
          h("span", {}, (d ? d.title : g.meta.mode) + " · " + g.meta.phase + (g.meta.phase === "play" ? " (cannot be resumed: its answers were only in the page that was closed)" : "")),
          resumable ? h("button", { type: "button", onclick: () => enterGame(g.code) }, "Open") : null,
          h("button", { type: "button", onclick: async () => { await Net.deleteGame(g.code); S.myGames = await Net.listGames(); draw(); } }, "Delete")));
      }
      wrap.appendChild(box);
    }

    const card = h("div", { class: "live-card" }, h("h2", {}, "New game"));
    const modes = h("div", { class: "live-modes", role: "radiogroup", "aria-label": "Game type" });
    for (const m of modeList()) {
      const built = m.built !== false;
      modes.appendChild(h("button", {
        type: "button", role: "radio", "aria-checked": String(m.id === su.modeId), disabled: !built,
        class: "live-modebtn" + (m.id === su.modeId ? " on" : ""), onclick: () => { pickMode(m.id); draw(); },
      }, h("b", {}, m.title), h("span", {}, built ? (m.blurb || "") : "Not built yet"), m.hidden ? h("em", {}, "test mode") : null));
    }
    card.appendChild(modes);

    if (def && def.built !== false) {
      const form = h("div", { class: "live-form" });
      for (const s of def.settings) form.appendChild(settingControl(s, su.values));
      if (def.teams) {
        const t = def.teams;
        if (t.optional) {
          form.appendChild(h("label", { class: "live-field" }, h("input", { type: "checkbox", checked: su.teamsOn, onchange: (e) => { su.teamsOn = e.target.checked; draw(); } }), " Play in teams"));
        }
        if (su.teamsOn || !t.optional) {
          const opts = (t.sizes || [2, 3]).map((n) => [String(n), "teams of about " + n]);
          if (t.all) opts.push(["0", "everyone in one team"]);
          form.appendChild(h("label", { class: "live-field" }, "Teams ",
            h("select", { onchange: (e) => { su.teamSize = +e.target.value; } },
              opts.map(([v, l]) => h("option", { value: v, selected: +v === su.teamSize }, l)))));
        }
      }
      card.appendChild(form);
    }
    if (S.error) card.appendChild(h("p", { class: "live-error" }, S.error));
    card.appendChild(h("button", { type: "button", id: "create", class: "primary live-bigbtn", disabled: !def || def.built === false || S.busy, onclick: createGame }, "Create game"));
    wrap.appendChild(card);
    if (S.swept) wrap.appendChild(h("p", { class: "live-note" }, S.swept + " old game" + (S.swept === 1 ? "" : "s") + " (over 12 hours) deleted."));

    if (DEBUG) {
      const dbg = h("div", { class: "live-card" }, h("h3", {}, "Debug"),
        h("button", { type: "button", id: "storage-check", onclick: async () => { S.storageReport = await Net.auditStorage(); draw(); } }, "Check what this browser has stored"));
      if (S.storageReport) dbg.appendChild(h("pre", { id: "storage-report" }, JSON.stringify(S.storageReport, null, 1)));
      wrap.appendChild(dbg);
    }
    app.appendChild(wrap);
  }
  function settingControl(s, values) {
    const field = h("div", { class: "live-field" });
    if (s.type === "flags") {
      field.appendChild(h("span", { class: "live-flabel" }, s.label));
      const box = h("div", { class: "live-flags" });
      for (const [val, label] of s.options) {
        box.appendChild(h("label", {}, h("input", {
          type: "checkbox", checked: (values[s.key] || []).includes(val),
          onchange: (e) => { const set = new Set(values[s.key]); e.target.checked ? set.add(val) : set.delete(val); values[s.key] = [...set]; },
        }), " " + label));
      }
      field.appendChild(box);
    } else {
      const opts = s.type === "int" ? s.options.map((n) => [n, String(n)]) : s.options;
      field.appendChild(h("label", {}, s.label + " ",
        h("select", { id: "set-" + s.key, onchange: (e) => { values[s.key] = s.type === "int" ? +e.target.value : e.target.value; } },
          opts.map(([v, l]) => h("option", { value: v, selected: v === values[s.key] }, l)))));
    }
    return field;
  }
  function drawNotTeacher(app) {
    const me = Net.uid();
    app.appendChild(h("div", { class: "live-card" },
      h("h2", {}, "Signed in, but not as the teacher yet"),
      h("p", {}, "You are signed in with Google, but the game does not yet know that this account is the teacher. This is a one-time step: in the Firebase console, open Realtime Database → Data, add a child named config, and inside it a child named teacherUid whose value is exactly this:"),
      h("p", {}, h("code", { id: "my-uid", class: "live-uid" }, me)),
      h("p", { class: "live-note" }, "(It is an ID Firebase made up for your account. It is not your email address, and it is the only thing the game checks.) Then reload this page.")));
  }

  async function createGame() {
    const su = S.setup, def = Live.modes[su.modeId];
    S.error = null; S.busy = true; draw();
    try {
      const set = Live.encodeSettings(def, su.values);
      const teamsOn = def.teams && (!def.teams.optional || su.teamsOn);
      if (def.teams && def.teams.optional) set.teams = su.teamsOn ? "on" : "off";
      const code = await Net.createGame({ mode: def.id, set, teamSize: teamsOn ? su.teamSize : 0, randomCode: () => Live.randomCode() });
      S.busy = false;
      await enterGame(code);
    } catch (e) {
      S.busy = false;
      S.error = Net.errCode(e) === "PERMISSION_DENIED" ? "The database refused to create the game. Is this account the teacher account? Reload and check." : (e.message || String(e));
      draw();
    }
  }

  // ---- inside a game ------------------------------------------------------------------------------------
  async function enterGame(code) {
    leaveGame();
    S.code = code; S.screen = "game"; S.stage = "idle"; S.seen = new Set(); S.tapped = {}; S.assigned = new Set();
    S.meta = null; S.players = {}; S.claims = {}; S.teams = {}; S.round = null; S.reveal = null; S.score = null; S.state = null; S.confirmEnd = false;
    let first = true;
    S.unwatch = Net.watchGameHost(code, {
      meta: (v) => {
        S.meta = v;
        if (!v) { if (!first) { leaveGame(); S.screen = "setup"; afterSignin(); } return; }
        if (first) { first = false; buildCtx(); }
        draw();
      },
      players: (v) => { S.players = v || {}; onPlayersChanged(); draw(); },
      claims: (v) => { S.claims = v || {}; },
      teams: (v) => { S.teams = v || {}; draw(); },
      round: (v) => { S.round = v; draw(); },
      reveal: (v) => { S.reveal = v; draw(); },
      score: (v) => { S.score = v; draw(); },
      state: (v) => { S.state = v; draw(); },
      taps: (uid, taps) => ingest(uid, taps),
    }, fail);
    startHeartbeat();
    draw();
  }
  function leaveGame() {
    if (S.unwatch) S.unwatch();
    S.unwatch = null;
    clearTimeout(S.timer); clearTimeout(S.autoTimer); clearInterval(S.beatTimer);
    if (S.offConn) { S.offConn(); S.offConn = null; }
    S.code = null; S.ctx = null; S.def = null; S.dom = null;
  }
  function startHeartbeat() {
    const beat = () => Net.heartbeat(S.code).catch(() => {});
    S.beatTimer = setInterval(beat, BEAT_MS);
    // (re)arm "mark me gone if this page disappears" every time the connection comes back
    S.offConn = Net.onConnection((up) => { if (up && S.code) { Net.armDisconnect(S.code).catch(() => {}); beat(); } });
  }

  const playerList = () => Object.entries(S.players)
    .map(([uid, p]) => ({ uid, idx: p.n, name: Names.nameFor(p.n), gloss: Names.glossFor(p.n), team: Number.isInteger(S.teams[uid]) ? S.teams[uid] : null, at: p.at || 0 }))
    .sort((a, b) => a.at - b.at || (a.uid < b.uid ? -1 : 1));
  const teamGroups = () => {
    const g = {};
    for (const [uid, t] of Object.entries(S.teams)) if (S.players[uid]) (g[t] = g[t] || []).push(uid);
    return g;
  };

  // What a mode is given. Documented in live/MODES.md; keep the two in step.
  function buildCtx() {
    const def = Live.modes[S.meta.mode];
    S.def = def;
    if (!def || def.built === false) return;
    const ctx = {
      code: S.code, mode: def.id, uid: Net.uid(),
      settings: Live.decodeSettings(def, S.meta.set),
      teamsOn: Live.teamsOn(def, S.meta),
      teamSize: S.meta.teamSize,
      mem: {},                                              // the mode's scratch space, in THIS page's memory only
      seed: (Date.now() ^ (Math.random() * 4294967296)) >>> 0,
      n: 0,                                                 // the round number the current call is about
      get round() { return S.round; },
      players: playerList,
      playerOf: (uid) => playerList().find((p) => p.uid === uid) || null,
      nameOf: (uid) => (S.players[uid] ? Names.nameFor(S.players[uid].n) : "?"),
      teamOf: (uid) => (Number.isInteger(S.teams[uid]) ? S.teams[uid] : null),
      teams: teamGroups,
      now: Net.now,
      write: (path, value) => {
        if (!WRITABLE_BY_MODES.test(path)) return Promise.reject(new Error("A mode may write only under state/, hands/ and score/ (tried: " + path + ")"));
        return Net.update(S.code, { [path]: value });
      },
      requestLock: () => { if (S.stage === "open") lock("mode"); },
      requestNext: (ms) => { clearTimeout(S.autoTimer); S.autoTimer = setTimeout(() => { if (S.stage === "revealed") advance(); }, ms || 0); },
    };
    ctx.random = Live.rng(ctx.seed);
    S.ctx = ctx;
  }

  // Late joiners in a team game go to the smallest team; anyone the teacher removed is forgotten.
  function onPlayersChanged() {
    if (!S.ctx || !S.def) return;
    if (S.ctx.teamsOn && S.meta && S.meta.phase === "play") {
      const todo = Object.keys(S.players).filter((u) => !Number.isInteger(S.teams[u]) && !S.assigned.has(u));
      for (const u of todo) {
        S.assigned.add(u);
        const t = Live.smallestTeam(S.teams);
        S.teams[u] = t;
        Net.update(S.code, { ["teams/" + u]: t }).catch(() => {});
      }
    }
  }

  // ---- taps -------------------------------------------------------------------------------------------
  // Every tap reaches the mode exactly once. Taps of other rounds are ignored. `dt` is the time from the
  // round opening to the tap, both on the server's clock; `late` means after the time limit plus a
  // second's grace for the network.
  function ingest(uid, taps) {
    if (!S.round || !S.def || S.def.built === false) return;
    for (const [id, t] of Object.entries(taps)) {
      const key = uid + "/" + id;
      if (S.seen.has(key)) continue;
      S.seen.add(key);
      if (t.n !== S.round.n || (S.stage !== "open" && S.stage !== "locking")) continue;
      S.tapped[uid] = (S.tapped[uid] || 0) + 1;
      const dt = t.at - S.round.t0;
      const tap = { id, n: t.n, v: t.v, at: t.at, dt, late: S.round.ms > 0 && dt > S.round.ms + 1000 };
      try { if (S.def.host.onTap) S.def.host.onTap(S.ctx, uid, tap); } catch (e) { console.error("mode onTap failed", e); }
    }
    draw();
    // everyone has answered at least once: lock soon (a mode can turn this off with autoLock: false)
    if (S.stage === "open" && S.def.autoLock !== false) {
      const who = playerList();
      if (who.length && who.every((p) => S.tapped[p.uid])) { clearTimeout(S.autoTimer); S.autoTimer = setTimeout(() => lock("everyone answered"), 400); }
    }
  }

  // ---- the round loop ----------------------------------------------------------------------------------
  async function startGame() {
    if (S.busy || !Object.keys(S.players).length) return;
    S.busy = true;
    try {
      if (S.ctx.teamsOn && !Object.keys(S.teams).length) await Net.update(S.code, { teams: Live.makeTeams(Object.keys(S.players), S.meta.teamSize) });
      await Net.update(S.code, { "meta/phase": "play" });
      S.stage = "idle";
      if (S.def.host.start) await S.def.host.start(S.ctx);
      S.busy = false;
      await advance();
    } catch (e) { S.busy = false; fail(e); }
  }

  async function advance() {
    if (S.stage === "open") return lock("teacher");
    if (S.stage !== "idle" && S.stage !== "revealed") return;
    clearTimeout(S.autoTimer);
    S.stage = "starting"; draw();
    try {
      const n = (S.round ? S.round.n : 0) + 1;
      S.ctx.n = n;
      const out = await S.def.host.nextRound(S.ctx);
      if (!out) return finish();
      const ms = Math.max(0, Math.min(600000, Math.round(out.ms || 0)));
      const up = { reveal: null, round: Object.assign({}, out.round, { n, open: true, t0: Net.TS(), ms }) };
      for (const [uid, hand] of Object.entries(out.hands || {})) up["hands/" + uid] = Object.assign({}, hand, { n });
      S.tapped = {};
      await Net.update(S.code, up);                 // hands and round together: no phone sees a round without its hand
      S.stage = "open";
      const r = S.round || {};
      if (ms > 0) S.timer = setTimeout(() => lock("time"), Math.max(0, (typeof r.t0 === "number" ? r.t0 : Net.now()) + ms - Net.now()));
    } catch (e) { fail(e); }
    draw();
  }

  async function lock(why) {
    if (S.stage !== "open") return;
    S.stage = "locking"; clearTimeout(S.timer); clearTimeout(S.autoTimer); draw();
    try {
      await Net.update(S.code, { "round/open": false });          // from here the rules refuse new taps
      const all = await Net.fetchTaps(S.code);                    // so this is the complete set
      for (const [uid, taps] of Object.entries(all)) ingest(uid, taps);
      const out = (await S.def.host.lock(S.ctx)) || {};
      const up = { reveal: Object.assign({}, out.reveal, { n: S.round.n }) };
      if (out.score) up.score = out.score;                        // replaces the whole score node
      await Net.update(S.code, up);
      S.stage = "revealed";
    } catch (e) { return fail(e); }
    draw();
  }

  async function finish() {
    S.stage = "done";
    await Net.update(S.code, { "meta/phase": "done" });
    draw();
  }

  async function endGame() {
    const code = S.code;
    leaveGame();
    S.screen = "setup"; S.setup = null; S.myGames = null;
    try { await Net.deleteGame(code); } catch (e) { return fail(e); }
    afterSignin();
  }

  // ---- the lobby and the game screens ------------------------------------------------------------------
  function drawGame(app) {
    const meta = S.meta;
    if (!meta) return say(app, "Opening the game…", []);
    if (!S.def || S.def.built === false) return say(app, "This game type is not built yet", [h("button", { type: "button", onclick: endGame }, "Delete this game")]);
    if (meta.phase === "lobby") return drawLobby(app);
    if (meta.phase === "play") return drawPlay(app);
    return drawDone(app);
  }

  const joinUrl = () => new URL("live.html?c=" + S.code, location.href).href;

  function drawLobby(app) {
    clear(app);
    const who = playerList(), ctx = S.ctx;
    const left = h("div", { class: "live-join" },
      h("p", { class: "live-note" }, "On your phone, go to"),
      h("p", { class: "live-url" }, joinUrl().replace(/^https?:\/\//, "").replace(/\?c=.*/, "")),
      h("p", { class: "live-note" }, "and enter the code"),
      h("p", { class: "live-code", id: "game-code", "aria-label": "Game code " + S.code.split("").join(" ") }, S.code),
      qrBlock(joinUrl()),
      h("p", { class: "live-note" }, "or scan the square."));

    const right = h("div", { class: "live-roster" },
      h("h2", {}, who.length ? who.length + (who.length === 1 ? " player" : " players") + " joined" : "Waiting for students to join…"));
    if (ctx.teamsOn && who.some((p) => p.team !== null)) {
      const groups = {};
      who.forEach((p) => { (groups[p.team === null ? -1 : p.team] = groups[p.team === null ? -1 : p.team] || []).push(p); });
      const cols = h("div", { class: "live-teams" });
      Object.keys(groups).map(Number).sort((a, b) => a - b).forEach((t) => {
        cols.appendChild(h("section", { class: "live-team" }, h("h3", {}, t < 0 ? "No team yet" : "Team " + Live.teamLabel(t)), groups[t].map(chip)));
      });
      right.appendChild(cols);
    } else {
      right.appendChild(h("div", { class: "live-chips" }, who.map(chip)));
    }

    const actions = [];
    if (ctx.teamsOn) actions.push(h("button", { type: "button", id: "make-teams", disabled: !who.length, onclick: () => Net.update(S.code, { teams: Live.makeTeams(who.map((p) => p.uid), S.meta.teamSize) }) }, Object.keys(S.teams).length ? "Shuffle teams" : "Make teams"));
    actions.push(h("button", { type: "button", id: "start", class: "primary live-bigbtn", disabled: !who.length || S.busy, onclick: startGame },
      ctx.teamsOn && who.length && !Object.keys(S.teams).length ? "Start (teams will be made)" : "Start"));
    actions.push(endButton());
    app.appendChild(h("div", { class: "live-lobby" }, left, right));
    showBar(actions);
    app.appendChild(h("p", { class: "live-note live-center" }, S.def.title + (ctx.teamsOn ? " · teams" : "") + ". Don’t close or reload this page during the game: the answers are kept in it."));
  }
  function chip(p) {
    const el = h("div", { class: "live-chip" },
      h("div", { class: "live-chip-name" }, h("b", {}, p.name), h("small", {}, p.gloss)));
    const ctrl = h("div", { class: "live-chip-ctrl" });
    if (S.ctx.teamsOn && Object.keys(S.teams).length) {
      const nTeams = Math.min(Live.MAX_TEAMS, Math.max(2, Object.keys(teamGroups()).length + 1));
      ctrl.appendChild(h("select", { "aria-label": "Team for " + p.name, onchange: (e) => Net.update(S.code, { ["teams/" + p.uid]: +e.target.value }) },
        Array.from({ length: nTeams }, (_, t) => h("option", { value: t, selected: t === p.team }, "Team " + Live.teamLabel(t)))));
    }
    ctrl.appendChild(h("button", { type: "button", class: "live-x", "aria-label": "Remove " + p.name, title: "Remove from the game", onclick: () => Net.removePlayer(S.code, p.uid, p.idx) }, "✕"));
    el.appendChild(ctrl);
    return el;
  }
  function qrBlock(url) {
    const box = h("div", { class: "live-qr", role: "img", "aria-label": "QR code for " + url });
    try {
      const qr = qrcode(0, "M"); qr.addData(url); qr.make();
      box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });    // the SVG comes from the library, from our own URL
    } catch (e) { box.textContent = url; }
    return box;
  }
  function endButton() {
    if (!S.confirmEnd) return h("button", { type: "button", id: "end", onclick: () => { S.confirmEnd = true; draw(); } }, "End game");
    return h("span", { class: "live-confirm" }, "Delete this game for everyone? ",
      h("button", { type: "button", id: "end-yes", class: "danger", onclick: endGame }, "Yes, end it"),
      h("button", { type: "button", onclick: () => { S.confirmEnd = false; draw(); } }, "Keep playing"));
  }

  function drawPlay(app) {
    if (!S.dom) {
      clear(app);
      S.dom = { strip: h("div", { class: "live-strip" }), area: h("div", { class: "live-area", id: "mode-area" }) };
      app.appendChild(S.dom.strip); app.appendChild(S.dom.area);
    }
    const who = playerList();
    const answered = who.filter((p) => S.tapped[p.uid]).length;
    clear(S.dom.strip);
    S.dom.strip.append(...[
      h("span", {}, "Game ", h("b", { class: "live-code-sm" }, S.code)),
      h("span", {}, who.length + " players"),
      S.stage === "open" ? h("span", {}, answered + " answered") : null,
      S.stage === "locking" ? h("span", {}, "Locking…") : null].filter(Boolean));
    const view = {
      phase: "play", stage: S.stage, round: S.round, reveal: S.reveal, score: S.score, state: S.state,
      tapped: Object.assign({}, S.tapped), players: who, teams: S.teams,
    };
    try { S.def.host.renderHost(S.ctx, S.dom.area, view); } catch (e) { console.error("mode renderHost failed", e); clear(S.dom.area); S.dom.area.appendChild(h("p", { class: "live-error" }, "The game screen failed: " + e.message)); }
    drawControls();
  }
  function showBar(children) {
    const bar = $("live-controls");
    bar.hidden = false;
    clear(bar);
    children.forEach((c) => bar.appendChild(c));
  }
  function drawControls() {
    const bar = $("live-controls");
    bar.hidden = false;
    clear(bar);
    const label = S.stage === "open" ? "Lock now" : S.stage === "revealed" || S.stage === "idle" ? "Next" : "…";
    bar.appendChild(h("button", { type: "button", id: "primary-action", class: "primary live-bigbtn", disabled: S.stage === "locking" || S.stage === "starting", onclick: advance }, label, h("kbd", {}, "Space")));
    for (const [key, k] of Object.entries(S.def.keys || {})) {
      bar.appendChild(h("button", { type: "button", onclick: () => k.run(S.ctx) }, k.label, h("kbd", {}, key.toUpperCase())));
    }
    bar.appendChild(endButton());
  }

  function drawDone(app) {
    clear(app);
    const who = playerList();
    const box = h("div", { class: "live-done" }, h("h2", {}, "Game over"));
    if (S.def.host.ownsDone) {
      const area = h("div", { class: "live-area" });
      box.appendChild(area);
      try { S.def.host.renderHost(S.ctx, area, { phase: "done", stage: "done", round: S.round, reveal: S.reveal, score: S.score, state: S.state, tapped: {}, players: who, teams: S.teams }); } catch (e) { console.error(e); }
    } else {
      const score = S.score || {};
      box.appendChild(h("h3", {}, "Final scores"));
      box.appendChild(Live.scoreboard(who.map((p) => ({ name: p.name, gloss: p.gloss, score: score[p.uid] || 0 })), { top: 10 }));
      if (S.ctx.teamsOn) {
        box.appendChild(h("h3", {}, "Teams"));
        box.appendChild(Live.scoreboard(Object.keys(teamGroups()).map((t) => ({ name: "Team " + Live.teamLabel(+t), score: score[t] || 0 })), { top: 10 }));
      }
    }
    box.appendChild(h("div", { class: "live-actions" }, endButton()));
    box.appendChild(h("p", { class: "live-note live-center" }, "Ending the game deletes it, and every player’s codename with it."));
    app.appendChild(box);
    $("live-controls").hidden = true;
  }

  // ---- keyboard ---------------------------------------------------------------------------------------
  document.addEventListener("keydown", (e) => {
    if (S.screen !== "game" || !S.meta || S.meta.phase !== "play") return;
    if (/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === " ") { e.preventDefault(); advance(); return; }
    const k = S.def && S.def.keys && S.def.keys[e.key.toLowerCase()];
    if (k) { e.preventDefault(); k.run(S.ctx); }
  });

  // ---- start ----------------------------------------------------------------------------------------------
  async function boot() {
    setBanner();
    Live.noticeLines("host").forEach((l) => $("notice-text").appendChild(h("p", {}, l)));
    const e = Net.env();
    if (e.kind !== "emulator" && e.kind !== "live") { S.screen = e.kind; return draw(); }
    try {
      await Net.init();
      $("signout").addEventListener("click", async () => { leaveGame(); await Net.signOut(); S.screen = "signin"; S.error = null; draw(); });
      if (Net.provider() === "google.com") await afterSignin(); else { if (Net.provider()) await Net.signOut(); S.screen = "signin"; draw(); }
    } catch (err) { fail(err); }
  }
  window.addEventListener("beforeunload", () => { /* the server marks the game not-live by itself (onDisconnect) */ });
  window.LiveHost = { state: S, Net };     // for the tests and the debug console; not used by the page itself
  boot();
})();
