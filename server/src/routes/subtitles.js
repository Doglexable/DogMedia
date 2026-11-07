import { createReadStream } from "fs";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { join } from "path";
import { extractMediaSubtitles, getSubtitlesForMedia, serializeSubtitle } from "../subtitles.js";
import { ACCESSIBLE_CATEGORY_IDS_SQL } from "../category-access.js";

const ACCESSIBLE_MEDIA_SQL = `
  ${ACCESSIBLE_CATEGORY_IDS_SQL}
  SELECT
    m.id,
    m.file_path,
    m.mime_type
  FROM media_assets m
  JOIN accessible_categories ac ON ac.id = m.category_id
  WHERE m.id = $2
`;

async function checkMediaAccess(fastify, request, reply, mediaId) {
  const { rows } = await fastify.pg.query(ACCESSIBLE_MEDIA_SQL, [request.accessTier, mediaId]);
  if (rows.length === 0) {
    const { rowCount } = await fastify.pg.query("SELECT 1 FROM media_assets WHERE id = $1", [mediaId]);
    if (rowCount === 0) {
      reply.code(404).send({ error: "Media not found" });
    } else {
      reply.code(403).send({ error: "Access denied" });
    }
    return null;
  }
  return rows[0];
}

export default async function subtitlesRoutes(fastify) {
  const dataDir = process.env.DATA_DIR || join(process.cwd(), "data");

  // List all subtitle tracks for media
  fastify.get("/media/:id/subtitles", async (request, reply) => {
    const media = await checkMediaAccess(fastify, request, reply, request.params.id);
    if (!media) return;

    let list = await getSubtitlesForMedia(fastify.pg, media.id);
    if (list.length === 0 && media.mime_type?.startsWith("video/")) {
      // Auto-extract subtitles on demand if not extracted yet
      try {
        list = await extractMediaSubtitles({
          dataDir,
          mediaId: media.id,
          filePath: media.file_path,
          pg: fastify.pg,
          log: request.log,
        });
      } catch (err) {
        request.log.warn({ err, mediaId: media.id }, "error during on-demand subtitle extraction");
      }
    }

    return list;
  });

  // Serve WebVTT subtitle stream
  fastify.get("/media/:id/subtitles/:subtitleId/vtt", async (request, reply) => {
    const media = await checkMediaAccess(fastify, request, reply, request.params.id);
    if (!media) return;

    const { rows } = await fastify.pg.query(
      "SELECT * FROM media_subtitles WHERE id = $1 AND media_id = $2",
      [request.params.subtitleId, media.id]
    );

    if (rows.length === 0 || !rows[0].vtt_path) {
      return reply.code(404).send({ error: "Subtitle not found" });
    }

    const filePath = join(dataDir, rows[0].vtt_path);
    try {
      await stat(filePath);
    } catch {
      return reply.code(404).send({ error: "Subtitle file missing from storage" });
    }

    reply.header("Content-Type", "text/vtt; charset=utf-8");
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.send(createReadStream(filePath));
  });

  // Serve raw ASS subtitle stream for full ASS rendering
  fastify.get("/media/:id/subtitles/:subtitleId/ass", async (request, reply) => {
    const media = await checkMediaAccess(fastify, request, reply, request.params.id);
    if (!media) return;

    const { rows } = await fastify.pg.query(
      "SELECT * FROM media_subtitles WHERE id = $1 AND media_id = $2",
      [request.params.subtitleId, media.id]
    );

    if (rows.length === 0 || !rows[0].ass_path) {
      return reply.code(404).send({ error: "ASS subtitle not available for this track" });
    }

    const filePath = join(dataDir, rows[0].ass_path);
    try {
      await stat(filePath);
    } catch {
      return reply.code(404).send({ error: "ASS subtitle file missing from storage" });
    }

    reply.header("Content-Type", "text/x-ssa; charset=utf-8");
    reply.header("Cache-Control", "public, max-age=86400");
    return reply.send(createReadStream(filePath));
  });

  // Translate subtitle track (Admin only)
  fastify.post("/media/:id/subtitles/translate", async (request, reply) => {
    if (request.accessTier < 100) {
      return reply.code(403).send({ error: "Insufficient tier" });
    }

    const gasUrl = process.env.TRANSLATOR_GAS_URL;
    const adminSecret = process.env.TRANSLATOR_ADMIN_SECRET || process.env.TRANSLATE_ADMIN_SECRET || "pfs_admin_secret_key_123";
    if (!gasUrl) {
      return reply.code(400).send({ error: "TRANSLATOR_GAS_URL is not configured" });
    }

    const media = await checkMediaAccess(fastify, request, reply, request.params.id);
    if (!media) return;

    let subtitleRow;
    const requestedSubId = request.body?.subtitleId ? Number(request.body.subtitleId) : null;
    if (requestedSubId) {
      const { rows } = await fastify.pg.query(
        "SELECT * FROM media_subtitles WHERE id = $1 AND media_id = $2",
        [requestedSubId, media.id]
      );
      subtitleRow = rows[0];
    } else {
      const { rows } = await fastify.pg.query(
        "SELECT * FROM media_subtitles WHERE media_id = $1 ORDER BY stream_index ASC LIMIT 1",
        [media.id]
      );
      subtitleRow = rows[0];
    }

    if (!subtitleRow || !subtitleRow.vtt_path) {
      return reply.code(404).send({ error: "No subtitle track available to translate" });
    }

    const sourceVttPath = join(dataDir, subtitleRow.vtt_path);
    let vttContent;
    try {
      vttContent = await readFile(sourceVttPath, "utf8");
    } catch {
      return reply.code(404).send({ error: "Source subtitle file missing from storage" });
    }

    const targetLang = (request.body?.targetLang || "id").trim().toLowerCase();
    let subSourceLang = (subtitleRow.language || "").trim().toLowerCase();
    const codeMap = { eng: "en", ind: "id", jpn: "ja", kor: "ko", spa: "es", fra: "fr", deu: "de", zho: "zh", und: "" };
    if (codeMap[subSourceLang]) subSourceLang = codeMap[subSourceLang];
    if (subSourceLang === targetLang) {
      subSourceLang = "";
    }

    let gasResponse;
    try {
      gasResponse = await fetch(gasUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          adminSecret,
          type: "subtitle",
          targetLang,
          sourceLang: subSourceLang,
          content: vttContent,
        }),
      });
    } catch (fetchErr) {
      return reply.code(502).send({ error: `Failed to connect to translator: ${fetchErr.message}` });
    }

    if (!gasResponse.ok) {
      const errText = await gasResponse.text().catch(() => "");
      return reply.code(502).send({ error: `Translation service failed: ${gasResponse.status} ${errText}` });
    }

    const gasResult = await gasResponse.json().catch(() => ({}));
    if (typeof gasResult.content !== "string") {
      return reply.code(502).send({ error: gasResult.error || "Translation returned invalid format" });
    }

    const { rows: maxRows } = await fastify.pg.query(
      "SELECT COALESCE(MAX(stream_index), -1) AS max_index FROM media_subtitles WHERE media_id = $1",
      [media.id]
    );
    const newStreamIndex = Number(maxRows[0]?.max_index ?? -1) + 1;

    const subDir = join(dataDir, "subtitles", String(media.id));
    await mkdir(subDir, { recursive: true });
    const targetRelative = `subtitles/${media.id}/${media.id}_tr_${targetLang}_${newStreamIndex}.vtt`;
    const targetAbsolute = join(dataDir, targetRelative);
    await writeFile(targetAbsolute, gasResult.content, "utf8");

    const langName = targetLang === "id" ? "Indonesian" : targetLang.toUpperCase();
    const title = `${langName} (Translated)`;

    const { rows: inserted } = await fastify.pg.query(
      `INSERT INTO media_subtitles (
         media_id, stream_index, language, title, format, is_default, has_ass_styling, vtt_path, ass_path, updated_at
       ) VALUES ($1, $2, $3, $4, 'vtt', FALSE, FALSE, $5, NULL, NOW())
       RETURNING *`,
      [media.id, newStreamIndex, targetLang, title, targetRelative]
    );

    return serializeSubtitle(inserted[0]);
  });
}
