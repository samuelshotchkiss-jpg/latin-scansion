// live_static.test.js -- reads the live game's SOURCE and checks the privacy promises that can be
// checked without a browser. (The matching check on a real browser's storage is
// LiveNet.auditStorage(), run by hand in the browser pane: see live/HOWTO.md.)
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const liveJs = fs.readdirSync(path.join(root, "live")).filter((f) => f.endsWith(".js")).map((f) => "live/" + f)
  .concat(fs.readdirSync(path.join(root, "live", "modes")).filter((f) => f.endsWith(".js")).map((f) => "live/modes/" + f));
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");

describe("what the live pages may do", () => {
  test("only net.js touches firebase.* (and net.js is the only file that reads browser storage, to audit it)", () => {
    for (const f of liveJs) {
      const src = noComments(read(f));
      if (f !== "live/net.js") {
        assert.ok(!/\bfirebase\s*\./.test(src), f + " touches firebase.*");
        // (common.js names these only as labels in Live.STORED, the list of what is stored; the next test covers writes)
        if (f !== "live/common.js") assert.ok(!/\b(localStorage|sessionStorage|indexedDB|document\.cookie)\b/.test(src), f + " touches browser storage");
      }
    }
  });
  test("nothing in the live code WRITES to localStorage, sessionStorage, IndexedDB or a cookie", () => {
    for (const f of liveJs) {
      const src = noComments(read(f));
      assert.ok(!/(localStorage|sessionStorage)\s*\.\s*(setItem|removeItem|clear)|(localStorage|sessionStorage)\s*\[/.test(src), f);
      assert.ok(!/document\.cookie\s*=/.test(src), f);
      assert.ok(!/indexedDB\s*\.\s*(open|deleteDatabase)/.test(src), f);
    }
  });
  test("sign-in persistence is SESSION and nothing else is ever requested", () => {
    const net = noComments(read("live/net.js"));
    assert.match(net, /Persistence\.SESSION/);
    assert.ok(!/Persistence\.(LOCAL|NONE)/.test(net));
  });
  test("student pages write only through the four net.js functions the rules were written for", () => {
    for (const f of ["live/player.js"].concat(liveJs.filter((x) => x.startsWith("live/modes/")))) {
      const src = noComments(read(f));
      assert.ok(!/Net\.(update|set|remove|createGame|deleteGame|removePlayer|heartbeat|sweepOld)\b/.test(src), f + " calls a teacher-only function");
    }
  });
  test("no live script uses innerHTML with page data (the QR code's own SVG is the one exception)", () => {
    for (const f of liveJs) {
      const hits = noComments(read(f)).match(/innerHTML/g) || [];
      assert.equal(hits.length, f === "live/host.js" ? 1 : 0, f);
    }
  });
  test("the two pages load only the pinned Firebase files (with fingerprints) and local scripts", () => {
    for (const page of ["live.html", "host.html"]) {
      const html = read(page);
      const srcs = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"[^>]*>/g)];
      assert.ok(srcs.length > 5);
      for (const m of srcs) {
        const url = m[1];
        if (/^https?:/.test(url)) {
          assert.match(url, /^https:\/\/www\.gstatic\.com\/firebasejs\/13\.0\.0\/firebase-(app|auth|database)-compat\.js$/, url);
          assert.match(m[0], /integrity="sha384-[A-Za-z0-9+/=]+"/, url + " needs an integrity fingerprint");
          assert.match(m[0], /crossorigin="anonymous"/);
        } else {
          assert.match(url, /\?v=/, page + ": " + url + " needs a ?v= cache-buster");
          assert.ok(fs.existsSync(path.join(root, url.split("?")[0])), url + " does not exist");
        }
      }
      for (const m of html.matchAll(/<link[^>]*href="([^"]+)"/g)) {
        if (!/^https?:/.test(m[1])) { assert.match(m[1], /\?v=/); assert.ok(fs.existsSync(path.join(root, m[1].split("?")[0])), m[1]); }
      }
    }
  });
  // The real web config has been committed since 2026-10-27 (it only names the project). What must
  // never be here is an email, the teacher's UID, or a server-side secret.
  test("the config holds only the web config (no email, no UID, no server secret)", () => {
    const cfg = read("live/firebase-config.js");
    const code = cfg.replace(/\/\/.*$/gm, "");
    assert.ok(!/@[a-z0-9.-]+\.[a-z]{2,}/i.test(code), "an email address is in the config");
    assert.ok(!/teacherUid|private_key|client_email|BEGIN PRIVATE KEY/i.test(code), "a UID or a service-account secret is in the config");
    const keys = Object.keys(new Function("window", cfg + "\n; return window.LIVE_CONFIG;")({}).web);
    for (const k of keys) assert.ok(["apiKey", "authDomain", "databaseURL", "projectId", "storageBucket", "messagingSenderId", "appId"].includes(k), "unexpected web config field " + k);
  });
});

describe("the privacy notice", () => {
  test("it names every kind of thing the code says it stores, and says what Google sees", () => {
    global.Live = require("../live/common.js");
    for (const role of ["host", "player"]) {
      const text = Live.noticeLines(role).join("\n");
      for (const k of [...Live.STORED.session, ...Live.STORED.indexedDB]) assert.ok(text.includes(k.what), role + " notice lacks: " + k.what);
      assert.match(text, /IP address/);
      assert.match(text, /No name|Never a name|never written|not written/i);
      assert.match(text, /cookies/);
    }
  });
  test("each page prints the notice from the same list", () => {
    for (const f of ["live/host.js", "live/player.js"]) assert.match(read(f), /Live\.noticeLines\(/);
    for (const p of ["live.html", "host.html"]) assert.match(read(p), /id="notice-text"/);
  });
  test("the music is for the teacher's page only: live.html and the students' scripts never name it", () => {
    for (const f of ["live.html", "live/player.js", "live/net.js", "live/common.js"]) {
      assert.ok(!/live\/audio|music\.js|Music|\.mp3/.test(read(f)), f);
    }
    assert.ok(/live\/music\.js/.test(read("host.html")));
  });
});
