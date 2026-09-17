# Copyright and licensing

This repository combines three bodies of material under three sets of terms.

## 1. The Latin texts — public domain

The words of Ovid's *Metamorphoses* and Vergil's *Aeneid* are in the public domain.

## 2. Editorial content — CC BY-NC-SA 4.0

Licensed under Creative Commons Attribution-NonCommercial-ShareAlike 4.0 (see
[`LICENSE-CONTENT`](LICENSE-CONTENT)):

- The macron markings added to the texts.
- The answer keys: every line's scansion, the reason given for each syllable, and its level.
- HTML pages and the project's Markdown documentation (e.g. `README.md` and this file).

In plain terms: others may share and adapt this material, but must credit it, may not use it
commercially, and must release adaptations under the same terms. The Latin underneath remains public
domain in its own right.

Summary: https://creativecommons.org/licenses/by-nc-sa/4.0/

## 3. Code — AGPL-3.0

Licensed under the GNU Affero General Public License, version 3 (see [`LICENSE-CODE`](LICENSE-CODE)):

- `scansion/` — the scanner and its command-line tool.
- The app's JavaScript and CSS.

In plain terms: anyone may use and modify the code, including to build scansion practice for other
texts, but must keep it open. The Affero clause covers the case this code invites: anyone who runs a
modified version as a website or other network service must offer its users the corresponding source.

## Why this split

It follows the reasoning of this project's sibling, the Pharr *Aeneid* grammar edition. Making the
code non-commercial as well would block legitimate educational reuse — teachers at tuition-charging
schools, nonprofits, open educational-resource libraries — while the AGPL already prevents what
matters: closed, proprietary versions of the code. The content stays non-commercial; the code stays
open.

## Combining the two licenses

CC BY-NC-SA 4.0 and AGPL-3.0 are not compatible within a single file, and in this project they never
share one: content lives in HTML, JSON and Markdown; code lives in Python, JavaScript and CSS. If you
extract material, keep that boundary — reuse the code under AGPL-3.0 and the content under
CC BY-NC-SA 4.0, and attribute the Latin texts as public domain.
