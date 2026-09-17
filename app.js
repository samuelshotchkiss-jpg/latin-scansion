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
  const KIND_NAMES = ['Long and short only', 'qu', 'h, x, z', 'Elision', 'Mūta cum liquida', 'Consonants at the start of a word', 'Greek words', 'Advanced'];

  const $ = (id) => document.getElementById(id);
  const lineEl = $('line');

  let lines = [];          // every scannable line, in reading order
  let byCitation = {};
  let stages = [];         // tutorial stages whose lines all exist
  let pool = [], index = 0;
  let marks = {}, tieOf = {}, junctions = [];
  let checked = false, revealed = false, helped = false;
  let tool = null, overlay = null;

  // ---- startup ------------------------------------------------------------------------------------
  Promise.all([
    fetch('data/lines.json').then((r) => r.json()),
    fetch('data/tutorial.json').then((r) => r.json()).catch(() => ({ stages: [] })),
  ]).then(([data, tutorial]) => {
    lines = data.filter((l) => l.scans && l.passage)
      .map((l, i) => ({ ...l, _at: i }))
      .sort((a, b) => (a.passage_order - b.passage_order) || (a._at - b._at));
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

    // A "Practice more" link: ?practice=<stage id> opens Practice with that stage's lines.
    const wanted = new URLSearchParams(location.search).get('practice');
    if (wanted) {
      const stage = stages.find((s) => s.id === wanted && s.practice);
      if (stage) usePracticeSet(stage);
      history.replaceState(null, '', location.pathname);
    }

    if (!S.acknowledged) $('privacy').hidden = false;
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
    document.querySelectorAll('#kinds input').forEach((cb) => { cb.checked = levels.includes(Number(cb.value)); });
  }
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
  document.querySelectorAll('#kinds input').forEach((cb) => cb.addEventListener('change', () => {
    S.levels = [...document.querySelectorAll('#kinds input:checked')].map((x) => Number(x.value));
    rebuildPool(current() && current().citation);
  }));

  // Tutorial: one stage's lesson and lines.
  function fillStageMenu() {
    $('stage').innerHTML = stages.map((s, i) =>
      `<option value="${i}">${S.tutorial[s.id] ? '✓ ' : ''}${i + 1}. ${escapeHTML(s.title)}</option>`).join('');
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
    $('feedback').innerHTML = ''; $('reason').innerHTML = '';
    const l = current();
    if (!l) {
      lineEl.textContent = 'No lines match — tick another kind of line, or choose All passages.';
      $('citation').textContent = ''; $('position').textContent = '';
      overlay = null; junctions = [];
      return;
    }
    const chars = [...l.text];
    let html = '', at = 0;
    l.nuclei.forEach((nu, i) => {
      html += escapeHTML(chars.slice(at, nu.start).join(''));
      html += `<span class="nuc" data-i="${i}" tabindex="0">` +
              `${escapeHTML(chars.slice(nu.start, nu.end).join(''))}<span class="mark"></span></span>`;
      at = nu.end;
    });
    html += escapeHTML(chars.slice(at).join(''));
    lineEl.innerHTML = html + '<div class="overlay"></div>';
    overlay = lineEl.querySelector('.overlay');
    junctions = computeJunctions(l);
    $('citation').textContent = l.citation;
    updatePosition();
    $('prev').disabled = index === 0;
    $('next').disabled = index >= pool.length - 1;
    if (S.mode === 'tutorial' && stages[S.stage]) S.stagePos[stages[S.stage].id] = l.citation;
    else S.citation = l.citation;
    P.save();
    render();
  }

  function updatePosition() {
    const solved = pool.filter((x) => P.isSolved(x.citation)).length;
    const what = S.mode === 'tutorial' ? 'Practice line' : 'Line';
    const mark = current() && P.isSolved(current().citation) ? ' · ✓ figured out' : '';
    $('position').textContent = `${what} ${index + 1} of ${pool.length} · ${solved} solved${mark}`;
  }

  function nucEls() { return [...lineEl.querySelectorAll('.nuc')]; }

  function render() {
    nucEls().forEach((el) => {
      const m = marks[el.dataset.i];
      el.classList.toggle('elided', m === 'X');
      el.querySelector('.mark').textContent = m === 'L' || m === 'S' ? SYMBOL[m] : '';
      if (!checked) el.classList.remove('ok', 'bad');
      el.classList.toggle('revealed', revealed);
    });
    return drawOverlay();
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
      tie.className = 'tie';
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
    const seq = l.nuclei.map((_, i) => i).filter((i) => marks[i] !== 'X');
    let p = 0, feet = 0;
    const breaks = [];
    while (p < seq.length && feet < 6) {
      const m0 = marks[seq[p]], m1 = marks[seq[p + 1]], m2 = marks[seq[p + 2]];
      let size = 0;
      if (m0 === 'L' && m1 === 'L') size = 2;
      else if (m0 === 'L' && m1 === 'S' && m2 === 'S') size = 3;
      if (!size) break;
      p += size; feet++;
      if (feet < 6 && p < seq.length) breaks.push([seq[p - 1], seq[p]]);
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
    return { feet, complete: feet === 6 && p === seq.length };
  }
  window.addEventListener('resize', () => drawOverlay());

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
    slot.className = 'tie slot';
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
      if (d.from == null) selectTool(d.mark);
      else showReason(d.from);
      return;
    }
    if (d.t) place(d.t.i, d.mark, d.from, d.t.j);
    else if (d.from != null) removeMark(d.from);           // dragged off the line: back to the tray
  });

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('pointerdown', (e) => startDrag(e, chip.dataset.mark, null));
    chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectTool(chip.dataset.mark); }
    });
  });

  lineEl.addEventListener('pointerdown', (e) => {
    const tie = e.target.closest('.tie:not(.slot)');
    if (tie) { startDrag(e, 'X', Number(tie.dataset.i)); return; }
    const markEl = e.target.closest('.mark');
    if (markEl && markEl.textContent) startDrag(e, marks[markEl.parentElement.dataset.i], Number(markEl.parentElement.dataset.i));
  });
  lineEl.addEventListener('click', (e) => {
    const el = e.target.closest('.nuc');
    if (!el || e.target.closest('.mark')) return;
    tapNucleus(Number(el.dataset.i));
  });
  lineEl.addEventListener('keydown', (e) => {
    const el = e.target.closest('.nuc');
    if (!el) return;
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
    if (tool) applyTool(i, tool);
    else if (checked || revealed) showReason(i);
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
      else if (result.alreadySolved) html += ' <span class="note">(Already figured out.)</span>';
      html += '</div>' + spondaicNote(l);
    } else {
      const unmarked = l.nuclei.filter((n, i) => !marks[i]).length;
      html = `${right} of ${total} right.`;
      if (unmarked) html += ` ${unmarked} syllable${unmarked === 1 ? ' has' : 's have'} no mark.`;
      if (shape && !shape.complete) html += ' <span class="note">Your marks don’t divide into six feet yet — see where the dividers stop.</span>';
      html += ' <span class="note">Tap a mark to see why.</span>';
    }
    let badges = result.badges;
    if (correct && S.mode === 'tutorial') {
      const stage = stages[S.stage];
      if (stage.lines.every((c) => P.isSolved(c))) {
        badges = badges.concat(P.completeStage(stage.id));
        fillStageMenu();
        html += `<div class="stage-done"><b>Stage ${S.stage + 1} complete!</b>` +
          (S.stage + 1 < stages.length
            ? ` <button type="button" class="primary" id="next-stage">On to stage ${S.stage + 2}: ${escapeHTML(stages[S.stage + 1].title)} →</button>`
            : ' That was the last stage — head to <b>Practice</b> to keep going.') + '</div>';
      }
    }
    html += badges.map((b) => `<span class="new-badge" title="${escapeHTML(b.desc)}">★ New badge: ${escapeHTML(b.title)}</span>`).join('');
    $('feedback').innerHTML = html;
    const nextStage = $('next-stage');
    if (nextStage) nextStage.addEventListener('click', () => openStage(S.stage + 1));
    $('reason').innerHTML = '';
    updatePosition();
    updatePoints();
  });

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
    $('feedback').innerHTML = spondaicNote(l) + '<div class="note">Tap a mark to see why.</div>';
    $('reason').innerHTML = '';
  });

  $('clear').addEventListener('click', () => { marks = {}; tieOf = {}; edited(); });
  $('prev').addEventListener('click', () => { if (index > 0) { index--; showLine(); } });
  $('next').addEventListener('click', () => { if (index < pool.length - 1) { index++; showLine(); } });

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
      (st.configs.length ? '<h3>What you have practiced</h3><ul>' +
        st.configs.map(([k, n]) => `<li>${escapeHTML(k)} <span class="note">(${n} check${n === 1 ? '' : 's'})</span></li>`).join('') + '</ul>' : '');
    $('report-name').value = S.name || '';
    $('progress').hidden = false;
  });
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
