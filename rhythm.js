// Latin Scansion -- the rhythm of a scanned line, played on two drums. AGPL-3.0 (see COPYRIGHT.md).
//
// A long syllable is DUM, a low drum, and lasts two beats; a short one is di, a higher tap, and lasts
// one -- so a dactyl is DUM-di-di and a spondee DUM-dum, each foot the same length. The first long of
// every foot (where the beat falls) is struck harder. Elided syllables are silent.
//
// Everything is synthesized in the browser (Web Audio): no sound files to download. The drums are
// pitched well above a kick drum's, because a phone's speaker cannot play the low end.
//
// On an iPhone, the silent switch mutes this, as it mutes other sounds from web pages. That is on
// purpose here: a classroom of phones on silent stays silent.
window.Rhythm = (function () {
  'use strict';

  const BEAT = 0.2;          // seconds per short syllable; a long takes two
  let ctx = null;
  let timers = [];
  let sources = [];

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();     // browsers start it paused until a tap or click
    return ctx;
  }

  // A pitched drum: a quick fall in pitch and a fast decay, with a click of noise on the attack.
  function drum(t, hi, lo, length, level) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(hi, t);
    o.frequency.exponentialRampToValueAtTime(lo, t + length * 0.6);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + length + 0.02);
    sources.push(o);

    const n = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.02), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let k = 0; k < d.length; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / d.length);
    n.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = hi * 6;
    const ng = ctx.createGain();
    ng.gain.value = level * 0.5;
    n.connect(f).connect(ng).connect(ctx.destination);
    n.start(t);
    sources.push(n);
  }
  const dum = (t, strong) => drum(t, strong ? 230 : 200, 95, 0.32, strong ? 0.9 : 0.6);
  const di = (t) => drum(t, 520, 380, 0.1, 0.45);

  // Which long syllables begin a foot: walk the marks as dactyls (L S S) and spondees (L L).
  function beats(marks) {
    const seq = marks.map((m, i) => ({ m, i })).filter((x) => x.m !== 'X');
    const ictus = new Set();
    let p = 0;
    while (p < seq.length) {
      if (seq[p].m !== 'L') { p++; continue; }
      ictus.add(seq[p].i);
      p += seq[p + 1] && seq[p + 1].m === 'S' ? 3 : 2;
    }
    return ictus;
  }

  function stop() {
    timers.forEach(clearTimeout);
    timers = [];
    sources.forEach((s) => { try { s.stop(); } catch (e) { /* already done */ } });
    sources = [];
  }

  // Play marks ('L', 'S' or 'X', one per syllable). onBeat(i, seconds) fires as syllable i sounds;
  // onEnd() when the line is over. Returns false if this browser has no Web Audio.
  function play(marks, onBeat, onEnd) {
    stop();
    if (!audio()) return false;
    const ictus = beats(marks);
    let t = ctx.currentTime + 0.12;
    const start = t;
    marks.forEach((m, i) => {
      if (m === 'X') return;
      const len = m === 'L' ? 2 * BEAT : BEAT;
      if (m === 'L') dum(t, ictus.has(i)); else di(t);
      const at = (t - start + 0.12) * 1000;
      timers.push(setTimeout(() => onBeat && onBeat(i, len), at));
      t += len;
    });
    timers.push(setTimeout(() => onEnd && onEnd(), (t - start + 0.12) * 1000 + 150));
    return true;
  }

  return { play, stop };
})();
