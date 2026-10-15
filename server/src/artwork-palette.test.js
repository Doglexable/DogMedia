import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, stat, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { artworkFilePath, ensureArtworkPalette, sharePaletteAccent } from "./artwork-palette.js";

const colors = [
  { hex: "#eeeeee", percentage: 60 },
  { hex: "#b6ae5d", percentage: 40 },
];
const fixtureDirs = [];

async function artworkFixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "pfs-palette-"));
  fixtureDirs.push(dataDir);
  await mkdir(join(dataDir, "7"));
  const filePath = join(dataDir, "7/front.webp");
  await writeFile(filePath, "artwork");
  return { dataDir, filePath };
}

afterEach(async () => {
  await Promise.all(fixtureDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("artwork palette persistence", () => {
  it("uses one versioned palette for every share of the same artwork", async () => {
    const { dataDir, filePath } = await artworkFixture();
    const fileStat = await stat(filePath);
    const fileFingerprint = `${fileStat.size}:${Math.trunc(fileStat.mtimeMs)}`;
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ colors, algorithm_version: 1, file_fingerprint: fileFingerprint }] });
    const runScript = vi.fn().mockResolvedValue({ stdout: JSON.stringify({ algorithm_version: 1, colors }) });
    const args = { pg: { query }, dataDir, artworkPath: "7/front.webp", runScript };

    expect(await ensureArtworkPalette(args)).toEqual(colors);
    expect(await ensureArtworkPalette(args)).toEqual(colors);
    expect(runScript).toHaveBeenCalledTimes(1);
    expect(runScript.mock.calls[0][1]).toEqual(expect.arrayContaining([filePath, "--json"]));
    expect(query.mock.calls[1][0]).toContain("ON CONFLICT (artwork_path) DO UPDATE");
    expect(query.mock.calls[1][1][3]).toBe(fileFingerprint);
  });

  it("rejects paths outside media storage and malformed script output", async () => {
    const { dataDir } = await artworkFixture();
    expect(() => artworkFilePath("/app/data/media", "../../etc/passwd")).toThrow("escapes");
    const pg = { query: vi.fn().mockResolvedValue({ rows: [] }) };
    await expect(ensureArtworkPalette({
      pg, dataDir, artworkPath: "7/front.webp",
      runScript: async () => ({ stdout: JSON.stringify({ algorithm_version: 1, colors: [{ hex: "red", percentage: 100 }] }) }),
    })).rejects.toThrow("invalid colors");
    expect(pg.query).toHaveBeenCalledTimes(1);
  });

  it("recomputes a palette when artwork at the same path changes", async () => {
    const { dataDir } = await artworkFixture();
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ colors, algorithm_version: 1, file_fingerprint: "stale" }] })
      .mockResolvedValueOnce({ rows: [] });
    const runScript = vi.fn().mockResolvedValue({ stdout: JSON.stringify({ algorithm_version: 1, colors }) });
    expect(await ensureArtworkPalette({ pg: { query }, dataDir, artworkPath: "7/front.webp", runScript })).toEqual(colors);
    expect(runScript).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[1][0]).toContain("file_fingerprint = EXCLUDED.file_fingerprint");
  });

  it("chooses a visible artwork color for share backgrounds", () => {
    expect(sharePaletteAccent(colors)).toBe("#b6ae5d");
    expect(sharePaletteAccent([{ hex: "#202020", percentage: 100 }])).toBe("#202020");
    expect(sharePaletteAccent(null)).toBeNull();
  });

});
