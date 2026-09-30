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

  const $ = (id) => document.getElementById(id);
  const lineEl = $('line');

  let lines = [];          // every scannable line, in reading order
  let rows = [];           // every line of every passage, scannable or not, in order
  let rowsByCit = {};
  let lastShown = null;    // the citation shown before this one: a step to a neighbour scrolls
  let byCitation = {};
  let stages = [];         // tutorial stages whose lines all exist
  let pool = [], index = 0;
  let marks = {}, tieOf = {}, junctions = [];
  let checked = false, revealed = false, helped = false;
  let tool = null, overlay = null;
  let cursor = null;       // FAST SCANNING: the syllable the next key or tap marks (null when off)

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
  ]).then(([data, tutorial]) => {
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
    S.mode = mode; P.save();
    document.querySelectorAll('.mode[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    $('practice-controls').hidden = mode !== 'practice';
    $('tutorial-controls').hidden = mode !== 'tutorial';
    $('lesson').hidden = mode !== 'tutorial';
    if (mode === 'tutorial') openStage(Math.min(S.stage || 0, stages.length - 1), true);
    else rebuildPool(S.citation);
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

  function openStage(k, resume) {
    const stage = stages[k];
    if (!stage) return;
    S.stage = k; P.save();
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
    pool = stage.lines.map((c) => byCitation[c]);
    const saved = resume ? S.stagePos[stage.id] : null;
    const at = saved ? pool.findIndex((l) => l.citation === saved) : -1;
    index = at >= 0 ? at : Math.max(0, pool.findIndex((l) => !P.isSolved(l.citation)));
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
    $('feedback').innerHTML = ''; $('reason').innerHTML = '';
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
    if (S.mode === 'tutorial' && stages[S.stage]) S.stagePos[stages[S.stage].id] = l.citation;
    else S.citation = l.citation;
    P.save();
    render();
  }

  function updatePosition() {
    const solved = pool.filter((x) => P.isSolved(x.citation)).length;
    const what = S.mode === 'tutorial' ? 'Practice line' : 'Line';
    $('position').textContent = `${what} ${index + 1} of ${pool.length} · ${solved} solved`;
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
      $('feedback').innerHTML = ''; $('reason').innerHTML = '';
    }
    render();
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
    lineEl.querySelectorAll('.slot').forEach((s) => s.remove());
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

  $('check').addEventListener('click', () => {
    const l = current(); if (!l) return;
    let right = 0;
    nucEls().forEach((el) => {
      const i = Number(el.dataset.i);
      const want = expected(l.nuclei[i]);
      el.classList.remove('ok', 'bad');
      if (marks[i] === want) right++;
      if (marks[i] === 'L' || marks[i] === 'S') el.classList.add(marks[i] === want ? 'ok' : 'bad');
    });
    checked = true; revealed = false;
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
      const unmarked = l.nuclei.filter((n, i) => !marks[i]).length;
      html = `${right} of ${total} right.`;
      if (unmarked) html += ` ${unmarked} syllable${unmarked === 1 ? ' has' : 's have'} no mark.`;
      if (shape && !shape.complete) html += ` <span class="note">Your marks don’t divide into ${l.meter === 'half-line' ? 'feet' : 'six feet'} yet — see where the dividers stop.</span>`;
      html += ' <span class="note">Tap a mark to see why.</span>';
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
    $('reason').innerHTML = '';
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
    nucEls().forEach((el) => el.classList.remove('ok', 'bad'));
    render();
    $('feedback').innerHTML = spondaicNote(l) + '<div class="note">Tap a mark to see why.</div>' + rhythmControls();
    wireRhythm();
    $('reason').innerHTML = '';
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

  // ---- reasons, in the student's words --------------------------------------------------------------
  function showReason(i) {
    const l = current(); if (!l || !(checked || revealed)) return;
    const n = l.nuclei[i];
    const want = expected(n);
    const got = marks[i];
    let html = `<b>${escapeHTML(n.text)}</b> is <b>${WORD[want]}</b>. ${escapeHTML(reason(n))}`;
    if (checked && got !== want) html += ` <span class="note">(You marked it ${got ? WORD[got] : 'nothing'}.)</span>`;
    $('reason').innerHTML = html;
  }

  function reason(n) {
    const f = n.followed_by || '';
    switch (n.why || n.mark) {
      case 'long vowel': return 'It is a long vowel.';
      case 'diphthong': return 'It is a diphthong, and diphthongs are long.';
      case 'two consonants': return `It is followed by two consonants (${consonants(f)}), which make the syllable long.`;
      case 'muta cum liquida, short': return `It is followed by ${f}, a mūta cum liquida (a stop + l or r). That pair does not have to make the syllable long — and here it doesn't.`;
      case 'muta cum liquida, long': return `It is followed by ${f}, a mūta cum liquida (a stop + l or r). That pair can make the syllable long — and here it does.`;
      case 'muta cum liquida at word start': return `The next word begins with ${f}, a mūta cum liquida, which does not make this syllable long.`;
      case 'f + liquid at word start': return `The next word begins with ${f}. Poets treat that pair like a mūta cum liquida: it does not make this syllable long.`;
      case 'word-initial cluster makes position': return `The next word begins with two consonants (${f}), and here they make this syllable long.`;
      case 'word-initial cluster ignored': return `The next word begins with two consonants (${f}), but the poet does not let them make this syllable long.`;
      case 'short vowel': return f ? `It is a short vowel followed by only one consonant (${consonants(f)}).` : 'It is a short vowel followed directly by another vowel.';
      case 'final syllable': return 'It is the last syllable of the line, which always counts as long.';
      case 'lengthened syllable': return 'The poet lengthens this syllable where the beat falls on it.';
      case 'elided': return 'A vowel (or vowel + m) at the end of a word is elided before a word that begins with a vowel or h.';
      case 'prodelided': return 'After a vowel or -m, the e of est (or es) drops out.';
      case 'merged': return 'This vowel runs together with the next one into a single syllable (synizesis).';
      default: return '';
    }
  }
  function consonants(f) {
    const notes = [];
    if (/[xz]/.test(f)) notes.push('x and z each count as two');
    if (/qu/.test(f)) notes.push('qu counts as one');
    if (f === 'i') notes.push('i between vowels counts as two');
    return notes.length ? `${f}; ${notes.join(', ')}` : f;
  }
})();
