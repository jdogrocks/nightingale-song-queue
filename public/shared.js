// Shared by the guest page and the VJ console. Vanilla JS, no build step.
// All server-provided strings are rendered via textContent only.

export function formatDuration(totalSecs) {
  if (totalSecs == null || Number.isNaN(totalSecs)) return '--:--';
  const total = Math.max(0, Math.round(totalSecs));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export function buildCover(item) {
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

let toastTimer = null;
export function showToast(el, message, ms = 3000) {
  el.textContent = message;
  el.hidden = false;
  void el.offsetWidth; // force reflow so the transition reruns
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('visible');
    setTimeout(() => {
      el.hidden = true;
    }, 300);
  }, ms);
}

async function load(url, handler) {
  try {
    const res = await fetch(url);
    if (res.ok) handler(await res.json());
  } catch {
    // offline / server down — keep whatever we last had
  }
}

export function refreshWaitlist(onWaitlist) {
  return load('/api/waitlist', onWaitlist);
}

// One initial fetch for first paint (an SSE connection can sit behind image
// requests on HTTP/1.1), then live updates. The server pushes a full
// snapshot on every connect and EventSource reconnects itself, so there is
// no polling fallback.
export function connectLive({ onSongbook, onWaitlist }) {
  load('/api/songbook', onSongbook);
  load('/api/waitlist', onWaitlist);
  const es = new EventSource('/api/events');
  es.addEventListener('snapshot', (e) => {
    const data = JSON.parse(e.data);
    onSongbook(data.songbook);
    onWaitlist(data.waitlist);
  });
  es.addEventListener('songbook', (e) => onSongbook(JSON.parse(e.data)));
  es.addEventListener('waitlist', (e) => onWaitlist(JSON.parse(e.data)));
}
