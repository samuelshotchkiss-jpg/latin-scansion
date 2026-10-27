// devices.js -- "Literary devices: team match", the first real live game mode. AGPL-3.0.
//
// Each team is shown ONE card (a device's name, its definition or a Latin example) and must find the two
// matching cards in the other columns. The team's cards are split over the teammates' phones, so no one
// phone can answer alone: the team has to talk. A wrong tap sends the team's streak back to zero. The
// first team to a streak of GOAL completed rounds wins.
//
// The rules of dealing and grading are in live/deal.js. This file adds the game around them:
//   Core   -- the game's memory and rules, with no screen (so tests/devices_mode.test.js can play whole games)
//   the mode definition -- settings, the teacher's projector, the student's phone, the end-of-game breakdown
//
// WHAT IS WRITTEN WHERE (see MODES.md): the host page keeps, in memory only, which card each hand index
// is (`dealt`) and the Deal round (`rounds`, which holds the answers). The database gets only the prompt
// (round), each player's cards as faces WITHOUT key or id (hands/<uid>), the teams' progress (state),
// and, at the lock, the three right cards (reveal). A tap is the index of a card in the tapper's own hand.
(function () {
  "use strict";
  const DECK = () => (typeof Deal !== "undefined" ? Deal : require("../deal.js"));
  const KINDS = ["name", "definition", "example"];
  const KIND_LABEL = { name: "Name", definition: "Definition", example: "Example" };
  const ROUND_MS = 120000;                        // a round nobody finishes is locked after two minutes

  // ---- a card as the phone draws it: text and shape only, never a key or id -------------------------
  function face(c) {
    if (c.kind === "example") return { k: "example", c: c.cite, l: c.lines.map((x) => ({ t: x.t, b: x.b })), e: c.en };
    return { k: c.kind, t: c.text };
  }

  // ---- the game's memory and rules, no screen ------------------------------------------------------
  // opts: { goal, prompt: "rotate"|kind, teams: { team: [uid...] }, rng }
  function createGame(pool, opts) {
    const rng = opts.rng || Math.random;
    const below = (n) => Math.min(n - 1, Math.floor(rng() * n));
    const shuffled = (a) => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = below(i + 1); [x[i], x[j]] = [x[j], x[i]]; } return x; };
    const g = {
      pool, goal: opts.goal, n: 0, keys: [], kindShift: below(3), teams: opts.teams, prog: {}, rounds: {}, dealt: {},
      tried: new Set(), stats: {}, right: {}, winner: null, current: null, order: [], pace: opts.prompt || "rotate",
    };
    for (const t of Object.keys(g.teams)) g.prog[t] = { streak: 0, total: 0, resets: 0, best: 0, cols: {}, bad: 0, done: false };
    const nameOf = (key) => (pool.find((d) => d.key === key) || {}).name || key;

    // The next prompt for every team: the same device for all, different decoys and deals per team.
    g.nextRound = function () {
      g.n++;
      if (!g.keys.length) g.keys = shuffled(pool.map((d) => d.key));
      const key = g.keys.pop();
      const kind = g.pace === "rotate" ? KINDS[(g.kindShift + g.n) % 3] : g.pace;
      const dev = pool.find((d) => d.key === key);
      const cite = dev.examples[below(dev.examples.length)].cite;
      g.tried = new Set(); g.rounds = {}; g.dealt = {}; g.order = [];
      const hands = {};
      let prompt = null;
      for (const [t, uids] of Object.entries(g.teams)) {
        const p = g.prog[t];
        Object.assign(p, { cols: {}, bad: 0, done: false });
        if (!uids.length) continue;
        const decoys = Math.max(2, Math.ceil((uids.length - 2) / 2));      // a big team needs more cards than players
        const round = DECK().makeRound(pool, { key, cite, promptKind: kind, decoys, rng });
        const dealt = DECK().hands(round, uids, { rng });
        g.rounds[t] = round;
        prompt = prompt || face(round.prompt);
        for (const u of uids) {
          g.dealt[u] = dealt[u];
          hands[u] = dealt[u].length ? { cards: dealt[u].map(face) } : {};        // (an empty list would not survive the database)
        }
      }
      const st = (g.stats[key] = g.stats[key] || { asked: 0, wrong: 0, mixed: {} });
      st.asked++;
      g.current = { key, kind, columns: KINDS.filter((k) => k !== kind) };
      return { prompt, kind, columns: g.current.columns, hands };
    };

    // One tap. Returns { ok: true|false|null, hand: <index>, team, completed, won } -- ok null = ignored.
    g.tap = function (uid, v, at, team) {
      const p = g.prog[team], card = g.dealt[uid] && g.dealt[uid][v];
      const none = { ok: null };
      if (!p || !card || p.done || g.winner !== null) return none;     // (once someone has won, the round is over)
      const mark = uid + "/" + v;
      if (g.tried.has(mark) || p.cols[card.kind]) return none;           // the same card twice, or a column already found
      g.tried.add(mark);
      const verdict = DECK().judge(g.rounds[team], card);                // the ORIGINAL round object, not a copy
      if (verdict.ok) {
        p.cols[card.kind] = true;
        g.right[uid] = (g.right[uid] || 0) + 1;
        let completed = false, won = false;
        if (g.current.columns.every((c) => p.cols[c])) {
          p.done = true; completed = true; g.order.push(team);
          p.streak++; p.total++; p.best = Math.max(p.best, p.streak);
          if (p.streak >= g.goal && g.winner === null) { g.winner = team; won = true; }
        }
        return { ok: true, completed, won };
      }
      p.streak = 0; p.resets++; p.bad++;
      const st = g.stats[g.current.key];
      st.wrong++;
      st.mixed[card.key] = (st.mixed[card.key] || 0) + 1;
      return { ok: false };
    };

    g.allDone = () => Object.keys(g.teams).filter((t) => g.teams[t].length).every((t) => g.prog[t].done);
    // The team(s) ahead right now: longest streak, then most rounds completed.
    g.leaders = function () {
      const ts = Object.keys(g.teams).filter((t) => g.teams[t].length);
      const top = Math.max(...ts.map((t) => g.prog[t].streak));
      const a = ts.filter((t) => g.prog[t].streak === top);
      const most = Math.max(...a.map((t) => g.prog[t].total));
      return a.filter((t) => g.prog[t].total === most);
    };
    // What the phones and projector may see of the teams' progress.
    g.publicState = function () {
      const t = {};
      for (const [k, p] of Object.entries(g.prog)) {
        t[k] = { s: p.streak, r: g.n, d: p.done ? 1 : 0, b: p.bad, x: p.resets, w: g.winner === k ? 1 : 0 };
        if (Object.keys(p.cols).length) t[k].c = Object.assign({}, p.cols);
      }
      return { goal: g.goal, t };
    };
    // The three right cards, once the round is locked.
    g.revealData = function () {
      const first = Object.keys(g.rounds)[0], r = g.rounds[first];
      const cards = { [r.promptKind]: face(r.prompt) };
      for (const c of Object.keys(r.answers)) cards[c] = face(r.answers[c]);
      return { cards, kind: r.promptKind, done: g.order.slice(), win: g.winner === null ? -1 : +g.winner };
    };
    g.scores = function () {
      const s = {};
      for (const uids of Object.values(g.teams)) for (const u of uids) s[u] = g.right[u] || 0;
      for (const [t, p] of Object.entries(g.prog)) if (g.teams[t].length) s[t] = p.streak;
      return s;
    };
    // The breakdown: sections for the end-of-game screen. `nameOfUid` gives a codename.
    g.summary = function (nameOfUid, teamLabel) {
      const ts = Object.keys(g.teams).filter((t) => g.teams[t].length);
      const sections = [{
        title: "How each team did",
        columns: ["Team", "Players", "Rounds completed", "Best streak", "Wrong taps"],
        rows: ts.map((t) => ["Team " + teamLabel(+t), g.teams[t].map(nameOfUid).join(", "), g.prog[t].total, g.prog[t].best, g.prog[t].resets]),
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

  if (typeof module === "object" && module.exports) module.exports = { createGame, face, KINDS, ROUND_MS };
  if (typeof Live === "undefined") return;           // (loaded by a test with no page: only the game rules are wanted)

  // ---- the screens ---------------------------------------------------------------------------------
  const { h, clear, countdown } = Live;
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

  // a team's progress this round, from the published state
  function teamNow(view, team, round) {
    const t = view.state && view.state.t && view.state.t[team];
    if (!t) return { s: 0, c: {}, d: 0, b: 0, x: 0, fresh: true };
    return { s: t.s || 0, x: t.x || 0, w: t.w || 0, c: t.r === round.n ? (t.c || {}) : {}, d: t.r === round.n ? t.d : 0, b: t.r === round.n ? t.b || 0 : 0 };
  }
  function bar(streak, goal) {
    const b = h("span", { class: "dv-live-bar", role: "img", "aria-label": streak + " of " + goal });
    for (let i = 0; i < goal; i++) b.appendChild(h("i", { class: i < streak ? "on" : "" }));
    return b;
  }

  let PICK = null, LAST = null;                   // the card this phone has selected but not yet locked in
  const rerender = () => { if (LAST) MODE.player.render(LAST[0], LAST[1], LAST[2]); };

  const MODE = Live.registerMode({
    id: "devices",
    title: "Literary devices: team match",
    blurb: "Teams find the matching name, definition and example. A wrong tap sends the team back to zero.",
    lateJoin: false,
    autoLock: false,
    teams: { optional: false, sizes: [2, 3], all: true },
    settings: [
      { key: "goal", label: "First team to complete this many rounds in a row", type: "int", options: [6, 8, 10, 12], default: 8 },
      { key: "cap", label: "Time limit for the whole game (minutes, 0 = none)", type: "int", options: [0, 5, 8, 10], default: 0 },
      { key: "english", label: "Show the English under examples", type: "enum", options: [["yes", "Yes"], ["no", "No"]], default: "yes" },
      { key: "prompt", label: "Prompt card", type: "enum", options: [["rotate", "Rotate: name, definition, example"], ["name", "Always a name"], ["definition", "Always a definition"], ["example", "Always an example"]], default: "rotate" },
    ],

    host: {
      ownsDone: true,

      lobbyNote(ctx, who) {
        const small = Object.values(ctx.teams()).some((u) => u.length === 1);
        return (small || who.length < 4 ? "A team of one is playable: its single phone holds both right cards. " : "") +
          "Each team shares its cards across its phones; late joiners wait for the next game.";
      },

      async start(ctx) {
        const res = await fetch("data/devices.json", { cache: "no-cache" });
        if (!res.ok) throw new Error("Could not load data/devices.json");
        const pool = (await res.json()).devices;
        const s = ctx.settings;
        ctx.mem.g = createGame(pool, { goal: s.goal, prompt: s.prompt, teams: ctx.teams(), rng: ctx.random });
        ctx.mem.started = ctx.now();
        if (s.cap > 0) {
          ctx.mem.capAt = ctx.mem.started + s.cap * 60000;
          ctx.mem.capTimer = setTimeout(() => {
            if (!window.LiveHost || window.LiveHost.state.ctx !== ctx) return;         // that game is gone
            ctx.mem.capped = true;
            ctx.requestLock();
          }, s.cap * 60000);
        }
        await ctx.write("state", ctx.mem.g.publicState());
      },

      nextRound(ctx) {
        const g = ctx.mem.g;
        if (g.winner !== null || ctx.mem.capped) { clearTimeout(ctx.mem.capTimer); return null; }
        const out = g.nextRound();
        ctx.write("state", g.publicState());
        return { ms: ROUND_MS, round: { pk: out.kind, p: out.prompt }, hands: out.hands };
      },

      onTap(ctx, uid, tap) {
        const g = ctx.mem.g, team = ctx.teamOf(uid);
        if (tap.late || team === null) return;
        const r = g.tap(uid, tap.v, tap.at, String(team));
        if (r.ok === null) return;
        ctx.write("hands/" + uid + "/res/" + tap.v, r.ok ? 1 : 0).catch(() => {});
        ctx.write("state", g.publicState()).catch(() => {});
        if (r.won || g.allDone()) ctx.requestLock();
      },

      lock(ctx) {
        const g = ctx.mem.g;
        ctx.write("state", g.publicState());
        return { reveal: g.revealData(), score: g.scores() };
      },

      summary(ctx) {
        const g = ctx.mem.g;
        return g ? g.summary((u) => ctx.nameOf(u), Live.teamLabel) : [];
      },

      renderHost(ctx, el, view) {
        clear(el);
        const g = ctx.mem.g;
        if (view.phase === "done") return drawWinner(ctx, el, g);
        const r = view.round;
        if (!r || !g) { el.appendChild(h("p", { class: "live-big" }, "Get ready…")); return; }
        const revealed = view.reveal && view.reveal.n === r.n;
        const en = ctx.settings.english === "yes";
        el.appendChild(h("div", { class: "live-q-head" },
          h("span", { class: "live-q-n" }, "Round " + r.n + " · first to " + g.goal + " in a row"),
          ctx.mem.capAt ? h("span", { class: "dv-live-cap live-note" }, "Game ends in ", h("b", { class: "dv-live-capclock" })) : null,
          r.open ? h("span", { class: "live-clock", "aria-label": "seconds left" }) : null));
        if (r.open) countdown(el.querySelector(".live-clock"), r.t0 + r.ms, ctx.now);
        if (ctx.mem.capAt) countdown(el.querySelector(".dv-live-capclock"), ctx.mem.capAt, ctx.now);

        const cols = KINDS.filter((k) => k !== r.pk).map((k) => KIND_LABEL[k].toLowerCase());
        el.appendChild(h("div", { class: "dv-live-stage" },
          h("div", { class: "dv-live-prompt" }, h("p", { class: "dv-live-ask" }, "Find the matching " + cols.join(" and ") + ":"), card(r.p, "dv-live-big", en))));

        const lanes = h("div", { class: "dv-live-lanes" });
        for (const t of Object.keys(g.teams).filter((k) => g.teams[k].length).sort()) {
          const p = g.prog[t];
          const found = g.current.columns.map((c) => h("span", { class: "dv-live-chip" + (p.cols[c] ? " on" : "") }, (p.cols[c] ? "✓ " : "… ") + KIND_LABEL[c]));
          lanes.appendChild(h("div", { class: "dv-live-lane" + (p.done ? " done" : "") + (g.winner === t ? " won" : "") },
            h("div", { class: "dv-live-lane-head" }, h("b", {}, "Team " + Live.teamLabel(+t)),
              h("span", { class: "dv-live-streak" }, p.streak + " / " + g.goal)),
            h("div", { class: "dv-live-members" }, g.teams[t].map((u) => ctx.nameOf(u)).join(" · ")),
            bar(p.streak, g.goal),
            h("div", { class: "dv-live-status" }, found, p.done ? h("span", { class: "dv-live-chip on" }, "Round complete ✓") : null,
              p.bad ? h("span", { class: "dv-live-oops" }, "✗ wrong card: back to 0") : null)));
        }
        el.appendChild(lanes);

        if (revealed) {
          const rv = view.reveal;
          el.appendChild(h("h3", {}, "The match"));
          el.appendChild(h("div", { class: "dv-live-three" }, KINDS.map((k) => card(rv.cards[k], k === rv.kind ? "dv-live-isprompt" : "", en))));
          if (rv.win >= 0) el.appendChild(h("p", { class: "live-big dv-live-wintext" }, "🏆 Team " + Live.teamLabel(rv.win) + " reached " + g.goal + "! Press Next."));
          else if (ctx.mem.capped) el.appendChild(h("p", { class: "live-big dv-live-wintext" }, "Time! Press Next for the result."));
        }
      },
    },

    player: {
      ownsDone: true,
      render(ctx, el, view) {
        clear(el);
        LAST = [ctx, el, view];
        const r = view.round;
        const en = ctx.settings.english === "yes";
        if (view.phase === "done") return donePhone(ctx, el, view);
        if (ctx.team === null) { el.appendChild(h("p", { class: "live-big" }, "You’ll play from the next game.")); return; }
        if (!r) { el.appendChild(h("p", { class: "live-big" }, "Get ready…")); return; }
        const goal = (view.state && view.state.goal) || ctx.settings.goal;
        const now = teamNow(view, ctx.team, r);
        const hand = view.hand && view.hand.n === r.n ? view.hand : null;
        const revealed = view.reveal && view.reveal.n === r.n;
        const mates = ctx.teammates().map((p) => p.name);

        el.appendChild(h("div", { class: "dv-live-top" },
          h("b", { class: "live-me-team" }, "Team " + Live.teamLabel(ctx.team)),
          h("span", { class: "dv-live-streak" }, "Streak " + now.s + " / " + goal),
          r.open ? h("span", { class: "live-clock", "aria-label": "seconds left" }) : null));
        if (r.open) countdown(el.querySelector(".live-clock"), r.t0 + r.ms, ctx.now);
        el.appendChild(bar(now.s, goal));
        if (mates.length) el.appendChild(h("p", { class: "live-note" }, "With: " + mates.join(", ")));

        const need = KINDS.filter((k) => k !== r.pk);
        el.appendChild(h("p", { class: "dv-live-ask" }, "Your team’s prompt — find the matching " + need.map((k) => KIND_LABEL[k].toLowerCase()).join(" and ") + ":"));
        el.appendChild(card(r.p, "dv-live-promptcard", en));
        el.appendChild(h("p", { class: "dv-live-cols" }, need.map((k) => h("span", { class: "dv-live-chip" + (now.c[k] ? " on" : "") },
          (now.c[k] ? "✓ " : "… ") + KIND_LABEL[k] + (now.c[k] ? " found" : " still open")))));
        if (now.b && !now.d) el.appendChild(h("p", { class: "dv-live-oops" }, "✗ Oops, a wrong card. The team is back to 0."));
        if (now.d) el.appendChild(h("p", { class: "live-result ok" }, "✓ Round complete! " + (revealed ? "" : "Waiting for the other teams…")));

        if (revealed) {
          const rv = view.reveal;
          el.appendChild(h("h3", {}, "The match"));
          el.appendChild(h("div", { class: "dv-live-three" }, KINDS.map((k) => card(rv.cards[k], k === rv.kind ? "dv-live-isprompt" : "", en))));
          if (rv.win >= 0) el.appendChild(h("p", { class: "live-result " + (+rv.win === ctx.team ? "ok" : "bad") }, +rv.win === ctx.team ? "🏆 Your team won!" : "Team " + Live.teamLabel(rv.win) + " won."));
          return;
        }
        if (!hand) { el.appendChild(h("p", { class: "live-note" }, "You’ll play from the next round.")); return; }
        const cards = asList(hand.cards);
        if (!cards.length) { el.appendChild(h("p", { class: "live-note" }, "You have no cards this round. Help your team check theirs.")); return; }

        el.appendChild(h("h3", {}, "Your cards"));
        const res = hand.res || {};
        const sent = new Set(view.myTaps.map((t) => t.v));
        const grid = h("div", { class: "dv-live-hand" });
        cards.forEach((f, i) => {
          const ok = res[i] === 1, bad = res[i] === 0, pending = !ok && !bad && sent.has(i);
          const blocked = !ok && !bad && !pending && !!now.c[f.k];
          const canPick = r.open && !now.d && !ok && !bad && !pending && !blocked;
          const picked = PICK && PICK.n === r.n && PICK.i === i;
          const tag = ok ? "✓ Correct — locked in" : bad ? "✗ Wrong" : pending ? "Sent…" : blocked ? "Your team has already found this column" : "";
          grid.appendChild(h("button", {
            type: "button", disabled: !canPick,
            class: "dv-live-mine" + (picked ? " picked" : "") + (ok ? " right" : "") + (bad ? " wrong" : "") + (blocked || pending ? " dim" : ""),
            "aria-pressed": String(!!picked),
            onclick: () => { PICK = picked ? null : { n: r.n, i }; rerender(); },
          }, card(f, "", en), tag ? h("span", { class: "dv-live-tag" }, tag) : null));
        });
        el.appendChild(grid);
        if (PICK && PICK.n === r.n && r.open) {
          el.appendChild(h("div", { class: "dv-live-confirm" },
            h("span", {}, "Tapping a wrong card sends your team back to 0."),
            h("button", { type: "button", class: "primary live-bigbtn", onclick: () => { const i = PICK.i; PICK = null; ctx.tap(i); rerender(); } }, "Lock it in"),
            h("button", { type: "button", onclick: () => { PICK = null; rerender(); } }, "Cancel")));
        }
      },
    },
  });

  function donePhone(ctx, el, view) {
    const rv = view.reveal, win = rv && rv.win >= 0 ? +rv.win : null;
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
    for (const t of ids) box.appendChild(h("p", { class: "dv-live-members" }, g.teams[t].map((u) => ctx.nameOf(u)).join(" · ")));
    el.appendChild(box);
  }
})();
