// Latin Scansion -- the student app. AGPL-3.0 (see COPYRIGHT.md).
//
// The key (data/lines.json) lists every syllable NUCLEUS of a line -- a vowel or diphthong -- with its
// mark: L, S, or elided. Nuclei are internal: the student never sees them marked. Long and short marks
// snap to them. Elision is a swoosh UNDER the line, dropped in the gap between any two syllables; the
// app works out which vowel it removes (see computeJunctions). A nucleus stays open to long and short
// marks until the STUDENT elides it: the app never gives an elision away.
//
// Two modes: TUTORIAL (data/tutorial.json -- a lesson and its lines, stage by stage) and PRACTICE (a
// passage and the skills learned so far). Progress, points, badges and the report are progress.js.
(function () {
  'use strict';

  const P = window.Progress;
  const S = P.state;
  const SYMBOL = { L: '¯', S: '˘' };
  const WORD = { L: 'long', S: 'short', X: 'elided' };
  const TIE = '<span class="tie-sym"></span>';
  const KIND_NAMES = ['Long and short only', 'qu', 'h, x, z, letters that count twice', 'Elision', 'Mūta cum liquida', 'Consonants at the start of a word', 'Greek words', 'Advanced'];
  const EIGHT_STAGES = ['syllables', 'pattern', 'refinements', 'elision', 'muta', 'clusters', 'greek', 'licences'];

  const $ = (id) => document.getElementById(id);
  const lineEl = $('line');
  const zoomEl = $('zoom');   // the zoom-in: a tapped syllable, divided (see the end of the file)

  let lines = [];          // every scannable line, in reading order
  let rows = [];           // every line of every passage, scannable or not, in order
  let rowsByCit = {};
  let lastShown = null;    // the citation shown before this one: a step to a neighbour scrolls
  let byCitation = {};
  let stages = [];         // tutorial stages whose lines all exist
  let examples = {};       // the lessons' worked examples, by citation (data/examples.json)
  let pool = [], index = 0;
  let marks = {}, tieOf = {}, junctions = [];
  let checked = false, revealed = false, helped = false;
  let tool = null, overlay = null;
  let cursor = null;       // FAST SCANNING: the syllable the next key or tap marks (null when off)
  let cameFrom = null;     // where a zoom-in's lesson link was followed from, for the way back

  // Fast scanning's keys: a straight stroke is long, a cup is short, an empty circle is nothing.
  // l, s and e -- the keys a focused vowel always took -- work too.
  const FAST_KEYS = { i: 'L', u: 'S', o: 'X', l: 'L', s: 'S', e: 'X' };
  const fastOn = () => !!S.fast && P.fastUnlocked();

  // ---- startup ------------------------------------------------------------------------------------
  Promise.all([
    // no-cache: ask the server every time whether the key or the tutorial changed (a few bytes when
    // not), so a push reaches students on their next load instead of after the cache expires
    fetch('data/lines.json', { cache: 'no-cache' }).then((r) => r.json()),
    fetch('data/tutorial.json', { cache: 'no-cache' }).then((r) => r.json()).catch(() => ({ stages: [] })),
    fetch('data/examples.json', { cache: 'no-cache' }).then((r) => r.json()).catch(() => []),
  ]).then(([data, tutorial, worked]) => {
    worked.filter((l) => l.scans).forEach((l) => { examples[l.citation] = l; });
    rows = data.filter((l) => l.passage)
      .map((l, i) => ({ ...l, _at: i }))
      .sort((a, b) => (a.passage_order - b.passage_order) || (a._at - b._at));
    lines = rows.filter((l) => l.scans);
    rows.forEach((l) => { rowsByCit[l.citation] = l; });
    lines.forEach((l) => { byCitation[l.citation] = l; });
    stages = (tutorial.stages || []).map((s) => {
      const missing = s.lines.filter((c) => !byCitation[c]);
      if (missing.length) console.warn(`tutorial stage "${s.id}": no such line(s): ${missing.join(', ')}`);
      return { ...s, lines: s.lines.filter((c) => byCitation[c]) };
    }).filter((s) => s.lines.length);
    P.init(lines, stages);

    const names = [...new Set(lines.map((l) => l.passage))];
    $('passage').innerHTML = '<option value="">All passages</option>' +
      names.map((n) => `<option>${escapeHTML(n)}</option>`).join('');
    $('passage').value = names.includes(S.passage) || S.passage === '' ? S.passage : (names[0] || '');
    if (!Array.isArray(S.levels)) {                   // the first release kept "everything up to level N"
      S.levels = Array.from({ length: S.level || 1 }, (_, i) => i + 1);
      delete S.level;
    }
    if (!S.kinds) {                                   // five kinds became six: qu, h, x, z split off level 1
      S.levels = [...new Set(S.levels.flatMap((k) => (k === 1 ? [1, 2] : [k + 1])))];
      S.kinds = 6;
    }
    if (S.kinds === 6) {                              // six became seven: qu and h, x, z split apart
      S.levels = [...new Set(S.levels.flatMap((k) => (k === 1 ? [1] : k === 2 ? [2, 3] : [k + 1])))];
      S.kinds = 7;
    }
    if (S.kinds === 7) {                              // seven became eight: word-initial consonants left muta
      S.levels = [...new Set(S.levels.flatMap((k) => (k < 5 ? [k] : k === 5 ? [5, 6] : [k + 1])))];
      S.kinds = 8;
      delete S.focus;
    }
    // The stage a student is on was kept by NUMBER, until a ninth stage went in fourth (2026-10-26, two
    // vowels side by side). It is kept by id now; a number saved without one counts in the old list.
    if (!S.stageId) S.stageId = EIGHT_STAGES[S.stage || 0] || EIGHT_STAGES[0];
    S.stage = Math.max(0, stages.findIndex((s) => s.id === S.stageId));
    setKinds(S.levels);
    fillStageMenu();
    fillWorkMenu();

    // A "Practice more" link: ?practice=<stage id> opens Practice with that stage's lines.
    const wanted = new URLSearchParams(location.search).get('practice');
    if (wanted) {
      const stage = stages.find((s) => s.id === wanted && s.practice);
      if (stage) usePracticeSet(stage);
      history.replaceState(null, '', location.pathname);
    }

    if (!P.storageOK()) $('no-storage').hidden = false;
    else if (!S.acknowledged) $('privacy').hidden = false;
    P.onChange(() => { updatePoints(); fillStageMenu(); showFastToggle(); });   // another tab saved
    showFastToggle();
    $('autoplay').checked = S.autoplay !== false;          // on unless the student turned it off
    setMode(S.mode || (Object.keys(S.lines).length ? 'practice' : 'tutorial'));
    updatePoints();
  }).catch((err) => {
    console.error(err);
    lineEl.textContent = 'Could not load the lines (data/lines.json).';
  });

  $('acknowledge').addEventListener('click', () => { P.acknowledge(); $('privacy').hidden = true; });

  function escapeHTML(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function current() { return pool[index]; }
  function updatePoints() { $('points-pill').textContent = S.points ? `★ ${S.points}` : ''; }

  // ---- modes --------------------------------------------------------------------------------------
  document.querySelectorAll('.mode[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  function setMode(mode) {
    // a lesson looked up from Practice was a visit: back in Practice, the tutorial stays where it was
    if (mode === 'practice' && cameFrom && cameFrom.mode === 'practice' && S.stage === cameFrom.to) {
      S.stage = cameFrom.stage; S.stageId = cameFrom.stageId;
    }
    if (mode === 'practice') cameFrom = null;
    S.mode = mode; P.save();
    document.querySelectorAll('.mode[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    document.body.classList.toggle('tutorial', mode === 'tutorial');
    $('goto').hidden = mode === 'tutorial';                // Go to and the map belong to Practice
    $('practice-controls').hidden = mode !== 'practice';
    $('tutorial-controls').hidden = mode !== 'tutorial';
    $('lesson').hidden = mode !== 'tutorial';
    if (mode === 'tutorial') openStage(Math.min(S.stage || 0, stages.length - 1), true);
    else rebuildPool(S.citation);
    showLessonBack();
  }

  // Practice: a passage, and the KINDS of line ticked. A kind is a level, not "up to" one: ticking
  // only Elision gives just the elision lines.
  function inSet(l, levels) {
    return levels.includes(l.level);
  }
  function rebuildPool(keepCitation) {
    const passage = $('passage').value;
    pool = lines.filter((l) => (!passage || l.passage === passage) && inSet(l, S.levels));
    const at = pool.findIndex((l) => l.citation === keepCitation);
    index = at >= 0 ? at : Math.max(0, pool.findIndex((l) => !P.isSolved(l.citation)));
    S.passage = passage; P.save();
    showLine();
  }
  function setKinds(levels) {
    kindBoxes().forEach((cb) => { cb.checked = levels.includes(Number(cb.value)); });
    summarizeKinds();
  }
  // On a phone the eight checkboxes fold away behind one line that says what is ticked.
  const kindBoxes = () => [...document.querySelectorAll('#kinds input[value]')];
  function summarizeKinds() {
    const on = kindBoxes().filter((x) => x.checked).map((x) => KIND_NAMES[Number(x.value) - 1]);
    const all = on.length === KIND_NAMES.length;
    $('kinds-summary').textContent = all ? ': all kinds' : on.length ? `: ${on.join(', ')}` : ': nothing ticked';
    $('kinds-all').checked = all;
    $('kinds-all').indeterminate = on.length > 0 && !all;
  }
  $('kinds-toggle').addEventListener('click', () => {
    const open = $('kinds').classList.toggle('open');
    $('kinds-toggle').setAttribute('aria-expanded', String(open));
  });
  function usePracticeSet(stage) {
    S.levels = stage.practice.levels.slice();
    S.passage = '';
    S.citation = null;
    S.mode = 'practice';
    $('passage').value = '';
    setKinds(S.levels);
    P.save();
  }
  $('passage').addEventListener('change', () => rebuildPool());
  kindBoxes().forEach((cb) => cb.addEventListener('change', () => {
    S.levels = kindBoxes().filter((x) => x.checked).map((x) => Number(x.value));
    summarizeKinds();
    rebuildPool(current() && current().citation);
  }));
  $('kinds-all').addEventListener('change', () => {
    S.levels = $('kinds-all').checked ? KIND_NAMES.map((_, i) => i + 1) : [];
    setKinds(S.levels);
    rebuildPool(current() && current().citation);
  });

  // Tutorial: one stage's lesson and lines.
  function fillStageMenu() {
    $('stage').innerHTML = stages.map((s, i) =>
      `<option value="${i}">${P.isStale(s) ? '✱ ' : S.tutorial[s.id] ? '✓ ' : ''}${i + 1}. ${escapeHTML(s.title)}</option>`).join('');
    $('stage').value = String(Math.min(S.stage || 0, Math.max(0, stages.length - 1)));
  }
  $('stage').addEventListener('change', () => openStage(Number($('stage').value)));

  function openStage(k, resume, atEnd) {
    const stage = stages[k];
    if (!stage) return;
    S.stage = k; S.stageId = stage.id; P.save();
    showLessonBack();
    $('stage').value = String(k);
    $('lesson-title').textContent = `Stage ${k + 1} of ${stages.length}: ${stage.title}`;
    let lesson = stage.lesson;
    if (P.isStale(stage) && stage.new) {                  // finished before the lesson grew: say what is new
      lesson = `<p class="whats-new">✱ <b>New since you finished this stage:</b> ${stage.new}</p>` + lesson;
    }
    if (stage.practice) {
      const n = lines.filter((l) => inSet(l, stage.practice.levels)).length;
      lesson += `<p class="practice-more"><a href="?practice=${encodeURIComponent(stage.id)}" data-stage="${k}">Practice more: ${n} lines like these →</a></p>`;
    }
    $('lesson-body').innerHTML = lesson;
    $('lesson-body').hidden = false;
    $('lesson-toggle').textContent = 'Hide lesson';
    buildDemos($('lesson-body'));
    pool = stage.lines.map((c) => byCitation[c]);
    const saved = resume ? S.stagePos[stage.id] : null;
    const at = saved ? pool.findIndex((l) => l.citation === saved) : -1;
    index = atEnd ? pool.length - 1 : at >= 0 ? at : Math.max(0, pool.findIndex((l) => !P.isSolved(l.citation)));
    showLine();
  }
  $('lesson-body').addEventListener('click', (e) => {
    const a = e.target.closest('.practice-more a');
    if (!a) return;
    e.preventDefault();                                   // same page: no reload needed
    usePracticeSet(stages[Number(a.dataset.stage)]);
    setMode('practice');
  });
  $('lesson-toggle').addEventListener('click', () => {
    const body = $('lesson-body');
    body.hidden = !body.hidden;
    $('lesson-toggle').textContent = body.hidden ? 'Show lesson' : 'Hide lesson';
    if (!body.hidden) body.querySelectorAll('.demo.zplay').forEach(fitZoom);   // measured while hidden: 0 wide
  });

  // ---- where a swoosh may go ------------------------------------------------------------------------
  const isLetter = (c) => /\p{L}/u.test(c);

  // EVERY gap between two neighbouring syllables takes a swoosh, however nonsensical (owner,
  // 2026-09-16): restricting it to the gaps where elision is possible would tell the student where
  // to look. The swoosh removes the first of the two vowels -- unless the second begins est or es,
  // when it removes that e (prodelision). One more slot after the last syllable: hypermetry.
  function computeJunctions(l) {
    const chars = [...l.text];
    const n = l.nuclei;
    const out = [];
    for (let k = 0; k + 1 < n.length; k++) {
      let elided = k;
      if (chars.slice(n[k].end, n[k + 1].start).some((c) => !isLetter(c))) {
        let s = n[k + 1].start, e = n[k + 1].start;
        while (s > 0 && isLetter(chars[s - 1])) s--;
        while (e < chars.length && isLetter(chars[e])) e++;
        const next = chars.slice(s, e).join('').toLowerCase();
        if (next === 'est' || next === 'es') elided = k + 1;
      }
      out.push({ p: k, q: k + 1, elided });
    }
    if (n.length) out.push({ p: n.length - 1, q: null, elided: n.length - 1 });
    return out;
  }

  // ---- rendering ----------------------------------------------------------------------------------
  function showLine() {
    marks = {}; tieOf = {}; checked = false; revealed = false; helped = false;
    stopRhythm();
    cursor = fastOn() ? 0 : null;
    $('feedback').innerHTML = ''; closeZoom();
    const l = current();
    if (!l) {
      lineEl.textContent = 'No lines match — tick another kind of line, or choose All passages.';
      $('line-note').hidden = true;
      $('ctx-prev').hidden = $('ctx-next').hidden = true;
      $('citation').textContent = ''; $('position').textContent = '';
      overlay = null; junctions = [];
      return;
    }
    const chars = [...l.text];
    // A line the reading stops in the middle of comes whole (reading_ends: where the reading stops);
    // the rest is grey -- it counts for the meter, but it is not part of the reading.
    const end = l.reading_ends == null ? chars.length : l.reading_ends;
    // (the space after the reading's last word goes on the far side of the dashed rule)
    const stop = end < chars.length ? end + (chars[end] === ' ' ? 1 : 0) : end;
    const RULE = '<span class="reading-end" title="Your reading ends here"></span>';
    const piece = (a, b) => {
      const inside = escapeHTML(chars.slice(a, Math.min(b, end)).join(''));
      const gap = escapeHTML(chars.slice(Math.max(a, end), Math.min(b, stop)).join(''));
      const beyond = escapeHTML(chars.slice(Math.max(a, stop), b).join(''));
      return inside + (a <= end && end < b ? gap + RULE : gap) + (beyond ? `<span class="beyond">${beyond}</span>` : '');
    };
    let html = '', at = 0;
    l.nuclei.forEach((nu, i) => {
      html += piece(at, nu.start);
      html += `<span class="nuc${nu.start >= end ? ' beyond' : ''}" data-i="${i}" tabindex="0">` +
              `${escapeHTML(chars.slice(nu.start, nu.end).join(''))}<span class="mark"></span></span>`;
      at = nu.end;
    });
    html += piece(at, chars.length);
    const note = end < chars.length ? TAIL_NOTE : l.meter === 'half-line' ? halfLineNote(l) : '';
    $('line-note').innerHTML = note;
    $('line-note').hidden = !note;
    lineEl.innerHTML = html + '<span class="line-check" title="You have figured out this line" hidden>✓</span><div class="overlay"></div>';
    overlay = lineEl.querySelector('.overlay');
    junctions = computeJunctions(l);
    const draft = takeDraft(l);
    if (draft) restoreDraft(l, draft);
    $('citation').textContent = l.citation;
    showContext(l);
    slide(l.citation);
    $('goto-msg').innerHTML = '';
    $('goto-work').value = workOf(l.citation);
    setGotoHint();
    updatePosition();
    $('prev').disabled = index === 0;
    $('next').disabled = index >= pool.length - 1;
    $('next-new').disabled = nextNewIndex() < 0;
    tutorialNav();
    if (S.mode === 'tutorial' && stages[S.stage]) S.stagePos[stages[S.stage].id] = l.citation;
    else S.citation = l.citation;
    P.save();
    render();
    if (checked || revealed) showResult(l);
  }

  // ---- a line left unfinished -------------------------------------------------------------------------
  // The line a student is working on is kept for each PLACE -- Practice, and each stage of the tutorial --
  // with its marks and, after a Check, its greens and reds: a look at a lesson and back finds it as it was
  // left. Stepping to another line in the same place lets it go, as Next always has. It lives in S.drafts,
  // so a reload keeps it too. Its nuclei are recorded with it: if the key has been rebuilt since and the
  // line's syllables moved, the draft is dropped rather than put its marks in the wrong places.
  const drafts = () => (S.drafts = S.drafts || {});
  const placeNow = () => (S.mode !== 'tutorial' ? 'practice' : stages[S.stage] ? `stage:${stages[S.stage].id}` : null);
  const nucleiOf = (l) => l.nuclei.map((n) => `${n.start}-${n.end}`).join(',');
  function keepDraft() {
    const l = current(), at = placeNow();
    if (!l || !at) return;
    if (!Object.keys(marks).length && !checked && !revealed && !helped) delete drafts()[at];
    else drafts()[at] = { citation: l.citation, nuclei: nucleiOf(l), marks: { ...marks }, tieOf: { ...tieOf }, checked, revealed, helped };
    P.save();
  }
  function takeDraft(l) {
    const at = placeNow(), d = at && drafts()[at];
    if (!d) return null;
    if (d.citation === l.citation && d.nuclei === nucleiOf(l)) return d;
    delete drafts()[at];                                  // another line here now: the old one goes
    return null;
  }
  function restoreDraft(l, d) {
    Object.entries(d.marks || {}).forEach(([i, m]) => { if (l.nuclei[i] && ['L', 'S', 'X'].includes(m)) marks[i] = m; });
    Object.entries(d.tieOf || {}).forEach(([i, j]) => { if (marks[i] === 'X' && junctions[j]) tieOf[i] = j; });
    checked = !!d.checked; revealed = !!d.revealed; helped = !!d.helped;
    if (cursor != null) {                                 // fast scanning: on at the first syllable not marked
      const k = l.nuclei.findIndex((_, i) => !marks[i]);
      cursor = k < 0 ? l.nuclei.length : k;
    }
  }
  // What a line Checked or answered before shows again: the colours, the dividers, and what was said
  // about it -- not the points or badges, which were given then.
  function showResult(l) {
    if (revealed) {
      $('feedback').innerHTML = revealedHTML(l);
    } else {
      const right = markResults(l);
      const shape = render();
      $('feedback').innerHTML = right === l.nuclei.length
        ? '<div><b>Correct!</b></div>' + spondaicNote(l) + rhythmControls() : wrongHTML(l, right, shape);
    }
    wireRhythm();
  }

  function updatePosition() {
    const solved = pool.filter((x) => P.isSolved(x.citation)).length;
    const what = S.mode === 'tutorial' ? 'Practice line' : 'Line';
    $('position').textContent = `${what} ${index + 1} of ${pool.length} · ${solved} solved`;
    const tut = S.mode === 'tutorial';
    $('position').hidden = tut;
    $('stage-dots').hidden = !tut;
    if (tut) {
      $('stage-dots').innerHTML = `<span class="of">Line ${index + 1} of ${pool.length}</span>` + pool.map((x, k) => {
        const done = P.isSolved(x.citation);
        const label = `Line ${k + 1}${done ? ', figured out' : ''}`;
        return `<button type="button" data-k="${k}" class="${done ? 'done' : ''}${k === index ? ' here' : ''}" title="${label}" aria-label="${label}"></button>`;
      }).join('');
    }
    // figured out: said beside the citation AND shown at the right of the line itself, where the eye is
    const done = !!(current() && P.isSolved(current().citation));
    $('solved-flag').hidden = !done;
    const tick = lineEl.querySelector('.line-check');
    if (tick) tick.hidden = !done;
    $('next-new').disabled = nextNewIndex() < 0;
  }

  // Next new: the next line in the pool not yet figured out, wrapping round to the start; -1 when
  // every other line is done. Next walks every line, solved or not, so a student who did the tutorial
  // first met its lines again, one after another, in Daedalus (a student, 2026-09-28).
  // ---- the tutorial's own row: Back and Next, which cross from stage to stage ---------------------------
  // A stage is a short sequence, and moving on is FREE (owner, 2026-09-30): the student sees what was
  // wrong after every Check, and has Show answer when stuck -- whether to go on is theirs to decide.
  function tutorialNav() {
    if (S.mode !== 'tutorial') return;
    const lastLine = index >= pool.length - 1, lastStage = S.stage >= stages.length - 1;
    $('t-back').disabled = index === 0 && S.stage === 0;
    $('t-back').title = index === 0 && S.stage > 0 ? `Back to stage ${S.stage}` : 'The line before';
    $('t-next').innerHTML = !lastLine ? '<span class="wide">Next </span>→'
      : !lastStage ? '<span class="wide">Next stage </span><span class="narrow">Stage </span>→'
      : '<span class="wide">On to Practice </span><span class="narrow">Practice </span>→';
    $('t-next').title = !lastLine ? 'The next line'
      : !lastStage ? `Stage ${S.stage + 2}: ${stages[S.stage + 1].title}` : 'The tutorial is done: practice on the passages';
    $('t-next').setAttribute('aria-label', $('t-next').title);
  }
  $('t-back').addEventListener('click', () => {
    if (index > 0) { index--; showLine(); } else if (S.stage > 0) openStage(S.stage - 1, false, true);
  });
  $('t-next').addEventListener('click', () => {
    if (index < pool.length - 1) { index++; showLine(); }
    else if (S.stage < stages.length - 1) openStage(S.stage + 1);
    else setMode('practice');
  });
  $('stage-dots').addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (b) { index = Number(b.dataset.k); showLine(); }
  });

  function nextNewIndex() {
    for (let k = 1; k < pool.length; k++) {
      const j = (index + k) % pool.length;
      if (!P.isSolved(pool[j].citation)) return j;
    }
    return -1;
  }
  const inTutorial = (cit) => stages.some((s) => s.lines.includes(cit));

  function nucEls() { return [...lineEl.querySelectorAll('.nuc')]; }

  // ---- the lines around it ----------------------------------------------------------------------------
  const TAIL_NOTE = 'Your reading stops in the middle of this line, at the dashed rule. The <span class="beyond">words in grey italics</span> ' +
    'finish it: they are not part of your reading, but they count for the meter, so scan them too.';
  const NUMBER = ['no', 'one', 'two', 'three', 'four', 'five'];
  function halfLineNote(l) {
    const whole = l.feet.filter((f) => f.length > 1).length;
    const half = l.feet[l.feet.length - 1].length === 1;
    return `Vergil left this line unfinished: it breaks off after ${NUMBER[whole]}${half ? ' and a half' : ''} ` +
      `feet. Scan what is there.`;
  }
  const citeStep = (cit, d) => { const [b, n] = bookLine(cit); return `${workOf(cit)} ${b}.${n + d}`; };
  const neighbour = (l, d) => rowsByCit[citeStep(l.citation, d)] || null;
  const hypermetric = (l) => !!(l && l.flags && l.flags.includes('hypermetry'));

  // A neighbour, faint: its nuclei are spans so a half swoosh can find them. In Practice it is a button
  // that goes there; in the Tutorial it is only to read (a click would leave the lesson).
  function ctxHTML(l, which) {
    const chars = [...l.text];
    let html = '', at = 0;
    (l.nuclei || []).forEach((nu, i) => {
      html += escapeHTML(chars.slice(at, nu.start).join(''));
      html += `<span class="ctx-nuc" data-i="${i}">${escapeHTML(chars.slice(nu.start, nu.end).join(''))}</span>`;
      at = nu.end;
    });
    html += escapeHTML(chars.slice(at).join(''));
    if (which === 'prev') html = `<bdi>${html}</bdi>`;
    const solved = P.isSolved(l.citation);
    const go = S.mode !== 'tutorial';
    const title = `${l.citation}${solved ? ' · figured out' : ''}${go ? ' — go to this line' : ''}`;
    const inner = `<span class="ctx-text" lang="la">${html}</span>` +
      (solved ? '<span class="ctx-check" aria-label="figured out">✓</span>' : '');
    return go
      ? `<button type="button" class="ctx-line" data-go="${escapeHTML(l.citation)}" title="${escapeHTML(title)}" aria-label="${escapeHTML(title)}">${inner}</button>`
      : `<div class="ctx-line" title="${escapeHTML(title)}">${inner}</div>`;
  }
  function showContext(l) {
    [['ctx-prev', -1, 'prev'], ['ctx-next', 1, 'next']].forEach(([id, d, which]) => {
      const n = neighbour(l, d);
      $(id).hidden = !n;
      $(id).innerHTML = n ? ctxHTML(n, which) : '';
    });
  }
  ['ctx-prev', 'ctx-next'].forEach((id) => $(id).addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    const note = goTo(b.dataset.go);
    $('goto-msg').innerHTML = note;
  }));

  // A step to the line just after (or before) in the text scrolls, as if the page moved: the faint line
  // below slides up into the box. Any other jump just appears.
  function slide(cit) {
    const was = lastShown;
    lastShown = cit;
    const box = $('stage-lines');
    box.classList.remove('slide-up', 'slide-down');
    if (!was || was === cit) return;
    const dir = citeStep(was, 1) === cit ? 'slide-up' : citeStep(was, -1) === cit ? 'slide-down' : '';
    if (!dir) return;
    // one step = the distance from the line above to the line (or from the line to the line below)
    const other = dir === 'slide-up' ? $('ctx-prev') : lineEl;
    const step = dir === 'slide-up' ? lineEl.offsetTop - (other.hidden ? 0 : other.offsetTop)
      : $('ctx-next').hidden ? lineEl.offsetHeight : $('ctx-next').offsetTop - lineEl.offsetTop;
    box.style.setProperty('--step', `${Math.max(step, 40)}px`);
    void box.offsetWidth;                                  // restart the animation
    box.classList.add(dir);
  }

  // HYPERMETRY, SPLIT: a swoosh on a line's last vowel trails off open (drawOverlay), and the next line's
  // first vowel gets the other half, unbegun. Drawn on the faint next line as soon as the student marks
  // it; and once a hypermetric line is figured out, its halves show from its neighbours too.
  function halfTie(host, el, side, faint) {
    const hr = host.getBoundingClientRect(), r = el.getBoundingClientRect();
    const mid = r.left + r.width / 2 - hr.left;
    // a leading half stops short of its line's left edge rather than poke out of the box
    const w = side === 'trail' ? r.height * 0.9 : Math.max(6, Math.min(r.height * 0.9, mid - 3));
    const t = document.createElement('span');
    t.className = `tie half-tie ${side}${faint ? ' faint' : ''}`;
    t.style.left = (side === 'trail' ? mid : mid - w) + 'px';
    t.style.width = w + 'px';
    t.style.top = (r.bottom - hr.top - r.height * 0.12) + 'px';
    t.style.height = (r.height * 0.28) + 'px';
    host.appendChild(t);
    return t;
  }
  function drawSplitTies() {
    document.querySelectorAll('.half-tie').forEach((t) => t.remove());
    const l = current();
    if (!l) return;
    const last = l.nuclei.length - 1;
    const below = $('ctx-next').querySelector('.ctx-line');
    const first = below && below.querySelector('.ctx-nuc');
    if (first && marks[last] === 'X') halfTie(below, first, 'lead', false);
    const prev = neighbour(l, -1);
    if (hypermetric(prev) && P.isSolved(prev.citation)) {
      const above = $('ctx-prev').querySelector('.ctx-line');
      const tail = above && [...above.querySelectorAll('.ctx-nuc')].pop();
      if (tail) halfTie(above, tail, 'trail', true);
      const mine = nucEls()[0];
      if (mine && overlay) halfTie(lineEl, mine, 'lead', true);
    }
  }

  function render() {
    nucEls().forEach((el) => {
      const m = marks[el.dataset.i];
      el.classList.toggle('elided', m === 'X');
      el.querySelector('.mark').textContent = m === 'L' || m === 'S' ? SYMBOL[m] : '';
      if (!checked) el.classList.remove('ok', 'bad');
      el.classList.toggle('revealed', revealed);
      el.classList.toggle('cursor', cursor === Number(el.dataset.i) && !checked && !revealed);
    });
    document.body.classList.toggle('fast', fastOn());
    $('hint').hidden = fastOn();
    $('fast-hint').hidden = !fastOn();
    const shape = drawOverlay();
    drawSplitTies();
    return shape;
  }

  // Swooshes under the line, and -- after Check -- foot dividers above it.
  function drawOverlay() {
    if (!overlay) return null;
    overlay.innerHTML = '';
    const lr = lineEl.getBoundingClientRect();
    const els = nucEls();
    const rect = (i) => els[i].getBoundingClientRect();
    const l = current();

    Object.keys(marks).forEach((key) => {
      const i = Number(key);
      if (marks[i] !== 'X') return;
      const j = junctions[tieOf[i]] || junctions.find((jj) => jj.elided === i);
      const a = rect(j ? j.p : i);
      const b = j && j.q != null ? rect(j.q) : null;
      const x1 = a.left + a.width / 2;
      const x2 = b && Math.abs(b.top - a.top) < a.height / 2 ? b.left + b.width / 2 : a.right + a.height * 0.45;
      const tie = document.createElement('span');
      tie.className = j && j.q == null ? 'tie trail' : 'tie';
      tie.dataset.i = i;
      tie.style.left = (x1 - lr.left) + 'px';
      tie.style.width = Math.max(14, x2 - x1) + 'px';
      tie.style.top = (a.bottom - lr.top - a.height * 0.12) + 'px';
      tie.style.height = (a.height * 0.28) + 'px';
      if (checked) tie.classList.add(marks[i] === expected(l.nuclei[i]) ? 'ok' : 'bad');
      if (revealed) tie.classList.add('revealed');
      overlay.appendChild(tie);
    });

    if (!(checked || revealed)) return null;
    // The student's own marks, grouped into feet in order: ¯ ¯ is a spondee, ¯ ˘ ˘ a dactyl.
    // A half-line (Aen. 4.361) has as many feet as its key, the last perhaps a lone long syllable.
    const seq = l.nuclei.map((_, i) => i).filter((i) => marks[i] !== 'X');
    const half = l.meter === 'half-line';
    const want = half ? l.feet.length : 6;
    let p = 0, feet = 0;
    const breaks = [];
    while (p < seq.length && feet < want) {
      const m0 = marks[seq[p]], m1 = marks[seq[p + 1]], m2 = marks[seq[p + 2]];
      let size = 0;
      if (m0 === 'L' && m1 === 'L') size = 2;
      else if (m0 === 'L' && m1 === 'S' && m2 === 'S') size = 3;
      else if (half && m0 === 'L' && p === seq.length - 1) size = 1;
      if (!size) break;
      p += size; feet++;
      if (feet < want && p < seq.length) breaks.push([seq[p - 1], seq[p]]);
    }
    breaks.forEach(([a, b]) => {
      const ra = rect(a), rb = rect(b);
      const x = Math.abs(rb.top - ra.top) < ra.height / 2 ? (ra.right + rb.left) / 2 : ra.right + 3;
      const bar = document.createElement('span');
      bar.className = 'bar';
      bar.style.left = (x - lr.left) + 'px';
      bar.style.top = (ra.top - lr.top - ra.height * 0.62) + 'px';
      bar.style.height = (ra.height * 0.7) + 'px';
      overlay.appendChild(bar);
    });
    return { feet, complete: feet === want && p === seq.length };
  }
  window.addEventListener('resize', () => { drawOverlay(); drawSplitTies(); });

  // ---- placing marks ------------------------------------------------------------------------------
  function place(i, mark, from, j) {
    if (from != null && from !== i) { delete marks[from]; delete tieOf[from]; }
    if (mark !== 'X' && marks[i] === 'X') return false;   // an elided vowel takes no long or short mark
    marks[i] = mark;                                       // a swoosh returns any long/short mark to the tray
    if (mark === 'X') tieOf[i] = j != null ? j : junctions.findIndex((jj) => jj.elided === i);
    else delete tieOf[i];
    edited();
    return true;
  }
  function removeMark(i) { delete marks[i]; delete tieOf[i]; edited(); }
  function edited() {
    stopRhythm();
    if (checked || revealed) {
      checked = false; revealed = false;
      $('feedback').innerHTML = ''; closeZoom();
    }
    render();
    keepDraft();
  }

  // Where a drop at (x, y) lands: a nucleus for long/short, a junction for the swoosh. {i, j} or null.
  function targetAt(x, y, mark) {
    const els = nucEls();
    if (mark === 'X') {
      let best = null, bestDx = Infinity;
      junctions.forEach((jj, k) => {
        const a = els[jj.p].getBoundingClientRect();
        const b = jj.q != null ? els[jj.q].getBoundingClientRect() : null;
        const sameRow = b && Math.abs(b.top - a.top) < a.height / 2;
        const ax = sameRow ? (a.right + b.left) / 2 : a.right + 8;
        if (y < a.top - a.height * 0.6 || y > a.bottom + a.height * 0.8) return;
        const dx = Math.abs(x - ax);
        if (dx < bestDx && dx <= Math.max(30, a.width * 1.5)) { best = { i: jj.elided, j: k }; bestDx = dx; }
      });
      return best;
    }
    let best = null, bestDx = Infinity, blocked = false;
    els.forEach((el) => {
      const i = Number(el.dataset.i);
      const r = el.getBoundingClientRect();
      if (y < r.top - r.height * 1.1 || y > r.bottom + r.height * 0.35) return;
      if (marks[i] === 'X') {                              // squarely on an elided vowel: no snap
        if (x >= r.left - 4 && x <= r.right + 4) blocked = true;
        return;
      }
      const dx = Math.abs(x - (r.left + r.width / 2));
      if (dx < bestDx && dx <= Math.max(28, r.width)) { best = { i }; bestDx = dx; }
    });
    return blocked ? null : best;
  }

  // ---- dragging -----------------------------------------------------------------------------------
  let drag = null;
  function startDrag(e, mark, from) {
    e.preventDefault();
    drag = { mark, from, x0: e.clientX, y0: e.clientY, moved: false, ghost: null, key: '', t: null };
  }
  function highlight(t) {
    nucEls().forEach((el) => el.classList.remove('target'));
    document.querySelectorAll('#line .slot, #ctx-next .slot').forEach((s) => s.remove());
    if (!t || !drag) return;
    if (drag.mark !== 'X') { nucEls()[t.i].classList.add('target'); return; }
    const jj = junctions[t.j];
    const lr = lineEl.getBoundingClientRect();
    const a = nucEls()[jj.p].getBoundingClientRect();
    const b = jj.q != null ? nucEls()[jj.q].getBoundingClientRect() : null;
    const x1 = a.left + a.width / 2;
    const x2 = b && Math.abs(b.top - a.top) < a.height / 2 ? b.left + b.width / 2 : a.right + a.height * 0.45;
    const slot = document.createElement('span');
    slot.className = jj.q == null ? 'tie slot trail' : 'tie slot';   // over a last vowel: the open, trailing half
    slot.style.left = (x1 - lr.left) + 'px';
    slot.style.width = Math.max(14, x2 - x1) + 'px';
    slot.style.top = (a.bottom - lr.top - a.height * 0.12) + 'px';
    slot.style.height = (a.height * 0.28) + 'px';
    overlay.appendChild(slot);
    // over a last vowel, the next line previews its unbegun half too
    const below = jj.q == null && $('ctx-next').querySelector('.ctx-line');
    const first = below && below.querySelector('.ctx-nuc');
    if (first) halfTie(below, first, 'lead', false).classList.add('slot');
  }
  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'ghost';
      drag.ghost.innerHTML = drag.mark === 'X' ? TIE : SYMBOL[drag.mark];
      document.body.appendChild(drag.ghost);
    }
    drag.ghost.style.left = e.clientX + 'px';
    drag.ghost.style.top = e.clientY + 'px';
    const t = targetAt(e.clientX, e.clientY, drag.mark);
    const key = t ? `${t.i}/${t.j}` : '';
    if (key !== drag.key) { drag.key = key; drag.t = t; highlight(t); }
  });
  document.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag;
    highlight(null);
    drag = null;
    if (d.ghost) d.ghost.remove();
    if (!d.moved) {
      if (d.from == null) { if (fastOn()) fastMark(d.mark); else selectTool(d.mark); }
      else showReason(d.from);
      return;
    }
    if (d.t) place(d.t.i, d.mark, d.from, d.t.j);
    else if (d.from != null) removeMark(d.from);           // dragged off the line: back to the tray
  });

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('pointerdown', (e) => startDrag(e, chip.dataset.mark, null));
    chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();                               // not the fast-scanning Enter (= Check)
        if (fastOn()) fastMark(chip.dataset.mark); else selectTool(chip.dataset.mark);
      }
    });
  });

  lineEl.addEventListener('pointerdown', (e) => {
    const tie = e.target.closest('.tie:not(.slot)');
    if (tie) { startDrag(e, 'X', Number(tie.dataset.i)); return; }
    const markEl = e.target.closest('.mark');
    if (markEl && markEl.textContent) startDrag(e, marks[markEl.parentElement.dataset.i], Number(markEl.parentElement.dataset.i));
  });
  lineEl.addEventListener('click', (e) => {
    if (e.target.closest('.mark') || e.target.closest('.tie')) return;
    const el = e.target.closest('.nuc');
    if (el) { tapNucleus(Number(el.dataset.i)); return; }
    // A fingertip is wider than a vowel: a tap that lands between letters takes the nearest one.
    if (checked || revealed) return;
    if (fastOn()) {
      const t = targetAt(e.clientX, e.clientY, 'L');
      if (t) { cursor = t.i; render(); }
      return;
    }
    if (!tool) return;
    const t = targetAt(e.clientX, e.clientY, tool);
    if (!t) return;
    if (tool !== 'X') applyTool(t.i, tool);
    else if (marks[t.i] === 'X') removeMark(t.i);
    else place(t.i, 'X', null, t.j);
  });
  lineEl.addEventListener('keydown', (e) => {
    const el = e.target.closest('.nuc');
    if (!el || fastOn()) return;                         // fast scanning has its own keys (below)
    const i = Number(el.dataset.i);
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tapNucleus(i); }
    else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); if (marks[i]) removeMark(i); }
    else {
      const k = { l: 'L', s: 'S', e: 'X' }[e.key.toLowerCase()];
      if (k) { e.preventDefault(); applyTool(i, k); }
    }
  });

  function selectTool(mark) {
    tool = tool === mark ? null : mark;
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('selected', c.dataset.mark === tool));
  }
  function tapNucleus(i) {
    if (fastOn()) {                                      // fast scanning: a tap moves the highlight
      if (checked || revealed) showReason(i); else { cursor = i; render(); }
      return;
    }
    if (tool) applyTool(i, tool);
    else if (checked || revealed) showReason(i);
  }

  // ---- fast scanning ---------------------------------------------------------------------------------
  // Mark the highlighted syllable and move on. The swoosh goes in the gap that elides THIS vowel; the one
  // vowel no gap elides -- before est or es, whose gap removes the e instead -- takes no swoosh.
  function fastMark(mark) {
    const l = current();
    if (!l || cursor == null || cursor >= l.nuclei.length) return;
    const i = cursor;
    if (mark === 'X') {
      const k = junctions.findIndex((jj) => jj.elided === i);
      if (k < 0) return;
      cursor = i + 1;
      if (marks[i] === 'X') render(); else place(i, 'X', null, k);
    } else {
      cursor = i + 1;
      if (marks[i] === 'X') { delete marks[i]; delete tieOf[i]; }
      place(i, mark, null);
    }
  }
  document.addEventListener('keydown', (e) => {
    if (!fastOn() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, select, textarea')) return;
    if (document.querySelector('.modal:not([hidden])')) return;
    const l = current();
    if (!l) return;
    const n = l.nuclei.length;
    if (cursor == null) cursor = 0;
    const mark = FAST_KEYS[e.key.toLowerCase()];
    if (mark) { e.preventDefault(); fastMark(mark); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); cursor = Math.min(n, cursor + 1); render(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); cursor = Math.max(0, cursor - 1); render(); }
    else if (e.key === 'Backspace') {
      e.preventDefault();
      if (cursor > 0 && (cursor >= n || !marks[cursor])) cursor--;
      if (marks[cursor]) removeMark(cursor); else render();
    } else if (e.key === 'Enter' && (hasUncheckedMarks() || !(e.target.closest && e.target.closest('button')))) {
      e.preventDefault();
      $('check').click();
    }
  });
  // ENTER CHECKS a line that has marks not yet checked, whatever has the focus. A button keeps the
  // focus after a click, so a student who clicked Next, typed marks and pressed Enter pressed NEXT --
  // and lost the marks (a student, 2026-09-30). Only with nothing to check does Enter press a button.
  const hasUncheckedMarks = () => Object.keys(marks).length > 0 && !checked && !revealed;
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || fastOn() || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, select, textarea, .chip')) return;
    if (document.querySelector('.modal:not([hidden])') || !hasUncheckedMarks()) return;
    e.preventDefault();
    $('check').click();
  });
  function showFastToggle() {
    $('fast-toggle').hidden = !P.fastUnlocked();
    $('fast').checked = fastOn();
  }
  $('fast').addEventListener('change', () => {
    S.fast = $('fast').checked;
    P.save();
    const l = current();
    cursor = fastOn() && l ? Math.max(0, l.nuclei.findIndex((_, i) => !marks[i])) : null;
    if (fastOn() && l && l.nuclei.every((_, i) => marks[i])) cursor = l.nuclei.length;
    if (fastOn()) selectTool(null);
    render();
  });
  $('fast-on').addEventListener('click', () => {
    $('fast-unlocked').hidden = true;
    $('fast').checked = true;
    $('fast').dispatchEvent(new Event('change'));
  });
  $('fast-later').addEventListener('click', () => { $('fast-unlocked').hidden = true; });
  function celebrateFast() {
    const f = P.fastStats();
    $('fast-why').innerHTML = `Your last <b>${f.recent}</b> lines took only ` +
      `<b>${f.perLine.toFixed(1)}</b> checks each, on average.`;
    showFastToggle();
    $('fast-unlocked').hidden = false;
  }
  // Tap-to-place. For the swoosh, a tapped vowel names its junction: the one that elides it, else
  // the one it borders.
  function applyTool(i, mark) {
    if (mark !== 'X') {
      if (marks[i] === mark) removeMark(i); else place(i, mark, null);
      return;
    }
    let k = junctions.findIndex((jj) => jj.elided === i);
    if (k < 0) k = junctions.findIndex((jj) => jj.p === i || jj.q === i);
    if (k < 0) return;
    const e = junctions[k].elided;
    if (marks[e] === 'X') removeMark(e); else place(e, 'X', null, k);
  }

  // ---- checking -----------------------------------------------------------------------------------
  function expected(n) { return n.mark === 'L' || n.mark === 'S' ? n.mark : 'X'; }

  // Green or red on each long and short mark (drawOverlay colours the swooshes); how many marks are right.
  function markResults(l) {
    let right = 0;
    nucEls().forEach((el) => {
      const i = Number(el.dataset.i);
      const want = expected(l.nuclei[i]);
      el.classList.remove('ok', 'bad');
      if (marks[i] === want) right++;
      if (marks[i] === 'L' || marks[i] === 'S') el.classList.add(marks[i] === want ? 'ok' : 'bad');
    });
    return right;
  }
  function wrongHTML(l, right, shape) {
    const total = l.nuclei.length;
    const unmarked = l.nuclei.filter((n, i) => !marks[i]).length;
    let html = `${right} of ${total} right.`;
    if (unmarked) html += ` ${unmarked} syllable${unmarked === 1 ? ' has' : 's have'} no mark.`;
    if (shape && !shape.complete) html += ` <span class="note">Your marks don’t divide into ${l.meter === 'half-line' ? 'feet' : 'six feet'} yet — see where the dividers stop.</span>`;
    return html + ' <span class="note">Tap any syllable to see why.</span>';
  }
  const revealedHTML = (l) => spondaicNote(l) + '<div class="note">Tap any syllable to see why.</div>' + rhythmControls();

  $('check').addEventListener('click', () => {
    const l = current(); if (!l) return;
    const right = markResults(l);
    checked = true; revealed = false;
    keepDraft();
    const shape = render();
    const total = l.nuclei.length;
    const correct = right === total;
    const context = S.mode === 'tutorial' ? `Tutorial: ${stages[S.stage].title}`
      : `${$('passage').value || 'All passages'} · ${S.levels.map((k) => KIND_NAMES[k - 1]).join(' + ')}`;
    const result = P.recordCheck(l, correct, helped, context);

    let html;
    if (correct) {
      html = '<div><b>Correct!</b>';
      if (result.points) html += ` <span class="gain">+${result.points} points${result.firstTry ? ' — first try!' : ''}</span>`;
      else if (result.helped) html += ' <span class="note">You used Show answer on this line — try it again on your own another time to count it.</span>';
      else if (result.alreadySolved) {
        // in Practice, say so when the line is one the tutorial already had them scan
        const where = S.mode === 'practice' && inTutorial(l.citation) ? ' — it’s one of the tutorial’s lines' : '';
        html += ` <span class="note">You’ve already figured this one out${where}, so it earns no new points.` +
          (nextNewIndex() >= 0 ? ' <b>Next new</b> skips to a line you haven’t done.' : '') + '</span>';
      }
      html += '</div>' + spondaicNote(l);
    } else {
      html = wrongHTML(l, right, shape);
    }
    let badges = result.badges;
    if (correct && S.mode === 'tutorial') {
      const stage = stages[S.stage];
      if (stage.lines.every((c) => P.isSolved(c))) {
        badges = badges.concat(P.completeStage(stage.id, stage));
        fillStageMenu();
        html += `<div class="stage-done"><b>Stage ${S.stage + 1} complete!</b>` +
          (S.stage + 1 < stages.length
            ? ` <button type="button" class="primary" id="next-stage">On to stage ${S.stage + 2}: ${escapeHTML(stages[S.stage + 1].title)} →</button>`
            : ' That was the last stage — head to <b>Practice</b> to keep going.') + '</div>';
      }
    }
    html += badges.map((b) => `<span class="new-badge" title="${escapeHTML(b.desc)}">★ New badge: ${escapeHTML(b.title)}</span>`).join('');
    if (correct) html += rhythmControls();
    $('feedback').innerHTML = html;
    const nextStage = $('next-stage');
    if (nextStage) nextStage.addEventListener('click', () => openStage(S.stage + 1));
    closeZoom();
    updatePosition();
    updatePoints();
    if (result.points) {
      const tick = lineEl.querySelector('.line-check');
      if (tick) tick.classList.add('fresh');
    }
    if (correct) {
      wireRhythm();
      if (S.autoplay !== false) playRhythm();
    }
    if (badges.some((b) => b.id === 'fast')) celebrateFast();
  });

  // ---- the rhythm: DUM-di-di, DUM-dum, singalong style ------------------------------------------------
  // Played from the ANSWER KEY's marks, so it is the line's true rhythm; each syllable and its mark light
  // up as its drum sounds. Offered on a correct Check (and played by itself, unless the student turned
  // that off) and after Show answer.
  const TOUCH = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  function rhythmControls() {
    if (!window.Rhythm) return '';
    return '<div class="rhythm-row"><button type="button" id="play-rhythm" class="rhythm-btn">▶ Hear the rhythm</button>' +
      (TOUCH ? '<div class="note">No sound? Check the volume, and your phone’s silent switch.</div>' : '') + '</div>';
  }
  function wireRhythm() {
    const b = $('play-rhythm');
    if (b) b.addEventListener('click', playRhythm);
  }
  $('autoplay').addEventListener('change', () => {
    S.autoplay = $('autoplay').checked;
    P.save();
    if (!S.autoplay) stopRhythm();                       // turning it off mid-line silences it now
  });
  function playRhythm() {
    const l = current();
    if (!l || !window.Rhythm) return;
    const els = nucEls();
    stopRhythm();
    lineEl.classList.add('singing');
    const b = $('play-rhythm');
    if (b) b.textContent = '♪ Playing…';
    window.Rhythm.play(l.nuclei.map(expected), (i, len) => {
      els.forEach((el, k) => { if (k < i) el.classList.add('sung'); });
      const el = els[i];
      el.classList.add('beat');
      setTimeout(() => el.classList.remove('beat'), len * 900);
    }, stopRhythm, l.nuclei.map((n) => !!n.accent));
  }
  function stopRhythm() {
    if (window.Rhythm) window.Rhythm.stop();
    lineEl.classList.remove('singing');
    nucEls().forEach((el) => el.classList.remove('beat', 'sung'));
    const b = $('play-rhythm');
    if (b) b.textContent = '▶ Hear the rhythm';
  }

  $('reveal').addEventListener('click', () => {
    const l = current(); if (!l) return;
    marks = {}; tieOf = {};
    l.nuclei.forEach((n, i) => {
      marks[i] = expected(n);
      if (marks[i] === 'X') tieOf[i] = junctions.findIndex((jj) => jj.elided === i);
    });
    revealed = true; checked = false; helped = true;
    P.recordReveal(l);
    keepDraft();
    nucEls().forEach((el) => el.classList.remove('ok', 'bad'));
    render();
    $('feedback').innerHTML = revealedHTML(l);
    wireRhythm();
    closeZoom();
  });

  $('clear').addEventListener('click', () => { marks = {}; tieOf = {}; edited(); });
  $('prev').addEventListener('click', () => { if (index > 0) { index--; showLine(); } });
  $('next').addEventListener('click', () => { if (index < pool.length - 1) { index++; showLine(); } });
  $('next-new').addEventListener('click', () => { const j = nextNewIndex(); if (j >= 0) { index = j; showLine(); } });

  // ---- Go to a line --------------------------------------------------------------------------------
  // The work comes from a menu, so nobody has to type "Met." or "Aen."; the student types only the book
  // and the line, in whatever way comes naturally: 4.620, 4 620, 4,620, 4:620.
  const WORK_NAMES = { 'Met.': 'Metamorphoses', 'Aen.': 'Aeneid', 'Her.': 'Heroides' };
  const workOf = (cit) => cit.split(' ')[0];
  const bookLine = (cit) => cit.split(' ')[1].split('.').map(Number);          // 'Aen. 4.620' -> [4, 620]
  const workName = (w) => WORK_NAMES[w] || w;
  // Lines our text leaves out ON PURPOSE, inside a passage: not a gap in the selection, so the map keeps
  // the passage whole and marks the line (owner, 2026-09-29: Met. 1.545 is judged spurious).
  const OMITTED = { 'Met. 1.545': 'left out of our text as spurious' };
  function fillWorkMenu() {
    const works = [...new Set(rows.map((l) => workOf(l.citation)))];
    $('goto-work').innerHTML = works.map((w) => `<option value="${escapeHTML(w)}">${escapeHTML(workName(w))}</option>`).join('');
    setGotoHint();
  }
  function setGotoHint() {
    const w = $('goto-work').value;
    const ex = lines.find((l) => workOf(l.citation) === w);
    $('goto-line').placeholder = ex ? `e.g. ${ex.citation.split(' ')[1]}` : 'book.line';
  }
  $('goto-work').addEventListener('change', setGotoHint);

  // Show a line in Practice, whatever the student was doing. Its passage is chosen (unless All passages
  // is), and its kind ticked if it was not: the student asked for THIS line. Returns what changed.
  function goTo(cit) {
    const l = byCitation[cit];
    if (!l) return '';
    let note = '';
    if (!S.levels.includes(l.level)) {
      S.levels = [...S.levels, l.level].sort((a, b) => a - b);
      setKinds(S.levels);
      note = `“${KIND_NAMES[l.level - 1]}” is ticked now, so this line can show.`;
    }
    if ($('passage').value && $('passage').value !== l.passage) $('passage').value = l.passage;
    S.citation = cit;
    if (S.mode !== 'practice') setMode('practice'); else rebuildPool(cit);
    return note;
  }

  // "54–89, 165–197": the stretches of one book that are in the app
  function ranges(nums) {
    const out = [];
    nums.forEach((n) => {
      const r = out[out.length - 1];
      if (r && n === r[1] + 1) r[1] = n; else out.push([n, n]);
    });
    return out.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');
  }
  function goButton(cit) {
    return `<button type="button" class="link" data-go="${escapeHTML(cit)}">${escapeHTML(cit)}</button>`;
  }
  function doGoto() {
    let text = $('goto-line').value.trim();
    let w = $('goto-work').value;
    // someone who types the abbreviation anyway ("aen 4.620") is taken at their word
    const typed = text.match(/^([a-z]+)\.?\s*/i);
    if (typed) {
      const t = typed[1].toLowerCase();
      const hit = [...$('goto-work').options].find((o) => o.value.toLowerCase().startsWith(t) || o.text.toLowerCase().startsWith(t));
      if (hit) { w = hit.value; $('goto-work').value = w; }
      text = text.slice(typed[0].length);
    }
    const m = text.match(/^(\d+)\s*[.,:;/ ]\s*(\d+)$/);
    const msg = $('goto-msg');
    if (!m) { msg.innerHTML = 'Type the book and the line, like <b>4.620</b>.'; return; }
    const book = Number(m[1]), n = Number(m[2]);
    const cit = `${w} ${book}.${n}`;
    const row = rows.find((l) => l.citation === cit);
    if (row && byCitation[cit]) {
      const note = goTo(cit);
      $('goto-line').value = '';
      $('goto-msg').innerHTML = note;
      return;
    }
    if (row) { msg.innerHTML = `${escapeHTML(cit)} is a half-line Vergil never finished, so there is nothing to scan.`; return; }
    if (OMITTED[cit]) { msg.innerHTML = `${escapeHTML(cit)} is ${OMITTED[cit]}.`; return; }
    const inBook = rows.filter((l) => workOf(l.citation) === w && bookLine(l.citation)[0] === book);
    if (!inBook.length) {
      const books = [...new Set(rows.filter((l) => workOf(l.citation) === w).map((l) => bookLine(l.citation)[0]))].sort((a, b) => a - b);
      msg.innerHTML = `No lines from ${escapeHTML(workName(w))} ${book} are in the app. Books here: ${books.join(', ')}.`;
      return;
    }
    const nums = inBook.map((l) => bookLine(l.citation)[1])
      .concat(Object.keys(OMITTED).filter((c) => workOf(c) === w && bookLine(c)[0] === book).map((c) => bookLine(c)[1]))
      .sort((a, b) => a - b);
    const nearest = inBook.filter((l) => byCitation[l.citation])
      .reduce((a, b) => (Math.abs(bookLine(b.citation)[1] - n) < Math.abs(bookLine(a.citation)[1] - n) ? b : a));
    msg.innerHTML = `${escapeHTML(cit)} isn’t in the app. ${escapeHTML(workName(w))} ${book} here: ${ranges(nums)}. Nearest: ${goButton(nearest.citation)}`;
  }
  $('goto-go').addEventListener('click', doGoto);
  $('goto-line').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doGoto(); } });
  $('goto-msg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (b) { const note = goTo(b.dataset.go); $('goto-msg').innerHTML = note; }
  });

  // ---- the map of lines ---------------------------------------------------------------------------
  // One square per line, ten to a row, lined up by line number (a row is 180–189), so a student can
  // find "late in Aeneid 4" by eye. Where our selection skips lines, the stretch breaks, and a gap across
  // the map says what is missing.
  function mapHTML() {
    const cur = current() && current().citation;
    const passages = [...new Set(rows.map((l) => l.passage))];
    return passages.map((name) => {
      const mine = rows.filter((l) => l.passage === name);
      const scannable = mine.filter((l) => byCitation[l.citation]);
      Object.keys(OMITTED).forEach((c) => {
        const [b, n] = bookLine(c);
        const k = mine.findIndex((l, i) => i > 0 && workOf(l.citation) === workOf(c)
          && bookLine(l.citation)[0] === b && bookLine(mine[i - 1].citation)[0] === b
          && bookLine(mine[i - 1].citation)[1] === n - 1 && bookLine(l.citation)[1] === n + 1);
        if (k > 0) mine.splice(k, 0, { citation: c, omitted: true });
      });
      const done = scannable.filter((l) => P.isSolved(l.citation)).length;
      // stretches of consecutive lines in one book
      const runs = [];
      mine.forEach((l) => {
        const [b, n] = bookLine(l.citation);
        const r = runs[runs.length - 1];
        if (r && r.work === workOf(l.citation) && r.book === b && n === r.last + 1) { r.items.push(l); r.last = n; }
        else runs.push({ work: workOf(l.citation), book: b, first: n, last: n, items: [l] });
      });
      let html = `<section class="map-passage"><h3>${escapeHTML(name)} <span class="map-count">${done} of ${scannable.length}</span></h3>`;
      runs.forEach((r, k) => {
        const prev = runs[k - 1];
        if (prev && prev.work === r.work && prev.book === r.book) {
          const a = prev.last + 1, b = r.first - 1;
          html += `<div class="map-gap">${a === b ? `line ${a} is` : `lines ${a}–${b} are`} not in our selection</div>`;
        }
        if (!prev || prev.book !== r.book || prev.work !== r.work) html += `<div class="map-book">${escapeHTML(workName(r.work))} ${r.book}</div>`;
        const byN = {};
        r.items.forEach((l) => { byN[bookLine(l.citation)[1]] = l; });
        html += '<div class="map-grid">';
        for (let d = Math.floor(r.first / 10) * 10; d <= r.last; d += 10) {
          html += `<span class="map-row">${d}</span>`;
          for (let n = d; n < d + 10; n++) {
            const l = byN[n];
            if (!l) { html += '<span class="cell none"></span>'; continue; }
            if (l.omitted) {
              html += `<span class="cell omitted" title="${escapeHTML(l.citation)} · ${OMITTED[l.citation]}"></span>`;
              continue;
            }
            if (!byCitation[l.citation]) {
              html += `<span class="cell half" title="${escapeHTML(l.citation)} · a half-line Vergil never finished"></span>`;
              continue;
            }
            const solved = P.isSolved(l.citation);
            const label = `${l.citation} · ${solved ? 'figured out' : 'not yet'}`;
            html += `<button type="button" class="cell ${solved ? 'solved' : 'todo'}${l.citation === cur ? ' current' : ''}" data-go="${escapeHTML(l.citation)}" title="${escapeHTML(label)}" aria-label="${escapeHTML(label)}"></button>`;
          }
        }
        html += '</div>';
      });
      return html + '</section>';
    }).join('');
  }
  $('open-map').addEventListener('click', () => {
    const done = lines.filter((l) => P.isSolved(l.citation)).length;
    $('map-summary').innerHTML = `You've figured out <b>${done}</b> of ${lines.length} lines.`;
    $('map-body').innerHTML = mapHTML();
    $('map').hidden = false;
    const here = $('map-body').querySelector('.cell.current');
    if (here) here.scrollIntoView({ block: 'center' });
  });
  $('map-body').addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (!b) return;
    $('map').hidden = true;
    const note = goTo(b.dataset.go);
    $('goto-msg').innerHTML = note;
  });
  $('close-map').addEventListener('click', () => { $('map').hidden = true; });
  $('map').addEventListener('click', (e) => { if (e.target.id === 'map') $('map').hidden = true; });

  function spondaicNote(l) {
    return l.flags.includes('spondaic fifth foot')
      ? '<div class="note">The fifth foot is a spondee (¯ ¯) — rare, and usually for effect.</div>' : '';
  }

  // ---- my progress --------------------------------------------------------------------------------
  $('open-progress').addEventListener('click', () => {
    const st = P.stats();
    const row = (label, n, total) => {
      const pct = total ? Math.round(100 * n / total) : 0;
      return `<div class="progress-row"><div>${escapeHTML(label)}</div><div class="meter"><span style="width:${pct}%"></span></div><div class="nums">${n} / ${total}</div></div>`;
    };
    $('progress-body').innerHTML =
      `<p>${st.solved ? `You've figured out <b>${st.solved}</b> line${st.solved === 1 ? '' : 's'} — <b>${st.percent}%</b> of all ${st.total} lines, or ${st.solved * 6} feet of hexameter.` : 'No lines figured out yet — start with the Tutorial!'}</p>` +
      `<div class="big-stats">
        <div><b>${st.points}</b><span>points</span></div>
        <div><b>${st.firstTries}</b><span>first-try lines</span></div>
        <div><b>${st.bestStreak}</b><span>best streak</span></div>
        <div><b>${st.days}</b><span>days practiced</span></div>
        <div><b>${st.checks}</b><span>checks</span></div>
      </div>` +
      '<h3>Tutorial</h3>' + row('Stages finished', st.stages.filter((s) => s.done).length, st.stages.length) +
      '<h3>Passages</h3>' + st.passages.map((p) => row(p.name, p.solved, p.total)).join('') +
      '<h3>Kinds of line</h3>' + st.byLevel.map((l) => row(KIND_NAMES[l.level - 1], l.solved, l.total)).join('') +
      '<h3>Badges</h3>' + (st.badges.length
        ? `<div class="badge-list">${st.badges.map((b) => `<span title="${escapeHTML(b.desc)}">★ ${escapeHTML(b.title)}</span>`).join('')}</div>`
        : '<p class="note">None yet — your first correct line earns one.</p>') +
      fastSection() +
      (st.configs.length ? '<h3>What you have practiced</h3><ul>' +
        st.configs.map(([k, n]) => `<li>${escapeHTML(k)} <span class="note">(${n} check${n === 1 ? '' : 's'})</span></li>`).join('') + '</ul>' : '');
    $('report-name').value = S.name || '';
    $('progress').hidden = false;
  });
  function fastSection() {
    const f = P.fastStats();
    const per = f.recent ? f.perLine.toFixed(1) : '—';
    const most = f.need.perLine;
    if (P.fastUnlocked()) {
      return '<h3>⚡ Fast scanning</h3><p>Unlocked! Turn it on or off with the switch under the marks.</p>';
    }
    return '<h3>⚡ Fast scanning (locked)</h3>' +
      `<p class="note">Unlocks when your last ${f.need.lines} lines took ${most} checks or fewer each, on average. Only your most recent lines count, so a slow start never holds you back.</p>` +
      `<div class="progress-row"><div>Lines figured out</div><div class="meter"><span style="width:${Math.round(100 * f.recent / f.need.lines)}%"></span></div><div class="nums">${f.recent} / ${f.need.lines}</div></div>` +
      `<p class="note">Your last ${f.recent} line${f.recent === 1 ? '' : 's'}: <b>${per}</b> checks each (${most} or fewer to unlock).</p>`;
  }
  $('close-progress').addEventListener('click', () => { $('progress').hidden = true; });
  $('progress').addEventListener('click', (e) => { if (e.target.id === 'progress') $('progress').hidden = true; });
  $('report-name').addEventListener('change', () => { S.name = $('report-name').value.trim(); P.save(); });
  $('download-report').addEventListener('click', () => {
    S.name = $('report-name').value.trim(); P.save();
    P.downloadReport(S.name);
  });
  $('reset-progress').addEventListener('click', () => {
    if (!window.confirm('Erase all your progress in this browser? This cannot be undone.')) return;
    P.reset();
    $('progress').hidden = true;
    fillStageMenu();
    updatePoints();
    setMode('tutorial');
  });

  // ---- the zoom-in: why a syllable is long, short or elided -----------------------------------------
  // After Check or Show answer, a tap on a syllable opens a card under it: that syllable and its
  // neighbours, enlarged, divided before the student's eyes. The words close up into one big word (the
  // tutorial's own method); the consonants between this vowel and the next lift out, and drop into the
  // syllable they belong to -- a mute (stop) + liquid tied by a swoosh and pushed together into the next one;
  // then what decides the mark lights up: the long vowel, the consonant that ends the syllable, the end
  // of the line, the vowel an elision runs into. The division is the scanner's (`syllable`, `doubled`,
  // `silent` in the key), never worked out here.
  const STEPS = [['is-word', 450], ['is-split', 1300], ['is-why', 2150], ['is-mark', 2700]];
  const PAIRED = ['muta cum liquida, short', 'muta cum liquida at word start', 'f + liquid at word start',
    'word-initial cluster ignored'];
  const CLOSED = ['two consonants', 'muta cum liquida, long', 'word-initial cluster makes position',
    'lengthened syllable'];
  let zoomAt = null;
  const AGAIN = '<button type="button" class="zoom-again" title="Divide it again" aria-label="Divide it again">↻</button>';
  const CLOSE = '<button type="button" class="zoom-close" title="Close" aria-label="Close">×</button>';

  function showReason(i) {
    const l = current(); if (!l || !(checked || revealed)) return;
    zoomAt = i;
    const want = expected(l.nuclei[i]), got = marks[i];
    const note = checked && got !== want ? `— you marked it ${got ? WORD[got] : 'nothing'}` : '';
    zoomEl.innerHTML = zoomCard(l, i, note, AGAIN + CLOSE, true);
    zoomEl.hidden = false;
    fitZoom(zoomEl);
    placeZoom();
    playZoom(zoomEl);
  }

  // What a card holds -- the heading, the strip, the sentence -- for the pop-up and for a lesson's
  // worked example alike. The pop-up adds a link to the lesson that teaches the reason.
  function zoomCard(l, i, note, buttons, withLessons) {
    const n = l.nuclei[i];
    const z = zoomStrip(l, i);
    const [tag, why] = zoomWhy(l, n, z);
    // the syllable, as it sounds (dīxit: dīc), or the vowel an elision takes (with its -m)
    const said = z && n.syllable ? z.said : n.text + (z && z.m ? 'm' : '');
    let head = n.mark === 'merged' ? `<b class="la">${escapeHTML(said)}</b> <b>runs into the next vowel</b>`
      : `<b class="la">${escapeHTML(said)}</b> is <b>${WORD[expected(n)]}</b>`;
    if (note) head += ` <span class="note">${note}</span>`;
    return `<div class="zoom-head"><span>${head}</span><span class="zoom-buttons">${buttons}</span></div>` +
      (z ? z.html : '') +
      `<p class="zoom-why" aria-live="polite"><span class="zoom-tag">${tag}</span> ${why}</p>` +
      (withLessons ? lessonLinks(l, n, z) : '');
  }

  // ---- from the zoom-in to the lesson behind it -------------------------------------------------------
  // Each reason names the stage that teaches it -- and the part of the lesson (data-topic in
  // tutorial.json) when a stage teaches several things. The notes a reason adds (qu, h, x, a j) bring
  // their own. A stage missing from the tutorial drops its link.
  const LESSON = {
    'long vowel': ['syllables'], 'two consonants': ['syllables'], 'short vowel': ['syllables'],
    'final syllable': ['syllables'], 'diphthong': ['vowels', 'diphthong'],
    'muta cum liquida, long': ['muta'], 'muta cum liquida, short': ['muta'],
    'muta cum liquida at word start': ['clusters'], 'f + liquid at word start': ['clusters'],
    'word-initial cluster makes position': ['clusters'], 'word-initial cluster ignored': ['clusters'],
    'elided': ['elision'], 'prodelided': ['elision'],
    'correption': ['licences'], 'lengthened syllable': ['licences'], 'merged': ['licences', 'synizesis'],
  };
  const TOPICS = {
    diphthong: 'Diphthongs', apart: 'Two vowels, two syllables', semivowel: 'i and u as consonants',
    qu: 'qu', h: 'h', x: 'x', z: 'z', 'i-between': 'i between two vowels', hic: 'hic and hoc',
    hiatus: 'Hiatus', synizesis: 'Synizesis', hypermetry: 'Hypermetry',
  };
  function lessonsFor(l, n, z) {
    if (!z) return [];
    const why = n.why || n.mark;
    let main = LESSON[why];
    if (why === 'short vowel' && n.hiatus) main = ['licences', 'hiatus'];
    else if (vowelNext(l, n) && (why === 'short vowel' || why === 'long vowel')) main = ['vowels', 'apart'];
    else if (why === 'elided' && !z.next) main = ['licences', 'hypermetry'];
    const out = main ? [main] : [];
    // the notes zoomReason adds, under the same conditions
    const notes = why === 'two consonants' || (why === 'short vowel' && !n.hiatus && z.onset);
    if (notes && z.qu) out.push(['refinements', 'qu']);
    if (notes && z.h) out.push(['refinements', 'h']);
    const d = why === 'two consonants' && (l.doubled || []).find((x) => x.at === z.codaAt);
    if (d) {
      const c = [...l.text][d.at].toLowerCase();
      out.push(['refinements', c === 'x' || c === 'z' ? c : c === 'i' ? 'i-between' : d.as.join('') === 'cc' ? 'hic' : null]);
    }
    if (z.j) out.push(['vowels', 'semivowel']);
    return out;
  }
  function lessonLinks(l, n, z) {
    const seen = new Set();
    const links = lessonsFor(l, n, z).filter(([id, topic]) => {
      const key = `${id}#${topic || ''}`;
      if (seen.has(key) || !stages.some((s) => s.id === id)) return false;
      seen.add(key);
      return true;
    });
    if (!links.length) return '';
    return '<p class="zoom-lesson">Lesson: ' + links.map(([id, topic]) => {
      const k = stages.findIndex((s) => s.id === id);
      const name = topic ? TOPICS[topic] : stages[k].title;
      return `<button type="button" class="link" data-lesson="${id}"${topic ? ` data-topic="${topic}"` : ''}>` +
        `${escapeHTML(name)} (stage ${k + 1}) →</button>`;
    }).join(' · ') + '</p>';
  }

  // The tutorial, at the stage that teaches it, scrolled to the part that does. From Practice, or from
  // another stage, the lesson shows a way back to the line, as it was left (see keepDraft).
  function openLesson(id, topic) {
    const k = stages.findIndex((s) => s.id === id);
    if (k < 0) return;
    closeZoom();
    if (S.mode !== 'tutorial' || S.stage !== k) {
      const l = current();
      cameFrom = { mode: S.mode, stage: S.stage, stageId: S.stageId, citation: l && l.citation, to: k };
      if (S.mode === 'tutorial') openStage(k, true);
      else { S.stage = k; setMode('tutorial'); }
    }
    const body = $('lesson-body');
    if (body.hidden) $('lesson-toggle').click();
    const part = (topic && body.querySelector(`[data-topic="${topic}"]`)) || $('lesson');
    const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    part.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
    if (part !== $('lesson')) {
      part.classList.remove('lit');
      void part.offsetWidth;                          // light it up again if it is already lit
      part.classList.add('lit');
    }
  }
  function showLessonBack() {
    if (cameFrom && (S.mode !== 'tutorial' || S.stage !== cameFrom.to)) cameFrom = null;
    $('lesson-back').hidden = !cameFrom;
    if (!cameFrom) return;
    $('lesson-back-go').textContent = cameFrom.mode === 'practice'
      ? `← Back to your line in Practice, ${cameFrom.citation}`
      : `← Back to stage ${cameFrom.stage + 1}, ${cameFrom.citation}`;
  }
  $('lesson-back-go').addEventListener('click', () => {
    const from = cameFrom;
    if (!from) return;
    if (from.mode === 'practice') setMode('practice');
    else { cameFrom = null; openStage(from.stage, true); }
    $('line-box').scrollIntoView({ block: 'center' });
  });

  function closeZoom() {
    stopZoom(zoomEl);
    zoomAt = null;
    zoomEl.hidden = true;
    zoomEl.innerHTML = '';
  }

  // The four steps play on a box: the pop-up, or a worked example in a lesson.
  function stopZoom(box) { (box.zoomTimers || []).forEach(clearTimeout); box.zoomTimers = []; }
  function playZoom(box) {
    stopZoom(box);
    const all = STEPS.map(([c]) => c);
    box.classList.remove(...all);
    const still = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (still) { box.classList.add(...all); return; }
    void box.offsetWidth;                            // start from the line as it is written
    STEPS.forEach(([c, t]) => box.zoomTimers.push(setTimeout(() => box.classList.add(c), t)));
  }

  // The letters shrink until the widest moment (the words apart, or the syllables apart) fits the card.
  // Nothing moves while it measures, and the card is left at the step it was on (a resize mid-way).
  function fitZoom(box) {
    const zs = box.querySelector('.zs'), row = box.querySelector('.zs-row');
    if (!zs || !zs.clientWidth) return;              // not on screen (a hidden lesson): fit it when shown
    const all = STEPS.map(([c]) => c);
    const was = all.filter((c) => box.classList.contains(c));
    box.classList.add('measure');
    zs.style.fontSize = '';
    box.classList.remove(...all);
    let need = row.getBoundingClientRect().width;
    box.classList.add(...all);
    need = Math.max(need, row.getBoundingClientRect().width);
    box.classList.remove(...all);
    const room = zs.clientWidth;
    if (need > room) zs.style.fontSize = (parseFloat(getComputedStyle(zs).fontSize) * room / need * 0.95) + 'px';
    clipTails(box);
    box.classList.add(...was);
    void box.offsetWidth;
    box.classList.remove('measure');
  }

  // A consonant i is drawn as a j with its tail clipped off at the baseline, so it reads as the i of
  // the line; step 1 lets the tail grow down out of it. The baseline is measured, not assumed: the
  // font differs from one device to the next.
  function clipTails(box) {
    box.querySelectorAll('.zs-grow').forEach((g) => {
      const base = g.querySelector('.zs-base').getBoundingClientRect().top;
      const below = g.getBoundingClientRect().bottom - base;
      g.style.setProperty('--tail', (below / parseFloat(getComputedStyle(g).fontSize)) + 'em');
    });
  }

  // Under the syllable, its caret pointing at it; kept inside the screen, and scrolled into view.
  function placeZoom() {
    if (zoomAt == null || zoomEl.hidden) return;
    const el = nucEls()[zoomAt];
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = zoomEl.offsetWidth;
    const cx = r.left + r.width / 2;
    const left = Math.max(16, Math.min(window.innerWidth - 16 - w, cx - w / 2));
    zoomEl.style.left = (left + window.scrollX) + 'px';
    zoomEl.style.top = (r.bottom + window.scrollY + r.height * 0.6) + 'px';
    zoomEl.style.setProperty('--caret', Math.max(18, Math.min(w - 18, cx - left)) + 'px');
    const below = zoomEl.getBoundingClientRect().bottom - window.innerHeight + 12;
    if (below > 0) window.scrollBy({ top: below, behavior: 'smooth' });
  }

  zoomEl.addEventListener('click', (e) => {
    const go = e.target.closest('[data-lesson]');
    if (go) openLesson(go.dataset.lesson, go.dataset.topic);
    else if (e.target.closest('.zoom-close')) closeZoom();
    else if (e.target.closest('.zoom-again')) playZoom(zoomEl);
  });
  // a tap anywhere else closes it -- except on another syllable, which opens that one instead
  document.addEventListener('pointerdown', (e) => {
    if (zoomEl.hidden || zoomEl.contains(e.target) || e.target.closest('#line .nuc, #line .tie')) return;
    closeZoom();
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !zoomEl.hidden) closeZoom(); });
  window.addEventListener('resize', () => {
    if (!zoomEl.hidden) { fitZoom(zoomEl); placeZoom(); }
    document.querySelectorAll('.demo.zplay').forEach(fitZoom);
  });

  // ---- worked examples in the lessons ----------------------------------------------------------------
  // A lesson may hold <div class="demo" data-line="Met. 13.607" data-show="volucrī:u volucris:u">: a
  // line from data/examples.json (lines from outside the reader, so they are new to the student) or from
  // the reader itself, shown scanned, with the syllables `data-show` names picked out -- a word and the
  // vowel of its syllable, with #2 for a second one (colōremque:e#2, est#2:e). The first divides itself
  // with the zoom-in's animation when the example comes into view; a tap divides any other.
  const seen = 'IntersectionObserver' in window ? new IntersectionObserver((hits) => {
    hits.forEach((h) => {
      if (!h.isIntersecting || h.target.played) return;
      h.target.played = true;
      fitZoom(h.target);
      playZoom(h.target);
    });
  }, { threshold: 0.6 }) : null;

  function buildDemos(root) {
    root.querySelectorAll('.demo[data-line]').forEach((box) => {
      const l = examples[box.dataset.line] || byCitation[box.dataset.line];
      const picks = l ? (box.dataset.show || '').split(/\s+/).filter(Boolean).map((s) => {
        const k = findNucleus(l, s);
        if (k == null) console.warn(`tutorial: ${box.dataset.line} has no syllable "${s}"`);
        return k;
      }).filter((k) => k != null) : [];
      if (!l || !picks.length) {
        if (!l) console.warn(`tutorial: no example line ${box.dataset.line}`);
        box.hidden = true;
        return;
      }
      box.line = l; box.picks = picks;
      box.classList.add('zplay');
      // a chip names the syllable as it sounds (lu, luc) -- or, for one elided away, its word
      const chips = picks.length < 2 ? '' : '<div class="demo-picks">' + picks.map((k) => {
        const n = l.nuclei[k], chars = [...l.text];
        let label = n.syllable ? zoomStrip(l, k).said : '';
        if (!label) {
          let a = n.start, b = n.end;
          while (a > 0 && isLetter(chars[a - 1])) a--;
          while (b < chars.length && isLetter(chars[b])) b++;
          label = chars.slice(a, b).join('');
        }
        return `<button type="button" data-k="${k}" lang="la">${escapeHTML(label)}</button>`;
      }).join('') + '</div>';
      box.innerHTML = `<div class="demo-cite">${escapeHTML(l.citation)}</div>` +
        `<div class="demo-line" lang="la">${demoLine(l, picks)}</div>${chips}<div class="demo-card"></div>`;
      showDemo(box, picks[0], false);
      if (seen) seen.observe(box); else playZoom(box);
    });
  }

  // The example line, scanned: every syllable's mark above it, the picked ones underlined.
  function demoLine(l, picks) {
    const chars = [...l.text];
    let html = '', at = 0;
    l.nuclei.forEach((n, k) => {
      html += escapeHTML(chars.slice(at, n.start).join(''));
      const m = SYMBOL[n.mark] || '';
      html += `<span class="dnuc${picks.includes(k) ? ' pick' : ''}${m ? '' : ' gone'}" data-k="${k}" tabindex="0" role="button">` +
        `${escapeHTML(chars.slice(n.start, n.end).join(''))}<span class="dmark">${m}</span></span>`;
      at = n.end;
    });
    return html + escapeHTML(chars.slice(at).join(''));
  }

  function showDemo(box, k, play) {
    box.querySelectorAll('[data-k]').forEach((e) => e.classList.toggle('on', Number(e.dataset.k) === k));
    stopZoom(box);
    box.classList.remove(...STEPS.map(([c]) => c));
    box.querySelector('.demo-card').innerHTML = zoomCard(box.line, k, '', AGAIN);
    box.at = k;
    fitZoom(box);
    if (play) { box.played = true; playZoom(box); }
  }

  // "volucris:u" -> the nucleus u of the word volucris; "colōremque:e#2" the second e; "est#2:e" the e
  // of the second est. Case and macrons count, as written in the line.
  function findNucleus(l, spec) {
    const m = spec.match(/^(.+?)(?:#(\d+))?:(.+?)(?:#(\d+))?$/);
    if (!m) return null;
    const [, word, wn, vowel, vn] = m;
    const chars = [...l.text];
    const words = [];
    for (let p = 0; p < chars.length;) {
      if (!isLetter(chars[p])) { p++; continue; }
      let e = p;
      while (e < chars.length && isLetter(chars[e])) e++;
      words.push([p, e, chars.slice(p, e).join('')]);
      p = e;
    }
    const w = words.filter(([, , t]) => t.toLowerCase() === word.toLowerCase())[(Number(wn) || 1) - 1];
    if (!w) return null;
    const ks = l.nuclei.map((_, k) => k).filter((k) => l.nuclei[k].start >= w[0] && l.nuclei[k].end <= w[1]
      && l.nuclei[k].text.toLowerCase() === vowel.toLowerCase());
    const k = ks[(Number(vn) || 1) - 1];
    return k == null ? null : k;
  }

  $('lesson-body').addEventListener('click', (e) => {
    const box = e.target.closest('.demo.zplay');
    if (!box) return;
    if (e.target.closest('.zoom-again')) { playZoom(box); return; }
    const pick = e.target.closest('[data-k]');
    if (pick) showDemo(box, Number(pick.dataset.k), true);
  });
  $('lesson-body').addEventListener('keydown', (e) => {
    const pick = e.target.closest('.demo .dnuc');
    if (!pick || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    showDemo(pick.closest('.demo'), Number(pick.dataset.k), true);
  });

  // The strip of letters: the syllable that holds nucleus i, with one neighbour on each side (two on one
  // side at the ends of the line). Returns its HTML and the letters the explanation names.
  function zoomStrip(l, i) {
    const N = l.nuclei;
    const act = N.map((_, k) => k).filter((k) => N[k].syllable);
    const n = N[i];
    // its own syllable -- or, for an elided or merged vowel, the syllable it lies inside
    let s = act.indexOf(i);
    if (s < 0) s = act.findIndex((k) => N[k].syllable[0] <= n.start && n.start < N[k].syllable[1]);
    if (s < 0) return null;
    const me = act[s], nx = act[s + 1];
    const lo = Math.max(0, Math.min(s - 1, act.length - 3)), hi = Math.min(act.length - 1, lo + 2);
    const chars = [...l.text];
    const halves = new Map((l.doubled || []).map((d) => [d.at, d.as]));
    const silent = new Set(l.silent || []);
    const nucOf = new Map();
    N.forEach((x, k) => { for (let p = x.start; p < x.end; p++) nucOf.set(p, k); });
    const gone = new Set();                          // an elided vowel and its -m; a prodelided e
    N.forEach((x) => {
      if (x.mark !== 'elided' && x.mark !== 'prodelided') return;
      let e = x.end;
      if (x.mark === 'elided') while (e < chars.length && isLetter(chars[e])) e++;
      for (let p = x.start; p < e; p++) gone.add(p);
    });
    const role = (p) => !isLetter(chars[p]) ? 'sp' : gone.has(p) ? 'gone'
      : nucOf.has(p) ? (N[nucOf.get(p)].mark === 'merged' ? 'glide' : 'v') : silent.has(p) ? 'h' : 'c';
    const span = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, k) => a + k);
    const isCons = (p) => role(p) === 'c' || role(p) === 'glide';
    // an i the scanner counts as a consonant (iam, coniugis; omnia by synizesis) is a j
    const isJ = (p) => /^i$/i.test(chars[p]) && isCons(p) && !halves.has(p);
    const said = (p) => (isJ(p) ? (chars[p] === 'I' ? 'J' : 'j') : chars[p]);
    const letters = (ps, side) => ps.map((p) => (halves.has(p) ? halves.get(p)[side] : said(p).toLowerCase())).join('');

    // the consonants between this syllable's vowel and the next: those that stay, those that go on
    const coda = span(N[me].end, N[me].syllable[1]).filter(isCons);
    const onset = nx != null ? span(N[nx].syllable[0], N[nx].start).filter(isCons) : [];
    const z = { coda: letters(coda, 0), onset: letters(onset, 1), codaAt: coda[coda.length - 1] };
    const [sa, sb] = N[me].syllable;
    z.said = span(sa, sb).filter((p) => isLetter(chars[p]) && !gone.has(p))
      .map((p) => (halves.has(p) ? halves.get(p)[p === sa ? 1 : 0] : said(p))).join('');
    // a j in this syllable or at the head of the next is worth a word (not synizesis: it says its own)
    z.j = n.mark !== 'merged' && [...span(sa, sb), ...onset].some((p) => isJ(p) && role(p) === 'c');
    z.crossed = onset.length > 0 && chars.slice(onset[onset.length - 1] + 1, N[nx].start).some((c) => !isLetter(c));
    z.h = nx != null && span(N[me].end, N[nx].start).some((p) => silent.has(p));
    z.qu = /qu/.test(n.followed_by || '') || /qu/i.test(z.said);   // after the vowel, or opening its syllable

    // what decides the mark: these letters light up (or the end of the line)
    const key = new Set();
    let keyEnd = false;
    const nucleus = (k) => span(N[k].start, N[k].end);
    const why = n.why || n.mark;
    if (['long vowel', 'diphthong', 'correption', 'short vowel'].includes(why)) nucleus(i).forEach((p) => key.add(p));
    if (CLOSED.includes(why)) coda.forEach((p) => key.add(p));
    if (PAIRED.includes(why)) onset.forEach((p) => key.add(p));
    if (why === 'final syllable') keyEnd = true;
    if (n.hiatus && nx != null) nucleus(nx).forEach((p) => key.add(p));
    if (why === 'merged') [...nucleus(i), ...nucleus(me)].forEach((p) => key.add(p));
    const ties = [];                                 // [from, to, class]: a swoosh under these letters
    if (why === 'elided') {
      z.next = N[me].start > n.start;              // the vowel it runs into -- or the next line's
      if (z.next) {
        nucleus(me).forEach((p) => key.add(p));
        const h = span(n.end, N[me].start).filter((p) => silent.has(p));   // horrendum: an h before it
        h.forEach((p) => key.add(p));
        z.hNext = h.length > 0;
      } else keyEnd = true;
      z.m = n.end < chars.length && isLetter(chars[n.end]);     // an elided syllable ends in a vowel or -m
    }
    if (why === 'prodelided') {
      let p = n.start - 1;
      while (p > 0 && !isLetter(chars[p])) p--;
      key.add(p);
      let w = p;
      while (w > 0 && isLetter(chars[w - 1])) w--;
      z.word = chars.slice(w, p + 1).join('');
    }
    // every elision in view gets its swoosh: from the lost vowel to the vowel it runs into
    N.forEach((x, k) => {
      if (x.mark === 'elided') {
        const host = act.find((a) => N[a].syllable[0] <= x.start && x.start < N[a].syllable[1]);
        if (host == null) return;
        ties.push(N[host].start > x.start ? [x.start, N[host].end, 'zs-elide' + (k === i ? ' mine' : '')]
          : [x.start, N[host].syllable[1], 'zs-elide trail' + (k === i ? ' mine' : '')]);
      } else if (x.mark === 'prodelided') {
        let p = x.start - 1;
        while (p > 0 && !isLetter(chars[p])) p--;
        ties.push([p, x.end, 'zs-elide' + (k === i ? ' mine' : '')]);
      }
    });
    // the consonants in play lift out and drop into their syllables; a mute (stop) + liquid goes as one.
    // Each belongs to one syllable (a letter that counts twice is in both), and not where a swoosh
    // already spans them: the wrappers must nest.
    const clear = (f, e) => !ties.some(([g, h]) => f < h && g < e);
    if (me === i && why !== 'final syllable') {
      const cuts = [];
      if (coda.length && clear(coda[0], coda[coda.length - 1] + 1)) {
        cuts.push([coda[0], coda[coda.length - 1] + 1, 'zs-cut-l', s]);
      }
      if (onset.length && clear(onset[0], onset[onset.length - 1] + 1)) {
        cuts.push([onset[0], onset[onset.length - 1] + 1, 'zs-cut-r' + (PAIRED.includes(why) ? ' tied' : ''), s + 1]);
      }
      ties.push(...cuts);
    }

    // an i becoming a j: a small one grows its tail down out of the i; a capital fades into J
    const toJ = (ch) => (ch === 'I'
      ? '<span class="zs-morph"><span class="from">I</span><span class="to">J</span></span>'
      : '<span class="zs-grow">j<span class="zs-base"></span></span>');

    let html = '<div class="zs"><span class="zs-row" lang="la">';
    for (let t = lo; t <= hi; t++) {
      const k = act[t];
      const [a, b] = N[k].syllable;
      const mine = ties.filter(([f, e, , g]) => f >= a && e <= b && (g == null || g === t));
      html += `<span class="zs-syl ${t === s ? 'here' : 'far'}">`;
      for (let p = a; p < b; p++) {
        mine.filter(([f]) => f === p).forEach(([, , c]) => { html += `<span class="${c}">`; });
        if (p === N[k].start) html += '<span class="zs-nuc">';
        const c = escapeHTML(chars[p]);
        if (halves.has(p) && p === b - 1 && p !== a) {       // a letter that counts twice: its first sound
          const first = halves.get(p)[0];
          html += `<span class="zs-l zs-dbl${key.has(p) ? ' key' : ''}">` + (first === 'j' && /i/i.test(chars[p]) ? toJ(chars[p])
            : `<span class="zs-morph"><span class="from">${c}</span><span class="to">${escapeHTML(first)}</span></span>`) + '</span>';
        } else if (halves.has(p) && p === a) {                 // ... and its second, in the next syllable
          html += `<span class="zs-l zs-dbl zs-half"><span>${escapeHTML(halves.get(p)[1])}</span></span>`;
        } else if (role(p) === 'sp') {
          html += `<span class="zs-sp">${chars[p] === ' ' ? '&nbsp;' : c}</span>`;
        } else if (isJ(p)) {
          html += `<span class="zs-l zs-${role(p)} zs-jay${key.has(p) ? ' key' : ''}">${toJ(chars[p])}</span>`;
        } else {
          // a consonant u is the u of qu (or sanguis, suāvis): no sound of its own, like h
          const mute = role(p) === 'c' && /u/i.test(chars[p]) ? ' zs-u' : '';
          html += `<span class="zs-l zs-${role(p)}${mute}${key.has(p) ? ' key' : ''}">${c}</span>`;
        }
        if (p === N[k].end - 1) {
          if (k === i) html += `<span class="zs-mark">${SYMBOL[N[k].mark] || ''}</span>`;
          html += '</span>';
        }
        mine.filter(([, e]) => e - 1 === p).forEach(() => { html += '</span>'; });
      }
      html += '</span>';
    }
    if (hi === act.length - 1) html += `<span class="zs-end${keyEnd ? ' key' : ''}"><span>line ends</span></span>`;
    z.html = html + '</span></div>';
    return z;
  }

  // What lit up, named (the tag), and said in a sentence -- and a word on any i that turned into a j.
  function zoomWhy(l, n, z) {
    const [tag, why] = zoomReason(l, n, z);
    const j = z && z.j ? ' The <i>i</i> before a vowel is a consonant, <i>j</i> (say it like English <i>y</i>).' : '';
    return [tag, why + j];
  }
  // The vowel straight after this one in its word, nothing between them: de-us, fī-li-us, il-lī-us.
  function vowelNext(l, n) {
    const next = l.nuclei[l.nuclei.indexOf(n) + 1];
    return next && next.start === n.end ? next : null;
  }
  function zoomReason(l, n, z) {
    const b = (s) => `<b class="la">${escapeHTML(s)}</b>`;
    const v = b(n.text);
    const after = vowelNext(l, n);
    const quNote = z && z.qu ? ' (<i>qu</i> is one consonant: its <i>u</i> is not a vowel.)' : '';
    const hNote = z && z.h ? ' The <i>h</i> does not count.' : '';
    const hiatus = n.hiatus ? ' The next word begins with a vowel, but here the poet does not elide: that is hiatus.' : '';
    if (!z) return ['', ''];
    const open = 'So the syllable ends in its short vowel.';
    switch (n.why || n.mark) {
      case 'long vowel':
        return ['long vowel', `Its vowel, ${v}, is long — it has a macron.` +
          (after ? ` A vowel before another vowel is usually short; the macron says this one is not.` : '') + hiatus];
      case 'diphthong': return ['diphthong', `${v} is a diphthong, two vowels said as one, and diphthongs are long.${hiatus}`];
      case 'two consonants':
        return ['ends in a consonant', `It ends in a consonant, ${b(z.coda)}: two consonants come after its vowel, and they divide between this syllable and the next.${quNote}${doubledNote(l, z)}${hNote}`];
      case 'muta cum liquida, long':
        return ['mūta cum liquida, divided', `${b(n.followed_by)} is a mūta cum liquida: a mute (stop) + <i>l</i> or <i>r</i>, which can go either way. Here the poet divides it: ${b(z.coda)} ends this syllable, so it is long.`];
      case 'muta cum liquida, short':
        return ['mūta cum liquida', `${b(z.onset)} is a mūta cum liquida: a mute (stop) + <i>l</i> or <i>r</i>, which can go either way. Here it goes together into the next syllable. ${open}`];
      case 'muta cum liquida at word start':
        return ['mūta cum liquida', `The next word begins with ${b(z.onset)}, a mūta cum liquida. It goes together into the next syllable. ${open}`];
      case 'f + liquid at word start':
        return ['f + liquid', `The next word begins with ${b(z.onset)}. Like a mūta cum liquida, it goes together into the next syllable. ${open}`];
      case 'word-initial cluster makes position':
        return ['ends in a consonant', `The next word begins with ${b(n.followed_by)}, and here they divide: ${b(z.coda)} ends this syllable, so it is long.`];
      case 'word-initial cluster ignored':
        return ['short vowel', `The next word begins with ${b(n.followed_by)}, but the poet lets them go together into the next syllable. ${open}`];
      case 'short vowel':
        if (n.hiatus) return ['no elision', `${hiatus.trim()} ${open}`];
        if (after) {
          return ['vowel before a vowel', `${v} comes straight before another vowel, ${b(after.text)}. They are not a ` +
            'diphthong, so they are two syllables — and a vowel before another vowel is short.'];
        }
        if (!z.onset) return ['short vowel', `Its vowel is short, and the next syllable begins with a vowel. ${open}`];
        return ['short vowel', `Its vowel is short, and only one consonant follows: ${b(z.onset)} begins the next syllable${z.crossed ? ', even across the space between words' : ''}. ${open}${quNote}${hNote}`];
      case 'correption':
        return ['shortened', `${v} has a macron, but a long vowel at the end of a word can be shortened before another vowel (correption).`];
      case 'final syllable':
        return ['end of the line', 'It is the last syllable of the line, and the last syllable always counts as long.'];
      case 'lengthened syllable':
        return ['lengthened at the beat', `Only one consonant follows, ${b(z.coda)}, so it ought to be short. But the beat falls here: the poet keeps ${b(z.coda)} in this syllable and lengthens it.`];
      case 'elided':
        if (!z.next) return ['into the next line', 'The line has one syllable too many: its last vowel elides into the next line, which begins with a vowel (hypermetry).'];
        return ['the next word begins with a vowel', `Its word ends in a vowel${z.m ? ' + <i>m</i>' : ''}, and the next word begins with ${z.hNext ? 'an <i>h</i> and a vowel — the <i>h</i> does not count' : 'a vowel'}. So ${v}${z.m ? b('m') : ''} is elided, and the swoosh joins what is left to the next vowel.`];
      case 'prodelided':
        return ['est after a vowel', `After a vowel or <i>-m</i>, the <i>e</i> of <i>est</i> drops out: ${b(z.word + ' est')} is said ${b(z.word + '’st')}.`];
      case 'merged':
        return ['run together', `${v} runs together with the next vowel into one syllable (synizesis)${/i/i.test(n.text) ? ': it becomes a consonant, <i>j</i>, said like English <i>y</i>' : ''}.`];
      default: return ['', ''];
    }
  }

  // A letter that counts twice, when it is the one that ends the syllable.
  function doubledNote(l, z) {
    const d = (l.doubled || []).find((x) => x.at === z.codaAt);
    if (!d) return '';
    const c = [...l.text][d.at].toLowerCase();
    if (c === 'x') return ' <i>x</i> is two consonants, <i>c</i> + <i>s</i>, and they divide between the syllables.';
    if (c === 'z') return ' <i>z</i> is two consonants, <i>d</i> + <i>z</i>, and they divide between the syllables.';
    if (c === 'i') return ' An <i>i</i> between two vowels is a consonant, <i>j</i> (say it like English <i>y</i>), and it counts twice: once to end this syllable, once to begin the next.';
    if (d.as[0] === 'c' && d.as[1] === 'c') return ' <i>hic</i> and <i>hoc</i> before a vowel are really <i>hicc</i> and <i>hocc</i>.';
    return ` This word hides an unwritten <i>j</i> after its <i>${escapeHTML(d.as[0])}</i>: <i>in-jiciō</i>.`;
  }
})();
