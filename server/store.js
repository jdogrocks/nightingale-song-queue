// Waitlist store: one ordered array. "waiting"/"sent" entries sit in queue
// order; "done" entries are kept as history (clients sort by doneAt).
// Every mutation persists a JSON snapshot to disk (temp file + rename).

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class WaitlistStore {
  constructor(dataFile) {
    this.dataFile = dataFile;
    this.entries = [];
    this._load();
  }

  list() {
    return this.entries;
  }

  add({ singerName, guestId, fileHash, songTitle, songArtist, coverUrl, needsAnalysis }) {
    const entry = {
      id: randomUUID(),
      singerName,
      guestId,
      fileHash,
      songTitle,
      songArtist,
      coverUrl: coverUrl ?? null,
      status: "waiting",
      needsAnalysis: !!needsAnalysis,
      requestedAt: new Date().toISOString(),
      sentAt: null,
      doneAt: null,
    };
    this.entries.push(entry);
    this._save();
    return entry;
  }

  _find(id) {
    const entry = this.entries.find((e) => e.id === id);
    if (!entry) throw new HttpError(404, `Entry ${id} not found`);
    return entry;
  }

  // Allowed when guestId matches the entry, or when no guestId is supplied
  // at all (the VJ page sends none).
  remove(id, guestId) {
    const entry = this._find(id);
    if (guestId && entry.guestId !== guestId) {
      throw new HttpError(403, "guestId does not match entry");
    }
    this.entries = this.entries.filter((e) => e !== entry);
    this._save();
    return entry;
  }

  markDone(id) {
    const entry = this._find(id);
    entry.status = "done";
    entry.doneAt = new Date().toISOString();
    this._save();
    return entry;
  }

  markSent(id) {
    const entry = this._find(id);
    entry.status = "sent";
    entry.sentAt = new Date().toISOString();
    this._save();
    return entry;
  }

  // orderedIds must contain exactly the ids of all non-done entries.
  reorder(orderedIds) {
    const active = this.entries.filter((e) => e.status !== "done");
    // ponytail: O(n²) same-set check, fine at party scale
    const sameSet =
      orderedIds.length === active.length &&
      active.every((e) => orderedIds.includes(e.id));
    if (!sameSet) {
      throw new HttpError(400, "orderedIds must contain exactly the ids of all non-done entries");
    }
    const byId = new Map(active.map((e) => [e.id, e]));
    this.entries = [
      ...orderedIds.map((id) => byId.get(id)),
      ...this.entries.filter((e) => e.status === "done"),
    ];
    this._save();
    return this.entries;
  }

  _load() {
    if (!existsSync(this.dataFile)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.dataFile, "utf8"));
      // Older snapshots stored {active, history} instead of {entries}.
      this.entries = parsed.entries ?? [...(parsed.active ?? []), ...(parsed.history ?? [])];
    } catch (err) {
      try { renameSync(this.dataFile, `${this.dataFile}.corrupt`); } catch {}
      console.warn(`Warning: could not parse ${this.dataFile} (${err.message}); starting empty`);
    }
  }

  _save() {
    mkdirSync(path.dirname(this.dataFile), { recursive: true });
    const tmpFile = `${this.dataFile}.tmp-${process.pid}`;
    writeFileSync(tmpFile, JSON.stringify({ entries: this.entries }, null, 2));
    renameSync(tmpFile, this.dataFile);
  }
}
