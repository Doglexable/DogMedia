import { describe, expect, it } from "vitest";
import {
  getCompletionAction,
  getQueueNavigation,
  isValidResumePosition,
  normalizeQueueState,
} from "./player-state.js";

describe("normalizeQueueState", () => {
  it("uses the active media when it is present in the queue", () => {
    expect(normalizeQueueState({ queue: [4, 8, 12], currentIndex: 0, items: [] }, 8)).toEqual({
      queueIds: [4, 8, 12],
      queueItems: [],
      queueIndex: 1,
    });
  });

  it("falls back to the server index when no media is selected", () => {
    expect(normalizeQueueState({ queue: [4, 8], currentIndex: 1 }, null)?.queueIndex).toBe(1);
  });
});

describe("queue navigation", () => {
  it("stops linear navigation at both boundaries", () => {
    expect(getQueueNavigation([1, 2], 0)).toMatchObject({ hasPrev: false, hasNext: true });
    expect(getQueueNavigation([1, 2], 1)).toMatchObject({ hasPrev: true, hasNext: false });
  });

  it("enables both boundaries when queue looping can wrap", () => {
    expect(getQueueNavigation([1, 2], 0, "queue")).toMatchObject({ hasPrev: true, hasNext: true });
    expect(getQueueNavigation([1, 2], 1, "queue")).toMatchObject({ hasPrev: true, hasNext: true });
  });
});

describe("completion behavior", () => {
  it("prioritizes media repeat, then linear advance, queue wrap, and stop", () => {
    expect(getCompletionAction({ loopMode: "media", hasLinearNext: true, queueLength: 2 })).toBe("repeat");
    expect(getCompletionAction({ loopMode: "none", hasLinearNext: true, queueLength: 2 })).toBe("advance");
    expect(getCompletionAction({ loopMode: "queue", hasLinearNext: false, queueLength: 2 })).toBe("wrap");
    expect(getCompletionAction({ loopMode: "none", hasLinearNext: false, queueLength: 2 })).toBe("stop");
  });
});

describe("resume validation", () => {
  it("accepts meaningful unfinished positions only", () => {
    expect(isValidResumePosition(2, 100)).toBe(true);
    expect(isValidResumePosition(1, 100)).toBe(false);
    expect(isValidResumePosition(97, 100)).toBe(false);
    expect(isValidResumePosition(12, 0)).toBe(true);
  });
});
