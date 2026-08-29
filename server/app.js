// Express app factory. createApp({config}) wires routes and returns
// {app, store, nightingale} without starting any network activity (no
// listen(), no songbook sync) so tests can boot it side-effect-free.

import { fileURLToPath } from "node:url";
import path from "node:path";
import express from "express";
import QRCode from "qrcode";

import { WaitlistStore, ValidationError, NotFoundError, ForbiddenError } from "./store.js";
import { NightingaleClient } from "./nightingale.js";
import { createEventHub } from "./events.js";
import { buildJoinInfo } from "./join-info.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

export function createApp({ config }) {
  const store = new WaitlistStore(config.dataFile);
  const nightingale = new NightingaleClient({
    url: config.nightingaleUrl,
    publicUrl: config.nightingalePublicUrl,
  });
  const events = createEventHub();

  const app = express();
  app.use(express.json());

  function buildSongbookPayload() {
    const sb = nightingale.getSongbook();
    return {
      partyName: config.partyName,
      songs: sb.songs,
      syncedAt: sb.syncedAt,
      nightingale: sb.nightingale,
    };
  }

  function buildWaitlistPayload() {
    const entries = store.list();
    const nowUp = entries.find((e) => e.status === "waiting") ?? null;
    return { entries, nowUp };
  }

  // Any songbook sync — whether triggered by the refresh route below or by
  // index.js's background interval — fans out to connected SSE clients.
  nightingale.on("synced", () => {
    events.broadcast("songbook", buildSongbookPayload());
  });

  app.get("/healthz", (req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/songbook", (req, res) => {
    res.json(buildSongbookPayload());
  });

  app.post("/api/songbook/refresh", async (req, res) => {
    try {
      await nightingale.syncSongbook();
      res.json(buildSongbookPayload());
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.get("/api/waitlist", (req, res) => {
    res.json(buildWaitlistPayload());
  });

  app.post("/api/waitlist", (req, res) => {
    const body = req.body ?? {};
    const singerName =
      typeof body.singerName === "string" ? body.singerName.trim() : "";
    const fileHash = body.fileHash;
    const guestId = body.guestId;

    if (singerName.length < 1 || singerName.length > 40) {
      return res
        .status(400)
        .json({ error: "singerName must be between 1 and 40 characters" });
    }
    if (typeof guestId !== "string" || guestId.length === 0 || guestId.length > 64) {
      return res
        .status(400)
        .json({ error: "guestId is required and must be at most 64 characters" });
    }
    if (typeof fileHash !== "string" || fileHash.length === 0) {
      return res.status(400).json({ error: "fileHash is required" });
    }
    const song = nightingale.findSong(fileHash);
    if (!song) {
      return res.status(400).json({ error: "fileHash not found in songbook" });
    }

    try {
      const needsAnalysis = song.isAnalyzed === false;
      const entry = store.add({
        singerName,
        guestId,
        fileHash,
        songTitle: song.title,
        songArtist: song.artist,
        coverUrl: song.coverUrl,
        needsAnalysis,
      });
      if (needsAnalysis) {
        nightingale.enqueueAnalysis(fileHash); // fire-and-forget
      }
      events.broadcast("waitlist", buildWaitlistPayload());
      res.status(201).json(entry);
    } catch (err) {
      if (err instanceof ValidationError) {
        return res.status(400).json({ error: err.message });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/waitlist/:id", (req, res) => {
    const guestId = req.body?.guestId;
    try {
      store.remove(req.params.id, guestId);
      events.broadcast("waitlist", buildWaitlistPayload());
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof NotFoundError) {
        return res.status(404).json({ error: err.message });
      }
      if (err instanceof ForbiddenError) {
        return res.status(403).json({ error: err.message });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/waitlist/:id/done", (req, res) => {
    try {
      const entry = store.markDone(req.params.id);
      events.broadcast("waitlist", buildWaitlistPayload());
      res.json(entry);
    } catch (err) {
      if (err instanceof NotFoundError) {
        return res.status(404).json({ error: err.message });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/waitlist/reorder", (req, res) => {
    const orderedIds = req.body?.orderedIds;
    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ error: "orderedIds must be an array" });
    }
    try {
      store.reorder(orderedIds);
      const payload = buildWaitlistPayload();
      events.broadcast("waitlist", payload);
      res.json(payload);
    } catch (err) {
      if (err instanceof ValidationError) {
        return res.status(400).json({ error: err.message });
      }
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/waitlist/:id/send", async (req, res) => {
    if (!nightingale.queueApi) {
      return res
        .status(501)
        .json({ error: "Nightingale queue API not available on this version" });
    }
    const entry = store.list().find((e) => e.id === req.params.id);
    if (!entry) {
      return res.status(404).json({ error: `Entry ${req.params.id} not found` });
    }
    const song = nightingale.findSong(entry.fileHash);
    const tempo = song?.tempo ?? 1.0;
    const keyOffset = song?.keyOffset ?? 0;
    try {
      await nightingale.addToPlaybackQueue({ fileHash: entry.fileHash, tempo, keyOffset });
      const updated = store.markSent(entry.id);
      events.broadcast("waitlist", buildWaitlistPayload());
      res.json(updated);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  });

  app.get("/api/events", (req, res) => {
    events.addClient(res);
    const snapshot = {
      waitlist: buildWaitlistPayload(),
      songbook: buildSongbookPayload(),
    };
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
  });

  app.get("/api/join-info", (req, res) => {
    res.json(buildJoinInfo(req, config, config.interfacesProvider));
  });

  app.get("/api/qr.svg", async (req, res) => {
    const { candidates } = buildJoinInfo(req, config, config.interfacesProvider);
    let targetUrl;
    if (req.query.url !== undefined) {
      const match = candidates.find((c) => c.url === req.query.url);
      if (!match) {
        return res
          .status(400)
          .json({ error: "url must exactly match one of the current join candidates" });
      }
      targetUrl = match.url;
    } else {
      if (candidates.length === 0) {
        return res
          .status(503)
          .json({ error: "No guest-reachable address could be determined" });
      }
      targetUrl = candidates[0].url;
    }
    try {
      const svg = await QRCode.toString(targetUrl, { type: "svg" });
      res.type("image/svg+xml").send(svg);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.use(express.static(PUBLIC_DIR));
  app.get("/vj", (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "vj.html"));
  });

  // Catch JSON body-parse errors (and anything else) as JSON, not HTML.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    res.status(400).json({ error: err.message || "Bad request" });
  });

  return { app, store, nightingale };
}
