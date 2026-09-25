// Latin Scansion -- progress, points, badges and the downloadable report. AGPL-3.0 (see COPYRIGHT.md).
//
// Everything here lives in the browser's localStorage and nowhere else. The privacy notice in
// index.html says exactly what is kept; if that list changes, change the notice.
window.Progress = (function () {
  'use strict';

  const KEY = 'latinScansion.v1';
  const APP_URL = 'https://samuelshotchkiss-jpg.github.io/latin-scansion/';

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  const S = read();
  if (!S.version) {                                  // the first release kept only {solved: {cit: true}}
    S.lines = S.lines || {};
    Object.keys(S.solved || {}).forEach((c) => {
      S.lines[c] = { checks: 1, solved: true, firstTry: false, points: 0, solvedAt: null, reveals: 0 };
    });
    delete S.solved;
    S.version = 2;
  }
  S.lines = S.lines || {};
  S.configs = S.configs || {};
  S.days = S.days || {};
  S.streak = S.streak || { current: 0, best: 0 };
  S.badges = S.badges || {};
  S.tutorial = S.tutorial || {};
  S.stagePos = S.stagePos || {};
  S.points = S.points || 0;

  // ---- two tabs, one storage ------------------------------------------------------------------------
  // Every tab holds its own copy of S, and save() writes the whole copy. So a tab left open -- a phone or
  // an iPad keeps them for weeks and brings them back without reloading -- used to overwrite whatever a
  // newer tab had done since (seen 2026-09-24: a stale tab's one save erased two finished stages). Now
  // save() first folds in what is stored, and another tab's save is folded in the moment it happens.
  // Progress only ever grows under a merge; the one thing that shrinks it, Reset, is stamped (resetAt)
  // so that a newer reset wins and an older copy cannot bring back what was erased.
  function merge(o) {
    if (!o || typeof o !== 'object') return;
    const mine = S.resetAt || '', theirs = o.resetAt || '';
    if (theirs > mine) {                             // they reset after we loaded: take theirs whole
      Object.keys(S).forEach((k) => delete S[k]);
      Object.assign(S, o);
      return;
    }
    if (theirs < mine) return;                       // theirs predates our reset
    Object.entries(o.lines || {}).forEach(([c, b]) => {
      const a = S.lines[c];
      if (!a) { S.lines[c] = b; return; }
      // the record of the FIRST solve carries firstTry, points and solvedAt together
      const first = b.solved && (!a.solved || (b.solvedAt || '') < (a.solvedAt || '')) ? b : a;
      S.lines[c] = Object.assign({}, first, {
        checks: Math.max(a.checks || 0, b.checks || 0),
        reveals: Math.max(a.reveals || 0, b.reveals || 0),
        solved: !!(a.solved || b.solved),
      });
    });
    const earliest = (x, y) => (x && y ? (x < y ? x : y) : x || y);
    const latest = (x, y) => (x && y ? (x > y ? x : y) : x || y);
    Object.entries(o.badges || {}).forEach(([k, d]) => { S.badges[k] = earliest(S.badges[k], d); });
    // the LATER finish date: a stage finished again after its lesson was revised stays cleared
    Object.entries(o.tutorial || {}).forEach(([k, d]) => { S.tutorial[k] = latest(S.tutorial[k], d); });
    Object.entries(o.days || {}).forEach(([k, n]) => { S.days[k] = Math.max(S.days[k] || 0, n); });
    Object.entries(o.configs || {}).forEach(([k, n]) => { S.configs[k] = Math.max(S.configs[k] || 0, n); });
    Object.entries(o.stagePos || {}).forEach(([k, c]) => { if (!(k in S.stagePos)) S.stagePos[k] = c; });
    S.streak.best = Math.max(S.streak.best || 0, (o.streak && o.streak.best) || 0);
    if (!S.acknowledged && o.acknowledged) S.acknowledged = o.acknowledged;
    if (!S.name && o.name) S.name = o.name;
    // points come only from solved lines, so the total is recomputed rather than added twice
    S.points = Object.values(S.lines).reduce((n, e) => n + (e.points || 0), 0);
    // what this tab is showing -- mode, stage, levels, passage -- stays this tab's
  }

  let onChange = null;                               // the app's hook: redraw after another tab saved
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || e.newValue === null) return;
    try { merge(JSON.parse(e.newValue)); } catch (err) { return; }
    if (onChange) onChange();
  });

  // Can this browser keep anything at all? Blocked website data or storage turned off says no, and
  // then every save fails silently -- the app says so instead (app.js).
  let storageOK = true;
  try { localStorage.setItem(KEY + '.probe', '1'); localStorage.removeItem(KEY + '.probe'); } catch (e) { storageOK = false; }

  function save() {
    try { merge(JSON.parse(localStorage.getItem(KEY))); } catch (e) { /* nothing stored, or unreadable */ }
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* private mode: nothing is kept */ }
  }
  const today = () => new Date().toISOString().slice(0, 10);

  // ---- fast scanning: the mastery that unlocks it -------------------------------------------------
  // Lines figured out, against every Check ever pressed (wrong ones, and ones after Show answer, too).
  const FAST = { lines: 20, ratio: 0.5 };            // 20 lines, at least one solve per two checks
  function fastStats() {
    const all = Object.values(S.lines);
    const solved = all.filter((e) => e.solved).length;
    const checks = all.reduce((n, e) => n + (e.checks || 0), 0);
    return { solved, checks, ratio: checks ? solved / checks : 0, need: FAST };
  }
  function fastReady() {
    const f = fastStats();
    return f.solved >= FAST.lines && f.ratio >= FAST.ratio;
  }

  // ---- badges ---------------------------------------------------------------------------------------
  // Each test sees the tallies after a line is solved. Order is display order.
  const BADGES = [
    { id: 'first', title: 'First line', desc: 'Scanned your first line correctly.', test: (t) => t.solved >= 1 },
    { id: 'ten', title: 'Ten lines', desc: 'Ten lines figured out.', test: (t) => t.solved >= 10 },
    { id: 'fifty', title: 'Fifty lines', desc: 'Fifty lines figured out.', test: (t) => t.solved >= 50 },
    { id: 'hundred', title: 'A hundred lines', desc: 'A hundred lines — six hundred feet of hexameter.', test: (t) => t.solved >= 100 },
    { id: 'all', title: 'Every line', desc: 'Every line in the app, figured out.', test: (t) => t.solved >= t.total },
    { id: 'streak5', title: 'Five in a row', desc: 'Five lines in a row right on the first try.', test: () => S.streak.best >= 5 },
    { id: 'streak10', title: 'Ten in a row', desc: 'Ten lines in a row right on the first try.', test: () => S.streak.best >= 10 },
    { id: 'qu', title: 'The u in qu', desc: 'Your first line with qu, whose u is not a vowel.', test: (t) => t.flag.qu },
    { id: 'hxz', title: 'h, x, z', desc: 'Your first line where an h, an x or z, or a letter that counts twice decided a syllable.', test: (t) => t.flag.hxz },
    { id: 'elision', title: 'Delicious', desc: 'Your first line with an elision.', test: (t) => t.flag.elision },
    { id: 'muta', title: 'Mūta cum liquida', desc: 'Your first line with a mute and a liquid inside a word.', test: (t) => t.flag.muta },
    { id: 'wordstart', title: 'Next word along', desc: "Your first line decided by the consonants beginning the next word.", test: (t) => t.flag.wordStart },
    { id: 'spondee', title: 'A rare spondee', desc: 'Found a line whose fifth foot is a spondee.', test: (t) => t.flag.spondaic },
    { id: 'greek', title: "It's all Greek", desc: 'Your first line with a Greek-looking word.', test: (t) => t.flag.greek },
    { id: 'licence', title: "Poet's licence", desc: 'Your first line where the poet bends the rules.', test: (t) => t.flag.advanced },
    { id: 'days3', title: 'Three days', desc: 'Practiced on three different days.', test: () => Object.keys(S.days).length >= 3 },
    { id: 'days7', title: 'A week of practice', desc: 'Practiced on seven different days.', test: () => Object.keys(S.days).length >= 7 },
    { id: 'tutorial', title: 'Tutorial complete', desc: 'Worked through every stage of the tutorial.', test: (t) => t.tutorialDone },
    // FAST SCANNING. Its cursor walks from syllable to syllable, which gives away where the syllables are
    // -- so it is earned, not offered: enough lines, and few enough checks per line (owner, 2026-09-24).
    // Unlocking IS this badge, so it keeps its date, survives the two-tab merge and is never taken back.
    { id: 'fast', title: 'Fast scanning', desc: `Unlocked fast scanning: ${FAST.lines} lines figured out, at least one for every ${1 / FAST.ratio} checks.`, test: () => fastReady() },
  ];

  let allLines = [];       // set by the app once the data has loaded
  let stages = [];
  function init(lines, tutorialStages) { allLines = lines; stages = tutorialStages; }

  const solvedCount = () => allLines.filter((l) => S.lines[l.citation] && S.lines[l.citation].solved).length;

  function awardBadges(line) {
    const f = line ? line.flags : [];
    const t = {
      solved: solvedCount(),
      total: allLines.length,
      tutorialDone: stages.length > 0 && stages.every((s) => S.tutorial[s.id]),
      flag: {
        qu: f.includes('qu'),
        hxz: f.includes('h, x, z'),
        elision: f.includes('elision') || f.includes('prodelision'),
        muta: f.includes('muta cum liquida'),                                   // inside a word
        wordStart: f.includes('muta cum liquida at word start') || f.includes('f + liquid at word start'),
        spondaic: f.includes('spondaic fifth foot'),
        greek: f.includes('greekiness'),
        advanced: !!(line && line.advanced),
      },
    };
    const fresh = [];
    BADGES.forEach((b) => {
      if (!S.badges[b.id] && b.test(t)) { S.badges[b.id] = today(); fresh.push(b); }
    });
    // Finishing a passage: every line of it figured out.
    if (line && line.passage && !S.badges['passage:' + line.passage]) {
      const mine = allLines.filter((l) => l.passage === line.passage);
      if (mine.length && mine.every((l) => S.lines[l.citation] && S.lines[l.citation].solved)) {
        S.badges['passage:' + line.passage] = today();
        fresh.push({ title: 'Finished: ' + line.passage, desc: 'Every line of ' + line.passage + ' figured out.' });
      }
    }
    return fresh;
  }

  // ---- recording ------------------------------------------------------------------------------------
  // `helped` is true when the student used Show answer on this line during this visit: a correct Check
  // afterwards earns nothing, and the line waits to be figured out on another visit.
  function recordCheck(line, correct, helped, context) {
    const e = S.lines[line.citation] = S.lines[line.citation] || { checks: 0, solved: false, firstTry: false, points: 0, solvedAt: null, reveals: 0 };
    e.checks++;
    if (context) S.configs[context] = (S.configs[context] || 0) + 1;
    const result = { points: 0, firstTry: false, alreadySolved: e.solved, helped: false, badges: [] };
    if (!correct) {
      S.streak.current = 0;
    } else if (helped) {
      S.streak.current = 0;
      result.helped = true;
    } else if (!e.solved) {
      e.solved = true;
      e.firstTry = e.checks === 1 && !e.reveals;
      e.solvedAt = new Date().toISOString();
      e.points = 10 * (line.level || 1) + (e.firstTry ? 10 : 0);
      S.points += e.points;
      S.days[today()] = (S.days[today()] || 0) + 1;
      S.streak.current = e.firstTry ? S.streak.current + 1 : 0;
      S.streak.best = Math.max(S.streak.best, S.streak.current);
      result.points = e.points;
      result.firstTry = e.firstTry;
      result.badges = awardBadges(line);
    }
    save();
    return result;
  }

  function recordReveal(line) {
    const e = S.lines[line.citation] = S.lines[line.citation] || { checks: 0, solved: false, firstTry: false, points: 0, solvedAt: null, reveals: 0 };
    e.reveals++;
    S.streak.current = 0;
    save();
  }

  // A stage finished BEFORE its lesson was revised (`revised` in tutorial.json) is stale: finishing it
  // again moves the date forward, which clears the app's "new since you finished" marker. The dates are
  // ISO strings, so < compares them; a stage with no `revised` is never stale.
  const isStale = (stage) => !!(stage.revised && S.tutorial[stage.id] && S.tutorial[stage.id] < stage.revised);

  function completeStage(id, stage) {
    if (S.tutorial[id] && !(stage && isStale(stage))) return [];
    S.tutorial[id] = today();
    const fresh = awardBadges(null);
    save();
    return fresh;
  }

  const isSolved = (cit) => !!(S.lines[cit] && S.lines[cit].solved);

  function acknowledge() { S.acknowledged = today(); save(); }

  function reset() {
    Object.keys(S).forEach((k) => { if (k !== 'acknowledged') delete S[k]; });
    Object.assign(S, { version: 2, lines: {}, configs: {}, days: {}, streak: { current: 0, best: 0 }, badges: {}, tutorial: {}, stagePos: {}, points: 0,
      resetAt: new Date().toISOString() });
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* not save(): nothing to merge in */ }
  }

  // ---- the numbers ----------------------------------------------------------------------------------
  function stats() {
    const passages = [...new Set(allLines.map((l) => l.passage))].map((name) => {
      const mine = allLines.filter((l) => l.passage === name);
      return { name, total: mine.length, solved: mine.filter((l) => isSolved(l.citation)).length };
    });
    const solvedLines = allLines.filter((l) => isSolved(l.citation));
    const byLevel = [1, 2, 3, 4, 5, 6, 7, 8].map((lv) => ({
      level: lv,
      total: allLines.filter((l) => l.level === lv).length,
      solved: solvedLines.filter((l) => l.level === lv).length,
    }));
    const badges = BADGES.filter((b) => S.badges[b.id]).map((b) => ({ title: b.title, desc: b.desc, on: S.badges[b.id] }))
      .concat(Object.keys(S.badges).filter((k) => k.startsWith('passage:'))
        .map((k) => ({ title: 'Finished: ' + k.slice(8), desc: 'Every line of ' + k.slice(8) + ' figured out.', on: S.badges[k] })));
    const recent = solvedLines
      .map((l) => ({ line: l, e: S.lines[l.citation] }))
      .filter((x) => x.e.solvedAt)
      .sort((a, b) => b.e.solvedAt.localeCompare(a.e.solvedAt));
    return {
      solved: solvedLines.length,
      total: allLines.length,
      percent: allLines.length ? Math.round(1000 * solvedLines.length / allLines.length) / 10 : 0,
      firstTries: solvedLines.filter((l) => S.lines[l.citation].firstTry).length,
      checks: Object.values(S.lines).reduce((n, e) => n + e.checks, 0),
      points: S.points,
      bestStreak: S.streak.best,
      days: Object.keys(S.days).length,
      passages, byLevel, badges, recent,
      configs: Object.entries(S.configs).sort((a, b) => b[1] - a[1]),
      stages: stages.map((s) => ({ title: s.title, done: S.tutorial[s.id] || null })),
    };
  }

  // ---- the report -----------------------------------------------------------------------------------
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const bar = (n, total) => {
    const pct = total ? Math.round(100 * n / total) : 0;
    return `<div class="bar"><span style="width:${pct}%"></span></div><div class="nums">${n} of ${total} (${pct}%)</div>`;
  };

  function headline(st) {
    if (!st.solved) return 'Just getting started.';
    const feet = st.solved * 6;
    return `${st.solved} line${st.solved === 1 ? '' : 's'} of Ovid and Vergil scanned — that's ${feet} feet of hexameter.`;
  }

  function reportHTML(name) {
    const st = stats();
    const when = new Date();
    const levelNames = ['Long and short only', 'qu', 'h, x, z, letters that count twice', 'Elision', 'Mūta cum liquida', 'Consonants at the start of a word', 'Greek words', 'Advanced'];
    const recent = st.recent.slice(0, 12).map(({ line, e }) =>
      `<tr><td>${esc(line.citation)}</td><td class="latin">${esc(line.text)}</td><td>${e.firstTry ? '★ first try' : e.checks + ' tries'}</td></tr>`).join('');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Scansion report — ${esc(name || 'student')}</title>
<style>
  body { margin: 0; background: #f4f1ea; color: #1d1d1f; font: 16px/1.5 system-ui, "Segoe UI", sans-serif; }
  .page { max-width: 46rem; margin: 2rem auto; background: #fff; border-radius: 14px; padding: 2rem 2.25rem; box-shadow: 0 2px 18px rgba(0,0,0,.08); }
  h1 { margin: 0; font-size: 1.6rem; } .sub { color: #6b6b70; margin: .2rem 0 1.4rem; }
  .who { font-size: 1.25rem; font-weight: 600; }
  .headline { font-size: 1.15rem; margin: 1rem 0 1.5rem; padding: .9rem 1rem; background: #eef3f9; border-radius: 10px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr)); gap: .75rem; margin-bottom: 1.5rem; }
  .stat { border: 1px solid #e3e0d8; border-radius: 10px; padding: .7rem .8rem; }
  .stat b { display: block; font-size: 1.6rem; color: #2f5d8a; } .stat span { color: #6b6b70; font-size: .85rem; }
  h2 { font-size: 1.05rem; margin: 1.6rem 0 .6rem; }
  .row { display: grid; grid-template-columns: 13rem 1fr 9rem; gap: .75rem; align-items: center; margin: .35rem 0; }
  .bar { height: .6rem; background: #ece9e1; border-radius: 99px; overflow: hidden; } .bar span { display: block; height: 100%; background: #2e7d4f; }
  .nums { font-size: .85rem; color: #6b6b70; }
  .badges { display: flex; flex-wrap: wrap; gap: .5rem; } .badge { border: 1px solid #e3e0d8; border-radius: 99px; padding: .3rem .75rem; font-size: .9rem; }
  table { width: 100%; border-collapse: collapse; font-size: .9rem; } td { padding: .35rem .4rem; border-top: 1px solid #eee; vertical-align: top; }
  .latin { font-family: Tahoma, "Noto Sans", sans-serif; }
  ul.stages { list-style: none; padding: 0; margin: 0; } ul.stages li { margin: .15rem 0; }
  .foot { color: #6b6b70; font-size: .8rem; margin-top: 2rem; }
  @media (max-width: 36rem) { .row { grid-template-columns: 1fr; gap: .2rem; } .page { margin: 0; border-radius: 0; } }
</style></head>
<body><div class="page">
  <h1>Latin Scansion — Progress Report</h1>
  <div class="sub">${esc(when.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }))}</div>
  <div class="who">${esc(name || '(no name given)')}</div>
  <div class="headline">${esc(headline(st))}</div>
  <div class="stats">
    <div class="stat"><b>${st.solved}</b><span>lines figured out</span></div>
    <div class="stat"><b>${st.percent}%</b><span>of all ${st.total} lines</span></div>
    <div class="stat"><b>${st.points}</b><span>points</span></div>
    <div class="stat"><b>${st.firstTries}</b><span>right on the first try</span></div>
    <div class="stat"><b>${st.bestStreak}</b><span>best streak</span></div>
    <div class="stat"><b>${st.days}</b><span>day${st.days === 1 ? '' : 's'} of practice</span></div>
  </div>
  <h2>Passages</h2>
  ${st.passages.map((p) => `<div class="row"><div>${esc(p.name)}</div>${bar(p.solved, p.total)}</div>`).join('')}
  <h2>By kind of line</h2>
  ${st.byLevel.map((l) => `<div class="row"><div>${esc(levelNames[l.level - 1])}</div>${bar(l.solved, l.total)}</div>`).join('')}
  <h2>Tutorial</h2>
  <ul class="stages">${st.stages.map((s) => `<li>${s.done ? '✓' : '○'} ${esc(s.title)}</li>`).join('')}</ul>
  <h2>Badges</h2>
  ${st.badges.length ? `<div class="badges">${st.badges.map((b) => `<span class="badge" title="${esc(b.desc)}">★ ${esc(b.title)}</span>`).join('')}</div>` : '<p>None yet.</p>'}
  ${recent ? `<h2>Most recent lines</h2><table>${recent}</table>` : ''}
  <div class="foot">Made by <a href="${APP_URL}">Latin Scansion</a> in the student's own browser, from progress stored only on that computer. ${st.checks} checks in all.</div>
</div></body></html>`;
  }

  function downloadReport(name) {
    const blob = new Blob([reportHTML(name)], { type: 'text/html' });
    const a = document.createElement('a');
    const safe = (name || 'student').replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'student';
    a.href = URL.createObjectURL(blob);
    a.download = `Scansion report - ${safe} - ${today()}.html`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  return { state: S, save, init, storageOK: () => storageOK, onChange: (fn) => { onChange = fn; }, recordCheck, recordReveal, completeStage, isStale, isSolved, acknowledge, reset, stats, downloadReport,
    fastStats, fastUnlocked: () => !!S.badges.fast };
})();
