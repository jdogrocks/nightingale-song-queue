// Builds the guest join-URL candidate list. Pure function of a req-like
// object, the app config, and an interfaces provider — no I/O beyond the
// injected interfacesProvider, so it's cheap to unit test.
// See DESIGN.md "Companion HTTP API" -> GET /api/join-info for the contract.

import os from "node:os";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

// req.get() is Express's case-insensitive header getter. Accept a plainer
// req-like object too (just { protocol, headers }) so tests don't need to
// stub an Express request.
function getHeader(req, name) {
  if (typeof req.get === "function") return req.get(name);
  return req.headers ? req.headers[name.toLowerCase()] : undefined;
}

// Strips the port from a Host header value, handling bracketed IPv6 hosts
// (e.g. "[::1]:7464") as well as plain "host:port".
function hostnameOf(host) {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(1, end);
  }
  const idx = host.lastIndexOf(":");
  return idx === -1 ? host : host.slice(0, idx);
}

function isLocalHostname(hostname) {
  return LOCAL_HOSTNAMES.has(hostname);
}

function normalizeUrl(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

function ipv4Octets(address) {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map(Number);
  return octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? octets : null;
}

function isLinkLocal(address) {
  const octets = ipv4Octets(address);
  return !!octets && octets[0] === 169 && octets[1] === 254;
}

function isPrivateRange(address) {
  const octets = ipv4Octets(address);
  if (!octets) return false;
  const [a, b] = octets;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function nonInternalIpv4Addresses(interfacesProvider) {
  const interfaces = interfacesProvider() || {};
  const addresses = [];
  for (const entries of Object.values(interfaces)) {
    for (const iface of entries || []) {
      const isIpv4 = iface.family === "IPv4" || iface.family === 4;
      if (!isIpv4 || iface.internal) continue;
      if (isLinkLocal(iface.address)) continue;
      addresses.push(iface.address);
    }
  }
  // Private ranges first, otherwise preserve interface enumeration order
  // (Array#filter is stable, so each group keeps its relative order).
  const priv = addresses.filter(isPrivateRange);
  const other = addresses.filter((addr) => !isPrivateRange(addr));
  return [...priv, ...other];
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
    add(normalizeUrl(config.guestUrl), "configured");
  }

  const host = getHeader(req, "host");
  if (host && !isLocalHostname(hostnameOf(host))) {
    const protocol = req.protocol || "http";
    add(`${protocol}://${host}/`, "request");
  }

  for (const address of nonInternalIpv4Addresses(interfacesProvider)) {
    add(`http://${address}:${config.port}/`, "interface");
  }

  return { candidates };
}
