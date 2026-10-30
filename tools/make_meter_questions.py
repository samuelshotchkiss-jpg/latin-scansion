#!/usr/bin/env python3
"""make_meter_questions.py -- the bank of "Longa an brevis?" questions, built from data/lines.json.

Content: CC BY-NC-SA 4.0; code: AGPL-3.0 (see COPYRIGHT.md). Python 3.10+, standard library only.

WHAT IT MAKES. data/meter_questions.json: one question per syllable worth asking about -- "this syllable of
this real line: long, short or elided?" -- with the reason, so the live game (live/modes/meter.js) can ask
it in seconds and the projector can teach from the answer. The Latin quantity is the scanner's, never
this file's: every answer is read off the nucleus records of data/lines.json, and nothing here corrects
or invents one. Never edit the output by hand; change this script (or the lines) and run it again.

    python tools/make_meter_questions.py              # write data/meter_questions.json
    python tools/make_meter_questions.py --report     # the distribution report (nothing is written)
    python tools/make_meter_questions.py --audit      # what looks doubtful in the data, with citations
    python tools/make_meter_questions.py --sample     # the review sheet tools/meter_questions_sample.md
    python tools/make_meter_questions.py --check      # exit 1 unless the file on disk is up to date

THE FILE.
    { "note": …, "kinds": { kind: {"level": 1..8, "label": "…"} },
      "lines": { "<citation>": { "text", "marks": ["L","S","X",…], "accents": [bool,…],
                                 "nuclei": [[start,end],…], "passage", "level", "flags",
                                 "reading_ends"?, "meter"? } },
      "questions": [ { "id": "<citation>#<nucleus index>", "line": "<citation>", "i": <nucleus index>,
                       "span": [start,end], "word": [start,end], "answer": "L"|"S"|"X",
                       "kind": "<kind>", "level": 1..8, "tag": "<short name of the reason>",
                       "why": "<the reason, one or two sentences>" } ] }
  * A line is stored once, however many questions it has; only lines with a question appear. `marks`,
    `accents` and `nuclei` have one entry per syllable nucleus, in order, so a question's `i` indexes
    all three, and `Rhythm.play(marks, onBeat, onEnd, accents)` can light `nuclei[i]` as it sounds.
    `marks` are the app's L/S/X for the drum player (app.js expected()).
  * `span` is the highlighted letters: the vowel, or for an elision the vowel and its -m (multum ille).
    `word` is the word that holds them. Offsets are into the NFC `text`, as in lines.json.
  * `level` is the QUESTION's level (the syllable's); the line's own level is lines[...].level.
  * `why` is an HTML fragment in the app's own words (the zoom-in's sentence, app.js zoomReason, with the
    same <b class="la"> / <i> markup, and its note on an i that is a j); `tag` is the zoom-in's short
    label ("ends in a consonant"). Nothing but <b class="la">, <i> and their closers appears in `why`.
  * `reading_ends` (Aen. 6.33): the reading stops there, the rest is grey; no question is asked past it.
    `meter` ("half-line", Aen. 4.361) is carried over from lines.json.

KINDS. The app's eight levels, applied to one SYLLABLE instead of a line. Each syllable gets the flags
the scanner would raise for it (scansion.build_line names them), and scansion.level_of() -- the scanner's
own rule, imported, not copied -- picks the lowest level that admits them all:
    level  kind        the syllable ...
      1    plain       is long or short for the plain reason: long by position (two consonants), or short
                       (one consonant after it, or a vowel straight after it: de-us)
      2    qu          has qu among the consonants after its vowel (aqua, sequor): qu is one consonant
      3    hxz         is one where an h, x, z, or an i between vowels (a letter that counts twice) changes the
                       count: a short vowel before h + a consonant (captat harundine), a long syllable
                       whose only consonant is x or z (dīxit)
      4    elision     is an elided vowel (and its -m): the answer is X
      5    mcl         comes before a mute (stop) + liquid inside a word (patris), short or divided and long, as the
                       poet scans it in the data
      6    mcl-start   comes before a mute (stop) + liquid, or f + liquid, that begins the next word (unda gravet,
                       curvāmine flectit): short
      7    greek       lies in a word the scanner calls Greek-looking (āera, Aenēās, Pēnēia)
      8    advanced    (NOT ASKED: the owner left every licence out -- hiatus, synizesis, a syllable
                       lengthened at the beat, an ignored or position-making word-initial cluster)
A syllable of several kinds takes the highest, as a line does. Two judgements that are this file's own, and
are listed in the --audit and the report so the owner can overrule them:
  * a vowel before a mute (stop) + liquid that the poet DIVIDES (long: pat-ris) is `mcl`, because the zoom-in
    teaches it as mūta cum liquida; the scanner raises no flag for it (a closed syllable like another);
  * a syllable in a Greek-looking word is `greek` whatever its reason, as the scanner levels a whole line.

WHICH SYLLABLES ARE ASKED. Never: a vowel that carries a macron in the text, unless it is elided (then the answer
is X, which the macron does not give away); a diphthong, or a written ae/au/oe read as two syllables; the last
syllable of a line (anceps, long by definition) or a vowel elided into the next line (hypermetry);
anything at or after a line's `reading_ends`; the e of est lost by prodelision (not the final vowel of a
word that elides -- INCLUDE_PRODELISION or --prodelision asks them); a line that does not scan or scans
two ways equally well (none today). Lines flagged `advanced` (they needed a licence to scan) give no
questions at all: no licence is asked, and the rest of such a line is left out with it. Everything else the data marks L, S or elided is asked, once.

REASONS. Every sentence is the app's (app.js zoomStrip / zoomReason / doubledNote), ported line for line;
the one input the app takes from its drawing -- which letters the zoom-in lifts out -- is recomputed here
from the same `syllable`, `doubled` and `silent` fields.
"""
from __future__ import annotations

import argparse
import gzip
import itertools
import json
import random
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scansion"))
import scansion  # noqa: E402  (the scanner: level_of, ADVANCED, is_vowel -- reused, never edited)

LINES = ROOT / "data" / "lines.json"
OUT = ROOT / "data" / "meter_questions.json"
SAMPLE = ROOT / "tools" / "meter_questions_sample.md"
APP = ROOT / "app.js"

INCLUDE_PRODELISION = False
NOTE = ("Generated by tools/make_meter_questions.py from data/lines.json; edit there. "
        "Content: CC BY-NC-SA 4.0; the Latin is public domain.")

# level -> kind, and the labels the practice page uses (app.js KIND_NAMES)
KIND_OF_LEVEL = {1: "plain", 2: "qu", 3: "hxz", 4: "elision", 5: "mcl", 6: "mcl-start", 7: "greek",
                 8: "advanced"}
LABELS = ["Long and short only", "qu", "h, x, z, letters that count twice", "Elision", "Mūta cum liquida",
          "Consonants at the start of a word", "Greek words", "Advanced"]
# kind `advanced` (level 8) is never asked (owner's ruling, 2026-10-27), so the file does not list it
KINDS = {KIND_OF_LEVEL[k]: {"level": k, "label": LABELS[k - 1]} for k in KIND_OF_LEVEL if k != 8}
LEVEL_OF_KIND = {k: v["level"] for k, v in KINDS.items()}
SPLIT_PAIRS = {"ae", "au", "oe"}      # written diphthongs the scanner may read as two syllables
THIN = 50                             # a kind with fewer questions than this is "thin" in the report
SAMPLE_SEED = 20261027
DEFAULT_KINDS = ("plain", "elision", "mcl")   # the meter mode's default ticks (PLAN.md, P5)
MIX = {"L": 0.4, "S": 0.4, "X": 0.2}


# ---- the app's own rules, ported ------------------------------------------------------------------------
def expected(n: dict) -> str:
    """app.js expected(): how a nucleus's mark becomes L, S or X for the drum player and the answer."""
    return n["mark"] if n["mark"] in ("L", "S") else "X"


def esc(s: str) -> str:
    """app.js escapeHTML."""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def zoom_strip(l: dict, i: int):
    """The letters app.js zoomStrip works out for nucleus i, without the drawing: what the sentence
    names (coda, onset, said, the notes). None when the nucleus has no syllable to show."""
    N, chars = l["nuclei"], l["text"]
    act = [k for k in range(len(N)) if "syllable" in N[k]]
    n = N[i]
    if i in act:
        s = act.index(i)
    else:                                            # elided or merged: the syllable it lies inside
        s = next((t for t, k in enumerate(act) if N[k]["syllable"][0] <= n["start"] < N[k]["syllable"][1]), -1)
    if s < 0:
        return None
    me = act[s]
    nx = act[s + 1] if s + 1 < len(act) else None
    halves = {d["at"]: d["as"] for d in l.get("doubled", [])}
    silent = set(l.get("silent", []))
    nuc_of = {p: k for k, x in enumerate(N) for p in range(x["start"], x["end"])}
    gone = set()                                     # an elided vowel and its -m; a prodelided e
    for x in N:
        if x["mark"] not in ("elided", "prodelided"):
            continue
        e = x["end"]
        if x["mark"] == "elided":
            while e < len(chars) and chars[e].isalpha():
                e += 1
        gone.update(range(x["start"], e))

    def role(p):
        if not chars[p].isalpha():
            return "sp"
        if p in gone:
            return "gone"
        if p in nuc_of:
            return "glide" if N[nuc_of[p]]["mark"] == "merged" else "v"
        return "h" if p in silent else "c"

    def is_cons(p):
        return role(p) in ("c", "glide")

    def is_j(p):                                     # an i the scanner counts as a consonant is a j
        return chars[p] in "iI" and is_cons(p) and p not in halves

    def said(p):
        return ("J" if chars[p] == "I" else "j") if is_j(p) else chars[p]

    def letters(ps, side):
        return "".join(halves[p][side] if p in halves else said(p).lower() for p in ps)

    coda = [p for p in range(N[me]["end"], N[me]["syllable"][1]) if is_cons(p)]
    onset = ([p for p in range(N[nx]["syllable"][0], N[nx]["start"]) if is_cons(p)] if nx is not None else [])
    z = {"coda": letters(coda, 0), "onset": letters(onset, 1), "codaAt": coda[-1] if coda else None}
    sa, sb = N[me]["syllable"]
    z["said"] = "".join(halves[p][1 if p == sa else 0] if p in halves else said(p)
                        for p in range(sa, sb) if chars[p].isalpha() and p not in gone)
    z["j"] = n["mark"] != "merged" and any(is_j(p) and role(p) == "c" for p in [*range(sa, sb), *onset])
    z["crossed"] = bool(onset) and any(not chars[q].isalpha() for q in range(onset[-1] + 1, N[nx]["start"]))
    z["h"] = nx is not None and any(p in silent for p in range(N[me]["end"], N[nx]["start"]))
    z["qu"] = "qu" in n.get("followed_by", "") or re.search("qu", z["said"], re.I) is not None
    z["next"] = z["hNext"] = z["m"] = False
    z["word"] = ""
    if n["mark"] == "elided":
        z["next"] = N[me]["start"] > n["start"]      # the vowel it runs into -- or the next line's
        if z["next"]:
            z["hNext"] = any(p in silent for p in range(n["end"], N[me]["start"]))
        z["m"] = n["end"] < len(chars) and chars[n["end"]].isalpha()
    if n["mark"] == "prodelided":
        p = n["start"] - 1
        while p > 0 and not chars[p].isalpha():
            p -= 1
        w = p
        while w > 0 and chars[w - 1].isalpha():
            w -= 1
        z["word"] = chars[w:p + 1]
    return z


def vowel_next(l: dict, i: int):
    """The vowel straight after this one in its word, nothing between them: de-us, fī-li-us."""
    N = l["nuclei"]
    nxt = N[i + 1] if i + 1 < len(N) else None
    return nxt if nxt and nxt["start"] == N[i]["end"] else None


def doubled_note(l: dict, z: dict) -> str:
    d = next((x for x in l.get("doubled", []) if x["at"] == z["codaAt"]), None)
    if not d:
        return ""
    c = l["text"][d["at"]].lower()
    if c == "x":
        return " <i>x</i> is two consonants, <i>c</i> + <i>s</i>, and they divide between the syllables."
    if c == "z":
        return " <i>z</i> is two consonants, <i>d</i> + <i>z</i>, and they divide between the syllables."
    if c == "i":
        return (" An <i>i</i> between two vowels is a consonant, <i>j</i> (say it like English <i>y</i>), "
                "and it counts twice: once to end this syllable, once to begin the next.")
    if d["as"][0] == "c" and d["as"][1] == "c":
        return " <i>hic</i> and <i>hoc</i> before a vowel are really <i>hicc</i> and <i>hocc</i>."
    return f" This word hides an unwritten <i>j</i> after its <i>{esc(d['as'][0])}</i>: <i>in-jiciō</i>."


def reason(l: dict, i: int):
    """(tag, why) -- app.js zoomWhy(zoomReason(...)): the label and the sentence the zoom-in shows."""
    n, z = l["nuclei"][i], zoom_strip(l, i)
    if not z:
        return "", ""

    def b(s):
        return f'<b class="la">{esc(s)}</b>'

    v = b(n["text"])
    after = vowel_next(l, i)
    qu_note = " (<i>qu</i> is one consonant: its <i>u</i> is not a vowel.)" if z["qu"] else ""
    h_note = " The <i>h</i> does not count." if z["h"] else ""
    hiatus = (" The next word begins with a vowel, but here the poet does not elide: that is hiatus."
              if n.get("hiatus") else "")
    open_ = "So the syllable ends in its short vowel."
    why = n.get("why") or n["mark"]
    if why == "long vowel":
        tag, s = "long vowel", (f"Its vowel, {v}, is long — it has a macron."
                                + (" A vowel before another vowel is usually short; the macron says this "
                                   "one is not." if after else "") + hiatus)
    elif why == "diphthong":
        tag, s = "diphthong", f"{v} is a diphthong, two vowels said as one, and diphthongs are long.{hiatus}"
    elif why == "two consonants":
        tag, s = "ends in a consonant", (
            f"It ends in a consonant, {b(z['coda'])}: two consonants come after its vowel, and they divide "
            f"between this syllable and the next.{qu_note}{doubled_note(l, z)}{h_note}")
    elif why == "muta cum liquida, long":
        tag, s = "mūta cum liquida, divided", (
            f"{b(n['followed_by'])} is a mūta cum liquida: a mute (stop) + <i>l</i> or <i>r</i>, which can go "
            f"either way. Here the poet divides it: {b(z['coda'])} ends this syllable, so it is long.")
    elif why == "muta cum liquida, short":
        tag, s = "mūta cum liquida", (
            f"{b(z['onset'])} is a mūta cum liquida: a mute (stop) + <i>l</i> or <i>r</i>, which can go either "
            f"way. Here it goes together into the next syllable. {open_}")
    elif why == "muta cum liquida at word start":
        tag, s = "mūta cum liquida", (
            f"The next word begins with {b(z['onset'])}, a mūta cum liquida. It goes together into the next "
            f"syllable. {open_}")
    elif why == "f + liquid at word start":
        tag, s = "f + liquid", (
            f"The next word begins with {b(z['onset'])}. Like a mūta cum liquida, it goes together into the "
            f"next syllable. {open_}")
    elif why == "word-initial cluster makes position":
        tag, s = "ends in a consonant", (
            f"The next word begins with {b(n['followed_by'])}, and here they divide: {b(z['coda'])} ends "
            "this syllable, so it is long.")
    elif why == "word-initial cluster ignored":
        tag, s = "short vowel", (
            f"The next word begins with {b(n['followed_by'])}, but the poet lets them go together into the "
            f"next syllable. {open_}")
    elif why == "short vowel":
        if n.get("hiatus"):
            tag, s = "no elision", f"{hiatus.strip()} {open_}"
        elif after:
            tag, s = "vowel before a vowel", (
                f"{v} comes straight before another vowel, {b(after['text'])}. They are not a diphthong, so "
                "they are two syllables — and a vowel before another vowel is short.")
        elif not z["onset"]:
            tag, s = "short vowel", f"Its vowel is short, and the next syllable begins with a vowel. {open_}"
        else:
            across = ", even across the space between words" if z["crossed"] else ""
            tag, s = "short vowel", (f"Its vowel is short, and only one consonant follows: {b(z['onset'])} "
                                     f"begins the next syllable{across}. {open_}{qu_note}{h_note}")
    elif why == "correption":
        tag, s = "shortened", (f"{v} has a macron, but a long vowel at the end of a word can be shortened "
                               "before another vowel (correption).")
    elif why == "final syllable":
        tag, s = "end of the line", "It is the last syllable of the line, and the last syllable always counts as long."
    elif why == "lengthened syllable":
        tag, s = "lengthened at the beat", (
            f"Only one consonant follows, {b(z['coda'])}, so it ought to be short. But the beat falls here: "
            f"the poet keeps {b(z['coda'])} in this syllable and lengthens it.")
    elif why == "elided":
        if not z["next"]:
            tag, s = "into the next line", ("The line has one syllable too many: its last vowel elides into "
                                            "the next line, which begins with a vowel (hypermetry).")
        else:
            m_note = " + <i>m</i>" if z["m"] else ""
            nxt = ("an <i>h</i> and a vowel — the <i>h</i> does not count" if z["hNext"] else "a vowel")
            tag, s = "the next word begins with a vowel", (
                f"Its word ends in a vowel{m_note}, and the next word begins with {nxt}. So "
                f"{v}{b('m') if z['m'] else ''} is elided, and the swoosh joins what is left to the next vowel.")
    elif why == "prodelided":
        tag, s = "est after a vowel", (
            f"After a vowel or <i>-m</i>, the <i>e</i> of <i>est</i> drops out: {b(z['word'] + ' est')} is "
            f"said {b(z['word'] + '’st')}.")
    elif why == "merged":
        j = ": it becomes a consonant, <i>j</i>, said like English <i>y</i>" if re.search("i", n["text"], re.I) else ""
        tag, s = "run together", (f"{v} runs together with the next vowel into one syllable (synizesis){j}.")
    else:
        return "", ""
    if z["j"]:
        s += " The <i>i</i> before a vowel is a consonant, <i>j</i> (say it like English <i>y</i>)."
    return tag, s


# ---- one syllable: its flags, its kind --------------------------------------------------------------------
def words_of(text: str):
    """[(start, end)] of each word, as scansion.WORD finds them."""
    return [(m.start(), m.end()) for m in scansion.WORD.finditer(text.lower())]


def has_macron(n: dict, text: str) -> bool:
    """A macron on the nucleus, capital or small (Ī, ī): NFD splits it off as U+0304."""
    return "̄" in unicodedata.normalize("NFD", text[n["start"]:n["end"]])


def syllable_flags(l: dict, i: int) -> set:
    """The flags the scanner would raise for this one syllable, by its own names (scansion.build_line):
    'qu', 'h, x, z', 'elision', 'prodelision', the muta kinds, the advanced licences, 'greekiness'."""
    N, text = l["nuclei"], l["text"]
    n = N[i]
    flags: set = set()
    why, mark = n.get("why"), n["mark"]
    if mark == "elided":
        flags.add("hypermetry" if i == len(N) - 1 else "elision")
    elif mark == "prodelided":
        flags.add("prodelision")
    elif mark == "merged":
        flags.add("synizesis")
    if n.get("hiatus"):
        flags.add("hiatus")
    if why == "lengthened syllable":
        flags.add("lengthened syllable")
    elif why == "correption":
        flags.add("correption")
    elif why == "word-initial cluster makes position":
        flags.add("word-initial cluster makes position")
    elif why == "word-initial cluster ignored":
        flags.add("ignored cluster")
    elif why in ("muta cum liquida, short", "muta cum liquida, long"):
        flags.add("muta cum liquida")                # (the scanner flags only the short one: see KINDS)
    elif why in ("muta cum liquida at word start", "f + liquid at word start"):
        flags.add(why)
    if "qu" in n.get("followed_by", ""):
        flags.add("qu")
    if "syllable" in n:
        # scansion.build_line, the h/x/z test: a short syllable with an h among its consonants, or a long
        # one whose only consonant is a single letter that counts twice (x, z, i between vowels, hic/hoc)
        nxt = next((x for x in N[i + 1:] if "syllable" in x), None)
        if nxt is not None:
            raw = "".join(c for c in text.lower()[n["end"]:nxt["start"]]
                          if c.isalpha() and not scansion.is_vowel(c))
            if (mark == "S" and "h" in raw and len(raw) >= 2) or (
                    mark == "L" and why == "two consonants" and len(n.get("followed_by", "")) == 1):
                flags.add("h, x, z")
    if any(d["start"] <= n["start"] < d["end"] for d in l.get("difficult_words", [])):
        flags.add("greekiness")
    return flags


def syllable_level(l: dict, i: int) -> int:
    flags = syllable_flags(l, i)
    return scansion.level_of(flags, bool(flags & scansion.ADVANCED))


def skip_reason(l: dict, i: int, prodelision: bool = INCLUDE_PRODELISION):
    """Why syllable i is not asked about, or None. The order is the order the report counts in."""
    N, text = l["nuclei"], l["text"]
    n = N[i]
    if not l.get("scans") or l.get("ambiguous"):
        return "line not settled"
    if n.get("why") == "final syllable":
        return "last syllable of the line"
    if i == len(N) - 1 and n["mark"] == "elided":
        return "last vowel elided into the next line (hypermetry)"
    if has_macron(n, text) and n["mark"] != "elided":     # an elided vowel with a macron IS asked (ruling 1)
        return "macron on the vowel"
    if n.get("why") == "diphthong" or n["end"] - n["start"] > 1:    # (an elided diphthong has no `why`)
        return "diphthong"
    if text[n["start"]:n["end"]] + (text[n["end"]] if n["end"] < len(text) else "") in SPLIT_PAIRS \
            and i + 1 < len(N) and N[i + 1]["start"] == n["end"]:
        return "ae/au/oe read as two syllables"
    if l.get("reading_ends") is not None and n["start"] >= l["reading_ends"]:
        return "beyond the line's reading_ends"
    if n["mark"] == "prodelided" and not prodelision:
        return "e of est lost by prodelision"
    if l.get("advanced"):                                  # no licence is asked, so nor is its line (ruling 3)
        return "syllable of a line that needed a licence"
    return None


# ---- the bank ----------------------------------------------------------------------------------------------
def line_entry(l: dict) -> dict:
    e = {"text": l["text"], "marks": [expected(n) for n in l["nuclei"]],
         "accents": [bool(n.get("accent")) for n in l["nuclei"]],
         "nuclei": [[n["start"], n["end"]] for n in l["nuclei"]],
         "passage": l["passage"], "level": l["level"], "flags": l["flags"]}
    if l.get("reading_ends") is not None:
        e["reading_ends"] = l["reading_ends"]
    if l.get("meter"):
        e["meter"] = l["meter"]
    return e


def question(l: dict, i: int) -> dict:
    n, text = l["nuclei"][i], l["text"]
    end = n["end"] + (1 if n["mark"] == "elided" and n["end"] < len(text) and text[n["end"]].isalpha() else 0)
    word = next(w for w in words_of(text) if w[0] <= n["start"] < w[1])
    level = syllable_level(l, i)
    tag, why = reason(l, i)
    return {"id": f"{l['citation']}#{i}", "line": l["citation"], "i": i, "span": [n["start"], end],
            "word": list(word), "answer": expected(n), "kind": KIND_OF_LEVEL[level], "level": level,
            "tag": tag, "why": why}


def build(lines: list[dict], prodelision: bool = INCLUDE_PRODELISION):
    """(bank, skipped): the bank as the file holds it, and {reason: count} for what was left out."""
    entries, questions, skipped = {}, [], Counter()
    for l in lines:
        for i in range(len(l["nuclei"])):
            r = skip_reason(l, i, prodelision)
            if r:
                skipped[r] += 1
                continue
            questions.append(question(l, i))
            entries.setdefault(l["citation"], line_entry(l))
    bank = {"note": NOTE, "kinds": KINDS, "lines": entries, "questions": questions}
    return bank, skipped


def render(bank: dict) -> str:
    """The file's text: one line, one question per row, so a diff reads and the size stays small."""
    dump = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))  # noqa: E731
    out = ["{", f'"note":{dump(bank["note"])},', f'"kinds":{dump(bank["kinds"])},', '"lines":{']
    out.append(",\n".join(f"{dump(c)}:{dump(e)}" for c, e in bank["lines"].items()))
    out += ["},", '"questions":[', ",\n".join(dump(q) for q in bank["questions"]), "]", "}", ""]
    return "\n".join(out)


def load_lines(path: Path = LINES) -> list[dict]:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


# ---- looking for what is doubtful in the data (listed, never fixed) -------------------------------------
def audit(lines: list[dict]) -> list[tuple]:
    """(citation, nucleus index, letters, what looks doubtful). The data is the scanner's and the owner's;
    this only reads it."""
    out = []
    for l in lines:
        N, text = l["nuclei"], l["text"]
        for i, n in enumerate(N):
            why, mark, fb = n.get("why"), n["mark"], n.get("followed_by", "")
            letters = text[n["start"]:n["end"]]
            mac = has_macron(n, text)

            def add(msg, c=l["citation"], i=i, letters=letters):
                out.append((c, i, letters, msg))

            if why == "long vowel" and not mac:
                add("marked 'long vowel' but carries no macron")
            if mac and mark == "S" and why != "correption":
                add("macron on a vowel marked short")
            if why == "short vowel" and not mac and fb and len(fb) >= 2 and fb not in ("qu", "ph", "th", "ch"):
                add("short vowel before more than one letter", letters=f"{letters} + {fb}")
            if why == "two consonants" and not fb:
                add("long by position with no consonant after it")
            if mark == "elided" and mac:
                add("elided vowel carries a macron (asked, as elision with the answer X)")
            if mark == "elided" and i == len(N) - 1:
                add("last vowel elided into the next line (hypermetry): kept out of the bank")
            if mark == "prodelided":
                add("e of est lost by prodelision: kept out of the bank unless --prodelision")
            if mark == "merged":
                add("synizesis: not asked (its line needed a licence)")
            if n.get("hiatus"):
                add("hiatus: a licence the scanner needed (not asked)")
            if why == "lengthened syllable":
                add("syllable lengthened at the beat: a licence the scanner needed (not asked)")
            if why == "muta cum liquida, long":
                add("mūta cum liquida scanned long: kind mcl, though the scanner raises no flag for it")
            if why == "diphthong" and text[n["start"]:n["end"]].lower() not in ("ae", "au", "oe", "eu", "ei", "ui"):
                add("diphthong that is not ae/au/oe/eu/ei/ui")
            if (i + 1 < len(N) and N[i + 1]["start"] == n["end"] and text[n["start"]:n["end"] + 1] in SPLIT_PAIRS):
                add("ae/au/oe read as two syllables (diphthong split)")
        if l.get("stage") == 2:
            out.append((l["citation"], -1, ", ".join(l["flags"]), "line needed an advanced licence to scan (whole line not asked)"))
        if l.get("reading_ends") is not None:
            out.append((l["citation"], -1, str(l["reading_ends"]), "the reading stops part-way; the rest is grey"))
        if l.get("meter"):
            out.append((l["citation"], -1, l["meter"], "not a whole hexameter"))
        if l.get("ambiguous"):
            out.append((l["citation"], -1, "", "scans two ways equally well"))
    return out


# ---- the report --------------------------------------------------------------------------------------------
def feasible(lines_by_answer: dict[str, set], n: int) -> bool:
    """Can n distinct lines be picked, one question each, in the 40/40/20 mix? Hall's condition for three
    answer types: for every set of answers, the lines that can supply one of them must cover the need."""
    need = {a: round(n * MIX[a]) for a in MIX}
    for r in range(1, 4):
        for combo in itertools.combinations("LSX", r):
            supply = set().union(*(lines_by_answer.get(a, set()) for a in combo))
            if len(supply) < sum(need[a] for a in combo):
                return False
    return True


def report(bank: dict, skipped: Counter, lines: list[dict]) -> str:
    qs = bank["questions"]
    out = []
    p = out.append
    raw = render(bank).encode("utf-8")
    p(f"Meter question bank: {len(qs)} questions on {len(bank['lines'])} of {len(lines)} lines "
      f"({len(raw) / 1024:.0f} KB; {len(gzip.compress(raw)) / 1024:.0f} KB gzipped, what a web server sends)")
    p("")
    p("Left out, by reason (the syllables of the 720 lines: "
      f"{sum(len(l['nuclei']) for l in lines)}):")
    for r, c in skipped.most_common():
        p(f"  {c:>5}  {r}")
    p("")
    by = defaultdict(Counter)
    for q in qs:
        by[q["kind"]][q["answer"]] += 1
    p("Questions by kind and answer:")
    p(f"  {'kind':<10} {'lvl':>3} {'Long':>6} {'Short':>6} {'Elided':>6} {'total':>6}")
    for k in KINDS:
        c = by[k]
        p(f"  {k:<10} {LEVEL_OF_KIND[k]:>3} {c['L']:>6} {c['S']:>6} {c['X']:>6} {sum(c.values()):>6}")
    tot = Counter(q["answer"] for q in qs)
    p(f"  {'all':<10} {'':>3} {tot['L']:>6} {tot['S']:>6} {tot['X']:>6} {len(qs):>6}")
    p("")
    passages = sorted({e["passage"] for e in bank["lines"].values()})
    p("Questions by passage, kind and answer (Long / Short / Elided):")
    for ps in passages:
        c = defaultdict(Counter)
        for q in qs:
            if bank["lines"][q["line"]]["passage"] == ps:
                c[q["kind"]][q["answer"]] += 1
        p(f"  {ps} ({sum(sum(x.values()) for x in c.values())})")
        for k in KINDS:
            if c[k]:
                p(f"      {k:<10} {c[k]['L']:>4} / {c[k]['S']:>4} / {c[k]['X']:>4}")
    p("")
    thin = [(k, sum(by[k].values())) for k in KINDS if sum(by[k].values()) < THIN]
    p(f"Kinds thinner than {THIN} questions: " + (", ".join(f"{k} ({c})" for k, c in thin) if thin else "none"))
    p("")
    # the default mix: can a game of N questions hold ~40 % long / 40 % short / 20 % elided?
    p(f"Default mix ({'+'.join(DEFAULT_KINDS)}), 40 % long / 40 % short / 20 % elided, no line twice:")
    scopes = [("all passages", None)] + [(ps, ps) for ps in passages]
    p(f"  {'':<22}" + "".join(f"{n:>9}" for n in (10, 20, 30, 40)))
    for label, ps in scopes:
        pick = [q for q in qs if q["kind"] in DEFAULT_KINDS and (ps is None or bank["lines"][q["line"]]["passage"] == ps)]
        by_ans: dict[str, set] = defaultdict(set)
        for q in pick:
            by_ans[q["answer"]].add(q["line"])
        p(f"  {label:<22}" + "".join(f"{('yes' if feasible(by_ans, n) else 'NO'):>9}" for n in (10, 20, 30, 40)))
    pick = [q for q in qs if q["kind"] in DEFAULT_KINDS]
    odd = len({q["line"] for q in pick if q["kind"] != "plain"})
    p(f"  (no two in a row of one kind needs {20} lines holding a non-plain question for a 40-question "
      f"game; there are {odd})")
    p("")
    docs = audit(lines)
    p(f"Doubtful items in the data (python tools/make_meter_questions.py --audit lists them): {len(docs)}")
    return "\n".join(out)


def format_audit(docs: list[tuple]) -> str:
    groups: dict[str, list] = defaultdict(list)
    for c, i, letters, msg in docs:
        groups[msg].append((c, i, letters))
    out = []
    for msg, items in sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        out.append(f"{msg}: {len(items)}")
        for c, i, letters in items:
            out.append(f"    {c}" + (f"  syllable {i} ({letters})" if i >= 0 else f"  ({letters})" if letters else ""))
    return "\n".join(out)


# ---- the review sheet ----------------------------------------------------------------------------------------
def plain_text(html: str) -> str:
    return re.sub(r"</?(?:b|i)[^>]*>", "", html).replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")


def sample_sheet(bank: dict, seed: int = SAMPLE_SEED, per_kind: int = 5, total: int = 40) -> str:
    rng = random.Random(seed)
    qs = bank["questions"]
    by_kind = defaultdict(list)
    for q in qs:
        by_kind[q["kind"]].append(q)
    picked: list[dict] = []
    for k in KINDS:                                  # 5 from every kind that has them, thin ones included
        pool = by_kind[k]
        picked += rng.sample(pool, min(per_kind, len(pool)))
    ids = {q["id"] for q in picked}
    larger = [q for k in KINDS if len(by_kind[k]) >= THIN for q in by_kind[k] if q["id"] not in ids]
    picked += rng.sample(larger, max(0, total - len(picked)))
    picked.sort(key=lambda q: (LEVEL_OF_KIND[q["kind"]], q["line"], q["i"]))
    word = {"L": "LONG", "S": "SHORT", "X": "ELIDED"}
    out = ["# Meter question bank — review sheet", "",
           f"{len(picked)} questions drawn at random (seed {seed}) from {len(qs)}; "
           "the same sheet comes back every time the script is run. For each one, the syllable asked about is in "
           "[brackets] and marked ▲ under the line; ¯ long, ˘ short, × elided are the answers for the whole line. "
           "Mark any whose answer or reason you would not teach.", ""]
    for n, q in enumerate(picked, 1):
        e = bank["lines"][q["line"]]
        text = e["text"]
        a, b = q["span"]
        shown = text[:a] + "[" + text[a:b] + "]" + text[b:]
        row = [" "] * len(text)
        sym = {"L": "¯", "S": "˘", "X": "×"}
        for (s, _), m in zip(e["nuclei"], e["marks"]):
            row[s] = sym[m]
        pointer = [" "] * len(text)
        pointer[a] = "▲"                              # (the rows below keep the line's own offsets)
        out += [f"## {n}. {q['line']} — {q['kind']} (level {q['level']}) — answer: **{word[q['answer']]}**", "",
                f"> {shown}", "",
                "```", text, "".join(row).rstrip(), "".join(pointer).rstrip(), "```", "",
                f"*{q['tag']}* — {plain_text(q['why'])}", "",
                "Right ☐   Wrong ☐   Note: ", ""]
    return "\n".join(out)


# ---- command line ----------------------------------------------------------------------------------------------
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--lines", type=Path, default=LINES)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--report", action="store_true", help="print the distribution report; write nothing")
    ap.add_argument("--audit", action="store_true", help="list what looks doubtful in the data; write nothing")
    ap.add_argument("--sample", nargs="?", const=SAMPLE, type=Path, metavar="PATH",
                    help=f"write the review sheet (default {SAMPLE.relative_to(ROOT)}); not committed")
    ap.add_argument("--check", action="store_true", help="exit 1 if the file on disk is out of date")
    ap.add_argument("--prodelision", action="store_true", help="also ask about the e of est lost by prodelision")
    args = ap.parse_args(argv)
    for s in (sys.stdout, sys.stderr):
        if hasattr(s, "reconfigure"):
            s.reconfigure(encoding="utf-8")
    lines = load_lines(args.lines)
    bank, skipped = build(lines, args.prodelision)
    if args.audit:
        print(format_audit(audit(lines)))
        return 0
    if args.report:
        print(report(bank, skipped, lines))
        return 0
    text = render(bank)
    if args.check:
        have = args.out.read_bytes() if args.out.exists() else b""
        if have != text.encode("utf-8"):
            print(f"{args.out} is out of date; run tools/make_meter_questions.py")
            return 1
        print("up to date")
        return 0
    if args.sample:
        args.sample.write_text(sample_sheet(bank), encoding="utf-8", newline="\n")
        print(f"wrote {args.sample}")
        return 0
    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    print(f"wrote {args.out}: {len(bank['questions'])} questions on {len(bank['lines'])} lines, "
          f"{len(text.encode('utf-8')) / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
