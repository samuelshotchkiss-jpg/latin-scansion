"""Export an idioms handout to data/idioms.json, for the live game's idioms modes. AGPL-3.0.

The owner makes an "Idioms to watch out for" handout for each reading (Via Latina IX-XII first; later
Fabulae Faciles and more Roman history). Its JSON lives in the Latin Vocab Toolkit, outside this public
repo, because the reading is an in-copyright book. This script copies ONLY the short cards -- the Latin
phrase (at most a few words), the owner's own word-for-word and natural English renderings, the group
heading and the chapter-and-line reference -- and never the handout's notes or anything longer.

    python tools/export_idioms.py SOURCE.json --id vl0912 --corpus latin-iii --title "Via Latina IX–XII"

A set with the same id is replaced; other sets are kept, in file order (the newest set of a class is the
LAST one of that class: the host's "Newest Latin III" picks it).

NEAR PAIRS. A card from another idiom is a wrong card (a decoy) only if it cannot also be read as right.
Two idioms whose meanings sit close ("make an attack" / "start fighting"; "make a withdrawal" /
"retreat") must never be dealt against each other. List such pairs below, by their Latin, per set id;
the exporter writes them into each idiom's `near` list (both ways) and the game skips them as decoys.
The script fails if a pair names a Latin phrase that is not in the handout.
"""
import argparse
import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "idioms.json"
MAX_LATIN_WORDS = 5          # a card is a phrase, never a passage (the book is in copyright)

NEAR = {
    "vl0912": [
        # fighting: "make an attack", "commit a battle", "carry war", "they had been fighting", "attacking Saguntum"
        ("impetum facere", "proelium committere"),
        ("impetum facere", "bellum gerere"),
        ("proelium committere", "bellum gerere"),
        ("impetum facere", "propter oppugnātiōnem Saguntī"),
        ("proelium committere", "multōs iam annōs … pugnābant"),
        ("bellum gerere", "multōs iam annōs … pugnābant"),
        # going away: "make a withdrawal" / "walk out", "carry back the foot" / "retreat", "turn aside", "from the back"
        ("sēcessiōnem facere", "pedem referre"),
        ("sēcessiōnem facere", "iter flectere"),
        ("pedem referre", "iter flectere"),
        ("pedem referre", "ā tergō"),
        # feelings that seize you
        ("metus nōbilēs invādit", "Gāium … furor … capit"),
        # "think little of" / "resent"; "least" / "not at all" / "no longer"
        ("parvī facere", "aegrē ferre"),
        ("minimē", "iam nōn"),
        ("minimē", "parvī facere"),
        # "while Cornelia was still alive" / "drive a life" = "live"
        ("Corneliā adhūc vīvā", "vītam agere"),
    ],
}


def slug(latin):
    s = unicodedata.normalize("NFKD", latin)
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z]+", "-", s).strip("-")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("source")
    ap.add_argument("--id", required=True, help="letters and digits, 16 at most (the host stores it)")
    ap.add_argument("--corpus", required=True, help="the class, e.g. latin-iii")
    ap.add_argument("--title", required=True)
    a = ap.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9]{1,16}", a.id):
        sys.exit("--id must be 1-16 letters or digits")

    src = json.loads(Path(a.source).read_text(encoding="utf-8"))
    idioms, seen = [], {}
    for sec in src["sections"]:
        for grp in sec["groups"]:
            for row in grp["rows"]:
                latin, where, literal, english = (str(x).strip() for x in row)
                words = [w for w in latin.split() if w != "…"]
                if len(words) > MAX_LATIN_WORDS:
                    sys.exit(f"{latin!r} is {len(words)} words: a card is a short phrase (copyright)")
                key = slug(latin)
                if key in seen:
                    sys.exit(f"two idioms make the key {key!r}")
                seen[key] = latin
                idioms.append({"key": key, "latin": latin, "literal": literal, "english": english,
                               "group": grp["name"], "where": where})

    by_latin = {i["latin"]: i for i in idioms}
    for x, y in NEAR.get(a.id, []):
        for t in (x, y):
            if t not in by_latin:
                sys.exit(f"NEAR names {t!r}, which is not in the handout")
        by_latin[x].setdefault("near", []).append(by_latin[y]["key"])
        by_latin[y].setdefault("near", []).append(by_latin[x]["key"])
    for col in ("latin", "literal", "english"):
        texts = [i[col] for i in idioms]
        dup = {t for t in texts if texts.count(t) > 1}
        if dup:
            sys.exit(f"the same {col} card twice: {sorted(dup)}")

    data = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    sets = [s for s in data.get("sets", []) if s["id"] != a.id]
    sets.append({"id": a.id, "corpus": a.corpus, "title": a.title, "idioms": idioms})
    out = {
        "_about": "Idiom cards for the live game (live/modes/idioms.js). GENERATED by tools/export_idioms.py "
                  "from the owner's handouts; do not edit by hand. Latin phrases are short quotations; the "
                  "English is the owner's own. CC BY-NC-SA 4.0 (see COPYRIGHT.md).",
        "sets": sets,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{a.id}: {len(idioms)} idioms -> {OUT.relative_to(ROOT)} ({len(sets)} set(s))")


if __name__ == "__main__":
    main()
