import { createReadStream, createWriteStream } from "fs";
import { mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { pipeline } from "stream/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { LyricsValidationError, normalizeWhisperLyrics, upsertUploadedLyrics } from "../lyrics.js";

const execFileAsync = promisify(execFile);
const DATA_DIR = process.env.DATA_DIR || "data";
const UPLOAD_TMP_DIR = process.env.UPLOAD_TMP_DIR || join(DATA_DIR, "tmp");
const CHUNK_SIZE = 512 * 1024;
const CHUNK_UPLOAD_DIR = join(UPLOAD_TMP_DIR, "chunked");
const ACCESSIBLE_CATEGORY_TREE_SQL = `
  WITH RECURSIVE accessible_categories AS (
    SELECT
      c.id,
      c.parent_id,
      c.min_access_tier,
      c.name,
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
      ac.path_parts || c.name::text,
      ac.order_parts || COALESCE(c.sort_order, 0)
    FROM categories c
    JOIN accessible_categories ac ON c.parent_id = ac.id
    WHERE c.min_access_tier <= $1
  )
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

function applyNoDownloadHeaders(reply, { revalidate = false } = {}) {
  reply.header("Content-Disposition", "inline");
  reply.header("Cache-Control", revalidate ? "private, no-cache" : "no-store, private, max-age=0");
  if (!revalidate) {
    reply.header("Pragma", "no-cache");
    reply.header("Expires", "0");
  }
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

async function probeDuration(filePath, log) {
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

async function deleteMediaThumbnails(categoryDir, mediaId) {
  const exts = ["webp", "jpg", "png", "jpeg"];
  await Promise.all(exts.map((xt) => unlink(join(categoryDir, `${mediaId}_thumb.${xt}`)).catch(() => {})));
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

  const { rowCount: categoryExists } = await fastify.pg.query(
    "SELECT 1 FROM categories WHERE id = $1",
    [fields.category_id]
  );
  if (categoryExists === 0) {
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
  const detectedDuration = durationObj ?? (await probeDuration(filePath, request.log));
  const detectedTags = mimeType.startsWith("audio/") ? await probeMediaTags(filePath, request.log) : {};
  const artists = providedArtists || detectedTags.artists || null;
  const trackOrder = resolveTrackOrder(providedTrackOrder, detectedTags.trackOrder);

  let thumbStoredName = `${mediaId}_thumb.webp`;

  if (thumbUpload) {
    const thumbExt = extFromFilename(thumbUpload.filename, "jpg");
    thumbStoredName = `${mediaId}_thumb.${thumbExt}`;
    await pipeline(createReadStream(thumbUpload.tempPath), createWriteStream(join(categoryDir, thumbStoredName)));
    await unlink(thumbUpload.tempPath).catch(() => {});
  } else {
    try {
      await generateAutoThumbnail({
        filePath,
        outputPath: join(categoryDir, thumbStoredName),
        mimeType,
        log: request.log,
      });
    } catch (err) {
      request.log.error(err, "ffmpeg thumbnail generation failed");
    }
  }

  const { rows: updated } = await fastify.pg.query(
    "UPDATE media_assets SET file_path = $1, mime_type = $2, duration = $3, artists = $4, track_order = $5 WHERE id = $6 RETURNING *",
    [`${fields.category_id}/${storedName}`, mimeType, detectedDuration, artists, trackOrder, mediaId]
  );

  if (lyrics) {
    await upsertUploadedLyrics(fastify.pg, mediaId, lyrics);
  }

  return reply.code(201).send({ ...updated[0], has_lyrics: Boolean(lyrics) });
}

async function replaceMediaFiles({ fastify, request, reply, mediaId, lyrics, mainFileUpload = null, thumbUpload = null }) {
  if (!mainFileUpload && !thumbUpload && lyrics === undefined) {
    return reply.code(400).send({ error: "Choose a replacement file, thumbnail, or lyrics file" });
  }

  const { rows } = await fastify.pg.query("SELECT * FROM media_assets WHERE id = $1", [mediaId]);
  if (rows.length === 0) {
    await cleanupUploads(mainFileUpload, thumbUpload);
    return reply.code(404).send({ error: "Not found" });
  }

  const existing = rows[0];
  const categoryDir = join(DATA_DIR, String(existing.category_id));
  await mkdir(categoryDir, { recursive: true });

  let nextFilePath = existing.file_path;
  let nextMimeType = existing.mime_type;
  let nextDuration = existing.duration;
  let nextArtists = existing.artists;

  if (mainFileUpload) {
    const ext = extFromFilename(mainFileUpload.filename);
    const storedName = `${mediaId}.${ext}`;
    const absoluteFilePath = join(categoryDir, storedName);
    const previousFilePath = join(DATA_DIR, existing.file_path);

    await pipeline(createReadStream(mainFileUpload.tempPath), createWriteStream(absoluteFilePath));
    await unlink(mainFileUpload.tempPath).catch(() => {});
    if (previousFilePath !== absoluteFilePath) await unlink(previousFilePath).catch(() => {});

    nextFilePath = `${existing.category_id}/${storedName}`;
    nextMimeType = mimeFromExt(absoluteFilePath);
    nextDuration = await probeDuration(absoluteFilePath, request.log);
    if (!normalizeOptionalText(nextArtists)) {
      const detectedTags = await probeMediaTags(absoluteFilePath, request.log);
      nextArtists = detectedTags.artists || null;
    }
  }

  if (mainFileUpload || thumbUpload) {
    await deleteMediaThumbnails(categoryDir, mediaId);
  }

  if (thumbUpload) {
    const thumbExt = extFromFilename(thumbUpload.filename, "jpg");
    await pipeline(createReadStream(thumbUpload.tempPath), createWriteStream(join(categoryDir, `${mediaId}_thumb.${thumbExt}`)));
    await unlink(thumbUpload.tempPath).catch(() => {});
  } else if (mainFileUpload) {
    try {
      await generateAutoThumbnail({
        filePath: join(DATA_DIR, nextFilePath),
        outputPath: join(categoryDir, `${mediaId}_thumb.webp`),
        mimeType: nextMimeType,
        log: request.log,
      });
    } catch (err) {
      request.log.error(err, "ffmpeg thumbnail generation failed");
    }
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
         duration = COALESCE($3, duration),
         artists = $4
     WHERE id = $5
     RETURNING *`,
    [nextFilePath, nextMimeType, nextDuration, normalizeOptionalText(nextArtists), mediaId]
  );

  return reply.send({ ...updatedRows[0], has_lyrics: lyrics === undefined ? undefined : lyrics !== null });
}

async function generateAutoThumbnail({ filePath, outputPath, mimeType, log }) {
  if (mimeType.startsWith("video/")) {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i", filePath,
      "-ss", "00:00:01.000",
      "-vframes", "1",
      "-vf", "scale=320:-1",
      "-c:v", "webp",
      outputPath,
    ]);
    return;
  }

  if (mimeType.startsWith("image/")) {
    await execFileAsync("ffmpeg", [
      "-y",
      "-i", filePath,
      "-vf", "scale=320:-1",
      "-vframes", "1",
      "-c:v", "webp",
      outputPath,
    ]);
    return;
  }

  if (mimeType.startsWith("audio/")) {
    try {
      await execFileAsync("ffmpeg", [
        "-y",
        "-i", filePath,
        "-map", "0:v:0",
        "-frames:v", "1",
        "-vf", "scale=320:-1",
        "-c:v", "webp",
        outputPath,
      ]);
    } catch (err) {
      log.debug(err, "audio file has no extractable embedded cover art");
    }
  }
}

export default async function (fastify, options = {}) {
  const scanMediaTags = options.probeMediaTags || probeMediaTags;
  fastify.get("/", async (request) => {
    const { category_id } = request.query;
    let query = `
      ${ACCESSIBLE_CATEGORY_TREE_SQL}
      SELECT
        m.*,
        ac.name AS category_name,
        array_to_string(ac.path_parts, ' / ') AS category_path
      FROM media_assets m
      JOIN accessible_categories ac ON ac.id = m.category_id
      WHERE 1 = 1
    `;
    const params = [request.accessTier];

    if (category_id) {
      query += " AND m.category_id = $2";
      params.push(category_id);
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

    const params = [request.accessTier, request.clientIp || request.ip];
    const clauses = [];
    if (categoryId !== null) {
      params.push(categoryId);
      clauses.push(`m.category_id = $${params.length}`);
    }
    if (view === "liked") {
      clauses.push("lm.media_id IS NOT NULL");
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
       SELECT m.*, ac.name AS category_name,
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
         ac.name AS category_name,
         array_to_string(ac.path_parts, ' / ') AS category_path
       FROM media_assets m
       JOIN accessible_categories ac ON ac.id = m.category_id
       WHERE m.id = $2`,
      [request.accessTier, id]
    );
    if (rows.length === 0) {
      const { rowCount } = await fastify.pg.query("SELECT 1 FROM media_assets WHERE id = $1", [id]);
      if (rowCount === 0) return reply.code(404).send({ error: "Not found" });
      return reply.code(403).send({ error: "Access denied" });
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

  fastify.post("/uploads/:uploadId/chunks", async (request, reply) => {
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

    for await (const part of request.parts()) {
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
    return reply.code(204).send();
  });

  fastify.post("/uploads/:uploadId/complete", async (request, reply) => {
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

      if (manifest.replaceMediaId) {
        return await replaceMediaFiles({
          fastify,
          request,
          reply,
          mediaId: manifest.replaceMediaId,
          lyrics: manifest.lyrics,
          mainFileUpload,
          thumbUpload,
        });
      }

      return await persistMediaUpload({
        fastify,
        request,
        reply,
        fields: manifest.fields,
        lyrics: manifest.lyrics,
        mainFileUpload,
        thumbUpload,
      });
    } catch (err) {
      if (err.code === "ENOENT") {
        return reply.code(400).send({ error: "Upload is missing one or more chunks" });
      }
      throw err;
    } finally {
      await rm(uploadDir, { recursive: true, force: true });
    }
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
        const tags = await scanMediaTags(join(DATA_DIR, row.file_path), request.log);
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

  fastify.put("/:id", async (request, reply) => {
    if (request.accessTier < 100) {
      return reply.code(403).send({ error: "Insufficient tier" });
    }
    const { id } = request.params;
    const { title, description, duration, artists, track_order: trackOrder } = request.body;
    const hasArtists = Object.hasOwn(request.body || {}, "artists");
    const hasDuration = Object.hasOwn(request.body || {}, "duration");
    const hasTrackOrder = Object.hasOwn(request.body || {}, "track_order");
    if (hasTrackOrder && hasTrackOrderValue(trackOrder) && parseTrackOrder(trackOrder) === null) {
      return reply.code(400).send({ error: "Track order must be a positive integer" });
    }
    const normalizedArtists = hasArtists ? normalizeOptionalText(artists) : null;
    const parsedDuration = Number.parseInt(duration, 10);
    const normalizedDuration = Number.isFinite(parsedDuration) && parsedDuration >= 0 ? parsedDuration : null;
    const normalizedTrackOrder = parseTrackOrder(trackOrder);
    const { rows } = await fastify.pg.query(
      "UPDATE media_assets SET title = COALESCE($1, title), description = COALESCE($2, description), duration = CASE WHEN $3 THEN $4 ELSE duration END, artists = CASE WHEN $5 THEN $6 ELSE artists END, track_order = CASE WHEN $7 THEN $8 ELSE track_order END WHERE id = $9 RETURNING *",
      [title, description, hasDuration, normalizedDuration, hasArtists, normalizedArtists, hasTrackOrder, normalizedTrackOrder, id]
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
      "SELECT file_path FROM media_assets WHERE id = $1",
      [id]
    );
    if (rows.length === 0) return reply.code(404).send({ error: "Not found" });

    const filePath = join(DATA_DIR, rows[0].file_path);
    await unlink(filePath).catch(() => {});

    // Attempt to delete any related thumbnail indiscriminately
    const baseDir = dirname(filePath);
    const baseName = rows[0].file_path.split("/")[1].split(".")[0];
    const exts = ["webp", "jpg", "png", "jpeg"];
    for (const xt of exts) {
      await unlink(join(baseDir, `${baseName}_thumb.${xt}`)).catch(() => {});
    }

    await fastify.pg.query("DELETE FROM media_assets WHERE id = $1", [id]);
    return reply.code(204).send();
  });

  fastify.get("/:id/stream", async (request, reply) => {
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

    const media = rows[0];
    const filePath = join(DATA_DIR, media.file_path);

    let fileStats;
    try {
      fileStats = await stat(filePath);
    } catch {
      return reply.code(404).send({ error: "File not found on disk" });
    }

    const fileSize = fileStats.size;
    const range = request.headers.range;
    const contentType = media.mime_type || mimeFromExt(filePath);
    applyNoDownloadHeaders(reply);

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

      const stream = createReadStream(filePath, { start, end });
      return reply.send(stream);
    }

    reply.header("Content-Length", fileSize);
    reply.header("Accept-Ranges", "bytes");
    reply.type(contentType);
    const stream = createReadStream(filePath);
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

    const media = rows[0];
    const categoryDir = join(DATA_DIR, String(media.category_id));
    const baseName = media.file_path.split("/")[1].split(".")[0];

    // Probe possible thumb names
    const exts = ["webp", "jpg", "png", "jpeg"];
    for (const xt of exts) {
      const p = join(categoryDir, `${baseName}_thumb.${xt}`);
      try {
        const thumbnailStats = await stat(p);
        const etag = `W/\"${thumbnailStats.size.toString(16)}-${Math.floor(thumbnailStats.mtimeMs).toString(16)}\"`;
        applyNoDownloadHeaders(reply, { revalidate: true });
        reply.header("ETag", etag);
        reply.header("Last-Modified", thumbnailStats.mtime.toUTCString());
        const modifiedSince = Date.parse(request.headers["if-modified-since"] || "");
        if (request.headers["if-none-match"] === etag
          || (!request.headers["if-none-match"] && Number.isFinite(modifiedSince) && thumbnailStats.mtimeMs <= modifiedSince + 999)) {
          return reply.code(304).send();
        }
        reply.type(mimeFromExt(p));
        return reply.send(createReadStream(p));
      } catch {
        // file doesn't exist, try next ext
      }
    }

    return reply.code(404).send({ error: "No thumbnail available" });
  });
}
