// Nightingale Queue — guest page logic. Vanilla JS, no build step.
// Contract: see DESIGN.md "Companion HTTP API". All user-provided /
// Nightingale-sourced strings are rendered via textContent only.

const STORAGE_NAME = 'nq_singerName';
const STORAGE_GUEST_ID = 'nq_guestId';

const state = {
  songs: [],
  songbookMeta: null, // { partyName, syncedAt, nightingale }
  songbookLoaded: false,
  entries: [],
  nowUp: null,
  guestId: null,
  singerName: null,
  pendingSong: null,
};

// --- DOM refs ---
const partyNameEl = document.getElementById('party-name');
const identityForm = document.getElementById('identity-form');
const identityDisplay = document.getElementById('identity-display');
const identityNameEl = document.getElementById('identity-name');
const singerNameInput = document.getElementById('singer-name-input');
const notYouBtn = document.getElementById('not-you-btn');

const mySongsSection = document.getElementById('my-songs');
const mySongsList = document.getElementById('my-songs-list');

const searchInput = document.getElementById('search-input');
const searchNote = document.getElementById('search-note');
const songbookStatusEl = document.getElementById('songbook-status');
const songListEl = document.getElementById('song-list');

const toastEl = document.getElementById('toast');

const confirmModal = document.getElementById('confirm-modal');
const confirmBody = document.getElementById('confirm-body');
const confirmCancelBtn = document.getElementById('confirm-cancel');
const confirmSubmitBtn = document.getElementById('confirm-submit');

let toastTimer = null;

// --- identity ---

// crypto.randomUUID only exists in secure contexts; guests load this page
// over plain http on a LAN IP, so fall back to getRandomValues (available
// everywhere) to build a v4 UUID.
function makeUuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function getOrCreateGuestId() {
  let id = localStorage.getItem(STORAGE_GUEST_ID);
  if (!id) {
    id = makeUuid();
    localStorage.setItem(STORAGE_GUEST_ID, id);
  }
  return id;
}

function loadIdentity() {
  state.guestId = getOrCreateGuestId();
  state.singerName = localStorage.getItem(STORAGE_NAME) || null;
}

function setSingerName(name) {
  state.singerName = name;
  localStorage.setItem(STORAGE_NAME, name);
}

function renderIdentity() {
  const hasName = !!state.singerName;
  identityForm.hidden = hasName;
  identityDisplay.hidden = !hasName;
  if (hasName) {
    identityNameEl.textContent = state.singerName;
  }
}

// --- helpers ---

function formatDuration(totalSecs) {
  if (totalSecs == null || Number.isNaN(totalSecs)) return '--:--';
  const total = Math.max(0, Math.round(totalSecs));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function buildCover(item) {
  if (item.coverUrl) {
    const img = document.createElement('img');
    img.src = item.coverUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.className = 'cover-img';
    return img;
  }
  const div = document.createElement('div');
  div.className = 'cover-placeholder';
  div.textContent = '♪';
  div.setAttribute('aria-hidden', 'true');
  return div;
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  // force reflow so the transition runs even if a toast is already visible
  void toastEl.offsetWidth;
  toastEl.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('visible');
    setTimeout(() => {
      toastEl.hidden = true;
    }, 300);
  }, 3000);
}

// --- rendering ---

function renderSongbookStatus() {
  songbookStatusEl.hidden = state.songbookLoaded;
}

function getFilteredSongs() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) {
    return { list: state.songs, truncated: false };
  }
  const filtered = state.songs.filter(
    (s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
  );
  return { list: filtered.slice(0, 100), truncated: filtered.length > 100 };
}

function renderSongList() {
  if (!state.songbookLoaded) {
    songListEl.textContent = '';
    searchNote.hidden = true;
    return;
  }
  const { list, truncated } = getFilteredSongs();
  searchNote.hidden = !truncated;

  songListEl.textContent = '';
  if (list.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty-state';
    empty.textContent = state.songs.length === 0
      ? 'No songs in the songbook yet.'
      : 'No matches — try a different search.';
    songListEl.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const song of list) {
    const li = document.createElement('li');
    li.className = 'song-row';
    li.dataset.fileHash = song.fileHash;
    li.tabIndex = 0;
    li.setAttribute('role', 'button');

    li.appendChild(buildCover(song));

    const info = document.createElement('div');
    info.className = 'song-info';
    const t = document.createElement('div');
    t.className = 'song-title';
    t.textContent = song.title;
    const a = document.createElement('div');
    a.className = 'song-artist';
    a.textContent = song.artist;
    info.append(t, a);
    li.appendChild(info);

    const dur = document.createElement('div');
    dur.className = 'song-duration';
    dur.textContent = formatDuration(song.durationSecs);
    li.appendChild(dur);

    frag.appendChild(li);
  }
  songListEl.appendChild(frag);
}

function renderMySongs() {
  const waitingEntries = state.entries.filter((e) => e.status === 'waiting');
  const mine = waitingEntries.filter((e) => e.guestId === state.guestId);

  if (mine.length === 0) {
    mySongsSection.hidden = true;
    mySongsList.textContent = '';
    return;
  }
  mySongsSection.hidden = false;
  mySongsList.textContent = '';

  const frag = document.createDocumentFragment();
  mine.forEach((entry) => {
    const pos = waitingEntries.findIndex((e) => e.id === entry.id) + 1;
    const li = document.createElement('li');
    li.className = 'my-song-row';

    const posEl = document.createElement('span');
    posEl.className = 'position';
    posEl.textContent = `#${pos}`;
    li.appendChild(posEl);

    const info = document.createElement('div');
    info.className = 'song-info';
    const t = document.createElement('div');
    t.className = 'song-title';
    t.textContent = entry.songTitle;
    const a = document.createElement('div');
    a.className = 'song-artist';
    a.textContent = entry.songArtist;
    info.append(t, a);
    li.appendChild(info);

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-ghost btn-small';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => cancelEntry(entry.id));
    li.appendChild(cancelBtn);

    frag.appendChild(li);
  });
  mySongsList.appendChild(frag);
}

function render() {
  renderIdentity();
  renderSongbookStatus();
  renderSongList();
  renderMySongs();
}

// --- data fetching ---

function handleSongbook(data) {
  state.songs = data.songs || [];
  state.songbookMeta = {
    partyName: data.partyName,
    syncedAt: data.syncedAt,
    nightingale: data.nightingale,
  };
  state.songbookLoaded = true;
  if (data.partyName) {
    partyNameEl.textContent = data.partyName;
    document.title = data.partyName;
  }
  render();
}

function handleWaitlist(data) {
  state.entries = data.entries || [];
  state.nowUp = data.nowUp || null;
  render();
}

// The SSE "snapshot" event's exact payload shape isn't pinned down further
// than "JSON matching the GET endpoints" in DESIGN.md. Handle both a
// combined {songbook, waitlist} wrapper and, defensively, a bare songbook-
// or waitlist-shaped object.
function handleSnapshot(data) {
  if (!data) return;
  if (data.songbook) {
    handleSongbook(data.songbook);
  } else if (Array.isArray(data.songs)) {
    handleSongbook(data);
  }
  if (data.waitlist) {
    handleWaitlist(data.waitlist);
  } else if (Array.isArray(data.entries)) {
    handleWaitlist(data);
  }
}

async function refreshSongbook() {
  try {
    const res = await fetch('/api/songbook');
    if (res.ok) handleSongbook(await res.json());
  } catch {
    // offline / server down — keep whatever we last had
  }
}

async function refreshWaitlistData() {
  try {
    const res = await fetch('/api/waitlist');
    if (res.ok) handleWaitlist(await res.json());
  } catch {
    // offline / server down — keep whatever we last had
  }
}

async function refreshAll() {
  await Promise.all([refreshSongbook(), refreshWaitlistData()]);
}

function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('snapshot', (e) => handleSnapshot(JSON.parse(e.data)));
  es.addEventListener('waitlist', (e) => handleWaitlist(JSON.parse(e.data)));
  es.addEventListener('songbook', (e) => handleSongbook(JSON.parse(e.data)));
  // EventSource reconnects natively on drop; refresh explicitly whenever a
  // connection (re)opens in case anything was missed while disconnected.
  es.addEventListener('open', () => {
    refreshAll();
  });
}

// --- actions ---

async function submitRequest(song) {
  const res = await fetch('/api/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      singerName: state.singerName,
      fileHash: song.fileHash,
      guestId: state.guestId,
    }),
  });
  const body = await safeJson(res);
  if (!res.ok) {
    throw new Error((body && body.error) || 'Could not join the waitlist.');
  }
  await refreshWaitlistData();
  const waitingEntries = state.entries.filter((e) => e.status === 'waiting');
  const idx = waitingEntries.findIndex((e) => body && e.id === body.id);
  showToast(idx >= 0 ? `You're #${idx + 1}` : "You're on the list");
}

async function cancelEntry(id) {
  try {
    await fetch(`/api/waitlist/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestId: state.guestId }),
    });
  } catch {
    showToast('Could not cancel — check your connection.');
  }
  await refreshWaitlistData();
}

// --- confirm modal ---

function openConfirm(song) {
  state.pendingSong = song;
  confirmBody.textContent = `Sing "${song.title}" by ${song.artist} as ${state.singerName}?`;
  confirmModal.hidden = false;
  confirmSubmitBtn.focus();
}

function closeConfirm() {
  confirmModal.hidden = true;
  state.pendingSong = null;
}

// --- event bindings ---

function bindEvents() {
  identityForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = singerNameInput.value.trim().slice(0, 40);
    if (!val) return;
    setSingerName(val);
    renderIdentity();
  });

  notYouBtn.addEventListener('click', () => {
    identityForm.hidden = false;
    identityDisplay.hidden = true;
    singerNameInput.value = state.singerName || '';
    singerNameInput.focus();
    singerNameInput.select();
  });

  searchInput.addEventListener('input', renderSongList);

  songListEl.addEventListener('click', (e) => {
    const row = e.target.closest('.song-row');
    if (!row) return;
    onSongRowActivate(row);
  });
  songListEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('.song-row');
    if (!row) return;
    e.preventDefault();
    onSongRowActivate(row);
  });

  confirmCancelBtn.addEventListener('click', closeConfirm);
  confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) closeConfirm();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !confirmModal.hidden) closeConfirm();
  });

  confirmSubmitBtn.addEventListener('click', async () => {
    const song = state.pendingSong;
    if (!song) return;
    confirmSubmitBtn.disabled = true;
    try {
      await submitRequest(song);
      closeConfirm();
    } catch (err) {
      showToast(err.message || 'Something went wrong. Try again.');
    } finally {
      confirmSubmitBtn.disabled = false;
    }
  });
}

function onSongRowActivate(row) {
  const song = state.songs.find((s) => s.fileHash === row.dataset.fileHash);
  if (!song) return;
  if (!state.singerName) {
    identityForm.hidden = false;
    singerNameInput.focus();
    return;
  }
  openConfirm(song);
}

// --- init ---

function init() {
  loadIdentity();
  bindEvents();
  render();
  if (!state.singerName) {
    singerNameInput.focus();
  }
  refreshAll();
  connectEvents();
  setInterval(refreshAll, 30000);
}

init();
