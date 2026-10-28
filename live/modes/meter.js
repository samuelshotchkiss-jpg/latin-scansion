// meter.js -- "Longa an brevis?", the live meter game. AGPL-3.0.
//
// One syllable of a real line of Ovid or Vergil is boxed; every student taps Long, Short or Elided against
// a countdown; the projector then reveals the answer, the reason (the practice app's own sentence), the whole
// scanned line, and plays the line's rhythm on the drums. The questions come from data/meter_questions.json
// (tools/make_meter_questions.py); the quantity of every syllable is the scanner's, never this file's.
//
// WHERE THINGS LIVE (privacy and size, see MODES.md):
//   * The question bank is 2.4 MB, and ONLY THE TEACHER'S PAGE loads it (host.start, below). A phone never
//     fetches it: it is given, per question, the line's text and which letters to box (round.t, a, b), and
//     three buttons. tests/meter_mode.test.js fails if a phone-side path could reach the bank.
//   * The answer, the reason and the full marks live in ctx.mem until lock() returns them as `reveal`, which
//     the shell writes only after the round has closed. Nothing about the question's KIND is ever published
//     before then either (an "elision" question would give itself away).
//   * A tap is one number: 0 = Long, 1 = Short, 2 = Elided. The first on-time tap counts; a phone disables
//     its buttons after one, and the host would ignore the rest anyway.
//   * hands/<uid> is an empty marker ({n} only) written to everyone present when a question opens. A student
//     who joins mid-question has none, so they are told they will play from the next one, and a tap of theirs
//     would not be graded.
//
// SCORING (owner's ruling): a right answer earns 500 + 500 x (time left / time allowed), the time being the
// SERVER's (the tap's `at` against the round's t0, both on the server clock, never the phone's); a wrong or
// missing answer earns 0; no streak bonus. A team's score is the AVERAGE of its members' scores, so unequal
// teams stay fair.
//
// ASKING. Questions are sampled for the ticked kinds and passages; no line is asked twice in a game; the
// answers are held near 40 % long / 40 % short / 20 % elided (elided only if "elision" is ticked; otherwise
// half and half); and no kind of syllable comes twice running when another ticked kind has a question left to
// give that answer -- EXCEPT "plain", which may repeat: it is the bread and butter, and strict alternation would
// make a third of a default game mūta cum liquida (PLAN said "no two of the same kind"; see the P5 report).
// A game is seeded: the same seed asks the same questions.
//
//   pure part  -- selection, points, the game's memory and its end-of-game breakdown (tested with no browser)
//   the mode   -- settings, the projector, the phone
(function () {
  "use strict";

  // ---- what the teacher may tick -------------------------------------------------------------------
  // The setting values are short words (the rules accept nothing else); the bank's own kind names have a
  // hyphen in one case, so each option names its kind.
  const KIND_OPTIONS = [
    ["plain", "Long and short only", "plain"],
    ["qu", "qu", "qu"],
    ["hxz", "h, x, z, letters that count twice", "hxz"],
    ["elision", "Elision", "elision"],
    ["mcl", "Mūta cum liquida", "mcl"],
    ["mclstart", "Consonants at the start of a word", "mcl-start"],
    ["greek", "Greek words", "greek"],
  ];
  const KIND_OF = Object.fromEntries(KIND_OPTIONS.map((o) => [o[0], o[2]]));
  const PASSAGE_OPTIONS = [
    ["aen1", "Aeneid I", "Aeneid I"],
    ["aen4", "Aeneid IV", "Aeneid IV"],
    ["daphne", "Daphne and Apollo", "Daphne and Apollo"],
    ["pyramus", "Pyramus and Thisbe", "Pyramus and Thisbe"],
    ["daedalus", "Daedalus and Icarus", "Daedalus and Icarus"],
    ["cumae", "The Gates of Cumae", "The Gates of Cumae"],
  ];
  const PASSAGE_OF = Object.fromEntries(PASSAGE_OPTIONS.map((o) => [o[0], o[2]]));
  const BANK_URL = "data/meter_questions.json";
  const ANS = ["L", "S", "X"];                       // the tap value is the index into this
  const ANS_WORD = ["Long", "Short", "Elided"];
  const ANS_SYM = ["¯", "˘", "⌒"];
  const SHARE = { L: 0.4, S: 0.4, X: 0.2 };
  const PLAIN_WEIGHT = 4;                            // "plain" is drawn four times as often as each rarer kind

  // ---- pure: selection ----------------------------------------------------------------------------
  // opts: { n, kinds: [kind names], passages: [passage names], rng }. Returns { list, short } where `short`
  // is true if the ticked kinds and passages could not supply n lines.
  function selectQuestions(bank, opts) {
    const rng = opts.rng || Math.random;
    const kinds = new Set(opts.kinds), passages = new Set(opts.passages);
    const pool = bank.questions.filter((q) => kinds.has(q.kind) && passages.has(bank.lines[q.line].passage));
    const byAns = { L: [], S: [], X: [] };
    for (const q of pool) byAns[q.answer].push(q);
    const lines = new Set(pool.map((q) => q.line));
    const n = Math.min(opts.n, lines.size);
    // how many of each answer: the 40/40/20 mix, or half and half without elision
    const wantX = byAns.X.length ? Math.round(n * SHARE.X) : 0;
    const wantL = Math.round((n - wantX) / 2);
    const target = [].concat(Array(wantX).fill("X"), Array(wantL).fill("L"), Array(n - wantX - wantL).fill("S"));
    for (let i = target.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [target[i], target[j]] = [target[j], target[i]]; }
    const used = new Set(), out = [];
    let prevKind = null;
    for (const want of target) {
      let cands = byAns[want].filter((q) => !used.has(q.line));
      if (!cands.length) cands = pool.filter((q) => !used.has(q.line));      // that answer has run out: take any
      if (!cands.length) break;
      let useKinds = [...new Set(cands.map((q) => q.kind))];
      if (useKinds.length > 1 && prevKind !== "plain") useKinds = useKinds.filter((k) => k !== prevKind);
      const weights = useKinds.map((k) => (k === "plain" ? PLAIN_WEIGHT : 1));
      let r = rng() * weights.reduce((a, b) => a + b, 0), kind = useKinds[useKinds.length - 1];
      for (let i = 0; i < useKinds.length; i++) { r -= weights[i]; if (r < 0) { kind = useKinds[i]; break; } }
      const ofKind = cands.filter((q) => q.kind === kind);
      const q = ofKind[Math.min(ofKind.length - 1, Math.floor(rng() * ofKind.length))];
      used.add(q.line); out.push(q); prevKind = q.kind;
    }
    return { list: out, short: out.length < opts.n };
  }

  // ---- pure: points --------------------------------------------------------------------------------
  // dt = ms from the round opening to the tap (server clock), ms = the time allowed
  function points(dt, ms) {
    const left = ms > 0 ? Math.min(1, Math.max(0, 1 - dt / ms)) : 0;
    return Math.round(500 + 500 * left);
  }

  // "<b class="la">s</b> ... <i>x</i>" (the app's own markup) -> [{ t: "s", tag: "b" }, { t: " ... " }, ...]
  // Only those two tags ever appear (the bank's test checks); anything else is shown as plain text.
  function whyParts(html) {
    const out = [], re = /<(b|i)(?: class="la")?>([\s\S]*?)<\/\1>/g;
    let at = 0, m;
    while ((m = re.exec(html)) !== null) {
      if (m.index > at) out.push({ t: html.slice(at, m.index) });
      out.push({ t: m[2], tag: m[1] });
      at = re.lastIndex;
    }
    if (at < html.length) out.push({ t: html.slice(at) });
    return out;
  }
  const whyText = (html) => whyParts(html).map((p) => p.t).join("");
  // the word holding the syllable, with the syllable's letters in brackets: "ar[u]m"
  function wordWithSyllable(bank, q) {
    const text = bank.lines[q.line].text;
    return text.slice(q.word[0], q.span[0]) + "[" + text.slice(q.span[0], q.span[1]) + "]" + text.slice(q.span[1], q.word[1]);
  }

  // ---- pure: the game's memory ---------------------------------------------------------------------
  // opts: { questions, ms, roster fn... } kept small: the host calls open(q, roster) once per question,
  // tap(uid, v, dt) per tap, and close(totals) once.
  function createGame(bank, questions, seconds) {
    const g = {
      bank, questions, ms: seconds * 1000, i: -1, q: null, roster: new Set(), answers: {},
      total: {},                                      // uid -> points so far
      byKind: {},                                     // kind -> { asked, answers, right, none }
      log: [],                                        // one record per question, for the breakdown
    };
    g.open = function (roster) {
      g.i++;
      g.q = g.i < questions.length ? questions[g.i] : null;
      g.roster = new Set(roster);
      g.answers = {};
      return g.q;
    };
    g.tap = function (uid, v, dt, late) {
      if (!g.q || late || !g.roster.has(uid) || g.answers[uid] || !Number.isInteger(v) || v < 0 || v > 2) return false;
      g.answers[uid] = { v, dt };
      return true;
    };
    g.everyoneAnswered = () => g.roster.size > 0 && [...g.roster].every((u) => g.answers[u]);
    // Grade the open question. Returns { right: index, pts: {uid: points won}, counts: [nL, nS, nX] }.
    g.close = function () {
      const q = g.q, right = ANS.indexOf(q.answer), pts = {}, counts = [0, 0, 0];
      let answered = 0, correct = 0;
      for (const u of g.roster) pts[u] = 0;
      for (const [u, a] of Object.entries(g.answers)) {
        counts[a.v]++; answered++;
        if (a.v === right) { pts[u] = points(a.dt, g.ms); g.total[u] = (g.total[u] || 0) + pts[u]; correct++; }
      }
      const k = (g.byKind[q.kind] = g.byKind[q.kind] || { asked: 0, answers: 0, right: 0, none: 0 });
      k.asked++; k.answers += answered; k.right += correct; k.none += g.roster.size - answered;
      g.log.push({ q, answered, right: correct, counts });
      return { right, pts, counts };
    };
    // The whole score table: players by uid, teams (if any) by number, each the AVERAGE of its members.
    g.scores = function (players, teams) {
      const s = {};
      for (const u of players) s[u] = g.total[u] || 0;
      for (const [t, uids] of Object.entries(teams || {})) {
        if (uids.length) s[t] = Math.round(uids.reduce((a, u) => a + (g.total[u] || 0), 0) / uids.length);
      }
      return s;
    };
    // The distribution of this game's questions (for the report and the tests).
    g.mix = function () {
      const kinds = {}, answers = { L: 0, S: 0, X: 0 };
      for (const q of questions) { kinds[q.kind] = (kinds[q.kind] || 0) + 1; answers[q.answer]++; }
      return { n: questions.length, kinds, answers };
    };
    // The breakdown for the end-of-game screen: only this page's memory, nothing per student.
    g.summary = function () {
      const label = (k) => (bank.kinds[k] && bank.kinds[k].label) || k;
      const rows = Object.entries(g.byKind).sort((a, b) => (bank.kinds[a[0]] ? bank.kinds[a[0]].level : 9) - (bank.kinds[b[0]] ? bank.kinds[b[0]].level : 9))
        .map(([k, s]) => [label(k), s.asked, s.answers, s.right, s.answers ? Math.round((100 * s.right) / s.answers) + "%" : "–", s.none]);
      const sections = [{
        title: "How the class did, by kind of syllable",
        note: "“Right” counts answers given; “No answer” counts the times a present player let the clock run out.",
        columns: ["Kind", "Questions", "Answers", "Right", "% right", "No answer"],
        rows,
      }];
      const missed = g.log.filter((r) => r.answered > 0 && r.right < r.answered)
        .sort((a, b) => (b.answered - b.right) / b.answered - (a.answered - a.right) / a.answered || (b.answered - b.right) - (a.answered - a.right))
        .slice(0, 8);
      const sec = { title: "The questions the class missed most" };
      if (!missed.length) sec.note = "Every answer that was given was right.";
      else {
        sec.note = "The syllable asked about is in brackets.";
        sec.columns = ["Line", "Word", "Answer", "Right"];
        sec.rows = missed.map((r) => [r.q.line, wordWithSyllable(bank, r.q), ANS_WORD[ANS.indexOf(r.q.answer)] + " (" + whyTag(r.q) + ")", r.right + " of " + r.answered]);
      }
      sections.push(sec);
      return sections;
    };
    return g;
  }
  const whyTag = (q) => q.tag || q.kind;

  // Everything the projector and the phones may be told once the round has locked.
  function revealFor(bank, q, result) {
    const line = bank.lines[q.line];
    return {
      a: ANS.indexOf(q.answer), c: q.line, tg: q.tag, why: q.why, i: q.i,
      mk: line.marks.join(""), ac: line.accents.map((x) => (x ? "1" : "0")).join(""),
      nu: line.nuclei.map((p) => [p[0], p[1]]), cnt: result.counts, pts: result.pts,
    };
  }
  // The few facts about a question that go out BEFORE the round locks: the line and the boxed letters.
  const publicRound = (bank, q, total) => ({ t: bank.lines[q.line].text, a: q.span[0], b: q.span[1], tot: total });

  const toExport = { selectQuestions, points, whyParts, whyText, wordWithSyllable, createGame, revealFor, publicRound, ANS, ANS_WORD, KIND_OPTIONS, PASSAGE_OPTIONS, KIND_OF, PASSAGE_OF, BANK_URL };
  if (typeof module === "object" && module.exports) module.exports = toExport;
  if (typeof Live === "undefined") return;           // (loaded by a test with no page: only the game rules are wanted)

  // ---- the screens ---------------------------------------------------------------------------------
  const { h, clear, countdown, scoreboard } = Live;
  const asList = (x) => (Array.isArray(x) ? x : x ? Object.values(x) : []);

  let BANK = null;                                    // the teacher's page only; a phone never sets or reads it
  function loadBank() {
    if (BANK) return BANK;
    BANK = fetch(BANK_URL, { cache: "no-cache" }).then((r) => {
      if (!r.ok) throw new Error("Could not load " + BANK_URL);
      return r.json();
    });
    BANK.catch(() => { BANK = null; });
    return BANK;
  }

  // the reason, built from the app's two tags without ever treating the text as HTML
  const whyNodes = (html) => whyParts(html).map((p) => (p.tag === "b" ? h("b", { class: "la", lang: "la" }, p.t) : p.tag === "i" ? h("i", {}, p.t) : p.t));

  // The question: the line with the asked letters boxed, underlined and pointed at (so it needs no colour).
  function questionLine(r) {
    return h("p", { class: "mt-live-line", lang: "la" }, r.t.slice(0, r.a),
      h("span", { class: "mt-live-target", "aria-label": "the syllable asked about" }, r.t.slice(r.a, r.b)), r.t.slice(r.b));
  }
  // The answer: the whole line with every syllable's mark above it. Returns { el, nucs } so the projector can
  // light the syllables as the rhythm plays.
  function scannedLine(text, rv, extraClass) {
    const marks = rv.mk.split(""), nu = asList(rv.nu).map(asList);
    const el = h("p", { class: "mt-live-line mt-live-scanned" + (extraClass ? " " + extraClass : ""), lang: "la" });
    const nucs = [];
    let at = 0;
    nu.forEach(([s, e], i) => {
      if (s > at) el.appendChild(document.createTextNode(text.slice(at, s)));
      const m = marks[i];
      const n = h("span", { class: "mt-live-nuc" + (m === "X" ? " elided" : "") + (i === rv.i ? " target" : "") }, text.slice(s, e),
        h("span", { class: "mt-live-mark", "aria-hidden": "true" }, m === "L" ? ANS_SYM[0] : m === "S" ? ANS_SYM[1] : ANS_SYM[2]));
      el.appendChild(n); nucs.push(n); at = e;
    });
    if (at < text.length) el.appendChild(document.createTextNode(text.slice(at)));
    return { el, nucs };
  }

  // The three answers drawn as shapes, so they sit in the middle of a button whatever the font does with ¯ ˘ ⌒
  const glyph = (v) => h("span", { class: "mt-live-glyph " + ["long", "short", "elide"][v], "aria-hidden": "true" });

  // The drums, once per question when it is revealed and again on the Replay key. On the teacher's page, with
  // the music loaded, live/music.js lays the line over Hustle (stops it on a bar line, drums from that instant,
  // resumes it after); otherwise, or if the music is muted, the line is simply played.
  function playRhythm(ctx) {
    const sc = ctx.mem.scanned;
    if (!sc || typeof Rhythm === "undefined") return;
    Rhythm.stop();
    sc.nucs.forEach((n) => n.classList.remove("beat", "sung"));
    sc.el.classList.add("singing");
    const rv = sc.rv, marks = rv.mk.split(""), accents = rv.ac.split("").map((c) => c === "1");
    const onBeat = (i, len) => {
      sc.nucs.forEach((n, k) => { if (k < i) n.classList.add("sung"); });
      const n = sc.nucs[i];
      if (n) { n.classList.add("beat"); setTimeout(() => n.classList.remove("beat"), len * 900); }
    };
    const onEnd = () => { sc.el.classList.remove("singing"); sc.nucs.forEach((n) => n.classList.remove("beat", "sung")); };
    if (typeof Music !== "undefined" && Music.line(marks, accents, onBeat, onEnd)) return;
    Rhythm.play(marks, onBeat, onEnd, accents);
  }

  const MODE = Live.registerMode({
    id: "meter",
    title: "Longa an brevis?",
    blurb: "One syllable of a real line: long, short or elided? Fast, loud, and the rhythm is played at the end.",
    lateJoin: true,
    autoLock: false,                                  // onTap locks when every player who was dealt in has answered
    teams: { optional: true, sizes: [2, 3, 4], all: false },
    settings: [
      { key: "rounds", label: "Questions", type: "int", options: [10, 20, 30, 40], default: 20 },
      { key: "seconds", label: "Seconds per question", type: "int", options: [6, 8, 12, 20], default: 12 },
      { key: "kinds", label: "Kinds of syllable", type: "flags", options: KIND_OPTIONS.map((o) => [o[0], o[1]]), default: ["plain", "elision", "mcl"] },
      { key: "passages", label: "Passages", type: "flags", options: PASSAGE_OPTIONS.map((o) => [o[0], o[1]]), default: PASSAGE_OPTIONS.map((o) => o[0]) },
    ],
    keys: { r: { label: "Replay rhythm", run: (ctx) => playRhythm(ctx) } },

    // ---- the teacher's page ------------------------------------------------------------------------
    host: {
      lobbyNote(ctx) {
        const s = ctx.settings;
        return s.kinds.length && s.passages.length ? "" : "Tick at least one kind of syllable and one passage (go back and make a new game).";
      },

      async start(ctx) {
        const bank = await loadBank();
        const s = ctx.settings;
        const kinds = s.kinds.map((k) => KIND_OF[k]), passages = s.passages.map((p) => PASSAGE_OF[p]);
        const sel = selectQuestions(bank, { n: s.rounds, kinds: kinds.length ? kinds : ["plain"], passages: passages.length ? passages : PASSAGE_OPTIONS.map((o) => o[2]), rng: ctx.random });
        ctx.mem.g = createGame(bank, sel.list, s.seconds);
        ctx.mem.short = sel.short;
      },

      nextRound(ctx) {
        const g = ctx.mem.g;
        if (typeof Rhythm !== "undefined") Rhythm.stop();
        if (typeof Music !== "undefined") Music.questionOpen();      // the music comes back to full under the new question
        ctx.mem.scanned = null;
        const roster = ctx.players().map((p) => p.uid);
        const q = g.open(roster);
        if (!q) return null;
        const hands = {};
        for (const u of roster) hands[u] = {};
        return { ms: g.ms, round: publicRound(g.bank, q, g.questions.length), hands };
      },

      onTap(ctx, uid, tap) {
        const g = ctx.mem.g;
        g.tap(uid, tap.v, tap.dt, tap.late);
        if (g.everyoneAnswered()) setTimeout(() => ctx.requestLock(), 400);
      },

      lock(ctx) {
        const g = ctx.mem.g, result = g.close();
        const score = g.scores(ctx.players().map((p) => p.uid), ctx.teamsOn ? ctx.teams() : null);
        return { reveal: revealFor(g.bank, g.q, result), score };
      },

      summary(ctx) {
        const g = ctx.mem.g;
        if (!g) return [];
        const sections = g.summary();
        if (ctx.mem.short) sections.push({ title: "A short game", note: "The kinds and passages ticked held fewer lines than the questions asked for, so the game was shorter." });
        return sections;
      },

      renderHost(ctx, el, view) {
        clear(el);
        const g = ctx.mem.g, r = view.round;
        if (!r || !g) { el.appendChild(h("p", { class: "live-big" }, "Get ready…")); return; }
        const revealed = view.reveal && view.reveal.n === r.n;
        const who = ctx.players();
        const tot = r.tot || ctx.settings.rounds;
        const head = h("div", { class: "live-q-head" },
          h("span", { class: "live-q-n" }, "Question " + r.n + " of " + tot),
          r.open ? h("span", { class: "live-clock", "aria-label": "seconds left" }) : null);
        el.appendChild(head);
        if (r.open) countdown(head.querySelector(".live-clock"), r.t0 + r.ms, ctx.now);

        if (!revealed) {
          el.appendChild(h("div", { class: "mt-live-stage" }, questionLine(r),
            h("p", { class: "mt-live-ask" }, "Is the boxed syllable long, short or elided?"),
            h("div", { class: "mt-live-legend" }, ANS_WORD.map((w, i) => h("span", {}, glyph(i), " " + w)))));
          const done = who.filter((p) => view.tapped[p.uid]);
          el.appendChild(h("div", { class: "mt-live-who", "aria-label": done.length + " of " + who.length + " have answered" },
            h("b", { class: "mt-live-count" }, done.length + " of " + who.length + " have answered"),
            h("span", { class: "mt-live-chips" }, who.map((p) => h("span", { class: "mt-live-chip" + (view.tapped[p.uid] ? " on" : ""), lang: "la" }, (view.tapped[p.uid] ? "✓ " : "") + p.name)))));
          return;
        }

        // the reveal: one screen, no scrolling at 1280 x 720
        const rv = view.reveal;
        if (!ctx.mem.scanned || ctx.mem.scanned.n !== r.n) {
          const sc = scannedLine(r.t, rv);
          ctx.mem.scanned = { n: r.n, el: sc.el, nucs: sc.nucs, rv };
          playRhythm(ctx);                            // (the first time only: later redraws keep the same element)
        }
        const cnt = asList(rv.cnt);
        const score = view.score || {};
        const rows = who.map((p) => ({ name: p.name, gloss: "", score: score[p.uid] || 0 }));
        const left = h("div", { class: "mt-live-left" },
          ctx.mem.scanned.el,
          h("p", { class: "mt-live-answer" }, h("b", {}, glyph(rv.a), " " + ANS_WORD[rv.a]), h("span", { class: "mt-live-cite" }, rv.c + " · " + rv.tg)),
          h("p", { class: "mt-live-tally" }, h("b", {}, "The class answered: "), ANS_WORD.map((w, i) => h("span", { class: i === rv.a ? "right" : "" }, (i === rv.a ? "✓ " : "") + w + " " + (cnt[i] || 0)))),
          h("p", { class: "mt-live-why" }, whyNodes(rv.why)));
        const right = h("div", { class: "mt-live-right" }, h("h3", {}, "Top five"), scoreboard(rows, { top: 5 }));
        if (ctx.teamsOn) right.appendChild(scoreboard(Object.keys(ctx.teams()).map((t) => ({ name: "Team " + Live.teamLabel(+t), score: score[t] || 0 })), { top: 4 }));
        el.appendChild(h("div", { class: "mt-live-reveal" }, left, right));
      },
    },

    // ---- the student's phone --------------------------------------------------------------------------
    player: {
      render(ctx, el, view) {
        clear(el);
        const r = view.round;
        if (!r) { el.appendChild(h("p", { class: "live-big" }, "Get ready…")); return; }
        const hand = view.hand && view.hand.n === r.n ? view.hand : null;
        if (!hand) { el.appendChild(h("p", { class: "live-big" }, "Welcome! You’ll play from the next question.")); return; }
        const mine = view.myTaps[0];
        const revealed = view.reveal && view.reveal.n === r.n ? view.reveal : null;
        const head = h("div", { class: "live-q-head" }, h("p", { class: "live-q-n" }, "Question " + r.n + (r.tot ? " of " + r.tot : "")));
        if (r.open && !mine) {
          const clock = h("span", { class: "live-clock", "aria-label": "seconds left" });
          head.appendChild(clock);
        }
        el.appendChild(head);                          // (attached BEFORE the countdown starts: it stops itself on a detached element)
        if (r.open && !mine) countdown(head.querySelector(".live-clock"), r.t0 + r.ms, ctx.now);
        if (revealed) el.appendChild(scannedLine(r.t, revealed, "mt-live-small").el);
        else el.appendChild(questionLine(r));

        const row = h("div", { class: "mt-live-buttons" });
        ANS_WORD.forEach((word, v) => {
          const chosen = mine && mine.v === v;
          const right = revealed && revealed.a === v;
          const wrong = revealed && chosen && !right;
          row.appendChild(h("button", {
            type: "button",
            class: "mt-live-btn" + (chosen ? " chosen" : "") + (right ? " right" : "") + (wrong ? " wrong" : ""),
            disabled: !r.open || !!mine,
            onclick: () => ctx.tap(v),
          }, h("span", { class: "mt-live-sym" }, glyph(v)), h("span", {}, word + (right ? " ✓" : wrong ? " ✗" : ""))));
        });
        el.appendChild(row);

        if (revealed) {
          const got = asPts(revealed.pts)[ctx.uid] || 0;
          el.appendChild(h("p", { class: "live-result " + (got ? "ok" : "bad") }, got ? "✓ Correct! +" + got : mine ? "✗ Not this time" : "No answer"));
          el.appendChild(h("p", { class: "mt-live-why" }, h("b", {}, ANS_WORD[revealed.a] + ". "), whyNodes(revealed.why)));
          el.appendChild(h("p", { class: "live-note" }, "Your points: " + Math.round((view.score || {})[ctx.uid] || 0) +
            (ctx.teamsOn && ctx.team !== null ? " · Team " + Live.teamLabel(ctx.team) + ": " + Math.round((view.score || {})[ctx.team] || 0) : "")));
        } else if (mine) {
          el.appendChild(h("p", { class: "live-note mt-live-locked" }, "Locked in ✓ — waiting for the others…"));
        } else if (!r.open) {
          el.appendChild(h("p", { class: "live-note" }, "Time’s up."));
        }
      },
    },
  });
  const asPts = (x) => x || {};
})();
