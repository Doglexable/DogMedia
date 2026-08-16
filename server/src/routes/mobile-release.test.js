import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import mobileReleaseRoutes from "./mobile-release.js";

const tempDirs = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function buildApp(accessTier = 100) {
  const dataDir = await mkdtemp(join(tmpdir(), "pfs-mobile-release-"));
  tempDirs.push(dataDir);
  const app = Fastify();
  await app.register(multipart, { limits: { fileSize: 1024 * 1024 } });
  app.addHook("onRequest", async (request) => {
    request.accessTier = accessTier;
    request.clientIp = "127.0.0.1";
  });
  await app.register(mobileReleaseRoutes, { prefix: "/api/mobile-release", dataDir });
  return app;
}

function multipartChunk(index, bytes) {
  const boundary = "pfs-release-test-boundary";
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="index"\r\n\r\n${index}\r\n`
    + `--${boundary}\r\nContent-Disposition: form-data; name="chunk"; filename="release.apk"\r\n`
    + "Content-Type: application/vnd.android.package-archive\r\n\r\n",
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([prefix, bytes, suffix]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

describe("mobile release routes", () => {
  it("reports an unavailable release before an APK is published", async () => {
    const app = await buildApp();
    const status = await app.inject({ method: "GET", url: "/api/mobile-release" });
    const download = await app.inject({ method: "GET", url: "/api/mobile-release/download" });

    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({ available: false });
    expect(download.statusCode).toBe(404);
    await app.close();
  });

  it("rejects release mutations below the admin access tier", async () => {
    const app = await buildApp(99);
    const response = await app.inject({
      method: "POST",
      url: "/api/mobile-release/uploads",
      payload: { version: "1.0.0", filename: "release.apk", size: 4 },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("publishes, downloads, and removes a chunked APK", async () => {
    const app = await buildApp();
    const apk = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x44, 0x4d]);
    const init = await app.inject({
      method: "POST",
      url: "/api/mobile-release/uploads",
      payload: { version: "1.2.3", filename: "dogmedia.apk", size: apk.length },
    });
    expect(init.statusCode).toBe(201);

    const { uploadId } = init.json();
    const chunk = multipartChunk(0, apk);
    const uploaded = await app.inject({
      method: "POST",
      url: `/api/mobile-release/uploads/${uploadId}/chunks`,
      ...chunk,
    });
    expect(uploaded.statusCode).toBe(200);

    const complete = await app.inject({ method: "POST", url: `/api/mobile-release/uploads/${uploadId}/complete` });
    expect(complete.statusCode).toBe(200);
    expect(complete.json()).toMatchObject({ available: true, version: "1.2.3", size: apk.length });

    const download = await app.inject({ method: "GET", url: "/api/mobile-release/download" });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toContain("application/vnd.android.package-archive");
    expect(download.rawPayload).toEqual(apk);

    const removed = await app.inject({ method: "DELETE", url: "/api/mobile-release" });
    expect(removed.statusCode).toBe(204);
    const status = await app.inject({ method: "GET", url: "/api/mobile-release" });
    expect(status.json()).toEqual({ available: false });
    await app.close();
  });
});
