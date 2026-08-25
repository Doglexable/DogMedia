import { describe, expect, it, vi } from "vitest";
import { createApiUnreachableError, getPlaybackErrorPresentation } from "./playback-errors.js";

describe("playback error presentation", () => {
  it("routes an unreachable API error to Downloads", () => {
    const presentation = getPlaybackErrorPresentation(createApiUnreachableError());
    const navigate = vi.fn();
    if (presentation.route) navigate(presentation.route);

    expect(presentation).toMatchObject({
      title: "Server unavailable",
      actionLabel: "Open Downloads",
      route: "Downloads",
    });
    expect(navigate).toHaveBeenCalledWith("Downloads");
  });

  it("keeps non-connectivity failures as regular playback errors", () => {
    expect(getPlaybackErrorPresentation(new Error("Unsupported codec"))).toEqual({
      title: "Playback unavailable",
      message: "Unsupported codec",
      actionLabel: "OK",
      route: null,
    });
  });
});
