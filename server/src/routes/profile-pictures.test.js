import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import profilePicturesRoutes from "./profile-pictures.js";

describe("profile pictures routes", () => {
  it("lists available profile pictures with both small and large variants", async () => {
    const app = Fastify();
    await app.register(profilePicturesRoutes, { prefix: "/api/profile-pictures" });

    const response = await app.inject({
      method: "GET",
      url: "/api/profile-pictures",
    });

    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(Array.isArray(data.pictures)).toBe(true);
    expect(data.pictures.length).toBeGreaterThan(0);

    const fine = data.pictures.find((p) => p.id === "fine");
    expect(fine).toBeDefined();
    expect(fine.name).toBe("Fine");
    expect(fine.small).toBe("/api/profile-pictures/fine?size=s");
    expect(fine.large).toBe("/api/profile-pictures/fine?size=l");

    await app.close();
  });

  it("serves credits text from CREDITS.txt", async () => {
    const app = Fastify();
    await app.register(profilePicturesRoutes, { prefix: "/api/profile-pictures" });

    const response = await app.inject({
      method: "GET",
      url: "/api/profile-pictures/credits",
    });

    expect(response.statusCode).toBe(200);
    const data = response.json();
    expect(data.ok).toBe(true);
    expect(data.credits).toContain("Credits:");
    expect(data.credits).toContain("comickergirl");

    await app.close();
  });

  it("serves large variant (_l_.webp) when size=l is requested", async () => {
    const app = Fastify();
    await app.register(profilePicturesRoutes, { prefix: "/api/profile-pictures" });

    const response = await app.inject({
      method: "GET",
      url: "/api/profile-pictures/fine?size=l",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/webp");
    expect(response.headers["etag"]).toBeDefined();
    expect(response.body.length).toBeGreaterThan(0);

    await app.close();
  });

  it("serves small variant (_s_.webp) when size=s or no size is requested", async () => {
    const app = Fastify();
    await app.register(profilePicturesRoutes, { prefix: "/api/profile-pictures" });

    const response = await app.inject({
      method: "GET",
      url: "/api/profile-pictures/fine?size=s",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/webp");

    const defaultResponse = await app.inject({
      method: "GET",
      url: "/api/profile-pictures/fine",
    });
    expect(defaultResponse.statusCode).toBe(200);
    expect(defaultResponse.headers["content-type"]).toBe("image/webp");
    // Small variant should match default size
    expect(response.headers["etag"]).toBe(defaultResponse.headers["etag"]);

    await app.close();
  });

  it("serves direct filename requests like _fine_s_.webp", async () => {
    const app = Fastify();
    await app.register(profilePicturesRoutes, { prefix: "/api/profile-pictures" });

    const response = await app.inject({
      method: "GET",
      url: "/api/profile-pictures/_fine_s_.webp",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/webp");

    await app.close();
  });

  it("falls back to default avatar fine if avatar name does not exist", async () => {
    const app = Fastify();
    await app.register(profilePicturesRoutes, { prefix: "/api/profile-pictures" });

    const response = await app.inject({
      method: "GET",
      url: "/api/profile-pictures/non_existent_avatar?size=l",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/webp");

    await app.close();
  });

  it("prevents path traversal attacks", async () => {
    const app = Fastify();
    await app.register(profilePicturesRoutes, { prefix: "/api/profile-pictures" });

    const response = await app.inject({
      method: "GET",
      url: "/api/profile-pictures/..%2F..%2Fetc%2Fpasswd",
    });

    // Should either fall back to fine or return 404, never 200 with passwd
    if (response.statusCode === 200) {
      expect(response.headers["content-type"]).toBe("image/webp");
    } else {
      expect(response.statusCode).toBe(404);
    }

    await app.close();
  });
});
