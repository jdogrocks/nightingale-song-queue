// Builds the guest join-URL candidate list. Pure function of an Express
// request, the app config, and an interfaces provider (injectable in tests).
// See DESIGN.md "Companion HTTP API" -> GET /api/join-info for the contract.

import os from "node:os";

// URL.hostname keeps brackets on IPv6, hence both spellings of ::1.
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const PRIVATE_RE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

function hostnameOf(host) {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return host;
  }
}

function nonInternalIpv4Addresses(interfacesProvider) {
  const addresses = [];
  for (const entries of Object.values(interfacesProvider() || {})) {
    for (const iface of entries || []) {
      const isIpv4 = iface.family === "IPv4" || iface.family === 4;
      if (!isIpv4 || iface.internal || iface.address.startsWith("169.254.")) continue;
      addresses.push(iface.address);
    }
  }
  // Private ranges first; Array#filter is stable so each group keeps order.
  return [
    ...addresses.filter((a) => PRIVATE_RE.test(a)),
    ...addresses.filter((a) => !PRIVATE_RE.test(a)),
  ];
}

export function buildJoinInfo(req, config, interfacesProvider = os.networkInterfaces) {
  const candidates = [];
  const seen = new Set();

  function add(url, source) {
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push({ url, source });
  }

  if (config.guestUrl) {
    add(config.guestUrl.endsWith("/") ? config.guestUrl : `${config.guestUrl}/`, "configured");
  }

  const host = req.get("host");
  if (host && !LOCAL_HOSTNAMES.has(hostnameOf(host))) {
    add(`${req.protocol || "http"}://${host}/`, "request");
  }

  for (const address of nonInternalIpv4Addresses(interfacesProvider)) {
    add(`http://${address}:${config.port}/`, "interface");
  }

  return { candidates };
}
