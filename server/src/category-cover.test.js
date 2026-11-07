import { access, mkdir, mkdtemp, rm, stat, writeFile } from "fs/promises";
import { execFile } from "child_process";
import { join } from "path";
import { tmpdir } from "os";
import { promisify } from "util";
import { afterEach, describe, expect, it } from "vitest";
import {
  blurPathFromCover,
  generateBlurCover,
  normalizeCategoryCover,
  normalizeMediaCover,
  unlinkCoverWithBlur,
} from "./category-cover.js";

const execFileAsync = promisify(execFile);
let tempDirs = [];

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "pfs-cover-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

async function createTestImage(filePath) {
  await execFileAsync("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", "testsrc=size=320x240:rate=1",
    "-frames:v", "1",
    filePath,
  ]);
}

describe("blurPathFromCover", () => {
  it("converts .webp cover paths to companion -blur.webp paths", () => {
    expect(blurPathFromCover("7/front-1234.webp")).toBe("7/front-1234-blur.webp");
    expect(blurPathFromCover("7/44/cover-1234.webp")).toBe("7/44/cover-1234-blur.webp");
    expect(blurPathFromCover("7/front.webp")).toBe("7/front-blur.webp");
  });

  it("is idempotent when already a -blur.webp path", () => {
    expect(blurPathFromCover("7/front-1234-blur.webp")).toBe("7/front-1234-blur.webp");
  });

  it("returns null for non-string or falsy input", () => {
    expect(blurPathFromCover(null)).toBeNull();
    expect(blurPathFromCover(undefined)).toBeNull();
    expect(blurPathFromCover("")).toBeNull();
  });
});

describe("unlinkCoverWithBlur", () => {
  it("removes both cover and blur files if they exist", async () => {
    const dataDir = await makeTempDir();
    const coverRel = "7/front.webp";
    const blurRel = "7/front-blur.webp";
    await mkdir(join(dataDir, "7"), { recursive: true });
    await writeFile(join(dataDir, coverRel), "cover");
    await writeFile(join(dataDir, blurRel), "blur");

    await unlinkCoverWithBlur(dataDir, coverRel);

    await expect(access(join(dataDir, coverRel))).rejects.toThrow();
    await expect(access(join(dataDir, blurRel))).rejects.toThrow();
  });

  it("does not throw if files do not exist", async () => {
    const dataDir = await makeTempDir();
    await expect(unlinkCoverWithBlur(dataDir, "7/non-existent.webp")).resolves.toBeUndefined();
    await expect(unlinkCoverWithBlur(dataDir, null)).resolves.toBeUndefined();
  });
});

describe("normalizeCategoryCover and normalizeMediaCover", () => {
  it("generates both high-res WebP and companion blurred WebP for category cover", async () => {
    const dataDir = await makeTempDir();
    const inputPath = join(dataDir, "input.png");
    await createTestImage(inputPath);

    const relPath = await normalizeCategoryCover({
      categoryId: 10,
      dataDir,
      inputPath,
    });

    const coverAbs = join(dataDir, relPath);
    const blurAbs = join(dataDir, blurPathFromCover(relPath));

    const coverStat = await stat(coverAbs);
    const blurStat = await stat(blurAbs);

    expect(coverStat.size).toBeGreaterThan(0);
    expect(blurStat.size).toBeGreaterThan(0);
    // Blur file must be significantly smaller than main cover
    expect(blurStat.size).toBeLessThan(coverStat.size);
  });

  it("generates both high-res WebP and companion blurred WebP for media cover", async () => {
    const dataDir = await makeTempDir();
    const inputPath = join(dataDir, "input.png");
    await createTestImage(inputPath);

    const relPath = await normalizeMediaCover({
      categoryId: 10,
      mediaId: 99,
      dataDir,
      inputPath,
    });

    const coverAbs = join(dataDir, relPath);
    const blurAbs = join(dataDir, blurPathFromCover(relPath));

    const coverStat = await stat(coverAbs);
    const blurStat = await stat(blurAbs);

    expect(coverStat.size).toBeGreaterThan(0);
    expect(blurStat.size).toBeGreaterThan(0);
    expect(blurStat.size).toBeLessThan(coverStat.size);
  });

  it("generateBlurCover creates blurred WebP from existing cover", async () => {
    const dataDir = await makeTempDir();
    const inputPath = join(dataDir, "input.png");
    const blurPath = join(dataDir, "output-blur.webp");
    await createTestImage(inputPath);

    const result = await generateBlurCover({ inputPath, outputPath: blurPath });
    expect(result.size).toBeGreaterThan(0);

    const stats = await stat(blurPath);
    expect(stats.size).toBe(result.size);
  });
});
