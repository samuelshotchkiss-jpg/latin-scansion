// The Vowels page's drills (vowels.html), built by tools/make_vowel_drills.py from data/lines.json.
// Pure: no emulator needed --  node --test tests/vowels.test.js
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const D = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "vowels.json"), "utf8"));
const LINES = new Map(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "lines.json"), "utf8"))
  .map((r) => [r.citation, r]));
const base = (c) => c.normalize("NFD")[0].toLowerCase();

test("every question points at real letters of its line, and has a reason", () => {
  for (const name of ["i", "diphthong"]) {
    assert.ok(D[name].length > 100, name);
    for (const [cite, ws, we, ts, te, answer, why, division] of D[name]) {
      const t = D.lines[cite];
      assert.ok(t && ws <= ts && te <= we && we <= t.length, `${cite} ${ws}`);
      assert.ok(D.reasons[why], `${cite}: no reason for ${why}`);
      assert.ok(division.replace(/·/g, "").length >= we - ws - 1, `${cite}: ${division}`);
      if (name === "i") {
        assert.ok(["vowel", "consonant"].includes(answer));
        assert.strictEqual(base(t[ts]), "i", `${cite}: ${t.slice(ts, te)}`);
        assert.ok("aeiouy".includes(base(t[te])), `${cite}: an i before a vowel`);
      } else {
        assert.ok(["one", "two"].includes(answer));
        assert.strictEqual(te - ts, 2, `${cite}: two letters`);
      }
    }
  }
});

test("the answer is the scanner's: a vowel i, or each of two vowels apart, is a nucleus of its own", () => {
  for (const [cite, , , ts, te, answer] of D.i) {
    const own = LINES.get(cite).nuclei.some((n) => n.start === ts && n.end === te);
    assert.strictEqual(own, answer === "vowel", `${cite} at ${ts}`);
  }
  for (const [cite, , , ts, te, answer] of D.diphthong) {
    const one = LINES.get(cite).nuclei.some((n) => n.start === ts && n.end === te);
    assert.strictEqual(one, answer === "one", `${cite} at ${ts}`);
  }
});

test("the owner's cases are there, and right", () => {
  const find = (name, word, answer) => D[name].some(([cite, ws, we, , , a]) =>
    D.lines[cite].slice(ws, we) === word && a === answer);
  assert.ok(find("i", "iuvenum", "consonant"), "iuvenum: j");     // Thisbē iuvenum, the quiz's trap
  assert.ok(find("i", "omnia", "vowel"), "omnia: word-final -ia");
  assert.ok(find("i", "coiēre", "vowel"), "coiēre: the i of eō");
  assert.ok(find("i", "Troiae", "consonant"), "Troiae: between vowels");
  assert.ok(find("diphthong", "deus", "two"), "de-us");
  assert.ok(find("diphthong", "cui", "one"), "cui");
});
