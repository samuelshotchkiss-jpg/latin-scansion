// Latin Scansion -- the rhythm of a scanned line, played on two drums. AGPL-3.0 (see COPYRIGHT.md).
//
// A long syllable is DUM, a low drum, and lasts two beats; a short one is di, a higher tap, and lasts
// one -- so a dactyl is DUM-di-di and a spondee DUM-dum, each foot the same length. The first long of
// every foot (where the beat falls) is struck harder. Elided syllables are silent.
//
// A soft cymbal marks each WORD ACCENT (the scanner's `accent`, from word end and syllable weight). Where
// the beat and the accent fall together -- as they usually do in the last two feet -- drum and cymbal
// sound at once; where they pull apart, you hear the cymbal off the beat.
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
  // A cymbal: a long hiss of noise, filtered high so it shimmers, kept quiet under the drums.
  let noise = null;
  function noiseBuffer() {
    if (!noise) {
      noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.2), ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let k = 0; k < d.length; k++) d[k] = Math.random() * 2 - 1;
    }
    return noise;
  }
  function cymbal(t) {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    const peak = ctx.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = 9000;
    peak.gain.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    n.connect(hp).connect(peak).connect(g).connect(ctx.destination);
    n.start(t);
    n.stop(t + 1.05);
    sources.push(n);
  }
  // A ride cymbal: a short, faint metallic tick (noise through a narrow band high up), for counting out the
  // subdivisions under the drums. Much quieter and shorter than the accent cymbal, so the two stay distinct.
  function ride(t, level) {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuffer();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 7500;
    bp.Q.value = 1.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    n.connect(bp).connect(g).connect(ctx.destination);
    n.start(t);
    n.stop(t + 0.2);
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
  // onEnd() when the line is over. accents[i] true: syllable i carries its word's accent (cymbal).
  // Returns false if this browser has no Web Audio.
  //
  // An optional fifth argument { ctx, at, beat } lets the live game's teacher page lay the line over music:
  //   ctx   the AudioContext to use (the page's own, so music and drums share one clock; used only if no
  //         context has been made yet)
  //   at    the context time (seconds, ctx.currentTime's clock) at which the first syllable sounds
  //   beat  seconds per short syllable (default BEAT, 0.2); a long takes two
  //   ride  true: a faint ride cymbal ticks every short-syllable beat for the whole line, under the longs too,
  //         so the subdivision of music with strong eighth notes carries on through the line
  // Called with four arguments, or with none of these keys, it behaves exactly as it always has.
  function play(marks, onBeat, onEnd, accents, opts) {
    stop();
    if (opts && opts.ctx && !ctx) ctx = opts.ctx;
    if (!audio()) return false;
    const beat = (opts && opts.beat) || BEAT;
    const ictus = beats(marks);
    const scheduled = !!(opts && typeof opts.at === 'number');
    // the old way starts 0.12 s from now; a scheduled start is the given time, never in the past
    let t = scheduled ? Math.max(opts.at, ctx.currentTime + 0.02) : ctx.currentTime + 0.12;
    const start = t;
    const lead = scheduled ? t - ctx.currentTime : 0.12;     // seconds from now until the first syllable
    marks.forEach((m, i) => {
      if (m === 'X') return;
      const len = m === 'L' ? 2 * beat : beat;
      if (m === 'L') dum(t, ictus.has(i)); else di(t);
      if (accents && accents[i]) cymbal(t);
      const at = (t - start + lead) * 1000;
      timers.push(setTimeout(() => onBeat && onBeat(i, len), at));
      t += len;
    });
    if (opts && opts.ride) {
      // one tick per beat from the first syllable to the line's end; a little stronger on the long-syllable grid
      const n = Math.round((t - start) / beat);
      for (let k = 0; k < n; k++) ride(start + k * beat, k % 2 === 0 ? 0.15 : 0.11);
    }
    timers.push(setTimeout(() => onEnd && onEnd(), (t - start + lead) * 1000 + 150));
    return true;
  }

  // How long a line lasts in seconds at a given beat: a long is two beats, a short one, an elision none.
  function length(marks, beat) {
    return marks.reduce((sum, m) => sum + (m === 'L' ? 2 : m === 'S' ? 1 : 0), 0) * (beat || BEAT);
  }

  // The shared AudioContext (made on first use; may start suspended until a click or key), so that other
  // sound on the page, such as the live game's music, can run on the same clock as the drums.
  function context() { return audio(); }

  return { play, stop, length, context };
})();
