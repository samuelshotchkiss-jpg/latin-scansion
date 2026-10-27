"""Tests for tools/make_meter_questions.py and data/meter_questions.json.

    python -m unittest discover -s tests -p "test_meter_questions.py"

The bank must never give an answer away or ask what must not be asked (a macron on the highlighted vowel,
a diphthong, a line's last syllable), every answer must agree with the line's marks, and the marks must be
what the app's own expected() makes of data/lines.json. Where Node is installed, the app's own functions
are run on every syllable and compared with the Python port, so the reasons the game teaches are the ones
the zoom-in teaches. The file must be byte-for-byte what the script makes from lines.json, so a stale bank
is caught here. Content: CC BY-NC-SA 4.0; code: AGPL-3.0 (see COPYRIGHT.md).
"""
import gzip
import json
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import unittest
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))
sys.path.insert(0, str(ROOT / "scansion"))
import make_meter_questions as mq  # noqa: E402
import scansion  # noqa: E402

LINES = mq.load_lines()
BY_CIT = {l["citation"]: l for l in LINES}
BANK_PATH = ROOT / "data" / "meter_questions.json"
BANK = json.loads(BANK_PATH.read_text(encoding="utf-8"))
QS = BANK["questions"]


def macron(s):
    return "̄" in unicodedata.normalize("NFD", s)


class Shape(unittest.TestCase):
    def test_top_level_and_ids(self):
        self.assertEqual(set(BANK), {"note", "kinds", "lines", "questions"})
        self.assertIn("CC BY-NC-SA 4.0", BANK["note"])
        ids = [q["id"] for q in QS]
        self.assertEqual(len(ids), len(set(ids)), "duplicate question ids")
        for q in QS:
            self.assertEqual(q["id"], f"{q['line']}#{q['i']}")
            self.assertIn(q["line"], BANK["lines"])
            self.assertIn(q["answer"], ("L", "S", "X"))
            self.assertIn(q["kind"], mq.KINDS)
            self.assertEqual(q["level"], mq.KINDS[q["kind"]]["level"])
            self.assertTrue(1 <= q["level"] <= 8)
            self.assertTrue(q["why"] and q["tag"], q["id"])

    def test_only_lines_with_questions_are_stored(self):
        self.assertEqual(set(BANK["lines"]), {q["line"] for q in QS})

    def test_kind_labels_are_the_practice_pages(self):
        src = (ROOT / "app.js").read_text(encoding="utf-8")
        names = re.search(r"const KIND_NAMES = (\[.*?\]);", src).group(1)
        labels = json.loads(names.replace("'", '"'))
        self.assertEqual(labels, [mq.KINDS[mq.KIND_OF_LEVEL[k]]["label"] for k in range(1, 9)])

    def test_reasons_use_only_the_apps_markup(self):
        for q in QS:
            rest = re.sub(r'</?i>|</?b>|<b class="la">', "", q["why"])
            self.assertNotIn("<", rest, q["id"])
            self.assertNotIn(">", rest, q["id"])


class WhatIsNeverAsked(unittest.TestCase):
    def test_no_macron_on_the_highlighted_vowel(self):
        for q in QS:
            e = BANK["lines"][q["line"]]
            a, b = q["span"]
            self.assertFalse(macron(e["text"][a:b]), q["id"])
            n = BY_CIT[q["line"]]["nuclei"][q["i"]]
            self.assertFalse(macron(n["text"]), q["id"])

    def test_no_diphthong(self):
        for q in QS:
            l = BY_CIT[q["line"]]
            n = l["nuclei"][q["i"]]
            self.assertNotEqual(n.get("why"), "diphthong", q["id"])
            self.assertEqual(n["end"] - n["start"], 1, q["id"])          # (an elided one has no `why`: Aen. 1.298 novae)
            nxt = l["nuclei"][q["i"] + 1]          # a written ae/au/oe read as two syllables is no better
            self.assertFalse(nxt["start"] == n["end"] and n["text"] + nxt["text"] in mq.SPLIT_PAIRS, q["id"])

    def test_no_final_syllable(self):
        for q in QS:
            l = BY_CIT[q["line"]]
            n = l["nuclei"][q["i"]]
            self.assertNotEqual(n.get("why"), "final syllable", q["id"])
            self.assertLess(q["i"], len(l["nuclei"]) - 1, q["id"])
            self.assertLess(q["i"], len(BANK["lines"][q["line"]]["marks"]) - 1, q["id"])

    def test_nothing_past_the_reading(self):
        # Aen. 6.33's reading stops at 27; "quīn prōtinus omnia" is grey and is not asked about
        bank, skipped = mq.build(LINES)
        self.assertEqual(skipped["beyond the line's reading_ends"], 4)
        for q in QS:
            end = BANK["lines"][q["line"]].get("reading_ends")
            if end is not None:
                self.assertLess(q["span"][0], end, q["id"])
        late = [(l["citation"], i) for l in LINES if l.get("reading_ends") is not None
                for i, n in enumerate(l["nuclei"]) if n["start"] >= l["reading_ends"]]
        self.assertTrue(late)
        asked = {(q["line"], q["i"]) for q in QS}
        self.assertFalse(asked & set(late))

    def test_advanced_lines_ask_only_about_the_licence(self):
        for q in QS:
            if BY_CIT[q["line"]]["advanced"]:
                self.assertEqual(q["kind"], "advanced", q["id"])

    def test_unsettled_lines_are_never_used(self):
        for q in QS:
            l = BY_CIT[q["line"]]
            self.assertTrue(l["scans"] and not l["ambiguous"], q["id"])

    def test_prodelision_is_left_out_by_default(self):
        for q in QS:
            self.assertNotEqual(BY_CIT[q["line"]]["nuclei"][q["i"]]["mark"], "prodelided", q["id"])


class WhatIsAsked(unittest.TestCase):
    def test_span_is_inside_the_text_and_on_a_vowel(self):
        for q in QS:
            text = BANK["lines"][q["line"]]["text"]
            a, b = q["span"]
            self.assertTrue(0 <= a < b <= len(text), q["id"])
            self.assertTrue(scansion.is_vowel(text[a].lower()), q["id"])
            if q["answer"] == "X":
                self.assertIn(b - a, (1, 2), q["id"])
                if b - a == 2:
                    self.assertEqual(text[a + 1].lower(), "m", q["id"])      # an elision: the vowel and its -m
            else:
                self.assertEqual(b - a, 1, q["id"])
            wa, wb = q["word"]
            self.assertTrue(wa <= a and b <= wb, q["id"])
            self.assertTrue(text[wa:wb].isalpha(), q["id"])
            self.assertTrue((wa == 0 or not text[wa - 1].isalpha()) and (wb == len(text) or not text[wb].isalpha()),
                            q["id"])

    def test_answer_agrees_with_the_lines_marks(self):
        for q in QS:
            e = BANK["lines"][q["line"]]
            self.assertEqual(q["answer"], e["marks"][q["i"]], q["id"])
            self.assertEqual(q["answer"], mq.expected(BY_CIT[q["line"]]["nuclei"][q["i"]]), q["id"])

    def test_the_span_is_the_nucleus(self):
        for q in QS:
            e = BANK["lines"][q["line"]]
            self.assertEqual(q["span"][0], e["nuclei"][q["i"]][0], q["id"])
            self.assertIn(q["span"][1] - e["nuclei"][q["i"]][1], (0, 1), q["id"])

    def test_every_line_is_stored_whole(self):
        for cit, e in BANK["lines"].items():
            l = BY_CIT[cit]
            self.assertEqual(e["text"], l["text"])
            self.assertEqual(len(e["marks"]), len(l["nuclei"]))
            self.assertEqual(len(e["accents"]), len(l["nuclei"]))
            self.assertEqual(e["nuclei"], [[n["start"], n["end"]] for n in l["nuclei"]])
            self.assertEqual((e["passage"], e["level"], e["flags"]), (l["passage"], l["level"], l["flags"]))
            for (a, b) in e["nuclei"]:
                self.assertLessEqual(b, len(e["text"]))

    def test_kinds_have_their_reason(self):
        for q in QS:
            l = BY_CIT[q["line"]]
            n = l["nuclei"][q["i"]]
            why, fb = n.get("why"), n.get("followed_by", "")
            if q["kind"] == "elision":
                self.assertEqual(n["mark"], "elided", q["id"])
            if q["answer"] == "X":
                self.assertIn(q["kind"], ("elision", "greek", "advanced"), q["id"])
            if q["kind"] == "qu":
                self.assertIn("qu", fb, q["id"])
            if q["kind"] == "mcl":
                self.assertTrue(why.startswith("muta cum liquida,"), q["id"])
            if q["kind"] == "mcl-start":
                self.assertIn(why, ("muta cum liquida at word start", "f + liquid at word start"), q["id"])
            if q["kind"] == "greek":
                self.assertTrue(any(d["start"] <= n["start"] < d["end"] for d in l["difficult_words"]), q["id"])
            if q["kind"] == "advanced":
                self.assertTrue(n["mark"] == "merged" or n.get("hiatus") or why in (
                    "lengthened syllable", "word-initial cluster makes position", "word-initial cluster ignored"),
                    q["id"])
            if q["kind"] == "plain":
                self.assertIn(why, ("short vowel", "two consonants"), q["id"])
                self.assertFalse(n.get("hiatus"), q["id"])
                self.assertNotIn("qu", fb, q["id"])
                self.assertFalse(any(d["start"] <= n["start"] < d["end"] for d in l["difficult_words"]), q["id"])

    def test_a_syllable_is_never_harder_than_its_line(self):
        # the scanner levels a line by its flags; a syllable's level uses the same rule, so it can only
        # exceed the line's where this file differs from the scanner -- a divided mute + liquid (long),
        # which the scanner raises no flag for (see KINDS in the script)
        for q in QS:
            if q["level"] > BANK["lines"][q["line"]]["level"]:
                n = BY_CIT[q["line"]]["nuclei"][q["i"]]
                self.assertEqual(n.get("why"), "muta cum liquida, long", q["id"])

    def test_every_kind_the_data_can_give_is_there(self):
        self.assertEqual({q["kind"] for q in QS}, set(mq.KINDS))
        self.assertEqual({q["answer"] for q in QS}, {"L", "S", "X"})


class FromTheApp(unittest.TestCase):
    """The app's own functions, run in Node on every syllable of every line."""

    @classmethod
    def setUpClass(cls):
        cls.node = shutil.which("node")
        cls.results = None
        if not cls.node:
            return
        with tempfile.TemporaryDirectory() as tmp:
            js = Path(tmp) / "app_reasons.js"
            js.write_text(NODE_HARNESS, encoding="utf-8")
            run = subprocess.run([cls.node, str(js), str(ROOT / "app.js"), str(mq.LINES)], capture_output=True,
                                 text=True, encoding="utf-8")
        if run.returncode:
            raise AssertionError("running the app's functions failed:\n" + run.stderr)
        cls.results = json.loads(run.stdout)

    def need_node(self):
        if self.results is None:
            self.skipTest("Node is not installed: the app's functions were not run")

    def test_expected_is_the_apps(self):
        src = (ROOT / "app.js").read_text(encoding="utf-8")
        line = re.search(r"^  function expected\(n\) \{.*\}$", src, re.M).group(0)
        self.assertEqual(line, "  function expected(n) { return n.mark === 'L' || n.mark === 'S' ? n.mark : 'X'; }")
        self.need_node()
        for cit, i, tag, why, exp in self.results:
            self.assertEqual(exp, mq.expected(BY_CIT[cit]["nuclei"][i]), f"{cit}#{i}")
        for cit, e in BANK["lines"].items():
            self.assertEqual(e["marks"], [x[4] for x in self.results if x[0] == cit])

    def test_reasons_are_the_zoom_ins(self):
        self.need_node()
        self.assertEqual(len(self.results), sum(len(l["nuclei"]) for l in LINES))
        for cit, i, tag, why, exp in self.results:
            self.assertEqual((tag, why), mq.reason(BY_CIT[cit], i), f"{cit}#{i}")

    def test_questions_carry_the_zoom_ins_sentence(self):
        self.need_node()
        by = {(c, i): (t, w) for c, i, t, w, _ in self.results}
        for q in QS:
            self.assertEqual((q["tag"], q["why"]), by[(q["line"], q["i"])], q["id"])


class Reproducible(unittest.TestCase):
    def test_file_is_what_the_script_makes(self):
        bank, _ = mq.build(mq.load_lines())
        self.assertEqual(BANK_PATH.read_bytes(), mq.render(bank).encode("utf-8"),
                         "data/meter_questions.json is out of date: run tools/make_meter_questions.py")

    def test_utf8_without_carriage_returns(self):
        raw = BANK_PATH.read_bytes()
        self.assertNotIn(b"\r", raw)
        raw.decode("utf-8")

    def test_the_bank_stays_small(self):
        # PLAN.md aims for under 1 MB; one question per askable syllable cannot (7,000 of them), but the file
        # must stay a size a classroom laptop fetches without noticing. This is the gzip a web server sends.
        self.assertLess(len(gzip.compress(BANK_PATH.read_bytes())), 400 * 1024)

    def test_sample_sheet_is_seeded(self):
        bank, _ = mq.build(mq.load_lines())
        a, b = mq.sample_sheet(bank), mq.sample_sheet(bank)
        self.assertEqual(a, b)
        self.assertEqual(len(re.findall(r"^## \d+\. ", a, re.M)), 40)
        kinds = Counter(re.findall(r"^## \d+\. \S+ \S+ — (\S+) \(level", a, re.M))
        for k in mq.KINDS:
            self.assertGreaterEqual(kinds[k], min(5, sum(1 for q in bank["questions"] if q["kind"] == k)), k)


class Mix(unittest.TestCase):
    def test_feasible_counts_distinct_lines(self):
        enough = {"L": set(range(4)), "S": set(range(4, 8)), "X": {8, 9}}
        self.assertTrue(mq.feasible(enough, 10))
        self.assertFalse(mq.feasible({**enough, "X": {8}}, 10))
        # lines that can give only one answer between them cannot fill two quotas
        self.assertFalse(mq.feasible({"L": set(range(4)), "S": set(range(4)), "X": {8, 9}}, 10))

    def test_default_mix_holds_for_a_whole_class_game(self):
        by = defaultdict(set)
        for q in QS:
            if q["kind"] in mq.DEFAULT_KINDS:
                by[q["answer"]].add(q["line"])
        for n in (10, 20, 30, 40):
            self.assertTrue(mq.feasible(by, n), n)


NODE_HARNESS = r"""
// Runs the app's own expected() and zoom-in reason on every syllable of every line (see the test).
const fs = require('fs');
const [appPath, linesPath] = process.argv.slice(2);
const src = fs.readFileSync(appPath, 'utf8').split('\n');
function take(re) {
  const a = src.findIndex((s) => re.test(s));
  if (a < 0) throw new Error('not found in app.js: ' + re);
  let b = a;
  if (/^  function /.test(src[a])) {
    if (!/\{\s*$/.test(src[a])) return src[a];                  // a one-line function
    while (src[b] !== '  }') b++;
  } else {
    while (!/;\s*$/.test(src[b])) b++;                          // a const may span lines
  }
  return src.slice(a, b + 1).join('\n');
}
const pieces = [/^  const SYMBOL = /, /^  const isLetter = /, /^  function escapeHTML\(/, /^  const PAIRED = /,
  /^  const CLOSED = /, /^  function expected\(/, /^  function zoomStrip\(/, /^  function zoomWhy\(/,
  /^  function vowelNext\(/, /^  function zoomReason\(/, /^  function doubledNote\(/].map(take);
const api = new Function(pieces.join('\n') + '\nreturn { zoomStrip, zoomWhy, expected };')();
const lines = JSON.parse(fs.readFileSync(linesPath, 'utf8'));
const out = [];
for (const l of lines) {
  l.nuclei.forEach((n, i) => {
    const [tag, why] = api.zoomWhy(l, n, api.zoomStrip(l, i));
    out.push([l.citation, i, tag, why, api.expected(n)]);
  });
}
process.stdout.write(JSON.stringify(out));
"""


if __name__ == "__main__":
    unittest.main()
