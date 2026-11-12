#!/usr/bin/env python3
"""make_vowel_drills.py -- data/vowels.json, the two drills on the Vowels page (vowels.html).

    python tools/make_vowel_drills.py            # rewrite data/vowels.json from data/lines.json
    python tools/make_vowel_drills.py --report   # counts and a sample of each kind, nothing written

THE OWNER (2026-11-12, after the Meter & Literary Devices Quiz): students struggle where vowels
meet, and with consonantal i above all -- half the class elided Thisbē before iuvenum. Two drills:

  * "i: VOWEL OR CONSONANT?" -- every i before a vowel. Consonantal: at the start of a word (iam),
    between vowels, where it counts twice (Troia), after a prefix before u, a or -ec- (coniūnx).
    Vocalic: after a consonant inside a word, and above all word-final -ia/-io/-ie (omnia); and the
    exceptions -- the i of eō, "go", after a prefix or co- (abiit, coiēre), and the names that open
    with a vowel i (Iāsōn, Iūlus). An i between consonants is plain, and left out.
  * "DIPHTHONG OR NOT?" -- every pair of vowels that meet inside a word and stay apart (de-us,
    om-ni-a, fu-it), and the diphthongs, about as many as those: all of them, since there are fewer.

THE ANSWER IS THE SCANNER'S, read from lines.json: a vowel i is a nucleus of its own, a consonant i
is in none, a diphthong is one nucleus of two letters, two vowels apart are two nuclei side by side.
So the drill teaches exactly what the Scan page marks. Left out: synizesis (merged vowels), the Greek
y and doubled Greek vowels (Minyae, Boōtēn), and the vowel i between vowels of Greek names (Pēnēia).
"""
from __future__ import annotations

import argparse
import json
import pathlib
import random
import re
import sys
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parents[1]
LINES = ROOT / "data" / "lines.json"
OUT = ROOT / "data" / "vowels.json"
sys.stdout.reconfigure(encoding="utf-8")

VOWELS = set("aeiouy")
PREFIX = re.compile(r"(?:con|ad|ob|sub|ab|in|dis)")        # the scanner's PREFIX_BEFORE_I
LOOKALIKE = {"ae", "au", "oe", "ei", "eu", "ui", "ai"}     # spelled as a diphthong is (or could be)

# What the page says after an answer: one plain sentence per kind (owner's terms: "consonantal i").
REASONS = {
    "i-start": "At the start of a word, an i before a vowel is a consonant, like English y: iam = jam.",
    "i-between": "Between two vowels, i is a consonant, and it counts twice: Troia = Troj-ja.",
    "i-prefix": "After a prefix (con-, ad-, sub-, ob-, in-, dis-), an i before u, a or -ec- is a "
                "consonant: con-jūnx, sub-jec-ta.",
    "i-final": "After a consonant, i is a vowel, its own syllable -- and so at the end of a word: "
               "om-ni-a, nes-ci-o.",
    "i-after": "After a consonant inside a word, i is a vowel, its own syllable: fī-li-us.",
    "i-eo": "The i of eō, “go” (īre, iit), stays a vowel after a prefix: ab-i-it, co-i-ē-re.",
    "i-name": "A few names begin with a vowel i: I-ā-sōn, I-ū-lus.",
    "d-common": "ae, au and oe are diphthongs: one syllable, and long.",
    "d-rare": "ei, eu and ui are diphthongs only in a few words: heu, seu, neu, cui, huic, dein(de), "
              "and Greek names like Orpheus.",
    "a-lookalike": "Outside those few words, e-u, e-i and u-i stay apart: de-us, me-us, fu-it.",
    "a-split": "A macron, or a prefix, splits them: ā-ēr, co-er-cet, Trō-es.",
    "a-ai": "ai is never a diphthong in Latin: a-it.",
    "a-other": "These two vowels are no diphthong, so each is its own syllable: me-a, tu-ō.",
}


def base(ch: str) -> str:
    return unicodedata.normalize("NFD", ch)[0].lower()


def plain(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if c.isalpha()
                   and not unicodedata.combining(c))


def division(r: dict, ws: int, we: int) -> str:
    """The word in syllables, as the Scan page divides it: a consonantal i written j (Troj·jae)."""
    # The scanner's syllables run across word breaks (de-u-s‿et: the s goes with the next word's
    # vowel), and a letter worth two (x; an i between vowels) sits in two of them. For ONE word on
    # its own: each of its letters goes to the first of its own syllables that holds it, and a
    # letter no syllable of the word holds (a final consonant lent to the next word) goes to the
    # nearest one -- except a consonantal i between vowels, written in both, as the Scan page
    # writes it (Troj·jae).
    t, nuc = r["text"], r["nuclei"]
    inside = {p for n in nuc for p in range(n["start"], n["end"])}
    # every vowel of the word, an elided one too (fraud-ō et: on its own the word is frau·dō)
    mine = [n for n in nuc if ws <= n["start"] < we and n["mark"] != "merged"]
    if not mine:
        return t[ws:we]
    spans = [n.get("syllable") or [n["start"], n["end"]] for n in mine]
    parts = [""] * len(mine)
    for p in range(ws, we):
        ch = t[p]
        if not ch.isalpha():
            continue
        holders = [k for k, (a, b) in enumerate(spans) if a <= p < b]
        cons_i = ch in "iI" and p not in inside and p + 1 < len(t) and base(t[p + 1]) in VOWELS
        if cons_i:
            ch = "J" if ch == "I" else "j"
        if not holders:                     # before the first vowel, after the last, or between
            k = 0 if p < mine[0]["start"] else len(mine) - 1 if p >= mine[-1]["end"] else \
                min(k for k, n in enumerate(mine) if n["start"] > p)   # a consonant opens the next
            holders = [k]
        if cons_i and p > ws:               # Troj·ja, even where the a is elided (Troia antīqua)
            before = [k for k, n in enumerate(mine) if n["start"] < p]
            after = [k for k, n in enumerate(mine) if n["start"] > p]
            holders = before[-1:] + after[:1]
        for k in (holders if cons_i and p > ws else holders[:1]):
            parts[k] += ch
    return "·".join(parts)


def build() -> dict:
    lines = json.loads(LINES.read_text(encoding="utf-8"))
    idrill, ddrill = [], []
    for r in lines:
        if not r.get("scans"):
            continue
        t, nuc = r["text"], r["nuclei"]
        at = {p: k for k, n in enumerate(nuc) for p in range(n["start"], n["end"])}
        for m in re.finditer(r"[^\W\d_]+", t):
            w, ws, we = m.group(), m.start(), m.end()
            item = lambda ts, te, answer, why: dict(
                cite=r["citation"], text=t, word=[ws, we], target=[ts, te], answer=answer, why=why,
                division=division(r, ws, we))
            # -- i before a vowel ------------------------------------------------------------------
            for i, ch in enumerate(w):
                if ch not in "iIī" or i + 1 >= len(w) or base(w[i + 1]) not in VOWELS:
                    continue
                if i == 0 and base(w[1]) == "i":
                    continue                    # iit: Aen. 1.376 reads it as one syllable (synizesis)
                p, before = ws + i, plain(w[:i])
                prev_cons = i > 0 and (base(w[i - 1]) not in VOWELS or w[i - 2:i].lower() == "qu")
                k = at.get(p)
                if k is None:                                           # a consonant
                    why = ("i-start" if i == 0 else "i-between" if not prev_cons else
                           "i-prefix" if PREFIX.fullmatch(before) else None)
                    if why:
                        idrill.append(item(p, p + 1, "consonant", why))
                    continue
                n = nuc[k]
                if n["mark"] == "merged" or n["end"] - n["start"] > 1:
                    continue                                            # synizesis; a diphthong's i
                if i == 0:
                    why = "i-name" if w[0] == "I" else "i-eo"
                elif before == "co" or (PREFIX.fullmatch(before) or before in ("red", "ex", "per", "trans",
                                                                               "prae", "ante", "sub", "ob")):
                    why = "i-eo"
                elif not prev_cons:
                    continue                                            # Pēnēia: a Greek name's vowel i
                elif i + 2 == len(w):
                    why = "i-final"
                else:
                    why = "i-after"
                idrill.append(item(p, p + 1, "vowel", why))
        # -- vowels meeting inside a word ----------------------------------------------------------
        # a word is a run of LETTERS: pollicitus—quae has no space between its two words
        word_at = {p: (m.start(), m.end()) for m in re.finditer(r"[^\W\d_]+", t)
                   for p in range(m.start(), m.end())}
        for k, n in enumerate(nuc):
            if n["mark"] in ("merged", "elided", "prodelided"):
                continue
            ws, we = word_at[n["start"]]
            if n.get("why") == "diphthong" and n["end"] - n["start"] == 2:
                pair = plain(t[n["start"]:n["end"]])
                ddrill.append(dict(cite=r["citation"], text=t, word=[ws, we],
                                   target=[n["start"], n["end"]], answer="one",
                                   why="d-common" if pair in ("ae", "au", "oe") else "d-rare",
                                   division=division(r, ws, we)))
                continue
            if k + 1 >= len(nuc) or n["end"] - n["start"] > 1:
                continue
            m2 = nuc[k + 1]
            if m2["start"] != n["end"] or m2["mark"] in ("merged", "elided", "prodelided") \
                    or m2["end"] - m2["start"] > 1:
                continue
            a, b = t[n["start"]], t[m2["start"]]
            pair = base(a) + base(b)
            if "y" in pair or pair in ("ee", "oo"):
                continue                                                # Minyae, Boōtēn: Greek
            if pair in LOOKALIKE:
                why = ("a-ai" if pair == "ai" else
                       "a-split" if pair in ("ae", "au", "oe") else "a-lookalike")
            else:
                why = "a-other"
            ddrill.append(dict(cite=r["citation"], text=t, word=[ws, we],
                               target=[n["start"], m2["end"]], answer="two", why=why,
                               division=division(r, ws, we)))
    return dict(
        note="Generated by tools/make_vowel_drills.py from data/lines.json (the scanner's answers); "
             "edit there, not here. Content: CC BY-NC-SA 4.0; the Latin is public domain.",
        reasons=REASONS, i=idrill, diphthong=ddrill)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--report", action="store_true", help="counts and samples; write nothing")
    a = ap.parse_args()
    d = build()
    from collections import Counter
    for name in ("i", "diphthong"):
        c = Counter(x["why"] for x in d[name])
        print(f"{name}: {len(d[name])} items  " + "  ".join(f"{k} {v}" for k, v in c.most_common()))
    if a.report:
        rng = random.Random(1)
        for name in ("i", "diphthong"):
            by = {}
            for x in d[name]:
                by.setdefault(x["why"], []).append(x)
            for why, xs in by.items():
                for x in rng.sample(xs, min(6, len(xs))):
                    w = x["text"][x["word"][0]:x["word"][1]]
                    tg = x["text"][x["target"][0]:x["target"][1]]
                    print(f"  {why:12} {x['answer']:9} {x['cite']:11} {w:16} [{tg}]  {x['division']}")
        return 0
    # COMPACT, because every student's device loads it: each line's text once, and a question as
    # [citation, word start, word end, target start, target end, answer, why, division].
    texts = {}
    def pack(x):
        texts[x["cite"]] = x["text"]
        return [x["cite"], *x["word"], *x["target"], x["answer"], x["why"], x["division"]]
    out = dict(note=d["note"], reasons=d["reasons"],
               fields=["cite", "word start", "word end", "target start", "target end", "answer",
                       "why", "division"],
               i=[pack(x) for x in d["i"]], diphthong=[pack(x) for x in d["diphthong"]])
    out["lines"] = texts
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
