// Nightingale Queue — VJ console logic. Vanilla JS, no build step.
// Contract: see DESIGN.md "Companion HTTP API".

import { safeJson, buildCover, showToast, connectLive, refreshWaitlist } from './shared.js';

const state = {
  songs: [],
  songbook: null, // last /api/songbook payload
  entries: [],
  nowUp: null,
};

// --- DOM refs ---
const partyNameEl = document.getElementById('party-name');
const bannerEl = document.getElementById('banner');

const qrBtn = document.getElementById('qr-btn');
const refreshBtn = document.getElementById('refresh-btn');
const statusLineEl = document.getElementById('status-line');
const openNightingaleLink = document.getElementById('open-nightingale-link');

const nowUpContent = document.getElementById('now-up-content');

const waitlistEl = document.getElementById('waitlist');
const waitlistEmpty = document.getElementById('waitlist-empty');

const historyList = document.getElementById('history-list');
const historyCount = document.getElementById('history-count');

const toastEl = document.getElementById('toast');

const qrModal = document.getElementById('qr-modal');
const qrImage = document.getElementById('qr-image');
const qrUrl = document.getElementById('qr-url');
const qrSelect = document.getElementById('qr-select');
const qrHint = document.getElementById('qr-hint');
const qrClose = document.getElementById('qr-close');

// --- helpers ---

function formatTime(iso) {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function nightingaleMeta() {
  return (state.songbook && state.songbook.nightingale) || {};
}

function queueApiAvailable() {
  return nightingaleMeta().queueApi === true;
}

function songStillUnanalyzed(fileHash) {
  const song = state.songs.find((s) => s.fileHash === fileHash);
  if (!song) return true; // can't verify — trust the entry's own flag
  return song.isAnalyzed === false;
}

function iconButton(label, title, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn icon-btn';
  btn.textContent = label;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  btn.addEventListener('click', onClick);
  return btn;
}

function textButton(label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-small';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

// --- rendering ---

function renderStatus() {
  if (!state.songbook) {
    statusLineEl.textContent = 'Connecting to the songbook…';
    bannerEl.hidden = true;
    return;
  }
  const ng = nightingaleMeta();
  bannerEl.hidden = ng.reachable !== false;
  const songCount = ng.songCount ?? state.songs.length;
  const synced = formatTime(state.songbook.syncedAt);
  const dot = ng.reachable ? '●' : '○';
  const label = ng.reachable ? 'reachable' : 'down';
  statusLineEl.textContent = `${songCount} songs · ${ng.analyzedCount ?? 0} analyzed · synced ${synced} · Nightingale ${dot} ${label}`;

  if (ng.publicUrl) {
    openNightingaleLink.href = ng.publicUrl;
    openNightingaleLink.classList.remove('disabled');
  } else {
    openNightingaleLink.removeAttribute('href');
    openNightingaleLink.classList.add('disabled');
  }
}

function renderNowUp() {
  nowUpContent.textContent = '';
  if (!state.nowUp) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Nobody queued yet.';
    nowUpContent.appendChild(p);
    return;
  }
  const entry = state.nowUp;
  nowUpContent.appendChild(buildCover(entry));

  const info = document.createElement('div');
  info.className = 'now-up-info';
  const singer = document.createElement('div');
  singer.className = 'now-up-singer';
  singer.textContent = entry.singerName;
  const song = document.createElement('div');
  song.className = 'now-up-song';
  song.textContent = entry.songTitle;
  const artist = document.createElement('div');
  artist.className = 'now-up-artist';
  artist.textContent = entry.songArtist;
  info.append(singer, song, artist);
  nowUpContent.appendChild(info);
}

function buildWaitlistRow(entry, idx, total, waitingEntries) {
  const li = document.createElement('li');
  li.className = 'waitlist-row';

  const posEl = document.createElement('div');
  if (entry.status === 'sent') {
    posEl.className = 'position badge-sent';
    posEl.textContent = 'Sent';
  } else {
    posEl.className = 'position';
    const waitingIdx = waitingEntries.findIndex((e) => e.id === entry.id);
    posEl.textContent = waitingIdx >= 0 ? `#${waitingIdx + 1}` : '';
  }
  li.appendChild(posEl);

  li.appendChild(buildCover(entry));

  const info = document.createElement('div');
  info.className = 'song-info';
  const singer = document.createElement('div');
  singer.className = 'singer-name';
  singer.textContent = entry.singerName;
  const song = document.createElement('div');
  song.className = 'song-title';
  song.textContent = entry.songTitle;
  const artist = document.createElement('div');
  artist.className = 'song-artist';
  artist.textContent = entry.songArtist;
  info.append(singer, song, artist);
  if (entry.needsAnalysis && songStillUnanalyzed(entry.fileHash)) {
    const badge = document.createElement('span');
    badge.className = 'badge badge-analyzing';
    badge.textContent = 'analyzing…';
    info.appendChild(badge);
  }
  li.appendChild(info);

  const controls = document.createElement('div');
  controls.className = 'controls';

  const upBtn = iconButton('↑', 'Move up', () => moveEntry(entry.id, 'up'));
  upBtn.disabled = idx === 0;
  const downBtn = iconButton('↓', 'Move down', () => moveEntry(entry.id, 'down'));
  downBtn.disabled = idx === total - 1;
  const topBtn = iconButton('⤒', 'Move to top', () => moveEntry(entry.id, 'top'));
  topBtn.disabled = idx === 0;
  controls.append(
    upBtn,
    downBtn,
    topBtn,
    textButton('Done', () => markDone(entry.id)),
    textButton('Remove', () => removeEntry(entry.id))
  );

  if (entry.status === 'waiting') {
    const sendBtn = textButton('Send', () => sendEntry(entry.id));
    sendBtn.classList.add('btn-accent');
    if (queueApiAvailable()) {
      sendBtn.title = 'Queue this song in Nightingale';
    } else {
      sendBtn.disabled = true;
      sendBtn.title = "This Nightingale version doesn't have the queue API yet (needs a build with the playback-queue commands).";
    }
    controls.appendChild(sendBtn);
  } else if (entry.status === 'sent') {
    const sentLabel = document.createElement('span');
    sentLabel.className = 'badge badge-sent-label';
    sentLabel.textContent = 'Sent ✓';
    controls.appendChild(sentLabel);
  }

  li.appendChild(controls);
  return li;
}

function renderWaitlist() {
  const list = state.entries.filter((e) => e.status !== 'done');
  const waitingEntries = state.entries.filter((e) => e.status === 'waiting');
  waitlistEmpty.hidden = list.length !== 0;
  waitlistEl.textContent = '';
  const frag = document.createDocumentFragment();
  list.forEach((entry, idx) => {
    frag.appendChild(buildWaitlistRow(entry, idx, list.length, waitingEntries));
  });
  waitlistEl.appendChild(frag);
}

function renderHistory() {
  const done = state.entries
    .filter((e) => e.status === 'done')
    .sort((a, b) => new Date(b.doneAt) - new Date(a.doneAt));

  historyCount.textContent = String(done.length);
  historyList.textContent = '';

  const frag = document.createDocumentFragment();
  done.forEach((entry) => {
    const li = document.createElement('li');
    const singer = document.createElement('span');
    singer.className = 'singer-name';
    singer.textContent = entry.singerName;
    const song = document.createElement('span');
    song.textContent = `${entry.songTitle} — ${entry.songArtist}`;
    li.append(singer, song);
    frag.appendChild(li);
  });
  historyList.appendChild(frag);
}

function render() {
  renderStatus();
  renderNowUp();
  renderWaitlist();
  renderHistory();
}

// --- data ---

function handleSongbook(data) {
  state.songs = data.songs || [];
  state.songbook = data;
  if (data.partyName) {
    partyNameEl.textContent = data.partyName;
    document.title = `${data.partyName} — VJ`;
  }
  render();
}

function handleWaitlist(data) {
  state.entries = data.entries || [];
  state.nowUp = data.nowUp || null;
  render();
}

// --- actions ---

// Every action posts, reports any error, then re-reads the waitlist.
async function act(url, options, failMessage) {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      const body = await safeJson(res);
      showToast(toastEl, (body && body.error) || failMessage, 3500);
    }
  } catch {
    showToast(toastEl, `${failMessage} — check your connection.`, 3500);
  }
  await refreshWaitlist(handleWaitlist);
}

async function moveEntry(id, mode) {
  const ids = state.entries.filter((e) => e.status !== 'done').map((e) => e.id);
  const idx = ids.indexOf(id);
  if (idx === -1) return;
  if (mode === 'up' && idx > 0) {
    [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
  } else if (mode === 'down' && idx < ids.length - 1) {
    [ids[idx + 1], ids[idx]] = [ids[idx], ids[idx + 1]];
  } else if (mode === 'top' && idx > 0) {
    ids.splice(idx, 1);
    ids.unshift(id);
  } else {
    return;
  }
  await act(
    '/api/waitlist/reorder',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderedIds: ids }) },
    'Could not reorder the waitlist'
  );
}

const markDone = (id) =>
  act(`/api/waitlist/${encodeURIComponent(id)}/done`, { method: 'POST' }, 'Could not mark done');

const removeEntry = (id) =>
  act(`/api/waitlist/${encodeURIComponent(id)}`, { method: 'DELETE' }, 'Could not remove entry');

function sendEntry(id) {
  if (!queueApiAvailable()) return;
  return act(`/api/waitlist/${encodeURIComponent(id)}/send`, { method: 'POST' }, 'Could not send to Nightingale');
}

// --- QR modal ---

// Labels per DESIGN.md: configured/request get fixed copy, interface shows
// the URL itself (there's nothing more descriptive to say about it).
function candidateLabel(candidate) {
  if (candidate.source === 'configured') return 'Configured (GUEST_URL)';
  if (candidate.source === 'request') return 'The address this page was opened with';
  return candidate.url;
}

function showQrCandidate(url) {
  qrImage.src = `/api/qr.svg?url=${encodeURIComponent(url)}`;
  qrImage.hidden = false;
  qrUrl.textContent = url;
}

function renderQrCandidates(candidates) {
  qrSelect.textContent = '';
  if (candidates.length === 0) {
    qrImage.hidden = true;
    qrImage.removeAttribute('src');
    qrUrl.textContent = '';
    qrSelect.hidden = true;
    qrHint.hidden = false;
    qrHint.textContent =
      "Every detected address is localhost-only. Set GUEST_URL, or open this VJ page via the venue's LAN IP.";
    return;
  }

  qrHint.hidden = true;
  showQrCandidate(candidates[0].url);

  qrSelect.hidden = candidates.length < 2;
  if (candidates.length > 1) {
    const frag = document.createDocumentFragment();
    candidates.forEach((candidate) => {
      const option = document.createElement('option');
      option.value = candidate.url;
      option.textContent = candidateLabel(candidate);
      frag.appendChild(option);
    });
    qrSelect.appendChild(frag);
    qrSelect.value = candidates[0].url;
  }
}

// Candidates change when the venue's network changes, so re-fetch every
// time the modal opens rather than caching them.
async function loadJoinInfo() {
  qrImage.hidden = true;
  qrSelect.hidden = true;
  qrHint.hidden = true;
  qrUrl.textContent = 'Loading…';
  try {
    const res = await fetch('/api/join-info');
    const body = await safeJson(res);
    renderQrCandidates((body && body.candidates) || []);
  } catch {
    qrUrl.textContent = '';
    qrHint.hidden = false;
    qrHint.textContent = 'Could not load join info — check your connection.';
  }
}

// --- toolbar ---

function bindToolbar() {
  qrBtn.addEventListener('click', () => {
    qrModal.hidden = false;
    loadJoinInfo();
  });
  qrSelect.addEventListener('change', () => showQrCandidate(qrSelect.value));
  qrClose.addEventListener('click', () => {
    qrModal.hidden = true;
  });
  qrModal.addEventListener('click', (e) => {
    if (e.target === qrModal) qrModal.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !qrModal.hidden) qrModal.hidden = true;
  });

  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    try {
      const res = await fetch('/api/songbook/refresh', { method: 'POST' });
      const body = await safeJson(res);
      if (res.ok) {
        handleSongbook(body);
      } else {
        showToast(toastEl, (body && body.error) || 'Refresh failed — Nightingale may be unreachable.', 3500);
      }
    } catch {
      showToast(toastEl, 'Refresh failed — network error.', 3500);
    } finally {
      refreshBtn.disabled = false;
    }
  });
}

bindToolbar();
render();
connectLive({ onSongbook: handleSongbook, onWaitlist: handleWaitlist });
