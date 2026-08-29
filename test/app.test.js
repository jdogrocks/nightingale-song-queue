import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createApp } from "../server/app.js";

// A plain node:http server that stands in for a Nightingale instance. It
// implements only what the companion needs: POST /api/cmd/{name}.
function makeSong(i, overrides = {}) {
  return {
    path: `/songs/song${i}.mp3`,
    file_hash: `hash-${i}`,
    title: `Song ${String(i).padStart(4, "0")}`,
    artist: `Artist ${i % 7}`,
    album: "Album",
    duration_secs: 180 + i,
    album_art_path: i % 2 === 0 ? `/art/${i}.jpg` : null,
    is_analyzed: true,
    language: "en",
    transcript_source: null,
    key: null,
    override_key: null,
    tempo: 1.0,
    key_offset: 0,
    is_video: false,
    usdx: null,
    origin: null,
    no_stems: false,
    ...overrides,
  };
}

function startMockNightingale({ songCount = 3, queueApi = false } = {}) {
  const songs = [];
  for (let i = 0; i < songCount; i++) {
    songs.push(makeSong(i, { is_analyzed: i !== 1 }));
  }
  const calls = [];
  let playbackQueue = [];
  let reachable = true;

  function send(res, status, body) {
    const text = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(text);
  }

  function sendUnknownCommand(res, name) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end(`unknown command ${name}`);
  }

  const server = http.createServer((req, res) => {
    if (!reachable) {
      req.destroy();
      return;
    }
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const match = req.url.match(/^\/api\/cmd\/([^/?]+)/);
      if (req.method !== "POST" || !match) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("not found");
        return;
      }
      const name = match[1];
      let body = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }
      calls.push({ name, body });

      if (name === "load_songs_meta") {
        const analyzed = songs.filter((s) => s.is_analyzed).length;
        send(res, 200, {
          analyzed_count: analyzed,
          count: songs.length,
          folder: "/songs",
          processed_count: songs.length,
          songs_count: songs.length,
          videos_count: 0,
        });
        return;
      }

      if (name === "load_songs") {
        const { skip = 0, take = 500 } = body?.params ?? {};
        const page = songs.slice(skip, skip + take);
        send(res, 200, {
          count: songs.length,
          folder: "/songs",
          processed: page,
          processed_count: page.length,
        });
        return;
      }

      if (name === "load_playback_queue") {
        if (!queueApi) return sendUnknownCommand(res, name);
        send(res, 200, playbackQueue);
        return;
      }

      if (name === "add_playback_queue_entry") {
        if (!queueApi) return sendUnknownCommand(res, name);
        const song = songs.find((s) => s.file_hash === body.fileHash);
        playbackQueue.push({
          id: String(playbackQueue.length),
          song,
          tempo: body.tempo,
          keyOffset: body.keyOffset,
        });
        send(res, 200, playbackQueue);
        return;
      }

      if (name === "enqueue") {
        send(res, 200, {});
        return;
      }

      sendUnknownCommand(res, name);
    });
  });

  return {
    server,
    songs,
    calls,
    getPlaybackQueue: () => playbackQueue,
    goDown: () => {
      reachable = false;
    },
  };
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

describe("Nightingale Queue companion API", () => {
  let dir;
  let mock;
  let mockPort;
  let app;
  let store;
  let nightingale;
  let httpServer;
  let baseUrl;

  async function boot({
    songCount = 3,
    queueApi = false,
    guestUrl = "",
    interfacesProvider,
  } = {}) {
    mock = startMockNightingale({ songCount, queueApi });
    mockPort = await listen(mock.server);

    dir = mkdtempSync(path.join(tmpdir(), "nq-app-"));
    const config = {
      partyName: "Test Party",
      nightingaleUrl: `http://127.0.0.1:${mockPort}`,
      nightingalePublicUrl: `http://127.0.0.1:${mockPort}`,
      dataFile: path.join(dir, "state.json"),
      port: 7464,
      guestUrl,
      // Tests that care about join-info/qr.svg behavior pass a fake so
      // results don't depend on the machine's real network interfaces.
      ...(interfacesProvider ? { interfacesProvider } : {}),
    };

    ({ app, store, nightingale } = createApp({ config }));
    httpServer = http.createServer(app);
    const appPort = await listen(httpServer);
    baseUrl = `http://127.0.0.1:${appPort}`;
  }

  afterEach(async () => {
    if (httpServer) await close(httpServer);
    if (mock) await close(mock.server).catch(() => {});
    if (dir) rmSync(dir, { recursive: true, force: true });
    mock = undefined;
    httpServer = undefined;
    dir = undefined;
  });

  test("GET /healthz returns ok", async () => {
    await boot();
    const res = await fetch(`${baseUrl}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  test("songbook sync paginates across multiple pages", async () => {
    await boot({ songCount: 650 });
    await nightingale.syncSongbook();

    const loadSongsCalls = mock.calls.filter((c) => c.name === "load_songs");
    assert.ok(loadSongsCalls.length >= 2, "expected more than one load_songs page");
    assert.equal(loadSongsCalls[0].body.params.skip, 0);
    assert.equal(loadSongsCalls[0].body.params.take, 500);
    assert.equal(loadSongsCalls[1].body.params.skip, 500);

    const res = await fetch(`${baseUrl}/api/songbook`);
    const payload = await res.json();
    assert.equal(payload.partyName, "Test Party");
    assert.equal(payload.songs.length, 650);
    assert.equal(payload.nightingale.songCount, 650);
    assert.equal(payload.nightingale.reachable, true);
    assert.equal(typeof payload.syncedAt, "string");

    // sorted by artist, then title
    for (let i = 1; i < payload.songs.length; i++) {
      const prev = payload.songs[i - 1];
      const cur = payload.songs[i];
      const cmp = prev.artist.localeCompare(cur.artist);
      assert.ok(cmp < 0 || (cmp === 0 && prev.title.localeCompare(cur.title) <= 0));
    }

    // cover url only present when album_art_path was non-null
    const withCover = payload.songs.find((s) => s.coverUrl !== null);
    assert.ok(withCover);
    assert.match(withCover.coverUrl, /\/api\/asset\?path=/);
  });

  test("feature detection: 404 on load_playback_queue sets queueApi false, and send returns 501", async () => {
    await boot({ songCount: 3, queueApi: false });
    await nightingale.syncSongbook();
    assert.equal(nightingale.queueApi, false);

    const song = nightingale.songs[0];
    const addRes = await fetch(`${baseUrl}/api/waitlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ singerName: "Ana", fileHash: song.fileHash, guestId: "g1" }),
    });
    assert.equal(addRes.status, 201);
    const entry = await addRes.json();

    const sendRes = await fetch(`${baseUrl}/api/waitlist/${entry.id}/send`, { method: "POST" });
    assert.equal(sendRes.status, 501);
    const sendBody = await sendRes.json();
    assert.deepEqual(sendBody, { error: "Nightingale queue API not available on this version" });
  });

  test("feature detection: success on load_playback_queue sets queueApi true, and send calls add_playback_queue_entry with camelCase payload", async () => {
    await boot({ songCount: 3, queueApi: true });
    await nightingale.syncSongbook();
    assert.equal(nightingale.queueApi, true);

    const song = nightingale.songs[0];
    const addRes = await fetch(`${baseUrl}/api/waitlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ singerName: "Ana", fileHash: song.fileHash, guestId: "g1" }),
    });
    const entry = await addRes.json();

    const sendRes = await fetch(`${baseUrl}/api/waitlist/${entry.id}/send`, { method: "POST" });
    assert.equal(sendRes.status, 200);
    const updated = await sendRes.json();
    assert.equal(updated.status, "sent");
    assert.equal(typeof updated.sentAt, "string");

    const queueCall = mock.calls.find((c) => c.name === "add_playback_queue_entry");
    assert.ok(queueCall, "expected add_playback_queue_entry to have been called");
    assert.deepEqual(queueCall.body, {
      fileHash: song.fileHash,
      tempo: song.tempo,
      keyOffset: song.keyOffset,
    });

    const waitlistRes = await fetch(`${baseUrl}/api/waitlist`);
    const waitlistPayload = await waitlistRes.json();
    assert.equal(waitlistPayload.entries[0].status, "sent");
  });

  test("refresh while Nightingale is down returns 502 and keeps serving the stale cache", async () => {
    await boot({ songCount: 5 });
    await nightingale.syncSongbook();

    const before = await (await fetch(`${baseUrl}/api/songbook`)).json();
    assert.equal(before.songs.length, 5);

    mock.goDown();

    const refreshRes = await fetch(`${baseUrl}/api/songbook/refresh`, { method: "POST" });
    assert.equal(refreshRes.status, 502);
    const refreshBody = await refreshRes.json();
    assert.equal(typeof refreshBody.error, "string");

    const after = await (await fetch(`${baseUrl}/api/songbook`)).json();
    assert.equal(after.songs.length, 5);
    assert.deepEqual(after.songs, before.songs);
    assert.equal(after.nightingale.reachable, false);
  });

  test("waitlist flow: add, list with nowUp, reorder, done, delete", async () => {
    await boot({ songCount: 3 });
    await nightingale.syncSongbook();
    const [songA, songB] = nightingale.songs;

    const addA = await fetch(`${baseUrl}/api/waitlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ singerName: "Ana", fileHash: songA.fileHash, guestId: "gA" }),
    });
    const entryA = await addA.json();
    assert.equal(addA.status, 201);
    assert.equal(entryA.songTitle, songA.title);

    const addB = await fetch(`${baseUrl}/api/waitlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ singerName: "Bo", fileHash: songB.fileHash, guestId: "gB" }),
    });
    const entryB = await addB.json();

    let listPayload = await (await fetch(`${baseUrl}/api/waitlist`)).json();
    assert.equal(listPayload.entries.length, 2);
    assert.equal(listPayload.nowUp.id, entryA.id);

    // reorder: B first
    const reorderRes = await fetch(`${baseUrl}/api/waitlist/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: [entryB.id, entryA.id] }),
    });
    assert.equal(reorderRes.status, 200);
    listPayload = await reorderRes.json();
    assert.equal(listPayload.nowUp.id, entryB.id);

    // done B
    const doneRes = await fetch(`${baseUrl}/api/waitlist/${entryB.id}/done`, { method: "POST" });
    assert.equal(doneRes.status, 200);
    const doneEntry = await doneRes.json();
    assert.equal(doneEntry.status, "done");

    listPayload = await (await fetch(`${baseUrl}/api/waitlist`)).json();
    assert.equal(listPayload.nowUp.id, entryA.id);

    // delete A with wrong guestId -> 403
    const forbiddenRes = await fetch(`${baseUrl}/api/waitlist/${entryA.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guestId: "not-gA" }),
    });
    assert.equal(forbiddenRes.status, 403);

    // delete A with no guestId (VJ) -> ok
    const deleteRes = await fetch(`${baseUrl}/api/waitlist/${entryA.id}`, { method: "DELETE" });
    assert.equal(deleteRes.status, 200);

    listPayload = await (await fetch(`${baseUrl}/api/waitlist`)).json();
    assert.equal(listPayload.entries.length, 1);
    assert.equal(listPayload.entries[0].status, "done");
  });

  test("POST /api/waitlist validation errors", async () => {
    await boot({ songCount: 1 });
    await nightingale.syncSongbook();
    const song = nightingale.songs[0];

    const missingName = await fetch(`${baseUrl}/api/waitlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ singerName: "", fileHash: song.fileHash, guestId: "g1" }),
    });
    assert.equal(missingName.status, 400);

    const missingGuest = await fetch(`${baseUrl}/api/waitlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ singerName: "Ana", fileHash: song.fileHash }),
    });
    assert.equal(missingGuest.status, 400);

    const badHash = await fetch(`${baseUrl}/api/waitlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ singerName: "Ana", fileHash: "does-not-exist", guestId: "g1" }),
    });
    assert.equal(badHash.status, 400);
  });

  test("needsAnalysis is set and enqueue is fired for an unanalyzed song", async () => {
    await boot({ songCount: 3 }); // song index 1 is is_analyzed: false
    await nightingale.syncSongbook();
    const unanalyzed = nightingale.songs.find((s) => s.isAnalyzed === false);
    assert.ok(unanalyzed, "expected mock songbook to contain an unanalyzed song");

    const addRes = await fetch(`${baseUrl}/api/waitlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ singerName: "Ana", fileHash: unanalyzed.fileHash, guestId: "g1" }),
    });
    const entry = await addRes.json();
    assert.equal(entry.needsAnalysis, true);

    // enqueue is fire-and-forget; give the event loop a tick to let it land.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const enqueueCall = mock.calls.find((c) => c.name === "enqueue");
    assert.ok(enqueueCall, "expected enqueue to have been called");
    assert.deepEqual(enqueueCall.body, { target: { kind: "hashes", hashes: [unanalyzed.fileHash] } });
  });

  test("GET /api/join-info returns the configured GUEST_URL as the first candidate", async () => {
    await boot({ guestUrl: "http://192.168.1.50:7464" });
    const res = await fetch(`${baseUrl}/api/join-info`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body.candidates[0], {
      url: "http://192.168.1.50:7464/",
      source: "configured",
    });
  });

  test("GET /api/qr.svg with no url param defaults to the first candidate", async () => {
    await boot({ guestUrl: "http://192.168.1.50:7464" });
    const res = await fetch(`${baseUrl}/api/qr.svg`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/svg+xml; charset=utf-8");
    const text = await res.text();
    assert.match(text, /^<svg/);
  });

  test("GET /api/qr.svg?url=<candidate> returns 200 for a URL that matches a current candidate", async () => {
    await boot({ guestUrl: "http://192.168.1.50:7464" });
    const res = await fetch(
      `${baseUrl}/api/qr.svg?url=${encodeURIComponent("http://192.168.1.50:7464/")}`,
    );
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /^<svg/);
  });

  test("GET /api/qr.svg?url=<non-candidate> returns 400", async () => {
    await boot({ guestUrl: "http://192.168.1.50:7464" });
    const res = await fetch(
      `${baseUrl}/api/qr.svg?url=${encodeURIComponent("http://evil.example/")}`,
    );
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(typeof body.error, "string");
  });

  test("GET /api/qr.svg returns 503 when there are no join candidates", async () => {
    // No GUEST_URL, requests hit the app over 127.0.0.1 (excluded as
    // localhost), and the fake interfaces provider reports nothing usable.
    await boot({ interfacesProvider: () => ({}) });
    const res = await fetch(`${baseUrl}/api/qr.svg`);
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.equal(typeof body.error, "string");
  });

  test("GET /api/events sends an initial snapshot event", async () => {
    await boot({ songCount: 2 });
    await nightingale.syncSongbook();

    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/events`, { signal: controller.signal });
    assert.equal(res.headers.get("content-type"), "text/event-stream");

    const reader = res.body.getReader();
    const { value } = await reader.read();
    const text = Buffer.from(value).toString("utf8");
    assert.match(text, /event: snapshot/);
    assert.match(text, /"waitlist"/);
    assert.match(text, /"songbook"/);

    controller.abort();
  });
});
