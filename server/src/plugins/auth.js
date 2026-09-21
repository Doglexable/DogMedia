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

function getLastValidHeaderIp(value) {
  const headers = Array.isArray(value) ? value : [value];

  for (let i = headers.length - 1; i >= 0; i--) {
    const header = headers[i];
    if (typeof header !== "string") continue;

    const parts = header.split(",");
    for (let j = parts.length - 1; j >= 0; j--) {
      const ip = normalizeIp(parts[j]);
      if (isIP(ip)) return ip;
    }
  }

  return null;
}

export function getClientIp(request) {
  const proxyPeerIp = request.raw?.socket?.remoteAddress || request.socket?.remoteAddress;

  if (isLoopbackIp(proxyPeerIp || request.ip)) {
    const forwardedIp =
      getLastValidHeaderIp(request.headers?.["x-forwarded-for"]) ||
      getLastValidHeaderIp(request.headers?.["x-real-ip"]);
    if (forwardedIp) {
      return forwardedIp;
    }
  }

  return normalizeIp(request.ip || proxyPeerIp || "");
}

export default async function (fastify) {
  const cacheTtlMs = 60_000;
  const cacheLimit = 1_024;
  const accessCache = new Map();
  let whitelistEmpty = false;
  let firstRunPromise = null;

  try {
    const { rows } = await fastify.pg.query("SELECT COUNT(*)::int AS cnt FROM ip_whitelist");
    whitelistEmpty = rows[0].cnt === 0;
  } catch (err) {
    fastify.log.warn(err, "could not initialize whitelist state");
  }

  const clearAuthCache = () => accessCache.clear();
  if (!fastify.hasDecorator("clearAuthCache")) {
    fastify.decorate("clearAuthCache", clearAuthCache);
  }

  function cacheAccess(ip, value) {
    if (accessCache.size >= cacheLimit) {
      accessCache.delete(accessCache.keys().next().value);
    }
    accessCache.set(ip, { expiresAt: Date.now() + cacheTtlMs, value });
  }

  function cachedAccess(ip) {
    const cached = accessCache.get(ip);
    if (!cached) return undefined;
    if (cached.expiresAt <= Date.now()) {
      accessCache.delete(ip);
      return undefined;
    }
    // Refresh insertion order so the size bound behaves like a small LRU.
    accessCache.delete(ip);
    accessCache.set(ip, cached);
    return cached.value;
  }

  async function initializeWhitelist(clientIp) {
    if (!firstRunPromise) {
      firstRunPromise = (async () => {
        await fastify.pg.query(
          "INSERT INTO ip_whitelist (cidr_range, access_tier, description) VALUES ($1, 999, 'First-run auto-add (Admin)') ON CONFLICT DO NOTHING",
          [clientIp]
        );

        const hostIps = getHostIps();
        for (const ip of hostIps) {
          await fastify.pg.query(
            "INSERT INTO ip_whitelist (cidr_range, access_tier, description) VALUES ($1, 999, 'Host Machine LAN IP (Admin)') ON CONFLICT DO NOTHING",
            [ip]
          );
        }

        const privateSubnets = ["192.168.0.0/16", "10.0.0.0/8", "172.16.0.0/12"];
        for (const subnet of privateSubnets) {
          await fastify.pg.query(
            "INSERT INTO ip_whitelist (cidr_range, access_tier, description) VALUES ($1, 0, 'Home Network (Standard)') ON CONFLICT DO NOTHING",
            [subnet]
          );
        }
        whitelistEmpty = false;
        clearAuthCache();
      })().finally(() => {
        firstRunPromise = null;
      });
    }
    await firstRunPromise;
  }

  fastify.addHook("onRequest", async (request, reply) => {
    const clientIp = getClientIp(request);
    request.clientIp = clientIp;

    const rawPath = request.url.split("?")[0];
    let normalizedPath;
    try {
      normalizedPath = decodeURIComponent(rawPath);
    } catch {
      normalizedPath = rawPath;
    }

    if (normalizedPath === "/api/whitelist" || normalizedPath.startsWith("/api/whitelist/")) {
      if (
        clientIp !== "127.0.0.1" &&
        clientIp !== "::1" &&
        clientIp !== "::ffff:127.0.0.1"
      ) {
        return reply.code(403).send({ error: "Only accessible from localhost" });
      }
      return;
    }

    if (whitelistEmpty) {
      const initializedByThisRequest = firstRunPromise === null;
      await initializeWhitelist(clientIp);
      if (initializedByThisRequest) {
        request.accessTier = 999;
        request.accessDescription = "First-run auto-add (Admin)";
        request.firstRun = true;
        return;
      }
    }

    const cached = cachedAccess(clientIp);
    if (cached !== undefined) {
      fastify.log.debug({ clientIp }, "auth cache hit");
      if (cached === null) return reply.code(403).send({ error: "Access denied" });
      request.accessTier = cached.accessTier;
      request.accessDescription = cached.description;
      return;
    }
    fastify.log.debug({ clientIp }, "auth cache miss");

    // ORDER BY masklen DESC ensures an exact IP (masklen 32) overrides a subnet (masklen 16/8).
    const { rows } = await fastify.pg.query(
      "SELECT access_tier, description FROM ip_whitelist WHERE $1::inet <<= cidr_range ORDER BY masklen(cidr_range) DESC LIMIT 1",
      [clientIp]
    );

    if (rows.length === 0) {
      cacheAccess(clientIp, null);
      return reply.code(403).send({ error: "Access denied" });
    }

    request.accessTier = rows[0].access_tier;
    request.accessDescription = rows[0].description;
    cacheAccess(clientIp, {
      accessTier: rows[0].access_tier,
      description: rows[0].description,
    });
  });
}
