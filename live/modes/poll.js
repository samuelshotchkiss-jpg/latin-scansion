// poll.js -- a throwaway mode that asks "A, B or C?" and shows how many chose each. AGPL-3.0.
//
// It exists for two reasons: to prove the live plumbing end to end (lobby, teams, rounds, taps, the
// answer kept off the phones until the reveal, scores, reconnection), and to be the WORKED EXAMPLE
// that live/MODES.md walks through, line by line. It is hidden from the teacher's mode list unless
// host.html is opened as host.html?debug. Read MODES.md next to this file.
//
// What it shows a mode author:
//   * settings          -- three controls the teacher sets before the game (a number, a word, a team size)
//   * the answer key    -- kept in ctx.mem (the host page's memory) and written to the database only
//                          in lock(), as part of `reveal`. A phone can never see it early.
//   * a private hand    -- each player is dealt their own shuffled order of A/B/C, so the host has
//                          something to write to hands/<uid>, readable by that player alone
//   * taps              -- v = which choice (0, 1 or 2), whatever order it was shown in
//   * scoring           -- speed counts; a team's score is the sum of its members'
//   * both screens      -- renderHost (the projector) and player.render (the phone)
(function () {
  "use strict";
  const { h, clear, countdown, scoreboard, shuffle } = Live;

  const QUESTIONS = [
    { q: "Which of these is a noun?", choices: ["puella", "amat", "bene"], answer: 0 },
    { q: "Which of these is a verb?", choices: ["rosa", "ambulat", "magnus"], answer: 1 },
    { q: "Which of these is an adverb?", choices: ["celer", "celeriter", "celeritas"], answer: 1 },
    { q: "Which word is in the accusative case?", choices: ["puella", "puellae", "puellam"], answer: 2 },
    { q: "Which word means “and”?", choices: ["sed", "et", "aut"], answer: 1 },
  ];
  const LETTERS = ["A", "B", "C"];
  const POINTS = 100;           // for a correct answer, plus up to POINTS more for speed

  Live.registerMode({
    id: "poll",
    title: "Poll (plumbing test)",
    blurb: "A, B or C? A test of the live game itself.",
    hidden: true,                                   // listed only with host.html?debug
    lateJoin: true,                                 // a student arriving mid-game plays from the next question
    teams: { optional: true, sizes: [2, 3, 4], all: true },

    // What the teacher can set. int -> a number; enum -> [value, label] pairs; flags -> tick-boxes.
    settings: [
      { key: "rounds", label: "Questions", type: "int", options: [3, 5], default: 3 },
      { key: "seconds", label: "Seconds per question", type: "int", options: [8, 15, 30], default: 15 },
      { key: "counts", label: "Show how many chose each, live", type: "enum", options: [["yes", "Yes"], ["no", "No"]], default: "yes" },
    ],

    // ---- the teacher's page ---------------------------------------------------------------------
    host: {
      // Once, when the teacher presses Start. ctx.mem is this game's scratch space in the HOST's memory.
      start(ctx) {
        ctx.mem.order = shuffle(QUESTIONS.map((q, i) => i), ctx.random);
        ctx.mem.asked = -1;
        ctx.mem.total = {};                         // uid -> points so far
      },

      // Called for round 1, 2, 3... Return null when there are no more rounds.
      nextRound(ctx) {
        const m = ctx.mem;
        m.asked++;
        if (m.asked >= ctx.settings.rounds) return null;
        m.q = QUESTIONS[m.order[m.asked]];          // the KEY (m.q.answer) never leaves this page until lock()
        m.answers = {};                             // uid -> the first tap this round
        const hands = {};
        for (const p of ctx.players()) hands[p.uid] = { order: shuffle([0, 1, 2], ctx.random) };
        return {
          ms: ctx.settings.seconds * 1000,
          round: { q: m.q.q, choices: m.q.choices }, // public: shown on every screen. No answer in here.
          hands,                                    // private: hands/<uid>, readable by that player only
        };
      },

      // Every tap of the current round, once, as it arrives.
      onTap(ctx, uid, tap) {
        const m = ctx.mem;
        if (tap.late || m.answers[uid]) return;     // only the first, on-time tap counts
        if (tap.v < 0 || tap.v > 2) return;
        m.answers[uid] = tap;
      },

      // The round is closed and every tap has been delivered. Grade, and return what to publish.
      lock(ctx) {
        const m = ctx.mem, round = ctx.round;
        const counts = [0, 0, 0], pts = {};
        for (const [uid, tap] of Object.entries(m.answers)) {
          counts[tap.v]++;
          if (tap.v === m.q.answer) {
            const left = Math.max(0, 1 - tap.dt / round.ms);
            pts[uid] = POINTS + Math.round(POINTS * left);
            m.total[uid] = (m.total[uid] || 0) + pts[uid];
          }
        }
        const score = {};                           // the WHOLE score node: players by uid, teams by number
        for (const p of ctx.players()) score[p.uid] = m.total[p.uid] || 0;
        if (ctx.teamsOn) {
          for (const [team, uids] of Object.entries(ctx.teams())) score[team] = uids.reduce((s, u) => s + (m.total[u] || 0), 0);
        }
        return { reveal: { answer: m.q.answer, counts, pts }, score };
      },

      // The projector. Replace the contents of `el` completely each time; it is called on every change.
      renderHost(ctx, el, view) {
        clear(el);
        const r = view.round;
        if (!r) { el.appendChild(h("p", { class: "live-big" }, "Get ready…")); return; }
        const revealed = view.reveal && view.reveal.n === r.n;
        const showCounts = revealed || ctx.settings.counts === "yes";
        const live = view.tapped, who = ctx.players();
        // while the round is open the counts come from the host's own memory (the taps it has graded so
        // far); after the reveal they come from the published `reveal`, the same numbers every phone sees
        const tally = [0, 0, 0];
        for (const a of Object.values(ctx.mem.answers || {})) tally[a.v]++;
        const answered = who.filter((p) => live[p.uid]).length;
        el.appendChild(h("div", { class: "live-q-head" },
          h("span", { class: "live-q-n" }, "Question " + (r.q || r.n) + " of " + ctx.settings.rounds),
          r.open ? h("span", { class: "live-clock", "aria-label": "seconds left" }, "") : null));
        if (r.open) countdown(el.querySelector(".live-clock"), r.t0 + r.ms, ctx.now);
        el.appendChild(h("h2", { class: "live-big" }, r.q));
        const row = h("div", { class: "live-choices" });
        r.choices.forEach((text, i) => {
          const n = revealed ? view.reveal.counts[i] : tally[i];
          const right = revealed && view.reveal.answer === i;
          row.appendChild(h("div", { class: "live-choice" + (right ? " right" : revealed ? " dim" : "") },
            h("b", {}, LETTERS[i] + (right ? " ✓" : "")), h("span", {}, text),
            showCounts && n !== null ? h("em", {}, String(n)) : null));
        });
        el.appendChild(row);
        el.appendChild(h("p", { class: "live-note" }, answered + " of " + who.length + " have answered"));
        if (revealed) {
          const rows = who.map((p) => ({ name: p.name, gloss: p.gloss, score: (view.score || {})[p.uid] || 0 }));
          el.appendChild(h("h3", {}, "Top five"));
          el.appendChild(scoreboard(rows, { top: 5 }));
          if (ctx.teamsOn && view.score) {
            el.appendChild(h("h3", {}, "Teams"));
            el.appendChild(scoreboard(Object.keys(ctx.teams()).map((t) => ({ name: "Team " + Live.teamLabel(+t), score: view.score[t] || 0 })), { top: 10 }));
          }
        }
      },
    },

    // ---- the student's phone -------------------------------------------------------------------
    player: {
      // `view.round`, `view.hand`, `view.myTaps`, `view.reveal`, `view.score` are all the phone ever gets.
      render(ctx, el, view) {
        clear(el);
        const r = view.round;
        if (!r) { el.appendChild(h("p", { class: "live-big" }, "Get ready…")); return; }
        const hand = view.hand && view.hand.n === r.n ? view.hand : null;
        if (!hand) {                                // joined after this question began: wait for the next
          el.appendChild(h("p", { class: "live-big" }, "Welcome! You’ll play from the next question."));
          return;
        }
        const mine = view.myTaps[0];                // this round's first tap (pending ones included)
        const revealed = view.reveal && view.reveal.n === r.n;
        el.appendChild(h("p", { class: "live-q-n" }, "Question " + (r.q || r.n)));
        if (r.open && !mine) {
          const clock = h("span", { class: "live-clock", "aria-label": "seconds left" });
          el.appendChild(clock);
          countdown(clock, r.t0 + r.ms, ctx.now);
        }
        el.appendChild(h("h2", { class: "live-q" }, r.q));
        const list = h("div", { class: "live-answers" });
        hand.order.forEach((choice, pos) => {
          const chosen = mine && mine.v === choice;
          const right = revealed && view.reveal.answer === choice;
          const wrong = revealed && chosen && !right;
          list.appendChild(h("button", {
            type: "button",
            class: "live-answer" + (chosen ? " chosen" : "") + (right ? " right" : "") + (wrong ? " wrong" : ""),
            disabled: !r.open || !!mine,
            onclick: () => ctx.tap(choice),
          }, h("b", {}, LETTERS[pos] + (right ? " ✓" : wrong ? " ✗" : "")), h("span", {}, r.choices[choice])));
        });
        el.appendChild(list);
        if (revealed) {
          const got = view.reveal.pts && view.reveal.pts[ctx.uid];
          el.appendChild(h("p", { class: "live-result " + (got ? "ok" : "bad") },
            got ? "✓ Correct! +" + got : mine ? "✗ Not this time" : "No answer"));
          el.appendChild(h("p", { class: "live-note" }, "Your points: " + Math.round((view.score || {})[ctx.uid] || 0)));
        } else if (mine) {
          el.appendChild(h("p", { class: "live-note" }, "Locked in ✓ — waiting for the others…"));
        } else if (!r.open) {
          el.appendChild(h("p", { class: "live-note" }, "Time’s up."));
        }
      },
    },
  });
})();
