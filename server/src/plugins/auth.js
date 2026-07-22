import os from "os";
import { isIP } from "net";

function getHostIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        ips.push(iface.address);
      }
    }
  }
  return ips;
}

function stripPortOrBrackets(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.includes("]")) {
    return trimmed.slice(1, trimmed.indexOf("]"));
  }

  return trimmed;
}

function normalizeIp(value) {
  const ip = stripPortOrBrackets(value || "");
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}

function isLoopbackIp(value) {
  const ip = normalizeIp(value);
  return ip === "::1" || ip.startsWith("127.");
}

export function getClientIp(request) {
  const proxyPeerIp = request.raw?.socket?.remoteAddress || request.socket?.remoteAddress;
  const forwardedFor = request.headers["x-forwarded-for"];
  const forwardedIps = Array.isArray(forwardedFor) ? forwardedFor : [forwardedFor];

  if (isLoopbackIp(proxyPeerIp || request.ip)) {
    for (const header of forwardedIps) {
      if (typeof header !== "string") continue;

      for (const rawIp of header.split(",")) {
        const ip = normalizeIp(rawIp);
        if (isIP(ip)) return ip;
      }
    }
  }

  return request.ip;
}

export default async function (fastify) {
  fastify.addHook("onRequest", async (request, reply) => {
    fastify.log.info({ url: request.url }, "auth onRequest running");
    const clientIp = getClientIp(request);
    request.clientIp = clientIp;

    if (request.url.startsWith("/api/whitelist")) {
      if (
        clientIp !== "127.0.0.1" &&
        clientIp !== "::1" &&
        clientIp !== "::ffff:127.0.0.1"
      ) {
        return reply.code(403).send({ error: "Only accessible from localhost" });
      }
      return;
    }

    const { rows: countRows } = await fastify.pg.query(
      "SELECT COUNT(*)::int AS cnt FROM ip_whitelist"
    );

    if (countRows[0].cnt === 0) {
      // 1. Whitelist the exact IP as Admin (Tier 999)
      await fastify.pg.query(
        "INSERT INTO ip_whitelist (cidr_range, access_tier, description) VALUES ($1, 999, 'First-run auto-add (Admin)') ON CONFLICT DO NOTHING",
        [clientIp]
      );

      // 1b. Also whitelist the laptop's real host IPs as Admin just in case they initialized via 127.0.0.1
      const hostIps = getHostIps();
      for (const ip of hostIps) {
        await fastify.pg.query(
          "INSERT INTO ip_whitelist (cidr_range, access_tier, description) VALUES ($1, 999, 'Host Machine LAN IP (Admin)') ON CONFLICT DO NOTHING",
          [ip]
        );
      }

      // 2. Blanket whitelist common private networks as standard users (Tier 0)
      // This ensures any device on the home network can watch, but only
      // the laptop that initialized the server gets the Admin privileges.
      const privateSubnets = ["192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12"];
      for (const subnet of privateSubnets) {
        await fastify.pg.query(
          "INSERT INTO ip_whitelist (cidr_range, access_tier, description) VALUES ($1, 0, 'Home Network (Standard)') ON CONFLICT DO NOTHING",
          [subnet]
        );
      }

      request.accessTier = 999;
      request.accessDescription = "First-run auto-add (Admin)";
      request.firstRun = true;
      return;
    }

    // ORDER BY masklen DESC ensures an exact IP (masklen 32) overrides a subnet (masklen 16/8).
    const { rows } = await fastify.pg.query(
      "SELECT access_tier, description FROM ip_whitelist WHERE $1::inet <<= cidr_range ORDER BY masklen(cidr_range) DESC LIMIT 1",
      [clientIp]
    );

    if (rows.length === 0) {
      return reply.code(403).send({ error: "Access denied" });
    }

    request.accessTier = rows[0].access_tier;
    request.accessDescription = rows[0].description;
  });
}
