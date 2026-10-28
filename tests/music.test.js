// music.test.js -- the live game's music (live/music.js) and the optional settings added to rhythm.js, with no
// browser: the old four-argument Rhythm.play is unchanged, a scheduled line starts on the given clock time at the
// given beat, and the bar-line arithmetic that stops and resumes Hustle keeps the groove on its grid.
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const Music = require("../live/music.js");

// a recording stand-in for the Web Audio API, enough for rhythm.js
function loadRhythm(currentTime) {
  const starts = [], timeouts = [];
  const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, value: 0 });
  const node = () => ({ connect(n) { return n; }, gain: param(), frequency: param(), start(t) { starts.push(t); }, stop() {}, getChannelData: () => new Float32Array(8) });
  const ctx = {
    currentTime, sampleRate: 8000, state: "running", destination: {}, resume() {},
    createOscillator: () => Object.assign(node(), { type: "" }), createGain: node, createBiquadFilter: () => Object.assign(node(), { type: "" }),
    createBufferSource: node, createBuffer: () => ({ getChannelData: () => new Float32Array(160) }),
  };
  const win = { AudioContext: function () { return ctx; } };
  const sandbox = { window: win, setTimeout: (fn, ms) => { timeouts.push(ms); return timeouts.length; }, clearTimeout() {}, Math };
  vm.runInNewContext(fs.readFileSync(path.join(root, "rhythm.js"), "utf8"), sandbox);
  return { R: win.Rhythm, ctx, starts, timeouts };
}
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, a + " vs " + b);
const MARKS = ["L", "S", "S", "L", "L", "X", "L", "S", "S", "L", "L", "L"];

test("rhythm.js: the old call (four arguments) schedules exactly as before", () => {
  const { R, starts, timeouts } = loadRhythm(5);
  assert.equal(R.play(MARKS, () => {}, () => {}, []), true);
  // each syllable, and the oscillator + noise burst of a drum: take the drum onsets (every start is a pair)
  const onsets = starts.filter((_, i) => i % 2 === 0);
  near(onsets[0], 5.12);                       // 0.12 s from now
  near(onsets[1] - onsets[0], 0.4);            // a long is two beats of 0.2 s
  near(onsets[2] - onsets[1], 0.2);            // a short is one
  assert.equal(onsets.length, MARKS.filter((m) => m !== "X").length);
  near(timeouts[0], 120);                      // onBeat for the first syllable: 0.12 s from now, in ms
  near(timeouts[1], 520);
  near(timeouts[timeouts.length - 1], (R.length(MARKS, 0.2) + 0.12) * 1000 + 150);
});

test("rhythm.js: { at, beat } starts on the given clock time at the given beat; { ctx } is used if none exists yet", () => {
  const { R, ctx, starts, timeouts } = loadRhythm(5);
  assert.equal(R.play(MARKS, null, null, null, { ctx, at: 9, beat: 0.25 }), true);
  const onsets = starts.filter((_, i) => i % 2 === 0);
  near(onsets[0], 9); near(onsets[1] - onsets[0], 0.5); near(onsets[2] - onsets[1], 0.25);
  near(timeouts[0], 4000);                     // 9 - 5 s from now
  // a start in the past is moved to just after now, never scheduled backwards
  const late = loadRhythm(5);
  late.R.play(MARKS, null, null, null, { at: 1, beat: 0.25 });
  near(late.starts[0], 5.02);
  // and a hexameter lasts exactly six seconds at beat 0.25: three bars of the music at 120 bpm
  const hex = [].concat(...Array(5).fill(["L", "S", "S"]), ["L", "L"]);       // five dactyls and a spondee
  near(R.length(hex, 0.25), 6.0);
  near(R.length(["L", "S", "S", "L", "S", "S", "L", "X", "S", "L", "L", "L", "S", "S", "L", "X", "L", "L"], 0.25) % 0.25, 0, 1e-9);
  assert.equal(typeof R.context, "function");
});

test("the grid: the loop is whole bars, and the next bar line honours the bar offset", () => {
  const H = Music.HUSTLE, dur = 120.55508333333333;          // Hustle as decoded in the browser
  const lp = Music.loopOf(dur);
  near(lp.start, 0.275); near(lp.end, 120.275); assert.equal(lp.beats, 240); assert.equal(lp.beats % 4, 0);
  // (looping the whole file would slip the beat by this much at every wrap)
  near(((dur - H.first) / H.period) % 1 * H.period, 0.28, 0.001);
  near(Music.positionAt(10, lp), 10);
  near(Music.positionAt(lp.end + 1.5, lp), 0.275 + 1.5);       // after the end, back at the loop's start
  near(Music.nextBarLine(100, 103, 0), 104.275);               // 100 + 0.275 + 2j
  near(Music.nextBarLine(100, 104.275, 0), 104.275);           // exactly on a bar line counts
  near(Music.nextBarLine(100, 103, 1), 103.775);               // offset 1: beats 3, 7, ...
  near(Music.nextBarLine(100, 103, 2), 103.275);
  near(Music.nextBarLine(100, 103, 3), 104.775);
  for (const off of [0, 1, 2, 3]) for (let tmin = 100; tmin < 100 + 3 * dur; tmin += 7.31) {
    const x = Music.nextBarLine(100, tmin, off);
    assert.ok(x >= tmin - 1e-9 && x - tmin <= 2.0 + 1e-9);
    const k = (x - 100 - H.first) / H.period;
    near(k, Math.round(k), 1e-6); assert.equal((Math.round(k) + off) % 4, 0);
  }
});

test("stop on a bar line, play the line, resume: the groove keeps its place on the grid, across loop wraps", () => {
  const dur = 120.55508333333333, lp = Music.loopOf(dur), off = 0;
  // pause at T on a bar line (anywhere in the track, including after several loops), resume at R = T + the line
  // padded to whole bars, from the same place: afterwards the bar lines are exactly where the old ones would have
  // been had the music only paused, and the resume itself is on a beat
  for (const D of [6.0, 5.4, 3.0, 2.1, 0.7, 6.2]) for (const started of [0, 61.3, 300.9, 1000]) {
    const origin = 50.1234, tmin = origin + started + 3;
    const T = Music.nextBarLine(origin, tmin, off);
    const pausePos = Music.positionAt(T - origin, lp);
    const k = (pausePos - 0.275) / 0.5;
    near(k, Math.round(k), 1e-6); assert.equal(Math.round(k) % 4, 0, "paused on a bar line, wherever in the loop");
    const R = T + Music.padToBar(D);
    assert.ok(R - T >= D - 1e-9);
    near((R - T) % 2, 0, 1e-9);
    const newOrigin = R - pausePos;                            // as resumeAt sets it
    near(Music.nextBarLine(newOrigin, R + 0.01, off) - R, 2.0, 1e-9);
  }
  assert.equal(Music.padToBar(6.0), 6.0); assert.equal(Music.padToBar(5.2), 6.0); assert.equal(Music.padToBar(0), 2.0);
  // a replay while paused starts on a bar line counted from the first pause, so the resume stays on the grid
  const first = 77.7;
  const T2 = Music.nextOnGrid(first, 2.0, first + 6.4);
  near((T2 - first) % 2, 0, 1e-9); assert.ok(T2 >= first + 6.4 && T2 < first + 8.4 + 1e-9);
});

test("the music is a host-page thing: live.html and the students' code never reach it", () => {
  const files = ["live.html", "live/player.js", "live/net.js", "live/common.js"];
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    assert.ok(!/live\/audio|music\.js|\bMusic\b|\.mp3/.test(src), f);
  }
  assert.match(fs.readFileSync(path.join(root, "host.html"), "utf8"), /live\/music\.js\?v=/);
  assert.ok(fs.existsSync(path.join(root, "live", "audio", "hustle.mp3")) && fs.existsSync(path.join(root, "live", "audio", "venus.mp3")));
});

test("the credits are in the page footer, COPYRIGHT.md and README.md; no visible 'phone'", () => {
  const host = fs.readFileSync(path.join(root, "host.html"), "utf8");
  assert.match(host, /Kevin MacLeod \(incompetech\.com\), CC BY 4\.0/);
  const cr = fs.readFileSync(path.join(root, "COPYRIGHT.md"), "utf8");
  for (const t of ["Hustle Kevin MacLeod (incompetech.com)", "Vibing Over Venus Kevin MacLeod (incompetech.com)", "https://creativecommons.org/licenses/by/4.0/", "live/audio/hustle.mp3", "live/audio/venus.mp3"]) assert.ok(cr.includes(t), t);
  assert.match(fs.readFileSync(path.join(root, "README.md"), "utf8"), /live\/audio\/.*CC BY 4\.0/);
  const music = fs.readFileSync(path.join(root, "live", "music.js"), "utf8");
  const strings = music.match(/"[^"\n]*"/g).join(" ");
  assert.ok(!/phone/i.test(strings));
});
