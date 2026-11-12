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
    { id: 'day20', title: 'Twenty in a day', desc: 'Twenty lines solved in one day.', test: () => (S.days[today()] || 0) >= 20 },
    { id: 'days3', title: 'Three days', desc: 'Jumbles on three different days.', test: () => Object.keys(S.days).length >= 3 },
  ];
  function counts(extra) {
    const solved = DATA.lines.filter((l) => S.lines[l.c] && (S.lines[l.c].scanned || S.lines[l.c].blind));
    return Object.assign({
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
    let seg = -1;
    cur.line.t.forEach((t) => {
      if (typeof t === 'string') {
        const wl = document.createElement('span');
        wl.className = 'wall';
        wl.textContent = t;
        lineEl.append(wl);
        return;
      }
      if (t.s === seg) return;
      seg = t.s;
      const box = document.createElement('span');
      box.className = 'jb-seg-wrap';
      box.dataset.seg = seg;
      const ws = bySeg.get(seg) || [];
      ws.forEach((w) => {
        const tile = tileFor(w);
        if (ws.length < 2) tile.classList.add('fixed');
        box.append(tile);
      });
      lineEl.append(box);
    });
    const ov = document.createElementNS(SVGNS, 'svg');
    ov.setAttribute('class', 'jb-swooshes');
    ov.setAttribute('aria-hidden', 'true');
    lineEl.append(ov);
    lineEl.classList.toggle('blind', mode === 'blind');
  }

  const tiles = () => [...lineEl.querySelectorAll('.tile:not(.ghost)')];
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
    const sc = J.scan(order);
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
    let k = 0;
    const st = [];
    m.feet.forEach((f) => { st.push(k); k += f.length; });
    const line = (x, y1, y2, cls) => {
      const l = document.createElementNS(SVGNS, 'line');
      l.setAttribute('x1', x); l.setAttribute('x2', x); l.setAttribute('y1', y1); l.setAttribute('y2', y2);
      l.setAttribute('class', cls);
      ov.append(l);
    };
    st.slice(1).forEach((j) => {
      const A = center(nuOf(sy[j - 1])), B = center(nuOf(sy[j]));
      if (Math.abs(A.y - B.y) > 8) return;
      line((A.x + B.x) / 2, B.top - 18, B.top - 4, 'bar');
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
      const moving = selected && selected !== d.tile && selected.parentNode === d.tile.parentNode;
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
    const box = tile.parentNode;
    const sibs = [...box.children].filter((t) => t !== tile);
    if (!sibs.length) return;
    let best = null, bestD = Infinity;
    sibs.forEach((t) => {
      const r = t.getBoundingClientRect();
      const cy = r.top + r.height / 2, cx = r.left + r.width / 2;
      const d = Math.abs(y - cy) * 3 + Math.abs(x - cx);
      if (d < bestD) { bestD = d; best = { t, after: x > cx }; }
    });
    const ref = best.after ? best.t.nextSibling : best.t;
    if (ref === tile || (ref === null && box.lastChild === tile) || tile.nextSibling === ref) return;
    moveTile(tile, ref);
  }

  // FLIP: the other tiles glide to their new places
  function moveTile(tile, ref) {
    const all = tiles();
    const before = new Map(all.map((t) => [t, t.getBoundingClientRect()]));
    tile.parentNode.insertBefore(tile, ref);
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
    if (selected.parentNode !== t.parentNode) { select(t); return; }
    const sibs = [...t.parentNode.children];
    const from = sibs.indexOf(selected), to = sibs.indexOf(t);
    const mover = selected;
    select(null);
    cur.moves++;
    moveTile(mover, from < to ? t.nextSibling : t);
  }

  lineEl.addEventListener('keydown', (e) => {
    const t = e.target.closest('.tile');
    if (!t || !canMove(t)) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const sibs = [...t.parentNode.children], i = sibs.indexOf(t);
      const j = e.key === 'ArrowLeft' ? i - 1 : i + 1;
      if (j < 0 || j >= sibs.length) return;
      e.preventDefault();
      cur.moves++;
      moveTile(t, e.key === 'ArrowLeft' ? sibs[j] : sibs[j].nextSibling);
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
    pool = DATA.lines.filter((l) => !dead.has(l.c) && (!pas || l.p === pas)
      && (lvl === 'mixed' || (lvl === 'plain' ? l.e === 0 : l.e > 0)));
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
    $('jb-hint').textContent = mode === 'blind'
      ? 'Drag the words (or tap one, then where it goes). Tap a vowel to mark it, for your own reference.'
      : 'Drag the words (or tap one, then where it goes). The marks follow the words.';
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
    const v = J.judge(cur.line, order);
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
        pts = Math.max(Math.round(BASE[mode] / 3), BASE[mode] - 3 * c.wrong);
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
    const sc = J.scan(order);
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
    // the words in this order, with the punctuation where it stands; words the student moved off the
    // poet's place are shaded in the comparison
    const bySeg = new Map();
    order.forEach((w) => { if (!bySeg.has(w.s)) bySeg.set(w.s, []); bySeg.get(w.s).push(w); });
    const out = [];
    let seg = -1, idx = 0;
    cur.line.t.forEach((t) => {
      if (typeof t === 'string') { out.push(esc(t)); return; }
      if (t.s === seg) return;
      seg = t.s;
      (bySeg.get(seg) || []).forEach((w) => {
        const moved = poet && w.id !== cur.words[idx].id;
        out.push(' ' + (moved ? `<span class="moved">${esc(w.w)}</span>` : esc(w.w)));
        idx++;
      });
    });
    return out.join('').trim().replace(/ ([,.;:!?])/g, '$1');
  }
  function showWin(order, v, pts, already) {
    const el = $('jb-verdict');
    el.className = 'jb-verdict ok';
    const poet = POET(cur.line.c);
    let html = v.exact
      ? `<h3>A hexameter — exactly as ${poet} wrote it!</h3>`
      : `<h3>A hexameter! Not quite ${poet}'s order, but it scans and it reads.</h3>
         <dl class="jb-compare"><dt>Yours</dt><dd lang="la">${lineText(order, true)}</dd>
         <dt>${poet}</dt><dd lang="la">${lineText(cur.words, false)}</dd></dl>`;
    html += `<p>Feet: ${v.meter.feet.map((f) => (f === 'LSS' ? '¯ ˘ ˘' : f === 'LL' ? '¯ ¯' : '¯ ' + (f[1] === 'S' ? '˘' : '¯'))).join(' | ')}.</p>`;
    html += already ? `<p>You had solved this line before in this mode: no new points.</p>`
      : `<p><span class="jb-pts">+${pts} points</span>${cur.wrong ? ` (${cur.wrong} wrong lock-in${cur.wrong > 1 ? 's' : ''} first)` : ' — first try!'}</p>`;
    el.innerHTML = html;
    el.hidden = false;
  }
  const RULES = {
    group: (f) => `${q(f.words[0])} belongs to an earlier clause than ${q(f.words[1])}: keep each clause's words together, in their order.`,
    opener: (f) => `${q(f.words[0])} begins its clause: at most two words may come in front of it.`,
    second: (f) => `${q(f.words[0])} stands second in its clause (or third), never first.`,
    after: (f) => `${q(f.words[0])} goes right after the word it emphasizes: ${q(f.words[1])}.`,
    prep: (f) => `${q(f.words[0])} needs its noun, ${q(f.words[1])}, right after it — or a word agreeing with that noun, with the noun close by.`,
    neg: (f) => `${q(f.words[0])} comes before the word it goes with: ${q(f.words[1])}.`,
    voc: (f) => `${q(f.words[0])} comes before the person addressed: ${q(f.words[1])}.`,
  };
  function brokenFoot(pattern) {
    let i = 0;
    for (let f = 0; f < 6; f++) {
      if (pattern[i] !== 'L') return f + 1;
      if (f === 5) return pattern.length === i + 2 ? 0 : 6;
      if (pattern[i + 1] === 'S' && pattern[i + 2] === 'S') i += 3;
      else if (pattern[i + 1] === 'L' && (f < 4 || cur.line.f5 === 'LL')) i += 2;
      else return f + 1;
    }
    return 6;
  }
  function showLose(order, v) {
    const el = $('jb-verdict');
    el.className = 'jb-verdict bad';
    let html;
    if (!v.meter.feet) {
      const f = brokenFoot(v.meter.scan.pattern);
      html = mode === 'scanned'
        ? `<h3>Not a hexameter yet.</h3><p>It goes wrong in the ${['first', 'second', 'third', 'fourth', 'fifth', 'sixth'][f - 1] || 'last'} foot${f === 5 ? ' (the fifth foot is almost always ¯ ˘ ˘)' : ''}.</p>`
        : `<h3>That order doesn't scan.</h3><p>Try marking a few syllables: the last two feet, ¯ ˘ ˘ | ¯ ¯, are a good place to start.</p>`;
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
    c.words.forEach((w) => { const t = tileOf(w.id); t.parentNode.append(t); });
    if (!reduced) all.forEach((t) => {
      const a = before.get(t), b = t.getBoundingClientRect();
      t.classList.remove('flip');
      t.style.transform = `translate(${a.left - b.left}px, ${a.top - b.top}px)`;
      requestAnimationFrame(() => { t.classList.add('flip'); t.style.transform = ''; });
    });
    setTimeout(() => {
      const sc = J.scan(c.words);
      if (mode === 'blind') all.forEach((t) => t.querySelectorAll('.nu').forEach((nu) => { nu.classList.add('truth'); setMark(nu, '', false); }));
      refresh(true);
      drawBars(J.meter(c.line, c.words));
      sing(c.words, sc, () => {}, mode === 'blind');
    }, reduced ? 0 : 220);
    lineEl.classList.add('locked');
    const el = $('jb-verdict');
    el.className = 'jb-verdict';
    el.innerHTML = `<h3>${POET(c.line.c)}'s line</h3><p lang="la">${lineText(c.words, false)}</p><p>No points this time; the next one's yours.</p>`;
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
      if (cur.done) drawBars(J.meter(cur.line, orderNow()));
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
      const line = asked && d.lines.find((l) => l.c === asked);
      start(line || pick());
    })
    .catch((err) => {
      console.error(err);
      $('jb-error').textContent = 'The jumbles could not be loaded. Try reloading the page.';
      $('jb-error').hidden = false;
      $('jb-card').hidden = true;
    });
})();
