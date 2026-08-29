// Nightingale Queue — VJ console logic. Vanilla JS, no build step.
// Contract: see DESIGN.md "Companion HTTP API". All Nightingale/guest-
// provided strings are rendered via textContent only.

const state = {
  songs: [],
  songbookMeta: null, // { partyName, syncedAt, nightingale }
  songbookLoaded: false,
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

let toastTimer = null;

// --- helpers ---

function formatDuration(totalSecs) {
  if (totalSecs == null || Number.isNaN(totalSecs)) return '--:--';
  const total = Math.max(0, Math.round(totalSecs));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatTime(iso) {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
  void toastEl.offsetWidth;
  toastEl.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('visible');
    setTimeout(() => {
      toastEl.hidden = true;
    }, 300);
  }, 3500);
}

function queueApiAvailable() {
  return !!(state.songbookMeta && state.songbookMeta.nightingale && state.songbookMeta.nightingale.queueApi === true);
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

function renderBanner() {
  if (!state.songbookLoaded) {
    bannerEl.hidden = true;
    return;
  }
  const reachable = state.songbookMeta.nightingale && state.songbookMeta.nightingale.reachable;
  bannerEl.hidden = reachable !== false;
}

function renderStatus() {
  if (!state.songbookLoaded) {
    statusLineEl.textContent = 'Connecting to the songbook…';
    return;
  }
  const ng = state.songbookMeta.nightingale || {};
  const songCount = ng.songCount ?? state.songs.length;
  const analyzedCount = ng.analyzedCount ?? 0;
  const synced = formatTime(state.songbookMeta.syncedAt);
  const dot = ng.reachable ? '●' : '○';
  const label = ng.reachable ? 'reachable' : 'down';
  statusLineEl.textContent = `${songCount} songs · ${analyzedCount} analyzed · synced ${synced} · Nightingale ${dot} ${label}`;
}

function renderOpenLink() {
  const url = state.songbookMeta && state.songbookMeta.nightingale && state.songbookMeta.nightingale.publicUrl;
  if (url) {
    openNightingaleLink.href = url;
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
  const doneBtn = textButton('Done', () => markDone(entry.id));
  const removeBtn = textButton('Remove', () => removeEntry(entry.id));
  controls.append(upBtn, downBtn, topBtn, doneBtn, removeBtn);

  if (entry.status === 'waiting') {
    const sendBtn = textButton('Send', () => sendEntry(entry.id));
    sendBtn.classList.add('btn-accent');
    if (!queueApiAvailable()) {
      sendBtn.disabled = true;
      sendBtn.title = "This Nightingale version doesn't have the queue API yet (needs a build with the playback-queue commands).";
    } else {
      sendBtn.title = 'Queue this song in Nightingale';
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
    .slice()
    .sort((a, b) => new Date(b.doneAt) - new Date(a.doneAt));

  historyCount.textContent = String(done.length);
  historyList.textContent = '';
  if (done.length === 0) return;

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
  renderBanner();
  renderStatus();
  renderOpenLink();
  renderNowUp();
  renderWaitlist();
  renderHistory();
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
    document.title = `${data.partyName} — VJ`;
  }
  render();
}

function handleWaitlist(data) {
  state.entries = data.entries || [];
  state.nowUp = data.nowUp || null;
  render();
}

// See guest.js for the same note: the SSE "snapshot" payload shape is not
// fully pinned down in DESIGN.md beyond "JSON matching the GET endpoints".
// Handle a combined {songbook, waitlist} wrapper, and defensively a bare
// songbook- or waitlist-shaped object.
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

async function refreshSongbookData() {
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
  await Promise.all([refreshSongbookData(), refreshWaitlistData()]);
}

function connectEvents() {
  const es = new EventSource('/api/events');
  es.addEventListener('snapshot', (e) => handleSnapshot(JSON.parse(e.data)));
  es.addEventListener('waitlist', (e) => handleWaitlist(JSON.parse(e.data)));
  es.addEventListener('songbook', (e) => handleSongbook(JSON.parse(e.data)));
  es.addEventListener('open', () => {
    refreshAll();
  });
}

// --- actions ---

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
  await reorder(ids);
}

async function reorder(orderedIds) {
  try {
    const res = await fetch('/api/waitlist/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds }),
    });
    if (!res.ok) {
      const body = await safeJson(res);
      showToast((body && body.error) || 'Could not reorder the waitlist.');
    }
  } catch {
    showToast('Could not reorder — check your connection.');
  }
  await refreshWaitlistData();
}

async function markDone(id) {
  try {
    const res = await fetch(`/api/waitlist/${encodeURIComponent(id)}/done`, { method: 'POST' });
    if (!res.ok) {
      const body = await safeJson(res);
      showToast((body && body.error) || 'Could not mark done.');
    }
  } catch {
    showToast('Could not mark done — check your connection.');
  }
  await refreshWaitlistData();
}

async function removeEntry(id) {
  try {
    const res = await fetch(`/api/waitlist/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await safeJson(res);
      showToast((body && body.error) || 'Could not remove entry.');
    }
  } catch {
    showToast('Could not remove — check your connection.');
  }
  await refreshWaitlistData();
}

async function sendEntry(id) {
  if (!queueApiAvailable()) return;
  try {
    const res = await fetch(`/api/waitlist/${encodeURIComponent(id)}/send`, { method: 'POST' });
    if (!res.ok) {
      const body = await safeJson(res);
      showToast((body && body.error) || 'Could not send to Nightingale.');
    }
  } catch {
    showToast('Could not send — check your connection.');
  }
  await refreshWaitlistData();
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
    qrSelect.hidden = false;
  } else {
    qrSelect.hidden = true;
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
  qrSelect.addEventListener('change', () => {
    showQrCandidate(qrSelect.value);
  });
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
        showToast((body && body.error) || 'Refresh failed — Nightingale may be unreachable.');
        await refreshSongbookData();
      }
    } catch {
      showToast('Refresh failed — network error.');
    } finally {
      refreshBtn.disabled = false;
    }
  });
}

// --- init ---

function init() {
  bindToolbar();
  render();
  refreshAll();
  connectEvents();
  setInterval(refreshAll, 30000);
}

init();
