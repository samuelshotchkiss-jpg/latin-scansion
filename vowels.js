// vowels.js -- the Vowels page: two drills on where vowels meet (owner, 2026-11-12).
//
//   "i: vowel or consonant?"  every i before a vowel: iam, Troia, coniūnx (consonant); omnia,
//                             fīlius, abiit, coiēre, Iāsōn (vowel)
//   "Diphthong or not?"       every two vowels side by side inside a word: de-us, fu-it, om-ni-a
//                             (two syllables) against ae, au, oe, and the few ei/eu/ui (one)
//
// data/vowels.json is built by tools/make_vowel_drills.py from data/lines.json, so every answer is
// the scanner's, the same the Scan page marks. Like the Devices page it STORES NOTHING: the tally
// is this visit's only.
//
// WHAT COMES UP: each drill draws its two answers equally often, and inside each answer, the kinds
// by the weights below -- word-final -ia and the exceptions (the i of eō, names with a vowel i)
// more than their share, and look-alike pairs (de-us, fu-it, ā-ēr, a-it) half of the time a pair
// stays apart. Each kind is a shuffled deck, dealt to the end before it is shuffled again.
"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const DRILLS = {
    i: {
      q: "Is the highlighted <b>i</b> a vowel or a consonant?",
      answers: [["vowel", "Vowel"], ["consonant", "Consonant (j)"]],
      said: { vowel: "a vowel", consonant: "a consonant" },
      weights: {
        consonant: { "i-start": 2, "i-between": 1, "i-prefix": 1 },
        vowel: { "i-final": 4, "i-after": 3, "i-eo": 1, "i-name": 1 },   // only 5 eō forms, 7 names
      },
    },
    diphthong: {
      q: "Are the highlighted vowels <b>one</b> syllable (a diphthong) or <b>two</b>?",
      answers: [["one", "One syllable: a diphthong"], ["two", "Two syllables"]],
      said: { one: "one syllable, a diphthong", two: "two syllables" },
      weights: {
        one: { "d-common": 2, "d-rare": 1 },
        two: { "a-lookalike": 2.5, "a-split": 1, "a-ai": 0.5, "a-other": 4 },
      },
    },
  };
  let DATA = null, drill = "i", item = null, answered = false;
  const decks = {}, tally = { i: [0, 0], diphthong: [0, 0] };
  let last = "";

  const shuffle = (a) => {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const pick = (weights) => {
    const live = Object.entries(weights).filter(([k]) => byKind[drill][k] && byKind[drill][k].length);
    let r = Math.random() * live.reduce((s, [, w]) => s + w, 0);
    for (const [k, w] of live) if ((r -= w) < 0) return k;
    return live[live.length - 1][0];
  };
  const byKind = { i: {}, diphthong: {} };

  function deal() {
    const D = DRILLS[drill];
    const answer = D.answers[Math.random() < 0.5 ? 0 : 1][0];
    const kind = pick(D.weights[answer]);
    const key = `${drill}:${kind}`;
    for (let tries = 0; tries < 5; tries++) {
      if (!decks[key] || !decks[key].length) decks[key] = shuffle(byKind[drill][kind].slice());
      const x = decks[key].pop();
      const word = x.text.slice(x.ws, x.we);
      if (word !== last || tries === 4) { last = word; return x; }
    }
  }

  function show() {
    item = deal();
    answered = false;
    const t = item.text;
    const line = $("vw-line");
    line.replaceChildren(t.slice(0, item.ws));
    const w = document.createElement("b");
    w.className = "vw-word";
    const mark = document.createElement("mark");
    mark.textContent = t.slice(item.ts, item.te);
    w.append(t.slice(item.ws, item.ts), mark, t.slice(item.te, item.we));
    line.append(w, t.slice(item.we));
    $("vw-cite").textContent = item.cite;
    $("vw-scan").href = `index.html?line=${encodeURIComponent(item.cite)}`;
    $("vw-q").innerHTML = DRILLS[drill].q;
    DRILLS[drill].answers.forEach(([val, label], i) => {
      const b = $(`vw-a${i + 1}`);
      b.textContent = label;
      b.dataset.val = val;
      b.disabled = false;
      b.classList.remove("ok", "bad");
    });
    $("vw-feedback").hidden = true;
  }

  function answer(val) {
    if (answered) return;
    answered = true;
    const D = DRILLS[drill], right = val === item.answer;
    tally[drill][0] += right ? 1 : 0;
    tally[drill][1] += 1;
    for (const b of [$("vw-a1"), $("vw-a2")]) {
      b.disabled = true;
      if (b.dataset.val === item.answer) b.classList.add("ok");
      else if (b.dataset.val === val) b.classList.add("bad");
    }
    $("vw-verdict").textContent = right ? "Right!" : `Not quite: it is ${D.said[item.answer]}.`;
    $("vw-verdict").className = `vw-verdict ${right ? "ok" : "bad"}`;
    $("vw-why").textContent = DATA.reasons[item.why];
    $("vw-division").textContent = item.division;
    $("vw-feedback").hidden = false;
    $("vw-next").focus();
    const [r, n] = tally[drill];
    $("vw-tally").textContent = `This drill, this visit: ${r} of ${n} right.`;
  }

  function choose(d) {
    drill = d;
    for (const b of document.querySelectorAll(".vw-tab")) b.setAttribute("aria-selected", String(b.dataset.drill === d));
    history.replaceState(null, "", `${location.pathname}?drill=${d}`);
    const [r, n] = tally[drill];
    $("vw-tally").textContent = n ? `This drill, this visit: ${r} of ${n} right.` : "";
    show();
  }

  $("vw-a1").addEventListener("click", () => answer($("vw-a1").dataset.val));
  $("vw-a2").addEventListener("click", () => answer($("vw-a2").dataset.val));
  $("vw-next").addEventListener("click", show);
  for (const b of document.querySelectorAll(".vw-tab")) b.addEventListener("click", () => choose(b.dataset.drill));
  // keys: 1 and 2 answer, Enter goes on
  document.addEventListener("keydown", (e) => {
    if (!DATA || e.target.closest("a, select, input")) return;
    if (!answered && (e.key === "1" || e.key === "2")) { answer($(`vw-a${e.key}`).dataset.val); e.preventDefault(); }
    else if (answered && e.key === "Enter" && e.target.id !== "vw-next") { show(); e.preventDefault(); }
  });

  fetch("data/vowels.json", { cache: "no-cache" })
    .then((r) => r.json())
    .then((d) => {
      DATA = d;
      for (const name of ["i", "diphthong"]) {
        for (const [cite, ws, we, ts, te, ans, why, division] of d[name]) {
          (byKind[name][why] ||= []).push({ cite, text: d.lines[cite], ws, we, ts, te, answer: ans, why, division });
        }
      }
      const asked = new URLSearchParams(location.search).get("drill");
      choose(asked === "diphthong" ? "diphthong" : "i");
    })
    .catch(() => {
      $("vw-error").textContent = "The drills could not be loaded. Try reloading the page.";
      $("vw-error").hidden = false;
      $("vw-card").hidden = true;
    });
})();
