import { execFile } from "child_process";
import { mkdir, readFile, stat, writeFile } from "fs/promises";
import { isAbsolute, join } from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export function cleanAssToVtt(vttString) {
  if (typeof vttString !== "string" || !vttString.trim()) return "WEBVTT\n\n";

  // Strip multiline override tags and comments in {...}
  const stripped = vttString.replace(/\{[\s\S]*?\}/g, "");
  const blocks = stripped.split(/\r?\n\r?\n/);
  const cleanedBlocks = [blocks[0]?.trim().startsWith("WEBVTT") ? blocks[0].trim() : "WEBVTT"];

  for (let i = 1; i < blocks.length; i++) {
    const rawLines = blocks[i].split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (rawLines.length === 0) continue;

    const timeLineIndex = rawLines.findIndex((l) => l.includes("-->"));
    if (timeLineIndex === -1) continue;

    const timeLine = rawLines[timeLineIndex];
    const textLines = rawLines.slice(timeLineIndex + 1);

    const validTextLines = [];
    for (const line of textLines) {
      const strippedTags = line.replace(/<[^>]*>/g, "").trim();
      // Drop ASS vector drawing coordinates (e.g. "m 0 0 l 120 ...")
      if (/^m\s+-?\d+/i.test(strippedTags)) continue;
      if (strippedTags.length > 0) {
        validTextLines.push(line);
      }
    }

    if (validTextLines.length > 0) {
      cleanedBlocks.push(`${timeLine}\n${validTextLines.join("\n")}`);
    }
  }

  return cleanedBlocks.join("\n\n") + "\n";
}

export async function probeSubtitleStreams(filePath, execFileImpl = execFileAsync) {
  try {
    const { stdout } = await execFileImpl("ffprobe", [
      "-v", "error",
      "-select_streams", "s",
      "-show_entries", "stream=index,codec_name,disposition:stream_tags=language,title",
      "-of", "json",
      filePath,
    ]);
    const data = JSON.parse(stdout || "{}");
    if (!Array.isArray(data.streams)) return [];

    return data.streams.map((stream) => {
      const codec = String(stream.codec_name || "").toLowerCase();
      const hasAssStyling = codec === "ass" || codec === "ssa";
      let format = "vtt";
      if (hasAssStyling) {
        format = "ass";
      } else if (codec === "subrip") {
        format = "srt";
      } else if (codec === "mov_text") {
        format = "mov_text";
      }

      return {
        streamIndex: Number(stream.index),
        codec,
        language: stream.tags?.language?.trim() || "und",
        title: stream.tags?.title?.trim() || "",
        isDefault: Boolean(stream.disposition?.default),
        hasAssStyling,
        format,
      };
    });
  } catch {
    return [];
  }
}

export function serializeSubtitle(row) {
  const hasAssStyling = Boolean(row.has_ass_styling);
  const mediaId = Number(row.media_id);
  const subtitleId = Number(row.id);
  return {
    id: subtitleId,
    mediaId,
    streamIndex: Number(row.stream_index),
    language: row.language || "und",
    title: row.title || (row.language && row.language !== "und" ? row.language.toUpperCase() : `Track ${Number(row.stream_index) + 1}`),
    format: row.format || "vtt",
    hasAssStyling,
    isDefault: Boolean(row.is_default),
    vttUrl: `/api/media/${mediaId}/subtitles/${subtitleId}/vtt`,
    assUrl: hasAssStyling ? `/api/media/${mediaId}/subtitles/${subtitleId}/ass` : null,
  };
}

export async function extractMediaSubtitles({
  dataDir,
  mediaId,
  filePath,
  pg,
  execFileImpl = execFileAsync,
  log,
}) {
  const inputPath = isAbsolute(filePath) ? filePath : join(dataDir, filePath);
  try {
    await stat(inputPath);
  } catch {
    return [];
  }

  const streams = await probeSubtitleStreams(inputPath, execFileImpl);
  if (streams.length === 0) return [];

  const subDir = join(dataDir, "subtitles", String(mediaId));
  await mkdir(subDir, { recursive: true });

  const results = [];
  for (const stream of streams) {
    const vttRelative = `subtitles/${mediaId}/${mediaId}_${stream.streamIndex}.vtt`;
    const vttAbsolute = join(dataDir, vttRelative);
    let assRelative = null;

    try {
      if (stream.hasAssStyling) {
        assRelative = `subtitles/${mediaId}/${mediaId}_${stream.streamIndex}.ass`;
        const assAbsolute = join(dataDir, assRelative);

        // 1. Extract raw ASS with lossless copy
        await execFileImpl("ffmpeg", [
          "-hide_banner", "-loglevel", "error", "-y",
          "-i", inputPath,
          "-map", `0:${stream.streamIndex}`,
          "-c", "copy",
          assAbsolute,
        ]);

        // 2. Extract WebVTT and clean tags/comments
        await execFileImpl("ffmpeg", [
          "-hide_banner", "-loglevel", "error", "-y",
          "-i", inputPath,
          "-map", `0:${stream.streamIndex}`,
          vttAbsolute,
        ]);

        try {
          const rawVtt = await readFile(vttAbsolute, "utf8");
          const cleanedVtt = cleanAssToVtt(rawVtt);
          await writeFile(vttAbsolute, cleanedVtt, "utf8");
        } catch (cleanError) {
          log?.warn?.({ err: cleanError, mediaId, streamIndex: stream.streamIndex }, "failed to clean ass-to-vtt output");
        }
      } else {
        // Standard SRT / MOV_TEXT / VTT stream
        await execFileImpl("ffmpeg", [
          "-hide_banner", "-loglevel", "error", "-y",
          "-i", inputPath,
          "-map", `0:${stream.streamIndex}`,
          vttAbsolute,
        ]);
      }

      const { rows } = await pg.query(
        `INSERT INTO media_subtitles (
           media_id, stream_index, language, title, format, is_default, has_ass_styling, vtt_path, ass_path, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (media_id, stream_index) DO UPDATE
         SET language = EXCLUDED.language,
             title = EXCLUDED.title,
             format = EXCLUDED.format,
             is_default = EXCLUDED.is_default,
             has_ass_styling = EXCLUDED.has_ass_styling,
             vtt_path = EXCLUDED.vtt_path,
             ass_path = EXCLUDED.ass_path,
             updated_at = NOW()
         RETURNING *`,
        [
          mediaId,
          stream.streamIndex,
          stream.language,
          stream.title,
          stream.format,
          stream.isDefault,
          stream.hasAssStyling,
          vttRelative,
          assRelative,
        ]
      );

      if (rows[0]) {
        results.push(serializeSubtitle(rows[0]));
      }
    } catch (err) {
      log?.warn?.({ err, mediaId, streamIndex: stream.streamIndex }, "failed extracting subtitle stream");
    }
  }

  return results;
}

export async function getSubtitlesForMedia(pg, mediaId) {
  const { rows } = await pg.query(
    "SELECT * FROM media_subtitles WHERE media_id = $1 ORDER BY stream_index ASC",
    [mediaId]
  );
  return rows.map(serializeSubtitle);
}
