// firebase-config.js -- the WEB config of the live game's Firebase project. AGPL-3.0.
//
// This file is public, and that is fine: a web config is not a secret. Its apiKey only says which
// project to talk to; what protects the data is database.rules.json (the rules), not this key.
// NEVER put a service-account key, an admin token, or anyone's email in this repository.
//
// It is committed with PLACEHOLDERS. The owner pastes the real values after creating the Firebase
// project (live/HOWTO.md, "Part 2"). While the placeholders are still here, the live pages say
// "this game is not set up yet" instead of failing.
window.LIVE_CONFIG = {
  // The host name the real site is served from. On this host the pages use the real project; on
  // `localhost` they use the local emulators; anywhere else (including 127.0.0.1) they refuse to run.
  pagesHost: "samuelshotchkiss-jpg.github.io",

  web: {
    apiKey: "PASTE-API-KEY-HERE",
    authDomain: "PASTE-PROJECT-ID.firebaseapp.com",
    databaseURL: "https://PASTE-PROJECT-ID-default-rtdb.firebaseio.com",
    projectId: "PASTE-PROJECT-ID",
    appId: "PASTE-APP-ID",
  },

  // The local test setup (npm run emulate). The project id must start with "demo-": Firebase refuses
  // to connect a demo- project to anything real.
  emulator: {
    apiKey: "demo-key",
    authDomain: "localhost",
    databaseURL: "https://demo-latin-live-default-rtdb.firebaseio.com",   // the emulator's default instance for this project id
    projectId: "demo-latin-live",
    appId: "demo-app",
    authPort: 9099,
    dbPort: 9000,
  },
};
