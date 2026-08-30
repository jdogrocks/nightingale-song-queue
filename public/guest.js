// Nightingale Queue — guest page logic. Vanilla JS, no build step.
// Contract: see DESIGN.md "Companion HTTP API".

import { formatDuration, safeJson, buildCover, showToast, connectLive, refreshWaitlist } from './shared.js';

const STORAGE_NAME = 'nq_singerName';
const STORAGE_GUEST_ID = 'nq_guestId';

const state = {
  songs: [],
  songbookLoaded: false,
  entries: [],
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

function loadIdentity() {
  let id = localStorage.getItem(STORAGE_GUEST_ID);
  if (!id) {
    id = makeUuid();
    localStorage.setItem(STORAGE_GUEST_ID, id);
  }
  state.guestId = id;
  state.singerName = localStorage.getItem(STORAGE_NAME) || null;
}

function renderIdentity() {
  const hasName = !!state.singerName;
  identityForm.hidden = hasName;
  identityDisplay.hidden = !hasName;
  if (hasName) {
    identityNameEl.textContent = state.singerName;
  }
}

// --- rendering ---

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
  songbookStatusEl.hidden = state.songbookLoaded;
  renderSongList();
  renderMySongs();
}

// --- data ---

function handleSongbook(data) {
  state.songs = data.songs || [];
  state.songbookLoaded = true;
  if (data.partyName) {
    partyNameEl.textContent = data.partyName;
    document.title = data.partyName;
  }
  render();
}

function handleWaitlist(data) {
  state.entries = data.entries || [];
  render();
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
  await refreshWaitlist(handleWaitlist);
  const waiting = state.entries.filter((e) => e.status === 'waiting');
  const idx = waiting.findIndex((e) => body && e.id === body.id);
  showToast(toastEl, idx >= 0 ? `You're #${idx + 1}` : "You're on the list");
}

async function cancelEntry(id) {
  try {
    await fetch(`/api/waitlist/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guestId: state.guestId }),
    });
  } catch {
    showToast(toastEl, 'Could not cancel — check your connection.');
  }
  await refreshWaitlist(handleWaitlist);
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

// --- event bindings ---

function bindEvents() {
  identityForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const val = singerNameInput.value.trim().slice(0, 40);
    if (!val) return;
    state.singerName = val;
    localStorage.setItem(STORAGE_NAME, val);
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
    if (row) onSongRowActivate(row);
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
      showToast(toastEl, err.message || 'Something went wrong. Try again.');
    } finally {
      confirmSubmitBtn.disabled = false;
    }
  });
}

loadIdentity();
bindEvents();
render();
if (!state.singerName) singerNameInput.focus();
connectLive({ onSongbook: handleSongbook, onWaitlist: handleWaitlist });
