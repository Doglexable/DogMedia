import { createReadStream, createWriteStream } from "fs";
import { mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from "fs/promises";
import { join, dirname } from "path";
import { pipeline } from "stream/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { randomUUID } from "crypto";
import { LyricsValidationError, normalizeWhisperLyrics } from "../lyrics.js";

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
      ARRAY[c.name::text]::text[] AS path_parts
    FROM categories c
    WHERE c.parent_id IS NULL
      AND c.min_access_tier <= $1
    UNION ALL
    SELECT
      c.id,
      c.parent_id,
      c.min_access_tier,
      c.name,
      ac.path_parts || c.name::text
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

function applyNoDownloadHeaders(reply) {
  reply.header("Content-Disposition", "inline");
  reply.header("Cache-Control", "no-store, private, max-age=0");
  reply.header("Pragma", "no-cache");
  reply.header("Expires", "0");
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("X-Download-Options", "noopen");
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

function firstMetadataValue(tags, keys) {
  if (!tags || typeof tags !== "object") return null;

  for (const key of keys) {
    const match = Object.entries(tags).find(([tagKey]) => tagKey.toLowerCase() === key.toLowerCase());
    const value = normalizeOptionalText(match?.[1]);
    if (value) return value;
  }

  return null;
}

async function probeMediaTags(filePath, log) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format_tags",
      "-of", "json",
      filePath,
    ]);
    const parsed = JSON.parse(stdout || "{}");
    const tags = parsed?.format?.tags || {};

    return {
      artists: firstMetadataValue(tags, ["artist", "album_artist", "artists", "composer", "performer"]),
    };
  } catch (err) {
    log.warn(err, "ffprobe metadata detection failed");
    return {};
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

  const { rows } = await fastify.pg.query(
    "INSERT INTO media_assets (category_id, title, description, file_path, duration, mime_type, artists) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
    [fields.category_id, fields.title, fields.description || "", "", durationObj, null, providedArtists]
  );

  const mediaId = rows[0].id;
  const storedName = `${mediaId}.${ext}`;
  const filePath = join(categoryDir, storedName);

  await pipeline(createReadStream(mainFileUpload.tempPath), createWriteStream(filePath));
  await unlink(mainFileUpload.tempPath).catch(() => {});
  const mimeType = mimeFromExt(filePath);
  const detectedDuration = durationObj ?? (await probeDuration(filePath, request.log));
  const detectedTags = providedArtists ? {} : await probeMediaTags(filePath, request.log);
  const artists = providedArtists || detectedTags.artists || null;

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
    "UPDATE media_assets SET file_path = $1, mime_type = $2, duration = $3, artists = $4 WHERE id = $5 RETURNING *",
    [`${fields.category_id}/${storedName}`, mimeType, detectedDuration, artists, mediaId]
  );

  if (lyrics) {
    await fastify.pg.query(
      `INSERT INTO media_lyrics (media_id, language, segments)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (media_id) DO UPDATE
       SET language = EXCLUDED.language,
           segments = EXCLUDED.segments,
           updated_at = NOW()`,
      [mediaId, lyrics.language, JSON.stringify(lyrics.segments)]
    );
  }

  return reply.code(201).send({ ...updated[0], has_lyrics: Boolean(lyrics) });
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

export default async function (fastify) {
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
    query += " ORDER BY m.title";

    const { rows } = await fastify.pg.query(query, params);
    return rows;
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
      duration = "",
      fileName,
      fileSize,
      fileType = "",
      thumbnailName = "",
      thumbnailSize = 0,
      thumbnailType = "",
      lyrics: rawLyrics = null,
    } = request.body || {};

    if (!category_id || !title || !fileName) {
      return reply.code(400).send({ error: "Category, title, and file name are required" });
    }

    let lyrics = null;
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
        duration,
      },
      file: {
        name: fileName,
        size: Number(fileSize) || 0,
        type: fileType,
        totalChunks: Math.max(1, Math.ceil((Number(fileSize) || 0) / CHUNK_SIZE)),
      },
      thumbnail: thumbnailName
        ? {
            name: thumbnailName,
            size: Number(thumbnailSize) || 0,
            type: thumbnailType,
            totalChunks: Math.max(1, Math.ceil((Number(thumbnailSize) || 0) / CHUNK_SIZE)),
          }
        : null,
      lyrics,
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
      const mainFileUpload = await assembleChunks({
        uploadDir,
        kind: "file",
        filename: manifest.file.name,
        totalChunks: manifest.file.totalChunks,
      });

      const thumbUpload = manifest.thumbnail
        ? await assembleChunks({
            uploadDir,
            kind: "thumbnail",
            filename: manifest.thumbnail.name,
            totalChunks: manifest.thumbnail.totalChunks,
          })
        : null;

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

  fastify.put("/:id", async (request, reply) => {
    if (request.accessTier < 100) {
      return reply.code(403).send({ error: "Insufficient tier" });
    }
    const { id } = request.params;
    const { title, description, duration, artists } = request.body;
    const hasArtists = Object.hasOwn(request.body || {}, "artists");
    const normalizedArtists = hasArtists ? normalizeOptionalText(artists) : null;
    const { rows } = await fastify.pg.query(
      "UPDATE media_assets SET title = COALESCE($1, title), description = COALESCE($2, description), duration = COALESCE($3, duration), artists = CASE WHEN $4 THEN $5 ELSE artists END WHERE id = $6 RETURNING *",
      [title, description, duration, hasArtists, normalizedArtists, id]
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
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
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
        await stat(p);
        applyNoDownloadHeaders(reply);
        reply.type(mimeFromExt(p));
        return reply.send(createReadStream(p));
      } catch {
        // file doesn't exist, try next ext
      }
    }
    
    return reply.code(404).send({ error: "No thumbnail available" });
  });
}
