// quiz.js -- the practice quiz page (quiz.html): a whole practice version of the Meter & Literary Devices
// Quiz, done on screen or printed, with its answer key.
//
// quiz-build.js chooses (by the real quiz's rules, from the same data/devices.json); this file only draws
// it and checks it. The format is the printed quiz's (toolkit renderers/device_quiz_docx.js): Part I a
// triple match -- a letter for each example's definition, then a name from the word bank for each
// definition -- and Part II a few lines to scan.
//
// Like the Devices page, it STORES NOTHING: no localStorage at all, so the scansion page's privacy notice
// stays true. The practice number, the number of devices and the macrons sit in the address instead
// (?no=12345&n=10&plain=1), so a reload, a bookmark or a printout's number brings back the same quiz.
"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const B = window.QuizBuild;
  const SIZES = [5, 8, 10, 12];
  let DATA = null, Q = null, no = 0;

  // a DOM element: el("b", { className: "x" }, "text", child, ...)
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === "className") e.className = v;
      else if (k === "text") e.textContent = v;
      else e.setAttribute(k, v);
    }
    for (const k of kids) if (k != null) e.append(k);
    return e;
  }

  // ---- the address holds the quiz -------------------------------------------------------------------
  function readAddress() {
    const p = new URLSearchParams(location.search);
    const n = Number(p.get("n"));
    $("qz-n").value = String(SIZES.includes(n) ? n : 10);
    $("qz-plain").checked = p.get("plain") === "1";
    const asked = Number(p.get("no"));
    no = B.isNumber(asked) ? asked : B.freshNumber();
  }
  function writeAddress() {
    const p = new URLSearchParams({ no: String(no), n: $("qz-n").value });
    if ($("qz-plain").checked) p.set("plain", "1");
    history.replaceState(null, "", `${location.pathname}?${p}`);
  }

  // ---- Part I ---------------------------------------------------------------------------------------
  // A choice on screen; on paper, what was chosen or a blank line to write on (.qz-pr, print only).
  function picker(label, options, blank, className) {
    const sel = el("select", { "aria-label": label });
    sel.append(el("option", { value: "", text: blank.screen }));
    for (const o of options) sel.append(el("option", { value: o, text: o }));
    const pr = el("span", { className: "qz-pr", "aria-hidden": "true", text: blank.paper });
    sel.addEventListener("change", () => {
      pr.textContent = sel.value || blank.paper;
      wrap.classList.remove("ok", "bad", "empty");           // a changed answer is no longer marked
    });
    const wrap = el("span", { className: `qz-pick ${className}` }, sel, pr);
    return wrap;
  }

  function latinBlock(latin) {
    const box = el("div", { className: "qz-latin", lang: "la" });
    for (const line of latin) {
      const l = el("div", { className: "qz-latin-line" });
      for (const [t, bold] of line) l.append(bold ? el("b", { text: t }) : t);
      box.append(l);
    }
    return box;
  }

  function drawPart1() {
    $("qz-bank").textContent = Q.bank.join("  ·  ");
    const letters = Q.definitions.map((d) => d.letter);
    const exs = $("qz-examples");
    exs.replaceChildren();
    Q.examples.forEach((e, i) => {
      const pick = picker(`Letter of the definition for example ${i + 1}`, letters,
                          { screen: "–", paper: "_____" }, "qz-letterpick");
      pick.dataset.answer = e.letter;
      exs.append(el("li", { className: "qz-ex" },
        el("div", { className: "qz-ex-top" }, pick, el("b", { className: "qz-num", text: `${i + 1}.` }),
           el("span", { className: "qz-cite", text: e.cite })),
        latinBlock(e.latin)));
    });
    const defs = $("qz-defs");
    defs.replaceChildren();
    for (const d of Q.definitions) {
      const pick = picker(`Name for definition ${d.letter}`, Q.bank,
                          { screen: "choose a name", paper: "________________________" }, "qz-namepick");
      pick.dataset.answer = d.name;
      defs.append(el("li", { className: "qz-def" },
        el("div", { className: "qz-def-top" }, el("b", { className: "qz-letter", text: `${d.letter}.` }), pick),
        el("p", { className: "qz-deftext", text: d.definition })));
    }
  }

  function check() {
    const picks = [...document.querySelectorAll("#qz-sheet .qz-pick")];
    let right = { letter: 0, name: 0 }, empty = 0;
    for (const p of picks) {
      const v = p.querySelector("select").value;
      const kind = p.classList.contains("qz-letterpick") ? "letter" : "name";
      p.classList.remove("ok", "bad", "empty");
      if (!v) { p.classList.add("empty"); empty++; continue; }
      const ok = v === p.dataset.answer;
      p.classList.add(ok ? "ok" : "bad");
      if (ok) right[kind]++;
    }
    const n = Q.examples.length, fb = $("qz-feedback");
    fb.replaceChildren();
    if (right.letter === n && right.name === n) {
      fb.append(el("div", {}, el("b", { text: `All ${n} letters and all ${n} names right!` })),
                el("div", { className: "note", text: "Try Part II next, or make a new practice quiz." }));
      return;
    }
    fb.append(el("div", { text: `Letters: ${right.letter} of ${n} right · Names: ${right.name} of ${n} right` }));
    const notes = [];
    if (empty) notes.push(`${empty} still blank (outlined in orange).`);
    if (picks.some((p) => p.classList.contains("bad"))) notes.push("Red ones are wrong: change them and check again, or open the answer key.");
    if (notes.length) fb.append(el("div", { className: "note", text: notes.join(" ") }));
  }

  // ---- Part II --------------------------------------------------------------------------------------
  const text = (s) => ($("qz-plain").checked ? B.plain(s) : s);

  // MARKING ON SCREEN (owner, 2026-11-12: students who practise see how the real quiz would score
  // them). Every vowel is a button; a tap cycles unmarked -> long -> short -> elided -> unmarked. The
  // marks live here, not in the page, so switching the macrons off keeps them. Nothing is stored.
  const SHOW = { "": "", L: "¯", S: "˘", x: "○" };
  const NEXT = { "": "L", L: "S", S: "x", x: "" };
  const SAY = { "": "unmarked", L: "long", S: "short", x: "elided" };
  let marks2 = [];

  function setMark(b, li, vi, m) {
    marks2[li][vi] = m;
    b.dataset.show = SHOW[m];
    b.setAttribute("aria-label", `${b.textContent}: ${SAY[m]}`);
    b.classList.remove("bad");                                 // a changed mark is no longer judged
  }

  function lineText(ln, li) {
    // Each WORD is one unbreakable span: a vowel button is a box of its own, and on a phone the line
    // broke between boxes, in the middle of a word (vīdisti|s).
    const t = text(ln.text), la = el("span", { className: "qz-la", lang: "la" });
    let word = el("span", { className: "qz-w" });
    const put = (s) => {
      for (const [i, part] of s.split(" ").entries()) {
        if (i) { la.append(word, " "); word = el("span", { className: "qz-w" }); }
        if (part) word.append(part);
      }
    };
    let at = 0;
    ln.slots.forEach(([s, e], vi) => {
      put(t.slice(at, s));
      const b = el("button", { type: "button", className: "qz-v" }, t.slice(s, e));
      setMark(b, li, vi, marks2[li][vi]);
      b.addEventListener("click", () => setMark(b, li, vi, NEXT[marks2[li][vi]]));
      word.append(b);
      at = e;
    });
    put(t.slice(at));
    la.append(word);
    return la;
  }

  function drawPart2() {
    const S = Q.scansion;
    $("qz-part2").hidden = !S;
    $("qz-key2-wrap").hidden = !S;
    if (!S) return;
    if (marks2.length !== S.lines.length) marks2 = S.lines.map((ln) => ln.slots.map(() => ""));
    $("qz-scan-cite").textContent = S.cite;
    const box = $("qz-scan");
    box.replaceChildren();
    S.lines.forEach((ln, li) => {
      // "Scan it" opens the line in the scanner (index.html?line=), in ONE other tab however many are
      // opened, so this quiz and its answers stay put.
      const open = el("a", { className: "qz-open no-print", href: `index.html?line=${encodeURIComponent(ln.cite)}`,
                             target: "latin-scansion", text: "Scan it in the app ↗" });
      box.append(el("div", { className: "qz-line" },
        el("span", { className: "qz-ln", text: String(ln.n) }), lineText(ln, li), open));
    });
    $("qz-key2-how").textContent = `${S.cite}: the feet, and every elision.`;
    const key = $("qz-key2");
    key.replaceChildren();
    for (const ln of S.lines) {
      key.append(el("div", { className: "qz-keyline" },
        el("div", {}, el("span", { className: "qz-ln", text: String(ln.n) }),
           el("span", { className: "qz-la", lang: "la", text: text(ln.text) })),
        el("div", { className: "qz-feet", text: ln.feet }),
        ln.elisions.length
          ? el("div", { className: "qz-elis", text: `elision (lost sound in brackets): ${ln.elisions.map(text).join(", ")}` })
          : null));
    }
  }

  // ---- the score, as the real quiz would give it (quiz-score.js) -------------------------------------
  function scoreQuiz() {
    const QS = window.QuizScore, out = $("qz-result");
    const picks = [...document.querySelectorAll("#qz-sheet .qz-pick")];
    const right1 = picks.filter((p) => p.querySelector("select").value === p.dataset.answer).length;
    const pct1 = 100 * right1 / picks.length, lv1 = QS.level(pct1);
    const S = Q.scansion, rules = DATA.scansion.rules;
    const lines = S.lines.map((ln) => ln.slots.map(([, , key, rung, r]) => ({ key, rung, rule: rules[r] })));
    const marks = marks2.map((m) => m.map((c) => c || ".").join(""));
    const r = QS.score(lines, marks);
    // the wrong vowels, in red, to look at again
    document.querySelectorAll("#qz-scan .qz-line").forEach((row, li) => {
      row.querySelectorAll(".qz-v").forEach((b, vi) => {
        const x = lines[li][vi];
        b.classList.toggle("bad", !!x.rung && marks[li][vi] !== x.key);
      });
    });
    const blank = marks.join("").split(".").length - 1;
    const n = (x) => (Math.round(x * 10) / 10).toFixed(1);
    out.replaceChildren(
      el("div", { className: "qz-result-head", text: "How the real quiz would grade this" }),
      el("div", {}, el("b", { text: "Part I: " }),
         `${right1} of ${picks.length} right (${Math.round(pct1)}%) → level ${lv1}`),
      el("div", {}, el("b", { text: "Part II: " }), `meter score ${n(r.score)} → level ${r.level}`));
    const why = r.rows.map((row) => `${row.rule}: ${row.missed}${row.of ? ` of ${row.of}` : ""} missed (−${n(row.cost)})`);
    if (r.breaks) why.push(`lines that do not fit the meter (−${n(r.breakCost)})`);
    if (why.length) out.append(el("ul", { className: "qz-why" }, ...why.map((w) => el("li", { text: w }))));
    out.append(el("div", { className: "qz-total" }, el("b", { text: "Overall: " }),
      `${QS.gradebook(lv1, r.level)}%`, el("span", { className: "note", text: " (each part's level, as the department averages them)" })));
    const notes = [];
    const blank1 = picks.filter((p) => !p.querySelector("select").value).length;
    if (blank1) notes.push(`${blank1} of Part I's ${picks.length} answers ${blank1 === 1 ? "is" : "are"} blank.`);
    if (blank) notes.push(blank === 1 ? "1 vowel is unmarked and counts as wrong."
                                      : `${blank} vowels are unmarked and count as wrong.`);
    if (r.rows.length) notes.push("Wrong vowels are shaded red: change them and score again, or open the answer key.");
    if (notes.length) out.append(el("div", { className: "note", text: notes.join(" ") }));
  }

  // ---- the key --------------------------------------------------------------------------------------
  function drawKey() {
    const body = $("qz-key1");
    body.replaceChildren();
    Q.examples.forEach((e, i) => body.append(el("tr", {},
      el("td", { text: `${i + 1}.` }),
      el("td", { className: "qz-key-letter", text: e.letter }),
      el("td", { className: "qz-key-name", text: e.name }),
      el("td", {}, el("span", { className: "qz-cite", text: e.cite }), " ",
         el("span", { className: "qz-english", text: e.english })))));
  }
  function showKey(open) {
    $("qz-key").hidden = !open;
    $("qz-key-toggle").textContent = open ? "Hide the answer key" : "Show the answer key";
    $("qz-key-toggle").setAttribute("aria-expanded", String(open));
    if (open) $("qz-key").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---- a whole quiz ---------------------------------------------------------------------------------
  function deal() {
    try {
      Q = B.build(DATA, no, Number($("qz-n").value));
    } catch (err) {
      $("qz-error").textContent = `This quiz could not be made: ${err.message}.`;
      $("qz-error").hidden = false;
      return;
    }
    $("qz-error").hidden = true;
    writeAddress();
    $("qz-no").textContent = `Practice quiz no. ${no}`;
    $("qz-key-no").textContent = `Practice quiz no. ${no}`;
    $("qz-feedback").replaceChildren();
    $("qz-result").replaceChildren();
    marks2 = [];                                         // a new quiz starts unmarked
    drawPart1();
    drawPart2();
    drawKey();
    showKey(false);
    $("qz-sheet").hidden = false;
    $("qz-key-row").hidden = false;
  }

  $("qz-new").addEventListener("click", () => {
    no = B.freshNumber();
    deal();
    $("qz-sheet").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("qz-n").addEventListener("change", () => { no = B.freshNumber(); deal(); });
  $("qz-plain").addEventListener("change", () => { writeAddress(); drawPart2(); });
  $("qz-check").addEventListener("click", check);
  $("qz-score").addEventListener("click", scoreQuiz);
  $("qz-key-toggle").addEventListener("click", () => showKey($("qz-key").hidden));
  $("qz-print").addEventListener("click", () => window.print());

  readAddress();
  fetch("data/devices.json", { cache: "no-cache" })
    .then((r) => r.json())
    .then((d) => { DATA = d; deal(); })
    .catch(() => {
      $("qz-error").textContent = "The quiz could not be loaded. Try reloading the page.";
      $("qz-error").hidden = false;
    });
})();
