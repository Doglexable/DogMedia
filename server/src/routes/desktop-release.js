import { createReadStream } from "fs";
import { lstat } from "fs/promises";
import { join } from "path";

const RELEASES = {
  "linux-deb": { filename: "dogmedia-linux-amd64.deb", platform: "linux", label: "Debian / Ubuntu (.deb)", type: "application/vnd.debian.binary-package" },
  "linux-rpm": { filename: "dogmedia-linux-x86_64.rpm", platform: "linux", label: "Fedora / RHEL (.rpm)", type: "application/x-rpm" },
  "windows-x64": { filename: "dogmedia-windows-x86_64.exe", platform: "windows", label: "Windows x64 (.exe)", type: "application/octet-stream" },
  "macos-arm64": { filename: "dogmedia-macos-arm64.zip", platform: "macos", label: "Apple silicon (.zip)", type: "application/zip" },
  "macos-x64": { filename: "dogmedia-macos-x86_64.zip", platform: "macos", label: "Intel Mac (.zip)", type: "application/zip" },
};

async function availableRelease(root, id) {
  const release = RELEASES[id];
  if (!release) return null;
  const path = join(root, release.filename);
  try {
    const file = await lstat(path);
    if (!file.isFile() || file.size < 1) return null;
    return { ...release, id, path, size: file.size };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export default async function desktopReleaseRoutes(fastify, options = {}) {
  const root = join(options.dataDir || process.env.DATA_DIR || "data", "desktop-release");

  fastify.get("/", async () => {
    const releases = await Promise.all(Object.keys(RELEASES).map((id) => availableRelease(root, id)));
    return {
      releases: releases.filter(Boolean).map(({ id, platform, label, size }) => ({ id, platform, label, size })),
    };
  });

  fastify.get("/download/:id", async (request, reply) => {
    const release = await availableRelease(root, request.params.id);
    if (!release) return reply.code(404).send({ error: "Desktop release not found" });
    reply.header("Content-Length", release.size);
    reply.header("Content-Disposition", `attachment; filename="${release.filename}"`);
    reply.header("Cache-Control", "private, no-cache");
    reply.type(release.type);
    return reply.send(createReadStream(release.path));
  });
}
