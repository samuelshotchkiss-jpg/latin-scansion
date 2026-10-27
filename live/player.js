// player.js -- the student's phone page (live.html). AGPL-3.0.
//
// A phone does very little on purpose: it joins (anonymous sign-in, then claims a random Latin
// codename), shows what the teacher's page has written, and sends taps. It never holds an answer
// key and never grades anything. The student types nothing but the four-letter game code, and even
// that is only used to look the game up: every value the phone writes is a number or a server time
// (see database.rules.json, which refuses anything else).
//
// Reload the same tab and it rejoins as the SAME player (the sign-in is kept in sessionStorage);
// close the tab and it is forgotten. A new tab is a new player.
(function () {
  "use strict";
  const { h, clear } = Live;
  const Net = LiveNet;
  const $ = (id) => document.getElementById(id);

  const STALE_MS = 15000;            // no heartbeat from the teacher's page for this long: say so
  const P = {
    screen: "boot", error: null,
    code: null, uid: null, def: null, unwatch: null,
    meta: null, claims: null, players: null, teams: {}, round: null, reveal: null, score: null, state: null, hand: null, taps: {},
    loaded: new Set(), idx: null, wasJoined: false, joining: false, pending: [],
    connected: true, stale: false, lastSig: null, ctx: null, area: null,
  };

  // ---- drawing -------------------------------------------------------------------------------------------
  // (a timer, not requestAnimationFrame: a tab in the background, such as a projector window behind another,
  // gets no animation frames, and the screen must still keep up)
  let queued = false;
  function draw() {
    if (queued) return;
    queued = true;
    setTimeout(() => { queued = false; try { render(); } catch (e) { console.error(e); P.screen = "error"; P.error = e.message; render(); } }, 16);
  }
  function say(title, lines, extra) {
    const app = $("app");
    clear(app);
    app.appendChild(h("div", { class: "live-card" }, h("h2", {}, title), lines.map((l) => (typeof l === "string" ? h("p", {}, l) : l)), extra || null));
    P.area = null; P.lastSig = null;
  }
  function codeForm(message) {
    const input = h("input", { id: "code-input", type: "text", maxlength: "4", autocomplete: "off", autocapitalize: "characters", spellcheck: "false", "aria-label": "Game code", class: "live-codebox", placeholder: "CODE" });
    const go = (ev) => {
      ev.preventDefault();
      const c = Live.cleanCode(input.value);
      if (!c) { P.error = "A game code is four letters, like KLMN. Look at the teacher’s screen."; return draw(); }
      P.error = null; connect(c);
    };
    return h("form", { class: "live-codeform", onsubmit: go },
      message ? h("p", {}, message) : null,
      input, h("button", { type: "submit", class: "primary live-bigbtn" }, "Join"),
      P.error ? h("p", { class: "live-error" }, P.error) : null);
  }

  function render() {
    switch (P.screen) {
      case "boot": return say("Starting…", []);
      case "refused": return say("This page will not run here", [Net.env().message]);
      case "unconfigured": return say("This game is not set up yet", ["Ask your teacher — the live game has not been connected yet. The practice pages still work as always."]);
      case "error": return say("Something went wrong", [P.error || "Unknown error.", h("button", { type: "button", onclick: () => location.reload() }, "Try again")]);
      case "code": return say("Join a game", [], codeForm("Enter the code shown on the teacher’s screen."));
      case "nogame": return say("No game with that code", ["Check the four letters on the teacher’s screen."], codeForm());
      case "ended": return say("The game has ended", ["The teacher ended this game. Thanks for playing!", h("button", { type: "button", onclick: () => { leave(); P.screen = "code"; draw(); } }, "Join another game")]);
      case "removed": return say("You were removed", ["The teacher took you out of this game.", h("button", { type: "button", onclick: () => { P.wasJoined = false; decide(); } }, "Join again")]);
      case "later": return say("A game is in progress", ["You’ll join the next one.", "When the teacher starts a new game, use the new code. You can keep this page open."]);
      case "finished": return say("This game has finished", ["Thanks for playing!"]);
      case "game": return drawGame();
    }
  }

  // ---- connecting and joining --------------------------------------------------------------------------------
  async function connect(code) {
    leave();
    P.code = code; P.screen = "boot"; draw();
    try {
      const meta = await Net.readMeta(code);
      if (!meta) { P.screen = "nogame"; P.code = null; return draw(); }
      const def = Live.modes[meta.mode];
      if (!def || def.built === false) { P.screen = "error"; P.error = "This page does not know the game type “" + meta.mode + "” yet. Reload it; if that does not help, tell your teacher."; return draw(); }
      history.replaceState(null, "", "?c=" + code);
      P.def = def; P.loaded = new Set();
      const got = (k, fn) => (v) => { fn(v); P.loaded.add(k); decide(); };
      P.unwatch = Net.watchGame(code, {
        meta: got("meta", (v) => { P.meta = v; }),
        claims: got("claims", (v) => { P.claims = v || {}; }),
        players: got("players", (v) => { P.players = v || {}; }),
        teams: (v) => { P.teams = v || {}; buildCtx(); draw(); },
        round: (v) => { P.round = v; P.pending = P.pending.filter((t) => !P.round || t.n === P.round.n); draw(); },
        reveal: (v) => { P.reveal = v; draw(); },
        score: (v) => { P.score = v; draw(); },
        state: (v) => { P.state = v; draw(); },
        hand: (v) => { P.hand = v; draw(); },
        taps: (v) => { P.taps = v || {}; P.pending = P.pending.filter((t) => !P.taps[t.id]); draw(); },
      }, (e) => { P.screen = "error"; P.error = "The game could not be read: " + (e.message || e.code); draw(); });
    } catch (e) { P.screen = "error"; P.error = e.message || String(e); draw(); }
  }
  function leave() {
    if (P.unwatch) P.unwatch();
    Object.assign(P, { unwatch: null, meta: null, claims: null, players: null, teams: {}, round: null, reveal: null, score: null, state: null,
      hand: null, taps: {}, idx: null, wasJoined: false, joining: false, pending: [], ctx: null, area: null, lastSig: null });
  }

  // Decide what this phone should be doing, whenever something it depends on changes.
  function decide() {
    if (!["meta", "claims", "players"].every((k) => P.loaded.has(k))) return;
    if (!P.meta) { P.screen = "ended"; return draw(); }
    const mine = P.players[P.uid];
    if (mine) {
      P.idx = mine.n; P.wasJoined = true; P.joining = false;
      buildCtx();
      P.screen = "game";
    } else if (P.wasJoined) {
      P.screen = "removed";
    } else if (P.meta.phase === "done") {
      P.screen = "finished";
    } else if (P.meta.phase === "play" && !P.def.lateJoin) {
      P.screen = "later";
    } else if (!P.joining) {
      autoJoin();
    }
    draw();
  }
  const freeNames = (skip) => {
    const free = [];
    for (let i = 0; i < Names.NAME_COUNT; i++) if (!P.claims[i] && i !== skip) free.push(i);
    return free;
  };
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  async function autoJoin() {
    P.joining = true;
    let lastErr = null;
    for (let tries = 0; tries < 10; tries++) {
      const free = freeNames();
      if (!free.length) { P.screen = "error"; P.error = "This game is full."; P.joining = false; return draw(); }
      try { await Net.join(P.code, pick(free)); return; }       // success: the players listener will fire, and decide() takes over
      catch (e) { lastErr = e; await new Promise((r) => setTimeout(r, 150)); }   // most likely someone took that name a moment ago
    }
    P.joining = false; P.screen = "error";
    P.error = "Could not join the game (" + ((lastErr && (lastErr.code || lastErr.message)) || "unknown") + ").";
    draw();
  }
  async function differentName() {
    if (!P.meta || P.meta.phase !== "lobby") return;
    for (let tries = 0; tries < 8; tries++) {
      const free = freeNames(P.idx);
      if (!free.length) return;
      try { await Net.reroll(P.code, P.idx, pick(free)); return; } catch (e) { await new Promise((r) => setTimeout(r, 150)); }
    }
  }

  // ---- taps ----------------------------------------------------------------------------------------------------
  async function sendTap(v) {
    const r = P.round;
    if (!Number.isInteger(v) || v < 0 || v > 9) throw new Error("A tap is a whole number from 0 to 9");
    if (!r || !r.open) return { ok: false, reason: "closed" };
    const n = r.n;
    const used = new Set([...Object.keys(P.taps), ...P.pending.map((t) => t.id)].filter((id) => id.startsWith(n + "_")));
    for (let k = 0; k < 10; k++) {
      const id = n + "_" + k;
      if (used.has(id)) continue;
      const entry = { id, n, v, at: null };
      P.pending.push(entry); draw();
      try { await Net.tap(P.code, n, k, v); return { ok: true, id }; }
      catch (e) {
        P.pending = P.pending.filter((t) => t !== entry); draw();
        if (Net.errCode(e) !== "PERMISSION_DENIED") return { ok: false, reason: "error" };
        // refused: either the round just closed, or that tap number was already used. Look again.
        if (!P.round || !P.round.open || P.round.n !== n) return { ok: false, reason: "closed" };
        used.add(id);
      }
    }
    return { ok: false, reason: "too many" };
  }

  // ---- what a mode is given -------------------------------------------------------------------------------------
  const playerList = () => Object.entries(P.players || {})
    .map(([uid, p]) => ({ uid, idx: p.n, name: Names.nameFor(p.n), gloss: Names.glossFor(p.n), team: Number.isInteger(P.teams[uid]) ? P.teams[uid] : null, at: p.at || 0 }))
    .sort((a, b) => a.at - b.at);
  function buildCtx() {
    if (!P.def || !P.meta || P.idx === null) return;
    const team = Number.isInteger(P.teams[P.uid]) ? P.teams[P.uid] : null;
    P.ctx = {
      code: P.code, mode: P.def.id, uid: P.uid, idx: P.idx,
      name: Names.nameFor(P.idx), gloss: Names.glossFor(P.idx),
      settings: Live.decodeSettings(P.def, P.meta.set),
      teamsOn: Live.teamsOn(P.def, P.meta), team,
      teammates: () => playerList().filter((p) => team !== null && p.team === team && p.uid !== P.uid),
      players: playerList,
      now: Net.now,
      tap: sendTap,
    };
  }
  function myTaps() {
    if (!P.round) return [];
    const n = P.round.n, out = [];
    for (const [id, t] of Object.entries(P.taps)) if (t.n === n) out.push({ id, n: t.n, v: t.v, at: t.at });
    for (const t of P.pending) if (t.n === n && !P.taps[t.id]) out.push(Object.assign({}, t));
    return out.sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  // ---- the game screen ---------------------------------------------------------------------------------------------
  function checkStale() {
    const m = P.meta;
    const stale = !!m && m.phase !== "done" && (!m.live || (typeof m.beat === "number" && Net.now() - m.beat > STALE_MS));
    if (stale !== P.stale) { P.stale = stale; draw(); }
  }

  function drawGame() {
    const app = $("app");
    const m = P.meta, ctx = P.ctx;
    if (!m || !ctx) return;
    const me = Live.h;
    // The shell around the mode is rebuilt only when it must be; the mode's own area is re-rendered
    // only when something it shows has changed, so a button is never replaced under a finger.
    const sig = JSON.stringify([m.phase, P.stale, P.connected, P.idx, ctx.team, P.round, P.hand, myTaps(), P.reveal, P.score, P.state,
      m.phase === "play" ? null : [P.players, P.teams, P.claims]]);
    if (sig === P.lastSig && P.area && app.contains(P.area)) return;
    P.lastSig = sig;

    clear(app);
    const bar = me("div", { class: "live-me" },
      me("span", { class: "live-me-name", lang: "la" }, ctx.name),
      ctx.teamsOn && ctx.team !== null ? me("span", { class: "live-me-team" }, "Team " + Live.teamLabel(ctx.team)) : null,
      !P.connected ? me("span", { class: "live-me-off" }, "Reconnecting…") : null);
    app.appendChild(bar);

    if (P.stale && m.phase !== "done") {
      app.appendChild(me("div", { class: "live-card live-wait", id: "waiting" }, me("h2", {}, "Waiting for the teacher…"), me("p", {}, "The teacher’s page has gone quiet. Keep this page open: the game carries on when it comes back.")));
      P.area = null;
      return;
    }
    const area = me("div", { class: "live-area", id: "mode-area" });
    P.area = area;
    app.appendChild(area);

    if (m.phase === "lobby") return drawLobby(area);
    const view = {
      phase: m.phase, round: P.round, hand: P.hand, myTaps: myTaps(), reveal: P.reveal, score: P.score, state: P.state,
      players: playerList(), teams: P.teams, live: !P.stale,
    };
    if (m.phase === "done" && !(P.def.player && P.def.player.ownsDone)) return drawDone(area, view);
    try { P.def.player.render(ctx, area, view); } catch (e) { console.error("mode render failed", e); area.appendChild(me("p", { class: "live-error" }, "This screen failed: " + e.message)); }
  }

  function drawLobby(area) {
    const ctx = P.ctx, list = playerList();
    area.appendChild(h("div", { class: "live-card live-yourname" },
      h("p", { class: "live-note" }, "Your codename"),
      h("h2", { class: "live-codename", lang: "la", id: "codename" }, ctx.name),
      h("p", { class: "live-gloss" }, ctx.gloss),
      h("button", { type: "button", id: "different", onclick: differentName }, "Different name")));
    if (ctx.teamsOn) {
      area.appendChild(h("p", { class: "live-note" }, ctx.team === null ? "Teams are made when the teacher presses Start." : "You are in Team " + Live.teamLabel(ctx.team) + "."));
    }
    area.appendChild(h("p", { class: "live-waiting" }, "Waiting for the teacher to start…"));
    area.appendChild(h("p", { class: "live-note" }, list.length + (list.length === 1 ? " player is here" : " players are here")));
    area.appendChild(h("ul", { class: "live-names" }, list.map((p) => h("li", { class: p.uid === P.uid ? "you" : "", lang: "la" }, p.name, p.uid === P.uid ? " (you)" : ""))));
  }

  function drawDone(area, view) {
    const score = P.score || {};
    area.appendChild(h("div", { class: "live-card" }, h("h2", {}, "Game over")));
    const rows = view.players.map((p) => ({ name: p.name, gloss: "", score: score[p.uid] || 0, you: p.uid === P.uid }));
    area.appendChild(h("h3", {}, "Scores"));
    area.appendChild(Live.scoreboard(rows, { top: 5 }));
    if (P.ctx.teamsOn) {
      const teams = [...new Set(view.players.map((p) => p.team).filter((t) => t !== null))];
      area.appendChild(h("h3", {}, "Teams"));
      area.appendChild(Live.scoreboard(teams.map((t) => ({ name: "Team " + Live.teamLabel(t), score: score[t] || 0, you: t === P.ctx.team })), { top: 10 }));
    }
    area.appendChild(h("p", { class: "live-note" }, "Thanks for playing! Close this tab when you are done: it forgets you."));
  }

  // ---- start ----------------------------------------------------------------------------------------------------------------
  async function boot() {
    Live.noticeLines("player").forEach((l) => $("notice-text").appendChild(h("p", {}, l)));
    const e = Net.env();
    if (e.kind === "emulator") { const b = $("live-banner"); b.hidden = false; b.textContent = "TEST MODE — practice database on this computer. Nothing here is real."; }
    if (e.kind !== "emulator" && e.kind !== "live") { P.screen = e.kind; return draw(); }
    try {
      await Net.init();
      P.uid = await Net.signInAnon();
      Net.onConnection((up) => { P.connected = up; draw(); });
      setInterval(checkStale, 1000);
      const code = Live.cleanCode(new URLSearchParams(location.search).get("c"));
      if (code) connect(code); else { P.screen = "code"; draw(); }
    } catch (err) { P.screen = "error"; P.error = err.message || String(err); draw(); }
  }
  window.LivePlayer = { state: P, Net };     // for the tests and the debug console; not used by the page itself
  boot();
})();
