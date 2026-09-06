# Nightingale Queue

A self-hosted karaoke waitlist manager that pairs with [Nightingale](https://nightingale.cafe).

Guests open a link on their phones, browse your real song library, and join a waitlist under their
own name. You get a VJ console with the rotation, drag-free reordering, and a QR code to put on the
screen. No accounts, no database, no cloud service, and no internet connection required at the venue.

```
   Guests' phones                 Your machine
  ┌──────────────┐        ┌───────────────────────────┐
  │  /  (guest)  │◄──────►│  Nightingale Queue :7464  │
  │ browse, join │  LAN   │  waitlist + songbook cache│
  └──────────────┘        └─────────────┬─────────────┘
                                        │ HTTP (server-side only)
  ┌──────────────┐        ┌─────────────▼─────────────┐
  │ /vj (you)    │◄──────►│  Nightingale     :64448   │
  │ run the show │        │  song library + player    │
  └──────────────┘        └───────────────────────────┘
```

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Deployment](#deployment)
- [Configuration](#configuration)
- [Running a party](#running-a-party)
- [Troubleshooting](#troubleshooting)
- [Implementation guide](#implementation-guide)
- [Development](#development)
- [Compatibility](#compatibility)
- [License](#license)

## Features

- **Live songbook sync** — the song list comes straight from Nightingale's API. Nothing to upload,
  export, or keep in step by hand.
- **Guest self-service** — guests set a name once, search the library, and request a song. They see
  their own position in the queue update live.
- **VJ console** — "now up" display, reorder (up / down / to top), mark done, remove, and a history
  of what has been sung.
- **QR code join** — the console shows a QR code pointing at your current LAN address, so guests
  join by pointing a camera at the screen.
- **Live updates** — Server-Sent Events push every change to every connected phone instantly.
- **Cover art proxying** — guests' phones only ever talk to this app, so album art works without
  giving phones any access to Nightingale.
- **Single container, no database** — the waitlist is one JSON file written atomically.
- **Forward-compatible** — when your Nightingale build gains the playback-queue API, the console's
  "Send to Nightingale" button switches itself on (see [Compatibility](#compatibility)).

## Requirements

**Nightingale running in self-hosted web mode.** This app talks to Nightingale over HTTP at
`/api/cmd/*`. That endpoint exists in Nightingale's **server / web mode** — the Docker image
(`razzaru/nightingale`) or the `install.sh` systemd install. The **desktop app alone is not enough**:
it drives the same commands through an internal bridge, and the only port it opens is a
token-authenticated loopback socket for its own analyser — not the command API, and not reachable
from another machine. Running both is a perfectly good setup — the container serves the song list,
and you play the party from the desktop app, which can use your GPU.

**One of:**

- **Docker** (recommended) — the included `compose.yaml` builds and runs everything, or
- **Node.js 20 or newer** — the only runtime dependencies are `express` and `qrcode`. No build step,
  no bundler, no transpiler.

**A local network.** The host machine, your VJ screen, and the guests' phones must be on the same
Wi-Fi. Guests need nothing but a modern mobile browser. No internet access is required at the venue;
nothing is fetched from a CDN and no telemetry leaves the machine.

**Not required:** a database, a reverse proxy, TLS certificates, accounts, or any cloud service.

## Deployment

### Docker (recommended)

```bash
git clone https://github.com/jdogrocks/nightingale-song-queue.git
cd nightingale-song-queue
docker compose up -d
```

Then open **http://localhost:7464** (guest view) and **http://localhost:7464/vj** (VJ console).

The bundled [`compose.yaml`](compose.yaml) assumes Nightingale is reachable on the host at port
64448 and reaches it via `host.docker.internal`. If Nightingale runs elsewhere, edit
`NIGHTINGALE_URL`. The waitlist lives in the named volume `nightingale-queue-data`, so it survives
restarts and upgrades.

To rebuild after pulling changes:

```bash
docker compose up -d --build
```

### Node

```bash
npm install
NIGHTINGALE_URL=http://localhost:64448 npm start
```

Same URLs as above. State is written to `./data/state.json` by default.

### Health check

`GET /healthz` returns `{"ok":true}`. The container declares a Docker `HEALTHCHECK` against it, so
`docker compose ps` reports `(healthy)` once the app is serving.

## Configuration

Everything is environment variables; there is no config file.

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `7464` | Listen port ("SING" on a phone keypad) |
| `NIGHTINGALE_URL` | `http://localhost:64448` | Where **this server process** reaches Nightingale. In Docker that is usually `http://host.docker.internal:64448`. |
| `NIGHTINGALE_PUBLIC_URL` | value of `NIGHTINGALE_URL` | Where **the VJ's browser** reaches Nightingale. Only used for the console's "Open Nightingale" link — cover art is proxied, so guests never need this. |
| `GUEST_URL` | *(empty)* | Explicit guest URL for the QR code, e.g. `http://192.168.1.50:7464`. Overrides auto-detection; see [the QR code](#the-qr-code-and-your-lan-address). |
| `DATA_FILE` | `./data/state.json` | Waitlist snapshot path (the container pins this to `/data/state.json`) |
| `SYNC_INTERVAL_SEC` | `120` | How often to re-read the songbook from Nightingale. `0` disables the timer. |
| `PARTY_NAME` | `Karaoke Party!` | Heading shown on both pages |

Under Docker you normally set none of these by hand: `compose.yaml` derives `GUEST_URL` and
`NIGHTINGALE_PUBLIC_URL` from a single `LAN_IP` entry in a `.env` file (copy `.env.example`). That
one line is the only per-venue change — see [the QR code](#the-qr-code-and-your-lan-address).

## Running a party

1. **Start Nightingale**, then start this app. Confirm the console's status line says
   `Nightingale ● reachable` and shows your song count.
2. **Check the address.** On Docker, set `LAN_IP` in `.env` to this machine's current IP and
   `docker compose up -d` — your IP changes with the network, and this is the one per-venue edit.
   Then open the console at `http://<that-IP>:7464/vj`. See
   [the QR code](#the-qr-code-and-your-lan-address).
3. **Show the QR code** (button in the console toolbar) on the party screen. Guests scan it and land
   on the guest page.
4. **Guests join.** Each guest types a name once, finds a song, and confirms. Their position appears
   under "My songs" and updates live as you work the rotation.
5. **Run the show.** The console's "Now up" panel names the next singer and song. Reorder with
   ↑ / ↓ / ⤒, hit **Done** when a song finishes, or **Remove** to drop a request.
6. **Play the song** in Nightingale. On builds with the playback-queue API you can press **Send**
   instead and it lands in Nightingale's queue directly.

### The QR code and your LAN address

Your LAN IP changes from venue to venue, so the QR code is resolved fresh every time the modal
opens, from three sources in priority order:

1. `GUEST_URL`, if you set it.
2. **The address you opened the console with.** Open `/vj` at `http://192.168.1.50:7464/vj` and the
   QR points at `http://192.168.1.50:7464/` automatically. This is the easy path.
3. **Detected network interfaces**, private ranges first.

If more than one candidate exists, the modal shows a picker so you can choose.

> **Running in Docker? Set `LAN_IP`.** A container cannot see the host's LAN address — it only sees
> its own internal one (something like `172.19.0.2`), which is useless to phones. The compose file
> therefore reads a single variable from a `.env` file beside it:
>
> ```
> LAN_IP=192.168.1.210
> ```
>
> That one line becomes both `GUEST_URL` and `NIGHTINGALE_PUBLIC_URL`. Copy `.env.example` to
> `.env`, set the address, and run `docker compose up -d`. **This is the only thing to change when
> you move to a new venue.** Leave `LAN_IP` unset and the QR falls back to whatever address you
> opened the console with — which works, as long as you open it at the LAN IP rather than
> `localhost`.

## Troubleshooting

**The guest page is stuck on "Connecting to the songbook…"**
The app cannot reach Nightingale. Check `NIGHTINGALE_URL`, and confirm Nightingale answers:
`curl -X POST http://localhost:64448/api/cmd/is_ready -H 'Content-Type: application/json' -d 'null'`
should print `true`. From inside Docker, `localhost` means the container — use
`host.docker.internal`.

**The QR code does not work / points somewhere strange**
See [the QR code](#the-qr-code-and-your-lan-address). Almost always: the console was opened at
`localhost` instead of the LAN IP.

**"Send" is greyed out**
Expected on Nightingale 1.1.0 and older — those builds have no playback-queue API. Start songs in
Nightingale itself. See [Compatibility](#compatibility).

**Songs show an "analyzing…" badge**
Nightingale has not finished analysing that track (stem separation and lyric transcription).
Requesting an unanalysed song automatically asks Nightingale to prioritise it, but analysis takes
time — analyse your library before the party.

**Album art is missing**
Cover images are proxied through this app, so this normally means Nightingale became unreachable
after the songbook was cached. Check the console status line and press "Refresh songbook".

**Guests cannot reach the page at all**
Confirm phones are on the same Wi-Fi, and that the host firewall allows inbound TCP on port 7464.
Client isolation ("AP isolation") on guest Wi-Fi networks will also block it.

## Implementation guide

### Design in one paragraph

One Node process serves a small JSON API, two static pages, and an SSE stream. The songbook is a
read-through cache of Nightingale's library; the waitlist is the only real state and lives in memory,
snapshotted to a JSON file on every change. Guests' browsers talk only to this app — never directly
to Nightingale — which is why nothing needs configuring per-phone. There is no build step: the
frontend is vanilla ES modules served as-is.

### Project layout

```
server/
  index.js        entry point: reads env vars, starts the sync timer, listens
  app.js          Express factory: all routes; returns {app, store, nightingale}
  nightingale.js  Nightingale API client, songbook cache, feature detection
  store.js        waitlist state + atomic JSON persistence
  events.js       Server-Sent Events hub
  join-info.js    guest-URL candidate detection for the QR code
public/
  index.html/guest.js   guest page
  vj.html/vj.js         VJ console
  shared.js             helpers shared by both pages
  style.css             all styling (dark theme)
test/                   node:test suites; no framework, no fixtures
DESIGN.md               the API contract, incl. verified Nightingale specifics
```

`createApp({config})` performs no network I/O and starts no timers, so tests can boot the whole app
against a mock Nightingale without side effects. `server/index.js` is the only place that reads the
environment.

### How a request flows

Guest taps a song →
`POST /api/waitlist` validates it (name length, guest id, and that the hash exists in the songbook
cache) → `store.add()` appends the entry and writes the snapshot → the entry is broadcast over SSE to
every connected page → the guest's own page re-renders with their position. If the song is not yet
analysed, Nightingale is asked to analyse it, fire-and-forget.

### Companion HTTP API

| Method & path | Purpose |
|---|---|
| `GET /healthz` | Liveness probe |
| `GET /api/songbook` | Cached songbook + party name + Nightingale status |
| `POST /api/songbook/refresh` | Force a re-sync (502 if Nightingale is down; the stale cache is kept) |
| `GET /api/cover?path=…` | Proxies one album-art image from Nightingale |
| `GET /api/waitlist` | `{entries, nowUp}` |
| `POST /api/waitlist` | Join the waitlist (`singerName`, `fileHash`, `guestId`) |
| `DELETE /api/waitlist/:id` | Remove an entry (guests must send their own `guestId`; the console sends none) |
| `POST /api/waitlist/:id/done` | Mark sung |
| `POST /api/waitlist/reorder` | Reorder; body must list exactly the non-done ids |
| `POST /api/waitlist/:id/send` | Push into Nightingale's playback queue (501 when unsupported) |
| `GET /api/events` | SSE stream: a `snapshot` on connect, then `waitlist` / `songbook` events |
| `GET /api/join-info` | QR candidate URLs, recomputed per request |
| `GET /api/qr.svg?url=…` | QR code SVG; the URL must match a current candidate |

Errors are always JSON: `{"error": "..."}`. The store raises `HttpError(status, message)` and routes
map it straight to the response code.

### Talking to Nightingale

Nightingale exposes one endpoint shape: `POST {base}/api/cmd/{name}` with a JSON body (`null` when
the command takes no arguments). Unknown commands return **404** with a plain-text body, which is
exactly how feature detection works. Commands used here:

| Command | Used for |
|---|---|
| `load_songs_meta` | song and analysed counts |
| `load_songs` | the library itself, paginated 500 at a time |
| `enqueue` | ask for analysis of a requested song (best-effort) |
| `load_playback_queue` | **probe only** — a 404 means this build has no queue API |
| `add_playback_queue_entry` | the console's "Send" button |
| `GET /api/asset?path=…` | album art (fetched server-side and re-served) |

Note the casing split in Nightingale's own API: library commands use `snake_case` fields, while the
playback-queue commands use `camelCase`. [`DESIGN.md`](DESIGN.md) records the exact payloads,
verified against a live instance.

### State and persistence

The waitlist is one ordered array. Entries carry `status` (`waiting` → `sent` → `done`), the singer's
name and guest id, and a denormalised copy of the song's title, artist, and cover URL — so history
survives songbook re-syncs and library changes. `nowUp` is simply the first `waiting` entry.

Every mutation writes the whole file to a temporary path and then renames it, which is atomic on
POSIX filesystems, so an interrupted write can never leave a half-written waitlist. An unparseable
file is moved aside to `<name>.corrupt` and the app starts empty rather than refusing to boot.
Snapshots from before v0.1 (`{active, history}`) are migrated on load.

### Live updates

`GET /api/events` registers the response with a small SSE hub and immediately writes one `snapshot`
event containing both the waitlist and the songbook, which is how pages populate on load. Every
mutation broadcasts a `waitlist` event; every successful sync broadcasts `songbook`. A comment
heartbeat every 25 seconds keeps intermediaries from closing idle streams, and browsers reconnect on
their own — so there is no polling loop anywhere in the frontend.

### Frontend notes

Both pages are plain ES modules with no framework. Every string that came from a guest or from
Nightingale is inserted with `textContent`, never `innerHTML`.

One non-obvious constraint: `crypto.randomUUID()` only exists in **secure contexts**. Guests load the
page over plain HTTP at a LAN IP, which is not one, so `shared.js`/`guest.js` fall back to
`crypto.getRandomValues()` to mint the guest id. Anything else added here must respect the same
limit.

### Security model

There is deliberately none: no authentication, no TLS, no rate limiting. This is a party tool for a
trusted LAN. Anyone who can reach the port can join the waitlist, and anyone who can reach `/vj` can
run the queue. Do not expose it to the internet. If you need to, put it behind a reverse proxy that
provides TLS and authentication.

The one thing that *is* enforced is that guests may only cancel their own entries (by `guestId`), and
`/api/qr.svg` will only encode a URL the server itself just offered.

## Development

```bash
npm install
npm test        # node --test — 38 tests, no framework
npm start
```

Tests cover the store (validation, reordering, persistence round-trips, corrupt-file recovery), the
HTTP API against a mock Nightingale server built on `node:http` (pagination, feature detection,
cover proxying, the full waitlist lifecycle), and join-URL detection with a fake network-interface
provider. Nothing in the suite touches the network or a real Nightingale.

Two conventions worth keeping:

- [`DESIGN.md`](DESIGN.md) is the contract. Change it in the same commit as the behaviour.
- Keep dependencies at two. Everything here is small enough to read in one sitting; that is a
  feature.

## Compatibility

Developed and verified against **Nightingale 1.1.0** (Docker), with the API surface cross-checked
against Nightingale's source.

The **"Send to Nightingale"** button needs the playback-queue commands, which are not in 1.1.0 — they
exist in Nightingale's `master` and will ship in a later release. The app probes for them on every
songbook sync, so the button turns itself on when you upgrade Nightingale; nothing here needs
changing. Until then the queue works exactly as well — you start each song in Nightingale yourself,
which is what a VJ is doing anyway.

Because that API is internal and undocumented, pin your Nightingale image to a known tag and re-test
after upgrading.

## License

Copyright © 2026 **Cirrusly Cloudy LLC**. Released as open source under the
[Apache License 2.0](LICENSE).

You are free to use, modify, distribute, and sell this software, including commercially. In return
the licence requires attribution: anyone redistributing this software or a derivative work must
include the licence, preserve the existing copyright and attribution notices, include a readable
copy of the [NOTICE](NOTICE) file, and state clearly if they changed any files. Apache 2.0 also
grants an explicit patent licence to users, and terminates that grant for anyone who brings a patent
suit over the software.
