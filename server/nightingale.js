// Nightingale API client: thin wrapper over the POST /api/cmd/{name}
// command endpoint, plus an in-memory songbook cache and playback-queue
// feature detection. Uses global fetch (Node >= 20).

const LOAD_SONGS_TAKE = 500;

export class NightingaleClient {
  constructor({ url, publicUrl, partyName }) {
    this.url = url.replace(/\/$/, "");
    this.publicUrl = (publicUrl || url).replace(/\/$/, "");
    this.partyName = partyName;
    this.onSynced = null; // set by the app; called after every successful sync

    this.songs = []; // formatted Song[] (camelCase), sorted by artist, title
    this.songsByHash = new Map();
    this.queueApi = false;
    this.reachable = false;
    this.syncedAt = null;
    this.songCount = 0;
    this.analyzedCount = 0;
  }

  // POST {url}/api/cmd/{name} with a JSON body (null when the command takes
  // no arguments). Returns the parsed JSON response on success. Throws an
  // Error with a `.status` property on a non-2xx HTTP response.
  async cmd(name, payload) {
    const res = await fetch(`${this.url}/api/cmd/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload === undefined ? null : payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(
        `Nightingale command "${name}" failed: ${res.status}${text ? ` ${text}` : ""}`,
      );
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  // Full songbook sync: metadata, paginated song list, then playback-queue
  // feature detection. On failure, the existing cache is left untouched
  // (stale) and the error is rethrown for the caller to handle.
  async syncSongbook() {
    try {
      const meta = await this.cmd("load_songs_meta", null);
      const rawSongs = await this._loadAllSongs();
      this.songCount = meta.count;
      this.analyzedCount = meta.analyzed_count;
      this.songs = this._formatSongs(rawSongs);
      this.songsByHash = new Map(this.songs.map((s) => [s.fileHash, s]));
      this.reachable = true;
      this.syncedAt = new Date().toISOString();
    } catch (err) {
      this.reachable = false;
      throw err;
    }
    await this._detectQueueApi();
    const book = this.getSongbook();
    this.onSynced?.(book);
    return book;
  }

  async _loadAllSongs() {
    let all = [];
    let total = Infinity;
    while (all.length < total) {
      const res = await this.cmd("load_songs", {
        params: {
          search: null,
          filters: { artist: null, album: null, playlist: null, query: null },
          skip: all.length,
          take: LOAD_SONGS_TAKE,
        },
      });
      total = res.count;
      if (res.processed.length === 0) break; // guard against a lying count
      all = all.concat(res.processed);
    }
    return all;
  }

  // Playback-queue commands are master-only (not in 1.1.0). A 404/"unknown
  // command" response means queueApi: false. Any other error leaves the
  // previous value in place (best-effort probe).
  async _detectQueueApi() {
    try {
      await this.cmd("load_playback_queue", null);
      this.queueApi = true;
    } catch (err) {
      if (err.status === 404) {
        this.queueApi = false;
      } else {
        console.warn(
          `Warning: playback-queue feature detection failed: ${err.message}`,
        );
      }
    }
  }

  _formatSongs(rawSongs) {
    const formatted = rawSongs.map((s) => ({
      fileHash: s.file_hash,
      title: s.title,
      artist: s.artist,
      album: s.album,
      durationSecs: s.duration_secs,
      isAnalyzed: s.is_analyzed,
      tempo: s.tempo,
      keyOffset: s.key_offset,
      // Relative: covers are proxied through the companion (/api/cover) so
      // guests' phones never need direct reachability to Nightingale.
      coverUrl: s.album_art_path
        ? `/api/cover?path=${encodeURIComponent(s.album_art_path)}`
        : null,
    }));
    formatted.sort((a, b) => {
      const artistCmp = (a.artist ?? "").localeCompare(b.artist ?? "");
      if (artistCmp !== 0) return artistCmp;
      return (a.title ?? "").localeCompare(b.title ?? "");
    });
    return formatted;
  }

  findSong(fileHash) {
    return this.songsByHash.get(fileHash) ?? null;
  }

  getSongbook() {
    return {
      partyName: this.partyName,
      songs: this.songs,
      syncedAt: this.syncedAt,
      nightingale: {
        reachable: this.reachable,
        queueApi: this.queueApi,
        publicUrl: this.publicUrl,
        songCount: this.songCount,
        analyzedCount: this.analyzedCount,
      },
    };
  }

  // Best-effort: queues AI analysis for a song. Swallows all errors (the
  // command may not exist on some Nightingale versions).
  async enqueueAnalysis(fileHash) {
    try {
      await this.cmd("enqueue", { target: { kind: "hashes", hashes: [fileHash] } });
    } catch {
      // best-effort, ignore
    }
  }

  async addToPlaybackQueue({ fileHash, tempo, keyOffset }) {
    return this.cmd("add_playback_queue_entry", { fileHash, tempo, keyOffset });
  }
}
