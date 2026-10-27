# The live game: how to try it, how to run it

For the teacher. Plain English first; where a word is technical it is explained once, right after it.

**What it is.** A Quizlet-Live-style game for class. You open a page on the projector; students open
a link on their phones; each student gets a Latin codename (*Vulpēs Callida*, a clever fox) instead of
typing a name; you press Start and run the rounds. Nothing about a student is kept: no names, no
emails, no scores after the game.

There are two parts. **Part 1** lets you try everything on your own computer with no accounts and no
risk. **Part 2** is the one-time setup of the real thing (about 20 minutes). **Part 3** is a class.

---

## Part 1 — Try it on your own computer (no accounts, nothing real)

You need Node.js (the program that runs the test tools) and Java (the test database needs it), and
the Firebase command-line tool. If `node --version`, `java -version` and `firebase --version` each
print a number, you have them. Open a terminal in the `latin-scansion` folder.

**1. Install the test tools, once.** (This downloads them into a folder called `node_modules`, which
is never uploaded.)

```bash
npm install
```

**2. Start the pretend database.** This is Firebase's *emulator*: a copy of the real thing that runs
on your computer only and forgets everything when you stop it. Its project name begins `demo-`, which
Firebase itself will not let connect to anything real. Leave this window open.

```bash
npm run emulate
```

**3. In a second terminal window, give the pretend database a pretend teacher.** (Once per time you
start step 2.)

```bash
node tools/seed-emulator.js
```

**4. In a third window, serve the site.**

```bash
python -m http.server 8770
```

**5. Open the teacher page:** <http://localhost:8770/host.html?debug> (type **localhost**, not
127.0.0.1: the pages refuse 127.0.0.1 on purpose). The yellow bar says TEST MODE. Press **Sign in as
the test teacher**, pick **Poll (plumbing test)** (it only shows up with `?debug`), press **Create
game**. A big four-letter code and a square QR code appear.

**6. Be a student.** In another browser window (a narrow one looks like a phone) open
`http://localhost:8770/live.html` and type the code, or use the link on the projector page. You get a
codename. **Different name** gives you another.

**7. Add pretend students** (your class is not here, so these are bots):

```bash
node tools/bots.js CODE --n 12 --speed fast
```

(Replace `CODE` with your four letters. `--n` is how many, `--speed` is `fast`, `normal` or `slow`.)
They join, and answer every question after a realistic pause. When you end the game, they stop.

**8. Play.** On the teacher page press **Make teams** (if you ticked teams) and **Start**. Each
question has a clock; it ends when the time is up, or everyone has answered, or you press **Lock now**;
then **Next** (or the space bar) shows the next one. **End game** deletes everything.

**Checking it is safe.** `npm test` runs about 130 checks, including 80 that try to break the database
rules (see `live/RULES.md`). Run it any time; it starts and stops its own pretend database.

---

## Part 2 — The real thing: one-time setup (about 20 minutes)

You do this once. The live game gets its **own new Firebase project**, so a mistake can never touch
the survey app, and the free plan's ceiling means it can never bill you.

1. <https://console.firebase.google.com> → **Add project**, name it `latin-live-game`. **Turn
   Google Analytics off.** Stay on the free **Spark** plan; never press an Upgrade button.
2. **Build → Realtime Database → Create database.** Location: United States. **Locked mode.**
3. **Build → Authentication → Get started → Sign-in method:** enable **Anonymous** and **Google**.
4. **Authentication → Settings → Authorized domains:** add `samuelshotchkiss-jpg.github.io`.
5. **Project settings → Your apps → Web (`</>`)**: register an app (skip hosting) and copy the
   `firebaseConfig` block into `live/firebase-config.js`, replacing the `PASTE-…` values in `web:`.
   (This looks like a password but is not one: it only says *which* project. The rules are the lock.)
6. **Read `database.rules.json` and `live/RULES.md`**, then deploy the rules only:

   ```bash
   firebase use --add
   ```

   (pick the new project and call it `default`), then

   ```bash
   firebase deploy --only database
   ```

7. Open `host.html` on the real site and sign in with Google. The page says *Signed in, but not as the
   teacher yet* and shows a long ID. In the console go to **Realtime Database → Data**, add a child
   `config`, inside it a child `teacherUid`, and paste that ID as its value. Reload. (This is how the
   game knows you are the teacher without your email ever being written in a public place.)
8. Try one student phone on the school Wi-Fi before the first class.

---

## Part 3 — Running a class

- Open `host.html` on the projector computer and sign in. Choose the game, press **Create game**.
  The code and a QR code fill the screen; students scan it or type the address and code.
- Students appear as codenames. Remove anyone with the ✕. Press **Start**.
- **Don't close or reload the teacher page during a game.** It holds the answers in its memory (that
  is what keeps them off the phones), so a reload ends that game. Press **End game** to finish.
- **A phone locks or loses signal?** Nothing is lost: when the student wakes it, it reconnects. If
  they reload the page, they come back as the same player in the same game (same tab only; a new tab
  is a new player). If the **teacher** page goes quiet, phones say "Waiting for the teacher…".
- A game you forget is deleted by the next time you open the teacher page after 12 hours.

## What is stored, and for how long

- **In the game's online database:** the game's settings; each player as a *number* that picks their
  codename, plus the time they joined; their taps as numbers; the questions on screen; the scores.
  **No name, no email, no text a student wrote** (the database rules refuse anything but numbers).
  All of it is deleted when you press **End game**, and any game older than 12 hours when you next open
  the teacher page.
- **On a student's phone:** in that tab only, a random sign-in number (so a reload rejoins), gone when
  the tab closes; and two small Firebase files that hold nothing about the student (a once-a-day
  date-and-version note, and an empty database). No cookies; nothing in long-term browser storage.
  Each live page says this at its foot, and `npm test` checks the notice against the list the code
  checks the browser against.
- **What Google still sees:** like any website, Firebase receives the IP address of each connection. No
  name, email or school account.
- **Your own sign-in:** Google is used only to show you are the teacher. Your email is not written into
  the game or into this repository.
