#!/usr/bin/env python3
"""scan.py -- scan a macronized hexameter (or elegiac) text from the command line.

    python scansion/scan.py lines.tsv                      # print every scan
    python scansion/scan.py lines.tsv --report             # only the lines that need a human
    python scansion/scan.py lines.tsv --level 1            # only the lines at one level
    python scansion/scan.py lines.tsv --greek              # the words flagged as Greek-looking
    python scansion/scan.py lines.tsv --json key.json      # write the answer key the app reads
    python scansion/scan.py lines.tsv --names names.txt --trouble trouble.txt
    python scansion/scan.py couplets.tsv --elegiac        # hexameter, pentameter, hexameter...

INPUT. One line of verse per line of the file, UTF-8, with a macron on every long vowel. A line may
start with a citation and a TAB (`Met. 8.183<TAB>Daedalus intereā ...`); otherwise its line number is
its citation. Blank lines and lines starting with # are skipped.

HINT FILES (optional). One form per line, or a citation, a TAB and a form. `--names` lists proper
nouns your text does not capitalize; `--trouble` lists names whose vowel lengths were hard to settle.
See scansion.py for what they change.

ELEGIAC (`--elegiac`). The verse lines alternate hexameter, pentameter, by their order in the file:
the first is a hexameter. Position, not trial, because some pentameters also scan as hexameters.
An excerpt must therefore start on the first line of a couplet.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scansion  # noqa: E402


def read_lines(path: str) -> list[tuple[str, str]]:
    rows = []
    for n, raw in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        cit, _, text = raw.partition("\t") if "\t" in raw else (str(n), "", raw)
        rows.append((cit.strip(), text))
    return rows


def read_hint(path: str | None) -> set:
    if not path:
        return set()
    out = set()
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if "\t" in raw:
            cit, _, form = raw.partition("\t")
            out.add((cit.strip(), scansion.bare(form.strip())))
        else:
            out.add(scansion.bare(raw.strip()))
    return out


def main() -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass
    ap = argparse.ArgumentParser(description="Scan macronized Latin hexameters (or elegiac couplets).",
                                 formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__)
    ap.add_argument("text", help="the macronized text")
    ap.add_argument("--report", action="store_true", help="print only lines a human should look at")
    ap.add_argument("--level", type=int, choices=range(1, 6), help="print only the lines at this level")
    ap.add_argument("--greek", action="store_true", help="list the words flagged for Greekiness")
    ap.add_argument("--json", help="write the answer key here")
    ap.add_argument("--names", help="proper nouns the text does not capitalize")
    ap.add_argument("--trouble", help="names whose vowel lengths were hard to settle")
    ap.add_argument("--elegiac", action="store_true",
                    help="elegiac couplets: odd lines hexameter, even lines pentameter")
    a = ap.parse_args()

    hints = {"names": read_hint(a.names), "trouble": read_hint(a.trouble)}
    results = [scansion.scan(text, cit, hints, "pentameter" if a.elegiac and n % 2 else "hexameter")
               for n, (cit, text) in enumerate(read_lines(a.text))]
    scansion.print_scans(results, report=a.report, level=a.level, greek=a.greek)
    if a.json:
        scansion.write_key(results, a.json)
        print(f"wrote {a.json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
