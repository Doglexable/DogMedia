import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import mediaRoutes, { mediaMetadataFromTags, parseTrackOrder, resolveTrackOrder } from "./media.js";

describe("track order metadata", () => {
  it.each([
    ["05", 5],
    ["5/12", 5],
    [" 09 / 14 ", 9],
    [7, 7],
    ["", null],
    ["0", null],
    ["side-a", null],
    ["3 of 12", null],
  ])("parses %j as %j", (input, expected) => {
    expect(parseTrackOrder(input)).toBe(expected);
  });

  it.each([
    [{ TRACK: "03/12" }, 3],
    [{ tracknumber: "04" }, 4],
    [{ Track_Number: "05" }, 5],
  ])("reads case-insensitive track tags from %j", (tags, expected) => {
    expect(mediaMetadataFromTags(tags).trackOrder).toBe(expected);
  });

  it("prefers an explicit upload order over detected metadata", () => {
    expect(resolveTrackOrder("7", 2)).toBe(7);
    expect(resolveTrackOrder("", 2)).toBe(2);
    expect(resolveTrackOrder("", null)).toBeNull();
  });

  it("rescans audio metadata without clearing missing or failed rows", async () => {
    const updates = [];
    const app = Fastify();
    app.decorate("pg", {
      async query(sql, params) {
        if (sql.startsWith("SELECT id, file_path")) {
          return {
            rows: [
              { id: 1, file_path: "7/1.flac", track_order: null },
              { id: 2, file_path: "7/2.flac", track_order: 2 },
              { id: 3, file_path: "7/3.flac", track_order: 8 },
              { id: 4, file_path: "7/4.flac", track_order: 9 },
            ],
          };
        }
        if (sql.startsWith("UPDATE media_assets SET track_order")) {
          updates.push(params);
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 100;
    });
    await app.register(mediaRoutes, {
      prefix: "/api/media",
      probeMediaTags: async (path) => {
        if (path.endsWith("1.flac")) return { trackOrder: 1 };
        if (path.endsWith("2.flac")) return { trackOrder: 2 };
        if (path.endsWith("3.flac")) return { trackOrder: null };
        return { probeFailed: true };
      },
    });

    const response = await app.inject({ method: "POST", url: "/api/media/track-orders/scan" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ scanned: 4, updated: 1, missing: 1, failed: 1 });
    expect(updates).toEqual([[1, 1]]);
    await app.close();
  });

  it("requires admin access for a metadata rescan", async () => {
    const app = Fastify();
    app.decorate("pg", { query: async () => ({ rows: [] }) });
    app.addHook("onRequest", async (request) => {
      request.accessTier = 99;
    });
    await app.register(mediaRoutes, { prefix: "/api/media" });

    const response = await app.inject({ method: "POST", url: "/api/media/track-orders/scan" });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
