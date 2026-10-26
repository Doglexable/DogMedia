import { createReadStream, existsSync } from "fs";
import { readdir, readFile, stat } from "fs/promises";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getProfilePicturesDir(dataDir = "data") {
  const candidates = [
    resolve(__dirname, "../../assets/img/profile-picture"),
    resolve(__dirname, "../../assets/image/profile-picture"),
    resolve(__dirname, "../../asset/image/profile-picture"),
    resolve(__dirname, "../../asset/img/profile-picture"),
    join(process.cwd(), "server", "assets", "img", "profile-picture"),
    join(process.cwd(), "server", "assets", "image", "profile-picture"),
    join(process.cwd(), "server", "asset", "image", "profile-picture"),
    join(process.cwd(), "assets", "img", "profile-picture"),
    join(process.cwd(), "assets", "image", "profile-picture"),
    join(process.cwd(), "asset", "image", "profile-picture"),
    join(dataDir, "profile-picture"),
    join(dataDir, "media", "profile-picture"),
    join(process.cwd(), dataDir, "media", "profile-picture"),
    join(process.cwd(), dataDir, "profile-picture"),
    join(process.cwd(), "..", "data", "media", "profile-picture"),
    join(process.cwd(), "..", "data", "profile-picture"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

export async function listProfilePictures(dir) {
  try {
    const files = await readdir(dir);
    const available = new Set(files);
    const result = [];
    const seen = new Set();
    for (const file of files) {
      const match = /^_(.+?)_s_\.webp$/.exec(file);
      if (match) {
        const id = match[1];
        if (!seen.has(id) && available.has(`_${id}_l_.webp`)) {
          seen.add(id);
          const name = id
            .split("_")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");
          result.push({
            id,
            name,
            small: `/api/profile-pictures/${id}?size=s`,
            large: `/api/profile-pictures/${id}?size=l`,
          });
        }
      }
    }
    result.sort((a, b) => a.id.localeCompare(b.id));
    return result;
  } catch {
    return [];
  }
}

export function resolveAvatarFile(profilePicturesDir, rawName, size = "s") {
  if (!rawName || typeof rawName !== "string") return null;
  const normalizedSize = String(size || "").toLowerCase() === "l" ? "l" : "s";
  let targetFile;

  if (rawName.endsWith(".webp") || rawName.endsWith(".gif")) {
    targetFile = rawName;
  } else {
    const base = rawName.replace(/^_+|_+$/g, "").replace(/_(s|l|m|f)$/i, "");
    targetFile = `_${base}_${normalizedSize}_.webp`;
  }

  // Prevent path traversal
  const resolved = resolve(profilePicturesDir, targetFile);
  if (!resolved.startsWith(profilePicturesDir)) {
    return null;
  }
  return resolved;
}

export default async function profilePicturesRoutes(fastify, options = {}) {
  const dataDir = options.dataDir || process.env.DATA_DIR || "data";
  const profilePicturesDir = getProfilePicturesDir(dataDir);

  fastify.get("/", async () => {
    const pictures = await listProfilePictures(profilePicturesDir);
    return { pictures };
  });

  fastify.get("/credits", async (request, reply) => {
    const creditsPath = join(profilePicturesDir, "CREDITS.txt");
    try {
      const text = await readFile(creditsPath, "utf-8");
      reply.header("Cache-Control", "public, max-age=86400");
      return { ok: true, credits: text };
    } catch {
      return { ok: true, credits: "" };
    }
  });

  fastify.get("/:name", async (request, reply) => {
    const { name } = request.params || {};
    const { size } = request.query || {};

    let filePath = resolveAvatarFile(profilePicturesDir, name, size);
    if (!filePath || !existsSync(filePath)) {
      // Fallback to default avatar 'fine' with requested size if custom avatar is missing
      filePath = resolveAvatarFile(profilePicturesDir, "fine", size);
      if (!filePath || !existsSync(filePath)) {
        return reply.code(404).send({ error: "Profile picture not found" });
      }
    }

    try {
      const stats = await stat(filePath);
      const etag = `W/"${stats.size.toString(16)}-${Math.floor(stats.mtimeMs).toString(16)}"`;
      reply.header("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
      reply.header("Content-Disposition", "inline");
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("ETag", etag);
      reply.header("Last-Modified", stats.mtime.toUTCString());

      const modifiedSince = Date.parse(request.headers["if-modified-since"] || "");
      if (
        request.headers["if-none-match"] === etag ||
        (!request.headers["if-none-match"] &&
          Number.isFinite(modifiedSince) &&
          stats.mtimeMs <= modifiedSince + 999)
      ) {
        return reply.code(304).send();
      }

      const mimeType = filePath.endsWith(".gif") ? "image/gif" : "image/webp";
      reply.type(mimeType);
      return reply.send(createReadStream(filePath));
    } catch {
      return reply.code(404).send({ error: "Profile picture not found" });
    }
  });
}
