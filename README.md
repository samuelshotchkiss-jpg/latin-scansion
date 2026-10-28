# Latin Scansion

Practice scanning Latin hexameter — Ovid and Vergil — **from macronized texts**.

> **Use it:** https://samuelshotchkiss-jpg.github.io/latin-scansion/

## Why macronized texts

Most scansion practice starts from an unmacronized text, so the student has to guess which vowels
are long — usually from a list of endings that are "usually long" or "usually short". This project
starts from the other end: every long vowel is marked, so **every long or short syllable has a reason
the student can see**. Long by nature, long by position, a mute and liquid that stays short, a vowel
removed by elision — nothing is a guess, and the rules stop looking arbitrary.

## How a student scans

The line is shown whole, with no syllable divisions. The student drags long (¯) and short (˘) marks
over it, and each mark **snaps to a syllable nucleus** — the vowel or diphthong at the heart of a
syllable. Dividing the syllables is part of the skill, so the app never does it for them while they
scan.

**Elision** is marked the traditional way: a swoosh under the gap between two syllables (*atque ‿ ita*).
It can go in *any* gap — the app does not hint where elision is possible. It removes the first of the
two vowels, or the *e* of *est* in prodelision (*imposita ‿ est*). A vowel stays open to long and short marks until the student elides
it, so the app never gives an elision away; once elided, any mark on it goes back to the tray.

**Check** turns each mark green or red, and draws foot dividers above the line — grouped from the
student's *own* marks, so a scansion that does not fall into six feet shows exactly where it breaks.

**Tapping a syllable** after Check (or Show answer) opens a **zoom-in**: that syllable and its
neighbours, enlarged, divided before the student's eyes. The words close up into one big word; the
consonants between this vowel and the next lift out and drop into the syllable they belong to — a
mūta cum liquida tied by a swoosh and pushed together into the next one, an *x* splitting into *c* +
*s*, an *i* that is a consonant (*iam*, *coniugis*, *Troia*) growing its tail into a *j*; then what decides the mark lights up — the long vowel, the consonant that ends the syllable, the
end of the line, the vowel an elision runs into — and a sentence says why. ↻ plays it again. Under
the sentence, a link opens the tutorial at the lesson that teaches the reason, scrolled to the part
that does (*qu*, hiatus, diphthongs…), with a way back to the line.

**A line left unfinished waits.** The marks on the line a student is working on — and after Check,
its greens and reds — are kept for each place: Practice, and each stage of the tutorial. A look at a
lesson and back finds the line as it was left, even after a reload; stepping to another line in the
same place lets it go, as Next always has.

## Tutorial, practice, and progress

- **Tutorial** walks through meter one idea at a time — syllables, long and short; the pattern;
  *qu, h, x, z*; two vowels side by side (a diphthong, two syllables, or an *i* or *u* that turns
  consonant); elision; mūta cum liquida; consonants at the start of a word; Greek words; the
  poets' licences — each with a short lesson and lines to practice it on. The lessons and their
  lines live in [`data/tutorial.json`](data/tutorial.json): edit the text, reorder the stages, or
  swap in lines from your own texts by citation. A lesson can also carry **worked examples** —
  lines from *outside* the reader, so they are new to the student (*et prīmō similis volucrī, mox
  vēra volucris* for mūta cum liquida) — shown scanned, with the syllables that teach the lesson
  divided by the same animation as the zoom-in. They live in
  [`data/examples.tsv`](data/examples.tsv), hand-macronized; rebuild their key with
  `python scansion/scan.py data/examples.tsv --json data/examples.json`.
- **Practice** chooses lines by passage and by the kinds of line ticked — only lines with elision,
  say, or only the advanced ones. Every tutorial stage after the first links to a practice set of
  lines like its own (`?practice=<stage id>`), ticking the matching kinds — except two vowels side
  by side, which no kind of line singles out.
- **My progress** shows lines figured out (and what share of the whole), points, streaks, days
  practiced, badges, and what has been practiced. A line solved after **Show answer** earns nothing
  until it is solved again on another visit.
- **Download report** saves a one-page progress report (a web page) that a student can send to a
  teacher.

All of this is kept in the browser's local storage and never sent anywhere; a notice says so on the
first visit.

## Literary devices

A second page, **Devices** (`devices.html`), drills the literary devices of the course's
Meter & Literary Devices Quiz by matching cards into rows: each row is one device, with its
**name**, its **definition**, and a Latin **example** from the reading. Tap a card, then the
space where it belongs; **Check** marks each card right or wrong. Tick *Names are cards too*
for a harder round. The quiz shows the Latin alone, so the English starts hidden;
tick *Show the English* to see the translations.

It is a page of its own: it shares nothing with the scansion practice, and it stores nothing
in the browser. Its data, [`data/devices.json`](data/devices.json), is generated from the same
pool the quiz is drawn from, so the practice and the quiz cannot disagree.

## Live class game

Two more pages run a live game for a class: the teacher opens `host.html` on the projector, and
students join on their own devices at `live.html` with a four-letter code. There are two games, a
team race that matches the literary devices' names, definitions and examples, and **Longa an
brevis?**, where everyone judges the same syllable of a real line. Unlike the rest of the site,
these two pages do talk to a server (a free Firebase project). Students do not sign in: each gets
an anonymous sign-in and an assigned Latin codename, stored as a number. Nothing a student types is
stored, and a game is deleted when it ends. The details, including how to try it on your own
computer, are in [`live/HOWTO.md`](live/HOWTO.md) and [`live/SPEC.md`](live/SPEC.md).

## Running it locally

The app is plain HTML, CSS and JavaScript with no build step, but it loads its lines with `fetch`, so
serve the folder rather than opening the file:

```bash
python -m http.server 8770
```

then open `http://localhost:8770`. Progress is kept in the browser's local storage; nothing is sent
anywhere. (The live game is the exception; `live/HOWTO.md` explains how to run it against a local
test copy of its database.)

## Levels

Each line is placed at the lowest level that allows everything in it:

| Level | Adds |
|---|---|
| 1 | Long and short syllables only |
| 2 | *qu* — its *u* is not a vowel |
| 3 | *h*, *x*, *z* — where miscounting one would change a syllable's length (*captat harundine*, *dīxit*) |
| 4 | Elision (including *est* / *es*: *imposita (e)st*) |
| 5 | Muta cum liquida inside a word (*patris*, *utrumque*) |
| 6 | Consonants at the start of a word, which leave a short vowel short (*unda gravet*, *curvāmine flectit*) |
| 7 | Greek-looking words: *āera*, *Aenēās*, *Boōtēn*, *Teucrī* |
| 8 | Anything advanced: hiatus, synizesis, hypermetry, lengthening at the beat… |

## The scanner

`scansion/` is a small Python library (standard library only, Python 3.10+) that scans a macronized
hexameter (or, with `meter="pentameter"`, a pentameter) and says why every syllable is long or short.
The app itself practises hexameters only. It produces the app's answer key, and it
works on any macronized text — use it for your own corpus.

```bash
python scansion/scan.py my_lines.tsv --report          # lines that need a human look
python scansion/scan.py my_lines.tsv --level 1         # the easiest lines
python scansion/scan.py my_lines.tsv --syllables       # each line divided: fis-tu-la-dis-pa-ri-bus…
python scansion/scan.py my_lines.tsv --json key.json   # the answer key
python scansion/scan.py couplets.tsv --elegiac         # elegiac couplets: odd lines hexameter, even pentameter
```

```python
import scansion
r = scansion.scan("atque ita compositās parvō curvāmine flectit,")
r["feet"]    # ['LSS', 'LSS', 'LL', 'LL', 'LSS', 'LL']
r["level"]   # 6
```

**Input.** UTF-8, one verse per line, with a macron on every long vowel. A line may begin with a
citation and a tab (`Met. 8.183⇥Daedalus intereā …`).

**A line that will not scan usually has a wrong macron.** `--report` lists those lines, so running the
scanner over a text is also a way to proofread its macrons.

### Conventions

These are the choices built into the scanner. They are stated at the top of `scansion/scansion.py`,
and they are the place to start if you teach differently.

- The final syllable of a line counts as long.
- *Muta cum liquida* is a stop (p b t d c g) followed by l or r; inside a word the meter decides.
- Consonants at the start of a word are their own kind: a mute + liquid there leaves a short final
  vowel short, and in Ovid and Vergil so does *fl-* or *fr-* — which is not muta cum liquida.
- Advanced licences are tried only when a line will not scan without them.

### The answer key

`--json` writes one object per line:

```json
{
  "citation": "Met. 8.194",
  "text": "atque ita compositās parvō curvāmine flectit,",
  "scans": true,
  "level": 6,
  "advanced": false,
  "feet": ["LSS", "LSS", "LL", "LL", "LSS", "LL"],
  "flags": ["elision", "f + liquid at word start", "qu"],
  "nuclei": [
    {"start": 0, "end": 1, "text": "a", "mark": "L", "why": "two consonants", "followed_by": "tqu",
     "syllable": [0, 2]},
    {"start": 4, "end": 5, "text": "e", "mark": "elided"}
  ],
  "difficult_words": []
}
```

`start` and `end` are character offsets into `text` (Unicode NFC). `mark` is `L`, `S`, `elided`,
`prodelided`, or `merged` (synizesis).

`syllable` is where that nucleus's syllable begins and ends, for *explaining* a mark (the app shows it
only after Check). The line is treated as one big word, as in *fis-tu-la-dis-pa-ri-bus-pau-lā-tim-sur-gi-ta-vē-nīs*,
and the rules are stated at the top of `scansion/scansion.py` (SYLLABLES). Neighbouring syllables meet;
they overlap only on a letter that counts twice, which `doubled` lists with the two sounds it stands
for (`{"at": 3, "as": ["c", "s"]}`: *dīxit* = *dīc-sit*). `silent` lists the letters that count for
nothing (an *h*), and a vowel left unelided before a vowel carries `"hiatus": true`.

## Licence

Three sets of terms — see [`COPYRIGHT.md`](COPYRIGHT.md) for which files fall under each:

- **The Latin texts** of Ovid and Vergil — public domain.
- **Editorial content** (the macron markings, the answer keys, the documentation) — **CC BY-NC-SA 4.0**
  ([`LICENSE-CONTENT`](LICENSE-CONTENT)).
- **Code** (the scanner, the app's JavaScript and CSS) — **AGPL-3.0** ([`LICENSE-CODE`](LICENSE-CODE)).
  Use it for your own texts; if you run a modified version as a website, share your changes.
- **The QR-code library** in `live/vendor/` — **MIT**, by Kazuhiko Arase (see `COPYRIGHT.md` §4).
