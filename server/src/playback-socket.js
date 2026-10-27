import { consumeSocketTicket, getExclusiveLease, readPlaybackSession, refreshExclusiveLease } from "./playback-session.js";
import { authorizeExclusiveReport, publicHolderWithPlayback, writeActivePlayback } from "./playback-live-state.js";
import { isUserSessionValid } from "./plugins/auth.js";

export const SOCKET_MAX_BYTES = 8192;
export const SOCKET_CLOSE = { malformed: 4400, unauthorized: 4401, rateLimited: 4408, slow: 4429 };
const VERSION = 1;

export function socketMediaType(session) {
  return typeof session?.mediaType === "string" ? session.mediaType : "";
}

export function parsePlaybackMessage(raw) {
  if (Buffer.byteLength(raw) > SOCKET_MAX_BYTES) throw new Error("Message too large");
  let value;
  try { value = JSON.parse(String(raw)); } catch { throw new Error("Invalid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== VERSION) throw new Error("Invalid protocol version");
  if (value.type === "auth" && typeof value.ticket === "string" && /^[A-Za-z0-9_-]{43}$/.test(value.ticket)) return value;
  if (value.type === "session.bind" && typeof value.sessionId === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(value.sessionId)) return value;
  if (value.type === "playback.state"
      && typeof value.sessionId === "string" && /^[A-Za-z0-9_-]{20,128}$/.test(value.sessionId)
      && Number.isSafeInteger(value.mediaId) && value.mediaId > 0
      && ["play", "pause", "end", "skip"].includes(value.action)
      && Number.isFinite(value.position) && value.position >= 0 && value.position <= 1e9
      && Number.isFinite(value.duration) && value.duration >= 0 && value.duration <= 1e9
      && ["none", "queue", "media"].includes(value.loopMode)
      && typeof value.shuffleEnabled === "boolean"
      && Number.isSafeInteger(value.sequence) && value.sequence >= 0) return value;
  throw new Error("Invalid message");
}

export function isAllowedSocketOrigin(request, allowedOrigins) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const scheme = request.headers["x-forwarded-proto"] === "https" ? "https" : request.protocol || "http";
  return allowedOrigins.has(origin) || origin === `${scheme}://${request.headers.host}`;
}

export function createPlaybackSocketHub(fastify, {
  allowedOrigins = new Set(),
  schedulePingInterval = setInterval,
  clearPingInterval = clearInterval,
} = {}) {
  const sockets = new Set();
  const timers = new Set();
  const counters = { connections: 0, authRejected: 0, reconnects: 0, protocolErrors: 0, slowConsumers: 0 };
  let revision = 0;
  let expiryTimer = null;
  let closed = false;

  const send = (entry, payload) => {
    if (entry.socket.readyState !== 1) return;
    if (entry.socket.bufferedAmount > 256 * 1024) {
      counters.slowConsumers += 1;
      entry.socket.close(SOCKET_CLOSE.slow, "Slow receiver");
      return;
    }
    if (entry.socket.bufferedAmount > 64 * 1024 && payload.type === "lease.state") {
      entry.pendingState = payload;
      return;
    }
    entry.socket.send(JSON.stringify(payload));
  };

  const stateFor = (entry, lease, holder) => {
    const leaseClientId = lease?.clientId || lease?.viewerId;
    const entryClientId = entry.identity.clientId || entry.identity.viewerId;
    const sameDevice = lease
      && lease.viewerId === entry.identity.viewerId
      && lease.clientIp === entry.identity.clientIp
      && leaseClientId === entryClientId;
    const currentOwner = sameDevice
      && (!entry.boundSessionId || entry.boundSessionId === lease.sessionId)
      && entry.revokedSessionId !== lease.sessionId;
    return {
      type: "lease.state", version: VERSION, revision,
      state: !lease ? "available" : currentOwner ? "owned" : "busy",
      expiresIn: lease?.expiresIn || 0,
      ...(holder ? { activeSession: holder } : {}),
    };
  };

  const sendStateFor = async (entry, lease) => {
    const holder = lease ? await publicHolderWithPlayback(fastify.redis, lease, lease.expiresIn) : null;
    send(entry, stateFor(entry, lease, holder));
  };

  const scheduleExpiry = async () => {
    if (expiryTimer) clearTimeout(expiryTimer);
    if (closed) return;
    const lease = await getExclusiveLease(fastify.redis);
    if (!lease) return;
    expiryTimer = setTimeout(async () => {
      try {
        const current = await getExclusiveLease(fastify.redis);
        if (!current) await notify();
        else await scheduleExpiry();
      } catch (error) { fastify.log.warn({ err: error }, "playback socket expiry check failed"); }
    }, Math.max(1000, lease.expiresIn * 1000 + 100));
    expiryTimer.unref?.();
  };

  const notify = async () => {
    if (closed) return;
    revision += 1;
    const lease = await getExclusiveLease(fastify.redis);
    const recipients = [...sockets];
    const holder = lease ? await publicHolderWithPlayback(fastify.redis, lease, lease.expiresIn) : null;
    for (const entry of recipients) {
      if (entry.boundSessionId && lease?.sessionId !== entry.boundSessionId) {
        const revokedSessionId = entry.boundSessionId;
        entry.revokedSessionId = entry.boundSessionId;
        entry.boundSessionId = null;
        entry.boundMediaType = "";
        entry.playing = false;
        send(entry, { type: "protocol.error", version: VERSION, code: "PLAYBACK_LEASE_LOST", sessionId: revokedSessionId, message: "Playback lease lost" });
      }
      send(entry, stateFor(entry, lease, holder));
    }
    await scheduleExpiry();
  };

  const handle = (socket, request) => {
    const entry = { socket, identity: null, boundSessionId: null, revokedSessionId: null, playing: false, sequence: -1, pong: true, messages: 0, windowAt: Date.now(), pendingState: null };
    const authTimeout = setTimeout(() => {
      if (!entry.identity) { counters.authRejected += 1; socket.close(SOCKET_CLOSE.unauthorized, "Authentication required"); }
    }, 5000);
    timers.add(authTimeout);
    const cleanup = () => {
      clearTimeout(authTimeout);
      timers.delete(authTimeout);
      clearPingInterval(pingTimer);
      timers.delete(pingTimer);
      sockets.delete(entry);
      if (entry.boundSessionId) scheduleExpiry().catch(() => {});
    };
    const pingTimer = schedulePingInterval(async () => {
      if (!entry.identity) return;
      if (!entry.pong) { socket.terminate(); return; }
      entry.pong = false;
      socket.ping();
      if (entry.pendingState && socket.bufferedAmount < 64 * 1024) {
        const pending = entry.pendingState;
        entry.pendingState = null;
        send(entry, pending);
      }
      if (entry.identity && fastify.pg?.query && entry.identity.userId) {
        try {
          const valid = await isUserSessionValid(fastify.pg, entry.identity.userId, entry.identity.sessionVersion);
          if (!valid) {
            const revokedSessionId = entry.boundSessionId;
            entry.boundSessionId = null;
            entry.boundMediaType = "";
            entry.playing = false;
            if (revokedSessionId) {
              send(entry, {
                type: "protocol.error",
                version: VERSION,
                code: "PLAYBACK_LEASE_LOST",
                sessionId: revokedSessionId,
                message: "Playback lease lost",
              });
            }
            socket.close(SOCKET_CLOSE.unauthorized, "Session revoked");
            if (revokedSessionId) await notify();
            return;
          }
        } catch (error) { fastify.log.warn({ err: error }, "playback socket session check failed"); }
      }
      // A connected, bound owner retains the lease during both play and pause.
      // Observers and unbound sockets never renew it.
      if (entry.boundSessionId) {
        try {
          const session = await readPlaybackSession(fastify.redis, entry.boundSessionId);
          if (!session || session.viewerId !== entry.identity.viewerId || session.clientIp !== entry.identity.clientIp) {
            entry.boundSessionId = null;
            entry.boundMediaType = "";
            entry.playing = false;
            await notify();
            return;
          }
          const result = await refreshExclusiveLease(fastify.redis, entry.identity.viewerId, entry.boundSessionId, entry.identity.clientIp);
          if (!result.refreshed) {
            entry.boundSessionId = null;
            entry.boundMediaType = "";
            entry.playing = false;
            await notify();
          } else await scheduleExpiry();
        } catch (error) { fastify.log.warn({ err: error }, "playback socket renewal failed"); }
      }
    }, 10000);
    pingTimer.unref?.();
    timers.add(pingTimer);
    socket.on("pong", () => { entry.pong = true; });
    socket.on("close", cleanup);
    socket.on("error", () => cleanup());
    let chain = Promise.resolve();
    socket.on("message", (raw) => {
      chain = chain.then(async () => {
        const now = Date.now();
        if (now - entry.windowAt > 1000) { entry.windowAt = now; entry.messages = 0; }
        if (++entry.messages > 30) { socket.close(SOCKET_CLOSE.rateLimited, "Rate limit"); return; }
        let message;
        try { message = parsePlaybackMessage(raw); }
        catch { counters.protocolErrors += 1; socket.close(SOCKET_CLOSE.malformed, "Invalid message"); return; }
        if (!entry.identity) {
          if (message.type !== "auth") { socket.close(SOCKET_CLOSE.unauthorized, "Authentication required"); return; }
          const identity = await consumeSocketTicket(fastify.redis, message.ticket, request.user);
          if (!identity) { counters.authRejected += 1; socket.close(SOCKET_CLOSE.unauthorized, "Invalid ticket"); return; }
          entry.identity = identity;
          clearTimeout(authTimeout);
          timers.delete(authTimeout);
          sockets.add(entry);
          counters.connections += 1;
          send(entry, { type: "socket.ready", version: VERSION });
          await sendStateFor(entry, await getExclusiveLease(fastify.redis));
          await scheduleExpiry();
          return;
        }
        if (message.type === "session.bind") {
          if (fastify.pg?.query && entry.identity.userId) {
            const valid = await isUserSessionValid(fastify.pg, entry.identity.userId, entry.identity.sessionVersion);
            if (!valid) {
              send(entry, { type: "protocol.error", version: VERSION, code: "PLAYBACK_NOT_OWNER", message: "Playback session is not the owner" });
              socket.close(SOCKET_CLOSE.unauthorized, "Session revoked");
              return;
            }
          }
          const session = await readPlaybackSession(fastify.redis, message.sessionId);
          const lease = await getExclusiveLease(fastify.redis);
          if (!session?.leaseRequired || session.viewerId !== entry.identity.viewerId
              || session.clientIp !== entry.identity.clientIp || session.accessTier !== entry.identity.accessTier
              || lease?.sessionId !== message.sessionId || lease.viewerId !== entry.identity.viewerId || lease.clientIp !== entry.identity.clientIp) {
            send(entry, { type: "protocol.error", version: VERSION, code: "PLAYBACK_NOT_OWNER", message: "Playback session is not the owner" });
            await sendStateFor(entry, lease);
            return;
          }
          entry.boundSessionId = message.sessionId;
          entry.boundMediaType = socketMediaType(session);
          entry.revokedSessionId = null;
          entry.sequence = -1;
          entry.playing = false;
          await sendStateFor(entry, lease);
          return;
        }
        if (message.type === "playback.state") {
          if (fastify.pg?.query && entry.identity.userId) {
            const valid = await isUserSessionValid(fastify.pg, entry.identity.userId, entry.identity.sessionVersion);
            if (!valid) {
              entry.boundSessionId = null;
              entry.boundMediaType = "";
              entry.playing = false;
              send(entry, { type: "protocol.error", version: VERSION, code: "PLAYBACK_NOT_OWNER", message: "Playback state rejected" });
              socket.close(SOCKET_CLOSE.unauthorized, "Session revoked");
              await notify();
              return;
            }
          }
          const identity = {
            ...entry.identity,
            sessionId: message.sessionId,
            mediaId: message.mediaId,
            mediaType: entry.boundMediaType,
          };
          const authorized = message.sessionId === entry.boundSessionId
            && await authorizeExclusiveReport(fastify.redis, identity);
          if (!authorized?.authorized || message.sequence < entry.sequence) {
            send(entry, { type: "protocol.error", version: VERSION, code: "PLAYBACK_NOT_OWNER", message: "Playback state rejected" });
            await sendStateFor(entry, await getExclusiveLease(fastify.redis));
            return;
          }
          entry.sequence = message.sequence;
          entry.playing = message.action === "play";
          await writeActivePlayback(fastify.redis, identity, message);
          await notify();
          return;
        }
        counters.protocolErrors += 1;
        socket.close(SOCKET_CLOSE.malformed, "Unexpected message");
      }).catch((error) => {
        fastify.log.warn({ err: error }, "playback socket message failed");
        socket.close(1011, "Server error");
      });
    });
  };

  const close = () => {
    closed = true;
    if (expiryTimer) clearTimeout(expiryTimer);
    for (const timer of timers) { clearTimeout(timer); clearInterval(timer); }
    timers.clear();
    for (const entry of sockets) entry.socket.close(1001, "Server shutdown");
    sockets.clear();
  };
  fastify.addHook("onClose", close);
  return { handle, notify, close, counters, allowedOrigins };
}
