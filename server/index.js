// Thin entry point: read env vars, create the app, start listening, kick
// off the initial songbook sync and its recurring interval.

import { createApp } from "./app.js";

function readConfig(env) {
  const nightingaleUrl = env.NIGHTINGALE_URL || "http://localhost:64448";
  return {
    port: Number(env.PORT) || 7464,
    nightingaleUrl,
    nightingalePublicUrl: env.NIGHTINGALE_PUBLIC_URL || nightingaleUrl,
    dataFile: env.DATA_FILE || "./data/state.json",
    syncIntervalSec:
      env.SYNC_INTERVAL_SEC !== undefined ? Number(env.SYNC_INTERVAL_SEC) : 120,
    partyName: env.PARTY_NAME || "Karaoke Night",
    guestUrl: env.GUEST_URL || "",
  };
}

const config = readConfig(process.env);
const { app, nightingale } = createApp({ config });

function syncSongbook() {
  nightingale.syncSongbook().catch((err) => {
    console.warn(`Warning: Nightingale songbook sync failed: ${err.message}`);
  });
}

syncSongbook();

if (config.syncIntervalSec > 0) {
  const timer = setInterval(syncSongbook, config.syncIntervalSec * 1000);
  timer.unref();
}

app.listen(config.port, () => {
  console.log(`Nightingale Queue companion listening on port ${config.port}`);
});
