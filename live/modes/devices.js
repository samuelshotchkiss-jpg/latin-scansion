// devices.js -- "Literary devices: team match", the first real live game mode. AGPL-3.0.
//
// Each team is shown ONE card (a device's name, its definition or a Latin example) and must find the two
// matching cards in the other columns. The team's cards are split across the teammates' phones, so no one
// phone can answer alone: the team has to talk. A wrong tap sends the team's streak back to zero. The
// first team to a streak of GOAL completed prompts wins.
//
// TEAMS RACE INDEPENDENTLY, like Quizlet Live: a team that completes its prompt is given a new prompt and a
// fresh deal at once, whatever the other teams are doing. The live shell, though, runs one "round" at a time
// and the database rules accept a tap only for the current round number `n`. So the mode uses the shell's
// round as a *generation counter*: every time any team advances, the round is locked and reopened (the
// shell bumps `n`) and every player's hand is re-written (unchanged for teams that did not advance). The
// round is closed for a fraction of a second while this happens; a phone whose tap was refused in that
// moment sends it again once the new round opens (see makeSender), unless its own team has moved on.
//
// HOW A TAP STAYS ATTACHED TO THE RIGHT CARD. A tap is one number 0-9. Here v = (hand index 0-3) + 4 x
// (the team's deal number mod 2). The host grades v against the tapper's CURRENT hand only when the
// parity matches the team's current deal; a tap meant for the previous deal has the other parity and is
// ignored. (A hand changes only when the tapper's own team advances, and that always flips the parity.)
//
// The rules of dealing and grading are in live/deal.js. This file adds:
//   createGame  -- the game's memory and rules, no screen (tests/devices_mode.test.js plays whole games)
//   makeSender  -- the phone's "send, and send again once if the round was just reopened" logic
//   the mode    -- settings, the teacher's projector, the student's phone, the end-of-game breakdown
//
// WHAT IS WRITTEN WHERE (see MODES.md): the host page keeps, in memory only, which card each hand index is
// and the Deal round (which holds the answers). The database gets only: each player's cards as faces WITHOUT
// key or id, plus their team's prompt (hands/<uid>, private); each team's progress and current prompt
// (state); and the score. A tap is the number described above.
(function () {
  "use strict";
  const DECK = () => (typeof Deal !== "undefined" ? Deal : require("../deal.js"));
  const KINDS = ["name", "definition", "example"];
  const KIND_LABEL = { name: "Name", definition: "Definition", example: "Example" };
  const MAX_RETRIES = 3;

  // ---- a card as the phone draws it: text and shape only, never a key or id -------------------------
  function face(c) {
    if (c.kind === "example") return { k: "example", c: c.cite, l: c.lines.map((x) => ({ t: x.t, b: x.b })), e: c.en };
    return { k: c.kind, t: c.text };
  }
  const encodeTap = (index, deal) => index + 4 * (deal % 2);

  // ---- the game's memory and rules, no screen ------------------------------------------------------
  // opts: { goal, prompt: "rotate"|kind, teams: { team: [uid...] }, rng, capAt }
  function createGame(pool, opts) {
    const rng = opts.rng || Math.random;
    const below = (n) => Math.min(n - 1, Math.floor(rng() * n));
    const shuffled = (a) => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = below(i + 1); [x[i], x[j]] = [x[j], x[i]]; } return x; };
    const nameOf = (key) => (pool.find((d) => d.key === key) || {}).name || key;
    const g = {
      pool, goal: opts.goal, pace: opts.prompt || "rotate", capAt: opts.capAt || 0, teams: opts.teams,
      T: {}, dealt: {}, res: {}, pending: [], stats: {}, right: {}, winner: null, began: false,
    };
    for (const [t, uids] of Object.entries(g.teams)) {
      g.T[t] = { uids, deal: 0, deck: [], lastKey: null, shift: below(3), key: null, round: null, prompt: null, pk: null, columns: [],
        cols: {}, bad: 0, done: false, tried: new Set(), streak: 0, total: 0, resets: 0, best: 0, last: null };
    }
    const active = () => Object.keys(g.T).filter((t) => g.T[t].uids.length);

    // A new prompt and a fresh deal for ONE team. Never the same device twice in a row for a team: it
    // draws from a shuffled deck of all the devices, and a reshuffle never starts with the last one.
    g.dealTeam = function (t) {
      const T = g.T[t];
      if (!T.deck.length) {
        T.deck = shuffled(pool.map((d) => d.key));
        if (T.deck.length > 1 && T.deck[T.deck.length - 1] === T.lastKey) [T.deck[0], T.deck[T.deck.length - 1]] = [T.deck[T.deck.length - 1], T.deck[0]];
      }
      const key = T.deck.pop();
      T.lastKey = key; T.key = key; T.deal++;
      T.pk = g.pace === "rotate" ? KINDS[(T.shift + T.deal) % 3] : g.pace;
      const dev = pool.find((d) => d.key === key);
      const cite = dev.examples[below(dev.examples.length)].cite;
      const decoys = Math.max(2, Math.ceil((T.uids.length - 2) / 2));        // a big team needs more cards than players
      T.round = DECK().makeRound(pool, { key, cite, promptKind: T.pk, decoys, rng });
      T.prompt = face(T.round.prompt);
      T.columns = KINDS.filter((k) => k !== T.pk);
      const dealt = DECK().hands(T.round, T.uids, { rng });
      for (const u of T.uids) { g.dealt[u] = dealt[u]; g.res[u] = {}; }
      Object.assign(T, { cols: {}, bad: 0, done: false, tried: new Set() });
      const st = (g.stats[key] = g.stats[key] || { asked: 0, wrong: 0, mixed: {} });
      st.asked++;
    };
    // What goes into hands/<uid>: the cards as faces (no key or id), the team's prompt, which deal this
    // is, and how this player's cards have been judged so far.
    g.handFor = function (uid, t) {
      const T = g.T[t], cards = g.dealt[uid] || [];
      const hand = { d: T.deal, pk: T.pk, p: T.prompt };
      if (cards.length) hand.cards = cards.map(face);                          // (an empty list would not survive the database)
      if (Object.keys(g.res[uid] || {}).length) hand.res = Object.assign({}, g.res[uid]);
      return hand;
    };
    g.allHands = function () {
      const out = {};
      for (const t of active()) for (const u of g.T[t].uids) out[u] = g.handFor(u, t);
      return out;
    };
    // The first deal, for everyone; afterwards only the teams that finished a prompt are dealt again.
    // Returns every player's hand (unchanged for the others, so each phone's hand carries the new round n).
    g.nextRound = function () {
      if (!g.began) { g.began = true; active().forEach((t) => g.dealTeam(t)); }
      else { g.pending.forEach((t) => g.dealTeam(t)); }
      g.pending = [];
      return g.allHands();
    };

    // One tap. Returns { ok: true|false|null, completed, won } (ok null = ignored, `stale` = it was meant
    // for a previous deal).
    g.tap = function (uid, v, team) {
      const T = g.T[team], none = { ok: null };
      if (!T || !Number.isInteger(v) || v < 0 || v > 7 || g.winner !== null || T.done) return none;
      if (Math.floor(v / 4) !== T.deal % 2) return { ok: null, stale: true };
      const index = v % 4, card = g.dealt[uid] && g.dealt[uid][index];
      if (!card || !T.uids.includes(uid)) return none;
      const mark = uid + "/" + index;
      if (T.tried.has(mark) || T.cols[card.kind]) return none;                // the same card twice, or a column already found
      T.tried.add(mark);
      const verdict = DECK().judge(T.round, card);                            // the ORIGINAL round object, not a copy
      if (verdict.ok) {
        T.cols[card.kind] = true;
        g.res[uid][index] = 1;
        g.right[uid] = (g.right[uid] || 0) + 1;
        let completed = false, won = false;
        if (T.columns.every((c) => T.cols[c])) {
          T.done = true; completed = true;
          T.streak++; T.total++; T.best = Math.max(T.best, T.streak);
          T.last = { cards: Object.assign({ [T.pk]: face(T.round.prompt) }, ...Object.entries(T.round.answers).map(([c, a]) => ({ [c]: face(a) }))) };
          g.pending.push(team);
          if (T.streak >= g.goal && g.winner === null) { g.winner = team; won = true; }
        }
        return { ok: true, completed, won, index };
      }
      g.res[uid][index] = 0;
      T.streak = 0; T.resets++; T.bad++;
      const st = g.stats[T.key];
      st.wrong++;
      st.mixed[card.key] = (st.mixed[card.key] || 0) + 1;
      return { ok: false, index };
    };

    // The team(s) ahead right now: longest streak, then most prompts completed.
    g.leaders = function () {
      const ts = active();
      const top = Math.max(...ts.map((t) => g.T[t].streak));
      const a = ts.filter((t) => g.T[t].streak === top);
      const most = Math.max(...a.map((t) => g.T[t].total));
      return a.filter((t) => g.T[t].total === most);
    };
    // What the phones and projector may see of the teams' progress.
    g.publicState = function () {
      const t = {};
      for (const k of active()) {
        const T = g.T[k];
        t[k] = { s: T.streak, d: T.deal, k: T.pk, p: T.prompt, b: T.bad, x: T.resets, n: T.total, e: T.done ? 1 : 0 };
        if (Object.keys(T.cols).length) t[k].c = Object.assign({}, T.cols);
        if (T.last) t[k].l = T.last.cards;
      }
      const s = { goal: g.goal, t, win: g.winner === null ? -1 : +g.winner };
      if (g.capAt) s.cap = g.capAt;
      return s;
    };
    g.scores = function () {
      const s = {};
      for (const t of active()) { for (const u of g.T[t].uids) s[u] = g.right[u] || 0; s[t] = g.T[t].streak; }
      return s;
    };
    // The breakdown: sections for the end-of-game screen. `nameOfUid` gives a codename.
    g.summary = function (nameOfUid, teamLabel) {
      const ts = active();
      const sections = [{
        title: "How each team did",
        columns: ["Team", "Players", "Prompts completed", "Best streak", "Wrong taps"],
        rows: ts.map((t) => ["Team " + teamLabel(+t), g.T[t].uids.map(nameOfUid).join(", "), g.T[t].total, g.T[t].best, g.T[t].resets]),
      }];
      const missed = Object.entries(g.stats).filter(([, s]) => s.wrong > 0).sort((a, b) => b[1].wrong - a[1].wrong || b[1].asked - a[1].asked);
      const sec = { title: "Devices the class missed most" };
      if (!missed.length) sec.note = "Nobody tapped a wrong card. Every device was matched cleanly.";
      else {
        sec.note = "Wrong taps are counted against the device the team was asked about; “mixed up with” is the device the wrong card belonged to.";
        sec.columns = ["Device", "Wrong taps", "Times asked", "Mixed up with"];
        sec.rows = missed.slice(0, 10).map(([key, s]) => [nameOf(key), s.wrong, s.asked,
          Object.entries(s.mixed).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => nameOf(k) + " ×" + n).join(", ")]);
      }
      sections.push(sec);
      return sections;
    };
    return g;
  }

  // ---- the phone's sender: one tap, sent again if the round had just been reopened -------------------
  // tap(v) -> Promise<{ ok, reason }> is ctx.tap. A refusal because the round was closed (the host was
  // dealing a team a new prompt) is not final: when the round is open again with a NEW number, and this
  // player's own deal is the same, the tap is sent once more (at most MAX_RETRIES times). If the player's
  // own team has moved on, the old tap is dropped: it was about cards that are gone.
  function makeSender(tap) {
    let queued = null;
    const attempt = async (i, d, n, tries) => {
      const r = await tap(encodeTap(i, d));
      if (!r.ok && r.reason === "closed" && tries < MAX_RETRIES) queued = { i, d, n, tries: tries + 1 };
      return r;
    };
    return {
      send: (i, d, n) => attempt(i, d, n, 0),
      // call with every new view of the round and hand; returns a promise when it sent something
      view({ n, open, d }) {
        if (!queued) return null;
        if (queued.d !== d) { queued = null; return null; }
        if (!open || n === queued.n) return null;
        const q = queued; queued = null;
        return attempt(q.i, q.d, n, q.tries);
      },
      get waiting() { return !!queued; },
    };
  }

  if (typeof module === "object" && module.exports) module.exports = { createGame, makeSender, encodeTap, face, KINDS };
  if (typeof Live === "undefined") return;           // (loaded by a test with no page: only the game rules are wanted)

  // ---- the screens ---------------------------------------------------------------------------------
  const { h, clear } = Live;
  const asList = (x) => (Array.isArray(x) ? x : x ? Object.values(x) : []);

  function cardFace(f, showEnglish) {
    const el = h("span", { class: "dv-live-face" });
    if (f.k === "example") {
      el.appendChild(h("span", { class: "dv-live-cite" }, f.c));
      for (const line of asList(f.l)) {
        const row = h("span", { class: "dv-live-latin", lang: "la" });
        const bold = asList(line.b);                              // (a line with nothing in bold arrives with no `b`)
        let at = 0;
        for (const [s, e] of bold.map((r) => asList(r))) {
          if (s > at) row.appendChild(h("span", {}, line.t.slice(at, s)));
          row.appendChild(h("b", {}, line.t.slice(s, e)));
          at = e;
        }
        if (at < line.t.length) row.appendChild(h("span", {}, line.t.slice(at)));
        el.appendChild(row);
      }
      if (showEnglish && f.e) el.appendChild(h("span", { class: "dv-live-english" }, f.e));
    } else el.textContent = f.t;
    return el;
  }
  const card = (f, cls, showEnglish) => h("div", { class: "dv-live-card dv-live-" + f.k + (cls ? " " + cls : "") },
    h("span", { class: "dv-live-kind" }, KIND_LABEL[f.k]), cardFace(f, showEnglish));
  const short = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
  // "simile · An open comparison: one thing… · Met. 8.213-214": a team's last match in one line
  const gist = (c) => [c.name.t, short(c.definition.t, 50), c.example.c].join(" · ");
  function bar(streak, goal) {
    const b = h("span", { class: "dv-live-bar", role: "img", "aria-label": streak + " of " + goal });
    for (let i = 0; i < goal; i++) b.appendChild(h("i", { class: i < streak ? "on" : "" }));
    return b;
  }
  // "Time left in the game: 4:12", worded so it cannot be mistaken for a score; stops by itself when it leaves the page
  function gameClock(endMs, nowFn) {
    const num = h("b", { class: "dv-live-clocknum" });
    const el = h("span", { class: "dv-live-clock" }, "Time left in the game: ", num);
    const show = () => {
      const left = Math.max(0, Math.ceil((endMs - nowFn()) / 1000));
      num.textContent = Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
    };
    const timer = setInterval(() => { if (!el.isConnected) clearInterval(timer); else show(); }, 500);
    show();
    return el;
  }

  let PICK = null, LAST = null, SENT = {}, SENDER = null, LASTD = 0;     // phone-only memory (this page, this game)
  const rerender = () => { if (LAST) MODE.player.render(LAST[0], LAST[1], LAST[2]); };

  const MODE = Live.registerMode({
    id: "devices",
    title: "Literary devices: team match",
    blurb: "Teams race to match each device's name, definition and example. A wrong tap sends the team back to zero.",
    lateJoin: false,
    autoLock: false,
    teams: { optional: false, sizes: [2, 3], all: true },
    settings: [
      { key: "goal", label: "First team to complete this many in a row", type: "int", options: [6, 8, 10, 12], default: 8 },
      { key: "cap", label: "Time limit for the whole game (minutes, 0 = none)", type: "int", options: [0, 5, 8, 10], default: 0 },
      { key: "english", label: "Show the English under examples", type: "enum", options: [["yes", "Yes"], ["no", "No"]], default: "yes" },
      { key: "prompt", label: "Prompt card", type: "enum", options: [["rotate", "Rotate: name, definition, example"], ["name", "Always a name"], ["definition", "Always a definition"], ["example", "Always an example"]], default: "rotate" },
    ],

    host: {
      ownsDone: true,

      lobbyNote(ctx, who) {
        const small = Object.values(ctx.teams()).some((u) => u.length === 1);
        return (small || who.length < 4 ? "A team of one is playable: one student's device holds both right cards." : "") +
          "Teams race on their own: each moves to its next prompt as soon as it finishes. Late joiners wait for the next game.";
      },

      async start(ctx) {
        const res = await fetch("data/devices.json", { cache: "no-cache" });
        if (!res.ok) throw new Error("Could not load data/devices.json");
        const pool = (await res.json()).devices;
        const s = ctx.settings;
        const capAt = s.cap > 0 ? ctx.now() + s.cap * 60000 : 0;
        ctx.mem.g = createGame(pool, { goal: s.goal, prompt: s.prompt, teams: ctx.teams(), rng: ctx.random, capAt });
        if (capAt) {
          ctx.mem.capTimer = setTimeout(() => {
            if (!window.LiveHost || window.LiveHost.state.ctx !== ctx) return;         // that game is gone
            ctx.mem.capped = true;
            ctx.requestLock();
          }, s.cap * 60000);
        }
      },

      // Called once at the start and again after every lock: deal the teams that finished, re-write everyone's hand.
      nextRound(ctx) {
        const g = ctx.mem.g;
        if (g.winner !== null || ctx.mem.capped) { clearTimeout(ctx.mem.capTimer); return null; }
        const hands = g.nextRound();
        ctx.write("state", g.publicState());
        return { ms: 0, round: {}, hands };
      },

      onTap(ctx, uid, tap) {
        const g = ctx.mem.g, team = ctx.teamOf(uid);
        if (team === null) return;
        const r = g.tap(uid, tap.v, String(team));
        if (r.ok === null) return;
        ctx.write("hands/" + uid + "/res/" + r.index, r.ok ? 1 : 0).catch(() => {});
        ctx.write("state", g.publicState()).catch(() => {});
        if (r.completed) ctx.requestLock();            // a team moved on: lock and reopen, which re-deals it (and bumps the round number)
      },

      lock(ctx) {
        const g = ctx.mem.g;
        ctx.write("state", g.publicState());
        return { reveal: { adv: g.pending.map(Number) }, score: g.scores() };
      },

      summary(ctx) {
        const g = ctx.mem.g;
        return g ? g.summary((u) => ctx.nameOf(u), Live.teamLabel) : [];
      },

      renderHost(ctx, el, view) {
        clear(el);
        const g = ctx.mem.g;
        if (view.phase === "done") return drawWinner(ctx, el, g);
        if (!view.round || !g) { el.appendChild(h("p", { class: "live-big" }, "Get ready…")); return; }
        // Nobody presses Next here: once the lock is shown, go straight on to the re-deal (unless a team has won).
        if (view.stage === "revealed" && g.winner === null) ctx.requestNext(0);
        const en = ctx.settings.english === "yes";
        el.appendChild(h("div", { class: "live-q-head" },
          h("span", { class: "live-q-n" }, "First team to " + g.goal + " in a row wins"),
          g.capAt ? gameClock(g.capAt, ctx.now) : null));
        const lanes = h("div", { class: "dv-live-lanes" });
        for (const t of Object.keys(g.T).filter((k) => g.T[k].uids.length).sort()) {
          const T = g.T[t];
          const found = T.columns.map((c) => h("span", { class: "dv-live-chip" + (T.cols[c] ? " on" : "") }, (T.cols[c] ? "✓ " : "… ") + KIND_LABEL[c]));
          lanes.appendChild(h("div", { class: "dv-live-lane" + (g.winner === t ? " won" : "") },
            h("div", { class: "dv-live-lane-head" }, h("b", {}, "Team " + Live.teamLabel(+t)), h("span", { class: "dv-live-streak" }, T.streak + " / " + g.goal)),
            h("div", { class: "dv-live-members" }, T.uids.map((u) => ctx.nameOf(u)).join(" · ")),
            bar(T.streak, g.goal),
            card(T.prompt, "dv-live-laneprompt", en),
            h("div", { class: "dv-live-status" }, found, T.bad ? h("span", { class: "dv-live-oops" }, "✗ wrong card: back to 0") : null),
            T.last ? h("p", { class: "dv-live-last" }, h("b", {}, "Last match: "), gist(T.last.cards)) : null));
        }
        el.appendChild(lanes);
        if (g.winner !== null) el.appendChild(h("p", { class: "live-big dv-live-wintext" }, "🏆 Team " + Live.teamLabel(+g.winner) + " reached " + g.goal + "! Press Next."));
      },
    },

    player: {
      ownsDone: true,
      render(ctx, el, view) {
        clear(el);
        LAST = [ctx, el, view];
        const r = view.round;
        const en = ctx.settings.english === "yes";
        const state = view.state || {};
        if (view.phase === "done") return donePhone(ctx, el, state);
        if (ctx.team === null) { el.appendChild(h("p", { class: "live-big" }, "You’ll play from the next game.")); return; }
        if (!r) { el.appendChild(h("p", { class: "live-big" }, "Get ready…")); return; }
        const goal = state.goal || ctx.settings.goal;
        const hand = view.hand && view.hand.n === r.n ? view.hand : null;
        const mine = state.t && state.t[ctx.team];
        const d = hand ? hand.d : 0;
        if (d !== LASTD) { PICK = null; SENT = {}; LASTD = d; }       // my team has a new prompt: forget the old selection
        if (!SENDER) SENDER = makeSender((v) => ctx.tap(v));
        if (hand) { const p = SENDER.view({ n: r.n, open: r.open, d }); if (p) p.then(rerender); }

        const now = mine && mine.d === d ? mine : { c: {}, b: 0 };
        const streak = mine ? mine.s || 0 : 0;
        const mates = ctx.teammates().map((p) => p.name);
        el.appendChild(h("div", { class: "dv-live-top" },
          h("b", { class: "live-me-team" }, "Team " + Live.teamLabel(ctx.team)),
          h("span", { class: "dv-live-streak" }, "Streak " + streak + " / " + goal)));
        el.appendChild(bar(streak, goal));
        if (state.cap) el.appendChild(h("p", { class: "dv-live-clockline" }, gameClock(state.cap, ctx.now)));
        if (mates.length) el.appendChild(h("p", { class: "live-note" }, "With: " + mates.join(", ")));
        if (state.win >= 0) {
          el.appendChild(h("p", { class: "live-result " + (+state.win === ctx.team ? "ok" : "bad") }, +state.win === ctx.team ? "🏆 Your team won!" : "Team " + Live.teamLabel(+state.win) + " won."));
          return;
        }
        if (!hand) { el.appendChild(h("p", { class: "live-note" }, "You’ll play from the next game.")); return; }

        const need = KINDS.filter((k) => k !== hand.pk);
        el.appendChild(h("p", { class: "dv-live-ask" }, "Your team’s prompt — find the matching " + need.map((k) => KIND_LABEL[k].toLowerCase()).join(" and ") + ":"));
        el.appendChild(card(hand.p, "dv-live-promptcard", en));
        el.appendChild(h("p", { class: "dv-live-cols" }, need.map((k) => h("span", { class: "dv-live-chip" + (now.c && now.c[k] ? " on" : "") },
          (now.c && now.c[k] ? "✓ " : "… ") + KIND_LABEL[k] + (now.c && now.c[k] ? " found" : " still open")))));
        if (now.b) el.appendChild(h("p", { class: "dv-live-oops" }, "✗ Oops, a wrong card. The team is back to 0."));
        if (mine && mine.l && streak > 0) el.appendChild(h("p", { class: "dv-live-last" }, h("b", {}, "Last match: "), gist(mine.l)));

        const cards = asList(hand.cards);
        if (!cards.length) { el.appendChild(h("p", { class: "live-note" }, "You have no cards for this prompt. Help your team check theirs.")); return; }
        el.appendChild(h("h3", {}, "Your cards"));
        const res = hand.res || {};
        const sent = SENT[d] || (SENT[d] = new Set());
        const grid = h("div", { class: "dv-live-hand" });
        cards.forEach((f, i) => {
          const ok = res[i] === 1, bad = res[i] === 0, pending = !ok && !bad && sent.has(i);
          const blocked = !ok && !bad && !pending && !!(now.c && now.c[f.k]);
          const canPick = !ok && !bad && !pending && !blocked;
          const picked = PICK && PICK.d === d && PICK.i === i;
          const tag = ok ? "✓ Correct — locked in" : bad ? "✗ Wrong" : pending ? "Sent…" : blocked ? "Your team has already found this column" : "";
          grid.appendChild(h("button", {
            type: "button", disabled: !canPick,
            class: "dv-live-mine" + (picked ? " picked" : "") + (ok ? " right" : "") + (bad ? " wrong" : "") + (blocked || pending ? " dim" : ""),
            "aria-pressed": String(!!picked),
            onclick: () => { PICK = picked ? null : { d, i }; rerender(); },
          }, card(f, "", en), tag ? h("span", { class: "dv-live-tag" }, tag) : null));
        });
        el.appendChild(grid);
        if (PICK && PICK.d === d) {
          el.appendChild(h("div", { class: "dv-live-confirm" },
            h("span", {}, "Tapping a wrong card sends your team back to 0."),
            h("button", { type: "button", class: "primary live-bigbtn", onclick: () => {
              const i = PICK.i; PICK = null; sent.add(i); rerender();
              SENDER.send(i, d, r.n).then(rerender);
            } }, "Lock it in"),
            h("button", { type: "button", onclick: () => { PICK = null; rerender(); } }, "Cancel")));
        }
      },
    },
  });

  function donePhone(ctx, el, state) {
    const win = state.win >= 0 ? +state.win : null;
    el.appendChild(h("p", { class: "live-big" }, win === null ? "Game over" : win === ctx.team ? "🏆 Your team won!" : "Team " + Live.teamLabel(win) + " won!"));
    el.appendChild(h("p", { class: "live-note" }, "Thanks for playing. Your teacher has the breakdown."));
  }

  function drawWinner(ctx, el, g) {
    if (!g) return;
    const ids = g.winner !== null ? [g.winner] : g.leaders();
    const box = h("div", { class: "dv-live-winner" });
    box.appendChild(h("p", { class: "dv-live-confetti", "aria-hidden": "true" }, "🏆 ✦ 🎉 ✦ 🏆"));
    box.appendChild(h("h2", { class: "live-big" }, (g.winner !== null ? "" : "Time! ") + (ids.length > 1 ? "A tie: " : "") +
      ids.map((t) => "Team " + Live.teamLabel(+t)).join(" and ") + (g.winner !== null ? " wins!" : " " + (ids.length > 1 ? "lead" : "leads") + ".")));
    for (const t of ids) box.appendChild(h("p", { class: "dv-live-members" }, g.T[t].uids.map((u) => ctx.nameOf(u)).join(" · ")));
    el.appendChild(box);
  }
})();
