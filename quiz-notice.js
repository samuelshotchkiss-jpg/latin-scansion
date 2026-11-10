// Latin Scansion -- a TEMPORARY "on Thursday's quiz?" notice. AGPL-3.0 (see COPYRIGHT.md).
//
// For the Meter & Literary Devices Quiz (Thu 2026-11-12) it tags, quietly:
//   - each kind of line in Practice's checkboxes: on the quiz (levels 1-6) or not (7 Greek, 8 advanced);
//   - each tutorial stage, by the levels its practice set ticks;
//   - the line on screen: one of the lines the quiz could set (data/devices.json -> scansion.lines,
//     written by the toolkit's quiz.py --app-json; never recomputed here), or a kind of line the quiz
//     never sets (Greek, advanced, ambiguous).
//
// Everything is in this one file and this one constant. It hides itself after QUIZ_NOTICE.until.
// To remove it for good: delete this file and its <script> tag in index.html. app.js knows nothing of
// it: it only watches what app.js puts on the page. It saves nothing.
(function () {
  'use strict';

  const QUIZ_NOTICE = {
    until: '2026-11-12',                          // the last day it shows (the student's own date)
    onQuizLevels: [1, 2, 3, 4, 5, 6],             // levels 7 (Greek) and 8 (advanced) are not set
    kindOn: 'on the quiz',
    kindOff: 'not on the quiz',
    lineCould: "This line could be on Thursday's quiz",
    lineWont: "Lines like this won't be on the quiz",
    lineNeutral: null,                            // a quiz kind of line outside the quiz passages: no tag
  };

  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (today > QUIZ_NOTICE.until) return;

  const $ = (id) => document.getElementById(id);
  const onQuiz = (levels) => levels.length > 0 && levels.every((k) => QUIZ_NOTICE.onQuizLevels.includes(k));
  const offQuiz = (levels) => levels.length > 0 && levels.every((k) => !QUIZ_NOTICE.onQuizLevels.includes(k));

  const css = document.createElement('style');
  css.textContent = `
    .qn-tag { display: inline-block; margin-left: .35rem; padding: 0 .45rem; border-radius: 999px;
      font-size: .72rem; line-height: 1.5; font-weight: 500; white-space: nowrap; vertical-align: middle;
      border: 1px solid var(--line); color: var(--muted); background: transparent; }
    .qn-tag.qn-on { border-color: var(--accent); color: var(--accent); }
    .where .qn-tag { margin-left: .5rem; white-space: normal; }
    .lesson-head .qn-tag { margin: 0 auto 0 .2rem; align-self: center; }
  `;
  document.head.appendChild(css);

  const tag = (on, text) => {
    const s = document.createElement('span');
    s.className = `qn-tag ${on ? 'qn-on' : 'qn-off'}`;
    s.textContent = text;
    return s;
  };

  // 1. The kinds of line in Practice: the checkboxes are in the page from the start.
  document.querySelectorAll('#kinds input[value]').forEach((cb) => {
    const k = Number(cb.value);
    const on = QUIZ_NOTICE.onQuizLevels.includes(k);
    cb.parentElement.appendChild(tag(on, on ? QUIZ_NOTICE.kindOn : QUIZ_NOTICE.kindOff));
  });

  // 2 and 3 need the data. Wait until app.js has shown a line (so its files are already in the
  // browser's cache and a second fetch is a quick "not modified"), then load what this file needs.
  const citation = $('citation');
  const title = $('lesson-title');
  if (!citation || !title) return;

  let quizLines = null, levelOf = null, stageLevels = null;

  function tagLine() {
    const old = document.querySelector('.where .qn-tag');
    if (old) old.remove();
    if (!quizLines) return;
    const c = citation.textContent.trim();
    const l = levelOf[c];
    if (!c || !l) return;
    let t = null, on = false;
    if (quizLines.has(c)) { t = QUIZ_NOTICE.lineCould; on = true; }
    else if (l.ambiguous || l.advanced || !QUIZ_NOTICE.onQuizLevels.includes(l.level)) t = QUIZ_NOTICE.lineWont;
    else t = QUIZ_NOTICE.lineNeutral;
    if (t) citation.parentElement.appendChild(tag(on, t));
  }

  function tagStage() {
    const head = title.parentElement;
    const old = head.querySelector('.qn-tag');
    if (old) old.remove();
    if (!stageLevels) return;
    const S = window.Progress && window.Progress.state;
    const levels = S && stageLevels[S.stageId];
    if (!levels) return;              // a stage with no practice set (syllables, two vowels): no tag
    if (onQuiz(levels)) title.after(tag(true, QUIZ_NOTICE.kindOn));
    else if (offQuiz(levels)) title.after(tag(false, QUIZ_NOTICE.kindOff));
  }

  function load() {
    Promise.all([
      fetch('data/devices.json', { cache: 'no-cache' }).then((r) => r.json()),
      fetch('data/lines.json', { cache: 'no-cache' }).then((r) => r.json()),
      fetch('data/tutorial.json', { cache: 'no-cache' }).then((r) => r.json()),
    ]).then(([devices, lines, tutorial]) => {
      quizLines = new Set(Object.keys((devices.scansion && devices.scansion.lines) || {}));
      levelOf = {};
      lines.forEach((l) => { levelOf[l.citation] = l; });
      stageLevels = {};
      (tutorial.stages || []).forEach((s) => { if (s.practice) stageLevels[s.id] = s.practice.levels; });
      tagLine();
      tagStage();
    }).catch(() => {});               // no data, no notice: the app works as ever
  }

  new MutationObserver(tagLine).observe(citation, { childList: true, characterData: true, subtree: true });
  new MutationObserver(tagStage).observe(title, { childList: true, characterData: true, subtree: true });
  if (citation.textContent.trim()) load();
  else new MutationObserver((_, obs) => {
    if (citation.textContent.trim()) { obs.disconnect(); load(); }
  }).observe(citation, { childList: true, characterData: true, subtree: true });
})();
