import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildJoinInfo } from "../server/join-info.js";

function fakeReq({ protocol = "http", host } = {}) {
  return { protocol, get: (name) => (name.toLowerCase() === "host" ? host : undefined) };
}

function fakeInterfaces(map) {
  return () => map;
}

const NO_INTERFACES = fakeInterfaces({});

describe("buildJoinInfo", () => {
  test("GUEST_URL takes priority over request and interface candidates, normalized with a trailing slash", () => {
    const req = fakeReq({ host: "venue.local:7464" });
    const config = { port: 7464, guestUrl: "http://192.168.1.50:7464" };
    const interfaces = fakeInterfaces({
      eth0: [{ address: "192.168.1.99", family: "IPv4", internal: false }],
    });

    const { candidates } = buildJoinInfo(req, config, interfaces);

    assert.equal(candidates[0].source, "configured");
    assert.equal(candidates[0].url, "http://192.168.1.50:7464/");
  });

  test("excludes the request source when the Host header is localhost, 127.0.0.1, or [::1]", () => {
    const config = { port: 7464, guestUrl: "" };
    for (const host of ["localhost:7464", "127.0.0.1:7464", "[::1]:7464"]) {
      const { candidates } = buildJoinInfo(fakeReq({ host }), config, NO_INTERFACES);
      assert.deepEqual(
        candidates.filter((c) => c.source === "request"),
        [],
        `expected no request candidate for host ${host}`,
      );
    }
  });

  test("includes a request candidate built from scheme + Host header for a non-localhost host", () => {
    const req = fakeReq({ protocol: "http", host: "venue.local:7464" });
    const config = { port: 7464, guestUrl: "" };

    const { candidates } = buildJoinInfo(req, config, NO_INTERFACES);

    assert.deepEqual(candidates, [{ url: "http://venue.local:7464/", source: "request" }]);
  });

  test("prefers private-range interface addresses over other ranges like Tailscale's 100.64/10", () => {
    const req = fakeReq({ host: "localhost" });
    const config = { port: 7464, guestUrl: "" };
    // Tailscale address enumerated first to prove priority isn't just enumeration order.
    const interfaces = fakeInterfaces({
      tailscale0: [{ address: "100.64.0.5", family: "IPv4", internal: false }],
      eth0: [{ address: "192.168.1.20", family: "IPv4", internal: false }],
    });

    const { candidates } = buildJoinInfo(req, config, interfaces);

    assert.deepEqual(candidates, [
      { url: "http://192.168.1.20:7464/", source: "interface" },
      { url: "http://100.64.0.5:7464/", source: "interface" },
    ]);
  });

  test("excludes link-local addresses (169.254.0.0/16)", () => {
    const req = fakeReq({ host: "localhost" });
    const config = { port: 7464, guestUrl: "" };
    const interfaces = fakeInterfaces({
      eth0: [
        { address: "169.254.1.5", family: "IPv4", internal: false },
        { address: "192.168.1.20", family: "IPv4", internal: false },
      ],
    });

    const { candidates } = buildJoinInfo(req, config, interfaces);

    assert.deepEqual(candidates, [{ url: "http://192.168.1.20:7464/", source: "interface" }]);
  });

  test("deduplicates by URL, keeping the highest-priority source", () => {
    const req = fakeReq({ host: "192.168.1.20:7464" });
    const config = { port: 7464, guestUrl: "" };
    const interfaces = fakeInterfaces({
      eth0: [{ address: "192.168.1.20", family: "IPv4", internal: false }],
    });

    const { candidates } = buildJoinInfo(req, config, interfaces);

    assert.deepEqual(candidates, [{ url: "http://192.168.1.20:7464/", source: "request" }]);
  });

  test("returns no candidates when nothing is configured, the host is local, and there are no usable interfaces", () => {
    const req = fakeReq({ host: "localhost:7464" });
    const config = { port: 7464, guestUrl: "" };

    const { candidates } = buildJoinInfo(req, config, NO_INTERFACES);

    assert.deepEqual(candidates, []);
  });
});
