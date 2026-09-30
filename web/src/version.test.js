import { describe, expect, it } from "vitest";
import { APP_VERSION, APP_VERSION_LABEL, APP_NAME, APP_FULL_NAME } from "./version";

describe("version module", () => {
  it("exports valid version string", () => {
    expect(typeof APP_VERSION).toBe("string");
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("exports correct version label with v prefix", () => {
    expect(APP_VERSION_LABEL).toBe(`v${APP_VERSION.replace(/^v/, "")}`);
    expect(APP_VERSION_LABEL.startsWith("v")).toBe(true);
  });

  it("exports app name and formatted full name", () => {
    expect(APP_NAME).toBe("Dogmedia");
    expect(APP_FULL_NAME).toBe(`Dogmedia Web ${APP_VERSION_LABEL}`);
  });
});
