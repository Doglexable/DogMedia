import { createHash } from "crypto";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { join } from "path";
import { getClientIp } from "../plugins/auth.js";
import { checkPublicMusicExchangeRate, createPublicMusicSession, readPublicMusicSession } from "../music-share-session.js";

const DATA_DIR = process.env.DATA_DIR || "data";
const VALID_TOKEN = /^[A-Za-z0-9_-]{40,60}$/;

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function parseByteRange(value, fileSize) {
  if (!value || !Number.isInteger(fileSize) || fileSize <= 0 || !/^bytes=[^,]+$/.test(value)) return null;
  const [rawStart, rawEnd] = value.slice(6).split("-");
  if (rawStart === "") {
    const length = Number.parseInt(rawEnd, 10);
    if (!Number.isInteger(length) || length <= 0) return null;
    return { start: Math.max(fileSize - length, 0), end: fileSize - 1 };
  }
  const start = Number.parseInt(rawStart, 10);
  const requestedEnd = rawEnd === "" ? fileSize - 1 : Number.parseInt(rawEnd, 10);
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start < 0 || start >= fileSize || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, fileSize - 1) };
}

function mediaHeaders(reply, { download = false } = {}) {
  reply.header("Content-Disposition", download ? 'attachment; filename="dogmedia-favorite-reel.mp4"' : "inline");
  reply.header("Cache-Control", "private, no-store, max-age=0");
  reply.header("Pragma", "no-cache");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Download-Options", "noopen");
}

const ACTIVE_REEL_SQL = `
  SELECT r.id, r.status, r.progress, r.output_path, r.duration_seconds,
         r.expires_at, r.last_error,
         COALESCE(json_agg(json_build_object(
           'position', i.position, 'title', i.title, 'artists', i.artists
         ) ORDER BY i.position) FILTER (WHERE i.reel_id IS NOT NULL), '[]') AS tracks
  FROM music_share_reels r
  LEFT JOIN music_share_reel_items i ON i.reel_id = r.id
  WHERE r.token_hash = $1 AND r.revoked_at IS NULL AND r.expires_at > NOW()
    AND r.created_at > NOW() - INTERVAL '1 day'
  GROUP BY r.id
`;

async function loadSessionReel(fastify, sessionId) {
  const session = await readPublicMusicSession(fastify.redis, sessionId);
  if (!session) return null;
  const { rows } = await fastify.pg.query(
    `SELECT output_path FROM music_share_reels
     WHERE id = $1 AND status = 'ready' AND revoked_at IS NULL AND expires_at > NOW()
       AND created_at > NOW() - INTERVAL '1 day'`,
    [session.shareId]
  );
  return rows[0] || null;
}

async function sendReelFile({ dataDir, fastify, request, reply, download = false }) {
  const reel = await loadSessionReel(fastify, request.params.sessionId);
  if (!reel) return reply.code(404).send({ error: "Shared music reel not found" });
  const filePath = join(dataDir, reel.output_path);
  let fileStats;
  try {
    fileStats = await stat(filePath);
  } catch {
    return reply.code(404).send({ error: "Shared music reel not found" });
  }
  mediaHeaders(reply, { download });
  reply.header("Accept-Ranges", "bytes");
  reply.type("video/mp4");
  if (request.headers.range) {
    const range = parseByteRange(request.headers.range, fileStats.size);
    if (!range) {
      reply.header("Content-Range", `bytes */${fileStats.size}`);
      return reply.code(416).send();
    }
    reply.code(206);
    reply.header("Content-Range", `bytes ${range.start}-${range.end}/${fileStats.size}`);
    reply.header("Content-Length", range.end - range.start + 1);
    return reply.send(createReadStream(filePath, range));
  }
  reply.header("Content-Length", fileStats.size);
  return reply.send(createReadStream(filePath));
}

export default async function (fastify, options = {}) {
  const dataDir = options.dataDir || DATA_DIR;

  fastify.post("/music/session", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store, max-age=0");
    reply.header("Referrer-Policy", "no-referrer");
    const clientIp = getClientIp(request);
    const token = String(request.body?.token || "");
    if (!VALID_TOKEN.test(token)) {
      if (!await checkPublicMusicExchangeRate(fastify.redis, clientIp)) {
        return reply.code(429).send({ error: "Too many link attempts. Try again in a minute." });
      }
      return reply.code(404).send({ error: "Shared music reel not found" });
    }
    const { rows } = await fastify.pg.query(ACTIVE_REEL_SQL, [hashToken(token)]);
    const reel = rows[0];
    if (!reel) {
      if (!await checkPublicMusicExchangeRate(fastify.redis, clientIp)) {
        return reply.code(429).send({ error: "Too many link attempts. Try again in a minute." });
      }
      return reply.code(404).send({ error: "Shared music reel not found" });
    }

    const base = {
      status: reel.status,
      progress: Number(reel.progress || 0),
      tracks: reel.tracks,
      duration: Number(reel.duration_seconds || (reel.tracks.length * 10)),
      shareExpiresAt: reel.expires_at,
    };
    if (reel.status !== "ready" || !reel.output_path) {
      return reply.code(reel.status === "failed" ? 500 : 202).send({
        ...base,
        error: reel.status === "failed" ? "This reel could not be prepared" : undefined,
      });
    }

    const created = await createPublicMusicSession(fastify.redis, { shareId: reel.id });
    const sessionBase = `/api/public/music/session/${created.sessionId}`;
    return {
      ...base,
      streamUrl: `${sessionBase}/stream`,
      downloadUrl: `${sessionBase}/download`,
      sessionExpiresAt: new Date(created.session.expiresAt).toISOString(),
    };
  });

  fastify.get("/music/session/:sessionId/stream", async (request, reply) => {
    return sendReelFile({ dataDir, fastify, request, reply });
  });

  fastify.get("/music/session/:sessionId/download", async (request, reply) => {
    return sendReelFile({ dataDir, fastify, request, reply, download: true });
  });
}
