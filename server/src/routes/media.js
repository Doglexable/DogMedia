import { createReadStream, createWriteStream } from "fs";
import { mkdir, open, readFile, rename, rm, stat, unlink, utimes, writeFile } from "fs/promises";
import { join } from "path";
import { pipeline } from "stream/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { LyricsValidationError, normalizeWhisperLyrics, upsertUploadedLyrics } from "../lyrics.js";
import { normalizeCategoryCover, normalizeMediaCover, sendCoverFile } from "../category-cover.js";
import { retryFailedEncoding } from "../encoding-queue.js";
import { enqueueMediaFinalization } from "../media-finalization-queue.js";
import { withActiveUpload } from "../upload-cleanup.js";
import {
  enqueueUploadCompletion,
  UPLOAD_COMPLETION_STATUS_PREFIX,
  uploadCompletionStatusKey,
} from "../upload-completion-queue.js";
import { ENCODED_QUALITIES, normalizeRequestedQuality, selectActualQuality } from "../media-quality.js";
import {
  acquireExclusiveLease,
  createPlaybackSession,
  readPlaybackSessionId,
  readViewerId,
  refreshExclusiveLease,
  requiresExclusiveLease,
  resolveViewerId,
  revokePlaybackSession,
  setPlaybackSessionCookie,
  setViewerCookie,
  validatePlaybackSession,
} from "../playback-session.js";

const execFileAsync = promisify(execFile);
const DATA_DIR = process.env.DATA_DIR || "data";
const UPLOAD_TMP_DIR = process.env.UPLOAD_TMP_DIR || join(DATA_DIR, "tmp");
const CHUNK_SIZE = 4 * 1024 * 1024;
const CHUNK_UPLOAD_DIR = join(UPLOAD_TMP_DIR, "chunked");
const ORIGINAL_QUALITY_MIN_TIER = Number.parseInt(process.env.MEDIA_ORIGINAL_MIN_TIER || "100", 10);
const ACCESSIBLE_CATEGORY_TREE_SQL = `
  WITH RECURSIVE accessible_categories AS (
    SELECT
      c.id,
      c.parent_id,
      c.min_access_tier,
      c.name,
      c.cover_path,
      ARRAY[c.name::text]::text[] AS path_parts,
      ARRAY[COALESCE(c.sort_order, 0)]::integer[] AS order_parts
    FROM categories c
    WHERE c.parent_id IS NULL
      AND c.min_access_tier <= $1
    UNION ALL
    SELECT
      c.id,
      c.parent_id,
      c.min_access_tier,
      c.name,
      c.cover_path,
      ac.path_parts || c.name::text,
      ac.order_parts || COALESCE(c.sort_order, 0)
    FROM categories c
    JOIN accessible_categories ac ON c.parent_id = ac.id
    WHERE c.min_access_tier <= $1
  )
`;
const MEDIA_ENCODING_FIELDS = `
  ARRAY(
    SELECT requested.quality
    FROM unnest(ARRAY['low','med','high']::text[]) WITH ORDINALITY requested(quality, position)
    WHERE EXISTS (
      SELECT 1 FROM media_encoding_variants variant
      WHERE variant.media_id = m.id AND variant.source_version = m.source_version
        AND variant.quality = requested.quality AND variant.status = 'ready'
    )
    ORDER BY requested.position
  ) || CASE
    WHEN split_part(m.mime_type, '/', 1) = 'image' OR $1 >= ${ORIGINAL_QUALITY_MIN_TIER} THEN ARRAY['ori']::text[]
    ELSE ARRAY[]::text[]
  END AS available_qualities,
  COALESCE((
    SELECT jsonb_object_agg(variant.quality, jsonb_build_object(
      'status', variant.status, 'attempts', variant.attempts, 'error', variant.last_error,
      'bitrate', variant.bitrate, 'width', variant.width, 'height', variant.height,
      'progress', variant.progress_percent
    ))
    FROM media_encoding_variants variant
    WHERE variant.media_id = m.id AND variant.source_version = m.source_version
  ), '{}'::jsonb) AS encoding_status
`;

function mimeFromExt(filePath) {
  const ext = filePath.split(".").pop().toLowerCase();
  const map = {
    mp4: "video/mp4",
    m4a: "audio/mp4",
    aac: "audio/aac",
    webm: "video/webm",
    mov: "video/quicktime",
    avi: "video/x-msvideo",
    mkv: "video/x-matroska",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    opus: "audio/opus",
    flac: "audio/flac",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  };
  return map[ext] || "application/octet-stream";
}

function extFromFilename(filename, fallback = "bin") {
  const parts = String(filename || "").split(".");
  return (parts.length > 1 ? parts.pop() : fallback).toLowerCase();
}

function applyNoDownloadHeaders(reply, { etag = null } = {}) {
  reply.header("Content-Disposition", "inline");
  if (etag) reply.header("ETag", etag);
  reply.header("Cache-Control", "private, no-store, max-age=0");
  reply.header("Pragma", "no-cache");
  reply.header("Expires", "0");
  reply.header("Cross-Origin-Resource-Policy", "same-origin");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Download-Options", "noopen");
}

export function parseByteRange(value, fileSize) {
  if (!value || !Number.isInteger(fileSize) || fileSize <= 0 || !/^bytes=[^,]+$/.test(value)) return null;
  const [rawStart, rawEnd] = value.slice(6).split("-");
  if (rawStart === "") {
    const suffixLength = Number.parseInt(rawEnd, 10);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(fileSize - suffixLength, 0), end: fileSize - 1 };
  }
  const start = Number.parseInt(rawStart, 10);
  const requestedEnd = rawEnd === "" ? fileSize - 1 : Number.parseInt(rawEnd, 10);
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start < 0 || start >= fileSize || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, fileSize - 1) };
}

function encodeBrowseCursor(row) {
  return Buffer.from(JSON.stringify({
    categoryOrder: Array.isArray(row.category_order) ? row.category_order.map(Number) : [],
    categoryId: Number(row.category_id),
    trackNull: row.track_order == null ? 1 : 0,
    trackOrder: row.track_order == null ? 0 : Number(row.track_order),
    id: Number(row.id),
  })).toString("base64url");
}

export function decodeBrowseCursor(value) {
  if (!value || typeof value !== "string" || value.length > 2_048) return null;
  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!Array.isArray(cursor.categoryOrder)
      || cursor.categoryOrder.length === 0
      || cursor.categoryOrder.some((part) => !Number.isInteger(part))
      || !Number.isInteger(cursor.categoryId) || cursor.categoryId < 1
      || ![0, 1].includes(cursor.trackNull)
      || !Number.isInteger(cursor.trackOrder)
      || !Number.isInteger(cursor.id) || cursor.id < 1) return null;
    return cursor;
  } catch {
    return null;
  }
}

export async function probeDuration(filePath, log) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const duration = Number.parseFloat(stdout.trim());
    return Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null;
  } catch (err) {
    log.warn(err, "ffprobe duration detection failed");
    return null;
  }
}

function normalizeOptionalText(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeContentKind(value, mimeType) {
  const normalized = normalizeOptionalText(value);
  if (mimeType?.startsWith("audio/")) return "music";
  if (mimeType?.startsWith("video/")) {
    return ["video_episode", "film", "video"].includes(normalized) ? normalized : "video";
  }
  if (mimeType?.startsWith("image/")) return "image";
  return null;
}

export function parseTrackOrder(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 1 ? value : null;
  }
  if (typeof value !== "string") return null;

  const match = value.trim().match(/^(\d+)(?:\s*\/\s*\d+)?$/);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

function hasTrackOrderValue(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function firstMetadataValue(tags, keys) {
  if (!tags || typeof tags !== "object") return null;

  for (const key of keys) {
    const match = Object.entries(tags).find(([tagKey]) => tagKey.toLowerCase() === key.toLowerCase());
    const value = normalizeOptionalText(match?.[1]);
    if (value) return value;
  }

  return null;
}

export function mediaMetadataFromTags(tags) {
  return {
    artists: firstMetadataValue(tags, ["artist", "album_artist", "artists", "composer", "performer"]),
    trackOrder: parseTrackOrder(firstMetadataValue(tags, ["track", "tracknumber", "track_number"])),
  };
}

export function resolveTrackOrder(providedValue, detectedValue) {
  return parseTrackOrder(providedValue) ?? parseTrackOrder(detectedValue) ?? null;
}

export async function probeMediaTags(filePath, log) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format_tags",
      "-of", "json",
      filePath,
    ]);
    const parsed = JSON.parse(stdout || "{}");
    const tags = parsed?.format?.tags || {};

    return mediaMetadataFromTags(tags);
  } catch (err) {
    log.warn(err, "ffprobe metadata detection failed");
    return { probeFailed: true };
  }
}

async function savePartToTemp(part) {
  const uploadDir = join(UPLOAD_TMP_DIR, "multipart");
  await mkdir(uploadDir, { recursive: true });
  const tempPath = join(uploadDir, `${Date.now()}-${randomUUID()}`);
  await pipeline(part.file, createWriteStream(tempPath));
  return {
    tempPath,
    filename: part.filename,
  };
}

async function cleanupUploads(...uploads) {
  await Promise.all(uploads.filter(Boolean).map((upload) => unlink(upload.tempPath).catch(() => {})));
}

function uploadSessionDir(uploadId) {
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) {
    return null;
  }
  return join(CHUNK_UPLOAD_DIR, uploadId);
}

function chunkPath(uploadDir, kind, index) {
  return join(uploadDir, `${kind}-${index}.part`);
}

async function saveJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value), "utf8");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function assembleChunks({ uploadDir, kind, filename, totalChunks }) {
  const assembledPath = join(uploadDir, `${kind}-assembled`);
  const handle = await open(assembledPath, "w");

  try {
    for (let index = 0; index < totalChunks; index += 1) {
      const partPath = chunkPath(uploadDir, kind, index);
      await stat(partPath);
      await handle.writeFile(createReadStream(partPath));
    }
  } finally {
    await handle.close();
  }

  return {
    tempPath: assembledPath,
    filename,
  };
}

async function persistMediaUpload({ fastify, request, reply, fields, lyrics = null, mainFileUpload, thumbUpload }) {
  if (!mainFileUpload) {
    await cleanupUploads(thumbUpload);
    return reply.code(400).send({ error: "File required" });
  }
  if (!fields.category_id || !fields.title) {
    await cleanupUploads(mainFileUpload, thumbUpload);
    return reply.code(400).send({ error: "Category and title required" });
  }
  if (hasTrackOrderValue(fields.track_order) && parseTrackOrder(fields.track_order) === null) {
    await cleanupUploads(mainFileUpload, thumbUpload);
    return reply.code(400).send({ error: "Track order must be a positive integer" });
  }

  const { rows: categoryRows } = await fastify.pg.query(
    "SELECT id, parent_id, cover_path FROM categories WHERE id = $1",
    [fields.category_id]
  );
  if (categoryRows.length === 0) {
    await cleanupUploads(mainFileUpload, thumbUpload);
    return reply.code(400).send({ error: "Category not found" });
  }

  const categoryDir = join(DATA_DIR, String(fields.category_id));
  await mkdir(categoryDir, { recursive: true });

  const ext = extFromFilename(mainFileUpload.filename);
  const parsedDuration = fields.duration ? Number(fields.duration) : null;
  const durationObj = Number.isFinite(parsedDuration) && parsedDuration >= 0 ? Math.floor(parsedDuration) : null;
  const providedArtists = normalizeOptionalText(fields.artists);
  const providedTrackOrder = parseTrackOrder(fields.track_order);

  const { rows } = await fastify.pg.query(
    "INSERT INTO media_assets (category_id, title, description, file_path, duration, mime_type, artists, track_order) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
    [fields.category_id, fields.title, fields.description || "", "", durationObj, null, providedArtists, providedTrackOrder]
  );

  const mediaId = rows[0].id;
  const storedName = `${mediaId}.${ext}`;
  const filePath = join(categoryDir, storedName);

  await pipeline(createReadStream(mainFileUpload.tempPath), createWriteStream(filePath));
  await unlink(mainFileUpload.tempPath).catch(() => {});
  const mimeType = mimeFromExt(filePath);
  const artists = providedArtists;
  const trackOrder = providedTrackOrder;
  const contentKind = normalizeContentKind(fields.content_kind, mimeType);

  let coverPath = categoryRows[0].cover_path;
  let thumbnailPath = null;
  if (thumbUpload && (mimeType.startsWith("video/") || mimeType.startsWith("image/"))) {
    try {
      thumbnailPath = await normalizeMediaCover({
        categoryId: fields.category_id,
        mediaId,
        dataDir: DATA_DIR,
        inputPath: thumbUpload.tempPath,
      });
    } catch (err) {
      request.log.debug({ err }, "uploaded media did not provide a usable item cover");
    }
  } else if (thumbUpload && !coverPath) {
    try {
      coverPath = await normalizeCategoryCover({
        categoryId: fields.category_id,
        dataDir: DATA_DIR,
        inputPath: thumbUpload.tempPath,
      });
      await fastify.pg.query("UPDATE categories SET cover_path = $1 WHERE id = $2 AND cover_path IS NULL", [coverPath, fields.category_id]);
    } catch (err) {
      request.log.debug({ err }, "uploaded media did not provide a usable category cover");
    }
  }
  await cleanupUploads(thumbUpload);

  const { rows: updated } = await fastify.pg.query(
    "UPDATE media_assets SET file_path = $1, mime_type = $2, duration = $3, artists = $4, track_order = $5, thumbnail_path = $6, content_kind = $7 WHERE id = $8 RETURNING *",
    [`${fields.category_id}/${storedName}`, mimeType, durationObj, artists, trackOrder, thumbnailPath, contentKind, mediaId]
  );

  if (lyrics) {
    await upsertUploadedLyrics(fastify.pg, mediaId, lyrics);
  }

  await enqueueMediaFinalization({ redis: fastify.redis, mediaId, sourceVersion: updated[0].source_version });

  return reply.code(201).send({ ...updated[0], has_lyrics: Boolean(lyrics) });
}

export async function replaceMediaFiles({
  fastify,
  reply,
  mediaId,
  lyrics,
  mainFileUpload = null,
  thumbUpload = null,
  dataDir = DATA_DIR,
  normalizeCover = normalizeMediaCover,
}) {
  if (!mainFileUpload && !thumbUpload && lyrics === undefined) {
    return reply.code(400).send({ error: "Choose a replacement file, thumbnail, or lyrics file" });
  }

  const { rows } = await fastify.pg.query("SELECT * FROM media_assets WHERE id = $1", [mediaId]);
  if (rows.length === 0) {
    await cleanupUploads(mainFileUpload, thumbUpload);
    return reply.code(404).send({ error: "Not found" });
  }

  const existing = rows[0];
  const replacementMimeType = mainFileUpload ? mimeFromExt(mainFileUpload.filename) : existing.mime_type;
  if (thumbUpload && !replacementMimeType?.startsWith("video/") && !replacementMimeType?.startsWith("image/")) {
    await cleanupUploads(mainFileUpload, thumbUpload);
    return reply.code(400).send({ error: "Replace shared artwork through the category thumbnail endpoint" });
  }
  const categoryDir = join(dataDir, String(existing.category_id));
  await mkdir(categoryDir, { recursive: true });

  let nextFilePath = existing.file_path;
  let nextMimeType = existing.mime_type;
  let nextDuration = existing.duration;
  let nextArtists = existing.artists;
  let nextThumbnailPath = existing.thumbnail_path;

  if (mainFileUpload) {
    const ext = extFromFilename(mainFileUpload.filename);
    const storedName = `${mediaId}.${ext}`;
    const absoluteFilePath = join(categoryDir, storedName);
    const previousFilePath = join(dataDir, existing.file_path);

    await pipeline(createReadStream(mainFileUpload.tempPath), createWriteStream(absoluteFilePath));
    await unlink(mainFileUpload.tempPath).catch(() => {});
    if (previousFilePath !== absoluteFilePath) await unlink(previousFilePath).catch(() => {});

    nextFilePath = `${existing.category_id}/${storedName}`;
    nextMimeType = mimeFromExt(absoluteFilePath);
    nextDuration = null;

    await rm(join(categoryDir, String(mediaId)), { recursive: true, force: true }).catch(() => {});
    nextThumbnailPath = null;
  }

  if (thumbUpload) {
    nextThumbnailPath = await normalizeCover({
      categoryId: existing.category_id,
      mediaId,
      dataDir,
      inputPath: thumbUpload.tempPath,
    });
  }

  if (lyrics !== undefined) {
    if (lyrics === null) {
      await fastify.pg.query("DELETE FROM media_lyrics WHERE media_id = $1", [mediaId]);
    } else {
      await upsertUploadedLyrics(fastify.pg, mediaId, lyrics);
    }
  }

  const { rows: updatedRows } = await fastify.pg.query(
    `UPDATE media_assets
     SET file_path = $1,
         mime_type = $2,
         duration = CASE WHEN $7 THEN $3 ELSE COALESCE($3, duration) END,
         artists = $4,
         content_kind = $5,
         source_version = source_version + CASE WHEN $7 THEN 1 ELSE 0 END,
         thumbnail_path = $8
     WHERE id = $6
     RETURNING *`,
    [nextFilePath, nextMimeType, nextDuration, normalizeOptionalText(nextArtists), normalizeContentKind(existing.content_kind, nextMimeType), mediaId, Boolean(mainFileUpload), nextThumbnailPath]
  );

  if (mainFileUpload) {
    await fastify.pg.query("DELETE FROM media_encoding_variants WHERE media_id = $1 AND source_version <> $2", [mediaId, updatedRows[0].source_version]);
    await enqueueMediaFinalization({ redis: fastify.redis, mediaId, sourceVersion: updatedRows[0].source_version });
  }

  if (thumbUpload && existing.thumbnail_path && existing.thumbnail_path !== nextThumbnailPath) {
    await unlink(join(dataDir, existing.thumbnail_path)).catch(() => {});
  }
  await cleanupUploads(thumbUpload);

  return reply.send({
    ...updatedRows[0],
    artwork_version: updatedRows[0].thumbnail_path,
    has_lyrics: lyrics === undefined ? undefined : lyrics !== null,
  });
}

function captureReply() {
  let statusCode = 200;
  return {
    code(value) {
      statusCode = value;
      return this;
    },
    send(body) {
      return { body, statusCode };
    },
  };
}

export async function processChunkedMediaUpload({ fastify, log, uploadId }) {
  const uploadDir = uploadSessionDir(uploadId);
  if (!uploadDir) throw new Error("Invalid upload id");

  const manifest = await readJson(join(uploadDir, "manifest.json"));
  try {
    const mainFileUpload = manifest.file
      ? await assembleChunks({
          uploadDir,
          kind: "file",
          filename: manifest.file.name,
          totalChunks: manifest.file.totalChunks,
        })
      : null;
    const thumbUpload = manifest.thumbnail
      ? await assembleChunks({
          uploadDir,
          kind: "thumbnail",
          filename: manifest.thumbnail.name,
          totalChunks: manifest.thumbnail.totalChunks,
        })
      : null;
    const reply = captureReply();
    const request = { log };
    const result = manifest.replaceMediaId
      ? await replaceMediaFiles({
          fastify,
          reply,
          mediaId: manifest.replaceMediaId,
          lyrics: manifest.lyrics,
          mainFileUpload,
          thumbUpload,
        })
      : await persistMediaUpload({
          fastify,
          request,
          reply,
          fields: manifest.fields,
          lyrics: manifest.lyrics,
          mainFileUpload,
          thumbUpload,
        });
    if (result.statusCode >= 400) throw new Error(result.body?.error || "Upload completion failed");
    return result.body;
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
}

export default async function (fastify, options = {}) {
  const scanMediaTags = options.probeMediaTags || probeMediaTags;
  const dataDir = options.dataDir || DATA_DIR;
  fastify.get("/", async (request) => {
    const { category_id } = request.query;
    let query = `
      ${ACCESSIBLE_CATEGORY_TREE_SQL}
      SELECT
        m.*,
        ${MEDIA_ENCODING_FIELDS},
        ac.name AS category_name,
        COALESCE(m.thumbnail_path, ac.cover_path) AS artwork_version,
        array_to_string(ac.path_parts, ' / ') AS category_path
      FROM media_assets m
      JOIN accessible_categories ac ON ac.id = m.category_id
      WHERE 1 = 1
    `;
    const params = [request.accessTier];

    const rawType = request.query?.type != null ? String(request.query.type).toLowerCase().trim() : "";
    const type = ["audio", "music", "video", "photo", "image"].includes(rawType) ? rawType : "all";

    if (category_id) {
      query += " AND m.category_id = $2";
      params.push(category_id);
    }
    if (type === "audio" || type === "music") {
      query += " AND m.mime_type LIKE 'audio/%'";
    } else if (type === "video") {
      query += " AND m.mime_type LIKE 'video/%'";
    } else if (type === "photo" || type === "image") {
      query += " AND m.mime_type LIKE 'image/%'";
    }
    query += ` ORDER BY ac.order_parts,
                        ac.id,
                        (m.track_order IS NULL)::int,
                        COALESCE(m.track_order, 0),
                        m.id`;

    const { rows } = await fastify.pg.query(query, params);
    return rows;
  });

  fastify.get("/browse", async (request, reply) => {
    const parsedLimit = Number.parseInt(request.query?.limit ?? "50", 10);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      return reply.code(400).send({ error: "limit must be between 1 and 100" });
    }
    const view = request.query?.view === "liked" ? "liked" : "all";
    const categoryId = request.query?.category_id == null
      ? null
      : Number.parseInt(request.query.category_id, 10);
    if (request.query?.category_id != null && (!Number.isInteger(categoryId) || categoryId < 1)) {
      return reply.code(400).send({ error: "Invalid category_id" });
    }
    const search = String(request.query?.q || "").trim().slice(0, 200);
    const cursor = request.query?.cursor ? decodeBrowseCursor(request.query.cursor) : null;
    if (request.query?.cursor && !cursor) {
      return reply.code(400).send({ error: "Invalid cursor" });
    }
    const rawType = request.query?.type != null ? String(request.query.type).toLowerCase().trim() : "";
    if (rawType && !["all", "audio", "music", "video", "photo", "image"].includes(rawType)) {
      return reply.code(400).send({ error: "Invalid type filter" });
    }
    const type = ["audio", "music", "video", "photo", "image"].includes(rawType) ? rawType : "all";

    const params = [request.accessTier, request.clientIp || request.ip];
    const clauses = [];
    if (categoryId !== null) {
      params.push(categoryId);
      clauses.push(`m.category_id = $${params.length}`);
    }
    if (view === "liked") {
      clauses.push("lm.media_id IS NOT NULL");
    }
    if (type === "audio" || type === "music") {
      clauses.push("m.mime_type LIKE 'audio/%'");
    } else if (type === "video") {
      clauses.push("m.mime_type LIKE 'video/%'");
    } else if (type === "photo" || type === "image") {
      clauses.push("m.mime_type LIKE 'image/%'");
    }
    if (search) {
      const escapedSearch = search.replace(/[\\%_]/g, "\\$&");
      params.push(`%${escapedSearch}%`);
      clauses.push(`lower(coalesce(m.title, '') || ' ' || coalesce(m.artists, '') || ' '
        || coalesce(m.description, '') || ' ' || ac.name) LIKE lower($${params.length}) ESCAPE '\\'`);
    }
    if (cursor) {
      const cursorStart = params.length + 1;
      params.push(cursor.categoryOrder, cursor.categoryId, cursor.trackNull, cursor.trackOrder, cursor.id);
      clauses.push(`(
        ac.order_parts,
        ac.id,
        (m.track_order IS NULL)::int,
        COALESCE(m.track_order, 0),
        m.id
      ) > ($${cursorStart}::integer[], $${cursorStart + 1}, $${cursorStart + 2}, $${cursorStart + 3}, $${cursorStart + 4})`);
    }
    params.push(parsedLimit + 1);
    const { rows } = await fastify.pg.query(
      `${ACCESSIBLE_CATEGORY_TREE_SQL}
       SELECT m.*, ${MEDIA_ENCODING_FIELDS}, ac.name AS category_name,
              COALESCE(m.thumbnail_path, ac.cover_path) AS artwork_version,
              array_to_string(ac.path_parts, ' / ') AS category_path,
              ac.order_parts AS category_order,
              (lm.media_id IS NOT NULL) AS liked
       FROM media_assets m
       JOIN accessible_categories ac ON ac.id = m.category_id
       LEFT JOIN liked_music lm
         ON lm.media_id = m.id AND lm.client_ip = $2::inet
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY ac.order_parts,
                ac.id,
                (m.track_order IS NULL)::int,
                COALESCE(m.track_order, 0),
                m.id
       LIMIT $${params.length}`,
      params
    );
    const hasMore = rows.length > parsedLimit;
    const items = rows.slice(0, parsedLimit);
    return {
      items,
      nextCursor: hasMore && items.length ? encodeBrowseCursor(items.at(-1)) : null,
    };
  });

  fastify.get("/:id", async (request, reply) => {
    const { id } = request.params;
    const { rows } = await fastify.pg.query(
      `${ACCESSIBLE_CATEGORY_TREE_SQL}
       SELECT
         m.*,
         ${MEDIA_ENCODING_FIELDS},
         ac.name AS category_name,
         COALESCE(m.thumbnail_path, ac.cover_path) AS artwork_version,
         array_to_string(ac.path_parts, ' / ') AS category_path
       FROM media_assets m
       JOIN accessible_categories ac ON ac.id = m.category_id
       WHERE m.id = $2`,
      [request.accessTier, id]
    );
    if (rows.length === 0) {
      return reply.code(404).send({ error: "Not found" });
    }
    return rows[0];
  });

  fastify.post("/", async (request, reply) => {
    if (request.accessTier < 100) {
      return reply.code(403).send({ error: "Insufficient tier" });
    }

    const fields = {};
    let mainFileUpload = null;
    let thumbUpload = null;
    let lyricsUpload = null;

    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (part.fieldname === "file") {
          if (mainFileUpload) await unlink(mainFileUpload.tempPath).catch(() => {});
          mainFileUpload = await savePartToTemp(part);
        } else if (part.fieldname === "thumbnail") {
          if (thumbUpload) await unlink(thumbUpload.tempPath).catch(() => {});
          thumbUpload = await savePartToTemp(part);
        } else if (part.fieldname === "lyrics") {
          if (lyricsUpload) await unlink(lyricsUpload.tempPath).catch(() => {});
          lyricsUpload = await savePartToTemp(part);
        } else {
          // Unrecognized file, just consume to avoid hanging
          part.file.resume();
        }
      } else {
        fields[part.fieldname] = part.value;
      }
    }

    let lyrics = null;
    if (lyricsUpload) {
      try {
        lyrics = normalizeWhisperLyrics(JSON.parse(await readFile(lyricsUpload.tempPath, "utf8")));
      } catch (error) {
        await cleanupUploads(mainFileUpload, thumbUpload, lyricsUpload);
        const message = error instanceof LyricsValidationError || error instanceof SyntaxError
          ? error.message
          : "Invalid lyrics file";
        return reply.code(400).send({ error: message });
      }
      await cleanupUploads(lyricsUpload);
    }

    return persistMediaUpload({ fastify, request, reply, fields, lyrics, mainFileUpload, thumbUpload });
  });

  fastify.post("/uploads", async (request, reply) => {
    if (request.accessTier < 100) {
      return reply.code(403).send({ error: "Insufficient tier" });
    }

    const {
      category_id,
      title,
      description = "",
      artists = "",
      track_order = "",
      duration = "",
      content_kind = "",
      fileName,
      fileSize,
      fileType = "",
      thumbnailName = "",
      thumbnailSize = 0,
      thumbnailType = "",
      lyrics: rawLyrics = null,
      replaceMediaId = null,
    } = request.body || {};

    const replacementId = replaceMediaId === null ? null : Number.parseInt(replaceMediaId, 10);
    const isReplacement = Number.isInteger(replacementId);

    if (!isReplacement && (!category_id || !title || !fileName)) {
      return reply.code(400).send({ error: "Category, title, and file name are required" });
    }

    if (!isReplacement && hasTrackOrderValue(track_order) && parseTrackOrder(track_order) === null) {
      return reply.code(400).send({ error: "Track order must be a positive integer" });
    }

    if (isReplacement && !fileName && !thumbnailName && rawLyrics === null) {
      return reply.code(400).send({ error: "Choose a replacement file, thumbnail, or lyrics file" });
    }

    let lyrics = undefined;
    if (rawLyrics !== null) {
      try {
        lyrics = normalizeWhisperLyrics(rawLyrics);
      } catch (error) {
        if (error instanceof LyricsValidationError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    }

    const uploadId = randomUUID();
    const uploadDir = join(CHUNK_UPLOAD_DIR, uploadId);
    await mkdir(uploadDir, { recursive: true });
    await saveJson(join(uploadDir, "manifest.json"), {
      fields: {
        category_id,
        title,
        description,
        artists,
        track_order,
        duration,
        content_kind,
      },
      file: fileName
        ? {
            name: fileName,
            size: Number(fileSize) || 0,
            type: fileType,
            totalChunks: Math.max(1, Math.ceil((Number(fileSize) || 0) / CHUNK_SIZE)),
          }
        : null,
      thumbnail: thumbnailName
        ? {
            name: thumbnailName,
            size: Number(thumbnailSize) || 0,
            type: thumbnailType,
            totalChunks: Math.max(1, Math.ceil((Number(thumbnailSize) || 0) / CHUNK_SIZE)),
          }
        : null,
      lyrics,
      replaceMediaId: isReplacement ? replacementId : null,
    });

    return reply.code(201).send({ uploadId, chunkSize: CHUNK_SIZE });
  });

  fastify.post("/uploads/:uploadId/chunks", async (request, reply) => withActiveUpload(request.params.uploadId, async () => {
    if (request.accessTier < 100) {
      return reply.code(403).send({ error: "Insufficient tier" });
    }

    const uploadDir = uploadSessionDir(request.params.uploadId);
    if (!uploadDir) {
      return reply.code(400).send({ error: "Invalid upload id" });
    }

    let manifest;
    try {
      manifest = await readJson(join(uploadDir, "manifest.json"));
    } catch {
      return reply.code(404).send({ error: "Upload not found" });
    }

    const fields = {};
    let chunkUpload = null;

    for await (const part of request.parts({ limits: { fileSize: CHUNK_SIZE + 1024 } })) {
      if (part.type === "file" && part.fieldname === "chunk") {
        if (chunkUpload) await unlink(chunkUpload.tempPath).catch(() => {});
        chunkUpload = await savePartToTemp(part);
      } else if (part.type === "file") {
        part.file.resume();
      } else {
        fields[part.fieldname] = part.value;
      }
    }

    const kind = fields.kind === "thumbnail" ? "thumbnail" : "file";
    const index = Number.parseInt(fields.index, 10);
    const expectedChunks = kind === "thumbnail" ? manifest.thumbnail?.totalChunks : manifest.file.totalChunks;

    if (!chunkUpload || !Number.isInteger(index) || index < 0 || !expectedChunks || index >= expectedChunks) {
      await cleanupUploads(chunkUpload);
      return reply.code(400).send({ error: "Chunk and valid index are required" });
    }

    await rename(chunkUpload.tempPath, chunkPath(uploadDir, kind, index));
    const now = new Date();
    await utimes(uploadDir, now, now);
    return reply.code(204).send();
  }));

  fastify.post("/uploads/:uploadId/complete", async (request, reply) => withActiveUpload(request.params.uploadId, async () => {
    if (request.accessTier < 100) {
      return reply.code(403).send({ error: "Insufficient tier" });
    }

    const uploadDir = uploadSessionDir(request.params.uploadId);
    if (!uploadDir) {
      return reply.code(400).send({ error: "Invalid upload id" });
    }

    let manifest;
    try {
      manifest = await readJson(join(uploadDir, "manifest.json"));
    } catch {
      return reply.code(404).send({ error: "Upload not found" });
    }

    const existingStatusRaw = await fastify.redis.get(uploadCompletionStatusKey(request.params.uploadId));
    if (existingStatusRaw) {
      const existingStatus = JSON.parse(existingStatusRaw);
      if (existingStatus.status === "completed" && existingStatus.media) return existingStatus.media;
      if (["queued", "processing"].includes(existingStatus.status)) {
        return reply.code(202).send({ uploadId: request.params.uploadId, status: existingStatus.status });
      }
      return reply.code(409).send({ error: existingStatus.error || "Upload processing failed" });
    }

    await enqueueUploadCompletion({
      redis: fastify.redis,
      uploadId: request.params.uploadId,
      metadata: {
        title: manifest.fields?.title || manifest.file?.name || `Media #${manifest.replaceMediaId || "new"}`,
        fileName: manifest.file?.name || manifest.thumbnail?.name || null,
        replacementMediaId: manifest.replaceMediaId || null,
      },
    });
    return reply.code(202).send({ uploadId: request.params.uploadId, status: "queued" });
  }));

  fastify.get("/uploads/queue", async (request, reply) => {
    if (request.accessTier < 100) {
      return reply.code(403).send({ error: "Insufficient tier" });
    }

    reply.header("Cache-Control", "no-store");
    let cursor = "0";
    const keys = [];
    do {
      const result = await fastify.redis.scan(
        cursor,
        "MATCH",
        `${UPLOAD_COMPLETION_STATUS_PREFIX}*`,
        "COUNT",
        100
      );
      cursor = String(result?.[0] || "0");
      keys.push(...(result?.[1] || []));
    } while (cursor !== "0");

    const rawStatuses = [];
    for (let index = 0; index < keys.length; index += 200) {
      rawStatuses.push(...await fastify.redis.mget(...keys.slice(index, index + 200)));
    }
    const jobs = rawStatuses.flatMap((raw) => {
      if (!raw) return [];
      try {
        const value = JSON.parse(raw);
        return value?.uploadId ? [value] : [];
      } catch {
        return [];
      }
    });
    const queuedJobs = jobs
      .filter((job) => job.status === "queued")
      .sort((a, b) => String(a.queuedAt || "").localeCompare(String(b.queuedAt || "")));
    const positions = new Map(queuedJobs.map((job, index) => [job.uploadId, index + 1]));
    const statusOrder = { processing: 0, queued: 1, failed: 2, completed: 3 };
    const visibleJobs = jobs
      .map((job) => {
        const { media, ...publicJob } = job;
        return {
          ...publicJob,
          mediaId: media?.id || null,
          queuePosition: positions.get(job.uploadId) || null,
        };
      })
      .sort((a, b) => {
        const statusDifference = (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4);
        if (statusDifference) return statusDifference;
        return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""));
      })
      .filter((job, index) => ["queued", "processing"].includes(job.status) || index < 50);

    return {
      jobs: visibleJobs,
      summary: {
        queued: jobs.filter((job) => job.status === "queued").length,
        processing: jobs.filter((job) => job.status === "processing").length,
        completed: jobs.filter((job) => job.status === "completed").length,
        failed: jobs.filter((job) => job.status === "failed").length,
      },
    };
  });

  fastify.get("/uploads/:uploadId/status", async (request, reply) => {
    if (request.accessTier < 100) {
      return reply.code(403).send({ error: "Insufficient tier" });
    }
    const uploadDir = uploadSessionDir(request.params.uploadId);
    if (!uploadDir) return reply.code(400).send({ error: "Invalid upload id" });
    reply.header("Cache-Control", "no-store");
    const rawStatus = await fastify.redis.get(uploadCompletionStatusKey(request.params.uploadId));
    if (!rawStatus) return reply.code(404).send({ error: "Upload status not found" });
    return JSON.parse(rawStatus);
  });

  fastify.delete("/uploads/:uploadId", async (request, reply) => {
    if (request.accessTier < 100) {
      return reply.code(403).send({ error: "Insufficient tier" });
    }

    const uploadDir = uploadSessionDir(request.params.uploadId);
    if (!uploadDir) {
      return reply.code(400).send({ error: "Invalid upload id" });
    }

    await rm(uploadDir, { recursive: true, force: true });
    await fastify.redis.del(uploadCompletionStatusKey(request.params.uploadId));
    return reply.code(204).send();
  });

  fastify.post("/track-orders/scan", async (request, reply) => {
    if (request.accessTier < 100) {
      return reply.code(403).send({ error: "Insufficient tier" });
    }

    const { rows } = await fastify.pg.query(
      "SELECT id, file_path, track_order FROM media_assets WHERE mime_type LIKE 'audio/%' ORDER BY id"
    );
    const result = { scanned: rows.length, updated: 0, missing: 0, failed: 0 };
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < rows.length) {
        const row = rows[nextIndex];
        nextIndex += 1;
        const tags = await scanMediaTags(join(dataDir, row.file_path), request.log);
        if (tags.probeFailed) {
          result.failed += 1;
          continue;
        }
        if (tags.trackOrder === null || tags.trackOrder === undefined) {
          result.missing += 1;
          continue;
        }
        if (Number(row.track_order) === tags.trackOrder) continue;

        await fastify.pg.query(
          "UPDATE media_assets SET track_order = $1 WHERE id = $2",
          [tags.trackOrder, row.id]
        );
        result.updated += 1;
      }
    };

    await Promise.all(Array.from({ length: Math.min(4, rows.length) }, () => worker()));
    return result;
  });

  fastify.post("/:id/encoding/retry", async (request, reply) => {
    if (request.accessTier < 100) return reply.code(403).send({ error: "Insufficient tier" });
    const force = request.body?.force === true;
    const retried = await retryFailedEncoding({ pg: fastify.pg, redis: fastify.redis, mediaId: request.params.id, force });
    if (retried) return reply.code(202).send({ status: "queued" });
    const { rowCount } = await fastify.pg.query("SELECT 1 FROM media_assets WHERE id = $1", [request.params.id]);
    return rowCount ? reply.code(409).send({ error: "No encoding variants to retry" }) : reply.code(404).send({ error: "Not found" });
  });

  fastify.put("/:id", async (request, reply) => {
    if (request.accessTier < 100) {
      return reply.code(403).send({ error: "Insufficient tier" });
    }
    const { id } = request.params;
    const { title, description, duration, artists, track_order: trackOrder, offline_allowed: offlineAllowed } = request.body;
    const hasArtists = Object.hasOwn(request.body || {}, "artists");
    const hasDuration = Object.hasOwn(request.body || {}, "duration");
    const hasTrackOrder = Object.hasOwn(request.body || {}, "track_order");
    const hasOfflineAllowed = Object.hasOwn(request.body || {}, "offline_allowed");
    if (hasOfflineAllowed && typeof offlineAllowed !== "boolean") {
      return reply.code(400).send({ error: "offline_allowed must be a boolean" });
    }
    if (hasTrackOrder && hasTrackOrderValue(trackOrder) && parseTrackOrder(trackOrder) === null) {
      return reply.code(400).send({ error: "Track order must be a positive integer" });
    }
    const normalizedArtists = hasArtists ? normalizeOptionalText(artists) : null;
    const parsedDuration = Number.parseInt(duration, 10);
    const normalizedDuration = Number.isFinite(parsedDuration) && parsedDuration >= 0 ? parsedDuration : null;
    const normalizedTrackOrder = parseTrackOrder(trackOrder);
    const { rows } = await fastify.pg.query(
      "UPDATE media_assets SET title = COALESCE($1, title), description = COALESCE($2, description), duration = CASE WHEN $3 THEN $4 ELSE duration END, artists = CASE WHEN $5 THEN $6 ELSE artists END, track_order = CASE WHEN $7 THEN $8 ELSE track_order END, offline_allowed = CASE WHEN $9 THEN $10 ELSE offline_allowed END WHERE id = $11 RETURNING *",
      [title, description, hasDuration, normalizedDuration, hasArtists, normalizedArtists, hasTrackOrder, normalizedTrackOrder, hasOfflineAllowed, offlineAllowed, id]
    );
    if (rows.length === 0) return reply.code(404).send({ error: "Not found" });
    return rows[0];
  });

  fastify.delete("/:id", async (request, reply) => {
    if (request.accessTier < 100) {
      return reply.code(403).send({ error: "Insufficient tier" });
    }
    const { id } = request.params;
    const { rows } = await fastify.pg.query(
      "SELECT file_path, category_id FROM media_assets WHERE id = $1",
      [id]
    );
    if (rows.length === 0) return reply.code(404).send({ error: "Not found" });

    const filePath = join(dataDir, rows[0].file_path);
    await unlink(filePath).catch(() => {});

    await rm(join(dataDir, String(rows[0].category_id), String(id)), { recursive: true, force: true }).catch(() => {});

    await fastify.pg.query("DELETE FROM media_assets WHERE id = $1", [id]);
    return reply.code(204).send();
  });

  fastify.post("/:id/playback-session", async (request, reply) => {
    const { id } = request.params;
    const requestedQuality = normalizeRequestedQuality(request.body?.quality, { defaultQuality: "high" });
    if (!requestedQuality) return reply.code(400).send({ error: "quality must be low, med, high, or ori" });

    const { rows } = await fastify.pg.query(
      `${ACCESSIBLE_CATEGORY_TREE_SQL}
       SELECT m.id, m.duration, m.mime_type, m.source_version
       FROM media_assets m
       JOIN accessible_categories ac ON ac.id = m.category_id
       WHERE m.id = $2`,
      [request.accessTier, id]
    );
    if (rows.length === 0) return reply.code(404).send({ error: "Media not found" });

    const media = rows[0];
    const protectedMedia = media.mime_type?.startsWith("audio/") || media.mime_type?.startsWith("video/");
    if (protectedMedia && requestedQuality === "ori" && request.accessTier < ORIGINAL_QUALITY_MIN_TIER) {
      return reply.code(403).send({ error: "Original quality requires admin access" });
    }

    const viewerId = resolveViewerId(request);
    const leaseRequired = requiresExclusiveLease(request.accessTier, media.mime_type);
    const created = await createPlaybackSession(fastify.redis, {
      mediaId: media.id,
      clientIp: request.clientIp || request.ip,
      accessTier: request.accessTier,
      viewerId,
      leaseRequired,
      quality: requestedQuality,
      sourceVersion: media.source_version,
      duration: media.duration,
    });
    if (leaseRequired) {
      let lease;
      try {
        lease = await acquireExclusiveLease(fastify.redis, {
          viewerId,
          sessionId: created.sessionId,
          mediaId: media.id,
          clientIp: request.clientIp || request.ip,
          platform: request.headers["x-viewer-id"] ? "mobile" : "web",
        });
      } catch (error) {
        await revokePlaybackSession(fastify.redis, created.sessionId).catch(() => {});
        request.log.error({ error }, "exclusive playback lease acquisition failed");
        return reply.code(503).send({ code: "PLAYBACK_LEASE_UNAVAILABLE", error: "Playback protection is temporarily unavailable" });
      }
      if (!lease.acquired) {
        await revokePlaybackSession(fastify.redis, created.sessionId);
        return reply.code(409).send({
          code: "PLAYBACK_IN_USE",
          error: "Media is currently playing on another device",
          retryAfter: lease.retryAfter,
        });
      }
      if (lease.previousSessionId && lease.previousSessionId !== created.sessionId) {
        await revokePlaybackSession(fastify.redis, lease.previousSessionId).catch(() => {});
      }
    }
    request.log.info({
      mediaId: Number(media.id),
      quality: requestedQuality,
      clientIp: request.clientIp || request.ip,
      expiresAt: created.session.expiresAt,
    }, "protected playback session created");
    setPlaybackSessionCookie(request, reply, media.id, created.sessionId, created.ttlSeconds);
    setViewerCookie(request, reply, viewerId);
    reply.header("Cache-Control", "no-store");
    return {
      streamUrl: `/api/media/${media.id}/stream?quality=${encodeURIComponent(requestedQuality)}`,
      sessionId: created.sessionId,
      viewerId,
      leaseRequired,
      expiresAt: new Date(created.session.expiresAt).toISOString(),
      quality: requestedQuality,
    };
  });

  fastify.get("/:id/stream", async (request, reply) => {
    const { id } = request.params;
    const requestedQuality = normalizeRequestedQuality(request.query?.quality, { defaultQuality: "high" });
    if (!requestedQuality) return reply.code(400).send({ error: "quality must be low, med, high, or ori" });
    const { rows } = await fastify.pg.query(
      `${ACCESSIBLE_CATEGORY_TREE_SQL}
       SELECT m.* FROM media_assets m
       JOIN accessible_categories ac ON ac.id = m.category_id
       WHERE m.id = $2`,
      [request.accessTier, id]
    );
    if (rows.length === 0) return reply.code(404).send({ error: "Not found" });

    const media = rows[0];
    const sessionId = readPlaybackSessionId(request, id);
    const viewerId = readViewerId(request);
    const validation = await validatePlaybackSession(fastify.redis, sessionId, {
      mediaId: id,
      clientIp: request.clientIp || request.ip,
      accessTier: request.accessTier,
      viewerId,
      quality: requestedQuality,
      sourceVersion: media.source_version,
    });
    if (!validation.valid) {
      reply.header("Cache-Control", "no-store");
      return reply.code(401).send({ error: "A valid playback session is required" });
    }
    if (validation.session.leaseRequired) {
      const lease = await refreshExclusiveLease(fastify.redis, viewerId, sessionId);
      if (!lease.refreshed) {
        reply.header("Cache-Control", "no-store");
        return reply.code(409).send({
          code: "PLAYBACK_LEASE_LOST",
          error: "Playback access is no longer active on this device",
          retryAfter: lease.retryAfter,
        });
      }
    }

    let actualQuality = "ori";
    let selectedPath = media.file_path;
    let selectedMime = media.mime_type;
    if (requestedQuality !== "ori") {
      const { rows: variants } = await fastify.pg.query(
        `SELECT quality, file_path, mime_type FROM media_encoding_variants
         WHERE media_id = $1 AND source_version = $2 AND status = 'ready'
           AND quality = ANY($3::text[])`,
        [id, media.source_version, ENCODED_QUALITIES]
      );
      actualQuality = selectActualQuality(requestedQuality, variants.map((variant) => variant.quality));
      const selected = variants.find((variant) => variant.quality === actualQuality);
      if (selected) {
        selectedPath = selected.file_path;
        selectedMime = selected.mime_type;
      }
    }
    const protectedMedia = media.mime_type?.startsWith("audio/") || media.mime_type?.startsWith("video/");
    if (protectedMedia && actualQuality === "ori" && request.accessTier < ORIGINAL_QUALITY_MIN_TIER) {
      return reply.code(409).send({ error: "A protected encoded rendition is not ready" });
    }
    const filePath = join(dataDir, selectedPath);

    let fileStats;
    try {
      fileStats = await stat(filePath);
    } catch {
      if (actualQuality === "ori") return reply.code(404).send({ error: "File not found on disk" });
      if (protectedMedia && request.accessTier < ORIGINAL_QUALITY_MIN_TIER) {
        return reply.code(409).send({ error: "A protected encoded rendition is not ready" });
      }
      actualQuality = "ori";
      selectedPath = media.file_path;
      selectedMime = media.mime_type;
      try {
        fileStats = await stat(join(dataDir, selectedPath));
      } catch {
        return reply.code(404).send({ error: "File not found on disk" });
      }
    }

    const fileSize = fileStats.size;
    const range = request.headers.range;
    const resolvedFilePath = join(dataDir, selectedPath);
    const contentType = selectedMime || mimeFromExt(resolvedFilePath);
    const etag = `"${id}-${media.source_version || 1}-${fileSize}-${actualQuality}"`;
    applyNoDownloadHeaders(reply, { etag });
    reply.header("Accept-Ranges", "bytes");
    reply.header("X-Media-Quality", actualQuality);

    if (request.headers["if-none-match"] === etag && !range) {
      return reply.code(304).send();
    }

    if (range) {
      const parsedRange = parseByteRange(range, fileSize);
      if (!parsedRange) {
        reply.header("Content-Range", `bytes */${fileSize}`);
        return reply.code(416).send();
      }
      const { start, end } = parsedRange;
      const chunkSize = end - start + 1;

      reply.code(206);
      reply.header("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      reply.header("Content-Length", chunkSize);
      reply.header("Accept-Ranges", "bytes");
      reply.type(contentType);

      const stream = createReadStream(resolvedFilePath, { start, end });
      return reply.send(stream);
    }

    reply.header("Content-Length", fileSize);
    reply.header("Accept-Ranges", "bytes");
    reply.type(contentType);
    const stream = createReadStream(resolvedFilePath);
    return reply.send(stream);
  });

  fastify.get("/:id/thumbnail", async (request, reply) => {
    const { id } = request.params;
    const { rows } = await fastify.pg.query(
      `${ACCESSIBLE_CATEGORY_TREE_SQL}
       SELECT m.* FROM media_assets m
       JOIN accessible_categories ac ON ac.id = m.category_id
       WHERE m.id = $2`,
      [request.accessTier, id]
    );
    if (rows.length === 0) {
      const { rowCount } = await fastify.pg.query("SELECT 1 FROM media_assets WHERE id = $1", [id]);
      if (rowCount === 0) return reply.code(404).send({ error: "Not found" });
      return reply.code(403).send({ error: "Access denied" });
    }

    const { rows: categories } = await fastify.pg.query("SELECT cover_path FROM categories WHERE id = $1", [rows[0].category_id]);
    const selectedCover = rows[0].thumbnail_path || categories[0]?.cover_path;
    if (!selectedCover) return reply.code(404).send({ error: "No thumbnail available" });
    const coverFile = join(dataDir, selectedCover);
    try {
      return sendCoverFile({ request, reply, filePath: coverFile, stats: await stat(coverFile) });
    } catch {
      return reply.code(404).send({ error: "No thumbnail available" });
    }
  });
}
