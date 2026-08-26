import { describe, expect, it } from "vitest";
import { readJsonArray } from "./api";

describe("readJsonArray", () => {
  it("returns valid collection responses", async () => {
    await expect(readJsonArray(new Response(JSON.stringify([{ id: 1 }]), {
      headers: { "Content-Type": "application/json" }, status: 200,
    }))).resolves.toEqual([{ id: 1 }]);
  });

  it("surfaces an API error instead of returning its object as a collection", async () => {
    await expect(readJsonArray(new Response(JSON.stringify({ error: "Access denied" }), {
      headers: { "Content-Type": "application/json" }, status: 403,
    }), "Could not load media")).rejects.toThrow("Access denied");
  });

  it("rejects successful responses with the wrong shape", async () => {
    await expect(readJsonArray(new Response(JSON.stringify({ items: [] }), {
      headers: { "Content-Type": "application/json" }, status: 200,
    }), "Could not load media")).rejects.toThrow("expected an array response");
  });
});
