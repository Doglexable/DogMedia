import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLeaseStatusPoller } from "./lease-status-poller";

describe("createLeaseStatusPoller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("performs an immediate read on start and delivers status", async () => {
    const getStatus = vi.fn().mockResolvedValue({ state: "busy", activeSession: { id: "s1" } });
    const onStatus = vi.fn().mockResolvedValue(undefined);

    const poller = createLeaseStatusPoller({ getStatus, onStatus, intervalMs: 5000 });

    expect(getStatus).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(onStatus).toHaveBeenCalledWith({ state: "busy", activeSession: { id: "s1" } });

    poller.stop();
  });

  it("schedules next read only after previous read completes and repeats on interval", async () => {
    let resolveGetStatus;
    const getStatus = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveGetStatus = resolve;
    }));
    const onStatus = vi.fn();

    const poller = createLeaseStatusPoller({ getStatus, onStatus, intervalMs: 5000 });

    expect(getStatus).toHaveBeenCalledTimes(1);
    // Advancing timers while request is in flight should not trigger overlapping requests
    await vi.advanceTimersByTimeAsync(10000);
    expect(getStatus).toHaveBeenCalledTimes(1);

    // Resolve first request
    resolveGetStatus({ state: "available" });
    await Promise.resolve();
    expect(onStatus).toHaveBeenCalledWith({ state: "available" });

    // Now advance 5000ms: second request triggers
    await vi.advanceTimersByTimeAsync(5000);
    expect(getStatus).toHaveBeenCalledTimes(2);

    poller.stop();
  });

  it("ignores in-flight response after stop() is called", async () => {
    let resolveGetStatus;
    const getStatus = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveGetStatus = resolve;
    }));
    const onStatus = vi.fn();

    const poller = createLeaseStatusPoller({ getStatus, onStatus, intervalMs: 5000 });

    expect(getStatus).toHaveBeenCalledTimes(1);
    poller.stop();
    expect(poller.isStopped()).toBe(true);

    // Resolve after stop
    resolveGetStatus({ state: "busy", activeSession: { id: "late" } });
    await Promise.resolve();

    expect(onStatus).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10000);
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it("tolerates transient failures and schedules subsequent retry", async () => {
    const getStatus = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network timeout"))
      .mockResolvedValueOnce({ state: "busy", activeSession: { id: "recovered" } });
    const onStatus = vi.fn();

    const poller = createLeaseStatusPoller({ getStatus, onStatus, intervalMs: 5000 });

    expect(getStatus).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(onStatus).not.toHaveBeenCalled();

    // Advance 5000ms for next poll
    await vi.advanceTimersByTimeAsync(5000);
    expect(getStatus).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(onStatus).toHaveBeenCalledWith({ state: "busy", activeSession: { id: "recovered" } });

    poller.stop();
  });

  it("stops scheduling timers when stop() is called", async () => {
    const getStatus = vi.fn().mockResolvedValue({ state: "available" });
    const onStatus = vi.fn();

    const poller = createLeaseStatusPoller({ getStatus, onStatus, intervalMs: 5000 });
    await Promise.resolve();
    expect(getStatus).toHaveBeenCalledTimes(1);

    poller.stop();
    await vi.advanceTimersByTimeAsync(20000);
    expect(getStatus).toHaveBeenCalledTimes(1);
  });
});
