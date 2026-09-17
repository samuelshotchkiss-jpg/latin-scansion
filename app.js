// Latin Scansion -- the student app. AGPL-3.0 (see COPYRIGHT.md).
//
// The key (data/lines.json) lists every syllable NUCLEUS of a line -- a vowel or diphthong -- with its
// mark: L, S, or elided. Students drag marks that snap to nuclei. A nucleus stays a valid target for
// long and short marks until the STUDENT marks it elided, whatever the key says: the app never gives
// an elision away. Marking a nucleus elided returns any long or short mark on it to the tray.
(function () {
  'use strict';

  const SYMBOL = { L: '¯', S: '˘', X: '×' };
  const WORD = { L: 'long', S: 'short', X: 'elided' };
  const STORE_KEY = 'latinScansion.v1';

  const $ = (id) => document.getElementById(id);
  const lineEl = $('line');

  let lines = [];          // every scannable line, in text order
  let pool = [];           // the lines the current passage + level admit
  let index = 0;           // position in pool
  let marks = {};          // nucleus index -> 'L' | 'S' | 'X'
  let checked = false;
  let revealed = false;
  let tool = null;         // a tray mark selected for tap-to-place
  let saved = load();

  // ---- storage (per browser; may be unavailable) --------------------------------------------------
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(saved)); } catch (e) { /* private mode */ }
  }
  saved.solved = saved.solved || {};

  // ---- data --------------------------------------------------------------------------------------
  fetch('data/lines.json')
    .then((r) => r.json())
    .then((data) => {
      // Reading order: by passage, then by position in the text.
      lines = data.filter((l) => l.scans && l.passage)
        .map((l, i) => ({ ...l, _at: i }))
        .sort((a, b) => (a.passage_order - b.passage_order) || (a._at - b._at));
      const names = [...new Set(lines.map((l) => l.passage))];
      $('passage').innerHTML = '<option value="">All passages</option>' +
        names.map((n) => `<option>${escapeHTML(n)}</option>`).join('');
      $('passage').value = names.includes(saved.passage) ? saved.passage : (names[0] || '');
      $('level').value = String(saved.level || 1);
      rebuildPool(saved.citation);
    })
    .catch(() => { lineEl.textContent = 'Could not load the lines (data/lines.json).'; });

  function rebuildPool(keepCitation) {
    const passage = $('passage').value;
    const level = Number($('level').value);
    pool = lines.filter((l) => (!passage || l.passage === passage) && l.level <= level);
    const at = pool.findIndex((l) => l.citation === keepCitation);
    index = at >= 0 ? at : Math.max(0, pool.findIndex((l) => !saved.solved[l.citation]));
    saved.passage = passage; saved.level = level; save();
    showLine();
  }
  $('passage').addEventListener('change', () => rebuildPool());
  $('level').addEventListener('change', () => rebuildPool(current() && current().citation));

  function current() { return pool[index]; }

  // ---- rendering ---------------------------------------------------------------------------------
  function escapeHTML(s) {
    return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function showLine() {
    marks = {}; checked = false; revealed = false;
    $('feedback').innerHTML = ''; $('reason').innerHTML = '';
    const l = current();
    if (!l) {
      lineEl.textContent = 'No lines at this level in this passage yet — try adding a skill.';
      $('citation').textContent = ''; $('position').textContent = '';
      return;
    }
    // Build the line: plain text between nuclei, a span per nucleus.
    const chars = [...l.text];          // code points; offsets in the key are NFC code points
    let html = '', at = 0;
    l.nuclei.forEach((n, i) => {
      html += escapeHTML(chars.slice(at, n.start).join(''));
      html += `<span class="nuc" data-i="${i}" tabindex="0" role="button">` +
              `${escapeHTML(chars.slice(n.start, n.end).join(''))}<span class="mark"></span></span>`;
      at = n.end;
    });
    html += escapeHTML(chars.slice(at).join(''));
    lineEl.innerHTML = html;
    $('citation').textContent = l.citation;
    const solved = pool.filter((x) => saved.solved[x.citation]).length;
    $('position').textContent = `Line ${index + 1} of ${pool.length} · ${solved} solved`;
    $('prev').disabled = index === 0;
    $('next').disabled = index >= pool.length - 1;
    saved.citation = l.citation; save();
    render();
  }

  function nucEls() { return [...lineEl.querySelectorAll('.nuc')]; }

  function render() {
    nucEls().forEach((el) => {
      const m = marks[el.dataset.i];
      el.classList.toggle('elided', m === 'X');
      el.querySelector('.mark').textContent = m ? SYMBOL[m] : '';
      if (!checked) el.classList.remove('ok', 'bad', 'missing', 'revealed');
    });
  }

  // ---- placing marks -----------------------------------------------------------------------------
  function place(i, mark, from) {
    if (from != null && from !== i) delete marks[from];
    if (mark !== 'X' && marks[i] === 'X') return false;     // an elided nucleus takes no long/short
    marks[i] = mark;                                        // X replaces (returns) any long/short mark
    edited();
    return true;
  }
  function removeMark(i) { delete marks[i]; edited(); }
  function edited() {
    if (checked || revealed) { checked = false; revealed = false; $('feedback').innerHTML = ''; $('reason').innerHTML = ''; }
    render();
  }

  // The nucleus a drop at (x, y) snaps to: the nearest eligible one on the same visual row. A long or
  // short mark dropped squarely ON a vowel the student has elided snaps nowhere -- it must not slide
  // onto the neighbouring vowel -- so it goes back to the tray.
  function targetAt(x, y, mark) {
    let best = null, bestDx = Infinity, blocked = false;
    nucEls().forEach((el) => {
      const i = Number(el.dataset.i);
      const r = el.getBoundingClientRect();
      if (y < r.top - r.height * 1.1 || y > r.bottom + r.height * 0.35) return;
      if (mark !== 'X' && marks[i] === 'X') {
        if (x >= r.left - 4 && x <= r.right + 4) blocked = true;
        return;
      }
      const dx = Math.abs(x - (r.left + r.width / 2));
      if (dx < bestDx && dx <= Math.max(28, r.width)) { best = i; bestDx = dx; }
    });
    return blocked ? null : best;
  }

  // ---- drag (pointer events: mouse, pen and touch alike) ------------------------------------------
  let drag = null;
  function startDrag(e, mark, from) {
    e.preventDefault();
    drag = { mark, from, x0: e.clientX, y0: e.clientY, moved: false, ghost: null, target: null, source: e.currentTarget };
  }
  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'ghost';
      drag.ghost.textContent = SYMBOL[drag.mark];
      document.body.appendChild(drag.ghost);
    }
    drag.ghost.style.left = e.clientX + 'px';
    drag.ghost.style.top = e.clientY + 'px';
    const t = targetAt(e.clientX, e.clientY, drag.mark);
    if (t !== drag.target) {
      nucEls().forEach((el) => el.classList.toggle('target', Number(el.dataset.i) === t));
      drag.target = t;
    }
  });
  document.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.ghost) d.ghost.remove();
    nucEls().forEach((el) => el.classList.remove('target'));
    if (!d.moved) {                                   // a tap, not a drag
      if (d.from == null) selectTool(d.mark);
      else showReason(d.from);
      return;
    }
    if (d.target != null) place(d.target, d.mark, d.from);
    else if (d.from != null) removeMark(d.from);      // dragged off the line: back to the tray
  });

  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('pointerdown', (e) => startDrag(e, chip.dataset.mark, null));
    chip.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectTool(chip.dataset.mark); }
    });
  });

  lineEl.addEventListener('pointerdown', (e) => {
    const markEl = e.target.closest('.mark');
    if (markEl && markEl.textContent) {
      const i = Number(markEl.parentElement.dataset.i);
      startDrag(e, marks[i], i);
    }
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
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); if (marks[i]) removeMark(i); }
    const k = { l: 'L', s: 'S', e: 'X', x: 'X' }[e.key.toLowerCase()];
    if (k) { e.preventDefault(); place(i, k, null); }
  });

  function selectTool(mark) {
    tool = tool === mark ? null : mark;
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('selected', c.dataset.mark === tool));
  }
  function tapNucleus(i) {
    if (tool) {
      if (marks[i] === tool) removeMark(i);
      else place(i, tool, null);
    } else if (checked || revealed) {
      showReason(i);
    }
  }

  // ---- checking ----------------------------------------------------------------------------------
  function expected(n) { return n.mark === 'L' || n.mark === 'S' ? n.mark : 'X'; }

  $('check').addEventListener('click', () => {
    const l = current(); if (!l) return;
    let right = 0;
    nucEls().forEach((el) => {
      const i = Number(el.dataset.i);
      const want = expected(l.nuclei[i]);
      const got = marks[i];
      el.classList.remove('ok', 'bad', 'missing', 'revealed');
      if (got === want) { el.classList.add('ok'); right++; }
      else el.classList.add(got ? 'bad' : 'missing');
    });
    checked = true;
    const total = l.nuclei.length;
    if (right === total) {
      saved.solved[l.citation] = true; save();
      $('feedback').innerHTML = `<div><b>Correct!</b></div>` + feetHTML(l);
      $('position').textContent = `Line ${index + 1} of ${pool.length} · ${pool.filter((x) => saved.solved[x.citation]).length} solved`;
    } else {
      $('feedback').innerHTML = `${right} of ${total} right. <span class="note">Tap an underlined vowel to see why.</span>`;
    }
    $('reason').innerHTML = '';
  });

  $('reveal').addEventListener('click', () => {
    const l = current(); if (!l) return;
    marks = {};
    l.nuclei.forEach((n, i) => { marks[i] = expected(n); });
    render();
    nucEls().forEach((el) => { el.classList.remove('ok', 'bad', 'missing'); el.classList.add('revealed'); });
    revealed = true; checked = false;
    $('feedback').innerHTML = feetHTML(l) + '<div class="note">Tap any vowel to see why.</div>';
    $('reason').innerHTML = '';
  });

  $('clear').addEventListener('click', () => { marks = {}; edited(); });
  $('prev').addEventListener('click', () => { if (index > 0) { index--; showLine(); } });
  $('next').addEventListener('click', () => { if (index < pool.length - 1) { index++; showLine(); } });

  function feetHTML(l) {
    const feet = l.feet.map((f) => [...f].map((c) => SYMBOL[c]).join('')).join(' | ');
    let html = `<div class="feet">${feet}</div>`;
    if (l.flags.includes('spondaic fifth foot')) {
      html += '<div class="note">The fifth foot is a spondee (¯ ¯) — rare, and usually for effect.</div>';
    }
    return html;
  }

  // ---- reasons, in the student's words -------------------------------------------------------------
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
      case 'long vowel': return `It is a long vowel.`;
      case 'diphthong': return `It is a diphthong, and diphthongs are long.`;
      case 'two consonants': return `It is followed by two consonants (${consonants(f)}), which make the syllable long.`;
      case 'muta cum liquida, short': return `It is followed by ${f}, a mūta cum liquida (a stop + l or r). That pair does not have to make the syllable long — and here it doesn't.`;
      case 'muta cum liquida, long': return `It is followed by ${f}, a mūta cum liquida (a stop + l or r). That pair can make the syllable long — and here it does.`;
      case 'muta cum liquida at word start': return `The next word begins with ${f}, a mūta cum liquida, which does not make this syllable long.`;
      case 'f + liquid at word start': return `The next word begins with ${f}. Poets treat that pair like a mūta cum liquida: it does not make this syllable long.`;
      case 'word-initial cluster makes position': return `The next word begins with two consonants (${f}), and here they make this syllable long.`;
      case 'word-initial cluster ignored': return `The next word begins with two consonants (${f}), but the poet does not let them make this syllable long.`;
      case 'short vowel': return f ? `It is a short vowel followed by only one consonant (${consonants(f)}).` : `It is a short vowel followed directly by another vowel.`;
      case 'final syllable': return `It is the last syllable of the line, which always counts as long.`;
      case 'lengthened syllable': return `The poet lengthens this syllable where the beat falls on it.`;
      case 'elided': return `A vowel (or vowel + m) at the end of a word is elided before a word that begins with a vowel or h.`;
      case 'prodelided': return `After a vowel or -m, the e of est (or es) drops out.`;
      case 'merged': return `This vowel runs together with the next one into a single syllable (synizesis).`;
      default: return '';
    }
  }
  function consonants(f) {
    let s = f;
    const notes = [];
    if (/[xz]/.test(f)) notes.push('x and z each count as two');
    if (/qu/.test(f)) notes.push('qu counts as one');
    if (/^i$|[aeiou]i/.test(f) || f === 'i') notes.push('i between vowels counts as two');
    return notes.length ? `${s}; ${notes.join(', ')}` : s;
  }
})();
