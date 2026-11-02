// derivatives.js -- "Derivatives: class relay", a whole-class race against the class's own best time. AGPL-3.0.
//
// Four cards belong together: a LATIN WORD, its DEFINITION, an English DERIVATIVE of it (at or above
// grade level) and that derivative's own DEFINITION. The projector and every device show one of the four
// (the prompt); the other three columns are dealt out, one column to each device, with decoys from the
// other words. The class must find all three, talking to each other: nobody can see another's cards.
// A wrong card adds seconds to the clock. The run is every word of the set (or a chosen number of them),
// and the time to beat is the class's best for that set, kept on the teacher's computer only.
//
// Made for a class of THREE (owner, 2026-11-02): each student holds one column. Fewer play too (a device
// holds two or three columns); more share a column, its cards split between them. Which column a device
// holds moves on by one every word, so everybody handles every kind of card.
//
// One word is one round of the live shell. A tap is the index of a card in the tapper's hand (0-9); the
// rules accept it only for the round that is open, so a tap can never land on the next word's cards.
//
// The data is data/derivatives.json, made by the Latin Vocab Toolkit (engine/export_derivative_cards.py):
// several sets, one per Trial; the teacher picks one, and "Newest" is the last in the file.
//
//   createGame -- the game's memory and rules, no screen (tests/derivatives_mode.test.js plays whole games)
//   the mode   -- settings, the projector, the device, the end-of-game breakdown
//
// WHAT IS WRITTEN WHERE: the host page keeps the words and every hand's meaning in memory. The database
// gets only each player's cards as plain text (hands/<uid>, private), the public progress (state), and
// nothing in score. The best times live in the teacher's page's memory, never in the database or the
// browser's storage (the live pages store nothing; see Live.STORED): they last through every "Play again"
// and are gone when the teacher's page is closed or reloaded.
(function () {
  "use strict";
  const KINDS = ["latin", "ldef", "deriv", "ddef"];
  const KIND_LABEL = { latin: "Latin word", ldef: "Latin meaning", deriv: "English derivative", ddef: "English meaning" };

  // ---- the game's memory and rules, no screen ------------------------------------------------------
  // words: [{ key, latin, def, derivs: [{ w, d }] }]
  // opts: { count (0 = all), penalty (seconds), prompt: "rotate"|kind, uids: [uid...], rng }
  function createGame(words, opts) {
    const rng = opts.rng || Math.random;
    const below = (n) => Math.min(n - 1, Math.floor(rng() * n));
    const shuffled = (a) => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = below(i + 1); [x[i], x[j]] = [x[j], x[i]]; } return x; };
    const usable = words.filter((w) => w && w.key && w.latin && w.def && Array.isArray(w.derivs) && w.derivs.length);
    if (usable.length < 2) throw new Error("A derivatives set needs at least two words");
    const count = opts.count > 0 ? Math.min(opts.count, usable.length) : usable.length;
    const g = {
      uids: opts.uids.slice(), penalty: opts.penalty || 0, pace: opts.prompt || "rotate",
      order: shuffled(usable).slice(0, count), i: -1, shift: below(4),
      cur: null, solved: 0, wrongs: 0, log: [], over: false,
    };
    const text = (w, kind, d) => (kind === "latin" ? w.latin : kind === "ldef" ? w.def : kind === "deriv" ? d.w : d.d);

    // Who holds which answer column this word: the three columns go round the players, one step on each word.
    g.assign = function (cols, i) {
      const n = g.uids.length, out = {};
      g.uids.forEach((u) => { out[u] = []; });
      if (!n) return out;
      if (n >= cols.length) g.uids.forEach((u, p) => out[u].push(cols[(p + i) % cols.length]));
      else cols.forEach((c, j) => out[g.uids[(j + i) % n]].push(c));
      return out;
    };

    // The next word: its prompt, the three right cards, the decoys, and every player's hand.
    g.deal = function () {
      g.i++;
      if (g.i >= g.order.length) { g.over = true; g.cur = null; return null; }
      const w = g.order[g.i], d = w.derivs[below(w.derivs.length)];
      const pk = g.pace === "rotate" ? KINDS[(g.shift + g.i) % 4] : g.pace;
      const cols = KINDS.filter((k) => k !== pk);
      const holds = g.assign(cols, g.i);
      const others = g.order.length > 1 ? usable.filter((x) => x.key !== w.key) : [];
      const sharers = (c) => g.uids.filter((u) => holds[u].includes(c)).length;
      const perPlayer = g.uids.length === 1 ? 3 : 4;            // a hand stays at 9 cards or fewer (a tap is 0-9)
      const hands = {}, meaning = {};
      g.uids.forEach((u) => { hands[u] = []; });
      for (const c of cols) {
        const right = { k: c, t: text(w, c, d) };
        const want = Math.max(perPlayer, sharers(c)) - 1;
        const seen = new Set([right.t]), decoys = [];
        for (const x of shuffled(others)) {
          if (decoys.length >= want) break;
          const t = text(x, c, x.derivs[below(x.derivs.length)]);
          if (seen.has(t)) continue;
          seen.add(t); decoys.push({ k: c, t });
        }
        const pile = shuffled([Object.assign({ ok: true }, right), ...decoys]);
        const who = g.uids.filter((u) => holds[u].includes(c));
        pile.forEach((card, j) => hands[who[j % who.length]].push(card));
      }
      for (const u of g.uids) {
        hands[u] = shuffled(hands[u]);
        meaning[u] = hands[u];
      }
      g.cur = { w, d, pk, cols, holds, meaning, found: {}, tried: {}, bad: 0, ms: null,
        row: { latin: w.latin, ldef: w.def, deriv: d.w, ddef: d.d } };
      return g.cur;
    };
    // What goes into hands/<uid>: the prompt, which columns this device holds, and the cards as plain text.
    g.handFor = function (uid) {
      const c = g.cur;
      const hand = { i: g.i + 1, of: g.order.length, pk: c.pk, p: c.row[c.pk], mine: c.holds[uid] || [] };
      if (!hand.mine.length) delete hand.mine;                                   // (an empty list would not survive the database)
      const cards = (c.meaning[uid] || []).map(({ k, t }) => ({ k, t }));
      if (cards.length) hand.cards = cards;
      return hand;
    };
    g.allHands = function () { const out = {}; for (const u of g.uids) out[u] = g.handFor(u); return out; };

    // One tap: v is the card's index in the tapper's hand; dt the time since the word opened.
    // Returns { ok: true|false|null, index, completed }.
    g.tap = function (uid, v, dt) {
      const c = g.cur;
      if (!c || c.ms !== null || !Number.isInteger(v)) return { ok: null };
      const card = (c.meaning[uid] || [])[v];
      const mark = uid + "/" + v;
      if (!card || mark in c.tried || c.found[card.k]) return { ok: null };
      c.tried[mark] = card.ok ? 1 : 0;
      if (!card.ok) { c.bad++; g.wrongs++; return { ok: false, index: v }; }
      c.found[card.k] = uid;
      if (c.cols.every((k) => c.found[k])) {
        c.ms = Math.max(0, dt || 0);
        g.solved += c.ms;
        g.log.push({ latin: c.w.latin, deriv: c.d.w, pk: c.pk, ms: c.ms, bad: c.bad });
        return { ok: true, index: v, completed: true };
      }
      return { ok: true, index: v, completed: false };
    };
    // The clock: solving time of the finished words, plus the open word's so far, plus the penalties.
    g.total = (openMs) => g.solved + (g.cur && g.cur.ms === null ? Math.max(0, openMs || 0) : 0) + g.wrongs * g.penalty * 1000;

    // What the devices and the projector may see. `t0` lets a device run the clock itself.
    g.publicState = function (extra) {
      const c = g.cur, s = { i: g.i + 1, of: g.order.length, done: g.solved, bad: g.wrongs, pen: g.penalty };
      if (c) {
        s.pk = c.pk; s.p = c.row[c.pk]; s.b = c.bad;
        const f = {};
        for (const k of c.cols) if (c.found[k]) f[k] = c.row[k];
        if (Object.keys(f).length) s.f = f;
        if (c.ms !== null) s.row = Object.assign({}, c.row);
      }
      return Object.assign(s, extra || {});
    };
    g.summary = function () {
      const rows = g.log.slice().sort((a, b) => b.ms - a.ms);
      return [{
        title: "Each word, slowest first",
        note: "Seconds are the time to find all three cards; a wrong card is counted on the word it happened on.",
        columns: ["Latin", "Derivative", "Prompt", "Seconds", "Wrong cards"],
        rows: rows.map((r) => [r.latin, r.deriv, KIND_LABEL[r.pk], (r.ms / 1000).toFixed(1), r.bad]),
      }];
    };
    return g;
  }

  const clockText = (ms) => {
    const t = Math.max(0, Math.round(ms / 100)) / 10, m = Math.floor(t / 60), s = t - m * 60;
    return m + ":" + (s < 10 ? "0" : "") + s.toFixed(1);
  };
  // A best time is only comparable with a run of the same set, length and penalty. Kept in this page's
  // memory: a "Play again" keeps it, closing or reloading the teacher's page forgets it.
  const BEST = {};
  const bestId = (set, count, penalty) => set + ":" + count + ":" + penalty;
  const readBest = (id) => BEST[id] || 0;
  const saveBest = (id, ms) => { BEST[id] = Math.round(ms); };

  if (typeof module === "object" && module.exports) module.exports = { createGame, clockText, KINDS };
  if (typeof Live === "undefined") return;           // (loaded by a test with no page: only the game rules are wanted)

  // ---- the data: which sets the settings offer --------------------------------------------------------
  // The settings are fixed when this file loads, but the sets are in a data file; the teacher's page
  // fetches it and adds them to the choice ("Newest" stays first and is the default).
  let DATA = null;
  const SET_SETTING = { key: "set", label: "Word set", type: "enum", options: [["newest", "Newest Trial"]], default: "newest" };
  const loadData = () => DATA || (DATA = fetch("data/derivatives.json", { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error("Could not load data/derivatives.json");
    return r.json();
  }).then((j) => {
    for (const s of j.sets.slice().reverse()) if (!SET_SETTING.options.some((o) => o[0] === s.id)) SET_SETTING.options.push([s.id, s.title]);
    return j;
  }));
  // (only on the teacher's page; this file runs before host.js's own tag is parsed, so ask the address)
  if (typeof location !== "undefined" && /\/host(\.html)?$/.test(location.pathname)) loadData().catch(() => { DATA = null; });

  // ---- the screens ---------------------------------------------------------------------------------
  const { h, clear } = Live;
  const asList = (x) => (Array.isArray(x) ? x : x ? Object.values(x) : []);
  const card = (k, t, cls) => h("div", { class: "dr-live-card dr-live-" + k + (cls ? " " + cls : "") },
    h("span", { class: "dr-live-kind" }, KIND_LABEL[k]), h("span", { class: "dr-live-face", lang: k === "latin" ? "la" : null }, t));
  // A clock that runs by itself between database updates, and stops when it leaves the page.
  function runningClock(stateFn, cls) {
    const el = h("b", { class: "dr-live-clock " + (cls || "") });
    const show = () => { el.textContent = clockText(stateFn()); };
    const timer = setInterval(() => { if (!el.isConnected) clearInterval(timer); else show(); }, 100);
    show();
    return el;
  }

  let PICK = null, LAST = null, SENT = {}, LASTN = 0;     // device-only memory (this page, this game)
  const rerender = () => { if (LAST) MODE.player.render(LAST[0], LAST[1], LAST[2]); };

  const MODE = Live.registerMode({
    id: "derivatives",
    title: "Derivatives: class relay",
    blurb: "The whole class matches each Latin word, its meaning, an English derivative and that word's meaning, racing its own best time. Best with three devices.",
    lateJoin: false,
    autoLock: false,
    noStandings: true,                               // one class, one time: nobody to rank
    settings: [
      SET_SETTING,
      { key: "count", label: "Words in a run (0 = the whole set)", type: "int", options: [0, 6, 10, 15], default: 0 },
      { key: "penalty", label: "Seconds added for a wrong card", type: "int", options: [0, 3, 5, 10], default: 5 },
      { key: "prompt", label: "Prompt card", type: "enum", options: [["rotate", "Rotate through all four"], ["latin", "Always the Latin word"], ["ldef", "Always the Latin meaning"], ["deriv", "Always the derivative"], ["ddef", "Always the English meaning"]], default: "rotate" },
    ],

    host: {
      ownsDone: true,

      lobbyNote(ctx, who) {
        const n = who.length;
        return n === 3 || !n ? "Best with three devices: each holds one of the three answer columns." :
          n && n < 3 ? "Fewer than three devices: some hold two columns or more." :
          "More than three devices: they share columns, each with part of the cards.";
      },

      async start(ctx) {
        const data = await loadData();
        const s = ctx.settings;
        const set = (s.set !== "newest" && data.sets.find((x) => x.id === s.set)) || data.sets[data.sets.length - 1];
        if (!set) throw new Error("data/derivatives.json has no word sets");
        const uids = ctx.players().map((p) => p.uid);
        ctx.mem.set = set;
        ctx.mem.g = createGame(set.words, { count: s.count, penalty: s.penalty, prompt: s.prompt, uids, rng: ctx.random });
        ctx.mem.bestId = bestId(set.id, ctx.mem.g.order.length, s.penalty);
        ctx.mem.best = readBest(ctx.mem.bestId);
      },

      nextRound(ctx) {
        const g = ctx.mem.g;
        const c = g.deal();
        if (!c) {                                     // the run is over: the time, and a record if it is one
          const total = g.total(0), prev = ctx.mem.best;
          ctx.mem.result = { total, prev, record: !prev || total < prev };
          if (ctx.mem.result.record) { saveBest(ctx.mem.bestId, total); ctx.mem.best = total; }
          ctx.write("state", g.publicState({ end: Math.round(total), best: Math.round(ctx.mem.best), rec: ctx.mem.result.record ? 1 : 0 }));
          return null;
        }
        ctx.write("state", g.publicState({ best: ctx.mem.best }));
        return { ms: 0, round: {}, hands: g.allHands() };
      },

      onTap(ctx, uid, tap) {
        const g = ctx.mem.g;
        const r = g.tap(uid, tap.v, tap.dt);
        if (r.ok === null) return;
        ctx.write("hands/" + uid + "/res/" + r.index, r.ok ? 1 : 0).catch(() => {});
        ctx.write("state", g.publicState({ best: ctx.mem.best })).catch(() => {});
        if (r.completed) ctx.requestLock();
      },

      lock(ctx) {
        return { reveal: {} };
      },

      summary(ctx) {
        const g = ctx.mem.g;
        return g ? g.summary() : [];
      },

      renderHost(ctx, el, view) {
        clear(el);
        const g = ctx.mem.g;
        if (view.phase === "done") return drawResult(ctx, el);
        if (!view.round || !g || !g.cur) { el.appendChild(h("p", { class: "live-big" }, "Get ready…")); return; }
        const c = g.cur, r = view.round;
        // Nobody presses Next: once the word is matched, the full row shows for a moment, then the next word.
        if (view.stage === "revealed") ctx.requestNext(1800);
        const openMs = () => (c.ms === null && typeof r.t0 === "number" ? ctx.now() - r.t0 : 0);
        el.appendChild(h("div", { class: "live-q-head dr-live-head" },
          h("span", { class: "live-q-n" }, "Word " + (g.i + 1) + " of " + g.order.length),
          h("span", { class: "dr-live-time" }, "Time ", runningClock(() => g.total(openMs()))),
          h("span", { class: "dr-live-best" }, ctx.mem.best ? "Best " + clockText(ctx.mem.best) : "No best time yet"),
          g.wrongs ? h("span", { class: "dr-live-pen" }, "Wrong cards: " + g.wrongs + (g.penalty ? " (+" + g.wrongs * g.penalty + " s)" : "")) : null));
        el.appendChild(card(c.pk, c.row[c.pk], "dr-live-big"));
        const slots = h("div", { class: "dr-live-slots" });
        for (const k of c.cols) {
          // An open slot does not name who holds it: the projector never shows whom the class is waiting on.
          slots.appendChild(c.found[k] ? card(k, c.row[k], "dr-live-found")
            : h("div", { class: "dr-live-card dr-live-empty" }, h("span", { class: "dr-live-kind" }, KIND_LABEL[k]), h("span", { class: "dr-live-who" }, "… still open")));
        }
        el.appendChild(slots);
        if (c.bad) el.appendChild(h("p", { class: "dr-live-oops" }, "✗ " + c.bad + " wrong card" + (c.bad > 1 ? "s" : "") + " on this word"));
        if (c.ms !== null) el.appendChild(h("p", { class: "live-big dr-live-got" }, "✓ Matched in " + (c.ms / 1000).toFixed(1) + " s"));
      },
    },

    player: {
      ownsDone: true,
      render(ctx, el, view) {
        clear(el);
        LAST = [ctx, el, view];
        const r = view.round, st = view.state || {};
        if (view.phase === "done") return donePhone(el, st);
        if (!r) { el.appendChild(h("p", { class: "live-big" }, "Get ready…")); return; }
        const hand = view.hand && view.hand.n === r.n ? view.hand : null;
        if (!hand) { el.appendChild(h("p", { class: "live-note" }, "You’ll play from the next game.")); return; }
        if (r.n !== LASTN) { PICK = null; SENT = {}; LASTN = r.n; }   // a new word: forget the old selection
        const mine = asList(hand.mine), found = (st.i === hand.i && st.f) || {}, matched = st.i === hand.i && !!st.row;

        el.appendChild(h("div", { class: "dr-live-top" },
          h("span", {}, "Word " + hand.i + " of " + hand.of),
          st.best ? h("span", { class: "dr-live-best" }, "Best " + clockText(st.best)) : null));
        el.appendChild(card(hand.pk, hand.p, "dr-live-promptcard"));
        el.appendChild(h("p", { class: "dr-live-cols" }, KINDS.filter((k) => k !== hand.pk).map((k) =>
          h("span", { class: "dr-live-chip" + (found[k] ? " on" : "") + (mine.includes(k) ? " mine" : "") },
            (found[k] ? "✓ " : "… ") + KIND_LABEL[k] + (mine.includes(k) ? " (you)" : "")))));
        if (matched) { el.appendChild(h("p", { class: "live-result ok" }, "✓ Matched! Next word coming…")); return; }
        if (st.i === hand.i && st.b) el.appendChild(h("p", { class: "dr-live-oops" }, "✗ A wrong card" + (st.pen ? ": +" + st.pen + " seconds" : "")));

        const cards = asList(hand.cards);
        if (!cards.length) { el.appendChild(h("p", { class: "live-note" }, "You have no cards for this word. Help the others check theirs.")); return; }
        el.appendChild(h("h3", {}, "Your cards: " + mine.map((k) => KIND_LABEL[k]).join(" and ")));
        const res = hand.res || {}, sent = SENT[r.n] || (SENT[r.n] = new Set());
        const grid = h("div", { class: "dr-live-hand" });
        cards.forEach((f, i) => {
          const ok = res[i] === 1, bad = res[i] === 0, pending = !ok && !bad && sent.has(i);
          const blocked = !ok && !bad && !pending && !!found[f.k];
          const canPick = !ok && !bad && !pending && !blocked && r.open;
          const picked = PICK === i;
          const tag = ok ? "✓ Right" : bad ? "✗ Wrong" : pending ? "Sent…" : blocked ? "Already found" : "";
          grid.appendChild(h("button", {
            type: "button", disabled: !canPick,
            class: "dr-live-mine" + (picked ? " picked" : "") + (ok ? " right" : "") + (bad ? " wrong" : "") + (blocked || pending ? " dim" : ""),
            "aria-pressed": String(picked),
            onclick: () => { PICK = picked ? null : i; rerender(); },
          }, card(f.k, f.t), tag ? h("span", { class: "dr-live-tag" }, tag) : null));
        });
        el.appendChild(grid);
        if (PICK !== null) {
          el.appendChild(h("div", { class: "dr-live-confirm" },
            h("span", {}, st.pen ? "A wrong card adds " + st.pen + " seconds." : "Is this the one?"),
            h("button", { type: "button", class: "primary live-bigbtn", onclick: () => {
              const i = PICK; PICK = null; sent.add(i); rerender();
              ctx.tap(i).then(rerender);
            } }, "Lock it in"),
            h("button", { type: "button", onclick: () => { PICK = null; rerender(); } }, "Cancel")));
        }
      },
    },
  });

  function resultLine(st) {
    if (!st.end) return "Game over";
    return (st.rec ? "🏆 New best time: " : "Time: ") + clockText(st.end);
  }
  function donePhone(el, st) {
    el.appendChild(h("p", { class: "live-big" }, resultLine(st)));
    if (st.end && !st.rec && st.best) el.appendChild(h("p", { class: "live-note" }, "The best is " + clockText(st.best) + "."));
    el.appendChild(h("p", { class: "live-note" }, "Keep this tab open if there is another game: it starts here. Close it when you are done: it forgets you."));
  }
  function drawResult(ctx, el) {
    const res = ctx.mem.result, g = ctx.mem.g;
    if (!res || !g) return;
    const box = h("div", { class: "dr-live-result" + (res.record ? " record" : "") });
    if (res.record) box.appendChild(h("p", { class: "dr-live-confetti", "aria-hidden": "true" }, "🏆 ✦ 🎉 ✦ 🏆"));
    box.appendChild(h("h2", { class: "live-big" }, (res.record ? "New best time! " : "Time: ") + clockText(res.total)));
    box.appendChild(h("p", {}, g.order.length + " words · " + (g.solved / 1000).toFixed(1) + " s matching · " +
      g.wrongs + " wrong card" + (g.wrongs === 1 ? "" : "s") + (g.penalty ? " (+" + g.wrongs * g.penalty + " s)" : "")));
    if (res.prev) box.appendChild(h("p", { class: "live-note" }, res.record ? "The old best was " + clockText(res.prev) + "." : "The best is still " + clockText(res.prev) + ", " + ((res.total - res.prev) / 1000).toFixed(1) + " s faster."));
    box.appendChild(h("p", { class: "live-note" }, "Word set: " + ctx.mem.set.title + ". The best time lasts until this page is closed or reloaded."));
    el.appendChild(box);
  }
})();
