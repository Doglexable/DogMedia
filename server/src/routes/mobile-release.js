import { createReadStream, createWriteStream } from "fs";
import { appendFile, mkdir, open, readFile, rename, rm, stat, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";
import { pipeline } from "stream/promises";

const DATA_DIR = process.env.DATA_DIR || "data";
const CHUNK_SIZE = 512 * 1024;
const MAX_APK_SIZE = 300 * 1024 * 1024;

function validUploadId(value) {
  return /^[0-9a-f-]{36}$/i.test(value || "");
}

function releasePaths(dataDir) {
  const root = join(dataDir, "mobile-release");
  return {
    root,
    apk: join(root, "dogmedia-android.apk"),
    metadata: join(root, "release.json"),
    uploads: join(root, "uploads"),
  };
}

async function readRelease(paths) {
  try {
    const [metadata, apkStats] = await Promise.all([
      readFile(paths.metadata, "utf8").then(JSON.parse),
      stat(paths.apk),
    ]);
    return { available: true, ...metadata, size: Number(apkStats.size) };
  } catch {
    return { available: false };
  }
}

export default async function mobileReleaseRoutes(fastify, options = {}) {
  const paths = releasePaths(options.dataDir || DATA_DIR);

  fastify.get("/", async () => readRelease(paths));

  fastify.get("/download", async (_request, reply) => {
    const release = await readRelease(paths);
    if (!release.available) return reply.code(404).send({ error: "Android release not found" });
    reply.header("Content-Length", release.size);
    reply.header("Content-Disposition", `attachment; filename="dogmedia-${release.version || "android"}.apk"`);
    reply.header("Cache-Control", "private, no-cache");
    reply.type("application/vnd.android.package-archive");
    return reply.send(createReadStream(paths.apk));
  });

  fastify.post("/uploads", async (request, reply) => {
    if (request.accessTier < 100) return reply.code(403).send({ error: "Insufficient tier" });
    const version = typeof request.body?.version === "string" ? request.body.version.trim().slice(0, 50) : "";
    const filename = typeof request.body?.filename === "string" ? request.body.filename.trim() : "";
    const size = Number(request.body?.size);
    if (!version) return reply.code(400).send({ error: "Release version is required" });
    if (!/^[a-z0-9][a-z0-9._+-]*$/i.test(version)) {
      return reply.code(400).send({ error: "Release version contains unsupported characters" });
    }
    if (!filename.toLowerCase().endsWith(".apk")) return reply.code(400).send({ error: "Choose an Android APK file" });
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_APK_SIZE) return reply.code(400).send({ error: "APK must be between 1 byte and 300 MB" });
    const uploadId = randomUUID();
    const uploadDir = join(paths.uploads, uploadId);
    await mkdir(uploadDir, { recursive: true });
    await writeFile(join(uploadDir, "manifest.json"), JSON.stringify({ version, filename, size, totalChunks: Math.ceil(size / CHUNK_SIZE) }));
    return reply.code(201).send({ uploadId, chunkSize: CHUNK_SIZE });
  });

  fastify.post("/uploads/:uploadId/chunks", async (request, reply) => {
    if (request.accessTier < 100) return reply.code(403).send({ error: "Insufficient tier" });
    if (!validUploadId(request.params.uploadId)) return reply.code(400).send({ error: "Invalid upload ID" });
    const uploadDir = join(paths.uploads, request.params.uploadId);
    let manifest;
    try {
      manifest = JSON.parse(await readFile(join(uploadDir, "manifest.json"), "utf8"));
    } catch {
      return reply.code(404).send({ error: "Upload not found" });
    }
    const part = await request.file({ limits: { fileSize: CHUNK_SIZE + 1024 } });
    const index = Number.parseInt(part?.fields?.index?.value, 10);
    if (!part || !Number.isInteger(index) || index < 0 || index >= manifest.totalChunks) {
      return reply.code(400).send({ error: "Invalid upload chunk" });
    }
    await pipeline(part.file, createWriteStream(join(uploadDir, `${index}.part`)));
    return { ok: true, index };
  });

  fastify.post("/uploads/:uploadId/complete", async (request, reply) => {
    if (request.accessTier < 100) return reply.code(403).send({ error: "Insufficient tier" });
    if (!validUploadId(request.params.uploadId)) return reply.code(400).send({ error: "Invalid upload ID" });
    const uploadDir = join(paths.uploads, request.params.uploadId);
    let manifest;
    try {
      manifest = JSON.parse(await readFile(join(uploadDir, "manifest.json"), "utf8"));
    } catch {
      return reply.code(404).send({ error: "Upload not found" });
    }
    const assembled = join(uploadDir, "release.apk.part");
    await writeFile(assembled, Buffer.alloc(0));
    for (let index = 0; index < manifest.totalChunks; index += 1) {
      let chunk;
      try {
        chunk = await readFile(join(uploadDir, `${index}.part`));
      } catch {
        return reply.code(409).send({ error: `Missing upload chunk ${index}` });
      }
      await appendFile(assembled, chunk);
    }
    const assembledStats = await stat(assembled);
    if (Number(assembledStats.size) !== Number(manifest.size)) {
      return reply.code(400).send({ error: "Uploaded APK size verification failed" });
    }
    const apkFile = await open(assembled, "r");
    const signature = Buffer.alloc(4);
    try {
      await apkFile.read(signature, 0, signature.length, 0);
    } finally {
      await apkFile.close();
    }
    if (!signature.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      await rm(assembled, { force: true });
      return reply.code(400).send({ error: "Uploaded file is not a valid APK archive" });
    }
    await mkdir(paths.root, { recursive: true });
    await rename(assembled, paths.apk);
    const metadata = {
      version: manifest.version,
      filename: manifest.filename,
      uploadedAt: new Date().toISOString(),
      uploadedBy: request.clientIp || request.ip,
    };
    await writeFile(paths.metadata, JSON.stringify(metadata), "utf8");
    await rm(uploadDir, { recursive: true, force: true });
    return { available: true, ...metadata, size: manifest.size };
  });

  fastify.delete("/uploads/:uploadId", async (request, reply) => {
    if (request.accessTier < 100) return reply.code(403).send({ error: "Insufficient tier" });
    if (!validUploadId(request.params.uploadId)) return reply.code(400).send({ error: "Invalid upload ID" });
    await rm(join(paths.uploads, request.params.uploadId), { recursive: true, force: true });
    return reply.code(204).send();
  });

  fastify.delete("/", async (request, reply) => {
    if (request.accessTier < 100) return reply.code(403).send({ error: "Insufficient tier" });
    await Promise.all([
      rm(paths.apk, { force: true }),
      rm(paths.metadata, { force: true }),
    ]);
    return reply.code(204).send();
  });
}
