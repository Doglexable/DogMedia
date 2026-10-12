import Fastify from "fastify";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import desktopReleaseRoutes from "./desktop-release.js";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function buildApp() {
  const dataDir = await mkdtemp(join(tmpdir(), "pfs-desktop-release-"));
  tempDirs.push(dataDir);
  const app = Fastify();
  await app.register(desktopReleaseRoutes, { prefix: "/api/desktop-release", dataDir });
  return { app, dataDir };
}

describe("desktop release routes", () => {
  it("lists only published packages and streams the selected file", async () => {
    const { app, dataDir } = await buildApp();
    const root = join(dataDir, "desktop-release");
    await mkdir(root);
    const bytes = Buffer.from("test-deb-package");
    await writeFile(join(root, "dogmedia-linux-amd64.deb"), bytes);

    const status = await app.inject({ method: "GET", url: "/api/desktop-release" });
    expect(status.json()).toEqual({ releases: [{ id: "linux-deb", platform: "linux", label: "Debian / Ubuntu (.deb)", size: bytes.length }] });

    const download = await app.inject({ method: "GET", url: "/api/desktop-release/download/linux-deb" });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload).toEqual(bytes);
    expect(download.headers["content-disposition"]).toContain("dogmedia-linux-amd64.deb");
    expect(download.headers["content-length"]).toBe(String(bytes.length));
    await app.close();
  });

  it("does not expose missing or unknown packages", async () => {
    const { app } = await buildApp();
    const status = await app.inject({ method: "GET", url: "/api/desktop-release" });
    expect(status.json()).toEqual({ releases: [] });
    const missing = await app.inject({ method: "GET", url: "/api/desktop-release/download/macos-arm64" });
    const unknown = await app.inject({ method: "GET", url: "/api/desktop-release/download/secret" });
    expect(missing.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
    await app.close();
  });

  it("serves macOS ZIP releases and ignores the old mislabeled ISO", async () => {
    const { app, dataDir } = await buildApp();
    const root = join(dataDir, "desktop-release");
    await mkdir(root);
    await writeFile(join(root, "dogmedia-macos-arm64.dmg"), "old-iso");
    expect((await app.inject({ method: "GET", url: "/api/desktop-release" })).json()).toEqual({ releases: [] });

    const bytes = Buffer.from("PK\x03\x04test-zip");
    await writeFile(join(root, "dogmedia-macos-arm64.zip"), bytes);
    const listed = await app.inject({ method: "GET", url: "/api/desktop-release" });
    expect(listed.json().releases).toEqual([{
      id: "macos-arm64", platform: "macos", label: "Apple silicon (.zip)", size: bytes.length,
    }]);
    const download = await app.inject({ method: "GET", url: "/api/desktop-release/download/macos-arm64" });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("application/zip");
    expect(download.headers["content-disposition"]).toContain("dogmedia-macos-arm64.zip");
    expect(download.rawPayload).toEqual(bytes);
    await app.close();
  });
});
