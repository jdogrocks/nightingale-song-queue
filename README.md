# Nightingale Queue

A self-hosted karaoke waitlist manager companion for [Nightingale](https://nightingale.cafe). Guests browse the songbook from their phones and join a waitlist by name; the VJ runs the rotation. No database, no auth, no frills—just a single container with live updates via Server-Sent Events.

## Features

- **Live songbook sync** — polls Nightingale's API for the complete song catalog; sorted by artist and title
- **Guest self-service waitlist** — guests enter their name, pick a song, and see their queue position in real-time
- **VJ console** — reorder the queue, mark songs as done, remove entries, send songs directly to Nightingale (when the playback API is available)
- **QR code join** — VJ toolbar displays a QR code linking guests to the guest page (computed from the request's Host header)
- **Live position updates** — Server-Sent Events broadcast waitlist and songbook changes to all connected browsers
- **Single container** — includes Node.js server, no database, no external services required
- **Feature detection** — automatically detects whether Nightingale supports the playback-queue API and enables the "Send" button accordingly

## How It Works

The server polls Nightingale's REST API to keep a cached songbook in memory and displays it to guests. The waitlist is kept as a JSON file (atomic writes: temp file + rename) and persisted on every mutation. When Nightingale ships its playback-queue API (currently unreleased, master-only), the "Send to Nightingale" button activates automatically via feature detection; until then the VJ starts each song in Nightingale manually.

## Quick Start: Docker

```bash
# Start the companion alongside Nightingale
docker compose up -d

# Open in browser
# Guest page: http://localhost:7464
# VJ page: http://localhost:7464/vj
```

The compose file assumes Nightingale is running on the host at port 64448. If your setup differs, edit `NIGHTINGALE_URL` in `compose.yaml`.

## Quick Start: Node

```bash
npm install
NIGHTINGALE_URL=http://localhost:64448 npm start
```

Then visit http://localhost:7464 (guest) or http://localhost:7464/vj (VJ console).

## Configuration

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `7464` | Server listen port ("SING" on a phone keypad) |
| `NIGHTINGALE_URL` | `http://localhost:64448` | Nightingale base URL as reachable **from this server process** |
| `NIGHTINGALE_PUBLIC_URL` | value of `NIGHTINGALE_URL` | Nightingale base URL as reachable **from guests' browsers** (used for cover images and VJ links to Nightingale) |
| `DATA_FILE` | `./data/state.json` | Waitlist snapshot path |
| `SYNC_INTERVAL_SEC` | `120` | Songbook re-sync interval in seconds; set to `0` to disable polling |
| `PARTY_NAME` | `Karaoke Party!` | Title shown on guest and VJ pages |
| `GUEST_URL` | (empty) | Explicit guest-page URL for the QR code, e.g. `http://192.168.1.50:7464`. Overrides detection. Recommended for Docker. |

## Party Checklist

- Put Nightingale and this app on the same LAN (or use `localhost` on a single machine)
- If hosting for remote guests, set `NIGHTINGALE_PUBLIC_URL` to the host's LAN IP (e.g., `http://192.168.1.100:64448`) so cover art and Nightingale links work from phones
- Set `GUEST_URL` (or open `/vj` via the LAN IP) so the QR code points phones at the right address
- Open `/vj` on your VJ screen to run the queue
- Show the QR code from the VJ toolbar so guests can join from their phones
- No internet required at the venue—everything works on a local network

## Compatibility

Tested against Nightingale 1.1.0. The "Send to Nightingale" button (which enqueues songs directly in Nightingale's playback queue) requires a Nightingale build newer than 1.1.0 and is disabled gracefully on 1.1.0.

## License

MIT
