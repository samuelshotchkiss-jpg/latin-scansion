"""scansion.py -- scan macronized Latin hexameters (and pentameters), nucleus by nucleus.

This is the engine behind the latin-scansion app, and it has no dependencies beyond the Python 3.10+
standard library. Give it a line of Latin in which every long vowel carries a macron:

    >>> import scansion
    >>> r = scansion.scan("atque ita compositās parvō curvāmine flectit,")
    >>> r["feet"], r["level"], r["flags"]
    (['LSS', 'LSS', 'LL', 'LL', 'LSS', 'LL'], 6, ['elision', 'f + liquid at word start', 'qu'])

WHAT A SCAN IS. For every vowel or diphthong in the line -- every syllable NUCLEUS -- the result
gives its span in the text, its mark (L long, S short, or `elided` when elision removes it), and the
reason for the mark. It never gives syllable boundaries: students mark nuclei, and where the
consonants fall is only a means to deciding long or short.

WHY THE TEXT MUST BE MACRONIZED. A scanner working from an unmacronized text has to guess vowel
length. Here a macron is a long vowel and an unmarked vowel is short, so every mark has a stated
reason. What remains is what the poet chose -- elision, a mute + liquid inside a word, a consonantal
i -- and the meter decides it. A line that will not scan therefore usually carries a wrong macron.

CONVENTIONS. Change these if you teach differently:
  * the final syllable of the line is long by definition;
  * muta cum liquida is a stop (p b t d c g) + l or r. Inside a word the meter decides. CONSONANTS AT THE
    START OF A WORD are their own kind: a mute + liquid there leaves a short final vowel short, and so
    does f + l / f + r -- which is not muta cum liquida at all;
  * ADVANCED, and tried only when a line will not scan without them: hiatus, synizesis, correption,
    a dissolved diphthong, hypermetry, lengthening at the beat, a word-initial cluster the poet
    ignores. Also advanced, though tried first: a word-initial cluster (sc-, sp-, st-...) that makes
    position by itself. The s + t left by prodelision (vīsa 'st) is not one: that is ordinary position.
  * GREEKINESS: a word that looks unlike ordinary Latin -- a pair that looks like a diphthong and is
    not (āera), vowels side by side in a name (Aenēās), an eu diphthong (Teucrī), three vowels in a
    row, the same vowel twice, many vowels, or a name whose macron was hard to settle. A y alone is
    not enough, and a familiar name (Īcarus) is not hard.

QU; H, X, Z. Any qu flags a line, because students take its u for a vowel. h, x and z are a later,
separate kind, flagging a line only where miscounting them would change a mark: a short syllable with
an h among its consonants (captat harundine), a long syllable whose only consonant is x or z (dīxit).

LEVELS. A line sits at the lowest level that admits everything in it:
    1 long and short only   2 + qu   3 + h, x, z   4 + elision   5 + muta cum liquida
    6 + consonants at the start of a word   7 + Greekiness   8 + anything advanced

HINTS (optional). `scan(text, citation, hints)` accepts
    {"names": {...}, "trouble": {...}}
where each set holds bare forms ("aeneas") or (citation, bare form) pairs. `names` marks proper
nouns the text does not capitalize; `trouble` marks words whose vowel lengths were hard to settle
(corrected by hand, or disputed by a macronizer). Only names count as trouble: a corrected case
ending is not Greek. `bare()` makes the forms.

METER. `scan()` reads a hexameter unless told otherwise. `scan(text, cit, hints, meter="pentameter")`
reads the second line of an elegiac couplet: two dactyls or spondees and a long syllable, a word end
(the diaeresis at mid-line), then two dactyls and a final syllable -- `feet` comes back as
['LSS', 'LL', 'L', 'LSS', 'LSS', 'L']. The same conventions apply, and the syllable before the
diaeresis must be long, like the last. A pentameter's result carries "meter": "pentameter"; a
hexameter's carries no meter key, so a hexameter answer key is unchanged. Which line of a couplet is
which is the caller's to say (by its position): some pentameters also scan as hexameters.
"""
from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass

LONG = {"ā": "a", "ē": "e", "ī": "i", "ō": "o", "ū": "u", "ȳ": "y"}
DIAERESIS = {"ä": "a", "ë": "e", "ï": "i", "ö": "o", "ü": "u", "ÿ": "y"}
PLAIN = set("aeiouy")
STOPS, LIQUIDS = set("pbtdcgk"), set("lr")
WORD = re.compile(r"[a-zāēīōūȳäëïöüÿ]+")
HEXAMETER = re.compile(r"^(?:LSS|LL){5}LL$")     # the final syllable is long by definition
PENTAMETER = re.compile(r"^((?:LSS|LL){2})L(?:LSS){2}L$")   # group 1: the half before the diaeresis
METERS = {"hexameter": HEXAMETER, "pentameter": PENTAMETER}

JOINED_EU = {"neu", "ceu", "seu", "heu", "eheu", "heus"}   # plus any name: Teucrī, Orpheus
JOINED_EI = {"dein", "deinde", "deinceps", "hei", "ei"}   # `ei` unmarked is the interjection; the pronoun is eī
PREFIX_BEFORE_I = re.compile(r"(?:con|ad|ob|sub|ab|in|dis)$")   # con-iugis: the i is a consonant
JOINED_UI = {"cui", "huic"}
CONSONANTAL_SU = re.compile(r"su[āa][vd]|su[ēe](?:sc|t)")   # suāvis, suādeō, suēscō, mānsuētus
MAX_DEVIATIONS = 4        # non-default choices per line; bounds the stage-2 search
ADVANCED = {"hiatus", "synizesis", "correption", "diphthong split", "hypermetry", "lengthened syllable",
            "ignored cluster", "word-initial cluster makes position"}
ELISION = {"elision", "prodelision"}
MUTA = {"muta cum liquida"}                                                  # inside a word
WORD_START = {"muta cum liquida at word start", "f + liquid at word start"}  # not a kind of muta: fl- is no mute


def level_of(flags: set, advanced: bool) -> int:
    """1 long and short only; 2 + qu; 3 + h, x, z; 4 + elision; 5 + muta cum liquida; 6 + consonants at
    the start of a word; 7 + Greekiness; 8 + advanced."""
    if advanced:
        return 8
    if "greekiness" in flags:
        return 7
    if flags & WORD_START:
        return 6
    if flags & MUTA:
        return 5
    if flags & ELISION:
        return 4
    if "h, x, z" in flags:
        return 3
    if "qu" in flags:
        return 2
    return 1


def base(c: str) -> str:
    return LONG.get(c) or DIAERESIS.get(c) or c


def is_vowel(c: str) -> bool:
    return base(c) in PLAIN


def bare(s: str) -> str:
    """Fold a form for comparison: no macrons, lower case, v -> u, j -> i."""
    s = "".join(c for c in unicodedata.normalize("NFD", s) if not unicodedata.combining(c))
    return s.lower().replace("v", "u").replace("j", "i")


@dataclass
class Unit:
    kind: str                # "V" a nucleus, "C" a consonant
    start: int               # offsets into the NFC line
    end: int
    word: int
    long: bool = False       # V: long by nature
    why: str = ""            # V: "long vowel" / "diphthong" / "split"
    count: int = 1           # C: consonants it is worth (x, z, consonantal i between vowels = 2)
    stop: bool = False
    liquid: bool = False
    gone: str = ""           # V: "elided" / "prodelided" / "merged"
    dropped: bool = False    # C: the -m of an elided syllable


def parse_word(t: str, ws: int, wi: int, proper: bool, pick) -> list[Unit]:
    units: list[Unit] = []
    i, n = 0, len(t)
    while i < n:
        c = t[i]
        nxt = t[i + 1] if i + 1 < n else ""
        if is_vowel(c):
            if (c == "i" and nxt == "c" and i + 2 < n and is_vowel(t[i + 2]) and units
                    and units[-1].kind == "C" and PREFIX_BEFORE_I.match(t[:i])):
                # iniciō, coniciō, abiciō: iaciō's j is not written (in-jiciō), yet it still closes the
                # prefix's syllable -- so the prefix's last consonant counts double, as x does
                units[-1].count = 2
            if c == "u" and i > 0 and nxt and is_vowel(nxt) and units:
                if t[i - 1] == "g" and i > 1 and t[i - 2] == "n":       # sanguis: gu is one consonant
                    units[-1].end = ws + i + 1
                    i += 1
                    continue
                if t[i - 1] == "s" and CONSONANTAL_SU.match(t, i - 1):  # suāvis
                    units[-1].end = ws + i + 1
                    i += 1
                    continue
            if c == "i" and nxt and is_vowel(nxt):
                if i == 0:                                              # iam, iubeō, Iūnō
                    if pick(("initial i", wi), [("consonantal", 0, 1), ("vocalic", 2, 2)]) == "consonantal":
                        units.append(Unit("C", ws, ws + 1, wi))
                        i += 1
                        continue
                elif units and units[-1].kind == "V":                   # eius, Troia -- or Mīnōia
                    if pick(("i between vowels", wi, i),
                            [("consonantal", 0, 1), ("vocalic", 1, 1)]) == "consonantal":
                        units.append(Unit("C", ws + i, ws + i + 1, wi, count=2))
                        i += 1
                        continue
                elif PREFIX_BEFORE_I.match(t[:i]):                      # coniugis, iniūria, obiectus
                    if pick(("i after prefix", wi, i),
                            [("vocalic", 0, 1), ("consonantal", 1, 1)]) == "consonantal":
                        units.append(Unit("C", ws + i, ws + i + 1, wi))
                        i += 1
                        continue
            if c in PLAIN and nxt in PLAIN and nxt:
                pair = c + nxt
                joined = False
                if pair in ("ae", "au", "oe"):
                    joined = pick(("diphthong", wi, i), [("joined", 0, 1), ("split", 2, 2)]) == "joined"
                    if not joined:
                        units.append(Unit("V", ws + i, ws + i + 1, wi))   # the split's first vowel
                        units[-1].why = "split"
                        i += 1
                        continue
                elif pair == "eu":
                    joined = t in JOINED_EU or proper                     # eundō, deus, meus: two vowels
                elif pair == "ei":
                    joined = t in JOINED_EI
                elif pair == "ui":
                    joined = t in JOINED_UI
                if joined:
                    units.append(Unit("V", ws + i, ws + i + 2, wi, long=True, why="diphthong"))
                    i += 2
                    continue
            if units and units[-1].kind == "V" and not units[-1].long and units[-1].why != "split":
                # the first vowel becomes a consonant (te-ne-ant -> ten-yant), so it can close a syllable.
                # Rarer than a short vowel before f + liquid, so it loses a tie; u rarer still.
                cost = 5 if base(t[i - 1]) == "u" else 4
                if pick(("synizesis", wi, i), [("apart", 0, 1), ("merged", cost, 2)]) == "merged":
                    units[-1].gone = "merged"
            units.append(Unit("V", ws + i, ws + i + 1, wi, long=c in LONG,
                              why="long vowel" if c in LONG else ""))
            i += 1
            continue
        if c == "h":                        # not a consonant; ch/ph/th are taken with their stop
            i += 1
            continue
        if c == "q" and nxt == "u":
            units.append(Unit("C", ws + i, ws + i + 2, wi))
            i += 2
            continue
        if c in "cpt" and nxt == "h":
            units.append(Unit("C", ws + i, ws + i + 2, wi, stop=True))
            i += 2
            continue
        if c in "xz":
            units.append(Unit("C", ws + i, ws + i + 1, wi, count=2))
            i += 1
            continue
        units.append(Unit("C", ws + i, ws + i + 1, wi, stop=c in STOPS, liquid=c in LIQUIDS))
        i += 1
    return units


def build_line(s: str, low: str, words, pick, flags: set, meter: str = "hexameter"):
    units: list[Unit] = []
    for wi, (ws, t, proper) in enumerate(words):
        units.extend(parse_word(t, ws, wi, proper, pick))
    for u in units:
        if u.kind == "V" and u.gone == "merged":
            flags.add("synizesis")
        if u.kind == "V" and u.why == "split":
            flags.add("diphthong split")

    # word junctions: elision, or (advanced) hiatus / correption
    for wi in range(len(words) - 1):
        a = [u for u in units if u.word == wi]
        b = [u for u in units if u.word == wi + 1]
        if not a or not b or b[0].kind != "V":
            continue
        if words[wi][1] in ("hic", "hoc") and a[-1].kind == "C":        # hicc, hocc before a vowel
            if pick(("hic/hoc", wi), [("double", 0, 1), ("single", 1, 1)]) == "double":
                a[-1].count = 2
            continue
        last, m = a[-1], None
        if last.kind == "C" and low[last.start:last.end] == "m" and len(a) > 1 and a[-2].kind == "V":
            last, m = a[-2], a[-1]
        if last.kind != "V" or last.gone:
            continue
        options = [("elide", 0, 1), ("hiatus", 3, 2)]
        if last.long and m is None:
            options.append(("correption", 3, 2))
        choice = pick(("junction", wi), options)
        if choice == "elide":
            if words[wi + 1][1] in ("est", "es"):
                b[0].gone = "prodelided"
                flags.add("prodelision")
            else:
                last.gone = "elided"
                if m:
                    m.dropped = True
                flags.add("elision")
        elif choice == "hiatus":
            flags.add("hiatus")
        else:
            last.long, last.why = False, ""
            flags.add("correption")

    # hypermetry: a final vowel that elides into the next line (locōrumque)
    # (a hexameter's licence: a pentameter closes its couplet, with nothing after it to elide into)
    tail = [u for u in units if u.word == len(words) - 1]
    if meter == "hexameter" and tail and tail[-1].kind == "V" and not tail[-1].gone:
        if pick(("hypermetry",), [("no", 0, 1), ("elide", 3, 2)]) == "elide":
            tail[-1].gone = "elided"
            flags.add("hypermetry")

    active = [u for u in units if u.kind == "V" and not u.gone]
    marks = []
    for k, v in enumerate(active):
        if k == len(active) - 1:
            marks.append(("L", "final syllable", ""))
            continue
        nxt = active[k + 1]
        cons = [u for u in units if v.end <= u.start < nxt.start
                and ((u.kind == "C" and not u.dropped) or (u.kind == "V" and u.gone == "merged"))]
        letters = "".join(low[u.start:u.end] for u in cons)
        total = sum(u.count for u in cons)
        if v.long:
            marks.append(("L", v.why, ""))
        elif total >= 2:
            if (len(cons) == 2 and cons[0].stop and cons[1].liquid and cons[0].count == 1
                    and cons[0].word == cons[1].word):
                if cons[0].word == v.word:
                    w = pick(("muta cum liquida", v.start), [("S", 0, 1), ("L", 0, 1)])
                    marks.append((w, "muta cum liquida, short" if w == "S" else "muta cum liquida, long",
                                  letters))
                    if w == "S":
                        flags.add("muta cum liquida")
                else:
                    marks.append(("S", "muta cum liquida at word start", letters))
                    flags.add("muta cum liquida at word start")
            elif cons[0].word != v.word and any(u.word == cons[0].word and u.kind == "V" and u.gone == "prodelided"
                                                 for u in units):
                # vīsa 'st: the e of est has gone, so its s + t follow the vowel directly. Ordinary
                # position, not a word-initial cluster (every "cluster" the corpus had was this).
                marks.append(("L", "two consonants", letters))
            elif cons[0].word != v.word and all(u.word == cons[0].word for u in cons):
                if len(cons) == 2 and letters[0] == "f" and cons[1].liquid:
                    # in Ovid and Vergil a short final vowel stays short before fl-/fr- (curvāmine flectit)
                    marks.append(("S", "f + liquid at word start", letters))
                    flags.add("f + liquid at word start")
                else:
                    w = pick(("cluster", v.start), [("L", 0, 1), ("S", 3, 2)])
                    marks.append((w, "word-initial cluster makes position" if w == "L"
                                  else "word-initial cluster ignored", letters))
                    flags.add("word-initial cluster makes position" if w == "L" else "ignored cluster")
            else:
                marks.append(("L", "two consonants", letters))
        elif total == 1 and cons[0].word == v.word and nxt.word != v.word:
            # a word-final closed syllable before a vowel: lengthened at the beat (pectoribūs inhiāns)
            w = pick(("lengthening", v.start), [("S", 0, 1), ("L", 3, 2)])
            marks.append((w, "short vowel" if w == "S" else "lengthened syllable", letters))
            if w == "L":
                flags.add("lengthened syllable")
        else:
            marks.append(("S", "short vowel", letters))

    pattern = "".join(m[0] for m in marks)
    fit = METERS[meter].match(pattern)
    if not fit:
        return None
    if meter == "pentameter":
        # the diaeresis: a word must end with the long syllable at mid-line
        mid = len(fit.group(1))
        if active[mid].word == active[mid + 1].word:
            return None

    # qu, and h/x/z, kept apart (owner, 2026-09-17): qu is everywhere and the app half-handles it (its u
    # takes no mark), so it comes first. ANY qu flags a line -- students take its u for a vowel. h, x and
    # z flag it only where miscounting changes a mark: a short syllable with an h among its consonants
    # (h counted), a long syllable whose only consonant is x or z (x counted as one).
    if "qu" in low:
        flags.add("qu")
    for k, (v, (w, why, letters)) in enumerate(zip(active, marks)):
        if k == len(active) - 1:
            continue
        raw = "".join(c for c in low[v.end:active[k + 1].start] if c.isalpha() and not is_vowel(c))
        if (w == "S" and "h" in raw and len(raw) >= 2) or (w == "L" and why == "two consonants" and letters in ("x", "z")):
            flags.add("h, x, z")
            break
    return units, active, marks, pattern


def _hinted(hint_set, cit, b) -> bool:
    return bool(hint_set) and ((cit, b) in hint_set or b in hint_set)


def difficult_words(s: str, low: str, words, units, cit, hints) -> list[dict]:
    """Greekiness: see the module docstring."""
    names = (hints or {}).get("names")
    trouble = (hints or {}).get("trouble")
    out = []
    for wi, (ws, t, capital) in enumerate(words):
        b = bare(t)
        proper = capital or _hinted(names, cit, b)
        mine = [u for u in units if u.word == wi and u.kind == "V"]
        why = []
        if proper and _hinted(trouble, cit, b):                        # not mihī: a case question
            why.append("its macron was hard to settle")
        if "y" in b:
            why.append("y")
        # two nuclei with nothing (or only h) between them -- from the scan, so consonantal i and v and
        # the u of qu are not vowels
        touching = [(p, q) for p, q in zip(mine, mine[1:]) if low[p.end:q.start] in ("", "h")]
        pairs = [(base(low[p.end - 1]), base(low[q.start]), low[p.end:q.start]) for p, q in touching]
        if any(q is r for (_, q), (r, _) in zip(touching, touching[1:])):
            why.append("three vowels in a row")
        if any(x == y and x not in "iu" for x, y, _ in pairs):            # Boōtēn, not mediīs or suum
            why.append("the same vowel twice")
        diphthongs = ("ae", "au", "oe") + (("ei", "eu") if proper else ())  # not deus, meus, eundō
        looks = any(u.why == "split" for u in mine) or any(
            x + y in diphthongs for x, y, h in pairs if not h)
        if looks:
            why.append("looks like a diphthong, isn't")
        if proper and any(u.why == "diphthong" and low[u.start:u.end] == "eu" for u in mine):
            why.append("eu diphthong")
        unlatin = any(x not in "iu" for x, _, _ in pairs)                # -ia, -ua, -iī are ordinary Latin
        if proper and not looks and unlatin:
            why.append("vowels side by side in a name")
        vowel_letters = sum(u.end - u.start for u in mine)
        if len(mine) >= 3 and vowel_letters / len(b) >= 0.75 and unlatin:   # āera, not aliī or īlia
            why.append("many vowels")
        if why and why != ["y"]:                     # y alone is not enough
            out.append({"word": s[ws:ws + len(t)], "start": ws, "end": ws + len(t), "why": why})
    return out


def feet(pattern: str, meter: str = "hexameter") -> list[str]:
    if meter == "pentameter":                      # each half: two feet, then its lone long syllable
        half = len(PENTAMETER.match(pattern).group(1))
        return feet(pattern[:half]) + ["L"] + feet(pattern[half + 1:-1]) + ["L"]
    out, p = [], 0
    while p < len(pattern):
        step = 3 if pattern[p + 1:p + 2] == "S" else 2
        out.append(pattern[p:p + step])
        p += step
    return out


def scan(text: str, cit: str | None = None, hints: dict | None = None,
         meter: str = "hexameter") -> dict:
    """Scan one macronized hexameter, or with meter="pentameter" a pentameter. See the module
    docstring for the result."""
    if meter not in METERS:
        raise ValueError(f"meter must be one of {sorted(METERS)}, not {meter!r}")
    tag = {"meter": meter} if meter != "hexameter" else {}
    s = unicodedata.normalize("NFC", text)
    low = s.lower()
    words = [(m.start(), m.group(0), s[m.start()].isupper()) for m in WORD.finditer(low)]
    names = (hints or {}).get("names")
    words = [(ws, t, cap or _hinted(names, cit, bare(t))) for ws, t, cap in words]

    for stage in (1, 2):
        solutions = []
        stack = [dict()]
        while stack:
            asg = stack.pop()
            seen, penalty = [], [0]

            def pick(key, options, asg=asg, seen=seen, penalty=penalty):
                opts = [o for o in options if o[2] <= stage]
                idx = asg.get(key, 0)
                seen.append((key, len(opts)))
                penalty[0] += opts[idx][1]
                return opts[idx][0]

            flags: set = set()
            res = build_line(s, low, words, pick, flags, meter)
            if res:
                solutions.append((penalty[0], res, flags))
            fixed = dict(asg)
            for key, nopts in seen:
                if key in asg:
                    continue
                if sum(1 for v in asg.values() if v) < MAX_DEVIATIONS:
                    for alt in range(1, nopts):
                        stack.append({**fixed, key: alt})
                fixed[key] = 0
        if solutions:
            break

    if not solutions:
        written = sum(1 for c in low if is_vowel(c))
        return {"citation": cit, "text": s, "scans": False, "short_line": written < 12, **tag}

    best = min(p for p, _, _ in solutions)
    tops = [(res, fl) for p, res, fl in solutions if p == best]
    distinct = {tuple((u.start, u.gone) for u in r[0] if u.kind == "V") + (r[3],) for r, _ in tops}
    (units, active, marks, pattern), flags = tops[0]

    marks_by_start = {v.start: m for v, m in zip(active, marks)}
    nuclei = []
    for u in units:
        if u.kind != "V":
            continue
        entry = {"start": u.start, "end": u.end, "text": s[u.start:u.end]}
        if u.gone:
            entry.update(mark=u.gone)
        else:
            w, why, letters = marks_by_start[u.start]
            entry.update(mark=w, why=why)
            if letters:
                entry["followed_by"] = letters
        nuclei.append(entry)

    ft = feet(pattern, meter)
    if meter == "hexameter" and ft[4] == "LL":
        flags.add("spondaic fifth foot")
    hard = difficult_words(s, low, words, units, cit, hints)
    if hard:
        flags.add("greekiness")
    advanced = bool(flags & ADVANCED)
    return {"citation": cit, "text": s, "scans": True, "stage": stage, "penalty": best,
            "ambiguous": len(distinct) > 1, "level": level_of(flags, advanced), "advanced": advanced,
            "feet": ft, "flags": sorted(flags), "nuclei": nuclei, "difficult_words": hard, **tag}


def mark_line(result: dict) -> str:
    """The marks as a row of text to print under the line: ¯ long, ˘ short, × elided."""
    row = [" "] * len(result["text"])
    sym = {"L": "¯", "S": "˘", "elided": "×", "prodelided": "×", "merged": "×"}
    for nu in result["nuclei"]:
        row[nu["start"]] = sym[nu["mark"]]
    return "".join(row).rstrip()


def print_scans(results: list[dict], report: bool = False, level: int | None = None,
                greek: bool = False) -> dict:
    """Print scans for a human; return a tally. `report` keeps only the lines that need a human
    (will not scan, needed an advanced licence to scan, or scan two ways equally well)."""
    tally = {"lines": len(results), "no scan": 0, "stage 2": 0, "ambiguous": 0}
    words: dict = {}
    for r in results:
        if not r["scans"]:
            tally["no scan"] += 1
        else:
            tally["stage 2"] += r["stage"] == 2
            tally["ambiguous"] += r["ambiguous"]
        if greek:
            for w in r.get("difficult_words", []):
                g = words.setdefault(w["word"].lower(), set())
                g.update(w["why"])
            continue
        if report and r["scans"] and r["stage"] == 1 and not r["ambiguous"]:
            continue
        if level and r.get("level") != level:
            continue
        pad = " " * 13
        print(f"{str(r['citation'] or ''):<12} {r['text']}")
        if not r["scans"]:
            print(pad + ("SHORT LINE -- a half-line, nothing to scan" if r["short_line"]
                         else "DOES NOT SCAN -- check the macrons"))
            continue
        notes = [f"level {r['level']}"] + list(r["flags"])
        if r["stage"] == 2:
            notes.append(f"advanced, penalty {r['penalty']}")
        if r["ambiguous"]:
            notes.append("AMBIGUOUS: more than one best scan")
        print(pad + mark_line(r))
        print(pad + " | ".join(r["feet"]) + f"    [{'; '.join(notes)}]")
    if greek:
        by_reason: dict = {}
        for word, reasons in words.items():
            for reason in reasons:
                by_reason.setdefault(reason, []).append(word)
        for reason, ws in sorted(by_reason.items(), key=lambda kv: -len(kv[1])):
            print(f"{reason} ({len(ws)}): {', '.join(sorted(ws))}\n")
        tally["difficult words"] = len(words)
        tally["lines with one"] = sum(1 for r in results if r.get("difficult_words"))
    print("\n" + "  ".join(f"{k}: {v}" for k, v in tally.items()))
    return tally


def write_key(results: list[dict], path) -> None:
    """The answer key the app reads: every scan, as JSON."""
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(results, fh, ensure_ascii=False, indent=1)
