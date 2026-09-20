import { access, mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";
import { replaceMediaFiles } from "./media.js";

function replyCapture() {
  return {
    statusCode: 200,
    code(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    send(body) {
      return { body, statusCode: this.statusCode };
    },
  };
}

describe("media file replacement artwork", () => {
  it("stores replacement artwork on a video item", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfs-replacement-artwork-"));
    const tempPath = join(dataDir, "poster.jpg");
    await writeFile(tempPath, "poster");
    const normalizeCover = vi.fn().mockResolvedValue("7/42/cover-new.webp");
    const queries = [];
    const fastify = {
      pg: {
        async query(sql, params) {
          queries.push({ sql, params });
          if (sql.startsWith("SELECT * FROM media_assets")) {
            return { rows: [{
              id: 42,
              category_id: 7,
              file_path: "7/42.mp4",
              mime_type: "video/mp4",
              thumbnail_path: "7/42/cover-old.webp",
              source_version: 3,
              content_kind: "film",
            }] };
          }
          return { rows: [{
            id: 42,
            title: "Film",
            thumbnail_path: params[7],
            source_version: 3,
          }] };
        },
      },
    };

    const result = await replaceMediaFiles({
      fastify,
      reply: replyCapture(),
      mediaId: 42,
      lyrics: undefined,
      thumbUpload: { tempPath, filename: "poster.jpg" },
      dataDir,
      normalizeCover,
    });

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      id: 42,
      thumbnail_path: "7/42/cover-new.webp",
      artwork_version: "7/42/cover-new.webp",
    });
    expect(normalizeCover).toHaveBeenCalledWith(expect.objectContaining({
      categoryId: 7,
      mediaId: 42,
      dataDir,
      inputPath: tempPath,
    }));
    expect(queries.at(-1).params[7]).toBe("7/42/cover-new.webp");
    await expect(access(tempPath)).rejects.toThrow();
  });

  it("keeps audio artwork managed at category level", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "pfs-replacement-audio-artwork-"));
    const tempPath = join(dataDir, "cover.jpg");
    await writeFile(tempPath, "cover");
    const fastify = {
      pg: {
        query: vi.fn().mockResolvedValueOnce({ rows: [{ id: 8, category_id: 2, mime_type: "audio/flac" }] }),
      },
    };

    const result = await replaceMediaFiles({
      fastify,
      reply: replyCapture(),
      mediaId: 8,
      lyrics: undefined,
      thumbUpload: { tempPath, filename: "cover.jpg" },
      dataDir,
    });

    expect(result.statusCode).toBe(400);
    expect(result.body.error).toMatch(/category thumbnail endpoint/);
    await expect(access(tempPath)).rejects.toThrow();
  });
});
