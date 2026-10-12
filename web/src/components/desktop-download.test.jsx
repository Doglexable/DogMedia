import { describe, expect, it } from "vitest";
import { detectDesktopPlatform } from "./desktop-download";

describe("detectDesktopPlatform", () => {
  it("detects desktop systems from browser platform data", () => {
    expect(detectDesktopPlatform({ userAgentData: { platform: "Windows" } })).toBe("windows");
    expect(detectDesktopPlatform({ platform: "MacIntel" })).toBe("macos");
    expect(detectDesktopPlatform({ platform: "Linux x86_64" })).toBe("linux");
  });

  it("does not mistake mobile devices for desktop systems", () => {
    expect(detectDesktopPlatform({ platform: "MacIntel", userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)" })).toBeNull();
    expect(detectDesktopPlatform({ platform: "MacIntel", maxTouchPoints: 5, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)" })).toBeNull();
    expect(detectDesktopPlatform({ platform: "Linux armv8l", userAgent: "Mozilla/5.0 (Linux; Android 14)" })).toBeNull();
  });
});
