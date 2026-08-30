import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { WaitlistStore, HttpError } from "../server/store.js";

let dir;
let dataFile;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "nq-store-"));
  dataFile = path.join(dir, "state.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeEntryInput(overrides = {}) {
  return {
    singerName: "Ana",
    guestId: "guest-1",
    fileHash: "hash-1",
    songTitle: "Song One",
    songArtist: "Artist One",
    coverUrl: null,
    needsAnalysis: false,
    ...overrides,
  };
}

describe("WaitlistStore.add", () => {
  test("creates an entry with generated id, waiting status, and timestamps", () => {
    const store = new WaitlistStore(dataFile);
    const entry = store.add(makeEntryInput());

    assert.equal(typeof entry.id, "string");
    assert.ok(entry.id.length > 0);
    assert.equal(entry.status, "waiting");
    assert.equal(entry.singerName, "Ana");
    assert.equal(entry.sentAt, null);
    assert.equal(entry.doneAt, null);
    assert.equal(typeof entry.requestedAt, "string");
    assert.deepEqual(store.list(), [entry]);
  });
});

describe("WaitlistStore.remove", () => {
  test("removes an entry when guestId matches", () => {
    const store = new WaitlistStore(dataFile);
    const entry = store.add(makeEntryInput({ guestId: "guest-1" }));
    store.remove(entry.id, "guest-1");
    assert.equal(store.list().length, 0);
  });

  test("removes an entry when no guestId is sent (VJ page)", () => {
    const store = new WaitlistStore(dataFile);
    const entry = store.add(makeEntryInput({ guestId: "guest-1" }));
    store.remove(entry.id);
    assert.equal(store.list().length, 0);
  });

  test("throws 403 when guestId does not match", () => {
    const store = new WaitlistStore(dataFile);
    const entry = store.add(makeEntryInput({ guestId: "guest-1" }));
    assert.throws(() => store.remove(entry.id, "someone-else"), (err) => err.status === 403);
    assert.equal(store.list().length, 1);
  });

  test("throws 404 for an unknown id", () => {
    const store = new WaitlistStore(dataFile);
    assert.throws(() => store.remove("nope"), (err) => err.status === 404);
  });

  test("removes a done (history) entry too", () => {
    const store = new WaitlistStore(dataFile);
    const entry = store.add(makeEntryInput({ guestId: "guest-1" }));
    store.markDone(entry.id);
    store.remove(entry.id);
    assert.equal(store.list().length, 0);
  });
});

describe("WaitlistStore.markDone / markSent", () => {
  test("markDone marks the entry done in place", () => {
    const store = new WaitlistStore(dataFile);
    const first = store.add(makeEntryInput({ guestId: "g1", fileHash: "h1" }));
    const second = store.add(makeEntryInput({ guestId: "g2", fileHash: "h2" }));

    store.markDone(first.id);
    store.markDone(second.id);

    const entries = store.list();
    assert.deepEqual(
      entries.map((e) => e.id),
      [first.id, second.id],
    );
    assert.equal(entries[0].status, "done");
    assert.equal(typeof entries[0].doneAt, "string");
  });

  test("markDone on an unknown id throws 404", () => {
    const store = new WaitlistStore(dataFile);
    assert.throws(() => store.markDone("nope"), (err) => err.status === 404);
  });

  test("markSent updates status and sentAt but keeps the entry active", () => {
    const store = new WaitlistStore(dataFile);
    const entry = store.add(makeEntryInput());
    const updated = store.markSent(entry.id);
    assert.equal(updated.status, "sent");
    assert.equal(typeof updated.sentAt, "string");
    assert.equal(store.list().length, 1);
  });

  test("markSent on an unknown id throws 404", () => {
    const store = new WaitlistStore(dataFile);
    assert.throws(() => store.markSent("nope"), (err) => err.status === 404);
  });
});

describe("WaitlistStore.reorder", () => {
  test("reorders active entries when ids exactly match", () => {
    const store = new WaitlistStore(dataFile);
    const a = store.add(makeEntryInput({ guestId: "ga", fileHash: "ha" }));
    const b = store.add(makeEntryInput({ guestId: "gb", fileHash: "hb" }));
    const c = store.add(makeEntryInput({ guestId: "gc", fileHash: "hc" }));

    store.reorder([c.id, a.id, b.id]);
    assert.deepEqual(
      store.list().map((e) => e.id),
      [c.id, a.id, b.id],
    );
  });

  test("rejects reorder missing an active id", () => {
    const store = new WaitlistStore(dataFile);
    const a = store.add(makeEntryInput({ guestId: "ga", fileHash: "ha" }));
    store.add(makeEntryInput({ guestId: "gb", fileHash: "hb" }));
    assert.throws(() => store.reorder([a.id]), (err) => err.status === 400);
  });

  test("rejects reorder that includes a done entry's id", () => {
    const store = new WaitlistStore(dataFile);
    const a = store.add(makeEntryInput({ guestId: "ga", fileHash: "ha" }));
    const b = store.add(makeEntryInput({ guestId: "gb", fileHash: "hb" }));
    store.markDone(a.id);
    assert.throws(() => store.reorder([a.id, b.id]), (err) => err.status === 400);
  });
});

describe("WaitlistStore persistence", () => {
  test("persists mutations and reloads them in a new store instance", () => {
    const store1 = new WaitlistStore(dataFile);
    const entry = store1.add(makeEntryInput({ guestId: "g1" }));
    store1.markSent(entry.id);

    const store2 = new WaitlistStore(dataFile);
    const entries = store2.list();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, entry.id);
    assert.equal(entries[0].status, "sent");
  });

  test("writes via temp file + rename (no stray temp files left behind)", () => {
    const store = new WaitlistStore(dataFile);
    store.add(makeEntryInput());
    const files = readdirSync(dir);
    assert.deepEqual(files, ["state.json"]);
    const saved = JSON.parse(readFileSync(dataFile, "utf8"));
    assert.equal(saved.entries.length, 1);
  });

  test("recovers from a corrupt data file by renaming it and starting empty", () => {
    writeFileSync(dataFile, "{ not valid json");
    const store = new WaitlistStore(dataFile);
    assert.deepEqual(store.list(), []);

    const corruptContents = readFileSync(`${dataFile}.corrupt`, "utf8");
    assert.equal(corruptContents, "{ not valid json");
  });
});
