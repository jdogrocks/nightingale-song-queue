// Waitlist store: pure state module (no Express, no Nightingale imports).
// Holds two ordered lists in memory:
//   - active: entries with status "waiting" or "sent", in queue order
//   - history: entries with status "done", most recent first, capped at 200
// Every mutation persists a JSON snapshot to disk (temp file + rename).

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const MAX_ACTIVE_ENTRIES = 200;
const MAX_HISTORY_ENTRIES = 200;

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ForbiddenError extends Error {
  constructor(message) {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class WaitlistStore {
  constructor(dataFile) {
    this.dataFile = dataFile;
    this.active = [];
    this.history = [];
    this._load();
  }

  // Returns all entries: active (queue order) followed by history
  // (most recent done first).
  list() {
    return [...this.active, ...this.history];
  }

  add({
    singerName,
    guestId,
    fileHash,
    songTitle,
    songArtist,
    coverUrl,
    needsAnalysis,
  }) {
    if (this.active.length >= MAX_ACTIVE_ENTRIES) {
      throw new ValidationError(
        `Waitlist is full (max ${MAX_ACTIVE_ENTRIES} active entries)`,
      );
    }
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
    this.active.push(entry);
    this._save();
    return entry;
  }

  // Removes an entry entirely. Allowed when guestId matches the entry's
  // guestId, or when no guestId is supplied at all (the VJ page sends none).
  remove(id, guestId) {
    const activeIdx = this.active.findIndex((e) => e.id === id);
    if (activeIdx !== -1) {
      const entry = this.active[activeIdx];
      this._checkGuest(entry, guestId);
      this.active.splice(activeIdx, 1);
      this._save();
      return entry;
    }
    const historyIdx = this.history.findIndex((e) => e.id === id);
    if (historyIdx !== -1) {
      const entry = this.history[historyIdx];
      this._checkGuest(entry, guestId);
      this.history.splice(historyIdx, 1);
      this._save();
      return entry;
    }
    throw new NotFoundError(`Entry ${id} not found`);
  }

  markDone(id) {
    const idx = this.active.findIndex((e) => e.id === id);
    if (idx === -1) throw new NotFoundError(`Entry ${id} not found`);
    const [entry] = this.active.splice(idx, 1);
    entry.status = "done";
    entry.doneAt = new Date().toISOString();
    this.history.unshift(entry);
    if (this.history.length > MAX_HISTORY_ENTRIES) {
      this.history.length = MAX_HISTORY_ENTRIES;
    }
    this._save();
    return entry;
  }

  markSent(id) {
    const entry = this.active.find((e) => e.id === id);
    if (!entry) throw new NotFoundError(`Entry ${id} not found`);
    entry.status = "sent";
    entry.sentAt = new Date().toISOString();
    this._save();
    return entry;
  }

  // orderedIds must contain exactly the ids of all entries whose status is
  // not "done" (i.e. every active id, no more, no less).
  reorder(orderedIds) {
    const activeIds = this.active.map((e) => e.id);
    const sameSet =
      orderedIds.length === activeIds.length &&
      activeIds.every((id) => orderedIds.includes(id));
    if (!sameSet) {
      throw new ValidationError(
        "orderedIds must contain exactly the ids of all non-done entries",
      );
    }
    const byId = new Map(this.active.map((e) => [e.id, e]));
    this.active = orderedIds.map((id) => byId.get(id));
    this._save();
    return this.list();
  }

  _checkGuest(entry, guestId) {
    const provided = guestId !== undefined && guestId !== null && guestId !== "";
    if (provided && entry.guestId !== guestId) {
      throw new ForbiddenError("guestId does not match entry");
    }
  }

  _load() {
    if (!existsSync(this.dataFile)) {
      this.active = [];
      this.history = [];
      return;
    }
    try {
      const raw = readFileSync(this.dataFile, "utf8");
      const parsed = JSON.parse(raw);
      this.active = Array.isArray(parsed.active) ? parsed.active : [];
      this.history = Array.isArray(parsed.history) ? parsed.history : [];
    } catch (err) {
      const corruptPath = `${this.dataFile}.corrupt-${Date.now()}`;
      try {
        renameSync(this.dataFile, corruptPath);
        console.warn(
          `Warning: could not parse ${this.dataFile} (${err.message}); moved to ${corruptPath} and starting empty`,
        );
      } catch (renameErr) {
        console.warn(
          `Warning: could not parse ${this.dataFile} (${err.message}) and could not rename it (${renameErr.message}); starting empty`,
        );
      }
      this.active = [];
      this.history = [];
    }
  }

  _save() {
    const dir = path.dirname(this.dataFile);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const tmpFile = `${this.dataFile}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(
      tmpFile,
      JSON.stringify({ active: this.active, history: this.history }, null, 2),
    );
    renameSync(tmpFile, this.dataFile);
  }
}
