import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import contentSignalsRoutes from "./content-signals.js";

describe("Content signals and markdown negotiation routes", () => {
  it("serves robots.txt with Content-Signal directives", async () => {
    const app = Fastify();
    await app.register(contentSignalsRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/robots.txt",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.headers["cache-control"]).toBe("public, max-age=86400");
    expect(response.payload).toContain("User-agent: *");
    expect(response.payload).toContain("Content-Signal: ai-train=no, search=yes, ai-input=no");
    expect(response.payload).toContain("Disallow: /");
  });

  it("returns markdown content when Accept: text/markdown is provided", async () => {
    const app = Fastify();
    await app.register(contentSignalsRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/",
      headers: {
        accept: "text/markdown",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/markdown");
    expect(response.headers.vary).toContain("Accept");
    expect(response.payload).toContain("# Dogmedia");
    expect(response.payload).toContain("## Overview");
    expect(response.payload).toContain("## Client Applications");
  });

  it("returns JSON status when normal browser/client Accept header is sent to root", async () => {
    const app = Fastify();
    await app.register(contentSignalsRoutes, { version: "0.7.6" });

    const response = await app.inject({
      method: "GET",
      url: "/",
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.vary).toContain("Accept");
    const json = JSON.parse(response.payload);
    expect(json).toEqual({
      status: "ok",
      app: "Dogmedia",
      version: "0.7.6",
    });
  });

  it("serves /index.md directly as markdown", async () => {
    const app = Fastify();
    await app.register(contentSignalsRoutes);

    const response = await app.inject({
      method: "GET",
      url: "/index.md",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/markdown");
    expect(response.payload).toContain("# Dogmedia");
  });
});
