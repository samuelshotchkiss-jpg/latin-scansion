// common.js -- what the teacher's page, the student's page and every mode share. AGPL-3.0.
//
// This file holds NO Firebase code and touches no storage (net.js is the only file that talks to
// Firebase). It gives the two pages:
//   * the mode registry   -- a mode file calls Live.registerMode({...}); see live/MODES.md
//   * pure helpers        -- team making, game codes, settings <-> numbers, a seeded random generator
//   * small DOM helpers   -- h() to build elements, a countdown, a scoreboard
//   * the privacy notice  -- built from the one list of what the pages store (Live.STORED)
//
// The pure helpers also load in Node (require), so tests/ can test them without a browser.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Live = api;
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  const Live = {};

  // ---- a game whose teacher has gone ---------------------------------------------------------------
  // The teacher's page writes meta/beat (server time) every 5 s. If it has been silent for GONE_MS, the page
  // was closed, reloaded or crashed, and the answers it held are lost: the game can never continue. The
  // teacher's page deletes such games of its own on opening, and the join page and the bots refuse them.
  // A shorter silence is a dropped connection, which recovers by itself (players see "Waiting for the
  // teacher…" meanwhile), so it is left alone.
  Live.GONE_MS = 60000;
  Live.isGone = (meta, nowMs) => !!meta && meta.phase !== "done" && typeof meta.beat === "number" && nowMs - meta.beat > Live.GONE_MS;

  // ---- game codes ----------------------------------------------------------------------------------
  // Four consonants and no vowels, so a code can never spell a word. database.rules.json holds the
  // same list; tests/rules.test.js and tests/static.test.js fail if the two disagree.
  Live.CODE_LETTERS = "BCDFGHJKLMNPRSTVWXZ";
  Live.CODE_RE = new RegExp("^[" + Live.CODE_LETTERS + "]{4}$");
  // Whatever a student types in the code box becomes either a valid code or null; nothing else ever
  // reaches a database path.
  Live.cleanCode = (s) => {
    const c = String(s == null ? "" : s).toUpperCase().replace(/[^A-Z]/g, "");
    return Live.CODE_RE.test(c) ? c : null;
  };
  Live.randomCode = (rnd = Math.random) => {
    let c = "";
    for (let i = 0; i < 4; i++) c += Live.CODE_LETTERS[Math.floor(rnd() * Live.CODE_LETTERS.length)];
    return c;
  };

  // ---- random numbers ------------------------------------------------------------------------------
  // mulberry32: a tiny seeded generator, so a game (or a test) can be replayed from its seed.
  Live.rng = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  Live.shuffle = (arr, rnd = Math.random) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  // ---- teams ---------------------------------------------------------------------------------------
  Live.MAX_TEAMS = 10;                    // database.rules.json allows team numbers 0..9
  Live.teamLabel = (n) => "ABCDEFGHIJ"[n] || String(n + 1);
  // Deal players into teams as evenly as possible. teamSize is the size to aim for (0 = everyone in
  // one team). Never a team of one when a team of two is possible; never more than MAX_TEAMS (so with
  // a big class some teams are bigger than asked). Returns { uid: teamNumber }.
  Live.makeTeams = (uids, teamSize, rnd = Math.random) => {
    const n = uids.length;
    if (!n) return {};
    let k = teamSize > 0 ? Math.ceil(n / teamSize) : 1;
    k = Math.min(k, Live.MAX_TEAMS);
    if (n >= 2) k = Math.min(k, Math.floor(n / 2));
    k = Math.max(k, 1);
    const out = {};
    Live.shuffle(uids.slice(), rnd).forEach((uid, i) => { out[uid] = i % k; });
    return out;
  };
  // The team a late joiner should go to: the smallest, the lowest number on a tie.
  Live.smallestTeam = (teamsByUid) => {
    const size = {};
    for (const t of Object.values(teamsByUid)) size[t] = (size[t] || 0) + 1;
    const used = Object.keys(size).map(Number);
    if (!used.length) return 0;
    let best = used[0];
    for (const t of used) if (size[t] < size[best] || (size[t] === size[best] && t < best)) best = t;
    return best;
  };

  // ---- the mode registry ---------------------------------------------------------------------------
  Live.modes = {};
  const SETTING_KEY = /^[A-Za-z0-9]{1,16}$/;
  const ENUM_VAL = /^[A-Za-z0-9]{1,16}$/;
  Live.registerMode = (def) => {
    const need = (ok, msg) => { if (!ok) throw new Error("registerMode(" + (def && def.id) + "): " + msg); };
    need(def && /^[a-z]{3,12}$/.test(def.id || ""), "id must be 3-12 lowercase letters (and database.rules.json must list it)");
    need(!Live.modes[def.id], "already registered");
    need(typeof def.title === "string" && def.title, "title is required");
    def.settings = def.settings || [];
    for (const s of def.settings) {
      need(SETTING_KEY.test(s.key || ""), "setting key '" + s.key + "' must be 1-16 letters or digits");
      need(["int", "enum", "flags"].includes(s.type), "setting '" + s.key + "': type must be int, enum or flags");
      need(Array.isArray(s.options) && s.options.length, "setting '" + s.key + "': options are required");
      if (s.type === "int") need(s.options.every(Number.isInteger), "setting '" + s.key + "': int options must be integers");
      if (s.type === "enum") need(s.options.every((o) => Array.isArray(o) && ENUM_VAL.test(o[0])), "setting '" + s.key + "': enum options are [value, label] with a short value");
      if (s.type === "flags") need(s.options.length <= 30 && s.options.every((o) => Array.isArray(o) && ENUM_VAL.test(o[0])), "setting '" + s.key + "': flags options are [value, label], at most 30");
    }
    need(def.teams === undefined || def.teams === false || typeof def.teams === "object", "teams must be false or an object");
    if (def.built !== false) {
      need(def.host && typeof def.host.nextRound === "function" && typeof def.host.lock === "function" && typeof def.host.renderHost === "function", "host needs nextRound, lock and renderHost");
      need(def.player && typeof def.player.render === "function", "player needs render");
    }
    Live.modes[def.id] = def;
    return def;
  };

  // A mode's settings live in meta/set as numbers or short words, never free text:
  //   int -> the number; enum -> the option's value word; flags -> a bit mask (bit i = options[i]).
  // encodeSettings takes the chosen values (flags as an array of option values); decodeSettings
  // turns the stored object back into chosen values, falling back to the default for anything missing
  // or out of range (so a game made by an older page still decodes).
  Live.defaultSettings = (mode) => {
    const v = {};
    for (const s of mode.settings || []) v[s.key] = s.default !== undefined ? s.default : (s.type === "flags" ? [] : s.type === "enum" ? s.options[0][0] : s.options[0]);
    return v;
  };
  Live.encodeSettings = (mode, values) => {
    const out = {};
    for (const s of mode.settings || []) {
      const v = values[s.key];
      if (s.type === "int") out[s.key] = Number.isInteger(v) ? v : s.options[0];
      else if (s.type === "enum") out[s.key] = s.options.some((o) => o[0] === v) ? v : s.options[0][0];
      else out[s.key] = (Array.isArray(v) ? v : []).reduce((m, x) => { const i = s.options.findIndex((o) => o[0] === x); return i < 0 ? m : m | (1 << i); }, 0);
    }
    return out;
  };
  Live.decodeSettings = (mode, stored) => {
    stored = stored || {};
    const out = Live.defaultSettings(mode);
    for (const s of mode.settings || []) {
      const v = stored[s.key];
      if (v === undefined || v === null) continue;
      if (s.type === "int" && Number.isInteger(v)) out[s.key] = v;
      else if (s.type === "enum" && s.options.some((o) => o[0] === v)) out[s.key] = v;
      else if (s.type === "flags" && Number.isInteger(v)) out[s.key] = s.options.filter((o, i) => v & (1 << i)).map((o) => o[0]);
    }
    return out;
  };
  // Teams are the shell's business, not the mode's: a mode that can use them says how, and the shell
  // adds the controls and stores the answer (meta.teamSize, plus meta.set.teams for an optional one).
  Live.teamsOn = (mode, meta) => {
    if (!mode.teams) return false;
    if (mode.teams.optional) return !!(meta && meta.set && meta.set.teams === "on");
    return true;
  };

  // ---- the privacy notice ------------------------------------------------------------------------------
  // The ONE list of what these pages put on a device. net.js's auditStorage() reads the browser's
  // real storage and compares it with this list; the notice shown on both pages is built from it.
  // (The numbers in this list were measured: see tests/storage-audit.md.)
  Live.STORED = {
    local: [],                            // localStorage: nothing, ever
    cookies: [],                          // cookies: nothing, ever
    session: [                            // sessionStorage: gone when the tab closes
      { key: /^firebase:authUser:/, what: "a random sign-in number (no name, no email) that lets a reload of this tab rejoin as the same player" },
    ],
    indexedDB: [                          // kept after the tab closes; the notice must say so
      { db: "firebase-heartbeat-database", what: "Firebase's own once-a-day note of the date and the library version (no name, no email, no game data)" },
      { db: "firebaseLocalStorageDb", what: "an empty database that Firebase's sign-in library always creates (it holds nothing: the sign-in itself is in the tab-only storage above)" },
    ],
    // Belongs to OTHER pages of this site (the practice app keeps its progress in localStorage); on the
    // real site these share the same address as the live pages, so the audit must not blame the live pages.
    otherPages: { local: [/^latinScansion\./] },
  };

  // The notice shown at the foot of both live pages, in plain English, built from Live.STORED so that
  // it can never list something different from what the audit looks for. Returns an array of lines.
  Live.noticeLines = (role) => {
    const S = Live.STORED;
    const keep = [];
    for (const x of S.session) keep.push("in this tab only, gone when you close it: " + x.what);
    for (const x of S.indexedDB) keep.push("kept in the browser after the tab closes: " + x.what);
    for (const x of S.local) keep.push("in long-term browser storage: " + x.what);
    for (const x of S.cookies) keep.push("in a cookie: " + x.what);
    const lines = [];
    lines.push("Stored on this device: " + keep.join("; ") + ". Nothing is put in cookies, and nothing in long-term browser storage" +
      (S.indexedDB.length ? " other than what is listed" : "") + ".");
    lines.push(role === "host"
      ? "Stored in the game’s online database: the game’s settings, each player’s codename (as a number), teams, the questions shown and the scores. Your Google sign-in only proves that you are the teacher; your email address is not written into the game. Ending the game deletes all of it, and any game over 12 hours old is deleted the next time this page is opened."
      : "Stored in the game’s online database: a number that picks your Latin codename, the time you joined, and the numbers you tap. Never a name, never an email address. When the teacher ends the game, all of it is deleted (anything older than 12 hours goes the next time the teacher opens their page).");
    lines.push("What Google still sees: like any website served from Google’s computers, Firebase receives the IP address of your connection. No name, email or school account is involved.");
    return lines;
  };

  // ---- small DOM helpers -----------------------------------------------------------------------------
  // h("div", {class: "x", onclick: fn}, "text", childNode, [more...]). Text is always set as text, never
  // as HTML, so nothing from the database can inject markup.
  Live.h = (tag, props, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "text") el.textContent = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
    };
    kids.forEach(add);
    return el;
  };
  Live.clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

  // A countdown in whole seconds. `nowFn` is the SERVER clock (Net.now / ctx.now), endMs a server
  // time. It stops by itself when the element leaves the page, so a mode can call it from render()
  // without cleaning up. Returns a stop function.
  Live.countdown = (el, endMs, nowFn) => {
    const tick = () => {
      if (!el.isConnected) { clearInterval(timer); return; }
      const left = Math.max(0, Math.ceil((endMs - nowFn()) / 1000));
      el.textContent = String(left);
      el.classList.toggle("live-low", left <= 3);
    };
    const timer = setInterval(tick, 200);
    tick();
    return () => clearInterval(timer);
  };

  // A ranked list. rows: [{ name, gloss, score, you, team }]. `top` limits the length.
  Live.scoreboard = (rows, { top = 5, unit = "" } = {}) => {
    const sorted = rows.slice().sort((a, b) => b.score - a.score);
    const list = Live.h("ol", { class: "live-board" });
    let rank = 0, last = null, shown = 0;
    sorted.forEach((r, i) => {
      if (r.score !== last) { rank = i + 1; last = r.score; }
      if (shown >= top && !r.you) return;
      shown++;
      list.appendChild(Live.h("li", { class: "live-board-row" + (r.you ? " you" : "") },
        Live.h("span", { class: "live-rank" }, String(rank)),
        Live.h("span", { class: "live-board-name" }, r.name, r.gloss ? Live.h("small", {}, r.gloss) : null),
        Live.h("span", { class: "live-board-score" }, Math.round(r.score) + unit)));
    });
    return list;
  };

  return Live;
});
