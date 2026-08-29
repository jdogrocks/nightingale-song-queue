# Nightingale Queue — Design & API Contract

A self-hosted karaoke waitlist manager that pairs with a running
[Nightingale](https://github.com/rzru/nightingale) server. Guests browse the
songbook from their phones, enter their name, and join a waitlist. The VJ
(host) sees the rotation, reorders it, and starts each song in Nightingale.

This document is the **single source of truth** for implementers. Every
Nightingale API fact below was verified against a live v1.1.0 Docker instance
and the master-branch source on 2026-08-29. Do not invent endpoints or fields.

## Architecture

- One Node.js (>=20) process. Express serves:
  - `public/` static frontend: guest page `/` (index.html), VJ page `/vj` (vj.html)
  - JSON API under `/api/*`
  - Server-Sent Events at `/api/events`
- No database. Waitlist state lives in memory and is snapshotted to a JSON
  file (atomic write: write temp file, then rename) on every mutation.
- Songbook is cached in memory, synced from Nightingale on boot, on an
  interval, and on demand.
- Dependencies: `express`, `qrcode`. Nothing else. No build step. Vanilla JS
  frontend.

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `PORT` | `7464` | Companion listen port ("SING" on a keypad) |
| `NIGHTINGALE_URL` | `http://localhost:64448` | Nightingale base URL as reachable **from this server process** |
| `NIGHTINGALE_PUBLIC_URL` | value of `NIGHTINGALE_URL` | Nightingale base URL as reachable **from guests' browsers** (used for cover images and VJ links) |
| `DATA_FILE` | `./data/state.json` | Waitlist snapshot path |
| `SYNC_INTERVAL_SEC` | `120` | Songbook re-sync interval; `0` disables |
| `PARTY_NAME` | `Karaoke Night` | Title shown on pages |
| `GUEST_URL` | (empty) | Explicit guest-page URL for the QR code, e.g. `http://192.168.1.50:7464`. Overrides detection. Recommended for Docker. |

## Nightingale API (verified)

Base: `NIGHTINGALE_URL`. Every command is
`POST {base}/api/cmd/{name}` with a JSON body (send `null` when the command
takes no arguments), `Content-Type: application/json`. Success responses are
raw JSON (no envelope). An unknown command returns **HTTP 404** with a plain
text body like `unknown command load_playback_queue`.

Commands available on the current release (1.1.0):

- `is_ready` → `true` | `false`
- `load_songs_meta` → `{"analyzed_count":417,"count":422,"folder":"/songs","processed_count":422,"songs_count":422,"videos_count":0}`
- `load_songs` with body:
  ```json
  {"params":{"search":null,"filters":{"artist":null,"album":null,"playlist":null,"query":null},"skip":0,"take":500}}
  ```
  → `{"count":422,"folder":"/songs","processed":[Song,...],"processed_count":422}`
  Paginate: loop `skip += take` until you have `count` songs. Use `take: 500`.
- `enqueue` with body `{"target":{"kind":"hashes","hashes":["<file_hash>"]}}`
  → queues AI analysis for a song. Treat as best-effort: swallow all errors
  (it may not exist on some versions).

`Song` fields (snake_case, verified live):
`path`, `file_hash`, `title`, `artist`, `album`, `duration_secs` (float),
`album_art_path` (string or null), `is_analyzed` (bool), `language`,
`transcript_source`, `key`, `override_key`, `tempo` (float, default 1.0),
`key_offset` (int), `is_video`, `usdx`, `origin`, `no_stems`.

Cover images: `GET {NIGHTINGALE_PUBLIC_URL}/api/asset?path=<urlencoded album_art_path>`
→ the image, no auth. Only build this URL when `album_art_path` is non-null.

### Playback-queue commands (master only — NOT in 1.1.0)

These exist on Nightingale master and will ship in the next release. The
companion must **feature-detect** them at boot and after each songbook refresh
by calling `load_playback_queue`; a 404/"unknown command" means
`queueApi: false`.

- `load_playback_queue` (body `null`) → `[{"id":"0","song":Song,"tempo":1.0,"keyOffset":0}, ...]` (camelCase!)
- `add_playback_queue_entry` body `{"fileHash":"<hash>","tempo":1.0,"keyOffset":0}` → updated entries array. Use the song's own `tempo` and `key_offset` from the songbook cache.
- `remove_playback_queue_entry` body `{"id":"<id>"}`
- `clear_playback_queue` (body `null`)

Note the casing split: **requests/responses for the playback queue are
camelCase; everything else is snake_case.** This matches the source.

## Companion HTTP API

All responses JSON. Errors: `{"error":"<message>"}` with 4xx/5xx status.

- `GET /healthz` → `{"ok":true}`
- `GET /api/songbook` →
  ```json
  {
    "partyName": "Karaoke Night",
    "songs": [{"fileHash":"...","title":"...","artist":"...","album":"...",
               "durationSecs":200.3,"isAnalyzed":true,"tempo":1.0,
               "keyOffset":0,"coverUrl":"http://.../api/asset?path=..." }],
    "syncedAt": "2026-08-29T20:00:00.000Z",
    "nightingale": {"reachable":true,"queueApi":false,"publicUrl":"http://localhost:64448","songCount":422,"analyzedCount":417}
  }
  ```
  `coverUrl` is null when there is no art. Songs sorted by artist, then title.
- `POST /api/songbook/refresh` → same payload, after a fresh sync. 502 with
  error message if Nightingale is unreachable (keep serving the stale cache
  on `GET`).
- `GET /api/waitlist` → `{"entries":[Entry,...],"nowUp":Entry|null}`
- `POST /api/waitlist` body `{"singerName":"Ana","fileHash":"...","guestId":"<uuid>"}`
  → created Entry (201). Validation: singerName trimmed, 1–40 chars;
  fileHash must exist in songbook cache; guestId required, ≤64 chars; max 200
  entries with status `waiting`/`sent`. If the song `isAnalyzed === false`,
  fire-and-forget an `enqueue` to Nightingale and set `needsAnalysis: true`.
- `DELETE /api/waitlist/:id` with optional body `{"guestId":"..."}`
  — allowed when the guestId matches the entry, or when no guestId is sent
  (VJ page sends none). Removes the entry entirely.
- `POST /api/waitlist/:id/done` → marks status `done` (kept as history, most
  recent first; history capped at 200).
- `POST /api/waitlist/reorder` body `{"orderedIds":["id1","id2",...]}` — must
  contain exactly the ids of all entries whose status is not `done`; 400
  otherwise. Reorders them.
- `POST /api/waitlist/:id/send` — only when `queueApi` is true; calls
  `add_playback_queue_entry` with the song's cached `tempo`/`key_offset`,
  marks status `sent` on success. 501 `{"error":"Nightingale queue API not available on this version"}` when `queueApi` is false. 502 on Nightingale errors.
- `GET /api/events` — SSE. On connect, send one `snapshot` event; then on any
  change send `waitlist` or `songbook` events. Event data = the same JSON as
  the corresponding GET. Heartbeat comment line every 25s.
- `GET /api/join-info` → `{"candidates":[{"url":"http://192.168.1.50:7464/","source":"interface"},...]}`
  Join-URL candidates, best first, recomputed on every request (venue/DHCP
  changes must be picked up live). Sources in priority order:
  1. `configured` — `GUEST_URL` env var, normalized to end with `/`.
  2. `request` — scheme + Host header of this request, only when the
     hostname is not `localhost`/`127.0.0.1`/`::1` (that address is proven
     reachable by whoever loaded the page; also the only detection that
     works from inside Docker).
  3. `interface` — `os.networkInterfaces()`: IPv4, non-internal, excluding
     link-local `169.254.0.0/16`; private ranges (10/8, 172.16/12,
     192.168/16) before other addresses (e.g. Tailscale 100.64/10); URL
     `http://<ip>:<PORT>/`. The interfaces provider must be injectable for
     tests.
  Deduplicate by URL, preserve priority order.
- `GET /api/qr.svg?url=<encoded>` — SVG QR code (via `qrcode` package) for
  the given URL, which MUST exactly match one of the current candidates
  (400 otherwise — no open QR generator). With no `url` param, encode the
  first candidate; 503 if there are no candidates.

`Entry`:
```json
{"id":"<uuid>","singerName":"Ana","guestId":"<uuid>",
 "fileHash":"...","songTitle":"...","songArtist":"...","coverUrl":null,
 "status":"waiting","needsAnalysis":false,
 "requestedAt":"ISO","sentAt":null,"doneAt":null}
```
Song metadata is denormalized onto the entry at request time so entries
survive songbook re-syncs.

`nowUp` = the first entry with status `waiting`.

## Store & persistence rules

- `server/store.js`: pure state module — no Express, no Nightingale imports.
  Constructor takes the data file path. Methods: `list()`, `add()`,
  `remove(id, guestId?)`, `markDone(id)`, `markSent(id)`, `reorder(orderedIds)`,
  plus snapshot load/save. Every mutation persists (temp file + rename) and
  returns the new state.
- On boot: load the file if valid JSON; on parse failure, rename the corrupt
  file to `<name>.corrupt-<timestamp>` and start empty (log a warning).
- IDs: `crypto.randomUUID()`.

## Live updates

`server/events.js`: tiny SSE hub — `addClient(res)`, `broadcast(event, data)`,
heartbeats, cleanup on close. Guest and VJ pages connect with `EventSource`
and also poll every 30s as a fallback.

## Frontend (public/)

Shared `style.css`, dark theme only, system font stack, one accent color
(pick a warm magenta/pink), large touch targets, mobile-first. No frameworks.
Escape all user strings via `textContent` — never innerHTML with user data.

Guest page `/` (`index.html` + `guest.js`):
1. First visit: inline name field ("Who's singing?"), saved to localStorage
   along with a generated `guestId`.
2. Search box filters the songbook client-side (case-insensitive substring on
   title + artist). Show at most 100 rows with a "keep typing to narrow it
   down" note; with empty search show the full alphabetical list (it's only a
   few hundred songs — simple list, `loading="lazy"` cover thumbnails).
3. Row: 48px cover (or placeholder), title, artist, duration (m:ss). Tap →
   confirm dialog → POST → toast "You're #N".
4. "My songs" section at top: the guest's own waiting entries with position
   number and a cancel button (sends guestId).
5. Live position updates via SSE.

VJ page `/vj` (`vj.html` + `vj.js`):
1. "Now up" hero: singer + song, large.
2. Waitlist: each row = position, singer, song/artist, `analyzing…` badge when
   `needsAnalysis` and the songbook still says not analyzed; controls:
   ↑ / ↓ / ⤒ (top), Done, Remove, Send. Send is hidden/disabled with a title
   tooltip when `queueApi` is false.
3. Toolbar: QR modal — on open, fetch `/api/join-info`; show the QR for the
   first candidate (`/api/qr.svg?url=...`) with the URL as text under it;
   when there is more than one candidate, show a `<select>` to switch
   (labels: `configured` → "Configured (GUEST_URL)", `request` → "The
   address this page was opened with", `interface` → the URL itself); if
   every candidate is localhost-only, show a hint to set `GUEST_URL` or
   open the VJ page via the LAN IP. Also in the toolbar: Refresh
   songbook button, status line (N songs · M analyzed · synced HH:MM ·
   Nightingale ● reachable/○ down), link "Open Nightingale" → `publicUrl`.
4. Done entries collapse into a "History" section.

## Testing

`node --test test/`. No test frameworks. Tests must cover:
- store: add/remove/done/reorder validation/persistence roundtrip/corrupt-file
  recovery/guestId authorization.
- API: boot the app on port 0 with a **mock Nightingale** (plain
  `node:http` server implementing `/api/cmd/*`): songbook sync with
  pagination (>1 page), feature detection on 404 → send returns 501,
  feature detection on success → send calls `add_playback_queue_entry` with
  the right camelCase payload and marks the entry `sent`, refresh while
  Nightingale is down keeps stale cache.
- The app module (`server/app.js`) must export a factory
  `createApp({config})` returning `{app, store, nightingale}` so tests can
  boot it without side effects; `server/index.js` is the thin entry point
  that reads env vars and listens.

## Non-goals (v1)

Auth, HTTPS, fairness auto-rotation, editing Nightingale state beyond the two
commands above, persistence of the songbook cache, i18n.
