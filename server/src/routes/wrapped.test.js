import { describe, expect, it } from "vitest";
import { acquireWrappedAccessLock, getWrappedAccessStatus } from "./wrapped.js";

const DAY_MS = 86400000;
const LOCK_MS = 30 * DAY_MS;

function createLockClient(now, locks = new Map()) {
  return {
    locks,
    async query(_sql, [clientIp]) {
      const existing = locks.get(clientIp);
      if (!existing || new Date(existing.next_open_at).getTime() <= now.getTime()) {
        const lastOpenedAt = now.toISOString();
        const nextOpenAt = new Date(now.getTime() + LOCK_MS).toISOString();
        const lock = {
          last_opened_at: lastOpenedAt,
          next_open_at: nextOpenAt,
        };

        locks.set(clientIp, lock);
        return { rows: [{ allowed: true, ...lock }] };
      }

      return { rows: [{ allowed: false, ...existing }] };
    },
  };
}

function createStatusClient(rows) {
  return {
    async query() {
      return { rows };
    },
  };
}

describe("acquireWrappedAccessLock", () => {
  it("allows the first request from an IP and writes a lock", async () => {
    const now = new Date("2026-08-04T00:00:00.000Z");
    const client = createLockClient(now);

    const access = await acquireWrappedAccessLock(client, "192.168.1.10");

    expect(access).toEqual({
      allowed: true,
      lastOpenedAt: "2026-08-04T00:00:00.000Z",
      nextOpenAt: "2026-09-03T00:00:00.000Z",
    });
    expect(client.locks.has("192.168.1.10")).toBe(true);
  });

  it("locks the same IP before 30 days have passed", async () => {
    const firstOpen = new Date("2026-08-04T00:00:00.000Z");
    const locks = new Map();
    await acquireWrappedAccessLock(createLockClient(firstOpen, locks), "192.168.1.10");

    const nextOpen = new Date("2026-08-20T00:00:00.000Z");
    const access = await acquireWrappedAccessLock(createLockClient(nextOpen, locks), "192.168.1.10");

    expect(access).toEqual({
      allowed: false,
      lastOpenedAt: "2026-08-04T00:00:00.000Z",
      nextOpenAt: "2026-09-03T00:00:00.000Z",
    });
  });

  it("allows the same IP after next_open_at and refreshes the lock", async () => {
    const firstOpen = new Date("2026-08-04T00:00:00.000Z");
    const locks = new Map();
    await acquireWrappedAccessLock(createLockClient(firstOpen, locks), "192.168.1.10");

    const unlockedAt = new Date("2026-09-03T00:00:00.000Z");
    const access = await acquireWrappedAccessLock(createLockClient(unlockedAt, locks), "192.168.1.10");

    expect(access).toEqual({
      allowed: true,
      lastOpenedAt: "2026-09-03T00:00:00.000Z",
      nextOpenAt: "2026-10-03T00:00:00.000Z",
    });
  });

  it("keeps locks independent by IP", async () => {
    const firstOpen = new Date("2026-08-04T00:00:00.000Z");
    const locks = new Map();
    await acquireWrappedAccessLock(createLockClient(firstOpen, locks), "192.168.1.10");

    const nextOpen = new Date("2026-08-20T00:00:00.000Z");
    const access = await acquireWrappedAccessLock(createLockClient(nextOpen, locks), "192.168.1.11");

    expect(access.allowed).toBe(true);
    expect(access.lastOpenedAt).toBe("2026-08-20T00:00:00.000Z");
    expect(locks.size).toBe(2);
  });
});

describe("getWrappedAccessStatus", () => {
  it("reports available without creating a lock when the IP has not opened Wrapped", async () => {
    const status = await getWrappedAccessStatus(createStatusClient([]), "192.168.1.10");

    expect(status).toEqual({
      available: true,
      lastOpenedAt: null,
      nextOpenAt: null,
      retryAfterSeconds: 0,
    });
  });

  it("reports unavailable lock metadata for an IP inside the cooldown", async () => {
    const status = await getWrappedAccessStatus(
      createStatusClient([
        {
          available: false,
          last_opened_at: "2026-08-04T00:00:00.000Z",
          next_open_at: "2026-09-03T00:00:00.000Z",
          retry_after_seconds: 2592000,
        },
      ]),
      "192.168.1.10"
    );

    expect(status).toEqual({
      available: false,
      lastOpenedAt: "2026-08-04T00:00:00.000Z",
      nextOpenAt: "2026-09-03T00:00:00.000Z",
      retryAfterSeconds: 2592000,
    });
  });
});
