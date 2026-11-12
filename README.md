# Latin Scansion

Practice scanning Latin hexameter — Ovid and Vergil — **from macronized texts**.

> **Use it:** https://samuelshotchkiss-jpg.github.io/latin-scansion/

## Why macronized texts

Most scansion practice starts from an unmacronized text, so the student has to guess which vowels
are long — usually from a list of endings that are "usually long" or "usually short". This project
starts from the other end: every long vowel is marked, so **every long or short syllable has a reason
the student can see**. Long by nature, long by position, a mute (stop) and liquid that stays short, a vowel
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

## Vowels

A page of drills on where vowels meet, **Vowels** (`vowels.html`), for the two things students most
often get wrong there (the teacher, 2026-11-12: half a class elided *Thisbē* before *iuvenum*):

* **i: vowel or consonant?** Every *i* before a vowel. A consonant at the start of a word (*iam*),
  between vowels, where it counts twice (*Troia* = *Troj-ja*), and after a prefix before *u*, *a* or
  *-ec-* (*coniūnx*); a vowel after a consonant, and above all in word-final *-ia*, *-io*, *-ie*
  (*omnia*), and in the exceptions: the *i* of *eō*, "go" (*abiit*, *coiēre*), and the names that open
  with a vowel *i* (*Iāsōn*, *Iūlus*). An *i* between consonants is plain, and left out.
* **Diphthong or not?** Every two vowels side by side inside a word that stay apart (*de-us*,
  *fu-it*, *om-ni-a*), against the diphthongs (*ae*, *au*, *oe*, and the few *ei*, *eu*, *ui*).

Each drill asks its two answers equally often, leaning on word-final *-ia*, the exceptions, and
look-alike pairs (*de-us*, *fu-it*, *ā-ēr*, *a-it*). After each answer: the reason, and the word in
syllables. The answers are the scanner's: [`data/vowels.json`](data/vowels.json) is built from
`data/lines.json` by `tools/make_vowel_drills.py` (**run it again whenever `lines.json` changes**),
and `tests/vowels.test.js` checks every answer against the key. Like the Devices page, it stores
nothing. The tutorial's "Two vowels side by side" lesson links to both drills.

The lines with a **tricky** example -- a consonantal *i*, the *i* of *eō* or a name, word-final
*-ia*, a look-alike pair, a rare diphthong -- are Practice's ninth kind, **Where vowels meet**
([`data/vowel_lines.json`](data/vowel_lines.json), from the same tool), and the lesson's *Practice
more* link. Not every example: *ae*, *au*, *oe* are in four lines of five. Unlike the other
kinds it is no level: it adds its lines, whatever their level, to what else is ticked.

## Hexameter jumbles

**Jumbles** (`jumbles.html`) shuffles a line's words until it no longer scans; the student drags them
back. Any order that makes a hexameter and reads as Latin, is **right** and
earns the points -- and when it is not the poet's own order, the poet's line is shown beside it.
About half the lines have more than one right order.

* **Two ways to start.** *Scanned*: every syllable is marked, and the marks follow the words -- a
  final syllable lengthens or shortens, an elision comes and goes. *Unscanned*: no marks, but a tap on
  a vowel marks it for reference; moving words sends the marks at the ends of words that changed
  neighbours flying. The true scansion arrives with the drums.
* **Lines**: no elision in the answer, at least one, or mixed; and by passage. Advanced lines
  (hiatus, synizesis, hypermetry...) are left out.
* **Sentences over two to four lines** (the fourth choice): one row per line. Where a clause runs
  over a line break, its words can move into the other line -- but only when the student moves them:
  a line may gain or lose words, and a line's share of a clause, emptied, leaves a dashed slot to drop
  words back into (the arrow keys step a word over the break too). Every line must scan; the grammar is judged
  over the whole sentence. 183 sentences; longer ones (up to fourteen lines) are left out.
* **A jumble stays readable** (strict rules): no word crosses punctuation; a conjunction, relative or
  *-que* word comes FIRST in its clause -- even where the poet put some of the clause's own words in
  front of it (*vīdistis sī quam…*, Aen. 1.322: the jumble never does that); a preposition keeps its
  object after it; *nōn* and *ō* stay before their word. It leans toward a plainer order (an
  adjective beside its noun, a verb last).
* **An answer is held to looser rules** -- the poets' own licences, but never against a plainer
  order (the teacher's ruling, 2026-11-12): up to two words may stand in front of a subordinating
  word, or as many as the poet put there, and they may equally go after it; a joining word (*et*,
  *aut*, *-que*) is never later than the poet put it; where *et* joins phrases rather than clauses, a
  verb or an adverb may cross it, and the rest keeps its order; a preposition's noun may come after
  an agreeing word or a genitive (*in Caesaris castra*); *nōn* may go before the verb; *enim*
  second or third, or right after its conjunction. Which words the poets set in front of their own
  clause's opener was decided place by place, in the toolkit's `export_jumbles.py` (`POSTPONED`,
  `SEPARATE`); the exporter prints any new place that needs a decision.
* Points, a first-try streak and twenty badges are kept in the browser under their own key
  (`latinScansion.jumbles.v1`), apart from the Scan page's progress.

The tiles, [`data/jumbles.json`](data/jumbles.json), are written by the Latin Vocab Toolkit's
`engine/export_jumbles.py` from `data/lines.json` and the reader's grammatical tags (**run it again
whenever `lines.json` changes**). [`jumble-core.js`](jumble-core.js) rescans any order exactly as the
scanner joins words; `tests/jumbles.test.js` checks every line against the key.

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

## Practice quiz

A third page, **Practice quiz** (`quiz.html`), makes a whole practice version of the Meter &
Literary Devices Quiz, laid out like the printed one. **Part I** is the triple match: ten Latin
examples (the number can be changed), their definitions shuffled beside them, and a word bank of
every device the class has learned; the student picks each example's definition letter, then each
definition's name. **Check Part I** marks every answer right, wrong or blank. **Part II** is a short
passage to scan: tap each vowel to mark it (long, short, elided), or open the line in the scanner
(`index.html?line=…`, the same as *Go to*). **Score my quiz** grades both parts as the teacher's
scorer grades the paper quiz (`quiz-score.js`, a port of the toolkit's `meter_grade.py`, checked by
`tests/quiz_score.test.js`): Part I's percentage, Part II's meter score with what was missed, and the
two averaged, out of 5. **Show the answer key** gives the letters, the names, the English of each
example, and the feet and elisions of the passage. **Print** gives the paper version: Part I on one
page, Part II on the next, and the key on its own page if it is showing.

A practice quiz is dealt by the real quiz's rules (`quiz-build.js` ports them): no two examples
share a line of Latin, no example appears beside a device it also illustrates, and the passage is
whole sentences of three to five lines, four when there is a four-line one. The passages come from
the same `data/devices.json`, which lists every passage the quiz could set from the lines the
class has read so far. Each practice quiz has a five-digit number, kept in the page's address, so
a reload or a bookmark brings it back; the teacher's versions have four digits and cannot be
rebuilt here. Like the Devices page, it stores nothing in the browser.

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
- *Muta cum liquida* is a mute (stop: p b t d c g) followed by l or r; inside a word the meter decides.
- Consonants at the start of a word are their own kind: a mute (stop) + liquid there leaves a short final
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
- **The live game's music** in `live/audio/` — two tracks by Kevin MacLeod (incompetech.com), **CC BY 4.0** (see `COPYRIGHT.md` §5).
