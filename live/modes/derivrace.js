// derivrace.js -- "Derivatives: team race", the derivatives cards (see derivatives.js) played as a race between
// teams, the way the devices mode (devices.js) races its teams. AGPL-3.0.
//
// Two teams of about four get the SAME words in the SAME order, each with the same prompt card, and move at
// their own pace. Every word is the relay's: one card is the prompt, and the team must find the other three
// (Latin word, Latin meaning, English derivative, English meaning), each one on a different device. A wrong
// card freezes the WHOLE team for a few seconds (no time is added). The first team to finish every word wins.
//
// The per-team game is derivatives.js's createGame (one game object per team, all dealing from one shared
// plan). The pace of the teams is devices.js's trick: the live shell has one round at a time, and the rules
// accept a tap only for the current round number `n`, so the round is a *generation counter*: whenever a
// team finishes a word the round is locked and reopened, and every hand is written again (unchanged for the
// other team). A tap carries the team's deal parity, v = index + 5 x (deal mod 2), so a hand holds at most 5
// cards and a tap meant for an old deal (the other parity) is ignored. See the header of devices.js.
//
//   createRace -- the game's memory and rules, no screen (tests/derivrace_mode.test.js plays whole games)
//   the mode   -- settings, the projector (two lanes), the device, the end-of-game breakdown
//
// WHAT IS WRITTEN WHERE: the host page keeps the words, the right answers and every freeze in memory. The
// database gets only each player's cards as plain text and how they were judged (hands/<uid>, private) and
// each team's public progress, with the moment its freeze ends (state). Nothing is written to score.
(function () {
  "use strict";
  const D = typeof module === "object" && module.exports ? require("./derivatives.js") : Live.Deriv;
  const { KINDS, KIND_LABEL, clockText } = D;
  const HAND = 5;                                            // cards in a hand, at most: a tap is index + 5 x parity (0-9)
  const encodeTap = (index, deal) => index + HAND * (deal % 2);
  const asList = (x) => (Array.isArray(x) ? x : x ? Object.values(x) : []);

  // ---- the game's memory and rules, no screen ------------------------------------------------------
  // words: the set's words. opts: { count, prompt, freeze (seconds), teams: { team: [uid...] }, rng }
  // Times are server milliseconds (`now`), passed in, so a test can run the clock by hand.
  function createRace(words, opts) {
    const rng = opts.rng || Math.random;
    const plan = D.makePlan(words, { count: opts.count, prompt: opts.prompt, rng });
    const race = { plan, freeze: opts.freeze || 0, T: {}, pending: [], winner: null, began: false, t0: 0, steps: plan.steps };
    for (const [t, uids] of Object.entries(opts.teams)) {
      if (!uids.length) continue;
      race.T[t] = { uids: uids.slice(), g: D.createGame(words, { plan, uids, penalty: 0, maxHand: HAND, rng }),
        deal: 0, t0: 0, frozenUntil: 0, res: {}, fin: null, wrongs: 0, last: null };
    }
    const teamIds = () => Object.keys(race.T).sort();
    race.teamIds = teamIds;

    race.dealTeam = function (t, now) {
      const T = race.T[t];
      T.g.deal();
      T.deal++; T.t0 = now;
      for (const u of T.uids) T.res[u] = {};
    };
    // What goes into hands/<uid>: the relay's hand, which deal this is, and how the cards were judged so far.
    race.handFor = function (uid, t) {
      const T = race.T[t], hand = Object.assign(T.g.handFor(uid), { d: T.deal });
      if (Object.keys(T.res[uid] || {}).length) hand.res = Object.assign({}, T.res[uid]);
      return hand;
    };
    race.allHands = function () {
      const out = {};
      for (const t of teamIds()) for (const u of race.T[t].uids) out[u] = race.handFor(u, t);
      return out;
    };
    // The first call deals everyone; afterwards only the teams that finished a word are dealt again.
    race.nextRound = function (now) {
      if (!race.began) { race.began = true; race.t0 = now; teamIds().forEach((t) => race.dealTeam(t, now)); }
      else race.pending.forEach((t) => race.dealTeam(t, now));
      race.pending = [];
      return race.allHands();
    };
    race.over = () => race.winner !== null;
    race.frozen = (t, now) => race.T[t].frozenUntil > now;

    // One tap at server time `at`. Returns { ok: true|false|null, index, completed, won, stale }.
    // ok null = ignored (stale parity, frozen, a card already tried, a word already found...).
    race.tap = function (uid, v, team, at) {
      const T = race.T[team], none = { ok: null };
      if (!T || race.winner !== null || T.fin !== null || !T.uids.includes(uid)) return none;
      if (!Number.isInteger(v) || v < 0 || v >= 2 * HAND) return none;
      if (Math.floor(v / HAND) !== T.deal % 2) return { ok: null, stale: true };
      if (at < T.frozenUntil) return { ok: null, frozen: true };            // frozen: not tried, not wrong
      const index = v % HAND;
      const r = T.g.tap(uid, index, at - T.t0);
      if (r.ok === null) return none;
      T.res[uid][index] = r.ok ? 1 : 0;
      if (!r.ok) {
        T.wrongs++;
        if (race.freeze > 0) T.frozenUntil = at + race.freeze * 1000;
        return { ok: false, index };
      }
      if (!r.completed) return { ok: true, index, completed: false };
      const c = T.g.cur;
      T.last = c.w.latin + " (" + c.w.def + ") · " + c.d.w;
      let won = false;
      if (T.g.i + 1 >= T.g.order.length) {                                   // that was the team's last word
        T.fin = Math.max(0, at - race.t0);
        if (race.winner === null) { race.winner = team; won = true; }
      } else race.pending.push(team);
      return { ok: true, index, completed: true, won };
    };

    // What the devices and the projector may see of the teams' progress.
    race.publicState = function () {
      const t = {};
      for (const k of teamIds()) {
        const T = race.T[k], g = T.g, c = g.cur;
        const s = { i: Math.min(g.i + 1, g.order.length), of: g.order.length, dn: g.log.length, n: T.deal, w: T.wrongs };
        if (c) {
          s.pk = c.pk; s.p = c.row[c.pk]; s.b = c.bad;
          const f = {};
          for (const col of c.cols) if (c.found[col]) f[col] = c.row[col];
          if (Object.keys(f).length) s.f = f;
        }
        if (T.frozenUntil) s.fz = T.frozenUntil;
        if (T.last) s.lm = T.last;
        if (T.fin !== null) s.fin = Math.round(T.fin);
        t[k] = s;
      }
      return { t0: race.t0, t, win: race.winner === null ? -1 : +race.winner, fr: race.freeze, of: race.steps.length };
    };

    // The breakdown. `nameOf(t)` is the team's label.
    race.summary = function (label) {
      const ts = teamIds(), out = [];
      out.push({
        title: ts.length > 1 ? "How each team did" : "How the team did",
        note: race.winner !== null ? "Team " + label(+race.winner) + " finished first." : undefined,
        columns: ["Team", "Words done", "Time to finish", "Wrong cards"],
        rows: ts.map((t) => {
          const T = race.T[t];
          return ["Team " + label(+t), T.g.log.length + " of " + T.g.order.length, T.fin !== null ? clockText(T.fin) : "did not finish", T.wrongs];
        }),
      });
      for (const t of ts) {
        const rows = T_rows(race.T[t]);
        out.push({
          title: "Team " + label(+t) + ": each word, slowest first",
          note: "Seconds are the time from the word opening to the third right card. A wait after a wrong card is part of it.",
          columns: ["Latin", "Derivative", "Prompt", "Seconds", "Wrong cards"],
          rows: rows.slice().sort((a, b) => b.ms - a.ms).map((r) => [r.latin, r.deriv, KIND_LABEL[r.pk], (r.ms / 1000).toFixed(1), r.bad]),
        });
      }
      // words with the most wrong cards, both teams together
      const by = new Map();
      for (const t of ts) for (const r of T_rows(race.T[t], true)) {
        if (!r.bad) continue;
        const e = by.get(r.latin) || { latin: r.latin, deriv: r.deriv, bad: 0, per: {} };
        e.bad += r.bad; e.per[t] = (e.per[t] || 0) + r.bad;
        by.set(r.latin, e);
      }
      const worst = [...by.values()].sort((a, b) => b.bad - a.bad || a.latin.localeCompare(b.latin));
      const sec = { title: "Words with the most wrong cards" };
      if (!worst.length) sec.note = "Nobody tapped a wrong card.";
      else {
        sec.columns = ["Latin", "Derivative", "Wrong cards", "By team"];
        sec.rows = worst.slice(0, 10).map((e) => [e.latin, e.deriv, e.bad, Object.keys(e.per).sort().map((t) => "Team " + label(+t) + " ×" + e.per[t]).join(", ")]);
      }
      out.push(sec);
      return out;
    };
    // a team's finished words, plus the open word if it has wrong cards (a team that lost may stop mid-word)
    function T_rows(T, withOpen) {
      const rows = T.g.log.map((r) => Object.assign({}, r));
      const c = T.g.cur;
      if (withOpen && c && c.ms === null && c.bad) rows.push({ latin: c.w.latin, deriv: c.d.w, pk: c.pk, ms: 0, bad: c.bad });
      return rows;
    }
    return race;
  }

  if (typeof module === "object" && module.exports) module.exports = { createRace, encodeTap, HAND };
  if (typeof Live === "undefined") return;           // (loaded by a test with no page: only the game rules are wanted)

  // ---- the settings ----------------------------------------------------------------------------------
  const { h, clear } = Live;
  const B = Live.Deriv;                              // (the page-only parts of derivatives.js: cards, clock, data)
  const { card } = B;
  const SET_SETTING = B.setSetting("newlatini", "Newest Latin I");

  // a number that counts down by itself to `endMs` (server time) and calls done() once; stops when it leaves the page
  function countdown(endMs, nowFn, cls, done) {
    const el = h("b", { class: cls || "" });
    let fired = false;
    const show = () => {
      const left = Math.max(0, Math.ceil((endMs - nowFn()) / 1000));
      el.textContent = String(left);
      if (left <= 0 && !fired) { fired = true; if (done) done(); }
    };
    const timer = setInterval(() => { if (!el.isConnected || fired) clearInterval(timer); else show(); }, 200);
    show();
    return el;
  }
  const short = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
  function bar(done, of) {
    const b = h("span", { class: "dx-live-bar", role: "img", "aria-label": done + " of " + of + " words done" });
    b.appendChild(h("i", { style: "width:" + Math.round(100 * done / Math.max(1, of)) + "%" }));
    return b;
  }

  let PICK = null, LAST = null, SENT = {}, SENDER = null, LASTD = 0;        // device-only memory (this page, this game)
  const rerender = () => { if (LAST) MODE.player.render(LAST[0], LAST[1], LAST[2]); };

  const MODE = Live.registerMode({
    id: "derivrace",
    title: "Derivatives: team race",
    blurb: "Two teams get the same Latin words. Each team matches the Latin word, its meaning, an English derivative and its meaning. A wrong card freezes the team. The first team to finish wins.",
    lateJoin: false,
    autoLock: false,
    noStandings: true,
    teams: { optional: false, sizes: [4], all: false },
    settings: [
      SET_SETTING,
      { key: "count", label: "Words in a run (0 = the whole set)", type: "int", options: [0, 6, 10, 15], default: 0 },
      { key: "freeze", label: "Seconds frozen after a wrong card", type: "int", options: [0, 3, 5, 8], default: 5 },
      { key: "prompt", label: "Prompt card", type: "enum", options: [["rotate", "Rotate through all four"], ["latin", "Always the Latin word"], ["ldef", "Always the Latin meaning"], ["deriv", "Always the derivative"], ["ddef", "Always the English meaning"]], default: "rotate" },
    ],

    host: {
      ownsDone: true,

      lobbyNote(ctx, who) {
        const n = who.length;
        let teams = Object.values(ctx.teams());
        if (!teams.length && n) {
          const by = Live.makeTeams(who.map((p) => p.uid), 4), sizes = {};
          for (const t of Object.values(by)) sizes[t] = (sizes[t] || 0) + 1;
          teams = Object.values(sizes).map((k) => new Array(k));
        }
        const bits = [];
        if (n && n <= 4) bits.push("With 4 or fewer players there is one team, and it plays alone. The class relay may be better for a small class.");
        if (teams.some((u) => u.length === 2)) bits.push("A team of two: one device holds two columns of cards.");
        bits.push("Both teams get the same words. A wrong card freezes the whole team.");
        return bits.join(" ");
      },

      async start(ctx) {
        const data = await B.loadData();
        const s = ctx.settings;
        const set = B.chooseSet(data.sets, s.set, "newlatini");
        if (!set) throw new Error("data/derivatives.json has no word sets");
        ctx.mem.set = set;
        ctx.mem.race = createRace(set.words, { count: s.count, prompt: s.prompt, freeze: s.freeze, teams: ctx.teams(), rng: ctx.random });
      },

      // Called once at the start and again after every lock: deal the teams that finished a word, write every hand.
      nextRound(ctx) {
        const r = ctx.mem.race;
        if (r.over()) return null;
        const hands = r.nextRound(ctx.now());
        ctx.write("state", r.publicState());
        return { ms: 0, round: {}, hands };
      },

      onTap(ctx, uid, tap) {
        const r = ctx.mem.race, team = ctx.teamOf(uid);
        if (team === null) return;
        const res = r.tap(uid, tap.v, String(team), typeof tap.at === "number" ? tap.at : ctx.now());
        if (res.ok === null) return;
        ctx.write("hands/" + uid + "/res/" + res.index, res.ok ? 1 : 0).catch(() => {});
        ctx.write("state", r.publicState()).catch(() => {});
        if (res.completed) ctx.requestLock();         // a team moved on: lock and reopen, which re-deals it (and bumps the round number)
      },

      lock(ctx) {
        const r = ctx.mem.race;
        ctx.write("state", r.publicState());
        const score = {};                              // the words each team has finished (the shell's "Teams" list shows it)
        for (const t of r.teamIds()) score[t] = r.T[t].g.log.length;
        return { reveal: {}, score };
      },

      summary(ctx) {
        const r = ctx.mem.race;
        return r ? r.summary(Live.teamLabel) : [];
      },

      renderHost(ctx, el, view) {
        clear(el);
        const r = ctx.mem.race;
        if (!view.round || !r) { el.appendChild(h("p", { class: "live-big" }, "Get ready…")); return; }
        // Nobody presses Next here: once the lock is shown, go straight on to the re-deal (unless a team has won).
        if (view.stage === "revealed" && !r.over()) ctx.requestNext(0);
        const win = r.winner;
        const fin = win !== null ? r.T[win].fin : null;
        const clock = fin !== null ? h("b", { class: "dr-live-clock" }, clockText(fin)) : B.runningClock(() => ctx.now() - r.t0);
        el.appendChild(h("div", { class: "live-q-head dr-live-head" },
          h("span", { class: "live-q-n" }, "Team race: " + r.steps.length + " words"),
          h("span", { class: "dr-live-time" }, "Time ", clock)));
        const lanes = h("div", { class: "dx-live-lanes" });
        for (const t of r.teamIds()) {
          const T = r.T[t], g = T.g, c = g.cur, now = ctx.now();
          const frozen = T.frozenUntil > now && T.fin === null && view.phase !== "done";
          const lane = h("div", { class: "dx-live-lane" + (win === t ? " won" : "") + (frozen ? " frozen" : "") });
          lane.appendChild(h("div", { class: "dx-live-lane-head" },
            h("b", {}, "Team " + Live.teamLabel(+t)),
            h("span", { class: "dx-live-word" }, T.fin !== null ? "All " + g.order.length + " words done" : "Word " + (g.i + 1) + " of " + g.order.length)));
          lane.appendChild(h("div", { class: "dx-live-members" }, T.uids.map((u) => ctx.nameOf(u)).join(" · ")));
          lane.appendChild(bar(g.log.length, g.order.length));
          if (c && T.fin === null && view.phase !== "done") {
            lane.appendChild(card(c.pk, c.row[c.pk], "dr-live-big dx-live-prompt"));
            const slots = h("div", { class: "dx-live-slots" });
            for (const k of c.cols) {
              // An open slot does not name who holds it: the projector never shows whom the class is waiting on.
              slots.appendChild(c.found[k] ? card(k, c.row[k], "dr-live-found")
                : h("div", { class: "dr-live-card dr-live-empty" }, h("span", { class: "dr-live-kind" }, KIND_LABEL[k]), h("span", { class: "dr-live-who" }, "… still open")));
            }
            lane.appendChild(slots);
          }
          if (frozen) {
            const banner = h("p", { class: "dx-live-frozen" });
            banner.append("Frozen: ", countdown(T.frozenUntil, ctx.now, "dx-live-count", () => banner.remove()), "…");
            lane.appendChild(banner);
          }
          if (T.wrongs) lane.appendChild(h("p", { class: "dx-live-wrongs" }, "Wrong cards: " + T.wrongs));
          if (T.last) lane.appendChild(h("p", { class: "dx-live-last" }, h("b", {}, "Last match: "), short(T.last, 90)));
          lanes.appendChild(lane);
        }
        el.appendChild(lanes);
        if (win !== null) {
          el.appendChild(h("p", { class: "live-big dx-live-wintext" }, "🏆 Team " + Live.teamLabel(+win) + " finished first!" + (view.phase === "done" ? "" : " Press Next.")));
        }
      },
    },

    player: {
      ownsDone: true,
      render(ctx, el, view) {
        clear(el);
        LAST = [ctx, el, view];
        const r = view.round, st = view.state || {};
        if (view.phase === "done") return donePhone(ctx, el, st);
        if (ctx.team === null) { el.appendChild(h("p", { class: "live-big" }, "You’ll play from the next game.")); return; }
        if (!r) { el.appendChild(h("p", { class: "live-big" }, "Get ready…")); return; }
        const hand = view.hand && view.hand.n === r.n ? view.hand : null;
        const d = hand ? hand.d : 0;
        if (d !== LASTD) { PICK = null; SENT = {}; LASTD = d; }         // my team has a new word: forget the old selection
        if (!SENDER) SENDER = Live.DevicesKit.makeSender((v) => ctx.tap(v), encodeTap);
        if (hand) { const p = SENDER.view({ n: r.n, open: r.open, d }); if (p) p.then(rerender); }

        const teams = st.t || {}, mine = teams[ctx.team];
        const me = mine && mine.n === d ? mine : null;
        const found = (me && me.f) || {};
        const mates = ctx.teammates().map((p) => p.name);
        el.appendChild(h("div", { class: "dr-live-top" },
          h("b", { class: "live-me-team" }, "Team " + Live.teamLabel(ctx.team)),
          h("span", {}, hand ? "Word " + hand.i + " of " + hand.of : "")));
        const others = Object.keys(teams).filter((k) => +k !== ctx.team).sort();
        if (others.length) {
          el.appendChild(h("p", { class: "live-note" }, others.map((k) => {
            const o = teams[k];
            return "Team " + Live.teamLabel(+k) + ": " + (o.fin !== undefined ? "finished" : "word " + o.i + " of " + o.of);
          }).join(" · ")));
        }
        if (mates.length) el.appendChild(h("p", { class: "live-note" }, "With: " + mates.join(", ")));
        if (st.win >= 0) {
          el.appendChild(h("p", { class: "live-result " + (+st.win === ctx.team ? "ok" : "bad") }, +st.win === ctx.team ? "🏆 Your team won!" : "Team " + Live.teamLabel(+st.win) + " won."));
          return;
        }
        if (!hand) { el.appendChild(h("p", { class: "live-note" }, "You’ll play from the next game.")); return; }

        const mineCols = asList(hand.mine);
        const frozenUntil = (mine && mine.fz) || 0;
        const frozen = frozenUntil > ctx.now();
        el.appendChild(card(hand.pk, hand.p, "dr-live-promptcard"));
        el.appendChild(h("p", { class: "dr-live-cols" }, KINDS.filter((k) => k !== hand.pk).map((k) =>
          h("span", { class: "dr-live-chip" + (found[k] ? " on" : "") + (mineCols.includes(k) ? " mine" : "") },
            (found[k] ? "✓ " : "… ") + KIND_LABEL[k] + (mineCols.includes(k) ? " (this device)" : "")))));
        if (frozen) {
          el.appendChild(h("p", { class: "dx-live-frozen" }, "Frozen: ", countdown(frozenUntil, ctx.now, "dx-live-count", rerender), "…"));
          el.appendChild(h("p", { class: "live-note" }, "A wrong card. The whole team waits."));
        }
        if (me && me.b && !frozen) el.appendChild(h("p", { class: "dr-live-oops" }, "✗ A wrong card on this word"));

        const cards = asList(hand.cards);
        if (!cards.length) { el.appendChild(h("p", { class: "live-note" }, "This device has no cards for this word. Help the others check theirs.")); return; }
        el.appendChild(h("h3", {}, "Your cards: " + mineCols.map((k) => KIND_LABEL[k]).join(" and ")));
        const res = hand.res || {}, sent = SENT[d] || (SENT[d] = new Map());
        const grid = h("div", { class: "dr-live-hand" });
        cards.forEach((f, i) => {
          const ok = res[i] === 1, bad = res[i] === 0, pending = !ok && !bad && sent.has(i);
          const blocked = !ok && !bad && !pending && !!found[f.k];
          const canPick = !ok && !bad && !pending && !blocked && !frozen;
          const picked = PICK === i;
          const tag = ok ? "✓ Right" : bad ? "✗ Wrong" : pending ? "Sent…" : blocked ? "Already found" : "";
          grid.appendChild(h("button", {
            type: "button", disabled: !canPick,
            class: "dr-live-mine" + (picked ? " picked" : "") + (ok ? " right" : "") + (bad ? " wrong" : "") + (blocked || pending || frozen ? " dim" : ""),
            "aria-pressed": String(picked),
            onclick: () => { PICK = picked ? null : i; rerender(); },
          }, card(f.k, f.t), tag ? h("span", { class: "dr-live-tag" }, tag) : null));
        });
        el.appendChild(grid);
        if (PICK !== null && !frozen) {
          const fr = st.fr !== undefined ? st.fr : ctx.settings.freeze;
          el.appendChild(h("div", { class: "dr-live-confirm" },
            h("span", {}, fr ? "A wrong card freezes the team for " + fr + " seconds." : "Is this the one?"),
            h("button", { type: "button", class: "primary live-bigbtn", onclick: () => {
              const i = PICK; PICK = null; sent.set(i, true); rerender();
              // a tap the host ignored (the team was frozen just then) gets no answer: let the card be tapped again
              setTimeout(() => { if (sent.get(i) && !SENDER.waiting) { sent.delete(i); rerender(); } }, 4000);
              SENDER.send(i, d, r.n).then(rerender);
            } }, "Lock it in"),
            h("button", { type: "button", onclick: () => { PICK = null; rerender(); } }, "Cancel")));
        }
      },
    },
  });

  function donePhone(ctx, el, st) {
    const win = st.win >= 0 ? +st.win : null;
    el.appendChild(h("p", { class: "live-big" }, win === null ? "Game over" : win === ctx.team ? "🏆 Your team won!" : "Team " + Live.teamLabel(win) + " won!"));
    el.appendChild(h("p", { class: "live-note" }, "Thanks for playing. Your teacher has the breakdown."));
  }
})();
