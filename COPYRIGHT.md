# Copyright and licensing

This repository combines three bodies of material under three sets of terms, plus one library
written by someone else (section 4).

## 1. The Latin texts — public domain

The words of Ovid's *Metamorphoses* and Vergil's *Aeneid* are in the public domain. The tutorial's
worked examples (`data/examples.tsv`), lines from outside the reader, take their text from the Perseus
Digital Library's editions of Hugo Magnus (Ovid, 1914) and J. B. Greenough (Vergil, 1900), both in the
public domain; the macrons are this project's.

## 2. Editorial content — CC BY-NC-SA 4.0

Licensed under Creative Commons Attribution-NonCommercial-ShareAlike 4.0 (see
[`LICENSE-CONTENT`](LICENSE-CONTENT)):

- The macron markings added to the texts.
- The answer keys: every line's scansion, the reason given for each syllable, and its level.
- The literary devices in `data/devices.json`: the definitions, the translations, and the choice
  of examples.
- The live game's question bank, `data/meter_questions.json`: the choice of syllables asked, their
  answers and the reasons given.
- HTML pages and the project's Markdown documentation (e.g. `README.md` and this file).

In plain terms: others may share and adapt this material, but must credit it, may not use it
commercially, and must release adaptations under the same terms. The Latin underneath remains public
domain in its own right.

Summary: https://creativecommons.org/licenses/by-nc-sa/4.0/

## 3. Code — AGPL-3.0

Licensed under the GNU Affero General Public License, version 3 (see [`LICENSE-CODE`](LICENSE-CODE)):

- `scansion/` — the scanner and its command-line tool.
- The app's JavaScript and CSS.
- The live class game: `live/` (except `live/vendor/`, below), its database rules
  (`database.rules.json`), and its tools and tests (`tools/`, `tests/`). The list of Latin codenames
  in `live/names.js` is part of the code.

In plain terms: anyone may use and modify the code, including to build scansion practice for other
texts, but must keep it open. The Affero clause covers the case this code invites: anyone who runs a
modified version as a website or other network service must offer its users the corresponding source.

## 4. The QR-code library — MIT

`live/vendor/qrcode.js` draws the square code on the projector that students scan to join a live
game. It is "QR Code Generator for JavaScript" by Kazuhiko Arase (Copyright © 2009), copied
unchanged and used under the MIT licence; its notice and the licence text are in
[`live/vendor/LICENSE-qrcode-generator.txt`](live/vendor/LICENSE-qrcode-generator.txt). The MIT
licence lets anyone use, copy and change it, provided that notice travels with it. "QR Code" is a
registered trademark of DENSO WAVE INCORPORATED.

## Why this split

It follows the reasoning of this project's sibling, the Pharr *Aeneid* grammar edition. Making the
code non-commercial as well would block legitimate educational reuse — teachers at tuition-charging
schools, nonprofits, open educational-resource libraries — while the AGPL already prevents what
matters: closed, proprietary versions of the code. The content stays non-commercial; the code stays
open.

## Combining the two licenses

CC BY-NC-SA 4.0 and AGPL-3.0 are not compatible within a single file, and in this project they never
share one: content lives in HTML, JSON, TSV and Markdown; code lives in Python, JavaScript and CSS. If you
extract material, keep that boundary — reuse the code under AGPL-3.0 and the content under
CC BY-NC-SA 4.0, and attribute the Latin texts as public domain.
