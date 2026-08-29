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

import {
  WaitlistStore,
  ValidationError,
  NotFoundError,
  ForbiddenError,
} from "../server/store.js";

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

  test("rejects a 201st active entry", () => {
    const store = new WaitlistStore(dataFile);
    for (let i = 0; i < 200; i++) {
      store.add(makeEntryInput({ guestId: `guest-${i}`, fileHash: `hash-${i}` }));
    }
    assert.throws(
      () => store.add(makeEntryInput({ guestId: "guest-200", fileHash: "hash-200" })),
      ValidationError,
    );
    assert.equal(store.list().length, 200);
  });
});

describe("WaitlistStore.remove", () => {
  test("removes an entry when guestId matches", () => {
    const store = new WaitlistStore(dataFile);
    const entry = store.add(makeEntryInput({ guestId: "guest-1" }));
    const removed = store.remove(entry.id, "guest-1");
    assert.equal(removed.id, entry.id);
    assert.equal(store.list().length, 0);
  });

  test("removes an entry when no guestId is sent (VJ page)", () => {
    const store = new WaitlistStore(dataFile);
    const entry = store.add(makeEntryInput({ guestId: "guest-1" }));
    store.remove(entry.id);
    assert.equal(store.list().length, 0);
  });

  test("throws ForbiddenError when guestId does not match", () => {
    const store = new WaitlistStore(dataFile);
    const entry = store.add(makeEntryInput({ guestId: "guest-1" }));
    assert.throws(() => store.remove(entry.id, "someone-else"), ForbiddenError);
    assert.equal(store.list().length, 1);
  });

  test("throws NotFoundError for an unknown id", () => {
    const store = new WaitlistStore(dataFile);
    assert.throws(() => store.remove("nope"), NotFoundError);
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
  test("markDone moves the entry into history, most recent first", () => {
    const store = new WaitlistStore(dataFile);
    const first = store.add(makeEntryInput({ guestId: "g1", fileHash: "h1" }));
    const second = store.add(makeEntryInput({ guestId: "g2", fileHash: "h2" }));

    store.markDone(first.id);
    store.markDone(second.id);

    const entries = store.list();
    assert.deepEqual(
      entries.map((e) => e.id),
      [second.id, first.id],
    );
    assert.equal(entries[0].status, "done");
    assert.equal(typeof entries[0].doneAt, "string");
  });

  test("markDone on an unknown id throws NotFoundError", () => {
    const store = new WaitlistStore(dataFile);
    assert.throws(() => store.markDone("nope"), NotFoundError);
  });

  test("history is capped at 200 entries", () => {
    const store = new WaitlistStore(dataFile);
    const ids = [];
    for (let i = 0; i < 201; i++) {
      const entry = store.add(makeEntryInput({ guestId: `g${i}`, fileHash: `h${i}` }));
      ids.push(entry.id);
      store.markDone(entry.id);
    }
    const history = store.list();
    assert.equal(history.length, 200);
    // Most recent (last added/done) stays at the front; the oldest is dropped.
    assert.equal(history[0].id, ids[200]);
    assert.ok(!history.some((e) => e.id === ids[0]));
  });

  test("markSent updates status and sentAt but keeps the entry active", () => {
    const store = new WaitlistStore(dataFile);
    const entry = store.add(makeEntryInput());
    const updated = store.markSent(entry.id);
    assert.equal(updated.status, "sent");
    assert.equal(typeof updated.sentAt, "string");
    assert.equal(store.list().length, 1);
  });

  test("markSent on an unknown id throws NotFoundError", () => {
    const store = new WaitlistStore(dataFile);
    assert.throws(() => store.markSent("nope"), NotFoundError);
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
    assert.throws(() => store.reorder([a.id]), ValidationError);
  });

  test("rejects reorder that includes a done entry's id", () => {
    const store = new WaitlistStore(dataFile);
    const a = store.add(makeEntryInput({ guestId: "ga", fileHash: "ha" }));
    const b = store.add(makeEntryInput({ guestId: "gb", fileHash: "hb" }));
    store.markDone(a.id);
    assert.throws(() => store.reorder([a.id, b.id]), ValidationError);
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
    assert.equal(saved.active.length, 1);
  });

  test("recovers from a corrupt data file by renaming it and starting empty", () => {
    writeFileSync(dataFile, "{ not valid json");
    const store = new WaitlistStore(dataFile);
    assert.deepEqual(store.list(), []);

    const files = readdirSync(dir);
    const corruptFile = files.find((f) => f.includes(".corrupt-"));
    assert.ok(corruptFile, "expected a .corrupt-<timestamp> file to exist");
    const corruptContents = readFileSync(path.join(dir, corruptFile), "utf8");
    assert.equal(corruptContents, "{ not valid json");
  });
});
