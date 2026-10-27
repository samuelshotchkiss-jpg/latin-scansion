// mutate_rules.js -- does the rules test-suite actually notice a loosened rule?
//
// For each line below it makes a copy of database.rules.json with ONE rule weakened, runs
// tests/rules.test.js against the copy, and reports how many tests failed. A mutation no test
// notices ("SURVIVED") is a rule with no test guarding it. Run it with `npm run test:mutate`
// (that script starts the emulator). Nothing here touches the real rules file.
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const rules = fs.readFileSync(path.join(__dirname, "..", "database.rules.json"), "utf8");
const PROV = "auth.token.firebase.sign_in_provider == 'google.com' && ";
const TEACHER_IS = "auth.uid === root.child('config').child('teacherUid').val()";
const OPEN = "root.child('games').child($code).child('round').child('open')";
const PLAYER_EXISTS = "root.child('games').child($code).child('players').child(auth.uid).exists()";
const POST_N = "newData.parent().parent().child('players').child(auth.uid).child('n')";

// [what was weakened, text to find, text to put instead, (more find/replace pairs...)]. Every occurrence
// is replaced. A few rules are locked twice on purpose (the claim AND the player record each check the
// name number); those are weakened together, because weakening one half alone changes nothing.
const MUTATIONS = [
  ["the teacher check no longer needs a Google sign-in", PROV, ""],
  ["the teacher check no longer compares the UID (any Google user is the teacher)", TEACHER_IS, "true"],
  ["config is readable by anyone signed in", '"config": {\n      ".read": false', '"config": {\n      ".read": "auth != null"'],
  ["config is writable by anyone signed in", '".read": false,\n      ".write": false', '".read": false,\n      ".write": "auth != null"'],
  ["any signed-in user can list games", '"games": {\n      ".read": "auth != null && auth.token', '"games": {\n      ".read": "auth != null || auth.token'],
  ["a student can read anyone's hand", '"hands": {\n          "$uid": {\n            ".read": "auth != null && auth.uid === $uid"', '"hands": {\n          "$uid": {\n            ".read": "auth != null"'],
  ["a student can read anyone's taps", '"taps": {\n          "$uid": {\n            ".read": "auth != null && auth.uid === $uid"', '"taps": {\n          "$uid": {\n            ".read": "auth != null"'],
  ["a tap no longer has to be the tapper's own", '".write": "auth != null && auth.uid === $uid && !data.exists() && newData.exists() && ' + PLAYER_EXISTS, '".write": "auth != null && !data.exists() && newData.exists() && ' + PLAYER_EXISTS],
  ["a tap can be edited or deleted", "&& !data.exists() && newData.exists() && " + PLAYER_EXISTS, "&& " + PLAYER_EXISTS],
  ["a tap needs no joined player", "&& " + PLAYER_EXISTS + " && " + OPEN, "&& " + OPEN],
  ["a tap is accepted when the round is closed", "child('open').val() === true", "child('open').val() !== 'x'"],
  ["a tap may have any round number", "newData.val() === root.child('games').child($code).child('round').child('n').val()", "true"],
  ["a tap may carry a client-chosen time", '"at": { ".validate": "newData.isNumber() && newData.val() === now" }', '"at": { ".validate": "newData.isNumber()" }'],
  ["a tap's v may be any number", "newData.val() >= 0 && newData.val() <= 9 && newData.val() % 1 === 0", "newData.isNumber()"],
  ["a tap's v may be text", '"v": { ".validate": "newData.isNumber() && ', '"v": { ".validate": "true || '],
  ["a tap id may be any text", "$id.matches(/^[0-9]{1,6}_[0-9]$/) && $id.beginsWith('' + newData.child('n').val() + '_')", "true"],
  ["a tap id need not match its round", " && $id.beginsWith('' + newData.child('n').val() + '_')", ""],
  ["a tap may have extra children", '"at": { ".validate": "newData.isNumber() && newData.val() === now" },\n              "$other": { ".validate": false }', '"at": { ".validate": "newData.isNumber() && newData.val() === now" }'],
  ["a player may write someone else's record", '".write": "auth != null && auth.uid === $uid && newData.exists() && root', '".write": "auth != null && newData.exists() && root'],
  ["a player may delete their own record", '".write": "auth != null && auth.uid === $uid && newData.exists() && root', '".write": "auth != null && auth.uid === $uid && root'],
  ["a player record may have extra children (a name)", '(data.exists() && newData.val() === data.val()))" },\n            "$other": { ".validate": false }', '(data.exists() && newData.val() === data.val()))" }'],
  ["a player's name number may be text", '"n": { ".validate": "newData.isNumber() && newData.val() >= 0 && newData.val() <= 959', '"n": { ".validate": "true || newData.val() >= 0 && newData.val() <= 959'],
  ["a player's name number may be out of range", "newData.val() >= 0 && newData.val() <= 959 && newData.val() % 1 === 0 && newData.parent()", "newData.parent()"],
  ["a player need not hold the claim for their name", " && newData.parent().parent().parent().child('claims').child('' + newData.val()).val() === auth.uid && (!data.exists()", " && (!data.exists()"],
  ["a player may re-roll without releasing the old name", " && (!data.exists() || data.val() === newData.val() || newData.parent().parent().parent().child('claims').child('' + data.val()).val() !== auth.uid)", ""],
  ["a player's joined-at time can be client-chosen", '"at": { ".validate": "newData.isNumber() && ((!data.exists() && newData.val() === now) || (data.exists() && newData.val() === data.val()))" }', '"at": { ".validate": "newData.isNumber()" }'],
  ["a player's joined-at time can be rewritten later", '|| (data.exists() && newData.val() === data.val()))" },\n            "$other"', '|| data.exists())" },\n            "$other"'],
  ["a claim can be overwritten by someone else", "((!data.exists() && newData.val() === auth.uid) || (data.val() === auth.uid &&", "((newData.val() === auth.uid) || (data.val() === auth.uid &&"],
  ["a claim can be deleted by someone else", "(data.val() === auth.uid && (newData.val() === auth.uid || (!newData.exists()", "(true && (newData.val() === auth.uid || (!newData.exists()"],
  ["a claim need not be backed by a player record", " && '' + " + POST_N + ".val() === $idx\"", "\""],
  ["a claim value need not be the claimer's UID (redundant: three rules check it)", '".validate": "newData.isString() && newData.val() === auth.uid && ', '".validate": "newData.isString() && '],
  ["a claim can be released while still in use", "(!newData.exists() && (!" + POST_N + ".exists() || '' + " + POST_N + ".val() !== $idx))", "!newData.exists()"],
  ["a claim number can be outside the name list (redundant: the player rule also limits it; the combined case is below)", "/^(0|[1-9][0-9]?|[1-8][0-9][0-9]|9[0-5][0-9])$/", "/^[0-9]+$/"],
  ["claims can be made in a game that does not exist (redundant: the player rule also needs the game; combined case below)", "\".write\": \"auth != null && root.child('games').child($code).child('meta').exists() && $idx", "\".write\": \"auth != null && $idx"],
  ["a claim may hold any value (both checks of its own removed; redundant: the player rule checks it a third time)", "((!data.exists() && newData.val() === auth.uid) ||", "((!data.exists()) ||", '".validate": "newData.isString() && newData.val() === auth.uid && ', '".validate": "newData.isString() && '],
  ["a name number outside the list (960 and up) is accepted (both checks removed)", "/^(0|[1-9][0-9]?|[1-8][0-9][0-9]|9[0-5][0-9])$/", "/^[0-9]+$/", "newData.val() >= 0 && newData.val() <= 959 && newData.val() % 1 === 0 && newData.parent()", "newData.parent()"],
  ["claims and players can be made in a game that does not exist (both checks removed)", "\".write\": \"auth != null && root.child('games').child($code).child('meta').exists() && $idx", "\".write\": \"auth != null && $idx", "newData.exists() && root.child('games').child($code).child('meta').exists()", "newData.exists()"],
  ["a game code can be anything", " && $code.matches(/^[BCDFGHJKLMNPRSTVWXZ]{4}$/)", ""],
  ["a game can hold stray children", '        "$other": { ".validate": false }\n      }\n    }\n  }\n}', "      }\n    }\n  }\n}"],
  ["meta accepts any phase", "/^(lobby|play|done)$/", "/^.*$/"],
  ["meta accepts any mode", "/^(devices|meter|poll)$/", "/^.*$/"],
  ["meta accepts extra children", '          "$other": { ".validate": false }\n        },\n\n        "claims"', '        },\n\n        "claims"'],
  ["meta may name another host", '"host": { ".validate": "newData.isString() && newData.val() === auth.uid" }', '"host": { ".validate": "newData.isString()" }'],
  ["a team number may be out of range", 'newData.val() >= 0 && newData.val() <= 9 && newData.val() % 1 === 0" }\n        },\n\n        "round"', 'newData.isNumber()" }\n        },\n\n        "round"'],
  ["a round with the wrong shape is accepted", '"open": { ".validate": "newData.isBoolean()" }', '"open": { ".validate": "true" }'],
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rules-mutation-"));
let survived = 0, notApplied = 0;
for (const [what, ...pairs] of MUTATIONS) {
  if (process.env.ONLY && !what.includes(process.env.ONLY)) continue;
  let mutant = rules, missing = false;
  for (let i = 0; i < pairs.length; i += 2) {
    if (!mutant.includes(pairs[i])) missing = true;
    mutant = mutant.split(pairs[i]).join(pairs[i + 1]);
  }
  if (missing) { console.log(`NOT APPLIED         ${what}   (the rule text changed; update this line)`); notApplied++; continue; }
  const file = path.join(tmp, "mutant.rules.json");
  fs.writeFileSync(file, mutant);
  const r = spawnSync(process.execPath, ["--test", path.join(__dirname, "rules.test.js")],
    { env: { ...process.env, RULES_FILE: file }, encoding: "utf8" });
  const failed = (/ℹ fail (\d+)/.exec(r.stdout) || [0, "?"])[1];
  const killed = failed === "?" || Number(failed) > 0;
  const expected = what.includes("redundant");
  console.log(`${killed ? "killed by " + String(failed).padStart(2) + " tests " : expected ? "survived (expected) " : "SURVIVED           "} ${what}`);
  if (!killed && !expected) survived++;
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${MUTATIONS.length} mutations, ${survived} survived, ${notApplied} not applied.`);
process.exit(survived || notApplied ? 1 : 0);
