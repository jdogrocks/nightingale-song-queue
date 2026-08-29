// Tiny Server-Sent Events hub. Clients are raw Express response objects
// that have already had SSE headers written by addClient(); broadcast()
// pushes an event to every connected client.

const HEARTBEAT_INTERVAL_MS = 25_000;

export function createEventHub() {
  const clients = new Set();

  function addClient(res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("\n");
    clients.add(res);
    res.on("close", () => clients.delete(res));
  }

  function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      res.write(payload);
    }
  }

  const heartbeatTimer = setInterval(() => {
    for (const res of clients) {
      res.write(": heartbeat\n\n");
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  function close() {
    clearInterval(heartbeatTimer);
    for (const res of clients) res.end();
    clients.clear();
  }

  return {
    addClient,
    broadcast,
    close,
    get clientCount() {
      return clients.size;
    },
  };
}
