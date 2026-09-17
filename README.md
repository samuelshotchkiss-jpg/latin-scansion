# Latin Scansion

Practice scanning Latin hexameter — Ovid and Vergil — **from macronized texts**.

> **Status: in development.** The scanner below works; the student app is being built. It will be
> served on GitHub Pages.

## Why macronized texts

Most scansion practice starts from an unmacronized text, so the student has to guess which vowels
are long — usually from a list of endings that are "usually long" or "usually short". This project
starts from the other end: every long vowel is marked, so **every long or short syllable has a reason
the student can see**. Long by nature, long by position, a mute and liquid that stays short, a vowel
removed by elision — nothing is a guess, and the rules stop looking arbitrary.

## How a student scans

The line is shown whole, with no syllable divisions. The student drags long and short marks over it,
and each mark **snaps to a syllable nucleus** — the vowel or diphthong at the heart of a syllable.
Marking an elision takes that nucleus out of play. Dividing the syllables is part of the skill, so
the app never does it for them.

## Levels

Each line is placed at the lowest level that allows everything in it:

| Level | Adds |
|---|---|
| 1 | Long and short syllables only |
| 2 | Elision (including *est* / *es*: *imposita (e)st*) |
| 3 | Muta cum liquida — inside a word, and at the start of one (*unda gravet*, *curvāmine flectit*) |
| 4 | Greek-looking words: *āera*, *Aenēās*, *Boōtēn*, *Teucrī* |
| 5 | Anything advanced: hiatus, synizesis, hypermetry, lengthening at the beat… |

## The scanner

`scansion/` is a small Python library (standard library only, Python 3.10+) that scans a macronized
hexameter and says why every syllable is long or short. It produces the app's answer key, and it
works on any macronized text — use it for your own corpus.

```bash
python scansion/scan.py my_lines.tsv --report          # lines that need a human look
python scansion/scan.py my_lines.tsv --level 1         # the easiest lines
python scansion/scan.py my_lines.tsv --json key.json   # the answer key
```

```python
import scansion
r = scansion.scan("atque ita compositās parvō curvāmine flectit,")
r["feet"]    # ['LSS', 'LSS', 'LL', 'LL', 'LSS', 'LL']
r["level"]   # 3
```

**Input.** UTF-8, one verse per line, with a macron on every long vowel. A line may begin with a
citation and a tab (`Met. 8.183⇥Daedalus intereā …`).

**A line that will not scan usually has a wrong macron.** `--report` lists those lines, so running the
scanner over a text is also a way to proofread its macrons.

### Conventions

These are the choices built into the scanner. They are stated at the top of `scansion/scansion.py`,
and they are the place to start if you teach differently.

- The final syllable of a line counts as long.
- *Muta cum liquida* is a stop (p b t d c g) followed by l or r. Inside a word the meter decides; at
  the start of a word it leaves a short final vowel short. A word-initial *fl-* or *fr-* does the same
  in Ovid and Vergil, and is grouped with it.
- Advanced licences are tried only when a line will not scan without them.

### The answer key

`--json` writes one object per line:

```json
{
  "citation": "Met. 8.194",
  "text": "atque ita compositās parvō curvāmine flectit,",
  "scans": true,
  "level": 3,
  "advanced": false,
  "feet": ["LSS", "LSS", "LL", "LL", "LSS", "LL"],
  "flags": ["elision", "f + liquid at word start"],
  "nuclei": [
    {"start": 0, "end": 1, "text": "a", "mark": "L", "why": "two consonants", "followed_by": "tqu"},
    {"start": 4, "end": 5, "text": "e", "mark": "elided"}
  ],
  "difficult_words": []
}
```

`start` and `end` are character offsets into `text` (Unicode NFC). `mark` is `L`, `S`, `elided`,
`prodelided`, or `merged` (synizesis).

## Licence

Three sets of terms — see [`COPYRIGHT.md`](COPYRIGHT.md) for which files fall under each:

- **The Latin texts** of Ovid and Vergil — public domain.
- **Editorial content** (the macron markings, the answer keys, the documentation) — **CC BY-NC-SA 4.0**
  ([`LICENSE-CONTENT`](LICENSE-CONTENT)).
- **Code** (the scanner, the app's JavaScript and CSS) — **AGPL-3.0** ([`LICENSE-CODE`](LICENSE-CODE)).
  Use it for your own texts; if you run a modified version as a website, share your changes.
