import { describe, expect, it, vi } from "vitest";
import { createLatestSummaryLoader } from "./dashboard-summary";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("createLatestSummaryLoader", () => {
  it("applies summary when single request succeeds", async () => {
    const applySummary = vi.fn();
    const fetchSummary = vi.fn().mockResolvedValue({ featuredId: 42 });
    const loader = createLatestSummaryLoader({ fetchSummary, applySummary });

    await loader.load("/api/playback/dashboard");

    expect(fetchSummary).toHaveBeenCalledWith("/api/playback/dashboard", { signal: undefined });
    expect(applySummary).toHaveBeenCalledWith({ featuredId: 42 });
  });

  it("handles normal resolution order (A then B)", async () => {
    const applySummary = vi.fn();
    const defA = deferred();
    const defB = deferred();

    const fetchSummary = vi.fn((url) => {
      if (url.includes("category=1")) return defA.promise;
      return defB.promise;
    });

    const loader = createLatestSummaryLoader({ fetchSummary, applySummary });

    const pA = loader.load("/api/playback/dashboard?category=1");
    const pB = loader.load("/api/playback/dashboard?category=2");

    defA.resolve({ category: 1 });
    await pA;
    // A was overwritten immediately by starting B, so A is not the latest generation!
    expect(applySummary).not.toHaveBeenCalledWith({ category: 1 });

    defB.resolve({ category: 2 });
    await pB;
    expect(applySummary).toHaveBeenCalledWith({ category: 2 });
    expect(applySummary).toHaveBeenCalledTimes(1);
  });

  it("handles reverse resolution order: B finishes before old A (stale A is ignored)", async () => {
    const applied = [];
    const applySummary = vi.fn((data) => applied.push(data));
    const defA = deferred();
    const defB = deferred();

    const fetchSummary = vi.fn((url) => {
      if (url.includes("category=1")) return defA.promise;
      return defB.promise;
    });

    const loader = createLatestSummaryLoader({ fetchSummary, applySummary });

    const pA = loader.load("/api/playback/dashboard?category=1");
    const pB = loader.load("/api/playback/dashboard?category=2");

    // B finishes first
    defB.resolve({ category: 2, featuredId: 200 });
    await pB;
    expect(applied).toEqual([{ category: 2, featuredId: 200 }]);

    // A finishes late
    defA.resolve({ category: 1, featuredId: 100 });
    await pA;

    // Stale A must NOT overwrite B
    expect(applied).toEqual([{ category: 2, featuredId: 200 }]);
    expect(applySummary).toHaveBeenCalledTimes(1);
  });

  it("ignores late old rejection when newer request is pending or finished", async () => {
    const applied = [];
    const applySummary = vi.fn((data) => applied.push(data));
    const defA = deferred();
    const defB = deferred();

    const fetchSummary = vi.fn((url) => {
      if (url.includes("category=1")) return defA.promise;
      return defB.promise;
    });

    const loader = createLatestSummaryLoader({ fetchSummary, applySummary });

    const pA = loader.load("/api/playback/dashboard?category=1");
    const pB = loader.load("/api/playback/dashboard?category=2");

    // Old request A rejects with network error
    defA.reject(new Error("Network failed"));
    await pA;

    // Must NOT call applySummary(null) because A is stale
    expect(applySummary).not.toHaveBeenCalled();

    // B succeeds
    defB.resolve({ category: 2, featuredId: 200 });
    await pB;
    expect(applied).toEqual([{ category: 2, featuredId: 200 }]);
  });

  it("calls applySummary(null) on real failure of current request", async () => {
    const applySummary = vi.fn();
    const fetchSummary = vi.fn().mockRejectedValue(new Error("500 Internal Error"));
    const loader = createLatestSummaryLoader({ fetchSummary, applySummary });

    await loader.load("/api/playback/dashboard");

    expect(applySummary).toHaveBeenCalledWith(null);
  });

  it("does not call applySummary on AbortError", async () => {
    const applySummary = vi.fn();
    const abortErr = new Error("Aborted");
    abortErr.name = "AbortError";
    const fetchSummary = vi.fn().mockRejectedValue(abortErr);
    const loader = createLatestSummaryLoader({ fetchSummary, applySummary });

    await loader.load("/api/playback/dashboard");

    expect(applySummary).not.toHaveBeenCalled();
  });

  it("invalidates in-flight requests on cleanup/unmount", async () => {
    const applySummary = vi.fn();
    const def = deferred();
    const fetchSummary = vi.fn().mockReturnValue(def.promise);
    const loader = createLatestSummaryLoader({ fetchSummary, applySummary });

    const loadPromise = loader.load("/api/playback/dashboard");
    loader.invalidate();

    def.resolve({ featuredId: 99 });
    await loadPromise;

    expect(applySummary).not.toHaveBeenCalled();
  });
});
