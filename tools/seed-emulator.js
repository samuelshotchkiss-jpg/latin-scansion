// seed-emulator.js -- gives the LOCAL test setup a teacher. AGPL-3.0.
//
//   node tools/seed-emulator.js
//
// Needs the emulators running (`npm run emulate`). It does what the owner does once by hand on the
// real project (live/HOWTO.md, Part 2): it signs a made-up "Google" teacher into the Auth emulator
// and writes that account's UID into config/teacherUid in the emulator's database. After this,
// "Sign in as the test teacher" on host.html (practice mode only) is the teacher.
//
// It refuses to talk to anything except this computer. The emulators accept an unsigned "Google"
// token and the special password `owner`, which is exactly why they must never be reachable from outside.
"use strict";
const AUTH = process.env.AUTH_EMULATOR_HOST || "localhost:9099";
const DB = process.env.FIREBASE_DATABASE_EMULATOR_HOST || "localhost:9000";
const NS = "demo-latin-live-default-rtdb";               // the emulator's default database for project demo-latin-live
const local = (hp) => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(hp);

async function main() {
  if (!local(AUTH) || !local(DB)) throw new Error("Refusing to seed anything but a local emulator (got " + AUTH + " and " + DB + ").");
  // The same made-up Google identity that net.js signs in with (signInTestTeacher): same `sub`, same account.
  const fake = JSON.stringify({ sub: "test-teacher", email: "teacher@example.test", email_verified: true });
  const r = await fetch("http://" + AUTH + "/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestUri: "http://localhost", postBody: "id_token=" + encodeURIComponent(fake) + "&providerId=google.com", returnSecureToken: true, returnIdpCredential: true }),
  });
  const j = await r.json();
  if (!j.localId) throw new Error("The Auth emulator did not give a UID: " + JSON.stringify(j));
  const w = await fetch("http://" + DB + "/config/teacherUid.json?ns=" + NS, { method: "PUT", headers: { Authorization: "Bearer owner" }, body: JSON.stringify(j.localId) });
  if (!w.ok) throw new Error("Could not write config/teacherUid: " + w.status + " " + (await w.text()));
  console.log("Test teacher ready. UID " + j.localId + " is now config/teacherUid in the emulator.");
}
main().catch((e) => { console.error(e.message); process.exit(1); });
