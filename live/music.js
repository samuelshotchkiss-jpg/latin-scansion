// music.js -- background music for the live game, on the TEACHER'S page only. AGPL-3.0.
//
// Two tracks by Kevin MacLeod (incompetech.com, CC BY 4.0; credits in the page footer and COPYRIGHT.md):
//   venus.mp3   "Vibing Over Venus"  the lobby, and the final breakdown. Looped; no beat grid needed.
//   hustle.mp3  "Hustle"             while a game is played. 120.0 bpm, steady; beats fall at 0.275 + 0.5 k s.
//               The file is 120.555 s long, which is NOT a whole number of beats from the first one (240.56), so
//               looping the whole file would make the beat stumble by 55 ms at every wrap. It is looped between
//               beat 0 (0.275 s) and beat 240 (120.275 s) instead: 60 bars exactly, so the grid never slips.
// Never loaded by live.html: students' devices stay silent (tests/live_static.test.js checks it).
//
// THE IDEA. A hexameter is always twelve beats, three bars of 4/4: rhythm.js plays a long as two BEATs and a
// short as one, and a foot is four of them. Played with BEAT = 0.25 s (half of Hustle's 0.5 s beat), a long is
// one beat of the track and a whole line lasts 6.0 s: exactly three bars. So in the meter game, when a question
// is revealed, Hustle is stopped on a BAR LINE, the line is drummed from that same instant on the SAME
// AudioContext clock, and Hustle comes back after the line (padded with silence to a bar line if the line is
// short or a half-line), carrying on from the place where it stopped, so the groove continues, quieter
// under the reveal (DUCK) and back to full when the next question opens.
//
// ADJUSTING BY EAR. Which of the four beats opens a bar could not be measured (the kick drum falls on all
// four). Change BAR_OFFSET below (0, 1, 2 or 3): a bar line is a beat k where (k + BAR_OFFSET) % 4 === 0,
// counting beats from the track's first beat at 0.275 s. If the drums seem to start "on the wrong beat" of the
// music, try the next number. DUCK is the volume under the reveal (0-1); LEAD is the least warning, in
// seconds, given before the stop so the drums can be scheduled.
//
//   pure part  -- the grid arithmetic (tested with no browser)
//   the page   -- loading, the loops, the Hustle transport (stop on a bar, resume later), mute, the watcher
(function () {
  "use strict";

  const HUSTLE = { first: 0.275, period: 0.5, beatsPerBar: 4 };   // measured in the browser: 120.0 bpm, beat grid starts at 0.275 s
  const BAR_OFFSET = 0;                // 0-3: see "adjusting by ear" above
  const DUCK = 0.4;                    // Hustle's volume under the reveal
  const LEAD = 0.25;                   // seconds of warning before the stop
  const LINE_BEAT = HUSTLE.period / 2; // a hexameter's short syllable lasts half a beat of the track
  const BAR_S = HUSTLE.period * HUSTLE.beatsPerBar;
  const FILES = { venus: "live/audio/venus.mp3", hustle: "live/audio/hustle.mp3" };

  // ---- pure: the grid ------------------------------------------------------------------------------
  // The loop: from the first beat to the last whole bar of beats that fits in the file.
  const loopOf = (dur, g) => { g = g || HUSTLE; const beats = Math.floor((dur - g.first) / g.period / g.beatsPerBar) * g.beatsPerBar; return { start: g.first, end: g.first + beats * g.period, beats }; };
  // Where in the file the track is, `tau` seconds after it was started from position 0: the first pass runs
  // from 0 to the loop's end, and afterwards it cycles between the loop's start and end.
  const positionAt = (tau, loop) => (tau < loop.end ? tau : loop.start + ((tau - loop.start) % (loop.end - loop.start)));
  // The first time T >= tmin that is a bar line, for a track whose position 0 sat at `origin` on the clock.
  // (The loop is a whole number of bars from a beat, so the unrolled grid never slips: beat j is at
  // origin + first + j x period whatever the number of wraps, and a bar line is a beat with (j + offset) % 4 === 0.)
  function nextBarLine(origin, tmin, offset, grid) {
    const g = grid || HUSTLE, off = offset === undefined ? BAR_OFFSET : offset;
    let j = Math.max(0, Math.ceil((tmin - origin - g.first) / g.period - 1e-9));
    while ((j + off) % g.beatsPerBar !== 0) j++;
    return origin + g.first + j * g.period;
  }
  // a length in seconds rounded UP to whole bars (a short line or a half-line leaves silence to the bar line)
  const padToBar = (seconds, bar) => Math.max(1, Math.ceil(seconds / (bar || BAR_S) - 1e-6)) * (bar || BAR_S);
  // the first time of the form from + j x bar that is at or after tmin
  const nextOnGrid = (from, bar, tmin) => from + Math.max(0, Math.ceil((tmin - from) / (bar || BAR_S) - 1e-9)) * (bar || BAR_S);

  const api = { HUSTLE, BAR_OFFSET, DUCK, BAR_S, LINE_BEAT, loopOf, positionAt, nextBarLine, padToBar, nextOnGrid };
  if (typeof module === "object" && module.exports) module.exports = api;
  if (typeof window === "undefined" || typeof document === "undefined") return;

  // ---- the page -------------------------------------------------------------------------------------
  let ctx = null, master = null, muted = false, loading = null, wanted = null, button = null;
  const buf = {};
  const V = { src: null, gain: null };                            // the loop that is playing now (venus), if any
  // Hustle's transport: `origin` is the clock time at which the track's position 0 would sit while it plays;
  // paused, `pausePos` is where it stopped and `pausedAt` the clock time it stopped (the reference for the bars)
  const H = { state: "idle", src: null, out: null, origin: 0, pausePos: 0, pausedAt: 0, timer: null };

  function audio() {
    if (!ctx) {
      ctx = typeof Rhythm !== "undefined" ? Rhythm.context() : null;
      if (!ctx) return null;
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
      H.out = ctx.createGain();
      H.out.connect(master);
    }
    return ctx;
  }
  const now = () => ctx.currentTime;

  function load() {
    if (loading) return loading;
    if (!audio()) return Promise.resolve();
    loading = Promise.all(Object.entries(FILES).map(([name, url]) =>
      fetch(url).then((r) => { if (!r.ok) throw new Error(url); return r.arrayBuffer(); })
        .then((a) => new Promise((ok, no) => ctx.decodeAudioData(a, ok, no)))
        .then((b) => { buf[name] = b; }))).then(() => { if (wanted) apply(wanted); }, (e) => { console.warn("music: could not load", e); });
    return loading;
  }

  // ---- venus: a plain loop ------------------------------------------------------------------------
  function fadeOutLoop() {
    if (!V.src) return;
    const g = V.gain, s = V.src, t = now();
    g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + 0.5);
    try { s.stop(t + 0.55); } catch (e) { /* already stopped */ }
    V.src = V.gain = null;
  }
  function startVenus() {
    if (V.src || !buf.venus) return;
    const t = now(), s = ctx.createBufferSource(), g = ctx.createGain();
    s.buffer = buf.venus; s.loop = true;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9, t + 0.8);
    s.connect(g); g.connect(master); s.start(t + 0.02);
    V.src = s; V.gain = g;
  }

  // ---- hustle: a transport that can stop on a bar line and carry on from there ---------------------------
  function hustleSource(t, offset) {
    const s = ctx.createBufferSource(), g = ctx.createGain(), lp = loopOf(buf.hustle.duration);
    s.buffer = buf.hustle; s.loop = true; s.loopStart = lp.start; s.loopEnd = lp.end;
    s.connect(g); g.connect(H.out);
    s.start(t, offset);
    return { s, g };
  }
  function startHustle() {
    if (H.state !== "idle" || !buf.hustle) return;
    const t = now() + 0.05, h = hustleSource(t, 0);
    H.src = h; H.origin = t; H.pausePos = 0; H.state = "playing";
    H.out.gain.cancelScheduledValues(t); H.out.gain.setValueAtTime(0, t); H.out.gain.linearRampToValueAtTime(1, t + 0.6);
  }
  function stopHustleNow(fade) {
    clearTimeout(H.timer);
    if (H.src) {
      const t = now(), g = H.src.g.gain;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + fade);
      try { H.src.s.stop(t + fade + 0.05); } catch (e) { /* not started */ }
    }
    H.src = null; H.state = "idle";
  }
  // Stop the running track at clock time T (a short fade into the stop) and remember where it was.
  function pauseAt(T) {
    H.pausePos = positionAt(T - H.origin, loopOf(buf.hustle.duration));
    H.pausedAt = T;
    const g = H.src.g.gain;
    g.setValueAtTime(1, Math.max(now(), T - 0.03)); g.linearRampToValueAtTime(0, T);
    try { H.src.s.stop(T + 0.01); } catch (e) { /* already stopped */ }
    H.src = null; H.state = "paused";
  }
  // Start it again at clock time R from where it stopped (the source is made just before R, so a replay or a
  // new question can still cancel it), at the given volume.
  function resumeAt(R, level) {
    clearTimeout(H.timer);
    const make = () => {
      if (H.state !== "paused") return;
      const t = Math.max(R, now() + 0.01), h = hustleSource(t, H.pausePos);
      H.src = h; H.origin = t - H.pausePos; H.state = "playing";
      H.out.gain.cancelScheduledValues(0); H.out.gain.setValueAtTime(level, t);
    };
    const wait = (R - now() - 0.4) * 1000;
    if (wait <= 0) make(); else H.timer = setTimeout(make, wait);
  }

  // ---- what the pages call --------------------------------------------------------------------------
  function apply(what) {
    if (!audio() || !buf.venus) return;
    wanted = what;
    if (what === "venus") { stopHustleNow(0.5); startVenus(); }
    else if (what === "hustle") { fadeOutLoop(); startHustle(); }
    else { fadeOutLoop(); stopHustleNow(0.5); }
  }
  const lobby = () => { wanted = "venus"; if (buf.venus) apply("venus"); else load(); };
  const game = () => { wanted = "hustle"; if (buf.hustle) apply("hustle"); else load(); };
  const stop = () => { wanted = null; if (ctx) apply(null); };

  // A new question has opened: bring Hustle back at full volume (on the grid, from where it stopped).
  function questionOpen() {
    if (!ctx || !buf.hustle || H.state === "idle") return;
    const t = now();
    if (H.state === "paused") {
      Rhythm.stop();
      resumeAt(nextOnGrid(H.pausedAt, BAR_S, t + 0.15), 1);
    } else {
      H.out.gain.cancelScheduledValues(t); H.out.gain.setValueAtTime(H.out.gain.value, t); H.out.gain.linearRampToValueAtTime(1, t + 0.8);
    }
  }

  // Play a scanned line over the music: Hustle stops on a bar line, the line is drummed from that instant (the
  // same clock) at half a beat of the track per short syllable, and Hustle resumes after it, quieter, from where
  // it stopped. Returns true if it did this; false means "not now" (no music, muted, not loaded) and the
  // caller should play the line in the ordinary way.
  function line(marks, accents, onBeat, onEnd) {
    if (!ctx || muted || !buf.hustle || H.state === "idle" || typeof Rhythm === "undefined") return false;
    if (ctx.state !== "running") return false;
    const t = now() + LEAD;
    let T;
    if (H.state === "playing") { T = nextBarLine(H.origin, t); pauseAt(T); }
    else { clearTimeout(H.timer); Rhythm.stop(); T = nextOnGrid(H.pausedAt, BAR_S, t); }
    const D = Rhythm.length(marks, LINE_BEAT), R = T + padToBar(D);
    Rhythm.play(marks, onBeat, onEnd, accents, { ctx, at: T, beat: LINE_BEAT });
    resumeAt(R, DUCK);
    line.last = { T, D, R };                    // for the tests and the console: the scheduled times
    return true;
  }

  function setMuted(m) {
    muted = !!m;
    if (master) master.gain.setTargetAtTime(muted ? 0 : 1, now(), 0.05);
    if (button) { button.textContent = "♪ Music: " + (muted ? "off" : "on"); button.setAttribute("aria-pressed", String(!muted)); }
  }

  // ---- the watcher: which music suits what the teacher's page is showing ---------------------------------
  let last = null;
  setInterval(() => {
    const S = window.LiveHost && window.LiveHost.state;
    if (!S) return;
    const want = S.screen === "game" && S.meta ? { lobby: "venus", play: "hustle", done: "venus" }[S.meta.phase] || null : null;
    if (want === last) return;
    last = want;
    if (want === "venus") lobby(); else if (want === "hustle") game(); else stop();
  }, 400);

  // The first click or key resumes the audio (the browser's autoplay rule) and starts loading the tracks.
  const wake = () => { if (audio()) { if (ctx.state === "suspended") ctx.resume(); load(); } };
  document.addEventListener("click", wake, true);
  document.addEventListener("keydown", wake, true);

  document.addEventListener("keydown", (e) => {
    if ((e.key === "m" || e.key === "M") && !e.metaKey && !e.ctrlKey && !e.altKey && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) setMuted(!muted);
  });
  const top = document.querySelector("header.top");
  if (top) {
    button = document.createElement("button");
    button.type = "button"; button.id = "music-toggle"; button.title = "Music on or off (M)";
    button.addEventListener("click", () => setMuted(!muted));
    top.insertBefore(button, top.querySelector("#signout"));
    setMuted(false);
  }

  window.Music = { lobby, game, stop, line, questionOpen, setMuted, isMuted: () => muted, state: () => H.state, constants: { BAR_OFFSET, DUCK, LEAD }, _H: H, _V: V,
    // for the console: the loudness of what is coming out right now (0 = silence), to check by number that the music plays
    level() { if (!ctx) return 0; if (!H.meter) { H.meter = ctx.createAnalyser(); H.meter.fftSize = 2048; master.connect(H.meter); } const d = new Float32Array(2048); H.meter.getFloatTimeDomainData(d); return Math.sqrt(d.reduce((a, x) => a + x * x, 0) / d.length); } };
})();
