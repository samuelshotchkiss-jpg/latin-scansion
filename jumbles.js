// Latin Scansion -- Hexameter jumbles (jumbles.html). AGPL-3.0 (see COPYRIGHT.md).
//
// Owner, 2026-11-12, "purely for fun": the poet's words shuffled until the line no longer scans; the
// student drags them back. Any order that is a hexameter and keeps to the
// looser rules of jumble-core.js is RIGHT and earns its points -- and when it is not the poet's own
// order, the poet's line is shown beside it to compare.
//
// TWO WAYS TO START
//   Scanned    every syllable is marked, and the marks follow the words: a last syllable lengthens or
//              shortens (the long mark's ends bend up into a short one), an elision comes and goes
//              (a swoosh, and the ending greys).
//   Unscanned  no marks. Tap a vowel to mark it for your own reference (¯ ˘, and elided on a last
//              vowel); moving a word sends the marks at the ends of words that changed neighbours
//              flying. Only the order counts; the true scansion arrives with the drums.
//
// SENTENCES (the Lines menu's fourth choice; owner 2026-11-12): two to four lines of one sentence,
// one row each. Where a clause runs over a line break, its words may move into the other line. A
// word changes lines only when the student puts it there (owner: words must not jump between lines
// by themselves), so a line may gain or lose words; a line's share of a clause, emptied, leaves a
// dashed slot to drop words back into. Every line must scan; the grammar is judged over the whole
// sentence.
//
// Stored apart from the Scan page's progress, under its own key: points, badges, solved lines.
'use strict';

(() => {
  const J = window.JumbleCore;
  const $ = (id) => document.getElementById(id);
  const KEY = 'latinScansion.jumbles.v1';
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const POET = (c) => (c.startsWith('Aen.') ? 'Vergil' : 'Ovid');
  const BASE = { scanned: 10, blind: 15 };

  // ---- storage: read fresh before every change, so two tabs never erase each other ---------------
  let storageOK = true;
  try { localStorage.setItem(KEY + '.probe', '1'); localStorage.removeItem(KEY + '.probe'); } catch (e) { storageOK = false; }
  function fresh(s) {
    s = s && typeof s === 'object' ? s : {};
    s.v = 1;
    s.lines = s.lines || {};
    s.points = s.points || 0;
    s.streak = s.streak || { cur: 0, best: 0 };
    s.blindStreak = s.blindStreak || { cur: 0, best: 0 };
    s.badges = s.badges || {};
    s.days = s.days || {};
    s.t = Object.assign({ locks: 0, right: 0, wrong: 0, shown: 0, own: 0, exact: 0 }, s.t || {});
    s.prefs = s.prefs || {};
    return s;
  }
  const read = () => { try { return fresh(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return fresh(null); } };
  let S = read();
  function update(fn) {
    if (storageOK) S = read();
    const r = fn(S);
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* private mode: nothing is kept */ }
    return r;
  }
  const today = () => new Date().toISOString().slice(0, 10);

  // ---- badges ------------------------------------------------------------------------------------
  const solvedIn = (mode) => Object.values(S.lines).filter((r) => r[mode]).length;
  const solvedAny = () => Object.values(S.lines).filter((r) => r.scanned || r.blind).length;
  const BADGES = [
    { id: 'first', title: 'Unjumbled', desc: 'Put your first line back together.', test: () => solvedAny() >= 1 },
    { id: 'ten', title: 'Ten lines', desc: 'Ten lines unjumbled.', test: () => solvedAny() >= 10 },
    { id: 'fifty', title: 'Fifty lines', desc: 'Fifty lines unjumbled.', test: () => solvedAny() >= 50 },
    { id: 'hundred', title: 'A hundred lines', desc: 'A hundred lines — six hundred feet put back.', test: () => solvedAny() >= 100 },
    { id: 'streak5', title: 'Five in a row', desc: 'Five lines in a row right at the first lock-in.', test: () => S.streak.best >= 5 },
    { id: 'streak15', title: 'Fifteen in a row', desc: 'Fifteen lines in a row right at the first lock-in.', test: () => S.streak.best >= 15 },
    { id: 'own', title: 'Poēta novus', desc: "A right answer the poet didn't write: your own hexameter.", test: () => S.t.own >= 1 },
    { id: 'own10', title: 'Rival of the poets', desc: 'Ten hexameters of your own.', test: () => S.t.own >= 10 },
    { id: 'exact25', title: 'Mind reader', desc: 'Twenty-five lines put back exactly as the poet wrote them.', test: () => S.t.exact >= 25 },
    { id: 'blind', title: 'No peeking', desc: 'Your first line solved unscanned.', test: () => solvedIn('blind') >= 1 },
    { id: 'blind25', title: 'By ear', desc: 'Twenty-five lines solved unscanned.', test: () => solvedIn('blind') >= 25 },
    { id: 'blind5', title: 'Eyes closed', desc: 'Five unscanned lines in a row right at the first lock-in.', test: () => S.blindStreak.best >= 5 },
    { id: 'elide', title: 'Slippery', desc: 'Ten lines whose answer has an elision.', test: (c) => c.elided >= 10 },
    { id: 'triple', title: 'Meltdown', desc: 'A line with three elisions or more.', test: (c) => c.maxE >= 3 },
    { id: 'both', title: 'Ovid and Vergil', desc: 'A line of each poet.', test: (c) => c.poets >= 2 },
    { id: 'tour', title: 'Grand tour', desc: 'A line from every passage.', test: (c) => c.passages >= c.allPassages },
    { id: 'quick', title: 'Quick hands', desc: 'A line right within 20 seconds.', test: (c) => c.quick },
    { id: 'comeback', title: 'Never give up', desc: 'Right after three wrong lock-ins or more.', test: (c) => c.comeback },
    { id: 'sentence', title: 'Over the line', desc: 'Your first sentence of two lines or more.', test: (c) => c.sentences >= 1 },
    { id: 'sentence10', title: 'Periodic', desc: 'Ten sentences of two lines or more.', test: (c) => c.sentences >= 10 },
    { id: 'four', title: 'Four-liner', desc: 'A sentence four lines long.', test: (c) => c.maxRows >= 4 },
    { id: 'day20', title: 'Twenty in a day', desc: 'Twenty lines solved in one day.', test: () => (S.days[today()] || 0) >= 20 },
    { id: 'days3', title: 'Three days', desc: 'Jumbles on three different days.', test: () => Object.keys(S.days).length >= 3 },
  ];
  function counts(extra) {
    const solved = allItems().filter((l) => S.lines[l.c] && (S.lines[l.c].scanned || S.lines[l.c].blind));
    return Object.assign({
      sentences: solved.filter((l) => l.rows).length,
      maxRows: solved.reduce((m, l) => Math.max(m, l.rows ? l.rows.length : 1), 0),
      elided: solved.filter((l) => l.e > 0).length,
      maxE: solved.reduce((m, l) => Math.max(m, l.e), 0),
      poets: new Set(solved.map((l) => POET(l.c))).size,
      passages: new Set(solved.map((l) => l.p)).size,
      allPassages: new Set(DATA.lines.map((l) => l.p)).size,
    }, extra || {});
  }
  function award(extra) {
    const c = counts(extra), fresh = [];
    BADGES.forEach((b) => { if (!S.badges[b.id] && b.test(c)) { S.badges[b.id] = today(); fresh.push(b); } });
    return fresh;
  }

  // ---- state -------------------------------------------------------------------------------------
  const allItems = () => DATA.lines.concat(DATA.sentences || []);
  let DATA = null, pool = [], cur = null, lastCite = '';
  const dead = new Set();                         // lines no strict shuffle can break
  const pref = (k, d) => (S.prefs[k] === undefined ? d : S.prefs[k]);
  let mode = pref('mode', 'scanned');
  const lineEl = $('jb-line');

  // ---- marks: one quadratic curve. t = 0 a long mark (flat), t = 1 a short (its ends bent up) -----
  const SVGNS = 'http://www.w3.org/2000/svg';
  const curve = (t) => `M2 ${7 - 6 * t} Q10 ${7 + 7 * t} 18 ${7 - 6 * t}`;
  function makeMark() {
    const s = document.createElementNS(SVGNS, 'svg');
    s.setAttribute('viewBox', '0 0 20 14');
    s.setAttribute('class', 'mk');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(SVGNS, 'path');
    s.appendChild(p);
    return s;
  }
  // state: 'L' 'S' 'X' (elided: no mark) or '' (no mark)
  function setMark(nu, state, animate) {
    const svg = nu.querySelector('.mk'), p = svg.firstChild;
    const to = { t: state === 'S' ? 1 : 0, o: state === 'L' || state === 'S' ? 1 : 0 };
    const from = { t: nu._t === undefined ? to.t : nu._t, o: nu._o === undefined ? 0 : nu._o };
    nu.dataset.m = state;
    if (from.o === 0) from.t = to.t;                   // a mark arriving arrives in its shape
    cancelAnimationFrame(nu._raf);
    const apply = (t, o, lift) => {
      p.setAttribute('d', curve(t));
      svg.style.opacity = o;
      svg.style.transform = `translateX(-50%) translateY(${lift}em)`;
      nu._t = t; nu._o = o;
    };
    if (!animate || reduced) { apply(to.t, to.o, 0); return; }
    const t0 = performance.now(), dur = 230;
    const back = (x) => 1 + 2.2 * Math.pow(x - 1, 3) + 1.2 * Math.pow(x - 1, 2);   // a little overshoot
    const step = (now) => {
      const k = Math.min(1, (now - t0) / dur), e = back(k);
      const lift = from.o < to.o ? -0.35 * (1 - k) : 0;
      apply(from.t + (to.t - from.t) * e, from.o + (to.o - from.o) * Math.min(1, k * 1.6), lift);
      if (k < 1) nu._raf = requestAnimationFrame(step);
    };
    nu._raf = requestAnimationFrame(step);
  }
  function setTail(tile, gone, animate) {
    const tail = tile.querySelector('.tail');
    if (!tail) return;
    const was = tail.classList.contains('gone') || tail.classList.contains('leach');
    if (gone === was) return;
    tail.classList.remove('gone', 'leach', 'unleach');
    if (gone) {
      if (animate && !reduced) {
        tail.classList.add('leach');
        tail.addEventListener('animationend', function f() {
          tail.removeEventListener('animationend', f);
          if (tail.classList.contains('leach')) { tail.classList.remove('leach'); tail.classList.add('gone'); }
        });
      } else tail.classList.add('gone');
    } else if (animate && !reduced) {
      tail.classList.add('unleach');
      tail.addEventListener('animationend', () => tail.classList.remove('unleach'), { once: true });
    }
  }

  // ---- building the line -------------------------------------------------------------------------
  function tileFor(w) {
    const t = document.createElement('span');
    t.className = 'tile';
    t.dataset.id = w.id;
    t.tabIndex = 0;
    t.setAttribute('role', 'button');
    t.setAttribute('aria-label', w.w);
    const text = w.w;
    let at = 0;
    const last = w.n.length - 1;
    const nuEl = (k) => {
      const [s, e] = w.n[k];
      const nu = document.createElement('span');
      nu.className = 'nu';
      nu.dataset.k = k;
      nu.append(makeMark(), text.slice(s, e));
      setMark(nu, '', false);
      return nu;
    };
    w.n.forEach(([s, e], k) => {
      if (k === last) return;
      t.append(text.slice(at, s), nuEl(k));
      at = e;
    });
    const [ls] = w.n[last];
    t.append(text.slice(at, ls));
    const tail = document.createElement('span');
    tail.className = 'tail';
    // prodelided est loses only its e: the tail of est is its vowel alone
    tail.append(nuEl(last));
    if (w.est) { t.append(tail, text.slice(w.n[last][1])); } else { tail.append(text.slice(w.n[last][1])); t.append(tail); }
    return t;
  }

  function build(order) {
    sweepDrags();
    lineEl.replaceChildren();
    const bySeg = new Map();
    order.forEach((w) => { if (!bySeg.has(w.s)) bySeg.set(w.s, []); bySeg.get(w.s).push(w); });
    const size = new Map([...bySeg].map(([k, ws]) => [k, ws.length]));
    // each line (row) in the poet's layout: its walls where they stand, and as many slots of each
    // segment as the poet put there, filled from the order
    const rows = J.rowsOf(cur.line);
    rows.forEach((row) => {
      const rowEl = document.createElement('div');
      rowEl.className = 'jb-row';
      let box = null;
      row.forEach((t) => {
        if (typeof t === 'string') {
          const wl = document.createElement('span');
          wl.className = 'wall';
          wl.textContent = t;
          rowEl.append(wl);
          box = null;
          return;
        }
        if (!box) {
          box = document.createElement('span');
          box.className = 'jb-seg-wrap';
          box.dataset.seg = t.s;
          box.dataset.cap = 0;
          rowEl.append(box);
        }
        box.dataset.cap = +box.dataset.cap + 1;
        const tile = tileFor(bySeg.get(t.s).shift());
        if (size.get(t.s) < 2) tile.classList.add('fixed');
        box.append(tile);
      });
      lineEl.append(rowEl);
    });
    lineEl.classList.toggle('multi', rows.length > 1);
    const ov = document.createElementNS(SVGNS, 'svg');
    ov.setAttribute('class', 'jb-swooshes');
    ov.setAttribute('aria-hidden', 'true');
    lineEl.append(ov);
    lineEl.classList.toggle('blind', mode === 'blind');
  }

  const tiles = () => [...lineEl.querySelectorAll('.tile:not(.ghost)')];
  // a segment (a stretch between punctuation) may be cut by a line break into parts, one per row;
  // data-cap is how many words the poet put in each part (used only to show the answer)
  const segOf = (t) => t.parentNode.dataset.seg;
  const partsOf = (seg) => [...lineEl.querySelectorAll(`.jb-seg-wrap[data-seg="${seg}"]`)];
  const segTiles = (seg) => partsOf(seg).flatMap((p) => [...p.children]);
  // put these tiles, in this order, into their segment's parts: each part takes as many as it holds
  function fill(seg, ts) {
    let k = 0;
    partsOf(seg).forEach((p) => { const cap = +p.dataset.cap; ts.slice(k, k + cap).forEach((t) => p.append(t)); k += cap; });
    markEmpty(seg);
  }
  // a part of a segment with no word left in it shows a dashed slot, a place to drop a word back
  function markEmpty(seg) {
    const parts = partsOf(seg);
    parts.forEach((p) => p.classList.toggle('empty', parts.length > 1 && !p.querySelector('.tile')));
  }
  // words per line, as they stand now
  const countsNow = () => [...lineEl.querySelectorAll('.jb-row')].map((r) => r.querySelectorAll('.tile').length);
  const orderNow = () => tiles().map((t) => cur.words[+t.dataset.id]);
  const tileOf = (id) => lineEl.querySelector(`.tile[data-id="${id}"]:not(.ghost)`);

  // ---- rescanning after a move -------------------------------------------------------------------
  // a word's marks and its greyed (elided) ending
  function paintTile(tile, w, marks, animate) {
    tile.querySelectorAll('.nu').forEach((nu) => setMark(nu, marks[+nu.dataset.k], animate));
    setTail(tile, marks[w.n.length - 1] === 'X' && !w.est, animate);
    if (w.est) tile.querySelector('.tail').classList.toggle('gone', marks[0] === 'X');
  }
  // the copy of a word under the finger while it is dragged: it changes as the word itself does
  const ghostOf = (id) => (drag && drag.ghost && +drag.tile.dataset.id === id ? drag.ghost : null);

  function refresh(animate, swooshesLater) {
    const order = orderNow();
    const sc = J.scanItem(cur.line, order, countsNow());
    cur.scan = sc;
    if (mode === 'scanned' || cur.done) {
      order.forEach((w, i) => {
        paintTile(tileOf(w.id), w, sc.marks[i], animate);
        const g = ghostOf(w.id);
        if (g) paintTile(g, w, sc.marks[i], animate);
      });
      drawSwooshes(order, sc, animate, swooshesLater);
    }
    // the poet's neighbours, for the unscanned marks that must fly
    const next = new Map(order.map((w, i) => [w.id, order[i + 1] ? order[i + 1].id : -1]));
    const prev = new Map(order.map((w, i) => [w.id, order[i - 1] ? order[i - 1].id : -1]));
    if (mode === 'blind' && !cur.done && cur.next) {
      order.forEach((w) => {
        const tile = tileOf(w.id), last = w.n.length - 1;
        if (cur.next.get(w.id) !== next.get(w.id)) flyAway(tile.querySelector(`.nu[data-k="${last}"]`));
        if (w.est && cur.prev.get(w.id) !== prev.get(w.id)) flyAway(tile.querySelector('.nu[data-k="0"]'));
      });
    }
    cur.next = next;
    cur.prev = prev;
    clearBars();
  }

  function flyAway(nu) {
    if (!nu || !nu.dataset.m) return;
    const g = !nu.closest('.ghost') && ghostOf(+nu.closest('.tile').dataset.id);
    const gnu = g && g.querySelector(`.nu[data-k="${nu.dataset.k}"]`);
    if (gnu) { flyAway(gnu); setMark(nu, '', false); if (nu.dataset.m === 'X') setTail(nu.closest('.tile'), false, false); return; }
    const svg = nu.querySelector('.mk');
    if (nu.dataset.m === 'X') { setTail(nu.closest('.tile'), false, true); }
    else if (!reduced) {
      const r = svg.getBoundingClientRect();
      const c = svg.cloneNode(true);
      c.setAttribute('class', 'flyaway');
      Object.assign(c.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', transform: '', opacity: 1 });
      document.body.append(c);
      c.addEventListener('animationend', () => c.remove());
    }
    setMark(nu, '', false);
  }

  // swooshes under the gap of each elision (and a prodelision's est)
  function center(nu) {
    const a = nu.getBoundingClientRect(), b = lineEl.getBoundingClientRect();
    return { x: a.left - b.left + a.width / 2, y: a.bottom - b.top, top: a.top - b.top };
  }
  // pruneOnly: drop the swooshes that no longer apply and hide the rest while the words glide;
  // a second call, once they have landed, draws the new ones in
  function drawSwooshes(order, sc, animate, pruneOnly) {
    const ov = lineEl.querySelector('.jb-swooshes');
    if (!ov) return;
    const want = new Map();
    order.forEach((w, i) => {
      const last = w.n.length - 1, nx = order[i + 1];
      if (!nx || sc.marks[i][last] !== 'X' && !(nx.est && sc.marks[i + 1][0] === 'X')) return;
      const a = tileOf(w.id).querySelector(`.nu[data-k="${last}"]`);
      const b = tileOf(nx.id).querySelector('.nu[data-k="0"]');
      want.set(`${w.id}-${nx.id}`, [a, b]);
    });
    const have = new Map([...ov.querySelectorAll('path.sw')].map((p) => [p.dataset.key, p]));
    have.forEach((p, k) => {
      if (!want.has(k)) {
        if (animate && !reduced) { p.classList.add('going'); setTimeout(() => p.remove(), 220); } else p.remove();
      } else p.classList.toggle('hush', !!pruneOnly);
    });
    if (pruneOnly) return;
    want.forEach(([a, b], k) => {
      const A = center(a), B = center(b);
      let d;
      if (Math.abs(A.y - B.y) > 8) d = `M${A.x} ${A.y + 3} q 9 9 20 2`;        // the next word wrapped
      else d = `M${A.x} ${A.y + 3} Q${(A.x + B.x) / 2} ${A.y + 3 + Math.min(16, 6 + (B.x - A.x) / 5)} ${B.x} ${B.y + 3}`;
      let p = have.get(k);
      if (!p || p.classList.contains('going')) {
        p = document.createElementNS(SVGNS, 'path');
        p.setAttribute('class', 'sw');
        p.dataset.key = k;
        ov.append(p);
        p.setAttribute('d', d);
        if (animate && !reduced) {
          const len = p.getTotalLength();
          p.style.setProperty('--len', len);
          p.style.strokeDasharray = len;
          p.classList.add('draw');
        }
      } else p.setAttribute('d', d);
    });
  }

  // foot bars, once the line is right
  function clearBars() { lineEl.querySelectorAll('.jb-swooshes .bar').forEach((e) => e.remove()); }
  function drawBars(m) {
    clearBars();
    const ov = lineEl.querySelector('.jb-swooshes');
    const order = orderNow(), sy = m.scan.sylls;
    const nuOf = (s) => tileOf(order[s.w].id).querySelector(`.nu[data-k="${s.n}"]`);
    const line = (x, y1, y2, cls) => {
      const l = document.createElementNS(SVGNS, 'line');
      l.setAttribute('x1', x); l.setAttribute('x2', x); l.setAttribute('y1', y1); l.setAttribute('y2', y2);
      l.setAttribute('class', cls);
      ov.append(l);
    };
    m.rows.forEach((r, ri) => {
      const rs = sy.filter((s) => s.row === ri);
      let k = 0;
      r.feet.forEach((f, fi) => {
        k += f.length;
        if (fi === r.feet.length - 1) return;
        const A = center(nuOf(rs[k - 1])), B = center(nuOf(rs[k]));
        if (Math.abs(A.y - B.y) > 8) return;
        line((A.x + B.x) / 2, B.top - 18, B.top - 4, 'bar');
      });
    });
  }

  // ---- dragging (pointer events: mouse, pen and touch) -------------------------------------------
  let drag = null, selected = null;
  function canMove(tile) { return cur && !cur.done && !cur.busy && !tile.classList.contains('fixed'); }

  // Moving the tile in the page mid-drag makes the browser drop its pointer capture, so the release
  // can land anywhere: off the line, on a button, outside the window. So moves and releases are heard
  // on the whole window, a new press first finishes any drag still open, and a fresh line sweeps
  // away any copy left behind (seen 2026-11-12: words stuck mid-drag).
  lineEl.addEventListener('pointerdown', (e) => {
    if (drag) endDrag();
    const slot = e.target.closest('.jb-seg-wrap.empty');
    if (slot && selected && cur && !cur.done && !cur.busy && segOf(selected) === slot.dataset.seg) {
      const m = selected;
      select(null);
      cur.moves++;
      moveTile(m, null, false, slot);
      return;
    }
    const tile = e.target.closest('.tile');
    if (!tile || !cur || cur.done || cur.busy || e.button > 0) return;
    drag = { tile, id: e.pointerId, x: e.clientX, y: e.clientY, moving: false, nu: e.target.closest('.nu') };
    try { tile.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer: no capture */ }
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moving) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6 || !canMove(drag.tile)) return;
      drag.moving = true;
      select(null);
      const r = drag.tile.getBoundingClientRect();
      const g = drag.tile.cloneNode(true);
      g.classList.add('ghost');
      g.removeAttribute('tabindex');
      const src = drag.tile.querySelectorAll('.nu'), dst = g.querySelectorAll('.nu');
      src.forEach((n, i) => { dst[i]._t = n._t; dst[i]._o = n._o; dst[i].dataset.m = n.dataset.m || ''; });
      Object.assign(g.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px' });
      document.body.append(g);
      drag.ghost = g;
      drag.dx = e.clientX - r.left;
      drag.dy = e.clientY - r.top;
      drag.tile.classList.add('placeholder');
      cur.moves++;
    }
    drag.ghost.style.left = e.clientX - drag.dx + 'px';
    drag.ghost.style.top = e.clientY - drag.dy + 'px';
    placeAt(drag.tile, e.clientX, e.clientY);
  });
  function endDrag(e) {
    if (!drag || (e && e.pointerId !== undefined && e.pointerId !== drag.id)) return;
    const d = drag;
    drag = null;
    if (e && e.type === 'pointercancel' && !d.moving) return;
    if (!d.moving) {                                   // a tap
      // with a word picked up, a tap on another word of its stretch puts it there, vowel or not
      const moving = selected && selected !== d.tile && segOf(selected) === segOf(d.tile);
      if (mode === 'blind' && d.nu && !cur.done && !moving) cycleMark(d.nu);
      else if (canMove(d.tile)) tapTile(d.tile);
      return;
    }
    const r = d.tile.getBoundingClientRect();
    d.ghost.classList.add('landing');
    d.ghost.style.left = r.left + 'px';
    d.ghost.style.top = r.top + 'px';
    setTimeout(() => { d.ghost.remove(); d.tile.classList.remove('placeholder'); }, reduced ? 0 : 140);
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', () => endDrag());           // let go outside the browser
  // any copy or placeholder a lost drag left behind
  function sweepDrags() {
    drag = null;
    document.querySelectorAll('.tile.ghost').forEach((g) => g.remove());
    lineEl.querySelectorAll('.tile.placeholder').forEach((t) => t.classList.remove('placeholder'));
  }

  // move `tile` to where the pointer is, among the tiles of its own stretch between punctuation
  function placeAt(tile, x, y) {
    const seg = segOf(tile);
    const sibs = segTiles(seg).filter((t) => t !== tile);
    const slots = partsOf(seg).filter((p) => !p.querySelector('.tile'));
    let best = null, bestD = Infinity;
    const near = (r) => Math.abs(y - (r.top + r.height / 2)) * 3 + Math.abs(x - (r.left + r.width / 2));
    sibs.forEach((t) => {
      const r = t.getBoundingClientRect(), d = near(r);
      if (d < bestD) { bestD = d; best = { t, after: x > r.left + r.width / 2 }; }
    });
    slots.forEach((p) => {
      const d = near(p.getBoundingClientRect());
      if (d < bestD) { bestD = d; best = { part: p }; }
    });
    if (!best) return;
    // nothing to do if that is where it is already
    if (best.part ? tile.parentNode === best.part
      : (best.after ? best.t.nextElementSibling === tile : best.t.previousElementSibling === tile)) return;
    if (best.part) moveTile(tile, null, false, best.part);
    else moveTile(tile, best.t, best.after);
  }

  // put `tile` just before (or after) `target`, a tile of its segment, in target's line -- or at the
  // end of `part`, an (empty) part of its segment. Nothing else moves line. FLIP: the others glide.
  function moveTile(tile, target, after, part) {
    if (tile === target) return;
    const all = tiles();
    const before = new Map(all.map((t) => [t, t.getBoundingClientRect()]));
    const seg = segOf(tile);
    if (part) part.append(tile);
    else target.parentNode.insertBefore(tile, after ? target.nextSibling : target);
    markEmpty(seg);
    if (!reduced) {
      all.forEach((t) => {
        if (t === tile && drag) return;
        const a = before.get(t), b = t.getBoundingClientRect();
        const dx = a.left - b.left, dy = a.top - b.top;
        if (!dx && !dy) return;
        t.classList.remove('flip');
        t.style.transform = `translate(${dx}px, ${dy}px)`;
        requestAnimationFrame(() => { t.classList.add('flip'); t.style.transform = ''; });
      });
    }
    // the marks change at once -- on the moved word (or the copy under the finger) and on any neighbour
    // it affects; the swooshes wait until the words have glided into place, then draw themselves in
    refresh(true, !reduced);
    setTimeout(() => {
      if (cur && cur.scan && (mode === 'scanned' || cur.done)) drawSwooshes(orderNow(), cur.scan, true);
    }, reduced ? 0 : 190);
    hideVerdictIfWrong();
  }

  // tap one word, then another: the first moves to the second's place
  function select(t) {
    if (selected) selected.classList.remove('selected');
    selected = t;
    if (t) t.classList.add('selected');
  }
  function tapTile(t) {
    if (!selected) { select(t); return; }
    if (selected === t) { select(null); return; }
    if (segOf(selected) !== segOf(t)) { select(t); return; }
    const sibs = segTiles(segOf(t));
    const from = sibs.indexOf(selected), to = sibs.indexOf(t);
    const mover = selected;
    select(null);
    cur.moves++;
    moveTile(mover, t, from < to);
  }

  lineEl.addEventListener('keydown', (e) => {
    const t = e.target.closest('.tile');
    if (!t || !canMove(t)) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const right = e.key === 'ArrowRight';
      const nb = right ? t.nextElementSibling : t.previousElementSibling;
      const parts = partsOf(segOf(t)), pi = parts.indexOf(t.parentNode);
      const over = parts[pi + (right ? 1 : -1)];          // the clause's part in the next/previous line
      if (!nb && !over) return;
      e.preventDefault();
      cur.moves++;
      if (nb) moveTile(t, nb, right);
      else if (right && over.firstElementChild) moveTile(t, over.firstElementChild, false);
      else moveTile(t, null, false, over);                 // to the end of the line before, or an empty slot
      t.focus();
    }
  });

  // unscanned: the student's own marks, for reference only
  function cycleMark(nu) {
    const tile = nu.closest('.tile'), w = cur.words[+tile.dataset.id];
    const isLast = +nu.dataset.k === w.n.length - 1 && !w.est || (w.est && +nu.dataset.k === 0);
    const seq = isLast ? ['', 'L', 'S', 'X'] : ['', 'L', 'S'];
    const now = nu.dataset.m || '';
    const nxt = seq[(seq.indexOf(now) + 1) % seq.length];
    if (now === 'X') setTail(tile, false, true);
    if (nxt === 'X') { setMark(nu, 'X', true); if (!w.est) setTail(tile, true, true); else nu.closest('.tail').classList.add('gone'); }
    else { if (w.est) nu.closest('.tail').classList.remove('gone'); setMark(nu, nxt, true); }
  }

  // ---- choosing a line ---------------------------------------------------------------------------
  function filterPool() {
    const lvl = $('jb-level').value, pas = $('jb-passage').value;
    pool = (lvl === 'sentences' ? DATA.sentences || [] : DATA.lines).filter((l) => !dead.has(l.c)
      && (!pas || l.p === pas) && (lvl === 'mixed' || lvl === 'sentences' || (lvl === 'plain' ? l.e === 0 : l.e > 0)));
  }
  function pick() {
    const fresh = pool.filter((l) => !(S.lines[l.c] && S.lines[l.c][mode]) && l.c !== lastCite);
    const from = fresh.length ? fresh : pool.filter((l) => l.c !== lastCite);
    return (from.length ? from : pool)[Math.floor(Math.random() * (from.length || pool.length))];
  }

  function start(line, keepOrder) {
    if (!line) {
      lineEl.replaceChildren();
      $('jb-hint').textContent = 'No lines here: choose another passage or kind of line.';
      return;
    }
    const words = J.wordsOf(line);
    let order = keepOrder || J.jumble(line);
    if (!order) { dead.add(line.c); filterPool(); start(pick()); return; }
    lastCite = line.c;
    cur = { line, words, wrong: 0, done: false, busy: false, moves: 0, shown: false, started: Date.now() };
    build(order);
    cur.next = null;
    refresh(false);
    $('jb-cite').textContent = line.c;
    $('jb-passname').textContent = '· ' + line.p;
    const rec = S.lines[line.c];
    $('jb-solved').hidden = !(rec && rec[mode]);
    $('jb-verdict').hidden = true;
    lineEl.classList.remove('locked', 'won', 'shake');
    $('jb-lock').disabled = false;
    $('jb-reshuffle').disabled = false;
    $('jb-show').disabled = false;
    $('jb-hint').textContent = (mode === 'blind'
      ? 'Drag the words (or tap one, then where it goes). Tap a vowel to mark it, for your own reference.'
      : 'Drag the words (or tap one, then where it goes). The marks follow the words.')
      + (line.rows ? ' Where a clause runs over the end of a line, its words can move into the next line.' : '');
    history.replaceState(null, '', `${location.pathname}?line=${encodeURIComponent(line.c)}`);
  }

  // ---- lock in -----------------------------------------------------------------------------------
  const drums = () => $('jb-drums').checked;
  function roll(then) {
    lineEl.classList.add('rolling');
    const done = () => { lineEl.classList.remove('rolling'); then(); };
    if (drums() && window.Rhythm && Rhythm.play(Array(9).fill('S'), null, done, null, { beat: 0.045 })) return;
    setTimeout(done, reduced ? 0 : 420);
  }
  function sing(order, sc, onEnd, reveal) {
    const sy = sc.sylls;
    const nuOf = (s) => tileOf(order[s.w].id).querySelector(`.nu[data-k="${s.n}"]`);
    const accents = sy.map((s) => order[s.w].ac === s.n);
    const beat = (i) => {
      const nu = nuOf(sy[i]);
      if (reveal) setMark(nu, sy[i].m, true);
      nu.classList.add('beat');
      setTimeout(() => nu.classList.remove('beat'), 170);
    };
    if (drums() && window.Rhythm && Rhythm.play(sy.map((s) => s.m), beat, onEnd, accents)) return;
    if (reveal) sy.forEach((s, i) => setTimeout(() => setMark(nuOf(s), s.m, true), reduced ? 0 : i * 35));
    setTimeout(onEnd, reduced ? 0 : sy.length * 35 + 100);
  }

  function lock() {
    if (!cur || cur.done || cur.busy) return;
    select(null);
    cur.busy = true;
    const order = orderNow();
    const v = J.judge(cur.line, order, countsNow());
    $('jb-lock').disabled = true;
    roll(() => {
      if (v.right) win(order, v);
      else lose(order, v);
    });
  }

  function win(order, v) {
    const c = cur;
    c.done = true;
    lineEl.classList.add('locked');
    const secs = (Date.now() - c.started) / 1000;
    let pts = 0, already = false, fresh = [];
    update((s) => {
      const rec = s.lines[c.line.c] || (s.lines[c.line.c] = {});
      already = !!rec[mode];
      if (!already) {
        const base = BASE[mode] * J.rowsOf(c.line).length;
        pts = Math.max(Math.round(base / 3), base - 3 * c.wrong);
        rec[mode] = today();
        s.points += pts;
      }
      if (v.exact) rec.exact = 1; else rec.own = 1;
      s.t.locks++; s.t.right++;
      if (v.exact) s.t.exact++; else s.t.own++;
      s.days[today()] = (s.days[today()] || 0) + 1;
      if (c.wrong === 0) bump(s, true);
      fresh = award({ quick: secs <= 20, comeback: c.wrong >= 3 });
    });
    // the true scansion -- in the unscanned mode it lands with the drums
    const sc = J.scanItem(c.line, order, countsNow());
    c.scan = sc;
    if (mode === 'blind') order.forEach((w) => tileOf(w.id).querySelectorAll('.nu').forEach((nu) => { nu.classList.add('truth'); setMark(nu, '', false); }));
    if (mode === 'blind') {
      order.forEach((w, i) => {
        const tile = tileOf(w.id);
        setTail(tile, sc.marks[i][w.n.length - 1] === 'X' && !w.est, true);
        if (w.est) tile.querySelector('.tail').classList.toggle('gone', sc.marks[i][0] === 'X');
      });
      drawSwooshes(order, sc, true);
    }
    tiles().forEach((t, i) => t.style.setProperty('--i', i));
    lineEl.classList.add('won');
    drawBars(v.meter);
    sing(order, sc, () => { c.busy = false; }, mode === 'blind');
    showWin(order, v, pts, already);
    fresh.forEach((b, i) => setTimeout(() => toast('★ ' + b.title + ' — ' + b.desc), 600 + i * 900));
    $('jb-solved').hidden = false;
    $('jb-reshuffle').disabled = true;
    $('jb-show').disabled = true;
    paintPoints();
    $('jb-next').focus();
  }

  function bump(s, right) {
    const k = mode === 'blind' ? 'blindStreak' : 'streak';
    for (const key of k === 'streak' ? ['streak'] : ['streak', 'blindStreak']) {
      if (right) { s[key].cur++; s[key].best = Math.max(s[key].best, s[key].cur); } else s[key].cur = 0;
    }
  }

  function lose(order, v) {
    const c = cur;
    update((s) => {
      s.t.locks++; s.t.wrong++;
      if (c.wrong === 0) bump(s, false);
    });
    c.wrong++;
    lineEl.classList.remove('shake');
    void lineEl.offsetWidth;
    lineEl.classList.add('shake');
    const after = () => { c.busy = false; $('jb-lock').disabled = false; };
    // scanned: hear it limp. unscanned: no rhythm -- it would give the scansion away
    if (mode === 'scanned' && drums() && window.Rhythm) sing(order, v.meter.scan, after, false);
    else after();
    showLose(order, v);
  }

  // ---- the verdict -------------------------------------------------------------------------------
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const q = (w) => `<b lang="la">${esc(w.w)}</b>`;
  function lineText(order, poet) {
    // the words in this order, with the punctuation where it stands, a line to a row; words the
    // student moved off the poet's place are shaded in the comparison
    let idx = 0;
    return J.rowsOf(cur.line).map((row) => row.map((t) => {
      if (typeof t === 'string') return esc(t);
      const w = order[idx], moved = poet && w.id !== cur.words[idx].id;
      idx++;
      return ' ' + (moved ? `<span class="moved">${esc(w.w)}</span>` : esc(w.w));
    }).join('').trim().replace(/ ([,.;:!?])/g, '$1')).join('<br>');
  }
  // the student's lines as they stand on the page, moved words shaded
  function yourText() {
    let idx = 0;
    return [...lineEl.querySelectorAll('.jb-row')].map((row) => [...row.children].map((el) => {
      if (el.classList.contains('wall')) return esc(el.textContent);
      if (!el.classList.contains('jb-seg-wrap')) return '';
      return [...el.querySelectorAll('.tile')].map((t) => {
        const w = cur.words[+t.dataset.id], moved = w.id !== cur.words[idx].id;
        idx++;
        return ' ' + (moved ? `<span class="moved">${esc(w.w)}</span>` : esc(w.w));
      }).join('');
    }).join('').trim().replace(/ ([,.;:!?])/g, '$1')).join('<br>');
  }
  const footText = (ft) => ft.map((f) => (f === 'LSS' ? '¯ ˘ ˘' : f === 'LL' ? '¯ ¯' : '¯ ' + (f[1] === 'S' ? '˘' : '¯'))).join(' | ');
  function showWin(order, v, pts, already) {
    const el = $('jb-verdict');
    el.className = 'jb-verdict ok';
    const poet = POET(cur.line.c);
    const many = v.meter.rows.length > 1;
    const what = many ? `${v.meter.rows.length} hexameters` : 'A hexameter';
    let html = v.exact
      ? `<h3>${what} — exactly as ${poet} wrote ${many ? 'them' : 'it'}!</h3>`
      : `<h3>${what}! Not quite ${poet}'s order, but ${many ? 'they scan' : 'it scans'} and ${many ? 'read' : 'reads'}.</h3>
         <dl class="jb-compare"><dt>Yours</dt><dd lang="la">${yourText()}</dd>
         <dt>${poet}</dt><dd lang="la">${lineText(cur.words, false)}</dd></dl>`;
    html += many
      ? `<p>${v.meter.rows.map((r, i) => `Line ${i + 1}: ${footText(r.feet)}`).join('<br>')}</p>`
      : `<p>Feet: ${footText(v.meter.rows[0].feet)}.</p>`;
    html += already ? `<p>You had solved this ${many ? 'sentence' : 'line'} before in this mode: no new points.</p>`
      : `<p><span class="jb-pts">+${pts} points</span>${cur.wrong ? ` (${cur.wrong} wrong lock-in${cur.wrong > 1 ? 's' : ''} first)` : ' — first try!'}</p>`;
    el.innerHTML = html;
    el.hidden = false;
  }
  const RULES = {
    group: (f) => `${q(f.words[0])} belongs to an earlier clause than ${q(f.words[1])}: keep each clause's words together, in their order.`,
    opener: (f) => `${q(f.words[0])} begins what it introduces: ${f.words[0].j ? 'move it nearer the front' : 'at most two words may come in front of it'}.`,
    second: (f) => `${q(f.words[0])} stands second in its clause (or third), never first.`,
    after: (f) => `${q(f.words[0])} goes right after the word it emphasizes: ${q(f.words[1])}.`,
    prep: (f) => `${q(f.words[0])} needs its noun, ${q(f.words[1])}, right after it — or a word agreeing with that noun, with the noun close by.`,
    neg: (f) => `${q(f.words[0])} comes before the word it goes with, ${q(f.words[1])} — or before the verb.`,
    phrase: (f) => `${q(f.words[0])} belongs before ${q(f.words[1])}: what <i>et</i>, <i>nec</i> or <i>-que</i> join stays in its order.`,
    voc: (f) => `${q(f.words[0])} comes before the person addressed: ${q(f.words[1])}.`,
    indef: (f) => `${q(f.words[0])} here means "any": it comes after ${q(f.words[1])}.`,
  };
  function brokenFoot(pattern, spondaicFifth) {
    let i = 0;
    for (let f = 0; f < 6; f++) {
      if (pattern[i] !== 'L') return f + 1;
      if (f === 5) return pattern.length === i + 2 ? 0 : 6;
      if (pattern[i + 1] === 'S' && pattern[i + 2] === 'S') i += 3;
      else if (pattern[i + 1] === 'L' && (f < 4 || spondaicFifth)) i += 2;
      else return f + 1;
    }
    return 6;
  }
  function showLose(order, v) {
    const el = $('jb-verdict');
    el.className = 'jb-verdict bad';
    let html;
    if (!v.meter.ok) {
      const rows = v.meter.rows, many = rows.length > 1;
      const r = rows.findIndex((x) => !x.feet);
      const f5 = Array.isArray(cur.line.f5) ? cur.line.f5[r] : cur.line.f5;
      const f = brokenFoot(rows[r].pattern, f5 === 'LL');
      const where = `${['first', 'second', 'third', 'fourth', 'fifth', 'sixth'][f - 1] || 'last'} foot${f === 5 ? ' (the fifth foot is almost always ¯ ˘ ˘)' : ''}`;
      html = mode === 'scanned'
        ? (many ? `<h3>Line ${r + 1} is not a hexameter yet.</h3><p>It goes wrong in the ${where}.</p>`
          : `<h3>Not a hexameter yet.</h3><p>It goes wrong in the ${where}.</p>`)
        : `<h3>${many ? 'Not every line scans yet.' : "That order doesn't scan."}</h3><p>Try marking a few syllables: the last two feet, ¯ ˘ ˘ | ¯ ¯, are a good place to start.</p>`;
    } else {
      html = `<h3>It scans! But the Latin doesn't read that way.</h3><p>${RULES[v.faults[0].rule](v.faults[0])}</p>`;
    }
    html += `<p class="jb-try">Move some words and lock in again${cur.wrong >= 2 ? ', or show the answer' : ''}.</p>`;
    el.innerHTML = html;
    el.hidden = false;
  }
  function hideVerdictIfWrong() {
    const el = $('jb-verdict');
    if (!el.hidden && el.classList.contains('bad')) el.hidden = true;
  }

  // give up: the words glide into the poet's order
  function showAnswer() {
    if (!cur || cur.done || cur.busy) return;
    const c = cur;
    c.done = c.shown = true;
    update((s) => { s.t.shown++; bump(s, false); });
    const all = tiles();
    const before = new Map(all.map((t) => [t, t.getBoundingClientRect()]));
    [...new Set(c.words.map((w) => w.s))].forEach((sg) => fill(sg, c.words.filter((w) => w.s === sg).map((w) => tileOf(w.id))));
    if (!reduced) all.forEach((t) => {
      const a = before.get(t), b = t.getBoundingClientRect();
      t.classList.remove('flip');
      t.style.transform = `translate(${a.left - b.left}px, ${a.top - b.top}px)`;
      requestAnimationFrame(() => { t.classList.add('flip'); t.style.transform = ''; });
    });
    setTimeout(() => {
      const sc = J.scanItem(c.line, c.words);
      if (mode === 'blind') all.forEach((t) => t.querySelectorAll('.nu').forEach((nu) => { nu.classList.add('truth'); setMark(nu, '', false); }));
      refresh(true);
      drawBars(J.meter(c.line, c.words));
      sing(c.words, sc, () => {}, mode === 'blind');
    }, reduced ? 0 : 220);
    lineEl.classList.add('locked');
    const el = $('jb-verdict');
    el.className = 'jb-verdict';
    el.innerHTML = `<h3>${POET(c.line.c)}'s ${c.line.rows ? 'lines' : 'line'}</h3><p lang="la">${lineText(c.words, false)}</p><p>No points this time; the next one's yours.</p>`;
    el.hidden = false;
    $('jb-lock').disabled = true;
    $('jb-reshuffle').disabled = true;
    $('jb-show').disabled = true;
  }

  // ---- stats -------------------------------------------------------------------------------------
  function paintPoints() { $('jb-points').textContent = S.points ? `${S.points} pts` : ''; }
  function toast(text) {
    const t = document.createElement('div');
    t.className = 'jb-toast';
    t.textContent = text;
    $('jb-toasts').append(t);
    setTimeout(() => t.remove(), 3300);
  }
  function openStats() {
    S = read();
    const num = (n, label) => `<div class="jb-num"><b>${n}</b><span>${label}</span></div>`;
    const pct = S.t.locks ? Math.round(100 * S.t.right / S.t.locks) : 0;
    const body = `<h2>My jumbles</h2>
      <div class="jb-nums">
        ${num(S.points, 'points')}
        ${num(solvedAny(), 'lines unjumbled')}
        ${num(solvedIn('scanned'), 'solved scanned')}
        ${num(solvedIn('blind'), 'solved unscanned')}
        ${num(S.t.exact, "the poet's own order")}
        ${num(S.t.own, 'hexameters of your own')}
        ${num(S.streak.cur + ' / ' + S.streak.best, 'first-try streak / best')}
        ${num(pct + '%', 'lock-ins that were right')}
      </div>
      <h3>Badges (${BADGES.filter((b) => S.badges[b.id]).length} of ${BADGES.length})</h3>
      <div class="jb-badges">${BADGES.map((b) => S.badges[b.id]
        ? `<div class="jb-badge have"><b>★ ${esc(b.title)}</b>${esc(b.desc)}<br><small>${S.badges[b.id]}</small></div>`
        : `<div class="jb-badge locked"><b>☆ ${esc(b.title)}</b>${esc(b.desc)}</div>`).join('')}</div>`;
    $('jb-modal-body').innerHTML = body;
    $('jb-modal').showModal();
  }
  $('jb-stats').addEventListener('click', openStats);
  $('jb-close').addEventListener('click', () => $('jb-modal').close());
  $('jb-reset').addEventListener('click', () => {
    if (!confirm('Erase all your jumbles points, badges and solved lines? This cannot be undone.')) return;
    const prefs = S.prefs;
    S = fresh({ prefs });
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* nothing kept */ }
    $('jb-modal').close();
    paintPoints();
  });

  // ---- controls ----------------------------------------------------------------------------------
  function setMode(m) {
    mode = m;
    update((s) => { s.prefs.mode = m; });
    document.querySelectorAll('.jb-opt').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === m)));
  }
  document.querySelectorAll('.jb-opt').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.mode === mode) return;
    setMode(b.dataset.mode);
    if (cur && !cur.done) start(cur.line, orderNow()); else start(pick());
  }));
  $('jb-level').addEventListener('change', () => { update((s) => { s.prefs.level = $('jb-level').value; }); filterPool(); start(pick()); });
  $('jb-passage').addEventListener('change', () => { update((s) => { s.prefs.passage = $('jb-passage').value; }); filterPool(); start(pick()); });
  $('jb-drums').addEventListener('change', () => update((s) => { s.prefs.drums = $('jb-drums').checked; }));
  $('jb-lock').addEventListener('click', lock);
  $('jb-next').addEventListener('click', () => { if (window.Rhythm) Rhythm.stop(); start(pick()); });
  $('jb-reshuffle').addEventListener('click', () => { if (cur && !cur.done && !cur.busy) start(cur.line); });
  $('jb-show').addEventListener('click', showAnswer);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || e.target.closest('button, select, input, a, dialog')) return;
    e.preventDefault();
    if (cur && cur.done) start(pick()); else lock();
  });
  let resizeT = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      if (!cur || !cur.scan) return;
      if (mode === 'scanned' || cur.done) drawSwooshes(orderNow(), cur.scan, false);
      if (cur.done) drawBars(J.meter(cur.line, orderNow(), countsNow()));
    }, 120);
  });

  fetch('data/jumbles.json', { cache: 'no-cache' })
    .then((r) => r.json())
    .then((d) => {
      DATA = d;
      const passages = [...new Map(d.lines.map((l) => [l.p, l.po])).entries()].sort((a, b) => a[1] - b[1]);
      passages.forEach(([p]) => { const o = document.createElement('option'); o.value = o.textContent = p; $('jb-passage').append(o); });
      $('jb-level').value = pref('level', 'plain');
      $('jb-passage').value = pref('passage', '');
      if ($('jb-passage').value !== pref('passage', '')) $('jb-passage').value = '';
      $('jb-drums').checked = pref('drums', true);
      $('jb-nostore').hidden = storageOK;
      setMode(mode);
      paintPoints();
      filterPool();
      const asked = new URLSearchParams(location.search).get('line');
      const line = asked && d.lines.concat(d.sentences || []).find((l) => l.c === asked);
      // a link to a sentence opens the sentences; a link to a line leaves the menu as it was
      if (line && line.rows && $('jb-level').value !== 'sentences') { $('jb-level').value = 'sentences'; filterPool(); }
      start(line || pick());
    })
    .catch((err) => {
      console.error(err);
      $('jb-error').textContent = 'The jumbles could not be loaded. Try reloading the page.';
      $('jb-error').hidden = false;
      $('jb-card').hidden = true;
    });
})();
